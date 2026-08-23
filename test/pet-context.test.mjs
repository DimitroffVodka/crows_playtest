import "./shim/foundry.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import * as pets from "../module/helpers/pets.mjs";
import { buildTestResult } from "../module/helpers/roll.mjs";
import { applyExpertise, declineExpertise } from "../module/helpers/expertise.mjs";

function human() {
  return {
    id: "crow1",
    uuid: "Actor.crow1",
    type: "crow",
    name: "Mara",
    system: {}
  };
}

function animal() {
  return {
    id: "pet1",
    uuid: "Actor.pet1",
    type: "monster",
    name: "Ash",
    system: {
      creatureType: "animal",
      pet: {
        ownerUuid: "",
        prospectiveOwnerUuid: "",
        followsUntil: 0,
        riderUuid: "",
        lastFedAt: 0
      }
    },
    statuses: new Set(),
    statusToggles: [],
    updates: [],
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    },
    async toggleStatusEffect(statusId, { active } = {}) {
      this.statusToggles.push({ statusId, active });
      if (active) this.statuses.add(statusId);
      else this.statuses.delete(statusId);
      return this;
    }
  };
}

function pendingMessage(result, id) {
  return {
    id,
    flags: { crows: { test: structuredClone(result) } },
    async update(data) {
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, structuredClone(value));
      }
      return this;
    }
  };
}

test("a committed tier-2 taming test follows from its persisted pet context", async () => {
  const crow = human();
  const pet = animal();
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 1_000
    }
  };

  const resolution = await pets.onPetTestCommitted(result, { id: "Message.taming" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null
  });

  assert.equal(resolution.ok, true);
  assert.equal(resolution.tier, 2);
  assert.equal(resolution.outcome, "follows-at-distance");
  assert.deepEqual(pet.updates, [{
    "system.pet.prospectiveOwnerUuid": "Actor.crow1",
    "system.pet.followsUntil": 87_400
  }]);
  assert.equal(pet.system.pet.ownerUuid, "");
  assert.equal(pet.system.pet.prospectiveOwnerUuid, "Actor.crow1");
  assert.equal(pet.system.pet.followsUntil, 87_400);
});

test("an expertise spend resolves taming from the final persisted tier", async () => {
  const crow = human();
  crow.isOwner = true;
  crow.system.expertises = { handlePet: { value: 1, max: 1 } };
  crow.update = async function update(data) {
    for (const [path, value] of Object.entries(data)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  };
  const pet = animal();
  const context = {
    kind: "taming",
    animalUuid: pet.uuid,
    humanUuid: crow.uuid,
    friendly: true,
    startedAt: 1_500
  };
  const pending = buildTestResult({
    actorId: crow.id,
    characteristic: "mind",
    kind: "test",
    rawSum: 10,
    charVal: 0,
    actor: crow,
    allowedExpertises: ["handlePet"],
    petContext: context
  });
  const message = pendingMessage(pending, "Message.taming-spend");
  let outcome = null;

  const final = await applyExpertise(message, "handlePet", {
    getActor: () => crow,
    emit(result, committedMessage) {
      outcome = pets.onPetTestCommitted(result, committedMessage, {
        resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
      });
      return true;
    }
  });
  const resolution = await outcome;

  assert.equal(pending.state, "pending");
  assert.equal(pending.tier, 1);
  assert.equal(final.state, "committed");
  assert.equal(final.commitReason, "spent");
  assert.equal(final.tier, 2);
  assert.deepEqual(final.petContext, context);
  assert.equal(resolution.outcome, "follows-at-distance");
  assert.deepEqual(pet.updates, [{
    "system.pet.prospectiveOwnerUuid": "Actor.crow1",
    "system.pet.followsUntil": 87_900
  }]);
});

test("declining a pending taming test resolves tier 1 without a pet write", async () => {
  const crow = human();
  crow.isOwner = true;
  crow.system.expertises = { handlePet: { value: 1, max: 1 } };
  const pet = animal();
  const pending = buildTestResult({
    actorId: crow.id,
    characteristic: "mind",
    kind: "test",
    rawSum: 10,
    charVal: 0,
    actor: crow,
    allowedExpertises: ["handlePet"],
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 1_500
    }
  });
  const message = pendingMessage(pending, "Message.taming-decline");
  let outcome = null;

  const final = await declineExpertise(message, {
    getActor: () => crow,
    emit(result, committedMessage) {
      outcome = pets.onPetTestCommitted(result, committedMessage, {
        resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
      });
      return true;
    }
  });
  const resolution = await outcome;

  assert.equal(final.commitReason, "declined");
  assert.equal(final.tier, 1);
  assert.equal(resolution.outcome, "refused");
  assert.deepEqual(pet.updates, []);
});

test("a pending pet command cannot resolve or apply Weakened", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  let resolverCalls = 0;

  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "pending",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    miasma: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  }, { id: "Message.pending-command-condition" }, {
    resolveUuid: async () => {
      resolverCalls += 1;
      return pet;
    }
  });

  assert.equal(resolution, null);
  assert.equal(resolverCalls, 0);
  assert.deepEqual(pet.updates, []);
  assert.deepEqual(pet.statusToggles, []);
  assert.equal(pet.system.conditions.weakened, false);
});

test("a committed tier-2 command applies canonical Weakened state", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  };

  const resolution = await pets.onPetTestCommitted(result, { id: "Message.command" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null
  });

  assert.deepEqual(resolution, {
    ok: true,
    tier: 2,
    outcome: "follows-command",
    weakened: true,
    testRequired: true
  });
  assert.deepEqual(pet.updates, [{ "system.conditions.weakened": true }]);
  assert.equal(pet.system.conditions.weakened, true);
  assert.deepEqual([...pet.statuses], ["weakened"]);
});

test("tier-2 command repairs a missing Weakened mirror without rewriting the boolean", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: true };

  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    miasma: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  }, { id: "Message.command-already-weakened" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  });

  assert.equal(resolution.outcome, "follows-command");
  assert.equal(resolution.weakened, true);
  assert.deepEqual(pet.updates, []);
  assert.equal(pet.system.conditions.weakened, true);
  assert.deepEqual([...pet.statuses], ["weakened"]);
  assert.deepEqual(pet.statusToggles, [{ statusId: "weakened", active: true }]);
});

test("an already-synchronized tier-2 command does not rewrite Weakened", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: true };
  pet.statuses.add("weakened");

  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    miasma: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  }, { id: "Message.command-weakened-in-sync" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  });

  assert.equal(resolution.outcome, "follows-command");
  assert.equal(resolution.weakened, true);
  assert.deepEqual(pet.updates, []);
  assert.deepEqual(pet.statusToggles, []);
  assert.equal(pet.system.conditions.weakened, true);
  assert.deepEqual([...pet.statuses], ["weakened"]);
});

test("a mirror-only failure preserves the successful tier-2 command condition", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  pet.toggleStatusEffect = async () => {
    throw new Error("status mirror unavailable");
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const resolution = await pets.onPetTestCommitted({
      actorId: crow.id,
      state: "committed",
      tier: 2,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      miasma: null,
      petContext: {
        kind: "command",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        needsTest: true
      }
    }, { id: "Message.command-mirror-failed" }, {
      resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
    });

    assert.equal(resolution.outcome, "follows-command");
    assert.equal(resolution.weakened, true);
    assert.deepEqual(pet.updates, [{ "system.conditions.weakened": true }]);
    assert.equal(pet.system.conditions.weakened, true);
    assert.deepEqual([...pet.statuses], []);
  } finally {
    console.warn = originalWarn;
  }
});

test("duplicate delivery of one tier-2 command weakens the pet once", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  const message = { id: "Message.duplicate-command-condition" };
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    miasma: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  };
  const options = {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  };

  const [first, second] = await Promise.all([
    pets.onPetTestCommitted(result, message, options),
    pets.onPetTestCommitted(structuredClone(result), message, options)
  ]);

  assert.deepEqual(second, first);
  assert.deepEqual(pet.updates, [{ "system.conditions.weakened": true }]);
  assert.deepEqual(pet.statusToggles, [{ statusId: "weakened", active: true }]);
  assert.equal(pet.system.conditions.weakened, true);
  assert.deepEqual([...pet.statuses], ["weakened"]);
});

test("command tiers 1 and 3 neither set nor clear Weakened", async () => {
  const crow = human();
  for (const [tier, expected] of [
    [1, { outcome: "refuses-command", weakened: false }],
    [3, { outcome: "follows-command", weakened: false }]
  ]) {
    const pet = animal();
    pet.system.pet.ownerUuid = crow.uuid;
    pet.system.conditions = { weakened: tier === 3 };
    if (tier === 3) pet.statuses.add("weakened");
    const resolution = await pets.onPetTestCommitted({
      actorId: crow.id,
      state: "committed",
      tier,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      petContext: {
        kind: "command",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        needsTest: true
      }
    }, { id: `Message.command-tier-${tier}` }, {
      resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
    });

    assert.equal(resolution.tier, tier);
    assert.equal(resolution.outcome, expected.outcome);
    assert.equal(resolution.weakened, expected.weakened);
    assert.deepEqual(pet.updates, []);
    assert.equal(pet.system.conditions.weakened, tier === 3);
    assert.deepEqual([...pet.statuses], tier === 3 ? ["weakened"] : []);
    assert.deepEqual(pet.statusToggles, []);
  }
});

test("a transferred pet refuses an old pending command at commit time", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = "Actor.new-owner";
  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  }, { id: "Message.command-after-transfer" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  });

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "commander-not-owner");
  assert.deepEqual(pet.updates, []);
});

test("commit-time type changes refuse both taming and command outcomes", async () => {
  for (const { label, kind, mutate, expectedReason } of [
    {
      label: "taming human",
      kind: "taming",
      mutate: ({ crow }) => {
        crow.type = "monster";
        crow.system.creatureType = "blood";
      },
      expectedReason: "owner-not-human"
    },
    {
      label: "taming animal",
      kind: "taming",
      mutate: ({ pet }) => { pet.system.creatureType = "blood"; },
      expectedReason: "not-an-animal"
    },
    {
      label: "command human",
      kind: "command",
      mutate: ({ crow }) => {
        crow.type = "monster";
        crow.system.creatureType = "blood";
      },
      expectedReason: "commander-not-human"
    },
    {
      label: "command animal",
      kind: "command",
      mutate: ({ pet }) => { pet.system.creatureType = "blood"; },
      expectedReason: "not-an-animal"
    }
  ]) {
    const crow = human();
    const pet = animal();
    if (kind === "command") pet.system.pet.ownerUuid = crow.uuid;
    mutate({ crow, pet });
    const petContext = kind === "taming"
      ? {
          kind,
          animalUuid: pet.uuid,
          humanUuid: crow.uuid,
          friendly: true,
          startedAt: 500
        }
      : {
          kind,
          animalUuid: pet.uuid,
          humanUuid: crow.uuid,
          needsTest: true
        };

    const resolution = await pets.onPetTestCommitted({
      actorId: crow.id,
      state: "committed",
      tier: 2,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      miasma: null,
      petContext
    }, { id: `Message.type-race-${label}` }, {
      resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
    });

    assert.equal(resolution.ok, false, label);
    assert.equal(resolution.reason, expectedReason, label);
    assert.deepEqual(pet.updates, [], `${label} authorized a pet write`);
  }
});

test("duplicate delivery of one committed pet message resolves only once", async () => {
  const crow = human();
  const pet = animal();
  const message = { id: "Message.duplicate-taming" };
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 2_000
    }
  };
  const options = {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null
  };

  const first = await pets.onPetTestCommitted(result, message, options);
  const second = await pets.onPetTestCommitted(structuredClone(result), message, options);

  assert.equal(first.outcome, "follows-at-distance");
  assert.deepEqual(second, first);
  assert.deepEqual(pet.updates, [{
    "system.pet.prospectiveOwnerUuid": "Actor.crow1",
    "system.pet.followsUntil": 88_400
  }]);
});

test("the subscriber resolves exact world Actor UUIDs without an injected map", async () => {
  const previousResolver = foundry.utils.fromUuid;
  const crow = human();
  const pet = animal();
  const lookedUp = [];
  foundry.utils.fromUuid = async (uuid) => {
    lookedUp.push(uuid);
    return uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null;
  };
  try {
    const resolution = await pets.onPetTestCommitted({
      actorId: crow.id,
      state: "committed",
      tier: 3,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      petContext: {
        kind: "taming",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        friendly: true,
        startedAt: 3_000
      }
    }, { id: "Message.default-world-resolver" });

    assert.equal(resolution.outcome, "owned");
    assert.deepEqual(new Set(lookedUp), new Set(["Actor.pet1", "Actor.crow1"]));
    assert.deepEqual(pet.updates, [{
      "system.pet.ownerUuid": "Actor.crow1",
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0,
      "system.pet.riderUuid": ""
    }]);
  } finally {
    if (previousResolver === undefined) delete foundry.utils.fromUuid;
    else foundry.utils.fromUuid = previousResolver;
  }
});

test("the default resolver follows synthetic Actor UUIDs through their parent Tokens", async () => {
  const previousResolver = foundry.utils.fromUuid;
  const crow = human();
  const pet = animal();
  crow.uuid = "Scene.scene1.Token.humanToken.Actor.humanBase";
  pet.uuid = "Scene.scene1.Token.petToken.Actor.petBase";
  const humanTokenUuid = "Scene.scene1.Token.humanToken";
  const petTokenUuid = "Scene.scene1.Token.petToken";
  const lookedUp = [];
  foundry.utils.fromUuid = async (uuid) => {
    lookedUp.push(uuid);
    if (uuid === crow.uuid || uuid === pet.uuid) {
      throw new Error("synthetic Actor suffix is not a declared embedded collection");
    }
    if (uuid === humanTokenUuid) return { uuid, actor: crow };
    if (uuid === petTokenUuid) return { uuid, actor: pet };
    throw new Error(`unexpected UUID fallback: ${uuid}`);
  };
  try {
    const resolution = await pets.onPetTestCommitted({
      actorId: crow.id,
      state: "committed",
      tier: 3,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      miasma: null,
      petContext: {
        kind: "taming",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        friendly: true,
        startedAt: 3_000
      }
    }, { id: "Message.default-synthetic-resolver" });

    assert.equal(resolution.outcome, "owned");
    assert.deepEqual(new Set(lookedUp), new Set([
      pet.uuid,
      crow.uuid,
      petTokenUuid,
      humanTokenUuid
    ]));
    assert.equal(lookedUp.includes(pet.id), false, "raw animal id fallback was attempted");
    assert.equal(lookedUp.includes(crow.id), false, "raw human id fallback was attempted");
    assert.deepEqual(pet.updates, [{
      "system.pet.ownerUuid": crow.uuid,
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0,
      "system.pet.riderUuid": ""
    }]);
  } finally {
    if (previousResolver === undefined) delete foundry.utils.fromUuid;
    else foundry.utils.fromUuid = previousResolver;
  }
});

test("a taming context without a finite start time never creates an epoch-based follow", async () => {
  const crow = human();
  const pet = animal();
  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: null
    }
  }, { id: "Message.invalid-start" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null
  });

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "invalid-pet-context");
  assert.deepEqual(pet.updates, []);
  assert.equal(pet.system.pet.followsUntil, 0);
});

test("a pet marker on a non-test result is ignored without resolving actors", async () => {
  let resolutions = 0;
  const resolution = await pets.onPetTestCommitted({
    actorId: "crow1",
    state: "committed",
    tier: 3,
    kind: "attack",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: { weaponType: "bow" },
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: "Actor.pet1",
      humanUuid: "Actor.crow1",
      friendly: true,
      startedAt: 500
    }
  }, { id: "Message.pet-marker-on-attack" }, {
    resolveUuid: async () => {
      resolutions += 1;
      return null;
    }
  });

  assert.equal(resolution, null);
  assert.equal(resolutions, 0);
});

test("a pet marker without the exact Handle Pet test declaration is ignored", async () => {
  let resolutions = 0;
  const resolution = await pets.onPetTestCommitted({
    actorId: "crow1",
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["athletics"],
    attack: null,
    casting: null,
    petContext: {
      kind: "command",
      animalUuid: "Actor.pet1",
      humanUuid: "Actor.crow1",
      needsTest: true
    }
  }, { id: "Message.wrong-expertise" }, {
    resolveUuid: async () => {
      resolutions += 1;
      return null;
    }
  });

  assert.equal(resolution, null);
  assert.equal(resolutions, 0);
});

test("a contradictory attack payload cannot resolve through the pet subscriber", async () => {
  let resolutions = 0;
  const resolution = await pets.onPetTestCommitted({
    actorId: "crow1",
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: { weaponType: "bow" },
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: "Actor.pet1",
      humanUuid: "Actor.crow1",
      friendly: true,
      startedAt: 500
    }
  }, { id: "Message.contradictory-attack" }, {
    resolveUuid: async () => {
      resolutions += 1;
      return null;
    }
  });

  assert.equal(resolution, null);
  assert.equal(resolutions, 0);
});

test("malformed target collections cannot authorize a pet resolution", async () => {
  for (const [label, targets] of [
    ["missing", undefined],
    ["null", null],
    ["object", {}],
    ["empty string", ""]
  ]) {
    const crow = human();
    const pet = animal();
    let resolutions = 0;
    const result = {
      actorId: crow.id,
      state: "committed",
      tier: 3,
      kind: "test",
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      miasma: null,
      petContext: {
        kind: "taming",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        friendly: true,
        startedAt: 500
      }
    };
    if (targets !== undefined) result.targets = targets;

    const resolution = await pets.onPetTestCommitted(
      result,
      { id: `Message.malformed-targets-${label}` },
      {
        resolveUuid: async (uuid) => {
          resolutions += 1;
          return uuid === pet.uuid ? pet : crow;
        }
      }
    );

    assert.equal(resolution, null, label);
    assert.equal(resolutions, 0, `${label} reached actor resolution`);
    assert.deepEqual(pet.updates, [], `${label} authorized a pet write`);
  }
});

test("a no-test command marker is ignored without resolving actors", async () => {
  let resolutions = 0;
  const resolution = await pets.onPetTestCommitted({
    actorId: "crow1",
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "command",
      animalUuid: "Actor.pet1",
      humanUuid: "Actor.crow1",
      needsTest: false
    }
  }, { id: "Message.command-without-test" }, {
    resolveUuid: async () => {
      resolutions += 1;
      return null;
    }
  });

  assert.equal(resolution, null);
  assert.equal(resolutions, 0);
});

test("legacy and ordinary committed flags without a pet marker remain harmless", async () => {
  let resolutions = 0;
  const base = {
    actorId: "crow1",
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null
  };
  for (const petContext of [undefined, null]) {
    const result = { ...base };
    if (petContext !== undefined) result.petContext = petContext;
    const resolution = await pets.onPetTestCommitted(result, null, {
      resolveUuid: async () => {
        resolutions += 1;
        return null;
      }
    });
    assert.equal(resolution, null);
  }
  assert.equal(resolutions, 0);
});

test("resolved actors must match the exact UUIDs persisted in the flag", async () => {
  const crow = human();
  const wrongPet = animal();
  wrongPet.uuid = "Actor.someone-else";
  const resolution = await pets.onPetTestCommitted({
    actorId: crow.id,
    state: "committed",
    tier: 3,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: "Actor.pet1",
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 500
    }
  }, { id: "Message.identity-mismatch" }, {
    resolveUuid: async (uuid) => uuid === "Actor.pet1" ? wrongPet : crow
  });

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "actor-identity-mismatch");
  assert.deepEqual(wrongPet.updates, []);
});

test("the persisted human must be the actor who rolled the test", async () => {
  const crow = human();
  const pet = animal();
  const resolution = await pets.onPetTestCommitted({
    actorId: "different-crow",
    state: "committed",
    tier: 3,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 500
    }
  }, { id: "Message.test-actor-mismatch" }, {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  });

  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, "test-actor-mismatch");
  assert.deepEqual(pet.updates, []);
});

test("pet commit-hook registration is idempotent and reports unknown writes", async () => {
  const previousHooks = globalThis.Hooks;
  const previousUi = globalThis.ui;
  const previousFromUuid = foundry.utils.fromUuid;
  const previousWarn = console.warn;
  const previousBound = pets.registerPetHooks._bound;
  const handlers = [];
  const notifications = [];
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  pet.update = async () => {
    throw new Error("backend result unknown");
  };
  globalThis.Hooks = {
    on(name, handler) {
      handlers.push({ name, handler });
      return handlers.length;
    }
  };
  globalThis.ui = {
    notifications: {
      error(message) { notifications.push(message); }
    }
  };
  foundry.utils.fromUuid = async (uuid) => uuid === pet.uuid ? pet : uuid === crow.uuid ? crow : null;
  console.warn = () => {};
  pets.registerPetHooks._bound = false;
  try {
    pets.registerPetHooks();
    pets.registerPetHooks();
    assert.equal(
      handlers.filter(({ name }) => name === "crowsTestCommitted").length,
      1
    );
    const [{ handler }] = handlers.filter(({ name }) => name === "crowsTestCommitted");
    await handler({
      actorId: crow.id,
      state: "committed",
      tier: 2,
      kind: "test",
      targets: [],
      allowedExpertises: ["handlePet"],
      attack: null,
      casting: null,
      miasma: null,
      petContext: {
        kind: "command",
        animalUuid: pet.uuid,
        humanUuid: crow.uuid,
        needsTest: true
      }
    }, { id: "Message.hook-condition-failed" });

    assert.equal(notifications.length, 1);
    assert.match(notifications[0], /pet.*could not.*updated.*do not reroll.*Ref/i);
  } finally {
    if (previousBound === undefined) delete pets.registerPetHooks._bound;
    else pets.registerPetHooks._bound = previousBound;
    if (previousHooks === undefined) delete globalThis.Hooks;
    else globalThis.Hooks = previousHooks;
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
    if (previousFromUuid === undefined) delete foundry.utils.fromUuid;
    else foundry.utils.fromUuid = previousFromUuid;
    console.warn = previousWarn;
  }
});

test("a rejected taming write reports unknown state and is not replayed", async () => {
  const crow = human();
  const pet = animal();
  let attempts = 0;
  pet.update = async () => {
    attempts += 1;
    throw new Error("backend result unknown");
  };
  const message = { id: "Message.taming-update-failed" };
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 3,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    petContext: {
      kind: "taming",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      friendly: true,
      startedAt: 500
    }
  };
  const options = {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  };

  const first = await pets.onPetTestCommitted(result, message, options);
  const second = await pets.onPetTestCommitted(result, message, options);

  assert.deepEqual(first, {
    ok: false,
    reason: "pet-update-failed",
    update: null,
    state: "unknown",
    retryTest: false
  });
  assert.deepEqual(second, first);
  assert.equal(attempts, 1);
});

test("a rejected command-condition write reports unknown state and is not replayed", async () => {
  const crow = human();
  const pet = animal();
  pet.system.pet.ownerUuid = crow.uuid;
  pet.system.conditions = { weakened: false };
  let attempts = 0;
  pet.update = async () => {
    attempts += 1;
    throw new Error("backend result unknown");
  };
  const message = { id: "Message.command-condition-failed" };
  const result = {
    actorId: crow.id,
    state: "committed",
    tier: 2,
    kind: "test",
    targets: [],
    allowedExpertises: ["handlePet"],
    attack: null,
    casting: null,
    miasma: null,
    petContext: {
      kind: "command",
      animalUuid: pet.uuid,
      humanUuid: crow.uuid,
      needsTest: true
    }
  };
  const options = {
    resolveUuid: async (uuid) => uuid === pet.uuid ? pet : crow
  };

  const first = await pets.onPetTestCommitted(result, message, options);
  const second = await pets.onPetTestCommitted(result, message, options);

  assert.deepEqual(first, {
    ok: false,
    reason: "pet-condition-failed",
    update: null,
    state: "unknown",
    retryTest: false
  });
  assert.deepEqual(second, first);
  assert.equal(attempts, 1);
  assert.equal(pet.system.conditions.weakened, false);
  assert.deepEqual([...pet.statuses], []);
});
