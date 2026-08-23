import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCharacteristics, characteristicSpread
} from "../module/helpers/character-creator.mjs";
import { applyBackground } from "../module/helpers/creation.mjs";
import { CROWS_STATUS, registerConditions } from "../module/conditions.mjs";

describe("Playtest 2 characteristic creation", () => {
  test("the background sets one characteristic to 2; the others take 1 and 0", () => {
    const result = characteristicSpread({
      backgroundCharacteristic: "mind",
      remainingHigh: "agility",
      spread: "1-0"
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.values, { mind: 2, agility: 1, strength: 0 });
  });

  test("the alternate remaining spread is 2 and -1, assigned freely", () => {
    const result = characteristicSpread({
      backgroundCharacteristic: "agility",
      remainingHigh: "strength",
      spread: "2--1"
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.values, { agility: 2, strength: 2, mind: -1 });
  });

  test("invalid or overlapping choices are refused before an actor write", async () => {
    let writes = 0;
    const actor = { type: "crow", update: async () => { writes += 1; } };
    const result = await applyCharacteristics(actor, {
      backgroundCharacteristic: "mind",
      remainingHigh: "mind",
      spread: "1-0"
    });
    assert.equal(result.ok, false);
    assert.equal(writes, 0);
  });
});

describe("Playtest 2 background grants", () => {
  test("expertise uses raise max and remaining together, and the stable id is stamped", async () => {
    let update = null;
    const actor = {
      type: "crow",
      system: {
        expertises: {
          bow: { value: 0, max: 0 },
          search: { value: 1, max: 1 }
        }
      },
      update: async (data) => { update = data; },
      createEmbeddedDocuments: async () => []
    };
    const background = {
      id: "bg-archer",
      name: "Archer",
      system: {
        stamina: 7,
        expertises: [
          { key: "bow", uses: 2 },
          { key: "search", uses: 1 }
        ],
        equipment: [],
        spellbooks: [],
        startingTrait: ""
      }
    };
    const result = await applyBackground(actor, background);
    assert.equal(result.ok, true);
    assert.equal(update["system.backgroundId"], "bg-archer");
    assert.equal(update["system.expertises.bow.max"], 2);
    assert.equal(update["system.expertises.bow.value"], 2);
    assert.equal(update["system.expertises.search.max"], 2);
    assert.equal(update["system.expertises.search.value"], 2);
    assert.deepEqual(result.expertiseUses, { bow: 2, search: 1 });
  });
});

describe("v14 status-effect registration", () => {
  test("preserves the proxy so statuses are indexed by both position and id", () => {
    const statuses = new Proxy([], {
      set(target, property, value) {
        if (property === "length") {
          target.length = value;
          return true;
        }
        const index = Number(property);
        if (Number.isInteger(index)) {
          target[index] = value;
          target[value.id] = value;
          return true;
        }
        target[property] = value;
        return true;
      }
    });
    const previous = globalThis.CONFIG;
    globalThis.CONFIG = { ...(previous ?? {}), statusEffects: statuses };
    try {
      registerConditions();
      assert.equal(statuses.length, CROWS_STATUS.length);
      assert.equal(statuses.blessed.id, "blessed");
      assert.equal(statuses.dead.id, "dead");
      assert.equal(statuses.boned, undefined);
    } finally {
      globalThis.CONFIG = previous;
    }
  });
});
