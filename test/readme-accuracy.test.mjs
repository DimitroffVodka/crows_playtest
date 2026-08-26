import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { CROWS } from "../module/config.mjs";

/**
 * The README makes checkable claims. Pin the ones a machine can verify.
 *
 * It went a whole playtest out of date: still advertising Playtest 1's dates,
 * `boned` as a levelled condition, the chaos COUNT rather than the per-cast
 * chaos roll, 11 packs, a v13 minimum, and a starter kit with a bedroll in it.
 * None of that is catchable by reading the code, and nobody re-reads a readme.
 *
 * These tests do not police prose. They check the numbers and vocabularies that
 * drift when the system changes underneath them.
 */

const README = readFileSync("README.md", "utf8");
const system = JSON.parse(readFileSync("system.json", "utf8"));

describe("README stays accurate", () => {
  test("declares the right pack count", () => {
    const m = README.match(/\*\*(\d+) packs\*\*/);
    assert.ok(m, "no '**N packs**' claim found");
    assert.equal(Number(m[1]), system.packs.length);
  });

  test("declares the right Foundry compatibility", () => {
    const { minimum, verified } = system.compatibility;
    assert.match(README, new RegExp(`v${minimum} minimum, verified on v${verified}`, "i"),
      `README must state v${minimum} minimum, verified on v${verified}`);
  });

  test("lists exactly the conditions the system defines", () => {
    for (const c of CROWS.conditions) {
      assert.match(README, new RegExp("`" + c + "`"), `README never mentions \`${c}\``);
    }
    // The Playtest 1 condition may only appear as history, never as a feature.
    const claims = README.split("\n").filter(l => /boned/i.test(l));
    for (const line of claims) {
      assert.match(line, /Playtest 1|is gone|replaced/i,
        `"boned" is presented as current: ${line.trim().slice(0, 70)}`);
    }
  });

  test("lists the crow sheet's actual tabs", () => {
    const src = readFileSync("module/sheets/crow-sheet.mjs", "utf8");
    const tabs = JSON.parse(src.match(/ctx\.tabs = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
    for (const t of tabs) {
      assert.match(README, new RegExp(t, "i"), `README omits the ${t} tab`);
    }
  });

  test("describes the universal starter kit that is actually granted", () => {
    const src = readFileSync("module/helpers/character-creator.mjs", "utf8");
    const kit = [...src.matchAll(/\{ name: "([^"]+)", pack: "crows\./g)].map(m => m[1]);
    assert.ok(kit.length >= 3, "could not read the starter kit from the creator");
    for (const item of kit) {
      assert.match(README, new RegExp(item.replace(/s$/, ""), "i"), `README omits ${item}`);
    }
    assert.ok(!/bedroll/i.test(README), "the kit has no bedroll");
  });

  test("does not advertise an API that no longer exists", () => {
    // `game.crows.chaos.show()` was documented long after the chaos count was
    // replaced by the per-cast chaos roll.
    const calls = [...README.matchAll(/game\.crows\.([a-zA-Z]+)/g)].map(m => m[1]);
    // The facade re-exports from across module/, so scan the tree — a symbol
    // defined in roll.mjs and spread into game.crows is still a real key.
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith(".mjs") ? [`${dir}/${e.name}`] : []);
    const src = walk("module").map((f) => readFileSync(f, "utf8")).join("\n");
    const missing = [...new Set(calls)].filter(k => !new RegExp(`\\b${k}\\b`).test(src));
    assert.deepEqual(missing, [], "README references game.crows keys the system never sets");
  });

  test("every repo path it links to exists", () => {
    const paths = [...README.matchAll(/\]\((?!https?:)([^)#]+)\)/g)].map(m => m[1]);
    const missing = paths.filter(p => {
      try { readdirSync(p); return false; } catch { /* not a dir */ }
      try { readFileSync(p); return false; } catch { return true; }
    });
    assert.deepEqual(missing, []);
  });
});
