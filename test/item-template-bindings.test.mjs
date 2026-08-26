import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Every `name="system.x"` in an item template must name a real schema field.
 *
 * WHY. The background sheet bound a <select> to `system.characteristicBonus`
 * and listed `system.skills` — both PT1 fields deleted in the PT2 migration.
 * The result was a sheet that silently displayed nothing for two of the five
 * things a background grants, and whose editor wrote to a path the DataModel
 * drops on the floor. Nothing failed. No test covered it, and the sheet looked
 * fine because the surrounding fields still worked.
 *
 * A binding to a dead path is always a bug and is always detectable from the
 * source, so it should never again survive to a live sheet.
 */

const TEMPLATES = "templates/item";
const MODELS = "module/data/item";

/** Field names declared by a `defineSchema()` return object. */
function schemaFields(type) {
  const file = join(MODELS, `${type}.mjs`);
  if (!existsSync(file)) return null;
  const src = readFileSync(file, "utf8");
  return new Set([...src.matchAll(/^\s+([a-zA-Z0-9_]+):\s*new fields\./gm)].map((m) => m[1]));
}

const templates = readdirSync(TEMPLATES).filter((f) => f.endsWith(".hbs"));

describe("item template bindings match their data model", () => {
  test("guard: templates and models were both found", () => {
    assert.ok(templates.length >= 8, `only ${templates.length} item templates`);
    assert.ok(schemaFields("background")?.size, "background schema not parsed");
  });

  for (const file of templates) {
    const type = file.replace(/\.hbs$/, "");
    test(`${file} binds only to fields ${type} actually has`, (t) => {
      const fields = schemaFields(type);
      if (!fields) return t.skip(`no data model for ${type}`);
      const src = readFileSync(join(TEMPLATES, file), "utf8");
      const bound = [...new Set(
        [...src.matchAll(/name="system\.([a-zA-Z0-9_]+)/g)].map((m) => m[1])
      )];
      const dead = bound.filter((b) => !fields.has(b));
      assert.deepEqual(dead, [], `${file} writes to path(s) the schema does not define`);
    });
  }

  test("the background sheet no longer references the deleted PT1 fields", () => {
    // Named explicitly because these two are what went wrong, and a generic
    // check cannot say WHICH removal mattered.
    const src = readFileSync(join(TEMPLATES, "background.hbs"), "utf8")
      .replace(/\{\{!--[\s\S]*?--\}\}/g, "");   // drop the comment explaining them
    for (const dead of ["characteristicBonus", "system.skills"]) {
      assert.ok(!src.includes(dead), `background.hbs still references ${dead}`);
    }
  });

  test("the background sheet surfaces every grant the schema can hold", () => {
    const src = readFileSync(join(TEMPLATES, "background.hbs"), "utf8");
    // bonusGold and pets were promoted out of the equipment array precisely so
    // they could be shown; a sheet that omits them wastes that.
    for (const shown of ["bonusGold", "pets", "expertises", "equipment",
                         "spellbooks", "startingTrait", "stamina"]) {
      assert.ok(src.includes(shown), `background.hbs never mentions ${shown}`);
    }
  });
});
