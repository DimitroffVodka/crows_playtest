import "./shim/foundry.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveBondPetActivity,
  takeRest,
  takeTownActivity
} from "../module/helpers/rest.mjs";

function restingCrow(events, { woundSlots = [] } = {}) {
  return {
    id: "crow1",
    uuid: "Actor.crow1",
    type: "crow",
    name: "Mara",
    flags: { crows: { advancementWindow: false } },
    items: [],
    system: {
      characteristics: {
        agility: { value: 0 },
        mind: { value: 0 },
        strength: { value: 0 }
      },
      expertises: {},
      miasma: { permanentNPC: false },
      preparedTask: { task: "", bonus: 2, setOn: "" },
      stamina: { value: 3, max: 5 },
      woundSlots: [...woundSlots],
      currency: 0,
      xp: { txp: 0, spendable: 0, expertiseBonusesSpent: 0, charBonusesSpent: 0 }
    },
    async update(data) {
      events.push({ document: "crow", data: structuredClone(data) });
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    },
    async updateEmbeddedDocuments() { return []; },
    async setFlag(scope, key, value) {
      events.push({ document: "crow-flag", data: { scope, key, value } });
      foundry.utils.setProperty(this, `flags.${scope}.${key}`, value);
      return this;
    }
  };
}

function prospectivePet(events, {
  uuid = "Actor.pet1",
  ownerUuid = "",
  prospectiveOwnerUuid = "Actor.crow1",
  followsUntil = 1_000,
  creatureType = "animal"
} = {}) {
  return {
    id: "pet1",
    uuid,
    type: "monster",
    name: "Ash",
    system: {
      creatureType,
      pet: {
        ownerUuid,
        prospectiveOwnerUuid,
        followsUntil,
        riderUuid: "Actor.oldRider",
        lastFedAt: 0
      }
    },
    updates: [],
    async update(data) {
      const copy = structuredClone(data);
      this.updates.push(copy);
      events.push({ document: "pet", data: copy });
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

async function withRestBoundary(pet, callback, {
  worldTime = 900,
  game: gameOverrides = {},
  RollClass = null,
  resolveUuid = null
} = {}) {
  const previousChatMessage = globalThis.ChatMessage;
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  const previousUi = globalThis.ui;
  const previousResolver = foundry.utils.fromUuid;
  const resolutions = [];

  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    async create(data) { return { id: "rest-pet-message", ...data }; }
  };
  globalThis.game = { ...gameOverrides, time: { worldTime } };
  if (RollClass) globalThis.Roll = RollClass;
  globalThis.ui = { notifications: { warn() {}, error() {} } };
  foundry.utils.fromUuid = async (uuid) => {
    resolutions.push(uuid);
    if (resolveUuid) return resolveUuid(uuid);
    return uuid === pet.uuid ? pet : null;
  };

  try {
    return await callback(resolutions);
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
    if (previousResolver === undefined) delete foundry.utils.fromUuid;
    else foundry.utils.fromUuid = previousResolver;
  }
}

test("a completed public rest bonds the exact prospective pet after rest benefits", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events);

  await withRestBoundary(pet, async (resolutions) => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: true,
      encounterChecks: false
    });

    assert.equal(result.ok, true);
    assert.equal(result.activity, "bondPet", "the registered activity must not normalize to none");
    assert.deepEqual(resolutions, ["Actor.pet1"], "the full UUID is the only lookup key");
    assert.deepEqual(result.activityResult, {
      ok: true,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      outcome: "owned",
      completed: true
    });
    assert.deepEqual(pet.updates, [{
      "system.pet.ownerUuid": "Actor.crow1",
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0,
      "system.pet.riderUuid": ""
    }]);
    assert.deepEqual(pet.system.pet, {
      ownerUuid: "Actor.crow1",
      prospectiveOwnerUuid: "",
      followsUntil: 0,
      riderUuid: "",
      lastFedAt: 0
    });
    assert.ok(
      events.findIndex((event) => event.document === "crow")
        < events.findIndex((event) => event.document === "pet"),
      "ownership must land only after the crow's rest benefits"
    );
  });
});

test("a two-hour town activity completes bonding at the exact expiry boundary", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events, { followsUntil: 1_000 });

  await withRestBoundary(pet, async (resolutions) => {
    const result = await takeTownActivity(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      day: "7"
    });

    assert.equal(result.ok, true);
    assert.equal(result.activity, "bondPet");
    assert.equal(result.hours, 2);
    assert.deepEqual(result.result, {
      ok: true,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      outcome: "owned",
      completed: true
    });
    assert.deepEqual(resolutions, ["Actor.pet1"]);
    assert.deepEqual(pet.updates, [{
      "system.pet.ownerUuid": "Actor.crow1",
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0,
      "system.pet.riderUuid": ""
    }]);
    assert.equal(events.some((event) => event.document === "crow"), false,
      "a town activity is not a full rest and grants no crow rest benefits");
  }, { worldTime: 1_000 });
});

test("an unfinished bonding rest waits without writing the animal", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events);

  const result = await resolveBondPetActivity(actor, { petUuid: "Actor.pet1" }, {
    restCompleted: false,
    now: 900,
    resolveUuid: async (uuid) => uuid === "Actor.pet1" ? pet : null
  });

  assert.deepEqual(result, {
    ok: true,
    activity: "bondPet",
    petUuid: "Actor.pet1",
    outcome: "waiting-for-rest",
    completed: false
  });
  assert.deepEqual(pet.updates, []);
});

test("bonding validation failures are explicit and never write the animal", async (t) => {
  const cases = [
    {
      name: "missing UUID",
      data: {},
      expected: { petUuid: "", error: "missing-pet-uuid" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "null world clock",
      data: { petUuid: "Actor.pet1" },
      now: null,
      expected: { petUuid: "Actor.pet1", error: "world-time-unavailable" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "NaN world clock",
      data: { petUuid: "Actor.pet1" },
      now: Number.NaN,
      expected: { petUuid: "Actor.pet1", error: "world-time-unavailable" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "infinite world clock",
      data: { petUuid: "Actor.pet1" },
      now: Number.POSITIVE_INFINITY,
      expected: { petUuid: "Actor.pet1", error: "world-time-unavailable" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "negative world clock",
      data: { petUuid: "Actor.pet1" },
      now: -1,
      expected: { petUuid: "Actor.pet1", error: "world-time-unavailable" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "raw actor id",
      data: { petUuid: "pet1" },
      expected: { petUuid: "pet1", error: "invalid-pet-uuid" },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "compendium Actor",
      data: { petUuid: "Compendium.crows.crows-monsters.Actor.pet1" },
      expected: {
        petUuid: "Compendium.crows.crows-monsters.Actor.pet1",
        error: "invalid-pet-uuid"
      },
      resolver: async () => { throw new Error("resolver must not run"); }
    },
    {
      name: "unknown UUID",
      data: { petUuid: "Actor.missing" },
      expected: { petUuid: "Actor.missing", error: "pet-not-found" },
      resolver: async () => null
    },
    {
      name: "resolver failure",
      data: { petUuid: "Actor.broken" },
      expected: { petUuid: "Actor.broken", error: "pet-resolution-failed" },
      resolver: async () => { throw new Error("socket failed"); }
    },
    {
      name: "non-animal",
      data: { petUuid: "Actor.pet1" },
      expected: { petUuid: "Actor.pet1", error: "not-an-animal" },
      pet: prospectivePet([], { creatureType: "blood" })
    },
    {
      name: "owner is not human",
      data: { petUuid: "Actor.pet1" },
      expected: { petUuid: "Actor.pet1", error: "owner-not-human" },
      human: prospectivePet([])
    },
    {
      name: "owner has no UUID",
      data: { petUuid: "Actor.pet1" },
      expected: { petUuid: "Actor.pet1", error: "owner-missing-uuid" },
      human: { ...restingCrow([]), uuid: "" }
    },
    {
      name: "already owned precedes prospective-owner mismatch",
      data: { petUuid: "Actor.pet1" },
      expected: { petUuid: "Actor.pet1", error: "already-owned" },
      pet: prospectivePet([], { ownerUuid: "Actor.other", prospectiveOwnerUuid: "Actor.wrong" })
    },
    {
      name: "wrong prospective owner",
      data: { petUuid: "Actor.pet1" },
      expected: { petUuid: "Actor.pet1", error: "not-prospective-owner" },
      pet: prospectivePet([], { prospectiveOwnerUuid: "Actor.other" })
    },
    {
      name: "expired follow",
      data: { petUuid: "Actor.pet1" },
      now: 1_001,
      expected: { petUuid: "Actor.pet1", error: "following-expired" },
      pet: prospectivePet([], { followsUntil: 1_000 })
    }
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const actor = entry.human ?? restingCrow([]);
      const pet = entry.pet ?? prospectivePet([]);
      const result = await resolveBondPetActivity(actor, entry.data, {
        restCompleted: true,
        now: Object.hasOwn(entry, "now") ? entry.now : 900,
        resolveUuid: entry.resolver ?? (async () => pet)
      });

      assert.deepEqual(result, {
        ok: false,
        activity: "bondPet",
        petUuid: entry.expected.petUuid,
        error: entry.expected.error
      });
      assert.deepEqual(pet.updates, []);
    });
  }
});

test("a rejected pet update reports unknown state and forbids replaying the rest", async () => {
  const actor = restingCrow([]);
  const pet = prospectivePet([]);
  let attempts = 0;
  pet.update = async () => {
    attempts += 1;
    throw new Error("document update uncertain");
  };

  const result = await resolveBondPetActivity(actor, { petUuid: "Actor.pet1" }, {
    restCompleted: true,
    now: 900,
    resolveUuid: async () => pet
  });

  assert.deepEqual(result, {
    ok: false,
    activity: "bondPet",
    petUuid: "Actor.pet1",
    error: "pet-update-failed",
    state: "unknown",
    retryRest: false
  });
  assert.equal(attempts, 1);
});

test("an expired public bonding activity fails explicitly without failing the rest", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events, { followsUntil: 1_000 });

  await withRestBoundary(pet, async () => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: true,
      encounterChecks: false
    });

    assert.equal(result.ok, true, "the rest contract remains successful");
    assert.deepEqual(result.activityResult, {
      ok: false,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      error: "following-expired"
    });
    assert.equal(actor.system.stamina.value, 5, "ordinary rest benefits still land");
    assert.equal(actor.flags.crows.advancementWindow, true);
    assert.deepEqual(pet.updates, []);
  }, { worldTime: 1_001 });
});

test("a rest failure before benefits never resolves or writes the prospective pet", async () => {
  const events = [];
  const actor = restingCrow(events, { woundSlots: [0] });
  const pet = prospectivePet(events);

  await withRestBoundary(pet, async (resolutions) => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: true,
      encounterChecks: false,
      woundChoices: [99]
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /does not hold a wound/i);
    assert.deepEqual(resolutions, []);
    assert.deepEqual(pet.updates, []);
    assert.equal(pet.system.pet.prospectiveOwnerUuid, "Actor.crow1");
    assert.equal(pet.system.pet.ownerUuid, "");
  });
});

test("an interrupted six-hour rest leaves bonding waiting while ordinary rest benefits land", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events);
  const settings = new Map();

  class TriggeredEncounterRoll {
    constructor(formula) {
      assert.equal(formula, "1d10");
      this.total = 10;
    }
    async evaluate() { return this; }
  }

  await withRestBoundary(pet, async (resolutions) => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: false,
      encounterChecks: true
    });

    assert.equal(result.ok, true);
    assert.equal(result.interrupted, true);
    assert.deepEqual(result.activityResult, {
      ok: true,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      outcome: "waiting-for-rest",
      completed: false
    });
    assert.deepEqual(resolutions, ["Actor.pet1"]);
    assert.deepEqual(pet.updates, []);
    assert.equal(pet.system.pet.ownerUuid, "");
    assert.equal(pet.system.pet.prospectiveOwnerUuid, "Actor.crow1");
    assert.equal(actor.system.stamina.value, 5);
    assert.equal(actor.flags.crows.advancementWindow, true,
      "the separate frozen advancement-window policy remains unchanged");
  }, {
    worldTime: 900,
    RollClass: TriggeredEncounterRoll,
    game: {
      actors: [],
      settings: {
        get: (_scope, key) => settings.get(key),
        async set(_scope, key, value) {
          settings.set(key, value);
          return value;
        }
      }
    }
  });
});

test("a synthetic pet UUID resolves through its exact parent Token without an actor-id fallback", async () => {
  const events = [];
  const actor = restingCrow(events);
  const syntheticUuid = "Scene.scene1.Token.token1.Actor.basePet";
  const tokenUuid = "Scene.scene1.Token.token1";
  const pet = prospectivePet(events, { uuid: syntheticUuid });

  await withRestBoundary(pet, async (resolutions) => {
    const result = await takeTownActivity(actor, {
      activity: "bondPet",
      activityData: { petUuid: syntheticUuid },
      day: "8"
    });

    assert.equal(result.ok, true);
    assert.equal(result.result.outcome, "owned");
    assert.deepEqual(resolutions, [syntheticUuid, tokenUuid]);
    assert.equal(resolutions.includes("basePet"), false, "raw actor ids are never a lookup fallback");
    assert.deepEqual(pet.updates, [{
      "system.pet.ownerUuid": "Actor.crow1",
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0,
      "system.pet.riderUuid": ""
    }]);
  }, {
    resolveUuid: async (uuid) => {
      if (uuid === syntheticUuid) throw new Error("synthetic Actor is not a declared embedded document");
      return uuid === tokenUuid ? { actor: pet } : null;
    }
  });
});

test("a pet write rejection is a nested non-retryable activity failure, not a second rest", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events);
  let attempts = 0;
  pet.update = async () => {
    attempts += 1;
    throw new Error("backend result unknown");
  };

  await withRestBoundary(pet, async () => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: true,
      encounterChecks: false
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.activityResult, {
      ok: false,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      error: "pet-update-failed",
      state: "unknown",
      retryRest: false
    });
    assert.equal(attempts, 1);
    assert.equal(actor.system.stamina.value, 5);
    assert.equal(actor.flags.crows.advancementWindow, true);
  });
});

test("a later Miasma failure keeps the already-completed bond and forbids replaying the rest", async () => {
  const events = [];
  const actor = restingCrow(events);
  const pet = prospectivePet(events);
  const settings = new Map([["inMiasma", true]]);

  class MiasmaRollFailure {
    constructor(formula) {
      assert.equal(formula, "2d10");
      throw new Error("automatic resistance unavailable");
    }
  }

  await withRestBoundary(pet, async () => {
    const result = await takeRest(actor, {
      activity: "bondPet",
      activityData: { petUuid: "Actor.pet1" },
      inTown: false,
      encounterChecks: false
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "miasma-resist-failed");
    assert.equal(result.completed, true);
    assert.equal(result.partial, true);
    assert.equal(result.retryRest, false);
    assert.deepEqual(result.activityResult, {
      ok: true,
      activity: "bondPet",
      petUuid: "Actor.pet1",
      outcome: "owned",
      completed: true
    });
    assert.equal(pet.updates.length, 1);
    assert.equal(pet.system.pet.ownerUuid, "Actor.crow1");
    assert.equal(pet.system.pet.prospectiveOwnerUuid, "");
    assert.equal(actor.flags.crows.advancementWindow, false);
  }, {
    RollClass: MiasmaRollFailure,
    game: {
      actors: [],
      settings: {
        get: (_scope, key) => settings.get(key),
        async set(_scope, key, value) {
          settings.set(key, value);
          return value;
        }
      }
    }
  });
});
