import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { rollUsageDie, resolveUsageDicePool } from "../module/helpers/usage-die.mjs";
import { resolveUsageDicePool as reExported } from "../module/helpers/dungeon-turn.mjs";

/**
 * A duck-typed stand-in for an Item. The shim deliberately leaves `Item`
 * undefined, and this helper only needs `system.usageDie` and `update`, so a
 * plain object is both sufficient and honest about the surface actually used.
 * `updates` records every write so a test can assert that NO write happened.
 */
function fakeItem({ enabled = true, udCurrent = 3, udMax = 3 } = {}) {
  const item = {
    system: { usageDie: { enabled, udCurrent, udMax, expiry: "dt" } },
    updates: [],
    async update(data) {
      item.updates.push(data);
      if ("system.usageDie.udCurrent" in data) {
        item.system.usageDie.udCurrent = data["system.usageDie.udCurrent"];
      }
    }
  };
  return item;
}

describe("resolveUsageDicePool (R:562)", () => {
  test("removes every die showing 1 or 2, not just one", () => {
    assert.deepEqual(resolveUsageDicePool([1, 2, 5]), {
      removed: 2, remaining: 1, depleted: false, faces: [1, 2, 5]
    });
  });

  test("3 and up survive; the boundary is 2/3", () => {
    assert.equal(resolveUsageDicePool([3, 4, 5, 6]).removed, 0);
    assert.equal(resolveUsageDicePool([2]).removed, 1);
    assert.equal(resolveUsageDicePool([3]).removed, 0);
  });

  test("a wholly unlucky pool depletes", () => {
    const res = resolveUsageDicePool([1, 1, 2]);
    assert.equal(res.remaining, 0);
    assert.equal(res.depleted, true);
  });

  test("an empty pool is depleted, not negative", () => {
    assert.deepEqual(resolveUsageDicePool([]), {
      removed: 0, remaining: 0, depleted: true, faces: []
    });
  });

  // `null` coerces to 0 — finite, and <= 2 — so a laxer numeric filter counted
  // it as a die removed. Only genuine d6 faces are kept.
  test("junk faces are discarded rather than counted as low rolls", () => {
    const res = resolveUsageDicePool([1, null, "x", undefined, 0, 7, -3, 2.5, 5]);
    assert.deepEqual(res.faces, [1, 5]);
    assert.equal(res.removed, 1, "only the real 1 counts as a removal");
    assert.equal(res.remaining, 1);
  });

  test("dungeon-turn re-exports the same function, so the rule has one implementation", () => {
    assert.equal(reExported, resolveUsageDicePool);
  });
});

describe("rollUsageDie (R:562)", () => {
  // THE REGRESSION. Playtest 1 rolled `1d6` and removed at most one die for any
  // pool size, so this returned udCurrent 2 where the rule says 1. It is the
  // assertion that fails against the old implementation.
  test("rolls the WHOLE pool and can lose several dice at once", async () => {
    const item = fakeItem({ udCurrent: 3 });
    const res = await rollUsageDie(item, { forced: [1, 2, 5] });

    assert.equal(res.rolls.length, 3, "must roll one die per die in the pool");
    assert.equal(res.removed, 2);
    assert.equal(res.udCurrent, 1);
    assert.equal(res.depleted, false);
    assert.equal(item.system.usageDie.udCurrent, 1, "the loss is persisted");
  });

  test("a lucky roll writes nothing at all", async () => {
    const item = fakeItem({ udCurrent: 3 });
    const res = await rollUsageDie(item, { forced: [3, 4, 6] });

    assert.equal(res.removed, 0);
    assert.equal(res.udCurrent, 3);
    assert.deepEqual(item.updates, [], "no removal means no database write");
  });

  test("losing the last die reports depleted", async () => {
    const item = fakeItem({ udCurrent: 2 });
    const res = await rollUsageDie(item, { forced: [1, 2] });

    assert.equal(res.udCurrent, 0);
    assert.equal(res.depleted, true);
  });

  test("a disabled usage die is never rolled", async () => {
    const item = fakeItem({ enabled: false, udCurrent: 3 });
    const res = await rollUsageDie(item, { forced: [1, 1, 1] });

    assert.deepEqual(res.rolls, []);
    assert.equal(res.removed, 0);
    assert.deepEqual(item.updates, []);
  });

  test("an already-empty pool is depleted and rolls nothing", async () => {
    const item = fakeItem({ udCurrent: 0 });
    const res = await rollUsageDie(item, { forced: [1] });

    assert.deepEqual(res.rolls, []);
    assert.equal(res.depleted, true);
    assert.deepEqual(item.updates, []);
  });

  test("an item with no usageDie at all does not throw", async () => {
    const res = await rollUsageDie({ system: {} });
    assert.equal(res.depleted, true);
    assert.equal(res.removed, 0);
  });

  // The seam must not let a caller remove more dice than the item has, or
  // udCurrent would go negative on a mis-sized injection.
  test("more forced faces than dice in the pool cannot overdraw it", async () => {
    const item = fakeItem({ udCurrent: 2 });
    const res = await rollUsageDie(item, { forced: [1, 1, 1, 1] });

    assert.equal(res.rolls.length, 2, "the pool caps how many dice are rolled");
    assert.equal(res.udCurrent, 0);
  });

  test("a bare number is accepted as a single-die pool", async () => {
    const item = fakeItem({ udCurrent: 1 });
    const res = await rollUsageDie(item, { forced: 2 });

    assert.deepEqual(res.rolls, [2]);
    assert.equal(res.udCurrent, 0);
  });
});
