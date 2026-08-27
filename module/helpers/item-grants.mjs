/**
 * Authorized Item grants.
 *
 * This module owns the part of Commerce that is useful even when the writer
 * service is not loaded: resolving a catalogue Item, making an isolated
 * embedded copy, planning its placement, and committing a bounded batch.
 *
 * The mutation boundary is deliberately injectable.  A production caller can
 * pass `context.writer` (or `context.authority.execute`) and let the Commerce
 * service provide its active-GM queue and durable receipt implementation.  The
 * small local implementation below exists for the system's pure helper tests
 * and for old callers while that service is being composed; it still records a
 * receipt when the target exposes the normal Actor update API.
 *
 * No source document is ever edited.  In particular, a Compendium Item's pack,
 * folder, source id, and inventory location are metadata of the source, not a
 * destination for the new embedded Item.
 */

import {
  CARRY_CONTAINERS,
  CONTAINER_ORDER,
  emptyLayout,
  layoutFor as defaultLayoutFor,
  packItem,
  placeAt,
  slotsNeeded,
  itemId
} from "./slots.mjs";

export const ITEM_GRANT_OPERATION = "grantItem";

export const ITEM_GRANT_ERRORS = Object.freeze([
  "invalid-request",
  "invalid-source",
  "invalid-placement",
  "no-capacity",
  "unauthorized",
  "authority-unavailable",
  "conflict",
  "duplicate-detected",
  "write-failed"
]);

const LOCAL_STATES = new WeakMap();
let localSequence = 0;

/* -------------------------------------------------------------------------- */
/* Small platform-neutral helpers                                             */
/* -------------------------------------------------------------------------- */

/** Clone a value without allowing a source DataModel to leak into a grant. */
export function cloneGrantValue(value) {
  if (value === undefined) return undefined;
  try {
    const clone = globalThis.foundry?.utils?.deepClone;
    if (typeof clone === "function") return clone(value);
  } catch { /* fall through to the platform-neutral clone */ }
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableFingerprintValue(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableFingerprintValue);
  return Object.fromEntries(Object.keys(value).sort()
    .map((key) => [key, stableFingerprintValue(value[key])]));
}

export function grantInputFingerprint(value) {
  return JSON.stringify(stableFingerprintValue(value));
}

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection.contents)) return [...collection.contents];
  try {
    if (typeof collection[Symbol.iterator] === "function") {
      return [...collection].map((entry) => Array.isArray(entry) ? entry[1] : entry);
    }
  } catch { /* a document collection may expose a throwing iterator */ }
  return [];
}

function documentId(document) {
  return document?.id ?? document?._id ?? null;
}

function actorUuid(actor) {
  return actor?.uuid ?? (actor?.id != null ? `Actor.${actor.id}` : null);
}

function actorItems(actor) {
  return valuesOf(actor?.items);
}

function actorSystemCommerce(actor) {
  const value = actor?.system?.commerce;
  return value && typeof value === "object" ? value : {};
}

function localStateFor(actor) {
  let state = LOCAL_STATES.get(actor);
  if (!state) {
    const commerce = actorSystemCommerce(actor);
    state = {
      revision: Number.isInteger(Number(commerce.revision)) && Number(commerce.revision) >= 0
        ? Math.floor(Number(commerce.revision)) : 0,
      receipts: commerce.receipts && typeof commerce.receipts === "object"
        ? cloneGrantValue(commerce.receipts) : {}
    };
    LOCAL_STATES.set(actor, state);
  }
  return state;
}

/** Current Actor commerce revision, defaulting to the initial revision zero. */
export function readGrantRevision(actor) {
  const commerce = actorSystemCommerce(actor);
  const stored = Number(commerce.revision);
  if (Number.isInteger(stored) && stored >= 0) {
    const local = LOCAL_STATES.get(actor);
    if (local && local.revision < stored) local.revision = stored;
    return Math.floor(stored);
  }
  return localStateFor(actor).revision;
}

/** A caller-facing context with the mandatory mutation token fields filled in. */
export function makeGrantContext(actor, operation = "grant", options = {}) {
  const provided = options && typeof options === "object" ? options : {};
  const id = actorUuid(actor) ?? "actor";
  const txId = String(provided.txId ?? `${operation}:${id}:${Date.now()}:${++localSequence}`);
  return {
    ...provided,
    kind: provided.kind ?? "grant",
    txId,
    expectedRevision: provided.expectedRevision == null
      ? readGrantRevision(actor) : provided.expectedRevision
  };
}

/* -------------------------------------------------------------------------- */
/* Source resolution and cloning                                               */
/* -------------------------------------------------------------------------- */

function looksLikeItem(source) {
  if (!source || typeof source !== "object") return false;
  if (source.documentName === "Item") return true;
  return typeof source.type === "string" &&
    (Object.prototype.hasOwnProperty.call(source, "name") ||
      Object.prototype.hasOwnProperty.call(source, "system"));
}

async function resolveByUuid(uuid, context = {}) {
  const resolver = context.resolveSource ?? context.fromUuid ?? globalThis.fromUuid;
  if (typeof resolver === "function") {
    try {
      const resolved = await resolver(uuid);
      if (resolved) return resolved;
    } catch { /* report invalid-source below */ }
  }

  // A Compendium index entry is sometimes handed to a helper instead of its
  // UUID.  Resolve it through the owning pack without ever touching the pack
  // document itself after it has been returned.
  const packs = globalThis.game?.packs;
  if (packs) {
    const entries = valuesOf(packs);
    for (const pack of entries) {
      try {
        const index = valuesOf(pack?.index?.contents ?? pack?.index);
        const entry = index.find((candidate) => candidate?.uuid === uuid);
        if (entry && typeof pack.getDocument === "function") {
          const resolved = await pack.getDocument(entry._id);
          if (resolved) return resolved;
        }
      } catch { /* try the next pack */ }
    }
  }
  return null;
}

/**
 * Resolve a resolved Item, UUID, or Compendium index/document source.
 *
 * This function is exported for callers that need to show a source error, but
 * `grantItem` performs target authorization before calling it.
 */
export async function resolveGrantSource(source, context = {}) {
  if (typeof source === "string") return resolveByUuid(source, context);
  if (source?.document && looksLikeItem(source.document)) return source.document;

  if (source && typeof source === "object") {
    const uuid = source.uuid ?? source.document?.uuid;
    if (uuid) {
      const resolved = await resolveByUuid(uuid, context);
      if (resolved) return resolved;
    }
    // Foundry Compendium index entries carry a pack name and _id, while some
    // test stubs carry the actual pack object.  Both are safe to resolve.
    const pack = typeof source.pack === "object"
      ? source.pack : globalThis.game?.packs?.get?.(source.pack);
    if (pack && source._id != null && typeof pack.getDocument === "function") {
      try {
        const resolved = await pack.getDocument(source._id);
        if (resolved) return resolved;
      } catch { /* report invalid-source below */ }
    }
  }

  return looksLikeItem(source) ? source : null;
}

function stripSourceIdentity(data) {
  // Both Foundry source objects and plain fixture objects occur in this code.
  // `id` is derived on a live Document but can be present on a fixture, so it
  // is stripped along with the canonical `_id` and YAML-only `_key`.
  delete data.id;
  delete data._id;
  delete data._key;

  // These are all source/collection placement metadata, never gameplay state.
  delete data.pack;
  delete data.folder;
  delete data.sort;
  delete data.sourceId;
  delete data.compendiumSource;

  if (data._stats && typeof data._stats === "object") {
    const stats = { ...data._stats };
    delete stats.compendiumSource;
    delete stats.sourceId;
    delete stats.pack;
    data._stats = Object.keys(stats).length ? stats : undefined;
    if (!data._stats) delete data._stats;
  }

  // Core uses this flag as the identity that permits re-opening a compendium
  // source.  Keeping it would make the embedded copy look pack-owned.
  if (data.flags?.core && typeof data.flags.core === "object") {
    const core = { ...data.flags.core };
    delete core.sourceId;
    delete core.compendiumSource;
    delete core.pack;
    data.flags = { ...data.flags, core };
  }

  if (data.system && typeof data.system === "object") {
    data.system = { ...data.system };
    delete data.system.location;
    delete data.system.sourceId;
    delete data.system.compendiumSource;
  }
  // A few old plain-object fixtures used a root location mirror.
  delete data.location;
  return data;
}

/**
 * Clone an Item source and remove only source identity/placement metadata.
 * System state, quantity, stack fields, and every other gameplay field survive.
 */
export function cloneGrantItemData(source) {
  if (!looksLikeItem(source)) return null;
  let raw;
  try {
    raw = typeof source.toObject === "function" ? source.toObject() : source;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const data = cloneGrantValue(raw);
  if (!data || typeof data !== "object") return null;
  return stripSourceIdentity(data);
}

/* -------------------------------------------------------------------------- */
/* Target authority and layouts                                                */
/* -------------------------------------------------------------------------- */

function activeGameUser() {
  return globalThis.game?.user ?? null;
}

function activeCommerceGMDefault() {
  const users = globalThis.game?.users;
  if (users == null) return null;
  let candidates = [];
  try {
    if (users.activeGM) return users.activeGM;
  } catch { /* scan below */ }
  try {
    if (typeof users.filter === "function") candidates = [...users.filter((u) => u?.active && u?.isGM)];
    else if (Array.isArray(users)) candidates = users.filter((u) => u?.active && u?.isGM);
    else if (Array.isArray(users.contents)) candidates = users.contents.filter((u) => u?.active && u?.isGM);
    else if (typeof users[Symbol.iterator] === "function") {
      candidates = [...users].map((entry) => Array.isArray(entry) ? entry[1] : entry)
        .filter((u) => u?.active && u?.isGM);
    }
  } catch { candidates = []; }
  candidates.sort((a, b) => {
    const role = (Number(b?.role) || 0) - (Number(a?.role) || 0);
    if (role) return role;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
  });
  return candidates[0] ?? null;
}

function resultFromHook(result, fallbackError = "unauthorized") {
  if (result === true || result == null) return null;
  if (result === false) return fail(fallbackError, { reason: fallbackError });
  if (typeof result === "object" && result.ok === false) return result;
  if (typeof result === "object" && result.ok === true) return null;
  return result ? null : fail(fallbackError, { reason: fallbackError });
}

function ownershipLevel(actor, user) {
  if (!actor || !user) return 0;
  if (typeof actor.testUserPermission === "function") {
    try {
      if (actor.testUserPermission(user, "OWNER")) return 3;
    } catch { /* inspect ownership below */ }
  }
  const ownership = actor.ownership;
  const value = ownership?.[user.id] ?? ownership?.default ?? 0;
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "OWNER") return 3;
    if (upper === "LIMITED") return 2;
    if (upper === "OBSERVER") return 1;
  }
  return Number(value) || 0;
}

/** Actor ownership check used by the default local adapter. */
export function isGrantAuthorized(actor, context = {}, user = activeGameUser()) {
  const hook = context.authorizeTarget ?? context.authorize ?? context.isAuthorized
    ?? context.authority?.authorizeTarget ?? context.authority?.authorize
    ?? context.authority?.isAuthorized;
  if (typeof hook === "function") return hook(actor, context, user);
  if (!actor) return false;
  if (user?.isGM === true) return true;
  if (actor.isOwner === true) return true;
  if (actor.isOwner === false) return false;
  if (ownershipLevel(actor, user) >= 3) return true;
  // No Foundry world exists in the unit harness.  A fixture without an
  // ownership field is intentionally usable there; once `game` or ownership
  // data exists, an absent owner is not silently treated as authorized.
  if (!globalThis.game && !actor.ownership && user == null) return true;
  return false;
}

async function authorizeGrantTarget(actor, context) {
  const result = await isGrantAuthorized(actor, context);
  const refusal = resultFromHook(result);
  if (refusal) return refusal;
  return null;
}

function authorityStatus(context = {}) {
  const adapter = context.authority ?? context.commerce ?? null;
  const active = context.activeGM ?? context.getActiveGM ?? adapter?.activeGM
    ?? adapter?.getActiveGM;
  const designated = context.isDesignatedWriter ?? context.isActiveGM
    ?? adapter?.isDesignatedWriter ?? adapter?.isActiveGM;

  if (typeof active === "function") {
    const selected = active();
    if (!selected) return fail("authority-unavailable", { reason: "no-active-gm" });
    if (typeof designated === "function" && !designated(activeGameUser(), selected)) {
      return fail("authority-unavailable", {
        reason: "request-must-run-on-designated-gm", activeGMId: selected.id ?? null
      });
    }
    return null;
  }

  // A real Foundry world has a Users collection.  Local writes on a player
  // client would bypass the designated writer, so refuse until a writer hook is
  // supplied.  The no-game path is the intentionally tiny unit-test adapter.
  if (globalThis.game?.users != null) {
    const selected = activeCommerceGMDefault();
    if (!selected) return fail("authority-unavailable", { reason: "no-active-gm" });
    const user = activeGameUser();
    if (!user || String(user.id) !== String(selected.id)) {
      return fail("authority-unavailable", {
        reason: "request-must-run-on-designated-gm", activeGMId: selected.id ?? null
      });
    }
  }
  return null;
}

function customLayoutFromCapacities(actor, capacities) {
  if (!capacities || typeof capacities !== "object") return null;
  const layout = emptyLayout(actor?.id ?? actor?._id ?? "", capacities);
  // `emptyLayout` knows the carried/magic containers.  A Party or another
  // Actor type may expose a stash name of its own, so append those containers
  // without changing the crow layout contract.
  for (const [container, value] of Object.entries(capacities)) {
    if (container in layout.capacities) continue;
    const cap = Number(value);
    if (!Number.isFinite(cap) || cap < 0) continue;
    layout.capacities[container] = Math.floor(cap);
    for (let index = 0; index < Math.floor(cap); index++) {
      layout.slots.push({ container, index, items: [], wound: false, spanId: null });
    }
  }
  return layout;
}

function targetLayout(actor, context = {}) {
  const supplied = context.layout ?? context.inventoryLayout;
  if (supplied && typeof supplied === "object") return cloneGrantValue(supplied);

  const layoutFor = context.layoutFor ?? context.inventory?.layoutFor
    ?? actor?.layoutFor ?? actor?.inventoryLayout;
  if (typeof layoutFor === "function") {
    try {
      const layout = layoutFor(actor, context);
      if (layout) return cloneGrantValue(layout);
    } catch { /* use the built-in adapter */ }
  }

  const capacities = context.capacities
    ?? actor?.system?.inventory?.capacities
    ?? actor?.system?.capacities;
  const custom = customLayoutFromCapacities(actor, capacities);
  if (custom) return custom;

  const stashCapacity = context.stashCapacity ?? actor?.system?.inventory?.capacity;
  if (Number.isFinite(Number(stashCapacity))) {
    const container = context.stashContainer ?? actor?.system?.inventory?.container ?? "backpack";
    return customLayoutFromCapacities(actor, { [container]: Number(stashCapacity) });
  }
  return defaultLayoutFor(actor);
}

/* -------------------------------------------------------------------------- */
/* Placement planning                                                          */
/* -------------------------------------------------------------------------- */

function placementOf(entry, context) {
  const direct = entry.placement ?? entry.destination ?? entry.location;
  if (direct != null) return direct;
  const global = context.placement ?? context.destination ?? context.location;
  if (global != null) return global;
  if (context.container != null || context.index != null) {
    return { container: context.container, index: context.index, length: context.length };
  }
  if (context.placementPolicy != null || context.policy != null) {
    return { policy: context.placementPolicy ?? context.policy };
  }
  return null;
}

function policyOf(placement) {
  if (typeof placement === "string") return placement;
  return placement?.policy ?? placement?.mode ?? null;
}

function allowsStacking(context, placement) {
  return context.allowStacking === true || context.mergeStacks === true || context.merge === true
    || placement?.allowStacking === true || placement?.mergeStacks === true || placement?.merge === true;
}

function explicitRefs(placement, item) {
  const need = Math.max(0, slotsNeeded(item));
  const span = placement?.span ?? placement?.refs ?? placement?.slots;
  if (span != null) {
    if (Array.isArray(span)) {
      if (span.length !== need) return { ok: false, reason: "wrong-span" };
      return { ok: true, refs: span.map((ref) => ({ container: ref.container, index: ref.index })) };
    }
    // Callers commonly use `span`/`slots` as the numeric length alongside a
    // starting container/index.  Treat that as the same contiguous placement
    // contract rather than requiring them to spell the refs array.
    if (Number(span) !== need) return { ok: false, reason: "wrong-span" };
  }
  const container = placement?.container;
  const index = Number(placement?.index);
  if (!container || !Number.isInteger(index)) return { ok: false, reason: "bad-placement" };
  if (placement.length != null && Number(placement.length) !== need) {
    return { ok: false, reason: "wrong-span" };
  }
  return {
    ok: true,
    refs: Array.from({ length: need }, (_, offset) => ({ container, index: index + offset }))
  };
}

function refsLocation(refs, item) {
  if (!refs?.length) return null;
  const container = refs[0].container;
  const indices = refs.map((ref) => Number(ref.index)).sort((a, b) => a - b);
  return { container, index: indices[0], length: Math.max(1, slotsNeeded(item)) };
}

function targetOccupied(layout, refs) {
  return refs.some((ref) => layout?.slots?.find((slot) =>
    slot.container === ref.container && slot.index === Number(ref.index))?.items?.length > 0);
}

function tryExplicitPlacement(layout, candidate, placement, merge) {
  const refs = explicitRefs(placement, candidate);
  if (!refs.ok) return refs;
  if (!merge && targetOccupied(layout, refs.refs)) {
    return { ok: false, reason: "stacking-not-opted-in" };
  }
  const result = refs.refs.length
    ? placeAt(layout, candidate, refs.refs)
    : placeAt(layout, candidate, [], { enforce: true });
  if (!result.ok) return result;
  return { ...result, location: refsLocation(refs.refs, candidate) };
}

function autoPackContainers(placement, context, layout) {
  const requested = placement?.containers ?? context.autoPackContainers ?? context.containers;
  if (Array.isArray(requested) && requested.length) return requested.map(String);
  // A stash can expose one custom container; otherwise auto-pack carried Items
  // in the same stable hand/belt/backpack order used by the sheet.
  if (placement?.container) return [String(placement.container)];
  const custom = Object.keys(layout?.capacities ?? {})
    .filter((key) => !CONTAINER_ORDER.includes(key));
  return custom.length ? custom : [...CARRY_CONTAINERS];
}

function tryAutoPlacement(layout, candidate, placement, context, merge) {
  if (slotsNeeded(candidate) === 0) {
    const result = placeAt(layout, candidate, [], { enforce: true });
    return result.ok ? { ...result, location: null } : result;
  }

  const attempts = [];
  for (const container of autoPackContainers(placement, context, layout)) {
    const cap = Number(layout?.capacities?.[container] ?? 0);
    for (let index = 0; index < Math.max(0, Math.floor(cap)); index++) {
      const refs = Array.from({ length: slotsNeeded(candidate) }, (_, offset) => ({
        container, index: index + offset
      }));
      if (!merge && targetOccupied(layout, refs)) {
        attempts.push({ container, index, reason: "stacking-not-opted-in" });
        continue;
      }
      const result = packItem(layout, candidate, container, index);
      if (result.ok) {
        return {
          ...result,
          location: { container, index, length: slotsNeeded(candidate) }
        };
      }
      attempts.push({ container, index, reason: result.reason });
    }
  }
  return { ok: false, reason: "no-capacity", attempts };
}

function normalizedEntry(entry, context) {
  if (entry && typeof entry === "object" &&
      (Object.prototype.hasOwnProperty.call(entry, "source") ||
        Object.prototype.hasOwnProperty.call(entry, "item") ||
        Object.prototype.hasOwnProperty.call(entry, "document") ||
        Object.prototype.hasOwnProperty.call(entry, "uuid"))) {
    return {
      source: entry.source ?? entry.item ?? entry.document ?? entry.uuid,
      quantity: entry.quantity,
      placement: entry.placement ?? entry.destination ?? entry.location,
      overrides: entry.overrides ?? entry.dataOverrides ?? null
    };
  }
  return {
    source: entry, quantity: undefined, placement: undefined,
    overrides: context.overrides ?? null, ...context
  };
}

function quantityOverride(value) {
  if (value == null) return { ok: true, value: null };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return { ok: false, reason: "quantity-invalid" };
  return { ok: true, value: number };
}

function markerFor(txId, index) {
  return {
    txId: String(txId), operation: ITEM_GRANT_OPERATION, index: Number(index)
  };
}

function addClaimMarker(data, txId, index) {
  if (!txId) return data;
  const flags = data.flags && typeof data.flags === "object" ? data.flags : {};
  const crows = flags.crows && typeof flags.crows === "object" ? flags.crows : {};
  data.flags = { ...flags, crows: { ...crows, grant: markerFor(txId, index) } };
  return data;
}

function itemPlanData(data, placementResult, candidate) {
  if (placementResult.location) {
    data.system = { ...(data.system ?? {}), location: placementResult.location };
  }
  return {
    data,
    placement: placementResult.location,
    id: itemId(candidate),
    slots: slotsNeeded(candidate)
  };
}

function layoutNeeded(entries, context) {
  return entries.some((entry) => {
    const placement = placementOf(entry, context);
    return policyOf(placement) !== "none" && policyOf(placement) !== "unplaced";
  });
}

/**
 * Resolve and preflight one or more source Items without any Actor write.
 *
 * The returned `layout` is a private cloned layout.  Callers can inspect the
 * placements, but mutating it cannot affect the Actor or the next plan.
 */
export async function planGrantBatch(actor, entries, context = {}) {
  if (!actor) return fail("invalid-request", { reason: "actor-required" });
  const list = Array.isArray(entries) ? entries : [entries];
  if (!list.length) return fail("invalid-request", { reason: "source-required" });

  const normalized = list.map((entry) => normalizedEntry(entry, context));
  const resolved = [];
  for (let index = 0; index < normalized.length; index++) {
    const entry = normalized[index];
    const source = await resolveGrantSource(entry.source, context);
    const data = cloneGrantItemData(source);
    if (!source || !data || !data.type) {
      return fail("invalid-source", { index, source: entry.source ?? null });
    }
    const quantity = quantityOverride(entry.quantity ?? context.quantity);
    if (!quantity.ok) return fail("invalid-request", { index, reason: quantity.reason });
    if (quantity.value != null) {
      data.system = { ...(data.system ?? {}), quantity: quantity.value };
    }
    if (entry.overrides && typeof entry.overrides === "object") {
      // Overrides are caller policy applied to the NEW copy only (for example,
      // a background qualifier in the display name).  They never run against
      // the resolved source document.
      for (const [key, value] of Object.entries(entry.overrides)) {
        if (!key || key === "_id" || key === "_key" || key === "id") continue;
        data[key] = cloneGrantValue(value);
      }
    }
    addClaimMarker(data, context.txId, index);
    resolved.push({ entry, source, data, index });
  }

  const needsLayout = layoutNeeded(normalized, context);
  let trial = null;
  if (needsLayout) {
    try {
      trial = targetLayout(actor, context);
    } catch (error) {
      return fail("no-capacity", { reason: "layout-unavailable", message: String(error?.message ?? error) });
    }
    if (!trial || !Array.isArray(trial.slots) || !trial.capacities) {
      return fail("no-capacity", { reason: "layout-unavailable" });
    }
  }

  const planned = [];
  for (const resolvedItem of resolved) {
    const { entry, source, data, index } = resolvedItem;
    const placement = placementOf(entry, context);
    const policy = policyOf(placement);
    const candidateId = `grant-preview-${String(context.txId ?? "preview")}-${index}`;
    const candidate = {
      ...cloneGrantValue(data), id: candidateId, _id: candidateId
    };
    let placementResult;

    if (policy === "none" || policy === "unplaced") {
      placementResult = { ok: true, location: null, indices: [] };
    } else if (!placement) {
      return fail("invalid-request", { index, reason: "placement-required" });
    } else if (policy === "auto-pack") {
      placementResult = tryAutoPlacement(trial, candidate, placement, context,
        allowsStacking(context, placement));
    } else {
      placementResult = tryExplicitPlacement(trial, candidate, placement,
        allowsStacking(context, placement));
    }

    if (!placementResult.ok) {
      const invalidPlacement = new Set([
        "bad-placement", "bad-index", "unknown-container", "cross-container",
        "non-contiguous", "wrong-span", "out-of-bounds", "no-slots"
      ]).has(placementResult.reason);
      return fail(invalidPlacement ? "invalid-placement" : "no-capacity", {
        index,
        reason: placementResult.reason,
        attempts: placementResult.attempts,
        placements: planned.map((item) => item.placement)
      });
    }
    planned.push({
      ...itemPlanData(data, placementResult, candidate),
      index,
      source,
      sourceUuid: source?.uuid ?? null
    });
  }

  const fingerprint = grantInputFingerprint({
    operation: ITEM_GRANT_OPERATION,
    actorUuid: actorUuid(actor),
    entries: planned.map(({ data, placement, sourceUuid, index }) => ({
      data, placement, sourceUuid, index
    }))
  });
  return {
    ok: true,
    operation: ITEM_GRANT_OPERATION,
    actorUuid: actorUuid(actor),
    items: planned,
    placements: planned.map((item) => item.placement),
    layout: trial,
    fingerprint
  };
}

export const planGrantItems = planGrantBatch;

export async function planGrantItem(actor, source, context = {}) {
  return planGrantBatch(actor, [{ source }], context);
}

/* -------------------------------------------------------------------------- */
/* Receipts and local bounded commit                                           */
/* -------------------------------------------------------------------------- */

function receiptStore(context) {
  return context.receipts ?? context.receiptStore ?? context.authority?.receipts
    ?? context.commerce?.receipts ?? null;
}

async function readReceipt(actor, txId, context) {
  const store = receiptStore(context);
  if (store) {
    try {
      if (typeof store.get === "function") {
        const value = await store.get(actor, txId);
        if (value) return cloneGrantValue(value);
      }
      if (typeof store.read === "function") {
        const value = await store.read(actor, txId);
        if (value) return cloneGrantValue(value);
      }
    } catch { /* fall through to Actor/local state */ }
  }
  const local = localStateFor(actor);
  const stored = actorSystemCommerce(actor).receipts?.[txId] ?? local.receipts?.[txId];
  return stored ? cloneGrantValue(stored) : null;
}

async function writeReceipt(actor, txId, receipt, context) {
  const store = receiptStore(context);
  if (store) {
    let result;
    if (typeof store.record === "function") result = await store.record(actor, txId, cloneGrantValue(receipt));
    else if (typeof store.set === "function") result = await store.set(actor, txId, cloneGrantValue(receipt));
    else if (typeof store.write === "function") result = await store.write(actor, txId, cloneGrantValue(receipt));
    if (result && typeof result === "object" && result.ok === false) throw new Error(result.error ?? "receipt write failed");
    return result;
  }

  const prior = localStateFor(actor);
  const next = {
    revision: prior.revision,
    receipts: { ...(prior.receipts ?? {}), [txId]: cloneGrantValue(receipt) }
  };
  if (context.persistReceipts !== false && typeof actor?.update === "function") {
    await actor.update({ "system.commerce": cloneGrantValue(next) });
  }
  // Some light test doubles record updates without changing their system.  The
  // direct assignment is only a fallback and never mutates source data.
  if (actor?.system && typeof actor.system === "object") actor.system.commerce = cloneGrantValue(next);
  LOCAL_STATES.set(actor, next);
  return receipt;
}

async function writeRevision(actor, revision, context) {
  const store = receiptStore(context);
  if (store?.setRevision) {
    const result = await store.setRevision(actor, revision);
    if (result && typeof result === "object" && result.ok === false) throw new Error(result.error ?? "revision write failed");
    return;
  }
  const prior = localStateFor(actor);
  const next = {
    revision,
    receipts: { ...(prior.receipts ?? {}) }
  };
  if (context.persistReceipts !== false && typeof actor?.update === "function") {
    await actor.update({ "system.commerce": cloneGrantValue(next) });
  }
  if (actor?.system && typeof actor.system === "object") actor.system.commerce = cloneGrantValue(next);
  LOCAL_STATES.set(actor, next);
}

function claimMarkerOf(item) {
  return item?.flags?.crows?.grant ?? item?.system?.commerceGrant ?? null;
}

function claimedItems(actor, txId) {
  return actorItems(actor).filter((item) => String(claimMarkerOf(item)?.txId ?? "") === String(txId));
}

function itemIds(items) {
  return items.map((item) => documentId(item)).filter((id) => id != null).map(String);
}

function leanResult(result) {
  const copy = { ...result };
  delete copy.items;
  delete copy.created;
  return cloneGrantValue(copy);
}

function receiptResult(receipt, actor, context, replayed = true) {
  const base = cloneGrantValue(receipt?.result ?? {});
  const items = claimedItems(actor, receipt?.txId ?? context.txId);
  return {
    ...base,
    ok: base.ok !== false,
    operation: ITEM_GRANT_OPERATION,
    txId: receipt?.txId ?? context.txId,
    itemIds: itemIds(items).length ? itemIds(items) : (base.itemIds ?? []),
    items,
    created: items,
    replayed,
    receipt: cloneGrantValue(receipt)
  };
}

async function reconcileClaimedReceipt(actor, existing, context, claimed) {
  const expected = Number(context.expectedRevision);
  const revision = Math.max(readGrantRevision(actor), expected + 1);
  const result = {
    ok: true,
    operation: ITEM_GRANT_OPERATION,
    txId: context.txId,
    itemIds: itemIds(claimed),
    snapshot: { actorUuid: actorUuid(actor) },
    revision,
    ...(existing?.result?.plan ? { plan: cloneGrantValue(existing.result.plan) } : {})
  };
  const committed = {
    ...existing,
    txId: context.txId,
    phase: "committed",
    createdItemIds: itemIds(claimed),
    result: leanResult(result),
    updatedAt: Date.now()
  };
  try {
    await writeReceipt(actor, context.txId, committed, context);
    await writeRevision(actor, revision, context);
  } catch (error) {
    return fail("write-failed", {
      state: "unknown", reconciliationRequired: true,
      txId: context.txId, itemIds: itemIds(claimed),
      message: String(error?.message ?? error)
    });
  }
  return {
    ...result,
    items: claimed,
    created: claimed,
    receipt: committed,
    replayed: true,
    reconciled: true
  };
}

async function resolveLiveActor(actor, context) {
  const resolver = context.resolveActor ?? context.resolveTargetActor;
  if (typeof resolver !== "function") return actor;
  try {
    const resolved = await resolver(actor, context);
    return resolved ?? actor;
  } catch {
    return actor;
  }
}

function contextRequestError(context) {
  const txId = String(context?.txId ?? "").trim();
  if (!txId) return fail("invalid-request", { reason: "tx-id-required" });
  const expected = Number(context?.expectedRevision);
  if (!Number.isInteger(expected) || expected < 0) {
    return fail("invalid-request", { reason: "expected-revision-required" });
  }
  return null;
}

function revisionConflict(actor, expected) {
  const current = readGrantRevision(actor);
  if (current === expected) return null;
  return fail("conflict", {
    reason: "stale-revision", retryable: true,
    expectedRevision: expected, currentRevision: current
  });
}

async function commitGrantPlan(actor, plan, context) {
  const expected = Number(context.expectedRevision);
  let live = await resolveLiveActor(actor, context);
  const existing = await readReceipt(live, context.txId, context);
  if (existing) {
    if (existing.planFingerprint && existing.planFingerprint !== plan.fingerprint) {
      return fail("duplicate-detected", {
        reason: "tx-id-reused", txId: context.txId, receipt: existing
      });
    }
    if (existing.phase === "committed") return receiptResult(existing, live, context);
    if (existing.phase === "uncertain") {
      const recovered = claimedItems(live, context.txId);
      if (recovered.length && recovered.length >= Number(existing.createdItemIds?.length ?? 1)) {
        return reconcileClaimedReceipt(live, existing, context, recovered);
      }
      return fail("write-failed", {
        state: "unknown", reconciliationRequired: true,
        txId: context.txId, receipt: existing
      });
    }
    const alreadyClaimed = claimedItems(live, context.txId);
    if (alreadyClaimed.length >= plan.items.length) {
      return reconcileClaimedReceipt(live, {
        ...existing,
        result: { ...(existing.result ?? {}), plan: publicPlan(plan) },
        writerUserId: context.writerUserId ?? activeGameUser()?.id ?? null
      }, context, alreadyClaimed);
    }
  }

  // A committed receipt is authoritative for a retry even though the
  // successful first call advanced the Actor revision.  Only a new token (or a
  // prepared token whose state is still current) is compared with the caller's
  // expected revision.
  const initialConflict = revisionConflict(live, expected);
  if (initialConflict) return initialConflict;

  const authority = authorityStatus(context);
  if (authority) return authority;
  live = await resolveLiveActor(live, context);
  const beforeWriteConflict = revisionConflict(live, expected);
  if (beforeWriteConflict) return beforeWriteConflict;

  const prepared = {
    txId: String(context.txId), operation: ITEM_GRANT_OPERATION, phase: "prepared",
    actorUuid: actorUuid(live), expectedRevision: expected,
    planFingerprint: plan.fingerprint, createdItemIds: [],
    writerUserId: context.writerUserId ?? activeGameUser()?.id ?? null,
    createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now()
  };
  try {
    await writeReceipt(live, context.txId, prepared, context);
  } catch (error) {
    return fail("write-failed", {
      state: "unknown", reconciliationRequired: true,
      txId: context.txId, reason: "receipt-write-failed",
      message: String(error?.message ?? error)
    });
  }

  const beforeCreateAuthority = authorityStatus(context);
  if (beforeCreateAuthority) return beforeCreateAuthority;
  live = await resolveLiveActor(live, context);
  const beforeCreateConflict = revisionConflict(live, expected);
  if (beforeCreateConflict) return beforeCreateConflict;

  let created;
  try {
    if (typeof live?.createEmbeddedDocuments !== "function") {
      throw new Error("target Actor cannot create embedded Items");
    }
    const data = plan.items.map((item) => cloneGrantValue(item.data));
    created = await live.createEmbeddedDocuments("Item", data);
    created = Array.isArray(created) ? created : valuesOf(created);
  } catch (error) {
    const uncertain = {
      ...prepared, phase: "uncertain", updatedAt: Date.now(),
      result: { ok: false, error: "write-failed", state: "unknown" },
      message: String(error?.message ?? error)
    };
    try { await writeReceipt(live, context.txId, uncertain, context); } catch { /* already uncertain */ }
    return fail("write-failed", {
      state: "unknown", reconciliationRequired: true,
      txId: context.txId, reason: "embedded-create-failed",
      message: String(error?.message ?? error), receipt: uncertain
    });
  }

  const afterCreateAuthority = authorityStatus(context);
  if (afterCreateAuthority) {
    const uncertain = {
      ...prepared, phase: "uncertain", updatedAt: Date.now(),
      createdItemIds: itemIds(created), result: { ok: false, error: "write-failed", state: "unknown" }
    };
    try { await writeReceipt(live, context.txId, uncertain, context); } catch { /* require GM reconciliation */ }
    return { ...afterCreateAuthority, txId: context.txId, state: "unknown", reconciliationRequired: true };
  }

  live = await resolveLiveActor(live, context);
  const observed = claimedItems(live, context.txId);
  const delivered = observed.length ? observed : created;
  const result = {
    ok: true,
    operation: ITEM_GRANT_OPERATION,
    txId: context.txId,
    itemIds: itemIds(delivered),
    plan: publicPlan(plan),
    snapshot: { actorUuid: actorUuid(live) },
    revision: expected + 1
  };
  const committed = {
    ...prepared, phase: "committed", updatedAt: Date.now(),
    createdItemIds: itemIds(delivered), result: leanResult(result)
  };
  try {
    await writeReceipt(live, context.txId, committed, context);
    await writeRevision(live, expected + 1, context);
  } catch (error) {
    const uncertain = {
      ...committed, phase: "uncertain", updatedAt: Date.now(),
      result: { ...leanResult(result), ok: false, error: "write-failed", state: "unknown" },
      message: String(error?.message ?? error)
    };
    try { await writeReceipt(live, context.txId, uncertain, context); } catch { /* durable state is unknown */ }
    return fail("write-failed", {
      state: "unknown", reconciliationRequired: true,
      txId: context.txId, itemIds: itemIds(delivered), receipt: uncertain,
      message: String(error?.message ?? error)
    });
  }
  return {
    ...result,
    items: delivered,
    created: delivered,
    receipt: committed
  };
}

function publicPlan(plan) {
  return {
    operation: plan.operation,
    actorUuid: plan.actorUuid,
    items: plan.items.map(({ data, placement, index, sourceUuid, slots }) => ({
      data: cloneGrantValue(data), placement: cloneGrantValue(placement),
      index, sourceUuid, slots
    })),
    placements: cloneGrantValue(plan.placements),
    fingerprint: plan.fingerprint
  };
}

function writerHook(context) {
  const adapter = context.authority ?? context.commerce ?? null;
  return context.writer ?? context.execute ?? context.commit
    ?? adapter?.execute ?? adapter?.enqueue ?? adapter?.enqueueOperation;
}

async function invokeWriter(writer, actor, plan, context) {
  const request = {
    actor,
    operation: ITEM_GRANT_OPERATION,
    txId: context.txId,
    expectedRevision: context.expectedRevision,
    plan: publicPlan(plan),
    grantPlan: plan,
    commit: (target = actor) => commitGrantPlan(target, plan, context)
  };
  // `enqueueOperation` adapters generally use (actor, task), while an
  // execute/writer hook receives the richer request.  A function's explicit
  // arity lets both stay simple and avoids a second queue implementation here.
  if (writer === context.authority?.enqueueOperation || writer === context.commerce?.enqueueOperation) {
    return writer(actor, request);
  }
  return writer(request);
}

/**
 * Grant one source Item.  Pass an explicit `placement` (`container/index` or
 * `policy: "auto-pack"`) and mandatory `txId`/`expectedRevision`; callers that
 * need several physical Items should use `grantItemBatch`.
 */
export async function grantItem(actor, source, context = {}) {
  if (Array.isArray(source)) return grantItemBatch(actor, source, context);
  return grantItemBatch(actor, [{ source }], context);
}

/**
 * Resolve, preflight, and commit a bounded all-or-nothing grant batch.
 * Capacity/source failures return before a receipt or embedded write.
 */
export async function grantItemBatch(actor, entries, context = {}) {
  const auth = await authorizeGrantTarget(actor, context);
  if (auth) return auth;
  const requestError = contextRequestError(context);
  if (requestError) return requestError;

  // A committed token is an idempotency receipt, not a fresh placement request.
  // Re-planning first would see the Item created by the original call occupying
  // its destination and could incorrectly turn a successful retry into
  // `no-capacity`.  The durable receipt is authoritative for the same token;
  // callers that need to prove a token's input identity can pass
  // `requestFingerprint`, which is checked before this fast path.
  const existing = await readReceipt(actor, context.txId, context);
  if (existing?.phase === "committed") {
    if (context.requestFingerprint && existing.planFingerprint
        && context.requestFingerprint !== existing.planFingerprint) {
      return fail("duplicate-detected", {
        reason: "tx-id-reused", txId: context.txId, receipt: existing
      });
    }
    return receiptResult(existing, actor, context);
  }
  // New mutations (and reconciliation of an unfinished mutation) must not
  // resolve sources or build a plan on a client that has no designated GM.
  // A committed receipt is the only replay that is safe without another
  // authority check because it performs no write.
  const initialAuthority = authorityStatus(context);
  if (initialAuthority) return initialAuthority;
  if (existing?.phase === "uncertain") {
    const recovered = claimedItems(actor, context.txId);
    if (recovered.length && recovered.length >= Number(existing.createdItemIds?.length ?? 1)) {
      const revision = readGrantRevision(actor);
      const result = {
        ok: true,
        operation: ITEM_GRANT_OPERATION,
        txId: context.txId,
        itemIds: itemIds(recovered),
        snapshot: { actorUuid: actorUuid(actor) },
        revision: revision > Number(context.expectedRevision) ? revision : Number(context.expectedRevision) + 1
      };
      const committed = {
        ...existing,
        phase: "committed",
        createdItemIds: itemIds(recovered),
        result: leanResult(result),
        updatedAt: Date.now()
      };
      try {
        await writeReceipt(actor, context.txId, committed, context);
        await writeRevision(actor, result.revision, context);
        return {
          ...result, items: recovered, created: recovered,
          receipt: committed, replayed: true, reconciled: true
        };
      } catch (error) {
        return fail("write-failed", {
          state: "unknown", reconciliationRequired: true,
          txId: context.txId, itemIds: itemIds(recovered),
          message: String(error?.message ?? error)
        });
      }
    }
    return fail("write-failed", {
      state: "unknown", reconciliationRequired: true,
      txId: context.txId, receipt: existing
    });
  }
  if (existing?.phase === "prepared") {
    // A writer can create the claim and the embedded Item, then lose its
    // acknowledgement before it records `committed`. Replanning that token
    // would see the claimed destination occupied and either report a false
    // capacity refusal or create a duplicate elsewhere. Reconcile a complete
    // marker set; a partial set is ambiguous and must remain visible to the GM.
    const recovered = claimedItems(actor, context.txId);
    const expectedCount = Array.isArray(entries) ? entries.length : 1;
    if (recovered.length >= expectedCount) {
      return reconcileClaimedReceipt(actor, existing, context, recovered);
    }
    if (recovered.length) {
      return fail("write-failed", {
        state: "unknown", reconciliationRequired: true,
        txId: context.txId, receipt: existing,
        itemIds: itemIds(recovered)
      });
    }
  }

  const plan = await planGrantBatch(actor, entries, context);
  if (!plan.ok) return plan;

  const writer = writerHook(context);
  if (writer) {
    try {
      const result = await invokeWriter(writer, actor, plan, context);
      return result ?? fail("write-failed", { reason: "writer-returned-no-result" });
    } catch (error) {
      return fail("write-failed", {
        state: "unknown", reconciliationRequired: true,
        txId: context.txId, message: String(error?.message ?? error)
      });
    }
  }
  return commitGrantPlan(actor, plan, context);
}

export const grantItems = grantItemBatch;
export const grantBatch = grantItemBatch;
