import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { collapseDoubledText, doubledTextRepair, DOUBLED_TEXT_PATHS } from "../module/helpers/migration.mjs";

/**
 * The crow sheet bound two inputs to `system.background` and two to
 * `system.details.feature`. A form cannot carry one field name twice — Foundry
 * collected both controls into an array, the StringField cast it to
 * `"Transmuter,Transmuter"`, the sheet rendered that back into both inputs, and
 * the next save doubled it again.
 *
 * Found by opening a crow sheet and reading it, not by any test. A live crow
 * had eight copies of its background after three saves; the growth is 2^n.
 */
describe("Duplicate-binding text repair", () => {
  test("no field is bound twice in the crow sheet", () => {
    // The actual defect. A second binding re-introduces the doubling no matter
    // how good the repair is, so guard the template rather than only the data.
    const sheet = readFileSync("templates/actor/crow/sheet.hbs", "utf8");
    const names = [...sheet.matchAll(/name="(system\.[^"]+)"/g)].map(m => m[1]);
    const seen = new Set();
    const duplicated = names.filter(n => seen.has(n) || (seen.add(n), false));
    assert.deepEqual([...new Set(duplicated)], [],
      "two inputs sharing a field name make Foundry submit an array and double the value on every save");
  });

  test("a doubled value collapses to one copy", () => {
    assert.equal(collapseDoubledText("Transmuter,Transmuter"), "Transmuter");
    assert.equal(collapseDoubledText("Transmuter,Transmuter,Transmuter,Transmuter"), "Transmuter");
  });

  test("the eight-copy case a live crow actually had", () => {
    assert.equal(collapseDoubledText(new Array(8).fill("Transmuter").join(",")), "Transmuter");
  });

  test("a genuine comma is left alone", () => {
    // Repairing something we cannot prove was corrupted is worse than the bug.
    assert.equal(collapseDoubledText("Smith, retired"), "Smith, retired");
    assert.equal(collapseDoubledText("Fisher,Farmer"), "Fisher,Farmer");
  });

  test("ordinary values pass through untouched", () => {
    for (const value of ["Transmuter", "", null, undefined, 7]) {
      assert.equal(collapseDoubledText(value), value);
    }
  });

  test("repair reports only the fields that need changing", () => {
    const actor = {
      system: { background: "Transmuter,Transmuter", details: { feature: "Steady hands" } }
    };
    assert.deepEqual(doubledTextRepair(actor), { "system.background": "Transmuter" },
      "an already-clean field must not be rewritten");
  });

  test("a clean actor needs no updates at all", () => {
    const actor = { system: { background: "Transmuter", details: { feature: "Steady hands" } } };
    assert.deepEqual(doubledTextRepair(actor), {});
  });

  test("both reachable fields are covered", () => {
    assert.deepEqual([...DOUBLED_TEXT_PATHS], ["system.background", "system.details.feature"]);
  });
});
