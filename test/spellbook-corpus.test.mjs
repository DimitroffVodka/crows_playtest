import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import YAML from "js-yaml";

import { migrateSpellbookSystem, targetNeedsReview } from "../module/helpers/spellcasting.mjs";

const SPELLBOOK_DIR = new URL("../src/packs/crows-spellbooks/", import.meta.url).pathname;

const CARD_NAMES = [
  "Animal Form", "Bone Capture", "Cacophony", "Corrupt", "Create Water",
  "Deadspeech", "Fire Hands", "Fire Lance", "Group Healing", "Jaunt", "Light",
  "Minor Blessing", "Minor Curse", "Minor Healing", "Minor Phantasm", "Minor Ward",
  "Monster Sense", "Repair", "Shrink", "Spark", "Stream", "Stubborn Object",
  "Summon Object", "Take Shape", "Teleport Object", "Thunder", "Wound Closure"
];

const REVIEWED_TARGETS = new Set([
  "Cacophony", "Create Water", "Deadspeech", "Minor Blessing", "Minor Phantasm",
  "Summon Object"
]);

const PRESERVED_IDS = new Map([
  ["Animal Form", "crowsspellanfrm1"], ["Bone Capture", "crowsspellbonec1"],
  ["Cacophony", "crowsspellcacph1"], ["Corrupt", "crowsspellcrupt1"],
  ["Create Water", "crowsspellcrwtr1"], ["Deadspeech", "crowsspelldspch1"],
  ["Fire Hands", "crowsspellfirhn1"], ["Fire Lance", "crowsspellfirla1"],
  ["Jaunt", "crowsspell0jaunt"], ["Light", "crowsspell0light"],
  ["Minor Blessing", "crowsspellminbl1"], ["Minor Curse", "crowsspellmincu1"],
  ["Minor Healing", "crowsspellminhl1"], ["Minor Phantasm", "crowsspellminph1"],
  ["Minor Ward", "crowsspellminwd1"], ["Monster Sense", "crowsspellmonst1"],
  ["Repair", "crowsspellrepar1"], ["Shrink", "crowsspellshrnk1"],
  ["Spark", "crowsspellspark1"], ["Stream", "crowsspellstrm01"],
  ["Stubborn Object", "crowsspellstbob1"], ["Summon Object", "crowsspellsumob1"],
  ["Take Shape", "crowsspelltkshp1"], ["Teleport Object", "crowsspelltlobj1"],
  ["Thunder", "crowsspellthndr1"]
]);

function corpus() {
  return readdirSync(SPELLBOOK_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const document = YAML.load(readFileSync(join(SPELLBOOK_DIR, file), "utf8"));
      const system = migrateSpellbookSystem(document.system ?? {});
      return { file, document, system };
    });
}

describe("shipped Playtest 2 spellbook corpus", () => {
  test("contains exactly the card deck and every document is packable", () => {
    const spellbooks = corpus();
    assert.equal(spellbooks.length, 27, "guard: all PT2 spellbook cards are present");

    const names = spellbooks.map(({ document }) => document.name).sort();
    assert.deepEqual(names, [...CARD_NAMES].sort(), "card-derived spell inventory");
    assert.equal(new Set(spellbooks.map(({ document }) => document._id)).size, spellbooks.length,
      "every spellbook has a unique _id");

    for (const { file, document } of spellbooks) {
      assert.match(document._id ?? "", /^[A-Za-z0-9]{16}$/, `${file}: _id is 16 characters`);
      assert.equal(document._key, `!items!${document._id}`, `${file}: _key points at _id`);
      assert.equal(document.type, "spellbook", `${file}: Foundry document type`);
    }

    for (const [name, id] of PRESERVED_IDS) {
      assert.equal(spellbooks.find(({ document }) => document.name === name)?.document._id, id,
        `${name}: existing _id was preserved`);
    }
  });

  test("all target review flags are explicit and no printed summon keyword is invented", () => {
    const flagged = corpus()
      .filter(({ document, system }) => targetNeedsReview(system, { name: document.name }))
      .map(({ document }) => document.name)
      .sort();
    assert.deepEqual(flagged, [...REVIEWED_TARGETS].sort());

    for (const { document, system } of corpus()) {
      assert.equal(system.target.summoned, false,
        `${document.name}: no card target line prints the Summoned keyword`);
    }
  });

  test("card corrections survive transcription", () => {
    const byName = new Map(corpus().map(({ document, system }) => [document.name, system]));
    assert.deepEqual(byName.get("Minor Blessing").range, { kind: "ranged", value: 3 });
    assert.equal(byName.get("Minor Blessing").target.text, "Varies");
    assert.deepEqual(byName.get("Minor Blessing").effectBands, { t1: "0", t2: "1", t3: "2" });

    assert.equal(byName.get("Teleport Object").target.text, "1 Tiny obj.");
    assert.equal(byName.get("Bone Capture").effectBands.t1, "");
    assert.doesNotMatch(byName.get("Deadspeech").description, /compound|dark/i);
    assert.doesNotMatch(byName.get("Shrink").description, /slug tail|speed is reduced/i);

    assert.deepEqual(byName.get("Group Healing").effectBands, {
      t1: "1+M Stamina regained", t2: "2+M Stamina regained", t3: "4+M Stamina regained"
    });
    assert.deepEqual(byName.get("Wound Closure").effectBands, {
      t1: "0 wounds healed", t2: "1 wound healed", t3: "2 wounds healed"
    });
  });
});
