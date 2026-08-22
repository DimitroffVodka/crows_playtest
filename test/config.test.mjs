import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CROWS, ALL_EXPERTISES, EXPERTISES_ALPHABETICAL, expertiseCategory,
  expertiseMaxForTxp, bonusesEarnedAtTxp, effectiveCapacities
} from "../module/config.mjs";

/**
 * T0.2 contract invariants. These are not "does the code run" tests — each one
 * pins a rule the contract depends on, so Wave 1 finds out immediately if a
 * later edit drifts from it.
 */

describe("expertise catalogue", () => {
  test("30 expertises in three categories (R:298-348)", () => {
    assert.equal(CROWS.expertises.general.length, 18);
    assert.equal(CROWS.expertises.spellcasting.length, 6);
    assert.equal(CROWS.expertises.weapon.length, 6);
    assert.equal(ALL_EXPERTISES.length, 30);
  });

  test("no key appears in two categories", () => {
    assert.equal(new Set(ALL_EXPERTISES).size, ALL_EXPERTISES.length);
  });

  test("the PT1 skills that were folded away are gone", () => {
    // climb/jump/swim -> athletics, hide/sneak -> stealth,
    // sabotage/sleightOfHand -> thievery, handleAnimal -> handlePet
    for (const dead of ["climb", "jump", "swim", "hide", "sneak",
                        "sabotage", "sleightOfHand", "handleAnimal"]) {
      assert.ok(!ALL_EXPERTISES.includes(dead), `${dead} should not survive`);
    }
    for (const live of ["athletics", "stealth", "thievery", "handlePet", "pickLock"]) {
      assert.ok(ALL_EXPERTISES.includes(live), `${live} should exist`);
    }
  });

  test("category lookup gates what a test may apply", () => {
    assert.equal(expertiseCategory("stealth"), "general");
    assert.equal(expertiseCategory("necromancy"), "spellcasting");
    assert.equal(expertiseCategory("bow"), "weapon");
    assert.equal(expertiseCategory("notAnExpertise"), undefined);
  });
});

describe("expertiseMaxForTxp — H6", () => {
  test("BELOW the table's first row returns the creation cap, not 0", () => {
    // The bug this guards: the table starts at txp 100, so a TXP-0 crow matches
    // no row. Returning 0 would make a background's "Benefaction (2 uses)"
    // grant (C:103) illegal on a character that has not yet played.
    assert.equal(expertiseMaxForTxp(0), 2);
    assert.equal(expertiseMaxForTxp(99), 2);
    assert.equal(expertiseMaxForTxp(), 2, "no argument must not return undefined");
  });

  test("steps 2 -> 3 -> 4 exactly on the table's TXP boundaries (C:621)", () => {
    assert.equal(expertiseMaxForTxp(4999), 2);
    assert.equal(expertiseMaxForTxp(5000), 3);
    assert.equal(expertiseMaxForTxp(19999), 3);
    assert.equal(expertiseMaxForTxp(20000), 4);
  });

  test("never exceeds 4, however much TXP", () => {
    assert.equal(expertiseMaxForTxp(30000), 4);
    assert.equal(expertiseMaxForTxp(1_000_000), 4);
  });
});

describe("bonusesEarnedAtTxp — the H5 budget input", () => {
  test("none before the first row", () => {
    assert.equal(bonusesEarnedAtTxp(0), 0);
    assert.equal(bonusesEarnedAtTxp(99), 0);
  });

  test("one per table row", () => {
    assert.equal(bonusesEarnedAtTxp(100), 1);
    assert.equal(bonusesEarnedAtTxp(500), 2);
    assert.equal(bonusesEarnedAtTxp(3500), 5);
    assert.equal(bonusesEarnedAtTxp(30000), 9);
  });

  test("then one per 30,000 after the last row (C:621 'every 30,000 after')", () => {
    assert.equal(bonusesEarnedAtTxp(60000), 10);
    assert.equal(bonusesEarnedAtTxp(90000), 11);
  });

  test("the pathological migration fixture is genuinely over budget", () => {
    // test/fixtures/actors/pt1-crow.json: 12 skills at bonus 2 = 24 uses,
    // at 3,500 TXP. This is the case H5 exists for — if this ever stops being
    // over budget the fixture has lost its teeth.
    const bonuses = bonusesEarnedAtTxp(3500);
    const backgroundUses = 7;                       // a typical background grant
    const budget = backgroundUses + CROWS.expertiseUsesPerBonus * bonuses;
    assert.equal(bonuses, 5);
    assert.equal(budget, 22);
    assert.ok(24 > budget, "24 converted uses must exceed the budget");
  });
});

describe("inventory config", () => {
  test("belt widened 2 -> 4 (R:428)", () => {
    assert.equal(CROWS.carryContainers.belt, 4);
    assert.equal(CROWS.carryContainers.hand, 2);
    assert.equal(CROWS.carryContainers.backpack, 10);
  });

  test("carry containers and magic slots are separate axes (R:426 vs R:438)", () => {
    assert.equal(CROWS.magicSlots.length, 6);
    for (const m of CROWS.magicSlots) {
      assert.ok(!(m in CROWS.carryContainers), `${m} must not be a carry container`);
    }
  });

  test("containerKeys is the union, and is what schemas should use", () => {
    assert.deepEqual(CROWS.containerKeys,
      ["hand", "belt", "backpack", "head", "neck", "waist", "arms", "finger", "feet"]);
  });

  test("backpackSize is gone — capacity is derived, not a frozen constant (M12)", () => {
    assert.equal(CROWS.backpackSize, undefined);
  });

  test("money models loose coin AND the purse (C:1917)", () => {
    assert.equal(CROWS.coinPerSlot, 250);
    assert.equal(CROWS.purseBaseCapacity, 500);
  });
});

describe("conditions", () => {
  test("boned, hidden and invisible are gone; vulnerable and weakened are in", () => {
    for (const dead of ["boned", "hidden", "invisible"]) {
      assert.ok(!CROWS.conditions.includes(dead), `${dead} should not survive`);
    }
    assert.ok(CROWS.conditions.includes("vulnerable"));
    assert.ok(CROWS.conditions.includes("weakened"));
    assert.equal(CROWS.conditions.length, 6);
  });
});

describe("expertise pool state transitions — review finding 1", () => {
  // The data model needs a Foundry runtime, so these exercise the SEMANTICS the
  // schema encodes: {value, max} where max is owned and value is remaining.
  // A single count cannot survive this sequence, which is the whole point.
  const rest = (e) => ({ ...e, value: e.max });
  const spend = (e) => ({ ...e, value: Math.max(0, e.value - 1) });

  test("spend then rest restores the OWNED amount, not the cap", () => {
    const granted2 = { value: 2, max: 2 };          // background gave 2 (C:103)
    const afterSpend = spend(spend(granted2));
    assert.deepEqual(afterSpend, { value: 0, max: 2 });
    assert.deepEqual(rest(afterSpend), { value: 2, max: 2 }, "rest restores to 2");
  });

  test("an expertise granted at 1 and one granted at 2 stay distinguishable at 0", () => {
    // This is exactly what a single mutable count destroys.
    const a = spend({ value: 1, max: 1 });
    const b = spend(spend({ value: 2, max: 2 }));
    assert.equal(a.value, 0);
    assert.equal(b.value, 0);
    assert.notEqual(a.max, b.max, "the owned amounts must still differ");
    assert.equal(rest(a).value, 1);
    assert.equal(rest(b).value, 2);
  });

  test("rest never mints uses up to the advancement cap", () => {
    // At 20,000 TXP the cap is 4, but a crow owning 1 must rest back to 1.
    const cap = expertiseMaxForTxp(20000);
    assert.equal(cap, 4);
    const owned1 = spend({ value: 1, max: 1 });
    assert.equal(rest(owned1).value, 1, "must not restore to the cap");
  });

  test("resting in the Miasma leaves spent uses spent (R:1375)", () => {
    const afterSpend = spend({ value: 2, max: 2 });
    const miasmaRest = (e) => e;                    // refresh suppressed
    assert.deepEqual(miasmaRest(afterSpend), { value: 1, max: 2 });
    // Inexpressible with one conflated count — there would be nothing to hold.
  });

  test("the H5 budget must read OWNED, which spending does not change", () => {
    const before = [{ value: 2, max: 2 }, { value: 3, max: 3 }];
    const after = before.map(spend);
    const owned = (es) => es.reduce((n, e) => n + e.max, 0);
    const remaining = (es) => es.reduce((n, e) => n + e.value, 0);
    assert.equal(owned(before), owned(after), "owned is stable across play");
    assert.notEqual(remaining(before), remaining(after));
  });
});

describe("tie-break ordering — review finding 9", () => {
  test("category order is NOT alphabetical, so they cannot be the same list", () => {
    assert.notDeepEqual(ALL_EXPERTISES, EXPERTISES_ALPHABETICAL);
  });

  test("the documented cross-category collision resolves alphabetically", () => {
    // `blacksmithing` precedes `bashing` in category order but follows it
    // alphabetically — the two orders trim different expertises.
    assert.ok(ALL_EXPERTISES.indexOf("blacksmithing") < ALL_EXPERTISES.indexOf("bashing"));
    assert.ok(EXPERTISES_ALPHABETICAL.indexOf("bashing")
            < EXPERTISES_ALPHABETICAL.indexOf("blacksmithing"));
  });

  test("alphabetical order holds all 30 keys and is locale-independent", () => {
    assert.equal(EXPERTISES_ALPHABETICAL.length, 30);
    assert.equal(EXPERTISES_ALPHABETICAL[0], "alchemy");
    assert.deepEqual([...EXPERTISES_ALPHABETICAL].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
                     EXPERTISES_ALPHABETICAL);
  });
});

describe("effectiveCapacities — review finding 5", () => {
  test("no grants returns the config base, plus 1 per magic slot", () => {
    const c = effectiveCapacities([]);
    assert.equal(c.backpack, 10);
    assert.equal(c.belt, 4);
    for (const m of CROWS.magicSlots) assert.equal(c[m], 1);
  });

  test("a belt grant raises belt only (C:737)", () => {
    const c = effectiveCapacities([{ container: "belt", count: 1 }]);
    assert.equal(c.belt, 5);
    assert.equal(c.backpack, 10, "unrelated containers untouched");
  });

  test("grants stack and the base is never mutated", () => {
    effectiveCapacities([{ container: "backpack", count: 3 }]);
    assert.equal(CROWS.carryContainers.backpack, 10, "config must not be mutated");
    assert.equal(effectiveCapacities([
      { container: "backpack", count: 1 }, { container: "backpack", count: 2 }
    ]).backpack, 13);
  });

  test("junk grants are ignored, never subtracted", () => {
    // A negative grant could shrink capacity into a character's wounds and kill
    // them, so these are dropped rather than applied.
    for (const bad of [{ container: "backpack", count: -5 },
                       { container: "backpack", count: 0 },
                       { container: "nonsense", count: 2 },
                       { container: "backpack", count: 1.5 }, null]) {
      assert.equal(effectiveCapacities([bad]).backpack, 10, JSON.stringify(bad));
    }
  });
});

describe("purse money — review finding 2", () => {
  test("the constants describe one slot's two alternatives (C:1917)", () => {
    assert.equal(CROWS.coinPerSlot, 250);
    assert.equal(CROWS.purseBaseCapacity, 500);
    assert.equal(CROWS.pursePerSlot, 1);
  });

  test("the starting kit is representable: empty purse + 3d6 gc loose (C:36)", () => {
    const purse = { isPurse: true, held: 0, baseCapacity: CROWS.purseBaseCapacity };
    const loose = 11;                                  // a 3d6 roll
    assert.equal(purse.held, 0);
    assert.ok(loose <= CROWS.coinPerSlot, "fits in one slot as loose coin");
    // and coins round-trip into it
    const moved = Math.min(loose, purse.baseCapacity - purse.held);
    assert.deepEqual({ held: purse.held + moved, loose: loose - moved },
                     { held: 11, loose: 0 });
  });

  test("Bursting Purse is the only published capacity increase (C:1737)", () => {
    assert.equal(CROWS.purseTraitBonus, 500);
    assert.equal(CROWS.purseBaseCapacity + CROWS.purseTraitBonus, 1000);
  });
});

describe("tier + characteristic bounds", () => {
  test("characteristic range is -5..5, with the PC cap held separately", () => {
    // Both PT1 bounds were wrong (min:-1 max:3). The cap of 4 is an advancement
    // rule (C:640), not a schema bound — magic may exceed it.
    assert.deepEqual(CROWS.charRange, { min: -5, max: 5 });
    assert.equal(CROWS.charPcCap, 4);
  });

  test("doom and crit are 2d10 SUMS", () => {
    assert.deepEqual(CROWS.doomFaces, [2, 3]);
    assert.deepEqual(CROWS.critFaces, [19, 20]);
    assert.ok(!CROWS.doomFaces.includes(1), "1 is unreachable on 2d10");
  });
});
