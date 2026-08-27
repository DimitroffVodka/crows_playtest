import "./shim/foundry.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { takeRest } from "../module/helpers/rest.mjs";
import { rollTest } from "../module/helpers/roll.mjs";
import {
  openSpendingWindow,
  purchaseTrait,
  spendCharBonus,
  spendExpertiseBonus,
  spendingWindow
} from "../module/helpers/advancement.mjs";

function lifecycleCrow({ window = false, txp = 100, spendable = 0, woundSlots = [] } = {}) {
  const actor = {
    id: "advancement-window-crow",
    type: "crow",
    name: "Window Crow",
    flags: { crows: { advancementWindow: window, unrelated: "preserved" } },
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
      xp: {
        txp,
        spendable,
        expertiseBonusesSpent: 0,
        charBonusesSpent: 0
      }
    },
    updates: [],
    flagWrites: [],
    embeddedCreates: [],
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    },
    async updateEmbeddedDocuments() { return []; },
    async createEmbeddedDocuments(type, docs) {
      const created = docs.map((doc, index) => ({
        ...structuredClone(doc),
        id: doc.id ?? doc._id ?? `${type.toLowerCase()}-${this.items.length + index + 1}`
      }));
      this.embeddedCreates.push({ type, docs: structuredClone(docs) });
      if (type === "Item") this.items.push(...created);
      return created;
    },
    async setFlag(scope, key, value) {
      this.flagWrites.push({ scope, key, value });
      foundry.utils.setProperty(this, `flags.${scope}.${key}`, value);
      return this;
    }
  };
  return actor;
}

test("a completed public rest opens advancement and permits a claim", async () => {
  const actor = lifecycleCrow();
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    async create(data) { return { id: "window-test-message", ...data }; }
  };

  try {
    const rest = await takeRest(actor, { inTown: true, encounterChecks: false });

    assert.equal(rest.ok, true);
    assert.equal(rest.interrupted, false);
    assert.equal(actor.flags.crows.advancementWindow, true);
    assert.equal(actor.flags.crows.unrelated, "preserved");
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });

    const spend = await spendExpertiseBonus(actor, "stamina");
    assert.equal(spend.ok, true, spend.error);
    assert.equal(actor.system.stamina.max, 7);
    assert.equal(actor.system.stamina.value, 7);
    assert.equal(actor.system.xp.expertiseBonusesSpent, 1);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
  }
});

test("a failed public rest leaves a closed window closed and writes nothing", async () => {
  const actor = lifecycleCrow({ woundSlots: [0] });
  const previousUi = globalThis.ui;
  globalThis.ui = { notifications: { warn() {} } };

  try {
    const rest = await takeRest(actor, {
      inTown: true,
      encounterChecks: false,
      woundChoices: [99]
    });

    assert.equal(rest.ok, false);
    assert.match(rest.error, /does not hold a wound/);
    assert.deepEqual(actor.flagWrites, []);
    assert.deepEqual(actor.updates, []);
    assert.deepEqual(spendingWindow(actor), { open: false, state: "closed" });
  } finally {
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
  }
});

test("an ok interrupted rest still opens under the current benefit-completion contract", async () => {
  const actor = lifecycleCrow();
  const previousChatMessage = globalThis.ChatMessage;
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  const settings = new Map();

  class EncounterRoll {
    constructor(formula) {
      assert.equal(formula, "1d10");
      this.total = 10;
    }

    async evaluate() { return this; }
  }

  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    getWhisperRecipients: () => [],
    async create(data) { return { id: `message-${String(data?.content ?? "").length}`, ...data }; }
  };
  globalThis.game = {
    actors: [],
    settings: {
      get: (_scope, key) => settings.get(key),
      async set(_scope, key, value) { settings.set(key, value); return value; }
    }
  };
  globalThis.Roll = EncounterRoll;

  try {
    const rest = await takeRest(actor, { inTown: false, encounterChecks: true });

    assert.equal(rest.ok, true);
    assert.equal(rest.interrupted, true);
    assert.equal(actor.flags.crows.advancementWindow, true);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
});

test("a Miasma rest opens only after its automatic resistance test", async () => {
  const actor = lifecycleCrow({ window: true });
  const previousChatMessage = globalThis.ChatMessage;
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  const previousApplications = globalThis.foundry.applications;
  let windowAtMiasmaRollConstruction = null;
  const settings = new Map([["inMiasma", true]]);

  class MiasmaRoll {
    constructor(formula) {
      assert.equal(formula, "2d10");
      windowAtMiasmaRollConstruction = actor.flags.crows.advancementWindow;
      this.dice = [{ faces: 10, results: [{ result: 5 }, { result: 5 }] }];
      this.total = 10;
    }

    async evaluate() { return this; }
    async toMessage(data) { return { id: "miasma-window-message", ...data }; }
  }

  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    getWhisperRecipients: () => [],
    async create(data) { return { id: "miasma-rest-message", ...data }; }
  };
  globalThis.game = {
    actors: [],
    settings: {
      get: (_scope, key) => settings.get(key),
      async set(_scope, key, value) { settings.set(key, value); return value; }
    },
    i18n: { localize: (key) => key }
  };
  globalThis.Roll = MiasmaRoll;
  globalThis.foundry.applications = {
    handlebars: { renderTemplate: async () => "<div>miasma test card</div>" }
  };

  try {
    const rest = await takeRest(actor, { inTown: false, encounterChecks: false });

    assert.equal(rest.ok, true);
    assert.equal(rest.inMiasma, true);
    assert.equal(rest.miasmaResult.ok, true);
    assert.equal(windowAtMiasmaRollConstruction, false);
    assert.deepEqual(actor.flagWrites.map(write => write.value), [false, true]);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousApplications === undefined) delete globalThis.foundry.applications;
    else globalThis.foundry.applications = previousApplications;
  }
});

test("a refused automatic Miasma test surfaces a partial rest and never opens", async () => {
  const actor = lifecycleCrow({ window: true });
  const previousChatMessage = globalThis.ChatMessage;
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  const previousUi = globalThis.ui;
  const settings = new Map([["inMiasma", true]]);
  const visibleErrors = [];
  let rollConstructions = 0;
  let closeAttempts = 0;

  actor.setFlag = async (scope, key, value) => {
    actor.flagWrites.push({ scope, key, value });
    if (value === false && closeAttempts++ === 0) {
      throw new Error("first Miasma close failed");
    }
    foundry.utils.setProperty(actor, `flags.${scope}.${key}`, value);
    return actor;
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    getWhisperRecipients: () => [],
    async create(data) { return { id: "failed-miasma-rest-message", ...data }; }
  };
  globalThis.game = {
    actors: [],
    settings: {
      get: (_scope, key) => settings.get(key),
      async set(_scope, key, value) { settings.set(key, value); return value; }
    }
  };
  globalThis.Roll = class MiasmaRollBomb {
    constructor() { rollConstructions += 1; }
  };
  globalThis.ui = {
    notifications: {
      error(message) { visibleErrors.push(message); },
      warn(message) { visibleErrors.push(message); }
    }
  };

  try {
    const rest = await takeRest(actor, { inTown: false, encounterChecks: false });

    assert.equal(rest.ok, false);
    assert.equal(rest.completed, true);
    assert.equal(rest.partial, true);
    assert.equal(rest.retryRest, false);
    assert.equal(rest.error, "miasma-resist-failed");
    assert.deepEqual(rest.miasmaResult, { ok: false, error: "miasma-resist-failed" });
    assert.equal(rest.advancementWindow.ok, false);
    assert.equal(rest.advancementWindow.open, false);
    assert.equal(rest.advancementWindow.recovery, "closed");
    assert.deepEqual(actor.flagWrites.map(write => write.value), [false, false]);
    assert.deepEqual(spendingWindow(actor), { open: false, state: "closed" });
    assert.equal(rollConstructions, 0);
    assert.equal(visibleErrors.length, 1);
    assert.match(visibleErrors[0], /do not repeat the rest/i);
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
  }
});

test("a final open failure is visible, non-retryable as a rest, and separately recoverable", async () => {
  const actor = lifecycleCrow();
  const previousChatMessage = globalThis.ChatMessage;
  const previousUi = globalThis.ui;
  const visibleErrors = [];
  const ordinarySetFlag = actor.setFlag.bind(actor);

  actor.setFlag = async (scope, key, value) => {
    actor.flagWrites.push({ scope, key, value });
    if (value === true) throw new Error("window open denied");
    foundry.utils.setProperty(actor, `flags.${scope}.${key}`, value);
    return actor;
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    async create(data) { return { id: "failed-window-open-message", ...data }; }
  };
  globalThis.ui = {
    notifications: {
      error(message) { visibleErrors.push(message); },
      warn(message) { visibleErrors.push(message); }
    }
  };

  try {
    let rest = null;
    await assert.doesNotReject(async () => {
      rest = await takeRest(actor, { inTown: true, encounterChecks: false });
    });

    assert.equal(rest.ok, false);
    assert.equal(rest.completed, true);
    assert.equal(rest.partial, true);
    assert.equal(rest.retryRest, false);
    assert.equal(rest.error, "advancement-window-open-failed");
    assert.deepEqual(rest.advancementWindow, {
      ok: false,
      open: false,
      error: "advancement-window-open-failed"
    });
    assert.equal(actor.system.stamina.value, 5, "the completed rest benefit is retained");
    assert.deepEqual(spendingWindow(actor), { open: false, state: "closed" });
    assert.equal(visibleErrors.length, 1);
    assert.match(visibleErrors[0], /do not repeat the rest/i);

    actor.setFlag = ordinarySetFlag;
    const retry = await openSpendingWindow(actor);
    assert.deepEqual(retry, { ok: true, open: true });
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousUi === undefined) delete globalThis.ui;
    else globalThis.ui = previousUi;
  }
});

test("multiple legal advancement claims remain possible until the next test", async () => {
  const actor = lifecycleCrow({ window: true, txp: 5000, spendable: 500 });
  const previousChatMessage = globalThis.ChatMessage;
  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null }),
    async create(data) { return { id: "advancement-message", ...data }; }
  };
  const startingTrait = {
    name: "Window Trait",
    type: "trait",
    system: {
      tree: "alchemy",
      tier: 1,
      isStarting: true,
      connectsTo: []
    }
  };

  try {
    const expertise = await spendExpertiseBonus(actor, "stamina");
    assert.equal(expertise.ok, true, expertise.error);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });

    const characteristic = await spendCharBonus(actor, "mind");
    assert.equal(characteristic.ok, true, characteristic.error);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });

    const trait = await purchaseTrait(actor, startingTrait);
    assert.equal(trait.ok, true, trait.error);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });

    assert.equal(actor.system.xp.expertiseBonusesSpent, 1);
    assert.equal(actor.system.xp.charBonusesSpent, 1);
    assert.equal(actor.system.characteristics.mind.value, 1);
    assert.equal(actor.system.xp.spendable, 0);
    assert.equal(actor.items.length, 1);
    assert.equal(actor.items[0].name, "Window Trait");
    assert.equal(actor.embeddedCreates.length, 1, "trait purchase uses the shared grant seam");
    const grantTxId = Object.keys(actor.system.commerce.receipts)[0];
    assert.match(grantTxId, /^trait-purchase:/);
    assert.equal(actor.embeddedCreates[0].docs[0].flags.crows.grant.txId, grantTxId);
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
  }
});

test("a failed trait grant does not spend XP or post success", async () => {
  const actor = lifecycleCrow({ window: true, txp: 5000, spendable: 500 });
  actor.createEmbeddedDocuments = async () => { throw new Error("capacity write failed"); };
  const previousChatMessage = globalThis.ChatMessage;
  let chats = 0;
  globalThis.ChatMessage = {
    getSpeaker: () => ({ actor: actor.id }),
    async create() { chats += 1; }
  };
  const startingTrait = {
    name: "Failed Trait", type: "trait",
    system: { tree: "alchemy", tier: 1, isStarting: true, connectsTo: [] }
  };

  try {
    const result = await purchaseTrait(actor, startingTrait);
    assert.equal(result.ok, false);
    assert.equal(result.error, "write-failed");
    assert.equal(actor.system.xp.spendable, 500);
    assert.equal(chats, 0);
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
  }
});

test("the next public test closes advancement before dice are constructed", async () => {
  const actor = lifecycleCrow({ window: true, txp: 500 });
  const previousChatMessage = globalThis.ChatMessage;
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  const previousApplications = globalThis.foundry.applications;
  let windowAtRollConstruction = null;

  class BoundaryRoll {
    constructor(formula) {
      assert.equal(formula, "2d10");
      windowAtRollConstruction = actor.flags.crows.advancementWindow;
      this.dice = [{ faces: 10, results: [{ result: 5 }, { result: 5 }] }];
      this.total = 10;
    }

    async evaluate() { return this; }
    async toMessage(data) { return { id: "window-roll-message", ...data }; }
  }

  globalThis.ChatMessage = {
    getSpeaker: ({ actor: speakerActor } = {}) => ({ actor: speakerActor?.id ?? null })
  };
  globalThis.game = {
    settings: { get: () => "publicroll" },
    i18n: { localize: (key) => key }
  };
  globalThis.Roll = BoundaryRoll;
  globalThis.foundry.applications = {
    handlebars: { renderTemplate: async () => "<div>test card</div>" }
  };

  try {
    const result = await rollTest({ actor, characteristic: "mind", flavor: "Window boundary" });

    assert.equal(result.state, "committed");
    assert.equal(windowAtRollConstruction, false);
    assert.deepEqual(spendingWindow(actor), { open: false, state: "closed" });

    const before = structuredClone(actor.system);
    const spend = await spendExpertiseBonus(actor, "stamina");
    assert.equal(spend.ok, false);
    assert.match(spend.error, /end of a rest/);
    assert.deepEqual(actor.system, before);
  } finally {
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousApplications === undefined) delete globalThis.foundry.applications;
    else globalThis.foundry.applications = previousApplications;
  }
});

test("a failed close refuses the test before any dice side effect", async () => {
  const actor = lifecycleCrow({ window: true });
  const previousRoll = globalThis.Roll;
  let rollConstructions = 0;

  actor.setFlag = async () => { throw new Error("window persistence denied"); };
  globalThis.Roll = class RefusedRoll {
    constructor() { rollConstructions += 1; }
  };

  try {
    await assert.rejects(
      rollTest({ actor, characteristic: "mind" }),
      /window persistence denied/
    );
    assert.equal(rollConstructions, 0);
    assert.deepEqual(spendingWindow(actor), { open: true, state: "open" });
  } finally {
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
});

test("a failed close cannot consume a matching prepared task", async () => {
  const actor = lifecycleCrow({ window: true });
  const previousRoll = globalThis.Roll;
  const preparedBefore = {
    task: "Open the abbey reliquary",
    bonus: 2,
    setOn: "7"
  };
  actor.system.preparedTask = structuredClone(preparedBefore);
  actor.setFlag = async () => { throw new Error("prepared close denied"); };
  let rollConstructions = 0;
  globalThis.Roll = class PreparedTaskRollBomb {
    constructor() { rollConstructions += 1; }
  };

  try {
    await assert.rejects(
      rollTest({
        actor,
        characteristic: "mind",
        task: "  open the abbey reliquary  "
      }),
      /prepared close denied/
    );
    assert.deepEqual(actor.system.preparedTask, preparedBefore);
    assert.deepEqual(actor.updates, []);
    assert.equal(rollConstructions, 0);
  } finally {
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
});
