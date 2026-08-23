import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveEdgesBanes, EDGE_BANE_CLAMP } from "../module/helpers/edges.mjs";
import { CROWS } from "../module/config.mjs";

/** n throwaway Labels, distinctly keyed so nothing can dedupe them by accident. */
const labels = (n, prefix) =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, label: `${prefix} ${i}` }));

/**
 * The FULL truth table, (0..3 edges) x (0..3 banes) = 16 cases.
 *
 * Every expectation here is CLAMP-THEN-SUBTRACT. A subtract-then-clamp
 * implementation passes 12 of these and fails the four where one side exceeds 2
 * — 3v1 being the case that matters in play.
 */
const TRUTH_TABLE = [
  { e: 0, b: 0, numeric: 0, tierShift: 0 },
  { e: 0, b: 1, numeric: -2, tierShift: 0 },
  { e: 0, b: 2, numeric: 0, tierShift: -1 },
  { e: 0, b: 3, numeric: 0, tierShift: -1 },

  { e: 1, b: 0, numeric: 2, tierShift: 0 },
  { e: 1, b: 1, numeric: 0, tierShift: 0 },
  { e: 1, b: 2, numeric: -2, tierShift: 0 },
  { e: 1, b: 3, numeric: -2, tierShift: 0 },

  { e: 2, b: 0, numeric: 0, tierShift: 1 },
  { e: 2, b: 1, numeric: 2, tierShift: 0 },
  { e: 2, b: 2, numeric: 0, tierShift: 0 },
  { e: 2, b: 3, numeric: 0, tierShift: 0 },

  { e: 3, b: 0, numeric: 0, tierShift: 1 },
  { e: 3, b: 1, numeric: 2, tierShift: 0 },
  { e: 3, b: 2, numeric: 0, tierShift: 0 },
  { e: 3, b: 3, numeric: 0, tierShift: 0 }
];

describe("resolveEdgesBanes — the full 4x4 truth table", () => {
  for (const row of TRUTH_TABLE) {
    test(`${row.e} edge(s) vs ${row.b} bane(s) -> numeric ${row.numeric}, tierShift ${row.tierShift}`, () => {
      const r = resolveEdgesBanes(labels(row.e, "e"), labels(row.b, "b"));
      assert.equal(r.numeric, row.numeric);
      assert.equal(r.tierShift, row.tierShift);
    });
  }

  test("3 edges + 1 bane is ONE edge, not a double edge", () => {
    // The case a naive subtract-then-clamp gets wrong: it computes net 2 and
    // grants a tier shift, where the rules give a plain +2. The third edge was
    // never in play, so it cannot cancel the bane.
    const r = resolveEdgesBanes(labels(3, "e"), labels(1, "b"));
    assert.equal(r.numeric, 2, "one edge is a numeric +2");
    assert.equal(r.tierShift, 0, "and NOT a tier shift");
  });

  test("1 edge + 3 banes is ONE bane, the mirror of the same trap", () => {
    const r = resolveEdgesBanes(labels(1, "e"), labels(3, "b"));
    assert.equal(r.numeric, -2);
    assert.equal(r.tierShift, 0);
  });

  test("numeric and tierShift are never both non-zero", () => {
    for (const row of TRUTH_TABLE) {
      const r = resolveEdgesBanes(labels(row.e, "e"), labels(row.b, "b"));
      assert.ok(r.numeric === 0 || r.tierShift === 0,
        `${row.e}v${row.b} produced both a numeric and a tier shift`);
    }
  });
});

describe("resolveEdgesBanes — channel separation and shape", () => {
  test("the numeric magnitude comes from config, not a literal", () => {
    const r = resolveEdgesBanes(labels(1, "e"), []);
    assert.equal(r.numeric, CROWS.edgeBane.numeric);
  });

  test("the clamp is 2 a side", () => {
    assert.equal(EDGE_BANE_CLAMP, 2);
    const two = resolveEdgesBanes(labels(2, "e"), []);
    const nine = resolveEdgesBanes(labels(9, "e"), []);
    assert.deepEqual(
      { numeric: two.numeric, tierShift: two.tierShift },
      { numeric: nine.numeric, tierShift: nine.tierShift }
    );
  });

  test("the supplied Labels survive verbatim, for the card's explanation", () => {
    const e = [{ key: "flanking", label: "Flanking", source: "Actor.abc123" }];
    const b = [{ key: "weakened", label: "Weakened" }];
    const r = resolveEdgesBanes(e, b);
    assert.deepEqual(r.edges, e);
    assert.deepEqual(r.banes, b);
  });

  test("the returned arrays are copies — a caller cannot mutate the inputs through them", () => {
    const e = labels(1, "e");
    const r = resolveEdgesBanes(e, []);
    r.edges.push({ key: "sneaky", label: "Sneaky" });
    assert.equal(e.length, 1);
  });

  test("no netEdges/netBanes — a single net value, deliberately not overdetermined", () => {
    const r = resolveEdgesBanes(labels(3, "e"), labels(1, "b"));
    assert.equal(r.netEdges, undefined);
    assert.equal(r.netBanes, undefined);
  });

  test("missing, null and non-array inputs resolve to neutral rather than throwing", () => {
    for (const bad of [undefined, null, 0, "edge", {}]) {
      const r = resolveEdgesBanes(bad, bad);
      assert.equal(r.numeric, 0);
      assert.equal(r.tierShift, 0);
    }
  });

  test("the explanation names the clamp when one actually happened", () => {
    assert.match(resolveEdgesBanes(labels(3, "e"), labels(1, "b")).explanation, /clamped to 2 vs 1/);
    assert.doesNotMatch(resolveEdgesBanes(labels(2, "e"), labels(1, "b")).explanation, /clamped/);
  });
});
