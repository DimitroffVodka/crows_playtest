/**
 * Geometry and seeded randomness for the Village planner.
 *
 * Deliberately free of Foundry globals, like `village-map.mjs`, so the planner
 * can be unit-tested and previewed outside a running world.
 *
 * The RNG is stream-splittable and that is not a stylistic choice. The planner
 * is staged and any stage may be locked while others are re-rolled; if every
 * stage drew from one sequence, re-rolling the streets would consume a
 * different number of values and silently shift every later stage as a side
 * effect. `streamFor(seed, "streets")` makes a stage's output depend only on
 * (seed, stage, params), which is what makes "keep the walls, redraw the
 * houses" a coherent operation rather than a reroll of everything.
 */

/* -------------------------------------------- */
/*  Seeded randomness                           */
/* -------------------------------------------- */

/** cyrb128 — string to four well-mixed 32-bit integers. */
export function hashString(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** sfc32. Small and fast; period is ample for one map. */
export class Rng {
  constructor(seed) {
    const [a, b, c, d] = Array.isArray(seed) ? seed : hashString(String(seed));
    this.a = a >>> 0; this.b = b >>> 0; this.c = c >>> 0; this.d = d >>> 0;
    // sfc32 is weak in its first draws from a raw seed; discard them.
    for (let i = 0; i < 12; i++) this.float();
  }

  float() {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  range(min, max) { return min + this.float() * (max - min); }
  int(min, max) { return Math.floor(this.range(min, max + 1)); }
  chance(p) { return this.float() < p; }
  pick(arr) { return arr[Math.floor(this.float() * arr.length)]; }

  /** Symmetric jitter in [-amount, +amount]. */
  jitter(amount) { return this.range(-amount, amount); }

  /** Approximately normal, clamped so callers never see a wild tail. */
  gaussian(mean = 0, stddev = 1, min = -Infinity, max = Infinity) {
    let u = 0;
    while (u === 0) u = this.float();
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this.float());
    return Math.max(min, Math.min(max, mean + n * stddev));
  }

  weightedIndex(weights) {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return -1;
    let r = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** The independent stream for one planner stage. */
export function streamFor(seed, stage) {
  return new Rng(`crows-village/${seed}/${stage}`);
}

/* -------------------------------------------- */
/*  Vectors                                     */
/* -------------------------------------------- */

export const TAU = Math.PI * 2;

export const pt = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = a => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const perp = a => ({ x: -a.y, y: a.x });
export const angleOf = a => Math.atan2(a.y, a.x);
export const fromAngle = (r, m = 1) => ({ x: Math.cos(r) * m, y: Math.sin(r) * m });

export function norm(a) {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export function rotate(a, r, origin = { x: 0, y: 0 }) {
  const c = Math.cos(r), s = Math.sin(r);
  const d = sub(a, origin);
  return { x: origin.x + d.x * c - d.y * s, y: origin.y + d.x * s + d.y * c };
}

/* -------------------------------------------- */
/*  Polylines                                   */
/* -------------------------------------------- */

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  return total;
}

/** Even spacing along a polyline. Keeps the final vertex so ends stay put. */
export function resample(points, spacing) {
  if (points.length < 2 || spacing <= 0) return points.slice();
  const out = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    let segment = dist(a, b);
    if (segment < 1e-9) continue;
    let t = 0;
    while (carry + (segment - t) >= spacing) {
      t += spacing - carry;
      carry = 0;
      out.push(lerp(a, b, t / segment));
    }
    carry += segment - t;
  }
  const last = points[points.length - 1];
  if (dist(out[out.length - 1], last) > spacing * 0.25) out.push(last);
  return out;
}

/**
 * Chaikin corner-cutting. Open polylines keep their endpoints so a street that
 * starts at a gate still starts at the gate after smoothing.
 */
export function smooth(points, iterations = 2, closed = false) {
  let current = points.slice();
  for (let it = 0; it < iterations; it++) {
    if (current.length < 3) break;
    const next = [];
    if (!closed) next.push(current[0]);
    const limit = closed ? current.length : current.length - 1;
    for (let i = 0; i < limit; i++) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push(lerp(a, b, 0.25), lerp(a, b, 0.75));
    }
    if (!closed) next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Recursive midpoint displacement between two points. Produces the wandering
 * line that makes roads and rivers read as organic rather than drafted.
 */
export function wander(a, b, rng, { roughness = 0.28, depth = 4 } = {}) {
  let points = [a, b];
  let amplitude = dist(a, b) * roughness;
  for (let d = 0; d < depth; d++) {
    const next = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1], p1 = points[i];
      const mid = lerp(p0, p1, 0.5);
      const n = perp(norm(sub(p1, p0)));
      next.push(add(mid, scale(n, rng.jitter(amplitude))), p1);
    }
    points = next;
    amplitude *= 0.5;
  }
  return points;
}

/** Point at distance `d` along the polyline, with the local tangent. */
export function pointAtDistance(points, d) {
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const segment = dist(a, b);
    if (segment < 1e-9) continue;
    if (travelled + segment >= d) {
      const t = (d - travelled) / segment;
      return { point: lerp(a, b, t), tangent: norm(sub(b, a)), index: i };
    }
    travelled += segment;
  }
  const n = points.length;
  return {
    point: points[n - 1],
    tangent: n > 1 ? norm(sub(points[n - 1], points[n - 2])) : { x: 1, y: 0 },
    index: n - 1
  };
}

/* -------------------------------------------- */
/*  Polygons                                    */
/* -------------------------------------------- */

/** Signed area; positive when the ring winds counter-clockwise in screen space. */
export function signedArea(poly) {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    total += cross(a, b);
  }
  return total / 2;
}

export const polygonArea = poly => Math.abs(signedArea(poly));

export function centroid(poly) {
  let x = 0, y = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = cross(p, q);
    x += (p.x + q.x) * f;
    y += (p.y + q.y) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    // Degenerate ring: fall back to the vertex average so callers still get a point.
    return poly.reduce((acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }), { x: 0, y: 0 });
  }
  return { x: x / (3 * a), y: y / (3 * a) };
}

export function bounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** Ray casting. Points exactly on an edge are not guaranteed either way. */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    const straddles = (a.y > p.y) !== (b.y > p.y);
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, add(a, scale(ab, t)));
}

export function distToPolyline(p, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(p, points[i - 1], points[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Shortest distance from a point to a closed ring's edges. */
export function distToRing(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distToSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (d < best) best = d;
  }
  return best;
}

/** Proper segment intersection, or null. Collinear overlap counts as no hit. */
export function segmentIntersection(p1, p2, p3, p4) {
  const r = sub(p2, p1);
  const s = sub(p4, p3);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const t = cross(sub(p3, p1), s) / denom;
  const u = cross(sub(p3, p1), r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: add(p1, scale(r, t)), t, u };
}

/** Does an open polyline cross a closed ring? */
export function polylineCrossesRing(points, ring) {
  for (let i = 1; i < points.length; i++) {
    for (let j = 0; j < ring.length; j++) {
      if (segmentIntersection(points[i - 1], points[i], ring[j], ring[(j + 1) % ring.length])) return true;
    }
  }
  return false;
}

/**
 * Move every edge inward by `d` and re-intersect. Reliable for the convex-ish
 * rings the planner produces; heavily reflex rings can self-intersect, so
 * callers treat a collapsed result as "no room" rather than trusting it.
 */
export function offsetRing(poly, d) {
  const n = poly.length;
  if (n < 3) return [];
  const orientation = signedArea(poly) > 0 ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const dir = norm(sub(b, a));
    if (len(dir) < 1e-9) continue;
    const inward = scale(perp(dir), -orientation * d);
    lines.push({ a: add(a, inward), b: add(b, inward) });
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i], nxt = lines[(i + 1) % lines.length];
    const r = sub(cur.b, cur.a), s = sub(nxt.b, nxt.a);
    const denom = cross(r, s);
    if (Math.abs(denom) < 1e-9) { out.push(cur.b); continue; }
    const t = cross(sub(nxt.a, cur.a), s) / denom;
    out.push(add(cur.a, scale(r, t)));
  }
  return out;
}

/** Sutherland–Hodgman against one half-plane; keeps the side `normal` points to. */
export function clipToHalfPlane(poly, origin, normal) {
  const out = [];
  const side = p => dot(sub(p, origin), normal);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push(lerp(a, b, t));
    }
  }
  return out;
}

/** Split a ring by an infinite line into the two sides. Either may be empty. */
export function splitRing(poly, origin, direction) {
  const n = perp(norm(direction));
  return [clipToHalfPlane(poly, origin, n), clipToHalfPlane(poly, origin, scale(n, -1))];
}

/** Axis-aligned-then-rotated rectangle as a ring. */
export function rectRing(center, width, height, rotation = 0) {
  const hw = width / 2, hh = height / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }
  ].map(p => add(center, rotate(p, rotation)));
}

/** Separating-axis overlap test. Correct for convex rings only. */
export function convexRingsOverlap(p1, p2) {
  for (const poly of [p1, p2]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const axis = perp(norm(sub(b, a)));
      let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
      for (const p of p1) { const v = dot(p, axis); if (v < min1) min1 = v; if (v > max1) max1 = v; }
      for (const p of p2) { const v = dot(p, axis); if (v < min2) min2 = v; if (v > max2) max2 = v; }
      if (max1 < min2 || max2 < min1) return false;
    }
  }
  return true;
}

/** Is every vertex of `poly` inside `ring`? */
export function ringContainsRing(ring, poly) {
  return poly.every(p => pointInPolygon(p, ring));
}

/**
 * A closed irregular loop around `center`. `lobes` controls how many broad
 * bulges the outline has; `irregularity` how far each vertex strays. This is
 * the shape primitive behind both the ruin shell and the open village extent.
 */
export function noisyLoop(center, radius, rng, {
  points = 28,
  irregularity = 0.18,
  lobes = 3,
  lobeDepth = 0.14,
  squash = 1
} = {}) {
  const phase = rng.range(0, TAU);
  const ring = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * TAU;
    const lobe = 1 + Math.sin(a * lobes + phase) * lobeDepth;
    const noise = 1 + rng.jitter(irregularity);
    const r = radius * lobe * noise;
    ring.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r * squash });
  }
  // Smoothing a closed ring removes the vertex-to-vertex jaggedness that raw
  // per-vertex noise creates, leaving broad organic curves.
  return smooth(ring, 2, true);
}

/** Ribbon polygon for a polyline of constant width — used to fill streets. */
export function ribbon(points, width) {
  if (points.length < 2) return [];
  const half = width / 2;
  const left = [], right = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const n = perp(norm(sub(b, a)));
    left.push(add(points[i], scale(n, half)));
    right.push(add(points[i], scale(n, -half)));
  }
  return left.concat(right.reverse());
}

/** Round to a fixed precision so serialized plans diff cleanly. */
export const round = (n, places = 2) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export const roundPoint = (p, places = 2) => ({ x: round(p.x, places), y: round(p.y, places) });
export const roundRing = (poly, places = 2) => poly.map(p => roundPoint(p, places));
