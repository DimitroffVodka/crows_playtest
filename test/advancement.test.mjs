import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as advancementApi from "../module/helpers/advancement.mjs";

import {
  bonusesEarned, expertiseBonusesEarned, charBonusesEarned,
  nextExpertiseBonusTXP, nextCharBonusTXP, nextAdvancementTXP, nextBonusTXP,
  retirementStatus, bonusesAvailable, expertiseCapFor,
  advancementBonusOptions, advancementOptions,
  planExpertiseDistribution, planExpertiseBonus, planCharAdvancement,
  spendExpertiseBonus, spendCharBonus,
  spendingWindow, treasureXP, replacementCharacter,
  isTraitBuyable, traitCost, traitPurchaseInfo, purchaseTrait,
  traitMinimumModifier, traitPoolMax, traitPoolState,
  gainXP
} from "../module/helpers/advancement.mjs";
import { CROWS, expertiseMaxForTxp } from "../module/config.mjs";

/**
 * T1.4. Every table here is Playtest 2's; none of Playtest 1's numbers survive.
 *
 * The pure planners take a "crow-like" — an object with `.system` (and `.items`
 * for traits) — so the rules are testable without a Foundry runtime. The async
 * wrappers are exercised against the same stub, which is possible only because
 * they reach for `globalThis.ChatMessage` / `globalThis.ui` rather than the bare
 * globals; undefined there is a no-op, not a ReferenceError.
 */

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

function crow({ txp = 0, spendable = 0, expertiseBonusesSpent = 0, charBonusesSpent = 0,
                expertises = {}, characteristics = {}, stamina = { value: 5, max: 5 },
                items = [], flags = {} } = {}) {
  const chars = { agility: { value: 0 }, mind: { value: 0 }, strength: { value: 0 } };
  for (const [k, v] of Object.entries(characteristics)) chars[k] = { value: v };
  const exp = {};
  for (const [k, v] of Object.entries(expertises)) {
    exp[k] = typeof v === "number" ? { value: v, max: v } : v;
  }
  const actor = {
    type: "crow",
    name: "Test Crow",
    flags,
    items,
    system: {
      characteristics: chars,
      expertises: exp,
      stamina: { ...stamina },
      xp: { txp, spendable, expertiseBonusesSpent, charBonusesSpent }
    },
    applied: null,
    embedded: [],
    async update(data) { actor.applied = { ...(actor.applied ?? {}), ...data }; return actor; },
    async createEmbeddedDocuments(_type, docs) { actor.embedded.push(...docs); return docs; },
    async setFlag(scope, key, value) {
      actor.flags[scope] = { ...(actor.flags[scope] ?? {}), [key]: value };
      return actor;
    }
  };
  return actor;
}

const trait = ({ name, tree = "armor", tier = 1, isStarting = false, connectsTo = [], usePool } = {}) => ({
  name, type: "trait",
  system: { tree, tier, isStarting, connectsTo, ...(usePool ? { usePool } : {}) }
});

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

describe("Expertise & Stamina track — C:621", () => {
  test("the first bonus lands exactly on 100 TXP", () => {
    assert.equal(expertiseBonusesEarned(99), 0);
    assert.equal(expertiseBonusesEarned(100), 1);
  });

  test("one per table row, through the 9th at 30,000", () => {
    assert.equal(expertiseBonusesEarned(29999), 8);
    assert.equal(expertiseBonusesEarned(30000), 9);
  });

  test("'every 30,000 after' begins at 60,000, not just past 30,000", () => {
    // The repeat is measured from the last ROW, so 30,001 is still the 9th.
    assert.equal(expertiseBonusesEarned(30001), 9);
    assert.equal(expertiseBonusesEarned(59999), 9);
    assert.equal(expertiseBonusesEarned(60000), 10);
    assert.equal(expertiseBonusesEarned(90000), 11);
  });

  test("negative and junk TXP read as 0, never as a negative bonus count", () => {
    assert.equal(expertiseBonusesEarned(-5000), 0);
    assert.equal(expertiseBonusesEarned("nonsense"), 0);
    assert.equal(expertiseBonusesEarned(), 0);
  });
});

describe("Characteristic track — C:642", () => {
  test("5,000 / 15,000 / 30,000 on the nose", () => {
    assert.equal(charBonusesEarned(4999), 0);
    assert.equal(charBonusesEarned(5000), 1);
    assert.equal(charBonusesEarned(14999), 1);
    assert.equal(charBonusesEarned(15000), 2);
    assert.equal(charBonusesEarned(29999), 2);
    assert.equal(charBonusesEarned(30000), 3);
  });

  test("then every 30,000 after — the 4th at 60,000", () => {
    assert.equal(charBonusesEarned(59999), 3);
    assert.equal(charBonusesEarned(60000), 4);
    assert.equal(charBonusesEarned(90000), 5);
  });

  test("the two tracks advance independently", () => {
    assert.deepEqual(bonusesEarned(5000), { expertise: 6, char: 1 });
    assert.deepEqual(bonusesEarned(60000), { expertise: 10, char: 4 });
  });
});

describe("next thresholds", () => {
  test("inside the table it is the next row", () => {
    assert.equal(nextExpertiseBonusTXP(0), 100);
    assert.equal(nextExpertiseBonusTXP(100), 500);
    assert.equal(nextExpertiseBonusTXP(29999), 30000);
  });

  test("past the table it walks the 30,000 repeat", () => {
    assert.equal(nextExpertiseBonusTXP(30000), 60000);
    assert.equal(nextExpertiseBonusTXP(59999), 60000);
    assert.equal(nextExpertiseBonusTXP(60000), 90000);
    assert.equal(nextCharBonusTXP(30000), 60000);
    assert.equal(nextCharBonusTXP(60000), 90000);
  });

  test("nextBonusTXP stays a NUMBER — the soonest of the two tracks", () => {
    assert.equal(nextBonusTXP(0), 100);
    assert.equal(nextBonusTXP(3500), 5000);
    assert.deepEqual(nextAdvancementTXP(3500), { expertise: 5000, char: 5000 });
  });
});

describe("retirement", () => {
  test("60,000 TXP", () => {
    assert.equal(CROWS.retirementTXP, 60000);
    assert.deepEqual(retirementStatus(59999),
      { txp: 59999, threshold: 60000, eligible: false, remaining: 1 });
    assert.equal(retirementStatus(60000).eligible, true);
    assert.equal(retirementStatus(90000).remaining, 0);
  });
});

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

describe("bonusesAvailable", () => {
  test("earned minus spent, on both tracks", () => {
    const a = bonusesAvailable(crow({ txp: 5000, expertiseBonusesSpent: 4, charBonusesSpent: 0 }));
    assert.equal(a.expertise, 2);          // 6 earned, 4 spent
    assert.equal(a.char, 1);
  });

  test("over-spending never reads as a negative allowance", () => {
    const a = bonusesAvailable(crow({ txp: 100, expertiseBonusesSpent: 9 }));
    assert.equal(a.expertise, 0);
  });
});

describe("expertiseCapFor", () => {
  test("a TXP-0 crow's cap is 2, so a background's 2 uses are legal on day one", () => {
    assert.equal(expertiseCapFor(crow({ txp: 0 })), 2);
    assert.equal(expertiseCapFor(crow({ txp: 5000 })), 3);
    assert.equal(expertiseCapFor(crow({ txp: 20000 })), 4);
  });
});

describe("advancementOptions — data for the sheet, no choice made", () => {
  test("returns the three options from C:615 and picks none", () => {
    const opts = advancementBonusOptions();
    assert.deepEqual(opts.map(o => o.id), ["uses", "stamina", "useAndStamina"]);
    assert.deepEqual(opts.map(o => [o.uses, o.stamina]), [[3, 0], [0, 2], [1, 1]]);
    assert.equal(CROWS.expertiseUsesPerBonus, 3);
  });

  test("the option table cannot be mutated through a caller", () => {
    advancementBonusOptions()[0].uses = 99;
    assert.equal(advancementBonusOptions()[0].uses, 3);
  });

  test("every expertise is offered with its room, including ones not owned", () => {
    const view = advancementOptions(crow({ txp: 100, expertises: { stealth: 2 } }));
    assert.equal(view.expertises.length, 30);
    const stealth = view.expertises.find(e => e.key === "stealth");
    const alchemy = view.expertises.find(e => e.key === "alchemy");
    assert.deepEqual([stealth.max, stealth.room], [2, 0]);
    assert.deepEqual([alchemy.max, alchemy.room], [0, 2], "an expertise you do not have has full room");
    assert.equal(view.cap, 2);
    assert.equal(alchemy.category, "general");
  });

  test("an over-cap expertise is surfaced, not clamped", () => {
    // A migrated crow can hold more than the cap allows (H5). Report it.
    const view = advancementOptions(crow({ txp: 0, expertises: { stealth: 4 } }));
    const stealth = view.expertises.find(e => e.key === "stealth");
    assert.equal(stealth.max, 4);
    assert.equal(stealth.overCap, 2);
    assert.equal(stealth.room, 0);
  });

  test("flags the all-characteristics-at-cap conversion", () => {
    const maxed = crow({ characteristics: { agility: 4, mind: 4, strength: 4 } });
    assert.equal(advancementOptions(maxed).charAdvancementConverts, true);
    assert.equal(advancementOptions(crow()).charAdvancementConverts, false);
  });
});

/* -------------------------------------------------------------------------- */
/* Distributing expertise uses                                                 */
/* -------------------------------------------------------------------------- */

describe("planExpertiseDistribution — C:615", () => {
  test("raises max AND value together, so the use is available immediately", () => {
    const plan = planExpertiseDistribution(crow({ txp: 5000, expertises: { stealth: { value: 0, max: 2 } } }),
                                           { stealth: 1, alchemy: 2 });
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.expertises.stealth.max"], 3);
    assert.equal(plan.updates["system.expertises.stealth.value"], 1,
      "a spent-down expertise gains the new use on top of what is left, not a full refill");
    assert.equal(plan.updates["system.expertises.alchemy.max"], 2);
    assert.equal(plan.updates["system.expertises.alchemy.value"], 2);
  });

  test("refuses to push any expertise above the cap for this TXP", () => {
    const c = crow({ txp: 100, expertises: { stealth: 2 } });     // cap 2, already there
    const plan = planExpertiseDistribution(c, { stealth: 1, alchemy: 2 });
    assert.equal(plan.ok, false);
    assert.match(plan.error, /stealth.*exceed the maximum of 2/);
    assert.equal(plan.cap, 2);
  });

  test("the cap rises with TXP, and the same distribution then passes", () => {
    const dist = { stealth: 1, alchemy: 2 };
    assert.equal(planExpertiseDistribution(crow({ txp: 100, expertises: { stealth: 2 } }), dist).ok, false);
    assert.equal(planExpertiseDistribution(crow({ txp: 5000, expertises: { stealth: 2 } }), dist).ok, true,
      "at 5,000 TXP the cap is 3");
    assert.equal(expertiseMaxForTxp(5000), 3);
  });

  test("uses may go into an expertise the crow does not have (C:615)", () => {
    const plan = planExpertiseDistribution(crow({ txp: 0 }), { necromancy: 2, bow: 1 });
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.expertises.necromancy.max"], 2);
    assert.equal(plan.updates["system.expertises.bow.value"], 1);
  });

  test("value is never written above max, even from a corrupt stored value", () => {
    const c = crow({ txp: 0, expertises: { stealth: { value: 5, max: 1 } } });
    const plan = planExpertiseDistribution(c, { stealth: 1, alchemy: 2 });
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.expertises.stealth.max"], 2);
    assert.equal(plan.updates["system.expertises.stealth.value"], 2, "clamped down to the new max");
  });

  test("the whole distribution must be spent — no more, no less", () => {
    const c = crow({ txp: 0 });
    assert.match(planExpertiseDistribution(c, { stealth: 2 }).error, /exactly 3 uses \(got 2\)/);
    assert.match(planExpertiseDistribution(c, { stealth: 2, alchemy: 2 }).error, /exactly 3 uses \(got 4\)/);
    assert.equal(planExpertiseDistribution(c, { stealth: 2, alchemy: 1 }).ok, true);
  });

  test("the split option distributes exactly one", () => {
    const c = crow({ txp: 0 });
    assert.equal(planExpertiseDistribution(c, { stealth: 1 }, { uses: 1 }).ok, true);
    assert.match(planExpertiseDistribution(c, { stealth: 2 }, { uses: 1 }).error, /exactly 1 use \(got 2\)/);
  });

  test("junk allocations are refused rather than coerced", () => {
    const c = crow({ txp: 0 });
    assert.match(planExpertiseDistribution(c, { notAnExpertise: 3 }).error, /unknown expertise/);
    assert.match(planExpertiseDistribution(c, { stealth: 1.5, alchemy: 1.5 }).error, /whole number/);
    assert.match(planExpertiseDistribution(c, { stealth: -1, alchemy: 4 }).error, /non-negative/);
  });

  test("zero entries are ignored, not counted as an allocation", () => {
    const plan = planExpertiseDistribution(crow({ txp: 0 }), { stealth: 2, alchemy: 1, bow: 0 });
    assert.ok(plan.ok, plan.error);
    assert.equal("system.expertises.bow.max" in plan.updates, false);
  });
});

describe("planExpertiseBonus — the three-way choice", () => {
  test("needs an unspent bonus", () => {
    const spent = crow({ txp: 100, expertiseBonusesSpent: 1 });
    assert.match(planExpertiseBonus(spent, "stamina").error, /no expertise\/Stamina advancements/);
  });

  test("+2 Stamina max raises current Stamina with it", () => {
    const c = crow({ txp: 100, stamina: { value: 3, max: 5 } });
    const plan = planExpertiseBonus(c, "stamina");
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.stamina.max"], 7);
    assert.equal(plan.updates["system.stamina.value"], 5);
    assert.equal(plan.updates["system.xp.expertiseBonusesSpent"], 1);
  });

  test("the split option applies one use and one Stamina", () => {
    const c = crow({ txp: 100, stamina: { value: 5, max: 5 } });
    const plan = planExpertiseBonus(c, "useAndStamina", { distribution: { bow: 1 } });
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.expertises.bow.max"], 1);
    assert.equal(plan.updates["system.stamina.max"], 6);
  });

  test("a bad distribution fails the whole bonus — nothing is half-applied", () => {
    const c = crow({ txp: 100, expertises: { stealth: 2 } });
    const plan = planExpertiseBonus(c, "uses", { distribution: { stealth: 3 } });
    assert.equal(plan.ok, false);
    assert.equal(plan.updates, undefined);
  });

  test("an unknown option is refused and lists the real ones", () => {
    const plan = planExpertiseBonus(crow({ txp: 100 }), "stamina4");   // the PT1 id
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.options, ["uses", "stamina", "useAndStamina"]);
  });
});

/* -------------------------------------------------------------------------- */
/* Characteristic advancement                                                  */
/* -------------------------------------------------------------------------- */

describe("planCharAdvancement — C:640", () => {
  test("+1 to the chosen characteristic", () => {
    const plan = planCharAdvancement(crow({ txp: 5000, characteristics: { mind: 2 } }), "mind");
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.updates["system.characteristics.mind.value"], 3);
    assert.equal(plan.updates["system.xp.charBonusesSpent"], 1);
    assert.equal(plan.converted, false);
  });

  test("the PC cap is 4 — 3 is a Playtest 1 number", () => {
    assert.equal(CROWS.charPcCap, 4);
    const plan = planCharAdvancement(crow({ txp: 5000, characteristics: { mind: 3 } }), "mind");
    assert.equal(plan.updates["system.characteristics.mind.value"], 4);
    assert.equal(planCharAdvancement(crow({ txp: 5000, characteristics: { mind: 4 } }), "mind").ok, false);
  });

  test("all three at 4 converts the advancement to +2 Stamina max", () => {
    const c = crow({ txp: 5000, characteristics: { agility: 4, mind: 4, strength: 4 },
                     stamina: { value: 8, max: 10 } });
    const plan = planCharAdvancement(c, "mind");
    assert.ok(plan.ok, plan.error);
    assert.equal(plan.converted, true);
    assert.equal(plan.updates["system.stamina.max"], 12);
    assert.equal(plan.updates["system.stamina.value"], 10);
    assert.equal("system.characteristics.mind.value" in plan.updates, false);
  });

  test("the conversion also fires when magic pushed a characteristic past the cap", () => {
    // The schema allows -5..5 precisely because the cap is an advancement rule.
    const c = crow({ txp: 5000, characteristics: { agility: 5, mind: 4, strength: 4 } });
    assert.equal(planCharAdvancement(c, null).converted, true);
  });

  test("no characteristic named, and not all at the cap, is an error not a guess", () => {
    const plan = planCharAdvancement(crow({ txp: 5000 }), null);
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.characteristics, ["agility", "mind", "strength"]);
    assert.equal(planCharAdvancement(crow({ txp: 5000 }), "charisma").ok, false);
  });

  test("needs an unspent characteristic advancement", () => {
    assert.match(planCharAdvancement(crow({ txp: 4999 }), "mind").error, /no characteristic advancements/);
  });
});

/* -------------------------------------------------------------------------- */
/* The end-of-rest window (C:609)                                              */
/* -------------------------------------------------------------------------- */

describe("spending is gated to the end of a rest", () => {
  test("an unset flag is permissive — a world with no rest wiring still advances", () => {
    assert.deepEqual(spendingWindow(crow()), { open: true, state: "unset" });
    assert.deepEqual(spendingWindow(crow({ flags: { crows: { advancementWindow: false } } })),
      { open: false, state: "closed" });
    assert.deepEqual(spendingWindow(crow({ flags: { crows: { advancementWindow: true } } })),
      { open: true, state: "open" });
  });

  test("a closed window blocks spending and applies nothing", async () => {
    const c = crow({ txp: 100, flags: { crows: { advancementWindow: false } } });
    const res = await spendExpertiseBonus(c, "stamina");
    assert.equal(res.ok, false);
    assert.match(res.error, /end of a rest/);
    assert.equal(c.applied, null);
  });

  test("force overrides it for a Ref", async () => {
    const c = crow({ txp: 100, flags: { crows: { advancementWindow: false } } });
    const res = await spendExpertiseBonus(c, "stamina", { force: true });
    assert.ok(res.ok, res.error);
    assert.equal(c.applied["system.stamina.max"], 7);
  });

  test("the gate covers characteristic advancement and trait purchase too", async () => {
    const c = crow({ txp: 5000, spendable: 5000, flags: { crows: { advancementWindow: false } } });
    assert.match((await spendCharBonus(c, "mind")).error, /end of a rest/);
    const res = await purchaseTrait(c, trait({ name: "Shield Wall", isStarting: true }));
    assert.match(res.error, /end of a rest/);
    assert.equal(c.embedded.length, 0);
  });
});

/* -------------------------------------------------------------------------- */
/* Applying                                                                    */
/* -------------------------------------------------------------------------- */

describe("spendExpertiseBonus / spendCharBonus apply exactly what was planned", () => {
  test("the expertise option writes both quantities and books the bonus as spent", async () => {
    const c = crow({ txp: 100 });
    const res = await spendExpertiseBonus(c, "uses", { distribution: { stealth: 2, bow: 1 } });
    assert.ok(res.ok, res.error);
    assert.deepEqual(c.applied, {
      "system.expertises.stealth.max": 2, "system.expertises.stealth.value": 2,
      "system.expertises.bow.max": 1, "system.expertises.bow.value": 1,
      "system.xp.expertiseBonusesSpent": 1
    });
  });

  test("a second bonus increments the spent count from what is stored", async () => {
    const c = crow({ txp: 500, expertiseBonusesSpent: 1 });
    await spendExpertiseBonus(c, "stamina");
    assert.equal(c.applied["system.xp.expertiseBonusesSpent"], 2);
  });

  test("non-crows are refused", async () => {
    assert.equal((await spendExpertiseBonus({ type: "monster" }, "stamina")).ok, false);
    assert.equal((await spendCharBonus(null, "mind")).ok, false);
  });
});

describe("gainXP", () => {
  test("TXP and spendable both rise", async () => {
    const c = crow({ txp: 90, spendable: 90 });
    const res = await gainXP(c, 20, { silent: true });
    assert.deepEqual(res, { ok: true, txp: 110, spendable: 110 });
    assert.equal(bonusesAvailable({ system: { xp: { txp: 110 } } }).expertise, 1,
      "crossing 100 TXP earns the first bonus");
  });

  test("a correction reduces spendable but never TXP — TXP is lifetime", async () => {
    const c = crow({ txp: 500, spendable: 300 });
    const res = await gainXP(c, -100, { silent: true });
    assert.deepEqual(res, { ok: true, txp: 500, spendable: 200 });
  });
});

/* -------------------------------------------------------------------------- */
/* XP accrual (C:605)                                                          */
/* -------------------------------------------------------------------------- */

describe("treasureXP", () => {
  test("value divided by the player count, rounded down", () => {
    const res = treasureXP([{ name: "Idol", value: 500 }, { name: "Chain", value: 250 }], { players: 4 });
    assert.equal(res.total, 750);
    assert.equal(res.perPlayer, 187);
  });

  test("purchased, crafted, innocent-taken and ally-owned goods are excluded, with reasons", () => {
    const res = treasureXP([
      { name: "Bought sword", value: 100, purchased: true },
      { name: "My own potion", value: 50, crafted: true },
      { name: "Widow's ring", value: 900, fromInnocent: true },
      { name: "Ally's pack", value: 40, allyOwned: true },
      { name: "Village stock", value: 10, fromVillage: true },
      { name: "Crypt haul", value: 300 }
    ], { players: 3 });
    assert.equal(res.total, 300);
    assert.equal(res.perPlayer, 100);
    assert.equal(res.excluded.length, 5);
    assert.deepEqual(res.excluded.map(e => e.reason).sort(),
      ["crafted", "not recovered outside the village", "originally an ally's",
       "purchased", "taken from an innocent"]);
  });

  test("a unique item's explicit XP value replaces its gold value", () => {
    const res = treasureXP([{ name: "Crown", value: 1000, xpValue: 250 }], { players: 1 });
    assert.equal(res.total, 250);
    assert.equal(res.counted[0].explicit, true);
    // and an explicit 0 is honoured rather than falling back to the gold value
    assert.equal(treasureXP([{ name: "Cursed", value: 800, xpValue: 0 }]).total, 0);
  });

  test("a party of zero does not divide by zero", () => {
    assert.equal(treasureXP([{ value: 100 }], { players: 0 }).perPlayer, 100);
  });
});

/* -------------------------------------------------------------------------- */
/* Death and replacement (C:653-657)                                           */
/* -------------------------------------------------------------------------- */

describe("replacementCharacter", () => {
  test("extra background rolls equal the dead crow's bonus count", () => {
    const r = replacementCharacter({ deadTxp: 3500, partyTxps: [8000, 4200, 12000] });
    assert.equal(r.extraBackgroundRolls, 5);
    assert.equal(r.charBonuses, 0);
  });

  test("the optional TXP floor is the party's LOWEST, with gold at half of it", () => {
    const r = replacementCharacter({ deadTxp: 20000, partyTxps: [8000, 4200, 12000] });
    assert.equal(r.suggestedTxp, 4200);
    assert.equal(r.suggestedGold, 2100);
    assert.equal(r.extraBackgroundRolls, 8);
  });

  test("a first death in a fresh party degrades to zero, not NaN", () => {
    assert.deepEqual(replacementCharacter(),
      { extraBackgroundRolls: 0, expertiseBonuses: 0, charBonuses: 0, suggestedTxp: 0, suggestedGold: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Traits (C:661-671)                                                          */
/* -------------------------------------------------------------------------- */

describe("trait purchase rules", () => {
  const owned = (name, tree, connectsTo = []) => ({
    name, type: "trait", system: { tree, tier: 1, connectsTo }
  });

  test("a starting trait is always buyable and costs 500", () => {
    const t = trait({ name: "Iron Skin", tree: "armor", isStarting: true });
    assert.equal(isTraitBuyable(crow(), t).ok, true);
    assert.equal(traitCost(t), 500);
  });

  test("anything else needs a line to a trait already owned on the SAME tree", () => {
    const t = trait({ name: "Turtle", tree: "armor", tier: 2 });
    assert.equal(isTraitBuyable(crow(), t).ok, false);
    const withArmor = crow({ items: [owned("Iron Skin", "armor", ["Turtle"])] });
    assert.equal(isTraitBuyable(withArmor, t).ok, true);
    const wrongTree = crow({ items: [owned("Iron Skin", "thievery", ["Turtle"])] });
    assert.equal(isTraitBuyable(wrongTree, t).ok, false);
  });

  test("the line is bidirectional — content names it from one end only", () => {
    const t = trait({ name: "Turtle", tree: "armor", tier: 2, connectsTo: ["Iron Skin"] });
    const c = crow({ items: [owned("Iron Skin", "armor", [])] });
    assert.equal(isTraitBuyable(c, t).ok, true);
  });

  test("one purchase each (C:667)", () => {
    const t = trait({ name: "Iron Skin", tree: "armor", isStarting: true });
    const c = crow({ items: [owned("Iron Skin", "armor")] });
    assert.deepEqual(isTraitBuyable(c, t), { ok: false, reason: "already owned" });
  });

  test("traitPurchaseInfo gives the grid its data without rendering any of it", () => {
    const t = trait({ name: "Iron Skin", tree: "armor", isStarting: true });
    const info = traitPurchaseInfo(crow({ spendable: 300 }), t);
    assert.deepEqual(
      { owned: info.owned, buyable: info.buyable, cost: info.cost, affordable: info.affordable },
      { owned: false, buyable: true, cost: 500, affordable: false });
    assert.equal(traitPurchaseInfo(crow({ spendable: 500 }), t).affordable, true);
  });
});

describe("minimum modifier — C:671", () => {
  test("a trait scaling off a characteristic never scales below 1", () => {
    assert.equal(traitMinimumModifier(3), 3);
    assert.equal(traitMinimumModifier(1), 1);
    assert.equal(traitMinimumModifier(0), 1);
    assert.equal(traitMinimumModifier(-2), 1);
  });

  test("a Mind-sized pool on a Mind -1 crow still has one use", () => {
    const t = trait({ name: "Focus", tree: "knowledge", usePool: { sizedBy: "mind", fixedMax: 0, used: 0 } });
    assert.equal(traitPoolMax(t, crow({ characteristics: { mind: -1 } })), 1);
    assert.equal(traitPoolMax(t, crow({ characteristics: { mind: 3 } })), 3);
  });

  test("a fixed pool is untouched by the rule and may legitimately be 0", () => {
    const t = trait({ name: "Fixed", usePool: { sizedBy: "", fixedMax: 0, used: 0 } });
    assert.equal(traitPoolMax(t, crow()), 0);
  });

  test("a spent use is never refunded when the characteristic drops", () => {
    const t = trait({ name: "Focus", tree: "knowledge", usePool: { sizedBy: "mind", fixedMax: 0, used: 3 } });
    const drained = traitPoolState(t, crow({ characteristics: { mind: 1 } }));
    assert.deepEqual(drained, { max: 1, used: 3, remaining: 0, overused: 2 });
  });
});

/* -------------------------------------------------------------------------- */
/* The public Playtest 2 surface                                               */
/* -------------------------------------------------------------------------- */

describe("public advancement API", () => {
  test("does not export the removed Playtest 1 spendSkillBonus helper", () => {
    assert.equal(Object.hasOwn(advancementApi, "spendSkillBonus"), false);
  });
});
