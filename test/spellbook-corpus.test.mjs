import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import YAML from "js-yaml";

import { migrateSpellbookSystem, targetNeedsReview, summonBehaviour } from "../module/helpers/spellcasting.mjs";

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

describe("summonBehaviour is inert against PT2 content — deliberately", () => {
  /**
   * READ THIS BEFORE "FIXING" summonBehaviour.
   *
   * It matches 0 of 27 shipped spellbooks, which reads like a broken detector
   * and invites loosening the parser until something matches. Do not.
   *
   * Two separate facts produce the zero, and only the first is a defect:
   *
   * 1. `summons` is false for Summon Object, which demonstrably summons one.
   *    Its card prints target `Self`, and `Summoned` — a keyword the rules
   *    DEFINE at R:1215 — appears in ZERO target lines across all five card
   *    decks. That is MCDM disagreeing with itself, and it is an MCDM question,
   *    not licence to edit the content or infer a summon from description prose.
   *
   * 2. `actsAsPet` is unreachable, and that is CORRECT. It requires
   *    `kind === "creature"`, and PT2 ships no creature-summoning spell — the
   *    only spell that summons anything summons an OBJECT. R:1255 anticipates
   *    summoned creatures ("they function like pets in combat except that you
   *    don't need to make a test"), which is what `requiresCommandTest: false`
   *    already encodes. The machinery is correct and dormant.
   *
   * Loosening the parser would hand pet mechanics to a summoned object, which
   * `petCombatProfile` guards against precisely because it must not happen.
   *
   * This test will fail the day MCDM ships a creature summon. That is the point.
   */
  test("no shipped spellbook acts as a pet, and none is detected as a summon", () => {
    const spellbooks = corpus();
    assert.equal(spellbooks.length, 27, "guard: the real shipped corpus was loaded");

    const actsAsPet = spellbooks.filter(({ system }) => summonBehaviour(system).actsAsPet)
      .map(({ document }) => document.name);
    assert.deepEqual(actsAsPet, [],
      "PT2 ships no creature-summoning spell; a hit here means the parser was loosened");

    const summons = spellbooks.filter(({ system }) => summonBehaviour(system).summons)
      .map(({ document }) => document.name);
    assert.deepEqual(summons, [],
      "no card prints `Summoned` in a target line; a hit means content was edited to satisfy the parser");
  });

  test("the rule that summoned creatures skip the command test is still encoded", () => {
    // R:1255. Unreachable today, but it must not silently flip when content arrives.
    for (const { document, system } of corpus()) {
      assert.equal(summonBehaviour(system).requiresCommandTest, false, document.name);
    }
  });
});
