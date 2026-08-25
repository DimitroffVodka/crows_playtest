import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { CROWS } from "../module/config.mjs";
import { CONTAINER_ORDER, WIELD_REFUSALS } from "../module/helpers/slots.mjs";
import { INSTITUTION_KEYS } from "../module/helpers/village.mjs";

/**
 * Every `CROWS.*` key the code asks for must exist in lang/en.json.
 *
 * WHY THIS EXISTS. On 2026-08-25 a commit added nested `CROWS: { Dialog: {...} }`
 * objects to a file whose 500-odd keys are all FLAT dotted strings. Foundry
 * resolves `CROWS.Sheet.Crow.slots` by walking the object first, so the new
 * nested `CROWS` shadowed EVERY flat `CROWS.*` sibling at once. Slot headers,
 * "Empty", "Coin" and "Expertises" all rendered as raw key text on the live
 * sheet. The suite was green throughout — nothing read the lang file.
 *
 * So this file pins three things, in order of what actually broke:
 *   1. the file stays flat,
 *   2. every literal key in the source resolves,
 *   3. every RUNTIME-BUILT key resolves too — those are the ones a grep for a
 *      missing string can never find, because the string does not exist until
 *      the sheet renders.
 */

const LANG_PATH = "lang/en.json";
const RAW = fs.readFileSync(LANG_PATH, "utf8");
const LANG = JSON.parse(RAW);

/* -------------------------------------------------------------------------- */
/*  Scanning the source                                                        */
/* -------------------------------------------------------------------------- */

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|hbs)$/.test(e.name)) out.push(full);
    }
  };
  walk("module");
  walk("templates");
  return out;
}

/**
 * A key reference is a STRING LITERAL that starts with `CROWS.` — never a bare
 * property access, because `CROWS` is also the config object and
 * `CROWS.weaponQualities` is data, not a translation.
 *
 * Backtick literals count only when they interpolate. A plain backtick
 * `CROWS.stackLimits` is how JSDoc in this codebase cites a config field, and
 * six of them would otherwise read as missing translations.
 */
const QUOTED = /(["'])(CROWS\.[^"'\n]*?)\1/g;
const BACKTICK = /`(CROWS\.[^`\n]*?)`/g;

/** `CROWS.Expertise.${key}Hint` → `CROWS.Expertise.*Hint` */
const shapeOf = (pattern) => pattern.replace(/\$\{[^}]*\}/g, "*");

function scan() {
  const literal = new Map();   // exact key           → files
  const dynamic = new Map();   // shape (with `*`)    → files
  const add = (map, k, file) => map.set(k, (map.get(k) ?? new Set()).add(file));

  for (const file of sourceFiles()) {
    // Handlebars comments are prose about keys, not uses of them.
    const src = fs.readFileSync(file, "utf8")
      .replace(/\{\{!--[\s\S]*?--\}\}/g, "")
      .replace(/\{\{![\s\S]*?\}\}/g, "");

    for (const [, , key] of src.matchAll(QUOTED)) {
      if (key.includes("${")) add(dynamic, shapeOf(key), file);
      else add(literal, key, file);
    }
    for (const [, key] of src.matchAll(BACKTICK)) {
      if (key.includes("${")) add(dynamic, shapeOf(key), file);
    }
  }
  return { literal, dynamic };
}

const { literal: LITERAL_REFS, dynamic: DYNAMIC_REFS } = scan();

/**
 * Two literals are handed to `localizedLabel(key, prefix, localize)` as a
 * PREFIX, so they are family roots rather than keys. Listed explicitly: an
 * "is it a prefix of something?" rule would let a typo through whenever the
 * typo happened to be a prefix.
 */
const PREFIX_ARGUMENTS = new Set(["CROWS.Condition", "CROWS.Expertise"]);

/* -------------------------------------------------------------------------- */
/*  The runtime-built key families                                             */
/* -------------------------------------------------------------------------- */

const EXPERTISES = Object.values(CROWS.expertises).flat();
const cross = (groups) =>
  Object.entries(groups).flatMap(([g, vs]) => vs.map(v => `${g}.${v}`));

/**
 * Every interpolated key shape, mapped to the vocabulary it can produce.
 *
 * The vocabularies come from config and the slot model, NOT from en.json —
 * reading the answer out of the file under test would assert nothing. A trait
 * tree added to `CROWS.traitTrees` with no matching label fails here.
 */
const FAMILIES = {
  "CROWS.Characteristic.*": () => Object.keys(CROWS.characteristics),
  "CROWS.Condition.*": () => CROWS.conditions,
  "CROWS.Condition.*Hint": () => CROWS.conditions.map(k => `${k}Hint`),
  "CROWS.Expertise.*": () => [...EXPERTISES, ...CROWS.disciplines],
  "CROWS.Expertise.*Hint": () => EXPERTISES.map(k => `${k}Hint`),
  "CROWS.ExpertiseCategory.*": () => Object.keys(CROWS.expertises),
  "CROWS.ExpertiseCategory.*Hint": () => Object.keys(CROWS.expertises).map(k => `${k}Hint`),
  "CROWS.Tier.*": () => ["1", "2", "3"],
  "CROWS.Sheet.*": () => CONTAINER_ORDER,
  "CROWS.Sheet.Crow.tab.*": () =>
    ["main", "equipment", "inventory", "pets", "advancement", "downtime", "bio"],
  "CROWS.Sheet.Crow.tree.*": () => CROWS.traitTrees,
  "CROWS.Sheet.Crow.value.size.*": () => CROWS.sizes,
  "CROWS.Sheet.Crow.pets.status.*": () =>
    ["invalid", "unowned", "followingYou", "followingOther", "ownedByYou", "ownedByOther"],
  "CROWS.Dialog.Village.institutionType.*": () => INSTITUTION_KEYS,
  // R:392 — why a weapon cannot attack from the slot it is in.
  "CROWS.Sheet.Crow.attackBlocked.*": () => WIELD_REFUSALS,
  // Each group has its own vocabulary — `gear.shield` is not a thing.
  "CROWS.Sheet.Crow.value.*.*": () => cross({
    action: CROWS.castTypes,
    armor: CROWS.armorTypes,
    duration: ["dt", "instant", "ud", "withNote"],
    expiry: CROWS.usageExpiry,
    gear: CROWS.gearSubtypes,
    quality: CROWS.weaponQualities,
    size: CROWS.sizes
  }),
  // Refusal reasons the inventory surfaces. Pinned against the slot model
  // below, so a new refusal cannot ship without a message.
  "CROWS.Dialog.InventoryDrop.*": () => DROP_REASONS
};

/**
 * Every reason string the slot model and the drop handler can produce.
 *
 * Read out of the sources rather than typed here, so adding
 * `return { ok: false, reason: "..." }` to slots.mjs fails this file until it
 * has a message — which is exactly how a player ends up staring at
 * `CROWS.Dialog.InventoryDrop.wrong-span` in a notification.
 */
function reasonsFromSource() {
  const found = new Set();
  for (const file of ["module/helpers/slots.mjs", "module/sheets/crow-sheet.mjs"]) {
    const src = fs.readFileSync(file, "utf8");
    for (const [, r] of src.matchAll(/reason:\s*"([a-z][a-z-]*)"/g)) found.add(r);
    // dropRefusal returns its reason directly.
    for (const [, r] of src.matchAll(/^\s*return "([a-z][a-z-]+)";/gm)) found.add(r);
  }
  return found;
}

/**
 * Reasons that exist only inside planSwap. A failed swap falls through to the
 * packItem reason that caused the refusal in the first place, which is the more
 * accurate message, so these never reach a notification.
 */
const INTERNAL_ONLY = new Set(["no-origin", "same-item"]);

/**
 * Reasons from the retrieval and coin APIs, which are not placement refusals
 * and are not reported through the drop notification — `retrieveFromBackpack`
 * (R:478) and the purse operations return them to their own callers.
 */
const NON_PLACEMENT = new Set([
  "not-in-backpack", "bad-roll", "no-coin", "no-purse", "purse-empty",
  // Wielding tokens (R:392). Their messages live under
  // CROWS.Sheet.Crow.attackBlocked.*, checked as its own family above — they are
  // not placement refusals and must not be looked up under InventoryDrop.
  ...WIELD_REFUSALS
]);

/** Raised by the sheet itself rather than by a placement attempt. */
const SHEET_REASONS = ["choose-slot", "not-owner", "swapped"];

const DROP_REASONS = [
  ...[...reasonsFromSource()].filter(r => !INTERNAL_ONLY.has(r) && !NON_PLACEMENT.has(r)),
  ...SHEET_REASONS
];

/* -------------------------------------------------------------------------- */
/*  Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("lang/en.json shape", () => {
  test("is entirely flat — one nested object shadows every flat sibling under it", () => {
    const nested = Object.entries(LANG).filter(([, v]) => typeof v !== "string");
    assert.deepEqual(nested.map(([k]) => k), [],
      "these values are not strings; Foundry walks objects before dotted keys, so a " +
      "nested CROWS block hides every CROWS.* key in the file");
  });

  test("declares no key twice — JSON.parse keeps the last silently", () => {
    // The file is flat and pretty-printed at one level, so every key is its own line.
    const declared = [...RAW.matchAll(/^\s{2}"([^"]+)":/gm)].map(m => m[1]);
    const seen = new Set();
    const dupes = declared.filter(k => seen.size === seen.add(k).size);
    assert.deepEqual(dupes, []);
    assert.equal(declared.length, Object.keys(LANG).length);
  });

  test("no value is left as its own key — the symptom of a shadowed lookup", () => {
    const echoes = Object.entries(LANG).filter(([k, v]) => k === v);
    assert.deepEqual(echoes.map(([k]) => k), []);
  });
});

describe("every literal CROWS.* key in the source resolves", () => {
  test("no missing keys", () => {
    const missing = [...LITERAL_REFS]
      .filter(([key]) => !(key in LANG) && !PREFIX_ARGUMENTS.has(key))
      .map(([key, files]) => `${key}  (${[...files].join(", ")})`);
    assert.deepEqual(missing, []);
  });

  test("the scan actually found the keys — a broken regex must not pass silently", () => {
    assert.ok(LITERAL_REFS.size > 250, `only ${LITERAL_REFS.size} literal keys scanned`);
    assert.ok(LITERAL_REFS.has("CROWS.Sheet.Crow.slotNumber"));
  });

  test("the two prefix arguments name real families", () => {
    for (const prefix of PREFIX_ARGUMENTS) {
      const children = Object.keys(LANG).filter(k => k.startsWith(`${prefix}.`));
      assert.ok(children.length, `${prefix} has no children in en.json`);
    }
  });
});

describe("every runtime-built CROWS.* key resolves", () => {
  test("each interpolated key shape is classified", () => {
    // An unclassified shape is not a pass — it is a family nobody checked.
    const unknown = [...DYNAMIC_REFS]
      .filter(([shape]) => !(shape in FAMILIES))
      .map(([shape, files]) => `${shape}  (${[...files].join(", ")})`);
    assert.deepEqual(unknown, [],
      "add these to FAMILIES with the vocabulary they interpolate over");
  });

  for (const [shape, values] of Object.entries(FAMILIES)) {
    test(`${shape} — every value has a key`, () => {
      // Values carry their own suffix (`fooHint`, `group.value`), so the shape
      // only supplies the text before the first interpolation.
      const prefix = shape.slice(0, shape.indexOf("*"));
      const missing = values().map(v => `${prefix}${v}`).filter(k => !(k in LANG));
      assert.deepEqual(missing, []);
    });
  }
});

describe("inventory refusal messages", () => {
  test("every refusal the slot model can raise has a message", () => {
    const missing = DROP_REASONS.filter(r => !(`CROWS.Dialog.InventoryDrop.${r}` in LANG));
    assert.deepEqual(missing, []);
  });

  test("the reasons were read from source, not from a stale list here", () => {
    const fromSource = reasonsFromSource();
    for (const expected of ["occupied", "stack-full", "hand-no-stack", "magic-slot-mismatch"]) {
      assert.ok(fromSource.has(expected), `${expected} no longer found by the reason scan`);
    }
  });

  test("every reason in the source is classified as one of the three kinds", () => {
    // The point of the whole block: a new `reason: "..."` lands in no bucket and
    // fails here, forcing the author to say whether a player will ever read it.
    const classified = new Set([...DROP_REASONS, ...INTERNAL_ONLY, ...NON_PLACEMENT]);
    const stray = [...reasonsFromSource()].filter(r => !classified.has(r));
    assert.deepEqual(stray, [],
      "classify each: user-facing (add a CROWS.Dialog.InventoryDrop message), " +
      "INTERNAL_ONLY, or NON_PLACEMENT");
  });

  test("swap-only reasons are deliberately unlocalized, not forgotten", () => {
    // If one of these ever reaches a notification it needs a message; until
    // then, a key for it would be dead weight that reads as coverage.
    for (const r of INTERNAL_ONLY) {
      assert.ok(!(`CROWS.Dialog.InventoryDrop.${r}` in LANG),
        `${r} now has a message — is it user-facing? If so, drop it from INTERNAL_ONLY`);
    }
  });
});
