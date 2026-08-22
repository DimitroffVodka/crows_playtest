import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { classifyTier, classifyDoomCrit } from "../module/helpers/roll.mjs";
import { CROWS } from "../module/config.mjs";

/**
 * T0.3 harness proof. These run against the EXISTING Playtest 1 helpers to
 * demonstrate the runner works without a Foundry runtime. Wave 1 replaces the
 * engine; these tests then cover the tier boundaries, which are unchanged
 * between playtests (T1 <=11 / T2 12-16 / T3 17+).
 */

describe("classifyTier — boundaries", () => {
  test("tier 1 is 11 and below", () => {
    assert.equal(classifyTier(2), 1);
    assert.equal(classifyTier(11), 1);
  });

  test("tier 2 is 12 to 16 inclusive", () => {
    assert.equal(classifyTier(12), 2);
    assert.equal(classifyTier(16), 2);
  });

  test("tier 3 is 17 and above", () => {
    assert.equal(classifyTier(17), 3);
    assert.equal(classifyTier(40), 3);
  });

  test("every boundary sits where config says, not where a literal says", () => {
    assert.equal(classifyTier(CROWS.tiers.t1Max), 1);
    assert.equal(classifyTier(CROWS.tiers.t1Max + 1), 2);
    assert.equal(classifyTier(CROWS.tiers.t2Max), 2);
    assert.equal(classifyTier(CROWS.tiers.t2Max + 1), 3);
  });
});

describe("classifyDoomCrit — reads the RAW 2d10 sum", () => {
  test("doom on a raw 2 or 3", () => {
    assert.deepEqual(classifyDoomCrit(2), { doom: true, crit: false });
    assert.deepEqual(classifyDoomCrit(3), { doom: true, crit: false });
  });

  test("crit on a raw 19 or 20", () => {
    assert.deepEqual(classifyDoomCrit(19), { doom: false, crit: true });
    assert.deepEqual(classifyDoomCrit(20), { doom: false, crit: true });
  });

  test("4 and 18 are ordinary", () => {
    assert.deepEqual(classifyDoomCrit(4), { doom: false, crit: false });
    assert.deepEqual(classifyDoomCrit(18), { doom: false, crit: false });
  });

  test("a MODIFIED total can never be a doom or crit — 2d10 cannot roll 1", () => {
    // Guards the classic bug: passing `total` instead of `rawSum`. A modified
    // total of 3 is reachable (raw 5, -2 bane) and must NOT read as a doom, so
    // callers have to pass the raw sum. This test documents the contract; it
    // cannot enforce it at the call site — that is T1.1's job.
    assert.equal(classifyDoomCrit(1).doom, false, "1 is not reachable on 2d10");
  });
});
