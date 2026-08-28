/**
 * Palettes for village plan rendering.
 *
 * Separate from the renderer because both the map renderer and the standalone
 * building art need them; keeping them here rather than in `village-plan-draw`
 * avoids an import cycle between the two, and leaves the palettes as plain data
 * a Ref can copy and edit without reading any drawing code.
 *
 * The `crows` palette is a direct transcription of the institution art in
 * `Crows Playtest 2 Markdown/assets/institutions/` — same ink, same material
 * pairs, same yard and paving treatment — so procedurally drawn buildings and
 * the hand-authored institution cards read as one set. `materials` carries the
 * light/dark pair each roof facet is shaded from.
 */

/** Roof material pairs, keyed as the source art names them. */
const CROWS_MATERIALS = Object.freeze({
  clay:   Object.freeze({ light: "#c97858", dark: "#ab5d3f" }),
  slate:  Object.freeze({ light: "#7e8f99", dark: "#63737d" }),
  thatch: Object.freeze({ light: "#deb868", dark: "#bf9849" }),
  wood:   Object.freeze({ light: "#b89168", dark: "#997149" }),
  arcane: Object.freeze({ light: "#8a76a6", dark: "#6d5b87" })
});

const DARK_MATERIALS = Object.freeze({
  clay:   Object.freeze({ light: "#8a5038", dark: "#6d3d2b" }),
  slate:  Object.freeze({ light: "#5b6a74", dark: "#45525b" }),
  thatch: Object.freeze({ light: "#9c7f45", dark: "#7d6537" }),
  wood:   Object.freeze({ light: "#7d6146", dark: "#634b35" }),
  arcane: Object.freeze({ light: "#5f5175", dark: "#4a3f5c" })
});

export const PLAN_STYLES = Object.freeze({
  /**
   * The drawn map's own palette.
   *
   * Was described as matching the shipped institution art, and no longer does:
   * the native-vector set in `assets/institutions/` inks at `#010206` against
   * this palette's `#2a221b`, and casts `#9699AE` at 0.46 where this casts
   * `#2a221b` at 0.35. It only shows where drawn art and stamps meet — a drawn
   * ruin standing next to a stamped neighbour — because the stamps now carry
   * every operating institution. Reconciling the two is a visual decision, so
   * the difference is recorded here rather than quietly split.
   */
  crows: Object.freeze({
    materials: CROWS_MATERIALS,
    paper: "#f4eee3", ink: "#2a221b",
    /** Ground outside a ruin shell — the Miasma-choked wilds (C:2218). */
    wilds: "#cfc6b4",
    wall: "#806f5d", wallFill: "#baa991",
    road: "#e8decb", roadEdge: "#998877", square: "#ded4c1",
    /** Fallbacks for callers that ask for a flat roof colour. */
    roof: "#c97858", roofAlt: "#ab5d3f", roofInstitution: "#7e8f99", roofRidge: "#2a221b",
    rubble: "#baa991", field: "#ded4c1", fieldFurrow: "#998877",
    orchard: "#c3cfae", water: "#7aa3ad", waterDeep: "#5f8791",
    tree: "#7d9667", treeInk: "#2a221b", vacant: "#ded4c1", title: "#2a221b",
    stone: "#ded4c1", stoneDark: "#baa991", thatchProp: "#deb868",
    canvas: "#e8decb", ember: "#d9a84e", gold: "#d9a84e", rune: "#5dc9bd",
    yardFill: "#e8decb", yardStroke: "#806f5d",
    shadow: Object.freeze({ dx: 4, dy: 6, blur: 2, color: "#2a221b", opacity: 0.35 })
  }),
  slate: Object.freeze({
    materials: DARK_MATERIALS,
    paper: "#20242b", ink: "#0d0f13",
    wilds: "#161a1f",
    wall: "#8b96a5", wallFill: "#39414d",
    road: "#333b45", roadEdge: "#59636f", square: "#3a434e",
    roof: "#8a5038", roofAlt: "#6d3d2b", roofInstitution: "#5b6a74", roofRidge: "#0d0f13",
    rubble: "#4a525d", field: "#2e3a30", fieldFurrow: "#3d4c3f",
    orchard: "#33452f", water: "#2f5a78", waterDeep: "#254a64",
    tree: "#3f5a3a", treeInk: "#0d0f13", vacant: "#2a313a", title: "#c9d1d9",
    stone: "#4d5560", stoneDark: "#3a414a", thatchProp: "#7d6a44",
    canvas: "#4d5560", ember: "#d2703a", gold: "#b98c3c", rune: "#3f9c93",
    yardFill: "#2a313a", yardStroke: "#59636f",
    shadow: Object.freeze({ dx: 4, dy: 6, blur: 2, color: "#000000", opacity: 0.45 })
  })
});

export const DEFAULT_PLAN_STYLE = "crows";

/**
 * Line weights, transcribed from the source art's stylesheet.
 *
 * The source draws a building at roughly 250 units across a 400 unit canvas.
 * Plots here vary, so callers scale these by the building's actual size —
 * a fixed weight would read as a hairline on a large plot and as a blot on a
 * small one.
 */
export const PLAN_STROKES = Object.freeze({
  reference: 250,
  thin: 1.2,
  line: 2,
  ridge: 2.2,
  thick: 3.5
});

/** Stroke weights scaled to a building of `size` units across. */
export function strokesFor(size) {
  const k = Math.max(0.45, Math.min(2.4, (Number(size) || PLAN_STROKES.reference) / PLAN_STROKES.reference));
  return {
    thin: PLAN_STROKES.thin * k,
    line: PLAN_STROKES.line * k,
    ridge: PLAN_STROKES.ridge * k,
    thick: PLAN_STROKES.thick * k
  };
}

/** Named preset, explicit palette object, or the default. Unknown names fall back. */
export function resolveStyle(style) {
  const base = PLAN_STYLES[DEFAULT_PLAN_STYLE];
  if (style && typeof style === "object") return { ...base, ...style, materials: style.materials ?? base.materials };
  return PLAN_STYLES[style] ?? base;
}
