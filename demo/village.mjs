/**
 * The canonical village map, in the browser.
 *
 * The map itself is authored, not generated: the roads, the ground and every
 * plot's position are frozen in `canonical-village-layout.mjs`. What the system
 * decides at runtime is only *how much of it is standing* — which institutions
 * have been founded, and how far down the housing, field and dressing lists
 * Prosperity reaches. `buildVillageProjection` is the function that decides it,
 * and this page calls that one, unchanged, for every frame.
 *
 * Tiles are `<image>` references rather than inlined SVG. Each canonical asset
 * carries what it needs on its own root element — the background's viewBox is
 * `0 0 500 500` against a 6000-unit map, and every housing file sets
 * `fill="none"` and `preserveAspectRatio="none"` there — so lifting the body out
 * of the file drops exactly the attributes that make it draw. Referencing the
 * file is also what Foundry does: a Tile is a texture, not a copy.
 */

import { buildVillageProjection } from "../module/helpers/village-map.mjs";
import {
  CANONICAL_INSTITUTION_SLOTS,
  CANONICAL_VILLAGE_BACKGROUND,
  CANONICAL_VILLAGE_SIZE
} from "../module/helpers/canonical-village-layout.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Foundry's asset route, rewritten as a path relative to this page. */
export function assetUrl(src) {
  return String(src).replace(/^systems\/crows\//, "../");
}

/** The institution types, in the order the projection returns them. */
export const INSTITUTION_TYPES = Object.keys(CANONICAL_INSTITUTION_SLOTS);

/** The full map — every slot filled. Used to size the DOM once, up front. */
const FULL_PROJECTION = buildVillageProjection({
  villageId: "demo",
  prosperity: 10,
  institutions: INSTITUTION_TYPES.map((type, index) => ({ id: `${type}-${index}`, type, level: 1 }))
});

/**
 * A tile as one `<image>`.
 *
 * A Tile is anchored at its middle and turns about that point, so the transform
 * puts the centre on the slot and offsets by half the art — the same order
 * `baseTileData` documents for the Scene.
 */
function tileImage(tile) {
  const node = document.createElementNS(SVG_NS, "image");
  node.setAttribute("width", tile.width);
  node.setAttribute("height", tile.height);
  node.setAttribute(
    "transform",
    `translate(${tile.x} ${tile.y}) rotate(${tile.rotation}) translate(${-tile.width / 2} ${-tile.height / 2})`
  );
  // `href` is the modern spelling; the xlink one keeps older renderers — and
  // the canvas rasterizer behind the PNG export — from drawing nothing.
  node.setAttribute("href", assetUrl(tile.texture.src));
  node.setAttributeNS(XLINK_NS, "xlink:href", assetUrl(tile.texture.src));
  return node;
}

function applyTile(node, tile) {
  const src = assetUrl(tile.texture.src);
  if (node.getAttribute("href") !== src) {
    node.setAttribute("href", src);
    node.setAttributeNS(XLINK_NS, "xlink:href", src);
  }
  node.setAttribute("width", tile.width);
  node.setAttribute("height", tile.height);
  node.setAttribute(
    "transform",
    `translate(${tile.x} ${tile.y}) rotate(${tile.rotation}) translate(${-tile.width / 2} ${-tile.height / 2})`
  );
}

/**
 * Build the map's DOM once, at full extent.
 *
 * Every slot gets a node up front and later updates only hide or show it. The
 * alternative — rebuilding the SVG on each change — re-creates 180 `<image>`
 * elements while a Prosperity slider is being dragged, and each new element
 * starts its texture load again, so the map blinks its way up the scale.
 */
export function createMap(container) {
  const size = CANONICAL_VILLAGE_SIZE;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("xmlns", SVG_NS);

  const background = document.createElementNS(SVG_NS, "image");
  background.setAttribute("x", 0);
  background.setAttribute("y", 0);
  background.setAttribute("width", size);
  background.setAttribute("height", size);
  background.setAttribute("href", assetUrl(CANONICAL_VILLAGE_BACKGROUND));
  background.setAttributeNS(XLINK_NS, "xlink:href", assetUrl(CANONICAL_VILLAGE_BACKGROUND));
  svg.append(background);

  // Layer order follows the projection's `sort`: fields under the village,
  // buildings on the ground, dressing over everything.
  const layers = {};
  const nodes = {};
  for (const kind of ["farmland", "institutions", "housing", "dressing"]) {
    const group = document.createElementNS(SVG_NS, "g");
    group.id = kind;
    nodes[kind] = FULL_PROJECTION[kind].map(tile => {
      const node = tileImage(tile);
      group.append(node);
      return node;
    });
    layers[kind] = group;
    svg.append(group);
  }

  container.replaceChildren(svg);
  return { svg, nodes, size };
}

/**
 * Show the village at this Prosperity with these institutions standing.
 *
 * @returns {object} The projection, for whatever the page wants to report.
 */
export function updateMap(map, { prosperity, founded }) {
  const projection = buildVillageProjection({
    villageId: "demo",
    prosperity,
    institutions: [...founded].map((type, index) => ({ id: `${type}-${index}`, type, level: 1 }))
  });

  // Housing, fields and dressing are ordered prefixes, so slot N is the same
  // slot at every Prosperity — present or absent, never moved.
  for (const kind of ["farmland", "housing", "dressing"]) {
    const shown = projection[kind].length;
    map.nodes[kind].forEach((node, index) => {
      node.style.display = index < shown ? "" : "none";
    });
  }

  // Every institution slot always stands; only what stands on it changes, from
  // the authored art to the unbuilt plot and back.
  projection.institutions.forEach((tile, index) => applyTile(map.nodes.institutions[index], tile));

  return projection;
}

/**
 * Rasterize the map to a PNG blob.
 *
 * The `<image>` hrefs are same-origin, but drawing an SVG that references other
 * files still taints the canvas in some engines, so each asset is inlined as a
 * data URI into a detached copy first — done here, on demand, rather than in the
 * page's own SVG, which would trade a live map for a 3 MB string.
 */
export async function toPng(map, { scale = 1 } = {}) {
  const clone = map.svg.cloneNode(true);
  const cache = new Map();

  await Promise.all([...clone.querySelectorAll("image")].map(async node => {
    if (node.style.display === "none") return node.remove();
    const src = node.getAttribute("href");
    if (!cache.has(src)) {
      cache.set(src, fetch(src)
        .then(response => response.text())
        .then(text => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`));
    }
    const uri = await cache.get(src);
    node.setAttribute("href", uri);
    node.setAttributeNS(XLINK_NS, "xlink:href", uri);
  }));

  const markup = new XMLSerializer().serializeToString(clone);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("the map could not be rasterized"));
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(markup)))}`;
  });

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.round(map.size * scale);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}
