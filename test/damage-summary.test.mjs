import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { damageSummaryLine } from "../module/helpers/damage.mjs";

/**
 * The "Damage applied" chat summary, which was built inline and had two dead
 * branches nobody noticed.
 *
 * WHY. `applyDamage` returns `defeated` — the canonical boolean for both Actor
 * types. The summary's Crow branch read `r.dead`, and its boned note read
 * `r.bonedBonus`. Neither field is ever returned, so neither branch could
 * render. A Crow killed by the damage got a summary that looked like an
 * ordinary hit, while the actor was defeated and its token already wore the
 * skull. That reads as "the damage did not kill them", which is the opposite
 * of what happened, and it is the worst way for a chat card to be wrong.
 *
 * `boned` is a Playtest 1 status, not a current condition, so that branch is
 * gone rather than repaired.
 *
 * These assert on the RENDERED line, not on the presence of a field. A test
 * that checked `result.defeated` existed would have passed against the broken
 * code, because the bug was never in the data.
 */
describe("Damage applied summary", () => {
  const crow = (over = {}) => ({
    ok: true, actorType: "crow", actorName: "Bruno", total: 7,
    absorbed: { armor: 2, stamina: 3, wounds: 1 }, armorBroken: [], ...over
  });
  const monster = (over = {}) => ({
    ok: true, actorType: "monster", actorName: "Ghoul", total: 5,
    stamina: { before: 5, after: 0 }, absorbed: {}, ...over
  });

  test("a Crow killed by the damage is reported as dead", () => {
    const line = damageSummaryLine(crow({ defeated: true }));
    assert.match(line, /\(dead\)/, "a defeated Crow's summary must say so");
    assert.match(line, /Bruno/);
  });

  test("a Crow who survives is not reported as dead", () => {
    assert.doesNotMatch(damageSummaryLine(crow({ defeated: false })), /\(dead\)/);
  });

  test("the Crow branch reads `defeated`, never a `dead` field", () => {
    // The exact shape of the old bug: `applyDamage` never returns `dead`, so a
    // summary keyed on it stayed silent. Passing the phantom field alone must
    // not produce the text; passing the real one must.
    assert.doesNotMatch(damageSummaryLine(crow({ dead: true })), /\(dead\)/);
    assert.match(damageSummaryLine(crow({ defeated: true })), /\(dead\)/);
  });

  test("a defeated monster is reported as defeated, not dead", () => {
    // The one id where the two vocabularies diverge: monsters are defeated,
    // Crows are dead, and the summary must not mix them.
    const line = damageSummaryLine(monster({ defeated: true }));
    assert.match(line, /\(defeated\)/);
    assert.doesNotMatch(line, /\(dead\)/);
  });

  test("a Crow who absorbs nothing still reads as a line, not an empty one", () => {
    const line = damageSummaryLine(crow({ absorbed: {}, total: 0 }));
    assert.match(line, /no effect/);
  });

  test("broken armour is named", () => {
    assert.match(damageSummaryLine(crow({ armorBroken: ["Chain shirt"] })), /broken: Chain shirt/);
  });

  test("a refused result contributes no line", () => {
    assert.equal(damageSummaryLine({ ok: false }), "");
    assert.equal(damageSummaryLine(null), "");
  });
});
