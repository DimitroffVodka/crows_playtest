/**
 * Party stash boundaries.
 *
 * This module deliberately does not implement Commerce `pay` or `receive`.
 * It supplies the Party-facing authorization, pure fund-transfer preflight,
 * and purse-move composition that a sheet needs before the shared Commerce
 * service lands.  A supplied Commerce transfer port owns every money write;
 * this module never falls back to a second currency writer.
 */

import {
  coinSummary,
  isPartyActor,
  layoutFor,
  looseCoinSlots,
  partyCapacityPolicy,
  purseEntriesFor
} from "./slots.mjs";

export { isPartyActor, partyCapacityPolicy } from "./slots.mjs";

const PARTY_FUND_ITEM_TYPES = new Set(["gear"]);
const TOP_LEVEL_AMOUNT_KEYS = ["amount", "fundAmount", "currency", "coins", "gc"];

function clone(value) {
  if (value == null) return value;
  if (globalThis.foundry?.utils?.deepClone) return globalThis.foundry.utils.deepClone(value);
  if (globalThis.foundry?.utils?.duplicate) return globalThis.foundry.utils.duplicate(value);
  return structuredClone(value);
}

function actorItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items)) return [...items];
  if (items && typeof items.values === "function") return [...items.values()];
  if (items && typeof items[Symbol.iterator] === "function") return [...items];
  return [];
}

function documentsOf(collection) {
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (collection && typeof collection.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function itemId(item) {
  return item?.id ?? item?._id ?? item?.document?._id ?? item?.document?.id ?? null;
}

function actorItem(actor, id) {
  if (id == null) return null;
  return actor?.items?.get?.(String(id))
    ?? actorItems(actor).find(item => String(itemId(item)) === String(id))
    ?? null;
}

function actorUuid(actor) {
  return actor?.uuid ?? actor?.document?.uuid ?? actor?.id ?? actor?._id ?? "";
}

function currentLoose(actor) {
  const value = Number(actor?.system?.currency);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function validAmount(amount) {
  const value = Number(amount);
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, reason: "invalid-amount", amount };
  }
  return { ok: true, amount: value };
}

function ownershipLevel(actor, user) {
  if (!actor || !user) return null;
  const ownership = actor.ownership ?? actor.permission;
  const key = user.id ?? user._id;
  const raw = key != null ? ownership?.[key] : undefined;
  if (raw === "OWNER" || raw === "owner") return 3;
  if (raw === "LIMITED" || raw === "limited") return 1;
  if (Number.isFinite(Number(raw))) return Number(raw);
  return null;
}

/** True when the supplied user owns this document in Foundry or a test stub. */
export function ownsActor(actor, user = globalThis.game?.user) {
  if (!actor || !user) return false;
  if (typeof actor.testUserPermission === "function") {
    try {
      if (actor.testUserPermission(user, "OWNER")) return true;
    } catch { /* fall through to the document flags */ }
  }
  if (actor.isOwner === true) return true;
  return ownershipLevel(actor, user) >= 3;
}

function isGM(user = globalThis.game?.user) {
  return user?.isGM === true;
}

/**
 * Check all involved documents before resolving any source Item or writing.
 * GM authority is the one override; players must own both sides.
 */
export function authorizePartyTransfer(party, otherActor = null, context = {}) {
  const user = context?.user ?? globalThis.game?.user;
  if (!isPartyActor(party)) return { ok: false, reason: "invalid-party" };
  if (isGM(user)) return { ok: true, user, isGM: true };
  if (!ownsActor(party, user)) return { ok: false, reason: "unauthorized", user };
  if (otherActor && !ownsActor(otherActor, user)) {
    return { ok: false, reason: "unauthorized", user };
  }
  return { ok: true, user, isGM: false };
}

/** Prior-art spelling retained as a public authorization predicate. */
export function canUserMoveMember(user, party, otherActor = null) {
  return authorizePartyTransfer(party, otherActor, { user }).ok;
}

export const _canUserMoveMember = canUserMoveMember;

function refusal(reason, extra = {}) {
  return { ok: false, reason, ...extra };
}

function moneySnapshot(actor) {
  const layout = layoutFor(actor);
  return {
    actorUuid: actorUuid(actor),
    loose: layout.coin?.loose ?? currentLoose(actor),
    // Layout preserves document order for display. Commerce planning has a
    // separate stable id order so two clients cannot choose different purses.
    purses: clone(layout.coin?.purses ?? [])
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  };
}

function planBase(actor, amount, direction) {
  return {
    actor,
    actorUuid: actorUuid(actor),
    amount,
    direction,
    before: moneySnapshot(actor),
    actorUpdate: {},
    itemUpdates: [],
    after: null
  };
}

/**
 * Pure debit planning shared by the Party sheet adapter and Commerce wiring.
 * Ordering is loose coin first, then stable purse Item id.
 */
export function planPartyDebit(actor, amount) {
  const checked = validAmount(amount);
  if (!checked.ok) return checked;
  if (!actor) return refusal("invalid-source");

  const plan = planBase(actor, checked.amount, "debit");
  let remaining = checked.amount;
  let loose = plan.before.loose;
  const purses = plan.before.purses.map(purse => ({ ...purse }));

  const looseDebit = Math.min(loose, remaining);
  loose -= looseDebit;
  remaining -= looseDebit;
  for (const purse of purses) {
    if (!remaining) break;
    const debit = Math.min(purse.held, remaining);
    purse.held -= debit;
    remaining -= debit;
    if (debit) {
      plan.itemUpdates.push({
        _id: purse.id,
        "system.purse.held": purse.held
      });
    }
  }
  if (remaining > 0) {
    return refusal("insufficient-funds", {
      amount: checked.amount,
      snapshot: plan.before,
      planned: { looseDebit, purses: [] },
      shortfall: remaining
    });
  }

  if (loose !== plan.before.loose) plan.actorUpdate["system.currency"] = loose;
  plan.after = { actorUuid: plan.actorUuid, loose, purses };
  plan.planned = {
    looseDebit,
    purses: plan.before.purses.map((before) => {
      const after = purses.find(purse => purse.id === before.id);
      return { id: before.id, amount: before.held - (after?.held ?? before.held) };
    }).filter(entry => entry.amount > 0)
  };
  return { ok: true, plan };
}

function freeCarrySlots(layout) {
  return (layout?.slots ?? [])
    .filter(slot => ["hand", "belt", "backpack"].includes(slot.container))
    .filter(slot => !(slot.items?.length > 0)).length;
}

function creditCapacity(actor, loose, amount, layout) {
  if (!amount) return { ok: true };
  if (isPartyActor(actor)) {
    const policy = partyCapacityPolicy(actor);
    if (!policy.resolved) {
      return refusal("capacity-undecided", {
        capacity: policy,
        amount,
        prospectiveLoose: loose
      });
    }
    if (policy.state === "configured" && loose > policy.limit) {
      return refusal("no-capacity", {
        capacity: policy,
        amount,
        prospectiveLoose: loose,
        excess: loose - policy.limit
      });
    }
    return { ok: true, capacity: policy };
  }

  const required = looseCoinSlots(loose);
  const available = freeCarrySlots(layout);
  if (required > available) {
    return refusal("no-capacity", {
      amount,
      prospectiveLoose: loose,
      requiredLooseSlots: required,
      availableLooseSlots: available,
      excess: Math.max(1, loose - available * 250)
    });
  }
  return { ok: true, requiredLooseSlots: required, availableLooseSlots: available };
}

/**
 * Pure credit planning. Effective purse room is filled first, then loose coin
 * is capacity-checked as one reservation. Party capacity is never inferred
 * from Crow containers; its unresolved state is returned explicitly.
 */
export function planPartyCredit(actor, amount) {
  const checked = validAmount(amount);
  if (!checked.ok) return checked;
  if (!actor) return refusal("invalid-source");

  const layout = layoutFor(actor);
  const plan = planBase(actor, checked.amount, "credit");
  let remaining = checked.amount;
  let loose = plan.before.loose;
  const purses = plan.before.purses.map(purse => ({ ...purse }));
  const purseCredits = [];

  for (const purse of purses) {
    if (!remaining) break;
    const room = Math.max(0, purse.cap - purse.held);
    const credit = Math.min(room, remaining);
    purse.held += credit;
    remaining -= credit;
    if (credit) {
      purseCredits.push({ id: purse.id, amount: credit });
      plan.itemUpdates.push({ _id: purse.id, "system.purse.held": purse.held });
    }
  }

  const prospectiveLoose = loose + remaining;
  const capacity = creditCapacity(actor, prospectiveLoose, remaining, layout);
  if (!capacity.ok) {
    return {
      ...capacity,
      snapshot: plan.before,
      planned: { purses: purseCredits, loose: remaining }
    };
  }

  loose = prospectiveLoose;
  if (loose !== plan.before.loose) plan.actorUpdate["system.currency"] = loose;
  plan.after = { actorUuid: plan.actorUuid, loose, purses };
  plan.planned = { purses: purseCredits, loose: remaining };
  return { ok: true, plan, capacity: capacity.capacity, requiredLooseSlots: capacity.requiredLooseSlots };
}

function normalizeTransferArgs(partyOrArgs, actor, amount, context) {
  // Public functions accept both `(party, actor, amount, context)` and a
  // single `{party, source|target, amount, ...context}` object.  Callers pass
  // the latter through another helper with explicit undefined arguments, so
  // checking `arguments.length` here is not sufficient.
  if (partyOrArgs?.party && isPartyActor(partyOrArgs.party)
      && actor == null && amount == null) {
    return { ...partyOrArgs };
  }
  return { party: partyOrArgs, actor, amount, ...(context ?? {}) };
}

export function planPartyDeposit(partyOrArgs, sourceActor, amount, context = {}) {
  const args = normalizeTransferArgs(partyOrArgs, sourceActor, amount, context);
  const auth = authorizePartyTransfer(args.party, args.source ?? args.actor, args);
  if (!auth.ok) return auth;
  const source = args.source ?? args.actor;
  if (!source || source.type !== "crow") return refusal("unsupported-source");
  const value = validAmount(args.amount);
  if (!value.ok) return value;
  const debit = planPartyDebit(source, value.amount);
  if (!debit.ok) return debit;
  const credit = planPartyCredit(args.party, value.amount);
  if (!credit.ok) return credit;
  return {
    ok: true,
    operation: "deposit",
    source,
    destination: args.party,
    amount: value.amount,
    sourcePlan: debit.plan,
    destinationPlan: credit.plan,
    authorization: auth
  };
}

export function planPartyWithdraw(partyOrArgs, targetActor, amount, context = {}) {
  const args = normalizeTransferArgs(partyOrArgs, targetActor, amount, context);
  const auth = authorizePartyTransfer(args.party, args.target ?? args.actor, args);
  if (!auth.ok) return auth;
  const target = args.target ?? args.actor;
  if (!target || target.type !== "crow") return refusal("unsupported-source");
  const value = validAmount(args.amount);
  if (!value.ok) return value;
  const debit = planPartyDebit(args.party, value.amount);
  if (!debit.ok) return debit;
  const credit = planPartyCredit(target, value.amount);
  if (!credit.ok) return credit;
  return {
    ok: true,
    operation: "withdraw",
    source: args.party,
    destination: target,
    amount: value.amount,
    sourcePlan: debit.plan,
    destinationPlan: credit.plan,
    authorization: auth
  };
}

export const planPartyWithdrawal = planPartyWithdraw;

function portFrom(context = {}) {
  return context.transferPort
    ?? context.commerce
    ?? context.commerce?.money
    ?? globalThis.game?.crows?.commerce
    ?? globalThis.game?.crows?.commerce?.money
    ?? globalThis.game?.crows?.money
    ?? null;
}

async function callPort(port, operation, transfer, context) {
  if (!port) return null;
  const names = operation === "deposit"
    ? ["deposit", "transferFunds", "transfer"]
    : ["withdraw", "transferFunds", "transfer"];
  const method = names.find(name => typeof port?.[name] === "function");
  if (!method) return null;
  const fn = port[method];
  const request = {
    ...context,
    operation,
    from: transfer.source,
    to: transfer.destination,
    source: transfer.source,
    destination: transfer.destination,
    party: operation === "deposit" ? transfer.destination : transfer.source,
    amount: transfer.amount,
    plan: {
      source: transfer.sourcePlan,
      destination: transfer.destinationPlan
    }
  };
  const result = fn.length <= 1
    ? await fn.call(port, request)
    : await fn.call(port, transfer.source, transfer.destination, transfer.amount, request);
  return result === undefined ? { ok: true } : result;
}

/** Commit a preflight transfer through the injected/shared Commerce port. */
export async function commitPartyTransfer(transfer, context = {}) {
  if (!transfer?.ok || !transfer.sourcePlan || !transfer.destinationPlan) {
    return refusal("invalid-request", { plan: transfer });
  }
  let external;
  try {
    external = await callPort(portFrom(context), transfer.operation, transfer, context);
  } catch (error) {
    return refusal("write-failed", {
      state: "unknown",
      repairRequired: true,
      operation: transfer.operation,
      amount: transfer.amount,
      plan: transfer,
      error,
      message: "The Commerce transfer could not be confirmed; inspect both Actors."
    });
  }
  if (external) return { ...external, operation: transfer.operation, plan: transfer };
  return refusal("commerce-unavailable", {
    operation: transfer.operation,
    amount: transfer.amount,
    plan: transfer,
    message: "No Commerce transfer port is wired for this Party operation."
  });
}

export async function depositPartyFunds(partyOrArgs, sourceActor, amount, context = {}) {
  const args = normalizeTransferArgs(partyOrArgs, sourceActor, amount, context);
  const plan = planPartyDeposit(args);
  if (!plan.ok) return plan;
  return commitPartyTransfer(plan, args);
}

export async function withdrawPartyFunds(partyOrArgs, targetActor, amount, context = {}) {
  const args = normalizeTransferArgs(partyOrArgs, targetActor, amount, context);
  const plan = planPartyWithdraw(args);
  if (!plan.ok) return plan;
  return commitPartyTransfer(plan, args);
}

function itemObject(item) {
  if (typeof item?.toObject === "function") return item.toObject();
  return clone(item);
}

/** Remove embedded identity and carried placement from a moved purse clone. */
export function purseTransferData(item) {
  const data = itemObject(item);
  delete data._id;
  delete data.id;
  delete data._key;
  if (data.system) delete data.system.location;
  return data;
}

function createdItem(result) {
  if (Array.isArray(result)) return result[0] ?? null;
  if (result?.contents && Array.isArray(result.contents)) return result.contents[0] ?? null;
  return result ?? null;
}

async function deleteEmbedded(actor, item) {
  const id = itemId(item);
  if (typeof actor?.deleteEmbeddedDocuments === "function") {
    return actor.deleteEmbeddedDocuments("Item", [id]);
  }
  if (typeof item?.delete === "function") return item.delete();
  throw new Error("embedded Item delete unavailable");
}

/**
 * Preflight and move one existing Coin Purse between Actors.  The destination
 * receives a fresh embedded identity; the source is deleted only after that
 * create confirms, and a failed second phase is compensated or marked unknown.
 */
export function planPartyPurseTransfer(party, item, context = {}) {
  // Check target authority before looking through the dropped document for its
  // source parent. An unauthorized user must not cause an arbitrary source
  // Actor/Item to be resolved merely by dragging it over this sheet.
  const targetAuth = authorizePartyTransfer(party, null, context);
  if (!targetAuth.ok) return targetAuth;
  const source = item?.parent ?? context.sourceActor ?? null;
  const auth = authorizePartyTransfer(party, source, context);
  if (!auth.ok) return auth;
  if (!source || source.type !== "crow") return refusal("unsupported-source");
  if (!item?.system?.purse?.isPurse || !PARTY_FUND_ITEM_TYPES.has(item?.type)) {
    return refusal("unsupported-party-item", { itemId: itemId(item) });
  }
  const movedItemId = itemId(item);
  if (!movedItemId) return refusal("invalid-source", { itemId: null });
  if (source.uuid && party.uuid && source.uuid === party.uuid) {
    return refusal("same-actor");
  }
  return {
    ok: true,
    operation: "move-purse",
    source,
    destination: party,
    item,
    itemId: movedItemId,
    data: purseTransferData(item),
    authorization: auth
  };
}

export async function movePartyPurse(partyOrArgs, item, context = {}) {
  const args = partyOrArgs?.party
    ? { ...partyOrArgs }
    : { party: partyOrArgs, item, ...context };
  const plan = planPartyPurseTransfer(args.party, args.item, args);
  if (!plan.ok) return plan;

  const port = portFrom(args);
  const move = port?.movePurse ?? port?.transferPurse;
  if (typeof move === "function") {
    try {
      const result = move.length <= 1
        ? await move.call(port, plan)
        : await move.call(port, plan.source, plan.destination, plan.item, plan);
      return { ...(result ?? { ok: true }), operation: "move-purse", plan };
    } catch (error) {
      return refusal("write-failed", {
        state: "unknown",
        repairRequired: true,
        operation: "move-purse",
        error,
        plan,
        message: "The purse transfer could not be confirmed; ask the GM to inspect both Actors."
      });
    }
  }

  if (typeof plan.destination.createEmbeddedDocuments !== "function") {
    return refusal("write-failed", { state: "unknown", repairRequired: true, plan });
  }
  let created = null;
  try {
    created = createdItem(await plan.destination.createEmbeddedDocuments("Item", [clone(plan.data)]));
  } catch (error) {
    return refusal("write-failed", { state: "confirmed", error, plan });
  }
  if (!created) {
    return refusal("write-failed", {
      state: "unknown",
      repairRequired: true,
      message: "Destination purse creation could not be confirmed.",
      plan
    });
  }
  try {
    await deleteEmbedded(plan.source, plan.item);
    return { ok: true, operation: "move-purse", movedItem: created, plan };
  } catch (error) {
    let repaired = false;
    try {
      if (created) await deleteEmbedded(plan.destination, created);
      repaired = true;
    } catch { /* the destination clone may now require GM repair */ }
    return {
      ok: false,
      reason: "write-failed",
      state: repaired ? "repaired" : "unknown",
      repairRequired: !repaired,
      error,
      plan
    };
  }
}

function parsedDropData(eventOrData) {
  if (eventOrData && typeof eventOrData === "object" && !eventOrData.dataTransfer) return eventOrData;
  const raw = eventOrData?.dataTransfer?.getData?.("text/plain")
    ?? eventOrData?.dataTransfer?.getData?.("application/json");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export const partyDropData = parsedDropData;

export function fundAmountFromDrop(data) {
  const source = data?.funds ?? data?.fund ?? data;
  for (const key of TOP_LEVEL_AMOUNT_KEYS) {
    if (Object.hasOwn(source ?? {}, key)) return source[key];
  }
  return undefined;
}

export async function resolveDropActor(data, context = {}) {
  if (data?.actor) return data.actor;
  if (data?.document?.type === "Actor") return data.document;
  const uuid = data?.actorUuid ?? data?.sourceUuid ?? data?.uuid;
  if (!uuid) return null;
  if (typeof globalThis.fromUuid === "function") {
    try { return await globalThis.fromUuid(uuid); } catch { /* try world collection */ }
  }
  const actors = context.actors ?? globalThis.game?.actors;
  return actors?.get?.(uuid)
    ?? documentsOf(actors).find(actor => actor?.uuid === uuid || actor?.id === uuid)
    ?? null;
}

/** Handle an Actor fund payload after target ownership has been checked. */
export async function depositDropToParty(party, eventOrData, context = {}) {
  const targetAuth = authorizePartyTransfer(party, null, context);
  if (!targetAuth.ok) return targetAuth;
  const data = parsedDropData(eventOrData);
  const source = await resolveDropActor(data, context);
  if (!source || source.type !== "crow") return refusal("unsupported-source");
  const amount = fundAmountFromDrop(data);
  if (amount === undefined) return refusal("invalid-amount");
  return depositPartyFunds(party, source, amount, context);
}

export function partyPurseItems(actor) {
  return actorItems(actor).filter(item => item?.system?.purse?.isPurse);
}

/** Sheet-ready read model. No speed, wound, or creature fields are included. */
export function partyViewData(actor, { user = globalThis.game?.user } = {}) {
  const layout = layoutFor(actor);
  const coin = coinSummary(layout);
  const capacity = layout.partyCapacity ?? partyCapacityPolicy(actor);
  const purses = partyPurseItems(actor).map(item => {
    const entry = coin.purses.find(purse => String(purse.id) === String(itemId(item)));
    return {
      id: itemId(item),
      name: item.name,
      img: item.img,
      held: entry?.held ?? (Number(item.system?.purse?.held ?? 0) || 0),
      capacity: entry?.cap ?? (Number(item.system?.purse?.baseCapacity ?? 0) || 0),
      overflow: entry?.over ?? 0
    };
  });
  return {
    layout,
    coin,
    purses,
    capacity,
    capacityUndecided: capacity.state === "unresolved",
    unsupportedItems: layout.unplaced,
    canDeposit: isGM() || ownsActor(actor, user),
    canWithdraw: isGM() || ownsActor(actor, user)
  };
}
