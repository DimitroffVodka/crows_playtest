/**
 * Greed Bonus — R:590.
 *
 * "Treasure found in the first three dungeon turns of a first entry is worth
 *  +30% / +20% / +10%. Once per dungeon per group of players."
 *
 * R:600 is explicit that "per group of players" means the PEOPLE at the table,
 * not the characters: a party that wipes and comes back with fresh crows does
 * NOT get the bonus again. That is why the claim record is a WORLD setting
 * keyed by dungeon id and never an actor flag — an actor flag would be reset
 * by exactly the event the rule is written to exclude.
 *
 * The rule has two clocks and they are easy to conflate:
 *   - the DT clock  — which of DTs 1/2/3 of the entry the treasure was found in,
 *                     giving the 30/20/10 multiplier;
 *   - the ENTRY clock — a dungeon's first entry is greed-bearing exactly once,
 *                     ever. DTs 1-3 of that ONE entry all pay out.
 *
 * So the record tracks a per-dungeon state machine, not a boolean:
 *
 *   (absent) --beginDungeonEntry--> "active" --endDungeonEntry--> "spent"
 *                                      |                             |
 *                                 pays 30/20/10                  pays nothing,
 *                                  on DT 1/2/3                    ever again
 *
 * Everything above the Foundry wrappers at the bottom is pure: the reducers
 * take a plain record and return a new one, so the whole rule is unit-testable
 * without a world.
 */

import { CROWS } from "../config.mjs";

const NS = "crows";
const KEY_ENTRIES = "greedEntries";

/** Per-dungeon greed states. */
export const GREED_UNENTERED = "unentered";
export const GREED_ACTIVE = "active";
export const GREED_SPENT = "spent";

/** The DTs that carry a multiplier, in order. Derived — never hard-code 1/2/3. */
export const GREED_DTS = Object.keys(CROWS.greedBonus).map(Number).sort((a, b) => a - b);

// --- pure core -------------------------------------------------------------

/**
 * Normalise a dungeon identifier. A blank/absent id is NOT coerced to a shared
 * empty-string key, because that would make every unnamed dungeon the same
 * dungeon and burn the bonus for all of them on the first delve.
 * @returns {string|null} the key, or null if the id is unusable.
 */
export function dungeonKey(dungeonId) {
  const key = String(dungeonId ?? "").trim();
  return key.length ? key : null;
}

/** @returns {"unentered"|"active"|"spent"} */
export function greedState(record, dungeonId) {
  const key = dungeonKey(dungeonId);
  if (!key) return GREED_UNENTERED;
  const state = (record ?? {})[key];
  return state === GREED_ACTIVE || state === GREED_SPENT ? state : GREED_UNENTERED;
}

/**
 * The multiplier for a DT number. Returns 0 outside DTs 1-3 — the fourth DT of
 * a first entry is worth face value.
 */
export function greedMultiplierForDT(dt) {
  const n = Number(dt);
  if (!Number.isFinite(n)) return 0;
  return CROWS.greedBonus[n] ?? 0;
}

/**
 * Open (or re-open) a dungeon's entry.
 * Idempotent while active, so a Ref clicking "enter" twice does not spend the
 * entry. Once spent, re-entering never revives it.
 * @returns {{record: object, firstEntry: boolean, state: string}}
 */
export function beginDungeonEntry(record, dungeonId) {
  const key = dungeonKey(dungeonId);
  const next = { ...(record ?? {}) };
  if (!key) return { record: next, firstEntry: false, state: GREED_UNENTERED };

  const state = greedState(next, key);
  if (state === GREED_SPENT) return { record: next, firstEntry: false, state: GREED_SPENT };

  next[key] = GREED_ACTIVE;
  return { record: next, firstEntry: true, state: GREED_ACTIVE };
}

/**
 * Close a dungeon's entry. This is what burns the once-per-dungeon claim, so it
 * must be called when the party LEAVES — not when the bonus is first paid out,
 * which would deny DTs 2 and 3 of the same first entry.
 */
export function endDungeonEntry(record, dungeonId) {
  const key = dungeonKey(dungeonId);
  const next = { ...(record ?? {}) };
  if (!key) return { record: next, state: GREED_UNENTERED };
  if (greedState(next, key) === GREED_ACTIVE) next[key] = GREED_SPENT;
  return { record: next, state: greedState(next, key) };
}

/**
 * Value a treasure find.
 *
 * The bonus is rounded, not the total, so `total - value === bonus` holds
 * exactly and a chat card that prints all three numbers never shows an
 * arithmetic that does not add up.
 *
 * @param {object} record     the world's greed record
 * @param {string} dungeonId
 * @param {number} dt         DT number WITHIN this entry (1-based)
 * @param {number} value      face value in gc
 * @returns {{applied:boolean, multiplier:number, bonus:number, total:number,
 *            value:number, reason:string}}
 */
export function greedAward(record, dungeonId, dt, value) {
  const face = Math.max(0, Math.round(Number(value) || 0));
  const state = greedState(record, dungeonId);
  const multiplier = greedMultiplierForDT(dt);

  const miss = (reason) => ({
    applied: false, multiplier: 0, bonus: 0, total: face, value: face, reason
  });

  if (!dungeonKey(dungeonId)) return miss("no dungeon id");
  if (state === GREED_SPENT) return miss("greed bonus already spent on this dungeon");
  if (state === GREED_UNENTERED) return miss("dungeon entry not open");
  if (!multiplier) return miss(`DT ${dt} is past the greed window (DTs ${GREED_DTS.join("/")})`);

  const bonus = Math.round(face * multiplier);
  return {
    applied: true, multiplier, bonus, total: face + bonus, value: face,
    reason: `first entry, DT ${dt}: +${Math.round(multiplier * 100)}%`
  };
}

// --- Foundry wrappers ------------------------------------------------------
//
// registerGreedSettings() is called from registerDungeonTurnSettings() rather
// than from crows.mjs, which T1.5 does not own. Both live in the dungeon-turn
// domain, so a single registration call site is honest rather than a dodge.

export function registerGreedSettings() {
  game.settings.register(NS, KEY_ENTRIES, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
}

export function getGreedRecord() {
  try { return game.settings.get(NS, KEY_ENTRIES) ?? {}; } catch { return {}; }
}

async function setGreedRecord(record) {
  return game.settings.set(NS, KEY_ENTRIES, record);
}

/** Open a dungeon's entry in the world record. */
export async function enterDungeon(dungeonId) {
  const { record, firstEntry, state } = beginDungeonEntry(getGreedRecord(), dungeonId);
  await setGreedRecord(record);
  return { firstEntry, state };
}

/** Close it. Call on leaving — this is what spends the once-per-dungeon claim. */
export async function leaveDungeon(dungeonId) {
  const { record, state } = endDungeonEntry(getGreedRecord(), dungeonId);
  await setGreedRecord(record);
  return { state };
}

/**
 * Value a find against the live world record and post a GM card. Read-only on
 * the record — the claim is spent by leaveDungeon(), not by collecting loot.
 */
export async function applyGreedBonus({ dungeonId, dt, value, label = "Treasure" } = {}) {
  const award = greedAward(getGreedRecord(), dungeonId, dt, value);
  const body = award.applied
    ? `<div>${label}: ${award.value} gc <strong>+${award.bonus} gc</strong> (${Math.round(award.multiplier * 100)}% greed bonus) = <strong>${award.total} gc</strong></div>`
    : `<div>${label}: <strong>${award.total} gc</strong> <em>(no greed bonus — ${award.reason})</em></div>`;
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({
    content: `<div class="crows greed-bonus"><header><strong>Greed Bonus</strong></header>${body}</div>`,
    whisper,
    speaker: { alias: "Greed Bonus" }
  });
  return award;
}
