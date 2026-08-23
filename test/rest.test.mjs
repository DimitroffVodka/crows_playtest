import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  expertiseRefreshUpdates, traitPoolState, traitPoolResetUpdates,
  woundCandidatesFromLayout, resolveWoundRemoval, validateTendWounds,
  harvestFormula, restBlockedReason,
  newRestSession, claimRestActivity, markTended, markRested, woundRemovalCount,
  sessionHasSecludeCamp, townActivityClaim, townActivitiesRemaining,
  preparedTaskMatches, PREPARE_FOR_TASK_BONUS, TOWN_ACTIVITY_LIMIT,
  REST_ACTIVITIES
} from "../module/helpers/rest.mjs";

import {
  encounterNumber, resolveEncounterCheck, conditionExpiryUpdate,
  DT_EXPIRING_CONDITIONS, DT_LENGTHS, resolveUsageDicePool, effectUsageDice
} from "../module/helpers/dungeon-turn.mjs";

import {
  beginDungeonEntry, endDungeonEntry, greedAward, greedState,
  greedMultiplierForDT, dungeonKey, GREED_ACTIVE, GREED_SPENT, GREED_UNENTERED
} from "../module/helpers/greed.mjs";

import { layoutFor } from "../module/helpers/slots.mjs";
import { CROWS } from "../module/config.mjs";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** An expertise block with only the named keys non-zero. */
function expertises(spec) {
  const out = {};
  for (const key of CROWS.ALL_EXPERTISES ?? Object.keys(spec)) out[key] = { value: 0, max: 0 };
  for (const [k, v] of Object.entries(spec)) out[k] = v;
  return out;
}

function traitItem({ id = "t1", name = "Trait", sizedBy = "", fixedMax = 0, used = 0 } = {}) {
  return { id, _id: id, name, type: "trait", system: { usePool: { sizedBy, fixedMax, used } } };
}

/** Minimal actor-like for layoutFor(): it reads `id`, `items`, `system`. */
function crowWithWounds(woundSlots, items = []) {
  return { id: "crow1", items, system: { woundSlots, currency: 0 } };
}

/* -------------------------------------------------------------------------- */
/*  1. The expertise refresh — R:628 and R:1375                                */
/* -------------------------------------------------------------------------- */

describe("expertiseRefreshUpdates — rest writes value, never max", () => {
  test("restores value up to max, and touches nothing else", () => {
    const u = expertiseRefreshUpdates(expertises({
      stealth: { value: 0, max: 3 },
      athletics: { value: 1, max: 2 }
    }));
    assert.equal(u["system.expertises.stealth.value"], 3);
    assert.equal(u["system.expertises.athletics.value"], 2);
  });

  test("NEVER writes max — max is the owned pool and only advancement moves it", () => {
    const u = expertiseRefreshUpdates(expertises({ stealth: { value: 0, max: 3 } }));
    for (const path of Object.keys(u)) {
      assert.ok(!path.endsWith(".max"), `rest wrote ${path} — that is the owned pool (C:615)`);
    }
  });

  test("an expertise nobody owns stays at 0 — rest cannot mint uses", () => {
    const u = expertiseRefreshUpdates(expertises({ stealth: { value: 0, max: 0 } }));
    assert.equal(u["system.expertises.stealth.value"], undefined);
  });

  test("does not restore to the derived cap, only to what is owned", () => {
    // expertiseCap at this TXP would be 2; owned is 1. Rest gives back 1.
    const u = expertiseRefreshUpdates(expertises({ stealth: { value: 0, max: 1 } }));
    assert.equal(u["system.expertises.stealth.value"], 1);
  });

  test("an already-full expertise produces no write at all", () => {
    const u = expertiseRefreshUpdates(expertises({ stealth: { value: 3, max: 3 } }));
    assert.deepEqual(u, {});
  });

  // THE ACCEPTANCE TEST.
  test("ACCEPTANCE: resting in the Miasma does NOT refresh expertise uses (R:1375)", () => {
    const spent = expertises({
      stealth: { value: 0, max: 3 },
      athletics: { value: 1, max: 2 },
      endurance: { value: 2, max: 2 }
    });
    const u = expertiseRefreshUpdates(spent, { inMiasma: true });
    assert.deepEqual(u, {}, "the Miasma must leave `value` exactly as it is");
  });

  test("the Miasma suppression is total, not partial — no key is written", () => {
    const u = expertiseRefreshUpdates(expertises({ stealth: { value: 0, max: 5 } }), { inMiasma: true });
    assert.equal(Object.keys(u).length, 0);
  });

  test("the suppression is expressible ONLY because value and max are separate", () => {
    // The proof: after a suppressed rest, `value` (0) and `max` (3) still carry
    // different facts. Collapse them into one number and the 0 is
    // indistinguishable from "never owned", so the NEXT rest cannot restore.
    const ex = expertises({ stealth: { value: 0, max: 3 } });
    assert.deepEqual(expertiseRefreshUpdates(ex, { inMiasma: true }), {});
    assert.equal(expertiseRefreshUpdates(ex)["system.expertises.stealth.value"], 3,
      "leaving the Miasma must restore what was owned all along");
  });
});

/* -------------------------------------------------------------------------- */
/*  2. Trait use pools — CONTRACT §5, C:921 / C:1361 / C:1501 / C:1739         */
/* -------------------------------------------------------------------------- */

describe("traitPoolState — a pool sized by a characteristic", () => {
  const chars = { agility: { value: 2 }, mind: { value: 3 }, strength: { value: 1 } };

  test("Mind-sized pools take their size from Mind (C:921, C:1361, C:1501)", () => {
    assert.equal(traitPoolState({ sizedBy: "mind", used: 0 }, chars).max, 3);
  });

  test("the Agility-sized pool is real and is sized by Agility (C:1739)", () => {
    assert.equal(traitPoolState({ sizedBy: "agility", used: 0 }, chars).max, 2);
  });

  test("a negative characteristic floors the pool at 0 — not an error state", () => {
    const drained = { mind: { value: -3 } };
    const s = traitPoolState({ sizedBy: "mind", used: 0 }, drained);
    assert.equal(s.max, 0);
    assert.equal(s.remaining, 0);
    assert.equal(s.overused, 0);
  });

  test("fixedMax is used when nothing sizes the pool", () => {
    assert.equal(traitPoolState({ sizedBy: "", fixedMax: 4, used: 1 }, chars).max, 4);
  });

  test("overused is reachable by a stat drain and is REPORTED, not refunded", () => {
    const s = traitPoolState({ sizedBy: "mind", used: 3 }, { mind: { value: 1 } });
    assert.equal(s.max, 1);
    assert.equal(s.overused, 2);
    assert.equal(s.remaining, 0);
    assert.equal(s.used, 3, "`used` must never be clamped down — that refunds a spent use");
  });
});

describe("traitPoolResetUpdates — the ONLY thing that resets a trait pool", () => {
  test("zeroes `used` on every configured pool", () => {
    const u = traitPoolResetUpdates([
      traitItem({ id: "a", sizedBy: "mind", used: 2 }),
      traitItem({ id: "b", sizedBy: "agility", used: 1 })
    ]);
    assert.deepEqual(u, [
      { _id: "a", "system.usePool.used": 0 },
      { _id: "b", "system.usePool.used": 0 }
    ]);
  });

  test("writes `used` and nothing else — never sizedBy, never fixedMax", () => {
    const u = traitPoolResetUpdates([traitItem({ id: "a", sizedBy: "mind", used: 2 })]);
    assert.deepEqual(Object.keys(u[0]).sort(), ["_id", "system.usePool.used"]);
  });

  test("an already-empty pool produces no write", () => {
    assert.deepEqual(traitPoolResetUpdates([traitItem({ sizedBy: "mind", used: 0 })]), []);
  });

  test("an overused pool IS reset by the rest — that is how overused clears", () => {
    const u = traitPoolResetUpdates([traitItem({ id: "a", sizedBy: "mind", used: 9 })]);
    assert.deepEqual(u, [{ _id: "a", "system.usePool.used": 0 }]);
  });

  test("non-traits and unconfigured pools are ignored", () => {
    assert.deepEqual(traitPoolResetUpdates([
      { id: "w", type: "weapon", system: { usePool: { sizedBy: "mind", used: 3 } } },
      traitItem({ id: "t", sizedBy: "", fixedMax: 0, used: 3 })
    ]), []);
  });

  test("the reset is NOT gated on the Miasma — R:1375 names expertises only", () => {
    // The direct proof, next to its opposite: the same night, the expertise
    // refresh is suppressed and the trait pool still resets.
    const items = [traitItem({ id: "a", sizedBy: "mind", used: 2 })];
    const ex = expertises({ stealth: { value: 0, max: 3 } });

    assert.deepEqual(expertiseRefreshUpdates(ex, { inMiasma: true }), {});
    assert.deepEqual(traitPoolResetUpdates(items), [{ _id: "a", "system.usePool.used": 0 }],
      "R:1375 names expertises; a trait pool refreshes in the Miasma like any other rest");
  });
});

/* -------------------------------------------------------------------------- */
/*  3. Wounds — R:524, R:628, R:670                                            */
/* -------------------------------------------------------------------------- */

describe("woundCandidatesFromLayout — wound slots come from T1.2's Layout", () => {
  test("reads backpack slots flagged as wounds, ascending", () => {
    const layout = layoutFor(crowWithWounds([5, 1, 3]));
    assert.deepEqual(woundCandidatesFromLayout(layout), [1, 3, 5]);
  });

  test("an orphaned wound beyond capacity is NOT offered as removable", () => {
    const cap = CROWS.carryContainers.backpack;          // 10
    const layout = layoutFor(crowWithWounds([2, cap + 4]));
    assert.deepEqual(woundCandidatesFromLayout(layout), [2],
      "a wound at an index that has no slot cannot be the one you choose");
  });
});

describe("resolveWoundRemoval — one wound, of the PLAYER'S choice", () => {
  test("removes exactly the chosen slot", () => {
    const r = resolveWoundRemoval([1, 3, 5], [3], 1);
    assert.deepEqual(r.removed, [3]);
    assert.deepEqual(r.remaining, [1, 5]);
    assert.equal(r.autoChosen, false);
  });

  test("a slot that holds no wound is rejected, and nothing is removed", () => {
    const r = resolveWoundRemoval([1, 3], [7], 1);
    assert.equal(r.ok, false);
    assert.deepEqual(r.removed, []);
  });

  test("no choice supplied falls back to the lowest slot and FLAGS it", () => {
    const r = resolveWoundRemoval([2, 6, 9], null, 1);
    assert.deepEqual(r.removed, [2]);
    assert.equal(r.autoChosen, true, "a UI must be able to tell a pick from a default");
  });

  test("a forced single candidate is not reported as auto-chosen guesswork", () => {
    assert.equal(resolveWoundRemoval([4], [4], 1).autoChosen, false);
  });

  test("no wounds means no removal and no error", () => {
    const r = resolveWoundRemoval([], [1], 1);
    assert.equal(r.ok, true);
    assert.deepEqual(r.removed, []);
  });

  test("Tend Wounds removes two, and never more than exist", () => {
    assert.deepEqual(resolveWoundRemoval([1, 4, 8], [4, 8], 2).removed, [4, 8]);
    assert.deepEqual(resolveWoundRemoval([1, 4], [1, 4], 2).removed, [1, 4]);
    assert.deepEqual(resolveWoundRemoval([3], null, 2).removed, [3]);
  });

  test("duplicate choices do not double-count into the allowance", () => {
    const r = resolveWoundRemoval([1, 4, 8], [4, 4], 2);
    assert.equal(r.removed.length, 2);
    assert.ok(r.removed.includes(4));
  });
});

/* -------------------------------------------------------------------------- */
/*  4. Tend Wounds — R:670                                                     */
/* -------------------------------------------------------------------------- */

describe("validateTendWounds", () => {
  // THE ACCEPTANCE TEST.
  test("ACCEPTANCE: refuses to target yourself", () => {
    const r = validateTendWounds({ actorId: "a", targetId: "a", targetWounds: 4 });
    assert.equal(r.ok, false);
    assert.match(r.error, /yourself/i);
  });

  test("ACCEPTANCE: refuses a target with only 1 wound", () => {
    const r = validateTendWounds({ actorId: "a", targetId: "b", targetWounds: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /2 wounds/);
  });

  test("refuses a target with no wounds", () => {
    assert.equal(validateTendWounds({ actorId: "a", targetId: "b", targetWounds: 0 }).ok, false);
  });

  test("accepts another character with exactly 2 wounds — the boundary", () => {
    assert.equal(validateTendWounds({ actorId: "a", targetId: "b", targetWounds: 2 }).ok, true);
  });

  test("refuses when there is no target at all", () => {
    assert.equal(validateTendWounds({ actorId: "a", targetId: "", targetWounds: 5 }).ok, false);
  });
});

describe("woundRemovalCount — tended is 2 INSTEAD of 1, not 2 on top of 1", () => {
  test("an untended crow removes one", () => {
    assert.equal(woundRemovalCount(newRestSession(), "a"), 1);
  });

  test("a tended crow removes two", () => {
    assert.equal(woundRemovalCount(markTended(newRestSession(), "b"), "b"), 2);
  });

  test("tending B does not change what A removes", () => {
    assert.equal(woundRemovalCount(markTended(newRestSession(), "b"), "a"), 1);
  });
});

/* -------------------------------------------------------------------------- */
/*  5. The group rest session — R:672                                          */
/* -------------------------------------------------------------------------- */

describe("claimRestActivity — Seclude Camp is one person per group", () => {
  test("the first claimant gets it", () => {
    const r = claimRestActivity(newRestSession(), { actorId: "a", activity: "secludeCamp" });
    assert.equal(r.ok, true);
    assert.equal(sessionHasSecludeCamp(r.session), true);
  });

  test("a second character cannot also seclude the same camp", () => {
    const first = claimRestActivity(newRestSession(), { actorId: "a", activity: "secludeCamp" });
    const second = claimRestActivity(first.session, { actorId: "b", activity: "secludeCamp" });
    assert.equal(second.ok, false);
    assert.match(second.error, /one person per group/i);
  });

  test("re-claiming it yourself is idempotent, not a collision", () => {
    const first = claimRestActivity(newRestSession(), { actorId: "a", activity: "secludeCamp" });
    assert.equal(claimRestActivity(first.session, { actorId: "a", activity: "secludeCamp" }).ok, true);
  });

  test("activities that are not group-unique can be doubled up", () => {
    const first = claimRestActivity(newRestSession(), { actorId: "a", activity: "harvest" });
    assert.equal(claimRestActivity(first.session, { actorId: "b", activity: "harvest" }).ok, true);
  });

  test("an actor who already rested starts a NEW rest, freeing the claim", () => {
    let s = claimRestActivity(newRestSession(), { actorId: "a", activity: "secludeCamp" }).session;
    s = markRested(s, "a");
    const again = claimRestActivity(s, { actorId: "a", activity: "secludeCamp" });
    assert.equal(again.ok, true);
    assert.deepEqual(again.session.rested, [], "the session rolled over into the next night");
  });

  test("Seclude Camp does not require finishing the rest (R:672)", () => {
    assert.equal(REST_ACTIVITIES.secludeCamp.needsCompletion, false);
    assert.equal(REST_ACTIVITIES.tendWounds.needsCompletion, true);
  });
});

/* -------------------------------------------------------------------------- */
/*  6. Town activities — R:678                                                 */
/* -------------------------------------------------------------------------- */

describe("townActivityClaim — 4 a day without sleeping", () => {
  test("four no-sleep activities are allowed, the fifth is not", () => {
    let rec = {};
    for (let i = 0; i < TOWN_ACTIVITY_LIMIT; i++) {
      const r = townActivityClaim(rec, { day: "1", actorId: "a", activity: "harvest" });
      assert.equal(r.ok, true, `activity ${i + 1} should be allowed`);
      rec = r.record;
    }
    const fifth = townActivityClaim(rec, { day: "1", actorId: "a", activity: "harvest" });
    assert.equal(fifth.ok, false);
    assert.equal(townActivitiesRemaining(rec, "1", "a"), 0);
  });

  test("each takes about two hours and the benefit lands then", () => {
    const r = townActivityClaim({}, { day: "1", actorId: "a", activity: "craftEquipment" });
    assert.equal(r.hours, 2);
    assert.equal(r.landsAfterHours, 2);
  });

  test("the limit is per character, not per party", () => {
    let rec = {};
    for (let i = 0; i < TOWN_ACTIVITY_LIMIT; i++) {
      rec = townActivityClaim(rec, { day: "1", actorId: "a", activity: "harvest" }).record;
    }
    assert.equal(townActivityClaim(rec, { day: "1", actorId: "b", activity: "harvest" }).ok, true);
  });

  test("a new day resets the allowance", () => {
    let rec = {};
    for (let i = 0; i < TOWN_ACTIVITY_LIMIT; i++) {
      rec = townActivityClaim(rec, { day: "1", actorId: "a", activity: "harvest" }).record;
    }
    assert.equal(townActivityClaim(rec, { day: "2", actorId: "a", activity: "harvest" }).ok, true);
  });

  test("Tend Wounds is the exception: 4h sleep, once a day", () => {
    const first = townActivityClaim({}, { day: "1", actorId: "a", activity: "tendWounds" });
    assert.equal(first.ok, true);
    assert.equal(first.hours, 4, "it still costs four hours' sleep");
    assert.equal(townActivityClaim(first.record, { day: "1", actorId: "a", activity: "tendWounds" }).ok, false);
  });

  test("Tend Wounds does NOT eat one of the four no-sleep activities", () => {
    const tended = townActivityClaim({}, { day: "1", actorId: "a", activity: "tendWounds" });
    assert.equal(townActivitiesRemaining(tended.record, "1", "a"), TOWN_ACTIVITY_LIMIT,
      "the four are explicitly the activities you take WITHOUT sleeping");
  });
});

/* -------------------------------------------------------------------------- */
/*  7. Harvest — R:652                                                         */
/* -------------------------------------------------------------------------- */

describe("harvestFormula — ACCEPTANCE: dice by each of the six sizes", () => {
  test("tiny, small and medium all yield 1d6", () => {
    assert.equal(harvestFormula("tiny"), "1d6");
    assert.equal(harvestFormula("small"), "1d6");
    assert.equal(harvestFormula("medium"), "1d6");
  });

  test("large 2d6, huge 3d6, Holy Shit! 4d6", () => {
    assert.equal(harvestFormula("large"), "2d6");
    assert.equal(harvestFormula("huge"), "3d6");
    assert.equal(harvestFormula("holyShit"), "4d6");
  });

  test("every size in CROWS.sizes has a formula and none is invented here", () => {
    for (const size of CROWS.sizes) {
      assert.equal(harvestFormula(size), CROWS.harvestDice[size], `${size} must come from config`);
    }
  });

  test("an unknown size returns null rather than guessing 1d6", () => {
    assert.equal(harvestFormula("gargantuan"), null);
    assert.equal(harvestFormula(""), null);
    assert.equal(harvestFormula(undefined), null);
  });
});

/* -------------------------------------------------------------------------- */
/*  8. Blocking and Prepare for Task                                           */
/* -------------------------------------------------------------------------- */

describe("restBlockedReason — R:460", () => {
  test("a magic slot overload blocks the rest entirely", () => {
    const r = restBlockedReason({ magicOverload: true });
    assert.ok(r);
    assert.match(r, /cannot rest/i);
  });

  test("no overload, no block", () => {
    assert.equal(restBlockedReason({ magicOverload: false }), null);
    assert.equal(restBlockedReason({}), null);
  });
});

describe("preparedTaskMatches — R:658 binds to a TASK, not a skill", () => {
  test("the bonus is +2 in Playtest 2", () => {
    assert.equal(PREPARE_FOR_TASK_BONUS, 2);
  });

  test("matches the task string, trimmed and case-insensitively", () => {
    assert.equal(preparedTaskMatches("Pick the abbot's lock", "pick the abbot's LOCK  "), true);
  });

  test("a different task does not match", () => {
    assert.equal(preparedTaskMatches("Pick the abbot's lock", "Pick the cellar lock"), false);
  });

  test("an empty preparation never matches — not even another empty string", () => {
    assert.equal(preparedTaskMatches("", ""), false);
    assert.equal(preparedTaskMatches(undefined, ""), false);
  });
});

/* -------------------------------------------------------------------------- */
/*  9. Encounters — R:622-624                                                  */
/* -------------------------------------------------------------------------- */

describe("encounterNumber — ACCEPTANCE: 9 -> 8 -> 7 across all four combinations", () => {
  test("neither crowded nor chaos: EN 9", () => {
    assert.equal(encounterNumber({ crowded: false, chaos: false }), 9);
    assert.equal(encounterNumber(), 9);
  });

  test("crowded only: EN 8", () => {
    assert.equal(encounterNumber({ crowded: true, chaos: false }), 8);
  });

  test("chaos only: EN 8", () => {
    assert.equal(encounterNumber({ crowded: false, chaos: true }), 8);
  });

  test("both: EN 7 — not 9 minus 1 minus 1 by coincidence", () => {
    assert.equal(encounterNumber({ crowded: true, chaos: true }), 7);
    assert.equal(encounterNumber({ crowded: true, chaos: true }), CROWS.encounter.bothEN);
  });

  test("every value comes from config, not from a literal", () => {
    assert.equal(encounterNumber(), CROWS.encounter.defaultEN);
    assert.equal(encounterNumber({ crowded: true }), CROWS.encounter.crowdedEN);
  });

  test("Seclude Camp takes exactly 1 off, from any of the three (R:672)", () => {
    assert.equal(encounterNumber({ secludeCamp: true }), 8);
    assert.equal(encounterNumber({ crowded: true, secludeCamp: true }), 7);
    assert.equal(encounterNumber({ crowded: true, chaos: true, secludeCamp: true }), 6);
  });

  test("the threshold can never drop below 2 — every 1d10 would trigger", () => {
    assert.ok(encounterNumber({ crowded: true, chaos: true, secludeCamp: true }) >= 2);
  });
});

describe("resolveEncounterCheck — 1d10 >= EN, and a 10 lands immediately", () => {
  test("below the EN, nothing happens", () => {
    const r = resolveEncounterCheck(8, 9);
    assert.equal(r.triggered, false);
    assert.equal(r.telegraph, false);
    assert.equal(r.immediate, false);
  });

  test("exactly the EN triggers — the boundary", () => {
    assert.equal(resolveEncounterCheck(9, 9).triggered, true);
  });

  test("ACCEPTANCE: a rolled 10 lands immediately", () => {
    const r = resolveEncounterCheck(10, 9);
    assert.equal(r.immediate, true);
    assert.equal(r.telegraph, false);
  });

  test("a triggering 9 or lower telegraphs instead of landing", () => {
    const r = resolveEncounterCheck(9, 9);
    assert.equal(r.immediate, false);
    assert.equal(r.telegraph, true, "the Ref signs it now; it lands next DT (R:624)");
  });

  test("a 10 is immediate at EN 7 too — immediacy is the FACE, not the margin", () => {
    assert.equal(resolveEncounterCheck(10, 7).immediate, true);
    assert.equal(resolveEncounterCheck(9, 7).immediate, false, "a 9 at EN 7 beats the EN by 2 and still only telegraphs");
    assert.equal(resolveEncounterCheck(9, 7).telegraph, true);
  });

  test("it is 1d10, not 1d6 — a 7, 8, 9 and 10 are all reachable results", () => {
    for (const face of [7, 8, 9, 10]) {
      assert.equal(resolveEncounterCheck(face, 7).triggered, true);
    }
  });

  test("triggered is exactly immediate-or-telegraph, never both, never neither", () => {
    for (let face = 1; face <= 10; face++) {
      for (const en of [7, 8, 9]) {
        const r = resolveEncounterCheck(face, en);
        assert.equal(r.triggered, r.immediate || r.telegraph);
        assert.equal(r.immediate && r.telegraph, false);
      }
    }
  });
});

describe("end-of-DT condition expiry — boned is gone", () => {
  test("blessed, vulnerable and weakened end at end-of-DT", () => {
    assert.deepEqual(DT_EXPIRING_CONDITIONS, ["blessed", "vulnerable", "weakened"]);
  });

  test("`boned` is not in the expiry list and has no PT2 equivalent", () => {
    assert.ok(!DT_EXPIRING_CONDITIONS.includes("boned"));
    assert.ok(!CROWS.conditions.includes("boned"));
  });

  test("only set conditions are written", () => {
    const u = conditionExpiryUpdate({ blessed: true, weakened: false, prone: true });
    assert.deepEqual(u, { "system.conditions.blessed": false });
  });

  test("conditions that do NOT expire at end-of-DT are left alone", () => {
    const u = conditionExpiryUpdate({ prone: true, grabbed: true, unconscious: true });
    assert.equal(u, null, "prone/grabbed/unconscious do not tick down with the dungeon turn");
  });

  test("a clean creature produces null, not an all-false write to every actor", () => {
    assert.equal(conditionExpiryUpdate({}), null);
    assert.equal(conditionExpiryUpdate({ blessed: false, vulnerable: false, weakened: false }), null);
  });
});

describe("DT length is configurable — R:616", () => {
  test("30 default, 60 relaxed, 20 intense", () => {
    assert.equal(DT_LENGTHS.standard.minutes, 30);
    assert.equal(DT_LENGTHS.relaxed.minutes, 60);
    assert.equal(DT_LENGTHS.intense.minutes, 20);
  });

  test("the 1d6-rooms mode has no minute count and does not fake one", () => {
    assert.equal(DT_LENGTHS.rooms.minutes, null);
    assert.equal(DT_LENGTHS.rooms.rooms, "1d6");
  });
});

describe("resolveUsageDicePool — the DT clock rolls ALL the dice", () => {
  test("every die showing 1 or 2 is removed, in one roll of the whole pool", () => {
    const r = resolveUsageDicePool([1, 2, 3, 6]);
    assert.equal(r.removed, 2);
    assert.equal(r.remaining, 2);
    assert.equal(r.depleted, false);
  });

  test("a pool can lose more than one die per dungeon turn", () => {
    assert.equal(resolveUsageDicePool([1, 1, 2]).removed, 3,
      "rolling one d6 for a 3-UD effect would decay it at a third of the published rate");
  });

  test("3, 4, 5 and 6 all survive", () => {
    assert.equal(resolveUsageDicePool([3, 4, 5, 6]).removed, 0);
  });

  test("at zero dice the effect ends", () => {
    assert.equal(resolveUsageDicePool([2]).depleted, true);
    assert.equal(resolveUsageDicePool([]).depleted, true);
  });
});

describe("effectUsageDice — the backlash UD seam", () => {
  test("reads the pool off the effect flag", () => {
    assert.equal(effectUsageDice({ flags: { crows: { backlash: {
      sourceRange: "83-84",
      duration: { kind: "ud", current: 2 }
    } } } }), 2);
  });

  test("an effect with no pool is skipped, not treated as a 1-die pool", () => {
    assert.equal(effectUsageDice({ flags: {} }), 0);
    assert.equal(effectUsageDice(undefined), 0);
    assert.equal(effectUsageDice({ flags: { crows: { backlash: {
      sourceRange: "83-84",
      duration: { kind: "ud", current: 0 }
    } } } }), 0);
    assert.equal(effectUsageDice({ flags: { crows: { ud: { current: 2, max: 2 } } } }), 0,
      "the deleted prototype flag must not remain a second authority");
    assert.equal(effectUsageDice({ flags: { crows: { backlash: {
      sourceRange: "05-06",
      duration: { kind: "dt", current: 2 }
    } } } }), 0, "D4 handles UD durations only");
  });
});

/* -------------------------------------------------------------------------- */
/*  10. Greed bonus — R:590                                                    */
/* -------------------------------------------------------------------------- */

describe("greedMultiplierForDT", () => {
  test("+30% / +20% / +10% on DTs 1, 2 and 3", () => {
    assert.equal(greedMultiplierForDT(1), 0.30);
    assert.equal(greedMultiplierForDT(2), 0.20);
    assert.equal(greedMultiplierForDT(3), 0.10);
  });

  test("DT 4 and beyond are worth face value", () => {
    assert.equal(greedMultiplierForDT(4), 0);
    assert.equal(greedMultiplierForDT(99), 0);
    assert.equal(greedMultiplierForDT(0), 0);
  });
});

describe("greed bonus — ACCEPTANCE: once per dungeon id, then never again", () => {
  test("the whole first entry pays out, then the dungeon is spent forever", () => {
    let rec = {};

    // First entry.
    const opened = beginDungeonEntry(rec, "crypt-of-ash");
    rec = opened.record;
    assert.equal(opened.firstEntry, true);
    assert.equal(greedState(rec, "crypt-of-ash"), GREED_ACTIVE);

    // All three greed DTs of that one entry pay — this is the part a naive
    // "claimed" boolean gets wrong by denying DTs 2 and 3.
    assert.equal(greedAward(rec, "crypt-of-ash", 1, 100).bonus, 30);
    assert.equal(greedAward(rec, "crypt-of-ash", 2, 100).bonus, 20);
    assert.equal(greedAward(rec, "crypt-of-ash", 3, 100).bonus, 10);
    assert.equal(greedAward(rec, "crypt-of-ash", 4, 100).applied, false);

    // Leave.
    rec = endDungeonEntry(rec, "crypt-of-ash").record;
    assert.equal(greedState(rec, "crypt-of-ash"), GREED_SPENT);

    // ACCEPTANCE: never again, for this dungeon id.
    const reopened = beginDungeonEntry(rec, "crypt-of-ash");
    rec = reopened.record;
    assert.equal(reopened.firstEntry, false);
    const second = greedAward(rec, "crypt-of-ash", 1, 100);
    assert.equal(second.applied, false);
    assert.equal(second.bonus, 0);
    assert.equal(second.total, 100);
    assert.match(second.reason, /already spent/i);
  });

  test("a different dungeon is unaffected — the claim is keyed by id", () => {
    let rec = beginDungeonEntry({}, "crypt-of-ash").record;
    rec = endDungeonEntry(rec, "crypt-of-ash").record;
    rec = beginDungeonEntry(rec, "sunken-mill").record;
    assert.equal(greedAward(rec, "sunken-mill", 1, 100).bonus, 30);
  });

  test("the claim survives a party wipe — it is world state, not actor state", () => {
    // R:600 is explicit that "per group of players" means the people, so there
    // is nothing on an actor for a fresh crow to reset. The record is the proof:
    // nothing in it is keyed by an actor.
    let rec = beginDungeonEntry({}, "crypt-of-ash").record;
    rec = endDungeonEntry(rec, "crypt-of-ash").record;
    assert.deepEqual(Object.keys(rec), ["crypt-of-ash"]);
    assert.equal(greedAward(rec, "crypt-of-ash", 1, 500).applied, false);
  });

  test("no bonus before the entry is opened", () => {
    const r = greedAward({}, "crypt-of-ash", 1, 100);
    assert.equal(r.applied, false);
    assert.match(r.reason, /not open/i);
    assert.equal(greedState({}, "crypt-of-ash"), GREED_UNENTERED);
  });

  test("re-opening an active entry does not spend it", () => {
    let rec = beginDungeonEntry({}, "crypt-of-ash").record;
    rec = beginDungeonEntry(rec, "crypt-of-ash").record;
    assert.equal(greedAward(rec, "crypt-of-ash", 1, 100).bonus, 30);
  });

  test("a blank dungeon id is not a shared key — it is refused", () => {
    assert.equal(dungeonKey("  "), null);
    assert.equal(dungeonKey(undefined), null);
    const opened = beginDungeonEntry({}, "");
    assert.equal(opened.firstEntry, false);
    assert.deepEqual(opened.record, {}, "an unnamed dungeon must not burn every other dungeon's bonus");
  });

  test("the bonus is rounded so that total - value === bonus exactly", () => {
    const rec = beginDungeonEntry({}, "d").record;
    for (const value of [1, 7, 33, 101, 999]) {
      for (const dt of [1, 2, 3]) {
        const a = greedAward(rec, "d", dt, value);
        assert.equal(a.total - a.value, a.bonus, `${value} gc on DT ${dt} must add up`);
        assert.ok(Number.isInteger(a.bonus));
      }
    }
  });
});
