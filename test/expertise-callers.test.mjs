import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { castSpell, _clearPendingCasts } from "../module/helpers/spellcasting.mjs";
import { rollMiasmaResist } from "../module/helpers/miasma.mjs";

async function withRollHarness(run, { raw = [6, 6] } = {}) {
  const previousRoll = globalThis.Roll;
  const previousGame = globalThis.game;
  const previousChatMessage = globalThis.ChatMessage;
  const previousApplications = globalThis.foundry.applications;
  let messageData = null;
  const createdMessages = [];

  globalThis.Roll = class DeterministicCallerRoll {
    constructor() {
      this.dice = [{ faces: 10, results: raw.map(result => ({ result })) }];
      this.total = raw.reduce((sum, value) => sum + value, 0);
    }
    async evaluate() { return this; }
    async toMessage(data) {
      messageData = data;
      return { id: "Message.expertiseCaller" };
    }
  };
  globalThis.game = {
    i18n: { localize: key => key },
    settings: { get: () => "publicroll" },
    user: { targets: new Set() }
  };
  globalThis.ChatMessage = {
    getSpeaker: ({ actor } = {}) => ({ actor: actor?.id ?? null }),
    create: async data => {
      createdMessages.push(data);
      return { id: "Message.callerOutcome" };
    }
  };
  globalThis.foundry.applications = {
    handlebars: { renderTemplate: async () => "<div>test</div>" }
  };

  try {
    return await run(() => messageData, createdMessages);
  } finally {
    _clearPendingCasts();
    if (previousRoll === undefined) delete globalThis.Roll;
    else globalThis.Roll = previousRoll;
    if (previousGame === undefined) delete globalThis.game;
    else globalThis.game = previousGame;
    if (previousChatMessage === undefined) delete globalThis.ChatMessage;
    else globalThis.ChatMessage = previousChatMessage;
    if (previousApplications === undefined) delete globalThis.foundry.applications;
    else globalThis.foundry.applications = previousApplications;
  }
}

describe("exact expertise declarations at roll callers", () => {
  test("castSpell persists its spellbook discipline and cannot be overridden by options", async () => {
    await withRollHarness(async getMessageData => {
      const actor = {
        id: "Actor.caster", name: "Caster", type: "crow", items: [],
        system: {
          conditions: {}, characteristics: { mind: { value: 0 } },
          expertises: { necromancy: { value: 1, max: 1 } }
        }
      };
      const spellbook = {
        id: "Item.corrupt", name: "Corrupt", type: "spellbook",
        system: {
          rank: 1, discipline: "necromancy", target: "1 creature",
          usageDie: { enabled: false, udCurrent: 0 }
        }
      };

      const out = await castSpell(actor, spellbook, { allowedExpertises: ["illusion"] });
      assert.deepEqual(out.test.allowedExpertises, ["necromancy"]);
      assert.deepEqual(getMessageData().flags.crows.test.allowedExpertises, ["necromancy"]);
    });
  });

  test("a pending Miasma Endurance test applies nothing before its committed tier", async () => {
    await withRollHarness(async (getMessageData, createdMessages) => {
      const actor = {
        id: "Actor.miasma", name: "Scout", type: "crow",
        system: {
          conditions: {}, miasma: {}, characteristics: { mind: { value: 0 } },
          expertises: { endurance: { value: 1, max: 1 } }
        },
        updates: [],
        async update(data) { this.updates.push(data); return this; }
      };

      const out = await rollMiasmaResist(actor);
      assert.equal(out.pending, true);
      assert.equal(out.test.state, "pending");
      assert.deepEqual(out.test.miasma, { kind: "resist" });
      assert.deepEqual(getMessageData().flags.crows.test.miasma, { kind: "resist" });
      assert.deepEqual(getMessageData().flags.crows.test.allowedExpertises, ["endurance"]);
      assert.deepEqual(actor.updates, [], "the pre-expertise tier must not mutate the actor");
      assert.deepEqual(createdMessages, [], "the pre-expertise tier must not post an outcome");
    }, { raw: [5, 5] });
  });

  test("a Miasma test with no Endurance use returns a committed initiation envelope", async () => {
    await withRollHarness(async getMessageData => {
      const actor = {
        id: "Actor.miasma-no-use", name: "Scout", type: "crow",
        system: {
          conditions: {}, miasma: {}, characteristics: { mind: { value: 0 } },
          expertises: { endurance: { value: 0, max: 1 } }
        },
        updates: [],
        async update(data) { this.updates.push(data); return this; }
      };

      const out = await rollMiasmaResist(actor);
      assert.equal(out.ok, true);
      assert.equal(out.pending, false);
      assert.equal(out.test.state, "committed");
      assert.equal(out.resolution, null, "the committed-test subscriber owns the outcome");
      assert.deepEqual(getMessageData().flags.crows.test.miasma, { kind: "resist" });
      assert.deepEqual(actor.updates, [], "the initiator never resolves even an immediate commit");
    }, { raw: [6, 6] });
  });
});
