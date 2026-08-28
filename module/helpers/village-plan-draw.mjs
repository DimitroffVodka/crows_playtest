/**
 * Render a village plan to SVG.
 *
 * Kept separate from the planner so layout and appearance can change
 * independently, and so the same plan can be drawn at Scene-background
 * resolution, as a handout, or as a thumbnail without regenerating anything.
 *
 * SVG rather than canvas because it is a pure string: it needs no DOM, so the
 * output can be produced in a unit test or a CLI preview, and Foundry can
 * rasterize it when a Scene background is wanted.
 */

import { PLAN_FORMS } from "./village-plan.mjs";
import { drawBuilding, materialForInstitution, shapeForInstitution } from "./village-plan-art.mjs";
import { DEFAULT_PLAN_STYLE, PLAN_STYLES, resolveStyle } from "./village-plan-style.mjs";
import { add, dist, fromAngle, lerp, perp, rectRing, scale, sub } from "./village-plan-geom.mjs";
import {
  HOUSING_SLUGS,
  INSTITUTION_SLUGS,
  STAMP_CANVAS,
  STAMP_SHADOW_BLUR_RATIO,
  STAMP_SHADOW_OFFSET
} from "./village-stamp-art.mjs";

/** Re-exported for callers that reach for palettes alongside the renderer. */
export { PLAN_STYLES };

/**
 * The village's ground, for use as a Scene backdrop.
 *
 * Buildings are deliberately omitted: on a Scene they are Tiles, so drawing
 * them into the backdrop as well would render every building twice — once
 * painted into the floor and once as the Tile standing on it.
 */
export function villageBackgroundSvg(plan, opts = {}) {
  return renderPlanToSvg(plan, { ...opts, showBuildings: false });
}

/** The one shadow filter the buildings layer uses. */
function shadowDefs(s) {
  const sh = s.shadow ?? { dx: 4, dy: 6, blur: 2, color: "#2a221b", opacity: 0.35 };
  // Scaled up from the card art's 400-unit canvas to plan space.
  const k = 6;
  return `<defs><filter id="vp-shadow" x="-20%" y="-20%" width="150%" height="150%">`
    + `<feDropShadow dx="${sh.dx * k}" dy="${sh.dy * k}" stdDeviation="${sh.blur * k}" flood-color="${sh.color}" flood-opacity="${sh.opacity}"/>`
    + `</filter></defs>`;
}

/**
 * Villagers roof with what is to hand, so housing mixes wood and thatch rather
 * than all matching. Weighted toward wood: a village is mostly housing, and
 * thatch is the most saturated colour in the palette — an all-thatch village
 * turns the whole map gold and leaves the institutions nothing to stand out
 * against. Derived from the plot id so it is stable across re-renders.
 */
function housingMaterial(plotId) {
  let h = 0;
  for (let i = 0; i < plotId.length; i++) h = (h * 31 + plotId.charCodeAt(i)) >>> 0;
  return h % 3 === 0 ? "thatch" : "wood";
}

const fmt = n => (Math.round(n * 100) / 100).toString();
const path = ring => ring.map((p, i) => `${i ? "L" : "M"}${fmt(p.x)} ${fmt(p.y)}`).join(" ") + " Z";
const line = points => points.map((p, i) => `${i ? "L" : "M"}${fmt(p.x)} ${fmt(p.y)}`).join(" ");

/**
 * @param {object} plan   Output of `buildVillagePlan`.
 * @param {object} [opts]
 * @param {string|object} [opts.style="parchment"]
 * @param {boolean} [opts.showVacant=false]  Draw unbuilt plots as faint outlines.
 * @param {boolean} [opts.showTitle=true]
 * @param {boolean} [opts.showPlotIds=false] Debug aid.
 * @param {boolean} [opts.showBuildings=true] Off for a Scene backdrop, where
 *   the buildings are Tiles and drawing them here would double every one.
 * @returns {string} A standalone SVG document.
 */
export function renderPlanToSvg(plan, opts = {}) {
  const s = resolveStyle(opts.style ?? DEFAULT_PLAN_STYLE);
  const { width, height } = plan;
  const ruin = plan.form === PLAN_FORMS.RUIN;
  const out = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push(shadowDefs(s));
  out.push(spriteDefs(opts.sprites?.bodies));
  // A ruin village is defined by the line between sheltered ground and the
  // wilds, so the exterior is painted as hostile ground and the shell reads as
  // the boundary between them. An open village has no such division.
  out.push(`<rect width="${width}" height="${height}" fill="${ruin ? (s.wilds ?? s.paper) : s.paper}"/>`);

  if (!ruin) {
    drawWater(out, plan, s);
    drawFarmland(out, plan, s);
    drawFarmsteads(out, plan, s, opts);
  }

  drawBoundary(out, plan, s, ruin);
  if (ruin) drawRubble(out, plan, s);

  drawStreets(out, plan, s);
  drawBridges(out, plan, s);
  drawSquare(out, plan, s);
  // Only when the buildings are Tiles: drawn buildings carry the layer filter
  // and would otherwise be shadowed twice.
  if (opts.showBuildings === false) drawStampShadows(out, plan, s, opts);
  if (opts.showBuildings !== false) drawBuildings(out, plan, s, opts);

  if (ruin) drawTowers(out, plan, s);
  drawWells(out, plan, s);
  if (!ruin) drawTrees(out, plan, s, opts);
  if (ruin) drawDebris(out, plan, s);

  if (opts.showTitle !== false && plan.name) drawTitle(out, plan, s);
  out.push("</svg>");
  return out.join("\n");
}

function drawWater(out, plan, s) {
  const water = plan.boundary.water;
  if (!water) return;
  out.push(`<g id="water">`);
  out.push(`<path d="${line(water.path)}" fill="none" stroke="${s.water}" stroke-width="${water.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(`<path d="${line(water.path)}" fill="none" stroke="${s.waterDeep}" stroke-width="${water.width * 0.55}" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(`</g>`);
}

function drawFarmland(out, plan, s) {
  const { fields = [], orchards = [] } = plan.dressing ?? {};
  if (!fields.length && !orchards.length) return;
  out.push(`<g id="farmland">`);
  for (const f of fields) {
    out.push(`<path d="${path(f.ring)}" fill="${s.field}" stroke="${s.fieldFurrow}" stroke-width="3"/>`);
    out.push(furrows(f, s));
  }
  for (const o of orchards) {
    out.push(`<path d="${path(o.ring)}" fill="${s.orchard}" stroke="${s.fieldFurrow}" stroke-width="3"/>`);
    out.push(orchardRows(o, s));
  }
  out.push(`</g>`);
}

/** Parallel plough lines clipped to the field by simple bounding sampling. */
function furrows(field, s) {
  const dir = fromAngle(field.furrow);
  const n = perp(dir);
  const c = field.center;
  const extent = Math.max(...field.ring.map(p => dist(p, c)));
  const strokes = [];
  for (let d = -extent; d <= extent; d += 46) {
    const mid = add(c, scale(n, d));
    const a = add(mid, scale(dir, -extent));
    const b = add(mid, scale(dir, extent));
    const seg = clipSegmentToRing(a, b, field.ring);
    if (seg) strokes.push(`M${fmt(seg[0].x)} ${fmt(seg[0].y)}L${fmt(seg[1].x)} ${fmt(seg[1].y)}`);
  }
  return `<path d="${strokes.join(" ")}" stroke="${s.fieldFurrow}" stroke-width="4" fill="none" opacity="0.75"/>`;
}

function orchardRows(orchard, s) {
  const dir = fromAngle(orchard.furrow);
  const n = perp(dir);
  const c = orchard.center;
  const extent = Math.max(...orchard.ring.map(p => dist(p, c)));
  const dots = [];
  for (let d = -extent; d <= extent; d += 78) {
    const mid = add(c, scale(n, d));
    const a = add(mid, scale(dir, -extent));
    const b = add(mid, scale(dir, extent));
    const seg = clipSegmentToRing(a, b, orchard.ring);
    if (!seg) continue;
    const length = dist(seg[0], seg[1]);
    for (let t = 40; t < length - 20; t += 74) {
      const p = lerp(seg[0], seg[1], t / length);
      dots.push(`<circle cx="${fmt(p.x)}" cy="${fmt(p.y)}" r="17" fill="${s.tree}"/>`);
    }
  }
  return dots.join("");
}

/**
 * Clip a segment to a ring by walking its edges and keeping the two extreme
 * crossings. Adequate for the convex-ish sector cells farmland produces.
 */
function clipSegmentToRing(a, b, ring) {
  const hits = [];
  for (let i = 0; i < ring.length; i++) {
    const c = ring[i], d = ring[(i + 1) % ring.length];
    const r = sub(b, a), sdir = sub(d, c);
    const denom = r.x * sdir.y - r.y * sdir.x;
    if (Math.abs(denom) < 1e-9) continue;
    const t = ((c.x - a.x) * sdir.y - (c.y - a.y) * sdir.x) / denom;
    const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) hits.push({ t, p: add(a, scale(r, t)) });
  }
  if (hits.length < 2) return null;
  hits.sort((x, y) => x.t - y.t);
  return [hits[0].p, hits[hits.length - 1].p];
}

function drawBoundary(out, plan, s, ruin) {
  const { ring, interior, gates, wallThickness } = plan.boundary;
  out.push(`<g id="boundary">`);
  if (ruin) {
    // Sheltered ground first, then the shell as a thick stroke centred on the
    // ring. Stroking guarantees a band of exactly `wallThickness` regardless of
    // how the inset behaved, where filling between two rings depends on an
    // offset that can collapse on a reflex outline.
    out.push(`<path d="${path(ring)}" fill="${s.paper}"/>`);
    out.push(`<path d="${path(ring)}" fill="none" stroke="${s.wallFill}" stroke-width="${wallThickness}"/>`);
    out.push(`<path d="${path(ring)}" fill="none" stroke="${s.wall}" stroke-width="${Math.max(8, wallThickness * 0.18)}"/>`);
    // Breaches are punched by over-painting, which is simpler and more robust
    // than splitting the ring into arcs around every gap.
    for (const g of gates) {
      out.push(`<circle cx="${fmt(g.point.x)}" cy="${fmt(g.point.y)}" r="${g.width / 2}" fill="${s.paper}"/>`);
    }
  } else {
    // The open-form extent is a generation construct, not a feature on the
    // ground; drawing it puts a large artificial circle around the village.
  }
  out.push(`</g>`);
}

function drawRubble(out, plan, s) {
  const masses = plan.boundary.rubble ?? [];
  if (!masses.length) return;
  out.push(`<g id="rubble">`);
  for (const m of masses) {
    out.push(`<path d="${path(m.ring)}" fill="${s.rubble}" stroke="${s.wall}" stroke-width="4" opacity="0.9"/>`);
  }
  out.push(`</g>`);
}

function drawStreets(out, plan, s) {
  out.push(`<g id="streets">`);
  // Two passes so junctions merge cleanly: all casings, then all fills.
  for (const street of plan.streets.streets) {
    out.push(`<path d="${line(street.points)}" fill="none" stroke="${s.roadEdge}" stroke-width="${street.width + 14}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  for (const street of plan.streets.streets) {
    out.push(`<path d="${line(street.points)}" fill="none" stroke="${s.road}" stroke-width="${street.width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  out.push(`</g>`);
}

/** Plank decks where streets cross water. Drawn over the road so the deck reads on top. */
function drawBridges(out, plan, s) {
  const bridges = plan.streets?.bridges ?? [];
  if (!bridges.length) return;
  out.push(`<g id="bridges">`);
  for (const b of bridges) {
    const deck = rectRing(b.point, b.length, b.width, b.angle);
    out.push(`<path d="${path(deck)}" fill="${s.wallFill}" stroke="${s.ink}" stroke-width="6"/>`);
    // A few planks across the span sell it as a bridge rather than a slab.
    const along = fromAngle(b.angle);
    const across = perp(along);
    for (let t = -b.length / 2 + 20; t < b.length / 2 - 10; t += 34) {
      const mid = add(b.point, scale(along, t));
      const p0 = add(mid, scale(across, -b.width / 2));
      const p1 = add(mid, scale(across, b.width / 2));
      out.push(`<path d="M${fmt(p0.x)} ${fmt(p0.y)}L${fmt(p1.x)} ${fmt(p1.y)}" stroke="${s.ink}" stroke-width="3" opacity="0.5"/>`);
    }
  }
  out.push(`</g>`);
}

function drawSquare(out, plan, s) {
  const sq = plan.streets.square;
  out.push(`<path id="square" d="${path(sq.ring)}" fill="${s.square}" stroke="${s.roadEdge}" stroke-width="6"/>`);
}

/**
 * Buildings, drawn as overhead structures fitted to their plots.
 *
 * The shape comes from the institution's type and effective level, so a village
 * that upgrades its temple sees a church become a cathedral on the map without
 * anything else changing. Housing gets the generic house form.
 */
function drawBuildings(out, plan, s, opts) {
  // One filter over the whole layer, not one per building: the shadow is then
  // cast in a single direction across the map, where a per-building filter
  // would rotate with each building and point twelve different ways.
  out.push(`<g id="buildings" filter="url(#vp-shadow)">`);
  for (const plot of plan.plots) {
    if (plot.use === "vacant") {
      if (opts.showVacant) {
        out.push(`<path d="${path(plot.ring)}" fill="none" stroke="${s.vacant}" stroke-width="3" stroke-dasharray="10 12"/>`);
      }
      continue;
    }
    const institution = plot.use === "institution";
    // Plot rectangles run frontage-along-street; the building's local frame
    // faces the street with -y, so it is rotated a quarter turn from the plot.
    out.push(drawBuilding({
      shape: institution ? shapeForInstitution(plot.institutionType, plot.institutionLevel ?? 1) : "house",
      center: plot.center,
      angle: plot.angle + Math.PI / 2,
      width: plot.depth,
      depth: plot.frontage,
      style: s,
      material: institution ? materialForInstitution(plot.institutionType) : housingMaterial(plot.id),
      destroyed: Boolean(plot.destroyed),
      institution
    }));
    if (opts.showPlotIds && institution) {
      out.push(`<text x="${fmt(plot.center.x)}" y="${fmt(plot.center.y - plot.frontage * 0.62)}" font-size="46" fill="${s.ink}" text-anchor="middle">${plot.institutionType}</text>`);
    }
  }
  out.push(`</g>`);
}

function drawTowers(out, plan, s) {
  const towers = plan.boundary.towers ?? [];
  if (!towers.length) return;
  out.push(`<g id="towers">`);
  for (const t of towers) {
    out.push(`<circle cx="${fmt(t.point.x)}" cy="${fmt(t.point.y)}" r="${t.radius}" fill="${s.wallFill}" stroke="${s.ink}" stroke-width="6"/>`);
  }
  out.push(`</g>`);
}

function drawWells(out, plan, s) {
  const wells = plan.dressing?.wells ?? [];
  for (const w of wells) {
    out.push(`<circle cx="${fmt(w.center.x)}" cy="${fmt(w.center.y)}" r="${w.radius}" fill="none" stroke="${s.ink}" stroke-width="7"/>`);
  }
}

function drawDebris(out, plan, s) {
  const debris = plan.dressing?.debris ?? [];
  if (!debris.length) return;
  out.push(`<g id="debris" opacity="0.5">`);
  for (const d of debris) {
    out.push(`<circle cx="${fmt(d.center.x)}" cy="${fmt(d.center.y)}" r="${d.radius}" fill="${s.rubble}"/>`);
  }
  out.push(`</g>`);
}

/**
 * Symbol definitions for any inlined stamps this backdrop uses.
 *
 * One `<symbol>` per sprite, referenced by `<use>`. A village carries a couple
 * of hundred trees; inlining each crown's twenty-odd paths at every position
 * would produce a multi-megabyte backdrop, where `<use>` costs one element
 * apiece. The references are internal, so they still resolve when the file is
 * loaded as a texture.
 */
function spriteDefs(sprites) {
  const entries = Object.entries(sprites ?? {});
  if (!entries.length) return "";
  const out = [`<defs>`];
  for (const [id, sprite] of entries) {
    if (!sprite?.body) continue;
    out.push(`<symbol id="${id}" viewBox="0 0 ${STAMP_CANVAS} ${STAMP_CANVAS}" overflow="visible">${sprite.body}</symbol>`);
  }
  out.push(`</defs>`);
  return out.length > 2 ? out.join("") : "";
}

/**
 * Place one sprite so its *ink* — not its canvas — lands on the target box.
 *
 * The stamps are drawn on a shared 512 square with the artwork sitting wherever
 * it naturally falls, so scaling by the canvas would size a small canopy and a
 * wide one identically. Scaling by the measured content box preserves the size
 * relationships the set was drawn with.
 */
function useSprite(id, box, centre, targetWidth) {
  const scale = targetWidth / box.width;
  const width = STAMP_CANVAS * scale;
  const x = centre.x - (box.x + box.width / 2) * scale;
  const y = centre.y - (box.y + box.height / 2) * scale;
  return `<use href="#${id}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(width)}"/>`;
}

/**
 * Trees.
 *
 * With crown sprites supplied these are the drawn canopies from the art set,
 * varied by a hash of position so a wood is not one crown repeated. Without
 * them — any caller that renders a plan without first loading the sprites, which
 * includes every test — they stay the flat discs they have always been, so the
 * backdrop never depends on the art being fetchable.
 */
function drawTrees(out, plan, s, opts = {}) {
  const trees = plan.dressing?.trees ?? [];
  if (!trees.length) return;
  const canopies = (opts.sprites?.order ?? []).filter(id => id.startsWith("vp-tree-canopy"));
  out.push(`<g id="trees">`);
  for (const t of trees) {
    if (!canopies.length) {
      out.push(`<circle cx="${fmt(t.center.x)}" cy="${fmt(t.center.y)}" r="${t.radius}" fill="${s.tree}" stroke="${s.treeInk}" stroke-width="3"/>`);
      continue;
    }
    // Position-derived so a re-render picks the same crown for the same tree.
    const pick = canopies[Math.abs(Math.round(t.center.x * 31 + t.center.y * 17)) % canopies.length];
    out.push(useSprite(pick, opts.sprites.boxes[pick], t.center, t.radius * 2));
  }
  out.push(`</g>`);
}

/**
 * Cast shadows for the stamped buildings, painted onto the ground.
 *
 * The buildings are Tiles and a Tile takes no SVG filter, so the shadow the art
 * set was drawn to have cannot travel with it. Painting it here is also the only
 * way to keep one light over the whole map: each building is rotated to face its
 * street, and an offset carried inside that rotation turns with the building.
 * So the silhouette is rotated with its building while the displacement is
 * applied *outside* the rotation, in world space — the same reasoning behind the
 * single layer-wide filter on the drawn buildings.
 *
 * Drawn before the boundary and streets so a shadow never lies over a wall it
 * should fall behind.
 */
function drawStampShadows(out, plan, s, opts = {}) {
  const sprites = opts.sprites;
  const footprints = opts.footprints ?? [];
  if (!sprites?.bodies || !footprints.length) return;
  const shadows = [];
  for (const spot of footprints) {
    const id = spot.kind === "institution"
      ? `vp-shadow-${INSTITUTION_SLUGS[spot.type] ?? ""}`
      : `vp-shadow-${HOUSING_SLUGS[spot.index % HOUSING_SLUGS.length]}`;
    if (!sprites.bodies[id]) continue;
    const { width: w, height: h } = spot;
    // World-space displacement, scaled to the building but never rotated.
    const dx = (STAMP_SHADOW_OFFSET.dx / STAMP_CANVAS) * w;
    const dy = (STAMP_SHADOW_OFFSET.dy / STAMP_CANVAS) * h;
    const deg = (spot.angle * 180) / Math.PI;
    shadows.push(
      `<g transform="translate(${fmt(spot.center.x + dx)} ${fmt(spot.center.y + dy)}) `
      + `rotate(${fmt(deg)}) translate(${fmt(-w / 2)} ${fmt(-h / 2)})">`
      + `<use href="#${id}" width="${fmt(w)}" height="${fmt(h)}"/></g>`
    );
  }
  if (!shadows.length) return;
  // One blur over the layer, not one per building: the softening is isotropic,
  // so it has none of the directional trouble that forces the offset outside
  // each rotation, and a single filter is one raster pass instead of thirty.
  // Sized from the median building so it tracks how big buildings are on this
  // map rather than being a constant that suits one scale and no other.
  const widths = footprints.map(f => f.width).sort((a, b) => a - b);
  const median = widths[Math.floor(widths.length / 2)] ?? 0;
  const blur = median * STAMP_SHADOW_BLUR_RATIO;
  const filter = blur > 0
    ? `<defs><filter id="vp-stamp-shadow" x="-12%" y="-12%" width="124%" height="124%">`
      + `<feGaussianBlur stdDeviation="${fmt(blur)}"/></filter></defs>`
    : "";
  out.push(`${filter}<g id="stamp-shadows"${blur > 0 ? ` filter="url(#vp-stamp-shadow)"` : ""}>`
    + `${shadows.join("")}</g>`);
}

/**
 * Farmsteads — discrete fenced plots on the outskirts.
 *
 * Deliberately separate from `drawFarmland`, which fills the planner's
 * arbitrary polygon rings with furrows. These stamps are self-contained square
 * plots with their own fences, gates and scarecrows; they cannot be stretched
 * to fill a ring without tearing, so they are placed as whole objects and the
 * ring treatment is left alone underneath them.
 */
function drawFarmsteads(out, plan, s, opts = {}) {
  const steads = plan.dressing?.farmsteads ?? [];
  const plots = (opts.sprites?.order ?? []).filter(id => id.startsWith("vp-farm-plot"));
  if (!steads.length || !plots.length) return;
  out.push(`<g id="farmsteads">`);
  for (const [i, stead] of steads.entries()) {
    const pick = plots[i % plots.length];
    out.push(useSprite(pick, opts.sprites.boxes[pick], stead.center, stead.size));
  }
  out.push(`</g>`);
}

function drawTitle(out, plan, s) {
  const y = plan.height - 120;
  out.push(`<text x="${plan.width / 2}" y="${y}" font-size="132" font-family="Georgia, serif" fill="${s.title}" text-anchor="middle" letter-spacing="10">${escapeXml(plan.name)}</text>`);
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]));
}
