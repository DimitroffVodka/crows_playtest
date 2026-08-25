/**
 * Pure decision logic for Crows' side-based initiative.
 *
 * The document and tracker classes are Foundry-facing, but the rules they
 * implement are deliberately kept here as plain functions so they can be
 * exercised by the node test suite without a live Foundry process.
 */

export const CROWS_SIDE = "crows";
export const ENEMIES_SIDE = "enemies";
export const SIDES = Object.freeze([CROWS_SIDE, ENEMIES_SIDE]);

const isSide = (value) => SIDES.includes(value);

/** Read a Crows flag from either a real document or a plain test stub. */
export function readCrowsFlag(document, key, fallback = undefined) {
  if (!document) return fallback;

  if (typeof document.getFlag === "function") {
    const value = document.getFlag("crows", key);
    if (value !== undefined && value !== null) return value;
  }

  const value = document.flags?.crows?.[key] ?? document._source?.flags?.crows?.[key];
  return value === undefined ? fallback : value;
}

/**
 * Determine a combatant's side from the rule's default signals.
 *
 * R:706 splits the table into "the PCs and any NPC allies they have" versus
 * "their enemies", so the signals are checked in that order of authority:
 *
 *   1. an explicit `crows.side` override — the Ref's call always wins
 *   2. actor type `crow`, which IS this system's PC type
 *   3. a player owner, for an ally an actual player drives
 *   4. a FRIENDLY token, for a Ref-run NPC ally
 *
 * Type comes before ownership because ownership is not a reliable proxy for
 * "is a PC". A Ref building an encounter solo owns every actor and sets no
 * dispositions, so every crow arrived HOSTILE and unowned and the whole party
 * sorted onto the enemy side — verified live before this check existed. A
 * `crow` actor is a player character whether or not a player is logged in.
 */
export function sideFromDisposition({
  actor = null,
  token = null,
  disposition = undefined,
  override = undefined,
  friendlyDisposition = 1
} = {}) {
  if (isSide(override)) return override;
  if (actor?.type === "crow") return CROWS_SIDE;
  if (actor?.hasPlayerOwner) return CROWS_SIDE;

  const actualDisposition = token?.disposition
    ?? token?._source?.disposition
    ?? disposition;
  const friendly = actualDisposition === "FRIENDLY"
    || actualDisposition === friendlyDisposition
    || String(actualDisposition) === String(friendlyDisposition);
  return friendly ? CROWS_SIDE : ENEMIES_SIDE;
}

/** Determine the side for a combatant document or a plain document-shaped stub. */
export function sideFromCombatant(combatant, { friendlyDisposition = 1 } = {}) {
  return sideFromDisposition({
    actor: combatant?.actor,
    token: combatant?.token,
    override: readCrowsFlag(combatant, "side"),
    friendlyDisposition
  });
}

/** A 1d10 face of 6+ puts the Crows first; 1–5 puts enemies first. */
export function firstSideFromRoll(face) {
  const value = Number(face);
  if (!Number.isInteger(value) || value < 1 || value > 10) return null;
  return value >= 6 ? CROWS_SIDE : ENEMIES_SIDE;
}

/**
 * Return the side order that applies to the current round.
 *
 * A stale `rolledForRound` deliberately disables the previous `firstSide` so
 * an old round's result cannot quietly drive a new round's turn order. When a
 * plain comparator stub has no round metadata, its explicit firstSide remains
 * usable for direct unit tests.
 */
export function firstSideForRound(combat) {
  const first = readCrowsFlag(combat, "firstSide");
  if (!isSide(first)) return null;

  const round = Number(combat?.round);
  const rolled = readCrowsFlag(combat, "rolledForRound");
  if (Number.isFinite(round) && round > 0 && rolled !== undefined
    && Number(rolled) !== round) return null;
  return first;
}

const compareLexical = (a, b) => {
  const left = String(a ?? "");
  const right = String(b ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
};

const numericOrder = (combatant) => {
  const value = Number(combatant?.order);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

/**
 * Comparator used by Combat#setupTurns.
 *
 * Foundry calls Combat#_sortCombatants unbound. This function therefore gets
 * the Combat document from `a.parent`; it never relies on a comparator `this`.
 */
export function compareSideCombatants(a, b) {
  const combat = a?.parent;
  const first = firstSideForRound(combat);
  if (first) {
    const sideRank = (combatant) => combatant?.side === first ? 0 : 1;
    const sideDelta = sideRank(a) - sideRank(b);
    if (sideDelta) return sideDelta;
  }

  const orderDelta = numericOrder(a) - numericOrder(b);
  if (orderDelta) return orderDelta;

  const nameDelta = compareLexical(a?.name, b?.name);
  if (nameDelta) return nameDelta;
  return compareLexical(a?.id, b?.id);
}

/** A player may roll for the side if they are the GM or own any combatant. */
export function canRollForCombat(combat, user) {
  if (user?.isGM) return true;
  if (!combat || !user) return false;
  const combatants = combat.combatants?.contents ?? combat.combatants ?? [];
  return [...combatants].some((combatant) => combatant?.isOwner
    || combatant?.testUserPermission?.(user, "OWNER"));
}

/** Surprised only blocks a turn during round 1. */
export function shouldSkipSurprised(combatant, round) {
  return Number(round) === 1 && !!combatant?.surprised;
}

/**
 * Pure next-turn selection used by tests and by callers that need to preview
 * the surprise rule. A null result means the caller should advance the round.
 */
export function nextPlayableTurnIndex(turns = [], currentTurn = null, {
  round = 1,
  skipDefeated = false
} = {}) {
  const start = Number.isInteger(currentTurn) ? currentTurn : -1;
  for (let index = start + 1; index < turns.length; index += 1) {
    const combatant = turns[index];
    if (skipDefeated && combatant?.isDefeated) continue;
    if (shouldSkipSurprised(combatant, round)) continue;
    return index;
  }
  return null;
}
