/**
 * Combat resolution, conditions and reactions — Playtest 2.
 *
 * T1.7 owns the condition MECHANICS and the mirror LOGIC. It does NOT own
 * `module/conditions.mjs` (status-effect registration) or `module/crows.mjs`
 * (hook wiring) — those belong to T2.3. Everything this file needs wired is
 * exported; T2.3 calls it. Neither task edits the other's files.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. NOTHING HERE READS A TIER BEFORE COMMIT. Rules that key on "a tier N
 *    result" read the FINAL, post-expertise tier: a miss is DEFINED as a tier 1
 *    result on an attack (R:921), so reading the pre-expertise value would make
 *    the six weapon expertises unable to convert a miss — which is their entire
 *    purpose. So this file subscribes to T1.1's `crowsTestCommitted` and
 *    `attackOutcome()` refuses a `state !== "committed"` result outright.
 *
 * 2. `system.conditions` is AUTHORITATIVE and strictly boolean (R:528 — "You
 *    can't gain a second instance of a condition you already have"). Foundry
 *    status effects MIRROR it. The command flow (CONTRACT §5b) is:
 *      a. a HUD toggle is INTERCEPTED and translated into an update to
 *         `system.conditions.<key>` — the toggle is INTENT, not state;
 *      b. the boolean is canonical, and every rule reads it;
 *      c. an idempotent, LOOP-GUARDED mirror adds/removes the status effect.
 *    Without the guard, (c) re-triggers (a). See `mirrorConditions`.
 *
 * 3. Condition mechanics are NEVER Active Effect `changes`. The roll engine
 *    reads the booleans; this file turns them into Labels. Active Effects stay
 *    correct for durational backlash (R:1561) and magic items, and there v14
 *    takes a STRING `type: "add"` — `CONST.ACTIVE_EFFECT_CHANGE_TYPES` holds
 *    PRIORITIES, not modes (`.add` is 20). See .planning/API-NOTES.md §1.
 *
 * Everything above the "Foundry-facing" banner is pure and unit-tested in
 * test/damage.test.mjs. Everything below it touches documents.
 */

import { CROWS } from "../config.mjs";

/** @typedef {{key: string, label: string, source?: string}} Label */
/** @typedef {{key: string, label: string, value: number}} Mod */

const label = (key, text, source) => (source ? { key, label: text, source } : { key, label: text });
const mod = (key, text, value) => ({ key, label: text, value });

/* ==========================================================================
 * Conditions — vocabulary
 * ========================================================================== */

/**
 * `system.conditions.<key>` -> Foundry status effect id.
 *
 * `defeated` -> `dead` is the ONE id where the two vocabularies differ, and it
 * is a single rule with no actor-type branch because BOTH CrowData and
 * MonsterData now carry `defeated`. Previously only monsters did, so the mirror
 * had nowhere to write for a PC.
 */
export const CONDITION_TO_STATUS = Object.freeze({
  ...Object.fromEntries(CROWS.conditions.map(k => [k, k])),
  defeated: "dead"
});

/** Status effect id -> `system.conditions` key. The inverse of the above. */
export const STATUS_TO_CONDITION = Object.freeze(
  Object.fromEntries(Object.entries(CONDITION_TO_STATUS).map(([k, v]) => [v, k]))
);

/** Every boolean this file will mirror. The six of R:526-558, plus `defeated`. */
export const CONDITION_KEYS = Object.freeze(Object.keys(CONDITION_TO_STATUS));

/**
 * Conditions lost at the end of a dungeon turn (R:532, R:544, R:556). T1.5 owns
 * the dungeon turn itself and calls `expireDungeonTurnConditions`.
 */
export const END_OF_DT_CONDITIONS = Object.freeze(["blessed", "vulnerable", "weakened"]);

/* ==========================================================================
 * Conditions — pure logic
 * ========================================================================== */

/**
 * The idempotent mirror, as data. Returns what would have to change for the
 * status effects to agree with the authoritative booleans — and returns two
 * EMPTY arrays when they already agree, which is what makes the write a no-op
 * and stops (c) from re-triggering (a).
 *
 * @param {object} conditions          `actor.system.conditions`
 * @param {Set<string>|string[]} statuses  `actor.statuses`
 * @returns {{add: string[], remove: string[], inSync: boolean}}
 */
export function conditionMirrorPlan(conditions = {}, statuses = []) {
  const present = statuses instanceof Set ? statuses : new Set(statuses ?? []);
  const add = [];
  const remove = [];
  for (const [key, statusId] of Object.entries(CONDITION_TO_STATUS)) {
    const want = !!conditions?.[key];
    const has = present.has(statusId);
    if (want && !has) add.push(statusId);
    else if (!want && has) remove.push(statusId);
  }
  return { add, remove, inSync: !add.length && !remove.length };
}

/**
 * Flatten an actor into the plain `TargetRef` snapshot `resolveTier` takes
 * (CONTRACT C10 — a Foundry document here would make the whole tier pipeline
 * untestable). The caller flattens; the resolver never sees a document.
 *
 * @returns {{tokenId: string, conditions: object}}
 */
export function targetRef(tokenId, conditions = {}) {
  const flat = {};
  for (const key of CROWS.conditions) flat[key] = !!conditions?.[key];
  return { tokenId: tokenId ?? "", conditions: flat };
}

/* ==========================================================================
 * Edge / bane / modifier sources — pure
 * ========================================================================== */

/**
 * Attacker-side labels: they apply to the whole roll, not to one target.
 *
 * R:532 blessed  -> an EDGE on all tests (never a numeric bonus; the two
 *                   channels are explicitly separate, R:286)
 * R:556 weakened -> a bane on all tests
 * R:542 prone    -> a bane on the MELEE attacks you make
 * R:1023         -> improvised weapons take a bane
 */
export function rollLevelLabels({ conditions = {}, isMelee = true, improvised = false, sourceId } = {}) {
  const edges = [];
  const banes = [];
  if (conditions.blessed) edges.push(label("blessed", "Blessed", sourceId));
  if (conditions.weakened) banes.push(label("weakened", "Weakened", sourceId));
  if (conditions.prone && isMelee) banes.push(label("prone-self", "Prone (melee attack)", sourceId));
  if (improvised) banes.push(label("improvised", "Improvised weapon", sourceId));
  return { edges, banes, mods: [] };
}

/**
 * Per-target labels. R:961: one roll, but "any bonuses, penalties, edges, or
 * banes that apply to individual targets apply only to those targets, which
 * could make the result of a single roll different for each."
 *
 * NOTE the two ranged channels, which are deliberately different (R:286):
 *   beyond normal range   -> a numeric `mod` of -2 per square (R:941)
 *   ranged while adjacent -> a `bane` (R:947)
 * Collapsing either into the other is wrong in both directions: banes clamp at
 * two and stack non-linearly, while mods add.
 *
 * @param {object} t                     the target situation
 * @param {string} t.tokenId
 * @param {object} [t.conditions]        the TARGET's conditions
 * @param {boolean} [t.surprised]        the target's round-1 combat flag
 * @param {boolean} [t.isMelee]
 * @param {number} [t.distance]          squares between attacker and target
 * @param {number} [t.normalRange]       the weapon/spell's normal range in squares
 * @param {boolean} [t.adjacent]         target is adjacent to the attacker
 * @param {boolean} [t.flanking]         attacker is flanking this target (R:965)
 * @param {boolean} [t.highGround]       attacker is >=1 square above (R:973)
 * @param {boolean} [t.cover]            R:757 — half the form blocked
 * @param {""|"light"|"heavy"|"invisible"} [t.concealment]  R:761-771
 */
export function targetLabels({
  tokenId = "",
  conditions = {},
  isMelee = true,
  distance = 0,
  normalRange = 0,
  adjacent = false,
  flanking = false,
  highGround = false,
  cover = false,
  concealment = "",
  surprised = false,
  sourceId
} = {}) {
  const edges = [];
  const banes = [];
  const mods = [];

  // --- the target's own conditions ---------------------------------------
  // R:554 unconscious is NOT a label: it forces tier 3 inside resolveTier, and
  // emitting an edge for it as well would double-count.
  if (conditions.prone) {
    // R:542 — melee attacks against a prone creature gain an edge; ranged take
    // a bane. One condition, opposite signs, chosen by the attack's own kind.
    if (isMelee) edges.push(label("prone-target", "Target prone (melee)", sourceId));
    else banes.push(label("prone-target", "Target prone (ranged)", sourceId));
  }
  // R:536 — attacks against a grabbed creature gain an edge.
  if (conditions.grabbed) edges.push(label("grabbed-target", "Target grabbed", sourceId));
  // R:704 — attacks against a surprised creature gain a flat +1 bonus.
  // This is a numeric modifier, not an edge, and it expires after round 1.
  if (surprised) mods.push(mod("surprised", "Target surprised", 1));

  // --- position ----------------------------------------------------------
  if (flanking && isMelee) edges.push(label("flanking", "Flanking", sourceId));   // R:965, melee only
  if (highGround) edges.push(label("high-ground", "High ground", sourceId));      // R:973, any attack

  // --- line of effect ----------------------------------------------------
  if (cover) banes.push(label("cover", "Target has cover", sourceId));            // R:757
  if (concealment === "light") {
    banes.push(label("concealment", "Light concealment", sourceId));              // R:763
  } else if (concealment === "heavy" || concealment === "invisible") {
    // R:767 / R:771 — a DOUBLE bane, which is two Labels. Invisibility is
    // "treated as heavy concealment", so it is the same two labels.
    const text = concealment === "invisible" ? "Target invisible" : "Heavy concealment";
    banes.push(label("concealment", `${text} (double bane)`, sourceId));
    banes.push(label("concealment-2", `${text} (double bane)`, sourceId));
  }

  // --- ranged geometry ---------------------------------------------------
  if (!isMelee) {
    if (adjacent) banes.push(label("ranged-adjacent", "Ranged attack at an adjacent target", sourceId)); // R:947
    const beyond = Math.max(0, Math.floor(distance) - Math.floor(normalRange));
    if (beyond > 0) {
      // R:941 — "-2 penalty for every 1 square the target is beyond normal
      // range". A PENALTY, not a bane.
      mods.push(mod("range", `Beyond normal range (${beyond} sq)`, -2 * beyond));
    }
  }

  return { tokenId, edges, banes, mods };
}

/**
 * Labels the ROLL PIPELINE already contributes for itself.
 *
 * `rollTest` calls `selfEdgesBanes` on the roller's conditions and
 * `targetEdgesBanes` on each TargetRef, so blessed / weakened / prone / grabbed
 * arrive in the resolution whether this file emits them or not. Emitting them
 * again is not cosmetic: edges and banes are COUNTED and clamp at two, so one
 * duplicated edge is the difference between +2 on the total and a whole tier
 * shift. `buildAttackLabels` therefore drops these by default and contributes
 * only what the roll pipeline cannot see — position, cover, geometry.
 *
 * The functions above still emit them, because they are the complete statement
 * of the rules and are tested as such.
 */
export const ROLL_PIPELINE_LABEL_KEYS = Object.freeze([
  "blessed", "weakened", "prone-self", "prone-target", "grabbed-target"
]);

const dropPipelineLabels = (list) => list.filter(l => !ROLL_PIPELINE_LABEL_KEYS.includes(l.key));

/**
 * Assemble one attack's whole label set: roll-level from the attacker, and one
 * entry per target.
 *
 * CONTRACT GAP, surfaced rather than papered over: `TestResult` carries
 * `mods` at the ROLL level only, while `targets[]` carries just `edges`/`banes`
 * — so a numeric per-target modifier (the range penalty) has nowhere to live on
 * a multi-target attack. With a single target (every weapon attack) the target's
 * mods are merged into the roll-level `mods`, which is exactly right. With more
 * than one target carrying mods, they stay in `targets[].mods` and a warning is
 * emitted so the caller cannot lose them silently.
 *
 * SECOND GAP, same shape: `rollTest` builds each `targets[]` entry from the
 * roll-level lists plus the target's own CONDITIONS, and has no parameter for a
 * caller-supplied per-target edge. Flanking, high ground, cover and concealment
 * are all per-target, so on a single-target attack they are passed at roll level
 * — which resolves identically, since one target inherits every roll-level
 * label. On a multi-target attack they would wrongly apply to every target, so
 * they stay in `targets[]` and a warning is emitted instead.
 *
 * @param {boolean} [includeConditionLabels=false] emit the labels the roll
 *        pipeline already contributes. Only for testing the rules in isolation;
 *        passing them to `rollTest` double-counts them.
 */
export function buildAttackLabels({
  attacker = {},
  isMelee = true,
  improvised = false,
  normalRange = 0,
  targets = [],
  includeConditionLabels = false
} = {}) {
  const keep = includeConditionLabels ? (l => l) : dropPipelineLabels;

  const rollRaw = rollLevelLabels({
    conditions: attacker.conditions ?? {},
    isMelee,
    improvised,
    sourceId: attacker.id
  });
  const roll = { mods: rollRaw.mods, edges: keep(rollRaw.edges), banes: keep(rollRaw.banes) };

  const resolved = targets.map(t => {
    const raw = targetLabels({
      ...t,
      isMelee: t.isMelee ?? isMelee,
      normalRange: t.normalRange ?? normalRange,
      sourceId: attacker.id
    });
    return { ...raw, edges: keep(raw.edges), banes: keep(raw.banes) };
  });

  const mods = [...roll.mods];
  const edges = [...roll.edges];
  const banes = [...roll.banes];
  const warnings = [];
  if (resolved.length === 1) {
    // One target inherits every roll-level label, so promoting its situational
    // ones is exact rather than an approximation.
    mods.push(...resolved[0].mods);
    edges.push(...resolved[0].edges);
    banes.push(...resolved[0].banes);
  } else {
    const carrying = resolved.filter(t => t.mods.length || t.edges.length || t.banes.length);
    if (carrying.length) {
      warnings.push(
        `rollTest takes edges/banes/mods at roll level only: ${carrying.length} target(s) carry a ` +
        `situational modifier that cannot be routed per-target. Read targets[].`
      );
    }
  }

  return { mods, edges, banes, targets: resolved, warnings };
}

/* ==========================================================================
 * Reactions — pure
 * ========================================================================== */

/** The four triggers that open a counter window (R:983). */
export const COUNTER_TRIGGERS = Object.freeze(["melee-attack", "grab", "knockback", "escape-grab"]);

/**
 * R:983 — Counter. "When a creature or object within reach of a melee weapon
 * you are currently wielding makes a melee attack against you, uses the Grab or
 * Knockback maneuver while targeting you, or attempts to escape being grabbed
 * by you with the Escape Grab maneuver and gets a tier 1 result, you can use
 * your reaction to counter attack... you deal the tier 2 result of the weapon
 * you're wielding... If the triggering test result was doom, you deal the tier 3
 * result instead. If a creature making an opportunity attack against you gets a
 * tier 1 result, you can't counter them."
 *
 * The tier read here MUST be the committed one — an expertise spent on the
 * attack can lift it out of tier 1 and close this window entirely.
 *
 * @param {object} p
 * @param {object} p.trigger   {kind, tier, doom}
 * @param {object} p.defender  {wieldingMelee, withinReach, reactionsRemaining, conditions}
 * @returns {{canCounter: boolean, reason: string|null, damageTier: 2|3|null}}
 */
export function counterOpportunity({ trigger = {}, defender = {} } = {}) {
  const no = (reason) => ({ canCounter: false, reason, damageTier: null });

  // R:955 — "If you get a tier 1 result on an opportunity attack, the target
  // can't counter you." Checked BEFORE the tier, so the reason names the rule
  // that actually applies rather than an incidental one.
  if (trigger.kind === "opportunity-attack") return no("an opportunity attack can't be countered");
  if (!COUNTER_TRIGGERS.includes(trigger.kind)) return no("not a countering trigger");
  if (trigger.tier !== 1) return no("the trigger wasn't a tier 1 result");

  const c = defender.conditions ?? {};
  if (c.unconscious) return no("unconscious creatures can't take reactions");
  if ((defender.reactionsRemaining ?? 1) < 1) return no("no reaction remaining");
  if (defender.wieldingMelee === false) return no("no melee weapon wielded");
  if (defender.withinReach === false) return no("the trigger is out of reach");

  // The doom is the TRIGGER's, not the counterer's — the counter is not itself
  // a test, so it has no doom of its own to read.
  return { canCounter: true, reason: null, damageTier: trigger.doom ? 3 : 2 };
}

/**
 * R:943 / R:945 — a ranged MISS with allies adjacent to the target.
 *
 * "If you miss on a ranged attack and the target was adjacent to one or more
 * allies, roll any die. On an odd result, the attack hits one of those allies
 * chosen randomly by the Ref. You deal the tier 2 damage..." and "If you rolled
 * a doom on a ranged attack while at least one ally is adjacent to your target,
 * you hit one of those allies... and deal the tier 3 damage."
 *
 * DECISION (not covered by the contract): a doom is also a tier 1 result, so
 * both sentences match it. They are read as one escalating rule, not two —
 * the doom's automatic tier 3 hit REPLACES the odd-die tier 2 check rather than
 * stacking with it. Two hits from one arrow has no support in the text.
 *
 * `die` and `pickIndex` are injected rather than rolled here so the rule is
 * testable; the Foundry wrapper supplies them.
 */
export function rangedMissConsequence({
  isRanged = false,
  tier = null,
  doom = false,
  alliesAdjacent = [],
  die = null,
  pickIndex = 0
} = {}) {
  const no = (reason) => ({ hitsAlly: false, allyId: null, damageTier: null, automatic: false, reason });
  if (!isRanged) return no("not a ranged attack");
  if (tier !== 1) return no("not a miss");
  if (!alliesAdjacent.length) return no("no allies adjacent to the target");

  const allyId = alliesAdjacent[Math.abs(pickIndex) % alliesAdjacent.length] ?? null;
  if (doom) return { hitsAlly: true, allyId, damageTier: 3, automatic: true, reason: null };  // R:945
  if (die == null) return no("no die rolled");
  const odd = Math.abs(Math.floor(die)) % 2 === 1;
  return odd
    ? { hitsAlly: true, allyId, damageTier: 2, automatic: false, reason: null }   // R:943
    : no("the die came up even");
}

/**
 * R:957 — "When you get a crit on an attack, you get another action that you
 * must use immediately if this action is gained on a turn other than yours."
 *
 * Read `crit`, NOT `terminal === "crit"`: R:554 keeps the crit roll live against
 * an unconscious target, where `terminal` is "unconscious" and the crit would
 * otherwise be swallowed.
 */
export function critConsequences({ crit = false, onOwnTurn = true } = {}) {
  if (!crit) return { extraAction: false, mustUseImmediately: false };
  return { extraAction: true, mustUseImmediately: !onOwnTurn };
}

/**
 * C:2140 — Silent armor: "+1 bonus to tests made to hide and sneak. If you get
 * a tier 1 result on a test made to hide or sneak, you are weakened."
 *
 * CONTRACT GAP: `TestResult` has no way to say "this was a hide or sneak test"
 * — `kind` is only test/attack/casting — so this rule cannot fire off the
 * committed result alone. The caller must mark the roll; see `onTestCommitted`.
 */
export function silentArmorConsequence({ wearingSilent = false, isHideOrSneak = false, tier = null } = {}) {
  if (!wearingSilent || !isHideOrSneak) return { weakened: false, mods: [] };
  return { weakened: tier === 1, mods: [mod("silent-armor", "Silent armor", 1)] };
}

/* ==========================================================================
 * Attack outcome — pure
 * ========================================================================== */

/**
 * Turn a COMMITTED `TestResult` into what happens to each target.
 *
 * Reads `targets[].tier`, never the message-level `tier`: R:961 gives one roll
 * whose per-target edges and banes can resolve to DIFFERENT tiers, and the
 * roll-level tier only describes the roll.
 *
 * Refuses a pending result outright. That is the A1 commit point: a weapon
 * expertise can lift a tier 1 into a hit, so anything that fires early
 * adjudicates a miss that never happened.
 *
 * @param {object} result  a TestResult
 * @param {object} attack  {t2, t3, isMelee, piercing, weaponName, blessedBonus, alliesAdjacent}
 */
export function attackOutcome(result, attack = {}) {
  if (!result) return { ok: false, reason: "no result" };
  if (result.state !== "committed") {
    return { ok: false, reason: "test is still pending — nothing may read a tier before commit" };
  }

  const bonus = Math.max(0, Math.floor(Number(attack.blessedBonus) || 0));
  const damageFor = (tier) => {
    const base = tier === 3 ? attack.t3 : tier === 2 ? attack.t2 : 0;
    const n = Number(base);
    // A formula that would not evaluate (a missing characteristic, say) is
    // passed through untouched so the card can still show it; adding a number
    // to it would produce string concatenation and a nonsense damage figure.
    if (!Number.isFinite(n)) return base ?? 0;
    return Math.max(0, n + bonus);
  };

  const entries = (result.targets?.length ? result.targets : [{ tokenId: null, tier: result.tier }]);
  const targets = entries.map(t => {
    const hit = t.tier >= 2;                       // R:921 — tier 1 IS the miss
    return {
      tokenId: t.tokenId ?? null,
      tier: t.tier,
      hit,
      miss: !hit,
      damage: hit ? damageFor(t.tier) : 0,
      piercing: !!attack.piercing,
      // R:997 — "If you miss [a melee attack], the target of the attack can
      // counter." The window is offered; whether it can actually be taken is
      // counterOpportunity()'s call, and it needs the defender's own state.
      counterWindow: !hit && attack.isMelee !== false && result.kind === "attack"
    };
  });

  const crit = critConsequences({ crit: !!result.crit, onOwnTurn: attack.onOwnTurn ?? true });

  // R:943/R:945 — the stray-ally hit is a property of the ROLL (one arrow), so
  // it is evaluated once against the first missed target.
  const missed = targets.find(t => t.miss);
  const stray = rangedMissConsequence({
    isRanged: attack.isMelee === false,
    tier: missed?.tier ?? null,
    doom: !!result.doom,
    alliesAdjacent: attack.alliesAdjacent ?? [],
    die: attack.strayDie ?? null,
    pickIndex: attack.strayPick ?? 0
  });

  return {
    ok: true,
    kind: result.kind,
    targets,
    crit: !!result.crit,
    extraAction: crit.extraAction,
    extraActionImmediate: crit.mustUseImmediately,
    stray: stray.hitsAlly
      ? { allyId: stray.allyId, damageTier: stray.damageTier, damage: damageFor(stray.damageTier), automatic: stray.automatic }
      : null,
    strayReason: stray.hitsAlly ? null : stray.reason
  };
}

/* ==========================================================================
 * Foundry-facing. Everything below touches documents.
 * ========================================================================== */

const _mirroring = new Set();

const _uuidOf = (actor) => actor?.uuid ?? actor?.id ?? null;

/**
 * True while THIS module is writing a status effect. The interception path
 * checks it and stands aside, which is the loop guard: without it the mirror's
 * own write looks exactly like a HUD toggle and re-enters step (a) forever.
 */
export function isMirroring(actor) {
  const id = _uuidOf(actor);
  return id != null && _mirroring.has(id);
}

/**
 * Step (c). Bring the token HUD's status effects into agreement with the
 * authoritative booleans. Idempotent by construction — `conditionMirrorPlan`
 * returns nothing to do when they already agree, and this returns without a
 * single write.
 */
export async function mirrorConditions(actor) {
  if (!actor) return { ok: false, reason: "no actor" };
  const plan = conditionMirrorPlan(actor.system?.conditions ?? {}, actor.statuses ?? new Set());
  if (plan.inSync) return { ok: true, changed: false, ...plan };

  const id = _uuidOf(actor);
  if (id != null) _mirroring.add(id);
  try {
    for (const statusId of plan.add) await actor.toggleStatusEffect?.(statusId, { active: true });
    for (const statusId of plan.remove) await actor.toggleStatusEffect?.(statusId, { active: false });
  } catch (err) {
    console.warn("crows | condition mirror failed", err);
    return { ok: false, changed: false, ...plan, error: String(err) };
  } finally {
    if (id != null) _mirroring.delete(id);
  }
  return { ok: true, changed: true, ...plan };
}

/**
 * Step (b). The ONLY supported way to change a condition. Strictly boolean:
 * R:528 says you cannot gain a second instance of a condition you already have,
 * so setting a condition you already have is a no-op, not an increment.
 */
export async function setCondition(actor, key, active = true) {
  if (!actor) return { ok: false, reason: "no actor" };
  if (!(key in CONDITION_TO_STATUS)) return { ok: false, reason: `unknown condition "${key}"` };
  const current = !!actor.system?.conditions?.[key];
  const next = !!active;
  if (current !== next) await actor.update({ [`system.conditions.${key}`]: next });
  const mirror = await mirrorConditions(actor);
  return { ok: true, key, active: next, changed: current !== next, mirror };
}

/**
 * Step (a). A Token HUD toggle is INTENT: translate it into a write to the
 * canonical boolean and let the mirror put the effect back.
 *
 * T2.3 wires this from the status-effect lifecycle and cancels core's own write
 * when `handled` comes back true. It must pass through untouched while
 * `isMirroring(actor)` — that write is ours.
 *
 * @returns {{handled: boolean, key?: string, reason?: string}}
 */
export async function handleStatusToggleIntent(actor, statusId, active) {
  if (!actor) return { handled: false, reason: "no actor" };
  if (isMirroring(actor)) return { handled: false, reason: "our own mirror write" };
  const key = STATUS_TO_CONDITION[statusId];
  if (!key) return { handled: false, reason: `"${statusId}" is not a crows condition` };
  await setCondition(actor, key, active);
  return { handled: true, key };
}

/**
 * R:532/R:544/R:556 — blessed, vulnerable and weakened are lost at the end of a
 * dungeon turn. T1.5 owns the dungeon turn and calls this.
 */
export async function expireDungeonTurnConditions(actor) {
  if (!actor) return { ok: false, reason: "no actor" };
  const c = actor.system?.conditions ?? {};
  const expired = END_OF_DT_CONDITIONS.filter(k => c[k]);
  if (!expired.length) return { ok: true, expired: [] };
  await actor.update(Object.fromEntries(expired.map(k => [`system.conditions.${k}`, false])));
  await mirrorConditions(actor);
  return { ok: true, expired };
}

/**
 * C:2140 — does this actor wear Silent armor?
 *
 * The field stores catalogue keys, so this helper only recognizes the explicit
 * `silent` key and does not infer an enchantment from an item's display name.
 */
export function wearsSilentArmor(actor) {
  for (const i of actor?.items ?? []) {
    if (i.type !== "armor" || !i.system?.worn) continue;
    // Silent is an armor ENCHANTMENT (C:1908, table row at C:1933). Item data
    // stores stable catalogue keys, so this is an identity check rather than a
    // name comparison that can be defeated by capitalization or whitespace.
    if ((i.system?.enchantments ?? []).includes("silent")) return true;
  }
  return false;
}

/**
 * The `crowsTestCommitted` subscriber — the ONLY place this module learns a
 * tier. T1.1 emits it on commit and only on commit.
 *
 * It does not apply damage by itself. Which target eats a hit is a Ref
 * decision, the chat card (T2.2) owns the Apply button, and auto-applying from
 * a hook would fire once per connected client. It computes the outcome, applies
 * the consequences that are unambiguously the ROLLER's own (Silent armor), and
 * re-emits `crowsAttackResolved` for the card. Pass `autoApply: true` when
 * wiring if a world wants the damage applied for it.
 *
 * THE PAYLOAD COMES OFF THE RESULT, NOT OFF THE SECOND ARGUMENT. T1.1 emits
 * `crowsTestCommitted(result, message)` — a ChatMessage, not a context object —
 * so an `attack` read from the second argument is ALWAYS undefined and every
 * damage figure would be computed from `{}`. `TestResult` now carries `attack`
 * and `casting` through to commit, which is the supported route; `ctx.attack`
 * survives only for a direct programmatic call.
 *
 * @param {object} result   the committed TestResult
 * @param {object} [ctx]    {actor, attack, tags, autoApply, message}
 */
export async function onTestCommitted(result, ctx = {}) {
  if (result?.state !== "committed") return { ok: false, reason: "not committed" };
  const actor = ctx.actor ?? _actorFromId(result.actorId);

  // C:2140. `tags` is this module's own extension, because TestResult cannot
  // say "this was a hide or sneak test" — see silentArmorConsequence.
  const tags = ctx.tags ?? result.tags ?? [];
  const isHideOrSneak = tags.includes("hide") || tags.includes("sneak");
  if (actor && isHideOrSneak) {
    const silent = silentArmorConsequence({
      wearingSilent: wearsSilentArmor(actor),
      isHideOrSneak,
      tier: result.tier
    });
    if (silent.weakened) await setCondition(actor, "weakened", true);
  }

  if (result.kind !== "attack") return { ok: true, outcome: null };

  const attack = ctx.attack ?? result.attack ?? {};
  const outcome = attackOutcome(result, attack);
  if (!outcome.ok) return outcome;

  if (ctx.autoApply) {
    const { applyDamage } = await import("./damage.mjs");
    for (const t of outcome.targets) {
      if (!t.hit || !t.tokenId) continue;
      const target = _actorFromTokenId(t.tokenId);
      if (target) await applyDamage(target, t.damage, { piercing: t.piercing, source: attack.weaponName });
    }
  }

  globalThis.Hooks?.callAll?.("crowsAttackResolved", result, outcome);
  return { ok: true, outcome };
}

/**
 * T2.3 calls this from `ready`. Binding lives here rather than in crows.mjs
 * only for the handler; the registration call itself is T2.3's to make.
 */
export function registerCombatHooks({ autoApply = false } = {}) {
  // T1.1's emitter signature is `(result, message)`. The second argument is a
  // ChatMessage, so it is named as one and never spread into the context — the
  // payload is read off the result. See onTestCommitted.
  globalThis.Hooks?.on?.("crowsTestCommitted", (result, message) =>
    onTestCommitted(result, { message, autoApply }));
}

function _actorFromId(actorId) {
  if (!actorId) return null;
  return globalThis.game?.actors?.get?.(actorId) ?? null;
}

function _actorFromTokenId(tokenId) {
  if (!tokenId) return null;
  const canvasToken = globalThis.canvas?.tokens?.get?.(tokenId);
  if (canvasToken?.actor) return canvasToken.actor;
  return globalThis.fromUuidSync?.(tokenId)?.actor ?? null;
}
