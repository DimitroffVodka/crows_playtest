import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  chaosRollDecision, chaosRollTriggersBacklash, effectiveBacklashRank,
  isChaosSuppressed, masteredDisciplinesFor,
  CHAOS_BACKLASH_FACE, MASTERY_RANK_REDUCTION
} from "../module/helpers/chaos.mjs";
import {
  BACKLASH_TABLE, BACKLASH_MIN, BACKLASH_MAX, lookupBacklash, backlashTargets,
  shouldRerollBacklash, backlashStacks, hasDuration, backlashUsageDice,
  isConditionOnlyBacklash
} from "../module/helpers/backlash.mjs";
import {
  planCastingOutcome, applyChaosRoll, summonBehaviour, migrateSpellbookSystem,
  parseDuration, resolveCastContext, _parkCast, _clearPendingCasts
} from "../module/helpers/spellcasting.mjs";
import { CROWS } from "../module/config.mjs";

/**
 * T1.8 — spellcasting, the chaos roll and backlashes.
 *
 * Everything under test is pure: the 1d6 and the d100 are supplied by the
 * test, not mocked. The Foundry-touching orchestration (castSpell, the commit
 * subscriber, the chat cards) is a thin executor over `planCastingOutcome`,
 * which is where every rule actually lives.
 */

const MASTERY = (tree) => ({ type: "trait", name: `${tree[0].toUpperCase()}${tree.slice(1)} Mastery`, system: { tree } });

/** A committed casting result, shaped like the contract's TestResult. */
const committed = (over = {}) => ({
  kind: "casting", state: "committed", commitReason: "no-legal-spend",
  tier: 1, doom: false, crit: false, ...over
});

/* ========================================================================== */
/*  R:1563 — the two routes to a backlash are INDEPENDENT                     */
/* ========================================================================== */

describe("backlash routes (R:1563)", () => {
  test("a doom goes straight to backlash and rolls NO chaos die", () => {
    const plan = planCastingOutcome({ ...committed({ doom: true }), rank: 3, discipline: "elemental" });
    assert.equal(plan.backlash.trigger, true);
    assert.equal(plan.backlash.cause, "doom on a casting");
    assert.equal(plan.chaos.roll, false, "a doom must not also roll chaos");
  });

  test("a doom still costs the spellbook's UD roll (R:1559)", () => {
    const plan = planCastingOutcome({ ...committed({ doom: true }), rank: 0, discipline: "illusion" });
    assert.equal(plan.udRoll, true);
  });

  test("a doom narrates no tier effect — the backlash replaces the spell", () => {
    const plan = planCastingOutcome({ ...committed({ doom: true }), rank: 1, discipline: "illusion" });
    assert.equal(plan.effectBand, null);
  });

  test("a committed tier 1 non-doom rolls the chaos die", () => {
    const plan = planCastingOutcome({ ...committed(), rank: 2, discipline: "elemental" });
    assert.equal(plan.chaos.roll, true);
    assert.equal(plan.chaos.die, "1d6");
    assert.equal(plan.backlash, null, "no backlash until the die is rolled");
  });

  test("only a 1 on the chaos die triggers a backlash (R:1567)", () => {
    const ctx = { rank: 2, discipline: "elemental", masteredDisciplines: [] };
    const plan = planCastingOutcome({ ...committed(), ...ctx });
    for (let face = 1; face <= 6; face++) {
      const rolled = applyChaosRoll(plan, face, ctx);
      assert.equal(!!rolled.backlash, face === CHAOS_BACKLASH_FACE, `face ${face}`);
    }
  });

  test("tier 2 and tier 3 never roll a chaos die", () => {
    for (const tier of [2, 3]) {
      const plan = planCastingOutcome({ ...committed({ tier }), rank: 0, discipline: "elemental" });
      assert.equal(plan.chaos.roll, false, `tier ${tier}`);
      assert.equal(plan.backlash, null);
      assert.equal(plan.effectBand, `t${tier}`);
    }
  });
});

/* ========================================================================== */
/*  THE COMMIT POINT — R:921 + R:292                                          */
/* ========================================================================== */

describe("chaos roll timing — the COMMITTED tier only", () => {
  test("nothing fires while the test is still pending", () => {
    const plan = planCastingOutcome({ tier: 1, doom: false, state: "pending", rank: 1, discipline: "elemental" });
    assert.equal(plan.ok, false);
    assert.equal(plan.chaos.roll, false);
    assert.equal(plan.udRoll, false, "the UD must not burn on a pending test either");
    assert.equal(plan.backlash, null);
  });

  test("a tier 1 raised to tier 2 by an expertise spend gets NO chaos roll", () => {
    // This is the whole reason the outcome hangs off `crowsTestCommitted`: the
    // phase-1 result was a tier 1, and reading THAT would roll chaos here.
    const plan = planCastingOutcome({
      kind: "casting", state: "committed", commitReason: "spent",
      tier: 2, doom: false, crit: false, expertiseSpent: "elemental",
      rank: 2, discipline: "elemental"
    });
    assert.equal(plan.chaos.roll, false);
    assert.equal(plan.chaos.reason, "tier 2 result");
  });

  test("a DECLINED spend still commits at tier 1 and does roll chaos", () => {
    const plan = planCastingOutcome({
      kind: "casting", state: "committed", commitReason: "declined",
      tier: 1, doom: false, crit: false, rank: 2, discipline: "elemental"
    });
    assert.equal(plan.chaos.roll, true);
  });

  test("the raw decision helper refuses any non-committed state", () => {
    for (const state of ["pending", undefined, "", "rolled"]) {
      const d = chaosRollDecision({ tier: 1, doom: false, state, rank: 0, discipline: "elemental" });
      assert.equal(d.roll, false, `state ${state}`);
    }
  });
});

/* ========================================================================== */
/*  R:1545 — the crit                                                         */
/* ========================================================================== */

describe("crit (R:1545)", () => {
  test("a crit skips the UD roll entirely", () => {
    const plan = planCastingOutcome({ ...committed({ tier: 3, crit: true }), rank: 5, discipline: "necromancy" });
    assert.equal(plan.udRoll, false);
  });

  test("every non-crit casting rolls the UD (R:1543)", () => {
    for (const over of [{ tier: 1 }, { tier: 2 }, { tier: 3 }, { tier: 1, doom: true }]) {
      const plan = planCastingOutcome({ ...committed(over), rank: 1, discipline: "necromancy" });
      assert.equal(plan.udRoll, true, JSON.stringify(over));
    }
  });
});

/* ========================================================================== */
/*  H1 — Discipline Mastery suppression                                       */
/* ========================================================================== */

describe("Discipline Mastery suppression (H1, C:765 et al.)", () => {
  const mastered = ["elemental"];

  test("rank 0 and rank 1 of the mastered discipline skip the chaos roll", () => {
    for (const rank of [0, 1]) {
      const plan = planCastingOutcome({ ...committed(), rank, discipline: "elemental", masteredDisciplines: mastered });
      assert.equal(plan.chaos.roll, false, `rank ${rank}`);
      assert.match(plan.chaos.reason, /mastery/i);
    }
  });

  test("rank 2 of the mastered discipline still rolls chaos", () => {
    const plan = planCastingOutcome({ ...committed(), rank: 2, discipline: "elemental", masteredDisciplines: mastered });
    assert.equal(plan.chaos.roll, true);
  });

  test("a different discipline at rank 0 is not suppressed", () => {
    const plan = planCastingOutcome({ ...committed(), rank: 0, discipline: "illusion", masteredDisciplines: mastered });
    assert.equal(plan.chaos.roll, true);
  });

  test("suppression never applies without the mastery", () => {
    assert.equal(isChaosSuppressed({ discipline: "elemental", rank: 0, masteredDisciplines: [] }), false);
  });

  test("rank 2+ of the mastered discipline is treated as 2 ranks lower on the table", () => {
    assert.equal(effectiveBacklashRank(5, { discipline: "elemental", masteredDisciplines: mastered }), 5 - MASTERY_RANK_REDUCTION);
    assert.equal(effectiveBacklashRank(2, { discipline: "elemental", masteredDisciplines: mastered }), 0);
  });

  test("the reduction never goes below 0, and never applies to rank 0-1", () => {
    assert.equal(effectiveBacklashRank(1, { discipline: "elemental", masteredDisciplines: mastered }), 1);
    assert.equal(effectiveBacklashRank(0, { discipline: "elemental", masteredDisciplines: mastered }), 0);
  });

  test("the reduction applies on the DOOM route too — the trait says 'when they trigger a backlash'", () => {
    const plan = planCastingOutcome({
      ...committed({ doom: true }), rank: 4, discipline: "elemental", masteredDisciplines: mastered
    });
    assert.equal(plan.backlash.rank, 2);
  });

  test("the reduction applies on the CHAOS route too", () => {
    const ctx = { rank: 4, discipline: "elemental", masteredDisciplines: mastered };
    const plan = applyChaosRoll(planCastingOutcome({ ...committed(), ...ctx }), 1, ctx);
    assert.equal(plan.backlash.rank, 2);
  });
});

describe("Mastery detection reads the trait's TREE, not its body text (H2)", () => {
  test("all six masteries resolve from their own tree", () => {
    const actor = { items: CROWS.disciplines.map(MASTERY) };
    assert.deepEqual(masteredDisciplinesFor(actor), CROWS.disciplines);
  });

  test("Elemental Mastery grants ELEMENTAL, despite MCDM's body text saying conjuration", () => {
    // C:1173 is a copy-paste error unfixed since Playtest 1 — read literally
    // the trait gives an elementalist nothing. See H2.
    const actor = { items: [{
      type: "trait", name: "Elemental Mastery",
      system: { tree: "elemental",
        description: "<p>Non-doom tier 1 results of rank 0 and 1 conjuration spells you cast don't add to the chaos count.</p>" }
    }] };
    assert.deepEqual(masteredDisciplinesFor(actor), ["elemental"]);
  });

  test("non-mastery traits and non-trait items are ignored", () => {
    const actor = { items: [
      { type: "trait", name: "Hurl the Storm", system: { tree: "elemental" } },
      { type: "gear", name: "Illusion Mastery", system: { tree: "illusion" } },
      { type: "trait", name: "Alchemy Mastery", system: { tree: "alchemy" } }   // not a discipline
    ] };
    assert.deepEqual(masteredDisciplinesFor(actor), []);
  });

  test("an actor with no items is not a crash", () => {
    assert.deepEqual(masteredDisciplinesFor(undefined), []);
    assert.deepEqual(masteredDisciplinesFor({}), []);
  });
});

/* ========================================================================== */
/*  The backlash table — R:1573-1659                                          */
/* ========================================================================== */

describe("backlash table", () => {
  test("every value from 1 to 105 resolves to exactly one row", () => {
    for (let total = BACKLASH_MIN; total <= BACKLASH_MAX; total++) {
      const hits = BACKLASH_TABLE.filter(r => total >= r.lo && total <= r.hi);
      assert.equal(hits.length, 1, `d100+rank ${total} matched ${hits.length} rows`);
    }
  });

  test("the table covers 1-105 with no gap and no overlap, and nothing beyond", () => {
    const sorted = [...BACKLASH_TABLE].sort((a, b) => a.lo - b.lo);
    assert.equal(sorted[0].lo, BACKLASH_MIN);
    assert.equal(sorted.at(-1).hi, BACKLASH_MAX);
    for (let i = 1; i < sorted.length; i++) {
      assert.equal(sorted[i].lo, sorted[i - 1].hi + 1, `gap/overlap before ${sorted[i].sourceRange}`);
    }
  });

  test("every row has text", () => {
    for (const row of BACKLASH_TABLE) {
      assert.ok(row.text.length > 20, `${row.sourceRange} has no usable text`);
    }
  });

  test("d100 + rank clamps at the top: 105 is the last row, and beyond it stays there", () => {
    assert.equal(lookupBacklash(105).row.sourceRange, "105");
    const over = lookupBacklash(110);
    assert.equal(over.row.sourceRange, "105");
    assert.equal(over.clamped, true);
    assert.equal(over.total, 105);
  });

  test("a total below the table clamps to the first row", () => {
    const under = lookupBacklash(0);
    assert.equal(under.row.sourceRange, "01-02");
    assert.equal(under.clamped, true);
  });

  test("the maximum legal roll is exactly the last row: d100 100 + rank 5", () => {
    assert.equal(lookupBacklash(100 + 5).row.sourceRange, "105");
    assert.equal(lookupBacklash(100 + 5).clamped, false);
  });

  test("ERRATA: the printed '62-64' row is read as 63-64, and 62 stays with '61-62'", () => {
    assert.equal(lookupBacklash(62).row.sourceRange, "61-62");
    const quicksand = lookupBacklash(63).row;
    assert.equal(quicksand.sourceRange, "62-64", "the source text must be preserved verbatim");
    assert.equal(quicksand.lo, 63);
    assert.match(quicksand.sourceNote, /overlaps/i);
    assert.equal(lookupBacklash(64).row.sourceRange, "62-64");
  });

  test("ERRATA: the 'Might RR' row is transcribed as printed and flagged, not corrected", () => {
    const bees = lookupBacklash(51).row;
    assert.match(bees.text, /Might RR/, "the source text must not be silently corrected");
    assert.match(bees.sourceNote, /Strength/);
  });
});

describe("backlash duration handling (R:1561)", () => {
  test("a duplicate durational backlash re-rolls", () => {
    // The donkey head: 1 UD, and its text says nothing about getting worse if
    // you already have it — so R:1561's re-roll applies.
    const donkey = BACKLASH_TABLE.find(r => r.sourceRange === "01-02");
    assert.equal(hasDuration(donkey), true);
    assert.equal(backlashStacks(donkey), false);
    assert.equal(shouldRerollBacklash(donkey, []).reroll, false, "not already active — no re-roll");
    assert.equal(shouldRerollBacklash(donkey, ["01-02"]).reroll, true);
  });

  test("...unless its effects stack", () => {
    // Both of these say what happens "if you are already suffering this
    // backlash", which is the rule's own definition of stacking. The sticky
    // goo reads like a plain durational effect until that last sentence.
    for (const range of ["11-12", "37-38"]) {
      const row = BACKLASH_TABLE.find(r => r.sourceRange === range);
      assert.equal(hasDuration(row), true, `${range} lasts`);
      assert.equal(backlashStacks(row), true, `${range} says the effect worsens if already suffered`);
      assert.equal(shouldRerollBacklash(row, [range]).reroll, false, range);
      assert.equal(shouldRerollBacklash(row, [range]).reason, "effects stack");
    }
  });

  test("...and conditions are excluded by the rule itself", () => {
    const weakened = BACKLASH_TABLE.find(r => r.sourceRange === "13-14");
    assert.equal(isConditionOnlyBacklash(weakened), true);
    assert.equal(shouldRerollBacklash(weakened, ["13-14"]).reroll, false);
  });

  test("an instantaneous backlash never re-rolls", () => {
    const negativeEnergy = BACKLASH_TABLE.find(r => r.sourceRange === "27-28");
    assert.equal(hasDuration(negativeEnergy), false);
    assert.equal(shouldRerollBacklash(negativeEnergy, ["27-28"]).reroll, false);
  });

  test("UD-carrying backlashes report their count for the end-of-DT clock", () => {
    assert.equal(backlashUsageDice(BACKLASH_TABLE.find(r => r.sourceRange === "01-02")), 1);
    assert.equal(backlashUsageDice(BACKLASH_TABLE.find(r => r.sourceRange === "83-84")), 2);
    assert.equal(backlashUsageDice(BACKLASH_TABLE.find(r => r.sourceRange === "27-28")), 0);
  });
});

describe("backlash targeting (R:1561)", () => {
  test("a creature-targeting spell keeps its targets", () => {
    const t = backlashTargets({ spellTargetKind: "creature", casterId: "c1", spellTargetIds: ["t1", "t2"] });
    assert.deepEqual(t.targetIds, ["t1", "t2"]);
    assert.equal(t.redirectedToCaster, false);
  });

  test("an object-targeting spell makes the CASTER the target", () => {
    const t = backlashTargets({ spellTargetKind: "object", casterId: "c1", spellTargetIds: ["rock"] });
    assert.deepEqual(t.targetIds, ["c1"]);
    assert.equal(t.redirectedToCaster, true);
  });

  test("a spell with no target at all falls back to the caster", () => {
    assert.deepEqual(backlashTargets({ spellTargetKind: "creature", casterId: "c1" }).targetIds, ["c1"]);
  });
});

/* ========================================================================== */
/*  R:1553 — summons                                                          */
/* ========================================================================== */

describe("summoned creatures (R:1553)", () => {
  test("a Summoned target acts as a pet and never needs a command test", () => {
    const s = summonBehaviour({ target: "1 Summoned creature" });
    assert.deepEqual(s, { summons: true, actsAsPet: true, requiresCommandTest: false });
  });

  test("an ordinary spell summons nothing", () => {
    assert.equal(summonBehaviour({ target: "1 creature" }).summons, false);
    assert.equal(summonBehaviour({}).summons, false);
  });
});

/* ========================================================================== */
/*  Spellbook schema migration — layer (a)                                    */
/* ========================================================================== */

describe("spellbook migration (layer a — safe on partial deltas)", () => {
  test("castType becomes castingTime", () => {
    const out = migrateSpellbookSystem({ castType: "maneuver" });
    assert.equal(out.castingTime, "maneuver");
    assert.equal(out.castType, undefined);
  });

  test("castType 'attack' becomes an action that is flagged as an attack", () => {
    const out = migrateSpellbookSystem({ castType: "attack" });
    assert.equal(out.castingTime, "action");
    assert.equal(out.isAttack, true);
  });

  test("aoe becomes areaOfEffect", () => {
    const out = migrateSpellbookSystem({ aoe: { shape: "cube", size: "3" } });
    assert.deepEqual(out.areaOfEffect, { shape: "cube", size: "3" });
    assert.equal(out.aoe, undefined);
  });

  test("free-text durations become structured", () => {
    assert.deepEqual(parseDuration("1 UD"), { kind: "ud", count: 1, note: "" });
    assert.deepEqual(parseDuration("2 UD"), { kind: "ud", count: 2, note: "" });
    assert.deepEqual(parseDuration("End of DT"), { kind: "dt", count: 0, note: "" });
    assert.deepEqual(parseDuration("instant"), { kind: "instant", count: 0, note: "" });
  });

  test("an unparseable duration is kept for a human, not silently made lasting", () => {
    const d = parseDuration("until the sun sets");
    assert.equal(d.kind, "instant");
    assert.equal(d.note, "until the sun sets");
  });

  test("a partial delta with none of these keys is untouched", () => {
    const delta = { rank: 3 };
    assert.deepEqual(migrateSpellbookSystem(delta), { rank: 3 });
  });

  test("an already-migrated document is not re-migrated", () => {
    const out = migrateSpellbookSystem({ castingTime: "reaction", duration: { kind: "ud", count: 2, note: "" } });
    assert.equal(out.castingTime, "reaction");
    assert.deepEqual(out.duration, { kind: "ud", count: 2, note: "" });
  });
});

/* ========================================================================== */
/*  Which cast did this committed test belong to?                             */
/* ========================================================================== */

describe("cast context resolution — the rank a backlash rolls at", () => {
  const cast = (over = {}) => ({
    castId: "cast-A", actorId: "actor-1", spellbookId: "sb-1", spellbookName: "Firebolt",
    rank: 3, discipline: "elemental", masteredDisciplines: [], ...over
  });

  test("the castId on the committed result claims the parked cast", () => {
    _clearPendingCasts();
    const parked = _parkCast(cast());
    const found = resolveCastContext({ kind: "casting", actorId: "actor-1", casting: { castId: "cast-A" } });
    assert.equal(found, parked);
  });

  test("a result carrying the whole payload needs nothing parked at all", () => {
    _clearPendingCasts();
    const found = resolveCastContext({
      kind: "casting", actorId: "actor-1",
      casting: { castId: "cast-Z", rank: 5, discipline: "necromancy" }
    });
    assert.equal(found.rank, 5);
    assert.equal(found.discipline, "necromancy");
  });

  test("the persisted flags are read when the result was rebuilt", () => {
    _clearPendingCasts();
    const parked = _parkCast(cast());
    const found = resolveCastContext(
      { kind: "casting", actorId: "actor-1" },
      { flags: { crows: { test: { casting: { castId: "cast-A" } } } } }
    );
    assert.equal(found, parked);
  });

  test("a single unnamed cast in flight resolves unambiguously", () => {
    _clearPendingCasts();
    const parked = _parkCast(cast());
    assert.equal(resolveCastContext({ kind: "casting", actorId: "actor-1" }), parked);
  });

  test("TWO casts in flight and no castId REFUSES rather than guessing a rank", () => {
    // The rank is added to the d100 (R:1559). Picking the wrong one of two
    // parked casts rolls the backlash on the wrong row, silently.
    _clearPendingCasts();
    _parkCast(cast({ castId: "cast-A", rank: 0 }));
    _parkCast(cast({ castId: "cast-B", rank: 5 }));
    assert.equal(resolveCastContext({ kind: "casting", actorId: "actor-1" }), null);
  });

  test("another actor's parked cast is never claimed", () => {
    _clearPendingCasts();
    _parkCast(cast({ actorId: "actor-2" }));
    assert.equal(resolveCastContext({ kind: "casting", actorId: "actor-1" }), null);
  });

  test("nothing parked and nothing on the result resolves to null", () => {
    _clearPendingCasts();
    assert.equal(resolveCastContext({ kind: "casting", actorId: "actor-1" }), null);
  });
});

/* ========================================================================== */
/*  The accumulator is gone                                                   */
/* ========================================================================== */

describe("the Playtest 1 chaos accumulator is gone", () => {
  test("chaos.mjs exposes no counter, tally or ceiling", async () => {
    const chaos = await import("../module/helpers/chaos.mjs");
    const forbidden = Object.keys(chaos).filter(k => /count|total|tally|threshold|ceiling|setting/i.test(k));
    assert.deepEqual(forbidden, [], `chaos.mjs still exports ${forbidden.join(", ")}`);
  });

  test("the chaos roll is a stateless per-cast 1d6", () => {
    assert.equal(chaosRollTriggersBacklash(1), true);
    for (const face of [2, 3, 4, 5, 6]) assert.equal(chaosRollTriggersBacklash(face), false);
  });
});
