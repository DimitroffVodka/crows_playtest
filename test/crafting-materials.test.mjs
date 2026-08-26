import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

import {
  EQUIPMENT_UPGRADE_KEYS,
  MATERIAL_IDENTITY_KEYS,
  equipmentUpgradeKeyFor,
  normalizeMaterialRequirement,
  planCraftingMaterials
} from "../module/helpers/materials.mjs";
import { completeProject } from "../module/helpers/crafting.mjs";

const materialItem = (id, {
  identity = "iron", form = "bar", size = "small", quantity = 1,
  creatureType = "", identified = true, subtype = "material", name = id
} = {}) => ({
  id,
  _id: id,
  name,
  type: "gear",
  system: {
    subtype,
    identified,
    quantity,
    material: { identity, form, size, creatureType }
  }
});

const requirement = (overrides = {}) => ({
  id: "req-1",
  quantity: 1,
  identity: "iron",
  form: "bar",
  size: "small",
  label: "iron bar",
  legacyText: "",
  ...overrides
});

const projectFor = (materials, overrides = {}) => ({
  id: "project-1",
  name: "Test project",
  goal: 100,
  points: 0,
  completed: 0,
  status: "pending",
  materials,
  output: { kind: "equipment", name: "Finished thing" },
  ...overrides
});

describe("crafting material vocabularies", () => {
  test("the four shipped cards are gear materials with their physical sizes intact", () => {
    for (const [file, size, slots, stackMax] of [
      ["crafting-material-tiny.yaml", "tiny", 1, 5],
      ["crafting-material-small.yaml", "small", 1, 1],
      ["crafting-material-medium.yaml", "medium", 2, 1],
      ["crafting-material-large.yaml", "large", 4, 1]
    ]) {
      const card = yaml.load(readFileSync(join("src/packs/crows-gear", file), "utf8"));
      assert.equal(card.type, "gear");
      assert.equal(card.system.subtype, "material");
      assert.deepEqual(card.system.material, { identity: "", form: "", size, creatureType: "" });
      assert.equal(card.system.slots, slots);
      assert.equal(card.system.stackMax, stackMax);
      assert.equal(card.system.quantity, 1);
    }
  });

  test("upgrade outputs and consumed identities remain separate lists", () => {
    assert.deepEqual(EQUIPMENT_UPGRADE_KEYS, [
      "bloodhide", "undeadBone", "demonHide", "angelHide", "elementalEssence",
      "steel", "archmageObsidian", "necromancerSilver", "starDiamond", "yew",
      "archmageWillow", "necromancerDeathtree", "starwood"
    ]);
    assert.deepEqual(MATERIAL_IDENTITY_KEYS, [
      "bloodCreature", "undead", "demon", "angel", "elemental", "plant", "iron",
      "treatedIron", "archmageObsidian", "necromancerSilver", "starDiamond", "hickory",
      "yew", "archmageWillow", "necromancerDeathtree", "starwood"
    ]);
    assert.equal(EQUIPMENT_UPGRADE_KEYS.includes("treatedIron"), false);
    assert.equal(MATERIAL_IDENTITY_KEYS.includes("steel"), false);
  });

  test("printed aliases map to the right namespace", () => {
    assert.equal(equipmentUpgradeKeyFor("Elemental Tree"), "elementalEssence");
    assert.deepEqual(normalizeMaterialRequirement("5 steel bars"), {
      id: "req-1", quantity: 5, identity: "treatedIron", form: "bar", size: "",
      label: "5 steel bars", legacyText: ""
    });
    assert.equal(normalizeMaterialRequirement("10 angel parts").identity, "angel");
    assert.equal(normalizeMaterialRequirement("10 angel hide").identity, "");
    assert.equal(normalizeMaterialRequirement("10 undead bone").identity, "");
  });

  test("Slaying remains a parameterized requirement, not a fixed key", () => {
    const normalized = normalizeMaterialRequirement({
      id: "slay-1", quantity: 5, identity: "creatureTypeParts", form: "part",
      params: { creatureType: "demon" }, label: "5 demon creature-type parts"
    });
    assert.equal(normalized.identity, "creatureTypeParts");
    assert.equal(normalized.params.creatureType, "demon");
    assert.equal(MATERIAL_IDENTITY_KEYS.includes("creatureTypeParts"), false);

    const actor = { items: [materialItem("part-a", {
      identity: "creatureTypeParts", form: "part", size: "small", quantity: 5,
      creatureType: "demon"
    })] };
    const plan = planCraftingMaterials(actor, projectFor([normalized]));
    assert.equal(plan.fullSets, 1);
    assert.equal(plan.availableSets, 1);
    assert.equal(plan.unresolved.length, 0);
  });
});

describe("inventory-derived material planning", () => {
  test("aggregates stacks, matches every constrained field, and orders consumption by Item id", () => {
    const actor = {
      items: [
        materialItem("bar-b", { quantity: 3 }),
        materialItem("bar-a", { quantity: 2 }),
        materialItem("wrong-size", { quantity: 20, size: "large" }),
        materialItem("treasure", { quantity: 99, subtype: "treasure" })
      ]
    };
    const plan = planCraftingMaterials(actor, projectFor([requirement({ quantity: 5 })]));
    assert.equal(plan.fullSets, 1);
    assert.equal(plan.availableSets, 1);
    assert.deepEqual(plan.consumption.map(entry => [entry.itemId, entry.quantity, entry.afterQuantity]), [
      ["bar-a", 2, 0], ["bar-b", 3, 0]
    ]);
    assert.deepEqual(plan.exhaustedIds, ["bar-a", "bar-b"]);
    assert.deepEqual(plan.updates.map(update => update._id), ["bar-a", "bar-b"]);
  });

  test("plans multiple physical copies and subtracts already pending copies", () => {
    const actor = { items: [materialItem("bar", { quantity: 12 })] };
    const project = projectFor([requirement({ quantity: 5 })], { completed: 1 });
    const plan = planCraftingMaterials(actor, project);
    assert.equal(plan.fullSets, 2);
    assert.equal(plan.availableSets, 1);
    assert.equal(plan.copies, 1, "default consumption is the pending copy count");
    assert.equal(plan.consumption[0].quantity, 5);
    const all = planCraftingMaterials(actor, project, { copies: 2 });
    assert.equal(all.consumption[0].quantity, 10);
    assert.equal(all.consumption[0].afterQuantity, 2);
  });

  test("reports one missing constrained requirement and never consumes a treasure gear", () => {
    const actor = { items: [materialItem("treasure", { subtype: "treasure", quantity: 100 })] };
    const plan = planCraftingMaterials(actor, projectFor([requirement({ size: "medium" })]));
    assert.equal(plan.fullSets, 0);
    assert.equal(plan.missing.length, 1);
    assert.equal(plan.missing[0].id, "req-1");
    assert.equal(plan.missing[0].shortfall, 1);
    assert.deepEqual(plan.consumption, []);
  });

  test("unknown legacy text is unresolved and a no-material project is unbounded", () => {
    const unresolved = planCraftingMaterials(
      { items: [materialItem("bar", { quantity: 100 })] },
      projectFor(["7 moon-metal shards"])
    );
    assert.equal(unresolved.fullSets, 0);
    assert.equal(unresolved.unresolved.length, 1);
    assert.equal(unresolved.unresolved[0].legacyText, "7 moon-metal shards");
    assert.deepEqual(unresolved.consumption, []);

    const empty = planCraftingMaterials({ items: [] }, projectFor([]));
    assert.equal(empty.fullSets, Number.POSITIVE_INFINITY);
    assert.equal(empty.availableSets, Number.POSITIVE_INFINITY);
    assert.deepEqual(empty.missing, []);
  });
});

function actorWithProject(project, items, { deleteFailure = false, mixedUpdate = false } = {}) {
  const calls = [];
  const actor = {
    id: "actor-1",
    uuid: "Actor.actor-1",
    name: "Mara",
    type: "crow",
    items,
    calls,
    updates: [],
    system: { crafting: { projects: [structuredClone(project)], outputClaims: [], transactions: [] } },
    async update(data) {
      calls.push({ kind: "actor", data: structuredClone(data) });
      this.updates.push(structuredClone(data));
      for (const [key, value] of Object.entries(data)) foundry.utils.setProperty(this, key, structuredClone(value));
      return this;
    },
    async updateEmbeddedDocuments(type, updates) {
      calls.push({ kind: "update", type, updates: structuredClone(updates) });
      for (const [index, update] of updates.entries()) {
        const item = this.items.find(entry => String(entry.id ?? entry._id) === String(update._id));
        if (!item) continue;
        if (mixedUpdate && index === 0) {
          item.system.quantity = update["system.quantity"];
          throw new Error("simulated update failure after one Item");
        }
        item.system.quantity = update["system.quantity"];
      }
    },
    async deleteEmbeddedDocuments(type, ids) {
      calls.push({ kind: "delete", type, ids: structuredClone(ids) });
      if (deleteFailure) throw new Error("simulated delete failure");
      this.items = this.items.filter(item => !ids.includes(String(item.id ?? item._id)));
    }
  };
  return actor;
}

async function withChat(run) {
  const old = globalThis.ChatMessage;
  const messages = [];
  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    async create(data) { messages.push(structuredClone(data)); return data; }
  };
  try { return await run(messages); }
  finally {
    if (old === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = old;
  }
}

describe("journaled material Finalize", () => {
  test("updates every quantity first, then deletes only exhausted Items and records a claim", async () => {
    const project = projectFor([requirement({ quantity: 5 })], { completed: 1 });
    const actor = actorWithProject(project, [
      materialItem("bar-b", { quantity: 2 }), materialItem("bar-a", { quantity: 3 })
    ]);
    await withChat(async messages => {
      const result = await completeProject(actor, project.id, { txId: "tx-success" });
      assert.equal(result.ok, true);
      assert.deepEqual(actor.calls.filter(call => call.kind).map(call => call.kind), [
        "actor", "update", "actor", "delete", "actor", "actor"
      ]);
      const update = actor.calls.find(call => call.kind === "update");
      assert.deepEqual(update.updates.map(entry => entry["system.quantity"]), [0, 0]);
      assert.equal(update.updates.every(entry => !Object.hasOwn(entry, "delete")), true);
      const deletion = actor.calls.find(call => call.kind === "delete");
      assert.deepEqual(deletion.ids, ["bar-a", "bar-b"]);
      assert.equal(actor.items.length, 0);
      assert.equal(actor.system.crafting.projects.length, 0);
      assert.equal(actor.system.crafting.outputClaims.length, 1);
      assert.match(messages[0].content, /Materials consumed/);
      assert.equal(actor.system.crafting.transactions[0].phase, "finalized");
    });
  });

  test("insufficient material refuses before journal, Item, project, or chat writes", async () => {
    const project = projectFor([requirement({ quantity: 5 })], { completed: 1 });
    const actor = actorWithProject(project, [materialItem("bar", { quantity: 4 })]);
    await withChat(async messages => {
      const result = await completeProject(actor, project.id, { txId: "tx-insufficient" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "insufficient-material");
      assert.deepEqual(actor.calls, []);
      assert.deepEqual(actor.updates, []);
      assert.equal(messages.length, 0);
      assert.equal(actor.items[0].system.quantity, 4);
    });
  });

  test("a rejected delete leaves a recoverable journal and retry does not decrement again", async () => {
    const project = projectFor([requirement()], { completed: 1 });
    const actor = actorWithProject(project, [materialItem("bar", { quantity: 1 })], { deleteFailure: true });
    await withChat(async messages => {
      const first = await completeProject(actor, project.id, { txId: "tx-delete" });
      assert.equal(first.ok, false);
      assert.equal(first.error, "recovery-required");
      assert.equal(first.transaction.failedPhase, "delete");
      assert.equal(actor.items[0].system.quantity, 0);
      const updateCallsBeforeRetry = actor.calls.filter(call => call.kind === "update").length;
      actor.deleteFailure = false;
      actor.deleteEmbeddedDocuments = async function (type, ids) {
        this.calls.push({ kind: "delete", type, ids: structuredClone(ids) });
        this.items = this.items.filter(item => !ids.includes(String(item.id ?? item._id)));
      };
      const second = await completeProject(actor, project.id, { txId: "tx-delete" });
      assert.equal(second.ok, true);
      assert.equal(actor.calls.filter(call => call.kind === "update").length, updateCallsBeforeRetry,
        "retry resumes deletion/finalize; it never reapplies quantities");
      assert.equal(actor.items.length, 0);
      assert.equal(messages.length, 1);
    });
  });

  test("mixed update state is recovery-required and never proceeds to delete", async () => {
    const project = projectFor([requirement({ quantity: 2 })], { completed: 1 });
    const actor = actorWithProject(project, [
      materialItem("bar-a", { quantity: 1 }), materialItem("bar-b", { quantity: 1 })
    ], { mixedUpdate: true });
    await withChat(async messages => {
      const result = await completeProject(actor, project.id, { txId: "tx-mixed" });
      assert.equal(result.ok, false);
      assert.equal(result.error, "recovery-required");
      assert.equal(result.transaction.failedPhase, "quantities");
      assert.equal(actor.calls.some(call => call.kind === "delete"), false);
      assert.equal(actor.system.crafting.transactions[0].phase, "recovery-required");
      assert.equal(messages.length, 0);
    });
  });
});
