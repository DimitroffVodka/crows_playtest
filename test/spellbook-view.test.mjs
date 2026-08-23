import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  migrateSpellbookSystem,
  targetNeedsReview
} from "../module/helpers/spellcasting.mjs";

const SPELLBOOK_DIR = new URL("../src/packs/crows-spellbooks/", import.meta.url).pathname;
const TEMPLATE = new URL("../templates/item/spellbook.hbs", import.meta.url);

function yamlScalar(source, key, indent = 2) {
  const match = source.match(new RegExp(`^${" ".repeat(indent)}${key}:\\s*([^\\n#]+)`, "m"));
  const raw = match?.[1]?.trim() ?? "";
  if (raw.startsWith('"') && raw.endsWith('"')) return JSON.parse(raw);
  return raw;
}

function shippedSpellbooks() {
  return readdirSync(SPELLBOOK_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => {
      const source = readFileSync(join(SPELLBOOK_DIR, file), "utf8");
      const name = yamlScalar(source, "name", 0);
      const system = {
        castType: yamlScalar(source, "castType"),
        target: yamlScalar(source, "target"),
        duration: yamlScalar(source, "duration")
      };
      migrateSpellbookSystem(system);
      return { file, name, system };
    });
}

describe("spellbook sheet PT2 fields", () => {
  test("all 25 shipped PT1 spellbooks migrate to fields the template renders", () => {
    const spellbooks = shippedSpellbooks();
    assert.equal(spellbooks.length, 25, "guard: the real shipped corpus was loaded");

    for (const spellbook of spellbooks) {
      assert.ok(["action", "maneuver", "reaction", "outOfCombat"].includes(spellbook.system.castingTime), spellbook.name);
      assert.equal(typeof spellbook.system.target, "object", spellbook.name);
      assert.ok(spellbook.system.target.text.length > 0, spellbook.name);
      assert.ok(["instant", "dt", "ud"].includes(spellbook.system.duration.kind), spellbook.name);
      assert.equal(spellbook.system.castType, undefined, spellbook.name);
    }
  });

  test("the five known ambiguous target lines stay visible and reviewable", () => {
    const flagged = shippedSpellbooks()
      .filter(({ name, system }) => targetNeedsReview(system, { name }))
      .map(({ name }) => name)
      .sort();
    assert.deepEqual(flagged, ["Cacophony", "Create Water", "Deadspeech", "Minor Phantasm", "Summon Object"]);
  });

  test("the sheet no longer reads or writes the deleted scalar fields", () => {
    const template = readFileSync(TEMPLATE, "utf8");
    assert.doesNotMatch(template, /system\.castType/);
    assert.doesNotMatch(template, /name="system\.target"/);
    assert.doesNotMatch(template, /name="system\.duration"/);
    assert.match(template, /system\.castingTime/);
    assert.match(template, /system\.durationLabel/);
    assert.match(template, /system\.target\.text/);
  });
});
