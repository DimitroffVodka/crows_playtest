/**
 * Spellcasting — R:1445–R:1567.
 *
 * Casting is ALWAYS a Mind test (R:1549); only the matching spellcasting
 * expertise may be applied to it (R:384, CONTRACT §1). The spellbook's UD is
 * rolled on EVERY cast (R:1543) except on a crit, which skips the UD roll
 * entirely (R:1545) and so is effectively a free cast.
 *
 * THE TIMING RULE THAT MAKES THIS FILE LOOK ROUNDABOUT
 * ----------------------------------------------------
 * Nothing here may read a tier at roll time. T1.1's roll pipeline is two-phase:
 * a test can sit `pending` while the player decides whether to spend a
 * spellcasting expertise, and an expertise improves "the test's result"
 * (R:292). A miss is *defined* as a tier 1 result (R:921), so a caster who
 * rolls tier 1 and then spends to reach tier 2 must get NO chaos roll. The
 * whole outcome — chaos roll, backlash, UD roll, effect band — therefore hangs
 * off `crowsTestCommitted`, and `castSpell` only starts the test.
 *
 * `planCastingOutcome` is pure and holds every rule; the impure part below it
 * just executes the plan. That split is what makes the timing testable without
 * a Foundry runtime.
 */

import { CROWS } from "../config.mjs";
import { chaosRollDecision, chaosRollTriggersBacklash, effectiveBacklashRank,
         masteredDisciplinesFor, CHAOS_DIE } from "./chaos.mjs";
import { rollBacklash } from "./backlash.mjs";

/** The hook T1.1 emits when — and only when — a test reaches its final tier. */
export const TEST_COMMITTED_HOOK = "crowsTestCommitted";

/**
 * Casts awaiting their commit event, keyed by cast id. A cast's rank and
 * discipline are needed at commit time and the committed TestResult is not
 * guaranteed to carry them, so they are parked here by `castSpell` and claimed
 * by the commit handler. See `resolveCastContext` for the lookup order.
 * @type {Map<string, object>}
 */
const _pendingCasts = new Map();

/* -------------------------------------------------------------------------- */
/*  PURE — the rules                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Decide everything that follows from a COMMITTED casting test.
 *
 * R:1563 gives two INDEPENDENT routes to a backlash and this is where they stay
 * independent: a doom goes straight to backlash and does not roll chaos; the
 * chaos roll fires only on "a tier 1 result that isn't a doom" (R:1567).
 *
 * @param {object} p
 * @param {1|2|3} p.tier                    The COMMITTED tier.
 * @param {boolean} [p.doom]
 * @param {boolean} [p.crit]
 * @param {"pending"|"committed"} p.state    Required, and NOT defaulted — see
 *                                           `chaosRollDecision`. A caller who
 *                                           forgets it gets an idle plan, not a
 *                                           chaos roll on a pending test.
 * @param {number} p.rank                   The spell's printed rank.
 * @param {string} p.discipline
 * @param {string[]} [p.masteredDisciplines]
 * @returns {{ok: boolean, reason?: string, udRoll: boolean,
 *            chaos: {roll: boolean, reason: string, die: string},
 *            backlash: null | {trigger: boolean, cause: string, rank: number},
 *            effectBand: "t1"|"t2"|"t3"|null}}
 */
export function planCastingOutcome({ tier, doom = false, crit = false, state,
                                     rank = 0, discipline = "", masteredDisciplines = [] } = {}) {
  const idle = {
    ok: false, udRoll: false, backlash: null, effectBand: null,
    chaos: { roll: false, reason: "test not committed", die: CHAOS_DIE }
  };
  // NOTHING downstream may fire while the test is pending (CONTRACT A1).
  if (state !== "committed") return { ...idle, reason: "pending" };

  const chaos = chaosRollDecision({ tier, doom, state, discipline, rank, masteredDisciplines });
  const backlashRank = effectiveBacklashRank(rank, { discipline, masteredDisciplines });

  return {
    ok: true,
    // R:1543 every cast rolls the UD; R:1545 a crit does not. A backlash
    // resolves INSTEAD of the spell but STILL COSTS the UD roll (R:1559), so
    // this is decided by the crit alone and never by the outcome route.
    udRoll: !crit,
    chaos: { ...chaos, die: CHAOS_DIE },
    // Route 1 of R:1563. Route 2 needs the 1d6 — see `applyChaosRoll`.
    backlash: doom ? { trigger: true, cause: "doom on a casting", rank: backlashRank } : null,
    // A backlash replaces the spell, so a doom narrates no effect band.
    effectBand: doom ? null : (tier === 1 ? "t1" : tier === 2 ? "t2" : "t3")
  };
}

/**
 * Fold a rolled chaos die into a plan. R:1567 — only a 1 causes a backlash.
 *
 * @param {object} plan   From `planCastingOutcome`.
 * @param {number} face   The 1d6 result.
 * @param {object} ctx    `{rank, discipline, masteredDisciplines}` — the same
 *                        values the plan was built from.
 * @returns {object} A new plan; the input is not mutated.
 */
export function applyChaosRoll(plan, face, { rank = 0, discipline = "", masteredDisciplines = [] } = {}) {
  if (!plan?.chaos?.roll) return plan;
  const chaos = { ...plan.chaos, face, triggered: chaosRollTriggersBacklash(face) };
  if (!chaos.triggered) return { ...plan, chaos };
  return {
    ...plan,
    chaos,
    backlash: { trigger: true, cause: `chaos roll ${face}`,
                rank: effectiveBacklashRank(rank, { discipline, masteredDisciplines }) }
  };
}

/**
 * R:1553 — summoned creatures "function like pets in combat except that you
 * don't need to make a test to convince them to undertake dangerous actions."
 * The pet machinery is T1.6's; this states the one difference so nobody has to
 * re-derive it from the spell's target line.
 *
 * @param {object} spellbookSystem
 * @returns {{summons: boolean, actsAsPet: boolean, requiresCommandTest: boolean}}
 */
export function summonBehaviour(spellbookSystem = {}) {
  const summons = /summoned/i.test(spellbookSystem?.target ?? "");
  return { summons, actsAsPet: summons, requiresCommandTest: false };
}

/**
 * Layer (a) shape migration for a Playtest 1 spellbook. Pure, safe on partial
 * update deltas — it only touches keys that are actually present.
 *
 * `SpellbookData.migrateData` delegates here so the logic stays importable
 * without a Foundry runtime.
 *
 * @param {object} source  A spellbook's `system` (or a delta of one).
 * @returns {object} The same object, mutated and returned (Foundry's contract).
 */
export function migrateSpellbookSystem(source) {
  if (!source || typeof source !== "object") return source;

  // castType -> castingTime (R:1449 names it "Casting Time").
  if (source.castType !== undefined && source.castingTime === undefined) {
    source.castingTime = source.castType;
  }
  delete source.castType;

  // "attack" is not one of PT2's four casting times — it says what the spell
  // DOES (R:1521). Seven PT1 spellbooks encode it here. An attack spell is
  // cast with an action, so move it there and keep the fact in `isAttack`
  // rather than dropping it on the floor.
  if (source.castingTime === "attack") {
    source.castingTime = "action";
    source.isAttack = true;
  }

  // aoe -> areaOfEffect (R:1479).
  if (source.aoe !== undefined && source.areaOfEffect === undefined) {
    source.areaOfEffect = source.aoe;
  }
  delete source.aoe;

  // duration: free string -> {kind, count}. PT1 content stores "instant",
  // "1 UD", "DT", "until the end of the DT".
  if (typeof source.duration === "string") source.duration = parseDuration(source.duration);

  return source;
}

/**
 * Parse a PT1 free-text duration into `{kind, count}`. Unrecognised text falls
 * back to `instant` with the original kept in `note`, so a bad transcription
 * shows up in the item rather than silently becoming a lasting spell.
 * @param {string} text
 */
export function parseDuration(text) {
  const raw = String(text ?? "").trim();
  const ud = raw.match(/(\d+)\s*UD/i);
  if (ud) return { kind: "ud", count: Number(ud[1]), note: "" };
  if (/\bUD\b/i.test(raw)) return { kind: "ud", count: 1, note: "" };
  if (/\bDT\b/i.test(raw)) return { kind: "dt", count: 0, note: "" };
  if (/^instant/i.test(raw) || raw === "") return { kind: "instant", count: 0, note: "" };
  return { kind: "instant", count: 0, note: raw };
}

/* -------------------------------------------------------------------------- */
/*  IMPURE — Foundry orchestration                                            */
/* -------------------------------------------------------------------------- */

/**
 * Start a casting. Posts the Mind test and returns; the OUTCOME is resolved
 * later, on `crowsTestCommitted`, because the tier is not final until then.
 *
 * @param {Actor} actor
 * @param {Item} spellbook
 * @param {object} [opts]
 * @returns {Promise<{ok: boolean, error?: string, castId?: string, test?: object}>}
 */
export async function castSpell(actor, spellbook, opts = {}) {
  if (!actor) return { ok: false, error: "no caster" };
  if (!spellbook || spellbook.type !== "spellbook") return { ok: false, error: "not a spellbook" };

  if (actor.system?.conditions?.unconscious) {
    ui.notifications?.warn(`${actor.name} is unconscious and cannot cast.`);
    return { ok: false, error: "unconscious" };
  }

  const sys = spellbook.system ?? {};
  const ud = sys.usageDie ?? {};
  // R:1541 — at 0 UD "the spell can't be cast from its book until its usage
  // dice are restored".
  if (ud.enabled && (ud.udCurrent ?? 0) <= 0) {
    ui.notifications?.warn(`${spellbook.name} has no usage dice remaining (rest to restore).`);
    return { ok: false, error: "no UD" };
  }

  const rank = Math.max(0, Math.floor(Number(sys.rank) || 0));
  const discipline = CROWS.disciplines.includes(sys.discipline) ? sys.discipline : "elemental";
  const castId = `cast-${foundry.utils.randomID()}`;

  const context = {
    castId,
    actorId: actor.id,
    spellbookId: spellbook.id,
    spellbookName: spellbook.name,
    rank,
    discipline,
    masteredDisciplines: masteredDisciplinesFor(actor),
    target: sys.target ?? ""
  };
  _pendingCasts.set(castId, context);

  const { rollTest } = await import("./roll.mjs");
  const test = await rollTest({
    actor,
    characteristic: "mind",
    flavor: `${actor.name} casts ${spellbook.name} (rank ${rank} ${discipline})`,
    casting: context,
    ...opts
  });

  return { ok: true, castId, test };
}

/**
 * Subscribe the casting outcome to the commit event. Idempotent — T2.3 wires
 * this from the entry point and a second call is a no-op.
 */
export function registerSpellcastingHooks() {
  if (registerSpellcastingHooks._bound) return;
  registerSpellcastingHooks._bound = true;
  Hooks.on(TEST_COMMITTED_HOOK, (result, message) => onTestCommitted(result, message));
}

/**
 * Resolve a casting once its tier is FINAL.
 *
 * @param {object} result   The committed TestResult (CONTRACT part 1.1).
 * @param {object} [message] The chat message carrying it, when the hook passes one.
 */
export async function onTestCommitted(result, message = null) {
  if (!result || result.kind !== "casting") return null;
  if (result.state !== "committed") return null;          // belt and braces

  const context = resolveCastContext(result, message);
  if (!context) {
    console.warn("crows | casting committed with no cast context; outcome not resolved", result);
    return null;
  }
  _pendingCasts.delete(context.castId);

  const actor = game.actors?.get(context.actorId) ?? null;
  const spellbook = actor?.items?.get?.(context.spellbookId) ?? null;

  let plan = planCastingOutcome({
    tier: result.tier,
    doom: !!result.doom,
    crit: !!result.crit,
    state: result.state,
    rank: context.rank,
    discipline: context.discipline,
    masteredDisciplines: context.masteredDisciplines
  });

  // --- the chaos roll (R:1567), only when the plan asked for one ------------
  if (plan.chaos.roll) {
    const chaosRoll = await new Roll(CHAOS_DIE).evaluate();
    await chaosRoll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `Chaos roll — ${context.spellbookName}`
    }, { rollMode: CONST.DICE_ROLL_MODES.PRIVATE });
    plan = applyChaosRoll(plan, chaosRoll.total, context);
  }

  // --- the backlash (R:1559) ----------------------------------------------
  let backlash = null;
  if (plan.backlash?.trigger) {
    backlash = await rollBacklash({
      rank: plan.backlash.rank,
      cause: plan.backlash.cause,
      actor,
      activeRanges: activeBacklashRanges(actor)
    });
  }

  // --- the UD roll (R:1543/R:1545/R:1559) ----------------------------------
  // Runs even when a backlash replaced the spell.
  let udResult = null;
  if (plan.udRoll && spellbook) {
    const { rollUsageDie } = await import("./usage-die.mjs");
    udResult = await rollUsageDie(spellbook);
  }

  // --- narration -----------------------------------------------------------
  // A backlash resolves INSTEAD of the spell, so its effect band is suppressed.
  const band = backlash ? null : plan.effectBand;
  const text = band ? (spellbook?.system?.effectBands?.[band] ?? "").trim() : "";
  if (text) {
    await ChatMessage.create({
      content: `<div class="crows spell-effect">
        <header><strong>${context.spellbookName}</strong> — tier ${result.tier} effect</header>
        <div class="se-text">${text}</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }

  return { plan, backlash, udResult, context };
}

/**
 * Find the cast a committed test belongs to.
 *
 * The TestResult shape frozen in the contract does not include the `casting`
 * payload, and the hook is not guaranteed to pass the message, so this tries
 * every route in order of reliability and falls back to the actor's oldest
 * unclaimed cast. It never guesses a rank: with no context the caller declines
 * to resolve rather than roll a backlash at the wrong rank.
 */
export function resolveCastContext(result, message = null) {
  const byId = result?.casting?.castId ?? message?.flags?.crows?.test?.casting?.castId;
  if (byId && _pendingCasts.has(byId)) return _pendingCasts.get(byId);

  const inline = result?.casting ?? message?.flags?.crows?.test?.casting;
  if (inline?.rank !== undefined && inline?.discipline) {
    return { castId: inline.castId ?? "", actorId: result?.actorId, masteredDisciplines: [], ...inline };
  }

  for (const [, ctx] of _pendingCasts) {
    if (ctx.actorId === result?.actorId) return ctx;
  }
  return null;
}

/** `sourceRange` values of durational backlashes already on the caster (R:1561). */
function activeBacklashRanges(actor) {
  const ranges = [];
  for (const effect of actor?.effects ?? []) {
    const range = effect?.flags?.crows?.backlashRange;
    if (range) ranges.push(range);
  }
  return ranges;
}

/** Test seam: drop any parked casts. */
export function _clearPendingCasts() {
  _pendingCasts.clear();
}

/** Test seam: park a cast context without going through Foundry. */
export function _parkCast(context) {
  _pendingCasts.set(context.castId, context);
  return context;
}
