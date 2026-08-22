import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  CROWS, ALL_EXPERTISES, expertiseCategory,
  expertiseMaxForTxp, bonusesEarnedAtTxp
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
