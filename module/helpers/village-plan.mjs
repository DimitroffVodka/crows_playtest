/**
 * Procedural village plan.
 *
 * This module answers one question: *where does everything physically go?*  It
 * takes a normalized Village record plus explicit parameters and returns a
 * serializable spatial plan — boundary, streets, plots, and which plot each
 * institution occupies.  It writes nothing, reads no globals, and never touches
 * a Scene; `village-map.mjs` remains the only thing that talks to Foundry.
 *
 * ## Why a plan instead of a grid
 *
 * The previous placement put institutions on a fixed 3-column grid anchored at
 * a hashed point.  That is stable and testable, but it is a sprite sheet rather
 * than a settlement: nothing faces a street, nothing is near anything for a
 * reason, and there is no handle to say "put the smithy by the gate".  A plan
 * introduces the missing middle layer — streets and plots — so position becomes
 * a consequence of layout rather than of array index.
 *
 * ## Two forms, one pipeline
 *
 * C:2218 — "In Cornath every village is contained within a ruin. These
 * structures are enclosed, protecting the people within from the Miasma and the
 * monsters wandering the wilds."  A Cornath village is therefore *inward*: a
 * bounded shell with the settlement packed inside and no farmland sprawl.  That
 * is the opposite of the open rural form most village generators produce, so
 * the boundary stage is pluggable: `ruin` builds an enclosing shell with
 * breaches, `open` builds an unwalled extent with fields and water for
 * settlements outside Cornath's premise (C:2220 allows villages the party only
 * visits, and other games have no Miasma at all).  Every later stage consumes
 * whatever the boundary stage produced, so the two forms share all the
 * street, plot and assignment logic.
 *
 * ## Locking
 *
 * Each stage draws from its own RNG stream (see `village-plan-geom.mjs`), so a
 * stage can be regenerated without disturbing the others.  Passing a previous
 * plan plus `locks` reuses that plan's output for the locked stages.  Locks are
 * honoured downstream-only: locking `streets` while the boundary changes can
 * leave streets crossing a wall that moved, so `buildVillagePlan` re-validates
 * locked stages against their new upstream input and drops what no longer fits
 * rather than emitting a plan that is quietly wrong.
 */

import {
  TAU,
  add,
  angleOf,
  bounds,
  centroid,
  convexRingsOverlap,
  dist,
  distToPolyline,
  distToRing,
  distToSegment,
  dot,
  fromAngle,
  norm,
  noisyLoop,
  offsetRing,
  perp,
  pointAtDistance,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rectRing,
  roundPoint,
  roundRing,
  scale,
  smooth,
  streamFor,
  sub,
  wander
} from "./village-plan-geom.mjs";

export const VILLAGE_PLAN_VERSION = "village-plan-1";

/** The two spatial forms.  See the module header for why both exist. */
export const PLAN_FORMS = Object.freeze({ RUIN: "ruin", OPEN: "open" });

/** Stage order.  A lock on stage N is only meaningful with 1..N-1 also stable. */
export const PLAN_STAGES = Object.freeze(["boundary", "streets", "plots", "assignment", "dressing"]);

/**
 * Placement intent per institution.  These are *soft* preferences scored
 * against candidate plots, not hard rules — a village with three plots still
 * places six institutions, just less ideally.
 *
 * `centrality`  1 = wants the square, 0 = indifferent, -1 = wants the edge.
 * `gate`        pull toward the nearest breach/entry.
 * `frontage`    preference for a main street over a back lane.
 * `area`        desired plot area in square plan units.
 * `quiet`       preference for being away from other institutions.
 *
 * `area` values are calibrated against the plot sizes the generator actually
 * produces (roughly 40k–130k square units for the default plot config). Asking
 * for more than the largest possible plot makes the term unsatisfiable for
 * every candidate, which silently removes size from the decision entirely.
 */
export const INSTITUTION_PLACEMENT = Object.freeze({
  // C:2232 starting six first.
  blacksmith:   { centrality:  0.1, gate:  0.3, frontage: 0.8, area:  92000, quiet: 0.2 },
  crypt:        { centrality: -0.9, gate: -0.4, frontage: 0.1, area:  70000, quiet: 0.8 },
  generalStore: { centrality:  0.9, gate:  0.1, frontage: 1.0, area:  88000, quiet: 0.0 },
  inn:          { centrality:  0.8, gate:  0.4, frontage: 1.0, area: 110000, quiet: 0.0 },
  temple:       { centrality:  0.7, gate: -0.2, frontage: 0.6, area: 120000, quiet: 0.4 },
  // The remaining catalogue.
  alchemist:    { centrality:  0.2, gate: -0.2, frontage: 0.4, area:  64000, quiet: 0.7 },
  auctionHouse: { centrality:  0.8, gate:  0.2, frontage: 0.9, area: 100000, quiet: 0.0 },
  barracks:     { centrality: -0.3, gate:  0.9, frontage: 0.7, area: 115000, quiet: 0.3 },
  beacon:       { centrality: -0.8, gate:  0.0, frontage: 0.0, area:  45000, quiet: 0.9 },
  bookseller:   { centrality:  0.4, gate: -0.3, frontage: 0.5, area:  58000, quiet: 0.5 },
  enchanter:    { centrality:  0.0, gate: -0.5, frontage: 0.3, area:  68000, quiet: 0.8 },
  stables:      { centrality: -0.4, gate:  1.0, frontage: 0.6, area: 100000, quiet: 0.2 }
});

/** Fallback for an institution key the catalogue does not know. */
const DEFAULT_PLACEMENT = Object.freeze({ centrality: 0.2, gate: 0, frontage: 0.5, area: 80000, quiet: 0.3 });

/**
 * Plan-space defaults.  Matched to `SCENE_DEFAULTS` in `village-map.mjs` so a
 * plan can be projected onto a Scene without rescaling.
 */
export const PLAN_DEFAULTS = Object.freeze({
  width: 4800,
  height: 6600,
  form: PLAN_FORMS.RUIN,
  /**
   * Whether a village handed a previous plan may extend its street network into
   * unused ground to make room. Off means the layout is fixed and a village
   * that outgrows it simply reports the shortfall.
   */
  growth: true,
  /**
   * Fraction of the shorter axis the settlement fills. `null` sizes it from
   * how much the record actually needs to house; a number pins it.
   */
  extent: null,
  streets: Object.freeze({
    /**
     * Lane budget multiplier. `null` derives enough frontage for the record;
     * a number scales that budget (2 = twice as many lanes).
     */
    density: null,
    /**
     * 0 = drafted straight, 1 = heavily meandering. Past about 0.4 a street
     * stops reading as a road and starts reading as a watercourse.
     */
    wander: 0.26,
    /**
     * Widths are in plan units against a 300-unit grid square, so a main street
     * is roughly a third of a square. Much wider and roads dominate the map.
     */
    mainWidth: 110,
    laneWidth: 70,
    maxDepth: 2
  }),
  plots: Object.freeze({
    /**
     * Distance between plot slots along a street frontage. Kept above
     * `maxFrontage` or adjacent plots collide and one of the pair is dropped.
     */
    spacing: 400,
    /** Gap between the street edge and the building line. */
    setback: 55,
    minFrontage: 200,
    maxFrontage: 380,
    minDepth: 200,
    maxDepth: 340,
    /** 0 = every slot filled, 1 = very sparse. */
    gaps: 0.18,
    /**
     * Spare plots laid out beyond what the record currently needs, as a
     * fraction of demand.
     *
     * A village planned to fit exactly has nowhere to grow: founding an
     * institution then evicts a house, and rising Prosperity adds no homes at
     * all because every frontage is taken. Since growth reuses the existing
     * streets to keep buildings from moving, the room to grow has to be laid
     * out up front. Vacant plots are that room.
     */
    headroom: 0.6
  }),
  housing: Object.freeze({
    /** null = derive from Prosperity. */
    count: null,
    perProsperity: 2.2,
    base: 8,
    min: 3,
    max: 60
  }),
  ruin: Object.freeze({
    breaches: 2,
    wallThickness: 150,
    /** Collapsed interior masses that streets and plots must avoid. */
    rubble: 7,
    towers: 3
  }),
  open: Object.freeze({
    /** "none" | "river" | "stream" */
    water: "river",
    waterWidth: 210,
    fields: 14,
    orchards: 3,
    /** Whole fenced plots placed as art, distinct from the furrowed `fields`. */
    farmsteads: 3,
    trees: 260
  })
});

/* -------------------------------------------- */
/*  Parameters                                  */
/* -------------------------------------------- */

const isObject = v => v != null && typeof v === "object" && !Array.isArray(v);

/** Shallow-per-section merge; sections are small and flat by design. */
function mergeParams(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined) continue;
    out[key] = isObject(value) && isObject(base[key]) ? { ...base[key], ...value } : value;
  }
  return out;
}

export function defaultPlanParams(overrides = {}) {
  return mergeParams(PLAN_DEFAULTS, overrides);
}

/**
 * How many buildings this village has to accommodate.  Everything that scales
 * with village size is derived from this one number.
 */
export function demandFor(village, params) {
  const institutions = Array.isArray(village?.institutions) ? village.institutions.length : 0;
  return Math.max(1, institutions + housingCountFor(village, params));
}

/**
 * Fill in the parameters left as `null`, sizing the settlement to its record.
 *
 * Fixed constants make a thriving village and a struggling one the same size,
 * so a Prosperity-9 settlement ends up with nowhere to put two thirds of its
 * buildings.  Deriving extent and lane budget from demand keeps the map honest
 * about what the village *is*, while an explicit value still overrides — the
 * point is a sensible default, not a removed choice.
 */
export function resolveAutoParams(village, params, previous = null) {
  const demand = demandFor(village, params);
  const resolved = { ...params, streets: { ...params.streets } };
  // Headroom has to buy ground, not lanes. Streets need a plot-depth of
  // clearance from each other, so packing extra lanes into the same shell makes
  // them crowd and yields *fewer* usable frontages, not more. Planning for a
  // larger village is what actually creates spare plots.
  const planningDemand = demand * (1 + Math.max(0, resolved.plots?.headroom ?? 0));

  if (resolved.extent == null) {
    // A village that founds an institution does not move its walls. When a
    // previous plan exists, inherit its footprint so the settlement grows into
    // the ground it already has instead of being resized — and with it, every
    // street and plot redrawn underneath the buildings already standing.
    const inherited = Number(previous?.params?.extent);
    resolved.extent = Number.isFinite(inherited)
      ? inherited
      : Math.max(0.45, Math.min(0.96, 0.44 + 0.075 * Math.sqrt(planningDemand)));
  }
  if (resolved.streets.density == null) {
    const inherited = Number(previous?.params?.streets?.density);
    resolved.streets.density = Number.isFinite(inherited) ? inherited : 1;
  }
  resolved.demand = demand;
  resolved.planningDemand = planningDemand;
  return resolved;
}

/**
 * Housing count.  Prosperity is the village's economic health (C:2254), so it
 * is the natural driver of how many homes stand, but an explicit count always
 * wins — a Ref who wants nine houses gets nine houses.
 */
export function housingCountFor(village, params) {
  const housing = params.housing ?? PLAN_DEFAULTS.housing;
  if (Number.isFinite(housing.count)) return Math.max(0, Math.floor(housing.count));
  const prosperity = Number(village?.prosperity ?? 0);
  const raw = housing.base + prosperity * housing.perProsperity;
  return Math.max(housing.min, Math.min(housing.max, Math.round(raw)));
}

/* -------------------------------------------- */
/*  Stage 1 — boundary                          */
/* -------------------------------------------- */

/**
 * The settlement shell plus its entries.  `interior` is the usable ring that
 * every later stage clips against; for the ruin form it is inset by the wall
 * thickness so buildings sit inside the structure rather than on top of it.
 */
function planBoundary(village, params, rng) {
  const width = params.width;
  const height = params.height;
  const center = {
    x: width / 2 + rng.jitter(width * 0.03),
    y: height / 2 + rng.jitter(height * 0.03)
  };
  const radius = (Math.min(width, height) / 2) * params.extent;
  const ruin = params.form === PLAN_FORMS.RUIN;

  // A ruin shell is a built structure: fewer, broader lobes and less vertex
  // noise than an organically-grown open village outline.
  const ring = noisyLoop(center, radius, rng, {
    points: ruin ? 26 : 34,
    irregularity: ruin ? 0.09 : 0.2,
    lobes: ruin ? 4 : 3,
    lobeDepth: ruin ? 0.1 : 0.17,
    squash: height > width ? 1.18 : 0.86
  });

  const wallThickness = ruin ? params.ruin.wallThickness : 0;
  let interior = ruin ? offsetRing(ring, wallThickness * 1.5) : ring;
  // offsetRing can fold a reflex ring inside out; a collapsed result means the
  // inset was too aggressive, so fall back to the untouched ring.
  if (interior.length < 3 || polygonArea(interior) < polygonArea(ring) * 0.25) interior = ring;

  const gates = planGates(ring, center, params, rng);

  const boundary = {
    form: params.form,
    center: roundPoint(center),
    radius: Math.round(radius),
    ring: roundRing(ring),
    interior: roundRing(interior),
    gates,
    wallThickness
  };

  if (ruin) {
    boundary.towers = planTowers(ring, gates, params, rng);
    boundary.rubble = planRubble(interior, center, params, rng);
  } else {
    boundary.water = planWater(params, center, rng);
  }
  return boundary;
}

/**
 * Entries.  For a ruin these are breaches in the shell — the only ways in, and
 * therefore what the street spine must connect.  For an open village they are
 * simply where the road crosses the village extent.
 */
function planGates(ring, center, params, rng) {
  const ruin = params.form === PLAN_FORMS.RUIN;
  const count = Math.max(1, Math.floor(ruin ? params.ruin.breaches : 2));
  const gates = [];
  // Spread entries around the ring rather than clustering them, then jitter,
  // so a two-gate village reads as a road passing through.
  const base = rng.range(0, TAU);
  for (let i = 0; i < count; i++) {
    const angle = base + (i / count) * TAU + rng.jitter(0.35);
    const dir = fromAngle(angle);
    const point = rayToRing(center, dir, ring);
    if (!point) continue;
    gates.push({
      id: `gate-${i}`,
      kind: ruin ? "breach" : "road",
      point: roundPoint(point),
      angle: Number(angle.toFixed(4)),
      width: Math.round(ruin ? rng.range(220, 420) : params.streets.mainWidth * 1.6)
    });
  }
  return gates;
}

/** March outward from `origin` until the ring is crossed. */
function rayToRing(origin, dir, ring) {
  const far = add(origin, scale(dir, 1e5));
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const hit = segmentHit(origin, far, a, b);
    if (hit) {
      const d = dist(origin, hit);
      if (d < bestDist) { bestDist = d; best = hit; }
    }
  }
  return best;
}

function segmentHit(p1, p2, p3, p4) {
  const r = sub(p2, p1), s = sub(p4, p3);
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * s.y - (p3.y - p1.y) * s.x) / denom;
  const u = ((p3.x - p1.x) * r.y - (p3.y - p1.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p1.x + r.x * t, y: p1.y + r.y * t };
}

/** Towers sit on the shell itself, spaced away from breaches. */
function planTowers(ring, gates, params, rng) {
  const count = Math.max(0, Math.floor(params.ruin.towers));
  const towers = [];
  let attempts = 0;
  while (towers.length < count && attempts++ < count * 12) {
    const p = ring[rng.int(0, ring.length - 1)];
    const clearOfGates = gates.every(g => dist(p, g.point) > g.width * 1.4);
    const clearOfTowers = towers.every(t => dist(p, t.point) > 420);
    if (clearOfGates && clearOfTowers) {
      towers.push({ point: roundPoint(p), radius: Math.round(rng.range(85, 135)) });
    }
  }
  return towers;
}

/**
 * Collapsed masses inside the shell.  These are obstacles, not decoration:
 * streets route around them and plots reject against them, which is what makes
 * a ruin village feel threaded through a structure rather than dropped into a
 * circle.
 */
function planRubble(interior, center, params, rng) {
  const count = Math.max(0, Math.floor(params.ruin.rubble));
  const masses = [];
  const area = polygonArea(interior);
  const radius = Math.sqrt(area / Math.PI);
  let attempts = 0;
  while (masses.length < count && attempts++ < count * 20) {
    const angle = rng.range(0, TAU);
    // Bias outward: the middle of the shell is where people actually live.
    const t = Math.sqrt(rng.range(0.15, 1));
    const p = add(center, fromAngle(angle, radius * t * 0.92));
    if (!pointInPolygon(p, interior)) continue;
    const size = rng.range(140, 330);
    if (masses.some(m => dist(m.center, p) < (m.radius + size) * 1.05)) continue;
    masses.push({
      center: roundPoint(p),
      radius: Math.round(size),
      ring: roundRing(noisyLoop(p, size, rng, { points: 12, irregularity: 0.3, lobes: 2, lobeDepth: 0.25 }))
    });
  }
  return masses;
}

/** Optional watercourse for the open form; crosses the map edge to edge. */
function planWater(params, center, rng) {
  const kind = params.open?.water ?? "none";
  if (kind === "none") return null;
  const width = kind === "stream" ? params.open.waterWidth * 0.45 : params.open.waterWidth;
  const angle = rng.range(0, TAU);
  const span = Math.max(params.width, params.height) * 1.2;
  const a = add(center, fromAngle(angle, span / 2));
  const b = add(center, fromAngle(angle + Math.PI, span / 2));
  // Offset the course so it rarely bisects the village centre exactly.
  const offset = scale(perp(norm(sub(b, a))), rng.range(-1, 1) * params.width * 0.22);
  const path = smooth(wander(add(a, offset), add(b, offset), rng, { roughness: 0.14, depth: 5 }), 2);
  return { kind, width: Math.round(width), path: roundRing(path) };
}

/* -------------------------------------------- */
/*  Stage 2 — streets                           */
/* -------------------------------------------- */

/**
 * The street network.  Villages read as roads with houses on them, not as
 * buildings with gaps between, so streets are generated first and everything
 * built afterwards hangs off them.
 */
function planStreets(village, boundary, params, rng) {
  const interior = boundary.interior;
  const center = boundary.center;
  const cfg = params.streets;
  const roughness = 0.06 + cfg.wander * 0.22;

  // The square: the open heart the spine passes through.
  const squareCenter = add(center, {
    x: rng.jitter(boundary.radius * 0.22),
    y: rng.jitter(boundary.radius * 0.22)
  });
  const squareRadius = boundary.radius * rng.range(0.11, 0.17);
  const square = roundRing(noisyLoop(squareCenter, squareRadius, rng, {
    points: 14, irregularity: 0.14, lobes: 2, lobeDepth: 0.12
  }));

  const streets = [];
  const gates = boundary.gates.length ? boundary.gates : [{ point: interior[0], id: "gate-0" }];

  // Spine: gate -> square -> gate.  With one gate it dead-ends at the square,
  // which is the "isolated" shape — the only way in is the way you came.
  const first = gates[0];
  const second = gates.length > 1 ? gates[1] : null;
  const spinePoints = [
    ...wander(first.point, squareCenter, rng, { roughness, depth: 4 }),
    ...(second ? wander(squareCenter, second.point, rng, { roughness, depth: 4 }).slice(1) : [])
  ];
  streets.push(makeStreet("spine-0", "spine", smooth(spinePoints, 2), cfg.mainWidth, 0));

  // Any further gates get their own spur into the square.
  for (let i = 2; i < gates.length; i++) {
    const points = smooth(wander(gates[i].point, squareCenter, rng, { roughness, depth: 4 }), 2);
    streets.push(makeStreet(`spine-${i - 1}`, "spine", points, cfg.mainWidth * 0.85, 0));
  }

  // Lanes branch off existing streets and stop at the shell.
  //
  // Branch spacing is the constraint that matters: every junction sterilises
  // the frontage around it, so a spine with a lane every few hundred units has
  // nowhere left to put houses. Lanes are therefore both few and *stratified* —
  // each branch owns a band of its parent — because purely random offsets
  // cluster, which produces the same starved frontage in a different place.
  const obstacles = boundary.rubble ?? [];
  const spineLength = polylineLength(streets[0].points);

  // Budget lanes by the frontage the record needs rather than by spine length
  // alone. Each unit of street yields roughly two plot slots per `spacing`,
  // discounted by the gap rate and by how many candidates get rejected against
  // the shell, the rubble and each other — measured at about 40% survival.
  const plotsPerUnit = (2 / params.plots.spacing) * (1 - params.plots.gaps) * 0.4;
  const neededLength = (params.planningDemand ?? params.demand) / Math.max(1e-6, plotsPerUnit);
  const laneBudget = Math.max(0, neededLength - spineLength);
  const target = Math.max(2, Math.min(26, Math.round((laneBudget / 1100) * cfg.density)));
  let depthQueue = streets.slice();
  for (let depth = 0; depth < Math.max(0, cfg.maxDepth); depth++) {
    const next = [];
    for (const parent of depthQueue) {
      const branches = depth === 0
        ? Math.max(1, Math.round(target / Math.max(1, depthQueue.length)))
        : (rng.chance(0.5) ? 1 : 0);
      for (let b = 0; b < branches; b++) {
        const lo = 0.15 + (b / branches) * 0.7;
        const hi = 0.15 + ((b + 1) / branches) * 0.7;
        // Alternate sides so a parent grows a spread rather than a comb.
        const side = b % 2 === 0 ? 1 : -1;
        const lane = growLane(parent, { interior, center, obstacles, params, rng, depth, streets, band: [lo, hi], side });
        if (lane) { streets.push(lane); next.push(lane); }
      }
    }
    depthQueue = next;
    if (!depthQueue.length) break;
  }

  return {
    square: { center: roundPoint(squareCenter), radius: Math.round(squareRadius), ring: square },
    streets,
    spineId: "spine-0",
    bridges: planBridges(streets, boundary.water)
  };
}

/**
 * Where streets cross water, there is a bridge.
 *
 * Found after the fact rather than by routing streets toward fords: a village
 * grows around its crossings, and detecting them keeps the street stage
 * independent of whether this form has water at all.  Crossings are deduped by
 * proximity so a street that clips the bank twice yields one bridge.
 */
function planBridges(streets, water) {
  if (!water?.path?.length) return [];
  const bridges = [];
  for (const street of streets) {
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1], b = street.points[i];
      for (let j = 1; j < water.path.length; j++) {
        const hit = segmentHit(a, b, water.path[j - 1], water.path[j]);
        if (!hit) continue;
        if (bridges.some(existing => dist(existing.point, hit) < water.width * 1.2)) continue;
        bridges.push({
          streetId: street.id,
          point: roundPoint(hit),
          // Aligned to the street, so the deck spans across the current.
          angle: Number(angleOf(sub(b, a)).toFixed(4)),
          length: Math.round(water.width * 1.5),
          width: Math.round(street.width * 1.35)
        });
      }
    }
  }
  return bridges;
}

function makeStreet(id, kind, points, width, depth) {
  return {
    id,
    kind,
    depth,
    width: Math.round(width),
    points: roundRing(points),
    length: Math.round(polylineLength(points))
  };
}

/**
 * Grow one lane off a parent street.  Returns null when the lane would be too
 * short to be worth drawing, which is the normal outcome near the shell.
 */
function growLane(parent, {
  interior, center, obstacles, params, rng, depth, streets,
  band = [0.18, 0.82], side = 0, startAt = null, toward = null
}) {
  const cfg = params.streets;
  const length = polylineLength(parent.points);
  if (length < 400) return null;

  // Start inside this branch's band, away from the parent's ends so junctions
  // read as junctions rather than as continuations. Growth into a known empty
  // pocket supplies its own start instead.
  const at = startAt == null
    ? rng.range(length * band[0], length * band[1])
    : Math.max(length * 0.08, Math.min(length * 0.92, startAt));
  const { point: origin, tangent } = pointAtDistance(parent.points, at);

  let dir;
  let reach;
  if (toward) {
    // Head for the pocket, but leave the parent square-on so the junction reads
    // as a junction rather than as a lane peeling off at a glancing angle.
    const straight = norm(sub(toward, origin));
    const chosen = dot(straight, perp(tangent)) >= 0 ? 1 : -1;
    dir = norm(add(scale(perp(tangent), chosen * 0.55), scale(straight, 1)));
    reach = dist(origin, toward) * rng.range(1.05, 1.35);
  } else {
    const chosenSide = side || (rng.chance(0.5) ? 1 : -1);
    const outward = scale(perp(tangent), chosenSide);
    // Lean lanes away from the centre so they reach unbuilt ground.
    const away = norm(sub(origin, center));
    dir = norm(add(scale(outward, 1), scale(away, rng.range(0.1, 0.5))));
    reach = (depth === 0 ? rng.range(0.45, 0.95) : rng.range(0.3, 0.6)) * Math.hypot(
      bounds(interior).width, bounds(interior).height
    ) * 0.32;
  }
  const rawEnd = add(origin, scale(dir, reach));
  const roughness = 0.08 + cfg.wander * 0.3;
  let points = smooth(wander(origin, rawEnd, rng, { roughness, depth: 3 }), 2);

  points = truncateToInterior(points, interior);
  points = truncateAtObstacles(points, obstacles);
  // Two streets need a band wide enough for a plot on each facing side, or the
  // frontage between them is sterile and the lane earns nothing. Derive that
  // from the plot dimensions rather than picking a number, so changing plot
  // depth keeps the network consistent with it.
  const separation = (params.plots.setback + params.plots.minDepth) * 1.18;
  // The guard cannot engage before the lane has had room to reach that
  // separation, or every lane is cut the moment it starts for being adjacent to
  // the parent it branches from — the clear run must exceed what the guard
  // demands, not merely clear the parent's kerb.
  const clearRun = separation + parent.width / 2 + cfg.laneWidth;
  points = truncateNearStreets(points, streets, parent, clearRun, separation);

  if (polylineLength(points) < 260) return null;
  const width = cfg.laneWidth * (depth === 0 ? 1 : 0.82);
  return makeStreet(`lane-${streets.length}`, depth === 0 ? "lane" : "alley", points, width, depth + 1);
}

/** Cut a polyline at the first vertex outside the usable ring. */
function truncateToInterior(points, interior) {
  const out = [];
  for (const p of points) {
    if (!pointInPolygon(p, interior)) break;
    out.push(p);
  }
  return out.length >= 2 ? out : points.slice(0, 2);
}

/** Stop a lane before it runs into collapsed masonry. */
function truncateAtObstacles(points, obstacles) {
  if (!obstacles?.length) return points;
  const out = [];
  for (const p of points) {
    if (obstacles.some(m => dist(p, m.center) < m.radius * 1.15)) break;
    out.push(p);
  }
  return out.length >= 2 ? out : points.slice(0, 2);
}

/**
 * Stop a lane just short of an existing street.  Without this, lanes run
 * alongside their neighbours and the network reads as noise instead of as a
 * set of distinct routes.
 *
 * The exclusion has to be measured in *distance travelled*, not in vertex
 * count: a lane begins on its parent by definition, and after smoothing the
 * first several vertices span almost no ground, so an index-based skip cuts
 * every lane off at birth for being adjacent to the street it branches from.
 */
function truncateNearStreets(points, streets, parent, clearRun, separation) {
  const others = streets.filter(s => s.id !== parent.id);
  const out = [points[0]];
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    travelled += dist(points[i - 1], points[i]);
    const guarded = travelled > clearRun;
    const tooClose = s => distToPolyline(points[i], s.points) < s.width / 2 + separation;
    if (guarded && (others.some(tooClose) || tooClose(parent))) break;
    out.push(points[i]);
  }
  return out.length >= 2 ? out : points.slice(0, 2);
}

/* -------------------------------------------- */
/*  Stage 3 — plots                             */
/* -------------------------------------------- */

/**
 * Building plots along street frontages.  Every plot is a rectangle squared to
 * its street, which is why buildings end up facing the road: the frontage
 * vector is the street tangent, not an arbitrary angle.
 */
function planPlots(boundary, streetPlan, params, rng) {
  const cfg = params.plots;
  const interior = boundary.interior;
  const obstacles = boundary.rubble ?? [];
  const square = streetPlan.square;
  const plots = [];
  // Why slots were dropped. Reported on the plan so a Ref tuning density can
  // see whether they are short of streets or short of room, rather than being
  // told only that the village came out sparse.
  const rejected = { gap: 0, interior: 0, square: 0, rubble: 0, ownStreet: 0, otherStreet: 0, plot: 0 };

  for (const street of streetPlan.streets) {
    plotsAlongStreet(street, {
      boundary, streets: streetPlan.streets, square, interior, obstacles, params, rng, plots, rejected
    });
  }
  return { plots, rejected };
}

/**
 * Lay plots along one street's frontage, appending to `plots`.
 *
 * Split out of `planPlots` so additive growth can lay plots along a newly grown
 * lane using exactly the same rules — including rejection against every street
 * and plot already standing. A second implementation would drift from this one
 * and start producing buildings in the road.
 */
function plotsAlongStreet(street, { boundary, streets, square, interior, obstacles, params, rng, plots, rejected }) {
  const cfg = params.plots;
  const length = polylineLength(street.points);
  const spacing = cfg.spacing * (street.kind === "spine" ? 1.05 : 0.92);
  const slots = Math.floor(length / spacing);

  for (let i = 0; i < slots; i++) {
    for (const side of [1, -1]) {
      if (rng.chance(cfg.gaps)) { rejected.gap++; continue; }

      const at = (i + 0.5) * spacing + rng.jitter(spacing * 0.16);
      const { point, tangent } = pointAtDistance(street.points, at);
      const normal = scale(perp(tangent), side);

      const frontage = rng.range(cfg.minFrontage, cfg.maxFrontage);
      const depth = rng.range(cfg.minDepth, cfg.maxDepth);
      const offset = street.width / 2 + cfg.setback + depth / 2;
      const centerPoint = add(point, scale(normal, offset));
      const angle = angleOf(tangent);
      const ring = rectRing(centerPoint, frontage, depth, angle);

      const reason = plotRejection(ring, { interior, obstacles, square, streets, plots, owner: street });
      if (reason) { rejected[reason]++; continue; }

      plots.push({
        // Numbered from the running total so growth never reuses an id that an
        // existing building is already assigned to.
        id: `plot-${plots.length}`,
        streetId: street.id,
        streetKind: street.kind,
        side,
        along: Math.round(at),
        center: roundPoint(centerPoint),
        angle: Number(angle.toFixed(4)),
        frontage: Math.round(frontage),
        depth: Math.round(depth),
        area: Math.round(frontage * depth),
        ring: roundRing(ring),
        // Cached because assignment scores every institution against every
        // plot; recomputing these in the inner loop is the hot path.
        distToCenter: Math.round(dist(centerPoint, boundary.center)),
        distToGate: boundary.gates.length
          ? Math.round(Math.min(...boundary.gates.map(g => dist(centerPoint, g.point))))
          : 0,
        distToSquare: Math.round(dist(centerPoint, square.center)),
        use: null
      });
    }
  }
}

/** The first reason this plot cannot stand, or null if it fits. */
function plotRejection(ring, { interior, obstacles, square, streets, plots, owner }) {
  if (!ring.every(p => pointInPolygon(p, interior))) return "interior";
  const c = centroid(ring);
  if (dist(c, square.center) < square.radius * 1.15) return "square";
  if (obstacles.some(m => dist(c, m.center) < m.radius + 90)) return "rubble";
  if (!clearsStreet(ring, owner, OWN_STREET_MARGIN)) return "ownStreet";
  if (streets.some(s => s.id !== owner.id && !clearsStreet(ring, s, OTHER_STREET_MARGIN))) return "otherStreet";
  // Plots are rectangles, so SAT is valid here — unlike against a street.
  if (plots.some(p => convexRingsOverlap(ring, p.ring))) return "plot";
  return null;
}

/**
 * A plot is *constructed* by offsetting from its own street, so it can only
 * approach that street through curvature: on the inside of a bend the far
 * corners of a wide frontage cut toward the centre-line. A few units of that is
 * invisible at map scale, so the owning street is held to a bare margin while
 * unrelated streets keep a real one.
 */
const OWN_STREET_MARGIN = 2;
const OTHER_STREET_MARGIN = 14;

/**
 * Does this plot keep clear of a street?
 *
 * Measured as distance to the street's centre-line rather than as an overlap
 * test against its ribbon polygon: a ribbon following a winding street is
 * strongly non-convex, and the separating-axis test is only valid for convex
 * shapes, so testing against one silently rejects every plot inside the
 * ribbon's convex hull — which for a curved street is most of the village.
 */
function clearsStreet(ring, street, margin) {
  const clearance = street.width / 2 + margin;
  if (ring.some(p => distToPolyline(p, street.points) < clearance)) return false;
  // A plot could also swallow a street end whose vertices are all interior to
  // the rectangle, which the vertex-distance test alone would miss.
  return !street.points.some(p => pointInPolygon(p, ring));
}

/* -------------------------------------------- */
/*  Additive growth                             */
/* -------------------------------------------- */

/**
 * Extend an existing network into unused ground, without touching what is
 * already there.
 *
 * A Cornath village cannot spread outward — it is enclosed by its ruin
 * (C:2218) — so growth means threading new lanes through the ground inside the
 * shell that nothing has claimed yet. New lanes are grown with the same
 * `growLane` used at planning time and are separation-tested against *every*
 * existing street, so they thread between what is built rather than over it.
 *
 * The alternative — re-planning at a larger extent — produces more room but
 * relocates every building already standing, which is precisely what the growth
 * workflow exists to avoid.
 *
 * Existing streets and plots are never modified; the caller appends what comes
 * back. When nothing more can be grown the village is genuinely full, and the
 * shortfall is reported rather than hidden.
 */
function growNetwork({ boundary, streetPlan, plots, params, rng, target }) {
  const interior = boundary.interior;
  const center = boundary.center;
  const obstacles = boundary.rubble ?? [];
  const square = streetPlan.square;
  const streets = streetPlan.streets.slice();
  const grown = [];
  const rejected = { gap: 0, interior: 0, square: 0, rubble: 0, ownStreet: 0, otherStreet: 0, plot: 0 };

  const maxLanes = 16;
  // A lane that houses nobody is clutter, not a street. Growth keeps only lanes
  // that actually earn frontage.
  let barren = 0;

  // Growth is aimed, not random. Branching off an arbitrary street in a village
  // that is already dense mostly produces lanes with no room beside them, so
  // the open ground is measured first and each lane is run from the nearest
  // street toward the emptiest pocket left.
  const pockets = findEmptyGround({ boundary, streets, plots, square, params, rng });

  for (const pocket of pockets) {
    if (plots.length >= target || grown.length >= maxLanes) break;
    const anchor = nearestPointOnNetwork(streets, pocket);
    if (!anchor) continue;
    const lane = growLane(anchor.street, {
      interior,
      center,
      obstacles,
      params,
      rng,
      depth: anchor.street.kind === "spine" ? 0 : 1,
      streets,
      startAt: anchor.at,
      toward: pocket
    });
    if (!lane) {
      barren++;
      continue;
    }
    // Provisionally part of the network, so its own plots are tested against it.
    streets.push(lane);
    const before = plots.length;
    plotsAlongStreet(lane, {
      boundary, streets, square, interior, obstacles, params, rng, plots, rejected
    });
    if (plots.length === before) {
      streets.pop();
      barren++;
      continue;
    }
    grown.push(lane);
  }
  return { streets: grown, rejected, barren };
}

/**
 * Sample the ground inside the shell for pockets nothing has claimed.
 *
 * A pocket has to be far enough from every street and plot that a new lane
 * could legally sit there — the same separation the planner enforces — or
 * growth aims at gaps too tight to build in and every lane it grows is thrown
 * away. Returned emptiest-first.
 */
function findEmptyGround({ boundary, streets, plots, square, params, rng, limit = 20 }) {
  const interior = boundary.interior;
  const obstacles = boundary.rubble ?? [];
  const separation = (params.plots.setback + params.plots.minDepth) * 1.18;
  const b = bounds(interior);
  const step = params.plots.spacing * 0.75;
  const found = [];

  for (let x = b.minX; x <= b.maxX; x += step) {
    for (let y = b.minY; y <= b.maxY; y += step) {
      const p = { x: x + rng.jitter(step * 0.25), y: y + rng.jitter(step * 0.25) };
      if (!pointInPolygon(p, interior)) continue;
      if (dist(p, square.center) < square.radius * 1.4) continue;
      if (obstacles.some(m => dist(p, m.center) < m.radius + 120)) continue;

      let toStreet = Infinity;
      for (const s of streets) {
        const d = distToPolyline(p, s.points);
        if (d < toStreet) toStreet = d;
      }
      if (toStreet < separation) continue;

      let toPlot = Infinity;
      for (const plot of plots) {
        const d = dist(p, plot.center);
        if (d < toPlot) toPlot = d;
      }
      if (toPlot < params.plots.spacing * 0.85) continue;

      found.push({ p, score: Math.min(toStreet, toPlot) });
    }
  }
  found.sort((a, b2) => b2.score - a.score);
  return found.slice(0, limit).map(f => f.p);
}

/** The nearest point on the existing network to `target`, as street + distance along it. */
function nearestPointOnNetwork(streets, target) {
  let best = null;
  for (const street of streets) {
    let travelled = 0;
    for (let i = 1; i < street.points.length; i++) {
      const a = street.points[i - 1], b = street.points[i];
      const segLength = dist(a, b);
      const d = distToSegment(target, a, b);
      if (!best || d < best.distance) {
        best = { street, at: travelled + segLength / 2, distance: d };
      }
      travelled += segLength;
    }
  }
  return best;
}

/* -------------------------------------------- */
/*  Stage 4 — assignment                        */
/* -------------------------------------------- */

/**
 * Give every institution a plot, then fill the rest with housing.
 *
 * Institutions are placed before housing and in descending order of how *picky*
 * they are, so the crypt gets its lonely edge plot before generic houses eat
 * the periphery.  Scoring is soft: a village whose plots are all central still
 * places the crypt, just on the least central plot available.
 */
function planAssignment(village, boundary, streetPlan, plots, params, rng, previous = null) {
  const institutions = normalizeInstitutions(village);
  const scale = spatialScale(boundary);
  const available = plots.filter(p => p.use === null);
  const assignments = [];
  const taken = new Set();
  const plotById = new Map(plots.map(p => [p.id, p]));

  // Anything already standing keeps its ground.
  //
  // Without this, founding one institution re-runs the whole greedy assignment
  // and every existing building can end up somewhere else — the village is not
  // growing, it is being rebuilt from scratch each time. A Ref adding a beacon
  // expects a beacon to appear, not the smithy to move across town.
  const priorPlacements = new Map(
    (previous?.assignment?.institutions ?? []).map(a => [a.institutionId, a])
  );
  const pending = [];
  for (const institution of institutions) {
    const prior = priorPlacements.get(institution.id);
    const plot = prior ? plotById.get(prior.plotId) : null;
    if (!plot || plot.use !== null || taken.has(plot.id)) { pending.push(institution); continue; }
    taken.add(plot.id);
    claimPlot(plot, institution);
    assignments.push(placementOf(institution, plot, prior.score ?? 0));
  }

  // Pickiest first: a strong preference is worth satisfying while choice remains.
  const ordered = pending.sort((a, b) => pickiness(b) - pickiness(a));

  for (const institution of ordered) {
    const wants = INSTITUTION_PLACEMENT[institution.type] ?? DEFAULT_PLACEMENT;
    let best = null;
    let bestScore = -Infinity;
    for (const plot of available) {
      if (taken.has(plot.id)) continue;
      const score = scorePlot(plot, wants, { scale, assignments, plots });
      if (score > bestScore) { bestScore = score; best = plot; }
    }
    if (!best) break;
    taken.add(best.id);
    claimPlot(best, institution);
    assignments.push(placementOf(institution, best, Number(bestScore.toFixed(3))));
  }

  // Housing takes what is left, preferring plots near the heart so the village
  // reads as inhabited rather than as a ring of houses around empty ground.
  // Existing homes are kept for the same reason institutions are.
  const housingTarget = housingCountFor(village, params);
  const housing = [];
  for (const prior of previous?.assignment?.housing ?? []) {
    if (housing.length >= housingTarget) break;
    const plot = plotById.get(prior.plotId);
    if (!plot || plot.use !== null || taken.has(plot.id)) continue;
    taken.add(plot.id);
    plot.use = "housing";
    housing.push({ plotId: plot.id, center: plot.center, angle: plot.angle });
  }
  const remaining = available
    .filter(p => !taken.has(p.id) && p.use === null)
    .sort((a, b) => a.distToSquare - b.distToSquare);
  for (const plot of remaining) {
    if (housing.length >= housingTarget) break;
    plot.use = "housing";
    housing.push({ plotId: plot.id, center: plot.center, angle: plot.angle });
  }
  for (const plot of plots) if (plot.use === null) plot.use = "vacant";

  return {
    institutions: assignments,
    housing,
    housingTarget,
    /** Honest reporting: the plan could not satisfy the record. */
    unplacedInstitutions: institutions.length - assignments.length,
    unbuiltHousing: Math.max(0, housingTarget - housing.length)
  };
}

/** Mark a plot as an institution's, carrying what the renderer needs. */
function claimPlot(plot, institution) {
  plot.use = "institution";
  plot.institutionId = institution.id;
  plot.institutionType = institution.type;
  // Carried onto the plot so a renderer can choose the building's form from
  // the record alone, without re-joining plots back to the assignment list.
  plot.institutionLevel = institution.level;
  plot.destroyed = institution.destroyed;
  plot.steward = institution.steward;
}

function placementOf(institution, plot, score) {
  return {
    institutionId: institution.id,
    type: institution.type,
    level: institution.level,
    steward: institution.steward,
    destroyed: institution.destroyed,
    plotId: plot.id,
    center: plot.center,
    angle: plot.angle,
    score
  };
}

/** How strongly this institution cares where it lands. */
function pickiness(institution) {
  const w = INSTITUTION_PLACEMENT[institution.type] ?? DEFAULT_PLACEMENT;
  return Math.abs(w.centrality) + Math.abs(w.gate) + w.quiet;
}

/** Characteristic distance, so scoring is resolution-independent. */
function spatialScale(boundary) {
  return Math.max(1, boundary.radius);
}

function scorePlot(plot, wants, { scale, assignments, plots }) {
  // Normalize each cached distance to 0..1 across the settlement.
  const centrality = 1 - Math.min(1, plot.distToSquare / scale);
  const gateNearness = 1 - Math.min(1, plot.distToGate / scale);
  const frontage = plot.streetKind === "spine" ? 1 : plot.streetKind === "lane" ? 0.55 : 0.2;

  let score = 0;
  score += wants.centrality * centrality * 2.0;
  score += wants.gate * gateNearness * 1.4;
  score += wants.frontage * frontage * 1.2;

  // Area fit: penalise plots much smaller than wanted far harder than larger
  // ones, because an undersized plot cannot hold the building at all.
  const ratio = plot.area / wants.area;
  score += ratio >= 1 ? Math.min(0.6, (ratio - 1) * 0.3) : -(1 - ratio) * 2.2;

  if (wants.quiet > 0 && assignments.length) {
    const nearest = Math.min(...assignments.map(a => {
      const other = plots.find(p => p.id === a.plotId);
      return other ? dist(plot.center, other.center) : Infinity;
    }));
    score += wants.quiet * Math.min(1, nearest / (scale * 0.5)) * 1.1;
  }
  return score;
}

/**
 * Reduce the Village record to what placement needs.  Destroyed institutions
 * still occupy ground — a burnt-out crypt is a ruin on the map, not an absence
 * — so they are placed and flagged rather than filtered out.
 */
function normalizeInstitutions(village) {
  const list = Array.isArray(village?.institutions) ? village.institutions : [];
  return list.map((inst, index) => ({
    id: String(inst?.id ?? inst?.type ?? `institution-${index}`),
    type: String(inst?.type ?? ""),
    level: Number(inst?.level ?? 1),
    /** The NPC who runs it (C:2232); carried through for map labelling. */
    steward: inst?.steward ? String(inst.steward) : null,
    destroyed: Boolean(inst?.destroyed)
  }));
}

/* -------------------------------------------- */
/*  Stage 5 — dressing                          */
/* -------------------------------------------- */

/** Form-specific decoration: fields and trees outside, debris and wells inside. */
function planDressing(boundary, streetPlan, plots, params, rng) {
  if (params.form === PLAN_FORMS.RUIN) {
    return {
      wells: planWells(streetPlan, rng),
      debris: planDebris(boundary, plots, streetPlan, params, rng),
      fields: [],
      orchards: [],
      farmsteads: [],
      trees: []
    };
  }
  const farmland = planFarmland(boundary, params, rng);
  const farmsteads = planFarmsteads(boundary, farmland, params, rng);
  return {
    wells: planWells(streetPlan, rng),
    debris: [],
    ...farmland,
    farmsteads,
    trees: planTrees(boundary, plots, streetPlan, farmland, params, rng)
  };
}

/**
 * Working farmsteads on the outskirts — a fenced plot with its own gate, well
 * and outbuildings, drawn as one whole object.
 *
 * Distinct from `planFarmland`, which produces arbitrary polygon rings for the
 * renderer to fill with furrows. A farmstead is a fixed piece of art and cannot
 * be stretched to fit a ring without tearing, so it gets its own position and
 * its own clear ground rather than being laid over a field. Placed further out
 * than the fields and rejected against them, so the two never overlap.
 */
function planFarmsteads(boundary, farmland, params, rng) {
  const target = Math.max(0, Math.floor(params.open.farmsteads ?? 0));
  if (!target) return [];
  const steads = [];
  const center = boundary.center;
  const water = boundary.water;
  const worked = [...farmland.fields, ...farmland.orchards];
  let attempts = 0;

  // The shell can span most of a portrait canvas, so only the angles with room
  // beyond it are viable and most candidates are thrown away. The budget is
  // generous for that reason: at 40 tries the third farmstead was being lost on
  // two thirds of villages, which read as a placement bug rather than as
  // variety.
  while (steads.length < target && attempts++ < target * 80) {
    const angle = rng.range(0, TAU);
    const anchor = add(center, fromAngle(angle, boundary.radius * rng.range(1.05, 1.45)));
    const size = rng.range(520, 760);
    const half = size * 0.5;
    // The whole plot has to land on the canvas, not just its centre.
    if (anchor.x - half < 0 || anchor.y - half < 0) continue;
    if (anchor.x + half > params.width || anchor.y + half > params.height) continue;
    if (pointInPolygon(anchor, boundary.ring)) continue;
    if (distToRing(anchor, boundary.ring) < 140) continue;
    if (water && distToPolyline(anchor, water.path) < water.width * 0.9 + half) continue;
    // A farmstead sits beside its fields, never on top of one.
    if (worked.some(cell => dist(cell.center, anchor) < half + 220)) continue;
    if (steads.some(s => dist(s.center, anchor) < (s.size + size) * 0.7)) continue;
    steads.push({
      id: `farmstead-${steads.length}`,
      center: roundPoint(anchor),
      size: Math.round(size)
    });
  }
  return steads;
}

function planWells(streetPlan, rng) {
  const square = streetPlan.square;
  return [{
    center: roundPoint(add(square.center, {
      x: rng.jitter(square.radius * 0.4),
      y: rng.jitter(square.radius * 0.4)
    })),
    radius: Math.round(rng.range(38, 58))
  }];
}

/** Small scattered debris that reads as a lived-in ruin. */
function planDebris(boundary, plots, streetPlan, params, rng) {
  const debris = [];
  const interior = boundary.interior;
  const count = 40;
  let attempts = 0;
  while (debris.length < count && attempts++ < count * 8) {
    const b = bounds(interior);
    const p = { x: rng.range(b.minX, b.maxX), y: rng.range(b.minY, b.maxY) };
    if (!pointInPolygon(p, interior)) continue;
    if (plots.some(plot => dist(p, plot.center) < plot.frontage * 0.8)) continue;
    if (streetPlan.streets.some(s => distToPolyline(p, s.points) < s.width * 0.7)) continue;
    debris.push({ center: roundPoint(p), radius: Math.round(rng.range(18, 52)) });
  }
  return debris;
}

/**
 * Fields and orchards outside the village.
 *
 * Placed as scattered irregular patches rather than as a radial partition of
 * the surrounding band. A sector partition is trivially exact, but it tiles the
 * whole annulus and so draws a perfect concentric donut around the settlement —
 * the single most artificial thing on the map. Real farmland clusters on the
 * good ground and leaves the rest alone, so patches are thrown at candidate
 * positions and rejected on overlap, which leaves the gaps that read as natural.
 */
function planFarmland(boundary, params, rng) {
  const fields = [];
  const orchards = [];
  const count = Math.max(0, Math.floor(params.open.fields));
  if (!count) return { fields, orchards };

  const center = boundary.center;
  const orchardTarget = Math.max(0, Math.floor(params.open.orchards));
  const water = boundary.water;
  const placed = [];
  let attempts = 0;

  while (placed.length < count && attempts++ < count * 30) {
    const angle = rng.range(0, TAU);
    const radius = boundary.radius * rng.range(1.06, 1.62);
    const anchor = add(center, fromAngle(angle, radius));
    if (anchor.x < 0 || anchor.y < 0 || anchor.x > params.width || anchor.y > params.height) continue;
    // Keep clear of the settlement edge and of any watercourse.
    if (distToRing(anchor, boundary.ring) < 90) continue;
    if (pointInPolygon(anchor, boundary.ring)) continue;
    if (water && distToPolyline(anchor, water.path) < water.width * 0.8) continue;

    const size = rng.range(280, 560);
    if (placed.some(p => dist(p.center, anchor) < (p.size + size) * 0.62)) continue;

    // Fields are worked in strips, so a squashed, slightly rotated quad reads
    // better than a circle: it gives the furrows a long axis to run along.
    const ring = noisyLoop(anchor, size, rng, {
      points: 9,
      irregularity: 0.12,
      lobes: 2,
      lobeDepth: 0.1,
      squash: rng.range(0.55, 0.9)
    });
    placed.push({ center: anchor, size });

    const cell = {
      id: `field-${placed.length - 1}`,
      ring: roundRing(ring),
      center: roundPoint(centroid(ring)),
      /** Furrow direction, so a renderer can hatch the field convincingly. */
      furrow: Number((angle + rng.jitter(0.6)).toFixed(4))
    };
    if (orchards.length < orchardTarget && rng.chance(0.3)) orchards.push(cell);
    else fields.push(cell);
  }
  return { fields, orchards };
}

/**
 * Trees, grown in copses rather than sprinkled.
 *
 * Uniform dart-throwing across the canvas produces even confetti, which reads
 * as texture rather than as woodland. Scattering around a smaller set of copse
 * centres gives the clumping and the clearings that make tree cover look like
 * terrain, and costs nothing extra.
 */
function planTrees(boundary, plots, streetPlan, farmland, params, rng) {
  const target = Math.max(0, Math.floor(params.open.trees));
  if (!target) return [];
  const trees = [];
  const water = boundary.water;
  const worked = [...farmland.fields, ...farmland.orchards];

  // Copses cluster beyond the settlement; a few sit inside it as garden trees.
  const copseCount = Math.max(3, Math.round(target / 22));
  const copses = [];
  for (let i = 0; i < copseCount; i++) {
    copses.push({
      center: {
        x: rng.range(params.width * 0.02, params.width * 0.98),
        y: rng.range(params.height * 0.02, params.height * 0.98)
      },
      spread: rng.range(320, 720)
    });
  }

  const blocked = p => {
    if (p.x < 0 || p.y < 0 || p.x > params.width || p.y > params.height) return true;
    if (plots.some(plot => dist(p, plot.center) < plot.frontage * 0.95)) return true;
    if (streetPlan.streets.some(s => distToPolyline(p, s.points) < s.width * 1.4)) return true;
    if (water && distToPolyline(p, water.path) < water.width * 0.7) return true;
    // Nothing grows in a ploughed field.
    if (worked.some(f => pointInPolygon(p, f.ring))) return true;
    return trees.some(t => dist(t.center, p) < 58);
  };

  let attempts = 0;
  while (trees.length < target && attempts++ < target * 14) {
    const copse = copses[rng.int(0, copses.length - 1)];
    const p = add(copse.center, fromAngle(rng.range(0, TAU), Math.abs(rng.gaussian(0, copse.spread * 0.55)) ));
    // Thin sharply inside the village: a few garden trees, not woodland.
    if (pointInPolygon(p, boundary.ring) && !rng.chance(0.1)) continue;
    if (blocked(p)) continue;
    trees.push({ center: roundPoint(p), radius: Math.round(rng.range(26, 52)) });
  }
  return trees;
}

/* -------------------------------------------- */
/*  Orchestration                                */
/* -------------------------------------------- */

/**
 * Build a complete plan.
 *
 * @param {object} village   Normalized Village record; only `institutions`,
 *                           `prosperity`, `sceneSeed` and `name` are read.
 * @param {object} [options]
 * @param {object} [options.params]    Parameter overrides; see `PLAN_DEFAULTS`.
 * @param {string} [options.seed]      Overrides `village.sceneSeed`.
 * @param {object} [options.previous]  A prior plan to reuse locked stages from.
 * @param {object} [options.locks]     `{ boundary: true, streets: true, ... }`
 * @returns {object} A serializable plan.
 */
export function buildVillagePlan(village = {}, options = {}) {
  const previous = options.previous ?? null;
  const params = resolveAutoParams(village, defaultPlanParams(options.params), previous);
  const seed = String(options.seed ?? village?.sceneSeed ?? village?.name ?? "crows-village");
  // Growing an existing village keeps its ground. Handed a previous plan, the
  // physical layers are reused by default and only the assignment re-runs, so
  // founding an institution adds a building instead of redrawing the town.
  // An explicit lock still wins, in either direction.
  const locks = previous
    ? { boundary: true, streets: true, plots: true, dressing: true, ...(options.locks ?? {}) }
    : (options.locks ?? {});
  const reuse = stage => Boolean(locks[stage]) && previous?.[stage] != null;

  const boundary = reuse("boundary")
    ? previous.boundary
    : planBoundary(village, params, streamFor(seed, "boundary"));

  // A locked street network is only reusable if it still fits the shell it is
  // being reused against; silently keeping streets that now cross a wall is
  // exactly the kind of quietly-wrong output locking is supposed to avoid.
  let streetPlan = reuse("streets") ? previous.streets : null;
  if (streetPlan && !streetsFitBoundary(streetPlan, boundary)) streetPlan = null;
  if (!streetPlan) streetPlan = planStreets(village, boundary, params, streamFor(seed, "streets"));

  // Reusing plots is only sound when the streets they front are the same ones;
  // a re-rolled network leaves old plots facing nothing.
  const reusePlots = reuse("plots") && streetPlan === previous?.streets;
  const plotResult = reusePlots
    ? {
        plots: previous.plots.map(p => ({
          ...p,
          use: null,
          institutionId: undefined,
          institutionType: undefined,
          institutionLevel: undefined,
          destroyed: undefined
        })),
        rejected: null
      }
    : planPlots(boundary, streetPlan, params, streamFor(seed, "plots"));
  let plots = plotResult.plots;

  // Additive growth: when the record now needs more room than the layout has,
  // extend the network instead of re-planning. Re-planning would find the room
  // but move every building already standing.
  let growth = null;
  // An explicit street lock freezes the network; growth would quietly add to it.
  const streetsFrozen = options.locks?.streets === true;
  if (previous && params.growth !== false && !streetsFrozen) {
    // Trigger on real shortage, not on the headroom target. Growing whenever
    // the layout sits below its ideal slack means founding one building extends
    // the streets even with plots standing empty — the village should only
    // reach for new ground when it has actually run out.
    const target = Math.ceil(params.demand * 1.15);
    if (plots.length < params.demand) {
      const before = plots.length;
      const result = growNetwork({
        boundary,
        streetPlan,
        plots,
        params,
        // Keyed on the current network size so each round of growth draws
        // fresh lanes, while re-running the same round stays reproducible.
        rng: streamFor(seed, `growth/${streetPlan.streets.length}`),
        target
      });
      if (result.streets.length) {
        // A new object: mutating the reused street plan would corrupt the
        // previous plan the caller still holds.
        streetPlan = { ...streetPlan, streets: [...streetPlan.streets, ...result.streets] };
      }
      growth = {
        lanes: result.streets.length,
        plots: plots.length - before,
        // Measured against what the record actually needs, not against the
        // stretch target — reporting a village as full when it comfortably
        // housed everyone is worse than not reporting at all.
        exhausted: plots.length < params.demand
      };
    }
  }

  const assignment = planAssignment(
    village, boundary, streetPlan, plots, params, streamFor(seed, "assignment"), previous
  );

  const dressing = reuse("dressing") && previous?.dressing
    ? previous.dressing
    : planDressing(boundary, streetPlan, plots, params, streamFor(seed, "dressing"));

  return {
    version: VILLAGE_PLAN_VERSION,
    seed,
    form: params.form,
    name: String(village?.name ?? ""),
    width: params.width,
    height: params.height,
    params,
    boundary,
    streets: streetPlan,
    plots,
    assignment,
    dressing,
    stats: {
      streets: streetPlan.streets.length,
      bridges: streetPlan.bridges?.length ?? 0,
      plots: plots.length,
      institutions: assignment.institutions.length,
      housing: assignment.housing.length,
      vacant: plots.filter(p => p.use === "vacant").length,
      unplacedInstitutions: assignment.unplacedInstitutions,
      unbuiltHousing: assignment.unbuiltHousing,
      /** Why candidate plots were dropped; null when plots were reused. */
      rejectedPlots: plotResult.rejected,
      /**
       * What this build added to an existing network, or null if it did not
       * grow. `exhausted` means no further lane would fit — the village has
       * filled its shell and cannot take more without moving what is built.
       */
      growth
    }
  };
}

/** Would every street still lie inside this boundary? */
function streetsFitBoundary(streetPlan, boundary) {
  return streetPlan.streets.every(s => s.points.every(p => pointInPolygon(p, boundary.interior)));
}

/**
 * Where a given institution sits, in plan space.  This is the seam
 * `village-map.mjs` uses to place a Tile: the plan owns layout, the map module
 * keeps owning Scene writes and art resolution.
 */
export function planPositionForInstitution(plan, institutionId) {
  const found = plan?.assignment?.institutions?.find(a => a.institutionId === institutionId);
  return found ? placementView(plan, found) : null;
}

/** Where housing unit `index` sits, or null when the plan had no room. */
export function planPositionForHousing(plan, index) {
  const found = plan?.assignment?.housing?.[index];
  return found ? placementView(plan, found) : null;
}

/**
 * A placement plus the plot it sits on.
 *
 * The plot's dimensions travel with the position because a consumer drawing
 * fixed-size art has to know how much room it actually has — art sized
 * independently of the plot either overflows into the street or rattles around
 * inside it.
 */
function placementView(plan, placement) {
  const plot = plan.plots?.find(p => p.id === placement.plotId) ?? null;
  return {
    x: placement.center.x,
    y: placement.center.y,
    angle: placement.angle,
    plotId: placement.plotId,
    frontage: plot?.frontage ?? null,
    depth: plot?.depth ?? null
  };
}
