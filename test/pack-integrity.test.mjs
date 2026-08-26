import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";
import { ClassicLevel } from "classic-level";

/**
 * Every compiled compendium is a release artifact, not a cache of the YAML.
 *
 * WHY. The source corpus tests intentionally read `src/packs`, but Foundry
 * reads the LevelDB files under `packs/`. That distinction let four gear cards
 * be reclassified as materials in source while the live pack still shipped
 * them as treasure. A source-only test suite can stay green while the feature
 * a Ref actually loads is inert.
 *
 * This guard reads every pack declared by `system.json`, checks its primary
 * document count, and compares the serialized document hierarchy with the
 * source. The projection mirrors the Foundry CLI's `applyHierarchy` and
 * `mapHierarchy`: `_key` is a build-only source field, embedded documents are
 * stored under their own LevelDB keys, and primary documents contain their
 * embedded IDs (including empty collections materialized by the compiler).
 *
 * Rejected alternatives:
 * - source-only corpus assertions cannot see a stale compiled artifact;
 * - file mtimes and LevelDB filenames say nothing about document content;
 * - rebuilding packs inside the test mutates release artifacts and would hide
 *   the very drift this test is meant to catch;
 * - `extractPack` into YAML is slower and adds filename/serialization noise
 *   when the LevelDB values are already the thing Foundry consumes.
 *
 * LIVE FOUNDry CAVEAT. ClassicLevel may advance a pack's manifest while it
 * opens a database, even for iteration. Each checkout pack is therefore copied
 * to a temporary directory before opening. `createIfMissing: false` still
 * protects against silently treating a missing compiled pack as an empty one;
 * the live Foundry Data directory is never opened by this test.
 */

const SYSTEM = JSON.parse(await fs.readFile("system.json", "utf8"));
const PACKS = SYSTEM.packs;

/** The hierarchy used by @foundryvtt/foundryvtt-cli/lib/package.mjs. */
const HIERARCHY = {
  actors: { items: "array", effects: "array" },
  cards: { cards: "array" },
  combats: { combatants: "array", groups: "array" },
  delta: { items: "array", effects: "array" },
  items: { effects: "array" },
  journal: { pages: "array", categories: "array" },
  playlists: { sounds: "array" },
  regions: { behaviors: "array" },
  tables: { results: "array" },
  tokens: { delta: "object" },
  scenes: {
    drawings: "array",
    tokens: "array",
    lights: "array",
    notes: "array",
    regions: "array",
    sounds: "array",
    templates: "array",
    tiles: "array",
    walls: "array"
  }
};

async function sourceFiles(pack) {
  const directory = pack.path.replace(/^packs/, "src/packs");
  const files = (await fs.readdir(directory))
    .filter(file => file.endsWith(".yaml") || file.endsWith(".yml"))
    .sort();
  return Promise.all(files.map(async file => ({
      file,
      document: yaml.load(await fs.readFile(path.join(directory, file), "utf8"))
    })));
}

/**
 * Return the exact value the CLI puts at `document._key` for this source node.
 * Its embedded collections become IDs; all other fields remain unchanged.
 */
function compiledValue(document, collection) {
  const value = structuredClone(document);
  delete value._key;

  for (const [embedded, kind] of Object.entries(HIERARCHY[collection] ?? {})) {
    if (kind === "array") {
      value[embedded] = Array.isArray(value[embedded])
        ? value[embedded].map(entry => entry._id)
        : [];
    } else {
      value[embedded] = value[embedded] ? value[embedded]._id : null;
    }
  }
  return value;
}

/** Collect primary and embedded source documents under their declared keys. */
function expectedEntries(sources) {
  const expected = new Map();

  function visit(document) {
    assert.ok(document && typeof document === "object", "source document is not an object");
    const key = document._key;
    assert.match(key ?? "", /^![^!]+![^!]+$/, `source document has no primary _key: ${document._id ?? "?"}`);
    assert.equal(expected.has(key), false, `duplicate source _key ${key}`);

    const collection = key.split("!")[1];
    expected.set(key, compiledValue(document, collection));

    for (const [embedded, kind] of Object.entries(HIERARCHY[collection] ?? {})) {
      const children = document[embedded];
      if (kind === "array") {
        for (const child of Array.isArray(children) ? children : []) visit(child);
      } else if (children) {
        visit(children);
      }
    }
  }

  for (const { document } of sources) visit(document);
  return expected;
}

async function readCompiledEntries(pack) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crows-pack-integrity-"));
  const copy = path.join(tempRoot, pack.name);
  let db;
  try {
    await fs.cp(pack.path, copy, { recursive: true });
    db = new ClassicLevel(copy, {
      keyEncoding: "utf8",
      valueEncoding: "json",
      createIfMissing: false
    });
    const entries = new Map();
    for await (const [key, value] of db.iterator()) entries.set(key, value);
    return entries;
  } catch (error) {
    throw new Error(`${pack.name}: unable to read compiled pack ${pack.path}: ${error.message}`, {
      cause: error
    });
  } finally {
    if (db) await db.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function differingPaths(expected, actual, prefix = "", paths = []) {
  if (paths.length >= 8) return paths;
  if (isDeepStrictEqual(expected, actual)) return paths;
  if (!expected || !actual || typeof expected !== "object" || typeof actual !== "object") {
    paths.push(prefix || "value");
    return paths;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || expected.length !== actual.length) {
      paths.push(prefix || "value");
      return paths;
    }
    for (let index = 0; index < expected.length && paths.length < 8; index++) {
      differingPaths(expected[index], actual[index], `${prefix}[${index}]`, paths);
    }
    return paths;
  }

  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (paths.length >= 8) break;
    const next = prefix ? `${prefix}.${key}` : key;
    if (!(key in expected) || !(key in actual)) paths.push(next);
    else differingPaths(expected[key], actual[key], next, paths);
  }
  return paths;
}

function primaryKeys(entries, collection) {
  return [...entries.keys()].filter(key => {
    const parts = key.split("!");
    return parts.length === 3 && parts[1] === collection;
  });
}

describe("compiled packs match their source corpus", () => {
  test("system.json declares the packs under test", () => {
    assert.ok(PACKS.length > 0, "system.json declares no packs");
    assert.equal(new Set(PACKS.map(pack => pack.name)).size, PACKS.length,
      "system.json declares duplicate pack names");
  });

  for (const pack of PACKS) {
    test(`${pack.name} has the source documents compiled into packs/`, async () => {
      const sources = await sourceFiles(pack);
      const expected = expectedEntries(sources);
      const actual = await readCompiledEntries(pack);
      const collection = sources[0]?.document?._key?.split("!")[1];
      const expectedPrimaryCount = sources.length;
      const actualPrimaryCount = primaryKeys(actual, collection).length;
      const failures = [];

      if (expectedPrimaryCount !== actualPrimaryCount) {
        failures.push(`document count expected ${expectedPrimaryCount}, compiled ${actualPrimaryCount}`);
      }
      if (expected.size !== actual.size) {
        failures.push(`record count expected ${expected.size}, compiled ${actual.size}`);
      }

      for (const [key, value] of expected) {
        if (!actual.has(key)) {
          failures.push(`missing ${key}`);
          continue;
        }
        if (!isDeepStrictEqual(value, actual.get(key))) {
          const paths = differingPaths(value, actual.get(key));
          failures.push(`${key} diverged in ${paths.join(", ") || "document fields"}`);
        }
      }
      for (const key of actual.keys()) {
        if (!expected.has(key)) failures.push(`unexpected ${key}`);
      }

      assert.deepEqual(failures, [], `${pack.name}: ${failures.join("; ")}`);
    });
  }
});
