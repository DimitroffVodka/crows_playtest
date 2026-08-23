/**
 * Usage dice — R:562.
 *
 * > "All UD are d6s. When the rules tell you to roll UD, **roll all of the item
 * > or effect's dice**. If a die rolled is a 1 or 2, that die is removed from
 * > the item or effect's UD total. When an effect's UD is 0, it ends."
 *
 * The pool is rolled WHOLE and every die showing 1-2 is removed, so one roll
 * can take several dice at once.
 *
 * Playtest 1's `rollUsageDie` rolled a single d6 and removed at most one die no
 * matter how large the pool was, so a 3-UD torch lasted about three times as
 * long as published — expected loss is 1.0 dice per roll at 3d6 against 0.33
 * with one d6. Nothing errored and no test went red; the decay rate was just
 * wrong, and only on multi-die items.
 *
 * The backlash path in dungeon-turn.mjs had it right all along, which is why
 * `resolveUsageDicePool` now lives here — the rule is implemented ONCE and both
 * callers share it. dungeon-turn.mjs re-exports it so its existing importers
 * keep working.
 */

/**
 * Apply the 1-2 removal rule to a set of rolled faces.
 *
 * Pure, so it is the seam every test drives: pass the faces, assert the pool.
 */
export function resolveUsageDicePool(faces = []) {
  // Only real d6 faces count. The looser `Number.isFinite` this replaced let
  // `null` through as 0 — finite, and <= 2, so a null silently REMOVED a die.
  // Unreachable from `Roll`, which only ever yields 1-6, but "bad input quietly
  // produces a plausible wrong answer" is the exact shape of every defect this
  // migration has turned up.
  const rolled = (faces ?? [])
    .map(Number)
    .filter(f => Number.isInteger(f) && f >= 1 && f <= 6);
  const removed = rolled.filter(f => f <= 2).length;
  const remaining = Math.max(0, rolled.length - removed);
  return { removed, remaining, depleted: remaining === 0, faces: rolled };
}

/**
 * Roll one item's whole UD pool and persist the result.
 *
 * `forced` is the deterministic dice seam. The test shim deliberately does not
 * stub global `Roll` (see test/shim/foundry.mjs) — inject results rather than
 * mocking. It takes an ARRAY of faces, one per die in the pool; a bare number
 * is accepted as a single-die pool.
 */
export async function rollUsageDie(item, { forced = null } = {}) {
  const ud = item.system?.usageDie;
  const pool = ud?.udCurrent ?? 0;

  if (!ud?.enabled || pool <= 0) {
    return { rolls: [], removed: 0, udCurrent: pool, depleted: pool <= 0 };
  }

  let faces;
  if (forced === null) {
    const roll = await new Roll(`${pool}d6`).evaluate();
    faces = roll.dice[0].results.map(r => r.result);
  } else {
    faces = Array.isArray(forced) ? forced.slice(0, pool) : [forced];
  }

  const res = resolveUsageDicePool(faces);
  if (res.removed) await item.update({ "system.usageDie.udCurrent": res.remaining });

  return {
    rolls: res.faces,
    removed: res.removed,
    udCurrent: res.remaining,
    depleted: res.depleted
  };
}
