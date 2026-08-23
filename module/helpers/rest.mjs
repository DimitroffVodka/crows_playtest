/**
 * Rest — PLAYTEST 2 (R:626-680).
 *
 * Six uninterrupted hours, at least four asleep, one ration consumed. A
 * completed rest restores ALL Stamina, ALL expertise uses, resets every trait
 * use pool, and removes ONE wound of the player's choice.
 *
 * Four things in here cost the design four adversarial review rounds. None of
 * them is an implementation detail; each is a rule that a "simplification"
 * silently breaks.
 *
 * 1. THE EXPERTISE REFRESH WRITES `value`, NEVER `max`.
 *    R:294 gives an expertise three quantities, and CONTRACT §2 stores two of
 *    them: `value` (uses remaining) and `max` (uses OWNED). Rest is
 *    `value = max`. Writing `max` would mint permanent uses out of a night's
 *    sleep; writing the derived `expertiseCap` would mint uses nobody bought.
 *    Only advancement (C:615) raises `max`.
 *
 * 2. THE MIASMA SUPPRESSES THE EXPERTISE REFRESH AND NOTHING ELSE.
 *    R:1375: resting in the Miasma does not restore expertise uses; every other
 *    effect of the rest applies normally. `value` is left EXACTLY as it is —
 *    not zeroed, not partially restored. This rule is the proof that the
 *    two-field model was mandatory: with a single mutable count there is no
 *    state that means "keep what you have and remember what you own", so the
 *    suppression is literally inexpressible. Do not collapse it back.
 *
 * 3. TRAIT USE POOLS RESET ON THE SAME REST, AND THE MIASMA DOES NOT STOP THEM.
 *    Four published traits are per-rest pools sized by a characteristic —
 *    C:921 (benefaction, Mind), C:1361 (knowledge, Mind), C:1501 (necromancy,
 *    Mind) and C:1739 (armor, AGILITY, the one an earlier count missed). Every
 *    one says "regaining all uses when you finish a rest", and NOTHING ELSE in
 *    the system resets them. R:1375 names expertises only, so a trait pool
 *    refreshes in the Miasma.
 *
 *    `used` is stored, not `remaining`, because the pool SIZE is derived from a
 *    characteristic and can move underneath you. So `overused` is reachable
 *    without cheating — spend at Mind 3, take a Mind drain to 1 — and it is
 *    REPORTED, never refunded. Nothing here clamps `used` downward.
 *
 * 4. THE WOUND REMOVED IS THE PLAYER'S CHOICE.
 *    R:524 puts wounds in specific backpack slots, so "remove a wound" is a
 *    positional act, not a decrement. The candidate slots come from T1.2's
 *    `layoutFor()`; this file does not compute slots.
 *
 * Everything above the Foundry section is pure and unit-tested in
 * test/rest.test.mjs.
 */

import { CROWS } from "../config.mjs";
import {
  endDungeonTurnForRest, runEndOfDtEffects, rollEncounterCheck, getDT
} from "./dungeon-turn.mjs";

// --- shape -----------------------------------------------------------------

/** R:626. */
export const REST_HOURS = 6;
export const REST_SLEEP_HOURS = 4;
/** R:668 — a check every two hours across the six. */
export const REST_ENCOUNTER_CHECK_HOURS = [2, 4, 6];
/** R:630 — end-of-DT effects fire at the halfway point. */
export const REST_HALFWAY_HOUR = REST_HOURS / 2;

/** R:678 — town activities, no sleeping, ~2h each. */
export const TOWN_ACTIVITY_LIMIT = 4;
export const TOWN_ACTIVITY_HOURS = 2;

/**
 * The rest activities (R:646-676). Repair Armor and Seclude Camp are new in
 * Playtest 2; Prepare for Task and Tend Wounds changed.
 *
 *  - `groupUnique`      only one member of the group may take it this rest.
 *  - `requiresTarget`   needs another creature.
 *  - `needsCompletion`  the benefit lands only if the rest is finished.
 *  - `townSleep`        in town it still costs four hours' sleep, so it does NOT
 *                       come out of the four no-sleep activities (R:678).
 */
export const REST_ACTIVITIES = {
  none:           { label: "No activity",      needsCompletion: false },
  tendWounds:     { label: "Tend Wounds",      needsCompletion: true,  requiresTarget: true, townSleep: true, oncePerDayInTown: true },
  identifyItem:   { label: "Identify Item",    needsCompletion: true },
  prepareForTask: { label: "Prepare for Task", needsCompletion: true },
  craftEquipment: { label: "Craft Equipment",  needsCompletion: true },
  harvest:        { label: "Harvest",          needsCompletion: true },
  repairArmor:    { label: "Repair Armor",     needsCompletion: true },
  // R:672 — "one person per group", and explicitly does NOT require finishing
  // the rest, because its whole point is to make the rest likelier to finish.
  secludeCamp:    { label: "Seclude Camp",     needsCompletion: false, groupUnique: true }
};

export const REST_ACTIVITY_KEYS = Object.keys(REST_ACTIVITIES);

function normaliseActivity(activity) {
  return REST_ACTIVITIES[activity] ? activity : "none";
}

export function activityLabel(activity) {
  return REST_ACTIVITIES[activity]?.label ?? activity;
}

// --- pure: expertise refresh (R:628, R:1375) --------------------------------

/**
 * The update paths that restore expertise uses.
 *
 * Writes `value` only, and only where it actually differs from `max`, so a
 * rested character produces an empty update rather than 30 no-op writes.
 *
 * In the Miasma this returns `{}` — NOT a set of writes that happen to be
 * no-ops, and not a partial restore. `value` is untouched, whatever it is.
 *
 * @param {object} expertises  actor.system.expertises
 * @param {{inMiasma?: boolean}} [opts]
 * @returns {Record<string, number>} dotted update paths → new value
 */
export function expertiseRefreshUpdates(expertises = {}, { inMiasma = false } = {}) {
  if (inMiasma) return {};
  const updates = {};
  for (const [key, ex] of Object.entries(expertises ?? {})) {
    const max = Number(ex?.max) || 0;
    const value = Number(ex?.value) || 0;
    if (value === max) continue;
    updates[`system.expertises.${key}.value`] = max;
  }
  return updates;
}

// --- pure: trait use pools (CONTRACT §5) ------------------------------------

/**
 * Resolve a trait's per-rest pool against the owner's characteristics.
 *
 * `Math.max(0, …)` on `max` matters: R:174 allows a characteristic down to −5,
 * and a negative pool is not an error state — it means the trait simply cannot
 * be used tonight.
 *
 * @param {object} usePool  trait.system.usePool — {sizedBy, fixedMax, used}
 * @param {object} characteristics  actor.system.characteristics
 * @returns {{max:number, used:number, remaining:number, overused:number, sizedBy:string}}
 */
export function traitPoolState(usePool = {}, characteristics = {}) {
  const sizedBy = usePool?.sizedBy || "";
  const used = Math.max(0, Number(usePool?.used) || 0);
  const max = sizedBy
    ? Math.max(0, Number(characteristics?.[sizedBy]?.value) || 0)
    : Math.max(0, Number(usePool?.fixedMax) || 0);
  return {
    sizedBy, max, used,
    remaining: Math.max(0, max - used),
    // Reachable by a stat drain, never by cheating. Reported, never refunded —
    // clamping `used` down here would silently hand back a spent use.
    overused: Math.max(0, used - max)
  };
}

/**
 * Embedded-item updates that reset every trait use pool (R:628).
 *
 * NOT gated on the Miasma — R:1375 names expertises and nothing else.
 *
 * `used` is only ever written to 0, and only when it is not already 0. That is
 * the sole direction this function moves it in: a pool whose owner's
 * characteristic dropped is `overused`, and this reset is what clears that,
 * not a clamp at read time.
 *
 * @param {Iterable} items  the actor's items (any iterable of Item-likes)
 * @returns {Array<object>} updateEmbeddedDocuments("Item", …) payloads
 */
export function traitPoolResetUpdates(items = []) {
  const updates = [];
  for (const item of items ?? []) {
    if (item?.type !== "trait") continue;
    const pool = item?.system?.usePool;
    if (!pool) continue;
    // A pool that was never configured (no sizedBy, no fixedMax) is not a pool.
    if (!pool.sizedBy && !(Number(pool.fixedMax) > 0)) continue;
    if ((Number(pool.used) || 0) === 0) continue;
    const id = item.id ?? item._id;
    if (!id) continue;
    updates.push({ _id: id, "system.usePool.used": 0 });
  }
  return updates;
}

// --- pure: wounds (R:524, R:628, R:670) -------------------------------------

/**
 * Which backpack indices currently hold a wound, ascending.
 *
 * Reads T1.2's Layout rather than `system.woundSlots` so that orphaned wounds —
 * indices beyond the actor's capacity, which CrowData preserves and reports —
 * are not offered as removable slots that do not exist.
 */
export function woundCandidatesFromLayout(layout) {
  return (layout?.slots ?? [])
    .filter(s => s.container === "backpack" && s.wound)
    .map(s => s.index)
    .sort((a, b) => a - b);
}

/**
 * Choose which wounds a rest removes.
 *
 * The choice is the PLAYER'S (R:628). When the caller supplies none and more
 * than one is available, this picks the LOWEST index and sets `autoChosen`, so
 * a UI can tell the difference between "the player picked slot 3" and "nobody
 * asked". Lowest, because a low backpack slot is the reachable one — R:478
 * succeeds on 1d10 >= the slot number, so freeing slot 1 is worth more than
 * freeing slot 10. That is a fallback, not the interface: T2.1 should ask.
 *
 * @param {number[]} candidates  from woundCandidatesFromLayout()
 * @param {number[]|null} choices  player-chosen indices
 * @param {number} count  1 normally, 2 when tended (R:670)
 * @returns {{ok:boolean, error?:string, removed:number[], remaining:number[], autoChosen:boolean}}
 */
export function resolveWoundRemoval(candidates = [], choices = null, count = 1) {
  const pool = [...new Set((candidates ?? []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  const want = Math.max(0, Math.floor(Number(count) || 0));

  if (!pool.length || !want) {
    return { ok: true, removed: [], remaining: pool, autoChosen: false };
  }

  const picked = [];
  for (const raw of choices ?? []) {
    const i = Number(raw);
    if (!pool.includes(i)) {
      return { ok: false, error: `slot ${raw} does not hold a wound`, removed: [], remaining: pool, autoChosen: false };
    }
    if (!picked.includes(i)) picked.push(i);
    if (picked.length === want) break;
  }

  const autoChosen = picked.length < Math.min(want, pool.length);
  for (const i of pool) {
    if (picked.length >= want) break;
    if (!picked.includes(i)) picked.push(i);
  }

  const removed = picked.slice(0, want).sort((a, b) => a - b);
  return {
    ok: true, removed,
    remaining: pool.filter(i => !removed.includes(i)),
    autoChosen
  };
}

// --- pure: Tend Wounds (R:670) ----------------------------------------------

/**
 * Tend Wounds is the one activity with hard targeting rules, and both of them
 * are new in Playtest 2: the target must have at least TWO wounds, and it can
 * never be the character performing it.
 */
export function validateTendWounds({ actorId = "", targetId = "", targetWounds = 0 } = {}) {
  if (!targetId) return { ok: false, error: "Tend Wounds needs a target." };
  if (actorId && targetId === actorId) return { ok: false, error: "Tend Wounds cannot target yourself (R:670)." };
  if ((Number(targetWounds) || 0) < 2) {
    return { ok: false, error: "Tend Wounds needs a target with at least 2 wounds (R:670)." };
  }
  return { ok: true };
}

// --- pure: harvest (R:652) --------------------------------------------------

/**
 * Generic monster parts by corpse size. Playtest 2 dropped the specific-organ
 * table; the size is the only input now.
 */
export function harvestFormula(size) {
  const key = String(size ?? "").trim();
  return CROWS.harvestDice[key] ?? null;
}

// --- pure: blocking (R:460) -------------------------------------------------

/**
 * Two magic items in one magic slot means you cannot rest at all (R:460). The
 * flag is T1.2's — this only consumes it.
 */
export function restBlockedReason({ magicOverload = false } = {}) {
  if (magicOverload) {
    return "Magic item slot overload — two items in one slot. You cannot rest until one is removed (R:460).";
  }
  return null;
}

// --- pure: the group rest session -------------------------------------------

/**
 * A rest is a GROUP event but `takeRest` is per-actor, so two rules need a
 * scratchpad shared across the calls that make up one night:
 *
 *   - Seclude Camp is "one person per group" (R:672);
 *   - Tend Wounds is performed BY one character ON another, and it makes the
 *     TARGET'S rest remove 2 wounds instead of 1 (R:670) — so the two calls
 *     can arrive in either order and must converge on 2 either way.
 *
 * A plain object, reduced by pure functions, so both rules are testable without
 * a world.
 */
export function newRestSession(id = "") {
  return { id: String(id || ""), rested: [], claims: {}, tended: [] };
}

/**
 * Claim an activity for this rest.
 *
 * An actor who has already rested in this session is starting a NEW rest, so
 * the session rolls over rather than reporting a bogus double-claim.
 */
export function claimRestActivity(session, { actorId = "", activity = "none" } = {}) {
  let next = session ?? newRestSession();
  const key = normaliseActivity(activity);

  if (next.rested.includes(actorId)) next = newRestSession(next.id);
  else next = { ...next, claims: { ...next.claims }, rested: [...next.rested], tended: [...next.tended] };

  const spec = REST_ACTIVITIES[key];
  if (spec?.groupUnique) {
    const holder = next.claims[key];
    if (holder && holder !== actorId) {
      return { ok: false, session: next, error: `${spec.label} is one person per group (R:672) — already taken this rest.` };
    }
  }
  if (key !== "none") next.claims[key] = actorId;
  return { ok: true, session: next };
}

/** Record that `targetId` is being tended tonight. */
export function markTended(session, targetId) {
  const next = session ?? newRestSession();
  if (!targetId || next.tended.includes(targetId)) return next;
  return { ...next, tended: [...next.tended, targetId] };
}

/** Record that `actorId` has now taken their rest. */
export function markRested(session, actorId) {
  const next = session ?? newRestSession();
  if (!actorId || next.rested.includes(actorId)) return next;
  return { ...next, rested: [...next.rested, actorId] };
}

/** R:670 — a tended character loses 2 wounds instead of 1, not 2 on top of 1. */
export function woundRemovalCount(session, actorId) {
  return (session?.tended ?? []).includes(actorId) ? 2 : 1;
}

/** Did anyone in this rest take Seclude Camp? Its EN −1 is group-wide. */
export function sessionHasSecludeCamp(session) {
  return Boolean(session?.claims?.secludeCamp);
}

// --- pure: town activities (R:678) ------------------------------------------

/**
 * In town you may take up to four rest activities a day WITHOUT sleeping, each
 * about two hours, and each benefit lands when its two hours are up rather than
 * at the end of a rest.
 *
 * Tend Wounds is carved out: it still needs four hours' sleep and is once per
 * day. It therefore does NOT consume one of the four — the four are explicitly
 * the no-sleep activities.
 *
 * @param {object} record  { [day]: { [actorId]: { count, tendWounds } } }
 * @returns {{ok:boolean, error?:string, record:object, hours:number, landsAfterHours:number}}
 */
export function townActivityClaim(record, { day = "0", actorId = "", activity = "none" } = {}) {
  const key = normaliseActivity(activity);
  const spec = REST_ACTIVITIES[key];
  const dayKey = String(day);
  const next = { ...(record ?? {}) };
  const dayRec = { ...(next[dayKey] ?? {}) };
  const mine = { count: 0, tendWounds: false, ...(dayRec[actorId] ?? {}) };

  const fail = (error) => ({ ok: false, error, record: record ?? {}, hours: 0, landsAfterHours: 0 });

  if (key === "none") return fail("No activity chosen.");

  if (spec.townSleep) {
    if (mine.tendWounds) return fail(`${spec.label} is once per day in town (R:678).`);
    mine.tendWounds = true;
    dayRec[actorId] = mine;
    next[dayKey] = dayRec;
    // Four hours' sleep, and the benefit lands with the sleep — not after two.
    return { ok: true, record: next, hours: REST_SLEEP_HOURS, landsAfterHours: REST_SLEEP_HOURS };
  }

  if (mine.count >= TOWN_ACTIVITY_LIMIT) {
    return fail(`Already took ${TOWN_ACTIVITY_LIMIT} activities today (R:678).`);
  }
  mine.count += 1;
  dayRec[actorId] = mine;
  next[dayKey] = dayRec;
  return { ok: true, record: next, hours: TOWN_ACTIVITY_HOURS, landsAfterHours: TOWN_ACTIVITY_HOURS };
}

/** How many of the four no-sleep activities `actorId` has left today. */
export function townActivitiesRemaining(record, day, actorId) {
  const used = Number(record?.[String(day)]?.[actorId]?.count) || 0;
  return Math.max(0, TOWN_ACTIVITY_LIMIT - used);
}

// --- pure: prepared task (R:658) --------------------------------------------

/**
 * Prepare for Task binds to a TASK — "picking the lock on the abbot's study" —
 * not to a skill. Playtest 1 stored a skill key and roll.mjs matched on it;
 * that cannot express "a specific task in a specific place", which is the whole
 * point of the rule, and it is why the schema field was renamed.
 *
 * Matching is trimmed and case-insensitive: the player typed this string once
 * at the campfire and will retype it hours later.
 */
export function preparedTaskMatches(prepared, task) {
  const a = String(prepared ?? "").trim().toLowerCase();
  const b = String(task ?? "").trim().toLowerCase();
  return a.length > 0 && a === b;
}

/**
 * R:658 — the bonus is +2 in Playtest 2 (it was +1).
 *
 * Not in CROWS: the number is already the `initial` of `preparedTask.bonus` on
 * CrowData, and config.mjs is frozen (CONTRACT §1). Duplicating it into config
 * would create two sources for one value. `consumePreparedTask` reads the
 * ACTOR'S stored bonus and only falls back to this constant, so a per-character
 * override from a future trait keeps working.
 */
export const PREPARE_FOR_TASK_BONUS = 2;

// =========================================================================
//  Foundry-facing
// =========================================================================

// The current group rest. GM-client-local and deliberately not a world setting:
// a rest session is a transient UI grouping, and persisting it would leave a
// half-open session behind after a reload for the next rest to inherit. Pass an
// explicit `session` to takeRest() if you need one that outlives this client.
let _session = newRestSession();

export function beginRestSession(id = "") {
  _session = newRestSession(id);
  return _session;
}
export function getRestSession() { return _session; }
export function endRestSession() {
  const done = _session;
  _session = newRestSession();
  return done;
}

/**
 * Restore every "rest"-expiry usage die on an actor's items — spellbooks above
 * all (R:1543 rolls a spellbook's UD on every cast, so the rest restore is what
 * makes a spellbook a renewable resource rather than a consumable).
 */
export async function restoreSpellbookUds(actor) {
  if (!actor) return { ok: false, restored: 0 };
  const updates = [];
  for (const i of actor.items) {
    const ud = i.system?.usageDie;
    if (!ud?.enabled) continue;
    if (ud.expiry !== "rest") continue;
    if ((ud.udCurrent ?? 0) >= (ud.udMax ?? 0)) continue;
    updates.push({ _id: i.id, "system.usageDie.udCurrent": ud.udMax });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return { ok: true, restored: updates.length };
}

/**
 * T1.2's positional Layout, or null if it cannot be built.
 *
 * Every caller here falls back to reading `system.woundSlots` directly when
 * this returns null. That fallback is strictly worse — it cannot tell an
 * orphaned wound from a real slot — so it exists only to keep a rest from
 * failing outright, never as the normal path.
 */
async function _loadLayout(actor) {
  try {
    const { layoutFor } = await import("./slots.mjs");
    return layoutFor(actor);
  } catch (e) {
    console.error("crows | rest: could not build a slot layout", e);
    return null;
  }
}

/**
 * Take a rest.
 *
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {string}  [opts.activity="none"]   one of REST_ACTIVITY_KEYS
 * @param {object}  [opts.activityData]      activity payload (see _resolveActivity)
 * @param {Actor}   [opts.target]            Tend Wounds target
 * @param {boolean} [opts.inTown=false]      town rest — no encounter checks
 * @param {number[]}[opts.woundChoices]      which wound slots to clear
 * @param {object}  [opts.session]           an explicit group rest session
 * @param {boolean} [opts.encounterChecks=true]  a group-rest UI runs these ONCE
 *                                           for the party, not once per crow
 * @param {boolean} [opts.tendedBy=false]    LEGACY alias for activity="tendWounds"
 */
export async function takeRest(actor, {
  activity = "none", activityData = null, target = null, inTown = false,
  woundChoices = null, session = null, encounterChecks = true, tendedBy = false
} = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  if (actor.type !== "crow") return { ok: false, error: "rest is for crows only" };

  if (tendedBy && activity === "none") activity = "tendWounds";
  activity = normaliseActivity(activity);

  const layout = await _loadLayout(actor);

  // R:460 — the magic-slot overload blocks the rest outright, before anything
  // is written. Nothing partial happens.
  const blocked = restBlockedReason({
    magicOverload: layout?.magicOverload ?? actor.system?.magicOverload ?? false
  });
  if (blocked) {
    ui.notifications?.warn(blocked);
    return { ok: false, error: blocked, blocked: true };
  }

  // --- claim the activity against the group session ------------------------
  const useShared = !session;
  const claim = claimRestActivity(session ?? _session, { actorId: actor.id, activity });
  if (!claim.ok) {
    ui.notifications?.warn(claim.error);
    return { ok: false, error: claim.error };
  }
  let sess = claim.session;

  // Tend Wounds resolves BEFORE the resting benefits, because it changes how
  // many wounds this rest removes from its target.
  let tendResult = null;
  if (activity === "tendWounds") {
    tendResult = await _applyTendWounds(actor, target, sess);
    if (!tendResult.ok) {
      ui.notifications?.warn(tendResult.error);
      if (useShared) _session = sess;
      return { ok: false, error: tendResult.error };
    }
    sess = tendResult.session;
  }

  const sys = actor.system ?? {};
  const inMiasma = await _inMiasma(inTown);

  // --- the timeline --------------------------------------------------------
  // t=0   the current DT ends, with NO encounter check (R:630)
  // t=2h  encounter check
  // t=3h  HALFWAY — end-of-DT effects expire, end-of-DT usage dice roll (R:630)
  // t=4h  encounter check
  // t=6h  encounter check, rest completes, benefits land
  if (!inTown) await endDungeonTurnForRest();

  const secludeCamp = sessionHasSecludeCamp(sess);
  const ecResults = [];
  let halfwayEffects = null;

  for (const hour of REST_ENCOUNTER_CHECK_HOURS) {
    if (hour > REST_HALFWAY_HOUR && !halfwayEffects && !inTown) {
      halfwayEffects = await runEndOfDtEffects();
    }
    if (inTown || !encounterChecks) continue;
    const ec = await rollEncounterCheck({ label: `Rest hour ${hour}`, secludeCamp });
    ecResults.push({ hour, ...ec });
    // An encounter breaks the six uninterrupted hours. The benefits are still
    // applied — whether the party can resume is the Ref's call, and withholding
    // them here would take that call away.
    if (ec.triggered) break;
  }
  if (!halfwayEffects && !inTown) halfwayEffects = await runEndOfDtEffects();

  // --- benefits ------------------------------------------------------------
  const stamBefore = sys.stamina?.value ?? 0;
  const stamMax = sys.stamina?.max ?? 0;

  const expertiseUpdates = expertiseRefreshUpdates(sys.expertises, { inMiasma });
  const woundCount = woundRemovalCount(sess, actor.id);
  const candidates = layout
    ? woundCandidatesFromLayout(layout)
    : [...(sys.woundSlots ?? [])].map(Number).sort((a, b) => a - b);
  const wounds = resolveWoundRemoval(candidates, woundChoices, woundCount);
  if (!wounds.ok) {
    ui.notifications?.warn(wounds.error);
    if (useShared) _session = sess;
    return { ok: false, error: wounds.error };
  }

  // Orphaned wounds — indices past capacity — are NOT in `candidates` and must
  // survive the write, so the new set is built from the stored set minus what
  // was removed, never from the layout.
  const storedWounds = [...(sys.woundSlots ?? [])].map(Number);
  const nextWounds = storedWounds.filter(i => !wounds.removed.includes(i));

  await actor.update({
    "system.stamina.value": stamMax,
    "system.woundSlots": nextWounds,
    ...expertiseUpdates
  });

  // Trait pools reset on EVERY rest, Miasma or not (R:1375 names expertises).
  const poolUpdates = traitPoolResetUpdates(actor.items);
  if (poolUpdates.length) await actor.updateEmbeddedDocuments("Item", poolUpdates);
  const overused = _overusedPools(actor);

  const restored = await restoreSpellbookUds(actor);

  sess = markRested(sess, actor.id);
  if (useShared) _session = sess;

  // --- the activity --------------------------------------------------------
  let activityResult = tendResult;
  if (activity !== "none" && activity !== "tendWounds") {
    activityResult = await _resolveActivity(actor, activity, activityData);
  }

  await _postRestCard(actor, {
    activity, inTown, inMiasma, secludeCamp,
    stamina: { before: stamBefore, after: stamMax },
    expertiseCount: Object.keys(expertiseUpdates).length,
    wounds, poolsReset: poolUpdates.length, overused,
    restoredUds: restored.restored, ecResults, halfwayEffects
  });

  const miasmaResult = inMiasma ? await _rollMiasma(actor) : null;

  return {
    ok: true, activity, inTown, inMiasma, secludeCamp,
    stamina: { before: stamBefore, after: stamMax },
    expertisesRefreshed: Object.keys(expertiseUpdates).length,
    expertiseRefreshSuppressed: inMiasma,
    wounds: { removed: wounds.removed, remaining: wounds.remaining, autoChosen: wounds.autoChosen, count: woundCount },
    traitPoolsReset: poolUpdates.length, overusedPools: overused,
    restoredUds: restored.restored,
    encounters: ecResults,
    interrupted: ecResults.some(r => r.triggered),
    halfway: halfwayEffects,
    activityResult, miasmaResult,
    session: sess
  };
}

/**
 * A town rest activity (R:678): two hours, no sleeping, benefit lands when the
 * two hours are up. This is NOT a rest — no Stamina, no expertise refresh, no
 * wound removed, no trait pools. Only the activity happens.
 *
 * Tend Wounds routed through here still costs four hours' sleep and is once per
 * day, which is the one exception the rule spells out.
 *
 * @param {object} [opts.ledger]  the day ledger to reduce; pass the previous
 *                                return value's `ledger` back in.
 */
export async function takeTownActivity(actor, {
  activity = "none", activityData = null, target = null, day = "0", ledger = null,
  woundChoices = null
} = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  if (actor.type !== "crow") return { ok: false, error: "rest is for crows only" };

  const key = normaliseActivity(activity);
  const claim = townActivityClaim(ledger ?? {}, { day, actorId: actor.id, activity: key });
  if (!claim.ok) {
    ui.notifications?.warn(claim.error);
    return { ok: false, error: claim.error, ledger: ledger ?? {} };
  }

  let result;
  if (key === "tendWounds") {
    const sess = newRestSession(`town-${day}`);
    const tend = await _applyTendWounds(actor, target, sess, woundChoices);
    if (!tend.ok) {
      ui.notifications?.warn(tend.error);
      return { ok: false, error: tend.error, ledger: ledger ?? {} };
    }
    result = tend;
  } else {
    result = await _resolveActivity(actor, key, activityData);
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="crows rest-activity town">
      <header><strong>${actor.name}</strong> — ${activityLabel(key)} <em>(in town, ${claim.hours}h)</em></header>
      <div>Benefit lands after ${claim.landsAfterHours} hours. ${townActivitiesRemaining(claim.record, day, actor.id)} of ${TOWN_ACTIVITY_LIMIT} no-sleep activities left today.</div>
    </div>`
  });

  return { ok: true, activity: key, ledger: claim.record, hours: claim.hours, result };
}

/* ---- internals ---------------------------------------------------------- */

async function _inMiasma(inTown) {
  if (inTown) return false;
  try {
    const { getInMiasma } = await import("./miasma.mjs");
    return !!getInMiasma();
  } catch {
    return false;
  }
}

async function _rollMiasma(actor) {
  try {
    const { rollMiasmaResist } = await import("./miasma.mjs");
    if (actor.system?.miasma?.permanentNPC) return null;
    return await rollMiasmaResist(actor);
  } catch {
    return null;
  }
}

/** Traits whose `used` outran their characteristic-sized pool. Reported only. */
function _overusedPools(actor) {
  const chars = actor.system?.characteristics ?? {};
  const out = [];
  for (const item of actor.items ?? []) {
    if (item?.type !== "trait" || !item.system?.usePool) continue;
    const state = traitPoolState(item.system.usePool, chars);
    if (state.overused > 0) out.push({ name: item.name, ...state });
  }
  return out;
}

/**
 * Tend Wounds (R:670). The target loses 2 wounds INSTEAD of 1, so this marks
 * them in the session and lets their own rest do the removal. If they have
 * already rested tonight, the extra wound is taken off now — either arrival
 * order converges on two.
 */
async function _applyTendWounds(actor, target, session, woundChoices = null) {
  const layout = target ? await _loadLayout(target) : null;
  const candidates = target
    ? (layout ? woundCandidatesFromLayout(layout) : [...(target.system?.woundSlots ?? [])].map(Number))
    : [];

  const check = validateTendWounds({
    actorId: actor.id,
    targetId: target?.id ?? "",
    targetWounds: candidates.length
  });
  if (!check.ok) return { ok: false, error: check.error, session };

  const alreadyRested = (session?.rested ?? []).includes(target.id);
  const next = markTended(session, target.id);

  let removed = [];
  if (alreadyRested) {
    // Their rest already took one; Tend Wounds makes it two.
    const extra = resolveWoundRemoval(candidates, woundChoices, 1);
    if (!extra.ok) return { ok: false, error: extra.error, session };
    removed = extra.removed;
    if (removed.length) {
      const stored = [...(target.system?.woundSlots ?? [])].map(Number);
      await target.update({ "system.woundSlots": stored.filter(i => !removed.includes(i)) });
    }
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="crows rest-activity tend-wounds">
      <header><strong>${actor.name}</strong> tends <strong>${target.name}</strong></header>
      <div>${alreadyRested
        ? `${target.name} had already rested — one further wound removed${removed.length ? ` (slot ${removed.join(", ")})` : ""}.`
        : `${target.name}'s rest will remove <strong>2</strong> wounds instead of 1.`}</div>
    </div>`
  });

  return { ok: true, activity: "tendWounds", target: target.name, appliedNow: removed, session: next };
}

async function _resolveActivity(actor, activity, data = null) {
  data = data ?? {};
  const speaker = ChatMessage.getSpeaker({ actor });
  const dt = (() => { try { return getDT(); } catch { return 0; } })();

  if (activity === "secludeCamp") {
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity seclude-camp">
        <header><strong>${actor.name}</strong> secludes the camp</header>
        <div>Encounter Number is <strong>−1</strong> for this rest (R:672). Does not require finishing the rest.</div>
      </div>`
    });
    return { ok: true, activity };
  }

  if (activity === "repairArmor") {
    // R:508 restores ONE item's AD. T1.7's helper already defaults to a single
    // piece — the most damaged — so this passes an explicit id when the player
    // chose one and NEVER passes {all: true}.
    try {
      const { repairArmor } = await import("./damage.mjs");
      const r = await repairArmor(actor, { itemId: data.itemId ?? null });
      await ChatMessage.create({
        speaker,
        content: `<div class="crows rest-activity repair-armor">
          <header><strong>${actor.name}</strong> repairs armor</header>
          <div>${r.repaired ? `Restored to full AD: <strong>${r.items.join(", ")}</strong>` : "<em>Nothing worn is damaged.</em>"}</div>
        </div>`
      });
      return { ok: true, activity, ...r };
    } catch (e) {
      console.error("crows | repair armor activity failed", e);
      return { ok: false, activity, error: "repair failed" };
    }
  }

  if (activity === "harvest") {
    const size = String(data.size ?? "").trim();
    const formula = harvestFormula(size);
    if (!formula) {
      const known = CROWS.sizes.join(", ");
      ui.notifications?.warn(`Harvest: unknown corpse size "${size}". Expected one of: ${known}.`);
      return { ok: false, activity, error: "unknown corpse size" };
    }
    const roll = await new Roll(formula).evaluate();
    const quarry = (data.target || "").trim() || "the corpse";
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity harvest">
        <header><strong>${actor.name}</strong> harvests <strong>${quarry}</strong> (${size})</header>
        <div>${formula} = <strong>${roll.total}</strong> monster parts. The corpse is destroyed (R:652).</div>
      </div>`
    });
    return { ok: true, activity, size, formula, parts: roll.total };
  }

  if (activity === "prepareForTask") {
    const task = (data.task ?? data.detail ?? "").trim();
    if (!task) {
      ui.notifications?.warn("Prepare for Task: name the specific task and place — preparation NOT recorded (R:658).");
      return { ok: false, activity, error: "no task" };
    }
    await actor.update({
      "system.preparedTask.task": task,
      "system.preparedTask.bonus": PREPARE_FOR_TASK_BONUS,
      "system.preparedTask.setOn": String(dt)
    });
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity prepare-for-task">
        <header><strong>${actor.name}</strong> prepares for <strong>${task}</strong></header>
        <div><strong>+${PREPARE_FOR_TASK_BONUS}</strong> to that specific task in that specific place. Lasts until the next completed rest (R:658).</div>
      </div>`
    });
    return { ok: true, activity, task, bonus: PREPARE_FOR_TASK_BONUS };
  }

  if (activity === "identifyItem") {
    const itemName = (data.itemName || "").trim() || "<em>(unnamed item)</em>";
    const itemId = data.itemId || null;
    try {
      const { identifyMagicItem } = await import("./crafting.mjs");
      const r = await identifyMagicItem(actor, { itemId, itemName });
      return { ok: true, activity, itemName, identifyResult: r };
    } catch {
      await ChatMessage.create({
        speaker,
        content: `<div class="crows rest-activity identify-item">
          <header><strong>${actor.name}</strong> spends the rest identifying <strong>${itemName}</strong></header>
          <em>Ref reveals identified properties.</em>
        </div>`
      });
      return { ok: true, activity, itemName };
    }
  }

  if (activity === "craftEquipment") {
    const projectId = data.projectId || null;
    if (projectId) {
      try {
        const { makeCraftingRoll } = await import("./crafting.mjs");
        let r = await makeCraftingRoll(actor, projectId);
        if (!r.ok) return { ok: false, activity, error: r.error };
        // R:1453 — a crit buys another crafting roll for the same item within
        // the same rest activity.
        const rolls = [r];
        let safety = 0;
        while (r.crit && !r.complete && safety < 8) {
          safety++;
          r = await makeCraftingRoll(actor, projectId);
          if (!r.ok) break;
          rolls.push(r);
        }
        return { ok: true, activity, projectId, rolls };
      } catch (e) {
        console.error("crows | craft activity failed", e);
      }
    }
    const project = (data.project || "").trim() || "<em>(unnamed project)</em>";
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity craft-equipment">
        <header><strong>${actor.name}</strong> crafts <strong>${project}</strong></header>
        <em>No active project — Ref adjudicates ad-hoc.</em>
      </div>`
    });
    return { ok: true, activity, project };
  }

  return { ok: false, activity, error: "unknown activity" };
}

async function _postRestCard(actor, r) {
  const expertiseLine = r.inMiasma
    ? `<li><strong>Expertise uses NOT restored</strong> — resting in the Miasma (R:1375). Every other benefit applies.</li>`
    : `<li>Expertise uses restored: <strong>${r.expertiseCount}</strong> expertise(s) back to their owned maximum</li>`;

  const woundLine = r.wounds.removed.length
    ? `<li>Wounds removed from backpack slot ${r.wounds.removed.join(", ")}${r.wounds.autoChosen ? " <em>(auto-picked — no choice was supplied)</em>" : ""}</li>`
    : `<li><em>No wounds to remove</em></li>`;

  const poolLine = r.poolsReset
    ? `<li>Trait use pools reset: <strong>${r.poolsReset}</strong></li>`
    : "";
  const overusedLine = r.overused.length
    ? `<li class="warn"><strong>Overused trait pools:</strong> ${r.overused.map(o => `${o.name} (${o.used}/${o.max})`).join(", ")} — a characteristic dropped below what was already spent. Reported, not refunded.</li>`
    : "";

  const ecBlock = r.inTown
    ? `<li><em>Town rest — no encounter checks.</em></li>`
    : r.ecResults.length
      ? `<li>Encounter checks: ${r.ecResults.length}${r.secludeCamp ? " <em>(Seclude Camp: EN −1)</em>" : ""}${r.ecResults.some(e => e.triggered) ? " — <strong>rest interrupted</strong>" : ""}</li>`
      : `<li><em>Encounter checks handled at group level.</em></li>`;

  const content = `<div class="crows rest-summary">
  <header><strong>${actor.name} rests</strong>${r.activity !== "none" ? ` <em>(${activityLabel(r.activity)})</em>` : ""}${r.inTown ? " <em>[town]</em>" : ""}</header>
  <ul>
    <li>Stamina: ${r.stamina.before} → <strong>${r.stamina.after}</strong></li>
    ${expertiseLine}
    ${woundLine}
    ${poolLine}
    ${overusedLine}
    <li>Rest-expiry usage dice restored on <strong>${r.restoredUds}</strong> item(s)</li>
    ${ecBlock}
  </ul>
</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
}

/**
 * Consume a Prepare-for-Task bonus if it matches `task`.
 *
 * SIGNATURE CHANGE from Playtest 1: the second argument is the TASK STRING, not
 * a skill key, and the bonus is +2. roll.mjs (T1.1) is the only caller.
 *
 * @returns {Promise<number>} the bonus consumed, or 0.
 */
export async function consumePreparedTask(actor, task) {
  if (!actor || actor.type !== "crow") return 0;
  const prep = actor.system?.preparedTask;
  if (!preparedTaskMatches(prep?.task, task)) return 0;
  const bonus = Number(prep?.bonus) || PREPARE_FOR_TASK_BONUS;
  await actor.update({
    "system.preparedTask.task": "",
    "system.preparedTask.setOn": ""
  });
  return bonus;
}
