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

  test("the card FACE carries only the sections the design handoff specifies", () => {
    // The card is a designed artifact. Starting gold and Animal were added to
    // it once and removed again — extra sections change its composition, and
    // that is the designer's call, not the implementer's.
    const src = readFileSync(join(TEMPLATES, "background.hbs"), "utf8");
    const face = src.slice(src.indexOf("<article"), src.indexOf("</article>"));
    const sections = [...face.matchAll(/bg-notelabel">\{\{localize "([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sections, [
      "CROWS.Background.Expertises",
      "CROWS.Background.Equipment",
      "CROWS.Background.StartingTrait"
    ]);
  });

  test("nothing the schema holds becomes unreachable", () => {
    // The handoff's own rule: whatever is not on the card face lives in the
    // All fields disclosure. Removing a section must not delete access to it.
    const src = readFileSync(join(TEMPLATES, "background.hbs"), "utf8");
    const all = src.slice(src.indexOf('<details class="bg-all">'));
    for (const field of ["startingGold", "bonusGold", "pets",
                         "characteristicOptionsAt2", "startingTrait", "description"]) {
      assert.ok(all.includes(field), `${field} is reachable nowhere`);
    }
  });

  test("no All-fields control writes to an ArrayField it cannot represent", () => {
    // A text input bound to system.pets submits a string and corrupts the array.
    const src = readFileSync(join(TEMPLATES, "background.hbs"), "utf8");
    assert.ok(!/<input[^>]*name="system\.pets"/.test(src),
      "pets is an ArrayField — a text input cannot write it");
  });
});
