const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

import {
  authorizePartyTransfer,
  depositDropToParty,
  depositPartyFunds,
  movePartyPurse,
  partyDropData,
  partyPurseItems,
  partyViewData,
  resolveDropActor,
  withdrawPartyFunds
} from "../helpers/party.mjs";

function t(key, data = null) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

function notify(kind, key, data = null) {
  globalThis.ui?.notifications?.[kind]?.(t(key, data));
}

function actorDocuments(collection) {
  if (Array.isArray(collection?.contents)) return [...collection.contents];
  if (collection && typeof collection.values === "function") return [...collection.values()];
  if (collection && typeof collection[Symbol.iterator] === "function") return [...collection];
  return [];
}

function actorsForSelect(party) {
  const user = globalThis.game?.user;
  return actorDocuments(globalThis.game?.actors)
    .filter(actor => actor?.type === "crow")
    .filter(actor => user?.isGM || actor?.isOwner === true || actor?.testUserPermission?.(user, "OWNER"))
    .filter(actor => actor?.uuid !== party?.uuid)
    .map(actor => ({
      uuid: actor.uuid ?? actor.id,
      name: actor.name ?? actor.id,
      id: actor.id
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function formRoot(target) {
  return target?.closest?.("form") ?? target?.form ?? null;
}

function formValue(target, name) {
  const root = formRoot(target);
  return root?.querySelector?.(`[name="${name}"]`)?.value ?? "";
}

function formAmount(target) {
  return formValue(target, "amount");
}

function portFor(sheet) {
  return sheet?.transferPort
    ?? sheet?.options?.transferPort
    ?? globalThis.game?.crows?.commerce
    ?? null;
}

function resultMessage(result) {
  if (result?.reason === "capacity-undecided") return "CROWS.Party.capacityUndecided";
  if (result?.reason === "unsupported-party-item") return "CROWS.Party.unsupportedItem";
  if (result?.reason === "unauthorized") return "CROWS.Party.unauthorized";
  if (result?.reason === "insufficient-funds") return "CROWS.Party.insufficientFunds";
  if (result?.reason === "invalid-amount") return "CROWS.Party.invalidAmount";
  if (result?.reason === "no-capacity") return "CROWS.Party.noCapacity";
  if (result?.reason === "commerce-unavailable") return "CROWS.Party.commerceUnavailable";
  if (result?.reason === "write-failed") return "CROWS.Party.writeFailed";
  return "CROWS.Party.transferFailed";
}

function reportResult(result) {
  if (result?.ok) {
    notify("info", result.operation === "withdraw"
      ? "CROWS.Party.withdrawn"
      : result.operation === "deposit"
        ? "CROWS.Party.deposited"
        : "CROWS.Party.purseMoved");
  } else {
    notify("warn", resultMessage(result));
  }
}

export class PartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "party"],
    position: { width: 620, height: "auto" },
    actions: {
      depositFunds: PartySheet._onDepositFunds,
      withdrawFunds: PartySheet._onWithdrawFunds
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = { body: { template: "systems/crows/templates/actor/party.hbs" } };

  async _prepareContext(options) {
    const base = await super._prepareContext(options);
    const ctx = base && typeof base === "object" ? base : {};
    const actor = this.document;
    const party = partyViewData(actor);
    const actors = actorsForSelect(actor);

    ctx.actor = actor;
    ctx.system = actor.system;
    ctx.party = party;
    ctx.coin = party.coin;
    ctx.purses = party.purses;
    ctx.capacity = party.capacity;
    ctx.capacityUndecided = party.capacityUndecided;
    ctx.capacityAlternatives = party.capacity.alternatives;
    ctx.unsupportedItems = party.unsupportedItems;
    ctx.crowActors = actors;
    ctx.isGM = globalThis.game?.user?.isGM === true;
    ctx.isOwner = actor.isOwner === true || ctx.isGM;
    ctx.canTransfer = party.canDeposit && party.canWithdraw;
    return ctx;
  }

  static async _onDepositFunds(event, target) {
    const authorized = authorizePartyTransfer(this.document, null, { user: globalThis.game?.user });
    if (!authorized.ok) {
      reportResult(authorized);
      return;
    }
    const sourceUuid = formValue(target, "sourceUuid");
    const source = await resolveDropActor({ actorUuid: sourceUuid });
    const result = source
      ? await depositPartyFunds(this.document, source, formAmount(target), {
        user: globalThis.game?.user,
        transferPort: portFor(this)
      })
      : { ok: false, reason: "invalid-source" };
    reportResult(result);
    if (result?.ok) await this.render();
  }

  static async _onWithdrawFunds(event, target) {
    const authorized = authorizePartyTransfer(this.document, null, { user: globalThis.game?.user });
    if (!authorized.ok) {
      reportResult(authorized);
      return;
    }
    const targetUuid = formValue(target, "targetUuid");
    const recipient = await resolveDropActor({ actorUuid: targetUuid });
    const result = recipient
      ? await withdrawPartyFunds(this.document, recipient, formAmount(target), {
        user: globalThis.game?.user,
        transferPort: portFor(this)
      })
      : { ok: false, reason: "invalid-source" };
    reportResult(result);
    if (result?.ok) await this.render();
  }

  /**
   * ActorSheetV2 dispatches Item drops here after resolving the document. A
   * Party accepts only an existing Coin Purse from an owned Crow; all other
   * item types are visibly refused and never passed to the generic clone path.
   */
  async _onDropItem(event, item) {
    const result = await movePartyPurse(this.document, item, {
      user: globalThis.game?.user,
      transferPort: portFor(this)
    });
    reportResult(result);
    if (result?.ok) await this.render();
    return result?.ok ? result.movedItem ?? item : null;
  }

  /**
   * A fund payload is explicit: it must carry a source Crow and a non-negative
   * amount. Dropping an Actor without that payload cannot silently deposit the
   * actor's whole balance.
   */
  async _onDropActor(event, actor) {
    const raw = partyDropData(event);
    const payload = actor
      ? {
        ...raw,
        actor,
        amount: event?.amount ?? event?.fundAmount ?? event?.detail?.amount ?? raw?.amount ?? raw?.fundAmount
      }
      : event;
    const result = await depositDropToParty(this.document, payload, {
      user: globalThis.game?.user,
      transferPort: portFor(this)
    });
    reportResult(result);
    if (result?.ok) await this.render();
    return result?.ok ? this.document : null;
  }

  /** Handle raw Actor drag data in Foundry versions that do not dispatch _onDropActor. */
  async _onDrop(event) {
    const data = partyDropData(event);
    const actorDrop = String(data?.type ?? "").toLowerCase() === "actor"
      || data?.actorUuid || data?.sourceUuid || data?.funds || data?.fund;
    if (actorDrop) {
      const result = await depositDropToParty(this.document, data, {
        user: globalThis.game?.user,
        transferPort: portFor(this)
      });
      reportResult(result);
      if (result?.ok) await this.render();
      return result?.ok ? this.document : null;
    }
    const result = await super._onDrop?.(event);
    return result;
  }
}

export { partyPurseItems };
