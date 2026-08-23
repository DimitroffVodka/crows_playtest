/**
 * The chaos roll — Playtest 2's per-cast backlash risk (R:1565–R:1567).
 *
 * WHAT WAS DELETED
 * ----------------
 * Playtest 1 modelled backlash risk as a Ref-secret, world-level tally that
 * accumulated across casts and fired a backlash once it crossed a fixed value.
 * That accumulator is GONE: no world setting, no running total, no ceiling, no
 * GM dialog. Any value a v0.1.3 world stored under the old `crows` world
 * setting is dead data for the migration to drop with a note (T1.3).
 *
 * WHAT REPLACED IT
 * ----------------
 * R:1563 — there are exactly TWO independent routes to a backlash:
 *   1. a doom on a casting        -> straight to backlash, no chaos roll
 *   2. the chaos roll             -> R:1567
 * R:1567 — the chaos roll is a 1d6 made when you cast a spell from a spellbook
 * and get "a tier 1 result that isn't a doom". On a 1, a backlash occurs.
 *
 * WHAT SURVIVED, AND IS EASY TO MISS
 * ----------------------------------
 * All six Discipline Mastery traits still say "...don't add to the chaos
 * count" (Alteration C:765, Benefaction C:917, Conjuration C:1117, Elemental
 * C:1173, Illusion C:1275, Necromancy C:1507). The phrase appears NOWHERE in
 * the Rules Book — it is stale Playtest 1 wording for a mechanic that still
 * exists in a new form. See docs/discrepancies/playtest-2-source-issues.md H1.
 * The intended reading, implemented here:
 *
 *     rank 0-1 spells of your mastered discipline DON'T TRIGGER A CHAOS ROLL.
 *
 * The traits' second clause needs no reinterpretation: rank 2+ spells of that
 * discipline are treated as 2 ranks lower when they trigger a backlash
 * (R:1559's d100 + rank lookup is unchanged). That reduction applies to BOTH
 * backlash routes, because the trait keys on "when they trigger a backlash",
 * not on how the backlash was triggered.
 *
 * Everything here is pure: no Roll, no ChatMessage, no game. The 1d6 is
 * supplied by the caller so the decision is unit-testable.
 */

import { CROWS } from "../config.mjs";

/** The chaos roll is a 1d6 (R:1567). */
export const CHAOS_DIE = "1d6";

/** ...and only a 1 causes a backlash (R:1567). */
export const CHAOS_BACKLASH_FACE = 1;

/** Mastery suppresses the chaos roll for ranks 0 and 1 (C:765 et al.). */
export const MASTERY_SUPPRESSED_MAX_RANK = 1;

/** Mastery treats rank 2+ as this many ranks lower on the backlash table. */
export const MASTERY_RANK_REDUCTION = 2;

/**
 * The six Discipline Mastery traits, resolved by the trait's OWN tree.
 *
 * H2 (docs/discrepancies/playtest-2-source-issues.md): Elemental Mastery's
 * BODY TEXT says "conjuration spells" — an MCDM copy-paste error unfixed since
 * Playtest 1, and a functional one: read literally the trait gives an
 * elementalist nothing. Resolving the discipline from `system.tree` (which is
 * `elemental`, as is the trait's name) implements the intended reading without
 * anyone having to parse or correct the description, and leaves MCDM's text
 * intact in the item for audit.
 *
 * @param {object} actor  An actor-like `{ items }`. Items are `{ type, name, system }`.
 * @returns {string[]} Mastered discipline keys, deduplicated, in CROWS.disciplines order.
 */
export function masteredDisciplinesFor(actor) {
  const found = new Set();
  for (const item of actor?.items ?? []) {
    if (item?.type !== "trait") continue;
    if (!/\bmastery\b/i.test(item?.name ?? "")) continue;
    const tree = item?.system?.tree;
    if (CROWS.disciplines.includes(tree)) found.add(tree);
  }
  return CROWS.disciplines.filter(d => found.has(d));
}

/**
 * The suppression hook. Rank 0-1 spells of a mastered discipline skip the
 * chaos roll entirely (H1's reading of C:765 et al.).
 *
 * @param {object} p
 * @param {string} p.discipline             The spell's discipline.
 * @param {number} p.rank                   The spell's rank, 0-5.
 * @param {string[]} [p.masteredDisciplines]
 * @returns {boolean}
 */
export function isChaosSuppressed({ discipline, rank, masteredDisciplines = [] } = {}) {
  if (!masteredDisciplines.includes(discipline)) return false;
  return normalizeRank(rank) <= MASTERY_SUPPRESSED_MAX_RANK;
}

/**
 * The rank used for the d100 lookup when a backlash actually fires (R:1559 +
 * the Mastery second clause). Rank 0-1 of a mastered discipline is unchanged —
 * suppression already handled those on the chaos-roll route, and on the DOOM
 * route the trait's clause only speaks about rank 2 and higher.
 *
 * @returns {number} The effective rank, never below 0.
 */
export function effectiveBacklashRank(rank, { discipline, masteredDisciplines = [] } = {}) {
  const r = normalizeRank(rank);
  if (!masteredDisciplines.includes(discipline)) return r;
  if (r < 2) return r;
  return Math.max(0, r - MASTERY_RANK_REDUCTION);
}

/**
 * Should a chaos roll be made for this COMMITTED test result?
 *
 * TIMING — this reads the committed tier, never the phase-1 tier. A caster who
 * rolls a tier 1 and then spends a spellcasting expertise to reach tier 2 gets
 * NO chaos roll: a miss is defined as a tier 1 *result* (R:921) and an
 * expertise improves "the test's result" (R:292). Callers must therefore hang
 * this off `crowsTestCommitted` and never off the roll itself.
 *
 * `state` has NO DEFAULT, deliberately. Defaulting it to "committed" would
 * make a caller who simply forgot to pass it roll chaos on a test that may
 * still be pending — the one failure this whole path exists to prevent, and
 * one that produces a wrong game silently. Anything that is not the literal
 * string "committed" declines.
 *
 * @param {object} p
 * @param {1|2|3} p.tier
 * @param {boolean} p.doom
 * @param {"pending"|"committed"} p.state   Required; anything else declines.
 * @param {string} p.discipline
 * @param {number} p.rank
 * @param {string[]} [p.masteredDisciplines]
 * @returns {{roll: boolean, reason: string}}
 */
export function chaosRollDecision({ tier, doom, state, discipline, rank,
                                    masteredDisciplines = [] } = {}) {
  if (state !== "committed") return { roll: false, reason: "test not committed" };
  // R:1563 — a doom is the OTHER route to a backlash. It does not route
  // through the chaos roll, and must not roll one on top.
  if (doom) return { roll: false, reason: "doom routes straight to backlash" };
  if (tier !== 1) return { roll: false, reason: `tier ${tier} result` };
  if (isChaosSuppressed({ discipline, rank, masteredDisciplines })) {
    return { roll: false, reason: `${discipline} mastery suppresses rank ${normalizeRank(rank)}` };
  }
  return { roll: true, reason: "tier 1 result that isn't a doom" };
}

/**
 * Does this 1d6 face cause a backlash? (R:1567 — only a 1.)
 * @param {number} face
 * @returns {boolean}
 */
export function chaosRollTriggersBacklash(face) {
  return Number(face) === CHAOS_BACKLASH_FACE;
}

function normalizeRank(rank) {
  return Math.max(0, Math.floor(Number(rank) || 0));
}
