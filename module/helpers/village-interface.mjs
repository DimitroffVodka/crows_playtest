/**
 * Village interface boundary.
 *
 * This module owns the browse/propose/Ref commit protocol.  The Village
 * setting, its designated-writer queue, and the event-aware service policy
 * remain in `village.mjs`; this layer only composes those primitives into a
 * durable ChatMessage proposal and a read model suitable for an application.
 *
 * Paid settlement is intentionally an injected receipt seam.  Ticket 5 owns
 * Commerce's pay/receive/grantItem implementation.  Until that seam is
 * supplied, a paid proposal can be browsed and reviewed but cannot claim a
 * payment or mutate Village state.
 */

import {
  INSTITUTIONS,
  institutionServicePolicy,
  villageInputFingerprint,
  getVillage,
  normalizeVillage,
  foundingPrice,
  upgradePrice,
  institutionPurchasableMaxLevel,
  advancementRow,
  sellPercentage,
  itemAvailability,
  villageCraftingQuote,
  workshopRental,
  innMaxBet,
  beaconRadius,
  beaconTransportCost,
  capstoneActive,
  auctionSalePercentage,
  auctionPriceMultiplier,
  auctionBuybackPrice,
  resolveVillageStockChance,
  foundVillageQuote,
  clampProsperity,
  enqueueVillageOperation,
  getVillageOperation,
  VILLAGE_OPERATION_TERMINAL_PHASES,
  getActiveVillageGM,
  isVillageDesignatedWriter,
  institutionRecordById
} from "./village.mjs";

export const VILLAGE_PROPOSAL_FLAG = "villageProposal";

export const VILLAGE_PROPOSAL_PHASES = Object.freeze([
  "pending", "approved", "prepared", "paying", "commerce-pending",
  "commerce-committed", "credit-pending", "spend-pending", "committing",
  "partial", "committed", "declined", "stale", "uncertain", "duplicate"
]);

export const VILLAGE_PROPOSAL_STATUSES = Object.freeze([
  "pending", "approved", "declined", "stale", "paying", "commerce-committed",
  "credit-pending", "spend-pending", "committed", "uncertain", "duplicate"
]);

export const VILLAGE_PROPOSAL_TERMINAL_STATUSES = Object.freeze([
  "declined", "stale", "committed", "uncertain", "duplicate"
]);

const TERMINAL_STATUSES = new Set(VILLAGE_PROPOSAL_TERMINAL_STATUSES);
const TERMINAL_OPERATION_PHASES = new Set(VILLAGE_OPERATION_TERMINAL_PHASES);
const PAID_ACTIONS = new Set([
  "found", "reopen", "upgrade", "buy", "merchant-purchase", "sell", "auction-sell",
  "auction-buy", "craft", "workshop", "inn", "beacon", "service"
]);

// A local index makes a just-created message addressable even in the minimal
// client/test collection, while the ChatMessage flag remains the durable
// source of truth across reloads.
const localProposalMessages = new Map();

function clone(value) {
  if (value === undefined) return undefined;
  try {
    if (typeof globalThis.foundry?.utils?.deepClone === "function") {
      return globalThis.foundry.utils.deepClone(value);
    }
  } catch { /* fall through */ }
  if (typeof structuredClone === "function") {
    try { return structuredClone(value); } catch { /* functions are not data */ }
  }
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function randomId(prefix = "id") {
  let value = null;
  try { value = globalThis.foundry?.utils?.randomID?.(16); } catch { /* shim */ }
  if (!value) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    value = Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  }
  return `${prefix}-${value}`;
}

function userId(user = globalThis.game?.user) {
  return user?.id == null ? null : String(user.id);
}

function isRefUser(user = globalThis.game?.user) {
  if (!user?.isGM) return { ok: false, error: "unauthorized", reason: "ref-required" };
  const active = getActiveVillageGM();
  if (!active) return { ok: false, error: "authority-unavailable", reason: "no-active-gm", code: "no-active-gm" };
  if (active.id != null && user.id != null && String(active.id) !== String(user.id)) {
    return {
      ok: false,
      error: "authority-unavailable",
      reason: "request-must-run-on-designated-gm",
      activeGMId: active.id
    };
  }
  return { ok: true, user, activeGM: active };
}

function canonicalAction(action) {
  const normalized = String(action ?? "browse").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return {
    view: "browse", read: "browse", browse: "browse",
    found: "found", foundinstitution: "found", foundreopen: "found", reopen: "reopen", recover: "reopen",
    upgrade: "upgrade", levelup: "upgrade",
    buy: "buy", purchase: "buy", merchantpurchase: "merchant-purchase",
    sell: "sell", sellitem: "sell", auctionsell: "auction-sell", auctionbuy: "auction-buy", buyback: "auction-buy",
    craft: "craft", commission: "craft", workshop: "workshop", rentworkshop: "workshop",
    inn: "inn", bet: "inn", beacon: "beacon", transport: "beacon", service: "service",
    rename: "rename", setname: "rename", prosperity: "set-prosperity", setprosperity: "set-prosperity"
  }[normalized] ?? normalized;
}

function actionRequest(source = {}) {
  const requested = source.requested && typeof source.requested === "object" ? source.requested : {};
  const request = {
    ...clone(requested),
    action: canonicalAction(source.action ?? requested.action ?? requested.operation),
    institutionId: source.institutionId ?? requested.institutionId ?? requested.id ?? requested.targetId,
    institutionType: source.institutionType ?? requested.institutionType ?? requested.type ?? source.type,
    actorUuid: source.actorUuid ?? source.beneficiaryActorUuid ?? source.payerActorUuid
      ?? source.payerUuid ?? requested.actorUuid ?? requested.payerActorUuid ?? requested.payerUuid,
    itemKey: source.itemKey ?? requested.itemKey,
    purchaseId: source.purchaseId ?? requested.purchaseId,
    itemPrice: source.itemPrice ?? requested.itemPrice ?? requested.price,
    itemValue: source.itemValue ?? requested.itemValue ?? requested.value,
    criteria: source.criteria ?? requested.criteria,
    itemCriteria: source.itemCriteria ?? requested.itemCriteria,
    uses: source.uses ?? requested.uses,
    expertise: source.expertise ?? requested.expertise,
    rank: source.rank ?? requested.rank,
    quality: source.quality ?? requested.quality,
    power: source.power ?? requested.power,
    bet: source.bet ?? requested.bet,
    hexes: source.hexes ?? requested.hexes,
    distance: source.distance ?? requested.distance,
    kind: source.kind ?? requested.kind,
    name: source.name ?? requested.name,
    value: source.value ?? requested.value,
    prosperity: source.prosperity ?? requested.prosperity,
    targetLevel: source.targetLevel ?? requested.targetLevel ?? requested.target,
    steward: source.steward ?? requested.steward,
    soldFor: source.soldFor ?? requested.soldFor,
    rush: source.rush ?? requested.rush,
    extraCraftingBonus: source.extraCraftingBonus ?? requested.extraCraftingBonus,
    connectionBonus: source.connectionBonus ?? requested.connectionBonus
  };
  for (const key of Object.keys(request)) if (request[key] === undefined) delete request[key];
  return request;
}

function policyFingerprint(policy) {
  const action = canonicalAction(policy?.action);
  const fingerprint = {
    action: policy?.action ?? null,
    villageId: policy?.villageId ?? null,
    institutionId: policy?.institutionId ?? null,
    institutionType: policy?.institutionType ?? null,
    rawLevel: policy?.rawLevel ?? null,
    pendingLevel: policy?.pendingLevel ?? null,
    effectiveLevel: policy?.effectiveLevel ?? null,
    status: policy?.status ?? null,
    reason: policy?.reason ?? null,
    quote: policy?.quote ?? null
  };
  if (["buy", "merchant-purchase", "service", "auction-buy"].includes(action)) {
    fingerprint.availability = policy?.availability ?? null;
    fingerprint.creditToConsume = policy?.creditToConsume ?? null;
  }
  if (["sell", "auction-sell"].includes(action)) fingerprint.salePercentage = policy?.salePercentage ?? null;
  if (action === "craft") fingerprint.craftingTerms = policy?.craftingTerms ?? null;
  if (action === "workshop") fingerprint.workshopTerms = policy?.workshopTerms ?? null;
  return villageInputFingerprint(fingerprint);
}

/** Public token helper for a browse form that wants to submit its read quote. */
export const villagePolicyFingerprint = policyFingerprint;
export const villageQuoteFingerprint = policyFingerprint;

function proposalInputFingerprint(input, policy, village) {
  return villageInputFingerprint({
    action: canonicalAction(input.action),
    villageId: input.villageId ?? village?.villageId ?? null,
    institutionId: input.institutionId ?? policy?.institutionId ?? null,
    institutionType: input.institutionType ?? policy?.institutionType ?? null,
    payerActorUuid: input.payerActorUuid ?? null,
    purchaseId: input.purchaseId ?? null,
    requested: input.requested ?? null,
    itemKey: input.itemKey ?? null,
    quoteFingerprint: input.quoteFingerprint ?? policyFingerprint(policy),
    availabilityFingerprint: input.availabilityFingerprint
      ?? villageInputFingerprint(policy?.availability ?? null)
  });
}

function proposalPayloadFromMessage(message) {
  if (!message || typeof message !== "object") return null;
  const value = message.flags?.crows?.[VILLAGE_PROPOSAL_FLAG]
    ?? message._source?.flags?.crows?.[VILLAGE_PROPOSAL_FLAG];
  return value && typeof value === "object" ? clone(value) : null;
}

function iterateCollection(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection[Symbol.iterator] === "function") return [...collection].map(entry => Array.isArray(entry) ? entry[1] : entry);
  return [];
}

function findMessageSync(proposalOrId) {
  if (proposalOrId && typeof proposalOrId === "object") {
    if (proposalPayloadFromMessage(proposalOrId)) return proposalOrId;
    if (proposalOrId.message && proposalPayloadFromMessage(proposalOrId.message)) return proposalOrId.message;
  }
  const id = typeof proposalOrId === "string" ? proposalOrId
    : proposalOrId?.proposalId ?? proposalOrId?.id ?? null;
  if (!id) return null;
  const local = localProposalMessages.get(String(id));
  if (local) {
    const localProposal = proposalPayloadFromMessage(local);
    const liveVillageId = (() => {
      try { return getVillage()?.villageId; } catch { return null; }
    })();
    if (!liveVillageId || !localProposal?.villageId || String(localProposal.villageId) === String(liveVillageId)) {
      return local;
    }
  }
  const collections = [globalThis.game?.messages, globalThis.game?.chat?.messages];
  for (const collection of collections) {
    const found = collection?.get?.(id);
    if (found) return found;
    const byId = iterateCollection(collection).find(message => String(message?.id ?? "") === String(id));
    if (byId) return byId;
    const byProposal = iterateCollection(collection).find(message =>
      String(proposalPayloadFromMessage(message)?.proposalId ?? "") === String(id));
    if (byProposal) return byProposal;
  }
  return null;
}

async function resolveMessage(proposalOrId) {
  const local = findMessageSync(proposalOrId);
  if (local) return local;
  if (typeof globalThis.ChatMessage?.get === "function") {
    try { return await globalThis.ChatMessage.get(proposalOrId); } catch { /* absent */ }
  }
  return null;
}

async function updateProposal(message, patch = {}) {
  const current = proposalPayloadFromMessage(message) ?? {};
  const next = { ...clone(current), ...clone(patch), updatedAt: Date.now() };
  if (typeof message?.update === "function") {
    try {
      await message.update({ [`flags.crows.${VILLAGE_PROPOSAL_FLAG}`]: clone(next) });
    } catch (error) {
      // The Village operation/journal remains the recovery source of truth if
      // a ChatMessage acknowledgement is lost. Keep the transition in the
      // returned projection without turning a committed operation into a UI
      // exception.
      next.chatUpdateError = String(error?.message ?? error);
    }
  } else if (message) {
    message.flags ??= {};
    message.flags.crows ??= {};
    message.flags.crows[VILLAGE_PROPOSAL_FLAG] = clone(next);
  }
  return next;
}

function messageId(message) {
  return message?.id ?? message?._id ?? null;
}

/**
 * Build the durable player/ref proposal.  This function intentionally does
 * not call `game.settings.set`, Commerce, or any Village mutation helper.
 */
export async function createVillageProposal(input = {}) {
  const village = normalizeVillage(input.village ?? getVillage());
  const action = canonicalAction(input.action ?? input.operation);
  if (!action || action === "browse") {
    return { ok: false, error: "invalid-proposal", reason: "action-required" };
  }
  const request = actionRequest({ ...input, action });
  if (action === "rename" && !String(input.name ?? request.name ?? input.requested?.name ?? "").trim()) {
    return { ok: false, error: "invalid-proposal", reason: "village-name-required" };
  }
  if (action === "set-prosperity") {
    const value = input.value ?? input.prosperity ?? request.value ?? request.prosperity;
    if (value == null || !Number.isFinite(Number(value))) {
      return { ok: false, error: "invalid-proposal", reason: "prosperity-required" };
    }
  }
  const purchaseId = ["buy", "merchant-purchase"].includes(action)
    ? String(input.purchaseId ?? request.purchaseId ?? randomId("purchase")) : null;
  if (purchaseId) request.purchaseId = purchaseId;
  const policy = institutionServicePolicy(village, request);
  if (policy.reason === "unknown-institution" || policy.reason === "institution-required") {
    return { ok: false, error: "invalid-proposal", reason: policy.reason, policy };
  }
  const proposalId = String(input.proposalId ?? randomId("proposal"));
  const villageOperationId = String(input.villageOperationId ?? input.operationId
    ?? `village-operation-${proposalId}`);
  const computedQuoteFingerprint = policyFingerprint(policy);
  if (input.quoteFingerprint != null && String(input.quoteFingerprint) !== computedQuoteFingerprint) {
    return {
      ok: false, error: "stale", reason: "stale-quote", stale: true,
      policy: clone(policy), currentQuoteFingerprint: computedQuoteFingerprint
    };
  }
  const quoteFingerprint = String(input.quoteFingerprint ?? computedQuoteFingerprint);
  const computedAvailabilityFingerprint = villageInputFingerprint(policy.availability ?? null);
  if (input.availabilityFingerprint != null
      && String(input.availabilityFingerprint) !== computedAvailabilityFingerprint) {
    return {
      ok: false, error: "stale", reason: "stale-availability", stale: true,
      policy: clone(policy), currentAvailabilityFingerprint: computedAvailabilityFingerprint
    };
  }
  const availabilityFingerprint = String(input.availabilityFingerprint
    ?? computedAvailabilityFingerprint);
  const requested = clone(input.requested ?? input.requestedService ?? input.requestedItem ?? request);
  const requestedRevision = input.expectedVillageRevision ?? input.expectedRevision;
  const expectedRevision = requestedRevision != null && String(requestedRevision).trim() !== ""
    && Number.isInteger(Number(requestedRevision)) ? Number(requestedRevision) : village.revision;
  const payload = {
    proposalId,
    villageOperationId,
    operationId: villageOperationId,
    proposerUserId: String(input.proposerUserId ?? userId() ?? "unknown"),
    action,
    villageId: String(input.villageId ?? village.villageId),
    originCycle: input.originCycle ?? village.cycle,
    expectedVillageRevision: expectedRevision,
    expectedRevision,
    institutionId: input.institutionId ?? policy.institutionId ?? null,
    institutionType: input.institutionType ?? policy.institutionType ?? null,
    target: clone(input.target ?? input.targetId ?? input.institutionId
      ?? policy.institutionId ?? input.institutionType ?? policy.institutionType ?? null),
    targetId: input.targetId ?? input.institutionId ?? policy.institutionId ?? null,
    payerActorUuid: input.payerActorUuid ?? input.payerUuid
      ?? request.payerActorUuid ?? request.payerUuid ?? request.actorUuid ?? null,
    purchaseId,
    requested,
    requestedItem: clone(input.requestedItem
      ?? ((input.itemKey ?? request.itemKey) ? { itemKey: input.itemKey ?? request.itemKey, ...requested } : null)),
    requestedService: clone(input.requestedService ?? (action === "service" ? requested : null)),
    itemKey: input.itemKey ?? request.itemKey ?? null,
    quote: clone(policy.quote),
    availability: clone(policy.availability),
    creditIntent: clone(policy.creditToConsume),
    grossPrice: policy.quote?.grossPrice ?? policy.quote?.price ?? null,
    netPrice: policy.quote?.netPrice ?? policy.quote?.price ?? null,
    quoteFingerprint,
    availabilityFingerprint,
    computedQuoteFingerprint,
    computedAvailabilityFingerprint,
    inputFingerprint: String(input.inputFingerprint
      ?? proposalInputFingerprint({ ...input, action, requested, quoteFingerprint, availabilityFingerprint }, policy, village)),
    status: "pending",
    phase: "pending",
    commerceTxId: null,
    childOperationIds: [...new Set((input.childOperationIds ?? input.childIds ?? []).map(String).filter(Boolean))],
    committedResult: null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (typeof globalThis.ChatMessage?.create !== "function") {
    return { ok: false, error: "chat-unavailable", reason: "chat-message-create-required" };
  }
  const content = input.content ?? `<div class="crows village-proposal" data-proposal-id="${escapeHtml(proposalId)}">
    <strong>Village proposal</strong> — ${escapeHtml(action)} (pending Ref review)
  </div>`;
  let message;
  try {
    message = await globalThis.ChatMessage.create({
      content,
      speaker: input.speaker ?? { alias: "Village" },
      flags: { crows: { [VILLAGE_PROPOSAL_FLAG]: clone(payload) } }
    });
  } catch (error) {
    return {
      ok: false, error: "chat-unavailable", reason: "chat-message-create-failed",
      message: String(error?.message ?? error)
    };
  }
  if (!message) return { ok: false, error: "chat-unavailable", reason: "chat-message-create-failed" };
  if (message) {
    localProposalMessages.set(proposalId, message);
    if (messageId(message) != null) localProposalMessages.set(String(messageId(message)), message);
  }
  return { ok: true, proposalId, proposal: clone(payload), message, messageId: messageId(message), policy: clone(policy) };
}

export const proposeVillageAction = createVillageProposal;
export const submitVillageProposal = createVillageProposal;
export const createProposal = createVillageProposal;

/** Read a proposal without exposing the ChatMessage's mutable flags object. */
export async function getVillageProposal(proposalOrId) {
  if (proposalOrId && typeof proposalOrId === "object" && proposalPayloadFromMessage(proposalOrId)) {
    return proposalPayloadFromMessage(proposalOrId);
  }
  const message = await resolveMessage(proposalOrId);
  return proposalPayloadFromMessage(message);
}

export const readVillageProposal = getVillageProposal;
export const inspectVillageProposal = getVillageProposal;
export const readProposal = getVillageProposal;

/** List durable proposals visible to this client for the selected Village. */
export function listVillageProposals(options = {}) {
  const villageId = options?.villageId == null ? getVillage()?.villageId : options.villageId;
  const messages = [
    ...iterateCollection(globalThis.game?.messages),
    ...iterateCollection(globalThis.game?.chat?.messages),
    ...localProposalMessages.values()
  ];
  const seen = new Set();
  return messages.flatMap(message => {
    const proposal = proposalPayloadFromMessage(message);
    if (!proposal || (villageId != null && String(proposal.villageId) !== String(villageId))) return [];
    const id = String(proposal.proposalId ?? messageId(message) ?? "");
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [{ ...clone(proposal), messageId: messageId(message) }];
  });
}

export const villageProposals = listVillageProposals;

async function resolvePayer(uuid) {
  if (!uuid) return null;
  const actors = globalThis.game?.actors;
  const direct = actors?.get?.(uuid);
  if (direct) return direct;
  const found = iterateCollection(actors).find(actor => actor?.uuid === uuid || actor?.id === uuid);
  if (found) return found;
  try {
    if (typeof globalThis.fromUuid === "function") return await globalThis.fromUuid(uuid);
  } catch { /* no actor */ }
  return null;
}

function payerAuthorized(actor, user) {
  if (!actor) return { ok: false, error: "payer-not-found", reason: "payer-not-found" };
  if (user?.isGM) return { ok: true, actor };
  if (actor.isOwner === true || actor.testUserPermission?.(user, "OWNER") === true
    || actor.testUserPermission?.(user, "OWNER", { exact: true }) === true) {
    return { ok: true, actor };
  }
  const ownership = actor.ownership ?? actor.permission;
  if (ownership && user?.id != null && [3, "OWNER", "owner"].includes(ownership[user.id])) {
    return { ok: true, actor };
  }
  return { ok: false, error: "payer-unauthorized", reason: "payer-unauthorized" };
}

function freshPolicyFor(proposal, village) {
  return institutionServicePolicy(village, actionRequest({
    ...proposal,
    action: proposal.action,
    institutionId: proposal.institutionId,
    institutionType: proposal.institutionType,
    payerActorUuid: proposal.payerActorUuid,
    requested: proposal.requested,
    itemKey: proposal.itemKey
  }));
}

async function validateProposal(proposal, {
  requirePayer = true,
  user = globalThis.game?.user,
  allowExistingOperation = false
} = {}) {
  const village = getVillage();
  if (String(proposal.villageId) !== String(village.villageId)) {
    return { ok: false, stale: true, error: "stale", reason: "village-id-changed", village, policy: null };
  }
  const expectedRevision = proposal.expectedVillageRevision ?? proposal.expectedRevision;
  const policy = freshPolicyFor(proposal, village);
  if (!allowExistingOperation && Number(expectedRevision) !== Number(village.revision)) {
    return {
      ok: false, stale: true, error: "stale", reason: "stale-revision", village,
      currentRevision: village.revision, policy
    };
  }
  const quoteFingerprint = policyFingerprint(policy);
  const availabilityFingerprint = villageInputFingerprint(policy.availability ?? null);
  if ((proposal.computedQuoteFingerprint && proposal.computedQuoteFingerprint !== quoteFingerprint)
      || (proposal.quoteFingerprint && proposal.quoteFingerprint !== quoteFingerprint)) {
    return { ok: false, stale: true, error: "stale", reason: "stale-quote", village, policy };
  }
  if ((proposal.computedAvailabilityFingerprint && proposal.computedAvailabilityFingerprint !== availabilityFingerprint)
      || (proposal.availabilityFingerprint && proposal.availabilityFingerprint !== availabilityFingerprint)) {
    return { ok: false, stale: true, error: "stale", reason: "stale-availability", village, policy };
  }
  if (PAID_ACTIONS.has(canonicalAction(proposal.action)) && policy.ok !== true) {
    return { ok: false, stale: true, error: "stale", reason: policy.reason ?? "policy-refusal", village, policy };
  }
  if (requirePayer && PAID_ACTIONS.has(canonicalAction(proposal.action)) && proposal.payerActorUuid) {
    const actor = await resolvePayer(proposal.payerActorUuid);
    const payer = payerAuthorized(actor, user);
    if (!payer.ok) return { ok: false, unauthorized: true, ...payer, village, policy };
  }
  if (requirePayer && PAID_ACTIONS.has(canonicalAction(proposal.action)) && !proposal.payerActorUuid) {
    return { ok: false, unauthorized: true, error: "payer-required", reason: "payer-required", village, policy };
  }
  return { ok: true, village, policy };
}

/**
 * Ref-only proposal review.  Approving writes only the ChatMessage phase; it
 * never writes the Village setting and never calls Commerce.
 */
export async function reviewVillageProposal(proposalOrId, options = {}) {
  const message = await resolveMessage(proposalOrId);
  const proposal = proposalPayloadFromMessage(message)
    ?? (proposalOrId && typeof proposalOrId === "object" ? clone(proposalOrId) : null);
  if (!proposal) return { ok: false, error: "proposal-not-found", reason: "proposal-not-found" };
  const authority = isRefUser(options.user ?? globalThis.game?.user);
  if (!authority.ok) return authority;
  if (TERMINAL_STATUSES.has(proposal.status) && proposal.status !== "uncertain") {
    return { ok: proposal.status === "committed", proposal: clone(proposal), status: proposal.status, replayed: true };
  }
  const decision = String(options.decision ?? options.status ?? "approve").toLowerCase();
  if (["decline", "declined", "reject", "rejected"].includes(decision)) {
    const next = message ? await updateProposal(message, {
      status: "declined", phase: "declined", reviewedByUserId: userId(authority.user), reviewedAt: Date.now(),
      reason: options.reason ?? "declined-by-ref"
    }) : { ...proposal, status: "declined", phase: "declined" };
    return { ok: true, status: "declined", proposal: next };
  }
  const checked = await validateProposal(proposal, { user: authority.user });
  if (!checked.ok) {
    const next = message ? await updateProposal(message, {
      status: checked.unauthorized ? "pending" : "stale",
      phase: checked.unauthorized ? "pending" : "stale",
      reason: checked.reason,
      currentRevision: checked.village?.revision ?? null
    }) : { ...proposal, status: checked.unauthorized ? "pending" : "stale", reason: checked.reason };
    return { ok: false, error: checked.error, reason: checked.reason, stale: checked.stale, unauthorized: checked.unauthorized, proposal: next, policy: clone(checked.policy) };
  }
  const next = message ? await updateProposal(message, {
    status: "approved", phase: "approved", reviewedByUserId: userId(authority.user), reviewedAt: Date.now(),
    reviewedRevision: checked.village.revision,
    reviewedPolicyFingerprint: policyFingerprint(checked.policy),
    reviewedPolicy: clone(checked.policy)
  }) : { ...proposal, status: "approved", phase: "approved" };
  return { ok: true, status: "approved", proposal: next, policy: clone(checked.policy) };
}

export const authorizeVillageProposal = reviewVillageProposal;
export const reviewProposal = reviewVillageProposal;
export const authorizeProposal = reviewVillageProposal;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function requestedValue(proposal, key, fallback = null) {
  return proposal?.requested?.[key] ?? proposal?.[key] ?? fallback;
}

function applyVillageOnlyAction(next, proposal, policy) {
  const action = canonicalAction(proposal.action);
  if (action === "rename") {
    const name = String(requestedValue(proposal, "name", "")).trim();
    if (!name) return { ok: false, error: "invalid-request", reason: "village-name-required" };
    next.name = name;
    return { ok: true, action, name };
  }
  if (action === "set-prosperity") {
    const value = requestedValue(proposal, "value", requestedValue(proposal, "prosperity", null));
    if (value == null || !Number.isFinite(Number(value))) {
      return { ok: false, error: "invalid-request", reason: "prosperity-required" };
    }
    next.prosperity = clampProsperity(value);
    if (next.prosperity > policy?.villageProsperity) next.raisingEventThisCycle = true;
    return { ok: true, action, prosperity: next.prosperity };
  }
  return null;
}

function applyReceiptState(next, proposal, policy, settlement = {}) {
  const action = canonicalAction(proposal.action);
  if (settlement.nextVillage && typeof settlement.nextVillage === "object") return clone(settlement.nextVillage);
  const institutionId = proposal.institutionId ?? policy?.institutionId;
  const institution = institutionId == null ? null : institutionRecordById(institutionId, next);
  if ((action === "found" || action === "reopen") && policy?.institutionType) {
    const def = INSTITUTIONS[policy.institutionType];
    if (!def) return next;
    const existing = next.institutions.find(entry => entry.type === policy.institutionType) ?? null;
    const record = existing ? {
      ...existing,
      name: requestedValue(proposal, "name", existing.name ?? def.label) || def.label,
      steward: requestedValue(proposal, "steward", existing.steward ?? "") || "",
      // Founding/reopening is a level-one operation; later paid upgrades are
      // separate proposals and cannot be smuggled into this receipt.
      level: 1,
      destroyed: false,
      destroyedOnCycle: null,
      destruction: null,
      pendingLevel: null,
      pendingFromCycle: null,
      foundedOnCycle: next.cycle,
      operatingFromCycle: next.cycle + 1,
      revivedOnCycle: existing.destroyed ? next.cycle : undefined
    } : {
      id: `inst-${proposal.proposalId}`,
      type: policy.institutionType,
      name: requestedValue(proposal, "name", def.label) || def.label,
      steward: requestedValue(proposal, "steward", "") || "",
      level: 1,
      foundedOnCycle: next.cycle,
      operatingFromCycle: next.cycle + 1,
      pendingLevel: null,
      pendingFromCycle: null,
      destroyed: false,
      destroyedOnCycle: null,
      destruction: null
    };
    if (existing) next.institutions[next.institutions.indexOf(existing)] = record;
    else next.institutions.push(record);
    next.prosperity = clampProsperity(next.prosperity + 1);
    next.raisingEventThisCycle = true;
    next.activeEffects = (next.activeEffects ?? []).filter(effect => effect.kind !== "boycott");
    return next;
  }
  if (action === "upgrade" && institution) {
    const target = Number(policy?.targetLevel ?? requestedValue(proposal, "targetLevel", 0));
    if (target > 0) {
      institution.pendingLevel = target;
      institution.pendingFromCycle = next.cycle + 1;
      next.prosperity = clampProsperity(next.prosperity + 1);
      next.raisingEventThisCycle = true;
    }
  }
  return next;
}

function operationResultLooksCommitted(result) {
  return result?.ok === true && (result?.committed === true || result?.operation?.phase === "committed"
    || result?.operation?.phase === "complete" || result?.phase === "committed" || result?.replayed === true);
}

function settlementPhase(settlement) {
  const phase = String(settlement?.phase ?? "").trim();
  return ["pending", "paying", "prepared", "commerce-pending", "commerce-committed", "credit-pending", "spend-pending", "partial", "uncertain"]
    .includes(phase) ? phase : null;
}

/**
 * Commit an approved proposal through the foundation queue.  A paid proposal
 * requires an injected `settle`/`settlement` callback (the future Commerce
 * saga).  The production interface never fabricates a paid receipt.
 */
export async function commitVillageProposal(proposalOrId, options = {}) {
  const message = await resolveMessage(proposalOrId);
  const proposal = proposalPayloadFromMessage(message)
    ?? (proposalOrId && typeof proposalOrId === "object" ? clone(proposalOrId) : null);
  if (!proposal) return { ok: false, error: "proposal-not-found", reason: "proposal-not-found" };
  const authority = isRefUser(options.user ?? globalThis.game?.user);
  if (!authority.ok) return authority;
  if (proposal.status === "committed" && proposal.committedResult) {
    return { ...clone(proposal.committedResult), ok: true, replayed: true, proposal: clone(proposal) };
  }
  const action = canonicalAction(proposal.action);
  const operationId = String(proposal.villageOperationId ?? proposal.operationId
    ?? `village-operation-${proposal.proposalId}`);
  const childOperationIds = [...new Set([
    ...(proposal.childOperationIds ?? []),
    ...(options.childOperationIds ?? options.childIds ?? [])
  ].map(String).filter(Boolean))];
  const existingOperation = getVillageOperation(operationId);
  const proposalFingerprint = proposal.inputFingerprint == null ? null : String(proposal.inputFingerprint);
  if (existingOperation && proposalFingerprint
      && String(existingOperation.inputFingerprint ?? "") !== proposalFingerprint) {
    return {
      ok: false, error: "duplicate", conflict: true, reason: "input-fingerprint-conflict",
      operation: clone(existingOperation), proposal: clone(proposal)
    };
  }
  if (existingOperation && TERMINAL_OPERATION_PHASES.has(String(existingOperation.phase ?? ""))) {
    const phase = String(existingOperation.phase);
    if (["committed", "complete", "resolved"].includes(phase)) {
      const committedResult = {
        ...(clone(existingOperation.result) ?? {}),
        ok: true,
        committed: true,
        operationId,
        villageOperationId: operationId,
        operation: clone(existingOperation)
      };
      const next = message ? await updateProposal(message, {
        status: "committed", phase: "committed", committedResult,
        operationResult: clone(existingOperation)
      }) : { ...proposal, status: "committed", phase: "committed", committedResult };
      return { ...committedResult, replayed: true, proposal: next };
    }
    return {
      ok: false,
      error: phase === "duplicate-detected" ? "duplicate" : "operation-terminal",
      reason: phase === "duplicate-detected" ? "input-fingerprint-conflict" : phase,
      operation: clone(existingOperation), proposal: clone(proposal)
    };
  }
  if (["declined", "stale", "duplicate"].includes(String(proposal.status ?? ""))) {
    return {
      ok: false, error: "proposal-terminal", reason: String(proposal.status),
      proposal: clone(proposal), replayed: true
    };
  }
  const checked = await validateProposal(proposal, {
    user: authority.user,
    allowExistingOperation: Boolean(existingOperation) || [
      "commerce-committed", "credit-pending", "spend-pending", "partial"
    ].includes(String(proposal.phase ?? ""))
  });
  if (!checked.ok) {
    const status = checked.unauthorized ? proposal.status ?? "pending" : "stale";
    const next = message ? await updateProposal(message, {
      status, phase: checked.unauthorized ? proposal.phase ?? "pending" : "stale",
      reason: checked.reason, currentRevision: checked.village?.revision ?? null
    }) : { ...proposal, status, reason: checked.reason };
    return { ok: false, error: checked.error, reason: checked.reason, stale: checked.stale, unauthorized: checked.unauthorized, proposal: next, policy: clone(checked.policy) };
  }
  const inputFingerprint = String(proposal.inputFingerprint ?? proposalInputFingerprint(proposal, checked.policy, checked.village));
  const settle = options.settle ?? options.settlement ?? options.commitPaid ?? null;
  const applyVillage = options.applyVillage ?? options.applyState ?? options.execute ?? null;
  let settlement = null;
  let stockResult = null;
  if (["buy", "merchant-purchase"].includes(action) && checked.policy?.availability?.outOfStockChance) {
    const stockPurchaseId = String(proposal.purchaseId ?? `${operationId}:stock`);
    stockResult = resolveVillageStockChance(checked.policy.availability.outOfStockChance, stockPurchaseId);
    if (stockResult.outOfStock) {
      const next = message ? await updateProposal(message, {
        status: "stale", phase: "stale", reason: "out-of-stock", stockResult
      }) : { ...proposal, status: "stale", phase: "stale", reason: "out-of-stock" };
      return {
        ok: false, error: "stale", reason: "out-of-stock", stale: true,
        stockResult, proposal: next, policy: clone(checked.policy)
      };
    }
  }
  if (PAID_ACTIONS.has(action)) {
    const storedSettlement = proposal.commerceResult && typeof proposal.commerceResult === "object"
      ? clone(proposal.commerceResult) : null;
    const reusableSettlement = storedSettlement && [
      "commerce-committed", "credit-pending", "spend-pending", "partial"
    ].includes(String(proposal.phase ?? "")) && options.reconcileSettlement !== true;
    if (reusableSettlement) {
      settlement = {
        ...storedSettlement,
        phase: existingOperation?.phase ?? storedSettlement.phase ?? proposal.phase
      };
    } else if (typeof settle !== "function" && options.commerceResult == null && options.receipt == null) {
      const next = message ? await updateProposal(message, {
        status: proposal.status === "approved" ? "approved" : proposal.status ?? "pending",
        phase: "prepared", villageOperationId: operationId, childOperationIds,
        reason: "payment-handler-pending"
      }) : { ...proposal, phase: "prepared", reason: "payment-handler-pending" };
      return {
        ok: false,
        error: "payment-handler-pending",
        reason: "commerce-seam-required",
        phase: "prepared",
        proposal: next,
        policy: clone(checked.policy)
      };
    }
    if (!reusableSettlement) {
      if (message) await updateProposal(message, {
        status: "paying", phase: "commerce-pending", villageOperationId: operationId, childOperationIds
      });
      try {
        settlement = typeof settle === "function"
          ? await settle({ proposal: clone(proposal), village: clone(checked.village), policy: clone(checked.policy),
            operationId, childOperationIds, stockResult: clone(stockResult) })
          : { ...(clone(options.commerceResult) ?? {}), receipt: clone(options.receipt) };
      } catch (error) {
        const next = message ? await updateProposal(message, {
          status: "uncertain", phase: "uncertain", reason: "commerce-uncertain",
          error: String(error?.message ?? error)
        }) : { ...proposal, status: "uncertain", phase: "uncertain" };
        return { ok: false, error: "commerce-uncertain", state: "unknown", reconciliationRequired: true, proposal: next };
      }
    }
    const returnedSettlementPhase = settlementPhase(settlement);
    if (settlement?.ok === false || settlement?.committed === false || settlement?.uncertain === true
        || (returnedSettlementPhase && returnedSettlementPhase !== "commerce-committed")) {
      const phase = returnedSettlementPhase ?? (settlement?.uncertain ? "uncertain" : "commerce-pending");
      const status = phase === "uncertain" ? "uncertain"
        : ["pending", "prepared", "commerce-pending"].includes(phase) ? "approved"
          : phase === "paying" ? "paying" : phase === "partial" ? "uncertain" : phase;
      const next = message ? await updateProposal(message, {
        status, phase, commerceTxId: settlement?.commerceTxId ?? settlement?.transactionId ?? null,
        childOperationIds: [...new Set([...childOperationIds, ...(settlement?.childOperationIds ?? [])].map(String))],
        reason: settlement?.reason ?? "commerce-refused", commerceResult: clone(settlement)
      }) : { ...proposal, status, phase };
      return { ok: false, error: settlement?.error ?? "commerce-refused", reason: settlement?.reason, phase, proposal: next, commerce: clone(settlement) };
    }
    childOperationIds.push(...(settlement?.childOperationIds ?? []).map(String));
    if (settlement?.commerceTxId ?? settlement?.transactionId) {
      childOperationIds.push(String(settlement.commerceTxId ?? settlement.transactionId));
    }
    if (message && !reusableSettlement) await updateProposal(message, {
      status: "commerce-committed", phase: "commerce-committed",
      commerceTxId: settlement?.commerceTxId ?? settlement?.transactionId ?? null,
      childOperationIds: [...new Set(childOperationIds)],
      commerceResult: clone(settlement)
    });
  }

  const villageOnly = !PAID_ACTIONS.has(action);
  const operation = await enqueueVillageOperation({
    operationId,
    action,
    villageId: checked.village.villageId,
    expectedRevision: checked.village.revision,
    originCycle: proposal.originCycle ?? checked.village.cycle,
    inputFingerprint,
    childOperationIds: [...new Set(childOperationIds)],
    execute: async ({ village }) => {
      const next = clone(village);
      const only = villageOnly ? applyVillageOnlyAction(next, proposal, {
        ...checked.policy,
        villageProsperity: village.prosperity
      }) : null;
      if (villageOnly && !only) {
        return {
          next: village,
          result: { ok: false, error: "unsupported-action", reason: "event-or-paid-owner-required", action },
          phase: "abandoned",
          terminal: true
        };
      }
      if (villageOnly && only?.ok === false) {
        return { next: village, result: only, phase: "abandoned", terminal: true };
      }
      let resultNext = next;
      const settlementCommitted = settlementPhase(settlement) == null
        || settlementPhase(settlement) === "commerce-committed";
      if (!villageOnly && typeof applyVillage === "function") {
        const applied = await applyVillage({ village: clone(next), proposal: clone(proposal), policy: clone(checked.policy),
          settlement: clone(settlement), operationId });
        resultNext = applied?.nextVillage ?? applied?.next ?? applied?.village
          ?? (Array.isArray(applied?.institutions) ? applied : next);
      } else if (!villageOnly && settlementCommitted) {
        resultNext = applyReceiptState(next, proposal, checked.policy, settlement ?? {});
      }
      const result = {
        ok: true,
        committed: settlementPhase(settlement) == null || settlementPhase(settlement) === "commerce-committed",
        action,
        proposalId: proposal.proposalId,
        villageOperationId: operationId,
        receipt: settlement?.receipt ?? settlement?.result ?? null,
        commerceTxId: settlement?.commerceTxId ?? settlement?.transactionId ?? null,
        result: clone(settlement?.result ?? null)
      };
      const phase = result.committed ? "committed" : settlementPhase(settlement);
      return { next: resultNext, result, phase, terminal: result.committed };
    }
  });

  if (!operationResultLooksCommitted(operation)) {
    const uncertain = operation?.state === "unknown" || operation?.reconciliationRequired || operation?.error === "write-failed";
    const phase = operation?.phase ?? (uncertain ? "uncertain" : villageOnly ? "pending" : "commerce-committed");
    const status = uncertain ? "uncertain" : phase === "partial" ? "uncertain" : villageOnly ? "pending" : phase;
    const next = message ? await updateProposal(message, {
      status, phase, operationResult: clone(operation),
      reason: operation?.reason ?? operation?.error
    }) : { ...proposal, status, phase: operation?.phase ?? status };
    return { ...clone(operation), ok: false, proposal: next, policy: clone(checked.policy) };
  }
  const committedResult = {
    ...clone(operation),
    ok: true,
    committed: true,
    proposalId: proposal.proposalId,
    villageOperationId: operationId
  };
  const next = message ? await updateProposal(message, {
    status: "committed", phase: "committed", committedAt: Date.now(),
    committedResult, operationResult: clone(operation), childOperationIds: [...new Set(childOperationIds)]
  }) : { ...proposal, status: "committed", phase: "committed", committedResult };
  return { ...committedResult, proposal: next, policy: clone(checked.policy) };
}

export const commitProposal = commitVillageProposal;
export const commitVillageAction = commitVillageProposal;
export const commit = commitVillageProposal;

/** Reconcile a durable Village operation without guessing whether it ran. */
export function getVillageProposalOperation(operationId, village = getVillage()) {
  return getVillageOperation(operationId, village);
}

export const inspectVillageProposalOperation = getVillageProposalOperation;
export const readVillageProposalOperation = getVillageProposalOperation;

function helperDescriptor(name) {
  return { helper: name };
}

function institutionReadModel(village, institution, actorUuid = null) {
  const browse = institutionServicePolicy(village, { action: "browse", institutionId: institution.id, actorUuid });
  const upgrade = institutionServicePolicy(village, { action: "upgrade", institutionId: institution.id, actorUuid });
  const def = INSTITUTIONS[institution.type];
  const nextLevel = Number(institution.pendingLevel ?? institution.level ?? 0) + 1;
  const terms = {
    foundingPrice: foundingPrice(institution.type),
    upgradePrice: upgradePrice(institution.type, nextLevel),
    advancement: advancementRow(institution.type, browse.effectiveLevel),
    maxPurchasableLevel: institutionPurchasableMaxLevel(institution.type),
    capstoneActive: capstoneActive(institution.type, browse.effectiveLevel, village.prosperity)
  };
  if (def?.roles?.includes("merchant")) {
    terms.salePercentage = browse.salePercentage;
    terms.availability = browse.availability;
    terms.innMaxBet = institution.type === "inn" ? innMaxBet(browse.effectiveLevel, village.prosperity) : null;
    terms.beaconRadius = institution.type === "beacon" ? beaconRadius(browse.effectiveLevel, village.prosperity) : null;
    terms.auction = institution.type === "auctionHouse" ? {
      chance: browse.availability,
      salePercentage: helperDescriptor("auctionSalePercentage"),
      priceMultiplier: helperDescriptor("auctionPriceMultiplier"),
      buybackPrice: helperDescriptor("auctionBuybackPrice")
    } : null;
  }
  if (def?.roles?.includes("artisan")) {
    terms.crafting = institution.type ? villageCraftingQuote(institution.type, browse.effectiveLevel, 0) : null;
    terms.workshop = def.workshop ? workshopRental(institution.type, browse.effectiveLevel) : null;
  }
  return {
    ...clone(institution),
    rawLevel: browse.rawLevel,
    currentLevel: browse.rawLevel,
    pendingLevel: browse.pendingLevel,
    pendingFromCycle: browse.pendingFromCycle,
    effectiveLevel: browse.effectiveLevel,
    levelState: browse.status,
    status: browse.status,
    statusReason: browse.reason ?? null,
    statuses: [...(browse.statuses ?? [])],
    readable: browse.readable === true,
    policy: browse,
    upgradePolicy: upgrade,
    terms
  };
}

/**
 * Pure read model consumed by the Village application.  It deliberately
 * exposes helper results/descriptors rather than copying institution tables.
 */
export function getVillageReadModel(options = {}) {
  const suppliedVillage = options?.village ?? (options?.institutions ? options : null);
  const village = normalizeVillage(suppliedVillage ?? getVillage());
  const actorUuid = options?.actorUuid ?? options?.payerActorUuid ?? null;
  const institutions = village.institutions.map(institution => institutionReadModel(village, institution, actorUuid));
  const merchantPolicies = institutions.filter(entry => INSTITUTIONS[entry.type]?.roles?.includes("merchant"));
  const auction = institutions.find(entry => entry.type === "auctionHouse");
  const model = {
    villageId: village.villageId,
    revision: village.revision,
    name: village.name,
    isHome: village.isHome !== false,
    canInvest: village.canInvest !== false,
    tracksCycles: village.tracksCycles !== false,
    cycle: village.cycle,
    prosperity: village.prosperity,
    institutionTypes: Object.values(INSTITUTIONS).map(definition => ({
      key: definition.key,
      label: definition.label,
      foundingPrice: definition.foundingPrice
    })),
    spentThisCycle: village.spentThisCycle,
    spendBonusAwarded: village.spendBonusAwarded,
    raisingEventThisCycle: village.raisingEventThisCycle,
    institutions,
    proposals: listVillageProposals({ villageId: village.villageId }),
    activeEffects: clone(village.activeEffects ?? []),
    eventReceipts: clone(village.eventReceipts ?? []),
    eventReceipt: clone(village.eventReceipt ?? null),
    pendingEvent: clone(village.pendingEvent),
    auctionLots: clone(village.auctionLots ?? []),
    operationJournal: clone(village.operationJournal ?? []),
    economics: {
      salePercentage: sellPercentage(village.prosperity),
      merchantCount: merchantPolicies.length,
      spendThreshold: 10000,
      spendRemaining: Math.max(0, 10000 - Math.max(0, Number(village.spentThisCycle) || 0)),
      foundVillage: foundVillageQuote(),
      itemAvailability: merchantPolicies.map(entry => ({ institutionId: entry.id, value: clone(entry.policy.availability) })),
      crafting: institutions.filter(entry => INSTITUTIONS[entry.type]?.roles?.includes("artisan"))
        .map(entry => ({ institutionId: entry.id, value: clone(entry.terms.crafting) })),
      workshopRental: institutions.filter(entry => entry.terms.workshop)
        .map(entry => ({ institutionId: entry.id, value: clone(entry.terms.workshop) })),
      innMaxBet: institutions.find(entry => entry.type === "inn")?.terms.innMaxBet ?? null,
      beacon: (() => {
        const beacon = institutions.find(entry => entry.type === "beacon");
        const radius = beacon?.terms.beaconRadius ?? null;
        return {
          radius,
          transportCost: beaconTransportCost(options.hexes ?? options.distance ?? 0)
        };
      })(),
      capstones: institutions.map(entry => ({ institutionId: entry.id, active: entry.terms.capstoneActive })),
      auction: {
        institutionId: auction?.id ?? null,
        chance: clone(auction?.terms.auction?.chance ?? null),
        salePercentage: helperDescriptor("auctionSalePercentage"),
        priceMultiplier: helperDescriptor("auctionPriceMultiplier"),
        buybackPrice: helperDescriptor("auctionBuybackPrice"),
        helpers: {
          salePercentage: helperDescriptor("auctionSalePercentage"),
          priceMultiplier: helperDescriptor("auctionPriceMultiplier"),
          buybackPrice: helperDescriptor("auctionBuybackPrice")
        }
      },
      helpers: {
        itemAvailability: helperDescriptor("itemAvailability"),
        sellPercentage: helperDescriptor("sellPercentage"),
        villageCraftingQuote: helperDescriptor("villageCraftingQuote"),
        workshopRental: helperDescriptor("workshopRental"),
        innMaxBet: helperDescriptor("innMaxBet"),
        beaconRadius: helperDescriptor("beaconRadius"),
        beaconTransportCost: helperDescriptor("beaconTransportCost"),
        foundVillageQuote: helperDescriptor("foundVillageQuote"),
        capstoneActive: helperDescriptor("capstoneActive"),
        auctionSalePercentage: helperDescriptor("auctionSalePercentage"),
        auctionPriceMultiplier: helperDescriptor("auctionPriceMultiplier"),
        auctionBuybackPrice: helperDescriptor("auctionBuybackPrice")
      }
    },
    policy: {
      labels: {
        interveningFreeLevelAbsorbsPaidTarget: true,
        noAutomaticRefund: true,
        levelZeroReopenUsesFoundingSemantics: true
      },
      homeScope: village.canInvest === false ? "foreign-read-only" : "home"
    }
  };
  return clone(model);
}

export const villageReadModel = getVillageReadModel;
export const buildVillageReadModel = getVillageReadModel;

/** Re-export the pure helper functions used by the application/read API. */
export const villageEconomics = Object.freeze({
  itemAvailability,
  sellPercentage,
  villageCraftingQuote,
  workshopRental,
  innMaxBet,
  beaconRadius,
  beaconTransportCost,
  foundVillageQuote,
  capstoneActive,
  auctionSalePercentage,
  auctionPriceMultiplier,
  auctionBuybackPrice
});

/** Public authority probe for the UI and tests; authorization remains in commit. */
export function villageCommitAuthority(user = globalThis.game?.user) {
  const result = isRefUser(user);
  return clone({
    ...result,
    designatedWriter: result.ok ? isVillageDesignatedWriter(user) : false
  });
}

// The interface module is a convenient public import for tests and future
// callers; keep the policy and pure economic helpers available here as well as
// on `module/helpers/village.mjs` and `game.crows.village`.
export {
  institutionServicePolicy,
  itemAvailability,
  sellPercentage,
  villageCraftingQuote,
  workshopRental,
  innMaxBet,
  beaconRadius,
  beaconTransportCost,
  foundVillageQuote,
  capstoneActive,
  auctionSalePercentage,
  auctionPriceMultiplier,
  auctionBuybackPrice
};
