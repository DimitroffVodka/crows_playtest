import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

import { parseEquipmentEntry } from "../module/helpers/creation.mjs";

const BACKGROUNDS = "src/packs/crows-backgrounds";
const ITEM_PACKS = [
  "src/packs/crows-gear",
  "src/packs/crows-weapons",
  "src/packs/crows-armor",
  "src/packs/crows-consumables",
  "src/packs/crows-ammunition"
];

/** Mirrors `comparisonKey` in creation.mjs. Duplicated deliberately: this test
 *  must fail if the production fold changes, not silently follow it. */
const key = (s) => String(s ?? "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

const loadAll = (dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".yaml"))
    .map((f) => yaml.load(readFileSync(join(dir, f), "utf8")));

const shippedItemNames = () => {
  const names = new Set();
  for (const dir of ITEM_PACKS) for (const doc of loadAll(dir)) names.add(key(doc.name));
  return names;
};

// The one alias creation.mjs carries. Restated here so a silent removal fails.
const ALIASES = new Map([["quiverofarrows", "Quiver of 20 Arrows"]]);

describe("equipment entry parsing", () => {
  test("a plain name is an item of quantity 1", () => {
    assert.deepEqual(parseEquipmentEntry("torch"),
      { raw: "torch", kind: "item", name: "torch", quantity: 1, qualifier: "" });
  });

  test("a numeric parenthetical is a quantity", () => {
    const p = parseEquipmentEntry("animal feed (6)");
    assert.equal(p.kind, "item");
    assert.equal(p.name, "animal feed");
    assert.equal(p.quantity, 6);
  });

  test("(pet) is a live Actor request, never an item", () => {
    const p = parseEquipmentEntry("riding horse (pet)");
    assert.equal(p.kind, "pet");
    assert.equal(p.name, "riding horse");
  });

  test("a word parenthetical is a qualifier, not a quantity", () => {
    const p = parseEquipmentEntry("musical instrument (lute)");
    assert.equal(p.kind, "item");
    assert.equal(p.name, "musical instrument");
    assert.equal(p.qualifier, "lute");
    assert.equal(p.quantity, 1);
  });

  test("gold strings are not items", () => {
    for (const raw of ["50 gold coins", "50 extra gold coins"]) {
      const p = parseEquipmentEntry(raw);
      assert.equal(p.kind, "gold", raw);
      assert.equal(p.amount, 50, raw);
      assert.equal(p.name, "", raw);
    }
  });

  test("a leading 'extra' is stripped — the kit already granted one", () => {
    const p = parseEquipmentEntry("extra knife");
    assert.equal(p.name, "knife");
    assert.equal(p.kind, "item");
  });

  test("raw is always preserved for reporting", () => {
    assert.equal(parseEquipmentEntry("  goat (pet)  ").raw, "goat (pet)");
  });
});

describe("normalization bridges the background/card spelling conflicts", () => {
  test("punctuation and spacing are noise", () => {
    assert.equal(key("gluepot"), key("Glue Pot"));
    assert.equal(key("quill and inkpot"), key("Quill & Inkpot"));
    assert.equal(key("quill and ink pot"), key("Quill & Inkpot"));
  });

  test("normalization alone canNOT bridge an embedded count — hence the alias", () => {
    assert.notEqual(key("quiver of arrows"), key("Quiver of 20 Arrows"));
    assert.equal(ALIASES.get(key("quiver of arrows")), "Quiver of 20 Arrows");
  });

  test("the alias target is a real shipped item", () => {
    const names = shippedItemNames();
    for (const target of ALIASES.values()) {
      assert.ok(names.has(key(target)), `alias points at a missing item: ${target}`);
    }
  });
});

describe("the real shipped corpus resolves", () => {
  test("every background equipment string resolves, or is a pet or gold", () => {
    const names = shippedItemNames();
    const backgrounds = loadAll(BACKGROUNDS);
    assert.equal(backgrounds.length, 36, "guard: the real background corpus was loaded");

    const unresolved = [];
    let strings = 0, pets = 0, gold = 0;

    for (const bg of backgrounds) {
      for (const raw of bg.system?.equipment ?? []) {
        strings++;
        const p = parseEquipmentEntry(raw);
        if (p.kind === "gold") { gold++; continue; }
        if (p.kind === "pet") { pets++; continue; }
        const hit = names.has(key(p.raw))
                 || names.has(key(p.name))
                 || names.has(key(ALIASES.get(key(p.name)) ?? ""));
        if (!hit) unresolved.push(`${bg.name}: ${raw}`);
      }
    }

    assert.equal(strings, 166, "guard: the real equipment corpus was loaded");
    assert.equal(gold, 2, "two gold strings");
    assert.equal(pets, 4, "four backgrounds start with a live animal");
    assert.deepEqual(unresolved, [], "every remaining equipment string must resolve");
  });

  test("lore books resolve on the FULL string, before any stripping", () => {
    const names = shippedItemNames();
    // If the parenthetical were stripped first these would fall back to a
    // generic "Lore Book", which is exactly what the four-variant naming exists
    // to prevent.
    for (const raw of ["lore book (historical lore)", "lore book (monster lore)", "lore book (nature lore)"]) {
      assert.ok(names.has(key(raw)), raw);
    }
  });
});
