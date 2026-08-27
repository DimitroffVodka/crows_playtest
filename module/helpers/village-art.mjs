/**
 * Shipped Village map art.
 *
 * The logical keys consumed by village-map.mjs stay independent from the
 * source catalogue's filenames.  Keeping this catalogue in one module makes
 * the resolution choice easy to replace later without changing Village state
 * or Scene reconciliation.
 */

export const VILLAGE_ART_ASSET_ROOT = "systems/crows/assets/village/";

/** The named PNG files copied from 2 Minute Tabletop's 300-DPI set. */
export const VILLAGE_ART_FILENAMES = Object.freeze([
  "Arena.png",
  "Banner 1.png",
  "Banner 2.png",
  "Banner 3.png",
  "Bridge, stone.png",
  "Bridge, wooden, small.png",
  "Bridge, wooden.png",
  "Building, L-house.png",
  "Building, ampitheatre.png",
  "Building, cathedral.png",
  "Building, church.png",
  "Building, circle.png",
  "Building, fishing wharf.png",
  "Building, foundry.png",
  "Building, guild hall.png",
  "Building, library.png",
  "Building, lumber mill.png",
  "Building, smith, exterior.png",
  "Building, smith.png",
  "Building, straw 1.png",
  "Building, straw 2.png",
  "Building, straw 3.png",
  "Building, straw 4.png",
  "Building, straw 5.png",
  "Building, tower, circle.png",
  "Building, tower, square, small.png",
  "Building, tower, square.png",
  "Building, water mill.png",
  "Building, windmill.png",
  "Canal, bend.png",
  "Canal, corner.png",
  "Canal, intersection.png",
  "Canal, junction.png",
  "Canal, straight.png",
  "Chimney 1.png",
  "Chimney 2.png",
  "Chimney 3.png",
  "Cliff, cave entrance.png",
  "Cliff, short, bend, gentle.png",
  "Cliff, short, bend.png",
  "Cliff, short, straight.png",
  "Cliff, tall, bend, gentle.png",
  "Cliff, tall, bend.png",
  "Cliff, tall, straight.png",
  "Mine tracks, bend.png",
  "Mine tracks, straight.png",
  "Mine.png",
  "Monument.png",
  "Palisade gate.png",
  "Palisade tower.png",
  "Palisade, long.png",
  "Palisade, short.png",
  "Park, garden.png",
  "Quarry.png",
  "Ship, large.png",
  "Ship, small.png",
  "Staircase, narrow.png",
  "Staircase, staggered.png",
  "Staircase, wide.png",
  "Tents, large.png",
  "Tents, market, small.png",
  "Tents, market.png",
  "Tents.png",
  "Trees, grove.png",
  "Trees, scattered.png",
  "Trees, single, large.png",
  "Trees, single, small.png",
  "Trees, trio 1.png",
  "Trees, trio 2.png",
  "Wagon.png"
]);

function src(filename, label = filename.replace(/\.png$/i, "")) {
  return Object.freeze({
    src: `${VILLAGE_ART_ASSET_ROOT}${filename}`,
    label
  });
}

function substitute(filename, label, substitutionReason) {
  return Object.freeze({
    ...src(filename, label),
    substituted: true,
    substitutionReason
  });
}

function ruin(label) {
  return substitute(
    "Palisade, short.png",
    `${label} (ruin)`,
    "No dedicated destroyed-state art; use a short palisade fragment as a readable damaged-structure texture."
  );
}

const assets = Object.freeze({
  // Institution identities.  Each current institution has a distinct visual
  // identity; the two printed progressions are handled by village-map.mjs.
  circle: src("Building, circle.png", "Round hall"),
  "guild-hall": src("Building, guild hall.png", "Guild hall"),
  "tower-square": src("Building, tower, square.png", "Square watchtower"),
  "tower-circle": src("Building, tower, circle.png", "Round beacon tower"),
  smith: src("Building, smith.png", "Smithy"),
  foundry: src("Building, foundry.png", "Foundry"),
  library: src("Building, library.png", "Library"),
  "market-tents": src("Tents, market.png", "Market tents"),
  "l-house": src("Building, L-house.png", "L-shaped hall"),
  church: src("Building, church.png", "Church"),
  cathedral: src("Building, cathedral.png", "Cathedral"),
  "arcane-hall": src("Building, ampitheatre.png", "Arcane hall"),

  // Crypt and stables are intentional substitutions, not unresolved art.  A
  // future catalogue can replace these entries without changing map state.
  "unsupported.crypt": substitute(
    "Cliff, cave entrance.png",
    "Crypt (cave entrance)",
    "No dedicated crypt asset; a dark stone cave entrance conveys a burial vault."
  ),
  "unsupported.stables": substitute(
    "Building, straw 5.png",
    "Stables (straw outbuilding substitute)",
    "No dedicated stables asset; reserve straw house 5 as a distinct thatched outbuilding rather than reusing it for housing."
  ),

  // A state-specific entry is deliberate: destroyed institutions must not
  // silently keep their operating texture.  The same fragment is legible at
  // map scale and gives every institution a stable, deterministic ruins state.
  "circle.destroyed": ruin("Round hall"),
  "guild-hall.destroyed": ruin("Guild hall"),
  "tower-square.destroyed": ruin("Square watchtower"),
  "tower-circle.destroyed": ruin("Round beacon tower"),
  "smith.destroyed": ruin("Smithy"),
  "foundry.destroyed": ruin("Foundry"),
  "library.destroyed": ruin("Library"),
  "market-tents.destroyed": ruin("Market tents"),
  "l-house.destroyed": ruin("L-shaped hall"),
  "church.destroyed": ruin("Church"),
  "cathedral.destroyed": ruin("Cathedral"),
  "unsupported.crypt.destroyed": ruin("Crypt"),
  "unsupported.stables.destroyed": ruin("Stables"),

  // The housing resolver prefers housingPool, while this remains a safe
  // single-asset fallback for callers that provide only an assets map.
  housing: src("Building, straw 1.png", "Straw house 1"),

  // These named identities are available for future Village Watch/prosperity
  // decoration work.  No institution currently consumes Village Watch.
  "village-watch-gate": src("Palisade gate.png", "Village Watch gate"),
  "village-watch-tower": src("Palisade tower.png", "Village Watch tower"),
  monument: src("Monument.png", "Monument"),
  garden: src("Park, garden.png", "Garden"),
  "banner-1": src("Banner 1.png", "Banner 1"),
  "banner-2": src("Banner 2.png", "Banner 2"),
  "banner-3": src("Banner 3.png", "Banner 3")
});

const housingPool = Object.freeze([
  // Straw 5 is reserved for the stables substitution and must not be a house.
  src("Building, straw 1.png", "Straw house 1"),
  src("Building, straw 2.png", "Straw house 2"),
  src("Building, straw 3.png", "Straw house 3"),
  src("Building, straw 4.png", "Straw house 4")
]);

// Keep the complete named catalogue discoverable even though only a subset is
// currently projected into generated Tiles.  It also makes a future art-set
// swap a data change rather than a path rewrite throughout map logic.
export const VILLAGE_ART_CATALOGUE = Object.freeze(Object.fromEntries(
  VILLAGE_ART_FILENAMES.map(filename => [filename, src(filename)])
));

export const VILLAGE_ART_SET = Object.freeze({
  id: "2minutetabletop-town-city-300dpi",
  label: "2 Minute Tabletop Town and City Assets (300 DPI)",
  resolution: "300 DPI",
  license: Object.freeze({
    name: "Creative Commons Attribution-NonCommercial 4.0 International",
    shortName: "CC BY-NC 4.0",
    url: "https://creativecommons.org/licenses/by-nc/4.0/"
  }),
  root: VILLAGE_ART_ASSET_ROOT,
  assets,
  housingPool,
  catalogue: VILLAGE_ART_CATALOGUE
});
