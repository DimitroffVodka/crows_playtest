/**
 * Commerce — the bounded money transaction seam.
 *
 * Money is two physical sources on one Actor: loose coin in
 * `system.currency`, and Coin Purse Items with their own `held` value.  This
 * module plans against the existing `Layout.coin` authority and only then
 * writes the bounded Actor/embedded-Item changes.  It deliberately does not
 * know Village prices, crafting recipes, or material consumption.
 *
 * The writer protocol is option (b) from the Commerce plan: the current
 * `game.users.activeGM` is the designated writer, requests are serialized per
 * Actor, every write re-checks live state, and `txId`/expected revision are
 * durable in an Actor-scoped receipt journal.  Foundry has no lease or
 * compare-and-swap primitive, so this module never claims atomicity across a
 * GM transition.  A visible receipt makes retries idempotent; an ambiguous
 * state is reported for reconciliation instead of being replayed. Requests
 * from a non-writer use Foundry's `system.crows` socket channel as transport
 * only. The channel carries an explicit request envelope and its acknowledgement
 * timeout is still an authority-unavailable outcome; it is never evidence that
 * a write did or did not land.
 */

import {
  layoutFor,
  coinSummary,
  looseCoinReservation,
  itemId
} from "./slots.mjs";
import { CROWS } from "../config.mjs";

const SOCKET_ROUTE_KEYS = ["routeToGM", "routeToWriter", "dispatchToGM"];
export const COMMERCE_SOCKET_EVENT = "system.crows";
const commerceSocketBindings = new WeakMap();
const ROUTED_CONTEXT_TOKEN = Symbol("crows-commerce-routed-context");
let commerceSocketRegistered = false;

/** The refusal vocabulary shared by pay/receive and the future grant seam. */
export const COMMERCE_ERRORS = Object.freeze([
  "insufficient-funds",
  "no-capacity",
  "overflow",
  "unauthorized",
  "authority-unavailable",
  "conflict",
  "duplicate-detected",
  "invalid-source",
  "write-failed",
  "invalid-request"
]);

/**
 * Contexts are policy labels, not prices or permissions supplied by a chat
 * card.  The caller chooses one explicitly; authorization below still checks
 * the actual requester and Actor ownership.
 */
export const COMMERCE_CONTEXTS = Object.freeze([
  "shopping",
  "merchant",
  "purchase",
  "artisan",
  "artisan-commission",
  "workshop",
  "inn",
  "beacon",
  "material-purchase",
  "crafting",
  "village-treasury",
  "institution-funding",
  "treasury",
  "deposit",
  "withdraw",
  "party-deposit",
  "party-withdraw",
  "grant"
]);

const CONTEXT_ALIASES = Object.freeze({
  shop: "shopping",
  shopping: "shopping",
  merchant: "merchant",
  purchase: "purchase",
  buy: "purchase",
  artisan: "artisan",
  commission: "artisan-commission",
  "artisan-commission": "artisan-commission",
  "artisan_commission": "artisan-commission",
  "artisan commission": "artisan-commission",
  workshop: "workshop",
  inn: "inn",
  beacon: "beacon",
  "material-purchase": "material-purchase",
  "material_purchase": "material-purchase",
  crafting: "crafting",
  treasury: "treasury",
  "village-treasury": "village-treasury",
  "village_treasury": "village-treasury",
  village: "village-treasury",
  "village-funding": "village-treasury",
  "institution-funding": "institution-funding",
  "institution_funding": "institution-funding",
  institution: "institution-funding",
  deposit: "deposit",
  withdraw: "withdraw",
  "party-deposit": "party-deposit",
  "party_deposit": "party-deposit",
  "party-withdraw": "party-withdraw",
  "party_withdraw": "party-withdraw",
  grant: "grant"
});

const TREASURY_CONTEXTS = new Set([
  "village-treasury", "institution-funding", "treasury"
]);

const PARTY_TRANSFER_CONTEXTS = new Set([
  "deposit", "withdraw", "party-deposit", "party-withdraw"
]);

const ROUTED_CONTEXT_KEYS = new Set([
  "txId", "transactionId", "expectedRevision", "revision", "commerceRevision",
  "actorUuid", "requester", "user", "caller", "routeToGM", "routeToWriter",
  "dispatchToGM", "resolveActor", "refreshActor", "authority", "authorityCheck",
  "chatHook", "onCommitted", "announce", "chat", "emit", "writer", "routed",
  "writerUser", "designatedWriter", "routeTimeoutMs", "socketRoute"
]);

/* -------------------------------------------------------------------------- */
/*  Platform-neutral values and identity                                       */
/* -------------------------------------------------------------------------- */

export function cloneCommerceValue(value) {
  if (value === undefined) return undefined;
  try {
    if (typeof globalThis.foundry?.utils?.deepClone === "function") {
      return globalThis.foundry.utils.deepClone(value);
    }
  } catch { /* fall through */ }
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch { /* functions/proxies are not structured-cloneable */ }
  try { return JSON.parse(JSON.stringify(value)); }
  catch { return value; }
}

function stableValue(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, stableValue(value[key])]));
}

/** Stable fingerprint for a transaction input or money state. */
export function commerceInputFingerprint(value) {
  return JSON.stringify(stableValue(value));
}

export const commerceFingerprint = commerceInputFingerprint;

function actorIdentity(actor) {
  const identity = actor?.uuid ?? actor?.id ?? actor?._id;
  return identity == null ? "" : String(identity);
}

export function actorUuid(actor) {
  return actorIdentity(actor);
}

function userIdentity(user) {
  const identity = user?.id ?? user?._id;
  return identity == null ? "" : String(identity);
}

function sameUser(left, right) {
  const a = userIdentity(left);
  const b = userIdentity(right);
  return !!a && !!b && a === b;
}

function requesterFor(context = {}) {
  if (isRoutedContext(context)) {
    return context?.requester ?? context?.user ?? context?.caller
      ?? globalThis.game?.user ?? null;
  }
  // A public request is authorized as the connected Foundry user. Context
  // metadata cannot impersonate another User document. The explicit fallback
  // is only useful to platform-neutral callers with no game singleton.
  return globalThis.game?.user
    ?? context?.requester ?? context?.user ?? context?.caller ?? null;
}

function writerFor(context = {}) {
  if (context?.[ROUTED_CONTEXT_TOKEN] === true) {
    return context?.writerUser ?? context?.writer ?? context?.designatedWriter
      ?? requesterFor(context);
  }
  // A caller-supplied writer identity is metadata, not authority. Only the
  // private routed token set by this module may designate a different writer.
  return requesterFor(context);
}

function isRoutedContext(context = {}) {
  return context?.[ROUTED_CONTEXT_TOKEN] === true;
}

function integer(value, fallback = null) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = integer(value, null);
  return number != null && number >= 0 ? number : fallback;
}

function actorItems(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return [...items];
  if (Array.isArray(items.contents)) return [...items.contents];
  if (typeof items.values === "function") {
    try { return [...items.values()]; } catch { /* fall through */ }
  }
  try { return [...items]; } catch { return []; }
}

function itemFor(actor, id) {
  const key = String(id ?? "");
  if (!key) return null;
  const items = actor?.items;
  if (typeof items?.get === "function") {
    try { return items.get(key) ?? null; } catch { /* fall through */ }
  }
  return actorItems(actor).find(item => String(itemId(item) ?? "") === key) ?? null;
}

function sortByStableId(entries = []) {
  return [...entries].sort((left, right) => {
    const a = String(left?.id ?? left?.itemId ?? "");
    const b = String(right?.id ?? right?.itemId ?? "");
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/* -------------------------------------------------------------------------- */
/*  Context and authority                                                      */
/* -------------------------------------------------------------------------- */

export function normalizeCommerceContext(context = {}) {
  const raw = typeof context === "string" ? { kind: context }
    : context && typeof context === "object" ? context : {};
  let kind = raw.kind ?? raw.context ?? raw.purpose ?? raw.transactionContext ?? raw.type ?? raw.action;
  if (kind && typeof kind === "object") kind = kind.kind ?? kind.context ?? kind.name;
  const key = String(kind ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return CONTEXT_ALIASES[key] ?? "";
}

function safeContextForFingerprint(context, kind = normalizeCommerceContext(context)) {
  const raw = context && typeof context === "object" ? context : {};
  const metadata = {};
  for (const [key, value] of Object.entries(raw)) {
    if (ROUTED_CONTEXT_KEYS.has(key)) continue;
    if (["kind", "context", "purpose", "transactionContext", "type", "action"].includes(key)) continue;
    if (typeof value === "function") continue;
    try { metadata[key] = cloneCommerceValue(value); }
    catch { /* an uncloneable caller-only value is not transaction metadata */ }
  }
  return { kind, metadata };
}

export function commerceTransactionFingerprint(actor, operation, amount, context = {}) {
  return commerceInputFingerprint({
    actorUuid: actorIdentity(actor),
    operation: String(operation ?? ""),
    amount: nonNegativeInteger(amount),
    context: safeContextForFingerprint(context)
  });
}

function isGMUser(user) {
  if (!user) return false;
  if (user.isGM === true || user.isRef === true) return true;
  // Foundry's GAMEMASTER role is 3.  Do not treat an arbitrary client-supplied
  // context flag as authority; this reads the User document itself.
  return Number(user.role) >= 3;
}

function ownershipValue(actor, user) {
  const id = userIdentity(user);
  if (!actor || !user) return null;

  try {
    if (typeof actor.testUserPermission === "function") {
      const result = actor.testUserPermission(user, "OWNER");
      if (typeof result === "boolean") return result;
    }
  } catch { /* fall through to the document-shaped probes */ }

  if (actor.isOwner === true) return true;
  if (actor.owner === true) return true;
  if (actor.ownerId != null && id && String(actor.ownerId) === id) return true;
  if (user.character && (user.character === actor
      || actorIdentity(user.character) === actorIdentity(actor))) return true;

  for (const key of ["ownership", "permission"]) {
    const map = actor?.[key];
    if (!map || typeof map !== "object") continue;
    const level = map[id] ?? map.default;
    if (level === true || String(level).toUpperCase() === "OWNER") return true;
    if (Number(level) >= 3) return true;
  }
  return false;
}

function contextNeedsTreasuryAuthority(kind) {
  return TREASURY_CONTEXTS.has(kind);
}

/**
 * Authorize against the actual Actor/User documents.  Party-specific transfer
 * labels are accepted for the native Party ticket when it lands, but this
 * service does not register or special-case the Party Actor type itself.
 */
export function isCommerceAuthorized(actor, context = {}, user = null) {
  const kind = normalizeCommerceContext(context);
  if (!COMMERCE_CONTEXTS.includes(kind)) return false;
  const requester = user ?? requesterFor(context);
  if (isGMUser(requester)) return true;
  if (!requester) return false;
  // All ordinary shopping/receive operations are owner-scoped.  Party deposit
  // and withdrawal use the same document ownership rule; GM override above is
  // the only special permission.
  if (contextNeedsTreasuryAuthority(kind)) return false;
  if (PARTY_TRANSFER_CONTEXTS.has(kind)) return ownershipValue(actor, requester) === true;
  return ownershipValue(actor, requester) === true;
}

export const commerceAuthorized = isCommerceAuthorized;

function usersHaveActiveGMProperty(users) {
  try { return users != null && "activeGM" in Object(users); }
  catch { return false; }
}

/** Deterministic counterpart of Foundry's computed `game.users.activeGM`. */
export function getActiveCommerceGM() {
  const users = globalThis.game?.users;
  if (users == null) return null;

  // Foundry v14 exposes this as a getter.  A present null is authoritative:
  // there is no designated writer during a handover.
  if (usersHaveActiveGMProperty(users)) {
    try { return users.activeGM ?? null; }
    catch { /* fall through to a collection scan for small test doubles */ }
  }

  let candidates = [];
  try {
    if (typeof users.filter === "function") candidates = [...users.filter(user => user?.active && isGMUser(user))];
    else if (Array.isArray(users)) candidates = users.filter(user => user?.active && isGMUser(user));
    else if (Array.isArray(users.contents)) candidates = users.contents.filter(user => user?.active && isGMUser(user));
    else if (typeof users[Symbol.iterator] === "function") {
      candidates = [...users].map(entry => Array.isArray(entry) ? entry[1] : entry)
        .filter(user => user?.active && isGMUser(user));
    }
  } catch { candidates = []; }

  candidates.sort((left, right) => {
    const roleOrder = (Number(right?.role) || 0) - (Number(left?.role) || 0);
    if (roleOrder) return roleOrder;
    const a = userIdentity(left);
    const b = userIdentity(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return candidates[0] ?? null;
}

export const activeCommerceGM = getActiveCommerceGM;

export function isCommerceDesignatedWriter(user = globalThis.game?.user) {
  const designated = getActiveCommerceGM();
  return !!designated && sameUser(user, designated);
}

function authorityResult(reason = "request-must-run-on-designated-gm") {
  const designated = getActiveCommerceGM();
  if (!designated) {
    return {
      ok: false, error: "authority-unavailable", code: "no-active-gm", reason: "no-active-gm"
    };
  }
  return {
    ok: false,
    error: "authority-unavailable",
    reason,
    activeGMId: userIdentity(designated)
  };
}

function writerAuthority(context = {}) {
  const designated = getActiveCommerceGM();
  if (!designated) return { ok: false, ...authorityResult("no-active-gm") };
  const writer = writerFor(context);
  if (!sameUser(writer, designated)) {
    return { ok: false, ...authorityResult() };
  }
  return { ok: true, designated, writer, requester: requesterFor(context) };
}

/* -------------------------------------------------------------------------- */
/*  Durable receipt state                                                      */
/* -------------------------------------------------------------------------- */

function receiptEntries(rawReceipts) {
  if (Array.isArray(rawReceipts)) return rawReceipts;
  if (rawReceipts && typeof rawReceipts === "object") {
    return Object.entries(rawReceipts).map(([txId, receipt]) => ({ txId, ...receipt }));
  }
  return [];
}

function rawCommerce(actor) {
  const raw = actor?.system?.commerce;
  return raw && typeof raw === "object" ? raw : {};
}

export function readCommerceRevision(actor) {
  const revision = Number(rawCommerce(actor).revision);
  return Number.isFinite(revision) && revision >= 0 ? Math.floor(revision) : 0;
}

function commerceState(actor) {
  const raw = rawCommerce(actor);
  return {
    ...cloneCommerceValue(raw),
    revision: readCommerceRevision(actor),
    receipts: receiptEntries(raw.receipts).map(cloneCommerceValue)
  };
}

function receiptId(receipt) {
  return String(receipt?.txId ?? receipt?.transactionId ?? "");
}

export function getCommerceReceipt(actor, txId) {
  const key = String(txId ?? "");
  if (!key) return null;
  const receipt = commerceState(actor).receipts.find(entry => receiptId(entry) === key);
  return receipt ? cloneCommerceValue(receipt) : null;
}

export const inspectCommerceReceipt = getCommerceReceipt;

function replaceReceipt(state, receipt) {
  const key = receiptId(receipt);
  const list = state.receipts.filter(entry => receiptId(entry) !== key);
  list.push(cloneCommerceValue(receipt));
  // Keep every recovery entry. The journal is Actor-scoped and the ticket does
  // not settle a retention policy; pruning here would silently remove the
  // evidence needed to replay an old idempotency token.
  return { ...state, receipts: list };
}

async function writeCommerceState(actor, state, updates = {}) {
  if (typeof actor?.update !== "function") throw new Error("actor.update unavailable");
  return actor.update({ ...updates, "system.commerce": cloneCommerceValue(state) });
}

async function persistReceipt(actor, receipt, { revision = null, updates = {} } = {}) {
  const state = commerceState(actor);
  if (revision != null) state.revision = nonNegativeInteger(revision, state.revision);
  const next = replaceReceipt(state, receipt);
  await writeCommerceState(actor, next, updates);
  return next;
}

/* -------------------------------------------------------------------------- */
/*  Snapshots and pure plans                                                   */
/* -------------------------------------------------------------------------- */

function moneyFromLayout(layout) {
  const coin = layout?.coin ?? { loose: 0, purses: [] };
  return {
    loose: Math.max(0, Math.floor(Number(coin.loose) || 0)),
    purses: sortByStableId((coin.purses ?? []).map(purse => ({
      id: String(purse?.id ?? ""),
      held: Math.max(0, Math.floor(Number(purse?.held) || 0)),
      cap: Math.max(0, Math.floor(Number(purse?.cap) || 0))
    })))
  };
}

function moneyFingerprint(money) {
  return commerceInputFingerprint({
    loose: money?.loose ?? 0,
    purses: sortByStableId(money?.purses ?? []).map(purse => ({
      id: String(purse?.id ?? ""),
      held: nonNegativeInteger(purse?.held),
      cap: nonNegativeInteger(purse?.cap)
    }))
  });
}

function moneyEqual(left, right) {
  return moneyFingerprint(left) === moneyFingerprint(right);
}

function snapshotMoney(snapshot) {
  return {
    loose: snapshot?.loose ?? snapshot?.money?.loose ?? 0,
    purses: snapshot?.purses ?? snapshot?.money?.purses ?? []
  };
}

/** Read the existing layout authority into a detached, durable snapshot. */
export function commerceSnapshot(actor) {
  const layout = layoutFor(actor);
  const money = moneyFromLayout(layout);
  const summary = coinSummary(layout);
  const reservation = looseCoinReservation(layout, money.loose);
  return {
    actorId: String(actor?.id ?? actor?._id ?? ""),
    actorUuid: actorIdentity(actor),
    actorType: actor?.type ?? null,
    revision: readCommerceRevision(actor),
    loose: money.loose,
    purses: cloneCommerceValue(money.purses),
    money: cloneCommerceValue(money),
    totalHeld: summary.totalHeld,
    purseRoom: summary.purseRoom,
    purseCapacity: summary.purseCapacity,
    overflow: summary.overflow,
    layout: {
      capacities: cloneCommerceValue(layout.capacities),
      unplaced: cloneCommerceValue(layout.unplaced),
      coin: cloneCommerceValue(layout.coin)
    },
    reservation: cloneCommerceValue(reservation),
    fingerprint: moneyFingerprint(money)
  };
}

export const readCommerceSnapshot = commerceSnapshot;

function validateRawMoneySources(actor) {
  const currency = actor?.system?.currency;
  if (currency != null) {
    const number = Number(currency);
    if (!Number.isInteger(number) || number < 0) return "invalid loose coin source";
  }
  for (const item of actorItems(actor)) {
    const purse = item?.system?.purse;
    if (!purse?.isPurse) continue;
    if (!itemId(item)) return "invalid purse source: item id is missing";
    const held = Number(purse.held);
    if (!Number.isInteger(held) || held < 0) return `invalid purse source: ${itemId(item) ?? "unknown"}`;
    const capacity = purse.baseCapacity == null ? CROWS.purseBaseCapacity : Number(purse.baseCapacity);
    if (!Number.isInteger(capacity) || capacity < 0) {
      return `invalid purse source capacity: ${itemId(item)}`;
    }
  }
  return null;
}

function planBase(operation, actor, amount, snapshot) {
  const money = snapshotMoney(snapshot);
  return {
    operation,
    actorId: snapshot.actorId,
    actorUuid: snapshot.actorUuid,
    amount,
    before: cloneCommerceValue(money),
    pre: cloneCommerceValue(money),
    sources: [],
    destinations: [],
    post: null,
    plannedSources: [],
    plannedDestinations: []
  };
}

/** Build the deterministic loose-first debit without touching an Actor. */
export function planPay(actor, amount, snapshot = null) {
  const value = nonNegativeInteger(amount, null);
  if (value == null) return { ok: false, error: "invalid-request", reason: "amount-must-be-non-negative-integer" };
  const current = snapshot ?? commerceSnapshot(actor);
  const money = snapshotMoney(current);
  const plan = planBase("pay", actor, value, current);
  let remaining = value;
  const sources = [];

  const looseDebit = Math.min(remaining, money.loose);
  sources.push({
    kind: "loose", source: "loose", actorId: current.actorId,
    before: money.loose, amount: looseDebit, debit: looseDebit,
    after: money.loose - looseDebit
  });
  remaining -= looseDebit;

  const purses = sortByStableId(money.purses);
  const postPurses = [];
  for (const purse of purses) {
    const debit = Math.min(remaining, purse.held);
    const source = {
      kind: "purse", source: "purse", itemId: purse.id,
      before: purse.held, cap: purse.cap, amount: debit, debit,
      after: purse.held - debit
    };
    sources.push(source);
    postPurses.push({ ...purse, held: purse.held - debit });
    remaining -= debit;
  }

  plan.sources = sources;
  plan.plannedSources = sources;
  plan.post = { loose: money.loose - looseDebit, purses: postPurses };
  plan.after = cloneCommerceValue(plan.post);
  plan.shortfall = remaining;
  plan.totalAvailable = value - remaining;
  if (remaining > 0) {
    return {
      ok: false,
      error: "insufficient-funds",
      reason: "insufficient-funds",
      shortfall: remaining,
      deficit: remaining,
      plan
    };
  }
  return { ok: true, plan };
}

/** Build purse-first credit plus the computed loose reservation. */
export function planReceive(actor, amount, snapshot = null) {
  const value = nonNegativeInteger(amount, null);
  if (value == null) return { ok: false, error: "invalid-request", reason: "amount-must-be-non-negative-integer" };
  const current = snapshot ?? commerceSnapshot(actor);
  const money = snapshotMoney(current);
  const plan = planBase("receive", actor, value, current);

  if (Number(current?.overflow) > 0) {
    return {
      ok: false, error: "overflow", reason: "purse-over-capacity",
      overflow: Number(current.overflow), plan, snapshot: current
    };
  }
  // A Party layout intentionally has no positional carry slots. Its purse
  // room remains usable, and the target's own uncapped strongbox policy lets
  // a loose remainder bypass carry-slot accounting; only a future configured
  // cap can refuse it through the reservation query below.
  if (current?.reservation && current.reservation.ok === false && !current?.layout?.party) {
    return {
      ok: false, error: "overflow", reason: "loose-over-capacity",
      overflow: current.reservation.excess, excess: current.reservation.excess,
      plan, snapshot: current
    };
  }

  let remaining = value;
  const destinations = [];
  const postPurses = [];
  for (const purse of sortByStableId(money.purses)) {
    const room = Math.max(0, purse.cap - purse.held);
    const credit = Math.min(remaining, room);
    const destination = {
      kind: "purse", destination: "purse", itemId: purse.id,
      before: purse.held, cap: purse.cap, amount: credit, credit,
      after: purse.held + credit
    };
    destinations.push(destination);
    postPurses.push({ ...purse, held: purse.held + credit });
    remaining -= credit;
  }

  const prospectiveLoose = money.loose + remaining;
  const reservation = looseCoinReservation(
    // `commerceSnapshot` retains no mutable layout; this pure query is rebuilt
    // from the original Actor only for this preflight and never mutates it.
    layoutFor(actor), prospectiveLoose
  );

  const looseDestination = {
    kind: "loose", destination: "loose", actorId: current.actorId,
    before: money.loose, amount: remaining, credit: remaining,
    after: prospectiveLoose, reservation: cloneCommerceValue(reservation)
  };

  if (remaining > 0 && !reservation.ok) {
    const excess = Math.max(0, reservation.excess);
    destinations.push(looseDestination);
    plan.destinations = destinations;
    plan.plannedDestinations = destinations;
    plan.post = { loose: prospectiveLoose, purses: postPurses };
    plan.after = cloneCommerceValue(plan.post);
    plan.loose = looseDestination;
    return {
      ok: false,
      error: "no-capacity",
      reason: "loose-reservation-does-not-fit",
      excess,
      overflow: excess,
      looseRemainder: remaining,
      reservation: cloneCommerceValue(reservation),
      plan,
      snapshot: current
    };
  }

  if (remaining > 0) {
    destinations.push(looseDestination);
    plan.loose = looseDestination;
  } else {
    plan.loose = {
      kind: "loose", destination: "loose", actorId: current.actorId,
      before: money.loose, amount: 0, credit: 0, after: money.loose,
      reservation: cloneCommerceValue(reservation)
    };
  }
  plan.destinations = destinations;
  plan.plannedDestinations = destinations;
  plan.post = { loose: prospectiveLoose, purses: postPurses };
  plan.after = cloneCommerceValue(plan.post);
  plan.reservation = cloneCommerceValue(reservation);
  plan.looseRemainder = remaining;
  return { ok: true, plan };
}

/* -------------------------------------------------------------------------- */
/*  Queue and live resolution                                                  */
/* -------------------------------------------------------------------------- */

const commerceQueues = new Map();

/** Execute one Actor-scoped task in deterministic FIFO order. */
export function enqueueCommerceOperation(actor, task) {
  const key = actorIdentity(actor);
  if (!key || typeof task !== "function") {
    return Promise.resolve({ ok: false, error: "invalid-source", reason: "actor-required" });
  }
  const prior = commerceQueues.get(key) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(() => task());
  commerceQueues.set(key, current);
  current.finally(() => {
    if (commerceQueues.get(key) === current) commerceQueues.delete(key);
  }).catch(() => undefined);
  return current;
}

export const queueCommerceOperation = enqueueCommerceOperation;
export const withCommerceOperation = enqueueCommerceOperation;

async function resolveLiveActor(actor, context = {}) {
  const resolver = context?.resolveActor ?? context?.refreshActor;
  if (typeof resolver === "function") {
    const resolved = await resolver(actor);
    return resolved ?? null;
  }
  // A document reference is already the authorized input.  A collection read
  // is only a refresh of that same identity, never resolution of a caller-only
  // arbitrary id.  Test doubles commonly omit game.actors, so retain actor.
  const actors = globalThis.game?.actors;
  if (actors && actor?.id != null && typeof actors.get === "function") {
    try {
      const live = actors.get(actor.id) ?? actors.get(actor.uuid);
      if (live && actorIdentity(live) === actorIdentity(actor)) return live;
    } catch { /* retain the supplied document */ }
  }
  return actor;
}

function sameActor(left, right) {
  return !!left && !!right && actorIdentity(left) === actorIdentity(right);
}

function liveWriterCheck(actor, context, expectedRevision, expectedMoney = null) {
  const authority = writerAuthority(context);
  if (!authority.ok) return authority;
  if (!isCommerceAuthorized(actor, context, requesterFor(context))) {
    return { ok: false, error: "unauthorized", reason: "requester-not-authorized" };
  }
  let snapshot;
  try { snapshot = commerceSnapshot(actor); }
  catch (error) {
    return { ok: false, error: "invalid-source", reason: String(error?.message ?? error) };
  }
  if (snapshot.revision !== expectedRevision) {
    return {
      ok: false, error: "conflict", code: "stale-revision", reason: "stale-revision",
      stale: true, retryable: true, expectedRevision, currentRevision: snapshot.revision,
      snapshot
    };
  }
  if (expectedMoney && !moneyEqual(snapshotMoney(snapshot), expectedMoney)) {
    return {
      ok: false, error: "conflict", code: "source-changed", reason: "source-changed",
      stale: true, retryable: true, expectedRevision, currentRevision: snapshot.revision,
      snapshot
    };
  }
  return { ok: true, designated: authority.designated, snapshot };
}

function routeFunction(context = {}) {
  for (const key of SOCKET_ROUTE_KEYS) {
    if (typeof context?.[key] === "function") return context[key];
  }
  return null;
}

function serializableContext(context = {}) {
  const raw = context && typeof context === "object" ? context : { kind: context };
  const out = { kind: normalizeCommerceContext(raw) };
  for (const [key, value] of Object.entries(raw)) {
    if (ROUTED_CONTEXT_KEYS.has(key)) continue;
    if (["kind", "context", "purpose", "transactionContext", "type", "action"].includes(key)) continue;
    if (typeof value === "function") continue;
    try { out[key] = cloneCommerceValue(value); } catch { /* omit caller-only values */ }
  }
  return out;
}

function userFromCollection(users, id) {
  if (!users || id == null) return null;
  try {
    if (typeof users.get === "function") return users.get(id) ?? null;
    const candidates = Array.isArray(users) ? users
      : Array.isArray(users.contents) ? users.contents
        : typeof users[Symbol.iterator] === "function"
          ? [...users].map(entry => Array.isArray(entry) ? entry[1] : entry) : [];
    return candidates.find(user => userIdentity(user) === String(id)) ?? null;
  } catch { return null; }
}

function actorFromUuid(uuid) {
  const key = String(uuid ?? "");
  if (!key) return null;
  const actors = globalThis.game?.actors;
  const id = key.split(".").pop();
  try {
    if (typeof actors?.get === "function") {
      const actor = actors.get(id) ?? actors.get(key);
      if (actor && actorIdentity(actor) === key) return actor;
    }
  } catch { /* fall through */ }
  try {
    const resolved = globalThis.fromUuidSync?.(key);
    return resolved && actorIdentity(resolved) === key ? resolved : null;
  } catch { return null; }
}

/**
 * Register the designated-GM side of the request/acknowledgement protocol.
 * Foundry's socket is a broadcast transport; the explicit envelope and the
 * activeGM check ensure that exactly the computed writer attempts the request.
 * A missing acknowledgement is intentionally left to the requester's timeout
 * path, because it cannot distinguish a lost request from a committed write.
 */
export function registerCommerceSocket(socket = globalThis.game?.socket) {
  commerceSocketRegistered = false;
  if (!socket || typeof socket.on !== "function") return false;
  if (commerceSocketBindings.has(socket)) {
    commerceSocketRegistered = true;
    return true;
  }

  const handler = async (payload, reply) => {
    if (payload?.type !== "request") return;
    const designated = getActiveCommerceGM();
    if (!designated || !sameUser(globalThis.game?.user, designated)) return;

    const respond = result => {
      if (typeof reply !== "function") return;
      try { reply(cloneCommerceValue(result)); } catch { /* socket is gone */ }
    };
    const actor = actorFromUuid(payload.actorUuid);
    const requester = userFromCollection(globalThis.game?.users, payload.requesterId);
    if (!actor) {
      respond(inputFailure(null, "invalid-source", "actor-resolution-failed"));
      return;
    }
    if (!requester) {
      respond(inputFailure(actor, "unauthorized", "requester-not-found"));
      return;
    }

    const context = {
      ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
      txId: payload.txId,
      expectedRevision: payload.expectedRevision,
      requester,
      writer: globalThis.game.user,
      writerUser: globalThis.game.user,
      [ROUTED_CONTEXT_TOKEN]: true
    };
    try {
      const result = await handleCommerceRequest({
        actor, operation: payload.operation, amount: payload.amount, context
      });
      respond(result);
    } catch (error) {
      respond(inputFailure(actor, "write-failed", "socket-request-failed", {
        state: "unknown", reconciliationRequired: true,
        message: String(error?.message ?? error)
      }));
    }
  };

  socket.on(COMMERCE_SOCKET_EVENT, handler);
  commerceSocketBindings.set(socket, handler);
  commerceSocketRegistered = true;
  return true;
}

async function routeOverFoundrySocket(actor, operation, amount, context, authority) {
  const socket = globalThis.game?.socket;
  const requester = requesterFor(context);
  if (!socket || typeof socket.emit !== "function" || !userIdentity(requester)) return null;
  const requestId = `${actorIdentity(actor)}:${String(context.txId ?? context.transactionId ?? "")}`;
  const payload = {
    type: "request",
    requestId,
    actorUuid: actorIdentity(actor),
    actorId: actor?.id ?? actor?._id ?? null,
    operation,
    amount,
    txId: context.txId ?? context.transactionId,
    expectedRevision: context.expectedRevision ?? context.revision ?? context.commerceRevision,
    requesterId: userIdentity(requester),
    context: serializableContext(context)
  };
  const timeout = Number(context.routeTimeoutMs);
  const timeoutMs = Number.isFinite(timeout) && timeout >= 0 ? timeout : 15000;
  return new Promise(resolve => {
    let settled = false;
    let timer = null;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => finish({
      ok: false, error: "authority-unavailable", reason: "writer-route-timeout",
      activeGMId: userIdentity(authority.designated)
    }), timeoutMs);
    try {
      socket.emit(COMMERCE_SOCKET_EVENT, payload, response => finish(response ?? {
        ok: false, error: "authority-unavailable", reason: "writer-route-empty-result",
        activeGMId: userIdentity(authority.designated)
      }));
    } catch (error) {
      finish({
        ok: false, error: "authority-unavailable", reason: "writer-route-failed",
        activeGMId: userIdentity(authority.designated), message: String(error?.message ?? error)
      });
    }
  });
}

async function routeToDesignatedWriter(actor, operation, amount, context, authority) {
  const route = routeFunction(context);
  if (!route && !commerceSocketRegistered) return null;
  if (!route) return routeOverFoundrySocket(actor, operation, amount, context, authority);
  const routedContext = {
    ...context,
    writer: authority.designated,
    writerUser: authority.designated,
    [ROUTED_CONTEXT_TOKEN]: true
  };
  try {
    const result = await route({
      actor,
      operation,
      amount,
      context: routedContext,
      txId: context.txId ?? context.transactionId,
      expectedRevision: context.expectedRevision ?? context.revision ?? context.commerceRevision,
      designatedGM: authority.designated
    }, authority.designated);
    return result ?? {
      ok: false, error: "authority-unavailable", reason: "writer-route-empty-result",
      activeGMId: userIdentity(authority.designated)
    };
  } catch (error) {
    return {
      ok: false, error: "authority-unavailable", reason: "writer-route-failed",
      activeGMId: userIdentity(authority.designated), message: String(error?.message ?? error)
    };
  }
}

function requestContext(context = {}) {
  const raw = typeof context === "string" ? { kind: context }
    : context && typeof context === "object" ? context : {};
  const txId = String(raw.txId ?? raw.transactionId ?? "").trim();
  const expectedRevision = integer(raw.expectedRevision ?? raw.revision ?? raw.commerceRevision, null);
  return { raw, txId, expectedRevision, kind: normalizeCommerceContext(raw) };
}

function inputFailure(actor, error, reason, extra = {}) {
  return {
    ok: false, error, reason,
    actorId: String(actor?.id ?? actor?._id ?? ""), actorUuid: actorIdentity(actor),
    ...extra
  };
}

function validateRequest(actor, amount, context, operation) {
  if (!actor || typeof actor !== "object") return inputFailure(actor, "invalid-source", "actor-required");
  if (!actorIdentity(actor)) return inputFailure(actor, "invalid-source", "actor-identity-required");
  if (!Number.isInteger(amount) || amount < 0) {
    return inputFailure(actor, "invalid-request", "amount-must-be-non-negative-integer");
  }
  const request = requestContext(context);
  if (!request.txId) return inputFailure(actor, "invalid-request", "tx-id-required");
  if (request.expectedRevision == null || request.expectedRevision < 0) {
    return inputFailure(actor, "invalid-request", "expected-revision-required");
  }
  if (!COMMERCE_CONTEXTS.includes(request.kind)) {
    return inputFailure(actor, "unauthorized", "invalid-context");
  }
  const requestedActor = context?.actorUuid;
  if (requestedActor != null && String(requestedActor) !== actorIdentity(actor)) {
    return inputFailure(actor, "invalid-source", "actor-uuid-mismatch");
  }
  return { ok: true, ...request, operation, amount };
}

function resultWithPlan(base, plan, snapshot) {
  return {
    ...base,
    snapshot: cloneCommerceValue(snapshot),
    plan: cloneCommerceValue(plan),
    sources: cloneCommerceValue(plan?.sources ?? []),
    destinations: cloneCommerceValue(plan?.destinations ?? [])
  };
}

function failureResult(error, reason, snapshot, plan, extra = {}) {
  return resultWithPlan({ ok: false, error, reason, ...extra }, plan, snapshot);
}

function receiptMatchesRequest(receipt, fingerprint) {
  return String(receipt?.inputFingerprint ?? receipt?.fingerprint ?? "") === String(fingerprint);
}

function receiptPhase(receipt) {
  return String(receipt?.phase ?? receipt?.state ?? "");
}

function receiptPostMoney(receipt) {
  return receipt?.postMoney ?? receipt?.plan?.post ?? null;
}

function committedReplay(receipt, operation, txId) {
  const result = receipt?.result && typeof receipt.result === "object"
    ? cloneCommerceValue(receipt.result)
    : { ok: true, operation, txId };
  return { ...result, ok: true, replayed: true, txId, receipt: cloneCommerceValue(receipt) };
}

function sourceUpdates(plan) {
  return (plan?.sources ?? []).filter(source => source.kind === "purse" && source.itemId && source.amount > 0)
    .map(source => ({ _id: source.itemId, "system.purse.held": source.after }));
}

function destinationUpdates(plan) {
  return (plan?.destinations ?? []).filter(destination => destination.kind === "purse"
      && destination.itemId && destination.amount > 0)
    .map(destination => ({ _id: destination.itemId, "system.purse.held": destination.after }));
}

function purseUpdatesForPlan(plan) {
  return plan?.operation === "pay" ? sourceUpdates(plan) : destinationUpdates(plan);
}

async function applyPurseUpdates(actor, updates) {
  if (!updates.length) return { ok: true, updates: [] };
  if (typeof actor?.updateEmbeddedDocuments === "function") {
    await actor.updateEmbeddedDocuments("Item", cloneCommerceValue(updates));
    return { ok: true, updates };
  }
  const applied = [];
  for (const update of updates) {
    const item = itemFor(actor, update._id);
    if (typeof item?.update !== "function") throw new Error("item.update unavailable");
    await item.update({ "system.purse.held": update["system.purse.held"] });
    applied.push(update);
  }
  return { ok: true, updates: applied };
}

function stateMatchesPlan(snapshot, plan, mode = "post") {
  const expected = mode === "pre" ? plan?.pre : plan?.post;
  return !!expected && moneyEqual(snapshotMoney(snapshot), expected);
}

function preparedReceipt({ operation, actor, amount, context, txId, expectedRevision, snapshot, plan, writer }) {
  const fingerprint = commerceTransactionFingerprint(actor, operation, amount, context);
  return {
    txId,
    operation,
    actorUuid: actorIdentity(actor),
    amount,
    context: safeContextForFingerprint(context),
    expectedRevision,
    inputFingerprint: fingerprint,
    fingerprint,
    phase: "prepared",
    state: "prepared",
    preRevision: expectedRevision,
    planFingerprint: commerceInputFingerprint(plan),
    preMoney: cloneCommerceValue(plan.pre),
    postMoney: cloneCommerceValue(plan.post),
    snapshot: cloneCommerceValue(snapshot),
    plan: cloneCommerceValue(plan),
    writerUserId: userIdentity(writer),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    result: null
  };
}

function failureFromWrite(operation, txId, snapshot, plan, reason, extra = {}) {
  return failureResult("write-failed", reason, snapshot, plan, {
    state: extra.state ?? "unknown",
    reconciliationRequired: extra.reconciliationRequired ?? true,
    repairRequired: extra.repairRequired ?? (extra.state ?? "unknown") === "unknown",
    operation, txId,
    ...extra
  });
}

async function markReceipt(actor, receipt, phase, result, { revision = null } = {}) {
  const next = {
    ...cloneCommerceValue(receipt),
    phase,
    state: phase,
    result: result == null ? null : cloneCommerceValue(result),
    updatedAt: Date.now()
  };
  if (revision != null) next.resultingRevision = revision;
  try {
    await persistReceipt(actor, next, { revision });
    return { ok: true, receipt: next };
  } catch (error) {
    return { ok: false, error };
  }
}

async function confirmSnapshot(actor, context) {
  const live = await resolveLiveActor(actor, context);
  if (!live || !sameActor(live, actor)) return { actor: live, snapshot: null };
  try { return { actor: live, snapshot: commerceSnapshot(live) }; }
  catch { return { actor: live, snapshot: null }; }
}

function allowedTransitionValue(actual, pre, post) {
  return actual === pre || actual === post;
}

async function compensateToPre(actor, plan, context, preSnapshot) {
  let live = await resolveLiveActor(actor, context);
  if (!live) return { ok: false, state: "unknown", reason: "actor-not-found-for-compensation" };
  let snapshot;
  try { snapshot = commerceSnapshot(live); }
  catch { return { ok: false, state: "unknown", reason: "snapshot-failed-during-compensation" }; }
  const pre = plan?.pre;
  const post = plan?.post;
  const actual = snapshotMoney(snapshot);
  if (moneyEqual(actual, pre)) return { ok: true, state: "known", snapshot };

  if (actual.loose !== pre.loose && !allowedTransitionValue(actual.loose, pre.loose, post?.loose)) {
    return { ok: false, state: "unknown", reason: "unexpected-loose-state", snapshot };
  }
  for (const expected of pre.purses ?? []) {
    const found = (actual.purses ?? []).find(purse => purse.id === expected.id);
    const after = (post?.purses ?? []).find(purse => purse.id === expected.id);
    if (!found || !allowedTransitionValue(found.held, expected.held, after?.held)) {
      return { ok: false, state: "unknown", reason: "unexpected-purse-state", snapshot };
    }
  }

  const purseRestore = (pre.purses ?? []).map(expected => {
    const found = (actual.purses ?? []).find(purse => purse.id === expected.id);
    return found && found.held !== expected.held
      ? { _id: expected.id, "system.purse.held": expected.held } : null;
  }).filter(Boolean);
  try {
    await applyPurseUpdates(live, purseRestore);
    if (actual.loose !== pre.loose) {
      await writeCommerceState(live, commerceState(live), { "system.currency": pre.loose });
    }
  } catch (error) {
    try {
      const checked = await confirmSnapshot(live, context);
      if (!checked.snapshot || !moneyEqual(snapshotMoney(checked.snapshot), pre)) {
        return { ok: false, state: "unknown", reason: String(error?.message ?? error), snapshot: checked.snapshot };
      }
      return { ok: true, state: "known", snapshot: checked.snapshot };
    } catch {
      return { ok: false, state: "unknown", reason: String(error?.message ?? error) };
    }
  }
  const checked = await confirmSnapshot(live, context);
  if (!checked.snapshot || !stateMatchesPlan(checked.snapshot, plan, "pre")) {
    return { ok: false, state: "unknown", reason: "compensation-not-confirmed", snapshot: checked.snapshot };
  }
  return { ok: true, state: "known", snapshot: checked.snapshot };
}

async function writeFailureRecovery({ actor, context, receipt, operation, txId, snapshot, plan, reason }) {
  const compensation = await compensateToPre(actor, plan, context, snapshot);
  const state = compensation.state ?? "unknown";
  const failure = failureFromWrite(operation, txId, compensation.snapshot ?? snapshot, plan, reason, {
    state,
    reconciliationRequired: state === "unknown",
    compensation: {
      attempted: true,
      confirmed: compensation.ok === true,
      state,
      reason: compensation.reason ?? null
    }
  });
  const marked = await markReceipt(actor, receipt, "uncertain", failure);
  if (!marked.ok) {
    return {
      ...failure, state: "unknown", reconciliationRequired: true,
      repairRequired: true, receiptWrite: "uncertain"
    };
  }
  return { ...failure, receipt: cloneCommerceValue(marked.receipt) };
}

async function reconcileExistingCommitted(actor, receipt, operation, txId, context) {
  const checked = await confirmSnapshot(actor, context);
  const post = receiptPostMoney(receipt);
  if (checked.snapshot && post && moneyEqual(snapshotMoney(checked.snapshot), post)) {
    const result = committedReplay(receipt, operation, txId);
    return result;
  }
  // A durable committed receipt is the authority for idempotent replay.  Do
  // not debit again or invent a new result even if an external repair changed
  // the Actor after the original commit.
  return committedReplay(receipt, operation, txId);
}

async function resumePreparedOrUncertain({ actor, operation, amount, context, request, snapshot, receipt }) {
  const plan = receipt?.plan;
  if (!plan || !stateMatchesPlan(snapshot, plan, "pre")) {
    return failureFromWrite(operation, request.txId, snapshot, plan, "receipt-state-ambiguous", {
      state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
    });
  }
  // An uncertain receipt whose compensation could not be confirmed is a
  // repair boundary, not permission to replay a debit just because a later
  // read happens to resemble the pre-state.  A GM/Ref can explicitly call the
  // recovery path after inspecting the durable receipt.
  if (receipt?.result?.state === "unknown" || receipt?.result?.reconciliationRequired === true) {
    return failureFromWrite(operation, request.txId, snapshot, plan, "receipt-requires-reconciliation", {
      state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
    });
  }
  return executePlan({
    actor, operation, amount, context, request,
    snapshot, plan, receipt, prepared: true
  });
}

async function handleExistingReceipt({ actor, operation, amount, context, request, snapshot, receipt }) {
  if (!receiptMatchesRequest(receipt, commerceTransactionFingerprint(actor, operation, amount, context))) {
    return failureResult("duplicate-detected", "tx-id-reused-with-different-request", snapshot,
      receipt?.plan ?? null, { txId: request.txId, receipt: cloneCommerceValue(receipt) });
  }
  const phase = receiptPhase(receipt);
  if (phase === "committed" || phase === "complete") {
    return reconcileExistingCommitted(actor, receipt, operation, request.txId, context);
  }
  const post = receiptPostMoney(receipt);
  if (post && moneyEqual(snapshotMoney(snapshot), post)) {
    if (receipt?.result?.ok === false || receipt?.result?.state === "unknown"
        || receipt?.result?.reconciliationRequired === true) {
      return failureFromWrite(operation, request.txId, snapshot, receipt.plan, "receipt-requires-reconciliation", {
        state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
      });
    }
    const writer = writerAuthority(context);
    if (!writer.ok) {
      return failureFromWrite(operation, request.txId, snapshot, receipt.plan, writer.reason, {
        state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
      });
    }
    const result = receipt.result && typeof receipt.result === "object"
      ? cloneCommerceValue(receipt.result)
      : {
        ok: true, operation, txId: request.txId, amount,
        plan: cloneCommerceValue(receipt.plan), snapshot: cloneCommerceValue(receipt.snapshot),
        revision: readCommerceRevision(actor)
      };
    const marked = await markReceipt(actor, receipt, "committed", result, {
      revision: Math.max(readCommerceRevision(actor), request.expectedRevision + 1)
    });
    if (!marked.ok) {
      return failureFromWrite(operation, request.txId, snapshot, receipt.plan, "receipt-reconciliation-failed", {
        state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
      });
    }
    return { ...result, ok: true, reconciled: true, txId: request.txId, receipt: marked.receipt };
  }
  if (stateMatchesPlan(snapshot, receipt.plan, "pre")
      && readCommerceRevision(actor) === request.expectedRevision) {
    return resumePreparedOrUncertain({ actor, operation, amount, context, request, snapshot, receipt });
  }
  return failureFromWrite(operation, request.txId, snapshot, receipt.plan, "receipt-state-ambiguous", {
    state: "unknown", reconciliationRequired: true, receipt: cloneCommerceValue(receipt)
  });
}

async function executePlan({ actor, operation, amount, context, request, snapshot, plan, receipt, prepared = false }) {
  let live = await resolveLiveActor(actor, context);
  if (!live || !sameActor(live, actor)) {
    return failureFromWrite(operation, request.txId, snapshot, plan, "actor-resolution-failed");
  }

  const writer = liveWriterCheck(live, context, request.expectedRevision, plan.pre);
  if (!writer.ok) {
    if (writer.error === "conflict" || writer.error === "unauthorized") {
      return failureResult(writer.error, writer.reason, writer.snapshot ?? snapshot, plan, {
        txId: request.txId, retryable: writer.retryable
      });
    }
    return failureFromWrite(operation, request.txId, writer.snapshot ?? snapshot, plan, writer.reason);
  }

  let durableReceipt = receipt;
  if (!prepared) {
    durableReceipt = preparedReceipt({
      operation, actor: live, amount, context, txId: request.txId,
      expectedRevision: request.expectedRevision, snapshot, plan, writer: writer.designated
    });
    try {
      await persistReceipt(live, durableReceipt);
      const check = getCommerceReceipt(live, request.txId);
      if (!check || receiptPhase(check) !== "prepared") {
        return failureFromWrite(operation, request.txId, snapshot, plan, "prepared-receipt-not-confirmed", {
          state: "unknown", reconciliationRequired: true
        });
      }
      durableReceipt = check;
    } catch (error) {
      return failureFromWrite(operation, request.txId, snapshot, plan, "prepared-receipt-write-failed", {
        state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error)
      });
    }
  }

  const updates = purseUpdatesForPlan(plan);
  if (updates.length) {
    live = await resolveLiveActor(live, context);
    const beforePurseWrite = liveWriterCheck(live, context, request.expectedRevision, plan.pre);
    if (!beforePurseWrite.ok) {
      return writeFailureRecovery({
        actor: live, context, receipt: durableReceipt, operation,
        txId: request.txId, snapshot, plan, reason: beforePurseWrite.reason
      });
    }
    try {
      await applyPurseUpdates(live, updates);
    } catch (error) {
      return writeFailureRecovery({
        actor: live, context, receipt: durableReceipt, operation,
        txId: request.txId, snapshot, plan,
        reason: `purse-write-failed: ${String(error?.message ?? error)}`
      });
    }
    const afterPurse = await confirmSnapshot(live, context);
    const purseExpected = { loose: plan.pre.loose, purses: plan.post.purses };
    if (!afterPurse.snapshot || !moneyEqual(snapshotMoney(afterPurse.snapshot), purseExpected)) {
      return writeFailureRecovery({
        actor: afterPurse.actor ?? live, context, receipt: durableReceipt, operation,
        txId: request.txId, snapshot: afterPurse.snapshot ?? snapshot, plan,
        reason: "purse-post-state-not-confirmed"
      });
    }
  }

  live = await resolveLiveActor(live, context);
  const beforeActorWrite = liveWriterCheck(live, context, request.expectedRevision,
    { loose: plan.pre.loose, purses: plan.post.purses });
  if (!beforeActorWrite.ok) {
    return writeFailureRecovery({
      actor: live, context, receipt: durableReceipt, operation,
      txId: request.txId, snapshot: beforeActorWrite.snapshot ?? snapshot, plan,
      reason: beforeActorWrite.reason
    });
  }

  const nextRevision = request.expectedRevision + 1;
  const result = resultWithPlan({
    ok: true, operation, txId: request.txId, amount,
    revision: nextRevision, resultingRevision: nextRevision
  }, plan, snapshot);
  const committedReceipt = {
    ...cloneCommerceValue(durableReceipt),
    phase: "committed", state: "committed", resultingRevision: nextRevision,
    result: cloneCommerceValue(result), updatedAt: Date.now()
  };
  const nextCommerce = replaceReceipt({
    ...commerceState(live), revision: nextRevision
  }, committedReceipt);

  try {
    await writeCommerceState(live, nextCommerce, { "system.currency": plan.post.loose });
  } catch (error) {
    const checked = await confirmSnapshot(live, context);
    if (checked.snapshot && stateMatchesPlan(checked.snapshot, plan, "post")
        && readCommerceRevision(checked.actor) >= nextRevision) {
      // The write landed but its acknowledgement was lost.  Persisting the
      // same receipt is a bookkeeping retry, not a second debit.
      const marked = await markReceipt(checked.actor, committedReceipt, "committed", result, {
        revision: nextRevision
      });
      if (marked.ok) return { ...result, recovered: true, receipt: marked.receipt };
      return failureFromWrite(operation, request.txId, checked.snapshot, plan, "commit-acknowledgement-lost", {
        state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error)
      });
    }
    return writeFailureRecovery({
      actor: live, context, receipt: durableReceipt, operation,
      txId: request.txId, snapshot: checked.snapshot ?? snapshot, plan,
      reason: `actor-write-failed: ${String(error?.message ?? error)}`
    });
  }

  const afterActor = await confirmSnapshot(live, context);
  const committed = afterActor.snapshot && stateMatchesPlan(afterActor.snapshot, plan, "post")
    && readCommerceRevision(afterActor.actor) === nextRevision
    && !!getCommerceReceipt(afterActor.actor, request.txId)
    && receiptPhase(getCommerceReceipt(afterActor.actor, request.txId)) === "committed";
  if (!committed) {
    // The final Actor write may have been observed only partially.  Never claim
    // success; compensate any confirmed source mutation and journal uncertainty.
    return writeFailureRecovery({
      actor: afterActor.actor ?? live, context, receipt: durableReceipt, operation,
      txId: request.txId, snapshot: afterActor.snapshot ?? snapshot, plan,
      reason: "commit-post-state-not-confirmed"
    });
  }

  const activeAfter = getActiveCommerceGM();
  if (!activeAfter || !sameUser(activeAfter, beforeActorWrite.designated)) {
    // The commit is durable, but a GM handover overlapped the acknowledgement.
    // Store the committed receipt and require reconciliation; do not emit chat.
    return {
      ...result,
      ok: false,
      error: "write-failed",
      state: "unknown",
      reconciliationRequired: true,
      reason: "gm-transition-overlap",
      receipt: cloneCommerceValue(getCommerceReceipt(afterActor.actor, request.txId))
    };
  }

  await notifyCommerceCommitted(result, context);
  return {
    ...result,
    receipt: cloneCommerceValue(getCommerceReceipt(afterActor.actor, request.txId))
  };
}

async function notifyCommerceCommitted(result, context = {}) {
  const hook = context?.onCommitted ?? context?.chatHook ?? context?.announce ?? context?.chat;
  if (typeof hook === "function") {
    try { await hook(cloneCommerceValue(result)); }
    catch (error) { /* a notification failure cannot turn a confirmed debit into success */
      return { ok: false, error: String(error?.message ?? error) };
    }
  }
  if (context?.emit === true && typeof globalThis.Hooks?.callAll === "function") {
    try { globalThis.Hooks.callAll("crowsCommerceCommitted", cloneCommerceValue(result)); }
    catch { /* hook listeners are not part of the transaction */ }
  }
  return { ok: true };
}

async function executeMoneyOperation(actor, operation, amount, context, request) {
  let live;
  try { live = await resolveLiveActor(actor, context); }
  catch (error) {
    return inputFailure(actor, "invalid-source", "actor-resolution-failed", {
      message: String(error?.message ?? error)
    });
  }
  if (!live || !sameActor(live, actor)) {
    return inputFailure(actor, "invalid-source", "actor-resolution-failed");
  }
  const rawSourceError = validateRawMoneySources(live);
  if (rawSourceError) return inputFailure(live, "invalid-source", rawSourceError);

  let snapshot;
  try { snapshot = commerceSnapshot(live); }
  catch (error) {
    return inputFailure(live, "invalid-source", String(error?.message ?? error));
  }

  const existing = getCommerceReceipt(live, request.txId);
  if (existing) {
    return enqueueCommerceOperation(live, async () => {
      const now = await resolveLiveActor(live, context);
      const current = commerceSnapshot(now);
      return handleExistingReceipt({
        actor: now, operation, amount, context, request,
        snapshot: current, receipt: existing
      });
    });
  }

  if (snapshot.revision !== request.expectedRevision) {
    return failureResult("conflict", "stale-revision", snapshot, null, {
      txId: request.txId, stale: true, retryable: true,
      expectedRevision: request.expectedRevision, currentRevision: snapshot.revision
    });
  }
  const planned = operation === "pay"
    ? planPay(live, amount, snapshot)
    : planReceive(live, amount, snapshot);
  if (!planned.ok) {
    return resultWithPlan({
      ok: false, error: planned.error, reason: planned.reason,
      txId: request.txId, amount,
      ...(planned.shortfall != null ? { shortfall: planned.shortfall, deficit: planned.shortfall } : {}),
      ...(planned.excess != null ? { excess: planned.excess, overflow: planned.excess } : {}),
      ...(planned.reservation ? { reservation: planned.reservation } : {})
    }, planned.plan, snapshot);
  }

  return enqueueCommerceOperation(live, async () => {
    // A same-token request can enter the queue before the first delivery has
    // written its receipt.  Re-read the journal inside the queue so the second
    // delivery returns that receipt rather than losing on a stale preflight or
    // attempting a second debit.
    const queuedActor = await resolveLiveActor(live, context);
    const queuedSnapshot = commerceSnapshot(queuedActor);
    const queuedReceipt = getCommerceReceipt(queuedActor, request.txId);
    if (queuedReceipt) {
      return handleExistingReceipt({
        actor: queuedActor, operation, amount, context, request,
        snapshot: queuedSnapshot, receipt: queuedReceipt
      });
    }
    return executePlan({
      actor: queuedActor, operation, amount, context, request,
      snapshot, plan: planned.plan
    });
  });
}

async function mutateMoney(actor, operation, amount, context = {}) {
  const valid = validateRequest(actor, amount, context, operation);
  if (!valid.ok) return valid;

  const requester = requesterFor(context);
  if (!isCommerceAuthorized(actor, context, requester)) {
    return inputFailure(actor, "unauthorized", "requester-not-authorized", {
      operation, txId: valid.txId
    });
  }

  const authority = writerAuthority(context);
  if (!authority.ok) {
    if (authority.activeGMId && !isRoutedContext(context)) {
      const routed = await routeToDesignatedWriter(actor, operation, amount, context, {
        designated: getActiveCommerceGM()
      });
      if (routed) return routed;
    }
    return { ...authority, operation, txId: valid.txId };
  }

  return executeMoneyOperation(actor, operation, amount, context, valid);
}

/** Debit all selected sources or refuse without any source write. */
export async function pay(actor, amount, context = {}) {
  return mutateMoney(actor, "pay", amount, context);
}

/** Credit purses first, then loose coin with a computed reservation. */
export async function receive(actor, amount, context = {}) {
  return mutateMoney(actor, "receive", amount, context);
}

export const payMoney = pay;
export const receiveMoney = receive;

/**
 * A socket/GM adapter can call this with an already-authorized Actor document;
 * no actor id is accepted as a substitute for the document input.
 */
export async function handleCommerceRequest({ actor, operation, amount, context = {} } = {}) {
  if (operation === "pay") return pay(actor, amount, context);
  if (operation === "receive") return receive(actor, amount, context);
  return inputFailure(actor, "invalid-request", "unknown-operation");
}

export const runCommerceOperation = handleCommerceRequest;
