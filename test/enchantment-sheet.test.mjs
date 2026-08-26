import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

const TEMPLATE_PATH = "templates/item/enchantment.hbs";
const SHEET_PATH = "module/sheets/item-sheet.mjs";
const ENTRY_POINT = "module/crows.mjs";
const ENCHANTMENTS = "src/packs/crows-enchantments";
const REQUIRED_FIELDS = ["key", "kind", "price", "uses", "applies", "materials", "goal"];

const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
const sheetSource = fs.readFileSync(SHEET_PATH, "utf8");
const entrySource = fs.readFileSync(ENTRY_POINT, "utf8");

function docs() {
  return fs.readdirSync(ENCHANTMENTS)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => ({ file, doc: yaml.load(fs.readFileSync(path.join(ENCHANTMENTS, file), "utf8")) }));
}

function withoutComments(source) {
  return source.replace(/\{\{!--[\s\S]*?--\}\}/g, "");
}

describe("enchantment catalogue sheet", () => {
  test("the registered Item type resolves through the shared sheet", () => {
    const manifest = JSON.parse(fs.readFileSync("system.json", "utf8"));
    assert.ok(manifest.documentTypes.Item.enchantment,
      "system.json must declare the enchantment Item type");
    assert.match(entrySource,
      /CONFIG\.Item\.dataModels\.enchantment\s*=\s*EnchantmentData/,
      "the enchantment data model must be registered at init");
    assert.match(sheetSource,
      /parts\.body = \{ template: `systems\/crows\/templates\/item\/\$\{this\.document\.type\}\.hbs` \}/,
      "the shared Item sheet must resolve the document type to its template");
    assert.ok(fs.existsSync(TEMPLATE_PATH), "the resolved template must exist");
  });

  test("renders every current EnchantmentData field and enriched description", () => {
    for (const field of REQUIRED_FIELDS) {
      assert.match(template, new RegExp(`system\\.${field}\\b`),
        `enchantment.hbs must render system.${field}`);
    }
    assert.match(template, /\{\{\{\s*description\s*\}\}\}/,
      "the card must render the enriched description context as HTML");
    assert.match(sheetSource, /this\.document\.type === "enchantment"/,
      "the Item sheet must prepare enchantment-specific context");
    assert.match(sheetSource,
      /ctx\.description = await foundry\.applications\.ux\.TextEditor\.implementation\.enrichHTML/,
      "the catalogue description must be enriched at the sheet boundary");
    assert.match(sheetSource, /sys\.description/,
      "enrichment must read the EnchantmentData description field");
  });

  test("prints materials verbatim and offers no editing controls", () => {
    assert.match(template, /\{\{system\.materials\}\}/,
      "materials must be displayed as the stored string");
    const source = withoutComments(template);
    for (const control of ["<input", "<textarea", "<select", 'name="', "data-edit"]) {
      assert.doesNotMatch(source, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        `enchantment.hbs must not carry ${control}`);
    }
    assert.doesNotMatch(source, /<form\b/i, "enchantment.hbs should not be a form");
  });

  test("uses the shared card surface for armor and weapon catalogue entries", () => {
    const entries = docs();
    const armor = entries.find(({ doc }) => doc.name === "Silent");
    const weapon = entries.find(({ doc }) => doc.name === "Frosty");
    assert.equal(armor?.doc.system.kind, "armor", "Silent should be an armor sample");
    assert.equal(weapon?.doc.system.kind, "weapon", "Frosty should be a weapon sample");
    assert.match(template, /class="crows-item card-face enchantment"/);
    assert.match(template, /system\.kind/);
    assert.match(template, /system\.applies/);
  });

  test("keeps armor and weapon Dancing as distinct catalogue entries", () => {
    const dancing = docs().filter(({ doc }) => doc.name === "Dancing");
    assert.equal(dancing.length, 2);
    assert.deepEqual(dancing.map(({ doc }) => doc.system.kind).sort(), ["armor", "weapon"]);
    assert.deepEqual(dancing.map(({ doc }) => doc.system.key).sort(),
      ["armor-dancing", "weapon-dancing"]);
    assert.notEqual(dancing[0].doc._id, dancing[1].doc._id);
    assert.notEqual(dancing[0].doc.system.description, dancing[1].doc.system.description);
  });
});
