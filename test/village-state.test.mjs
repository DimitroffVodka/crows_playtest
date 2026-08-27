/**
 * Foundry-facing Village state probes.
 *
 * The pure Village table tests intentionally omit game/settings/Hooks.  These
 * probes provide the smallest setting/document-shaped harness needed to test
 * the state boundary itself: reads are owned clones, save owns the one change
 * notification, and the journal survives a client/module reload.  The fake
 * setting callback invokes onChange synchronously, matching Foundry v14's
 * Setting._onUpdate boundary; a delayed callback would be a different platform
 * contract rather than a reason to reintroduce an either-order dispatcher.
 */

import "./shim/foundry.mjs";
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultVillage, getVillage, setVillage, saveVillage,
  registerVillageSettings, migrateVillageState,
  damageInstitution, getInstitution, getInstitutionLevel,
  itemAvailability, upgradeInstitution,
  recordSpend,
  liveInstitutionRecords, effectiveInstitutionLevel,
  enqueueVillageOperation, villageInputFingerprint,
  rollVillageEvent, resolvePendingEvent, getVillageEventReceipt
} from "../module/helpers/village.mjs";

let settingConfig;
let store;
let designatedId;
let settingWrites;
let changeCalls;
let chatCalls;
let failSettingWrite;

const clone = value => structuredClone(value);

function installWorld(raw = null) {
  store = clone(raw ?? defaultVillage());
  designatedId = "gm-a";
  settingWrites = 0;
  changeCalls = [];
  chatCalls = [];
  failSettingWrite = false;
  globalThis.Hooks = {
    callAll: (name, ...args) => changeCalls.push({ name, args: clone(args) })
  };
  globalThis.ChatMessage = {
    create: async data => { chatCalls.push(clone(data)); return data; }
  };
  globalThis.game = {
    user: { id: "gm-a", isGM: true, active: true },
    users: {
      get activeGM() {
        return designatedId ? { id: designatedId, isGM: true, active: true, role: 4 } : null;
      }
    },
    settings: {
      register: (_namespace, _key, data) => { settingConfig = data; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        settingWrites += 1;
        if (failSettingWrite) throw new Error("setting write rejected");
        store = clone(value);
        // Foundry calls the registered callback inside the successful update.
        settingConfig?.onChange?.(clone(store), {}, globalThis.game.user.id);
        return clone(value);
      }
    }
  };
  registerVillageSettings();
}

beforeEach(() => installWorld());

describe("normalized Village setting boundary", () => {
  test("default records carry durable identity, receipt, and journal fields", () => {
    const village = defaultVillage();
    assert.match(village.villageId, /^village-/);
    assert.equal(typeof village.sceneSeed, "string");
    assert.equal(village.revision, 0);
    assert.equal(village.sceneId, null);
    assert.deepEqual(village.bootstrap, { txId: null, phase: "prepared", candidateSceneId: null });
    assert.deepEqual(village.auctionLots, []);
    assert.deepEqual(village.operationJournal, []);
    assert.equal(village.institutions[0].destroyed, false);
    assert.deepEqual(village.eventReceipts, []);
    assert.equal(village.eventReceipt, null);
  });

  test("legacy identity is stable across reads and persists through the shared migration", async () => {
    const legacy = defaultVillage();
    delete legacy.villageId;
    delete legacy.sceneSeed;
    delete legacy.revision;
    delete legacy.sceneId;
    delete legacy.bootstrap;
    delete legacy.auctionLots;
    delete legacy.operationJournal;
    legacy.name = "Legacy Home";
    installWorld(legacy);

    const first = getVillage();
    const second = getVillage();
    assert.equal(first.villageId, second.villageId);
    assert.equal(first.sceneSeed, second.sceneSeed);
    assert.equal(store.villageId, undefined, "a read must not silently write migration state");

    const migrated = await migrateVillageState({ operationId: "migration-1" });
    assert.equal(migrated.ok, true);
    assert.equal(migrated.migrated, true);
    assert.equal(store.villageId, first.villageId);
    assert.equal(store.sceneSeed, first.sceneSeed);
    assert.equal(store.revision, 0, "identity migration starts the observation revision at zero");
    assert.equal(store.name, "Legacy Home");
  });

  test("getVillage isolates nested state and save emits one owned prev/next pair", async () => {
    const original = getVillage();
    const read = getVillage();
    read.institutions[0].name = "mutated read";
    read.activeEffects.push({ kind: "local-only" });
    assert.equal(store.institutions[0].name, original.institutions[0].name);
    assert.deepEqual(store.activeEffects, original.activeEffects);

    const next = await setVillage({ name: "Changed Home" }, { operationId: "rename-1" });
    assert.equal(changeCalls.length, 1);
    assert.equal(changeCalls[0].name, "crowsVillageChanged");
    const [hookNext, hookPrev, metadata] = changeCalls[0].args;
    assert.equal(hookPrev.name, original.name);
    assert.equal(hookNext.name, "Changed Home");
    assert.equal(hookNext.revision, original.revision + 1);
    assert.equal(metadata.operationId, "rename-1");
    const observedPrev = clone(hookPrev);

    // Mutating any returned/notification object cannot falsify persisted state
    // or a previous snapshot retained by another consumer.
    next.institutions[0].name = "caller changed result";
    hookNext.institutions[0].name = "listener changed next";
    hookPrev.institutions[0].name = "listener changed prev";
    assert.equal(store.institutions[0].name, original.institutions[0].name);
    assert.equal(observedPrev.institutions[0].name, original.institutions[0].name);
  });

  test("a failed setting write emits no Village change hook", async () => {
    failSettingWrite = true;
    await assert.rejects(() => setVillage({ name: "should not land" }));
    assert.equal(changeCalls.length, 0);
    assert.equal(store.name, "Unnamed Village");
  });

  test("a remote setting update dispatches once with the cached previous state", async () => {
    await setVillage({ name: "Before Remote" }, { operationId: "local-before-remote" });
    changeCalls = [];
    const remote = clone(store);
    remote.name = "After Remote";
    remote.revision += 1;
    settingConfig.onChange(remote, { operationId: "remote-op" }, "gm-b");
    assert.equal(changeCalls.length, 1);
    const [next, prev, metadata] = changeCalls[0].args;
    assert.equal(next.name, "After Remote");
    assert.equal(prev.name, "Before Remote");
    assert.equal(metadata.remote, true);
    assert.equal(metadata.sourceUserId, "gm-b");
  });
});

describe("institution tombstones", () => {
  test("destruction preserves id/name/steward and all live service lookups skip it", async () => {
    const original = getVillage();
    const blacksmith = original.institutions.find(institution => institution.type === "blacksmith");
    blacksmith.steward = "Mara";
    installWorld(original);

    const result = await damageInstitution(blacksmith.id, {
      resolutionId: "event-1", resolutionMetadata: { source: "test" }, operationId: "damage-1"
    });
    assert.equal(result.ok, true);
    assert.equal(result.destroyed, true);
    assert.equal(result.institution.id, blacksmith.id);
    assert.equal(result.institution.name, blacksmith.name);
    assert.equal(result.institution.steward, "Mara");
    assert.equal(result.institution.destroyedOnCycle, 0);
    assert.equal(result.institution.destruction.resolutionId, "event-1");

    const ruin = getInstitution(blacksmith.id);
    assert.equal(ruin.destroyed, true, "id lookup remains available for ruins/map projection");
    assert.equal(getInstitutionLevel("blacksmith"), 0);
    assert.equal(effectiveInstitutionLevel(ruin, { cycle: 0 }).level, 0);
    assert.equal(itemAvailability("blacksmith", 4, { institutionRecord: ruin }).available, false);
    assert.equal((await upgradeInstitution(blacksmith.id)).error, "institution-destroyed");
    assert.equal(liveInstitutionRecords().some(institution => institution.id === blacksmith.id), false);
  });

  test("a surviving record of the same type still wins type lookup over an earlier tombstone", async () => {
    const village = defaultVillage();
    const blacksmith = village.institutions.find(institution => institution.type === "blacksmith");
    blacksmith.destroyed = true;
    village.institutions.push({
      ...blacksmith, id: "blacksmith-survivor", destroyed: false, level: 2, steward: "new steward"
    });
    installWorld(village);
    assert.equal(getInstitutionLevel("blacksmith"), 2);
    assert.deepEqual(liveInstitutionRecords().filter(i => i.type === "blacksmith").map(i => i.id), ["blacksmith-survivor"]);
  });
});

describe("Village operation queue and journal", () => {
  test("recordSpend is idempotent under the parent Village operation token", async () => {
    await setVillage({ operationJournal: [{
      operationId: "spend-idempotent",
      action: "merchant-purchase",
      originCycle: 0,
      phase: "spend-pending",
      inputFingerprint: "spend-idempotent"
    }] }, { operationId: "seed-spend-operation" });
    const first = await recordSpend(100, { operationId: "spend-idempotent", silent: true });
    const writes = settingWrites;
    const second = await recordSpend(100, { operationId: "spend-idempotent", silent: true });
    assert.equal(first.spentThisCycle, 100);
    assert.equal(second.spentThisCycle, 100);
    assert.equal(getVillage().spentThisCycle, 100);
    assert.equal(settingWrites, writes, "a lost spend acknowledgement must not count twice");
  });

  test("commits a terminal token once and returns its persisted result on retry", async () => {
    const before = getVillage();
    const input = { action: "rename", name: "Queue Home" };
    const first = await enqueueVillageOperation({
      operationId: "op-1",
      villageId: before.villageId,
      expectedRevision: before.revision,
      inputFingerprint: villageInputFingerprint(input),
      childOperationIds: ["child-1"],
      terminalResult: { ok: true, value: 42 }
    });
    assert.equal(first.ok, true);
    assert.equal(first.value, 42);
    assert.equal(getVillage().operationJournal.length, 1);
    assert.equal(getVillage().operationJournal[0].phase, "committed");
    const writesAfterFirst = settingWrites;

    const retry = await enqueueVillageOperation({
      operationId: "op-1",
      villageId: before.villageId,
      expectedRevision: before.revision,
      inputFingerprint: villageInputFingerprint(input),
      terminalResult: { ok: true, value: 999 }
    });
    assert.equal(retry.replayed, true);
    assert.equal(retry.value, 42);
    assert.equal(settingWrites, writesAfterFirst, "terminal replay is read-only");

    const conflict = await enqueueVillageOperation({
      operationId: "op-1",
      villageId: before.villageId,
      expectedRevision: before.revision,
      inputFingerprint: villageInputFingerprint({ action: "different" }),
      terminalResult: { ok: true }
    });
    assert.equal(conflict.error, "duplicate");
  });

  test("persist false is an additive read-only queue escape hatch", async () => {
    const before = getVillage();
    const writesBefore = settingWrites;
    const result = await enqueueVillageOperation({
      operationId: "picker-cancel-1", villageId: before.villageId,
      expectedRevision: before.revision, inputFingerprint: "picker-cancel",
      persist: false,
      execute: async () => ({ persist: false, result: { ok: false, error: "selection-required" } })
    });
    assert.deepEqual(result, { ok: false, error: "selection-required" });
    assert.equal(settingWrites, writesBefore);
    assert.deepEqual(getVillage().operationJournal, []);
  });

  test("rejects a stale new token and refuses when no active designated GM exists", async () => {
    const before = getVillage();
    const stale = await enqueueVillageOperation({
      operationId: "stale-1", villageId: before.villageId, expectedRevision: before.revision + 1,
      inputFingerprint: "stale", terminalResult: { ok: true }
    });
    assert.equal(stale.error, "conflict");
    assert.equal(stale.reason, "stale-revision");
    assert.equal(settingWrites, 0);

    designatedId = null;
    const unavailable = await enqueueVillageOperation({
      operationId: "nogm-1", villageId: before.villageId, expectedRevision: before.revision,
      inputFingerprint: "no-gm", terminalResult: { ok: true }
    });
    assert.equal(unavailable.error, "authority-unavailable");
    assert.equal(settingWrites, 0);
  });

  test("re-resolves revision after an awaited executor before writing", async () => {
    const before = getVillage();
    const result = await enqueueVillageOperation({
      operationId: "late-stale-1", villageId: before.villageId, expectedRevision: before.revision,
      inputFingerprint: "late-stale", execute: async ({ village }) => {
        await setVillage({ name: "remote winner" }, { operationId: "remote-winner" });
        return { next: { ...village, name: "stale overwrite" }, result: { ok: true } };
      }
    });
    assert.equal(result.error, "conflict");
    assert.equal(result.reason, "stale-revision");
    assert.equal(getVillage().name, "remote winner");
  });

  test("the terminal journal remains available after a simulated reload", async () => {
    const before = getVillage();
    const request = {
      operationId: "reload-1", villageId: before.villageId, expectedRevision: before.revision,
      inputFingerprint: "reload-token", terminalResult: { ok: true, persisted: "yes" }
    };
    const first = await enqueueVillageOperation(request);
    assert.equal(first.persisted, "yes");
    const persisted = clone(store);
    installWorld(persisted);
    const retry = await enqueueVillageOperation({ ...request, terminalResult: { ok: true, persisted: "no" } });
    assert.equal(retry.replayed, true);
    assert.equal(retry.persisted, "yes");
  });

  test("retains recent-cycle terminals and prunes only older terminal evidence", async () => {
    let revision = getVillage().revision;
    for (let index = 0; index < 105; index += 1) {
      const result = await enqueueVillageOperation({
        operationId: `old-${index}`, villageId: getVillage().villageId,
        expectedRevision: revision, inputFingerprint: `old-fingerprint-${index}`,
        originCycle: -100, terminalResult: { ok: true, index }
      });
      assert.equal(result.ok, true);
      revision = getVillage().revision;
    }
    assert.equal(getVillage().operationJournal.length, 100);
    assert.equal(getVillage().operationJournal[0].operationId, "old-5");
  });

  test("reports reconciliation when the active GM changes across the write", async () => {
    const originalSet = game.settings.set;
    game.settings.set = async (...args) => {
      const result = await originalSet(...args);
      designatedId = "gm-b";
      return result;
    };
    const before = getVillage();
    const result = await enqueueVillageOperation({
      operationId: "handover-1", villageId: before.villageId, expectedRevision: before.revision,
      inputFingerprint: "handover", terminalResult: { ok: true }
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "write-failed");
    assert.equal(result.reconciliationRequired, true);
    assert.equal(result.state, "unknown");
    assert.equal(getVillage().operationJournal[0].phase, "committed");
  });

  test("event resolution persists a receipt beside the normalized Village state", async () => {
    const rolled = await rollVillageEvent({ rollD10: 7, operationId: "state-event-roll", silent: true });
    assert.equal(rolled.ok, true);
    assert.equal(getVillage().pendingEvent.resolutionId, rolled.resolutionId);
    const merchant = getVillage().institutions.find(institution => institution.type === "blacksmith");
    const resolved = await resolvePendingEvent({
      resolutionId: rolled.resolutionId,
      selections: { institutionId: merchant.id },
      context: { user: game.user }
    });
    assert.equal(resolved.ok, true);
    assert.equal(getVillage().pendingEvent, null);
    assert.equal(getVillage().eventReceipt.resolutionId, rolled.resolutionId);
    assert.equal(getVillageEventReceipt(rolled.resolutionId).phase, "committed");
  });
});
