import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import {
  adjustXRestUse,
  monsterViewData,
  toggleMonsterWound
} from "../module/helpers/monster-view.mjs";
import { ALL_EXPERTISES, CROWS } from "../module/config.mjs";

const MONSTER_DIR = new URL("../src/packs/crows-monsters/", import.meta.url).pathname;

function scalar(source, key) {
  const match = source.match(new RegExp(`^  ${key}:\\s*([^\\n#]+)`, "m"));
  return match?.[1]?.trim() ?? null;
}

function shippedMonsters() {
  return readdirSync(MONSTER_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => {
      const source = readFileSync(join(MONSTER_DIR, file), "utf8");
      return {
        file: basename(file),
        name: source.match(/^name:\s*([^\n#]+)/m)?.[1]?.trim() ?? file,
        system: {
          power: Number(scalar(source, "power")),
          creatureType: scalar(source, "creatureType"),
          slots: Number(scalar(source, "slots")),
          reactions: 1,
          woundSlots: [],
          xRest: [],
          expertises: [],
          conditions: {}
        }
      };
    });
}

const view = (system) => monsterViewData(system, {
  expertiseKeys: ALL_EXPERTISES,
  conditionKeys: CROWS.conditions,
  localize: (key) => key
});

describe("monster sheet view model", () => {
  test("every shipped creature renders exactly its real backpack-slot count", () => {
    const monsters = shippedMonsters();
    assert.equal(monsters.length, 11, "guard: the real shipped corpus was loaded");

    for (const monster of monsters) {
      const data = view(monster.system);
      assert.equal(data.slotCells.length, monster.system.slots, monster.name);
      assert.equal(data.hasSlots, monster.system.slots > 0, monster.name);
    }

    assert.equal(monsters.find((m) => m.name === "Horse (Pet)")?.system.slots, 10);
    assert.equal(monsters.find((m) => m.name === "Ring Collector")?.system.slots, 0);
  });

  test("the six PT2 conditions render in contract order", () => {
    const data = view({ conditions: { prone: true, weakened: true } });
    assert.deepEqual(data.conditions.map((condition) => condition.key), CROWS.conditions);
    assert.deepEqual(data.conditions.filter((condition) => condition.active).map((condition) => condition.key), ["prone", "weakened"]);
  });

  test("expertise choices use the 30-key config catalogue and preserve array-shaped uses", () => {
    const data = view({ expertises: [{ key: "historicalLore", value: 1, max: 2 }] });
    assert.equal(data.expertises[0].choices.length, 30);
    assert.equal(data.expertises[0].choices.filter((choice) => choice.selected)[0].key, "historicalLore");
    assert.equal(data.expertises[0].value, 1);
    assert.equal(data.expertises[0].max, 2);
  });

  test("X/Rest reports remaining and overuse without clamping stored use", () => {
    const data = view({ xRest: [
      { name: "Roar", max: 2, used: 1 },
      { name: "Vanish", max: 1, used: 3 }
    ] });
    assert.deepEqual(data.xRestFeatures.map(({ remaining, overused }) => ({ remaining, overused })), [
      { remaining: 1, overused: 0 },
      { remaining: 0, overused: 2 }
    ]);
  });
});

describe("monster sheet mutations", () => {
  test("wound toggles preserve orphaned wound indices", () => {
    assert.deepEqual(toggleMonsterWound(new Set([1, 8]), 2, 4), [1, 2, 8]);
    assert.deepEqual(toggleMonsterWound(new Set([1, 8]), 1, 4), [8]);
    assert.deepEqual(toggleMonsterWound(new Set([1, 8]), 8, 4), [1, 8], "out-of-capacity cells cannot be toggled from the grid");
  });

  test("X/Rest controls spend or refund exactly one use", () => {
    const start = [{ name: "Vanish", max: 2, used: 1 }];
    assert.equal(adjustXRestUse(start, 0, 1)[0].used, 2);
    assert.equal(adjustXRestUse(start, 0, -1)[0].used, 0);
    assert.equal(adjustXRestUse([{ name: "Vanish", max: 2, used: 4 }], 0, -1)[0].used, 3,
      "refunding invalid legacy data does not silently normalize several uses");
    assert.equal(start[0].used, 1, "the source array is not mutated");
  });
});
