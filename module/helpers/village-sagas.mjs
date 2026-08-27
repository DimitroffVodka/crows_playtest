/**
 * Receipt-bearing Village operations.
 *
 * Village policy and Commerce are deliberately separate concerns.  This
 * module is the small orchestration layer between them: it owns the
 * operationJournal phase transitions, while Commerce owns every physical
 * money/Item write and the event/equipment owners retain their own state.
 *
 * These are recoverable sagas, not cross-document transactions.  Foundry has
 * no compare-and-swap across a world Setting and an Actor.  A stable
 * designated-GM queue, durable child receipts, deterministic ids, and
 * same-token repair provide idempotency and reconciliation; the residual
 * GM-transition window remains explicitly uncertain.
 */

import {
  getVillage,
  saveVillage,
  institutionServicePolicy,
  institutionRecordById,
  isLiveInstitution,
  foundingPrice,
  upgradePrice,
  recordSpend,
  villageInputFingerprint,
  resolveVillageStockChance,
  auctionSalePercentage,
  auctionBuybackPrice,
  enqueueVillageOperation,
  getVillageOperation,
  getActiveVillageGM,
  isVillageDesignatedWriter
} from "./village.mjs";
import {
  pay as defaultPay,
  receive as defaultReceive,
  planReceive as defaultPlanReceive,
  readCommerceRevision
} from "./commerce.mjs";
import {
  grantItem as defaultGrantItem,
  planGrantItem as defaultPlanGrantItem,
  resolveGrantSource,
  cloneGrantItemData
} from "./item-grants.mjs";

const NONTERMINAL_PHASES = new Set([
  "prepared", "commerce-pending", "commerce-committed", "credit-pending",
  "spend-pending", "partial", "uncertain"
]);
const TERMINAL_PHASES = new Set(["committed", "abandoned", "complete", "resolved", "duplicate-detected"]);

function clone(value) {
  if (value === undefined) return undefined;
  try {
    if (typeof globalThis.foundry?.utils?.deepClone === "function") {
      return globalThis.foundry.utils.deepClone(value);
    }
  } catch { /* fall through */ }
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
  } catch { /* fall through */ }
  try { return JSON.parse(JSON.stringify(value)); } catch { return value; }
}

function id(value, fallback = "") {
  const token = String(value ?? "").trim();
  return token || fallback;
}

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? number : fallback;
}

function amount(value) {
  return Math.max(0, integer(value, 0));
}

function actorId(actor) {
  return id(actor?.uuid ?? actor?.id ?? actor?._id);
}

function itemId(item) {
  return id(item?.id ?? item?._id);
}

function actorItems(actor) {
  const items = actor?.items;
  if (Array.isArray(items)) return [...items];
  if (Array.isArray(items?.contents)) return [...items.contents];
  if (typeof items?.values === "function") {
    try { return [...items.values()]; } catch { /* fall through */ }
  }
  try { return items && typeof items[Symbol.iterator] === "function" ? [...items] : []; }
  catch { return []; }
}

function itemFor(actor, wantedId) {
  const key = id(wantedId);
  if (!key) return null;
  try {
    if (typeof actor?.items?.get === "function") return actor.items.get(key) ?? null;
  } catch { /* fall through */ }
  return actorItems(actor).find(item => itemId(item) === key) ?? null;
}

function collectionActor(uuid, collection = globalThis.game?.actors) {
  const wanted = id(uuid);
  if (!wanted) return null;
  try {
    if (typeof collection?.get === "function") {
      const direct = collection.get(wanted) ?? collection.get(wanted.split(".").pop());
      if (direct && actorId(direct) === wanted) return direct;
    }
  } catch { /* fall through */ }
  const values = Array.isArray(collection) ? collection
    : Array.isArray(collection?.contents) ? collection.contents
      : (() => {
        try {
          return collection && typeof collection[Symbol.iterator] === "function"
            ? [...collection].map(value => Array.isArray(value) ? value[1] : value) : [];
        } catch { return []; }
      })();
  return values.find(actor => actorId(actor) === wanted || id(actor?.id) === wanted) ?? null;
}

async function resolveActor(uuid, options = {}) {
  const wanted = id(uuid);
  const supplied = options.actor ?? options.payerActor ?? options.sellerActor
    ?? options.buyerActor ?? options.targetActor ?? null;
  if (supplied && (!wanted || actorId(supplied) === wanted || id(supplied.id) === wanted)) return supplied;
  const resolver = options.resolveActor ?? options.actorResolver ?? options.getActor;
  if (typeof resolver === "function") {
    try {
      const resolved = await resolver(wanted, options);
      if (resolved) return resolved;
    } catch { /* continue to the world collection */ }
  }
  const found = collectionActor(wanted);
  if (found) return found;
  if (typeof globalThis.fromUuid === "function") {
    try { return await globalThis.fromUuid(wanted); } catch { /* no actor */ }
  }
  return null;
}

function operationIds(operationId, childRoot = operationId) {
  const root = id(childRoot, id(operationId));
  return {
    payTxId: `${root}:pay`,
    receiveTxId: `${root}:receive`,
    grantTxId: `${root}:grant`,
    deleteId: `${root}:delete`,
    compensationPayTxId: `${root}:compensation`,
    creditOperationId: `${root}:credit`,
    spendOperationId: `${root}:spend`,
    serviceOperationId: `${root}:service`
  };
}

function operationChildIds(ids, action) {
  const children = [];
  if (["sell", "auction-sell"].includes(action)) {
    children.push(ids.receiveTxId, ids.deleteId, ids.compensationPayTxId);
  } else if (action === "auction-buy") {
    children.push(ids.payTxId, ids.grantTxId, ids.compensationPayTxId);
  } else if (["buy", "merchant-purchase"].includes(action)) {
    children.push(ids.payTxId, ids.grantTxId, ids.creditOperationId, ids.spendOperationId, ids.compensationPayTxId);
  } else if (["craft", "workshop", "inn", "beacon", "service"].includes(action)) {
    children.push(ids.payTxId, ids.serviceOperationId);
  } else {
    children.push(ids.payTxId);
  }
  return [...new Set(children.filter(Boolean))];
}

function actionRequest(proposal, action) {
  const requested = proposal?.requested && typeof proposal.requested === "object"
    ? clone(proposal.requested) : {};
  return {
    ...requested,
    action,
    institutionId: proposal?.institutionId ?? requested.institutionId,
    institutionType: proposal?.institutionType ?? requested.institutionType,
    actorUuid: proposal?.payerActorUuid ?? requested.actorUuid ?? requested.payerActorUuid,
    sellerActorUuid: proposal?.sellerActorUuid ?? requested.sellerActorUuid,
    buyerActorUuid: proposal?.buyerActorUuid ?? requested.buyerActorUuid,
    payerActorUuid: proposal?.payerActorUuid,
    villageOperationId: proposal?.villageOperationId ?? proposal?.operationId ?? requested.villageOperationId,
    operationId: proposal?.operationId ?? proposal?.villageOperationId ?? requested.operationId,
    itemKey: proposal?.itemKey ?? requested.itemKey,
    itemId: proposal?.itemId ?? requested.itemId,
    saleId: proposal?.saleId ?? requested.saleId,
    auctionId: proposal?.auctionId ?? requested.auctionId,
    buybackPrice: proposal?.buybackPrice ?? requested.buybackPrice,
    itemPrice: proposal?.itemPrice ?? proposal?.grossPrice ?? requested.itemPrice ?? requested.price,
    grossPrice: proposal?.grossPrice ?? requested.grossPrice ?? requested.itemPrice ?? requested.price,
    itemValue: proposal?.itemValue ?? requested.itemValue ?? requested.value,
    targetLevel: proposal?.targetLevel ?? requested.targetLevel ?? requested.target,
    target: proposal?.targetLevel ?? requested.targetLevel ?? requested.target,
    soldFor: proposal?.soldFor ?? requested.soldFor,
    bet: proposal?.bet ?? requested.bet,
    hexes: proposal?.hexes ?? requested.hexes ?? requested.distance,
    distance: proposal?.distance ?? requested.distance ?? requested.hexes,
    rush: proposal?.rush ?? requested.rush,
    criteria: proposal?.criteria ?? requested.criteria,
    itemCriteria: proposal?.itemCriteria ?? requested.itemCriteria,
    uses: proposal?.uses ?? requested.uses,
    expertise: proposal?.expertise ?? requested.expertise,
    rank: proposal?.rank ?? requested.rank,
    quality: proposal?.quality ?? requested.quality,
    power: proposal?.power ?? requested.power,
    kind: proposal?.kind ?? requested.kind
  };
}

function policyFingerprint(policy) {
  if (!policy) return "null";
  return villageInputFingerprint({
    action: policy.action,
    villageId: policy.villageId,
    institutionId: policy.institutionId,
    institutionType: policy.institutionType,
    rawLevel: policy.rawLevel,
    pendingLevel: policy.pendingLevel,
    effectiveLevel: policy.effectiveLevel,
    status: policy.status,
    reason: policy.reason,
    quote: policy.quote,
    availability: policy.availability,
    creditToConsume: policy.creditToConsume,
    salePercentage: policy.salePercentage,
    craftingTerms: policy.craftingTerms,
    workshopTerms: policy.workshopTerms
  });
}

function resultPhase(result) {
  const phase = String(result?.phase ?? result?.receipt?.phase ?? result?.state ?? "").trim();
  if (phase === "committed" || phase === "complete" || phase === "resolved") return "committed";
  if (phase === "prepared" || phase === "pending" || phase === "paying" || phase === "commerce-pending") {
    return "commerce-pending";
  }
  if (["commerce-committed", "credit-pending", "spend-pending", "partial", "uncertain"].includes(phase)) {
    return phase;
  }
  if (result?.uncertain === true || result?.state === "unknown" || result?.reconciliationRequired) return "uncertain";
  return result?.ok === false ? "refused" : "committed";
}

function childCommitted(result) {
  if (!result || result.ok === false) return false;
  return !["prepared", "pending", "commerce-pending", "commerce-committed",
    "credit-pending", "spend-pending", "uncertain", "partial", "blocked"]
    .includes(resultPhase(result)) && result.state !== "unknown" && !result.reconciliationRequired;
}

function childUncertain(result) {
  if (!result) return true;
  return result.state === "unknown" || result.reconciliationRequired === true
    || ["uncertain", "prepared", "pending", "commerce-pending", "commerce-committed",
      "credit-pending", "spend-pending", "partial"].includes(resultPhase(result))
    || ["write-failed", "timeout", "unknown"].includes(String(result.error ?? ""));
}

function commerceCommitted(result) {
  if (!result) return false;
  const phase = resultPhase(result);
  return (phase === "committed" || phase === "commerce-committed")
    && result?.ok !== false && result?.state !== "unknown" && !result?.reconciliationRequired;
}

function commerceFailurePhase(result) {
  // Commerce can durably debit before a GM handover loses the acknowledgement.
  // Treat the outcome's own uncertainty marker as authoritative before looking
  // at the error allow-list; an error name alone must never make a proven or
  // potentially-proven debit terminal and unreconcilable.
  if (result?.reconciliationRequired === true || result?.state === "unknown"
    || result?.uncertain === true) return "uncertain";
  const phase = resultPhase(result);
  if (phase !== "refused") return phase;
  if (childUncertain(result)) return "uncertain";
  if (["duplicate", "duplicate-detected"].includes(String(result?.error ?? ""))) {
    // A child token that already belongs to a different input cannot be
    // safely replayed or silently abandoned.  Preserve it as an uncertain
    // Village operation for Ref adjudication, even though Commerce proved no
    // new debit in this call.
    return "uncertain";
  }
  // A known refusal that did not mutate money can remain repairable under the
  // same Village token.  In particular, a stale Actor revision, a temporary
  // authority handover, or a full receive destination must not turn the
  // operation into a terminal receipt that prevents the required retry.
  if (["insufficient-funds", "conflict", "authority-unavailable", "no-capacity", "overflow"].includes(String(result?.error ?? ""))) {
    return "commerce-pending";
  }
  return "abandoned";
}

function operationEntry(village, operationId) {
  return (village?.operationJournal ?? []).find(entry => id(entry?.operationId) === id(operationId)) ?? null;
}

function setAuctionLotStatus(village, auctionId, status, extra = {}) {
  const next = clone(village);
  const lot = (next.auctionLots ?? []).find(candidate => id(candidate.auctionId) === id(auctionId));
  if (lot) Object.assign(lot, { status, ...clone(extra) });
  return next;
}

function journalEntry({ village, operationId, action, originCycle, expectedRevision,
  inputFingerprint, phase, childOperationIds, result, metadata = {}, previous = null }) {
  const now = Date.now();
  return {
    ...(previous ? clone(previous) : {}),
    operationId,
    action,
    villageId: village.villageId,
    originCycle,
    expectedRevision,
    inputFingerprint,
    phase,
    childOperationIds: [...new Set((childOperationIds ?? []).map(String).filter(Boolean))],
    ...clone(metadata),
    result: clone(result),
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    resultingRevision: village.revision + 1,
    writerUserId: globalThis.game?.user?.id ?? null
  };
}

function withJournal(village, entry) {
  const next = clone(village);
  next.operationJournal = [
    ...(next.operationJournal ?? []).filter(candidate => id(candidate?.operationId) !== id(entry.operationId)),
    clone(entry)
  ];
  return next;
}

async function persistPhase(village, params = {}) {
  const entry = journalEntry({ village, ...params });
  const next = withJournal(village, entry);
  try {
    const saved = await saveVillage(next, {
      prev: village,
      operationId: params.operationId,
      action: params.action
    });
    return { ok: true, village: saved, entry: operationEntry(saved, params.operationId) ?? entry };
  } catch (error) {
    return {
      ok: false,
      error: "write-failed",
      state: "unknown",
      reconciliationRequired: true,
      reason: "village-phase-write-failed",
      operationId: params.operationId,
      message: String(error?.message ?? error)
    };
  }
}

function failure(error, extra = {}) {
  return { ok: false, error, ...clone(extra) };
}

function commerceFunction(options, operation) {
  const provided = operation === "pay"
    ? options.pay ?? options.commerce?.pay
    : options.receive ?? options.commerce?.receive;
  if (typeof provided === "function") return provided;
  if (typeof globalThis.game?.crows?.commerce?.[operation] === "function") {
    return globalThis.game.crows.commerce[operation].bind(globalThis.game.crows.commerce);
  }
  return operation === "pay" ? defaultPay : defaultReceive;
}

function grantFunction(options) {
  if (typeof options.grantItem === "function") return options.grantItem;
  if (typeof options.commerce?.grantItem === "function") return options.commerce.grantItem.bind(options.commerce);
  if (typeof globalThis.game?.crows?.commerce?.grantItem === "function") {
    return globalThis.game.crows.commerce.grantItem.bind(globalThis.game.crows.commerce);
  }
  if (typeof globalThis.game?.crows?.grantItem === "function") return globalThis.game.crows.grantItem;
  return defaultGrantItem;
}

function grantPlanner(options) {
  if (typeof options.preflightGrant === "function") return options.preflightGrant;
  if (typeof options.commerce?.preflightGrant === "function") return options.commerce.preflightGrant.bind(options.commerce);
  if (typeof globalThis.game?.crows?.commerce?.preflightGrant === "function") {
    return globalThis.game.crows.commerce.preflightGrant.bind(globalThis.game.crows.commerce);
  }
  return defaultPlanGrantItem;
}

function commerceRevision(actor, options = {}) {
  const explicit = options.expectedCommerceRevision ?? options.commerceRevision
    ?? options.expectedPayerRevision;
  if (explicit != null && Number.isInteger(Number(explicit))) return Number(explicit);
  try { return readCommerceRevision(actor); } catch { return 0; }
}

function commerceContext({ kind, txId, actor, operationId, originCycle, expectedRevision, options = {}, extra = {} }) {
  return {
    kind,
    txId,
    expectedRevision,
    actorUuid: actorId(actor),
    operationId,
    villageOperationId: operationId,
    originCycle,
    requester: options.user ?? globalThis.game?.user,
    ...clone(extra)
  };
}

function commerceKind(action) {
  if (action === "craft") return "artisan-commission";
  if (action === "service") return "merchant";
  return action;
}

async function callCommerce(operation, actor, value, context, options = {}) {
  const fn = commerceFunction(options, operation);
  if (typeof fn !== "function") return failure("commerce-unavailable", { phase: "commerce-pending" });
  try {
    const result = await fn(actor, amount(value), context);
    return result && typeof result === "object" ? clone(result) : { ok: Boolean(result), phase: result ? "committed" : "commerce-pending" };
  } catch (error) {
    return failure("write-failed", {
      phase: "uncertain", state: "unknown", reconciliationRequired: true,
      message: String(error?.message ?? error)
    });
  }
}

function sourceFrom(proposal, options = {}) {
  return options.source ?? options.item ?? options.itemData ?? options.requestedItem
    ?? proposal?.source ?? proposal?.item ?? proposal?.requestedItem
    ?? proposal?.requested?.source ?? proposal?.requested?.item ?? null;
}

async function resolveSource(source, options = {}) {
  if (source == null) return null;
  const resolver = options.resolveGrantSource ?? options.resolveItemSource;
  if (typeof resolver === "function") {
    try { return await resolver(source, options); } catch { return null; }
  }
  try { return await resolveGrantSource(source, options); } catch { return source; }
}

async function preflightGrant(actor, source, ids, operationId, originCycle, options = {}) {
  if (!actor || source == null) return failure("invalid-source", { reason: "grant-target-or-source-required" });
  const planner = grantPlanner(options);
  if (typeof planner !== "function") return { ok: true, assumed: true };
  try {
    const result = await planner(actor, source, {
      txId: ids.grantTxId,
      grantId: ids.grantTxId,
      operationId: ids.grantTxId,
      expectedRevision: commerceRevision(actor, options),
      originCycle,
      villageOperationId: operationId,
      source,
      placement: options.placement,
      allocation: options.allocation,
      stacking: options.stacking,
      user: options.user ?? globalThis.game?.user
    });
    if (result === false) return failure("no-capacity");
    if (result && typeof result === "object") return clone(result);
    return { ok: true, phase: "preflight" };
  } catch (error) {
    return failure("no-capacity", { reason: String(error?.message ?? error) });
  }
}

async function preflightReceive(actor, value, operationId, originCycle, options = {}) {
  const planner = options.preflightReceive ?? options.planReceive
    ?? options.commerce?.planReceive ?? defaultPlanReceive;
  if (typeof planner !== "function") return { ok: true, assumed: true };
  const context = commerceContext({
    kind: "merchant", txId: `${id(operationId)}:receive-preflight`, actor,
    operationId, originCycle, expectedRevision: commerceRevision(actor, options), options,
    extra: { sale: true, preflight: true }
  });
  try {
    // Commerce's native pure planReceive accepts (actor, amount, snapshot),
    // while an injected adapter may prefer the same context shape as receive.
    const result = planner === defaultPlanReceive
      ? await planner(actor, amount(value)) : await planner(actor, amount(value), context);
    if (result === false) return failure("no-capacity");
    if (result && typeof result === "object") return clone(result);
    return { ok: result !== false, phase: "preflight" };
  } catch (error) {
    return failure("no-capacity", { reason: String(error?.message ?? error) });
  }
}

function grantContext(actor, source, ids, operationId, originCycle, options = {}) {
  return {
    txId: ids.grantTxId,
    grantId: ids.grantTxId,
    operationId: ids.grantTxId,
    expectedRevision: commerceRevision(actor, options),
    actorUuid: actorId(actor),
    source,
    item: source,
    originCycle,
    villageOperationId: operationId,
    kind: "grant",
    placement: options.placement,
    allocation: options.allocation,
    stacking: options.stacking,
    user: options.user ?? globalThis.game?.user
  };
}

function itemSnapshot(item) {
  const grantData = cloneGrantItemData(item);
  if (grantData) return grantData;
  let value = item;
  try {
    if (typeof item?.toObject === "function") value = item.toObject(false);
    else if (typeof item?.toJSON === "function") value = item.toJSON();
  } catch { value = item; }
  const snapshot = clone(value) ?? {};
  // The source embedded id and its old placement are not valid on the buyer.
  delete snapshot._id;
  delete snapshot.id;
  if (snapshot.system && typeof snapshot.system === "object") {
    snapshot.system = clone(snapshot.system);
    delete snapshot.system.location;
  }
  return snapshot;
}

function itemValueOf(item, proposal, options = {}) {
  return amount(options.itemValue ?? proposal?.itemValue ?? proposal?.requested?.itemValue
    ?? proposal?.requested?.value ?? item?.system?.value ?? item?.system?.price ?? item?.value);
}

function paymentAmount(action, proposal, policy, entry = null, options = {}) {
  if (entry?.netPrice != null && ["buy", "merchant-purchase"].includes(action)) return amount(entry.netPrice);
  if (entry?.price != null) return amount(entry.price);
  const quote = policy?.quote ?? proposal?.quote ?? {};
  if (["found", "reopen"].includes(action)) return amount(quote.price ?? foundingPrice(policy?.institutionType ?? proposal?.institutionType));
  if (action === "upgrade") return amount(quote.price ?? upgradePrice(policy?.institutionType ?? proposal?.institutionType, policy?.targetLevel));
  if (["craft", "workshop", "inn", "beacon", "service"].includes(action)) {
    if (action === "craft") return amount(quote.cost ?? options.cost ?? proposal?.cost);
    if (action === "workshop") return amount(quote.pricePerDay ?? options.pricePerDay ?? proposal?.pricePerDay);
    if (action === "inn") return amount(options.bet ?? proposal?.bet ?? proposal?.requested?.bet ?? quote.bet);
    if (action === "beacon") return amount(quote.fare ?? options.fare ?? proposal?.fare);
    return amount(options.price ?? proposal?.price ?? quote.price ?? quote.cost);
  }
  if (action === "auction-buy") return amount(quote.buybackPrice ?? proposal?.buybackPrice ?? options.buybackPrice);
  return amount(quote.price ?? proposal?.price ?? options.price);
}

function localFoundingMutation(next, proposal, policy, operationId, originCycle) {
  const type = policy?.institutionType ?? proposal?.institutionType;
  const index = (next.institutions ?? []).findIndex(institution => institution.type === type);
  const existing = index < 0 ? null : next.institutions[index];
  if (existing && isLiveInstitution(existing) && Number(existing.level) > 0) {
    return failure("institution-exists", { institution: clone(existing) });
  }
  const source = proposal?.requested && typeof proposal.requested === "object" ? proposal.requested : {};
  const record = {
    ...(existing ? clone(existing) : {}),
    id: existing?.id ?? `inst-${operationId}`,
    type,
    name: String(proposal?.name ?? source.name ?? existing?.name ?? policy?.institutionType ?? type),
    steward: String(proposal?.steward ?? source.steward ?? existing?.steward ?? ""),
    level: 1,
    foundedOnCycle: originCycle,
    operatingFromCycle: originCycle + 1,
    opensAfterCycle: originCycle,
    pendingLevel: null,
    pendingFromCycle: null,
    pendingOperationId: null,
    pendingOperation: null,
    operationId: null,
    destroyed: false,
    destroyedOnCycle: null,
    destruction: null,
    destructionMetadata: null,
    foundingOperationId: operationId,
    foundedBy: "pc-or-party"
  };
  if (existing) next.institutions[index] = record;
  else next.institutions.push(record);
  next.prosperity = Math.max(-10, Math.min(10, integer(next.prosperity, 0) + 1));
  next.raisingEventThisCycle = true;
  next.activeEffects = (next.activeEffects ?? []).filter(effect => effect.kind !== "boycott");
  return { ok: true, institution: record, prosperity: next.prosperity };
}

function localUpgradeMutation(next, proposal, policy, operationId, originCycle) {
  const institution = institutionRecordById(proposal?.institutionId ?? policy?.institutionId, next);
  if (!institution) return failure("institution-not-found");
  if (!isLiveInstitution(institution)) return failure("institution-destroyed", { institution: clone(institution) });
  const target = integer(policy?.targetLevel ?? proposal?.targetLevel ?? proposal?.requested?.targetLevel, 0);
  if (target <= 0) return failure("invalid-upgrade-target");
  if (institution.pendingOperationId === operationId && Number(institution.pendingLevel) === target) {
    return { ok: true, institution, prosperity: next.prosperity, replayed: true };
  }
  institution.pendingLevel = target;
  institution.pendingFromCycle = originCycle + 1;
  institution.opensAfterCycle = originCycle;
  institution.pendingOperationId = operationId;
  institution.pendingOperation = operationId;
  next.prosperity = Math.max(-10, Math.min(10, integer(next.prosperity, 0) + 1));
  next.raisingEventThisCycle = true;
  return { ok: true, institution, prosperity: next.prosperity };
}

function localCreditMatches(effect, credit) {
  if (!effect || effect.kind !== "credit") return false;
  if (credit?.creditId && id(effect.creditId) !== id(credit.creditId)) return false;
  if (credit?.institutionId && id(effect.institutionId ?? effect.target) !== id(credit.institutionId)) return false;
  if (credit?.beneficiaryActorUuid && id(effect.beneficiaryActorUuid ?? effect.beneficiary ?? effect.actorUuid)
      !== id(credit.beneficiaryActorUuid)) return false;
  return true;
}

function decrementCreditObject(effect, value, actorUuid) {
  const current = amount(effect.amountRemaining ?? effect.remainingAmount ?? effect.remaining ?? effect.amount ?? effect.value);
  const nextAmount = Math.max(0, current - amount(value));
  if (effect.amountRemaining != null) effect.amountRemaining = nextAmount;
  if (effect.remainingAmount != null) effect.remainingAmount = nextAmount;
  if (effect.remaining != null) effect.remaining = nextAmount;
  if (effect.amount != null) effect.amount = nextAmount;
  if (effect.value != null && effect.perPC == null) effect.value = nextAmount;
  if (effect.remainingByActor && actorUuid) effect.remainingByActor[actorUuid] = nextAmount;
  if (effect.amountByActor && actorUuid) effect.amountByActor[actorUuid] = nextAmount;
  return nextAmount;
}

function consumeCreditLocally(next, credit, value) {
  if (!credit || amount(value) <= 0) return { ok: true, consumed: 0, remaining: credit?.remainingAmount ?? 0 };
  let changed = false;
  let remaining = null;
  for (const effect of next.activeEffects ?? []) {
    if (!localCreditMatches(effect, credit)) continue;
    remaining = decrementCreditObject(effect, value, credit.beneficiaryActorUuid);
    changed = true;
  }
  // `eventReceipts` is immutable audit evidence.  The resolver projects a
  // credit into `activeEffects`; mutating the normalized receipt as well would
  // decrement the same allowance twice and rewrite the event's historical
  // amount.  If the live projection is absent, the safe result is an
  // uncertain repair rather than inventing a new mutable source from history.
  if (!changed) return failure("credit-not-found", { creditId: credit.creditId, state: "unknown", reconciliationRequired: true });
  return { ok: true, consumed: amount(value), remaining: remaining ?? 0 };
}

function creditReservation(village, creditId, operationId) {
  return (village?.operationJournal ?? []).filter(entry => NONTERMINAL_PHASES.has(String(entry?.phase ?? ""))
    && id(entry.operationId) !== id(operationId) && id(entry.creditReservation?.creditId) === id(creditId))
    .reduce((sum, entry) => sum + amount(entry.creditReservation?.amount), 0);
}

function creditWithReservation(policy, village, operationId) {
  const credit = policy?.creditToConsume;
  if (!credit) return null;
  const reserved = creditReservation(village, credit.creditId, operationId);
  const available = Math.max(0, amount(credit.remainingAmount) - reserved);
  return { ...clone(credit), remainingAmount: available, amountRemaining: available, amount: available };
}

function freshPolicy(village, proposal, action, operationId) {
  const policy = institutionServicePolicy(village, actionRequest(proposal, action));
  if (!policy || policy.ok !== true) return policy;
  if (["buy", "merchant-purchase"].includes(action)) {
    policy.creditToConsume = creditWithReservation(policy, village, operationId);
    if (policy.quote) {
      const gross = amount(proposal?.grossPrice ?? policy.quote.grossPrice ?? policy.quote.netPrice ?? policy.quote.price);
      const credit = amount(policy.creditToConsume?.remainingAmount);
      policy.quote = { ...policy.quote, grossPrice: gross, creditApplied: Math.min(gross, credit), netPrice: Math.max(0, gross - credit) };
    }
  }
  return policy;
}

function adapterFor(action, options = {}) {
  const direct = options.serviceAdapter ?? options.onService ?? options.service
    ?? options.equipmentAdapter ?? options.equipment?.[action]
    ?? options.crafting?.[action] ?? options.transport ?? options.settleInn;
  if (typeof direct === "function") return direct;
  if (direct && typeof direct[action] === "function") return direct[action].bind(direct);
  if (typeof globalThis.game?.crows?.crafting?.[action] === "function") return globalThis.game.crows.crafting[action].bind(globalThis.game.crows.crafting);
  return null;
}

async function callService(action, payload, options = {}) {
  const adapter = adapterFor(action, options);
  if (!adapter) return failure("service-adapter-required", { phase: "commerce-committed" });
  try {
    const result = await adapter(clone(payload));
    if (result === false) return failure("service-refused", { phase: "partial" });
    return result && typeof result === "object" ? clone(result) : { ok: true, phase: "committed" };
  } catch (error) {
    return failure("service-write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) });
  }
}

async function callDelete(actor, item, metadata, options = {}) {
  const fn = options.deleteItem ?? options.deleteEmbeddedItem ?? options.executeDeleteItem;
  try {
    if (typeof fn === "function") {
      const result = await fn(actor, item, clone(metadata));
      return result && typeof result === "object" ? clone(result) : { ok: result !== false, phase: result === false ? "blocked" : "committed" };
    }
    if (typeof actor?.deleteEmbeddedDocuments !== "function") return failure("delete-unavailable", { phase: "uncertain", state: "unknown" });
    await actor.deleteEmbeddedDocuments("Item", [itemId(item)]);
    return { ok: true, phase: "committed", deleteId: metadata.deleteId };
  } catch (error) {
    return failure("write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) });
  }
}

function operationResult({ operationId, action, phase, result, entry = null, village = null, extra = {} }) {
  return {
    operationId,
    villageOperationId: operationId,
    action,
    phase,
    ...clone(result),
    operation: entry ? clone(entry) : undefined,
    childOperationIds: clone(entry?.childOperationIds ?? result?.childOperationIds ?? []),
    commerceTxId: result?.commerceTxId ?? entry?.commerceTxId ?? entry?.receiveTxId
      ?? entry?.payTxId ?? undefined,
    villageRevision: village?.revision,
    ...clone(extra)
  };
}

function operationMetadata({ proposal, policy, ids, operationId, originCycle, grossPrice = null,
  netPrice = null, creditApplied = 0, extra = {} }) {
  return {
    policyFingerprint: policyFingerprint(policy),
    quoteFingerprint: proposal?.quoteFingerprint ?? null,
    availabilityFingerprint: proposal?.availabilityFingerprint ?? null,
    commerceTxId: ["sell", "auction-sell"].includes(proposal?.action)
      ? ids.receiveTxId : ids.payTxId,
    childOperationIds: operationChildIds(ids, proposal?.action),
    originCycle,
    opensAfterCycle: originCycle,
    grossPrice,
    netPrice,
    creditApplied,
    ...clone(extra)
  };
}

async function persistFailure(village, params, result, phase) {
  const written = await persistPhase(village, { ...params, phase, result });
  if (written.ok) return operationResult({ ...params, phase, result, entry: written.entry, village: written.village });
  return operationResult({ ...params, phase: "uncertain", result: { ...clone(result), ok: false, error: "write-failed", state: "unknown", reconciliationRequired: true }, village, extra: written });
}

async function runInstitutionSaga({ village, proposal, policy, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options }) {
  const actor = await resolveActor(proposal?.payerActorUuid, options);
  if (!actor) return failure("payer-not-found", { phase: entry?.phase ?? "prepared", operationId });
  const price = paymentAmount(action, proposal, policy, entry, options);
  const metadata = operationMetadata({ proposal, policy, ids, operationId, originCycle, extra: { price, payerActorUuid: actorId(actor) } });
  let current = village;
  let currentEntry = entry;
  if (!currentEntry) {
    const prepared = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "prepared", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "prepared", operationId, action }
    });
    if (!prepared.ok) return prepared;
    current = prepared.village;
    currentEntry = prepared.entry;
  }
  if (!commerceCommitted(currentEntry?.commerceResult)) {
    const pending = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-pending", childOperationIds: operationChildIds(ids, action), metadata: { ...metadata },
      result: { ok: false, phase: "commerce-pending", operationId, action }, previous: currentEntry
    });
    if (!pending.ok) return pending;
    current = pending.village;
    currentEntry = pending.entry;
    const commerceResult = options.commerceResult && !currentEntry.commerceResult
      ? clone(options.commerceResult)
      : await callCommerce("pay", actor, price, commerceContext({
        kind: action === "upgrade" || ["found", "reopen"].includes(action) ? "institution-funding" : action,
        txId: ids.payTxId, actor, operationId, originCycle,
        expectedRevision: commerceRevision(actor, options), options,
        extra: { villageId: current.villageId, villageRevision: current.revision }
      }), options);
    if (!commerceCommitted(commerceResult)) {
      const terminalPhase = commerceFailurePhase(commerceResult);
      const persisted = await persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, commerceResult }, previous: currentEntry
      }, { ...commerceResult, operationId }, terminalPhase);
      return persisted;
    }
    const committed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, commerceResult, commerceReceipt: commerceResult.receipt ?? null },
      result: { ok: false, phase: "commerce-committed", operationId, action, commerce: commerceResult }, previous: currentEntry
    });
    if (!committed.ok) return committed;
    current = committed.village;
    currentEntry = committed.entry;
  }

  const next = clone(current);
  const local = action === "upgrade"
    ? localUpgradeMutation(next, proposal, policy, operationId, originCycle)
    : localFoundingMutation(next, proposal, policy, operationId, originCycle);
  if (!local.ok) return persistFailure(current, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    childOperationIds: operationChildIds(ids, action), metadata: { ...metadata }, previous: currentEntry
  }, local, "uncertain");
  const result = {
    ok: true, committed: true, phase: "committed", operationId, action,
    institution: clone(local.institution), prosperity: next.prosperity,
    price, originCycle, opensAfterCycle: originCycle,
    operatingFromCycle: local.institution.operatingFromCycle,
    commerce: clone(currentEntry?.commerceResult ?? null), commerceTxId: ids.payTxId
  };
  const final = await persistPhase(next, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    phase: "committed", childOperationIds: operationChildIds(ids, action),
    metadata: { ...metadata, commerceResult: currentEntry?.commerceResult ?? null }, result, previous: currentEntry
  });
  if (!final.ok) return final;
  return operationResult({ operationId, action, phase: "committed", result, entry: final.entry, village: final.village });
}

async function runServiceSaga({ village, proposal, policy, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options }) {
  const actor = await resolveActor(proposal?.payerActorUuid, options);
  if (!actor) return failure("payer-not-found", { phase: entry?.phase ?? "prepared", operationId });
  const price = paymentAmount(action, proposal, policy, entry, options);
  const metadata = operationMetadata({ proposal, policy, ids, operationId, originCycle, extra: { price, payerActorUuid: actorId(actor) } });
  let current = village;
  let currentEntry = entry;
  if (!currentEntry) {
    const prepared = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "prepared", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "prepared", operationId, action }
    });
    if (!prepared.ok) return prepared;
    current = prepared.village;
    currentEntry = prepared.entry;
  }
  if (!commerceCommitted(currentEntry?.commerceResult)) {
    const pending = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-pending", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "commerce-pending", operationId, action }, previous: currentEntry
    });
    if (!pending.ok) return pending;
    current = pending.village;
    currentEntry = pending.entry;
    const commerceResult = options.commerceResult && !currentEntry.commerceResult
      ? clone(options.commerceResult)
      : await callCommerce("pay", actor, price, commerceContext({
        kind: commerceKind(action), txId: ids.payTxId, actor, operationId, originCycle,
        expectedRevision: commerceRevision(actor, options), options
      }), options);
    if (!commerceCommitted(commerceResult)) {
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, commerceResult }, previous: currentEntry
      }, { ...commerceResult, operationId }, commerceFailurePhase(commerceResult));
    }
    const committed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, commerceResult, commerceReceipt: commerceResult.receipt ?? null },
      result: { ok: false, phase: "commerce-committed", operationId, action, commerce: commerceResult }, previous: currentEntry
    });
    if (!committed.ok) return committed;
    current = committed.village;
    currentEntry = committed.entry;
  }
  if (currentEntry?.serviceResult && childCommitted(currentEntry.serviceResult)) {
    const result = currentEntry.result ?? { ok: true, phase: "committed", operationId, action };
    const replay = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "committed", childOperationIds: operationChildIds(ids, action), metadata: { ...metadata }, result,
      previous: currentEntry
    });
    if (!replay.ok) return replay;
    return operationResult({ operationId, action, phase: "committed", result, entry: replay.entry, village: replay.village, extra: { replayed: true } });
  }
  const service = await callService(action, {
    action, operationId, originCycle, proposal: clone(proposal), policy: clone(policy),
    payment: clone(currentEntry?.commerceResult), commerceTxId: ids.payTxId,
    terms: clone(policy?.craftingTerms ?? policy?.workshopTerms ?? policy?.quote),
    amount: price
  }, options);
  const phase = resultPhase(service);
  if (phase !== "committed") {
    return persistFailure(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, serviceResult: service }, previous: currentEntry
    }, { ...service, operationId }, phase === "refused" ? "partial" : phase);
  }
  const result = {
    ok: true, committed: true, phase: "committed", operationId, action,
    price, originCycle, service: clone(service), commerce: clone(currentEntry?.commerceResult), commerceTxId: ids.payTxId
  };
  const final = await persistPhase(current, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    phase: "committed", childOperationIds: operationChildIds(ids, action),
    metadata: { ...metadata, serviceResult: service, commerceResult: currentEntry?.commerceResult ?? null }, result,
    previous: currentEntry
  });
  if (!final.ok) return final;
  return operationResult({ operationId, action, phase: "committed", result, entry: final.entry, village: final.village });
}

async function runPurchaseSaga({ village, proposal, policy, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options }) {
  const stockChance = policy?.availability?.outOfStockChance;
  let stockResult = entry?.stockResult ?? null;
  if (stockChance && !entry?.stockResult) {
    const purchaseId = id(proposal?.purchaseId, `${operationId}:stock`);
    stockResult = resolveVillageStockChance(stockChance, purchaseId);
    if (!stockResult.ok) return failure("invalid-request", { reason: stockResult.reason, operationId });
    if (stockResult.outOfStock) {
      return persistFailure(village, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action),
        metadata: { stockResult }, previous: entry
      }, { ok: false, error: "out-of-stock", operationId, stockResult }, "abandoned");
    }
  }
  const actor = await resolveActor(proposal?.payerActorUuid, options);
  if (!actor) return failure("payer-not-found", { phase: entry?.phase ?? "prepared", operationId });
  let source = sourceFrom(proposal, options);
  source = await resolveSource(source, options);
  if (!source) return failure("invalid-source", { phase: entry?.phase ?? "prepared", operationId });
  const grossPrice = amount(entry?.grossPrice ?? proposal?.grossPrice ?? policy?.quote?.grossPrice
    ?? proposal?.requested?.itemPrice ?? proposal?.requested?.price);
  const credit = entry?.creditReservation
    ? { ...clone(policy?.creditToConsume ?? {}), ...clone(entry.creditReservation), remainingAmount: amount(entry.creditReservation.amountAvailable) }
    : creditWithReservation(policy, village, operationId);
  const creditApplied = amount(entry?.creditApplied ?? Math.min(grossPrice, credit?.remainingAmount ?? 0));
  const netPrice = amount(entry?.netPrice ?? grossPrice - creditApplied);
  const metadata = operationMetadata({ proposal, policy, ids, operationId, originCycle,
    grossPrice, netPrice, creditApplied,
    extra: { payerActorUuid: actorId(actor), sourceSnapshot: cloneGrantItemData(source), itemKey: proposal?.itemKey ?? null, stockResult } });
  let current = village;
  let currentEntry = entry;
  if (!currentEntry) {
    const preflight = await preflightGrant(actor, source, ids, operationId, originCycle, options);
    if (preflight?.ok === false) return failure(preflight.error ?? "no-capacity", { ...preflight, phase: "abandoned", operationId });
    const prepared = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "prepared", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, creditReservation: credit ? {
        creditId: credit.creditId, amount: creditApplied,
        amountAvailable: amount(credit.remainingAmount), beneficiaryActorUuid: credit.beneficiaryActorUuid,
        institutionId: credit.grantingInstitutionId ?? credit.institutionId,
        creditOperationId: ids.creditOperationId
      } : null },
      result: { ok: false, phase: "prepared", operationId, action, grossPrice, netPrice, creditApplied }
    });
    if (!prepared.ok) return prepared;
    current = prepared.village;
    currentEntry = prepared.entry;
  }
  if (!commerceCommitted(currentEntry?.commerceResult)) {
    const pending = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-pending", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "commerce-pending", operationId, action, grossPrice, netPrice, creditApplied }, previous: currentEntry
    });
    if (!pending.ok) return pending;
    current = pending.village;
    currentEntry = pending.entry;
    const commerceResult = options.commerceResult && !currentEntry.commerceResult
      ? clone(options.commerceResult)
      : await callCommerce("pay", actor, netPrice, commerceContext({
        kind: "purchase", txId: ids.payTxId, actor, operationId, originCycle,
        expectedRevision: commerceRevision(actor, options), options,
        extra: { grossPrice, creditApplied, netPrice }
      }), options);
    if (!commerceCommitted(commerceResult)) {
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, commerceResult }, previous: currentEntry
      }, { ...commerceResult, operationId, grossPrice, netPrice, creditApplied }, commerceFailurePhase(commerceResult));
    }
    const committed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, commerceResult, commerceReceipt: commerceResult.receipt ?? null },
      result: { ok: false, phase: "commerce-committed", operationId, action, commerce: commerceResult, grossPrice, netPrice, creditApplied }, previous: currentEntry
    });
    if (!committed.ok) return committed;
    current = committed.village;
    currentEntry = committed.entry;
  }

  let grantResult = currentEntry?.grantResult ?? null;
  if (!grantResult || !childCommitted(grantResult)) {
    const grant = grantFunction(options);
    try {
      grantResult = await grant(actor, source, grantContext(actor, source, ids, operationId, originCycle, options));
    } catch (error) {
      grantResult = failure("write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) });
    }
    grantResult = clone(grantResult ?? failure("write-failed", { phase: "uncertain", state: "unknown" }));
    if (!childCommitted(grantResult)) {
      if (childUncertain(grantResult)) {
        return persistFailure(current, {
          operationId, action, originCycle, expectedRevision, inputFingerprint,
          childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, grantResult }, previous: currentEntry
        }, { ...grantResult, operationId, grossPrice, netPrice, creditApplied }, "uncertain");
      }
      let compensation = { ok: true, phase: "committed", amount: 0 };
      if (netPrice > 0) {
        compensation = await callCommerce("receive", actor, netPrice, commerceContext({
          kind: "purchase", txId: ids.compensationPayTxId, actor, operationId, originCycle,
          expectedRevision: commerceRevision(actor, options), options,
          extra: { compensation: true, failedChild: ids.grantTxId }
        }), options);
      }
      if (!commerceCommitted(compensation)) {
        return persistFailure(current, {
          operationId, action, originCycle, expectedRevision, inputFingerprint,
          childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, grantResult, compensation }, previous: currentEntry
        }, { ...grantResult, operationId, compensation, grossPrice, netPrice, creditApplied }, "uncertain");
      }
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, grantResult, compensation }, previous: currentEntry
      }, { ok: false, error: grantResult.error ?? "grant-refused", operationId, grant: grantResult, compensation }, "abandoned");
    }
    const progressed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, grantResult, commerceResult: currentEntry?.commerceResult ?? null },
      result: { ok: false, phase: "commerce-committed", operationId, action, grant: grantResult, grossPrice, netPrice, creditApplied }, previous: currentEntry
    });
    if (!progressed.ok) return progressed;
    current = progressed.village;
    currentEntry = progressed.entry;
  }

  let creditResult = currentEntry?.creditResult ?? null;
  if (creditApplied > 0 && !childCommitted(creditResult)) {
    const creditNext = clone(current);
    const credit = currentEntry?.creditReservation ?? creditWithReservation(policy, current, operationId);
    if (typeof options.consumeCredit === "function") {
      try {
        creditResult = await options.consumeCredit({ village: clone(creditNext), credit: clone(credit),
          amount: creditApplied, operationId: ids.creditOperationId });
        const returnedVillage = creditResult?.nextVillage ?? creditResult?.village;
        if (returnedVillage && typeof returnedVillage === "object") Object.assign(creditNext, clone(returnedVillage));
      }
      catch (error) { creditResult = failure("credit-write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) }); }
    } else creditResult = consumeCreditLocally(creditNext, credit, creditApplied);
    creditResult = clone(creditResult ?? failure("credit-write-failed", { phase: "uncertain", state: "unknown" }));
    if (!childCommitted(creditResult)) {
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, grantResult, creditResult }, previous: currentEntry
      }, { ok: false, error: creditResult.error ?? "credit-write-failed", operationId, grant: grantResult, credit: creditResult }, "credit-pending");
    }
    const creditWritten = await persistPhase(creditNext, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "spend-pending", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, grantResult, creditResult, commerceResult: currentEntry?.commerceResult ?? null },
      result: { ok: false, phase: "spend-pending", operationId, action, grant: grantResult, credit: creditResult }, previous: currentEntry
    });
    if (!creditWritten.ok) return creditWritten;
    current = creditWritten.village;
    currentEntry = creditWritten.entry;
  } else if (creditApplied > 0 && currentEntry?.phase === "credit-pending") {
    // A retry may have reached this branch with an already-consumed credit
    // child; retain the delivered item and advance to spend accounting.
    const promoted = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "spend-pending", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, grantResult, creditResult },
      result: { ok: false, phase: "spend-pending", operationId, action, grant: grantResult, credit: creditResult }, previous: currentEntry
    });
    if (!promoted.ok) return promoted;
    current = promoted.village;
    currentEntry = promoted.entry;
  }

  let spendResult = currentEntry?.spendResult ?? null;
  if (!spendResult) {
    const recorder = options.recordSpend ?? recordSpend;
    try { spendResult = await recorder(netPrice, { silent: true, operationId, originCycle }); }
    catch (error) { spendResult = failure("spend-write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) }); }
    spendResult = clone(spendResult ?? failure("spend-write-failed", { phase: "uncertain", state: "unknown" }));
    if (!childCommitted(spendResult)) {
      return persistFailure(getVillage(), {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, grantResult, creditResult, spendResult }, previous: getVillageOperation(operationId)
      }, { ok: false, error: spendResult.error ?? "spend-write-failed", operationId, grant: grantResult, credit: creditResult, spend: spendResult }, "spend-pending");
    }
    current = getVillage();
    currentEntry = getVillageOperation(operationId, current) ?? currentEntry;
    // Record the successful accounting child before the terminal journal
    // write.  If that final acknowledgement is lost, the next same-token
    // repair sees `spendResult` and cannot count the purchase twice.
    const spendCheckpoint = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "spend-pending", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, grantResult, creditResult, spendResult, commerceResult: currentEntry?.commerceResult ?? null },
      result: { ok: false, phase: "spend-pending", operationId, action, grant: grantResult, credit: creditResult, spend: spendResult },
      previous: currentEntry
    });
    if (!spendCheckpoint.ok) return spendCheckpoint;
    current = spendCheckpoint.village;
    currentEntry = spendCheckpoint.entry;
  }
  const result = {
    ok: true, committed: true, phase: "committed", operationId, action,
    grossPrice, creditApplied, netPrice, grant: clone(grantResult), credit: clone(creditResult),
    spend: clone(spendResult), commerce: clone(currentEntry?.commerceResult), commerceTxId: ids.payTxId,
    originCycle, itemIds: grantResult?.itemIds ?? grantResult?.createdItemIds ?? []
  };
  const final = await persistPhase(current, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    phase: "committed", childOperationIds: operationChildIds(ids, action),
    metadata: { ...metadata, grantResult, creditResult, spendResult, commerceResult: currentEntry?.commerceResult ?? null }, result,
    previous: currentEntry
  });
  if (!final.ok) return final;
  return operationResult({ operationId, action, phase: "committed", result, entry: final.entry, village: final.village });
}

async function runSaleSaga({ village, proposal, policy, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options, auction = false }) {
  const saleId = id(proposal?.saleId ?? proposal?.requested?.saleId, operationId);
  const auctionId = id(proposal?.auctionId ?? proposal?.requested?.auctionId, operationId);
  const auctionRoll = auction
    ? integer(options.auctionRoll ?? options.d10 ?? options.roll ?? proposal?.auctionRoll
      ?? proposal?.d10 ?? proposal?.requested?.auctionRoll ?? proposal?.requested?.d10
      ?? entry?.auctionRoll, 0)
    : null;
  if (auction && (auctionRoll < 1 || auctionRoll > 10)) {
    return failure("invalid-request", { reason: "auction-roll-required", phase: entry?.phase ?? "prepared", operationId });
  }
  const seller = await resolveActor(proposal?.sellerActorUuid ?? proposal?.payerActorUuid, options);
  if (!seller) return failure("seller-not-found", { phase: entry?.phase ?? "prepared", operationId });
  const suppliedItem = options.item ?? proposal?.item ?? proposal?.source
    ?? proposal?.requested?.item ?? proposal?.requested?.source ?? null;
  const sourceItemId = id(options.itemId ?? proposal?.itemId ?? proposal?.requested?.itemId
    ?? itemId(suppliedItem));
  // Always resolve the current embedded Item from the seller.  A caller may
  // hand us a stale serialized copy (or an Item belonging to another Actor),
  // but only the live owned document is eligible for the receive-then-delete
  // saga.
  const item = itemFor(seller, sourceItemId);
  if (!item) return failure("item-not-found", { phase: entry?.phase ?? "prepared", operationId, itemId: sourceItemId });
  const value = itemValueOf(item, proposal, options);
  const requestedValue = proposal?.itemValue ?? proposal?.requested?.itemValue
    ?? proposal?.requested?.value ?? options.itemValue;
  if (requestedValue != null && amount(requestedValue) !== value) {
    return failure("stale", { reason: "item-value-changed", stale: true,
      phase: entry?.phase ?? "prepared", operationId, itemId: sourceItemId,
      itemValue: value, requestedValue: amount(requestedValue) });
  }
  const salePercent = auction ? auctionSalePercentage(auctionRoll, village.prosperity) : policy?.sale?.percentage;
  const expectedProceeds = Math.floor(value * Number(salePercent ?? 0) / 100);
  const suppliedProceeds = options.proceeds ?? options.soldFor ?? proposal?.proceeds
    ?? proposal?.soldFor ?? proposal?.requested?.proceeds ?? proposal?.requested?.soldFor;
  if (suppliedProceeds != null && amount(suppliedProceeds) !== amount(expectedProceeds)) {
    return failure("stale", { reason: auction ? "auction-price-changed" : "sale-price-changed", stale: true,
      phase: entry?.phase ?? "prepared", operationId,
      proceeds: amount(expectedProceeds), requestedProceeds: amount(suppliedProceeds),
      ...(auction ? { soldFor: amount(expectedProceeds), requestedSoldFor: amount(suppliedProceeds) } : {}) });
  }
  const proceeds = auction
    ? amount(expectedProceeds)
    : amount(Math.floor(value * Number(salePercent ?? 0) / 100));
  const snapshot = entry?.auctionSnapshot ?? (auction ? itemSnapshot(item) : null);
  const metadata = operationMetadata({ proposal, policy, ids, operationId, originCycle,
    extra: { sellerActorUuid: actorId(seller), itemId: sourceItemId, itemValue: value, proceeds,
      saleId, auctionId,
      receiveTxId: ids.receiveTxId, deleteId: ids.deleteId, compensationPayTxId: ids.compensationPayTxId,
      ...(auction ? { auctionSnapshot: snapshot, auctionRoll, salePercentage: salePercent } : {}) } });
  let current = village;
  let currentEntry = entry;
  if (!currentEntry) {
    const receivePreflight = await preflightReceive(seller, proceeds, operationId, originCycle, options);
    if (receivePreflight?.ok === false) {
      return failure(receivePreflight.error ?? "no-capacity", {
        ...receivePreflight, phase: "prepared", operationId, proceeds
      });
    }
    const prepared = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "prepared", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "prepared", operationId, action, proceeds, itemId: sourceItemId }
    });
    if (!prepared.ok) return prepared;
    current = prepared.village;
    currentEntry = prepared.entry;
  }
  if (auction) {
    const lotNext = clone(current);
    const existingLot = (lotNext.auctionLots ?? []).find(candidate => id(candidate.auctionId) === auctionId);
    if (!existingLot) {
      lotNext.auctionLots = [...(lotNext.auctionLots ?? []), {
        auctionId, status: "pending", sellerActorUuid: actorId(seller), sourceItemId,
        snapshot, itemValue: value, soldFor: proceeds, salePercentage: salePercent,
        auctionRoll, createdOnCycle: originCycle
      }];
    } else if (existingLot.status !== "pending" && existingLot.status !== "sold") {
      return failure("auction-lot-conflict", { phase: "uncertain", state: "unknown",
        reconciliationRequired: true, operationId, auctionId, lot: clone(existingLot) });
    }
    const lotWritten = existingLot ? { ok: true, village: current, entry: currentEntry }
      : await persistPhase(lotNext, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        phase: "prepared", childOperationIds: operationChildIds(ids, action), metadata,
        result: { ok: false, phase: "prepared", operationId, action, proceeds, auctionId }, previous: currentEntry
      });
    if (!lotWritten.ok) return lotWritten;
    current = lotWritten.village;
    currentEntry = lotWritten.entry;
  }
  let receiveResult = currentEntry?.receiveResult ?? null;
  if (!receiveResult || !commerceCommitted(receiveResult)) {
    if (!receiveResult) {
      const pending = await persistPhase(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        phase: "commerce-pending", childOperationIds: operationChildIds(ids, action), metadata,
        result: { ok: false, phase: "commerce-pending", operationId, action, proceeds }, previous: currentEntry
      });
      if (!pending.ok) return pending;
      current = pending.village;
      currentEntry = pending.entry;
    }
    receiveResult = await callCommerce("receive", seller, proceeds, commerceContext({
      kind: "merchant", txId: ids.receiveTxId, actor: seller, operationId, originCycle,
      expectedRevision: commerceRevision(seller, options), options,
      extra: { sale: true, auction, itemId: sourceItemId, proceeds }
    }), options);
    receiveResult = clone(receiveResult);
    if (!commerceCommitted(receiveResult)) {
      const failurePhase = commerceFailurePhase(receiveResult);
      const failureVillage = auction && failurePhase === "abandoned"
        ? setAuctionLotStatus(current, auctionId, "abandoned", { abandonedOnCycle: originCycle }) : current;
      return persistFailure(failureVillage, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, receiveResult }, previous: currentEntry
      }, { ...receiveResult, operationId, proceeds }, failurePhase);
    }
    const progressed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, receiveResult },
      result: { ok: false, phase: "commerce-committed", operationId, action, receive: receiveResult, proceeds }, previous: currentEntry
    });
    if (!progressed.ok) return progressed;
    current = progressed.village;
    currentEntry = progressed.entry;
  }
  let deleteResult = currentEntry?.deleteResult ?? null;
  if (!deleteResult || !childCommitted(deleteResult)) {
    const latestSeller = await resolveActor(actorId(seller), options);
    const latestItem = latestSeller ? itemFor(latestSeller, sourceItemId) : null;
    if (!latestSeller || !latestItem) {
      deleteResult = failure("item-not-found", { phase: "uncertain", state: "unknown", reconciliationRequired: true, itemId: sourceItemId });
    } else {
      deleteResult = await callDelete(latestSeller, latestItem, {
        deleteId: ids.deleteId, operationId: ids.deleteId, villageOperationId: operationId,
        actorUuid: actorId(latestSeller), itemId: sourceItemId, originCycle
      }, options);
    }
    deleteResult = clone(deleteResult);
    if (!childCommitted(deleteResult)) {
      const compensation = await callCommerce("pay", seller, proceeds, commerceContext({
        kind: "merchant", txId: ids.compensationPayTxId, actor: seller, operationId, originCycle,
        expectedRevision: commerceRevision(seller, options), options,
        extra: { compensation: true, sale: true, auction, failedChild: ids.deleteId }
      }), options);
      if (!commerceCommitted(compensation)) {
        return persistFailure(current, {
          operationId, action, originCycle, expectedRevision, inputFingerprint,
          childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, receiveResult, deleteResult, compensation }, previous: currentEntry
        }, { ok: false, error: deleteResult.error ?? "delete-failed", operationId, receive: receiveResult, delete: deleteResult, compensation }, "uncertain");
      }
      const deletePhase = childUncertain(deleteResult) ? "uncertain" : "abandoned";
      const failureVillage = auction && deletePhase === "abandoned"
        ? setAuctionLotStatus(current, auctionId, "abandoned", { abandonedOnCycle: originCycle }) : current;
      return persistFailure(failureVillage, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, receiveResult, deleteResult, compensation }, previous: currentEntry
      }, { ok: false, error: deleteResult.error ?? "delete-failed", operationId, receive: receiveResult, delete: deleteResult, compensation,
        ...(deletePhase === "uncertain" ? { state: "unknown", reconciliationRequired: true } : {}) }, deletePhase);
    }
    const progressed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, receiveResult, deleteResult },
      result: { ok: false, phase: "commerce-committed", operationId, action, receive: receiveResult, delete: deleteResult }, previous: currentEntry
    });
    if (!progressed.ok) return progressed;
    current = progressed.village;
    currentEntry = progressed.entry;
  }
  const next = clone(current);
  let lot = null;
  if (auction) {
    lot = (next.auctionLots ?? []).find(candidate => id(candidate.auctionId) === auctionId);
    if (!lot) {
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, receiveResult, deleteResult }, previous: currentEntry
      }, { ok: false, error: "auction-lot-missing", operationId, auctionId,
        state: "unknown", reconciliationRequired: true }, "uncertain");
    }
    if (lot) Object.assign(lot, { status: "sold", soldOnCycle: originCycle, soldFor: proceeds, snapshot, itemValue: value });
  }
  const result = {
    ok: true, committed: true, phase: "committed", operationId, action, saleId: auction ? undefined : saleId,
    auctionId: auction ? auctionId : undefined,
    sellerActorUuid: actorId(seller), itemId: sourceItemId,
    itemValue: value, proceeds, ...(auction ? { auctionRoll, salePercentage: salePercent } : {}),
    receive: clone(receiveResult), delete: clone(deleteResult),
    receiveTxId: ids.receiveTxId, deleteId: ids.deleteId, compensationPayTxId: ids.compensationPayTxId,
    commerceTxId: ids.receiveTxId, lot: clone(lot), originCycle
  };
  const final = await persistPhase(next, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    phase: "committed", childOperationIds: operationChildIds(ids, action),
    metadata: { ...metadata, receiveResult, deleteResult }, result, previous: currentEntry
  });
  if (!final.ok) return final;
  return operationResult({ operationId, action, phase: "committed", result, entry: final.entry, village: final.village });
}

async function runBuybackSaga({ village, proposal, policy, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options }) {
  const buyer = await resolveActor(proposal?.buyerActorUuid ?? proposal?.payerActorUuid, options);
  if (!buyer) return failure("buyer-not-found", { phase: entry?.phase ?? "prepared", operationId });
  const auctionId = id(options.auctionId ?? proposal?.auctionId ?? proposal?.requested?.auctionId
    ?? entry?.auctionId ?? operationId);
  const lot = (village.auctionLots ?? []).find(candidate => id(candidate.auctionId) === auctionId);
  if (!lot || lot.status !== "sold") return failure("auction-lot-unavailable", { phase: entry?.phase ?? "prepared", operationId, auctionId });
  const itemValue = amount(options.itemValue ?? proposal?.itemValue ?? entry?.itemValue ?? lot.itemValue);
  const soldFor = amount(options.soldFor ?? proposal?.soldFor ?? entry?.soldFor ?? lot.soldFor);
  const expectedPrice = amount(auctionBuybackPrice(soldFor, itemValue));
  const suppliedPrice = options.buybackPrice ?? proposal?.buybackPrice
    ?? proposal?.requested?.buybackPrice;
  if (suppliedPrice != null && amount(suppliedPrice) !== expectedPrice) {
    return failure("stale", { reason: "auction-buyback-price-changed", stale: true,
      phase: entry?.phase ?? "prepared", operationId, auctionId,
      buybackPrice: expectedPrice, requestedBuybackPrice: amount(suppliedPrice) });
  }
  const price = entry?.price != null ? amount(entry.price)
    : suppliedPrice == null ? expectedPrice : amount(suppliedPrice);
  const source = lot.snapshot;
  const metadata = operationMetadata({ proposal, policy, ids, operationId, originCycle,
    extra: { auctionId, buyerActorUuid: actorId(buyer), itemValue, soldFor, price, snapshot: clone(source) } });
  let current = village;
  let currentEntry = entry;
  if (!currentEntry) {
    const preflight = await preflightGrant(buyer, source, ids, operationId, originCycle, options);
    if (preflight?.ok === false) return failure(preflight.error ?? "no-capacity", { ...preflight, phase: "abandoned", operationId });
    const prepared = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "prepared", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "prepared", operationId, action, auctionId, price }
    });
    if (!prepared.ok) return prepared;
    current = prepared.village;
    currentEntry = prepared.entry;
  }
  let payResult = currentEntry?.payResult ?? null;
  if (!payResult || !commerceCommitted(payResult)) {
    const pending = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-pending", childOperationIds: operationChildIds(ids, action), metadata,
      result: { ok: false, phase: "commerce-pending", operationId, action, auctionId, price }, previous: currentEntry
    });
    if (!pending.ok) return pending;
    current = pending.village;
    currentEntry = pending.entry;
    payResult = await callCommerce("pay", buyer, price, commerceContext({
      kind: "merchant", txId: ids.payTxId, actor: buyer, operationId, originCycle,
      expectedRevision: commerceRevision(buyer, options), options,
      extra: { auctionBuyback: true, auctionId, price }
    }), options);
    payResult = clone(payResult);
    if (!commerceCommitted(payResult)) {
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, payResult }, previous: currentEntry
      }, { ...payResult, operationId, auctionId, price }, commerceFailurePhase(payResult));
    }
    const progressed = await persistPhase(current, {
      operationId, action, originCycle, expectedRevision, inputFingerprint,
      phase: "commerce-committed", childOperationIds: operationChildIds(ids, action),
      metadata: { ...metadata, payResult },
      result: { ok: false, phase: "commerce-committed", operationId, action, pay: payResult, auctionId, price }, previous: currentEntry
    });
    if (!progressed.ok) return progressed;
    current = progressed.village;
    currentEntry = progressed.entry;
  }
  let grantResult = currentEntry?.grantResult ?? null;
  if (!grantResult || !childCommitted(grantResult)) {
    try { grantResult = await grantFunction(options)(buyer, source, grantContext(buyer, source, ids, operationId, originCycle, options)); }
    catch (error) { grantResult = failure("write-failed", { phase: "uncertain", state: "unknown", reconciliationRequired: true, message: String(error?.message ?? error) }); }
    grantResult = clone(grantResult);
    if (!childCommitted(grantResult)) {
      if (childUncertain(grantResult)) {
        return persistFailure(current, {
          operationId, action, originCycle, expectedRevision, inputFingerprint,
          childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, payResult, grantResult }, previous: currentEntry
        }, { ok: false, error: grantResult?.error ?? "grant-uncertain", operationId, auctionId,
          pay: payResult, grant: grantResult }, "uncertain");
      }
      const compensation = await callCommerce("receive", buyer, price, commerceContext({
        kind: "merchant", txId: ids.compensationPayTxId, actor: buyer, operationId, originCycle,
        expectedRevision: commerceRevision(buyer, options), options,
        extra: { compensation: true, auctionBuyback: true, auctionId }
      }), options);
      if (!commerceCommitted(compensation)) {
        return persistFailure(current, {
          operationId, action, originCycle, expectedRevision, inputFingerprint,
          childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, payResult, grantResult, compensation }, previous: currentEntry
        }, { ok: false, error: grantResult?.error ?? "grant-failed", operationId, auctionId, pay: payResult, grant: grantResult, compensation }, "uncertain");
      }
      return persistFailure(current, {
        operationId, action, originCycle, expectedRevision, inputFingerprint,
        childOperationIds: operationChildIds(ids, action), metadata: { ...metadata, payResult, grantResult, compensation }, previous: currentEntry
      }, { ok: false, error: grantResult?.error ?? "grant-failed", operationId, auctionId, pay: payResult, grant: grantResult, compensation }, "abandoned");
    }
  }
  const next = clone(current);
  const finalLot = (next.auctionLots ?? []).find(candidate => id(candidate.auctionId) === auctionId);
  if (!finalLot || finalLot.status !== "sold") return failure("auction-lot-conflict", { phase: "uncertain", state: "unknown", reconciliationRequired: true, auctionId });
  finalLot.status = "returned";
  finalLot.returnedOnCycle = originCycle;
  finalLot.returnedToActorUuid = actorId(buyer);
  const result = {
    ok: true, committed: true, phase: "committed", operationId, action, auctionId,
    buyerActorUuid: actorId(buyer), price, pay: clone(payResult), grant: clone(grantResult),
    payTxId: ids.payTxId, grantTxId: ids.grantTxId, commerceTxId: ids.payTxId,
    lot: clone(finalLot), originCycle
  };
  const final = await persistPhase(next, {
    operationId, action, originCycle, expectedRevision, inputFingerprint,
    phase: "committed", childOperationIds: operationChildIds(ids, action),
    metadata: { ...metadata, payResult, grantResult }, result, previous: currentEntry
  });
  if (!final.ok) return final;
  return operationResult({ operationId, action, phase: "committed", result, entry: final.entry, village: final.village });
}

async function runPaidSaga({ village, proposal, action, operationId, originCycle,
  expectedRevision, inputFingerprint, ids, entry, options }) {
  if (originCycle !== village.cycle && entry && NONTERMINAL_PHASES.has(String(entry.phase))) {
    return failure("cycle-conflict", { reason: "origin-cycle-advanced", phase: entry.phase, operationId,
      originCycle, currentCycle: village.cycle, operation: clone(entry) });
  }
  const policy = freshPolicy(village, proposal, action, operationId);
  const expectedPolicy = options.expectedPolicyFingerprint ?? proposal?.computedPolicyFingerprint
    ?? proposal?.quoteFingerprint ?? null;
  if (!policy || policy.ok !== true) return failure(policy?.reason ?? "policy-refusal", { phase: entry?.phase ?? "prepared", operationId, policy: clone(policy) });
  const livePolicyFingerprint = typeof options.policyFingerprint === "function"
    ? options.policyFingerprint(policy) : policyFingerprint(policy);
  // A committed credit child intentionally changes the read policy by making
  // the consumed allowance disappear.  That is progress made by this same
  // operation, not a stale quote; retain the recorded gross/net reservation
  // while allowing repair to continue to spend accounting.  Other policy
  // changes still fail closed.
  const creditProgressOwn = entry && ["buy", "merchant-purchase"].includes(action)
    && entry.creditResult && childCommitted(entry.creditResult)
    && amount(entry.creditReservation?.amount) > 0
    && !policy.creditToConsume;
  if (expectedPolicy && expectedPolicy !== livePolicyFingerprint && !creditProgressOwn) {
    return failure("stale", { reason: "stale-policy", stale: true, phase: entry?.phase ?? "prepared", operationId, policy: clone(policy) });
  }
  if (["found", "reopen", "upgrade"].includes(action)) {
    return runInstitutionSaga({ village, proposal, policy, action, operationId, originCycle,
      expectedRevision, inputFingerprint, ids, entry, options });
  }
  if (["craft", "workshop", "inn", "beacon", "service"].includes(action)) {
    return runServiceSaga({ village, proposal, policy, action, operationId, originCycle,
      expectedRevision, inputFingerprint, ids, entry, options });
  }
  if (["buy", "merchant-purchase"].includes(action)) {
    return runPurchaseSaga({ village, proposal, policy, action, operationId, originCycle,
      expectedRevision, inputFingerprint, ids, entry, options });
  }
  if (["sell", "auction-sell"].includes(action)) {
    return runSaleSaga({ village, proposal, policy, action, operationId, originCycle,
      expectedRevision, inputFingerprint, ids, entry, options, auction: action === "auction-sell" });
  }
  if (action === "auction-buy") {
    return runBuybackSaga({ village, proposal, policy, action, operationId, originCycle,
      expectedRevision, inputFingerprint, ids, entry, options });
  }
  return failure("unsupported-paid-action", { operationId, action });
}

function canonicalAction(action) {
  const value = String(action ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return {
    found: "found", foundinstitution: "found", reopen: "reopen", recover: "reopen",
    upgrade: "upgrade", levelup: "upgrade", craft: "craft", commission: "craft",
    workshop: "workshop", rentworkshop: "workshop", inn: "inn", bet: "inn",
    beacon: "beacon", transport: "beacon", service: "service", buy: "buy",
    purchase: "buy", merchantpurchase: "merchant-purchase", sell: "sell", sellitem: "sell",
    auctionsell: "auction-sell", auctionbuy: "auction-buy", buyback: "auction-buy"
  }[value] ?? value;
}

function directRequestedFingerprint(input = {}) {
  const requested = clone(input.requested ?? input) ?? {};
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return {};
  for (const key of ["payerActor", "actor", "buyerActor", "sellerActor", "user", "source", "item", "itemData",
    "requestedItem", "requestedService", "pay", "receive", "grantItem", "serviceAdapter", "equipmentAdapter"]) {
    delete requested[key];
  }
  return requested;
}

/** Commit one paid Village proposal through the durable saga boundary. */
export async function commitVillagePaidAction({ proposal = {}, options = {}, user = null } = {}) {
  const action = canonicalAction(proposal.action);
  const before = getVillage();
  if (proposal.villageId != null && String(proposal.villageId) !== String(before.villageId)) {
    return failure("stale", { reason: "village-id-changed", stale: true,
      operationId: proposal.villageOperationId ?? proposal.operationId ?? null,
      villageId: before.villageId });
  }
  const operationId = id(proposal.villageOperationId ?? proposal.operationId,
    `village-operation-${id(proposal.proposalId, `paid-${Date.now()}`)}`);
  const expectedRevision = Number.isInteger(Number(proposal.expectedVillageRevision ?? proposal.expectedRevision))
    ? Number(proposal.expectedVillageRevision ?? proposal.expectedRevision) : before.revision;
  const originCycle = integer(proposal.originCycle, before.cycle);
  const childRoot = ["sell", "auction-sell"].includes(action)
    ? (proposal.saleId ?? proposal.auctionId ?? proposal.requested?.saleId
      ?? proposal.requested?.auctionId ?? operationId)
    : operationId;
  const ids = operationIds(operationId, childRoot);
  const childOperationIds = operationChildIds(ids, action);
  const inputFingerprint = String(proposal.inputFingerprint ?? villageInputFingerprint({
    action, operationId, proposal: clone(proposal)
  }));
  const existing = getVillageOperation(operationId, before);
  if (existing && String(existing.inputFingerprint ?? "") !== inputFingerprint) {
    return failure("duplicate", { conflict: true, reason: "input-fingerprint-conflict", operation: clone(existing), operationId });
  }
  const terminal = existing && TERMINAL_PHASES.has(String(existing.phase ?? ""));
  if (terminal) {
    if (existing.phase === "committed" || existing.phase === "complete" || existing.phase === "resolved") {
      return { ...(clone(existing.result) ?? {}), ok: true, committed: true, replayed: true,
        operationId, phase: "committed", childOperationIds: clone(existing.childOperationIds ?? []),
        operation: clone(existing) };
    }
    return failure("operation-terminal", { operationId, phase: existing.phase, operation: clone(existing) });
  }
  if (!existing && originCycle !== before.cycle) {
    return failure("cycle-conflict", { reason: "origin-cycle-mismatch", operationId,
      originCycle, currentCycle: before.cycle });
  }
  if (!getActiveVillageGM() || !isVillageDesignatedWriter(user ?? globalThis.game?.user)) {
    return failure("authority-unavailable", { reason: getActiveVillageGM() ? "request-must-run-on-designated-gm" : "no-active-gm", operationId });
  }
  const result = await enqueueVillageOperation({
    operationId,
    action,
    villageId: before.villageId,
    expectedRevision,
    originCycle,
    inputFingerprint,
    childOperationIds,
    execute: async ({ village }) => {
      const outcome = await runPaidSaga({ village, proposal: clone({ ...proposal, action }), action, operationId,
        originCycle: existing?.originCycle ?? originCycle, expectedRevision, inputFingerprint,
        ids, entry: operationEntry(village, operationId), options: { ...options, user: user ?? options.user } });
      // Every saga phase above has already passed through saveVillage.  The
      // enclosing generic queue must therefore return the owned outcome
      // without attempting to persist the pre-saga snapshot a second time.
      // `persisted: true` is important for partial/uncertain recovery phases.
      const result = outcome?.entry && outcome?.village && !outcome?.operationId
        ? { ok: false, error: outcome.error ?? "write-failed", phase: "uncertain",
          state: "unknown", reconciliationRequired: true, operationId }
        : outcome;
      return { persist: false, persisted: true, result: clone(result) };
    }
  });
  return result;
}

/**
 * Explicit Ref adjudication for a paid operation that cannot be repaired in
 * its origin cycle.  Abandonment is never an implicit timeout behavior: when
 * a debit is proven, a distinct Commerce compensation child must commit first.
 * A failed/uncertain compensation leaves the original operation uncertain so
 * the cycle boundary continues to block.  A commit decision simply re-enters
 * the original same-token proposal and therefore retains its quote and cycle.
 */
export async function adjudicateVillageOperation({ operationId, decision = "abandon",
  proposal = null, options = {}, user = null, reason = "ref-adjudicated" } = {}) {
  const token = id(operationId);
  if (!token) return failure("invalid-request", { reason: "operation-id-required" });
  const normalizedDecision = String(decision).toLowerCase();
  if (normalizedDecision === "commit") {
    if (!proposal) return failure("invalid-request", { reason: "original-proposal-required", operationId: token });
    return commitVillagePaidAction({ proposal: { ...clone(proposal), operationId: token, villageOperationId: token }, options, user });
  }
  if (normalizedDecision !== "abandon") {
    return failure("invalid-request", { reason: "adjudication-decision-required", operationId: token });
  }
  const before = getVillage();
  const entry = getVillageOperation(token, before);
  if (!entry) return failure("operation-not-found", { operationId: token });
  if (TERMINAL_PHASES.has(String(entry.phase ?? ""))) {
    return { ...(clone(entry.result) ?? {}), operationId: token, phase: entry.phase, replayed: true, operation: clone(entry) };
  }
  if (!getActiveVillageGM() || !isVillageDesignatedWriter(user ?? options.user ?? globalThis.game?.user)) {
    return failure("authority-unavailable", { reason: getActiveVillageGM() ? "request-must-run-on-designated-gm" : "no-active-gm", operationId: token });
  }
  const ids = operationIds(token);
  const result = await enqueueVillageOperation({
    operationId: token,
    villageId: before.villageId,
    expectedRevision: entry.expectedRevision ?? before.revision,
    originCycle: entry.originCycle ?? before.cycle,
    inputFingerprint: entry.inputFingerprint ?? villageInputFingerprint(entry),
    action: "adjudicate-village-operation",
    childOperationIds: [...new Set(entry.childOperationIds ?? [])],
    execute: async ({ village }) => {
      const currentEntry = operationEntry(village, token) ?? entry;
      const action = String(currentEntry.action ?? "");
      const settledChild = currentEntry.commerceResult
        ?? currentEntry.payResult ?? currentEntry.receiveResult;
      const provenCommerce = settledChild && commerceCommitted(settledChild);
      const refundAmount = amount(currentEntry.netPrice ?? currentEntry.price
        ?? currentEntry.proceeds ?? currentEntry.grossPrice);
      let compensation = currentEntry.compensation && commerceCommitted(currentEntry.compensation)
        ? clone(currentEntry.compensation) : null;
      const compensationId = `${token}:adjudication-compensation`;
      if (provenCommerce && refundAmount > 0 && !compensation) {
        const payerUuid = currentEntry.payerActorUuid ?? currentEntry.sellerActorUuid
          ?? currentEntry.buyerActorUuid;
        const actor = await resolveActor(payerUuid, options);
        if (!actor) {
          const failed = await persistFailure(village, {
            operationId: token, action, originCycle: currentEntry.originCycle ?? village.cycle,
            expectedRevision: currentEntry.expectedRevision ?? village.revision,
            inputFingerprint: currentEntry.inputFingerprint ?? villageInputFingerprint(currentEntry),
            childOperationIds: [...new Set([...(currentEntry.childOperationIds ?? []), compensationId])],
            metadata: { compensationPayTxId: compensationId }, previous: currentEntry
          }, { ok: false, error: "compensation-actor-not-found", operationId: token,
            state: "unknown", reconciliationRequired: true }, "uncertain");
          return { persist: false, persisted: true, result: failed };
        }
        const isSale = ["sell", "auction-sell"].includes(action);
        compensation = await callCommerce(isSale ? "pay" : "receive", actor, refundAmount, commerceContext({
          kind: "merchant", txId: compensationId, actor, operationId: token,
          originCycle: currentEntry.originCycle ?? village.cycle,
          expectedRevision: commerceRevision(actor, options), options,
          extra: { compensation: true, adjudication: true, originalOperationId: token }
        }), options);
        if (!commerceCommitted(compensation)) {
          const failed = await persistFailure(village, {
            operationId: token, action, originCycle: currentEntry.originCycle ?? village.cycle,
            expectedRevision: currentEntry.expectedRevision ?? village.revision,
            inputFingerprint: currentEntry.inputFingerprint ?? villageInputFingerprint(currentEntry),
            childOperationIds: [...new Set([...(currentEntry.childOperationIds ?? []), compensationId])],
            metadata: { compensationPayTxId: compensationId, compensation }, previous: currentEntry
          }, { ok: false, error: "compensation-failed", operationId: token, compensation,
            state: "unknown", reconciliationRequired: true }, "uncertain");
          return { persist: false, persisted: true, result: failed };
        }
      }
      const committedResult = { ok: true, phase: "abandoned", operationId: token, reason,
        compensation: compensation ? clone(compensation) : null,
        compensationPayTxId: compensation ? compensationId : null };
      const adjudicationVillage = action === "auction-sell"
        ? setAuctionLotStatus(village, currentEntry.auctionId ?? token, "abandoned", {
          abandonedOnCycle: currentEntry.originCycle ?? village.cycle
        }) : village;
      const written = await persistPhase(adjudicationVillage, {
        operationId: token, action, originCycle: currentEntry.originCycle ?? village.cycle,
        expectedRevision: currentEntry.expectedRevision ?? village.revision,
        inputFingerprint: currentEntry.inputFingerprint ?? villageInputFingerprint(currentEntry),
        phase: "abandoned", childOperationIds: [...new Set([
          ...(currentEntry.childOperationIds ?? []), ...(compensation ? [compensationId] : [])
        ])], metadata: { compensation }, result: committedResult, previous: currentEntry
      });
      if (!written.ok) return { persist: false, persisted: true, result: written };
      return { persist: false, persisted: true,
        result: operationResult({ operationId: token, action, phase: "abandoned",
          result: committedResult, entry: written.entry, village: written.village }) };
    }
  });
  return result;
}

function directProposal(action, input = {}, options = {}) {
  const village = getVillage();
  const payer = input.payerActor ?? input.actor ?? input.buyerActor ?? input.sellerActor
    ?? options.payerActor ?? options.actor ?? options.buyerActor ?? options.sellerActor;
  const payerActorUuid = input.payerActorUuid ?? input.payerUuid ?? actorId(payer);
  const identity = ["sell", "auction-sell"].includes(action)
    ? (input.saleId ?? input.auctionId ?? null) : null;
  const defaultOperationId = action === "auction-buy" && input.auctionId
    ? `village-${action}-${input.auctionId}-${payerActorUuid ?? "buyer"}`
    : `village-${action}-${village.villageId}-${village.cycle}-${Date.now()}`;
  const operationId = id(input.operationId, identity
    ?? defaultOperationId);
  const auctionInstitutionId = ["auction-sell", "auction-buy"].includes(action)
    ? village.institutions?.find(institution => institution.type === "auctionHouse")?.id : null;
  const source = input.source ?? input.item ?? input.itemData;
  const sourceSnapshot = cloneGrantItemData(source) ?? (typeof source === "string" ? source : null);
  const proposal = {
    proposalId: input.proposalId ?? operationId,
    villageOperationId: operationId,
    operationId,
    action,
    villageId: village.villageId,
    originCycle: input.originCycle ?? village.cycle,
    expectedVillageRevision: input.expectedVillageRevision ?? input.expectedRevision ?? village.revision,
    expectedRevision: input.expectedVillageRevision ?? input.expectedRevision ?? village.revision,
    institutionId: input.institutionId ?? input.id ?? input.targetId ?? auctionInstitutionId,
    institutionType: input.institutionType ?? input.type,
    payerActorUuid,
    purchaseId: input.purchaseId ?? null,
    saleId: input.saleId ?? null,
    sellerActorUuid: input.sellerActorUuid ?? actorId(input.sellerActor),
    buyerActorUuid: input.buyerActorUuid ?? actorId(input.buyerActor),
    auctionId: input.auctionId ?? null,
    auctionRoll: input.auctionRoll ?? input.d10 ?? input.roll ?? null,
    requested: clone(input.requested ?? input),
    source,
    item: input.item,
    itemId: input.itemId ?? itemId(input.item),
    itemValue: input.itemValue ?? input.value ?? input.item?.system?.value
      ?? input.item?.system?.price ?? input.item?.value,
    grossPrice: input.grossPrice ?? input.itemPrice ?? input.price,
    targetLevel: input.targetLevel ?? input.target,
    soldFor: input.soldFor,
    buybackPrice: input.buybackPrice,
    proceeds: input.proceeds,
    itemKey: input.itemKey,
    bet: input.bet,
    hexes: input.hexes ?? input.distance,
    rush: input.rush,
    quoteFingerprint: input.quoteFingerprint ?? null,
    inputFingerprint: input.inputFingerprint ?? villageInputFingerprint({
      action, operationId, villageId: village.villageId, originCycle: input.originCycle ?? village.cycle,
      institutionId: input.institutionId ?? input.id ?? input.targetId ?? auctionInstitutionId,
      institutionType: input.institutionType ?? input.type, payerActorUuid,
      sellerActorUuid: input.sellerActorUuid ?? actorId(input.sellerActor),
      buyerActorUuid: input.buyerActorUuid ?? actorId(input.buyerActor),
      purchaseId: input.purchaseId ?? null, saleId: input.saleId ?? null, auctionId: input.auctionId ?? null,
      itemId: input.itemId ?? itemId(input.item), itemValue: input.itemValue ?? input.value
        ?? input.item?.system?.value ?? input.item?.system?.price ?? input.item?.value,
      grossPrice: input.grossPrice ?? input.itemPrice ?? input.price,
      targetLevel: input.targetLevel ?? input.target, soldFor: input.soldFor,
      buybackPrice: input.buybackPrice, proceeds: input.proceeds, itemKey: input.itemKey,
      bet: input.bet, hexes: input.hexes ?? input.distance, rush: input.rush,
      requested: directRequestedFingerprint(input), sourceSnapshot
    }),
    computedPolicyFingerprint: null
  };
  return proposal;
}

async function directPaid(action, input = {}, options = {}) {
  const proposal = directProposal(action, input, options);
  const policy = institutionServicePolicy(getVillage(), actionRequest(proposal, action));
  proposal.computedPolicyFingerprint = policyFingerprint(policy);
  return commitVillagePaidAction({ proposal, options: { ...options, ...input }, user: options.user ?? input.user });
}

/** PC/Party-funded founding; the shorter `foundInstitution` is unfunded. */
export async function foundInstitutionPaid(input = {}, options = {}) {
  return directPaid((input.institutionType ?? input.type) ? "found" : "reopen", input, options);
}

/** PC/Party-funded upgrade; the lower-level `upgradeInstitution` is unfunded. */
export async function upgradeInstitutionPaid(inputOrId = {}, options = {}) {
  const input = typeof inputOrId === "string" ? { ...options, institutionId: inputOrId } : inputOrId;
  return directPaid("upgrade", input, typeof inputOrId === "string" ? options : { ...options, ...input });
}

export async function commissionArtisan(input = {}, options = {}) {
  return directPaid("craft", input, options);
}

export async function rentWorkshop(input = {}, options = {}) {
  return directPaid("workshop", input, options);
}

export async function placeInnBet(input = {}, options = {}) {
  return directPaid("inn", input, options);
}

export async function payBeaconFare(input = {}, options = {}) {
  return directPaid("beacon", input, options);
}

export async function purchaseMerchantItem(input = {}, options = {}) {
  return directPaid("merchant-purchase", input, options);
}

export async function sellItem(input = {}, options = {}) {
  return directPaid("sell", input, options);
}

export async function auctionSell(input = {}, options = {}) {
  return directPaid("auction-sell", input, options);
}

export async function auctionBuyback(input = {}, options = {}) {
  return directPaid("auction-buy", input, options);
}
