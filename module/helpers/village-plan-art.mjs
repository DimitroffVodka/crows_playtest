/**
 * Overhead building art for institutions, drawn as SVG.
 *
 * Buildings are drawn rather than stamped from a sprite catalogue, for the same
 * reason streets are: a drawn building can be fitted to the plot the planner
 * actually produced — its size, its proportions, and the angle of the street it
 * fronts — where a fixed-size image can only be centred and hoped for. It also
 * covers `crypt` and `stables`, which resolve to `unsupported.*` in
 * `INSTITUTION_ART_KEYS` and have no art in the shipped PNG catalogue.
 *
 * ## Matching the institution cards
 *
 * The look is transcribed from `assets/institutions/*.svg`: the same ink, the
 * same clay/slate/thatch/wood/arcane material pairs, the same yard and paving
 * treatment, and the same faceted roofs. Roof facets are the signature — each
 * slope is its own filled polygon shaded light or dark, which is what gives the
 * buildings their solidity. A single flat fill with line-work over it reads flat
 * next to them.
 *
 * ## Lighting
 *
 * Facets are shaded by their normal rotated into *world* space, not local
 * space. Buildings here rotate to face their street; shading them locally would
 * light each roof from a different direction and the map would look incoherent.
 * The light sits upper-left, matching the source art's `dx 4 / dy 6` shadow.
 *
 * ## Local space
 *
 * Every shape draws in its own local frame, centred on the origin with the
 * street-facing edge toward -y, and is placed by an SVG transform. Rotating a
 * group is one attribute; rotating every point in JS is a hundred lines of
 * arithmetic that can disagree with itself.
 */

import { resolveStyle, strokesFor } from "./village-plan-style.mjs";

/**
 * Mirrors `INSTITUTION_ART_KEYS` in `village-map.mjs`.
 *
 * Mirrored rather than imported so this module stays free of Foundry globals
 * and of the Village record, exactly as `village-map.mjs` mirrors Foundry's
 * `defaultLevelId` rather than reading it. `village-plan-art.test.mjs` asserts
 * the two tables agree, so the duplication is checkable instead of hopeful.
 */
export const INSTITUTION_SHAPES = Object.freeze({
  alchemist:    Object.freeze([{ max: Infinity, shape: "circle" }]),
  auctionHouse: Object.freeze([{ max: Infinity, shape: "guild-hall" }]),
  barracks:     Object.freeze([{ max: Infinity, shape: "tower-square" }]),
  beacon:       Object.freeze([{ max: Infinity, shape: "tower-circle" }]),
  blacksmith:   Object.freeze([{ max: 1, shape: "smith" }, { max: Infinity, shape: "foundry" }]),
  bookseller:   Object.freeze([{ max: Infinity, shape: "library" }]),
  crypt:        Object.freeze([{ max: Infinity, shape: "crypt" }]),
  enchanter:    Object.freeze([{ max: Infinity, shape: "arcane-hall" }]),
  generalStore: Object.freeze([{ max: Infinity, shape: "market-tents" }]),
  inn:          Object.freeze([{ max: Infinity, shape: "l-house" }]),
  stables:      Object.freeze([{ max: Infinity, shape: "stables" }]),
  temple:       Object.freeze([{ max: 1, shape: "church" }, { max: Infinity, shape: "cathedral" }])
});

/**
 * Primary roof material per institution, read off the shipped card art rather
 * than invented: clay for the trades and the public houses, slate for the
 * scholarly and the sacred, thatch for the stables, arcane for the enchanter.
 */
export const INSTITUTION_MATERIAL = Object.freeze({
  alchemist: "slate",
  auctionHouse: "clay",
  barracks: "slate",
  beacon: "clay",
  blacksmith: "clay",
  bookseller: "slate",
  crypt: "slate",
  enchanter: "arcane",
  generalStore: "clay",
  inn: "clay",
  stables: "thatch",
  temple: "slate"
});

/** Every shape this module can draw. */
export const BUILDING_SHAPES = Object.freeze([
  "circle", "guild-hall", "tower-square", "tower-circle", "smith", "foundry",
  "library", "crypt", "arcane-hall", "market-tents", "l-house", "stables",
  "church", "cathedral", "house"
]);

/** Which shape an institution shows at a given effective level. */
export function shapeForInstitution(type, level = 1) {
  const rows = INSTITUTION_SHAPES[type];
  if (!rows) return "house";
  const n = Number(level);
  const effective = Number.isFinite(n) ? n : 1;
  for (const row of rows) if (effective <= row.max) return row.shape;
  return rows[rows.length - 1].shape;
}

/** Which material an institution's roof is made of. */
export function materialForInstitution(type) {
  return INSTITUTION_MATERIAL[type] ?? "thatch";
}

/* -------------------------------------------- */
/*  Primitives                                  */
/* -------------------------------------------- */

const fmt = n => (Math.round(n * 100) / 100).toString();
const deg = rad => (rad * 180) / Math.PI;

const poly = pts => pts.map((p, i) => `${i ? "L" : "M"}${fmt(p[0])} ${fmt(p[1])}`).join(" ") + " Z";
const seg = (a, b) => `M${fmt(a[0])} ${fmt(a[1])}L${fmt(b[0])} ${fmt(b[1])}`;

/** Light direction, upper-left, matching the card art's shadow offset. */
const LIGHT = Object.freeze({ x: -Math.SQRT1_2, y: -Math.SQRT1_2 });

/**
 * Which side of a material pair a roof facet takes, given the facet's normal in
 * the building's local frame and the building's rotation.
 *
 * Exported so the lighting invariant is assertable rather than assumed: a facet
 * that faces a given *world* direction must get the same colour no matter how
 * the building is rotated, or roofs across the map end up lit from different
 * directions and the whole thing looks incoherent.
 */
export function facetFill(nx, ny, angle, pair) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const wx = nx * cos - ny * sin;
  const wy = nx * sin + ny * cos;
  return (wx * LIGHT.x + wy * LIGHT.y) > 0 ? pair.light : pair.dark;
}

/**
 * The drawing context handed to every shape: resolved palette, size-scaled
 * stroke weights, the building's material, and a shader that accounts for the
 * building's rotation.
 */
function makeContext(style, { angle = 0, material = "thatch", size = 250, ground = true } = {}) {
  const materials = style.materials ?? {};
  const pair = materials[material] ?? { light: style.roof, dark: style.roofAlt };
  const shade = (nx, ny, m = pair) => facetFill(nx, ny, angle, m);
  return {
    s: style,
    k: strokesFor(size),
    mat: pair,
    materials,
    shade,
    /**
     * Whether yards and paving paint their own ground. False for Tile art: the
     * drawn map already supplies the ground beneath, so a filled yard reads as
     * a pale card floating on the map rather than as swept earth.
     */
    ground,
    /** Look up a named material pair, falling back to the building's own. */
    pairOf: name => materials[name] ?? pair
  };
}

/**
 * A hipped roof seen from above, built as four shaded facets.
 *
 * Each slope is a filled polygon lit from its own outward normal, so the roof
 * has real form rather than a flat fill with lines drawn on top. The shared
 * facet edges *are* the ridge and hips; the extra ridge stroke only weights it.
 */
function facetedRoof(w, d, ctx, { material = null, inset = 0.26 } = {}) {
  const m = material ? ctx.pairOf(material) : ctx.mat;
  const hw = w / 2, hh = d / 2;
  const along = w >= d;
  const ridgeHalf = (along ? hw : hh) * (1 - inset * 2);
  const A = [-hw, -hh], B = [hw, -hh], C = [hw, hh], D = [-hw, hh];

  let facets, ridge;
  if (along) {
    const L = [-ridgeHalf, 0], R = [ridgeHalf, 0];
    ridge = [L, R];
    facets = [
      { pts: [A, B, R, L], n: [0, -1] },
      { pts: [D, C, R, L], n: [0, 1] },
      { pts: [B, C, R], n: [1, 0] },
      { pts: [A, D, L], n: [-1, 0] }
    ];
  } else {
    const T = [0, -ridgeHalf], Bt = [0, ridgeHalf];
    ridge = [T, Bt];
    facets = [
      { pts: [A, D, Bt, T], n: [-1, 0] },
      { pts: [B, C, Bt, T], n: [1, 0] },
      { pts: [A, B, T], n: [0, -1] },
      { pts: [D, C, Bt], n: [0, 1] }
    ];
  }
  return facets
    .map(f => `<path d="${poly(f.pts)}" fill="${ctx.shade(f.n[0], f.n[1], m)}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}" stroke-linejoin="round"/>`)
    .join("")
    + `<path d="${seg(ridge[0], ridge[1])}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.ridge)}" stroke-linecap="round" fill="none"/>`;
}

/** A conical roof, faceted the same way so it sits beside the hipped ones. */
function conicalRoof(r, ctx, { material = null, wedges = 10 } = {}) {
  const m = material ? ctx.pairOf(material) : ctx.mat;
  const parts = [];
  for (let i = 0; i < wedges; i++) {
    const a0 = (i / wedges) * Math.PI * 2;
    const a1 = ((i + 1) / wedges) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    parts.push(`<path d="${poly([[0, 0], [Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]])}" fill="${ctx.shade(Math.cos(mid), Math.sin(mid), m)}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" stroke-linejoin="round"/>`);
  }
  parts.push(`<circle cx="0" cy="0" r="${fmt(r)}" fill="none" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`);
  return parts.join("");
}

/** A polygonal roof (octagon and friends), faceted per side. */
function polygonalRoof(r, sides, ctx, { material = null } = {}) {
  const m = material ? ctx.pairOf(material) : ctx.mat;
  const parts = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const a1 = ((i + 1) / sides) * Math.PI * 2 + Math.PI / sides;
    const mid = (a0 + a1) / 2;
    parts.push(`<path d="${poly([[0, 0], [Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]])}" fill="${ctx.shade(Math.cos(mid), Math.sin(mid), m)}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" stroke-linejoin="round"/>`);
  }
  return parts.join("");
}

/** A flat-roofed block — outbuildings, lean-tos, annexes. */
function block(x, y, w, d, ctx, { material = "wood", nx = 0, ny = 1 } = {}) {
  return `<rect x="${fmt(x - w / 2)}" y="${fmt(y - d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="${ctx.shade(nx, ny, ctx.pairOf(material))}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}" stroke-linejoin="round"/>`;
}

function chimney(x, y, size, ctx) {
  return `<rect x="${fmt(x - size / 2)}" y="${fmt(y - size / 2)}" width="${fmt(size)}" height="${fmt(size)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`;
}

/** Open ground belonging to the building — a yard, paddock or forecourt. */
function yard(x, y, w, d, ctx) {
  const fill = ctx.ground ? ctx.s.yardFill : "none";
  return `<rect x="${fmt(x - w / 2)}" y="${fmt(y - d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="${fill}" stroke="${ctx.s.yardStroke}" stroke-width="${fmt(ctx.k.thin)}" stroke-dasharray="${fmt(ctx.k.line * 2)},${fmt(ctx.k.line * 1.5)}"/>`;
}

/** Paved ground — the stone apron the card art puts under its buildings. */
function paving(x, y, w, d, ctx) {
  if (!ctx.ground) return "";
  return `<rect x="${fmt(x - w / 2)}" y="${fmt(y - d / 2)}" width="${fmt(w)}" height="${fmt(d)}" fill="${ctx.s.square}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`;
}

/** Steps at an entrance, drawn as stacked bars. */
function steps(x, y, w, count, ctx) {
  const out = [];
  const rise = Math.max(3, w * 0.05);
  for (let i = 0; i < count; i++) {
    const iw = w * (1 - i * 0.14);
    out.push(`<rect x="${fmt(x - iw / 2)}" y="${fmt(y + i * rise)}" width="${fmt(iw)}" height="${fmt(rise * 0.8)}" fill="${ctx.s.square}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`);
  }
  return out.join("");
}

function tree(x, y, r, ctx) {
  return `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}" fill="${ctx.s.tree}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`
    + `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r * 0.55)}" fill="none" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" opacity="0.7"/>`;
}

/* -------------------------------------------- */
/*  Shapes                                      */
/* -------------------------------------------- */

/**
 * Each shape receives the plot box it must fit inside and returns SVG in local
 * space. `-y` faces the street, so entrances, porches and yards go there.
 */
const SHAPES = {
  house(w, d, ctx) {
    return facetedRoof(w * 0.92, d * 0.82, ctx)
      + chimney(w * 0.24, -d * 0.18, Math.min(w, d) * 0.13, ctx);
  },

  "l-house"(w, d, ctx) {
    // Inn: a main range plus a wing, wrapping a courtyard onto the street.
    const mainD = d * 0.5, wingD = d * 0.48;
    return [
      yard(w * 0.22, -d * 0.22, w * 0.4, d * 0.4, ctx),
      `<g transform="translate(0 ${fmt(d * 0.22)})">${facetedRoof(w * 0.95, mainD, ctx)}</g>`,
      `<g transform="translate(${fmt(-w * 0.26)} ${fmt(-d * 0.2)})">${facetedRoof(w * 0.4, wingD, ctx, { material: "wood" })}</g>`,
      chimney(-w * 0.26, d * 0.2, Math.min(w, d) * 0.12, ctx),
      chimney(w * 0.34, d * 0.3, Math.min(w, d) * 0.11, ctx)
    ].join("");
  },

  church(w, d, ctx) {
    // Nave along the long axis, a squat bell tower at the street end.
    const naveW = w * 0.5, naveD = d * 0.86;
    const towerSize = Math.min(w, d) * 0.3;
    return [
      paving(0, d * 0.46, naveW * 0.8, d * 0.1, ctx),
      facetedRoof(naveW, naveD, ctx, { inset: 0.18 }),
      `<g transform="translate(0 ${fmt(-d * 0.43 - towerSize * 0.2)})">${facetedRoof(towerSize, towerSize, ctx, { material: "clay", inset: 0.3 })}</g>`,
      steps(0, d * 0.43, naveW * 0.6, 3, ctx)
    ].join("");
  },

  cathedral(w, d, ctx) {
    // Cruciform: nave, transept, apse. The transept is what distinguishes it
    // from the church at a glance, which is the whole point of the upgrade.
    const naveW = w * 0.44, naveD = d * 0.88;
    const transeptW = w * 0.92, transeptD = d * 0.26;
    const apse = naveW * 0.5;
    return [
      paving(0, d * 0.47, naveW * 0.9, d * 0.09, ctx),
      `<path d="M${fmt(-apse)} ${fmt(-d * 0.44)}A${fmt(apse)} ${fmt(apse)} 0 0 1 ${fmt(apse)} ${fmt(-d * 0.44)}Z" fill="${ctx.shade(0, -1)}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      facetedRoof(naveW, naveD, ctx, { inset: 0.14 }),
      `<g transform="translate(0 ${fmt(-d * 0.1)})">${facetedRoof(transeptW, transeptD, ctx, { inset: 0.2 })}</g>`,
      `<circle cx="0" cy="${fmt(-d * 0.1)}" r="${fmt(Math.min(w, d) * 0.07)}" fill="${ctx.s.gold}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      steps(0, d * 0.44, naveW * 0.7, 4, ctx),
      chimney(-transeptW * 0.42, -d * 0.1, Math.min(w, d) * 0.1, ctx),
      chimney(transeptW * 0.42, -d * 0.1, Math.min(w, d) * 0.1, ctx)
    ].join("");
  },

  smith(w, d, ctx) {
    // Forge hall with a lean-to on its flank and the working yard butted
    // against its street edge. Every piece touches: a yard floating clear of
    // its building reads as a drafting error rather than as a forecourt.
    const hallD = d * 0.44, hallY = d * 0.24;
    const hallTop = hallY - hallD / 2;
    const yardD = d * 0.36;
    return [
      yard(0, hallTop - yardD / 2, w * 0.74, yardD, ctx),
      block(w * 0.39, hallY, w * 0.18, hallD * 0.84, ctx, { material: "wood", nx: 1, ny: 0 }),
      `<g transform="translate(${fmt(-w * 0.04)} ${fmt(hallY)})">${facetedRoof(w * 0.7, hallD, ctx)}</g>`,
      `<circle cx="0" cy="${fmt(hallTop - yardD * 0.5)}" r="${fmt(Math.min(w, d) * 0.085)}" fill="${ctx.s.ember}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      chimney(-w * 0.3, hallY, Math.min(w, d) * 0.15, ctx)
    ].join("");
  },

  foundry(w, d, ctx) {
    // The upgrade: a bigger mass, twin stacks and a casting yard.
    const hallD = d * 0.48, hallY = d * 0.26;
    const hallTop = hallY - hallD / 2;
    const yardD = d * 0.34;
    return [
      yard(0, hallTop - yardD / 2, w * 0.82, yardD, ctx),
      block(-w * 0.36, hallY, w * 0.2, hallD * 0.72, ctx, { material: "wood", nx: -1, ny: 0 }),
      `<g transform="translate(0 ${fmt(hallY)})">${facetedRoof(w * 0.86, hallD, ctx)}</g>`,
      `<circle cx="${fmt(-w * 0.16)}" cy="${fmt(hallTop - yardD * 0.5)}" r="${fmt(Math.min(w, d) * 0.08)}" fill="${ctx.s.ember}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      `<circle cx="${fmt(w * 0.16)}" cy="${fmt(hallTop - yardD * 0.5)}" r="${fmt(Math.min(w, d) * 0.055)}" fill="${ctx.s.ember}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" opacity="0.85"/>`,
      chimney(-w * 0.26, hallY, Math.min(w, d) * 0.16, ctx),
      chimney(w * 0.28, hallY, Math.min(w, d) * 0.14, ctx)
    ].join("");
  },

  library(w, d, ctx) {
    // Central hall with two reading wings — an H, read end-on.
    const hallW = w * 0.44, hallD = d * 0.9;
    const wingW = w * 0.26, wingD = d * 0.46;
    return [
      facetedRoof(hallW, hallD, ctx, { inset: 0.16 }),
      `<g transform="translate(${fmt(-w * 0.34)} 0)">${facetedRoof(wingW, wingD, ctx, { material: "wood" })}</g>`,
      `<g transform="translate(${fmt(w * 0.34)} 0)">${facetedRoof(wingW, wingD, ctx, { material: "wood" })}</g>`,
      tree(-w * 0.36, d * 0.36, Math.min(w, d) * 0.08, ctx),
      steps(0, d * 0.45, hallW * 0.6, 2, ctx)
    ].join("");
  },

  "guild-hall"(w, d, ctx) {
    // A wide public hall with a columned porch facing the street.
    const hallD = d * 0.68;
    const columns = [];
    for (let i = -2; i <= 2; i++) {
      columns.push(`<circle cx="${fmt(i * w * 0.15)}" cy="${fmt(-d * 0.3)}" r="${fmt(Math.min(w, d) * 0.05)}" fill="${ctx.s.stone}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`);
    }
    return [
      `<g transform="translate(0 ${fmt(d * 0.1)})">${facetedRoof(w * 0.94, hallD, ctx, { inset: 0.2 })}</g>`,
      `<rect x="${fmt(-w * 0.42)}" y="${fmt(-d * 0.38)}" width="${fmt(w * 0.84)}" height="${fmt(d * 0.16)}" fill="${ctx.s.square}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      columns.join(""),
      `<circle cx="0" cy="${fmt(d * 0.1)}" r="${fmt(Math.min(w, d) * 0.07)}" fill="${ctx.s.gold}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      steps(0, d * 0.44, w * 0.5, 3, ctx)
    ].join("");
  },

  circle(w, d, ctx) {
    // Alchemist: a round still-house, an annex cut into its side, and a herb
    // plot against it. The annex overlaps the drum so it reads as built on.
    const r = Math.min(w, d) * 0.33;
    const cy = d * 0.14;
    const herbD = d * 0.28;
    return [
      yard(0, cy - r - herbD / 2, w * 0.6, herbD, ctx),
      herbRows(0, cy - r - herbD / 2, w * 0.6, herbD, ctx),
      block(r * 0.5 + w * 0.11, cy, w * 0.22, r * 0.84, ctx, { material: "wood", nx: 1, ny: 0 }),
      `<g transform="translate(0 ${fmt(cy)})">${conicalRoof(r, ctx, { wedges: 12 })}</g>`,
      chimney(r * 0.5 + w * 0.14, cy, Math.min(w, d) * 0.095, ctx)
    ].join("");
  },

  "arcane-hall"(w, d, ctx) {
    // Enchanter: an octagon and an attached study tower, with a ward ring.
    const r = Math.min(w, d) * 0.36;
    return [
      polygonalRoof(r, 8, ctx),
      `<circle cx="0" cy="0" r="${fmt(r * 0.34)}" fill="none" stroke="${ctx.s.rune}" stroke-width="${fmt(ctx.k.line)}"/>`,
      `<circle cx="0" cy="0" r="${fmt(r * 0.16)}" fill="${ctx.s.gold}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`,
      `<g transform="translate(${fmt(w * 0.31)} ${fmt(d * 0.27)})">${conicalRoof(Math.min(w, d) * 0.14, ctx, { material: "clay", wedges: 8 })}</g>`
    ].join("");
  },

  "market-tents"(w, d, ctx) {
    // General store: a shop with a run of market awnings along its street
    // frontage. The awnings abut in a row — scattered loose diamonds read as
    // stray shapes rather than as a market.
    const shopD = d * 0.34, shopY = d * 0.29;
    const shopTop = shopY - shopD / 2;
    const bays = 3;
    const bayW = w * 0.84 / bays;
    const awnY = shopTop - d * 0.16;
    const awnings = [];
    for (let i = 0; i < bays; i++) {
      const x = -w * 0.42 + bayW * (i + 0.5);
      const fill = i % 2 ? ctx.s.canvas : ctx.shade(0, -1, ctx.pairOf("wood"));
      awnings.push(`<rect x="${fmt(x - bayW / 2)}" y="${fmt(awnY - d * 0.13)}" width="${fmt(bayW)}" height="${fmt(d * 0.26)}" fill="${fill}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`);
    }
    return [
      awnings.join(""),
      `<g transform="translate(0 ${fmt(shopY)})">${facetedRoof(w * 0.7, shopD, ctx)}</g>`,
      `<rect x="${fmt(-w * 0.46)}" y="${fmt(awnY - d * 0.06)}" width="${fmt(w * 0.09)}" height="${fmt(w * 0.09)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`,
      `<rect x="${fmt(w * 0.38)}" y="${fmt(awnY + d * 0.02)}" width="${fmt(w * 0.08)}" height="${fmt(w * 0.08)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`
    ].join("");
  },

  "tower-square"(w, d, ctx) {
    // Barracks: a keep set into the end of a hall range, with the drill yard
    // butted against the range. The tower overlaps the hall so the two read as
    // one fortified building rather than two objects that happen to be near.
    const rangeD = d * 0.34, rangeY = d * 0.28;
    const rangeTop = rangeY - rangeD / 2;
    const t = Math.min(w, d) * 0.4;
    const yardD = d * 0.42;
    return [
      yard(0, rangeTop - yardD / 2, w * 0.84, yardD, ctx),
      drillMarks(0, rangeTop - yardD / 2, w * 0.84, yardD, ctx),
      `<g transform="translate(${fmt(-w * 0.12)} ${fmt(rangeY)})">${facetedRoof(w * 0.74, rangeD, ctx)}</g>`,
      `<g transform="translate(${fmt(w * 0.22 + t / 2)} ${fmt(rangeY - t * 0.12)})">${facetedRoof(t, t, ctx, { material: "clay", inset: 0.32 })}</g>`
    ].join("");
  },

  "tower-circle"(w, d, ctx) {
    // Beacon: a stone drum with a parapet walk and the signal fire in its
    // crown — the ward against the Miasma (C:2218).
    //
    // Crenellation is cut *into* the rim as notches rather than stacked on it
    // as blocks: separate merlon squares sitting on the circumference read as
    // loose confetti orbiting the tower rather than as part of its wall.
    // Concentric rings read as a target no matter how they are shaded, so the
    // radial symmetry is broken deliberately: a stair block against the drum
    // and a roofed guard hut beside it. Two rings, not four.
    const r = Math.min(w, d) * 0.3;
    const notches = [];
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      notches.push(`<path d="${seg([Math.cos(a) * r, Math.sin(a) * r], [Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78])}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}" stroke-linecap="butt"/>`);
    }
    return [
      // Stair up the outside, breaking the circle.
      `<rect x="${fmt(-r * 0.28)}" y="${fmt(r * 0.72)}" width="${fmt(r * 0.56)}" height="${fmt(r * 0.62)}" fill="${ctx.s.stone}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      steps(0, r * 0.8, r * 0.48, 3, ctx),
      `<circle cx="0" cy="0" r="${fmt(r)}" fill="${ctx.s.stone}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thick)}"/>`,
      notches.join(""),
      `<circle cx="0" cy="0" r="${fmt(r * 0.78)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      `<circle cx="0" cy="0" r="${fmt(r * 0.34)}" fill="${ctx.s.ember}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      // Guard hut, so the composition has a front. Kept tucked against the
      // drum: pushed further out it leaves the plot and lands in the street.
      `<g transform="translate(${fmt(-r * 1.14)} ${fmt(-r * 0.62)})">${facetedRoof(r * 0.66, r * 0.52, ctx, { material: "clay", inset: 0.3 })}</g>`
    ].join("");
  },

  crypt(w, d, ctx) {
    // No art exists for this one; a sunken stone vault with markers around it.
    const vaultW = w * 0.5, vaultD = d * 0.44;
    const markers = [];
    const spots = [[-0.34, 0.3], [-0.12, 0.38], [0.16, 0.34], [0.36, 0.22], [-0.36, -0.06]];
    for (const [mx, my] of spots) {
      markers.push(`<rect x="${fmt(mx * w - w * 0.022)}" y="${fmt(my * d)}" width="${fmt(w * 0.045)}" height="${fmt(d * 0.06)}" rx="${fmt(w * 0.02)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`);
    }
    return [
      paving(0, d * 0.06, w * 0.86, d * 0.76, ctx),
      markers.join(""),
      `<g transform="translate(0 ${fmt(-d * 0.14)})">${facetedRoof(vaultW, vaultD, ctx, { inset: 0.3 })}</g>`,
      // The stair down, which is the only way a crypt reads from above.
      `<rect x="${fmt(-vaultW * 0.2)}" y="${fmt(-d * 0.14 + vaultD * 0.5)}" width="${fmt(vaultW * 0.4)}" height="${fmt(d * 0.12)}" fill="${ctx.s.stoneDark}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}"/>`,
      steps(0, -d * 0.14 + vaultD * 0.5 + 2, vaultW * 0.36, 3, ctx)
    ].join("");
  },

  stables(w, d, ctx) {
    // Also unsupported in the art set. A bare rectangle says nothing, so the
    // stalls are divided across the range and the paddock is properly fenced —
    // those two details are the whole difference between a shed and a stable.
    const rangeW = w * 0.92, rangeD = d * 0.34, rangeY = d * 0.29;
    const rangeTop = rangeY - rangeD / 2;
    const paddockD = d * 0.44;
    const paddockY = rangeTop - paddockD / 2;
    const stalls = [];
    for (let i = 1; i < 5; i++) {
      const x = -rangeW / 2 + i * (rangeW / 5);
      stalls.push(`<path d="${seg([x, rangeY - rangeD / 2], [x, rangeY + rangeD / 2])}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" opacity="0.8"/>`);
    }
    const rail = [];
    for (let i = 0; i <= 6; i++) {
      const x = -w * 0.42 + i * (w * 0.84 / 6);
      rail.push(`<circle cx="${fmt(x)}" cy="${fmt(paddockY - paddockD / 2)}" r="${fmt(Math.max(2, w * 0.012))}" fill="${ctx.s.yardStroke}"/>`);
    }
    return [
      yard(0, paddockY, w * 0.84, paddockD, ctx),
      rail.join(""),
      `<circle cx="${fmt(-w * 0.26)}" cy="${fmt(paddockY + paddockD * 0.16)}" r="${fmt(Math.min(w, d) * 0.06)}" fill="${ctx.s.thatchProp}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`,
      `<circle cx="${fmt(-w * 0.14)}" cy="${fmt(paddockY - paddockD * 0.02)}" r="${fmt(Math.min(w, d) * 0.048)}" fill="${ctx.s.thatchProp}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}"/>`,
      `<g transform="translate(0 ${fmt(rangeY)})">${facetedRoof(rangeW, rangeD, ctx)}</g>`,
      stalls.join("")
    ].join("");
  }
};

/** Planted rows in a herb plot. */
function herbRows(x, y, w, d, ctx) {
  const dots = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      dots.push(`<circle cx="${fmt(x - w * 0.36 + i * (w * 0.18))}" cy="${fmt(y - d * 0.16 + j * (d * 0.32))}" r="${fmt(Math.min(w, d) * 0.06)}" fill="${ctx.s.tree}" opacity="0.85"/>`);
    }
  }
  return dots.join("");
}

/** Scuffed ground in a drill yard — a few short marks, not a texture. */
function drillMarks(x, y, w, d, ctx) {
  const marks = [];
  for (let i = 0; i < 4; i++) {
    const mx = x - w * 0.3 + i * (w * 0.2);
    marks.push(`<path d="${seg([mx, y - d * 0.12], [mx + w * 0.06, y + d * 0.12])}" stroke="${ctx.s.yardStroke}" stroke-width="${fmt(ctx.k.thin)}" opacity="0.5"/>`);
  }
  return marks.join("");
}

/* -------------------------------------------- */
/*  Drawing                                     */
/* -------------------------------------------- */

/**
 * Per-shape size correction.
 *
 * Shapes built around a circle or a narrow nave only span 50–70% of the box
 * they are given, where a plain house spans 92%. Drawn at the same box that
 * makes a temple render *smaller* than the cottage next door, which inverts
 * what the map should say about the building. These factors normalise the
 * apparent footprint; anything at 1 already fills its box.
 */
const SHAPE_SCALE = Object.freeze({
  // Lower than the other round shapes: the beacon's stair and guard hut widen
  // its composition, so it needs less help filling the plot.
  "tower-circle": 1.12,
  circle: 1.3,
  "arcane-hall": 1.24,
  crypt: 1.2,
  church: 1.12,
  "market-tents": 1.06
});

/**
 * A destroyed institution is still ground the village has to route around, so
 * it is drawn as a broken shell rather than omitted (C:2266 destroys
 * institutions outright; the map should show the loss, not hide it).
 */
function ruinOf(w, d, ctx, rng) {
  // Angular chunks, not circles: collapsed masonry breaks along straight
  // edges, and soft discs read as bubbles rather than as a wrecked building.
  const chunks = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rng ? rng.float() : 0.35);
    const r = Math.min(w, d) * (0.1 + (rng ? rng.float() : 0.45) * 0.11);
    const cx = Math.cos(a) * w * 0.24, cy = Math.sin(a) * d * 0.24;
    const spin = (rng ? rng.float() : 0.2) * Math.PI;
    const pts = [];
    for (let k = 0; k < 4; k++) {
      const t = spin + (k / 4) * Math.PI * 2;
      const kr = r * (k % 2 ? 0.72 : 1);
      pts.push([cx + Math.cos(t) * kr, cy + Math.sin(t) * kr]);
    }
    chunks.push(`<path d="${poly(pts)}" fill="${ctx.shade(Math.cos(a), Math.sin(a), { light: ctx.s.rubble, dark: ctx.s.stoneDark })}" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.thin)}" stroke-linejoin="round"/>`);
  }
  return [
    `<rect x="${fmt(-w * 0.42)}" y="${fmt(-d * 0.42)}" width="${fmt(w * 0.84)}" height="${fmt(d * 0.84)}" fill="none" stroke="${ctx.s.ink}" stroke-width="${fmt(ctx.k.line)}" stroke-dasharray="${fmt(ctx.k.line * 5)},${fmt(ctx.k.line * 3.5)}" opacity="0.7"/>`,
    chunks.join("")
  ].join("");
}

/**
 * Draw one building, fitted to a plot and rotated to its street.
 *
 * @param {object} opts
 * @param {string} opts.shape       One of `BUILDING_SHAPES`.
 * @param {{x:number,y:number}} opts.center
 * @param {number} opts.angle       Radians; the street tangent.
 * @param {number} opts.width       Plot frontage.
 * @param {number} opts.depth       Plot depth.
 * @param {object} opts.style       A palette from `PLAN_STYLES`.
 * @param {string} [opts.material]  Roof material; defaults per institution.
 * @param {boolean} [opts.destroyed]
 * @param {boolean} [opts.institution=true]
 * @param {object} [opts.rng]
 * @returns {string} SVG fragment.
 */
export function drawBuilding({
  shape, center, angle = 0, width, depth, style, material = null,
  destroyed = false, institution = true, rng = null, ground = true
}) {
  const palette = resolveStyle(style);
  const draw = SHAPES[shape] ?? SHAPES.house;
  // Buildings sit inside their plot, not flush to its edge.
  const k = SHAPE_SCALE[shape] ?? 1;
  const w = width * 0.94 * k;
  const d = depth * 0.94 * k;
  const ctx = makeContext(palette, {
    angle,
    material: material ?? (institution ? "clay" : "thatch"),
    size: Math.min(w, d),
    ground
  });
  const body = destroyed ? ruinOf(w, d, ctx, rng) : draw(w, d, ctx);
  return `<g transform="translate(${fmt(center.x)} ${fmt(center.y)}) rotate(${fmt(deg(angle))})">${body}</g>`;
}

/**
 * A standalone SVG document for one building shape — a Foundry Tile texture, a
 * handout, or a sheet icon, independent of any generated map.
 *
 * `shadow` defaults on for standalone use but must be OFF for Tile art: a Tile
 * is rotated to face its street, and a shadow baked into the texture turns with
 * it, so a village would end up lit from as many directions as it has streets.
 * The map's own renderer casts one shadow over the whole buildings layer
 * instead, which is why it can keep them.
 */
export function shapeSvg(shape, {
  destroyed = false, size = 512, style, padding = 0.08, background = "none",
  material = null, shadow = true, institution = true, ground = true
} = {}) {
  const palette = resolveStyle(style);
  const box = size * (1 - padding * 2);
  const drop = palette.shadow ?? { dx: 4, dy: 6, blur: 2, color: "#2a221b", opacity: 0.35 };
  const body = drawBuilding({
    shape,
    center: { x: size / 2, y: size / 2 },
    angle: 0,
    width: box,
    depth: box,
    style: palette,
    material,
    destroyed,
    institution,
    ground
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    shadow
      ? `<defs><filter id="vp-shadow" x="-20%" y="-20%" width="150%" height="150%">`
        + `<feDropShadow dx="${drop.dx}" dy="${drop.dy}" stdDeviation="${drop.blur}" flood-color="${drop.color}" flood-opacity="${drop.opacity}"/>`
        + `</filter></defs>`
      : "",
    background === "none" ? "" : `<rect width="${size}" height="${size}" fill="${background}"/>`,
    shadow ? `<g filter="url(#vp-shadow)">${body}</g>` : body,
    "</svg>"
  ].filter(Boolean).join("\n");
}

/** The same, addressed by institution type and level rather than by shape. */
export function institutionSvg(type, options = {}) {
  return shapeSvg(shapeForInstitution(type, options.level ?? 1), {
    ...options,
    material: options.material ?? materialForInstitution(type)
  });
}
