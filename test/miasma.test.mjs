import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  onMiasmaTestCommitted,
  registerMiasmaHooks,
  resolveMiasmaResist
} from "../module/helpers/miasma.mjs";
import { buildTestResult } from "../module/helpers/roll.mjs";
import { applyExpertise, declineExpertise } from "../module/helpers/expertise.mjs";

function crow() {
  return {
    id: "Actor.miasma", name: "Scout", type: "crow",
    isOwner: true,
    system: {
      conditions: {}, miasma: {},
      expertises: { endurance: { value: 1, max: 1 } }
    },
    updates: [],
    async update(data) {
      this.updates.push(data);
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

async function withMiasmaGlobals(run) {
  const previousGame = globalThis.game;
  const previousChatMessage = globalThis.ChatMessage;
  const previousRoll = globalThis.Roll;
  const messages = [];
  globalThis.game = { settings: { get: () => 7 } };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    create: async data => { messages.push(data); return { id: "Message.miasma" }; }
  };
  globalThis.Roll = class DeterministicMiasmaEffectRoll {
    constructor() { this.total = 1; }
    async evaluate() { return this; }
  };
  try {
    return await run(messages);
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
}

function message(result, id) {
  return {
    id,
    flags: { crows: { test: structuredClone(result) } },
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

describe("Miasma committed-test lifecycle", () => {
  test("a pending result is never resolved", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const out = await resolveMiasmaResist({ state: "pending", tier: 1 }, actor);
      assert.deepEqual(out, { ok: false, error: "test-pending" });
      assert.deepEqual(actor.updates, []);
      assert.deepEqual(messages, []);
    });
  });

  test("a committed tier 2 stamps the test and applies one boned level", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const out = await resolveMiasmaResist({ state: "committed", tier: 2 }, actor);
      assert.deepEqual(out, { ok: true, tier: 2, boned: true, effect: null });
      assert.equal(actor.system.miasma.lastTestOn, 7);
      assert.equal(actor.system.conditions.boned, 1);
      assert.equal(messages.length, 1);
    });
  });

  test("the commit subscriber resolves only a persisted Miasma marker", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const getActor = id => id === actor.id ? actor : null;
      const ordinary = {
        actorId: actor.id, state: "committed", tier: 2,
        allowedExpertises: ["endurance"], miasma: null
      };
      assert.equal(await onMiasmaTestCommitted(ordinary, null, { getActor }), null);
      assert.deepEqual(actor.updates, []);

      const marked = { ...ordinary, miasma: { kind: "resist" } };
      assert.deepEqual(
        await onMiasmaTestCommitted(marked, null, { getActor }),
        { ok: true, tier: 2, boned: true, effect: null }
      );
      assert.equal(actor.system.conditions.boned, 1);
      assert.equal(messages.length, 1);
    });
  });

  test("spending Endurance resolves the improved tier exactly once", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const initial = buildTestResult({
        actorId: actor.id, rawSum: 10, actor,
        allowedExpertises: ["endurance"], miasma: { kind: "resist" }
      });
      const testMessage = message(initial, "Message.miasma-spend");
      let resolution = null;
      const out = await applyExpertise(testMessage, "endurance", {
        getActor: () => actor,
        emit: (result, committedMessage) => {
          resolution = onMiasmaTestCommitted(result, committedMessage, { getActor: () => actor });
        }
      });
      assert.equal(out.tier, 2);
      assert.deepEqual(await resolution, { ok: true, tier: 2, boned: true, effect: null });
      assert.equal(actor.system.conditions.boned, 1);
      assert.deepEqual(actor.system.miasma.effects ?? [], []);
      assert.equal(messages.length, 1);
    });
  });

  test("declining Endurance resolves the rolled tier exactly once", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const initial = buildTestResult({
        actorId: actor.id, rawSum: 10, actor,
        allowedExpertises: ["endurance"], miasma: { kind: "resist" }
      });
      const testMessage = message(initial, "Message.miasma-decline");
      let resolution = null;
      const out = await declineExpertise(testMessage, {
        getActor: () => actor,
        emit: (result, committedMessage) => {
          resolution = onMiasmaTestCommitted(result, committedMessage, { getActor: () => actor });
        }
      });
      assert.equal(out.tier, 1);
      assert.equal((await resolution).tier, 1);
      assert.equal(actor.system.conditions.boned, 1);
      assert.deepEqual(actor.system.miasma.effects, [2]);
      assert.equal(messages.length, 1);
    });
  });

  test("hook registration is idempotent", () => {
    const previousHooks = globalThis.Hooks;
    const previousBound = registerMiasmaHooks._bound;
    const handlers = [];
    globalThis.Hooks = { on: (name, handler) => handlers.push({ name, handler }) };
    registerMiasmaHooks._bound = false;
    try {
      registerMiasmaHooks();
      registerMiasmaHooks();
      assert.equal(handlers.length, 1);
      assert.equal(handlers[0].name, "crowsTestCommitted");
    } finally {
      if (previousBound === undefined) delete registerMiasmaHooks._bound;
      else registerMiasmaHooks._bound = previousBound;
      if (previousHooks === undefined) delete globalThis.Hooks;
      else globalThis.Hooks = previousHooks;
    }
  });
});
