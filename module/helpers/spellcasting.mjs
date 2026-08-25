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
 * The ONE spellcasting expertise a given casting may spend (R:1459).
 *
 * "A spell's discipline describes the type of magic it harnesses and the
 * spellcasting expertise th[at] can be used for the test made to cast the
 * spell." Singular — the matching one. The six spellcasting expertise keys are
 * exactly the six discipline keys (CONTRACT §1), so the mapping is identity;
 * it is a named function anyway so the rule has somewhere to live and a caller
 * cannot mistake the coincidence for a licence to accept any of the six.
 *
 * @param {string} discipline
 * @returns {string|null} the expertise key, or null for an unknown discipline.
 */
export function matchingExpertiseFor(discipline) {
  return CROWS.disciplines.includes(discipline) ? discipline : null;
}

/**
 * May this expertise be spent on this test, as far as the DISCIPLINE rule is
 * concerned? Applicability is a separate, earlier question that
 * `canSpendExpertise` owns; this answers only "is it the right one of the six".
 *
 * Returns true for anything that is not a spellcasting spend, so it composes as
 * an extra defense after either the legacy category path or D1's exact
 * applicability declaration. `helpers/expertise.mjs` is the enforcement point;
 * keeping the rule here gives the spell discipline one owner.
 *
 * @param {object} result  A TestResult; `result.casting.discipline` is read.
 * @param {string} key     The expertise key being spent.
 * @returns {boolean}
 */
export function castingExpertiseAllows(result, key) {
  const discipline = result?.casting?.discipline;
  if (!discipline) return true;                       // not a spell — not this rule's business
  if (!CROWS.expertises.spellcasting.includes(key)) return true;   // a weapon/general spend
  return key === matchingExpertiseFor(discipline);
}

/**
 * R:1553 — summoned creatures "function like pets in combat except that you
 * don't need to make a test to convince them to undertake dangerous actions."
 * The pet machinery is T1.6's; this states the one difference so nobody has to
 * re-derive it from the spell's target line.
 *
 * @param {object} spellbookSystem
 * @returns {{summons: boolean, actsAsPet: boolean, requiresCommandTest: boolean}}
 * A summoned OBJECT is not a pet. R:1467 makes "Summoned" cover "a creature or
 * object", and R:1553's pet behaviour is about creatures only — so `actsAsPet`
 * keys on the target's kind, not on the fact of the summon. An earlier version
 * returned `actsAsPet: summons`, which would have handed pet mechanics to a
 * conjured rock.
 *
 * @param {object} spellbookSystem
 * @returns {{summons: boolean, actsAsPet: boolean, requiresCommandTest: boolean}}
 */
export function summonBehaviour(spellbookSystem = {}) {
  const target = normalizeTarget(spellbookSystem?.target);
  const summons = !!target.summoned;
  return {
    summons,
    actsAsPet: summons && target.kind === "creature",
    requiresCommandTest: false
  };
}

/**
 * The target-entry vocabulary of R:1461–R:1521.
 *
 * `""` is R:1521's "No Target Entry". `other` is the escape hatch, and it earns
 * its place: the shipped spellbooks target "1 corpse", "1 square", "1 space"
 * and "1 vessel or area", none of which are in the rules' vocabulary. A strict
 * enum would reject real content, and guessing a kind for them would be worse
 * than admitting the parse failed.
 */
export const TARGET_KINDS = Object.freeze(
  ["", "self", "creature", "object", "target", "ally", "enemy", "other"]);

/**
 * Parse a printed target line into structure, keeping the line verbatim.
 *
 * WHY THIS IS STRUCTURED AND NOT A REGEX AT THE CALL SITE.
 * `summonBehaviour` used to answer "is this a summon?" with `/summoned/i`
 * against this free text. Across the 25 shipped spellbooks that matches
 * ZERO of them — including the one named "Summon Object", whose target line
 * reads "Self". A detector that silently returns false for every document in
 * the corpus is the same class of bug as a spend gate that lets the wrong
 * expertise through: nothing fails, the answer is just always wrong.
 *
 * The parser stays deliberately literal. It will NOT infer a summon from
 * description prose — that is how "1 corpse" becomes a guess. What it cannot
 * classify it marks `other` and flags for review (`targetNeedsReview`).
 *
 * @param {string} text
 * @returns {{count: number, all: boolean, kind: string, summoned: boolean, text: string}}
 */
export function parseTarget(text) {
  const raw = String(text ?? "").trim();
  const out = { count: 1, all: false, kind: "creature", summoned: false, text: raw };
  if (!raw) return { ...out, count: 0, kind: "" };

  const lower = raw.toLowerCase();

  // R:1467 — "All" stands in place of the number.
  if (/^all\b/.test(lower)) { out.all = true; out.count = 0; }
  else {
    const n = lower.match(/^(\d+)/);
    if (n) out.count = Number(n[1]);
  }

  // R:1467 — Summoned. Orthogonal to the kind: a summon is still a creature
  // or an object, and R:1553 only makes the creature case a pet.
  if (/\bsummon(ed)?\b/.test(lower)) out.summoned = true;

  if (/^self\b/.test(lower)) { out.kind = "self"; out.count = 0; }
  else if (/\bcreatures?\b/.test(lower)) out.kind = "creature";
  else if (/\bobj(ect)?s?\b\.?|\bobj\./.test(lower)) out.kind = "object";
  else if (/\btargets?\b/.test(lower)) out.kind = "target";
  else if (/\ball(y|ies)\b/.test(lower)) out.kind = "ally";
  else if (/\benem(y|ies)\b/.test(lower)) out.kind = "enemy";
  else out.kind = "other";

  return out;
}

/** Accept either the structured target or a legacy free-text one. */
function normalizeTarget(target) {
  if (target && typeof target === "object") return target;
  return parseTarget(target);
}

/**
 * Does this spell's target line need a human before it can be trusted?
 *
 * On the CONTRACT §3 reporting pattern: a parse that
 * could not classify its input REPORTS that, so Wave 3 can list the documents
 * rather than discover them one bug at a time. Two cases:
 *   - the kind came out `other` — a noun outside R:1467's vocabulary;
 *   - the spell reads like it places a creature or object in the world, but
 *     its target line never said "Summoned".
 *
 * DELIBERATELY OVER-INCLUSIVE. "create" is in the pattern even though plenty of
 * spells create a non-summon effect (Cacophony creates a noise, Minor Phantasm
 * an image), because the alternative is what this flag exists to prevent: the
 * shipped "Summon Object" targets "Self" and its description says *create*, not
 * summon, so a tighter pattern misses the one document that most obviously
 * needs a human. A false positive here costs someone a glance; a false negative
 * ships a summon nothing detects.
 *
 * @param {object} spellbookSystem
 * @param {object} [opts]
 * @param {string} [opts.name]  The item name — "Summon Object" says it there
 *                              and nowhere else.
 * @returns {boolean}
 */
export function targetNeedsReview(spellbookSystem = {}, { name = "" } = {}) {
  const target = normalizeTarget(spellbookSystem?.target);
  if (target.summoned) return false;              // already stated properly
  if (target.kind === "other") return true;
  const prose = `${name} ${spellbookSystem?.description ?? ""}`;
  return /\b(summons?|summoned|summoning|conjures?|creates?)\b/i.test(prose);
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

  // target: free string -> {count, all, kind, summoned, text}. The printed line
  // survives in `text`, so a parse this migration got wrong is recoverable.
  if (typeof source.target === "string") source.target = parseTarget(source.target);

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
    ...opts,
    allowedExpertises: [discipline]
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
      actor
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
 * Route 1 is the real one: T1.1's `TestResult` carries the `casting` payload
 * verbatim, so `castId` identifies the cast exactly. Route 2 reads the same
 * payload off the persisted flags when the hook passes a message but the
 * result was rebuilt. Route 3 exists only for a result that somehow carries
 * neither, and is deliberately REFUSED when it is ambiguous.
 *
 * The rank is what makes this worth being careful about: it is added to the
 * d100 (R:1559), so resolving the wrong cast rolls the backlash on the wrong
 * row. One caster CAN have two casts in flight — a reaction spell cast while
 * an out-of-combat casting sits pending on its expertise decision — and there
 * is nothing in a bare TestResult to tell them apart. Guessing the oldest
 * would be wrong half the time and silent every time, so when more than one
 * cast is parked for the actor this returns null and the caller declines to
 * resolve rather than roll at a rank it invented.
 */
export function resolveCastContext(result, message = null) {
  const byId = result?.casting?.castId ?? message?.flags?.crows?.test?.casting?.castId;
  if (byId && _pendingCasts.has(byId)) return _pendingCasts.get(byId);

  const inline = result?.casting ?? message?.flags?.crows?.test?.casting;
  if (inline?.rank !== undefined && inline?.discipline) {
    return { castId: inline.castId ?? "", actorId: result?.actorId, masteredDisciplines: [], ...inline };
  }

  const mine = [...(_pendingCasts.values())].filter(ctx => ctx.actorId === result?.actorId);
  if (mine.length === 1) return mine[0];
  if (mine.length > 1) {
    console.warn(`crows | ${mine.length} casts in flight for this actor and the committed test names none of them; `
                 + "declining to resolve rather than roll a backlash at a guessed rank", result);
  }
  return null;
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
