import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  resolveTier,
  buildTestResult,
  selfEdgesBanes,
  targetEdgesBanes,
  autoDoomApplies,
  classifyTier,
  testCardData,
  preparedTaskMod
} from "../module/helpers/roll.mjs";
import {
  canSpendExpertise,
  categoryAllows,
  legalExpertiseSpends,
  hasLegalSpend,
  readExpertiseUses,
  spendExpertise,
  declineResult,
  applyExpertise,
  declineExpertise,
  xRestRefundOnCrit,
  __resetCommitLedger
} from "../module/helpers/expertise.mjs";

// ---------------------------------------------------------------------------
// Test doubles.
//
// `Hooks` is set here rather than in test/shim/foundry.mjs on purpose: the shim
// stays minimal, and the commit event is a T1.1 concern, so its recorder belongs
// in T1.1's suite. Everything else uses the injectable seams on applyExpertise /
// declineExpertise — a seam beats a mock.
// ---------------------------------------------------------------------------

let events = [];
globalThis.Hooks = {
  callAll(name, ...args) {
    events.push({ name, args });
  }
};

const labels = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, label: `${prefix} ${i}` }));

function fakeCrow({ expertises = {}, isOwner = true, id = "Actor.crow", conditions = {}, xRest = null } = {}) {
  const system = { expertises, conditions, characteristics: {} };
  if (xRest) system.xRest = xRest;
  return {
    id, isOwner, type: "crow", system,
    updates: [],
    async update(data) {
      this.updates.push(data);
      for (const [k, v] of Object.entries(data)) foundry.utils.setProperty(this, k, v);
      return this;
    }
  };
}

function fakeMonster({ expertises = [], isOwner = true, id = "Actor.monster" } = {}) {
  return {
    id, isOwner, type: "monster",
    system: { expertises, conditions: {}, characteristics: {}, slots: 10 },
    updates: [],
    async update(data) {
      this.updates.push(data);
      for (const [k, v] of Object.entries(data)) foundry.utils.setProperty(this, k, v);
      return this;
    }
  };
}

function fakeMessage(result, id = "Message.1") {
  return {
    id,
    flags: { crows: { test: structuredClone(result) } },
    updates: 0,
    async update(data) {
      this.updates++;
      for (const [k, v] of Object.entries(data)) foundry.utils.setProperty(this, k, v);
      return this;
    }
  };
}

const flagOf = (m) => m.flags.crows.test;
const commits = () => events.filter(e => e.name === "crowsTestCommitted");

/** A pending result forged directly, to test a gate ahead of the state guard. */
function pendingResult(over = {}) {
  return {
    actorId: "Actor.crow", characteristic: "strength", rawSum: 10, charVal: 2,
    mods: [], eb: { numeric: 0, tierShift: 0, edges: [], banes: [], explanation: "" },
    total: 12, tier: 2, doom: false, crit: false, terminal: null, kind: "test",
    targets: [], expertiseSpent: null, state: "pending", commitReason: null,
    ...over
  };
}

beforeEach(() => {
  events = [];
  __resetCommitLedger();
});

// ---------------------------------------------------------------------------
describe("resolveTier — ordinary resolution", () => {
  test("total is rawSum + characteristic + mods + the edge/bane numeric", () => {
    const r = resolveTier({
      rawSum: 10, charVal: 2,
      mods: [{ key: "tool", label: "Masterwork", value: 1 }],
      edges: labels(1, "e"), banes: []
    });
    assert.equal(r.total, 10 + 2 + 1 + 2);
    assert.equal(r.tier, classifyTier(15));
    assert.equal(r.terminal, null);
  });

  test("mods and edges are SEPARATE channels — a +2 mod is not an edge (R:286)", () => {
    const withMod = resolveTier({ rawSum: 10, mods: [{ key: "m", label: "m", value: 2 }] });
    const withEdge = resolveTier({ rawSum: 10, edges: labels(1, "e") });
    assert.equal(withMod.total, withEdge.total, "both land on the same total");
    assert.equal(withMod.eb.edges.length, 0, "but the mod contributed no edge");
    assert.equal(withEdge.eb.edges.length, 1);
  });

  test("two edges shift the tier instead of the total", () => {
    const r = resolveTier({ rawSum: 10, charVal: 0, edges: labels(2, "e") });
    assert.equal(r.total, 10, "a double edge adds nothing numeric");
    assert.equal(r.tier, 2, "tier 1 (10) shifted up one");
  });

  test("a double bane cannot push the tier below 1", () => {
    const r = resolveTier({ rawSum: 4, charVal: 0, banes: labels(2, "b") });
    assert.equal(r.tier, 1);
  });

  test("a double edge cannot push the tier above 3", () => {
    const r = resolveTier({ rawSum: 18, charVal: 4, edges: labels(2, "e") });
    assert.equal(r.tier, 3);
  });

  test("total is non-null ONLY on the ordinary path", () => {
    assert.equal(resolveTier({ rawSum: 2 }).total, null, "doom");
    assert.equal(resolveTier({ rawSum: 20 }).total, null, "crit");
    assert.notEqual(resolveTier({ rawSum: 10 }).total, null, "ordinary");
  });
});

// ---------------------------------------------------------------------------
describe("resolveTier — terminal precedence, as EARLY RETURNS", () => {
  const unconsciousTarget = {
    tokenId: "Token.1",
    conditions: { unconscious: true, prone: false, grabbed: false, blessed: false, weakened: false, vulnerable: false }
  };

  test("a doom is terminal against a double edge", () => {
    const r = resolveTier({ rawSum: 2, edges: labels(2, "e") });
    assert.equal(r.tier, 1);
    assert.equal(r.terminal, "doom");
    assert.equal(r.doom, true);
  });

  test("a doom is terminal against +10 of mods", () => {
    const r = resolveTier({ rawSum: 3, charVal: 5, mods: [{ key: "x", label: "x", value: 10 }] });
    assert.equal(r.tier, 1);
    assert.equal(r.terminal, "doom");
    assert.equal(r.total, null, "no total, because the modifiers did not matter");
  });

  test("a doom is terminal against a double edge AND +10 of mods AND a high characteristic", () => {
    const r = resolveTier({
      rawSum: 2, charVal: 5,
      mods: [{ key: "a", label: "a", value: 6 }, { key: "b", label: "b", value: 4 }],
      edges: labels(2, "e")
    });
    assert.equal(r.tier, 1);
    assert.equal(r.terminal, "doom");
  });

  test("a doom cannot be rescued by an expertise spend either", () => {
    const doomed = pendingResult({ rawSum: 2, doom: true, terminal: "doom", tier: 1, total: null, kind: "attack" });
    const actor = fakeCrow({ expertises: { bow: { value: 2, max: 2 } } });
    assert.equal(canSpendExpertise(doomed, "bow", actor), "a doom can't be improved");
  });

  test("a crit is terminal against a double bane", () => {
    const r = resolveTier({ rawSum: 19, charVal: -5, banes: labels(2, "b") });
    assert.equal(r.tier, 3);
    assert.equal(r.terminal, "crit");
    assert.equal(r.crit, true);
  });

  test("an attack on an unconscious target OUTRANKS a doom (R:554 over R:246)", () => {
    const r = resolveTier({ rawSum: 2, kind: "attack", target: unconsciousTarget });
    assert.equal(r.tier, 3, "tier 3, not tier 1");
    assert.equal(r.terminal, "unconscious");
    assert.equal(r.doom, true, "the doom is still REPORTED for the Ref to adjudicate");
  });

  test("the unconscious-target case keeps the crit live (R:554's parenthetical)", () => {
    const r = resolveTier({ rawSum: 20, kind: "attack", target: unconsciousTarget });
    assert.equal(r.terminal, "unconscious");
    assert.equal(r.crit, true, "T1.7 reads the extra action off `crit`, never off `terminal`");
  });

  test("the unconscious rule applies to ATTACKS only — a plain test near one still dooms", () => {
    const r = resolveTier({ rawSum: 2, kind: "test", target: unconsciousTarget });
    assert.equal(r.terminal, "doom");
    assert.equal(r.tier, 1);
  });

  test("autoDoom dooms without the dice, and suppresses a crit it would otherwise report", () => {
    const r = resolveTier({ rawSum: 19, autoDoom: true });
    assert.equal(r.terminal, "doom");
    assert.equal(r.doom, true);
    assert.equal(r.crit, false, "a rule-mandated doom is not also a crit");
  });
});

// ---------------------------------------------------------------------------
describe("conditions feed the edge/bane channel — conditionNet is gone", () => {
  test("Blessed is an EDGE, not a +1 (R:532)", () => {
    const { edges, banes } = selfEdgesBanes({ conditions: { blessed: true } });
    assert.deepEqual(edges.map(e => e.key), ["blessed"]);
    assert.equal(banes.length, 0);
  });

  test("Weakened is a bane on all tests (R:556)", () => {
    const { banes } = selfEdgesBanes({ conditions: { weakened: true } });
    assert.deepEqual(banes.map(b => b.key), ["weakened"]);
  });

  test("`boned` no longer does anything at all", () => {
    const { edges, banes } = selfEdgesBanes({ conditions: { boned: 3 } });
    assert.equal(edges.length, 0);
    assert.equal(banes.length, 0);
  });

  test("Blessed and Weakened together cancel to neutral", () => {
    const { edges, banes } = selfEdgesBanes({ conditions: { blessed: true, weakened: true } });
    const r = resolveTier({ rawSum: 10, edges, banes });
    assert.equal(r.eb.numeric, 0);
    assert.equal(r.eb.tierShift, 0);
  });

  test("Prone is a bane on the roller's MELEE attacks only", () => {
    const melee = selfEdgesBanes({ conditions: { prone: true }, kind: "attack", attack: { isMelee: true } });
    const ranged = selfEdgesBanes({ conditions: { prone: true }, kind: "attack", attack: { isMelee: false } });
    const plain = selfEdgesBanes({ conditions: { prone: true }, kind: "test" });
    assert.equal(melee.banes.length, 1);
    assert.equal(ranged.banes.length, 0);
    assert.equal(plain.banes.length, 0);
  });

  test("Unconscious is a DOUBLE bane on Mind tests — two Labels, because the channel counts", () => {
    const { banes } = selfEdgesBanes({ conditions: { unconscious: true }, characteristic: "mind" });
    assert.equal(banes.length, 2);
    const r = resolveTier({ rawSum: 14, banes });
    assert.equal(r.eb.tierShift, -1, "a double bane, not a single one");
  });

  test("Unconscious auto-dooms Agility and Strength, but not Mind", () => {
    assert.equal(autoDoomApplies({ conditions: { unconscious: true }, characteristic: "agility" }), true);
    assert.equal(autoDoomApplies({ conditions: { unconscious: true }, characteristic: "strength" }), true);
    assert.equal(autoDoomApplies({ conditions: { unconscious: true }, characteristic: "mind" }), false);
    assert.equal(autoDoomApplies({ conditions: {}, characteristic: "agility" }), false);
  });

  test("a grabbed target hands the attacker an edge (R:536)", () => {
    const t = { tokenId: "Token.7", conditions: { grabbed: true } };
    assert.deepEqual(targetEdgesBanes(t, { kind: "attack" }).edges.map(e => e.key), ["targetGrabbed"]);
    assert.equal(targetEdgesBanes(t, { kind: "test" }).edges.length, 0, "attacks only");
  });

  test("a prone target is an edge in melee and a bane at range (R:540)", () => {
    const t = { tokenId: "Token.8", conditions: { prone: true } };
    assert.equal(targetEdgesBanes(t, { kind: "attack", attack: { isMelee: true } }).edges.length, 1);
    assert.equal(targetEdgesBanes(t, { kind: "attack", attack: { isMelee: true } }).banes.length, 0);
    assert.equal(targetEdgesBanes(t, { kind: "attack", attack: { isMelee: false } }).banes.length, 1);
  });

  test("target edges carry their tokenId as `source`, so the card can say whose they are", () => {
    const t = { tokenId: "Token.9", conditions: { grabbed: true } };
    assert.equal(targetEdgesBanes(t, { kind: "attack" }).edges[0].source, "Token.9");
  });
});

// ---------------------------------------------------------------------------
describe("Prepare for Task (R:658) — the SUMMED channel, never an edge", () => {
  const TASK = "picking the lock on the abbot's study";

  test("a matched task becomes a Mod with the +2 on it", () => {
    assert.deepEqual(preparedTaskMod(TASK, 2), {
      key: "preparedTask", label: `Prepared: ${TASK}`, value: 2
    });
  });

  test("no match leaves no phantom \"+0\" row on the card", () => {
    assert.equal(preparedTaskMod(TASK, 0), null);
    assert.equal(preparedTaskMod(TASK, undefined), null);
    assert.equal(preparedTaskMod(TASK, null), null);
  });

  test("it lands in mods[] and NOT in the edge/bane channel", () => {
    const r = buildTestResult({
      rawSum: 10, charVal: 0, mods: [preparedTaskMod(TASK, 2)], actor: null
    });
    assert.deepEqual(r.mods.map(m => m.key), ["preparedTask"]);
    assert.deepEqual(r.eb.edges, [], "R:286 — a bonus is not an edge");
    assert.deepEqual(r.eb.banes, []);
    assert.equal(r.eb.numeric, 0, "the edge channel contributed nothing");
    assert.equal(r.eb.tierShift, 0);
    assert.equal(r.total, 12, "the +2 reached the total by being SUMMED");
  });

  test("two +2 bonuses sum to +4 and still cannot shift a tier", () => {
    // The failure this guards: routed as edges, two of these would tally to a
    // DOUBLE edge and move the tier outright instead of adding 4.
    const r = buildTestResult({
      rawSum: 10, charVal: 0,
      mods: [preparedTaskMod(TASK, 2), { key: "tool", label: "Masterwork", value: 2 }],
      actor: null
    });
    assert.equal(r.total, 14);
    assert.equal(r.eb.tierShift, 0);
    assert.equal(r.tier, classifyTier(14));
  });

  test("the bonus cannot rescue a doom — mods are still ignored on a terminal path", () => {
    const r = buildTestResult({ rawSum: 2, mods: [preparedTaskMod(TASK, 2)], actor: null });
    assert.equal(r.terminal, "doom");
    assert.equal(r.tier, 1);
    assert.equal(r.total, null);
  });
});

// ---------------------------------------------------------------------------
describe("buildTestResult — multi-target (R:961)", () => {
  const actorWithBow = () => fakeCrow({ expertises: { bow: { value: 1, max: 2 } } });

  test("one roll, one rawSum, per-target tiers", () => {
    const r = buildTestResult({
      actorId: "Actor.crow", characteristic: "agility", kind: "attack",
      rawSum: 15, charVal: 0, attack: { isMelee: false },
      targets: [
        { tokenId: "T.plain", conditions: {} },
        { tokenId: "T.grabbed", conditions: { grabbed: true } }
      ],
      actor: actorWithBow()
    });
    assert.equal(r.targets.length, 2);
    assert.equal(r.rawSum, 15, "one roll, shared by both targets");
    assert.equal(r.targets[0].tier, 2, "15 is tier 2");
    assert.equal(r.targets[1].tier, 3, "grabbed hands over an edge: 15 + 2 = 17, tier 3");
  });

  test("the BASE tier is the no-target resolution and describes the roll only", () => {
    const r = buildTestResult({
      kind: "attack", rawSum: 12, charVal: 0, attack: { isMelee: true },
      targets: [{ tokenId: "T.unconscious", conditions: { unconscious: true } }],
      actor: actorWithBow()
    });
    assert.equal(r.tier, 2, "the base resolution has no target");
    assert.equal(r.terminal, null);
    assert.equal(r.targets[0].tier, 3, "but damage reads targets[].tier");
    assert.equal(r.targets[0].terminal, "unconscious");
  });

  test("each target entry carries the FULL effective edges that produced its tier", () => {
    const r = buildTestResult({
      kind: "attack", rawSum: 10, edges: [{ key: "flanking", label: "Flanking" }],
      attack: { isMelee: true },
      targets: [{ tokenId: "T.prone", conditions: { prone: true } }],
      actor: actorWithBow()
    });
    assert.deepEqual(r.targets[0].edges.map(e => e.key), ["flanking", "targetProne"]);
  });

  test("a test with no targets has an empty targets array, never undefined", () => {
    const r = buildTestResult({ rawSum: 10, actor: null });
    assert.deepEqual(r.targets, []);
  });
});

// ---------------------------------------------------------------------------
describe("the roll payload survives to commit — the card is a pure function of the flag", () => {
  // API-NOTES §4: updating the flag re-renders the message, and a late-joining
  // client renders from the flag ALONE. So anything the card needs has to be in
  // the TestResult. Both downstream consumers depend on this: spellcasting.mjs
  // resolves its cast context from `result.casting.castId`, and combat.mjs
  // computes damage from an `attack`.
  const attack = { weaponName: "Shortbow", isMelee: false, t2: 4, t3: 7, piercing: true };
  const casting = { castId: "cast-abc", rank: 2, discipline: "elemental", spellbookName: "Cinders" };

  test("an attack's damage payload is on the result", () => {
    const r = buildTestResult({ kind: "attack", rawSum: 12, attack, actor: null });
    assert.deepEqual(r.attack, attack);
    assert.equal(r.casting, null);
  });

  test("a casting's context is on the result, so castId survives the pending window", () => {
    const r = buildTestResult({ kind: "casting", rawSum: 12, casting, actor: null });
    assert.equal(r.casting.castId, "cast-abc");
    assert.equal(r.attack, null);
  });

  test("the payload is still there after a spend commits", async () => {
    const actor = fakeCrow({ expertises: { bow: { value: 1, max: 1 } } });
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, attack, actor }));
    const out = await applyExpertise(msg, "bow", { getActor: () => actor });
    assert.deepEqual(out.attack, attack, "T1.7 reads damage off the COMMITTED result");
    assert.deepEqual(commits()[0].args[0].attack, attack, "and the event carries it");
  });

  test("the payload is still there after a decline commits", async () => {
    const actor = fakeCrow({ expertises: { elemental: { value: 1, max: 1 } } });
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "casting", rawSum: 12, casting, actor }));
    const out = await declineExpertise(msg, { getActor: () => actor });
    assert.equal(out.casting.castId, "cast-abc");
  });

  test("testCardData reads the payload off the result, not off the caller", () => {
    const r = buildTestResult({ kind: "attack", rawSum: 12, attack, actor: null });
    const data = testCardData(r, { flavor: "Shoot" });
    assert.deepEqual(data.attack, attack, "a re-render with no caller context still shows Apply Damage");
  });
});

// ---------------------------------------------------------------------------
describe("canSpendExpertise — the gate (R:292)", () => {
  const bowCrow = () => fakeCrow({ expertises: { bow: { value: 1, max: 2 }, athletics: { value: 1, max: 1 } } });

  test("state is checked FIRST — a DECLINED card is not spendable (C2)", () => {
    const declined = pendingResult({ kind: "attack", state: "committed", commitReason: "declined" });
    assert.equal(canSpendExpertise(declined, "bow", bowCrow()), "already resolved");
  });

  test("a weapon expertise is REFUSED on a casting (R:384)", () => {
    const casting = pendingResult({ kind: "casting" });
    assert.equal(canSpendExpertise(casting, "bow", bowCrow()), "wrong expertise category");
  });

  test("a spellcasting expertise IS allowed on an attack — the spell-attack case (R:913)", () => {
    const attack = pendingResult({ kind: "attack" });
    const caster = fakeCrow({ expertises: { elemental: { value: 1, max: 1 } } });
    assert.equal(canSpendExpertise(attack, "elemental", caster), null);
  });

  test("a casting accepts only its OWN discipline's expertise (R:1451, singular)", () => {
    // Category alone is not enough: without the discipline gate an alteration
    // caster could improve their result by spending necromancy, and it would be
    // silent — the spend looks legal and the tier really does improve.
    const alteration = pendingResult({ kind: "casting", casting: { discipline: "alteration", rank: 1 } });
    const caster = fakeCrow({
      expertises: { alteration: { value: 1, max: 1 }, necromancy: { value: 1, max: 1 } }
    });
    assert.equal(canSpendExpertise(alteration, "alteration", caster), null);
    assert.equal(canSpendExpertise(alteration, "necromancy", caster), "wrong discipline");
  });

  test("the discipline gate covers spell ATTACKS too", () => {
    // R:913 opens the weapon/spellcasting category on an attack, but it does not
    // license picking any of the six.
    const spellAttack = pendingResult({ kind: "attack", casting: { discipline: "elemental", rank: 1 } });
    const caster = fakeCrow({
      expertises: { elemental: { value: 1, max: 1 }, illusion: { value: 1, max: 1 }, bow: { value: 1, max: 1 } }
    });
    assert.equal(canSpendExpertise(spellAttack, "elemental", caster), null);
    assert.equal(canSpendExpertise(spellAttack, "illusion", caster), "wrong discipline");
    assert.equal(canSpendExpertise(spellAttack, "bow", caster), null, "a plain weapon spend is untouched");
  });

  test("the discipline gate is not the general/weapon gate's business", () => {
    const alteration = pendingResult({ kind: "test", casting: { discipline: "alteration", rank: 1 } });
    const crow = fakeCrow({ expertises: { athletics: { value: 1, max: 1 } } });
    assert.equal(canSpendExpertise(alteration, "athletics", crow), null);
  });

  test("a non-casting result is unaffected — no discipline, no rule", () => {
    const attack = pendingResult({ kind: "attack" });
    const caster = fakeCrow({ expertises: { necromancy: { value: 1, max: 1 } } });
    assert.equal(canSpendExpertise(attack, "necromancy", caster), null);
  });

  test("a general expertise is refused on both attacks and castings", () => {
    assert.equal(categoryAllows("attack", "athletics"), false);
    assert.equal(categoryAllows("casting", "athletics"), false);
    assert.equal(categoryAllows("test", "athletics"), true);
  });

  test("a spend is REFUSED when the tier is already 3, so a use cannot be burned for nothing", () => {
    const maxed = pendingResult({ kind: "attack", tier: 3 });
    assert.equal(canSpendExpertise(maxed, "bow", bowCrow()), "already tier 3");
  });

  test("one expertise per test", () => {
    const already = pendingResult({ kind: "attack", expertiseSpent: "slashing" });
    assert.equal(canSpendExpertise(already, "bow", bowCrow()), "one expertise per test");
  });

  test("`value` at 0 refuses even when `max` is high — remaining is what is spendable", () => {
    const attack = pendingResult({ kind: "attack" });
    const spent = fakeCrow({ expertises: { bow: { value: 0, max: 4 } } });
    assert.equal(canSpendExpertise(attack, "bow", spent), "no uses left");
  });

  test("an unknown expertise key is refused by category, never by a crash", () => {
    assert.equal(canSpendExpertise(pendingResult(), "juggling", bowCrow()), "wrong expertise category");
  });

  test("monsters store expertises as an ARRAY and must still be able to spend", () => {
    const attack = pendingResult({ kind: "attack" });
    const sage = fakeMonster({ expertises: [{ key: "bashing", value: 2, max: 2 }] });
    assert.deepEqual(readExpertiseUses(sage, "bashing"), { value: 2, max: 2 });
    assert.equal(canSpendExpertise(attack, "bashing", sage), null);
  });

  test("legalExpertiseSpends lists only what would actually be accepted", () => {
    const attack = pendingResult({ kind: "attack" });
    const crow = fakeCrow({ expertises: { bow: { value: 1, max: 1 }, athletics: { value: 5, max: 5 } } });
    assert.deepEqual(legalExpertiseSpends(attack, crow), ["bow"]);
    assert.equal(hasLegalSpend(attack, crow), true);
    assert.equal(hasLegalSpend(attack, null), false, "no actor, no spend");
  });
});

// ---------------------------------------------------------------------------
describe("A1 commit lifecycle — nothing downstream fires while pending", () => {
  const spendable = () => fakeCrow({ expertises: { bow: { value: 2, max: 3 } } });

  test("a terminal result is COMMITTED on the first render, with no pending window", () => {
    for (const [rawSum, reasonTerminal] of [[2, "doom"], [20, "crit"]]) {
      const r = buildTestResult({ kind: "attack", rawSum, actor: spendable() });
      assert.equal(r.terminal, reasonTerminal);
      assert.equal(r.state, "committed");
      assert.equal(r.commitReason, "terminal");
    }
  });

  test("an unconscious-target attack also commits terminally", () => {
    const r = buildTestResult({
      kind: "attack", rawSum: 12, actor: spendable(),
      targets: [{ tokenId: "T", conditions: { unconscious: true } }]
    });
    // The BASE resolution has no target, so it is not terminal — the pending
    // window is decided by the base, and this attack can still be improved.
    assert.equal(r.terminal, null);
    assert.equal(r.targets[0].terminal, "unconscious");
  });

  test("no uses -> committed, \"no-legal-spend\"", () => {
    const r = buildTestResult({ kind: "attack", rawSum: 12, actor: fakeCrow({ expertises: { bow: { value: 0, max: 2 } } }) });
    assert.equal(r.state, "committed");
    assert.equal(r.commitReason, "no-legal-spend");
  });

  test("no legal CATEGORY -> committed, \"no-legal-spend\"", () => {
    // Plenty of uses, but they are all general expertises and this is a casting.
    const r = buildTestResult({ kind: "casting", rawSum: 12, actor: fakeCrow({ expertises: { athletics: { value: 5, max: 5 } } }) });
    assert.equal(r.state, "committed");
    assert.equal(r.commitReason, "no-legal-spend");
  });

  test("only WRONG-DISCIPLINE expertises -> committed, \"no-legal-spend\", never a stuck pending card", () => {
    // The discipline gate feeds hasLegalSpend, so a caster holding six
    // spellcasting expertises but not this spell's one commits immediately
    // instead of stranding downstream effects behind a spend nobody can make.
    const caster = fakeCrow({ expertises: { necromancy: { value: 3, max: 3 }, illusion: { value: 3, max: 3 } } });
    const r = buildTestResult({
      actorId: caster.id, kind: "casting", rawSum: 12,
      casting: { discipline: "alteration", rank: 1 }, actor: caster
    });
    assert.equal(r.state, "committed");
    assert.equal(r.commitReason, "no-legal-spend");

    // ...and the matching discipline still opens the pending window.
    caster.system.expertises.alteration = { value: 1, max: 1 };
    const ok = buildTestResult({
      actorId: caster.id, kind: "casting", rawSum: 12,
      casting: { discipline: "alteration", rank: 1 }, actor: caster
    });
    assert.equal(ok.state, "pending");
  });

  test("a legal spend available -> PENDING, commitReason null", () => {
    const r = buildTestResult({ kind: "attack", rawSum: 12, actor: spendable() });
    assert.equal(r.state, "pending");
    assert.equal(r.commitReason, null);
    assert.equal(commits().length, 0, "and no commit event has been emitted");
  });

  test("applyExpertise -> committed \"spent\", tier +1, event emitted exactly once", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    assert.equal(flagOf(msg).tier, 2);

    const out = await applyExpertise(msg, "bow", { getActor: () => actor });

    assert.equal(out.state, "committed");
    assert.equal(out.commitReason, "spent");
    assert.equal(out.expertiseSpent, "bow");
    assert.equal(out.tier, 3);
    assert.equal(flagOf(msg).tier, 3, "the flag is the source of truth for the re-render");
    assert.equal(commits().length, 1);
    assert.equal(commits()[0].args[0].tier, 3, "the event carries the FINAL tier");
  });

  test("a spend decrements `value` and NEVER touches `max`", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    await applyExpertise(msg, "bow", { getActor: () => actor });
    assert.deepEqual(actor.updates, [{ "system.expertises.bow.value": 1 }]);
    assert.equal(actor.system.expertises.bow.max, 3, "max is the owned pool");
  });

  test("a monster's array-shaped expertises decrement correctly too", async () => {
    const sage = fakeMonster({ expertises: [{ key: "bashing", value: 2, max: 2 }, { key: "search", value: 1, max: 1 }] });
    const msg = fakeMessage(buildTestResult({ actorId: sage.id, kind: "attack", rawSum: 12, actor: sage }));
    await applyExpertise(msg, "bashing", { getActor: () => sage });
    assert.deepEqual(sage.system.expertises, [
      { key: "bashing", value: 1, max: 2 },
      { key: "search", value: 1, max: 1 }
    ]);
  });

  test("declineExpertise -> committed \"declined\", event emitted exactly once", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    const out = await declineExpertise(msg, { getActor: () => actor });
    assert.equal(out.state, "committed");
    assert.equal(out.commitReason, "declined");
    assert.equal(out.tier, 2, "declining resolves as rolled");
    assert.equal(commits().length, 1);
  });

  test("SEQUENTIAL double-click on spend -> still exactly ONE commit event and ONE use spent", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    await applyExpertise(msg, "bow", { getActor: () => actor });
    await applyExpertise(msg, "bow", { getActor: () => actor });
    assert.equal(commits().length, 1);
    assert.equal(actor.updates.length, 1);
    assert.equal(actor.system.expertises.bow.value, 1);
  });

  test("CONCURRENT double-click on spend -> the in-flight lock holds too", async () => {
    // This is the case the render hook actually produces: it fires TWICE per
    // render (API-NOTES §2), so a naively bound button is bound twice and both
    // handlers read `pending` in the same tick.
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    await Promise.all([
      applyExpertise(msg, "bow", { getActor: () => actor }),
      applyExpertise(msg, "bow", { getActor: () => actor })
    ]);
    assert.equal(commits().length, 1);
    assert.equal(actor.updates.length, 1);
    assert.equal(msg.updates, 1);
  });

  test("double-click on decline -> exactly ONE commit event", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    await Promise.all([
      declineExpertise(msg, { getActor: () => actor }),
      declineExpertise(msg, { getActor: () => actor })
    ]);
    await declineExpertise(msg, { getActor: () => actor });
    assert.equal(commits().length, 1);
  });

  test("a spend AFTER a decline is refused, and cannot rewrite the commit", async () => {
    const actor = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor }));
    await declineExpertise(msg, { getActor: () => actor });
    const out = await applyExpertise(msg, "bow", { getActor: () => actor });
    assert.equal(out.commitReason, "declined");
    assert.equal(actor.updates.length, 0, "no use was spent");
    assert.equal(commits().length, 1);
  });

  test("a non-owner's click is refused — the hook binds on EVERY client", async () => {
    const actor = spendable();
    actor.isOwner = false;
    const owned = spendable();
    const msg = fakeMessage(buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor: owned }));
    const out = await applyExpertise(msg, "bow", { getActor: () => actor });
    assert.equal(out.state, "pending");
    assert.equal(commits().length, 0);
  });

  test("the commit ledger refuses a second event for the same message id", async () => {
    const actor = spendable();
    const r = buildTestResult({ actorId: actor.id, kind: "attack", rawSum: 12, actor });
    const a = fakeMessage(r, "Message.same");
    const b = fakeMessage(r, "Message.same");
    await declineExpertise(a, { getActor: () => actor });
    await declineExpertise(b, { getActor: () => actor });
    assert.equal(commits().length, 1, "same id, one event");
  });
});

// ---------------------------------------------------------------------------
describe("pure commit transforms", () => {
  test("spendExpertise moves the tier, not the total (R:292 improves the RESULT)", () => {
    const next = spendExpertise(pendingResult({ tier: 1, total: 9 }), "athletics");
    assert.equal(next.tier, 2);
    assert.equal(next.total, 9, "the roll did not change");
  });

  test("spendExpertise floors per-target tiers at 3", () => {
    const r = pendingResult({ targets: [{ tokenId: "a", tier: 3, edges: [], banes: [], terminal: "unconscious" }] });
    assert.equal(spendExpertise(r, "athletics").targets[0].tier, 3);
  });

  test("spendExpertise does not mutate its input", () => {
    const r = pendingResult();
    spendExpertise(r, "athletics");
    assert.equal(r.state, "pending");
    assert.equal(r.expertiseSpent, null);
  });

  test("declineResult on an already-committed result returns it unchanged", () => {
    const spent = spendExpertise(pendingResult(), "athletics");
    assert.equal(declineResult(spent).commitReason, "spent");
  });
});

// ---------------------------------------------------------------------------
describe("xRest crit refund (F:714)", () => {
  test("refunds one use of the first feature that has one spent", () => {
    const { xRest, refunded } = xRestRefundOnCrit([
      { name: "Roar", max: 2, used: 0 },
      { name: "Shatter", max: 1, used: 1 }
    ]);
    assert.equal(refunded, "Shatter");
    assert.deepEqual(xRest.map(e => e.used), [0, 0]);
  });

  test("refunds nothing when nothing is spent", () => {
    const { refunded } = xRestRefundOnCrit([{ name: "Roar", max: 2, used: 0 }]);
    assert.equal(refunded, null);
  });

  test("a named refund targets that feature", () => {
    const { xRest, refunded } = xRestRefundOnCrit([
      { name: "Roar", max: 2, used: 2 },
      { name: "Shatter", max: 1, used: 1 }
    ], "Shatter");
    assert.equal(refunded, "Shatter");
    assert.deepEqual(xRest.map(e => e.used), [2, 0]);
  });

  test("an empty or missing list is not an error", () => {
    assert.equal(xRestRefundOnCrit().refunded, null);
    assert.equal(xRestRefundOnCrit(null).refunded, null);
  });
});
