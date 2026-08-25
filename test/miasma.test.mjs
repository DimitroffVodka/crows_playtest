import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  onMiasmaTestCommitted,
  registerMiasmaHooks,
  resolveMiasmaResist,
  clearCruelty,
  lookupEffects,
  MIASMA_EFFECTS,
  miasmaCrueltyPenalty,
  miasmaResistMods,
  miasmaRestWoundCount
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

  test("a committed tier 2 stamps the test and has no effect", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const out = await resolveMiasmaResist({ state: "committed", tier: 2 }, actor);
      assert.deepEqual(out, { ok: true, tier: 2, cruelty: 0, effect: null });
      assert.equal(actor.system.miasma.lastTestOn, 7);
      assert.equal(actor.system.miasma.cruelty ?? 0, 0);
      assert.equal(actor.system.conditions.boned, undefined);
      assert.equal(messages.length, 1);
    });
  });

  test("a committed tier 1 gains cruelty and both effects from one paired row", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      const out = await resolveMiasmaResist({ state: "committed", tier: 1 }, actor);
      assert.equal(out.ok, true);
      assert.equal(out.tier, 1);
      assert.equal(out.cruelty, 1);
      assert.equal(actor.system.miasma.cruelty, 1);
      assert.deepEqual(actor.system.miasma.effects, [2]);
      assert.equal(out.effect.first.id, "despondent");
      assert.equal(out.effect.second.id, "sneak-edge");
      assert.equal(out.effect.effects.length, 2);
      assert.equal(messages.length, 1, "the paired effect card is posted once");
    });
  });

  test("a committed tier 3 clears all cruelty through the self branch", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      actor.system.miasma.cruelty = 3;
      const out = await resolveMiasmaResist({ state: "committed", tier: 3 }, actor);
      assert.deepEqual(out, { ok: true, tier: 3, cruelty: 0, crueltyCleared: 3, effect: null });
      assert.equal(actor.system.miasma.cruelty, 0);
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
        { ok: true, tier: 2, cruelty: 0, effect: null }
      );
      assert.equal(actor.system.miasma.cruelty ?? 0, 0);
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
      assert.deepEqual(await resolution, { ok: true, tier: 2, cruelty: 0, effect: null });
      assert.equal(actor.system.miasma.cruelty ?? 0, 0);
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
      const resolved = await resolution;
      assert.equal(resolved.tier, 1);
      assert.equal(resolved.cruelty, 1);
      assert.equal(actor.system.miasma.cruelty, 1);
      assert.deepEqual(actor.system.miasma.effects, [2]);
      assert.equal(resolved.effect.first.id, "despondent");
      assert.equal(resolved.effect.second.id, "sneak-edge");
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

describe("Playtest 2 Miasma table and cruelty couplings", () => {
  test("each bucket resolves to a first and second effect, including 13+", () => {
    for (const bucket of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
      const row = lookupEffects(bucket);
      assert.ok(row, `missing row for ${bucket}`);
      assert.ok(row.first && row.second, `row ${bucket} is not paired`);
      assert.equal(row.effects.length, 2);
      assert.equal(row.second.endsOn, row.first.endsOn, "R:1136/R:1140 duration coupling");
    }
    assert.equal(lookupEffects(14).first.id, "permanent-npc");
    assert.equal(MIASMA_EFFECTS[9].second.id, "extra-wound-rest");
  });

  test("the checked-in table prose is the PT2 prose, not the PT1 boned table", () => {
    assert.match(lookupEffects(1).first.text, /only speak if spoken to first/);
    assert.equal(lookupEffects(1).second.text, "You have an edge on tests made to sneak or hide.");
    assert.match(lookupEffects(3).second.text, /gain a \+2 bonus on tests made related to the forage role/);
    assert.match(lookupEffects(9).second.text, /recover 2 wounds instead of 1/);
    assert.match(lookupEffects(11).second.text, /\+1 damage bonus on weapon attacks/);
    assert.match(lookupEffects(13).first.text, /permanently selfish and cruel/);
  });

  test("cruelty is the only Miasma RR penalty", () => {
    const actor = crow();
    actor.system.miasma.cruelty = 3;
    assert.equal(miasmaCrueltyPenalty(actor), -3);
    assert.deepEqual(miasmaResistMods(actor), [{ key: "cruelty", label: "Miasma cruelty", value: -3 }]);
    assert.deepEqual(miasmaResistMods(crow()), []);
  });

  test("the extra-wound paired benefit changes one rest's removal to two", () => {
    const actor = crow();
    actor.system.miasma.effects = [10];
    assert.equal(miasmaRestWoundCount(actor, 1), 2);
    assert.equal(miasmaRestWoundCount(actor, 2), 2);
    assert.equal(miasmaRestWoundCount(actor, 1, { inMiasma: false }), 1);
    actor.system.miasma.effects = [];
    assert.equal(miasmaRestWoundCount(actor, 1), 1);
  });

  test("resting outside the Miasma clears cruelty without converting it to a condition", async () => {
    await withMiasmaGlobals(async messages => {
      const actor = crow();
      actor.system.miasma.cruelty = 4;
      const result = await clearCruelty(actor, { announce: false });
      assert.equal(result.cleared, 4);
      assert.equal(actor.system.miasma.cruelty, 0);
      assert.equal(actor.system.conditions.boned, undefined);
      assert.deepEqual(messages, []);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  Schema-bound regression probe                                             */
/* -------------------------------------------------------------------------- */

/**
 * A minimal DataModel runner for this test only. It uses CrowData's real
 * production schema and implements the important Foundry boundary: updates
 * to paths absent from that schema are dropped without creating a property.
 * The ordinary fixture above cannot catch the historical bug because its
 * update() accepts every dotted path.
 */
function installSchemaBoundFoundry() {
  class Field {
    constructor(options = {}) { Object.assign(this, options); }
  }
  class SchemaField extends Field {
    constructor(fields, options = {}) { super(options); this.fields = fields; this.fieldKind = "SchemaField"; }
  }
  class ArrayField extends Field {
    constructor(element, options = {}) { super(options); this.element = element; this.fieldKind = "ArrayField"; }
  }
  class SetField extends Field {
    constructor(element, options = {}) { super(options); this.element = element; this.fieldKind = "SetField"; }
  }

  const fields = {
    StringField: Field, NumberField: Field, BooleanField: Field, HTMLField: Field,
    SchemaField, ArrayField, SetField
  };
  const previous = { abstract: globalThis.foundry.abstract, fields: globalThis.foundry.data?.fields };

  function shape(schema, source = {}) {
    const out = {};
    for (const [key, field] of Object.entries(schema ?? {})) {
      if (field?.fieldKind === "SchemaField") {
        out[key] = shape(field.fields, source?.[key] ?? {});
      } else if (field?.fieldKind === "ArrayField" || field?.fieldKind === "SetField") {
        out[key] = Array.isArray(source?.[key])
          ? structuredClone(source[key])
          : structuredClone(field.initial ?? []);
      } else if (Object.prototype.hasOwnProperty.call(source ?? {}, key)) {
        out[key] = structuredClone(source[key]);
      } else if (field && "initial" in field) {
        out[key] = structuredClone(field.initial);
      }
    }
    return out;
  }

  function fieldAt(schema, path) {
    let fieldsAt = schema;
    let field = null;
    for (const part of path.split(".")) {
      field = fieldsAt?.[part];
      if (!field) return null;
      fieldsAt = field.fieldKind === "SchemaField" ? field.fields : null;
    }
    return field;
  }

  class TypeDataModel {
    static migrateData(source) { return source; }
    constructor(source = {}) {
      const migrated = this.constructor.migrateData(structuredClone(source));
      Object.assign(this, shape(this.constructor.defineSchema(), migrated));
    }
    applyUpdate(path, value) {
      if (!fieldAt(this.constructor.defineSchema(), path)) return false;
      const parts = path.split(".");
      const key = parts.pop();
      let target = this;
      for (const part of parts) target = target[part];
      target[key] = structuredClone(value);
      return true;
    }
  }

  globalThis.foundry.data = { ...(globalThis.foundry.data ?? {}), fields };
  globalThis.foundry.abstract = { TypeDataModel };
  return () => {
    globalThis.foundry.abstract = previous.abstract;
    globalThis.foundry.data.fields = previous.fields;
  };
}

test("DataModel-bound regression: deleted conditions.boned cannot absorb a Tier 1 result", async () => {
  const restoreFoundry = installSchemaBoundFoundry();
  try {
    const { CrowData } = await import(`../module/data/actor/crow.mjs?schema-bound=${Date.now()}`);
    const actor = {
      id: "Actor.schema-bound",
      name: "Schema Scout",
      type: "crow",
      system: new CrowData({ conditions: {}, miasma: { cruelty: 0 } }),
      updates: [],
      async update(data) {
        this.updates.push(data);
        for (const [path, value] of Object.entries(data)) {
          if (path.startsWith("system.")) this.system.applyUpdate(path.slice(7), value);
        }
        return this;
      }
    };

    await withMiasmaGlobals(async () => {
      const result = await resolveMiasmaResist({ state: "committed", tier: 1 }, actor);
      assert.equal(result.cruelty, 1);
      assert.equal(actor.system.miasma.cruelty, 1, "Tier 1 must write the new schema field");
      assert.equal(actor.system.conditions.boned, undefined, "the deleted field must not be created by update()");
      assert.ok(actor.updates.some(update => Object.hasOwn(update, "system.miasma.cruelty")));
    });
  } finally {
    restoreFoundry();
  }
});
