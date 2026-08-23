import { CROWS } from "../config.mjs";
import { resolveEdgesBanes } from "./edges.mjs";
import {
  applyCritXRestRefund,
  emitTestCommitted,
  hasLegalSpend
} from "./expertise.mjs";

/**
 * The Crows test pipeline.
 *
 * TWO INDEPENDENT MODIFIER CHANNELS, and they never mix (R:286):
 *   - `edges` / `banes` are COUNTED, clamped at 2 a side, then resolved by
 *     helpers/edges.mjs into either a ±2 or a ±1 tier shift;
 *   - `mods` are SUMMED. A masterwork tool's +2 is a Mod, not an edge.
 *
 * `conditionNet` — the old Blessed-minus-Boned ±1 on every roll — is GONE.
 * `boned` does not exist in Playtest 2, and Blessed is an EDGE (R:532), not a
 * numeric modifier. Conditions now feed the edge/bane channel; see
 * `selfEdgesBanes` and `targetEdgesBanes`.
 *
 * Everything above `rollTest` is PURE and unit-tested without Foundry.
 */

export function classifyTier(total) {
  if (total <= CROWS.tiers.t1Max) return 1;
  if (total <= CROWS.tiers.t2Max) return 2;
  return 3;
}

export function classifyDoomCrit(rawSum) {
  return {
    doom: CROWS.doomFaces.includes(rawSum),
    crit: CROWS.critFaces.includes(rawSum)
  };
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/**
 * Tier resolution — a chain of EARLY RETURNS, so "terminal" actually terminates.
 *
 * This is the most error-prone thing in the system. The earlier numbered-steps
 * version let a doom against an unconscious target satisfy two contradictory
 * steps at once; here the precedence is the control flow.
 *
 * Returns a TierResolution — the tier-resolution SUBSET only. It has no `state`,
 * `commitReason`, `actorId`, `characteristic`, `kind`, `targets` or
 * `expertiseSpent`; `buildTestResult` assembles those.
 *
 * @param {object}  o
 * @param {number}  o.rawSum    the UNMODIFIED 2d10 sum — never a modified total
 * @param {object}  [o.target]  a plain TargetRef SNAPSHOT, never a Foundry document
 * @param {boolean} [o.autoDoom] R:552 — an unconscious crow's Agi/Str test dooms
 *                               without the dice having to say so
 */
export function resolveTier({
  rawSum,
  charVal = 0,
  mods = [],
  edges = [],
  banes = [],
  kind = "test",
  target = null,
  autoDoom = false
} = {}) {
  const doom = autoDoom || CROWS.doomFaces.includes(rawSum);
  // An auto-doom suppresses the crit even on a raw 19/20: the test is doomed by
  // rule, not by the dice, and leaving `crit` true here would have T1.7 hand out
  // a crit's extra action (R:957) on a failed test.
  const crit = !autoDoom && CROWS.critFaces.includes(rawSum);
  const eb = resolveEdgesBanes(edges, banes);
  const base = { rawSum, charVal, mods: [...mods], eb, doom, crit };

  // (1) Attack against an unconscious target. R:554: "Attacks against you always
  //     achieve a tier 3 result (though the attacker can roll to see if they get
  //     a crit)." That parenthetical narrows what the roll is still FOR — crit
  //     detection — which implies the tier is already settled. So this outranks
  //     doom. `doom` is still reported so the Ref can adjudicate the "major
  //     setback" (R:246) narratively; it does not lower the tier. `crit` stays
  //     live here too, so T1.7 reads the crit's extra action off `crit`, never
  //     off `terminal`.
  if (kind === "attack" && target?.conditions?.unconscious) {
    return { ...base, total: null, tier: 3, terminal: "unconscious" };
  }

  // (2) Doom. Tier 1 "regardless of edges, expertises, and other bonuses"
  //     (R:246). The expertise gate refuses a doom as well.
  if (doom) return { ...base, total: null, tier: 1, terminal: "doom" };

  // (3) Crit. Tier 3 "regardless of banes or other penalties" (R:244).
  if (crit) return { ...base, total: null, tier: 3, terminal: "crit" };

  // (4) Ordinary resolution. `total` is non-null ONLY here — reporting a total on
  //     a terminal path would imply the modifiers mattered, and they did not.
  const total = rawSum + charVal
    + mods.reduce((a, m) => a + (Number(m?.value) || 0), 0)
    + eb.numeric;
  const tier = clamp(classifyTier(total) + eb.tierShift, 1, 3);
  return { ...base, total, tier, terminal: null };
}

// ---------------------------------------------------------------------------
// Conditions -> the edge/bane channel (R:526-558, hint text pinned in lang/en.json)
// ---------------------------------------------------------------------------

/**
 * Edges and banes the ROLLER's own conditions contribute.
 *
 * Blessed  -> edge on all tests (R:532)
 * Weakened -> bane on all tests (R:556)
 * Prone    -> bane on melee attacks (R:540)
 * Unconscious -> DOUBLE bane on Mind tests (R:552). Two entries, because the
 *   channel is counted: one Label is one bane. The rule says "Mind tests to
 *   notice your surroundings"; like Playtest 1 we apply it to all Mind tests
 *   rather than guess at intent from the flavor text.
 *
 * `attack.isMelee` is how the caller distinguishes melee from ranged; absent, an
 * attack is treated as ranged.
 */
export function selfEdgesBanes({ conditions = {}, characteristic = null, kind = "test", attack = null } = {}) {
  const edges = [];
  const banes = [];
  if (conditions.blessed) edges.push({ key: "blessed", label: "Blessed" });
  if (conditions.weakened) banes.push({ key: "weakened", label: "Weakened" });
  if (conditions.prone && kind === "attack" && attack?.isMelee) {
    banes.push({ key: "prone", label: "Prone (melee attack)" });
  }
  if (conditions.unconscious && characteristic === "mind") {
    banes.push({ key: "unconscious", label: "Unconscious (double bane)" });
    banes.push({ key: "unconsciousSecond", label: "Unconscious (double bane)" });
  }
  return { edges, banes };
}

/**
 * Edges and banes ONE TARGET contributes, on attacks only.
 *
 * Grabbed -> attacks against it gain an edge (R:536)
 * Prone   -> melee attacks against it gain an edge, ranged take a bane (R:540)
 * Unconscious is NOT here: it is terminal, handled as early return (1) above.
 *
 * @param {{tokenId: string, conditions: object}} target a plain snapshot
 */
export function targetEdgesBanes(target, { kind = "test", attack = null } = {}) {
  const edges = [];
  const banes = [];
  if (kind !== "attack") return { edges, banes };
  const c = target?.conditions ?? {};
  const source = target?.tokenId;
  if (c.grabbed) edges.push({ key: "targetGrabbed", label: "Target grabbed", source });
  if (c.prone) {
    if (attack?.isMelee) edges.push({ key: "targetProne", label: "Target prone (melee)", source });
    else banes.push({ key: "targetProne", label: "Target prone (ranged)", source });
  }
  return { edges, banes };
}

/** R:552 — an unconscious creature auto-dooms Agility and Strength tests. */
export function autoDoomApplies({ conditions = {}, characteristic = null } = {}) {
  return !!conditions.unconscious && (characteristic === "agility" || characteristic === "strength");
}

// ---------------------------------------------------------------------------
// TestResult assembly + the A1 commit decision
// ---------------------------------------------------------------------------

/**
 * PURE. Assemble a full TestResult, including its initial commit state.
 *
 * MULTI-TARGET (R:961): ONE roll, but per-target edges and banes can resolve to
 * different tiers. `tier` is the BASE resolution — roll-level edges/banes, no
 * target — and describes the roll. `targets[].tier` is what damage reads. Each
 * entry is a separate `resolveTier` call sharing this same `rawSum`.
 *
 * `targets[].edges` / `.banes` hold the FULL effective lists for that target
 * (roll-level plus target-level), so an entry explains its own tier without the
 * card having to re-derive anything.
 *
 * @param {object} o
 * @param {object|null} o.actor  read ONLY to decide whether a legal spend exists
 */
export function buildTestResult({
  actorId = null,
  characteristic = null,
  kind = "test",
  rawSum,
  charVal = 0,
  mods = [],
  edges = [],
  banes = [],
  targets = [],
  attack = null,
  autoDoom = false,
  actor = null
} = {}) {
  const base = resolveTier({ rawSum, charVal, mods, edges, banes, kind, autoDoom });

  const targetEntries = (targets ?? []).filter(Boolean).map(t => {
    const extra = targetEdgesBanes(t, { kind, attack });
    const tEdges = [...edges, ...extra.edges];
    const tBanes = [...banes, ...extra.banes];
    const r = resolveTier({ rawSum, charVal, mods, edges: tEdges, banes: tBanes, kind, target: t, autoDoom });
    return { tokenId: t?.tokenId ?? null, tier: r.tier, edges: tEdges, banes: tBanes, terminal: r.terminal };
  });

  const result = {
    actorId,
    characteristic,
    rawSum: base.rawSum,
    charVal: base.charVal,
    mods: base.mods,
    eb: base.eb,
    total: base.total,
    tier: base.tier,
    doom: base.doom,
    crit: base.crit,
    terminal: base.terminal,
    kind,
    targets: targetEntries,
    expertiseSpent: null,
    state: "pending",
    commitReason: null
  };

  // A1. A terminal result commits on creation — there is no pending window at
  // all, because nothing can change it. So does a result nobody can legally
  // improve; leaving that one pending would strand every downstream effect
  // behind a decision the player cannot make.
  if (base.terminal) {
    result.state = "committed";
    result.commitReason = "terminal";
  } else if (!hasLegalSpend(result, actor)) {
    result.state = "committed";
    result.commitReason = "no-legal-spend";
  }
  return result;
}

/** Flatten the user's current targets into TargetRef snapshots (C10). */
export function snapshotUserTargets() {
  const targets = globalThis.game?.user?.targets ?? [];
  return [...targets].map(t => ({
    tokenId: t?.id ?? null,
    conditions: { ...(t?.actor?.system?.conditions ?? {}) }
  }));
}

// ---------------------------------------------------------------------------
// The Foundry-touching entry point
// ---------------------------------------------------------------------------

/**
 * Roll a Crows test and post its card.
 *
 * The dice roll is a bare `2d10`: `rawSum` is the unmodified sum and every
 * modifier is applied in `resolveTier`, so a modified total can never be mistaken
 * for a doom or a crit.
 *
 * The whole TestResult is stored at `message.flags.crows.test`. The card must be
 * a PURE FUNCTION of that flag — updating the flag re-renders the message
 * (API-NOTES §4), and a late-joining client renders from flags alone.
 *
 * NOTE — the Prepare-for-Task bonus (R:658) is NOT applied here. It matches on a
 * free-text task, which this signature has no way to name; the caller passes it
 * as a Mod. See the T1.1 report.
 *
 * @returns {Promise<object>} the TestResult (also on the message's flags)
 */
export async function rollTest({
  actor = null,
  characteristic = null,
  mods = [],
  edges = [],
  banes = [],
  flavor = "Test",
  attack = null,
  casting = null,
  targets = null
} = {}) {
  const kind = casting ? "casting" : attack ? "attack" : "test";
  const conditions = actor?.system?.conditions ?? {};
  const charVal = characteristic
    ? Number(actor?.system?.characteristics?.[characteristic]?.value ?? 0)
    : 0;

  const self = selfEdgesBanes({ conditions, characteristic, kind, attack });
  const allEdges = [...edges, ...self.edges];
  const allBanes = [...banes, ...self.banes];
  const autoDoom = autoDoomApplies({ conditions, characteristic });
  const refs = targets ?? (kind === "attack" ? snapshotUserTargets() : []);

  const roll = await new Roll("2d10").evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;

  const result = buildTestResult({
    actorId: actor?.id ?? null,
    characteristic, kind, rawSum, charVal,
    mods, edges: allEdges, banes: allBanes,
    targets: refs, attack, autoDoom, actor
  });

  const content = await foundry.applications.handlebars.renderTemplate(
    "systems/crows/templates/chat/test-card.hbs",
    testCardData(result, { flavor, attack, casting })
  );
  const message = await roll.toMessage(
    {
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
      content,
      flags: { crows: { test: result } }
    },
    { rollMode: game.settings.get("core", "rollMode") }
  );

  // F:714 — a crit refunds one spent X/Rest use. A crit always commits on
  // creation (it is terminal, or it is the unconscious-target case which is also
  // terminal), so this runs exactly once per crit.
  if (result.crit && actor) {
    try {
      await applyCritXRestRefund(actor);
    } catch (err) {
      console.warn("crows | crit X/Rest refund failed", err);
    }
  }

  if (result.state === "committed") emitTestCommitted(result, message);
  return result;
}

/**
 * Shape a TestResult for the CURRENT chat card template.
 *
 * T2.2 owns templates/chat/test-card.hbs and rewrites it against the TestResult
 * directly; until then this keeps the existing card renderable. `total` is null
 * on every terminal path, which the old template simply leaves blank.
 */
export function testCardData(result, { flavor = "Test", attack = null, casting = null } = {}) {
  const bandLabel = result.tier === 1 ? "≤11 (Tier 1)"
    : result.tier === 2 ? "12–16 (Tier 2)"
      : "17+ (Tier 3)";
  return {
    flavor,
    tier: result.tier,
    doom: result.doom,
    crit: result.crit,
    total: result.total,
    rawSum: result.rawSum,
    char: result.characteristic,
    charVal: result.charVal,
    skill: null,
    skillBonus: 0,
    mods: result.mods,
    tierForcedNote: result.terminal === "unconscious" ? "target unconscious" : null,
    attack,
    casting,
    bandLabel
  };
}

/**
 * Everything T2.3 must hang off `game.crows` for the probes and the console.
 * One line at the entry point: `Object.assign(game.crows, ROLL_API)`.
 */
export const ROLL_API = Object.freeze({
  classifyTier,
  classifyDoomCrit,
  resolveTier,
  resolveEdgesBanes,
  selfEdgesBanes,
  targetEdgesBanes,
  autoDoomApplies,
  buildTestResult,
  snapshotUserTargets,
  testCardData,
  rollTest
});
