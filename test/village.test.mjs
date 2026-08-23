import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  INSTITUTIONS, INSTITUTION_KEYS, INSTITUTION_TYPES, STARTING_INSTITUTIONS,
  ARTISANS, MERCHANTS, AVAILABILITY_IS_A_ROLL,
  institutionMaxLevel, institutionPurchasableMaxLevel, upgradePrice, foundingPrice,
  advancementRow, effectiveInstitutionLevel, capstoneActive,
  itemAvailability, innMaxBet, beaconRadius, beaconTransportCost,
  sellPercentage, auctionSalePercentage, auctionPriceMultiplier, auctionBuybackPrice,
  clampProsperity, recordMerchantSpend, prosperityAtCycleEnd, SPEND_FOR_PROSPERITY,
  VILLAGE_EVENTS, VILLAGE_EVENT_MIN, VILLAGE_EVENT_MAX, villageEventFor,
  CONNECTION_BENEFITS, monsterPartTrade, retirementBenefitCount,
  makeForeignVillage, foundVillageQuote, villageCraftingQuote, workshopRental,
  PROSPERITY_MIN, PROSPERITY_MAX
} from "../module/helpers/village.mjs";

import {
  TOOL_FOR_EXPERTISE, CRAFTING_EXPERTISE_BONUS, CRAFTING_DOUBLE_BANE_PENALTY,
  MAX_EXPERTISES_PER_CRAFTING_ROLL,
  meetsCraftingPrerequisites, craftingRollBonus, craftingPointsFrom,
  accrueCraftingPoints, canAssistCrafting, identifyTier, IDENTIFY_OUTCOMES
} from "../module/helpers/crafting.mjs";

import {
  dailyWage, dailyUpkeep, deathPayment, settleHirelingDeath,
  applyMissedPayment, canHireWhileInDebt, payDebt,
  hireableMaxPower, canHireFromBarracks, hirelingStartingRations, daysBeforeFeeding,
  onEmployerDeath, newEmployment, HIRELING_CONTROL, PROVISIONS_RATIONS
} from "../module/helpers/hirelings.mjs";

/* ========================================================================== */
/*  Institutions                                                              */
/* ========================================================================== */

/**
 * THE acceptance table: every institution's level count, re-derived from the
 * Playtest 2 Characters book rather than carried over from Playtest 1. The
 * changelog says outright that "the number of levels of some institutions has
 * changed", so a count that merely looks plausible is not evidence of anything
 * — each row cites the advancement table it was read off.
 */
const LEVEL_COUNTS = [
  // key             levels  founding  source of the advancement table
  ["alchemist",        4,      3000,   "C:2734-2739"],
  ["auctionHouse",     5,      2000,   "C:2794-2800"],
  ["barracks",         5,      3000,   "C:2777-2783"],  // NEW in Playtest 2 (C:2759)
  ["beacon",           5,      4000,   "C:2830-2836"],  // NEW in Playtest 2 (C:2806)
  ["blacksmith",       4,      3000,   "C:2869-2877"],
  ["bookseller",       6,      3000,   "C:2903-2910"],
  ["crypt",            5,      2000,   "C:2955-2961"],
  ["enchanter",        4,      3000,   "C:2984-2989"],
  ["generalStore",     3,      1000,   "C:3010-3014"],
  ["inn",              5,      1000,   "C:3086-3092"],
  ["stables",          5,      2000,   "C:3071-3077"],
  ["temple",           6,      2000,   "C:3128-3135"]   // 6th row is unpriced — see below
];

describe("institutions — the advancement tables", () => {
  test("there are exactly twelve, and no PT1 phantoms survive", () => {
    assert.equal(INSTITUTION_KEYS.length, 12);
    // PT1 shipped four institutions that do not exist in the Playtest 2 text,
    // and omitted three that do. If either half of that regresses, this fails.
    for (const gone of ["herbalist", "market", "mageGuild", "scriptorium", "smithy"]) {
      assert.equal(INSTITUTIONS[gone], undefined, `${gone} is not a Playtest 2 institution`);
    }
    for (const added of ["alchemist", "auctionHouse", "stables", "barracks", "beacon"]) {
      assert.ok(INSTITUTIONS[added], `${added} must exist`);
    }
  });

  for (const [key, levels, founding, source] of LEVEL_COUNTS) {
    test(`${key}: ${levels} levels, ${founding} gc to found (${source})`, () => {
      assert.equal(institutionMaxLevel(key), levels);
      assert.equal(foundingPrice(key), founding);
      const rows = INSTITUTIONS[key].advancement;
      // Rows are in level order, 1..n, and 1st level is never purchasable.
      assert.deepEqual(rows.map(r => r.level), Array.from({ length: levels }, (_, i) => i + 1));
      assert.equal(rows[0].price, null, "you reach 1st level by founding, not upgrading");
    });
  }

  test("upgrade prices match the tables", () => {
    // Two spot checks per shape, so a transposed column cannot pass.
    assert.equal(upgradePrice("bookseller", 6), 12000);   // C:2910
    assert.equal(upgradePrice("bookseller", 2), 750);     // C:2906
    assert.equal(upgradePrice("beacon", 5), 12000);       // C:2836
    assert.equal(upgradePrice("generalStore", 3), 3000);  // C:3014
    assert.equal(upgradePrice("crypt", 5), 4000);         // C:2961
    assert.equal(upgradePrice("inn", 5), 2000);           // C:3092
  });

  test("the temple's 6th level exists but cannot be bought (C:3135)", () => {
    // The table has six rows; the sixth has no price because you only reach it
    // through Higher Authority (C:3120), never by paying. A `maxLevel` that
    // ignored this would let a party buy a level for `null` gc.
    assert.equal(institutionMaxLevel("temple"), 6);
    assert.equal(institutionPurchasableMaxLevel("temple"), 5);
    assert.equal(upgradePrice("temple", 6), null);
    // Everyone else's table max IS purchasable.
    for (const [key] of LEVEL_COUNTS.filter(([k]) => k !== "temple")) {
      assert.equal(institutionPurchasableMaxLevel(key), institutionMaxLevel(key), key);
    }
  });

  test("starting village: five seeded institutions plus one chosen (C:2549)", () => {
    assert.deepEqual([...STARTING_INSTITUTIONS], ["blacksmith", "crypt", "generalStore", "inn", "temple"]);
    for (const k of STARTING_INSTITUTIONS) assert.ok(INSTITUTIONS[k], k);
  });

  test("the temple is an artisan now and sells no crafting materials (C:3104)", () => {
    assert.ok(ARTISANS.includes("temple"));
    assert.deepEqual([...INSTITUTIONS.temple.craftsExpertises], ["alchemy", "blacksmithing", "enchanting"]);
    assert.equal(INSTITUTIONS.temple.sellsCraftingMaterials, false);
    // The blacksmith still does (C:2853) — the change is the temple's alone.
    assert.equal(INSTITUTIONS.blacksmith.sellsCraftingMaterials, true);
  });

  test("the auction house no longer sells monster parts", () => {
    assert.equal(INSTITUTIONS.auctionHouse.sellsMonsterParts, false);
  });

  test("every artisan crafts with a bonus equal to its level, and only three rent workshops", () => {
    assert.deepEqual([...ARTISANS].sort(), ["alchemist", "blacksmith", "enchanter", "temple"]);
    const withWorkshops = ARTISANS.filter(k => INSTITUTIONS[k].workshop);
    assert.deepEqual(withWorkshops.sort(), ["alchemist", "blacksmith", "enchanter"]);
    assert.equal(INSTITUTIONS.temple.workshop, null, "the temple crafts for you but rents no bench");
  });

  test("INSTITUTION_TYPES is a label map over exactly the same keys", () => {
    assert.deepEqual(Object.keys(INSTITUTION_TYPES).sort(), [...INSTITUTION_KEYS].sort());
    assert.equal(INSTITUTION_TYPES.generalStore, "General Store");
  });
});

/* ========================================================================== */
/*  Availability is a level lookup, not a roll                                */
/* ========================================================================== */

describe("availability (changelog: no longer a roll, save at the auction house)", () => {
  test("the PT1 availability roll is gone from the source", () => {
    // The acceptance criterion is about the CODE, so read the code. A missing
    // export is invisible to `node --check` and to every other test here.
    const src = readFileSync(new URL("../module/helpers/village.mjs", import.meta.url), "utf8");
    // Strip the header comment block, which documents the deletion by name.
    const body = src.slice(src.indexOf("const NS ="));
    assert.ok(!/export\s+(async\s+)?function\s+rollAvailability/.test(body),
      "rollAvailability must be deleted, not adapted");
    assert.ok(!/baseAvailability/.test(body),
      "base availability + prosperity is a Playtest 1 concept");
    assert.ok(!/1d100/.test(body), "nothing rolls d100 for stock any more");
  });

  test("exactly one institution still resolves availability by chance", () => {
    assert.deepEqual([...AVAILABILITY_IS_A_ROLL], ["auctionHouse"]);
    for (const key of MERCHANTS.filter(k => INSTITUTIONS[k].availability)) {
      const axis = INSTITUTIONS[key].availability.axis;
      const isChance = axis === "percentChance";
      assert.equal(isChance, key === "auctionHouse", `${key} availability axis: ${axis}`);
    }
  });

  test("the temple is the one merchant with no catalogue to gate", () => {
    // Its services scale off the level directly (wounds healed C:3114, blessing
    // days C:3116, Prayer of Returning's reach C:3118), so there is no item
    // list an availability lookup could apply to. Asserted rather than left
    // implicit, because a null availability otherwise reads as an omission.
    const catalogueless = MERCHANTS.filter(k => !INSTITUTIONS[k].availability);
    assert.deepEqual(catalogueless, ["temple"]);
    assert.equal(itemAvailability("temple", 5, {}).ok, false);
  });

  test("the two shapes are discriminated, never collapsed to a boolean", () => {
    const deterministic = itemAvailability("generalStore", 1, { quality: "standard" });
    assert.equal(deterministic.deterministic, true);
    assert.equal(deterministic.available, true);
    assert.equal(deterministic.chancePercent, undefined);

    const chance = itemAvailability("auctionHouse", 1, { kind: "valued" });
    assert.equal(chance.deterministic, false);
    assert.equal(chance.available, undefined, "an auction result must not read as a verdict");
    assert.equal(chance.chancePercent, 15);   // C:2796
  });

  test("auction house percentages by level (C:2794-2800)", () => {
    const valued = [15, 20, 25, 30, 35];
    const unique = [5, 10, 15, 20, 25];
    for (let lvl = 1; lvl <= 5; lvl++) {
      assert.equal(itemAvailability("auctionHouse", lvl, { kind: "valued" }).chancePercent, valued[lvl - 1]);
      assert.equal(itemAvailability("auctionHouse", lvl, { kind: "unique" }).chancePercent, unique[lvl - 1]);
    }
  });

  test("alchemist stocks by expertise uses required (C:2718)", () => {
    for (let lvl = 1; lvl <= 4; lvl++) {
      assert.equal(itemAvailability("alchemist", lvl, { uses: lvl }).available, true);
      assert.equal(itemAvailability("alchemist", lvl, { uses: lvl + 1 }).available, false);
    }
  });

  test("the blacksmith's enchanting column starts a level late (C:2851, C:2873)", () => {
    // A 1st-level blacksmith deals in blacksmithing items but NO magic arms:
    // the enchanting column is blank on row 1. Reusing `level` for both axes
    // would silently sell a magic sword out of a village forge on day one.
    assert.equal(itemAvailability("blacksmith", 1, { uses: 1 }).available, true);
    assert.equal(itemAvailability("blacksmith", 1, { expertise: "enchanting", uses: 1 }).available, false);
    assert.equal(itemAvailability("blacksmith", 2, { expertise: "enchanting", uses: 1 }).available, true);
    assert.equal(itemAvailability("blacksmith", 4, { expertise: "enchanting", uses: 3 }).available, true);
    assert.equal(itemAvailability("blacksmith", 4, { expertise: "enchanting", uses: 4 }).available, false);
    // The alchemist does not stock enchanting at all.
    assert.equal(itemAvailability("alchemist", 4, { expertise: "enchanting", uses: 1 }).available, false);
  });

  test("bookseller ranks, general store quality, pet and hireling power", () => {
    assert.equal(itemAvailability("bookseller", 1, { rank: 0 }).available, true);   // C:2905
    assert.equal(itemAvailability("bookseller", 1, { rank: 1 }).available, false);
    assert.equal(itemAvailability("bookseller", 6, { rank: 5 }).available, true);   // C:2910

    assert.equal(itemAvailability("generalStore", 1, { quality: "fine" }).available, false);
    assert.equal(itemAvailability("generalStore", 2, { quality: "fine" }).available, true);
    assert.equal(itemAvailability("generalStore", 3, { quality: "masterwork" }).available, true);

    assert.equal(itemAvailability("stables", 3, { power: 6 }).available, true);     // C:3075
    assert.equal(itemAvailability("stables", 3, { power: 7 }).available, false);
    assert.equal(itemAvailability("barracks", 5, { power: 10 }).available, true);   // C:2783
  });

  test("a closed institution stocks nothing", () => {
    const r = itemAvailability("generalStore", 0, { quality: "standard" });
    assert.equal(r.available, false);
    assert.equal(r.closed, true);
  });

  test("inn max bet is level base plus Prosperity (C:3086)", () => {
    assert.equal(innMaxBet(1, 0), 15);
    assert.equal(innMaxBet(1, 10), 25);
    assert.equal(innMaxBet(5, 10), 70);
    assert.equal(innMaxBet(3, -10), 25);
    // Minimum bet is 1 gc (C:3037), so 0 is not a legal bet at any level.
    assert.equal(itemAvailability("inn", 5, { bet: 0, prosperity: 10 }).available, false);
    assert.equal(itemAvailability("inn", 5, { bet: 70, prosperity: 10 }).available, true);
    assert.equal(itemAvailability("inn", 5, { bet: 71, prosperity: 10 }).available, false);
  });

  test("beacon radius tracks level, and Burn Bright needs BOTH level 5 and Prosperity 10", () => {
    for (let lvl = 1; lvl <= 5; lvl++) assert.equal(beaconRadius(lvl, 0), lvl);   // C:2832-2836
    assert.equal(beaconRadius(5, 9), 5, "Prosperity 9 is not 10");
    assert.equal(beaconRadius(4, 10), 4, "level 4 is not level 5");
    assert.equal(beaconRadius(5, 10), 6);                                          // C:2822
    assert.equal(beaconTransportCost(3), 300);                                     // C:2818
    assert.equal(beaconTransportCost(0), 0);
  });
});

/* ========================================================================== */
/*  Effective level                                                           */
/* ========================================================================== */

describe("effective institution level", () => {
  const inst = (over = {}) => ({ type: "generalStore", level: 2, operatingFromCycle: 0, pendingLevel: null, pendingFromCycle: null, ...over });

  test("a paid-for upgrade does not operate until its cycle arrives (C:2704)", () => {
    const i = inst({ level: 2, pendingLevel: 3, pendingFromCycle: 5 });
    assert.equal(effectiveInstitutionLevel(i, { cycle: 4 }).level, 2);
    assert.equal(effectiveInstitutionLevel(i, { cycle: 5 }).level, 3);
  });

  test("a newly founded institution is closed until it opens (C:2698)", () => {
    const i = inst({ level: 1, operatingFromCycle: 7 });
    const before = effectiveInstitutionLevel(i, { cycle: 6 });
    assert.equal(before.closed, true);
    assert.equal(before.notYetOpen, true);
    assert.equal(before.level, 0);
    assert.equal(effectiveInstitutionLevel(i, { cycle: 7 }).level, 1);
  });

  test("event modifiers move level, and 0 is closed rather than level 1 (C:2673)", () => {
    const i = inst({ level: 3 });
    assert.equal(effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: -3 }] }).closed, true);
    assert.equal(effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: -3 }] }).level, 0);
    assert.equal(effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: -1 }] }).level, 2);
    assert.equal(effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: 2 }] }).level, 5);
    // A festival stacked on a surplus is two separate modifiers.
    assert.equal(effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: 1 }, { delta: 1 }] }).level, 5);
  });

  test("rising past the last table row is legal but flagged", () => {
    const i = inst({ type: "generalStore", level: 3 });   // 3 is its maximum
    const r = effectiveInstitutionLevel(i, { cycle: 1, modifiers: [{ delta: 1 }] });
    assert.equal(r.level, 4);
    assert.equal(r.aboveTableMax, true);
    // And the availability lookup clamps to the best row rather than throwing.
    assert.equal(itemAvailability("generalStore", 4, { quality: "masterwork" }).available, true);
  });

  test("only the crypt and the temple get a Prosperity-10 LEVEL bump (C:2943, C:3120)", () => {
    const crypt = { type: "crypt", level: 5, operatingFromCycle: 0 };
    assert.equal(effectiveInstitutionLevel(crypt, { cycle: 1, prosperity: 10 }).level, 6);
    assert.equal(effectiveInstitutionLevel(crypt, { cycle: 1, prosperity: 9 }).level, 5);
    const temple = { type: "temple", level: 5, operatingFromCycle: 0 };
    assert.equal(effectiveInstitutionLevel(temple, { cycle: 1, prosperity: 10 }).level, 6);

    // Everyone else's capstone is a named service, not a level. The alchemist
    // at 4 with Prosperity 10 gets free potions, but is still 4th level.
    const alch = { type: "alchemist", level: 4, operatingFromCycle: 0 };
    assert.equal(effectiveInstitutionLevel(alch, { cycle: 1, prosperity: 10 }).level, 4);
    assert.equal(capstoneActive("alchemist", 4, 10), true);
    assert.equal(capstoneActive("alchemist", 3, 10), false);
    assert.equal(capstoneActive("alchemist", 4, 9), false);
  });

  test("the capstone is a floor, not a delta — a boosted temple does not reach 7", () => {
    const temple = { type: "temple", level: 5, operatingFromCycle: 0 };
    const r = effectiveInstitutionLevel(temple, { cycle: 1, prosperity: 10, modifiers: [{ delta: 1 }] });
    assert.equal(r.level, 6);
  });

  test("exactly two institutions declare a level-bumping capstone", () => {
    const bumpers = INSTITUTION_KEYS.filter(k => INSTITUTIONS[k].prosperity10?.effectiveLevel);
    assert.deepEqual(bumpers.sort(), ["crypt", "temple"]);
    // ...but every institution has SOME Prosperity-10 capstone.
    for (const k of INSTITUTION_KEYS) assert.ok(INSTITUTIONS[k].prosperity10, k);
  });
});

/* ========================================================================== */
/*  Prosperity and trade                                                      */
/* ========================================================================== */

describe("prosperity", () => {
  test("bounds are -10..10 (C:2595, C:2599)", () => {
    assert.equal(PROSPERITY_MIN, -10);
    assert.equal(PROSPERITY_MAX, 10);
    assert.equal(clampProsperity(50), 10);
    assert.equal(clampProsperity(-50), -10);
  });

  test("10,000 gc of merchant spending in a cycle raises it by 1 (C:2593)", () => {
    assert.equal(SPEND_FOR_PROSPERITY, 10000);
    let v = { spentThisCycle: 0, spendBonusAwarded: false };
    v = { ...v, ...pick(recordMerchantSpend(v, 4000)) };
    assert.equal(v.spentThisCycle, 4000);
    assert.equal(v.spendBonusAwarded, false);

    const crossing = recordMerchantSpend(v, 6000);
    assert.equal(crossing.prosperityDelta, 1, "crossing the threshold pays once");
    v = { ...v, ...pick(crossing) };
    assert.equal(v.spendBonusAwarded, true);
  });

  test("it pays ONCE per cycle, not per further 10,000", () => {
    let v = { spentThisCycle: 0, spendBonusAwarded: false };
    const first = recordMerchantSpend(v, 25000);
    assert.equal(first.prosperityDelta, 1);
    v = { ...v, ...pick(first) };
    // 25,000 in one go is +1, and the next 10,000 in the same cycle adds nothing.
    assert.equal(recordMerchantSpend(v, 10000).prosperityDelta, 0);
  });

  test("a cycle with nothing to raise it costs 1 (C:2599)", () => {
    assert.equal(prosperityAtCycleEnd(4, { raisingEventOccurred: false }), 3);
    assert.equal(prosperityAtCycleEnd(4, { raisingEventOccurred: true }), 4);
    assert.equal(prosperityAtCycleEnd(-10, { raisingEventOccurred: false }), -10, "floors, never wraps");
    // At the cap, an upgrade still counts as "something that COULD raise it",
    // so the clamp does not turn a good cycle into a penalty.
    assert.equal(prosperityAtCycleEnd(10, { raisingEventOccurred: true }), 10);
  });

  test("sale percentages (C:2627-2636), including every band boundary", () => {
    const expected = new Map([
      [-10, 30], [-9, 40], [-6, 40], [-5, 45], [-2, 45],
      [-1, 50], [1, 50], [2, 55], [5, 55], [6, 60], [9, 60], [10, 70]
    ]);
    for (const [p, pct] of expected) assert.equal(sellPercentage(p), pct, `prosperity ${p}`);
  });

  test("auction sale, price swing and buy-back (C:2753, C:2757)", () => {
    assert.equal(auctionSalePercentage(7, 3), 91);        // 7 x (10 + 3)
    assert.equal(auctionSalePercentage(1, -10), 0);       // 1 x (10 - 10)
    assert.equal(auctionPriceMultiplier(2, 3), 0.7);      // even -> -30%
    assert.equal(auctionPriceMultiplier(3, 3), 1.3);      // odd  -> +30%
    assert.equal(auctionBuybackPrice(500, 1000), 600);
  });

  test("monster parts trade generically, five for one (C:2575)", () => {
    assert.deepEqual(monsterPartTrade(5), { spent: 5, received: 1 });
    assert.deepEqual(monsterPartTrade(12), { spent: 10, received: 2 });
    assert.deepEqual(monsterPartTrade(4), { spent: 0, received: 0 });
  });
});

/* ========================================================================== */
/*  Village events                                                            */
/* ========================================================================== */

describe("village event table (C:2653-2684)", () => {
  test("covers -9..20 with no gap and no overlap", () => {
    // d10 (1..10) + Prosperity (-10..10) spans exactly this range, so a gap is
    // a table that returns undefined at a total the dice can actually produce.
    assert.equal(VILLAGE_EVENT_MIN, -9);
    assert.equal(VILLAGE_EVENT_MAX, 20);
    let cursor = VILLAGE_EVENT_MIN;
    for (const e of VILLAGE_EVENTS) {
      assert.equal(e.min, cursor, `gap or overlap before ${e.id}`);
      assert.ok(e.max >= e.min, e.id);
      cursor = e.max + 1;
    }
    assert.equal(cursor, VILLAGE_EVENT_MAX + 1);
    for (let t = VILLAGE_EVENT_MIN; t <= VILLAGE_EVENT_MAX; t++) {
      assert.ok(villageEventFor(t), `no event at ${t}`);
    }
  });

  test("every reachable d10 + Prosperity total lands on an event", () => {
    for (let p = PROSPERITY_MIN; p <= PROSPERITY_MAX; p++) {
      for (let d = 1; d <= 10; d++) {
        const e = villageEventFor(d + p);
        assert.ok(e, `d10 ${d} + prosperity ${p}`);
        assert.ok(d + p >= e.min && d + p <= e.max);
      }
    }
  });

  test("merchant misfortune moves LEVEL now, not availability percentages", () => {
    // This is the shape change. In PT1 these entries moved a stock percentage;
    // in PT2 they move effective level and can close a shop outright.
    const robbery = villageEventFor(0);
    assert.equal(robbery.id, "devastatingRobbery");
    assert.equal(robbery.effect.kind, "merchantLevel");
    assert.equal(robbery.effect.delta, -3);              // C:2673
    assert.equal(robbery.effect.closedAtZero, true);

    const thefts = villageEventFor(1);
    assert.equal(thefts.effect.delta, -1);               // C:2674
    assert.equal(villageEventFor(2).id, thefts.id, "1-2 is one bucket");

    assert.equal(villageEventFor(7).effect.delta, 1);    // C:2680
    assert.equal(villageEventFor(8).id, villageEventFor(7).id);
    assert.equal(villageEventFor(11).effect.delta, 2);   // C:2683
  });

  test("the festival hits every merchant, not one (C:2676)", () => {
    const festival = villageEventFor(16);
    assert.equal(festival.id, "merchantFestival");
    assert.equal(festival.effect.scope, "all");
    assert.equal(festival.effect.delta, 1);
  });

  test("a prosperous cycle at the cap converts to a sale bonus (C:2677)", () => {
    const e = villageEventFor(17);
    assert.equal(e.effect.kind, "prosperity");
    assert.equal(e.effect.delta, 1);
    assert.equal(e.effect.atCapInstead.kind, "sellPercentage");
    assert.equal(e.effect.atCapInstead.delta, 10);
  });

  test("no entry mentions an availability percentage any more", () => {
    for (const e of VILLAGE_EVENTS) {
      assert.notEqual(e.effect.kind, "availability", e.id);
      assert.ok(!/item availability/i.test(e.text), `${e.id}: ${e.text}`);
    }
  });

  test("every entry carries a citation and a structured effect", () => {
    for (const e of VILLAGE_EVENTS) {
      assert.match(e.source, /^C:\d+$/, e.id);
      assert.ok(e.effect?.kind, e.id);
      assert.ok(e.text.length > 10, e.id);
    }
  });
});

/* ========================================================================== */
/*  Other villages, retirement, village crafting                              */
/* ========================================================================== */

describe("other villages and retirement", () => {
  test("a foreign village can't be invested in and isn't tracked (C:2543)", () => {
    const v = makeForeignVillage({ name: "Ashfall", prosperity: 3 });
    assert.equal(v.canInvest, false);
    assert.equal(v.tracksCycles, false);
    assert.equal(v.isHome, false);
    assert.equal(v.prosperity, 3);
    assert.equal(makeForeignVillage({ prosperity: 99 }).prosperity, 10, "still clamped");
  });

  test("founding another village costs 15,000 gc and ten days (C:3168)", () => {
    const q = foundVillageQuote();
    assert.equal(q.price, 15000);
    assert.equal(q.days, 10);
    assert.deepEqual(q.startingInstitutions, [...STARTING_INSTITUTIONS]);
  });

  test("retirement benefits scale at 60,000 and 100,000 TXP (C:3148, C:3150)", () => {
    assert.equal(retirementBenefitCount(59999), 0);
    assert.equal(retirementBenefitCount(60000), 1);
    assert.equal(retirementBenefitCount(99999), 1);
    assert.equal(retirementBenefitCount(100000), 2);
  });

  test("NPC connection benefits are all cited (C:2551)", () => {
    assert.ok(CONNECTION_BENEFITS.length >= 10);
    for (const b of CONNECTION_BENEFITS) assert.match(b.source, /^C:\d+$/, b.id);
  });
});

describe("village crafting (C:2639-2649)", () => {
  test("full price, one roll a day, at a bonus equal to the institution's level", () => {
    const q = villageCraftingQuote("blacksmith", 3, 500);
    assert.equal(q.cost, 500);
    assert.equal(q.rollsPerDay, 1);
    assert.equal(q.craftingBonus, 3);
    assert.equal(q.materialsRequired, true);
  });

  test("a rush job is double the money and double the rolls (C:2647)", () => {
    const q = villageCraftingQuote("blacksmith", 3, 500, { rush: true });
    assert.equal(q.cost, 1000);
    assert.equal(q.rollsPerDay, 2);
  });

  test("only artisans take commissions — and the temple now does (C:3104)", () => {
    assert.equal(villageCraftingQuote("temple", 2, 100).ok, true);
    assert.equal(villageCraftingQuote("generalStore", 2, 100).ok, false);
    assert.equal(villageCraftingQuote("auctionHouse", 2, 100).ok, false);
  });

  test("workshops rent for 5 gc a day at a bonus equal to level; the temple has none", () => {
    const w = workshopRental("blacksmith", 4);
    assert.equal(w.pricePerDay, 5);       // C:2859
    assert.equal(w.craftingBonus, 4);
    assert.equal(workshopRental("temple", 5).ok, false);
  });
});

/* ========================================================================== */
/*  Crafting                                                                  */
/* ========================================================================== */

/** A crow-shaped stub: expertises are `{value, max}` per contract §2. */
const crow = (expertises = {}, items = []) => ({
  type: "crow",
  name: "Test Crow",
  items,
  system: { characteristics: { mind: { value: 2 } }, expertises }
});

describe("crafting prerequisites (R:1669-1687)", () => {
  test("the gate reads uses OWNED (`max`), never uses REMAINING (`value`)", () => {
    // A crow who spent both blacksmithing uses on tests this morning still owns
    // two and is still qualified to begin the project. Reading `value` would
    // make the prerequisite flicker with the day's spending.
    const spentOut = crow({ blacksmithing: { value: 0, max: 2 } }, [{ name: "Blacksmith's Tools (fine)" }]);
    const r = meetsCraftingPrerequisites(spentOut, { expertise: "blacksmithing", uses: 2 });
    assert.equal(r.ok, true, r.reasons.join("; "));
    assert.equal(r.owned, 2);

    const underqualified = crow({ blacksmithing: { value: 3, max: 1 } }, [{ name: "Blacksmith's Tools" }]);
    assert.equal(meetsCraftingPrerequisites(underqualified, { expertise: "blacksmithing", uses: 2 }).ok, false);
  });

  test("tools are required and matched by name (R:1681-1687)", () => {
    assert.deepEqual(TOOL_FOR_EXPERTISE, {
      alchemy: "alchemist's tools",
      blacksmithing: "blacksmith's tools",
      enchanting: "enchanter's tools"
    });
    const noTools = crow({ alchemy: { value: 2, max: 2 } });
    const r = noTools && meetsCraftingPrerequisites(noTools, { expertise: "alchemy", uses: 1 });
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(" "), /alchemist's tools/);

    // A curly apostrophe in the item name must not defeat the match.
    const curly = crow({ alchemy: { value: 2, max: 2 } }, [{ name: "Alchemist’s Tools (masterwork)" }]);
    assert.equal(meetsCraftingPrerequisites(curly, { expertise: "alchemy", uses: 1 }).ok, true);
  });

  test("an unknown expertise is refused rather than silently passing at 0", () => {
    const c = crow({}, []);
    // PT1 skill names must not resolve — `CROWS.skills` no longer exists.
    const r = meetsCraftingPrerequisites(c, { expertise: "smithing", uses: 1 });
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(" "), /unknown expertise/);
  });

  test("an assistant is gated on the same prerequisites (R:1713)", () => {
    const project = { expertise: "enchanting", uses: 2 };
    const helper = crow({ enchanting: { value: 0, max: 2 } }, [{ name: "Enchanter's Tools" }]);
    assert.equal(canAssistCrafting(helper, project).ok, true);
    const bystander = crow({ enchanting: { value: 2, max: 1 } }, [{ name: "Enchanter's Tools" }]);
    assert.equal(canAssistCrafting(bystander, project).ok, false);
  });
});

describe("crafting rolls (R:1697-1709)", () => {
  test("an expertise is a flat +4 and you may apply two (R:1703)", () => {
    assert.equal(CRAFTING_EXPERTISE_BONUS, 4);
    assert.equal(MAX_EXPERTISES_PER_CRAFTING_ROLL, 2);
    assert.equal(craftingRollBonus({ mind: 2, expertisesApplied: 1 }).total, 6);
    assert.equal(craftingRollBonus({ mind: 2, expertisesApplied: 2 }).total, 10);
  });

  test("a third expertise is ignored, not applied", () => {
    const b = craftingRollBonus({ mind: 0, expertisesApplied: 3 });
    assert.equal(b.total, 8);
    assert.equal(b.expertisesApplied, 2);
    assert.equal(b.expertisesIgnored, 1);
  });

  test("a double edge is +4 and a double bane -4, replacing the usual mechanics", () => {
    assert.equal(craftingRollBonus({ doubleEdge: true }).total, 4);
    assert.equal(craftingRollBonus({ doubleBane: true }).total, CRAFTING_DOUBLE_BANE_PENALTY);
    // They are separate channels from the expertise bonus and stack with it.
    assert.equal(craftingRollBonus({ mind: 1, expertisesApplied: 2, doubleEdge: true }).total, 13);
  });

  test("institution and connection bonuses are plain addends (C:2645, C:2561)", () => {
    assert.equal(craftingRollBonus({ mind: 2, institutionBonus: 3 }).total, 5);
  });

  test("the minimum is 1 point unless it's a doom (R:1701)", () => {
    assert.equal(craftingPointsFrom({ total: 14 }), 14);
    assert.equal(craftingPointsFrom({ total: 0 }), 1);
    assert.equal(craftingPointsFrom({ total: -6 }), 1, "even through a double bane");
    assert.equal(craftingPointsFrom({ total: 14, doom: true }), 0, "a doom accrues nothing");
  });

  test("surplus rolls into another copy, but only with materials for it (R:1709)", () => {
    // 250 points against a goal of 100 is two finished items and 50 banked...
    const withMaterials = accrueCraftingPoints({ points: 0, goal: 100 }, 250, { materialSets: 3 });
    assert.equal(withMaterials.completedThisRoll, 2);
    assert.equal(withMaterials.points, 50);
    assert.equal(withMaterials.blockedOnMaterials, false);

    // ...but with materials for only one, the surplus stays banked rather than
    // minting a second item out of nothing.
    const short = accrueCraftingPoints({ points: 0, goal: 100 }, 250, { materialSets: 1 });
    assert.equal(short.completedThisRoll, 1);
    assert.equal(short.points, 150);
    assert.equal(short.blockedOnMaterials, true);
  });

  test("points accumulate across rolls", () => {
    let p = { points: 0, goal: 100, completed: 0 };
    p = { ...p, ...accrueCraftingPoints(p, 40) };
    assert.equal(p.points, 40);
    assert.equal(p.completed, 0);
    p = { ...p, ...accrueCraftingPoints(p, 70) };
    assert.equal(p.completed, 1);
    assert.equal(p.points, 10);
  });

  test("no `skill` vocabulary survives in the crafting source", () => {
    const src = readFileSync(new URL("../module/helpers/crafting.mjs", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("import {"));
    assert.ok(!/system\?\.skills/.test(body), "CROWS.skills is gone");
    assert.ok(!/project\.skill\b/.test(body), "projects name an expertise now");
    // Recipes are a Playtest 1 concept. The header comment names `hasRecipe` to
    // record that it was deleted, so the assertion is on USE — a property read
    // or an object key — not on the word appearing anywhere in the file.
    assert.ok(!/\.hasRecipe\b/.test(body), "nothing reads hasRecipe");
    assert.ok(!/^\s*hasRecipe\s*:/m.test(body), "nothing writes hasRecipe");
    assert.ok(!/\.prereqBonus\b/.test(body), "nothing reads prereqBonus");
    assert.ok(!/^\s*prereqBonus\s*:/m.test(body), "nothing writes prereqBonus");
  });
});

describe("IDing magic items (R:1719-1733)", () => {
  test("tiers use the shared boundaries, not hardcoded numbers", () => {
    assert.equal(identifyTier(11), 1);
    assert.equal(identifyTier(12), 2);
    assert.equal(identifyTier(16), 2);
    assert.equal(identifyTier(17), 3);
    assert.equal(IDENTIFY_OUTCOMES[1].id, "activate");
    assert.equal(IDENTIFY_OUTCOMES[3].id, "full");
  });
});

/* ========================================================================== */
/*  Hirelings                                                                 */
/* ========================================================================== */

describe("hirelings — employment terms (C:2503-2511)", () => {
  test("daily wage is power x 10, minimum 10 (C:2507)", () => {
    assert.equal(dailyWage(0), 10, "the minimum bites below power 1");
    assert.equal(dailyWage(1), 10);
    assert.equal(dailyWage(2), 20);
    assert.equal(dailyWage(10), 100);
  });

  test("the daily obligation is coin AND food", () => {
    assert.deepEqual(dailyUpkeep(4), { gc: 40, rations: 1 });
  });

  test("death payment is power x 500 (C:2509)", () => {
    assert.equal(deathPayment(4), 2000);
    assert.equal(deathPayment(0), 0);
  });

  test("the death bill is equipment PLUS salary already paid PLUS the death payment", () => {
    // The salary already paid is owed AGAIN to the family — it is not a credit
    // against the bill. Netting it off would halve the debt on the exact roll
    // that is supposed to hurt.
    const bill = settleHirelingDeath({ power: 4, salaryPaid: 240, equipmentValue: 300, hiredInVillage: "Ashfall" });
    assert.equal(bill.deathPayment, 2000);
    assert.equal(bill.salaryOwed, 240);
    assert.equal(bill.equipmentOwed, 300);
    assert.equal(bill.total, 2540);
    assert.equal(bill.payableInVillage, "Ashfall", "owed where they were hired, not where you are");
    assert.equal(bill.payableOn, "return");
  });

  test("a missed payment ends the contract and blackballs the whole party (C:2511)", () => {
    const e = newEmployment({ employerId: "pc1", power: 3, hiredInVillage: "Ashfall" });
    const after = applyMissedPayment(e);
    assert.equal(after.status, "left");
    assert.equal(after.leftReason, "unpaid");
    assert.equal(after.outstandingDebt, 30);
    // "other crows associated with them" — a party fact, not a per-actor one.
    assert.equal(after.blacklistedParty, true);
    assert.equal(canHireWhileInDebt(after.outstandingDebt), false);
  });

  test("paying the debt off lifts the blackball, and part-paying does not", () => {
    const indebted = { outstandingDebt: 100, blacklistedParty: true };
    const part = payDebt(indebted, 40);
    assert.equal(part.outstandingDebt, 60);
    assert.equal(part.blacklistedParty, true);
    const clear = payDebt(part, 60);
    assert.equal(clear.outstandingDebt, 0);
    assert.equal(clear.blacklistedParty, false);
    assert.equal(canHireWhileInDebt(0), true);
  });

  test("hirelings follow PC rules except XP (C:2517)", () => {
    assert.equal(HIRELING_CONTROL.followsPCRules, true);
    assert.equal(HIRELING_CONTROL.noXP, true);
    assert.equal(HIRELING_CONTROL.mayUseEquipment, true);
    assert.equal(HIRELING_CONTROL.hasExpertises, true);
    assert.equal(HIRELING_CONTROL.mayTakeRestActivities, true);
    assert.equal(HIRELING_CONTROL.controlledBy, "employer");
    assert.equal(HIRELING_CONTROL.refMayOverride, true);
  });
});

describe("hirelings — the barracks supplies them (C:2773-2783)", () => {
  test("maximum power is twice the barracks level", () => {
    const expected = [2, 4, 6, 8, 10];
    for (let lvl = 1; lvl <= 5; lvl++) assert.equal(hireableMaxPower(lvl), expected[lvl - 1]);
    assert.equal(hireableMaxPower(0), 0, "no barracks, no hirelings");
  });

  test("a hireling above the barracks' ceiling is refused", () => {
    assert.equal(canHireFromBarracks({ power: 6 }, 3).ok, true);
    assert.equal(canHireFromBarracks({ power: 7 }, 3).ok, false);
    assert.equal(canHireFromBarracks({ power: 1 }, 0).ok, false);
  });

  test("Provisions needs BOTH level 5 and Prosperity 10 (C:2769)", () => {
    assert.equal(hirelingStartingRations(5, 10), PROVISIONS_RATIONS);
    assert.equal(hirelingStartingRations(5, 9), 0);
    assert.equal(hirelingStartingRations(4, 10), 0);
    assert.equal(daysBeforeFeeding(5, 10), 12);
    assert.equal(daysBeforeFeeding(1, 0), 0);
  });
});

describe("hirelings — death of the employer (C:2533)", () => {
  const employed = () => newEmployment({ employerId: "pc1", power: 3, hiredInVillage: "Ashfall" });

  test("a willing survivor inherits the contract on the same terms", () => {
    const e = { ...employed(), salaryPaid: 90, daysServed: 3 };
    const after = onEmployerDeath(e, { willingPCs: [{ id: "pc2" }] });
    assert.equal(after.status, "active");
    assert.equal(after.employerId, "pc2");
    assert.equal(after.previousEmployerId, "pc1");
    assert.equal(after.salaryPaid, 90, "terms carry over; this is not a renegotiation");
  });

  test("with nobody willing, they go home to the village where they were hired", () => {
    const after = onEmployerDeath(employed(), { willingPCs: [] });
    assert.equal(after.status, "returnedHome");
    assert.equal(after.employerId, null);
    assert.equal(after.returnedTo, "Ashfall");
    assert.equal(after.offerMade, true);
  });

  test("a total party kill leaves nobody to ask", () => {
    const after = onEmployerDeath(employed(), {});
    assert.equal(after.status, "returnedHome");
  });
});

/** Narrow a recordMerchantSpend result down to the village fields it updates. */
function pick({ spentThisCycle, spendBonusAwarded }) {
  return { spentThisCycle, spendBonusAwarded };
}
