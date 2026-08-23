import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKLASH_TABLE,
  backlashUsageDice,
  hasDuration,
  rollBacklash
} from "../module/helpers/backlash.mjs";
import * as dungeonTurn from "../module/helpers/dungeon-turn.mjs";
import { onTestCommitted } from "../module/helpers/spellcasting.mjs";

function fakeActor({ effects = [], events = null } = {}) {
  return {
    id: "Actor.backlash",
    name: "Backlash Crow",
    type: "crow",
    effects,
    created: [],
    async createEmbeddedDocuments(type, sources) {
      events?.push("create-effect");
      this.created.push({ type, sources: structuredClone(sources) });
      return [];
    }
  };
}

async function withChatMessage(run, { events = null } = {}) {
  const previous = globalThis.ChatMessage;
  const messages = [];
  globalThis.ChatMessage = {
    getWhisperRecipients: () => [],
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    create: async data => {
      events?.push("create-chat");
      messages.push(structuredClone(data));
      return { id: "Message.backlash", ...data };
    }
  };
  try {
    return await run(messages);
  } finally {
    if (previous === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previous;
  }
}

async function withCommittedCastingGlobals(actor, run) {
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  globalThis.game = {
    actors: { get: id => id === actor.id ? actor : null }
  };
  globalThis.Roll = class DeterministicBacklashRoll {
    constructor(formula) {
      assert.equal(formula, "1d100 + 0");
      this.total = 83;
    }
    async evaluate() { return this; }
  };
  try {
    return await withChatMessage(run);
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
}

async function withDungeonTurnGlobals(actors, faces, run) {
  const previousGame = globalThis.game;
  const previousRoll = globalThis.Roll;
  globalThis.game = { actors };
  globalThis.Roll = class DeterministicBacklashDie {
    constructor(formula) {
      assert.equal(formula, "1d6");
      this.total = faces.shift();
      this.dice = [{ results: [{ result: this.total }] }];
    }
    async evaluate() { return this; }
  };
  try {
    return await run();
  } finally {
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
  }
}

function fakeBacklashEffect({ id = "Effect.backlash", current = 2 } = {}) {
  return {
    id,
    name: "Backlash 83-84",
    flags: { crows: { backlash: {
      sourceRange: "83-84",
      duration: { kind: "ud", current }
    } } },
    updates: [],
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function fakeClockActor(effect, { type = "monster" } = {}) {
  return {
    id: "Actor.clock",
    name: "Clock Target",
    type,
    effects: [effect],
    deletions: [],
    async deleteEmbeddedDocuments(documentName, ids) {
      this.deletions.push({ documentName, ids: [...ids] });
      this.effects = this.effects.filter(candidate => !ids.includes(candidate.id));
      return [];
    }
  };
}

function fakeDtItem(name) {
  return {
    name,
    system: { usageDie: { enabled: true, expiry: "dt", udCurrent: 1 } },
    updates: [],
    async update(data) {
      this.updates.push(structuredClone(data));
      for (const [path, value] of Object.entries(data)) {
        foundry.utils.setProperty(this, path, value);
      }
      return this;
    }
  };
}

function addDtActorState(actor, item) {
  actor.items = [item];
  actor.system = { conditions: { blessed: true } };
  actor.updates = [];
  actor.update = async function (data) {
    this.updates.push(structuredClone(data));
    for (const [path, value] of Object.entries(data)) {
      foundry.utils.setProperty(this, path, value);
    }
    return this;
  };
  actor.getFlag = () => false;
  return actor;
}

describe("backlash ActiveEffect lifecycle", () => {
  test("row 83-84 creates the canonical two-die backlash effect", async () => {
    const events = [];
    await withChatMessage(async () => {
      const actor = fakeActor({ events });
      const result = await rollBacklash({ actor, d100: async () => 83 });

      assert.equal(result.sourceRange, "83-84");
      assert.equal(actor.created.length, 1);
      assert.equal(actor.created[0].type, "ActiveEffect");
      assert.equal(actor.created[0].sources.length, 1);
      const source = actor.created[0].sources[0];
      assert.equal(source.name, "Backlash 83-84");
      assert.equal(source.description, result.text);
      assert.equal(source.transfer, false);
      assert.equal(source.system, undefined, "D4 must not invent prose mechanics");
      assert.equal(source.changes, undefined, "v14 changes do not live at the top level");
      assert.deepEqual(Object.keys(source.flags.crows), ["backlash"]);
      assert.deepEqual(source.flags.crows.backlash, {
        sourceRange: "83-84",
        duration: { kind: "ud", current: 2 }
      });
      assert.equal(source.flags.crows.backlash.duration.max, undefined);
      assert.equal(source.duration, undefined);
    }, { events });
    assert.deepEqual(events, ["create-effect", "create-chat"]);
  });

  test("all and only the 12 UD rows persist their exact pool", async () => {
    const expected = {
      "01-02": 1,
      "03-04": 1,
      "39-40": 1,
      "43-44": 1,
      "45-46": 1,
      "47-48": 1,
      "59-60": 1,
      "73-74": 1,
      "77-78": 1,
      "83-84": 2,
      "97-98": 2,
      "99-100": 2
    };
    const rows = BACKLASH_TABLE.filter(row => backlashUsageDice(row) > 0);
    assert.deepEqual(
      Object.fromEntries(rows.map(row => [row.sourceRange, backlashUsageDice(row)])),
      expected
    );

    await withChatMessage(async () => {
      for (const row of rows) {
        const actor = fakeActor();
        await rollBacklash({ actor, d100: async () => row.lo });
        assert.equal(actor.created.length, 1, row.sourceRange);
        assert.equal(
          actor.created[0].sources[0].flags.crows.backlash.sourceRange,
          row.sourceRange,
          row.sourceRange
        );
        assert.equal(
          actor.created[0].sources[0].flags.crows.backlash.duration.current,
          expected[row.sourceRange],
          row.sourceRange
        );
      }
    });
  });

  test("none of the 14 non-UD durational rows invents an expiry clock", async () => {
    const rows = BACKLASH_TABLE.filter(row => hasDuration(row) && backlashUsageDice(row) === 0);
    assert.equal(rows.length, 14);
    await withChatMessage(async () => {
      for (const row of rows) {
        const actor = fakeActor();
        const result = await rollBacklash({ actor, d100: async () => row.lo });
        assert.equal(result.sourceRange, row.sourceRange);
        assert.deepEqual(actor.created, [], row.sourceRange);
      }
    });
  });

  test("a UD result without a caster refuses instead of posting a half-result", async () => {
    await withChatMessage(async messages => {
      await assert.rejects(
        () => rollBacklash({ d100: async () => 83 }),
        /without a caster Actor/
      );
      assert.deepEqual(messages, []);
    });
  });

  test("a canonical active range makes rollBacklash reroll the duplicate", async () => {
    await withChatMessage(async () => {
      const actor = fakeActor({
        effects: [{
          id: "Effect.existing",
          flags: { crows: { backlash: {
            sourceRange: "83-84",
            duration: { kind: "ud", current: 2 }
          } } }
        }]
      });
      const faces = [83, 97];
      let rolls = 0;
      const result = await rollBacklash({
        actor,
        d100: async () => {
          rolls += 1;
          return faces.shift();
        }
      });

      assert.equal(rolls, 2);
      assert.equal(result.rerolled, true);
      assert.equal(result.sourceRange, "97-98");
      assert.equal(actor.created.length, 1);
      assert.equal(
        actor.created[0].sources[0].flags.crows.backlash.sourceRange,
        "97-98"
      );
    });
  });

  test("the committed casting subscriber passes the resolved world actor to D4", async () => {
    const actor = fakeActor();
    actor.items = { get: () => null };

    await withCommittedCastingGlobals(actor, async () => {
      const result = await onTestCommitted({
        kind: "casting",
        state: "committed",
        tier: 1,
        doom: true,
        actorId: actor.id,
        casting: {
          castId: "Cast.backlash",
          rank: 0,
          discipline: "elemental",
          spellbookName: "Probe Spell"
        }
      });

      assert.equal(result.backlash.sourceRange, "83-84");
      assert.equal(actor.created.length, 1);
      assert.equal(actor.created[0].type, "ActiveEffect");
    });
  });

  test("the focused clock decays a canonical effect on any actor", async () => {
    const effect = fakeBacklashEffect({ current: 2 });
    const actor = fakeClockActor(effect, { type: "monster" });
    const faces = [1, 6];
    let rolls = 0;

    await dungeonTurn.tickBacklashUsageDice([actor], {
      rollD6: async () => {
        rolls += 1;
        return faces.shift();
      }
    });

    assert.equal(rolls, 2);
    assert.deepEqual(effect.updates, [{
      "flags.crows.backlash.duration.current": 1
    }]);
    assert.equal(effect.flags.crows.backlash.duration.current, 1);
    assert.deepEqual(actor.deletions, []);
    assert.equal(actor.effects.length, 1);
  });

  test("the focused clock deletes the whole effect when its last die expires", async () => {
    const effect = fakeBacklashEffect({ current: 1 });
    const actor = fakeClockActor(effect);

    await dungeonTurn.tickBacklashUsageDice([actor], {
      rollD6: async () => 2
    });

    assert.deepEqual(effect.updates, []);
    assert.deepEqual(actor.deletions, [{
      documentName: "ActiveEffect",
      ids: [effect.id]
    }]);
    assert.deepEqual(actor.effects, []);
  });

  test("the end-of-DT orchestrator delegates canonical effects for every actor type", async () => {
    const effect = fakeBacklashEffect({ current: 1 });
    const actor = fakeClockActor(effect, { type: "monster" });

    const result = await withDungeonTurnGlobals([actor], [2], () =>
      dungeonTurn.runEndOfDtEffects()
    );

    assert.equal(result.backlash.length, 1);
    assert.deepEqual(actor.deletions, [{
      documentName: "ActiveEffect",
      ids: [effect.id]
    }]);
    assert.deepEqual(actor.effects, []);
  });

  test("the mixed actor orchestrator keeps item and condition clocks crow-only", async () => {
    const crowItem = fakeDtItem("Crow Torch");
    const crow = addDtActorState(fakeClockActor(null, { type: "crow" }), crowItem);
    crow.id = "Actor.crow-clock";
    crow.name = "Crow Clock";
    crow.effects = [];

    const monsterItem = fakeDtItem("Monster Torch");
    const effect = fakeBacklashEffect({ current: 1 });
    const monster = addDtActorState(
      fakeClockActor(effect, { type: "monster" }),
      monsterItem
    );
    monster.id = "Actor.monster-clock";
    monster.name = "Monster Clock";

    const faces = [2, 2];
    const result = await withDungeonTurnGlobals([crow, monster], faces, () =>
      dungeonTurn.runEndOfDtEffects()
    );

    assert.deepEqual(faces, []);
    assert.equal(result.udRolls.length, 1);
    assert.equal(result.udRolls[0].actor, "Crow Clock");
    assert.equal(result.expired.length, 1);
    assert.equal(result.expired[0].actor, "Crow Clock");
    assert.equal(result.backlash.length, 1);
    assert.equal(result.backlash[0].actor, "Monster Clock");

    assert.deepEqual(crowItem.updates, [{ "system.usageDie.udCurrent": 0 }]);
    assert.equal(crow.system.conditions.blessed, false);
    assert.deepEqual(monsterItem.updates, []);
    assert.equal(monster.system.conditions.blessed, true);
    assert.deepEqual(monster.effects, []);
  });

  test("a concurrently completed delete is an idempotent success", async () => {
    const effect = fakeBacklashEffect({ current: 1 });
    const actor = fakeClockActor(effect);
    actor.deleteEmbeddedDocuments = async function (documentName, ids) {
      this.deletions.push({ documentName, ids: [...ids] });
      this.effects = [];
      throw new Error("ActiveEffect no longer exists");
    };

    await assert.doesNotReject(() => dungeonTurn.tickBacklashUsageDice([actor], {
      rollD6: async () => 1
    }));

    assert.equal(actor.deletions.length, 1);
    assert.deepEqual(actor.effects, []);
    assert.deepEqual(actor.created ?? [], []);
  });

  test("an already-depleted canonical effect is deleted without another roll", async () => {
    const effect = fakeBacklashEffect({ current: 0 });
    const actor = fakeClockActor(effect);
    let rolls = 0;

    await dungeonTurn.tickBacklashUsageDice([actor], {
      rollD6: async () => {
        rolls += 1;
        return 6;
      }
    });

    assert.equal(rolls, 0);
    assert.equal(actor.deletions.length, 1);
    assert.deepEqual(actor.effects, []);
  });

  test("an effect deleted while its dice roll is never updated or recreated", async () => {
    const effect = fakeBacklashEffect({ current: 2 });
    const actor = fakeClockActor(effect);
    const faces = [1, 6];

    await dungeonTurn.tickBacklashUsageDice([actor], {
      rollD6: async () => {
        const face = faces.shift();
        if (faces.length === 0) actor.effects = [];
        return face;
      }
    });

    assert.deepEqual(effect.updates, []);
    assert.deepEqual(actor.deletions, []);
    assert.deepEqual(actor.effects, []);
    assert.deepEqual(actor.created ?? [], []);
  });
});
