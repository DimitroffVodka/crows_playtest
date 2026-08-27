import "./shim/foundry.mjs";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  defaultVillage,
  registerVillageSettings,
  endCycle,
  rollVillageEvent
} from "../module/helpers/village.mjs";
import {
  VillageApplication,
  describeVillageControlResult
} from "../module/applications/village.mjs";
import { villageCommitAuthority } from "../module/helpers/village-interface.mjs";

let store;
let settingConfig;
let api;

function clone(value) {
  return structuredClone(value);
}

function installWorld(raw = defaultVillage(), { user = null, overrides = {} } = {}) {
  store = clone(raw);
  const currentUser = user ?? { id: "gm-a", isGM: true, active: true, role: 4 };
  globalThis.Hooks = { callAll: () => {} };
  globalThis.game = {
    user: currentUser,
    users: {
      get activeGM() {
        return { id: "gm-a", isGM: true, active: true, role: 4 };
      }
    },
    settings: {
      register: (_namespace, _key, data) => { settingConfig = data; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        store = clone(value);
        settingConfig?.onChange?.(clone(store), {}, globalThis.game.user.id);
        return clone(value);
      }
    }
  };
  api = {
    get: () => clone(store),
    commitAuthority: villageCommitAuthority,
    endCycle,
    rollEvent: rollVillageEvent,
    ...overrides
  };
  globalThis.game.crows = { village: api };
  registerVillageSettings();
}

function quietApp(options = {}) {
  const app = new VillageApplication(options);
  app.render = async () => app;
  return app;
}

beforeEach(() => installWorld());
afterEach(() => {
  delete globalThis.game;
  delete globalThis.Hooks;
});

describe("Village cycle controls", () => {
  test("non-authoritative users receive no controls and a direct handler call is refused", async () => {
    globalThis.game.user = { id: "player-a", isGM: false, active: true };
    const calls = [];
    api.endCycle = async request => { calls.push(request); return { ok: true }; };
    const app = quietApp();

    // Regression: the Village sheet must not turn a hidden control into a
    // client-side permission bypass.
    const context = await app._prepareContext();
    assert.equal(context.cycleControls.visible, false);
    assert.equal(context.canCommit, false);

    const result = await VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "ref-required");
    assert.equal(calls.length, 0, "the hidden button's handler still re-checks authority");
    await app.close();
  });

  test("a blocked end-cycle renders the blocking operation identity, action, and phase", async () => {
    const blocked = {
      operationId: "purchase-stuck-42",
      action: "upgrade",
      phase: "commerce-committed"
    };
    store.operationJournal = [blocked];
    const app = quietApp();

    // Regression: a commerce-committed purchase once left the Ref with a dead
    // cycle button and no way to discover the blocking journal entry.
    const result = await VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    assert.equal(result.ok, false);
    assert.equal(result.operation.operationId, blocked.operationId);
    assert.equal(result.operation.action, blocked.action);
    assert.equal(result.operation.phase, blocked.phase);

    const context = await app._prepareContext();
    assert.match(context.actionNotice.message, /purchase-stuck-42/);
    assert.match(context.actionNotice.message, /upgrade/);
    assert.match(context.actionNotice.message, /commerce-committed/);
    assert.match(describeVillageControlResult(result).message, /Repair or adjudicate/);
    await app.close();
  });

  test("rolling on top of an unresolved pending event is refused", async () => {
    store.pendingEvent = {
      eventId: "banditRaid",
      id: "banditRaid",
      rolled: 3,
      total: -7,
      cycle: store.cycle,
      resolutionId: "event-open-1",
      status: "pending",
      selection: {},
      selections: {}
    };
    const before = clone(store.pendingEvent);
    const app = quietApp();

    // Regression: rolling from the UI must not overwrite the pending event
    // whose target choices the Ref still needs to resolve.
    const result = await VillageApplication._onRollEvent.call(app, {}, { dataset: {} });
    assert.equal(result.ok, false);
    assert.equal(result.error, "event-pending");
    assert.deepEqual(store.pendingEvent, before);
    const context = await app._prepareContext();
    assert.equal(context.pendingEvent.resolutionId, "event-open-1");
    assert.equal(context.resolutionOptions.selectionKey, "institutionIds");
    assert.equal(context.cycleControls.visible, true);
    await app.close();
  });

  test("a double-click shares one explicit end-cycle operation token", async () => {
    let calls = 0;
    let request;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    api.endCycle = async value => {
      calls += 1;
      request = value;
      await pending;
      return { ok: true, cycle: 1 };
    };
    const app = quietApp();

    // Regression: two clicks during an ApplicationV2 render race must not
    // advance two cycles.
    const first = VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    const second = VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(typeof request.operationId, "string");
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(one, two);
    assert.match(request.operationId, /^village-ui-end-cycle:/);
    await app.close();
  });

  test("a failed end-cycle retry keeps its token after the journal advances revision", async () => {
    const requests = [];
    api.endCycle = async request => {
      requests.push(request);
      if (requests.length === 1) {
        // Regression: the failure journal write bumps revision, but must not
        // strand the operation behind a freshly minted retry token.
        store.revision += 1;
        store.operationJournal = [{
          operationId: request.operationId,
          action: "end-cycle",
          phase: "uncertain",
          inputFingerprint: "cycle-input"
        }];
        return {
          ok: false,
          error: "write-failed",
          phase: "uncertain",
          operation: store.operationJournal[0]
        };
      }
      return { ok: false, error: "write-failed", phase: "uncertain", operation: store.operationJournal[0] };
    };
    const app = quietApp();

    await VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    await VillageApplication._onEndCycle.call(app, {}, { dataset: {} });
    assert.equal(requests.length, 2);
    assert.equal(requests[0].operationId, requests[1].operationId);
    assert.equal(requests[1].expectedRevision, 1, "the retry still checks the live revision");
    await app.close();
  });

  test("pending-event controls pass the stable resolution and selected targets to the Village API", async () => {
    const blacksmith = store.institutions.find(entry => entry.type === "blacksmith");
    store.pendingEvent = {
      eventId: "banditRaid",
      id: "banditRaid",
      rolled: 3,
      total: -7,
      cycle: store.cycle,
      resolutionId: "event-open-2",
      status: "pending",
      selection: {},
      selections: {}
    };
    let resolutionRequest;
    let abandonRequest;
    api.resolvePendingEvent = async request => {
      resolutionRequest = request;
      return { ok: true, phase: "committed", resolutionId: request.resolutionId };
    };
    api.abandonPendingEvent = async request => {
      abandonRequest = request;
      return { ok: true, phase: "abandoned", resolutionId: request.resolutionId };
    };
    const app = quietApp();

    const resolved = await VillageApplication._onResolveVillageEvent.call(app, {}, {
      dataset: {
        resolutionId: "event-open-2",
        selections: JSON.stringify({ institutionIds: [blacksmith.id] })
      }
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolutionRequest.resolutionId, "event-open-2");
    assert.deepEqual(resolutionRequest.selections, { institutionIds: [blacksmith.id] });
    assert.equal(resolutionRequest.context.isGM, true);

    const abandoned = await VillageApplication._onAbandonVillageEvent.call(app, {}, {
      dataset: { resolutionId: "event-open-2", reason: "Ref chose to defer" }
    });
    assert.equal(abandoned.ok, true);
    assert.equal(abandonRequest.resolutionId, "event-open-2");
    assert.equal(abandonRequest.reason, "Ref chose to defer");
    await app.close();
  });

  test("blocker recovery carries the stuck operation id into adjudication", async () => {
    const blocked = {
      operationId: "purchase-stuck-99",
      action: "merchant-purchase",
      phase: "commerce-committed"
    };
    store.operationJournal = [blocked];
    let request;
    api.adjudicateVillageOperation = async value => {
      request = value;
      return { ok: true, phase: "abandoned", operationId: value.operationId };
    };
    const app = quietApp();
    const context = await app._prepareContext();
    assert.equal(context.cycleBlock.operationId, blocked.operationId);

    const result = await VillageApplication._onAdjudicateVillageOperation.call(app, {}, {
      dataset: { operationId: blocked.operationId, decision: "abandon" }
    });
    assert.equal(result.ok, true);
    assert.equal(request.operationId, blocked.operationId);
    assert.equal(request.decision, "abandon");
    await app.close();
  });
});
