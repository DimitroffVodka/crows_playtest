import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import yaml from "js-yaml";

import { ALL_EXPERTISES } from "../module/config.mjs";

const BACKGROUND_DIR = new URL("../src/packs/crows-backgrounds/", import.meta.url).pathname;
const CHARACTERISTICS = new Set(["agility", "mind", "strength"]);

function shippedBackgrounds() {
  return readdirSync(BACKGROUND_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const source = readFileSync(join(BACKGROUND_DIR, file), "utf8");
      return { file: basename(file), source, document: yaml.load(source) };
    });
}

describe("shipped Playtest 2 background corpus", () => {
  test("loads all 36 documents with stable Foundry identities and PT2 fields", () => {
    const backgrounds = shippedBackgrounds();
    assert.equal(backgrounds.length, 36, "guard: the real shipped corpus was loaded");

    for (const { file, source, document } of backgrounds) {
      assert.ok(document && typeof document === "object", file);
      assert.match(document._id ?? "", /^[A-Za-z0-9]{16}$/, file + ": _id");
      assert.equal(document._key, "!items!" + document._id, file + ": _key");

      const system = document.system ?? {};
      assert.ok(Array.isArray(system.characteristicOptionsAt2), file + ": characteristicOptionsAt2 array");
      assert.ok(system.characteristicOptionsAt2.length > 0, file + ": characteristicOptionsAt2 non-empty");
      assert.ok(
        system.characteristicOptionsAt2.every((key) => CHARACTERISTICS.has(key)),
        file + ": characteristicOptionsAt2 values"
      );
      assert.equal(system.startingGold, "3d6", file + ": universal starting gold");
      assert.doesNotMatch(source, /^  (skills|characteristicBonus):/m, file + ": PT1 field survived");
    }
  });

  test("every expertise grant uses a live config key and an explicit positive use count", () => {
    for (const { file, document } of shippedBackgrounds()) {
      const expertises = document.system?.expertises;
      assert.ok(Array.isArray(expertises), file + ": expertises array");
      for (const expertise of expertises) {
        assert.ok(ALL_EXPERTISES.includes(expertise?.key), file + ": unknown expertise " + expertise?.key);
        assert.equal(Number.isInteger(expertise?.uses), true, file + ": non-integer uses");
        assert.ok(expertise.uses >= 1, file + ": non-positive uses");
      }
    }
  });

  test("characteristic-at-2 distribution matches the source corpus", () => {
    const counts = new Map();
    for (const { file, document } of shippedBackgrounds()) {
      const options = document.system.characteristicOptionsAt2;
      const key = options.join("|");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      assert.ok(options.every((characteristic) => CHARACTERISTICS.has(characteristic)), file);
    }

    assert.deepEqual(Object.fromEntries(counts), {
      mind: 15,
      strength: 9,
      agility: 6,
      "mind|strength": 2,
      "agility|strength": 1,
      "agility|mind": 1,
      "agility|mind|strength": 2
    });
  });
});
