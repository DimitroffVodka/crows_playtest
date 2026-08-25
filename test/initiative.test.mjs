import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CROWS_SIDE,
  ENEMIES_SIDE,
  sideFromDisposition,
  sideFromCombatant,
  firstSideFromRoll,
  compareSideCombatants,
  nextPlayableTurnIndex
} from "../module/helpers/initiative.mjs";
import { targetLabels } from "../module/helpers/combat.mjs";
import { CrowsCombat } from "../module/documents/combat.mjs";

describe("side assignment — R:706", () => {
  test("a crow actor is a PC even when GM-owned and HOSTILE (R:706)", () => {
    // The live failure this pins: a Ref building an encounter solo owns every
    // actor and sets no dispositions, so all three combatants — two crows
    // included — sorted onto the enemy side and the whole feature did nothing.
    assert.equal(sideFromDisposition({
      actor: { type: "crow", hasPlayerOwner: false },
      token: { disposition: -1 }
    }), CROWS_SIDE);
  });

  test("an explicit override still beats actor type", () => {
    assert.equal(sideFromDisposition({
      actor: { type: "crow", hasPlayerOwner: true },
      override: "enemies"
    }), ENEMIES_SIDE);
  });

  test("a monster stays an enemy when GM-owned and not friendly", () => {
    assert.equal(sideFromDisposition({
      actor: { type: "monster", hasPlayerOwner: false },
      token: { disposition: -1 }
    }), ENEMIES_SIDE);
  });

  test("a player-owned actor defaults to the Crows side", () => {
    assert.equal(sideFromDisposition({ actor: { hasPlayerOwner: true }, token: { disposition: -1 } }), CROWS_SIDE);
  });

  test("a Friendly token defaults to the Crows side", () => {
    assert.equal(sideFromDisposition({ actor: { hasPlayerOwner: false }, token: { disposition: 1 } }), CROWS_SIDE);
  });

  test("a non-friendly, unowned combatant defaults to enemies", () => {
    assert.equal(sideFromCombatant({
      actor: { hasPlayerOwner: false },
      token: { disposition: -1 },
      flags: { crows: {} }
    }), ENEMIES_SIDE);
  });

  test("a valid crows.side override wins over ownership and disposition", () => {
    assert.equal(sideFromCombatant({
      actor: { hasPlayerOwner: true },
      token: { disposition: 1 },
      flags: { crows: { side: ENEMIES_SIDE } }
    }), ENEMIES_SIDE);
  });
});

describe("side roll — R:706", () => {
  test("a 5 puts enemies first", () => {
    assert.equal(firstSideFromRoll(5), ENEMIES_SIDE);
  });

  test("a 6 puts the Crows first", () => {
    assert.equal(firstSideFromRoll(6), CROWS_SIDE);
  });
});

describe("side comparator — Combat#setupTurns calls it unbound", () => {
  const parent = {
    getFlag(namespace, key) {
      assert.equal(namespace, "crows");
      return key === "firstSide" ? CROWS_SIDE : undefined;
    }
  };

  test("side rank, manual order, name and id are all deterministic", () => {
    const crows = { parent, side: CROWS_SIDE, order: 4, name: "Zed", id: "z" };
    const enemy = { parent, side: ENEMIES_SIDE, order: 0, name: "Abe", id: "a" };
    assert.ok(compareSideCombatants(crows, enemy) < 0);

    const first = { parent, side: CROWS_SIDE, order: 1, name: "Zed", id: "z" };
    const second = { parent, side: CROWS_SIDE, order: 2, name: "Abe", id: "a" };
    assert.ok(compareSideCombatants(first, second) < 0);

    const named = { parent, side: CROWS_SIDE, order: 3, name: "Abe", id: "b" };
    const namedLater = { parent, side: CROWS_SIDE, order: 3, name: "Zed", id: "a" };
    assert.ok(compareSideCombatants(named, namedLater) < 0);
  });

  test("the comparator works with this set to undefined", () => {
    const a = { parent, side: CROWS_SIDE, order: 1, name: "A", id: "a" };
    const b = { parent, side: ENEMIES_SIDE, order: 1, name: "B", id: "b" };
    assert.ok(CrowsCombat.prototype._sortCombatants.call(undefined, a, b) < 0);
  });
});

describe("surprise — R:704", () => {
  const turns = [
    { id: "surprised", surprised: true },
    { id: "ordinary", surprised: false },
    { id: "surprised-2", surprised: true }
  ];

  test("surprised combatants are skipped in round 1", () => {
    assert.equal(nextPlayableTurnIndex(turns, -1, { round: 1 }), 1);
    assert.equal(nextPlayableTurnIndex(turns, 1, { round: 1 }), null);
  });

  test("the same flag is ignored in round 2", () => {
    assert.equal(nextPlayableTurnIndex(turns, -1, { round: 2 }), 0);
    assert.equal(nextPlayableTurnIndex(turns, 0, { round: 2 }), 1);
  });
});

describe("surprised target labels — R:704", () => {
  test("a surprised target gets exactly +1", () => {
    assert.deepEqual(targetLabels({ surprised: true }).mods, [
      { key: "surprised", label: "Target surprised", value: 1 }
    ]);
  });

  test("an ordinary target gets no surprised modifier", () => {
    assert.deepEqual(targetLabels({ surprised: false }).mods, []);
  });
});
