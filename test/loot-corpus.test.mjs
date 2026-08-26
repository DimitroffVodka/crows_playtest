import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import yaml from "js-yaml";
import { migrateEnchantmentSystem } from "../module/helpers/migration.mjs";

const LOOT_DIR = "src/packs/crows-loot";
const LEGAL_EXPIRY = new Set(["useless", "refuel", "rest", "activate", "dt"]);
const PRESERVED_IDS = new Map([
  ["Blood Concoction", "crowsloot0bldcnc"],
  ["Boom Wand", "crowsloot0boomwd"],
  ["Magic Ring", "crowsloot0magicr"],
  ["Magic Wand", "crowsloot0magicw"],
  ["Minor Telekinesis Ring", "crowsloot0telekn"],
  ["Potion", "crowsloot0potion"]
]);

const PREMADE_WEAPONS = new Map([
  ["Steel Knife", { t2: "3 + A or S", t3: "5 + A or S", enchantments: [], material: true }],
  ["Steel Axe", { t2: "4 + S", t3: "8 + S", enchantments: [], material: true }],
  ["Exploding Greatsword", { t2: "4 + S", t3: "8 + S", enchantments: ["exploding"], material: false }],
  ["Vicious Steel Flail", { t2: "4 + S", t3: "7 + S", enchantments: ["vicious"], material: true }]
]);

function shippedLoot() {
  return readdirSync(LOOT_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => ({
      file,
      document: yaml.load(readFileSync(join(LOOT_DIR, file), "utf8"))
    }));
}

describe("shipped Playtest 2 loot corpus", () => {
  test("contains all 13 dungeon-loot documents with packable identities", () => {
    const loot = shippedLoot();
    assert.equal(loot.length, 13, "guard: all IL loot cards are present");

    const seen = new Map();
    for (const { file, document } of loot) {
      assert.ok(document && typeof document === "object", file);
      assert.match(document._id ?? "", /^[A-Za-z0-9]{16}$/, `${file}: _id is 16 chars`);
      assert.equal(document._key, `!items!${document._id}`, `${file}: _key matches _id`);
      assert.equal(seen.get(document._id), undefined,
        `${file}: _id collides with ${seen.get(document._id)}`);
      seen.set(document._id, file);
    }

    for (const [name, id] of PRESERVED_IDS) {
      assert.equal(loot.find(({ document }) => document.name === name)?.document._id, id,
        `${name}: existing _id was preserved`);
    }
  });

  test("usage-die expiry values stay inside the Foundry enum", () => {
    for (const { file, document } of shippedLoot()) {
      const expiry = document.system?.usageDie?.expiry;
      if (expiry === undefined) continue;
      assert.ok(LEGAL_EXPIRY.has(expiry), `${file}: illegal usageDie.expiry ${expiry}`);
    }
  });

  test("premade weapon cards retain upgraded stats and enchantments", () => {
    const weapons = shippedLoot()
      .map(({ document }) => document)
      .filter((document) => PREMADE_WEAPONS.has(document.name));
    assert.equal(weapons.length, PREMADE_WEAPONS.size, "all four IL weapon cards are represented");

    for (const weapon of weapons) {
      const expected = PREMADE_WEAPONS.get(weapon.name);
      const system = migrateEnchantmentSystem(weapon.system);
      assert.equal(weapon.type, "weapon", `${weapon.name}: loot weapon document type`);
      assert.equal(weapon.system.qualityTier, "standard",
        `${weapon.name}: material upgrades do not use gear qualityTier`);
      assert.deepEqual(weapon.system.damage, { t2: expected.t2, t3: expected.t3 },
        `${weapon.name}: printed upgraded damage`);
      assert.deepEqual(system.enchantments, expected.enchantments,
        `${weapon.name}: printed enchantments`);

      if (expected.material) {
        assert.match(weapon.system.description, /Steel/, `${weapon.name}: Steel is explicit in description`);
      }
      if (expected.enchantments.length) {
        const printed = expected.enchantments[0][0].toUpperCase() + expected.enchantments[0].slice(1);
        assert.match(weapon.system.description, new RegExp(printed),
          `${weapon.name}: enchantment is explicit in description`);
      }
    }
  });
});
