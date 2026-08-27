import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

const SheetBase = class {
  static DEFAULT_OPTIONS = {};
  static PARTS = {};
};
globalThis.foundry.applications = {
  api: {
    HandlebarsApplicationMixin: Base => class extends Base {},
    DialogV2: class DialogV2 {}
  },
  sheets: { ActorSheetV2: SheetBase, ItemSheetV2: SheetBase }
};

const { CrowSheet } = await import("../module/sheets/crow-sheet.mjs");
const { MonsterSheet } = await import("../module/sheets/monster-sheet.mjs");
const { defeatedForActor, syncDefeatedCondition } = await import("../module/helpers/damage.mjs");

function actorDocument({ type, woundSlots = [], conditions = {}, slots = 0, stamina = 5 } = {}) {
  const actor = {
    id: `${type}-condition-test`,
    type,
    isOwner: true,
    items: [],
    system: {
      slots,
      stamina: { value: stamina, max: stamina },
      woundSlots: [...woundSlots],
      conditions: { defeated: false, ...conditions }
    },
    updates: [],
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) foundry.utils.setProperty(this, path, value);
      return this;
    }
  };
  return actor;
}

describe("defeated condition lifecycle", () => {
  test("the invariant uses Stamina for a slotless monster", async () => {
    const actor = actorDocument({ type: "monster", slots: 0, stamina: 4, conditions: { defeated: true } });

    assert.equal(defeatedForActor(actor), false);
    await syncDefeatedCondition(actor);
    assert.equal(actor.system.conditions.defeated, false);

    actor.system.stamina.value = 0;
    assert.equal(defeatedForActor(actor), true);
    await syncDefeatedCondition(actor);
    assert.equal(actor.system.conditions.defeated, true);
  });

  test("the crow wound toggle clears defeated when a wound is removed", async () => {
    const actor = actorDocument({
      type: "crow",
      woundSlots: Array.from({ length: 10 }, (_, index) => index),
      conditions: { defeated: true }
    });

    await CrowSheet.DEFAULT_OPTIONS.actions.toggleWound.call(
      { document: actor }, {}, { dataset: { index: "9" } }
    );

    assert.equal(actor.system.conditions.defeated, false);
    assert.ok(actor.updates.some(update => update["system.conditions.defeated"] === false));
  });

  test("the monster wound toggle clears defeated when a wound is removed", async () => {
    const actor = actorDocument({
      type: "monster",
      slots: 2,
      woundSlots: [0, 1],
      conditions: { defeated: true }
    });

    await MonsterSheet.DEFAULT_OPTIONS.actions.toggleWound.call(
      { document: actor }, {}, { dataset: { index: "1" } }
    );

    assert.equal(actor.system.conditions.defeated, false);
    assert.ok(actor.updates.some(update => update["system.conditions.defeated"] === false));
  });
});
