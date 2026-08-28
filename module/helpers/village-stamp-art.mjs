/**
 * The hand-authored Crows village art set, shipped as native vector stamps.
 *
 * ## Why stamps alongside drawn art
 *
 * `village-plan-art.mjs` draws buildings procedurally so they can be fitted to
 * whatever plot the planner produced. That is the right answer for filler — a
 * street of houses should follow its street — but it cannot give an institution
 * an *identity*. A drawn "guild hall" is a shape; the Auction House stamp is a
 * grand octagonal bidding amphitheater with a cupola skylight and a locked
 * relic dais. Players read the second one off the map.
 *
 * So the two paths are composed rather than swapped: a stamp wins wherever one
 * exists, and the drawn art fills every gap behind it. `resolveArt` in
 * `village-map.mjs` already tries `artSet.resolve()` before `artSet.assets`,
 * so `composeStampArtSet` needs no resolver changes — it puts the stamps on
 * `resolve` and the drawn paths on `assets`.
 *
 * ## What has no stamp, and why that is fine
 *
 * - **Destroyed states.** The set has no ruin art. Every institution's
 *   `.destroyed` visual falls through to the drawn ruin, which is why the
 *   composition order matters more than the stamp coverage.
 * - **Level progressions.** `INSTITUTION_ART_KEYS` gives `blacksmith` and
 *   `temple` two bands each (smith -> foundry, church -> cathedral) and the set
 *   ships one asset apiece — the level-1 form. `stampForInstitution` is keyed by
 *   type *and* level and checks `${type}.level${n}` first, so dropping a
 *   `foundry` stamp in later is a data edit here, not a code change.
 *
 * ## Shadows
 *
 * Every stamp has an aligned companion at `<name>.shadow.svg` holding the same
 * silhouette displaced along a fixed light angle. They are deliberately *not*
 * carried on the art entry: `artEntrySource` whitelists `src`/`label`/
 * `substituted`/`substitutionReason` and drops everything else, so a `shadow`
 * field would vanish silently. `shadowSrcFor` derives the companion path from
 * the stamp path instead, which keeps the two from drifting apart.
 */

export const VILLAGE_STAMP_ASSET_ROOT = "systems/crows/assets/";

/** Light angle the whole set is drawn to; shadow SVGs bake this as a translate. */
export const STAMP_SHADOW_OFFSET = Object.freeze({ dx: 28, dy: 16 });

/**
 * Softening applied to cast shadows, as a fraction of a building's width.
 *
 * The set draws its shadows as hard-edged flat silhouettes, which is right for
 * a single asset viewed on its own — the design package's preview composites
 * them exactly that way. On a village map it is not: a hard copy displaced 5.5%
 * of the building's width reads as a misregistered duplicate rather than as a
 * shadow, and it sits next to drawn buildings that *are* softened, so the two
 * halves of the map disagree about what a shadow looks like.
 *
 * The value keeps the drawn map's own blur-to-offset proportion. That path uses
 * `dx 4 / dy 6 / blur 2` scaled by 6, so its blur is a little over a quarter of
 * its offset; at the stamps' 32/512 offset that lands near 0.018 of the width.
 * Matching the ratio rather than the absolute blur is what keeps the two
 * consistent as buildings change size.
 */
export const STAMP_SHADOW_BLUR_RATIO = 0.018;

/** The ink and shadow contract every asset in this set is drawn against. */
export const STAMP_PALETTE = Object.freeze({
  ink: "#010206",
  foliageInk: "#091011",
  shadowColor: "#9699AE",
  shadowOpacity: 0.46
});

function stamp(path, label) {
  return Object.freeze({ src: `${VILLAGE_STAMP_ASSET_ROOT}${path}`, label });
}

/**
 * Institution type -> stamp. Keys match `INSTITUTION_ART_KEYS` in
 * `village-map.mjs`; the filenames are kebab-case because that is how the
 * design package names them.
 */
export const INSTITUTION_STAMPS = Object.freeze({
  alchemist: stamp("institutions/alchemist.svg", "Alchemist"),
  auctionHouse: stamp("institutions/auction-house.svg", "Auction House"),
  barracks: stamp("institutions/barracks.svg", "Barracks"),
  beacon: stamp("institutions/beacon.svg", "Beacon"),
  blacksmith: stamp("institutions/blacksmith.svg", "Blacksmith"),
  bookseller: stamp("institutions/bookseller.svg", "Bookseller"),
  crypt: stamp("institutions/crypt.svg", "Crypt"),
  enchanter: stamp("institutions/enchanter.svg", "Enchanter"),
  generalStore: stamp("institutions/general-store.svg", "General Store"),
  inn: stamp("institutions/inn.svg", "Inn"),
  stables: stamp("institutions/stables.svg", "Stables"),
  temple: stamp("institutions/temple.svg", "Temple")
});

/**
 * Per-level overrides, checked before the base stamp.
 *
 * Empty today: the set has no `foundry` or `cathedral` art. Kept as a declared
 * seam so the progression that already exists in `INSTITUTION_ART_KEYS` has
 * somewhere to land without reworking the resolver.
 */
export const INSTITUTION_LEVEL_STAMPS = Object.freeze({});

/** Replaces the straw-house pool; a street of these reads as a settlement. */
export const HOUSING_STAMPS = Object.freeze([
  stamp("rural/farmhouses/farmhouse-cottage.svg", "Farmhouse Cottage"),
  stamp("rural/farmhouses/farmhouse-longhouse.svg", "Farmhouse Longhouse"),
  stamp("rural/farmhouses/farmhouse-barnstead.svg", "Barn-Attached Homestead")
]);

/**
 * Overhead crowns for the dressing layer.
 *
 * Ordered small -> large -> clustered. `tree-copse` and `tree-forest-edge` are
 * multi-crown assets meant for massing at a boundary, not for standing in as a
 * single tree, so callers picking one tree per dressing point should draw from
 * `TREE_CANOPY_STAMPS` and reserve the clusters for edges.
 */
export const TREE_CANOPY_STAMPS = Object.freeze([
  stamp("rural/trees/tree-canopy-small.svg", "Small Canopy Tree"),
  stamp("rural/trees/tree-canopy-medium.svg", "Medium Canopy Tree"),
  stamp("rural/trees/tree-canopy-wide.svg", "Wide Canopy Tree"),
  stamp("rural/trees/tree-canopy-irregular.svg", "Irregular Canopy Tree")
]);

export const TREE_CLUSTER_STAMPS = Object.freeze([
  stamp("rural/trees/tree-copse.svg", "Dense Tree Copse"),
  stamp("rural/trees/tree-forest-edge.svg", "Forest-Edge Cluster")
]);

export const TREE_STAMPS = Object.freeze([...TREE_CANOPY_STAMPS, ...TREE_CLUSTER_STAMPS]);

/**
 * Net-new terrain: self-contained fenced plots.
 *
 * These are *not* a replacement for the planner's `fields` and `orchards`,
 * which are arbitrary polygon rings filled with furrow strokes. A 512-square
 * stamp cannot fill an arbitrary ring, so these are placed as discrete
 * farmsteads on the outskirts and the ring treatment stays as it is.
 */
export const FARM_PLOT_STAMPS = Object.freeze([
  stamp("rural/farm-plots/farm-plot-row-crops.svg", "Row-Crop Field"),
  stamp("rural/farm-plots/farm-plot-kitchen-garden.svg", "Kitchen Garden"),
  stamp("rural/farm-plots/farm-plot-orchard.svg", "Orchard and Pasture Plot")
]);

/** Every asset in the set is drawn on this square. */
export const STAMP_CANVAS = 512;

/**
 * Where the ink actually sits inside each 512 canvas.
 *
 * Measured from the rendered alpha bounds in the design package's validation
 * report, not guessed. The dressing layer needs them because it places a tree
 * by its *crown*, not by its canvas: a wide canopy and a small one are drawn on
 * the same 512 square, so scaling both by the canvas would make them the same
 * size on the map and throw away the variety the set was drawn to provide.
 */
export const STAMP_CONTENT_BOXES = Object.freeze({
  "tree-canopy-small": Object.freeze({ x: 160, y: 174, width: 186, height: 148 }),
  "tree-canopy-medium": Object.freeze({ x: 115, y: 144, width: 262, height: 197 }),
  "tree-canopy-wide": Object.freeze({ x: 85, y: 156, width: 311, height: 186 }),
  "tree-canopy-irregular": Object.freeze({ x: 110, y: 123, width: 294, height: 246 }),
  "tree-copse": Object.freeze({ x: 80, y: 114, width: 359, height: 259 }),
  "tree-forest-edge": Object.freeze({ x: 10, y: 142, width: 476, height: 199 }),
  "farm-plot-row-crops": Object.freeze({ x: 62, y: 74, width: 388, height: 367 }),
  "farm-plot-kitchen-garden": Object.freeze({ x: 68, y: 72, width: 380, height: 364 }),
  "farm-plot-orchard": Object.freeze({ x: 64, y: 69, width: 386, height: 367 })
});

/** The bare slug of a stamp path — `.../tree-copse.svg` -> `tree-copse`. */
export function slugFor(src) {
  const path = typeof src === "string" ? src : String(src?.src ?? "");
  return path.split("/").pop()?.replace(/\.(shadow\.)?svg$/, "") ?? "";
}

/** Measured ink bounds for a stamp, falling back to the whole canvas. */
export function contentBoxFor(src) {
  return STAMP_CONTENT_BOXES[slugFor(src)]
    ?? { x: 0, y: 0, width: STAMP_CANVAS, height: STAMP_CANVAS };
}

/**
 * The drawable body of a stamp, ready to inline into another SVG document.
 *
 * The backdrop is uploaded as one self-contained file and used as a Scene
 * texture, and an SVG loaded as an image may not resolve external references —
 * so a tree cannot be `<image href="tree.svg">` there, it has to be inlined.
 * Strips the XML prolog, the outer `<svg>` wrapper, and the accessibility
 * `<title>`/`<desc>`, which would otherwise repeat 260 times.
 */
export function stampBody(svgText) {
  const text = String(svgText ?? "");
  const open = text.indexOf(">", text.indexOf("<svg"));
  const close = text.lastIndexOf("</svg>");
  if (open < 0 || close < 0 || close <= open) return "";
  return text.slice(open + 1, close)
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
}

/**
 * A shadow stamp's body with its baked-in light offset removed.
 *
 * Each shadow SVG displaces its silhouette by `translate(28 16)` so the file
 * stands alone. A building on the map is rotated to face its street, though,
 * and a displacement carried *inside* that rotation turns with it — which is
 * how you end up with a village whose shadows point twelve different ways.
 * Stripping it here lets the caller re-apply the same offset outside the
 * rotation, in world space, so one light serves the whole map.
 */
export function stampShadowBody(svgText) {
  return stampBody(svgText).replace(
    /(<g\b[^>]*\bid="shadow"[^>]*)\stransform="translate\(\s*[\d.+-]+[\s,]+[\d.+-]+\s*\)"/i,
    "$1"
  );
}

/**
 * The aligned shadow companion for a stamp path, or null when the path is not
 * one of ours. Derived rather than stored so the pair cannot drift.
 */
export function shadowSrcFor(src) {
  const path = typeof src === "string" ? src : String(src?.src ?? "");
  if (!path.startsWith(VILLAGE_STAMP_ASSET_ROOT) || !path.endsWith(".svg")) return null;
  if (path.endsWith(".shadow.svg")) return path;
  return `${path.slice(0, -".svg".length)}.shadow.svg`;
}

/**
 * The stamp for an institution at an effective level, or null when the set has
 * no art for it. Level overrides win so a future `foundry` stamp takes over
 * from `blacksmith` without touching callers.
 */
export function stampForInstitution(type, level = 1) {
  const key = String(type ?? "");
  if (!key) return null;
  const n = Math.floor(Number(level));
  if (Number.isFinite(n) && n > 0) {
    const override = INSTITUTION_LEVEL_STAMPS[`${key}.level${n}`];
    if (override) return override;
  }
  return INSTITUTION_STAMPS[key] ?? null;
}

/**
 * Compose the stamps over a drawn art set.
 *
 * The drawn set from `drawnVillageArtSet` delivers *everything* through its own
 * `resolve` and carries no `assets` map, so this must chain that function
 * rather than merely spread the object around it — overriding `resolve` alone
 * would silently drop every ruin and every unstamped shape onto null.
 *
 * Order is: a stamp if the set has one, otherwise whatever the drawn set says.
 * Destroyed states return null from the stamp arm on purpose, so the drawn ruin
 * wins for them.
 */
export function composeStampArtSet(drawn = null) {
  const delegate = typeof drawn?.resolve === "function" ? drawn.resolve.bind(drawn) : null;
  return {
    ...(drawn ?? {}),
    id: "crows-village-stamps",
    label: "Crows village art (native vector)",
    root: VILLAGE_STAMP_ASSET_ROOT,
    // A stamped house reads better than a drawn one and still rotates to its
    // street, so the pool is replaced outright rather than composed.
    housingPool: HOUSING_STAMPS.map(entry => ({ ...entry })),
    resolve(context = {}) {
      const { type, effectiveLevel, visualState, kind } = context;
      const stampable = kind !== "background"
        && kind !== "housing"
        && (!visualState || visualState === "operating" || visualState === "closed");
      if (stampable) {
        const hit = stampForInstitution(type, effectiveLevel ?? 1);
        if (hit) return hit;
      }
      return delegate ? delegate(context) : null;
    }
  };
}

/**
 * Institution type -> file slug, and the housing pool's slugs in pool order.
 *
 * Derived from the catalogues rather than written out again: the renderer needs
 * to name a sprite for a building, and a second hand-maintained copy of the
 * type-to-filename mapping is exactly the kind of thing that goes stale the
 * first time an asset is renamed.
 */
export const INSTITUTION_SLUGS = Object.freeze(Object.fromEntries(
  Object.entries(INSTITUTION_STAMPS).map(([type, entry]) => [type, slugFor(entry.src)])
));

export const HOUSING_SLUGS = Object.freeze(HOUSING_STAMPS.map(entry => slugFor(entry.src)));

/** Every shipped stamp, for coverage checks and the art-audit surface. */
export const VILLAGE_STAMP_CATALOGUE = Object.freeze({
  institutions: INSTITUTION_STAMPS,
  housing: HOUSING_STAMPS,
  trees: TREE_STAMPS,
  farmPlots: FARM_PLOT_STAMPS
});
