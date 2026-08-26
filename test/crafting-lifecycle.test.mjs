import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  accrueCraftingPoints,
  completeProject,
  makeCraftingRoll,
  normalizeCraftingProject,
  reconcileCraftingProject
} from "../module/helpers/crafting.mjs";
import { migrateCrowSystem, migrateCraftingProject } from "../module/helpers/migration.mjs";

function actorWith(project, { outputClaims = [] } = {}) {
  const actor = {
    id: "Actor.crafting",
    uuid: "Actor.crafting",
    name: "Mara",
    type: "crow",
    items: [],
    updates: [],
    system: {
      characteristics: { mind: { value: 0 } },
      expertises: {},
      crafting: { projects: [structuredClone(project)], outputClaims }
    },
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) foundry.utils.setProperty(this, path, structuredClone(value));
      return this;
    }
  };
  return actor;
}

async function withCraftingGlobals(run, { total = 100, dice = [5, 5] } = {}) {
  const previousRoll = globalThis.Roll;
  const previousChat = globalThis.ChatMessage;
  const messages = [];
  globalThis.Roll = class DeterministicCraftingRoll {
    constructor() {
      this.total = total;
      this.dice = [{ faces: 10, results: dice.map(result => ({ result })) }];
    }

    async evaluate() { return this; }

    async toMessage(data) {
      messages.push(structuredClone(data));
      return { id: "Message.crafting", ...data };
    }
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    async create(data) {
      messages.push(structuredClone(data));
      return { id: "Message.crafting", ...data };
    }
  };
  try {
    return await run(messages);
  } finally {
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousChat === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChat;
  }
}

describe("crafting lifecycle arithmetic", () => {
  test("an exact-goal roll leaves one durable completion and zero points", () => {
    const result = accrueCraftingPoints({ points: 0, goal: 100, completed: 0 }, 100, { materialSets: 1 });
    assert.equal(result.points, 0);
    assert.equal(result.completed, 1);
    assert.equal(result.completedThisRoll, 1);
  });

  test("an overshoot keeps surplus points for the next copy", () => {
    const result = accrueCraftingPoints({ points: 0, goal: 100, completed: 0 }, 250, { materialSets: 1 });
    assert.equal(result.completed, 1);
    assert.equal(result.points, 150);
    assert.equal(result.blockedOnMaterials, true);
  });

  test("goal points without an authorized set stay blocked, not completed", () => {
    const result = accrueCraftingPoints({ points: 0, goal: 100, completed: 0 }, 100, { materialSets: 0 });
    assert.equal(result.completed, 0);
    assert.equal(result.points, 100);
    assert.equal(result.blockedOnMaterials, true);
  });

  test("multiple authorized sets complete multiple copies", () => {
    const result = accrueCraftingPoints({ points: 0, goal: 100, completed: 0 }, 250, { materialSets: 3 });
    assert.equal(result.completed, 2);
    assert.equal(result.completedThisRoll, 2);
    assert.equal(result.points, 50);
    assert.equal(result.blockedOnMaterials, false);
  });

  test("reconciliation promotes a blocked goal when a set is explicitly available", () => {
    const actor = actorWith({ id: "p1", name: "Blade", goal: 100, points: 100, completed: 0, status: "blocked" });
    const result = reconcileCraftingProject(actor, actor.system.crafting.projects[0], { materialSets: 1 });
    assert.equal(result.project.completed, 1);
    assert.equal(result.project.points, 0);
    assert.equal(result.project.status, "pending");
  });
});

describe("durable crafting roll and finalize", () => {
  test("exact-goal makeCraftingRoll persists completion and a cloned reload sees it", async () => {
    const actor = actorWith({ id: "p1", name: "Blade", goal: 100, points: 0, materials: [] });
    await withCraftingGlobals(async () => {
      const result = await makeCraftingRoll(actor, "p1");
      assert.equal(result.ok, true);
      assert.equal(result.complete, true);
      assert.equal(result.project.points, 0);
      assert.equal(result.project.completed, 1);
      assert.equal(result.project.status, "pending");
    });

    const reloaded = structuredClone(actor.system);
    assert.equal(reloaded.crafting.projects[0].points, 0);
    assert.equal(reloaded.crafting.projects[0].completed, 1);
    assert.equal(reloaded.crafting.projects[0].status, "pending");
  });

  test("pre-roll reconciliation and the same roll share one material-set budget", async () => {
    const actor = actorWith({ id: "p1", name: "Blade", goal: 100, points: 150, completed: 0, status: "blocked", materials: [{
      id: "req-1", quantity: 1, identity: "iron", form: "bar", size: "", label: "iron bar", legacyText: ""
    }] });
    await withCraftingGlobals(async () => {
      const result = await makeCraftingRoll(actor, "p1", { materialSets: 2 });
      assert.equal(result.project.completed, 2, "150 banked + 250 gained can finish only two authorized copies");
      assert.equal(result.project.points, 200);
    }, { total: 250, dice: [10, 10] });
  });

  test("a material-bearing project gets no implicit set from the roll helper", async () => {
    const actor = actorWith({
      id: "p1", name: "Blade", goal: 100, points: 0, completed: 0,
      materials: [{ id: "req-1", quantity: 1, identity: "iron", form: "bar", size: "", label: "iron bar" }]
    });
    await withCraftingGlobals(async () => {
      const result = await makeCraftingRoll(actor, "p1");
      assert.equal(result.project.completed, 0);
      assert.equal(result.project.points, 100);
      assert.equal(result.project.status, "blocked");
    });
  });

  test("completeProject refuses an incomplete project without an update or chat", async () => {
    const actor = actorWith({ id: "p1", name: "Blade", goal: 100, points: 100, completed: 0, status: "active" });
    await withCraftingGlobals(async messages => {
      const result = await completeProject(actor, "p1");
      assert.deepEqual(result.ok, false);
      assert.equal(result.error, "incomplete");
      assert.deepEqual(actor.updates, []);
      assert.deepEqual(messages, []);
    });
  });

  test("finalize records one non-Item claim per completed copy and retains surplus", async () => {
    const actor = actorWith({
      id: "p1",
      name: "Blade",
      goal: 100,
      points: 50,
      completed: 2,
      status: "pending",
      output: { kind: "equipment", name: "Fine Blade", template: { type: "weapon" } },
      materials: []
    });
    actor.createEmbeddedDocuments = async () => { throw new Error("completeProject must not create an Item"); };

    await withCraftingGlobals(async messages => {
      const result = await completeProject(actor, "p1");
      assert.equal(result.ok, true);
      assert.equal(result.claims.length, 2);
      assert.equal(actor.system.crafting.outputClaims.length, 2);
      assert.equal(actor.system.crafting.outputClaims[0].kind, "equipment");
      assert.equal(actor.system.crafting.projects[0].completed, 0);
      assert.equal(actor.system.crafting.projects[0].points, 50);
      assert.equal(actor.system.crafting.projects[0].status, "active");
      assert.equal(messages.length, 1, "finalize posts one card after the actor write");
    });
  });
});

describe("crafting project shape migration", () => {
  test("old projects gain conservative durable fields and structured material labels", () => {
    const migrated = migrateCraftingProject({
      id: "p1", name: "Blade", goal: 100, points: 100,
      materials: ["3 archmage obsidian bars", "mystery material"]
    });
    assert.equal(migrated.completed, 0, "old points alone cannot prove a completion");
    assert.equal(migrated.status, "active");
    assert.deepEqual(migrated.materials[0], {
      id: "req-1", quantity: 3, identity: "archmageObsidian", form: "bar", size: "",
      label: "3 archmage obsidian bars", legacyText: ""
    });
    assert.equal(migrated.materials[1].identity, "");
    assert.equal(migrated.materials[1].legacyText, "mystery material");
    assert.equal(normalizeCraftingProject(migrated).output.kind, "equipment");
  });

  test("migrateCrowSystem applies the project shape migration idempotently", () => {
    const source = { crafting: { projects: [{ id: "p1", skill: "blacksmithing", points: 100, goal: 100 }] } };
    const first = migrateCrowSystem(source);
    const second = migrateCrowSystem(first);
    assert.deepEqual(second, first);
    assert.equal(first.crafting.projects[0].expertise, "blacksmithing");
    assert.equal(first.crafting.projects[0].completed, 0);
    assert.equal(first.crafting.projects[0].status, "active");
  });
});
