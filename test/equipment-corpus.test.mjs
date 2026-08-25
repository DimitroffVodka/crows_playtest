import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const PACKS = {
  weapons: "src/packs/crows-weapons",
  armor: "src/packs/crows-armor",
  ammunition: "src/packs/crows-ammunition"
};

const WEAPON_QUALITIES = new Set([
  "brutal", "cumbersome", "disengage", "dismember",
  "light", "parry", "pummeling", "reload"
]);

const EXPECTED = {
  weapons: {
    Hammer: { cost: 10, slots: 1, qualities: ["light", "pummeling"] },
    Mace: { cost: 12, slots: 1, qualities: ["pummeling"] },
    Flail: { cost: 15, slots: 2, qualities: ["pummeling"] },
    Maul: { cost: 15, slots: 2, qualities: ["pummeling"] },
    Handaxe: { cost: 10, slots: 1, qualities: ["dismember", "light"] },
    Axe: { cost: 12, slots: 1, qualities: ["dismember"] },
    Halberd: { cost: 15, slots: 2, qualities: ["dismember"] },
    Greataxe: { cost: 15, slots: 2, qualities: ["dismember"] },
    Knife: { cost: 10, slots: 1, qualities: ["disengage", "light", "parry"] },
    Sword: { cost: 12, slots: 1, qualities: ["disengage", "parry"] },
    Glaive: { cost: 15, slots: 2, qualities: ["disengage", "parry"] },
    Greatsword: { cost: 15, slots: 2, qualities: ["disengage", "parry"] },
    Stiletto: { cost: 10, slots: 1, qualities: ["brutal", "light"] },
    Spear: { cost: 12, slots: 1, qualities: ["brutal"] },
    Pike: { cost: 15, slots: 2, qualities: ["brutal"] },
    Warpick: { cost: 15, slots: 2, qualities: ["brutal"] },
    Shortbow: { cost: 10, slots: 1, qualities: ["cumbersome"] },
    Longbow: { cost: 12, slots: 2, qualities: [] },
    Crossbow: { cost: 15, slots: 2, qualities: ["reload"] }
  },
  armor: {
    "Light Armor": { cost: 50, slots: 2 },
    "Medium Armor": { cost: 150, slots: 3 },
    "Heavy Armor": { cost: 400, slots: 4 },
    Shield: { cost: 15, slots: 1 }
  },
  ammunition: {
    "Quiver of 20 Arrows": { cost: 5, slots: 1 },
    "Case of 20 Bolts": { cost: 5, slots: 1 }
  }
};

const loadPack = (directory) => readdirSync(directory)
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => ({
    file,
    doc: yaml.load(readFileSync(join(directory, file), "utf8"))
  }));

const names = (documents) => documents.map(({ doc }) => doc.name).sort();

describe("weapons, armor, and ammunition corpus", () => {
  test("every document is packable and ids are unique", () => {
    const documents = Object.values(PACKS).flatMap(loadPack);
    const seen = new Map();

    for (const { file, doc } of documents) {
      assert.ok(doc._id, `${file}: missing _id`);
      assert.equal(doc._id.length, 16, `${file}: _id must be 16 chars`);
      assert.equal(doc._key, `!items!${doc._id}`, `${file}: _key must match _id`);
      assert.equal(seen.get(doc._id), undefined,
        `${file}: _id collides with ${seen.get(doc._id)}`);
      seen.set(doc._id, file);
    }
  });

  test("the PT2 document counts and names match the book", () => {
    const weapons = loadPack(PACKS.weapons);
    const armor = loadPack(PACKS.armor);
    const ammunition = loadPack(PACKS.ammunition);

    assert.equal(weapons.length, 19, "Weapon Prices has 19 weapons (C:1980–1998)");
    assert.equal(armor.length, 4, "Armor Prices has 4 armor types (C:1814–1817)");
    assert.equal(ammunition.length, 2, "Weapon Prices has 2 ammunition rows (C:1999–2000)");
    assert.deepEqual(names(weapons), Object.keys(EXPECTED.weapons).sort());
    assert.deepEqual(names(armor), Object.keys(EXPECTED.armor).sort());
    assert.deepEqual(names(ammunition), Object.keys(EXPECTED.ammunition).sort());
  });

  test("weapon qualities are canonical and prices/slots match the book", () => {
    for (const { file, doc } of loadPack(PACKS.weapons)) {
      const expected = EXPECTED.weapons[doc.name];
      assert.ok(expected, `${file}: unexpected weapon ${doc.name}`);
      assert.deepEqual([...doc.system.qualities].sort(), [...expected.qualities].sort(),
        `${file}: qualities for ${doc.name}`);
      for (const quality of doc.system.qualities) {
        assert.ok(WEAPON_QUALITIES.has(quality),
          `${file}: non-book weapon quality ${quality}`);
      }
      assert.equal(doc.system.cost, expected.cost, `${file}: price for ${doc.name}`);
      assert.equal(doc.system.slots, expected.slots, `${file}: slots for ${doc.name}`);
    }
  });

  test("armor and ammunition prices/slots match the book", () => {
    for (const kind of ["armor", "ammunition"]) {
      for (const { file, doc } of loadPack(PACKS[kind])) {
        const expected = EXPECTED[kind][doc.name];
        assert.ok(expected, `${file}: unexpected ${kind} ${doc.name}`);
        assert.equal(doc.system.cost, expected.cost, `${file}: price for ${doc.name}`);
        assert.equal(doc.system.slots, expected.slots, `${file}: slots for ${doc.name}`);
      }
    }
  });
});
