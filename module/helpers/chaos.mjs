/**
 * Chaos Count — the Ref-secret per-world tally that triggers backlashes
 * once it reaches 13 (per Rules Booklet p.24).
 *
 * Stored as a hidden world setting so it persists across reloads and is
 * GM-only visible. registerChaosSetting() must run in the init hook.
 */

const NS = "crows";
const KEY = "chaosCount";
const THRESHOLD = 13;

export function registerChaosSetting() {
  game.settings.register(NS, KEY, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export function getChaos() {
  try { return Number(game.settings.get(NS, KEY)) || 0; }
  catch { return 0; }
}

export async function setChaos(n) {
  return game.settings.set(NS, KEY, Math.max(0, Math.floor(Number(n) || 0)));
}

/**
 * Add (or subtract) chaos. Returns {before, after, threshold} where
 * threshold === true means a backlash should be triggered and CC reset.
 */
export async function addToChaos(amount) {
  const before = getChaos();
  const after = Math.max(0, before + Math.floor(Number(amount) || 0));
  await setChaos(after);
  return { before, after, threshold: after >= THRESHOLD, ceiling: THRESHOLD };
}

export async function resetChaos() {
  const before = getChaos();
  await setChaos(0);
  return { before, after: 0 };
}
