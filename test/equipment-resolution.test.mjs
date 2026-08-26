import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

import { parseEquipmentEntry, embeddedItemName, backgroundSummary } from "../module/helpers/creation.mjs";
import { petActorNameFor, BACKGROUND_PET_ACTORS } from "../module/helpers/character-creator.mjs";

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

import { liftGrantsOutOfEquipment } from "../module/helpers/migration.mjs";

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

describe("embedded item naming", () => {
  // Regression: a live run produced "Lore Book (Historical Lore) (Historical
  // Lore)". The full string had already matched a shipped item, so the
  // qualifier was part of the name and appending it doubled the suffix. The
  // resolution tests could not catch it — they check whether a name RESOLVES,
  // and this is the item-CONSTRUCTION path.
  test("a qualifier is NOT appended when the full string already matched", () => {
    const p = parseEquipmentEntry("lore book (historical lore)");
    assert.equal(embeddedItemName("Lore Book (Historical Lore)", p, true),
      "Lore Book (Historical Lore)");
  });

  test("a qualifier IS appended when only the stripped name matched", () => {
    const p = parseEquipmentEntry("musical instrument (lute)");
    assert.equal(embeddedItemName("Musical Instrument", p, false),
      "Musical Instrument (Lute)");
  });

  test("no qualifier leaves the name alone either way", () => {
    const p = parseEquipmentEntry("torch");
    assert.equal(embeddedItemName("Torch", p, false), "Torch");
    assert.equal(embeddedItemName("Torch", p, true), "Torch");
  });

  test("a quantity is not a qualifier and never reaches the name", () => {
    const p = parseEquipmentEntry("animal feed (6)");
    assert.equal(embeddedItemName("Animal Feed", p, false), "Animal Feed");
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

describe("background pets map to real stat blocks", () => {
  test("every pet string a background grants resolves to a shipped Actor", () => {
    const monsters = readdirSync("src/packs/crows-monsters")
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => yaml.load(readFileSync(join("src/packs/crows-monsters", f), "utf8")));
    const statBlocks = new Set(monsters.map((m) => m.name));

    // Pets are their own schema field. They used to be equipment strings ending
    // in "(pet)", recoverable only by a regex — the same shape of defect that
    // silently dropped the Noble's bonus gold.
    const granted = [];
    for (const bg of loadAll(BACKGROUNDS)) {
      for (const name of bg.system?.pets ?? []) {
        granted.push({ background: bg.name, raw: name, name });
      }
      // Nothing may still be hiding in equipment.
      for (const raw of bg.system?.equipment ?? []) {
        assert.ok(!/\(\s*pet\s*\)$/i.test(raw),
          `${bg.name}: "${raw}" is a pet living in the equipment array`);
      }
    }

    assert.equal(granted.length, 4, "four backgrounds start play owning an animal");

    const unmapped = [];
    for (const g of granted) {
      const statBlock = petActorNameFor(g.name);
      if (!statBlock) { unmapped.push(`${g.background}: no mapping for "${g.name}"`); continue; }
      if (!statBlocks.has(statBlock)) unmapped.push(`${g.background}: "${statBlock}" not in crows-monsters`);
    }
    assert.deepEqual(unmapped, [], "every granted pet must resolve to a real stat block");
  });

  test("the mapping bridges word order that normalization cannot", () => {
    // "riding horse" vs "Horse, Riding" — same words, different order. This is
    // why the map exists rather than a normalized lookup.
    assert.equal(petActorNameFor("riding horse"), "Horse, Riding");
    assert.equal(petActorNameFor("goat"), "Goat");
    assert.equal(petActorNameFor("dog"), "Dog");
  });

  test("an unmapped animal returns null rather than guessing", () => {
    assert.equal(petActorNameFor("wolf"), null);
    assert.equal(petActorNameFor(""), null);
    assert.equal(petActorNameFor(undefined), null);
  });

  test("every mapped stat block is one a crow can actually use as a pet", () => {
    const monsters = readdirSync("src/packs/crows-monsters")
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => yaml.load(readFileSync(join("src/packs/crows-monsters", f), "utf8")));
    for (const statBlock of Object.values(BACKGROUND_PET_ACTORS)) {
      const doc = monsters.find((m) => m.name === statBlock);
      assert.ok(doc, `${statBlock} missing`);
      assert.equal(doc.system.creatureType, "animal", `${statBlock} must be an animal`);
      // A 0-slot animal cannot carry pet inventory or take wounds in slots.
      // Six shipped animals legitimately print 0; none of them are startable pets.
      assert.ok(doc.system.slots > 0, `${statBlock} has no slots — unusable as a granted pet`);
    }
  });
});

describe("the real shipped corpus resolves", () => {
  test("every background equipment string resolves, or is a pet or gold", () => {
    const names = shippedItemNames();
    const backgrounds = loadAll(BACKGROUNDS);
    assert.equal(backgrounds.length, 36, "guard: the real background corpus was loaded");

    const unresolved = [];
    let strings = 0, pets = 0, goldGrants = 0;

    for (const bg of backgrounds) {
      pets += (bg.system?.pets ?? []).length;
      if (bg.system?.bonusGold) goldGrants++;
      for (const raw of bg.system?.equipment ?? []) {
        strings++;
        const p = parseEquipmentEntry(raw);
        // equipment is ITEMS ONLY now — a gold or pet entry here is the bug.
        assert.notEqual(p.kind, "gold", `${bg.name}: gold in the equipment array — "${raw}"`);
        assert.notEqual(p.kind, "pet", `${bg.name}: a pet in the equipment array — "${raw}"`);
        // The full string is tried BEFORE the qualifier is stripped, because
        // "lore book (historical lore)" IS the card's name.
        const hit = names.has(key(p.raw))
                 || names.has(key(p.name))
                 || names.has(key(ALIASES.get(key(p.name)) ?? ""));
        if (!hit) unresolved.push(`${bg.name}: ${raw}`);
      }
    }

    assert.equal(strings, 160, "guard: the real equipment corpus was loaded");
    assert.equal(goldGrants, 2, "Merchant and Noble each grant bonus coins");
    assert.equal(pets, 4, "four backgrounds start with a live animal");
    assert.deepEqual(unresolved, [], "every equipment string must resolve to a shipped card");
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

/* -------------------------------------------------------------------------- */

/**
 * Coins and animals moved OUT of the equipment array into their own fields.
 *
 * The lift still runs on load, so a world built before the fields existed keeps
 * working. These pin the two ways that goes wrong: losing a grant, and applying
 * it twice.
 */
describe("lifting grants out of a legacy equipment array", () => {
  test("gold and pets are promoted, and the items are left alone", () => {
    const out = liftGrantsOutOfEquipment({
      equipment: ["lantern", "50 gold coins", "riding horse (pet)", "oil flask"]
    });
    assert.deepEqual(out.equipment, ["lantern", "oil flask"]);
    assert.equal(out.bonusGold, 50);
    assert.deepEqual(out.pets, ["riding horse"]);
  });

  test("'50 extra gold coins' counts too — Merchant's wording differs from Noble's", () => {
    assert.equal(liftGrantsOutOfEquipment({ equipment: ["50 extra gold coins"] }).bonusGold, 50);
  });

  test("an explicit field is never overwritten or added to", () => {
    // The lift can run more than once on the same source. If it added rather
    // than deferred, a Noble would gain 50 gc on every load.
    const out = liftGrantsOutOfEquipment({
      equipment: ["50 gold coins", "goat (pet)"],
      bonusGold: 50,
      pets: ["goat"]
    });
    assert.equal(out.bonusGold, 50, "must not become 100");
    assert.deepEqual(out.pets, ["goat"], "must not become two goats");
  });

  test("already-clean content is returned untouched", () => {
    const src = { equipment: ["lantern"], bonusGold: 0, pets: [] };
    assert.equal(liftGrantsOutOfEquipment(src), src, "same object — no needless churn");
  });

  test("survives junk rather than throwing", () => {
    assert.deepEqual(liftGrantsOutOfEquipment({}), {});
    assert.deepEqual(liftGrantsOutOfEquipment({ equipment: null }).equipment, null);
  });

  test("the shipped corpus needs no lifting — it already declares the fields", () => {
    for (const bg of loadAll(BACKGROUNDS)) {
      const lifted = liftGrantsOutOfEquipment(bg.system);
      assert.equal(lifted, bg.system, `${bg.name} still has a grant hiding in equipment`);
    }
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The Bio tab's provenance panel.
 *
 * Everything it shows also lives elsewhere on the sheet, mixed in with what the
 * character earned since. This is the only place that says which of it came
 * from the background — so the shaping is pinned rather than eyeballed.
 */
describe("backgroundSummary", () => {
  const t = (k) => k.split(".").pop();

  test("shapes the whole shipped corpus without throwing, and totals the uses", () => {
    for (const bg of loadAll(BACKGROUNDS)) {
      const s = backgroundSummary(bg.system, t);
      assert.ok(s, `${bg.name} produced no summary`);
      assert.equal(s.totalUses, (bg.system.expertises ?? []).reduce((n, e) => n + (e.uses ?? 1), 0),
        `${bg.name} total uses`);
      assert.ok(s.stamina >= 1, `${bg.name} stamina`);
      assert.equal(s.characteristic.keys.length, (bg.system.characteristicOptionsAt2 ?? []).length);
    }
  });

  test("distinguishes a fixed characteristic from a choice from any", () => {
    assert.equal(backgroundSummary({ characteristicOptionsAt2: ["mind"] }, t).characteristic.isChoice, false);
    const two = backgroundSummary({ characteristicOptionsAt2: ["mind", "strength"] }, t).characteristic;
    assert.equal(two.isChoice, true);
    assert.equal(two.isAny, false);
    assert.equal(two.labelText, "mind, strength");
    const any = backgroundSummary({ characteristicOptionsAt2: ["agility", "mind", "strength"] }, t).characteristic;
    assert.equal(any.isAny, true);
  });

  test("flags a multi-use grant so the template needs no comparison helper", () => {
    const s = backgroundSummary({ expertises: [{ key: "stealth", uses: 1 }, { key: "bow", uses: 2 }] }, t);
    assert.deepEqual(s.expertises.map((e) => [e.key, e.many]), [["bow", true], ["stealth", false]]);
    assert.equal(s.totalUses, 3);
  });

  test("surfaces the promoted fields — this is what they were promoted FOR", () => {
    const noble = loadAll(BACKGROUNDS).find((b) => b.name === "Noble");
    const s = backgroundSummary(noble.system, t);
    assert.equal(s.bonusGold, 50, "the Noble's 50 gc must be visible to the player");
    assert.deepEqual(s.pets, ["Riding Horse"]);
    assert.ok(!s.equipment.some((e) => /gold coins|\(pet\)/i.test(e)),
      "equipment must no longer carry them");
  });

  test("returns null for nothing rather than a hollow panel", () => {
    assert.equal(backgroundSummary(null), null);
    assert.equal(backgroundSummary(undefined), null);
  });

  test("survives a background with no grants at all", () => {
    const s = backgroundSummary({}, t);
    assert.deepEqual([s.expertises, s.equipment, s.pets, s.spellbooks], [[], [], [], []]);
    assert.equal(s.totalUses, 0);
    assert.equal(s.startingGold, "3d6");
  });
});
