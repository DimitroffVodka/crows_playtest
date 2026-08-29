/**
 * Browser adapter for the village generator.
 *
 * The planner and the plan renderer are already pure — they read no globals and
 * touch no Scene — so the demo runs the shipped modules unmodified rather than a
 * copy. Only two things have to be bridged:
 *
 * 1. **Asset paths.** The stamp catalogue addresses art as `systems/crows/...`,
 *    which is Foundry's route, not a URL this page can fetch. `assetUrl` maps it
 *    onto the repository layout the demo is served from.
 *
 * 2. **Compositing.** In Foundry a village map is a Scene: the plan renders the
 *    *ground* and every building is a separate Tile standing on it. There are no
 *    Tiles here, so the buildings are laid into the same SVG using the transform
 *    `village-plan-draw` already uses for their cast shadows — same centre, same
 *    rotation, same box — which is what keeps a building sitting on its own
 *    shadow instead of beside it.
 *
 * The result is one self-contained SVG: no external references, so it can be
 * downloaded and opened anywhere.
 */

import { renderPlanToSvg } from "../../module/helpers/village-plan-draw.mjs";
import { stampFootprints, SCENE_DEFAULTS } from "../../module/helpers/village-map.mjs";
import {
  FARM_PLOT_STAMPS,
  HOUSING_STAMPS,
  INSTITUTION_STAMPS,
  STAMP_CANVAS,
  TREE_STAMPS,
  contentBoxFor,
  shadowSrcFor,
  slugFor,
  stampBody,
  stampShadowBody
} from "../../module/helpers/village-stamp-art.mjs";

/** Foundry's asset route, rewritten as a path relative to this page. */
export function assetUrl(src) {
  return String(src).replace(/^systems\/crows\//, "../../");
}

/**
 * Square boxes for the stamps, overriding the Scene's 4:3 institution tile.
 *
 * A Foundry Tile sets `fit: "fill"`, so a square texture in a 4:3 box is simply
 * stretched. An SVG `<symbol>` cannot be stretched and letterboxed at once, and
 * the cast shadows in `village-plan-draw` are already drawn with the default
 * `xMidYMid meet` — so a 4:3 box here would shrink each building inside its own
 * shadow's box and leave the two out of register.
 *
 * Square sidesteps it: the art is drawn on a square canvas and the canonical map
 * authors square slots for exactly this reason, so building and shadow land on
 * the same rectangle and nothing is stretched. `fitTileToPlot` still scales the
 * result down to the plot the planner gave it.
 */
const FOOTPRINT_OPTIONS = Object.freeze({
  ...SCENE_DEFAULTS,
  institutionWidthGrid: 4,
  institutionHeightGrid: 4,
  housingWidthGrid: 2,
  housingHeightGrid: 2
});

const round = n => Math.round(n * 100) / 100;

/**
 * Every stamp the map can use, fetched once.
 *
 * Fetched rather than bundled because these are the same files Foundry serves;
 * a build step that inlined them would be a second copy to keep in step. A
 * stamp that fails to load is simply absent — `renderPlanToSvg` falls back to
 * drawing that element itself, so a bad fetch costs detail, never a map.
 */
export async function loadStampArt() {
  const bodies = {};
  const boxes = {};
  const buildings = {};
  const dressingEntries = [...TREE_STAMPS, ...FARM_PLOT_STAMPS];

  const fetchText = async src => {
    const response = await fetch(assetUrl(src));
    if (!response.ok) throw new Error(`${response.status} ${src}`);
    return response.text();
  };

  const dressing = dressingEntries.map(async entry => {
    const body = stampBody(await fetchText(entry.src));
    if (!body) return;
    const id = `vp-${slugFor(entry.src)}`;
    bodies[id] = { body };
    boxes[id] = contentBoxFor(entry.src);
  });

  const stamps = [...Object.values(INSTITUTION_STAMPS), ...HOUSING_STAMPS].flatMap(entry => [
    fetchText(entry.src).then(text => {
      const body = stampBody(text);
      if (body) buildings[`vb-${slugFor(entry.src)}`] = body;
    }),
    fetchText(shadowSrcFor(entry.src)).then(text => {
      const body = stampShadowBody(text);
      if (body) bodies[`vp-shadow-${slugFor(entry.src)}`] = { body };
    })
  ]);

  const results = await Promise.allSettled([...dressing, ...stamps]);
  const failed = results.filter(r => r.status === "rejected").length;

  // The dressing layer picks a canopy by hashing a tree's position against this
  // list, so its order decides which tree gets which crown. Rebuilt from the
  // catalogue rather than from fetch completion order, which is arrival time:
  // otherwise the same seed draws a different wood on every reload, and a
  // different one again from what Foundry draws.
  const order = dressingEntries
    .map(entry => `vp-${slugFor(entry.src)}`)
    .filter(id => bodies[id]);

  return { sprites: order.length ? { bodies, boxes, order } : null, buildings, failed };
}

/** Which stamp stands on a given footprint. Mirrors the Tile art resolution. */
function stampFor(spot) {
  return spot.kind === "institution"
    ? INSTITUTION_STAMPS[spot.type]
    : HOUSING_STAMPS[spot.index % HOUSING_STAMPS.length];
}

/**
 * The buildings layer, as Foundry's Tiles would stand.
 *
 * The transform is the one `drawStampShadows` uses for the cast shadows, minus
 * their light-angle offset: rotation about the building's centre, displacement
 * applied outside it. Sharing it is what keeps a building on its own shadow
 * rather than beside it.
 */
function buildingsLayer(footprints, buildings) {
  const used = new Map();
  const uses = [];

  for (const spot of footprints) {
    const entry = stampFor(spot);
    const id = entry ? `vb-${slugFor(entry.src)}` : null;
    if (!id || !buildings[id]) continue;
    used.set(id, buildings[id]);
    const deg = (spot.angle * 180) / Math.PI;
    uses.push(
      `<g transform="translate(${round(spot.center.x)} ${round(spot.center.y)}) `
      + `rotate(${round(deg)}) translate(${round(-spot.width / 2)} ${round(-spot.height / 2)})">`
      + `<use href="#${id}" width="${round(spot.width)}" height="${round(spot.height)}"/></g>`
    );
  }

  if (!uses.length) return "";
  const defs = [...used].map(([id, body]) =>
    `<symbol id="${id}" viewBox="0 0 ${STAMP_CANVAS} ${STAMP_CANVAS}" overflow="visible">${body}</symbol>`
  ).join("");
  return `<defs>${defs}</defs><g id="buildings">${uses.join("")}</g>`;
}

/**
 * Render a plan to one standalone SVG.
 *
 * @param {object}  plan              A plan from `buildVillagePlan`.
 * @param {object}  [options]
 * @param {object}  [options.art]     The result of `loadStampArt`.
 * @param {string}  [options.style]   A `PLAN_STYLES` key.
 * @param {boolean} [options.showTitle]
 * @param {boolean} [options.stamps]  False draws the procedural buildings
 *                                    instead of standing the authored art.
 */
export function renderVillageSvg(plan, { art = null, style, showTitle = true, stamps = true } = {}) {
  const sprites = art?.sprites ?? null;

  // Without the authored set there is nothing to stand on the ground, so the
  // renderer draws the buildings itself — the same path every unit test takes.
  if (!stamps || !art) return renderPlanToSvg(plan, { style, showTitle, sprites });

  const footprints = stampFootprints(plan, FOOTPRINT_OPTIONS);
  const ground = renderPlanToSvg(plan, {
    style,
    showTitle,
    sprites,
    footprints,
    // The ground carries the cast shadows; the buildings go on top of it.
    showBuildings: false
  });
  return ground.replace(/<\/svg>\s*$/, `${buildingsLayer(footprints, art.buildings)}</svg>`);
}
