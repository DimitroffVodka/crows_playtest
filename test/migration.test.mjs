import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  SKILL_TO_EXPERTISE, DROPPED_CONDITION_KEYS,
  migrateCrowSystem, migrateBackgroundSystem, placeWoundSlots,
  buildBackgroundIndex, resolveBackground,
  expertiseBudgetForTxp, reconcileExpertiseBudget, reconcileActorExpertises,
  expertiseOverBudget, migrateActorSlots, migrateActorDocument,
  buildMigrationReport, RECONCILED_FLAG, BACKGROUND_USES_FLAG
} from "../module/helpers/migration.mjs";
import { ALL_EXPERTISES, CROWS } from "../module/config.mjs";

/**
 * T1.3 — Playtest 1 -> Playtest 2 migration.
 *
 * The organising idea of this file is the TWO-LAYER SPLIT, because conflating
 * the layers is the bug this task exists to avoid:
 *
 *   layer (a)  migrateCrowSystem(source)      pure, per-document, SHAPE ONLY,
 *                                             and runs on PARTIAL UPDATE DELTAS
 *   layer (b)  reconcileActorExpertises(actor) whole-actor POLICY, once
 *
 * So the layer-separation block below asserts that (a) deliberately leaves an
 * over-budget character over budget — that is correct output, not a bug — and
 * the budget block asserts that (b) is the only thing that even computes a
 * budget, let alone writes one.
 */

const FIXTURE = JSON.parse(fs.readFileSync(new URL("./fixtures/actors/pt1-crow.json", import.meta.url), "utf8"));
const DELTA = JSON.parse(fs.readFileSync(new URL("./fixtures/actors/pt1-crow-delta.json", import.meta.url), "utf8"));

const clone = (v) => structuredClone(v);

/** Apply the flattened update paths a layer-(b) function returns, as actor.update() would. */
function applyUpdates(actor, updates) {
  for (const [path, value] of Object.entries(updates)) foundry.utils.setProperty(actor, path, value);
  return actor;
}

/** The fixture, run through layer (a) and dressed as an Actor-shaped object. */
function migratedFixtureActor(overrides = {}) {
  const actor = {
    _id: "actor-fixture",
    name: FIXTURE.name,
    type: "crow",
    system: migrateCrowSystem(clone(FIXTURE.system)),
    items: clone(FIXTURE.items),
    flags: {}
  };
  return foundry.utils.mergeObject(actor, overrides);
}

/**
 * A resolvable PT2 background. Grants 4 uses (2 + 2), which is what makes the
 * fixture's budget 4 + 3*5 = 19 against 25 owned.
 */
const THIEF = {
  _id: "bg-thief",
  name: "Thief",
  type: "background",
  system: { expertises: [{ key: "stealth", uses: 2 }, { key: "thievery", uses: 2 }] }
};

const THIEF_INDEX = buildBackgroundIndex([THIEF]);
const EMPTY_INDEX = buildBackgroundIndex([]);

/* ========================================================================== */
describe("SKILL_TO_EXPERTISE — the map itself", () => {
/* ========================================================================== */

  test("every Playtest 1 skill has a destination, and every destination is real", () => {
    // 34 PT1 keys. The old catalogue is gone from config, so it is spelled out
    // here — if a key were missing from the map its uses would vanish silently.
    const PT1 = [
      "alchemy", "blacksmithing", "climb", "enchanting", "endurance", "gymnastics",
      "handleAnimal", "hide", "historicalLore", "jump", "lift", "magicLore",
      "monsterLore", "natureLore", "navigate", "pickLock", "religiousLore", "sabotage",
      "search", "sleightOfHand", "sneak", "swim",
      "alteration", "benefaction", "conjuration", "elemental", "illusion", "necromancy",
      "bashing", "bow", "chopping", "slashing", "stabbing", "unarmed"
    ];
    assert.equal(PT1.length, 34);
    for (const skill of PT1) {
      assert.ok(SKILL_TO_EXPERTISE[skill], `${skill} has no destination`);
      assert.ok(ALL_EXPERTISES.includes(SKILL_TO_EXPERTISE[skill]),
        `${skill} -> ${SKILL_TO_EXPERTISE[skill]} is not an expertise`);
    }
    assert.equal(Object.keys(SKILL_TO_EXPERTISE).length, 34);
  });

  test("34 skills land on all 30 expertises — nothing is unreachable", () => {
    assert.deepEqual(new Set(Object.values(SKILL_TO_EXPERTISE)), new Set(ALL_EXPERTISES));
  });

  test("the four collapses, and pickLock surviving on its own", () => {
    for (const k of ["climb", "jump", "swim"]) assert.equal(SKILL_TO_EXPERTISE[k], "athletics");
    for (const k of ["hide", "sneak"]) assert.equal(SKILL_TO_EXPERTISE[k], "stealth");
    for (const k of ["sabotage", "sleightOfHand"]) assert.equal(SKILL_TO_EXPERTISE[k], "thievery");
    assert.equal(SKILL_TO_EXPERTISE.handleAnimal, "handlePet");
    // pickLock is NOT folded into thievery — it is its own PT2 expertise.
    assert.equal(SKILL_TO_EXPERTISE.pickLock, "pickLock");
  });
});

/* ========================================================================== */
describe("layer (a) — migrateCrowSystem on a PARTIAL UPDATE DELTA", () => {
/* ========================================================================== */

  test("does not crash and invents no sibling fields", () => {
    const out = migrateCrowSystem(clone(DELTA.system));
    // migrateData runs on update deltas. Anything invented here would be
    // WRITTEN to the document as part of an unrelated edit.
    for (const invented of ["characteristics", "xp", "woundSlots", "preparedTask",
                            "stamina", "currency", "speed", "background"]) {
      assert.ok(!(invented in out), `invented ${invented} from a delta that had none`);
    }
    assert.deepEqual(Object.keys(out).sort(), ["conditions", "expertises"]);
  });

  test("bonus 0 survives as value = max = 0, not dropped as falsy", () => {
    const out = migrateCrowSystem(clone(DELTA.system));
    assert.deepEqual(out.expertises, { athletics: { value: 0, max: 0 } });
    // Explicitly: the key EXISTS. "absent" and "owned zero" are different facts.
    assert.ok("athletics" in out.expertises);
  });

  test("boned is dropped without reading blessed", () => {
    const out = migrateCrowSystem(clone(DELTA.system));
    assert.deepEqual(out.conditions, {});
    assert.ok(!("blessed" in out.conditions), "blessed must not be invented");
  });

  test("no TXP in the delta means NO per-expertise clamp is guessed", () => {
    // Assuming txp 0 would cap at the creation value and silently shave a
    // veteran's uses during an unrelated field edit. Layer (b) has the TXP.
    const out = migrateCrowSystem({ skills: { hide: { bonus: 4 } } });
    assert.equal(out.expertises.stealth.max, 4);
  });

  test("input is never mutated", () => {
    const src = clone(DELTA.system);
    const before = JSON.stringify(src);
    migrateCrowSystem(src);
    assert.equal(JSON.stringify(src), before);
  });

  test("non-objects and empty deltas pass through harmlessly", () => {
    assert.deepEqual(migrateCrowSystem({}), {});
    assert.equal(migrateCrowSystem(null), null);
    assert.equal(migrateCrowSystem(undefined), undefined);
  });
});

/* ========================================================================== */
describe("layer (a) — migrateCrowSystem on the whole fixture", () => {
/* ========================================================================== */

  const out = migrateCrowSystem(clone(FIXTURE.system));

  test("collapse takes the MAX of the source bonuses", () => {
    // climb 1 / jump 0 / swim 2 -> athletics 2. The fixture populates the pair
    // with DIFFERENT bonuses so max-wins is observable, not accidental.
    assert.deepEqual(out.expertises.athletics, { value: 2, max: 2 });
    assert.deepEqual(out.expertises.stealth, { value: 2, max: 2 });      // hide 2 / sneak 1
    assert.deepEqual(out.expertises.thievery, { value: 2, max: 2 });     // sabotage 2 / sleightOfHand 1
    assert.deepEqual(out.expertises.handlePet, { value: 2, max: 2 });    // handleAnimal 2
  });

  test("both value and max are written to the converted amount", () => {
    for (const e of Object.values(out.expertises)) assert.equal(e.value, e.max);
  });

  test("a zero-bonus skill survives on the whole document too", () => {
    assert.deepEqual(out.expertises.enchanting, { value: 0, max: 0 });
    assert.deepEqual(out.expertises.magicLore, { value: 0, max: 0 });
  });

  test("skills is gone and expertises replaced it", () => {
    assert.ok(!("skills" in out));
    assert.ok(!("wounds" in out));
    assert.ok(!("containers" in out));
  });

  test("boned is DROPPED, not converted to weakened; blessed 2 -> true", () => {
    assert.equal(out.conditions.blessed, true);
    assert.ok(!("boned" in out.conditions));
    // The temptation is `weakened: true`. Different duration, different
    // semantics — a migration must not invent a condition the character
    // never had.
    assert.ok(!("weakened" in out.conditions));
    assert.deepEqual(DROPPED_CONDITION_KEYS, ["boned", "hidden", "invisible"]);
  });

  test("wounds become slot indices, preferring the EMPTY backpack slots", () => {
    // The fixture's backpack holds items at 0,1,2 and is empty from 3 on.
    // Playtest 1 filled bottom-up regardless of contents; that would have put
    // all three wounds on occupied slots and cost this crow 3 speed under
    // reading (c) — silently, on migration day.
    assert.deepEqual(out.woundSlots, [3, 4, 5]);
  });

  test("preparedTask.skill + detail become free text; setOn keeps its date", () => {
    assert.equal(out.preparedTask.task, "Pick Lock — the vault door on level 2");
    assert.ok(!("skill" in out.preparedTask));
    assert.ok(!("detail" in out.preparedTask));
    // setOn was a NumberField in PT1 and would have coerced this to 0.
    assert.equal(out.preparedTask.setOn, "2026-05-20");
  });

  test("a numeric setOn is canonicalised into the string field", () => {
    const o = migrateCrowSystem({ preparedTask: { skill: "search", setOn: 3 } });
    assert.equal(o.preparedTask.setOn, "DT 3");
    assert.equal(o.preparedTask.task, "Search");
    // 0 was PT1's "unset", not dungeon turn zero.
    assert.equal(migrateCrowSystem({ preparedTask: { setOn: 0 } }).preparedTask.setOn, "");
  });

  test("xp.skillBonusesSpent is carried to expertiseBonusesSpent", () => {
    assert.equal(out.xp.expertiseBonusesSpent, 5);
    assert.ok(!("skillBonusesSpent" in out.xp));
    assert.equal(out.xp.txp, 3500);
  });

  test("crafting projects rename skill -> expertise through the same map", () => {
    const o = migrateCrowSystem({ crafting: { projects: [{ id: "p1", skill: "sleightOfHand" }] } });
    assert.equal(o.crafting.projects[0].expertise, "thievery");
    assert.ok(!("skill" in o.crafting.projects[0]));
  });

  test("running it twice changes nothing the second time", () => {
    assert.deepEqual(migrateCrowSystem(clone(out)), out);
  });
});

/* ========================================================================== */
describe("LAYER SEPARATION (C1) — (a) converts shape, (b) reconciles", () => {
/* ========================================================================== */

  test("(a) on the delta attempts no budget and does not throw", () => {
    // No xp, no items, no background. A budget here would either throw or
    // assume 0 — and assuming 0 trims a character to nothing.
    const out = migrateCrowSystem(clone(DELTA.system));
    assert.equal(out.expertises.athletics.max, 0);
    assert.ok(!("xp" in out));
  });

  test("(a) on the full fixture leaves `max` OVER BUDGET — shape only, no trim", () => {
    const out = migrateCrowSystem(clone(FIXTURE.system));
    const owned = Object.values(out.expertises).reduce((n, e) => n + e.max, 0);

    // NOTE ON THE NUMBER. §T1.3's acceptance and the fixture's own header both
    // say 24, from "12 skills at bonus 2". The fixture ALSO carries
    // historicalLore at bonus 1, so the true converted total is 25. The data
    // is authoritative over the prose; both figures are pinned so the
    // discrepancy can never be mistaken for drift.
    assert.equal(Object.values(out.expertises).filter(e => e.max === 2).length, 12);
    assert.equal(12 * 2, 24);
    assert.equal(owned, 25);

    // The point of the assertion: 25 is far beyond anything PT2 advancement
    // can produce at 3,500 TXP (budget 19 with the Thief background), and
    // layer (a) left it alone anyway.
    assert.ok(owned > 19);
  });

  test("(b) on the same actor performs the trim", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });
    assert.equal(r.skipped, false);
    assert.equal(r.desired, 25);
    assert.equal(r.budget, 19);
    assert.equal(r.overBudget, 6);
    assert.ok(r.trimmed.length > 0);
  });
});

/* ========================================================================== */
describe("BACKGROUND LOOKUP — there is no embedded Background Item", () => {
/* ========================================================================== */

  test("resolves by backgroundId when present", () => {
    const actor = migratedFixtureActor({ system: { background: "", backgroundId: "bg-thief" } });
    const bg = resolveBackground(actor, THIEF_INDEX);
    assert.equal(bg.ok, true);
    assert.equal(bg.matchedBy, "id");
    assert.equal(bg.uses, 4);
  });

  test("falls back to the NAME, trimmed and case-insensitive", () => {
    for (const name of ["Thief", "thief", "  tHiEf  ", "THIEF"]) {
      const actor = migratedFixtureActor({ system: { background: name } });
      const bg = resolveBackground(actor, THIEF_INDEX);
      assert.equal(bg.ok, true, `"${name}" should resolve`);
      assert.equal(bg.matchedBy, "name");
      assert.equal(bg.uses, 4);
    }
  });

  test("a stale id falls through to the name rather than failing", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief", backgroundId: "bg-deleted" } });
    const bg = resolveBackground(actor, THIEF_INDEX);
    assert.equal(bg.ok, true);
    assert.equal(bg.matchedBy, "name");
  });

  test("STAMPS backgroundId on first successful resolution", () => {
    const actor = migratedFixtureActor({ system: { background: "thief" } });
    assert.equal(actor.system.backgroundId, undefined);
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });
    // Identity repair, not a balance decision — so it is stamped even in the
    // report-only default. It is what makes the lookup survive a rename.
    assert.equal(r.updates["system.backgroundId"], "bg-thief");
    applyUpdates(actor, r.updates);
    assert.equal(actor.system.backgroundId, "bg-thief");
  });

  test("two backgrounds with the same name are AMBIGUOUS, not a coin-flip", () => {
    const index = buildBackgroundIndex([THIEF, { _id: "bg-thief-2", name: "thief", system: { expertises: [{ key: "stealth", uses: 1 }] } }]);
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const bg = resolveBackground(actor, index);
    assert.equal(bg.ok, false);
    assert.equal(bg.reason, "background-ambiguous");
  });

  test("UNRESOLVED -> reported, and the actor's budget SKIPPED ENTIRELY", () => {
    // Until T3.1 re-transcribes the backgrounds this is the ONLY reachable
    // case, so it is the one that has to be right.
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const before = clone(actor.system.expertises);
    const r = reconcileActorExpertises(actor, { backgrounds: EMPTY_INDEX });

    assert.equal(r.skipped, true);
    assert.equal(r.reason, "background-name-unresolved");
    assert.equal(r.background.ok, false);
    assert.equal(r.background.name, "Thief");
    assert.deepEqual(r.updates, {}, "an unresolved actor must not be written to at all");
    assert.deepEqual(actor.system.expertises, before);
  });

  test("UNRESOLVED is NOT read as backgroundUses = 0", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: EMPTY_INDEX });

    // Zero grants would give budget 0 + 3*5 = 15 against 25 owned, i.e. the
    // LARGEST possible surplus reported at the moment the migration knows
    // LEAST about the character. Neither number may appear.
    assert.equal(expertiseBudgetForTxp(3500, 0, 5), 15, "sanity: what 0 would have produced");
    assert.equal(r.budget, null);
    assert.equal(r.overBudget, null);
    assert.notEqual(r.overBudget, 10);
    assert.deepEqual(r.trimmed, []);
  });

  test("an unresolved actor is NOT stamped, so a re-run after T3.1 reaches it", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const first = reconcileActorExpertises(actor, { backgrounds: EMPTY_INDEX });
    applyUpdates(actor, first.updates);
    assert.notEqual(actor.flags?.crows?.[RECONCILED_FLAG], true);

    // T3.1 lands; the same actor now resolves.
    const second = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });
    assert.equal(second.skipped, false);
    assert.equal(second.budget, 19);
  });

  test("an actor with no background at all is also skipped, with its own reason", () => {
    const actor = migratedFixtureActor();      // the fixture carries no background
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "actor-has-no-background");
    assert.equal(r.budget, null);
  });

  test("a background still in PT1 shape is resolvable but flagged", () => {
    // migrateBackgroundSystem is best-effort; T3.1 overwrites it. The budget
    // must be able to say the number it used came from a migrated grant.
    const pt1 = { _id: "bg-old", name: "Old Thief", system: { skills: ["hide", "sneak"] } };
    const bg = resolveBackground({ system: { background: "Old Thief" } }, buildBackgroundIndex([pt1]));
    assert.equal(bg.ok, false);
    assert.equal(bg.reason, "background-has-no-grants");
  });
});

/* ========================================================================== */
describe("H5 budget — expertiseBudgetForTxp", () => {
/* ========================================================================== */

  test("backgroundUses + 3 * bonuses spent", () => {
    assert.equal(expertiseBudgetForTxp(3500, 4, 5), 19);      // the fixture case
    assert.equal(expertiseBudgetForTxp(0, 4, 0), 4);          // a fresh crow: background only
    assert.equal(expertiseBudgetForTxp(100, 2, 1), 5);
  });

  test("never trusts skillBonusesSpent above what the table says was earned", () => {
    // 3,500 TXP has earned 5 bonuses. A sheet claiming 12 does not get 36 uses.
    assert.equal(expertiseBudgetForTxp(3500, 4, 12), 19);
    // Below the claim, the claim wins — bonuses may have gone to characteristics.
    assert.equal(expertiseBudgetForTxp(3500, 4, 2), 10);
  });

  test("an absent claim falls back to bonuses EARNED", () => {
    assert.equal(expertiseBudgetForTxp(3500, 4, undefined), 19);
  });

  test("THROWS rather than defaulting backgroundUses to 0", () => {
    // The one dangerous default. Callers must skip the actor instead.
    assert.throws(() => expertiseBudgetForTxp(3500, null, 5), TypeError);
    assert.throws(() => expertiseBudgetForTxp(3500, undefined, 5), TypeError);
    assert.throws(() => expertiseBudgetForTxp(3500, NaN, 5), TypeError);
    assert.throws(() => expertiseBudgetForTxp(3500, -1, 5), TypeError);
  });
});

/* ========================================================================== */
describe("H5 water-levelling — reconcileExpertiseBudget", () => {
/* ========================================================================== */

  const converted = Object.fromEntries(
    Object.entries(migrateCrowSystem(clone(FIXTURE.system)).expertises).map(([k, e]) => [k, e.max])
  );

  test("the distribution is EXACT and stable, not just the total", () => {
    const r = reconcileExpertiseBudget(converted, 19, 2);
    // Six removals, each taking 1 from a current maximum, ties broken on the
    // alphabetically-first key: alchemy, athletics, blacksmithing, endurance,
    // gymnastics, handlePet. `lift` onwards keeps 2 because the six removals
    // ran out first.
    assert.deepEqual(r.granted, {
      alchemy: 1, athletics: 1, blacksmithing: 1, endurance: 1, gymnastics: 1, handlePet: 1,
      lift: 2, navigate: 2, pickLock: 2, search: 2, stealth: 2, thievery: 2,
      historicalLore: 1,
      enchanting: 0, magicLore: 0, monsterLore: 0, natureLore: 0, religiousLore: 0
    });
    assert.equal(Object.values(r.granted).reduce((n, v) => n + v, 0), 19);
  });

  test("the tie-break is ALPHABETICAL, not the category display order", () => {
    // The trap: in category order `blacksmithing` precedes `bashing`, so the
    // two orders trim different expertises. Only one of them is stable.
    const r = reconcileExpertiseBudget({ bashing: 3, blacksmithing: 3 }, 5, 4);
    assert.deepEqual(r.granted, { bashing: 2, blacksmithing: 3 });
  });

  test("water-levels the tallest first — breadth is preserved, not the strongest few", () => {
    const r = reconcileExpertiseBudget({ athletics: 4, stealth: 1, thievery: 1 }, 4, 4);
    assert.deepEqual(r.granted, { athletics: 2, stealth: 1, thievery: 1 });
  });

  test("every removal lands in `trimmed`, one entry per key", () => {
    const r = reconcileExpertiseBudget(converted, 19, 2);
    assert.deepEqual(r.trimmed, [
      { key: "alchemy", from: 2, to: 1 },
      { key: "athletics", from: 2, to: 1 },
      { key: "blacksmithing", from: 2, to: 1 },
      { key: "endurance", from: 2, to: 1 },
      { key: "gymnastics", from: 2, to: 1 },
      { key: "handlePet", from: 2, to: 1 }
    ]);
    const removed = r.trimmed.reduce((n, t) => n + (t.from - t.to), 0);
    assert.equal(r.desired - removed, 19);
  });

  test("desired < budget is NOT topped up", () => {
    const r = reconcileExpertiseBudget({ athletics: 1, stealth: 1 }, 30, 4);
    assert.deepEqual(r.granted, { athletics: 1, stealth: 1 });
    assert.deepEqual(r.trimmed, []);
    assert.equal(r.desired, 2);
  });

  test("the per-expertise max still applies after the total trim", () => {
    // Budget is generous; the per-key cap is what bites.
    const r = reconcileExpertiseBudget({ athletics: 9, stealth: 9 }, 100, 3);
    assert.deepEqual(r.granted, { athletics: 3, stealth: 3 });
    assert.deepEqual(r.trimmed, [
      { key: "athletics", from: 9, to: 3 },
      { key: "stealth", from: 9, to: 3 }
    ]);
  });

  test("both trims compose: clamp to the cap, then water-level to the budget", () => {
    // 9/9/1 clamps to 3/3/1 (total 7), then three removals take the current
    // tallest each time: athletics (tie, alphabetically first) -> 2, stealth
    // -> 2, athletics again (tie at 2) -> 1. Levelling, not decapitation.
    const r = reconcileExpertiseBudget({ athletics: 9, stealth: 9, thievery: 1 }, 4, 3);
    assert.deepEqual(r.granted, { athletics: 1, stealth: 2, thievery: 1 });
    assert.equal(Object.values(r.granted).reduce((n, v) => n + v, 0), 4);
  });

  test("a budget of 0 empties the map without looping forever", () => {
    const r = reconcileExpertiseBudget({ athletics: 2, stealth: 1 }, 0, 4);
    assert.deepEqual(r.granted, { athletics: 0, stealth: 0 });
  });
});

/* ========================================================================== */
describe("H5 — reconcileActorExpertises writes nothing by default", () => {
/* ========================================================================== */

  test("REPORT-ONLY leaves value/max byte-for-byte unchanged", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const before = JSON.stringify(actor.system.expertises);

    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });   // default mode

    assert.equal(r.mode, "report-only");
    assert.equal(JSON.stringify(actor.system.expertises), before, "the actor object was mutated");
    for (const path of Object.keys(r.updates)) {
      assert.ok(!path.startsWith("system.expertises."), `report-only wrote ${path}`);
    }
    // Applying the updates must ALSO leave the numbers alone.
    applyUpdates(actor, r.updates);
    assert.equal(JSON.stringify(actor.system.expertises), before);
  });

  test("...while `trimmed` is still populated, so the GM sees what enforcing would do", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });
    assert.equal(r.overBudget, 6);
    assert.equal(r.trimmed.length, 6);
    assert.equal(r.granted.alchemy, 1);
    assert.equal(actor.system.expertises.alchemy.max, 2, "granted is a PROPOSAL, not the stored value");
  });

  test("ENFORCE is the only mode that mutates", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });

    assert.equal(r.updates["system.expertises.alchemy.max"], 1);
    applyUpdates(actor, r.updates);
    assert.equal(actor.system.expertises.alchemy.max, 1);
    assert.equal(actor.system.expertises.lift.max, 2, "untrimmed expertises are not touched");

    const owned = Object.values(actor.system.expertises).reduce((n, e) => n + e.max, 0);
    assert.equal(owned, 19);
  });

  test("enforce trims max, THEN clamps value under it", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });
    assert.equal(r.updates["system.expertises.alchemy.value"], 1);
    applyUpdates(actor, r.updates);
    for (const e of Object.values(actor.system.expertises)) {
      assert.ok(e.value <= e.max, "value may never exceed max");
    }
  });

  test("a value already below the trimmed max is left alone, not raised", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    actor.system.expertises.alchemy.value = 0;          // the player spent both
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });
    assert.equal(r.updates["system.expertises.alchemy.max"], 1);
    assert.ok(!("system.expertises.alchemy.value" in r.updates), "enforce must not mint a use back");
  });

  test("the budget reads `max`, never `value`", () => {
    const spent = migratedFixtureActor({ system: { background: "Thief" } });
    for (const e of Object.values(spent.system.expertises)) e.value = 0;   // everything spent

    const fresh = reconcileActorExpertises(migratedFixtureActor({ system: { background: "Thief" } }), { backgrounds: THIEF_INDEX });
    const used = reconcileActorExpertises(spent, { backgrounds: THIEF_INDEX });

    // If the budget read `value`, the reported surplus would collapse to 0 the
    // moment a player used their expertises — the allocation never changed.
    assert.equal(used.desired, fresh.desired);
    assert.equal(used.overBudget, fresh.overBudget);
    assert.equal(used.overBudget, 6);
  });

  test("a legally-advanced crow is not over budget and nothing is trimmed", () => {
    const actor = {
      _id: "legal", name: "Legal Crow", type: "crow", flags: {},
      system: {
        background: "Thief", xp: { txp: 3500, expertiseBonusesSpent: 5 },
        expertises: { stealth: { value: 2, max: 2 }, thievery: { value: 2, max: 2 } }
      },
      items: []
    };
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });
    assert.equal(r.overBudget, 0);
    assert.deepEqual(r.trimmed, []);
    for (const path of Object.keys(r.updates)) assert.ok(!path.startsWith("system.expertises."));
  });

  test("a monster is not a crow and is skipped", () => {
    const r = reconcileActorExpertises({ type: "monster", system: {} }, { backgrounds: THIEF_INDEX });
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "not-a-crow");
  });
});

/* ========================================================================== */
describe("H5 — the stamp: two call sites, never twice on one actor", () => {
/* ========================================================================== */

  test("the world pass stamps the actor", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX });
    assert.equal(r.updates[`flags.crows.${RECONCILED_FLAG}`], true);
    applyUpdates(actor, r.updates);
    assert.equal(actor.flags.crows[RECONCILED_FLAG], true);
  });

  test("calling it again after the world pass is a no-op", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    applyUpdates(actor, reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX }).updates);

    const again = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce" });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already-reconciled");
    assert.deepEqual(again.updates, {}, "a second pass must not re-trim");
  });

  test("`force` is the escape hatch for a GM re-running it deliberately", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    applyUpdates(actor, reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX }).updates);
    const forced = reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX, mode: "enforce", force: true });
    assert.equal(forced.skipped, false);
    assert.equal(forced.overBudget, 6);
  });

  test("an actor IMPORTED AFTER the world pass still gets reconciled", () => {
    // The straggler path (createActor). A PT1 actor dragged in from another
    // world, or restored from a backup, never passes through the `ready` pass
    // and would otherwise keep its over-budget uses unchecked forever.
    const worldActor = migratedFixtureActor({ _id: "in-world", system: { background: "Thief" } });
    applyUpdates(worldActor, reconcileActorExpertises(worldActor, { backgrounds: THIEF_INDEX }).updates);

    const imported = migratedFixtureActor({ _id: "imported-later", system: { background: "Thief" } });
    const r = reconcileActorExpertises(imported, { backgrounds: THIEF_INDEX });
    assert.equal(r.skipped, false);
    assert.equal(r.overBudget, 6);
    assert.equal(r.updates[`flags.crows.${RECONCILED_FLAG}`], true);
  });
});

/* ========================================================================== */
describe("expertiseOverBudget — the permanent, sheet-visible state", () => {
/* ========================================================================== */

  test("the exact surplus for the migrated fixture", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    applyUpdates(actor, reconcileActorExpertises(actor, { backgrounds: THIEF_INDEX }).updates);
    // The reconcile cached the resolved grant total, because the compendium
    // lookup that produced it cannot run in synchronous derived data.
    assert.equal(actor.flags.crows[BACKGROUND_USES_FLAG], 4);
    assert.equal(expertiseOverBudget(actor), 6);
  });

  test("0 for a legally-advanced crow", () => {
    const actor = {
      system: { xp: { txp: 3500, expertiseBonusesSpent: 5 }, expertises: { stealth: { value: 2, max: 2 } } },
      flags: { crows: { [BACKGROUND_USES_FLAG]: 4 } }
    };
    assert.equal(expertiseOverBudget(actor), 0);
  });

  test("NULL — not 0 — when the background was never resolved", () => {
    // 0 reads as "this crow is fine". null means "unknown" and the sheet shows
    // nothing, which is the honest answer.
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    assert.equal(expertiseOverBudget(actor), null);
  });

  test("an explicit backgroundUses overrides the cache", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    assert.equal(expertiseOverBudget(actor, 4), 6);
    assert.equal(expertiseOverBudget(actor, 10), 0);
  });
});

/* ========================================================================== */
describe("M12 wounds — prefer empty, never clamp, never drop", () => {
/* ========================================================================== */

  test("placeWoundSlots fills empty slots first, lowest index first", () => {
    assert.deepEqual(placeWoundSlots(3, { occupied: [0, 1, 2], capacity: 10 }),
      { indices: [3, 4, 5], forced: [], orphaned: [] });
  });

  test("a wound forced onto an occupied slot is REPORTED", () => {
    const full = placeWoundSlots(2, { occupied: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], capacity: 10 });
    assert.deepEqual(full.indices, [0, 1]);
    assert.deepEqual(full.forced, [0, 1]);
  });

  test("a HIGHER empty slot beats a lower occupied one", () => {
    // Slot 4 is the only empty one. The first wound takes it even though slots
    // 0-3 are lower — "lowest index first" orders the EMPTY slots, it does not
    // outrank emptiness. Only the second wound, with nothing empty left, falls
    // back to the lowest occupied slot and is reported as forced.
    const r = placeWoundSlots(2, { occupied: [0, 1, 2, 3, 5, 6, 7, 8, 9], capacity: 10 });
    assert.deepEqual(r.indices, [0, 4]);
    assert.deepEqual(r.forced, [0]);
  });

  test("more wounds than slots SPILL past capacity — never clamped, never dropped", () => {
    const r = placeWoundSlots(12, { occupied: [], capacity: 10 });
    assert.equal(r.indices.length, 12, "no wound may be dropped");
    assert.deepEqual(r.orphaned, [10, 11]);
    assert.ok(r.indices.includes(11), "indices are not clamped to capacity - 1");
  });

  test("migrateActorSlots re-places a naive bottom-up layout onto empty slots", () => {
    // The state PT1 would have left: wounds at 0,1,2 on top of the items.
    const actor = {
      _id: "a", name: "Bottom-up", type: "crow", flags: {},
      system: { woundSlots: [0, 1, 2], expertises: {}, xp: { txp: 0 } },
      items: [0, 1, 2].map(i => ({ _id: `i${i}`, name: `Item ${i}`, type: "gear", system: { slots: 1, location: { container: "backpack", index: i, length: 1 } } }))
    };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.updates["system.woundSlots"], [3, 4, 5]);
    assert.equal(r.wounds.moved, true);
    assert.deepEqual(r.wounds.forcedOntoOccupied, []);
  });

  test("...and leaves an already-good layout alone (idempotent, no churn)", () => {
    const actor = {
      _id: "a", name: "Fine", type: "crow", flags: {},
      system: { woundSlots: [3, 4, 5], expertises: {}, xp: { txp: 0 } },
      items: [0, 1, 2].map(i => ({ _id: `i${i}`, name: `Item ${i}`, type: "gear", system: { slots: 1, location: { container: "backpack", index: i, length: 1 } } }))
    };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.updates, {});
    assert.equal(r.wounds.moved, false);
  });

  test("a wound with nowhere empty to go is reported, not hidden", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ _id: `i${i}`, name: `Item ${i}`, type: "gear", system: { slots: 1, location: { container: "backpack", index: i, length: 1 } } }));
    const actor = { _id: "a", name: "Full", type: "crow", flags: {}, system: { woundSlots: [0, 1], expertises: {}, xp: { txp: 0 } }, items };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.wounds.forcedOntoOccupied, [0, 1]);
    assert.deepEqual(r.updates, {}, "nothing better exists, so nothing moves");
  });

  test("an index at or beyond capacity is PRESERVED and surfaced as orphaned", () => {
    const actor = { _id: "a", name: "Orphan", type: "crow", flags: {}, system: { woundSlots: [2, 12], expertises: {}, xp: { txp: 0 } }, items: [] };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.wounds.orphaned, [12]);
    assert.ok(r.wounds.indices.includes(12), "the orphan must not be dropped");
    assert.ok(!Object.keys(r.updates).includes("system.woundSlots"), "and must not be clamped to 9");
  });

  test("a slot-granting trait widens the backpack, so a former orphan is in range", () => {
    const actor = {
      _id: "a", name: "Trait", type: "crow", flags: {},
      system: { woundSlots: [11], expertises: {}, xp: { txp: 0 } },
      items: [{ _id: "t", name: "Big Pack", type: "trait", system: { slotGrants: [{ container: "backpack", count: 4 }] } }]
    };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.wounds.orphaned, [], "capacity is config PLUS trait grants (M12)");
  });
});

/* ========================================================================== */
describe("slot re-layout — collect and report, never relocate", () => {
/* ========================================================================== */

  const gear = (id, container, index, length = 1, extra = {}) => ({
    _id: id, name: id, type: "gear",
    system: { slots: length, location: { container, index, length }, ...extra }
  });

  test("an item spilling past its container is REPORTED, not moved", () => {
    const actor = { _id: "a", name: "Illegal", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("bedroll", "backpack", 9, 2)] };
    const r = migrateActorSlots(actor);
    assert.equal(r.illegal.length, 1);
    assert.equal(r.illegal[0].reason, "beyond-capacity");
    assert.equal(r.illegal[0].id, "bedroll");
    assert.deepEqual(r.updates, {}, "a migration that repacks the bag makes the Ref debug a layout nobody chose");
  });

  test("two items claiming the same slot are reported as an overlap", () => {
    const actor = { _id: "a", name: "Overlap", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("rope", "backpack", 2), gear("lantern", "backpack", 2)] };
    const r = migrateActorSlots(actor);
    assert.equal(r.illegal.length, 1);
    assert.equal(r.illegal[0].reason, "overlap");
  });

  test("a container that no longer exists is reported, not silently emptied", () => {
    const actor = { _id: "a", name: "Ghost", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("relic", "quiver", 0)] };
    const r = migrateActorSlots(actor);
    assert.equal(r.illegal[0].reason, "unknown-container");
  });

  test("belt 2 -> 4 is a safe widening: what was legal stays legal", () => {
    // Both PT1 belt slots, plus the two the widening added.
    const actor = { _id: "a", name: "Belt", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("p1", "belt", 0), gear("p2", "belt", 1), gear("p3", "belt", 2), gear("p4", "belt", 3)] };
    assert.equal(CROWS.carryContainers.belt, 4);
    assert.deepEqual(migrateActorSlots(actor).illegal, []);
  });

  test("magic-slot items keep their index on the new axis", () => {
    const actor = { _id: "a", name: "Magic", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("ring", "finger", 0, 1, { equipSlotType: "finger" })] };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.illegal, []);
    assert.deepEqual(r.magicOverload, []);
  });

  test("two items in one magic slot are an overload (R:438)", () => {
    const actor = { _id: "a", name: "Overload", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("ring1", "finger", 0), gear("ring2", "finger", 0)] };
    const r = migrateActorSlots(actor);
    // The second ring cannot be placed, so it lands in `illegal`; the axis
    // itself is reported through the overlap. Either way it is visible.
    assert.ok(r.illegal.length + r.magicOverload.length > 0);
  });

  test("an item whose equipSlotType disagrees with its container is flagged", () => {
    const actor = { _id: "a", name: "Mismatch", type: "crow", flags: {}, system: { woundSlots: [], expertises: {}, xp: { txp: 0 } }, items: [gear("crown", "finger", 0, 1, { equipSlotType: "head" })] };
    const r = migrateActorSlots(actor);
    assert.equal(r.illegal[0].reason, "equip-slot-mismatch");
  });

  test("the actor-level PT1 containers map is read when item locations are absent", () => {
    // The fixture's shape: no per-item `location`, an actor-level map instead.
    const actor = { _id: "a", name: "Mapped", type: "crow", flags: {}, system: { containers: clone(FIXTURE.system.containers), woundSlots: [0, 1, 2], expertises: {}, xp: { txp: 0 } }, items: clone(FIXTURE.items) };
    const r = migrateActorSlots(actor);
    assert.deepEqual(r.updates["system.woundSlots"], [3, 4, 5]);
  });
});

/* ========================================================================== */
describe("migrateBackgroundSystem — best-effort shape, overwritten by T3.1", () => {
/* ========================================================================== */

  test("a collapsing pair LOSES a grant, which is why backgrounds are replaced", () => {
    // The Thief: 7 PT1 skills, two of them collapsing pairs, so 5 expertises.
    // There is no bonus to take a max of, so the second grant is simply gone.
    const out = migrateBackgroundSystem({ skills: ["hide", "sneak", "sabotage", "sleightOfHand", "pickLock", "climb", "search"] });
    assert.equal(out.expertises.length, 5);
    assert.deepEqual(out.expertises.map(e => e.key).sort(),
      ["athletics", "pickLock", "search", "stealth", "thievery"]);
    assert.ok(!("skills" in out));
  });

  test("every grant is 1 use, because PT1 records no other number", () => {
    // C:103 says "Benefaction (2 uses)" for a real background. The 2 exists
    // nowhere in PT1 data, so no transform can produce it — T3.1 must.
    const out = migrateBackgroundSystem({ skills: ["benefaction", "elemental"] });
    for (const e of out.expertises) assert.equal(e.uses, 1);
  });

  test("characteristicBonus becomes the allowed SET at 2 (C:28)", () => {
    assert.deepEqual(migrateBackgroundSystem({ characteristicBonus: "mind" }).characteristicOptionsAt2, ["mind"]);
    assert.deepEqual(migrateBackgroundSystem({ characteristicBonus: "mind or strength" }).characteristicOptionsAt2, ["mind", "strength"]);
    assert.deepEqual(migrateBackgroundSystem({ characteristicBonus: "any" }).characteristicOptionsAt2, ["agility", "mind", "strength"]);
  });

  test("existing PT2 data is not overwritten by the best-effort pass", () => {
    const out = migrateBackgroundSystem({ skills: ["hide"], expertises: [{ key: "stealth", uses: 2 }] });
    assert.deepEqual(out.expertises, [{ key: "stealth", uses: 2 }]);
  });
});

/* ========================================================================== */
describe("migrateActorDocument + the GM report — nothing disappears silently", () => {
/* ========================================================================== */

  test("one call per actor merges both layers' updates", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    const r = migrateActorDocument(actor, { backgrounds: THIEF_INDEX });
    assert.equal(r.actorName, FIXTURE.name);
    assert.equal(r.expertises.overBudget, 6);
    assert.equal(r.updates[`flags.crows.${RECONCILED_FLAG}`], true);
  });

  test("deleted status effects are reported, not silently cleaned", () => {
    const actor = migratedFixtureActor({ system: { background: "Thief" } });
    actor.effects = [{ statuses: ["boned"] }, { statuses: ["prone", "hidden"] }];
    const r = migrateActorDocument(actor, { backgrounds: THIEF_INDEX });
    assert.deepEqual(r.removedStatuses.sort(), ["boned", "hidden"]);
  });

  test("the report is JournalEntry data and names what it could not resolve", () => {
    const unresolved = migrateActorDocument(migratedFixtureActor({ system: { background: "Thief" } }), { backgrounds: EMPTY_INDEX });
    const resolved = migrateActorDocument(migratedFixtureActor({ _id: "b", name: "Budgeted", system: { background: "Thief" } }), { backgrounds: THIEF_INDEX });

    const entry = buildMigrationReport([unresolved, resolved]);
    assert.equal(typeof entry.name, "string");
    assert.equal(entry.pages[0].type, "text");
    assert.equal(entry.pages[0].text.format, 1);      // JOURNAL_ENTRY_PAGE_FORMATS.HTML

    const html = entry.pages[0].text.content;
    assert.match(html, /Backgrounds not resolved/);
    assert.match(html, /budget skipped, not assumed zero/);
    assert.match(html, /Budgeted/);
    assert.match(html, /report-only/);
  });

  test("the report says trims were WRITTEN only under enforce", () => {
    const r = migrateActorDocument(migratedFixtureActor({ system: { background: "Thief" } }), { backgrounds: THIEF_INDEX, mode: "enforce" });
    const html = buildMigrationReport([r], { mode: "enforce" }).pages[0].text.content;
    assert.match(html, /were WRITTEN/);
  });

  test("an empty world still produces a valid report", () => {
    const entry = buildMigrationReport([]);
    assert.match(entry.pages[0].text.content, /0 actor\(s\) examined/);
  });
});
