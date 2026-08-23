import { ALL_EXPERTISES, expertiseCategory } from "../config.mjs";

/**
 * Expertise spending and the A1 COMMIT LIFECYCLE.
 *
 * The top half of this file is PURE — no Foundry, unit-testable, and where every
 * rule lives. The bottom half is the thin Foundry layer that reads/writes the
 * `message.flags.crows.test` flag and the actor.
 *
 * ---------------------------------------------------------------------------
 * A1 — why the commit point exists
 *
 * Rules that key on "a tier N result" must read the FINAL, post-expertise tier.
 * A miss is *defined* as a tier 1 result on an attack (R:921), so if downstream
 * triggers read the pre-expertise value a weapon expertise could never convert a
 * miss — which is the entire purpose of the six weapon expertises. R:292 agrees:
 * an expertise improves "the test's RESULT".
 *
 * Therefore NOTHING downstream may fire while `state === "pending"`:
 *
 *   rollTest()
 *     |- terminal (doom/crit/unconscious) -> committed, "terminal"
 *     |- no legal spend available         -> committed, "no-legal-spend"
 *     \- otherwise                        -> PENDING, card offers spend/decline
 *   applyExpertise()                      -> committed, "spent"
 *   declineExpertise()                    -> committed, "declined"
 *
 * On commit — and ONLY on commit — `crowsTestCommitted` fires, exactly once, with
 * (TestResult, ChatMessage). T1.7 (miss/Counter/Silent armor), T1.8 (chaos roll)
 * and T2.2 (final card render) all hang off it.
 *
 * `declineExpertise` is not optional: without an explicit decline a card with a
 * legal spend available stays `pending` forever and its downstream effects never
 * fire.
 * ---------------------------------------------------------------------------
 */

/**
 * Which expertise categories a test of each kind may apply.
 *
 * R:913 — attacks accept a WEAPON or a SPELLCASTING expertise (the latter is the
 *         spell-attack case).
 * R:384 — castings accept SPELLCASTING only.
 * General expertises apply to neither, which leaves them for ordinary tests.
 */
export const EXPERTISE_CATEGORIES_BY_KIND = Object.freeze({
  test: ["general"],
  attack: ["weapon", "spellcasting"],
  casting: ["spellcasting"]
});

/** @returns {boolean} whether `key` is a legal expertise for a test of `kind`. */
export function categoryAllows(kind, key) {
  const cat = expertiseCategory(key);
  if (!cat) return false;
  const allowed = EXPERTISE_CATEGORIES_BY_KIND[kind] ?? EXPERTISE_CATEGORIES_BY_KIND.test;
  return allowed.includes(cat);
}

/**
 * Read one expertise's `{value, max}` off an actor, whichever shape it is in.
 *
 * CrowData keys expertises by name; MonsterData stores an ARRAY of
 * `{key, value, max}` (contract §3). The frozen `canSpendExpertise` was written
 * against the crow shape only, which would have refused every monster spend with
 * "no uses left". Both shapes resolve here so the gate itself stays literal.
 *
 * @returns {{value: number, max: number}} zeroes when the actor has no such entry
 */
export function readExpertiseUses(actor, key) {
  const store = actor?.system?.expertises;
  if (!store) return { value: 0, max: 0 };
  const entry = Array.isArray(store) ? store.find(e => e?.key === key) : store[key];
  return {
    value: Number(entry?.value) || 0,
    max: Number(entry?.max) || 0
  };
}

/**
 * The spend gate (R:292 — improve by one tier, max 3; one expertise and one use
 * per test).
 *
 * @returns {string|null} a refusal reason, or null when the spend is legal.
 */
export function canSpendExpertise(result, key, actor) {
  // STATE FIRST (C2). Without this a DECLINED card is still spendable: decline
  // sets state "committed" but leaves expertiseSpent null, so every other guard
  // passes and the spend lands AFTER downstream effects fired off the committed
  // tier. This check must come first.
  if (result?.state === "committed") return "already resolved";
  if (result?.terminal === "doom") return "a doom can't be improved";   // R:246
  if ((result?.tier ?? 0) >= 3) return "already tier 3";                // no-op burn
  if (result?.expertiseSpent) return "one expertise per test";          // R:292
  if (!categoryAllows(result?.kind ?? "test", key)) return "wrong expertise category";
  if (readExpertiseUses(actor, key).value < 1) return "no uses left";
  return null;
}

/** Every expertise key this actor could legally spend on this result, in display order. */
export function legalExpertiseSpends(result, actor) {
  return ALL_EXPERTISES.filter(k => canSpendExpertise(result, k, actor) === null);
}

/** Short-circuiting `legalExpertiseSpends(...).length > 0`. Drives "no-legal-spend". */
export function hasLegalSpend(result, actor) {
  if (!actor) return false;
  return ALL_EXPERTISES.some(k => canSpendExpertise(result, k, actor) === null);
}

/**
 * PURE. Apply a spend to a TestResult and commit it.
 *
 * R:292 improves the test's RESULT — the tier — not the total, so `total` is
 * untouched and a committed card can legitimately show a tier that its raw total
 * would not produce. Per-target tiers move with it: R:961 is ONE roll resolved
 * per target, and one use improves that roll. Targets already at tier 3 (crit,
 * or an unconscious target) simply floor at 3.
 *
 * Callers must run `canSpendExpertise` first; this function does not re-gate.
 */
export function spendExpertise(result, key) {
  const next = structuredClone(result);
  next.tier = Math.min(3, next.tier + 1);
  next.targets = (next.targets ?? []).map(t => ({ ...t, tier: Math.min(3, t.tier + 1) }));
  next.expertiseSpent = key;
  next.state = "committed";
  next.commitReason = "spent";
  return next;
}

/**
 * PURE. Commit a result as declined. Idempotent — an already-committed result is
 * returned unchanged so a double-click cannot rewrite a "spent" into a "declined".
 */
export function declineResult(result) {
  if (result?.state === "committed") return result;
  const next = structuredClone(result);
  next.state = "committed";
  next.commitReason = "declined";
  return next;
}

/**
 * PURE. F:714 — a crit refunds one spent use of an X/Rest feature.
 *
 * The rule does not say WHICH feature when several have spent uses, so this picks
 * the first entry with `used > 0` in stored order: deterministic, and identical on
 * every client. See the T1.1 report — if MCDM intends a player choice, the picker
 * belongs on the card (T2.2) and should call this with an explicit name.
 *
 * @returns {{xRest: Array, refunded: string|null}}
 */
export function xRestRefundOnCrit(xRest = [], name = null) {
  const list = Array.isArray(xRest) ? xRest : [];
  const i = name === null
    ? list.findIndex(e => (Number(e?.used) || 0) > 0)
    : list.findIndex(e => e?.name === name && (Number(e?.used) || 0) > 0);
  if (i < 0) return { xRest: list, refunded: null };
  const next = list.map((e, j) => (j === i ? { ...e, used: Math.max(0, (Number(e.used) || 0) - 1) } : e));
  return { xRest: next, refunded: next[i].name ?? null };
}

// ---------------------------------------------------------------------------
// Commit ledger — the same-tick guard behind "exactly one commit event"
// ---------------------------------------------------------------------------
//
// The DURABLE dedupe is the flag itself: once `state === "committed"` every gate
// refuses. This ledger only closes the window where two handlers both read
// `pending` before either has written — which is not hypothetical, because
// renderChatMessageHTML fires TWICE per render (API-NOTES §2) and a naively
// bound button is bound twice.
//
// Capped, because a long session produces thousands of messages. Eviction is safe:
// an evicted id is an old message that is already committed in its flag, so the
// state gate refuses it long before the ledger is consulted.

const COMMIT_LEDGER_CAP = 512;
const _committed = new Set();
const _inFlight = new Set();

/** @returns {boolean} true the first time this message id is claimed, false after. */
export function claimCommit(messageId) {
  if (!messageId) return true;               // message-less flows (tests, probes)
  if (_committed.has(messageId)) return false;
  if (_committed.size >= COMMIT_LEDGER_CAP) {
    _committed.delete(_committed.values().next().value);
  }
  _committed.add(messageId);
  return true;
}

/** Fire `crowsTestCommitted` at most once per message. @returns {boolean} whether it fired. */
export function emitTestCommitted(result, message = null) {
  if (!claimCommit(message?.id)) return false;
  globalThis.Hooks?.callAll?.("crowsTestCommitted", result, message);
  return true;
}

/** Test-only. Clears the ledger so suites do not leak state into one another. */
export function __resetCommitLedger() {
  _committed.clear();
  _inFlight.clear();
}

// ---------------------------------------------------------------------------
// Foundry layer
// ---------------------------------------------------------------------------

function defaultGetActor(actorId) {
  return globalThis.game?.actors?.get?.(actorId) ?? null;
}

function notify(msg) {
  globalThis.ui?.notifications?.warn?.(msg);
}

/** Read the TestResult off a message. Works with a real ChatMessage or a plain object. */
export function readTestFlag(message) {
  if (!message) return null;
  if (typeof message.getFlag === "function") return message.getFlag("crows", "test") ?? null;
  return globalThis.foundry?.utils?.getProperty?.(message, "flags.crows.test") ?? null;
}

async function writeTestFlag(message, result) {
  await message.update({ "flags.crows.test": result });
}

/** Decrement one remaining use. NEVER touches `max` — that is the owned pool. */
async function decrementExpertiseUse(actor, key) {
  const store = actor?.system?.expertises;
  const { value } = readExpertiseUses(actor, key);
  const nextValue = Math.max(0, value - 1);
  if (Array.isArray(store)) {
    const arr = store.map(e => (e?.key === key ? { ...e, value: nextValue } : { ...e }));
    await actor.update({ "system.expertises": arr });
  } else {
    await actor.update({ [`system.expertises.${key}.value`]: nextValue });
  }
}

/**
 * Spend one use of `expertiseKey` on the test stored on `message`, and COMMIT.
 *
 * Idempotent three ways over, because one click must never spend two uses:
 *  1. the flag's `state === "committed"` refuses every later call (durable);
 *  2. an in-flight lock refuses a second click while the update is in flight;
 *  3. the commit ledger refuses a second `crowsTestCommitted` for this message.
 *
 * The message flag is written BEFORE the actor is decremented. That ordering is
 * deliberate: the flag is the claim, so a failure between the two can at worst
 * leave a committed card whose use was not deducted (visible, and in the
 * player's favour) rather than a burned use that can be burned again on retry.
 *
 * @param {ChatMessage|object} message
 * @param {string} expertiseKey
 * @returns {Promise<object|null>} the final TestResult
 */
export async function applyExpertise(message, expertiseKey, {
  getActor = defaultGetActor,
  emit = emitTestCommitted
} = {}) {
  const result = readTestFlag(message);
  if (!result) return null;
  if (result.state === "committed") return result;          // (1)
  const id = message?.id ?? null;
  if (id && _inFlight.has(id)) return result;               // (2)

  const actor = getActor(result.actorId);
  if (!actor) {
    notify("This test's actor is no longer available.");
    return result;
  }
  if (actor.isOwner !== true) {
    // The render hook runs on EVERY client, so every player's browser binds this
    // button. Non-owners bail here rather than relying on the server rejecting
    // their update.
    return result;
  }

  const refusal = canSpendExpertise(result, expertiseKey, actor);
  if (refusal) {
    notify(refusal);
    return result;
  }

  const next = spendExpertise(result, expertiseKey);
  if (id) _inFlight.add(id);
  try {
    await writeTestFlag(message, next);
    try {
      await decrementExpertiseUse(actor, expertiseKey);
    } catch (err) {
      console.warn("crows | expertise committed but the use could not be deducted", err);
    }
    emit(next, message);                                    // (3)
  } finally {
    if (id) _inFlight.delete(id);
  }
  return next;
}

/**
 * Resolve the test as rolled. REQUIRED — without it a card with a legal spend
 * available never leaves `pending` and nothing downstream ever fires.
 */
export async function declineExpertise(message, {
  getActor = defaultGetActor,
  emit = emitTestCommitted
} = {}) {
  const result = readTestFlag(message);
  if (!result) return null;
  if (result.state === "committed") return result;
  const id = message?.id ?? null;
  if (id && _inFlight.has(id)) return result;

  const actor = getActor(result.actorId);
  if (actor && actor.isOwner !== true) return result;

  const next = declineResult(result);
  if (id) _inFlight.add(id);
  try {
    await writeTestFlag(message, next);
    emit(next, message);
  } finally {
    if (id) _inFlight.delete(id);
  }
  return next;
}

/**
 * Bind the test card's spend/decline buttons, idempotently.
 *
 * Register from the entry point (T2.3 owns module/crows.mjs):
 *
 *   Hooks.on("renderChatMessageHTML", (message, html) => bindTestCardActions(message, html));
 *
 * Two things this guards, both verified live on 14.367 (API-NOTES §2/§3):
 *  - the hook FIRES TWICE per render, so an unmarked binding is bound twice and
 *    one click spends two uses;
 *  - `html` is a native HTMLLIElement, NOT jQuery, so `html.find()` throws.
 */
export function bindTestCardActions(message, html) {
  if (!html?.querySelectorAll) return;
  for (const btn of html.querySelectorAll('[data-action^="crows-"][data-action$="-expertise"]')) {
    if (btn.dataset.crowsBound === "1") continue;
    btn.dataset.crowsBound = "1";
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const el = ev.currentTarget;
      if (el.dataset.action === "crows-spend-expertise") {
        await applyExpertise(message, el.dataset.expertise);
      } else {
        await declineExpertise(message);
      }
    });
  }
}

/**
 * The expertise/commit half of T1.1's public surface. Folded into `ROLL_API` in
 * roll.mjs so the entry point (T2.3 owns module/crows.mjs) needs exactly one
 * line, plus one hook registration:
 *
 *   Object.assign(game.crows, ROLL_API);
 *   Hooks.on("renderChatMessageHTML", (message, html) => bindTestCardActions(message, html));
 */
export const EXPERTISE_API = Object.freeze({
  canSpendExpertise,
  categoryAllows,
  legalExpertiseSpends,
  hasLegalSpend,
  readExpertiseUses,
  applyExpertise,
  declineExpertise,
  bindTestCardActions,
  emitTestCommitted,
  xRestRefundOnCrit,
  applyCritXRestRefund
});

/** F:714. Write the crit's X/Rest refund back to the actor. No-op when nothing is spent. */
export async function applyCritXRestRefund(actor, name = null) {
  const current = actor?.system?.xRest;
  if (!Array.isArray(current) || !current.length) return null;
  const { xRest, refunded } = xRestRefundOnCrit(current, name);
  if (!refunded) return null;
  await actor.update({ "system.xRest": xRest });
  return refunded;
}
