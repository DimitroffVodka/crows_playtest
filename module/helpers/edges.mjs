import { CROWS } from "../config.mjs";

/**
 * Edge / bane resolution (R:278-284).
 *
 * PURE — no Foundry. Everything here is a function of two arrays of `Label`.
 *
 * Edges and banes are a COUNTED channel. Numeric bonuses are a SEPARATE channel
 * (R:286) and never enter this function: a masterwork tool's +2 is a `Mod`, not
 * an edge, and the two must not be able to convert into one another.
 *
 * The algorithm is CLAMP-THEN-SUBTRACT, and the order is load-bearing:
 *
 *   E = min(edges.length, 2)   B = min(banes.length, 2)   net = E - B
 *
 *   net +2 -> tierShift +1   (double edge)
 *   net +1 -> numeric   +2   (single edge)
 *   net  0 -> neutral
 *   net -1 -> numeric   -2   (single bane)
 *   net -2 -> tierShift -1   (double bane)
 *
 * Subtract-then-clamp gets "3 edges + 1 bane" wrong: it yields net 2 (a DOUBLE
 * edge) where the rules give ONE edge, because the third edge was never there to
 * be cancelled. That case is pinned in test/edges.test.mjs.
 *
 * @typedef {{key: string, label: string, source?: string}} Label
 * @typedef {{numeric: -2|0|2, tierShift: -1|0|1, edges: Label[], banes: Label[],
 *            explanation: string}} EdgeBaneResolution
 */

/** The most edges or banes that can matter on one test (R:278). */
export const EDGE_BANE_CLAMP = 2;

/**
 * @param {Label[]} edges
 * @param {Label[]} banes
 * @returns {EdgeBaneResolution}
 */
export function resolveEdgesBanes(edges = [], banes = []) {
  const e = Array.isArray(edges) ? edges.filter(Boolean) : [];
  const b = Array.isArray(banes) ? banes.filter(Boolean) : [];

  const E = Math.min(e.length, EDGE_BANE_CLAMP);
  const B = Math.min(b.length, EDGE_BANE_CLAMP);
  const net = E - B;

  const n = CROWS.edgeBane.numeric;   // 2 (R:264)
  let numeric = 0;
  let tierShift = 0;
  if (net >= 2) tierShift = 1;
  else if (net === 1) numeric = n;
  else if (net === -1) numeric = -n;
  else if (net <= -2) tierShift = -1;

  return {
    numeric,
    tierShift,
    edges: [...e],
    banes: [...b],
    explanation: explainEdgesBanes(e.length, b.length, E, B, net)
  };
}

/**
 * A human-readable account of how the two counts collapsed. Deterministic — the
 * chat card renders this verbatim, so it must not depend on locale or ordering.
 */
export function explainEdgesBanes(rawEdges, rawBanes, E, B, net) {
  const parts = [`${plural(rawEdges, "edge")} vs ${plural(rawBanes, "bane")}`];
  if (rawEdges > EDGE_BANE_CLAMP || rawBanes > EDGE_BANE_CLAMP) {
    parts.push(`clamped to ${E} vs ${B}`);
  }
  parts.push(effectText(net));
  return parts.join(" — ");
}

function effectText(net) {
  if (net >= 2) return "double edge: one tier better";
  if (net === 1) return `single edge: +${CROWS.edgeBane.numeric}`;
  if (net === 0) return "no net effect";
  if (net === -1) return `single bane: −${CROWS.edgeBane.numeric}`;
  return "double bane: one tier worse";
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
