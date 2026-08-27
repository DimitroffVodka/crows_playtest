import {
  getVillageReadModel,
  createVillageProposal,
  reviewVillageProposal,
  commitVillageProposal
} from "../helpers/village-interface.mjs";
import { registerVillageChangeListener } from "../helpers/village.mjs";

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
  return target?.dataset ?? target?.closest?.("[data-village-action]")?.dataset ?? {};
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
      commitVillageProposal: VillageApplication._onCommitProposal
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
    return {
      ...(parent ?? {}),
      ...model,
      village: model,
      isRef: Boolean(globalThis.game?.user?.isGM),
      quoteInvalidated: this._quoteInvalidated,
      lastVillageMetadata: this._lastVillageMetadata
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
}

export async function openVillageApplication(options = {}) {
  const application = new VillageApplication(options);
  await application.render({ force: true });
  return application;
}

export const openVillage = openVillageApplication;
export const VillageApp = VillageApplication;
export const VillageSheet = VillageApplication;
