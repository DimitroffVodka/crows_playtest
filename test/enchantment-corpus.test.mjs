import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import {
  enchantmentUsesFor,
  migrateEnchantmentSystem,
  slugifyEnchantment
} from "../module/helpers/migration.mjs";
import { wearsSilentArmor } from "../module/helpers/combat.mjs";

const DIR = "src/packs/crows-enchantments";
const ICON_DIR = "icons/enchantments";
const ARMOR_NAMES = [
  "Banishing", "Climbing", "Dancing", "Deep", "Demon’s Head", "Feather",
  "Flying", "Glow", "Heavy", "Luring", "Passthrough", "Revenge", "Silent",
  "Slick", "Speedy", "Spell-Storing", "Sustaining", "Telepathic Node",
  "Victory", "Waterwalking"
];
const WEAPON_NAMES = [
  "Absorbing", "Dancing", "Defending", "Exploding", "Flaming", "Frosty",
  "Gashing", "Hewing", "Hungry", "Impact", "Infinity", "Lightning",
  "Poisoning", "Raging", "Returning", "Slaying", "Sworn Foe", "Teleporting",
  "Vicious", "Weakening"
];

function docsIn(directory = DIR) {
  return fs.readdirSync(directory).filter(file => file.endsWith(".yaml")).map(file => ({
    file,
    doc: yaml.load(fs.readFileSync(path.join(directory, file), "utf8"))
  }));
}

function sourceBullets(start, end) {
  const lines = fs.readFileSync("docs/source/C-characters-book.md", "utf8").split(/\r?\n/);
  return lines.slice(start - 1, end)
    .filter(line => /^- \*\*/.test(line))
    .map(line => line.match(/^- \*\*(.+?):\*\* (.*)$/))
    .map(([, name, description]) => [name, `<p>${description}</p>`]);
}

describe("enchantment catalogue", () => {
  test("contains 40 packable documents with 20 armor and 20 weapon entries", () => {
    const documents = docsIn();
    assert.equal(documents.length, 40);
    assert.equal(documents.filter(({ doc }) => doc.system.kind === "armor").length, 20);
    assert.equal(documents.filter(({ doc }) => doc.system.kind === "weapon").length, 20);

    const ids = new Set();
    for (const { file, doc } of documents) {
      assert.equal(doc.type, "enchantment", file);
      assert.match(doc._id ?? "", /^[A-Za-z0-9]{16}$/, `${file}: id`);
      assert.equal(doc._key, `!items!${doc._id}`, `${file}: key`);
      assert.equal(ids.has(doc._id), false, `${file}: duplicate id`);
      ids.add(doc._id);
      assert.ok(fs.existsSync(doc.img.replace(/^systems\/crows\//, "")), `${file}: icon`);
      assert.ok(Number.isInteger(doc.system.price) && doc.system.price > 0, `${file}: price`);
      assert.ok(Number.isInteger(doc.system.uses) && doc.system.uses >= 1 && doc.system.uses <= 4,
        `${file}: uses`);
      assert.ok(Number.isInteger(doc.system.goal) && doc.system.goal > 0, `${file}: goal`);
      const expectedKey = doc.name === "Dancing"
        ? `${doc.system.kind}-dancing`
        : slugifyEnchantment(doc.name);
      assert.equal(doc.system.key, expectedKey, `${file}: key`);
      if (doc.system.kind === "armor") {
        assert.ok(["both", "suit", "shield"].includes(doc.system.applies), `${file}: applies`);
      } else {
        assert.equal(doc.system.applies, "", `${file}: weapon applies must be blank`);
      }
    }

    assert.deepEqual(documents.filter(({ doc }) => doc.system.kind === "armor")
      .map(({ doc }) => doc.name).sort(), [...ARMOR_NAMES].sort());
    assert.deepEqual(documents.filter(({ doc }) => doc.system.kind === "weapon")
      .map(({ doc }) => doc.name).sort(), [...WEAPON_NAMES].sort());
  });

  test("descriptions are verbatim against the cited source ranges", () => {
    const expected = [
      ...sourceBullets(1896, 1915),
      ...sourceBullets(2055, 2074)
    ];
    const actual = docsIn().map(({ doc }) => [doc.name, doc.system.description]);
    for (const [name, description] of expected) {
      assert.ok(actual.some(([actualName, actualDescription]) =>
        actualName === name && actualDescription === description), name);
    }
  });

  test("Dancing is two distinct catalogue documents", () => {
    const dancing = docsIn().filter(({ doc }) => doc.name === "Dancing");
    assert.equal(dancing.length, 2);
    assert.deepEqual(dancing.map(({ doc }) => doc.system.kind).sort(), ["armor", "weapon"]);
    assert.deepEqual(dancing.map(({ doc }) => doc.system.key).sort(), ["armor-dancing", "weapon-dancing"]);
    assert.notEqual(dancing[0].doc.system.description, dancing[1].doc.system.description);
    assert.notEqual(dancing[0].doc._id, dancing[1].doc._id);
  });

  test("every shipped enchantment key resolves, including the two loot cards", () => {
    const keys = new Set(docsIn().map(({ doc }) => doc.system.key));
    const itemDirs = ["src/packs/crows-weapons", "src/packs/crows-armor", "src/packs/crows-loot"];
    const attached = itemDirs.flatMap(directory => docsIn(directory).map(({ doc }) => doc.system));
    for (const system of attached) {
      const migrated = migrateEnchantmentSystem(system);
      for (const key of migrated.enchantments ?? []) assert.ok(keys.has(key), key);
    }

    const loot = docsIn("src/packs/crows-loot");
    assert.deepEqual(loot.find(({ doc }) => doc.name === "Exploding Greatsword").doc.system.enchantments,
      ["exploding"]);
    assert.deepEqual(loot.find(({ doc }) => doc.name === "Vicious Steel Flail").doc.system.enchantments,
      ["vicious"]);
  });
});

describe("enchantment shape migration", () => {
  test("slugifies the legacy string and is idempotent", () => {
    assert.equal(slugifyEnchantment(" Demon’s Head "), "demons-head");
    const first = migrateEnchantmentSystem({ enchantment: "Demon’s Head" });
    assert.deepEqual(first, { enchantments: ["demons-head"] });
    const second = migrateEnchantmentSystem(first);
    assert.deepEqual(second, first);
    assert.equal(second.enchantments.length, 1);
    assert.deepEqual(migrateEnchantmentSystem({ enchantment: "Dancing" }, { kind: "armor" }),
      { enchantments: ["armor-dancing"] });
    assert.deepEqual(migrateEnchantmentSystem({ enchantment: "Dancing" }, { kind: "weapon" }),
      { enchantments: ["weapon-dancing"] });
  });

  test("new arrays win over a stale singular field", () => {
    const clean = { enchantments: ["exploding"] };
    assert.equal(migrateEnchantmentSystem(clean), clean);
    assert.deepEqual(migrateEnchantmentSystem({
      enchantment: "Vicious", enchantments: ["exploding"]
    }), { enchantments: ["exploding"] });
    assert.deepEqual(migrateEnchantmentSystem({ enchantment: "" }), { enchantments: [] });
  });

  test("the derived budget sums known keys and ignores unknown ones", () => {
    assert.equal(enchantmentUsesFor(["silent", "victory", "future-custom"]), 4);
  });
});

describe("Silent armor identity check", () => {
  test("fires only for worn armor carrying the silent key", () => {
    assert.equal(wearsSilentArmor({ items: [
      { type: "armor", name: "Night Mail", system: { worn: true, enchantments: ["silent"] } }
    ] }), true);
    assert.equal(wearsSilentArmor({ items: [
      { type: "armor", name: "Silent Mail", system: { worn: true, enchantments: [] } }
    ] }), false);
    assert.equal(wearsSilentArmor({ items: [
      { type: "armor", name: "Night Mail", system: { worn: false, enchantments: ["silent"] } }
    ] }), false);
    assert.equal(wearsSilentArmor({ items: [
      { type: "weapon", system: { worn: true, enchantments: ["silent"] } }
    ] }), false);
  });
});

assert.equal(fs.readdirSync(ICON_DIR).filter(file => file.endsWith(".svg")).length, 40);
