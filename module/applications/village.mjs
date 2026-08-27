import {
  getVillageReadModel,
  createVillageProposal,
  reviewVillageProposal,
  commitVillageProposal,
  villageCommitAuthority
} from "../helpers/village-interface.mjs";
import {
  VILLAGE_EVENTS,
  getVillage,
  endCycle,
  rollVillageEvent,
  resolvePendingEvent,
  abandonPendingEvent,
  cancelPendingEvent,
  villageEventResolutionOptions,
  registerVillageChangeListener
} from "../helpers/village.mjs";
import { adjudicateVillageOperation } from "../helpers/village-sagas.mjs";

const api = globalThis.foundry?.applications?.api ?? {};
const ApplicationV2 = api.ApplicationV2 ?? class ApplicationV2Fallback {
  constructor(options = {}) { this.options = options; this.element = null; }
  async render() { return this; }
  async close() { return this; }
};
const HandlebarsMixin = typeof api.HandlebarsApplicationMixin === "function"
  ? api.HandlebarsApplicationMixin : Base => Base;

function valueFrom(root, selector, fallback = undefined) {
  const field = root?.querySelector?.(selector);
  if (!field) return fallback;
  if (field.type === "checkbox") return Boolean(field.checked);
  return field.value ?? fallback;
}

function numberValue(root, selector, fallback = undefined) {
  const value = valueFrom(root, selector, fallback);
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function targetData(target) {
  const source = target?.dataset ? target : target?.currentTarget ?? target?.target ?? target;
  return source?.dataset ?? source?.closest?.("[data-village-action]")?.dataset ?? {};
}

const LOCAL_VILLAGE_API = Object.freeze({
  get: getVillage,
  endCycle,
  rollEvent: rollVillageEvent,
  resolvePendingEvent,
  resolveVillageEvent: resolvePendingEvent,
  abandonPendingEvent,
  cancelPendingEvent,
  resolutionOptions: villageEventResolutionOptions,
  adjudicateVillageOperation,
  commitAuthority: villageCommitAuthority
});

const BLOCKING_OPERATION_PHASES = new Set([
  "prepared", "commerce-pending", "commerce-committed", "credit-pending",
  "spend-pending", "partial", "uncertain", "blocked"
]);

function villageApi() {
  return globalThis.game?.crows?.village ?? LOCAL_VILLAGE_API;
}

function villageApiMethod(api, names, fallback) {
  for (const name of names) {
    if (typeof api?.[name] === "function") return api[name].bind(api);
  }
  return fallback;
}

function authorityFor(user = globalThis.game?.user) {
  const api = villageApi();
  const hasCommitProbe = typeof api?.commitAuthority === "function";
  const probe = villageApiMethod(api, ["commitAuthority"], villageCommitAuthority);
  let result;
  try {
    result = hasCommitProbe ? probe?.(user) : null;
  } catch (error) {
    return { ok: false, error: "authority-unavailable", reason: String(error?.message ?? error) };
  }
  if (!hasCommitProbe) {
    const hasWriterSurface = typeof api?.activeGM === "function"
      || typeof api?.isDesignatedWriter === "function" || api?.activeGM != null;
    if (!hasWriterSurface) result = villageCommitAuthority(user);
    else {
      const active = typeof api?.activeGM === "function" ? api.activeGM() : api?.activeGM;
      const designated = typeof api?.isDesignatedWriter === "function"
        ? api.isDesignatedWriter(user) : null;
      if (!user?.isGM) result = { ok: false, error: "unauthorized", reason: "ref-required" };
      else if (!active) result = { ok: false, error: "authority-unavailable", reason: "no-active-gm" };
      else if (designated === false) result = {
        ok: false, error: "authority-unavailable",
        reason: "request-must-run-on-designated-gm", activeGMId: active.id ?? null
      };
      else result = { ok: true, activeGM: active, designatedWriter: designated !== false };
    }
  }
  if (!result || result.ok !== true || result.designatedWriter === false) {
    return {
      ...(result && typeof result === "object" ? result : {}),
      ok: false,
      error: result?.error ?? "unauthorized",
      reason: result?.reason ?? "ref-required"
    };
  }
  return { ...result, ok: true, designatedWriter: true };
}

function liveVillageFor(app) {
  const api = villageApi();
  try {
    const value = api.get?.();
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* use the application's last model */ }
  if (app?._readModel && typeof app._readModel === "object") return app._readModel;
  try { return getVillageReadModel(); } catch { return {}; }
}

function operationToken(action, app, suffix = "") {
  const village = liveVillageFor(app);
  const villageId = String(village?.villageId ?? "village");
  const cycle = Number.isFinite(Number(village?.cycle)) ? Number(village.cycle) : 0;
  const revision = Number.isFinite(Number(village?.revision)) ? Number(village.revision) : 0;
  const key = `${action}:${villageId}:${cycle}:${suffix}`;
  app._villageOperationTokens ??= new Map();
  if (!app._villageOperationTokens.has(key)) {
    const safe = key.replace(/[^A-Za-z0-9:_-]+/g, "-");
    app._villageOperationTokens.set(key, `village-ui-${safe}`);
  }
  return { operationId: app._villageOperationTokens.get(key), expectedRevision: revision, village };
}

function controlFlights(app) {
  app._villageControlFlights ??= new Map();
  return app._villageControlFlights;
}

function rememberControlResult(app, result, control) {
  if (!app || (typeof app !== "object" && typeof app !== "function")) return;
  app._lastActionResult = result;
  app._lastVillageControlResult = result;
  app._lastVillageControl = control;
  const operation = result?.operation;
  app._blockedOperation = operationBlock(result) ? operation : null;
}

function operationBlock(result) {
  const operation = result?.operation;
  if (!operation || !operation.phase || !operation.operationId
      || !BLOCKING_OPERATION_PHASES.has(String(operation.phase))) return null;
  return {
    operationId: String(operation.operationId),
    action: String(operation.action ?? "Village operation"),
    phase: String(operation.phase),
    message: `Cycle cannot advance: operation “${operation.operationId}” (${operation.action ?? "Village operation"}) is still in the “${operation.phase}” phase. Repair or adjudicate it before ending the cycle.`
  };
}

/** Turn a structured control result into text a Ref can act on. */
export function describeVillageControlResult(result) {
  if (!result) return null;
  const blocked = operationBlock(result);
  if (blocked) return { kind: "warning", ...blocked };
  if (result.error === "event-pending" || result.error === "event-resolving"
      || result.error === "event-blocked" || result.error === "event-partial"
      || result.error === "event-uncertain") {
    const pending = result.pendingEvent;
    const resolutionId = pending?.resolutionId ? ` (${pending.resolutionId})` : "";
    return {
      kind: "warning",
      message: `Cycle cannot advance: the Village event${resolutionId} is still ${pending?.status ?? "pending"}. Resolve or abandon it first.`
    };
  }
  if (result.ok === true) return { kind: "success", message: "Village control committed." };
  if (result.error || result.reason) {
    return {
      kind: "warning",
      message: `Village control refused: ${String(result.reason ?? result.error)}.`
    };
  }
  return null;
}

function parseSelections(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}

function selectionValues(root, key) {
  if (!root || !key) return [];
  const values = [];
  const controls = root.querySelectorAll?.("[data-event-selection]") ?? [];
  for (const control of controls) {
    const controlKey = control?.dataset?.selectionKey ?? control?.name;
    if (controlKey !== key) continue;
    if (control.type === "checkbox" && !control.checked) continue;
    if (control.type === "radio" && !control.checked) continue;
    if (control.multiple && control.selectedOptions) {
      for (const option of control.selectedOptions) {
        if (option?.value != null && String(option.value).trim()) values.push(option.value);
      }
      continue;
    }
    if (control.value != null && String(control.value).trim()) values.push(control.value);
  }
  if (values.length) return values;
  const field = root.querySelector?.(`[name="${key}"]`);
  if (field?.value != null && String(field.value).trim()) return [field.value];
  return [];
}

function eventSelections(app, target, options) {
  const data = targetData(target);
  const root = app?._root?.();
  const direct = parseSelections(data.selections ?? data.selection ?? valueFrom(root, "[name='eventSelections']"));
  if (direct && Object.keys(direct).length) return direct;
  const key = data.selectionKey ?? options?.selectionKey;
  if (options?.kind === "item" || key === "actorUuid/itemId") {
    const actorUuid = data.actorUuid ?? valueFrom(root, "[name='actorUuid']");
    const itemId = data.itemId ?? valueFrom(root, "[name='itemId']");
    return {
      ...(actorUuid ? { actorUuid } : {}),
      ...(itemId ? { itemId } : {})
    };
  }
  const values = selectionValues(root, key);
  if (values.length) {
    if (key === "institutionId" || key === "institutionType" || key === "actorUuid/itemId") {
      return { [key]: values[0] };
    }
    return { [key]: values };
  }
  const selections = {};
  for (const name of ["institutionId", "institutionType", "actorUuid", "itemId", "destroyInstitutionId"]) {
    if (data[name] != null && String(data[name]).trim()) selections[name] = data[name];
  }
  for (const name of ["institutionIds", "recipientActorUuids", "actorUuids"]) {
    if (data[name] == null) continue;
    const valuesFromData = Array.isArray(data[name]) ? data[name] : String(data[name]).split(",");
    selections[name] = valuesFromData.map(value => String(value).trim()).filter(Boolean);
  }
  return selections;
}

function eventContext(app, expectedRevision) {
  const user = globalThis.game?.user;
  return {
    ...(app?.options?.eventContext ?? {}),
    ...(app?.options?.context ?? {}),
    user,
    isGM: Boolean(user?.isGM),
    expectedRevision
  };
}

async function renderControlResult(app, result, control) {
  rememberControlResult(app, result, control);
  if (typeof app?._renderAfterVillageControl === "function") {
    await app._renderAfterVillageControl();
  } else if (typeof app?.render === "function") {
    try { await app.render({ force: true }); } catch { /* a closing app */ }
  }
  return result;
}

async function refuseControl(app, result, control) {
  return renderControlResult(app, {
    ok: false,
    error: result?.error ?? "unauthorized",
    reason: result?.reason ?? "ref-required",
    ...(result && typeof result === "object" ? result : {})
  }, control);
}

function runSingleFlight(app, key, work) {
  const flights = controlFlights(app);
  const existing = flights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    try { return await work(); }
    catch (error) {
      return renderControlResult(app, {
        ok: false,
        error: "control-failed",
        reason: String(error?.message ?? error),
        state: "unknown"
      }, key);
    }
  })();
  flights.set(key, flight);
  flight.then(() => {
    if (flights.get(key) === flight) flights.delete(key);
  }, () => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  return flight;
}

/**
 * The in-game Village browse/proposal surface.  It is intentionally a small
 * ApplicationV2 wrapper around the read model: policy, authority and durable
 * proposal transitions live in the helper layer and are therefore testable
 * without a rendered DOM.
 */
export class VillageApplication extends HandlebarsMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "application", "village"],
    position: { width: 920, height: "auto" },
    window: { title: "Village", resizable: true },
    actions: {
      refreshVillage: VillageApplication._onRefresh,
      proposeVillage: VillageApplication._onPropose,
      reviewVillageProposal: VillageApplication._onReviewProposal,
      commitVillageProposal: VillageApplication._onCommitProposal,
      endCycle: VillageApplication._onEndCycle,
      rollEvent: VillageApplication._onRollEvent,
      rollVillageEvent: VillageApplication._onRollEvent,
      resolveVillageEvent: VillageApplication._onResolveVillageEvent,
      resolvePendingEvent: VillageApplication._onResolveVillageEvent,
      abandonPendingEvent: VillageApplication._onAbandonVillageEvent,
      abandonVillageEvent: VillageApplication._onAbandonVillageEvent,
      cancelPendingEvent: VillageApplication._onAbandonVillageEvent,
      cancelVillageEvent: VillageApplication._onAbandonVillageEvent,
      adjudicateVillageOperation: VillageApplication._onAdjudicateVillageOperation,
      repairVillageOperation: VillageApplication._onAdjudicateVillageOperation
    }
  };

  static PARTS = {
    body: { template: "systems/crows/templates/actor/village.hbs" }
  };

  #unsubscribe = null;
  #closed = false;
  _readModel = null;
  _quoteInvalidated = false;
  _lastVillageMetadata = null;
  _lastActionResult = null;
  _lastVillageControlResult = null;
  _lastVillageControl = null;
  _blockedOperation = null;
  _villageOperationTokens = new Map();
  _villageControlFlights = new Map();

  constructor(options = {}) {
    super(options);
    this.#unsubscribe = registerVillageChangeListener((next, previous, metadata) => {
      if (this.#closed) return;
      this._quoteInvalidated = true;
      this._lastVillageMetadata = metadata ?? null;
      this._readModel = null;
      // ApplicationV2 coalesces renders; a remote change must invalidate the
      // open form even when the previous render is still in flight.
      try { Promise.resolve(this.render({ force: true })).catch(() => undefined); } catch { /* a closing app */ }
    });
  }

  async _prepareContext(options = {}) {
    const parent = typeof super._prepareContext === "function"
      ? await super._prepareContext(options) : {};
    const model = getVillageReadModel({
      ...(options ?? {}),
      actorUuid: options?.actorUuid ?? this.options?.actorUuid ?? null
    });
    this._readModel = model;
    const authority = authorityFor(globalThis.game?.user);
    const canCommit = authority.ok === true && authority.designatedWriter !== false;
    const api = villageApi();
    let liveVillage = model;
    try {
      const candidate = api.get?.();
      if (candidate && typeof candidate === "object") liveVillage = candidate;
    } catch { /* the read model is still enough to render */ }
    let resolutionOptions = null;
    if (model.pendingEvent) {
      const resolver = villageApiMethod(api, ["resolutionOptions"], villageEventResolutionOptions);
      try {
        resolutionOptions = resolver(liveVillage, {
          ...(this.options?.eventContext ?? {}),
          ...(this.options?.context ?? {})
        });
        if (resolutionOptions && typeof resolutionOptions === "object") {
          const count = resolutionOptions.count;
          resolutionOptions = {
            ...resolutionOptions,
            multiple: count === "one-or-more" || Number(count) > 1
              || resolutionOptions.kind === "recipients"
          };
        }
      } catch { resolutionOptions = null; }
    }
    const event = model.pendingEvent
      ? VILLAGE_EVENTS.find(candidate => candidate.id === (model.pendingEvent.eventId ?? model.pendingEvent.id))
      : null;
    const pendingEvent = model.pendingEvent ? {
      ...model.pendingEvent,
      eventId: model.pendingEvent.eventId ?? model.pendingEvent.id ?? null,
      eventName: event?.id ?? model.pendingEvent.eventId ?? model.pendingEvent.id ?? "Village event",
      text: event?.text ?? "This Village event is awaiting Ref resolution.",
      effect: event?.effect ?? null
    } : null;
    const journalBlockEntry = (model.operationJournal ?? []).find(entry =>
      BLOCKING_OPERATION_PHASES.has(String(entry?.phase ?? "")));
    const journalBlock = journalBlockEntry
      ? operationBlock({ operation: journalBlockEntry }) : null;
    const actionNotice = describeVillageControlResult(this._lastActionResult)
      ?? (journalBlock ? { kind: "warning", ...journalBlock } : null);
    const flights = controlFlights(this);
    return {
      ...(parent ?? {}),
      ...model,
      village: model,
      authority,
      canCommit,
      isRef: canCommit,
      quoteInvalidated: this._quoteInvalidated,
      lastVillageMetadata: this._lastVillageMetadata,
      cycleControls: {
        visible: canCommit && model.tracksCycles !== false,
        busy: flights.has("endCycle") || flights.has("rollEvent"),
        endCycleBusy: flights.has("endCycle"),
        rollEventBusy: flights.has("rollEvent")
      },
      pendingEvent,
      resolutionOptions,
      eventResolutionBusy: flights.has("resolveVillageEvent"),
      eventAbandonBusy: flights.has("abandonPendingEvent"),
      operationRepairBusy: flights.has("adjudicateVillageOperation"),
      actionNotice,
      controlMessage: actionNotice?.message ?? null,
      cycleBlock: journalBlock ?? operationBlock(this._lastActionResult),
      blockedOperation: this._blockedOperation ?? journalBlockEntry ?? null
    };
  }

  async close(options = {}) {
    this.#closed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    return typeof super.close === "function" ? super.close(options) : this;
  }

  _root() {
    return this.element ?? this.form ?? null;
  }

  static async _onRefresh() {
    this._quoteInvalidated = true;
    this._readModel = null;
    return this.render({ force: true });
  }

  async _renderAfterProposalChange() {
    this._readModel = null;
    try { await this.render({ force: true }); } catch { /* a closing app */ }
  }

  async _renderAfterVillageControl() {
    this._readModel = null;
    try { await this.render({ force: true }); } catch { /* a closing app */ }
  }

  static async _onPropose(event, target) {
    const data = targetData(target);
    const root = this._root();
    const requested = {
      itemKey: data.itemKey ?? valueFrom(root, "[name='itemKey']"),
      itemPrice: numberValue(root, "[name='itemPrice']"),
      itemValue: numberValue(root, "[name='itemValue']"),
      targetLevel: numberValue(root, "[name='targetLevel']"),
      name: valueFrom(root, "[name='villageName']"),
      steward: valueFrom(root, "[name='steward']"),
      uses: numberValue(root, "[name='uses']"),
      rank: numberValue(root, "[name='rank']"),
      quality: valueFrom(root, "[name='quality']"),
      power: numberValue(root, "[name='power']"),
      bet: numberValue(root, "[name='bet']"),
      hexes: numberValue(root, "[name='hexes']"),
      rush: Boolean(valueFrom(root, "[name='rush']", false))
    };
    Object.keys(requested).forEach(key => {
      if (requested[key] === undefined || requested[key] === null || requested[key] === "") delete requested[key];
    });
    const payerActorUuid = data.payerActorUuid ?? valueFrom(root, "[name='payerActorUuid']")
      ?? this.options?.payerActorUuid ?? this.options?.actorUuid ?? null;
    const result = await createVillageProposal({
      action: data.villageAction ?? data.action,
      institutionId: data.institutionId,
      institutionType: data.institutionType ?? valueFrom(root, "[name='institutionType']"),
      payerActorUuid,
      itemKey: data.itemKey,
      requested,
      quoteFingerprint: data.quoteFingerprint,
      availabilityFingerprint: data.availabilityFingerprint
    });
    if (result.ok) this._quoteInvalidated = false;
    await this._renderAfterProposalChange();
    return result;
  }

  static async _onReviewProposal(event, target) {
    const data = targetData(target);
    const result = await reviewVillageProposal(data.proposalId ?? data.villageProposalId, {
      decision: data.decision ?? "approve"
    });
    await this._renderAfterProposalChange();
    return result;
  }

  static async _onCommitProposal(event, target) {
    const data = targetData(target);
    const result = await commitVillageProposal(data.proposalId ?? data.villageProposalId, {
      // The saga supplies Commerce by default.  An injected settlement remains
      // a narrow test/owner seam and cannot fabricate a committed Village
      // result without the saga's receipt-bearing phase.
      settle: this.options?.settle
    });
    await this._renderAfterProposalChange();
    return result;
  }

  static async _onEndCycle(event, target) {
    const authority = authorityFor(globalThis.game?.user);
    if (!authority.ok || authority.designatedWriter === false) {
      return refuseControl(this, authority, "endCycle");
    }
    const data = targetData(target);
    const skipEvent = data.skipEvent === "true" || data.skipEvent === "1";
    const token = operationToken("end-cycle", this, skipEvent ? "skip-event" : "roll-event");
    const api = villageApi();
    return runSingleFlight(this, "endCycle", async () => {
      const method = villageApiMethod(api, ["endCycle"], endCycle);
      const operationId = String(data.operationId ?? "").trim() || token.operationId;
      const result = await method({
        operationId,
        expectedRevision: token.expectedRevision,
        skipEvent
      });
      return renderControlResult(this, result, "endCycle");
    });
  }

  static async _onRollEvent(event, target) {
    const authority = authorityFor(globalThis.game?.user);
    if (!authority.ok || authority.designatedWriter === false) {
      return refuseControl(this, authority, "rollEvent");
    }
    const data = targetData(target);
    const token = operationToken("roll-event", this, "");
    const api = villageApi();
    return runSingleFlight(this, "rollEvent", async () => {
      const method = villageApiMethod(api, ["rollEvent", "rollVillageEvent"], rollVillageEvent);
      const operationId = String(data.operationId ?? "").trim() || token.operationId;
      const result = await method({
        operationId,
        resolutionId: String(data.resolutionId ?? "").trim() || `${operationId}:resolution`,
        expectedRevision: token.expectedRevision
      });
      return renderControlResult(this, result, "rollEvent");
    });
  }

  static async _onResolveVillageEvent(event, target) {
    const authority = authorityFor(globalThis.game?.user);
    if (!authority.ok || authority.designatedWriter === false) {
      return refuseControl(this, authority, "resolveVillageEvent");
    }
    const data = targetData(target);
    const model = liveVillageFor(this);
    const pending = model?.pendingEvent ?? this._readModel?.pendingEvent;
    const resolutionId = data.resolutionId ?? pending?.resolutionId;
    const api = villageApi();
    const resolver = villageApiMethod(api,
      ["resolvePendingEvent", "resolveVillageEvent", "resolveEvent"], resolvePendingEvent);
    const options = (() => {
      try {
        const optionsResolver = villageApiMethod(api, ["resolutionOptions"], villageEventResolutionOptions);
        return optionsResolver(model, this.options?.eventContext ?? {});
      } catch { return null; }
    })();
    const selections = eventSelections(this, target, options);
    const token = String(resolutionId ?? "").trim();
    if (!token) return refuseControl(this, { error: "invalid-request", reason: "resolution-id-required" }, "resolveVillageEvent");
    return runSingleFlight(this, "resolveVillageEvent", async () => {
      const result = await resolver({
        resolutionId: token,
        selections,
        context: eventContext(this, Number(model?.revision ?? this._readModel?.revision ?? 0))
      });
      return renderControlResult(this, result, "resolveVillageEvent");
    });
  }

  static async _onAbandonVillageEvent(event, target) {
    const authority = authorityFor(globalThis.game?.user);
    if (!authority.ok || authority.designatedWriter === false) {
      return refuseControl(this, authority, "abandonPendingEvent");
    }
    const data = targetData(target);
    const model = liveVillageFor(this);
    const pending = model?.pendingEvent ?? this._readModel?.pendingEvent;
    const resolutionId = String(data.resolutionId ?? pending?.resolutionId ?? "").trim();
    if (!resolutionId) {
      return refuseControl(this, { error: "invalid-request", reason: "resolution-id-required" }, "abandonPendingEvent");
    }
    const reason = data.reason ?? valueFrom(this._root(), "[name='eventAbandonReason']") ?? "ref-abandoned";
    const api = villageApi();
    const abandoner = villageApiMethod(api,
      ["abandonPendingEvent", "cancelPendingEvent", "abandonVillageEvent"], abandonPendingEvent);
    return runSingleFlight(this, "abandonPendingEvent", async () => {
      const result = await abandoner({
        resolutionId,
        reason,
        context: eventContext(this, Number(model?.revision ?? this._readModel?.revision ?? 0))
      });
      return renderControlResult(this, result, "abandonPendingEvent");
    });
  }

  /**
   * Give the Ref an explicit recovery path for a nonterminal operation that
   * blocks cycle close.  Abandonment is receipt-bearing: paid operations are
   * compensated by the saga before the blocker becomes terminal.
   */
  static async _onAdjudicateVillageOperation(event, target) {
    const authority = authorityFor(globalThis.game?.user);
    if (!authority.ok || authority.designatedWriter === false) {
      return refuseControl(this, authority, "adjudicateVillageOperation");
    }
    const data = targetData(target);
    const operation = this._blockedOperation ?? this._lastActionResult?.operation;
    const operationId = String(data.operationId ?? operation?.operationId ?? "").trim();
    if (!operationId) {
      return refuseControl(this, { error: "invalid-request", reason: "operation-id-required" }, "adjudicateVillageOperation");
    }
    const decision = String(data.decision ?? "abandon").trim().toLowerCase() || "abandon";
    const reason = data.reason ?? "ref-adjudicated";
    const api = villageApi();
    const adjudicate = villageApiMethod(api,
      ["adjudicateVillageOperation", "repairVillageOperation"], adjudicateVillageOperation);
    return runSingleFlight(this, "adjudicateVillageOperation", async () => {
      const result = await adjudicate({
        operationId,
        decision,
        reason,
        user: globalThis.game?.user,
        options: {
          ...(this.options?.sagaOptions ?? {}),
          ...(this.options?.context ?? {}),
          user: globalThis.game?.user
        }
      });
      return renderControlResult(this, result, "adjudicateVillageOperation");
    });
  }
}

export async function openVillageApplication(options = {}) {
  const application = new VillageApplication(options);
  await application.render({ force: true });
  return application;
}

export const openVillage = openVillageApplication;
export const VillageApp = VillageApplication;
export const VillageSheet = VillageApplication;
