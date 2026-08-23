import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

/**
 * BOOT PATH — the failures `npm test` structurally cannot see.
 *
 * Wave 1 shipped 604 passing tests over a system that would not start. Twice.
 *
 *   1. `helpers/schema.mjs` built its container `choices:` from
 *      `Object.keys(CROWS.containers)` after the contract deleted that key —
 *      `Object.keys(undefined)`, a TypeError at module load. Every item data
 *      model imports that mixin, so none of them registered.
 *   2. `crows.mjs` still imports six functions from `helpers/chaos.mjs` that
 *      T1.8's rewrite removed, and `rollAvailability` from `helpers/village.mjs`
 *      which no longer exists. An ESM named import of a missing export is a
 *      hard load failure, not a runtime `undefined`.
 *
 * Neither was visible to the suite, and that is not a bug in the harness —
 * `test/shim/foundry.mjs` is deliberately tiny, and its own comment says so:
 * "if a helper needs more than what is here, it is not a pure helper." Because
 * it has no `foundry.data.fields`, nothing under `node --test` ever imports a
 * data model, so the whole `module/data/**` tree is untested BY CONSTRUCTION —
 * and every `choices:` in it is a live `CROWS.*` dereference of exactly the
 * shape that broke.
 *
 * So this file does not test behaviour. It tests that the modules LOAD, that
 * their schemas BUILD, and that the entry point's imports RESOLVE. The stubs
 * below exist only to get far enough for a module-load failure to be thrown at
 * us; they are not a second shim and nothing should import them.
 *
 * `module/crows.mjs` is deliberately never imported — it needs `Hooks` and
 * `CONFIG` at module scope and belongs to T2.3. Layer 3 reads it as TEXT.
 */

/* -------------------------------------------------------------------------- */
/*  Stubs — the minimum for a class body to evaluate                           */
/* -------------------------------------------------------------------------- */

/**
 * A DataField stand-in that keeps its options where the walker can see them.
 * The real fields validate; these only have to remember what they were handed,
 * because what we are checking is the ARGUMENTS — a `choices:` that arrived
 * `undefined` is the bug.
 */
function stubField(kind) {
  return class StubField {
    constructor(a = {}, b = {}) {
      this.fieldKind = kind;
      if (kind === "SchemaField") { this.fields = a; Object.assign(this, b); }
      else if (kind === "ArrayField" || kind === "SetField") { this.element = a; Object.assign(this, b); }
      else Object.assign(this, a);
    }
  };
}

const FIELD_TYPES = [
  "StringField", "NumberField", "BooleanField", "HTMLField", "ObjectField",
  "SchemaField", "ArrayField", "SetField", "FilePathField", "ColorField",
  "DocumentIdField", "FilePathField", "AngleField", "AlphaField"
];

// Follow the shim's own idiom: anything already present wins, so if the shim
// ever grows a real implementation it is not clobbered by this stub.
const fieldStubs = Object.fromEntries(FIELD_TYPES.map(n => [n, stubField(n)]));
globalThis.foundry.data = globalThis.foundry.data ?? {};
globalThis.foundry.data.fields = { ...fieldStubs, ...(globalThis.foundry.data.fields ?? {}) };

globalThis.foundry.abstract = {
  TypeDataModel: class TypeDataModel {},
  DataModel: class DataModel {},
  ...(globalThis.foundry.abstract ?? {})
};

const SheetBase = class { static DEFAULT_OPTIONS = {}; static PARTS = {}; };
globalThis.foundry.applications = {
  api: { HandlebarsApplicationMixin: (B) => class extends B {}, DialogV2: class DialogV2 {} },
  sheets: { ItemSheetV2: SheetBase, ActorSheetV2: SheetBase },
  ...(globalThis.foundry.applications ?? {})
};

/* -------------------------------------------------------------------------- */
/*  Discovery                                                                  */
/* -------------------------------------------------------------------------- */

const MODULE_DIR = new URL("../module/", import.meta.url);

/** Every `.mjs` under a directory, recursively, as paths relative to it. */
function mjsFilesUnder(dirUrl, prefix = "") {
  const out = [];
  for (const e of readdirSync(dirUrl, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...mjsFilesUnder(new URL(`${e.name}/`, dirUrl), `${prefix}${e.name}/`));
    else if (e.name.endsWith(".mjs")) out.push(`${prefix}${e.name}`);
  }
  return out.sort();
}

const DATA_MODELS = mjsFilesUnder(new URL("data/", MODULE_DIR));
const HELPERS = mjsFilesUnder(new URL("helpers/", MODULE_DIR));

/** Walk a built schema, visiting every field including nested and element ones. */
function walkFields(fields, path, visit) {
  for (const [key, field] of Object.entries(fields ?? {})) {
    const here = path ? `${path}.${key}` : key;
    visit(here, field);
    if (field?.fieldKind === "SchemaField") walkFields(field.fields, here, visit);
    else if (field?.element) {
      visit(`${here}[]`, field.element);
      if (field.element?.fieldKind === "SchemaField") walkFields(field.element.fields, `${here}[]`, visit);
    }
  }
}

const choiceCount = (c) =>
  Array.isArray(c) ? c.length : (c && typeof c === "object" ? Object.keys(c).length : -1);

/* -------------------------------------------------------------------------- */
/*  Layer 0 — the discovery itself                                             */
/* -------------------------------------------------------------------------- */

describe("the sweep actually swept something", () => {
  // A glob that silently matches nothing is the same failure mode as a test
  // file named `.js` in a runner that only globs `.test.mjs`: green, and never
  // executed. Pin the floors so a moved directory fails loudly.
  test("found the data models and the helpers", () => {
    assert.ok(DATA_MODELS.length >= 10, `expected >=10 data models, found ${DATA_MODELS.length}`);
    assert.ok(HELPERS.length >= 20, `expected >=20 helpers, found ${HELPERS.length}`);
    assert.ok(DATA_MODELS.includes("actor/crow.mjs"));
    assert.ok(HELPERS.includes("slots.mjs"));
  });
});

/* -------------------------------------------------------------------------- */
/*  Layer 1 — every data model loads and its schema builds                     */
/* -------------------------------------------------------------------------- */

describe("data models build (the schema.mjs class of failure)", () => {
  for (const rel of DATA_MODELS) {
    test(`${rel} imports and every schema builds`, async () => {
      const ns = await import(new URL(`data/${rel}`, MODULE_DIR).href);
      const models = Object.values(ns)
        .filter(v => typeof v === "function" && typeof v.defineSchema === "function");
      assert.ok(models.length > 0, `${rel} exports no data model — did it move?`);
      for (const Model of models) {
        // The assertion is that this does not throw. `Object.keys(undefined)`
        // on a deleted CROWS key dies right here.
        const schema = Model.defineSchema();
        assert.ok(schema && typeof schema === "object", `${Model.name}.defineSchema() returned nothing`);
      }
    });
  }

  test("no `choices:` is empty or undefined", async () => {
    // The silent version of the same bug: the model still references a CROWS
    // key, the key still exists, but it is no longer the list you think — or it
    // is gone, and `choices` arrives `undefined`. A field that never mentions
    // `choices` is untouched; one that mentions it must mean something.
    const problems = [];
    for (const rel of DATA_MODELS) {
      const ns = await import(new URL(`data/${rel}`, MODULE_DIR).href);
      for (const Model of Object.values(ns)) {
        if (typeof Model !== "function" || typeof Model.defineSchema !== "function") continue;
        walkFields(Model.defineSchema(), "", (path, field) => {
          if (!field || typeof field !== "object" || !("choices" in field)) return;
          if (choiceCount(field.choices) <= 0) {
            problems.push(`${rel} ${Model.name}.${path} choices=${JSON.stringify(field.choices)}`);
          }
        });
      }
    }
    assert.deepEqual(problems, []);
  });

  test("every `initial` is legal against its own `choices`", async () => {
    // What caught the schema.mjs fix by hand: `initial: "backpack"` is only
    // correct while "backpack" is still in the list it is checked against.
    const problems = [];
    for (const rel of DATA_MODELS) {
      const ns = await import(new URL(`data/${rel}`, MODULE_DIR).href);
      for (const Model of Object.values(ns)) {
        if (typeof Model !== "function" || typeof Model.defineSchema !== "function") continue;
        walkFields(Model.defineSchema(), "", (path, field) => {
          if (!field || typeof field !== "object") return;
          if (!Array.isArray(field.choices) || typeof field.initial !== "string") return;
          if (!field.choices.includes(field.initial)) {
            problems.push(`${rel} ${Model.name}.${path} initial=${JSON.stringify(field.initial)}`);
          }
        });
      }
    }
    assert.deepEqual(problems, []);
  });
});

/* -------------------------------------------------------------------------- */
/*  Layer 2 — every helper loads for real                                      */
/* -------------------------------------------------------------------------- */

/**
 * Helpers are supposed to be shim-importable — that is the deal T0.3's shim
 * makes. Anything that genuinely needs a live Foundry goes here WITH a reason,
 * so a skip is a decision someone wrote down rather than a silent gap.
 *
 * Empty today, and it should stay that way.
 */
const HELPERS_NEEDING_LIVE_FOUNDRY = {
  // "example.mjs": "reason it cannot load without a real Foundry"
};

describe("helpers load (the crows.mjs class of failure, one level down)", () => {
  for (const rel of HELPERS) {
    const skip = HELPERS_NEEDING_LIVE_FOUNDRY[rel];
    test(`${rel} imports cleanly`, { skip }, async () => {
      const ns = await import(new URL(`helpers/${rel}`, MODULE_DIR).href);
      assert.ok(ns && typeof ns === "object");
    });
  }

  test("the skip list names a reason for every entry, and no stale ones", () => {
    for (const [file, reason] of Object.entries(HELPERS_NEEDING_LIVE_FOUNDRY)) {
      assert.ok(typeof reason === "string" && reason.length > 10, `${file} needs a real reason`);
      assert.ok(HELPERS.includes(file), `${file} is skipped but no longer exists`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  Layer 3 — the entry point's imports resolve                                */
/* -------------------------------------------------------------------------- */

/**
 * `module/crows.mjs` is read as TEXT and never imported — it touches `Hooks`
 * and `CONFIG` at module scope and belongs to T2.3. But its import statements
 * are checkable without running it: resolve each target, and assert every named
 * binding is really exported. That is precisely the failure ESM raises at load
 * and nothing else in the suite can see.
 */
function staticImportsOf(source) {
  const out = [];
  const re = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    const clause = m[1].trim();
    const specifier = m[2];
    if (!specifier.startsWith(".")) continue;          // package imports are not ours
    const names = [];
    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      for (const part of braced[1].split(",")) {
        const t = part.trim();
        if (t) names.push(t.split(/\s+as\s+/)[0].trim());
      }
    } else if (!clause.startsWith("*")) {
      names.push("default");                            // `import X from "..."`
    }
    if (names.length) out.push({ specifier, names });
  }
  return out;
}

/**
 * KNOWN UNWIRED IMPORTS — a shrinking list, not a suppression.
 *
 * These are real breakage in `module/crows.mjs`, which is T2.3's file and not
 * T1.2's to edit. Listing them keeps the suite honest for the other seven
 * agents while making every one of them visible in source, and the ratchet test
 * below fails the moment an entry is FIXED and not removed — so the list can
 * only shrink, never quietly rot into a permanent exemption.
 *
 *   chaos.mjs   T1.8 rewrote it for the PT2 chaos roll. The PT1 Chaos Count
 *               tally is gone, and with it all six of these. crows.mjs still
 *               imports the old API. NOBODY had caught this one.
 *   village.mjs `rollAvailability` no longer exists; availability is now
 *               `itemAvailability` / `AVAILABILITY_IS_A_ROLL`. T1.6's blocker.
 */
const KNOWN_UNWIRED = {
  "./helpers/chaos.mjs": [
    "registerChaosSetting", "getChaos", "setChaos",
    "addToChaos", "resetChaos", "showChaosDialog"
  ],
  "./helpers/village.mjs": ["rollAvailability"]
};

const ENTRY_POINT = new URL("crows.mjs", MODULE_DIR);
const ENTRY_IMPORTS = staticImportsOf(readFileSync(ENTRY_POINT, "utf8"));

async function unresolvedEntryImports() {
  const missing = [];
  for (const { specifier, names } of ENTRY_IMPORTS) {
    let ns;
    try {
      ns = await import(new URL(specifier, ENTRY_POINT).href);
    } catch (e) {
      missing.push({ specifier, name: "*", note: `module failed to load: ${e.message}` });
      continue;
    }
    for (const name of names) if (!(name in ns)) missing.push({ specifier, name });
  }
  return missing;
}

describe("module/crows.mjs imports resolve", () => {
  test("the parse found the import block", () => {
    assert.ok(ENTRY_IMPORTS.length >= 20, `parsed only ${ENTRY_IMPORTS.length} imports — regex drifted?`);
    const total = ENTRY_IMPORTS.reduce((n, i) => n + i.names.length, 0);
    assert.ok(total >= 80, `parsed only ${total} named bindings — regex drifted?`);
  });

  test("every named import exists, except the ones known to be unwired", async () => {
    const unexpected = (await unresolvedEntryImports())
      .filter(m => !(KNOWN_UNWIRED[m.specifier] ?? []).includes(m.name))
      .map(m => `${m.specifier} -> ${m.name}${m.note ? ` (${m.note})` : ""}`);
    assert.deepEqual(unexpected, [], "crows.mjs imports something that is not exported");
  });

  test("KNOWN_UNWIRED only shrinks — a fixed entry must be deleted from it", async () => {
    // Without this the list becomes a permanent exemption and the next rewrite
    // of chaos.mjs hides behind it.
    const stillMissing = new Set((await unresolvedEntryImports()).map(m => `${m.specifier} -> ${m.name}`));
    const stale = [];
    for (const [specifier, names] of Object.entries(KNOWN_UNWIRED)) {
      for (const name of names) {
        if (!stillMissing.has(`${specifier} -> ${name}`)) stale.push(`${specifier} -> ${name}`);
      }
    }
    assert.deepEqual(stale, [], "these are wired again — remove them from KNOWN_UNWIRED");
  });
});
