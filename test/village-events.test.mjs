import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultVillage, getVillage, registerVillageSettings, setVillage,
  endCycle, rollVillageEvent, resolvePendingEvent, abandonPendingEvent,
  villageEventResolutionOptions, getVillageEventReceipt
} from "../module/helpers/village.mjs";
import { grantItem } from "../module/helpers/item-grants.mjs";

let store;
let settingConfig;
let settingWrites;
let chatCalls;

const clone = value => structuredClone(value);

function installWorld(raw = defaultVillage()) {
  store = clone(raw);
  settingWrites = 0;
  chatCalls = [];
  globalThis.Hooks = { callAll: () => {} };
  globalThis.ChatMessage = { create: async data => { chatCalls.push(clone(data)); return data; } };
  globalThis.game = {
    user: { id: "gm-events", isGM: true, active: true },
    users: {
      activeGM: { id: "gm-events", isGM: true, active: true, role: 4 }
    },
    settings: {
      register: (_namespace, _key, config) => { settingConfig = config; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        settingWrites += 1;
        store = clone(value);
        settingConfig?.onChange?.(clone(store), {}, globalThis.game.user.id);
        return clone(value);
      }
    }
  };
  registerVillageSettings();
}

beforeEach(() => installWorld());

function pending(eventId, resolutionId, extra = {}) {
  return {
    eventId, id: eventId, rolled: 1, total: 0, cycle: 0, resolutionId,
    status: "pending", selection: {}, selections: {}, ...extra
  };
}

describe("durable Village event lifecycle", () => {
  test("roll persists a pending event, leaves targets unresolved, then commits once", async () => {
    const rolled = await rollVillageEvent({ rollD10: 7, operationId: "event-roll-1", silent: true });
    assert.equal(rolled.ok, true);
    assert.equal(rolled.event.id, "smallSurplus");
    assert.equal(getVillage().pendingEvent.status, "pending");
    assert.equal(getVillage().activeEffects.length, 0, "targeted effects wait for the Ref");

    const beforePick = settingWrites;
    const picker = await resolvePendingEvent({
      resolutionId: rolled.resolutionId, selections: {}, context: { user: game.user }
    });
    assert.equal(picker.ok, false);
    assert.equal(picker.error, "selection-required");
    assert.equal(picker.picker.kind, "merchant");
    assert.equal(settingWrites, beforePick, "dismissing a picker is read-only");

    const merchant = getVillage().institutions.find(institution => institution.type === "blacksmith");
    const committed = await resolvePendingEvent({
      resolutionId: rolled.resolutionId,
      selections: { institutionId: merchant.id },
      context: { user: game.user }
    });
    assert.equal(committed.ok, true);
    assert.equal(committed.phase, "committed");
    assert.equal(getVillage().pendingEvent, null);
    assert.equal(getVillage().activeEffects[0].target, merchant.id);
    const receipt = getVillageEventReceipt(rolled.resolutionId);
    assert.equal(receipt.phase, "committed");
    assert.equal(receipt.result.phase, "committed");
    assert.equal(receipt.revision, getVillage().revision);

    const retry = await resolvePendingEvent({
      resolutionId: rolled.resolutionId,
      selections: { institutionId: merchant.id },
      context: { user: game.user }
    });
    assert.equal(retry.replayed, true);
    assert.equal(settingWrites > beforePick, true);
  });

  test("endCycle records the roll and blocks a second cycle until resolution", async () => {
    const closed = await endCycle({ rollD10: 7, operationId: "cycle-close-1" });
    assert.equal(closed.ok, true);
    assert.equal(closed.cycle, 1);
    assert.equal(closed.pendingEvent.status, "pending");
    assert.equal(getVillage().activeEffects.length, 0);

    const blocked = await endCycle({ rollD10: 7, operationId: "cycle-close-2" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "event-pending");
    assert.equal(getVillage().cycle, 1);
  });
});

describe("conditional event predicates", () => {
  test("all-first-level damage opens a secondary destroy picker and cancellation writes nothing", async () => {
    const village = defaultVillage();
    const pair = village.institutions.filter(institution => ["blacksmith", "crypt"].includes(institution.type));
    pair.forEach(institution => { institution.level = 1; });
    village.pendingEvent = pending("monsterDamagesTwo", "two-1");
    installWorld(village);

    const first = await resolvePendingEvent({
      resolutionId: "two-1", selections: { institutionIds: pair.map(institution => institution.id) },
      context: { user: game.user }
    });
    assert.equal(first.error, "secondary-destroy-selection");
    assert.equal(first.picker.kind, "institution-group-destroy-one");
    assert.equal(getVillage().pendingEvent.status, "pending");
    assert.equal(getVillage().institutions.find(institution => institution.id === pair[0].id).destroyed, false);

    const committed = await resolvePendingEvent({
      resolutionId: "two-1",
      selections: { institutionIds: pair.map(institution => institution.id), destroyInstitutionId: pair[0].id },
      context: { user: game.user }
    });
    assert.equal(committed.ok, true);
    const destroyed = getVillage().institutions.find(institution => institution.id === pair[0].id);
    const survivor = getVillage().institutions.find(institution => institution.id === pair[1].id);
    assert.equal(destroyed.destroyed, true);
    assert.equal(survivor.level, 1);
  });

  test("Prosperity-floor damage requires a picker even though the row has no count", async () => {
    const village = defaultVillage();
    village.prosperity = -10;
    village.pendingEvent = pending("monsterAttackDead", "floor-1");
    installWorld(village);
    const options = villageEventResolutionOptions();
    assert.equal(options.kind, "institution-at-floor");
    const picker = await resolvePendingEvent({ resolutionId: "floor-1", context: { user: game.user } });
    assert.equal(picker.picker.kind, "institution-at-floor");
    assert.equal(getVillage().prosperity, -10);
  });
});

describe("structured event applier", () => {
  test("resolves one representative of every effect kind from structured fields", async () => {
    const cases = [
      { eventId: "monsterDestroysInstitution", selections: v => ({ institutionId: v.institutions[0].id }),
        assert: v => assert.equal(v.institutions[0].destroyed, true) },
      { eventId: "banditRaid", mutate: v => { v.institutions[0].level = 2; },
        selections: v => ({ institutionId: v.institutions[0].id }),
        assert: v => assert.equal(v.institutions[0].level, 1) },
      { eventId: "monsterAttackDead", mutate: v => { v.prosperity = -9; },
        assert: v => assert.equal(v.prosperity, -10) },
      { eventId: "smallSurplus", selections: v => ({ institutionId: v.institutions[3].id }),
        assert: v => assert.equal(v.activeEffects[0].target, v.institutions[3].id) },
      { eventId: "lowOnSupplies", selections: v => ({ institutionId: v.institutions[3].id }),
        assert: v => assert.equal(v.activeEffects[0].percent, 30) },
      { eventId: "recession", assert: v => assert.equal(v.activeEffects[0].delta, -5) },
      { eventId: "gratefulRations", recipients: true,
        assert: v => assert.equal(v.eventReceipt.normalizedEffects[0].kind, "grant") },
      { eventId: "credit100", recipients: true, selections: v => ({ institutionId: v.institutions[3].id }),
        assert: v => assert.equal(v.activeEffects[0].amountRemaining, 100) },
      { eventId: "villagersFound", selections: () => ({ institutionType: "alchemist" }),
        assert: v => assert.equal(v.institutions.some(i => i.type === "alchemist"), true) },
      { eventId: "quartersVandalized", item: true,
        assert: v => assert.equal(v.eventReceipt.normalizedEffects[0].itemId, "item-1") },
      { eventId: "artisanHiresHelp", selections: v => ({ institutionId: v.institutions[0].id }),
        assert: v => assert.equal(v.activeEffects[0].value, 2) },
      { eventId: "stewardMurdered", selections: v => ({ institutionId: v.institutions[0].id }),
        assert: v => assert.equal(v.activeEffects[0].excludeRetiredPC, true) },
      { eventId: "villagersBlamePCs", assert: v => assert.equal(v.activeEffects[0].kind, "boycott") },
      { eventId: "artisanVandalized", selections: v => ({ institutionId: v.institutions[0].id }),
        assert: v => assert.equal(v.activeEffects[0].kind, "artisanShutdown") }
    ];
    for (const [index, entry] of cases.entries()) {
      const village = defaultVillage();
      entry.mutate?.(village);
      village.pendingEvent = pending(entry.eventId, `all-kinds-${index}`);
      installWorld(village);
      let selections = entry.selections?.(village) ?? {};
      const context = { user: game.user };
      if (entry.recipients) {
        const actor = { id: "Actor.kind", uuid: "Actor.kind", items: [] };
        context.actors = new Map([[actor.uuid, actor]]);
        selections = { ...selections, recipientActorUuids: [actor.uuid] };
        context.preflightGrant = async () => ({ ok: true });
        context.grantItem = async () => ({ ok: true, phase: "committed" });
      }
      if (entry.item) {
        const item = { id: "item-1", itemClass: "mundane" };
        const actor = { id: "Actor.kind", uuid: "Actor.kind", items: new Map([[item.id, item]]) };
        context.resolveActor = async () => actor;
        context.deleteItem = async () => ({ ok: true, phase: "committed" });
        selections = { actorUuid: actor.uuid, itemId: item.id };
      }
      const result = await resolvePendingEvent({
        resolutionId: `all-kinds-${index}`, selections, context
      });
      assert.equal(result.ok, true, `${entry.eventId}: ${result.error ?? result.phase}`);
      entry.assert(getVillage());
    }
  });

  test("permanent level events absorb paid targets without refunds and clear closure promotion", async () => {
    const village = defaultVillage();
    const blacksmith = village.institutions[0];
    blacksmith.level = 3;
    blacksmith.pendingLevel = 4;
    blacksmith.pendingFromCycle = 1;
    blacksmith.pendingOperationId = "paid-absorb";
    village.operationJournal = [{ operationId: "paid-absorb", phase: "commerce-committed", result: { ok: true } }];
    village.pendingEvent = pending("profitableCycle", "absorb-1");
    installWorld(village);
    const absorbed = await resolvePendingEvent({
      resolutionId: "absorb-1", selections: { institutionId: blacksmith.id }, context: { user: game.user }
    });
    assert.equal(absorbed.ok, true);
    assert.equal(getVillage().institutions[0].level, 4);
    assert.equal(getVillage().institutions[0].pendingLevel, null);
    assert.equal(getVillage().operationJournal.find(e => e.operationId === "paid-absorb").result.pendingDisposition,
      "fulfilled-by-event");

    const closing = defaultVillage();
    const closingBlacksmith = closing.institutions[0];
    closingBlacksmith.pendingLevel = 2;
    closingBlacksmith.pendingFromCycle = 1;
    closingBlacksmith.pendingOperationId = "paid-close";
    closing.operationJournal = [{ operationId: "paid-close", phase: "commerce-committed", result: { ok: true } }];
    closing.pendingEvent = pending("banditRaid", "closure-1");
    installWorld(closing);
    const closed = await resolvePendingEvent({
      resolutionId: "closure-1", selections: { institutionId: closingBlacksmith.id }, context: { user: game.user }
    });
    assert.equal(closed.ok, true);
    assert.equal(getVillage().institutions[0].destroyed, true);
    assert.equal(getVillage().institutions[0].pendingLevel, null);
    assert.equal(getVillage().operationJournal.find(e => e.operationId === "paid-close").result.pendingDisposition,
      "superseded-by-destruction");
  });
});

describe("event grant saga", () => {
  test("a real top-level grant resolves the event, delivers its per-PC quantity, and reaches a terminal phase", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("gratefulRations", "grant-real-1");
    installWorld(village);

    const ration = {
      id: "ration-source",
      uuid: "Compendium.crows.crows-consumables.Item.ration-source",
      name: "Ration",
      type: "consumable",
      system: { slots: 1, stackMax: 6, quantity: 1 }
    };
    const rationPack = {
      index: { contents: [{ _id: ration.id, name: ration.name }] },
      async getDocument(id) { return id === ration.id ? ration : null; }
    };
    const actor = {
      id: "event-crow",
      uuid: "Actor.event-crow",
      type: "crow",
      isOwner: true,
      items: [],
      system: { commerce: { revision: 0, receipts: {} } },
      async update(changes) {
        if (changes["system.commerce"]) this.system.commerce = structuredClone(changes["system.commerce"]);
        return this;
      },
      async createEmbeddedDocuments(documentName, documents) {
        const created = documents.map((document, index) => ({
          ...structuredClone(document),
          id: document.id ?? document._id ?? `${this.id}-item-${this.items.length + index + 1}`
        }));
        if (documentName === "Item") this.items.push(...created);
        return created;
      }
    };
    game.actors = new Map([[actor.uuid, actor]]);
    game.packs = new Map([["crows.crows-consumables", rationPack]]);
    // The live API exposes grants at game.crows.grantItem, not under
    // game.crows.commerce. This deliberately exercises that production seam.
    game.crows = { grantItem };

    const result = await resolvePendingEvent({
      resolutionId: "grant-real-1",
      selections: { recipientActorUuids: [actor.uuid] },
      context: { user: game.user, actors: game.actors }
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.phase, "committed");
    assert.equal(getVillage().pendingEvent, null);
    assert.equal(actor.items.length, 1);
    assert.equal(actor.items[0].name, "Ration");
    assert.equal(actor.items[0].system.quantity, 6);
    assert.equal(actor.system.commerce.revision, 1);
    const receipt = getVillageEventReceipt("grant-real-1");
    assert.equal(receipt.phase, "committed");
    assert.equal(receipt.childResults[0].phase, "committed");
    assert.deepEqual(receipt.childResults[0].result.itemIds, [actor.items[0].id]);
    assert.equal(actor.system.commerce.receipts["grant-real-1:grant:Actor.event-crow"].expectedRevision, 0);
    assert.equal(receipt.childResults[0].result.items, undefined,
      "the Village receipt keeps an item identity, not a live Actor graph");
    const retry = await resolvePendingEvent({
      resolutionId: "grant-real-1",
      selections: { recipientActorUuids: [actor.uuid] },
      context: { user: game.user, actors: game.actors }
    });
    assert.equal(retry.replayed, true);
    assert.equal(actor.items.length, 1, "the deterministic child token prevents a duplicate grant");
  });

  test("preflights the complete roster and distinguishes partial repair", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("gratefulRations", "grant-1");
    installWorld(village);
    const actors = new Map([
      ["Actor.a", { id: "Actor.a", uuid: "Actor.a", items: [] }],
      ["Actor.b", { id: "Actor.b", uuid: "Actor.b", items: [] }]
    ]);
    const calls = [];
    let fail = true;
    const context = {
      user: game.user,
      actors,
      preflightGrant: async actor => {
        calls.push(`preflight:${actor.uuid}`);
        return { ok: true };
      },
      grantItem: async (actor, source, metadata) => {
        calls.push(`grant:${actor.uuid}`);
        if (actor.uuid === "Actor.b" && fail) return { ok: false, error: "no-capacity" };
        return { ok: true, phase: "committed", commerceTxId: metadata.txId };
      }
    };
    const first = await resolvePendingEvent({
      resolutionId: "grant-1",
      selections: { recipientActorUuids: ["Actor.b", "Actor.a"] },
      context
    });
    assert.equal(first.ok, false);
    assert.equal(first.phase, "partial");
    assert.equal(getVillage().pendingEvent.status, "partial");
    assert.deepEqual(calls.slice(0, 2), ["preflight:Actor.a", "preflight:Actor.b"]);
    assert.deepEqual(calls.slice(2), ["grant:Actor.a", "grant:Actor.b"]);
    assert.deepEqual(first.childResults.map(child => [child.actorUuid, child.phase]), [
      ["Actor.a", "committed"], ["Actor.b", "refused"]
    ], "partial results expose both the committed and refused recipients");

    fail = false;
    const repaired = await resolvePendingEvent({
      resolutionId: "grant-1",
      selections: { recipientActorUuids: ["Actor.b", "Actor.a"] },
      context
    });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.phase, "committed");
    assert.equal(getVillage().pendingEvent, null);
    assert.deepEqual(calls.slice(-1), ["grant:Actor.b"], "the committed child is never replayed");
  });

  test("an unavailable Commerce grant blocks before any child write", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("healingPotions", "grant-2");
    installWorld(village);
    const actor = { id: "Actor.a", uuid: "Actor.a", items: [] };
    const result = await resolvePendingEvent({
      resolutionId: "grant-2", selections: { recipientActorUuids: [actor.uuid] },
      context: { user: game.user, actors: new Map([[actor.uuid, actor]]) }
    });
    assert.equal(result.ok, false);
    assert.equal(result.phase, "blocked");
    assert.equal(getVillage().pendingEvent.status, "blocked");
    assert.equal(getVillageEventReceipt("grant-2").phase, "blocked");
  });

  test("preflight probes every recipient before reporting the first refusal", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("gratefulRations", "grant-preflight-all");
    installWorld(village);
    const actors = new Map([
      ["Actor.a", { id: "Actor.a", uuid: "Actor.a", items: [] }],
      ["Actor.b", { id: "Actor.b", uuid: "Actor.b", items: [] }]
    ]);
    const calls = [];
    const result = await resolvePendingEvent({
      resolutionId: "grant-preflight-all",
      selections: { recipientActorUuids: ["Actor.b", "Actor.a"] },
      context: {
        user: game.user,
        actors,
        preflightGrant: async actor => {
          calls.push(actor.uuid);
          return actor.uuid === "Actor.a" ? { ok: false, error: "no-capacity" } : { ok: true };
        },
        grantItem: async () => {
          throw new Error("grant must not run after preflight refusal");
        }
      }
    });
    assert.equal(result.phase, "blocked");
    assert.deepEqual(calls, ["Actor.a", "Actor.b"]);
    assert.equal(getVillage().pendingEvent.status, "blocked");
  });

  test("a lost progress acknowledgement is durable uncertain state and retries the same child id", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("gratefulRations", "grant-progress-uncertain");
    installWorld(village);
    const actor = { id: "Actor.a", uuid: "Actor.a", items: [] };
    const calls = [];
    const originalSet = game.settings.set;
    let failNext = false;
    game.settings.set = async (...args) => {
      if (failNext) {
        failNext = false;
        throw new Error("progress acknowledgement lost");
      }
      return originalSet(...args);
    };
    const context = {
      user: game.user,
      actors: new Map([[actor.uuid, actor]]),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async (_actor, _source, metadata) => {
        calls.push(metadata.grantId);
        failNext = true;
        return { ok: true, phase: "committed", commerceTxId: metadata.txId };
      }
    };
    const uncertain = await resolvePendingEvent({
      resolutionId: "grant-progress-uncertain",
      selections: { recipientActorUuids: [actor.uuid] }, context
    });
    assert.equal(uncertain.ok, false);
    assert.equal(uncertain.phase, "uncertain");
    assert.equal(getVillage().pendingEvent.status, "uncertain");
    assert.equal(getVillageEventReceipt("grant-progress-uncertain").phase, "uncertain");

    const repaired = await resolvePendingEvent({
      resolutionId: "grant-progress-uncertain",
      selections: { recipientActorUuids: [actor.uuid] }, context
    });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.phase, "committed");
    assert.deepEqual(calls, ["grant-progress-uncertain:grant:Actor.a"],
      "the uncertain child is retried by its original id only after the failed progress write");
  });

  test("a final setting acknowledgement lost after commit does not replay local effects", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("gratefulRations", "grant-final-uncertain");
    installWorld(village);
    const actor = { id: "Actor.a", uuid: "Actor.a", items: [] };
    const originalSet = game.settings.set;
    let writes = 0;
    let grantCalls = 0;
    game.settings.set = async (...args) => {
      writes += 1;
      const value = await originalSet(...args);
      if (writes === 3) throw new Error("final acknowledgement lost after commit");
      return value;
    };
    const context = {
      user: game.user,
      actors: new Map([[actor.uuid, actor]]),
      preflightGrant: async () => ({ ok: true }),
      grantItem: async () => {
        grantCalls += 1;
        return { ok: true, phase: "committed" };
      }
    };
    const uncertain = await resolvePendingEvent({
      resolutionId: "grant-final-uncertain",
      selections: { recipientActorUuids: [actor.uuid] }, context
    });
    assert.equal(uncertain.ok, false);
    assert.equal(uncertain.phase, "uncertain");
    assert.equal(getVillage().pendingEvent, null, "the final snapshot landed before its acknowledgement was lost");
    assert.equal(getVillageEventReceipt("grant-final-uncertain").phase, "committed");

    const replay = await resolvePendingEvent({
      resolutionId: "grant-final-uncertain",
      selections: { recipientActorUuids: [actor.uuid] }, context
    });
    assert.equal(replay.replayed, true);
    assert.equal(grantCalls, 1);
  });
});

describe("event founding and explicit abandonment", () => {
  test("item deletion re-resolves the parent Actor immediately before the child write", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("quartersVandalized", "delete-reresolve-1");
    installWorld(village);
    const item = { id: "item-1", name: "Rope", itemClass: "fine" };
    const actor = { id: "Actor.a", uuid: "Actor.a", items: new Map([[item.id, item]]) };
    let resolves = 0;
    let deletedActor = null;
    const result = await resolvePendingEvent({
      resolutionId: "delete-reresolve-1",
      selections: { actorUuid: actor.uuid, itemId: item.id },
      context: {
        user: game.user,
        resolveActor: async () => { resolves += 1; return actor; },
        deleteItem: async (parent, embedded, metadata) => {
          deletedActor = parent;
          parent.items.delete(embedded.id);
          return { ok: true, phase: "committed", deleteId: metadata.deleteId };
        }
      }
    });
    assert.equal(result.ok, true);
    assert.equal(deletedActor, actor);
    assert.equal(resolves >= 2, true);
    assert.equal(actor.items.has(item.id), false);
    assert.equal(getVillageEventReceipt("delete-reresolve-1").normalizedEffects[0].target,
      `${actor.uuid}:${item.id}`);
  });

  test("villagers found a unique type without paid-founding side effects", async () => {
    const village = defaultVillage();
    const tombstone = village.institutions.find(institution => institution.type === "blacksmith");
    tombstone.destroyed = true;
    tombstone.destroyedOnCycle = 0;
    village.prosperity = 3;
    village.activeEffects = [{ kind: "boycott" }];
    village.pendingEvent = pending("villagersFound", "found-1");
    installWorld(village);
    const result = await resolvePendingEvent({
      resolutionId: "found-1",
      selections: { institutionType: "blacksmith" },
      context: { user: game.user }
    });
    assert.equal(result.ok, true);
    const revived = getVillage().institutions.find(institution => institution.type === "blacksmith");
    assert.equal(revived.id, tombstone.id);
    assert.equal(revived.destroyed, false);
    assert.equal(revived.operatingFromCycle, 1);
    assert.equal(getVillage().prosperity, 3);
    assert.equal(getVillage().activeEffects[0].kind, "boycott");
  });

  test("the Prosperity cap branch records a sale effect and still counts as a raising event", async () => {
    const village = defaultVillage();
    village.prosperity = 10;
    village.pendingEvent = pending("prosperousCycle", "prosperity-cap-1");
    installWorld(village);
    const result = await resolvePendingEvent({
      resolutionId: "prosperity-cap-1", context: { user: game.user }
    });
    assert.equal(result.ok, true);
    assert.equal(getVillage().prosperity, 10);
    assert.equal(getVillage().raisingEventThisCycle, true);
    assert.equal(getVillage().activeEffects[0].kind, "sellPercentage");
    assert.equal(getVillage().activeEffects[0].delta, 10);
  });

  test("abandoning a blocked event consumes it and leaves an audit receipt", async () => {
    const village = defaultVillage();
    village.pendingEvent = pending("healingPotions", "abandon-1");
    installWorld(village);
    const actor = { id: "Actor.a", uuid: "Actor.a", items: [] };
    const blocked = await resolvePendingEvent({
      resolutionId: "abandon-1", selections: { recipientActorUuids: [actor.uuid] },
      context: { user: game.user, actors: new Map([[actor.uuid, actor]]) }
    });
    assert.equal(blocked.phase, "blocked");
    const abandoned = await abandonPendingEvent({
      resolutionId: "abandon-1", reason: "ref-adjudicated", context: { user: game.user }
    });
    assert.equal(abandoned.ok, true);
    assert.equal(abandoned.phase, "abandoned");
    assert.equal(getVillage().pendingEvent, null);
    assert.equal(getVillageEventReceipt("abandon-1").phase, "abandoned");
  });
});
