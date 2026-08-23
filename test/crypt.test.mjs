import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import * as cryptRules from "../module/helpers/crypt.mjs";
import { effectiveInstitutionLevel } from "../module/helpers/village.mjs";

describe("crypt boon effect level (C:2943)", () => {
  test("crypt 5 + Prosperity 10 uses level 6 and never consults a disagreeing fallback", () => {
    const institutionLevel = effectiveInstitutionLevel(
      { type: "crypt", level: 5, operatingFromCycle: 0 },
      { cycle: 1, prosperity: 10 }
    ).level;
    assert.equal(institutionLevel, 6, "the village institution owns the capstone rule");

    assert.equal(
      typeof cryptRules.resolveCryptBoonLevel,
      "function",
      "crypt.mjs must expose one pure authority seam for every boon effect"
    );
    const boonLevel = cryptRules.resolveCryptBoonLevel({
      institutionLevel,
      readFallback: () => {
        throw new Error("the standalone level must not be read when the institution exists");
      }
    });
    assert.equal(boonLevel, 6);

    const expected = {
      cooperation: { uses: 1, value: 12 },
      disappearance: { uses: 1, value: 6 },
      escape: { uses: 1, value: 18 },
      flight: { uses: 1, value: 6 },
      fury: { uses: 1, value: 6 },
      greed: { uses: 1, value: 6 },
      knowledge: { uses: 1, value: 6 },
      rescue: { uses: 6, value: 1 },
      swiftness: { uses: 1, value: 6 },
      vitality: { uses: 1, value: 12 }
    };
    assert.deepEqual(
      Object.fromEntries(Object.entries(cryptRules.CRYPT_BOONS).map(([id, boon]) => [
        id,
        { uses: boon.uses(boonLevel), value: boon.value(boonLevel) }
      ])),
      expected,
      "all ten boon magnitudes and charge counts scale from the same effective level"
    );
  });

  test("the standalone value is only a true fallback, and level 0 remains authoritative", () => {
    let reads = 0;
    assert.equal(cryptRules.resolveCryptBoonLevel({
      institutionLevel: undefined,
      readFallback: () => { reads += 1; return 5; }
    }), 5);
    assert.equal(reads, 1);

    assert.equal(cryptRules.resolveCryptBoonLevel({
      institutionLevel: 0,
      readFallback: () => { throw new Error("a destroyed crypt is not a missing crypt"); }
    }), 0);
  });
});

describe("Boon of Disappearance (C:2925)", () => {
  test("is an honest narrative combat-round clock, not a deleted condition flag", () => {
    const boon = cryptRules.CRYPT_BOONS.disappearance;
    assert.equal(boon.applyTo, "narrative");
    assert.equal(boon.uses(6), 1, "the use-vs-expend ambiguity keeps the existing single-use default");
    assert.match(boon.summary(6), /6 combat rounds/);
  });
});
