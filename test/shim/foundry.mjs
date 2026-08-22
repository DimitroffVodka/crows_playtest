/**
 * Minimal Foundry global shim for running PURE helpers under `node --test`.
 *
 * The rule this file enforces by being small: if a helper needs more than what
 * is here, it is not a pure helper. Do not grow this shim to accommodate one —
 * move the helper's Foundry-touching part into a probe (dev/probes/) and keep
 * the pure part importable.
 *
 * Import for side effects before importing anything from module/:
 *   import "./shim/foundry.mjs";
 */

// --- Math.clamp -----------------------------------------------------------
// Foundry adds this to the Math namespace. Node 26 does not have it.
if (typeof Math.clamp !== "function") {
  Math.clamp = (value, min, max) => Math.min(Math.max(value, min), max);
}

// --- foundry.utils --------------------------------------------------------
// Only the handful of helpers that pure code legitimately reaches for.
const utils = {
  deepClone: (o) => structuredClone(o),

  duplicate: (o) => structuredClone(o),

  /** foundry.utils.mergeObject — the subset pure helpers use. */
  mergeObject(original, other = {}, { insertKeys = true, overwrite = true } = {}) {
    const out = structuredClone(original);
    for (const [k, v] of Object.entries(other)) {
      const exists = k in out;
      if (!exists && !insertKeys) continue;
      if (exists && !overwrite) continue;
      out[k] = v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null
        ? this.mergeObject(out[k], v, { insertKeys, overwrite })
        : v;
    }
    return out;
  },

  /** Dotted-path read: getProperty(obj, "system.xp.txp"). */
  getProperty(object, key) {
    if (!key) return undefined;
    return key.split(".").reduce((o, k) => (o == null ? o : o[k]), object);
  },

  /** Dotted-path write, creating intermediate objects. */
  setProperty(object, key, value) {
    if (!key) return false;
    const parts = key.split(".");
    const last = parts.pop();
    let target = object;
    for (const p of parts) {
      if (typeof target[p] !== "object" || target[p] === null) target[p] = {};
      target = target[p];
    }
    const changed = target[last] !== value;
    target[last] = value;
    return changed;
  },

  /** Stable, order-insensitive object equality for test assertions. */
  objectsEqual(a, b) {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
  },

  randomID(length = 16) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  }
};

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

globalThis.foundry = globalThis.foundry ?? {};
globalThis.foundry.utils = { ...utils, ...(globalThis.foundry.utils ?? {}) };

// --- Deliberately NOT shimmed ---------------------------------------------
// Roll, ChatMessage, Actor, Item, Hooks, game, ui, CONFIG.
//
// A helper that reaches for any of those is not unit-testable and belongs in a
// probe. Leaving them undefined makes that failure loud at import time instead
// of producing a test that passes against a fake.
//
// The one exception Wave 1 may need: a deterministic dice source. When that
// arrives, inject it as a parameter (rollTest({ ..., rng })) rather than
// shimming global Roll — a seam beats a mock.

export { utils as foundryUtils };
