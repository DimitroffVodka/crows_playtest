import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const DIR = "src/packs/crows-tables";
const tables = readdirSync(DIR).filter((f) => f.endsWith(".yaml"))
  .map((f) => ({ file: f, t: yaml.load(readFileSync(join(DIR, f), "utf8")) }));

/**
 * A RollTable is an INSTRUMENT, not a transcript.
 *
 * The books contain range bugs — Backlashes prints 61-62 and 62-64, both
 * claiming 62; Minor Interesting Things prints 45 twice and skips 57 entirely.
 * Our content policy is to preserve printed text verbatim, but a table that
 * returns nothing on a 57, or silently picks the first of two rows claiming a
 * 62, is broken in play rather than faithful. The ranges are made continuous
 * and the source rows are logged for MCDM.
 */
describe("roll tables are rollable", () => {
  test("guard: the corpus loaded", () => {
    assert.equal(tables.length, 31);
  });

  for (const { file, t } of tables) {
    test(`${file} covers its die with no gap or overlap`, () => {
      assert.ok(t.results?.length, "no results");
      const rs = t.results.map((r) => ({ lo: r.range?.[0], hi: r.range?.[1] }))
        .sort((a, b) => a.lo - b.lo);
      for (const r of rs) {
        assert.ok(Number.isInteger(r.lo) && Number.isInteger(r.hi), `bad range in ${file}`);
        assert.ok(r.hi >= r.lo, `inverted ${r.lo}-${r.hi}`);
      }
      for (let i = 1; i < rs.length; i++) {
        assert.ok(rs[i].lo > rs[i - 1].hi,
          `overlap: ${rs[i-1].lo}-${rs[i-1].hi} and ${rs[i].lo}-${rs[i].hi}`);
        assert.equal(rs[i].lo, rs[i - 1].hi + 1,
          `gap between ${rs[i-1].hi} and ${rs[i].lo} — a roll there returns nothing`);
      }
    });
  }

  test("every table declares a formula its ranges can actually produce", () => {
    const bad = [];
    for (const { file, t } of tables) {
      const m = String(t.formula ?? "").match(/^(\d+)d(\d+)$/);
      if (!m) { bad.push(`${file}: unparseable formula ${t.formula}`); continue; }
      const [, n, faces] = m.map(Number);
      const max = Math.max(...t.results.map((r) => r.range[1]));
      const min = Math.min(...t.results.map((r) => r.range[0]));
      if (min < n) bad.push(`${file}: lowest range ${min} below minimum roll ${n}`);
      // A formula with MORE faces than the table covers leaves dead rolls.
      if (n * faces > max) bad.push(`${file}: ${t.formula} can roll ${n * faces}, table stops at ${max}`);
    }
    assert.deepEqual(bad, []);
  });

  test("Backlashes rolls d100 — the rank bonus is added by the roller (R:1261)", () => {
    // Rows run to 105 to cover "d100 + the rank of the triggering spell", but a
    // 1d105 formula would let a rank-0 cast reach 101-105, which never happens.
    const bl = tables.find((x) => x.file === "magic-backlashes.yaml").t;
    assert.equal(bl.formula, "1d100");
    assert.equal(Math.max(...bl.results.map((r) => r.range[1])), 105);
  });

  test("results use v14's `name`, never the removed `text` field", () => {
    // TableResult's v14 schema is _id, type, NAME, img, DESCRIPTION, documentUuid,
    // weight, range, drawn, flags, _stats. `text` was removed. Authoring it meant
    // Foundry migrated the value into `description` — an HTMLField — which escaped
    // "Traveling >2 hexes" into "Traveling &gt;2 hexes", and left `name`, the field
    // v14 actually renders, empty on all 519 rows.
    for (const { file, t } of tables) {
      for (const r of t.results) {
        assert.ok(!("text" in r), `${file}: uses the removed \`text\` field`);
        assert.ok(String(r.name ?? "").trim(), `${file}: a result has no name`);
      }
    }
  });

  test("no result smuggles an HTML entity into plain text", () => {
    // `name` is a StringField and renders literally, so "&gt;" would display as
    // those four characters.
    const bad = [];
    for (const { file, t } of tables) {
      for (const r of t.results) {
        if (/&(?:amp|lt|gt|quot|#39);/.test(r.name)) bad.push(`${file}: ${r.name.slice(0, 50)}`);
      }
    }
    assert.deepEqual(bad, []);
  });

  test("every result has a stable id", () => {
    for (const { file, t } of tables) {
      assert.ok(t._id && t._key?.startsWith("!tables!"), `${file}: bad table id`);
      for (const r of t.results) {
        assert.ok(r._key?.startsWith("!tables.results!"), `${file}: bad result key`);
      }
    }
  });

  test("ids are unique across the whole pack", () => {
    const seen = new Set();
    for (const { file, t } of tables) {
      assert.ok(!seen.has(t._id), `${file}: duplicate table id ${t._id}`);
      seen.add(t._id);
      for (const r of t.results) {
        assert.ok(!seen.has(r._id), `${file}: duplicate result id ${r._id}`);
        seen.add(r._id);
      }
    }
  });
});
