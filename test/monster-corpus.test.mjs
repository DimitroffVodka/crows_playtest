import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "js-yaml";

import { ALL_EXPERTISES, CROWS } from "../module/config.mjs";

const MONSTER_DIR = new URL("../src/packs/crows-monsters/", import.meta.url).pathname;
const SLOTLESS_ANIMALS = new Set([
  "Chicken", "Crow", "Hawk", "Rat", "Snake, Venomous", "Spider"
]);

const PRESERVED_IDS = new Map([
  ["Bear", "crowsmon0bear001"],
  ["Cat", "crowsmon0cat0001"],
  ["Dog", "crowsmon0dog0001"],
  ["Goat", "crowsmon0goat001"],
  ["Horse, Riding", "crowsmon0horse01"],
  ["Rat", "crowsmonster0rat"],
  ["Wolf", "crowsmonsterwolf"],
  ["Blood Creature A", "crowsmonbloodaa1"],
  ["Blood Creature B", "crowsmonbloodbb1"],
  ["Blood Creature C", "crowsmonbloodcc1"],
  ["Ring Collector (Namlin)", "crowsmonringcol1"]
]);

function corpus() {
  return readdirSync(MONSTER_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const document = YAML.load(readFileSync(join(MONSTER_DIR, file), "utf8"));
      return { file, document, system: document.system ?? {} };
    });
}

test("the pinned PT2 bestiary corpus is complete and loadable", () => {
  const monsters = corpus();
  assert.equal(monsters.length, 71, "guard: all Animals, Humans, and Monsters stat blocks are present");

  const ids = monsters.map(({ document }) => document._id);
  assert.equal(new Set(ids).size, monsters.length, "every document has a unique _id");

  for (const { file, document: actor, system } of monsters) {
    assert.match(actor._id, /^[A-Za-z0-9]{16}$/, `${file}: _id is 16 characters`);
    assert.equal(actor._key, `!actors!${actor._id}`, `${file}: _key is present and points at _id`);
    assert.equal(actor.type, "monster", `${file}: Foundry document type`);
    assert.equal(Object.hasOwn(system, "type"), false, `${file}: creatureType is not confused with Foundry type`);
    assert.ok(CROWS.creatureTypes.includes(system.creatureType), `${file}: creatureType is in the schema catalogue`);

    for (const expertise of system.expertises ?? []) {
      assert.ok(ALL_EXPERTISES.includes(expertise.key), `${file}: expertise key ${expertise.key}`);
      assert.equal(expertise.value, expertise.max, `${file}: expertise value starts full`);
      assert.ok(Number.isInteger(expertise.value) && expertise.value >= 1, `${file}: expertise uses are positive`);
    }

    assert.ok(Number.isInteger(system.slots) && system.slots >= 0, `${file}: slots is a count`);
    assert.ok(Array.isArray(system.xRest), `${file}: xRest is an array`);
    for (const feature of system.xRest) {
      assert.ok(feature.name, `${file}: X/Rest feature has a name`);
      assert.ok(Number.isInteger(feature.max) && feature.max > 0, `${file}: X/Rest max`);
      assert.equal(feature.used, 0, `${file}: X/Rest starts unused`);
    }

    if (["human", "animal"].includes(system.creatureType)) {
      assert.ok(system.slots > 0 || SLOTLESS_ANIMALS.has(actor.name),
        `${file}: human/animal slots must be printed-positive or a canonical slotless animal`);
    }
  }

  const zeroSlotAnimals = new Set(monsters
    .filter(({ document: actor, system }) => system.creatureType === "animal" && system.slots === 0)
    .map(({ document: actor }) => actor.name));
  assert.deepEqual(zeroSlotAnimals, SLOTLESS_ANIMALS,
    "the six animals whose pinned stat blocks print Slots: 0 remain explicit exceptions");

  for (const [name, id] of PRESERVED_IDS) {
    assert.equal(monsters.find(({ document: actor }) => actor.name === name)?.document._id, id,
      `${name}: existing _id was preserved`);
  }

  const ringCollector = monsters.find(({ document: actor }) => actor.name === "Ring Collector (Namlin)");
  assert.deepEqual(ringCollector?.system.xRest, [{ name: "Vanish", max: 1, used: 0 }],
    "Ring Collector Vanish is structured as X/Rest");
  assert.equal(ringCollector?.system.traits.find(({ name }) => name === "Vanish")?.uses, "",
    "Ring Collector Vanish no longer encodes its resource in trait uses");
});
