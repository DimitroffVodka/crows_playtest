/**
 * Village creator and Scene projection.
 *
 * Village state remains the only source of truth.  This module turns a
 * normalized Village record into Scene-embedded Tile data and owns the
 * recovery boundary around the independent setting and Scene writes.  The
 * generated-content flag is the ownership boundary: a Tile without the
 * matching flag is Ref decoration and is never changed by this module.
 */

import {
  CONNECTION_BENEFITS,
  INSTITUTION_KEYS,
  INSTITUTION_TYPES,
  STARTING_INSTITUTIONS,
  STARTING_INSTITUTION_CHOICES,
  clampProsperity,
  defaultVillage,
  effectiveInstitutionLevel,
  findLiveInstitution,
  getActiveVillageGM,
  getVillage,
  isVillageDesignatedWriter,
  normalizeVillage,
  registerVillageChangeListener,
  saveVillage,
  setVillageSceneReconciliationEnqueuer
} from "./village.mjs";
import { VILLAGE_ART_SET } from "./village-art.mjs";
import {
  CANONICAL_DRESSING_SLOTS,
  CANONICAL_FARMLAND_SLOTS,
  CANONICAL_HOUSING_SLOTS,
  CANONICAL_INSTITUTION_ART,
  CANONICAL_INSTITUTION_SLOTS,
  CANONICAL_UNBUILT_PLOT,
  CANONICAL_VILLAGE_BACKGROUND,
  CANONICAL_VILLAGE_SIZE,
  canonicalPrefixCount
} from "./canonical-village-layout.mjs";
import { villageBackgroundSvg } from "./village-plan-draw.mjs";
import { BUILDING_SHAPES, materialForInstitution, shapeSvg } from "./village-plan-art.mjs";
import {
  FARM_PLOT_STAMPS,
  HOUSING_STAMPS,
  INSTITUTION_STAMPS,
  TREE_STAMPS,
  composeStampArtSet,
  contentBoxFor,
  shadowSrcFor,
  slugFor,
  stampBody,
  stampShadowBody
} from "./village-stamp-art.mjs";

export const VILLAGE_MAP_GENERATOR_VERSION = "canonical-village-1";
export const GENERATOR_VERSION = VILLAGE_MAP_GENERATOR_VERSION;

/**
 * Foundry's `Scene.metadata.defaultLevelId` (app/common/documents/scene.mjs:46).
 * Mirrored rather than read so this module stays evaluable without Foundry
 * globals, which is what lets the projection be unit-tested at all.
 */
export const DEFAULT_LEVEL_ID = "defaultLevel0000";

export const SCENE_DEFAULTS = Object.freeze({
  width: CANONICAL_VILLAGE_SIZE,
  height: CANONICAL_VILLAGE_SIZE,
  // Zero, so that projection space IS background space.
  //
  // Foundry places Tiles in canvas coordinates, but padding shifts the
  // background image to (sceneX, sceneY) — each axis padded then rounded UP to
  // a whole grid square. At the old 0.25 that put the backdrop at (1200, 1800)
  // while this projection kept placing buildings from (0, 0), so anything in
  // the left or top margin landed in the grey gutter beside the map. Observed
  // live: the crypt and the inn sat off the edge of the meadow.
  //
  // The alternative — teaching the projection Foundry's padding rounding — buys
  // nothing here and duplicates engine-internal math. A village map is a static
  // backdrop with no need for off-canvas room, so removing the offset is both
  // the smaller change and the one that keeps tile coordinates checkable
  // against the background image itself.
  padding: 0,
  grid: Object.freeze({
    type: 1,
    size: 300,
    style: "solidLines",
    thickness: 1,
    color: "#000000",
    alpha: 0.2,
    distance: 5,
    units: "sq"
  }),
  institutionWidthGrid: 4,
  institutionHeightGrid: 3,
  housingWidthGrid: 2,
  housingHeightGrid: 2,
  institutionGapGrid: 0.5,
  housingGapGrid: 0.25,
  settlementGapGrid: 0.5,
  settlementMarginGrid: 1,
  backgroundVariant: "day"
});

export const VILLAGE_BACKGROUND_VARIANTS = Object.freeze({
  DAY: "day",
  NIGHT: "night"
});

const PHASE_ORDER = Object.freeze({
  prepared: 0,
  "scene-created": 1,
  "tiles-created": 2,
  committed: 3,
  uncertain: -1
});

const UNSUPPORTED_TYPES = new Set(["crypt", "stables"]);

/**
 * Logical art identities.  These names deliberately do not encode a local
 * filesystem path or a resolution choice.  An injected artSet can map them
 * to either the 72-DPI or 300-DPI catalogue later.
 */
export const INSTITUTION_ART_KEYS = Object.freeze({
  alchemist: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "circle" })
  ]) }),
  auctionHouse: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "guild-hall" })
  ]) }),
  barracks: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "tower-square" })
  ]) }),
  beacon: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "tower-circle" })
  ]) }),
  // These two progressions are the evidence-backed mappings from the source
  // art catalogue.  The ordinary mapping choices stay presentation data.
  blacksmith: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: 1, key: "smith" }),
    Object.freeze({ max: Infinity, key: "foundry" })
  ]) }),
  bookseller: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "library" })
  ]) }),
  crypt: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "unsupported.crypt" })
  ]) }),
  enchanter: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "arcane-hall" })
  ]) }),
  generalStore: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "market-tents" })
  ]) }),
  inn: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "l-house" })
  ]) }),
  stables: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: Infinity, key: "unsupported.stables" })
  ]) }),
  // The Temple's role-appropriate progression is church -> cathedral.
  temple: Object.freeze({ levels: Object.freeze([
    Object.freeze({ max: 1, key: "church" }),
    Object.freeze({ max: Infinity, key: "cathedral" })
  ]) })
});

const HOUSING_ASSET_KEY = "housing";

function clone(value) {
  if (value === undefined) return undefined;
  try {
    if (typeof globalThis.foundry?.utils?.deepClone === "function") {
      return globalThis.foundry.utils.deepClone(value);
    }
  } catch { /* use the platform-neutral fallback */ }
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableValue(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function equalValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function text(value) {
  return String(value ?? "").trim();
}

function institutionLabel(type) {
  return (INSTITUTION_TYPES[type] ?? text(type)) || "Institution";
}

function sceneOwnershipObserver() {
  return Number(globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2);
}

function generatorVersion(options = {}) {
  return text(options.generatorVersion || VILLAGE_MAP_GENERATOR_VERSION)
    || VILLAGE_MAP_GENERATOR_VERSION;
}

function scenesFrom(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return [...collection];
  if (Array.isArray(collection.contents)) return [...collection.contents];
  if (typeof collection.values === "function") {
    try { return [...collection.values()]; } catch { /* fall through */ }
  }
  if (typeof collection[Symbol.iterator] === "function") {
    try {
      return [...collection].map(entry => Array.isArray(entry) ? entry[1] : entry);
    } catch { /* fall through */ }
  }
  if (typeof collection.filter === "function") {
    try { return [...collection.filter(() => true)]; } catch { /* fall through */ }
  }
  return [];
}

function sceneId(scene) {
  return scene?.id ?? scene?._id ?? null;
}

/** Read only the Crows Village identity flag from a Scene. */
export function villageSceneFlag(scene) {
  const direct = scene?.flags?.crows?.village;
  if (direct && typeof direct === "object") return clone(direct);
  try {
    const fromDocument = scene?.getFlag?.("crows", "village");
    if (fromDocument && typeof fromDocument === "object") return clone(fromDocument);
  } catch { /* a test document may not implement getFlag */ }
  return null;
}

/** Find Scenes by generated Village identity, never by texture or name. */
export function findVillageScenes(villageId, collection = globalThis.game?.scenes) {
  const id = text(villageId);
  if (!id) return [];
  return scenesFrom(collection).filter(scene => villageSceneFlag(scene)?.villageId === id);
}

/** Classify the lookup-before-create result without mutating any Scene. */
export function classifyVillageScenes(villageId, collection = globalThis.game?.scenes) {
  const candidates = findVillageScenes(villageId, collection);
  return {
    status: candidates.length === 0 ? "none" : candidates.length === 1 ? "one" : "multiple",
    candidates: candidates.map(sceneId).filter(Boolean),
    scenes: candidates
  };
}

function sceneById(id, collection = globalThis.game?.scenes) {
  const wanted = text(id);
  if (!wanted) return null;
  try {
    const found = collection?.get?.(wanted);
    if (found) return found;
  } catch { /* use a collection scan */ }
  return scenesFrom(collection).find(scene => text(sceneId(scene)) === wanted) ?? null;
}

function sceneClass(options = {}) {
  return options.SceneClass
    ?? options.sceneClass
    ?? globalThis.Scene
    ?? globalThis.foundry?.documents?.Scene
    ?? globalThis.game?.scenes?.documentClass
    ?? null;
}

function sceneCreateFunction(options = {}) {
  const candidate = sceneClass(options);
  if (typeof candidate?.create === "function") return candidate.create.bind(candidate);
  if (typeof candidate?.implementation?.create === "function") {
    return candidate.implementation.create.bind(candidate.implementation);
  }
  return null;
}

function sceneTiles(scene) {
  const tiles = scene?.tiles;
  if (!tiles) return [];
  if (Array.isArray(tiles)) return [...tiles];
  if (Array.isArray(tiles.contents)) return [...tiles.contents];
  if (typeof tiles.values === "function") {
    try { return [...tiles.values()]; } catch { /* fall through */ }
  }
  if (typeof tiles[Symbol.iterator] === "function") {
    try {
      return [...tiles].map(entry => Array.isArray(entry) ? entry[1] : entry);
    } catch { /* fall through */ }
  }
  if (typeof tiles.filter === "function") {
    try { return [...tiles.filter(() => true)]; } catch { /* fall through */ }
  }
  return [];
}

function tileId(tile) {
  return tile?.id ?? tile?._id ?? null;
}

function tileFlag(tile) {
  const direct = tile?.flags?.crows?.village;
  if (direct && typeof direct === "object") return direct;
  try {
    const fromDocument = tile?.getFlag?.("crows", "village");
    if (fromDocument && typeof fromDocument === "object") return fromDocument;
  } catch { /* plain test tile */ }
  return null;
}

/** Return only generated Crows Tiles for this Village. */
export function generatedVillageTiles(scene, villageId) {
  const id = text(villageId);
  return sceneTiles(scene).filter(tile => tileFlag(tile)?.villageId === id);
}

function tileIdentityKey(flag) {
  if (!flag || typeof flag !== "object") return null;
  if (flag.slotId != null && flag.kind != null) {
    return `${String(flag.kind)}:${String(flag.slotId)}`;
  }
  if (flag.kind === "institution" && flag.institutionId != null) {
    return `institution:${String(flag.institutionId)}`;
  }
  if (flag.kind === "housing" && flag.housingIndex != null) {
    return `housing:${String(flag.housingIndex)}`;
  }
  return null;
}

function fnv1a(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function gridSizeFor(options = {}) {
  const configured = options.gridSize ?? options.grid?.size ?? SCENE_DEFAULTS.grid.size;
  const size = Math.floor(Number(configured));
  return Number.isFinite(size) && size > 0 ? size : SCENE_DEFAULTS.grid.size;
}

function tileDimensionFor(options, kind, axis) {
  const absoluteKey = `${kind}${axis}`;
  const configuredAbsolute = Number(options[absoluteKey]);
  if (Number.isFinite(configuredAbsolute) && configuredAbsolute > 0) {
    return Math.round(configuredAbsolute);
  }
  const gridKey = `${absoluteKey}Grid`;
  const configuredGrid = Number(options[gridKey] ?? SCENE_DEFAULTS[gridKey]);
  const gridUnits = Number.isFinite(configuredGrid) && configuredGrid > 0 ? configuredGrid : 1;
  return Math.max(1, Math.round(gridUnits * gridSizeFor(options)));
}

function gridLengthFor(options, key, fallback) {
  const configured = Number(options[key] ?? SCENE_DEFAULTS[key] ?? fallback);
  const units = Number.isFinite(configured) && configured >= 0 ? configured : fallback;
  return Math.max(0, Math.round(units * gridSizeFor(options)));
}

/**
 * Deterministic, presentation-only coordinates.  The identity is included in
 * the hash so adding an institution does not renumber existing slots. Tile
 * dimensions bound the top-left origin so portrait scenes cannot clip a tile.
 */
export function deterministicPosition({
  sceneSeed = "",
  identity = "",
  kind = "institution",
  index = 0,
  width = SCENE_DEFAULTS.width,
  height = SCENE_DEFAULTS.height,
  margin = 220,
  tileWidth = 0,
  tileHeight = 0
} = {}) {
  const seed = fnv1a(`${sceneSeed}|${kind}|${identity}|${index}`);
  const second = fnv1a(`${sceneSeed}|${kind}|${identity}|${index}|y`);
  const sceneWidth = Math.max(1, Math.floor(Number(width) || SCENE_DEFAULTS.width));
  const sceneHeight = Math.max(1, Math.floor(Number(height) || SCENE_DEFAULTS.height));
  const safeMargin = Math.max(0, Math.floor(Number(margin) || 0));
  const contentWidth = Math.max(0, Math.floor(Number(tileWidth) || 0));
  const contentHeight = Math.max(0, Math.floor(Number(tileHeight) || 0));
  const maxX = Math.max(0, sceneWidth - contentWidth);
  const maxY = Math.max(0, sceneHeight - contentHeight);
  const minX = Math.min(safeMargin, maxX);
  const minY = Math.min(safeMargin, maxY);
  const boundedMaxX = Math.max(minX, maxX - safeMargin);
  const boundedMaxY = Math.max(minY, maxY - safeMargin);
  const usableWidth = Math.max(1, boundedMaxX - minX + 1);
  const usableHeight = Math.max(1, boundedMaxY - minY + 1);
  return {
    x: minX + (seed % usableWidth),
    y: minY + (second % usableHeight)
  };
}

const INSTITUTION_CLUSTER_COLUMNS = 3;
const INSTITUTION_CLUSTER_ROWS = Math.ceil(INSTITUTION_KEYS.length / INSTITUTION_CLUSTER_COLUMNS);
const MAX_HOUSING_TILES = 5;

function sceneDimension(options, key) {
  const configured = Number(options[key]);
  const fallback = SCENE_DEFAULTS[key];
  return Math.max(1, Math.floor(Number.isFinite(configured) && configured > 0 ? configured : fallback));
}

function boundedClusterOrigin({ sceneSize, extent, margin, seed }) {
  const maxOrigin = Math.max(0, sceneSize - extent);
  const minOrigin = Math.min(Math.max(0, margin), maxOrigin);
  const maxOriginWithMargin = Math.max(minOrigin, maxOrigin - Math.max(0, margin));
  const span = Math.max(1, maxOriginWithMargin - minOrigin + 1);
  return minOrigin + (fnv1a(seed) % span);
}

/**
 * A background-agnostic settlement footprint.  Its anchor varies by
 * sceneSeed, but the institution grid and housing row stay clustered rather
 * than following any one backdrop's path or landmarks.
 */
function settlementLayout(village, options = {}) {
  const gridSize = gridSizeFor(options);
  const institutionWidth = tileDimensionFor(options, "institution", "Width");
  const institutionHeight = tileDimensionFor(options, "institution", "Height");
  const housingWidth = tileDimensionFor(options, "housing", "Width");
  const housingHeight = tileDimensionFor(options, "housing", "Height");
  const institutionGap = gridLengthFor(options, "institutionGapGrid", 0.5);
  const housingGap = gridLengthFor(options, "housingGapGrid", 0.25);
  const settlementGap = gridLengthFor(options, "settlementGapGrid", 0.5);
  const clusterWidth = INSTITUTION_CLUSTER_COLUMNS * institutionWidth
    + (INSTITUTION_CLUSTER_COLUMNS - 1) * institutionGap;
  const clusterHeight = INSTITUTION_CLUSTER_ROWS * institutionHeight
    + (INSTITUTION_CLUSTER_ROWS - 1) * institutionGap;
  const housingRowWidth = MAX_HOUSING_TILES * housingWidth + (MAX_HOUSING_TILES - 1) * housingGap;
  const settlementWidth = Math.max(clusterWidth, housingRowWidth);
  const settlementHeight = clusterHeight + settlementGap + housingHeight;
  const configuredMargin = Number(options.margin);
  const gridMargin = Number.isFinite(configuredMargin) && configuredMargin >= 0
    ? Math.round(configuredMargin)
    : gridLengthFor(options, "settlementMarginGrid", 1);
  const width = sceneDimension(options, "width");
  const height = sceneDimension(options, "height");
  const sceneSeed = village?.sceneSeed ?? "";
  return {
    gridSize,
    institutionWidth,
    institutionHeight,
    institutionGap,
    housingWidth,
    housingHeight,
    housingGap,
    clusterWidth,
    clusterHeight,
    housingRowWidth,
    settlementWidth,
    settlementHeight,
    settlementGap,
    left: boundedClusterOrigin({
      sceneSize: width,
      extent: settlementWidth,
      margin: gridMargin,
      seed: `${sceneSeed}|settlement|x`
    }),
    top: boundedClusterOrigin({
      sceneSize: height,
      extent: settlementHeight,
      margin: gridMargin,
      seed: `${sceneSeed}|settlement|y`
    })
  };
}

/**
 * Turn a plan's placement into Tile coordinates.
 *
 * Both the plan and a Foundry v14 Tile work in centres — the Tile's mesh is
 * anchored at 0.5/0.5 and positioned on `x`/`y`, so `x`/`y` *is* where the
 * middle of the art lands. The centre therefore passes through untouched.
 *
 * This used to subtract half the tile, which was right when a Tile was placed
 * by its top-left corner. Against v14 that offset every building up and left by
 * half its own size — a whole grid square for an institution — which showed up
 * as buildings sitting beside their plots and clear of their own cast shadows.
 * The system declares v14 as both minimum and verified, so there is no older
 * behaviour left to support.
 */
function tilePositionFromPlan(at) {
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

/**
 * Fit configured tile art inside the plot the plan gave it.
 *
 * The shipped institution art is 4×3 grid squares — 1200×900 — while a plot is
 * around 300×270. Drawn at its configured size every building would be sixteen
 * times the area of its own plot, overlapping its neighbours and hanging off
 * the map; and the arithmetic rules out simply enlarging the scene, since forty
 * buildings at twelve squares each need 480 against the background's 352.
 *
 * So the art is scaled to the ground it was given, preserving its aspect ratio.
 * A temple on a large plot still renders larger than a cottage — size now
 * follows from the plan rather than from a constant.
 *
 * The plot's frontage runs along its street while the tile is turned a quarter
 * turn to face it, so frontage bounds the tile's *height* and depth its width.
 */
function fitTileToPlot(at, width, height) {
  const frontage = Number(at?.frontage);
  const depth = Number(at?.depth);
  if (!Number.isFinite(frontage) || !Number.isFinite(depth) || frontage <= 0 || depth <= 0) {
    return { width, height };
  }
  if (width <= 0 || height <= 0) return { width, height };
  const scale = Math.min(depth / width, frontage / height);
  if (!Number.isFinite(scale) || scale <= 0 || scale >= 1) return { width, height };
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Degrees a tile turns to face the street its plot fronts on. */
export function planRotationFor(at) {
  const angle = Number(at?.angle);
  if (!Number.isFinite(angle)) return 0;
  // +90° matches the drawn map, where a building's local frame faces the
  // street with -y; without it tiles sit broadside to their own frontage.
  return Math.round(((angle + Math.PI / 2) * 180) / Math.PI);
}

export function institutionPosition(village, institution, options = {}) {
  if (typeof options.positionForInstitution === "function") {
    return clone(options.positionForInstitution({ village: clone(village), institution: clone(institution) }));
  }

  const layout = settlementLayout(village, {
    ...options,
    ...(options.tileWidth != null ? { institutionWidth: options.tileWidth } : {}),
    ...(options.tileHeight != null ? { institutionHeight: options.tileHeight } : {})
  });
  const slot = INSTITUTION_KEYS.indexOf(String(institution?.type ?? ""));
  const fallback = fnv1a(`${village?.sceneSeed ?? ""}|institution|${institution?.id ?? institution?.type}`)
    % (INSTITUTION_CLUSTER_COLUMNS * INSTITUTION_CLUSTER_ROWS);
  const resolvedSlot = slot >= 0 ? slot : fallback;
  const column = resolvedSlot % INSTITUTION_CLUSTER_COLUMNS;
  const row = Math.floor(resolvedSlot / INSTITUTION_CLUSTER_COLUMNS);
  // The grid is laid out in cell corners while a Tile is placed by its centre,
  // so half a cell is added here rather than leaving this fallback half a tile
  // out of step with the planned path beside it.
  return {
    x: Math.round(layout.left + column * (layout.institutionWidth + layout.institutionGap)
      + layout.institutionWidth / 2),
    y: Math.round(layout.top + row * (layout.institutionHeight + layout.institutionGap)
      + layout.institutionHeight / 2)
  };
}

export function housingPosition(village, index, options = {}) {
  if (typeof options.positionForHousing === "function") {
    return clone(options.positionForHousing({ village: clone(village), index }));
  }

  const layout = settlementLayout(village, {
    ...options,
    ...(options.tileWidth != null ? { housingWidth: options.tileWidth } : {}),
    ...(options.tileHeight != null ? { housingHeight: options.tileHeight } : {})
  });
  const resolvedIndex = Math.max(0, Math.min(MAX_HOUSING_TILES - 1,
    Math.floor(Number(index) || 0)));
  const activeHousingCount = Math.max(1, Math.min(MAX_HOUSING_TILES,
    housingTierForProsperity(village?.prosperity ?? 0)));
  const activeRowWidth = activeHousingCount * layout.housingWidth
    + (activeHousingCount - 1) * layout.housingGap;
  const housingLeft = layout.left + (layout.settlementWidth - activeRowWidth) / 2;
  return {
    x: Math.round(housingLeft + resolvedIndex * (layout.housingWidth + layout.housingGap)
      + layout.housingWidth / 2),
    y: Math.round(layout.top + layout.clusterHeight + layout.settlementGap
      + layout.housingHeight / 2)
  };
}

function artKeyAliases(key) {
  const value = text(key);
  if (!value) return [];
  const camel = value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  const spaced = value.replace(/-/g, " ");
  const building = value.startsWith("building.") ? value : `building.${value}`;
  return [...new Set([value, camel, spaced, building])];
}

function artEntryAt(container, key) {
  if (!container) return undefined;
  if (container instanceof Map) {
    try { return container.get(key); } catch { return undefined; }
  }
  if (typeof container === "object") return container[key];
  return undefined;
}

function artEntrySource(entry) {
  if (typeof entry === "string") {
    return { src: entry, label: null, substituted: false, substitutionReason: null };
  }
  if (!entry || typeof entry !== "object") return null;
  const src = entry.src ?? entry.path ?? entry.url ?? entry.texture ?? null;
  return {
    src: src == null ? null : String(src),
    label: entry.label == null ? null : String(entry.label),
    substituted: entry.substituted === true,
    substitutionReason: entry.substitutionReason == null
      ? null
      : String(entry.substitutionReason)
  };
}

/** Resolve one logical art key from a deliberately injected catalogue. */
function resolveArt(artSet, key, visualState, context = {}) {
  if (!artSet) return { src: null, label: null, key: null, stateSpecific: false };

  if (typeof artSet.resolve === "function") {
    try {
      const resolved = artSet.resolve({
        key,
        assetKey: key,
        visualState,
        ...clone(context)
      });
      const converted = artEntrySource(resolved);
      if (converted?.src) {
        return { ...converted, key, stateSpecific: true };
      }
    } catch { /* an art resolver is an optional late-bound seam */ }
  }

  const maps = [
    artSet.assets,
    artSet.catalogue,
    artSet.catalog,
    artSet.images,
    artSet
  ].filter(Boolean);
  const stateKeys = visualState === "operating"
    ? []
    : [
      `${key}.${visualState}`,
      `${key}-${visualState}`,
      `${visualState}.${key}`,
      visualState === "destroyed" ? `${key}.ruins` : null,
      visualState === "destroyed" ? `${key}-ruins` : null,
      visualState === "destroyed" ? "ruins" : null,
      visualState === "closed" ? "closed" : null
    ].filter(Boolean);
  // A destroyed institution must not silently keep its operating texture.
  // A closed institution may use the same role asset while its state remains
  // explicit in the resolver result and generated flag.
  const typeKey = text(context.type);
  const level = Math.floor(Number(context.effectiveLevel) || 0);
  const levelKeys = typeKey && level > 0
    ? [`${typeKey}.level${level}`, `${typeKey}-level-${level}`, `${typeKey}-${level}`]
    : [];
  const directKeys = visualState === "destroyed"
    ? [...stateKeys, ...levelKeys]
    : [...stateKeys, ...levelKeys, typeKey, key].filter(Boolean);
  for (const map of maps) {
    // A state-first map is convenient for fixtures and production settings.
    const stateMap = map[visualState];
    if (stateMap) {
      for (const alias of artKeyAliases(key)) {
        const converted = artEntrySource(artEntryAt(stateMap, alias));
        if (converted?.src) return { ...converted, key: alias, stateSpecific: true };
      }
    }
    for (const candidate of directKeys) {
      for (const alias of artKeyAliases(candidate)) {
        const raw = artEntryAt(map, alias);
        const stateEntry = raw && typeof raw === "object"
          ? (raw[visualState] ?? raw.states?.[visualState] ?? raw.variants?.[visualState]
            ?? (level > 0 ? (raw[`level${level}`] ?? raw[level]) : undefined))
          : undefined;
        const converted = artEntrySource(stateEntry ?? raw);
        if (converted?.src) {
          return {
            ...converted,
            key: alias,
            stateSpecific: candidate !== key || visualState === "operating"
          };
        }
      }
    }
  }
  return { src: null, label: null, key: null, stateSpecific: false };
}

function backgroundVariant(value, fallback = SCENE_DEFAULTS.backgroundVariant) {
  const candidate = text(value).toLowerCase();
  return candidate || fallback;
}

function backgroundMaps(set) {
  if (!set) return [];
  return [
    set,
    set.backgrounds,
    set.background,
    set.assets?.backgrounds,
    set.assets?.background,
    set.assets,
    set.maps?.backgrounds,
    set.catalogue?.backgrounds,
    set.catalogue
  ].filter(Boolean).filter((map, index, maps) => maps.indexOf(map) === index);
}

/**
 * Resolve the Scene background through the same late-bound art boundary as
 * institution textures.  A Ref can provide either a {day, night} map, an art
 * set carrying .backgrounds, or a resolver function without changing Village
 * state or this projection code.
 */
export function resolveVillageBackground({
  variant = SCENE_DEFAULTS.backgroundVariant,
  artSet = null,
  backgroundSet = null
} = {}) {
  const requested = backgroundVariant(variant);
  const sets = [
    backgroundSet,
    artSet?.backgrounds,
    artSet,
    configuredBackgroundSet,
    VILLAGE_ART_SET.backgrounds
  ].filter(Boolean).filter((set, index, candidates) => candidates.indexOf(set) === index);

  for (const set of sets) {
    const fallback = backgroundVariant(set.defaultVariant ?? set.defaultBackground);
    const keys = [...new Set([requested, fallback, "default", SCENE_DEFAULTS.backgroundVariant])];
    for (const candidate of keys) {
      let converted = null;
      if (typeof set.resolveBackground === "function") {
        try {
          converted = artEntrySource(set.resolveBackground({
            key: candidate,
            variant: candidate,
            visualState: candidate
          }));
        } catch { /* an optional Ref resolver must not break Scene creation */ }
      }
      if (!converted?.src && typeof set.resolve === "function") {
        try {
          converted = artEntrySource(set.resolve({
            key: candidate,
            assetKey: candidate,
            variant: candidate,
            visualState: candidate,
            kind: "background"
          }));
        } catch { /* an optional Ref resolver must not break Scene creation */ }
      }
      if (!converted?.src) {
        for (const map of backgroundMaps(set)) {
          converted = artEntrySource(artEntryAt(map, candidate));
          if (!converted?.src && candidate === requested) converted = artEntrySource(map);
          if (converted?.src) break;
        }
      }
      if (converted?.src) {
        return {
          ...converted,
          key: candidate,
          variant: candidate,
          supported: true,
          substituted: converted.substituted === true,
          substitutionReason: converted.substitutionReason ?? null,
          unsupported: false,
          needsArt: false,
          reason: converted.substituted ? "substituted" : null
        };
      }
    }
  }

  return {
    src: null,
    label: null,
    key: null,
    variant: requested,
    supported: false,
    substituted: false,
    substitutionReason: null,
    unsupported: true,
    needsArt: true,
    reason: "asset-unresolved"
  };
}

function levelValue(effectiveLevel) {
  if (effectiveLevel && typeof effectiveLevel === "object") {
    return Math.floor(Number(effectiveLevel.level ?? effectiveLevel.effectiveLevel) || 0);
  }
  return Math.floor(Number(effectiveLevel) || 0);
}

function visualStateFor(effectiveLevel, destroyed) {
  if (destroyed === true || effectiveLevel?.destroyed === true) return "destroyed";
  if (effectiveLevel?.closed === true || levelValue(effectiveLevel) <= 0) return "closed";
  return "operating";
}

function baseArtKey(type, level) {
  const mapping = INSTITUTION_ART_KEYS[type];
  if (!mapping) return `unsupported.${type || "institution"}`;
  return mapping.levels.find(row => level <= row.max)?.key
    ?? mapping.levels.at(-1)?.key
    ?? `unsupported.${type}`;
}

/**
 * Pure data-driven institution art resolver.  `effectiveLevel` may be a
 * number or the object returned by effectiveInstitutionLevel; accepting the
 * latter keeps pending levels, cycle modifiers, and capstones in the caller's
 * effective-level calculation rather than duplicating those rules here.
 */
export function assetForInstitution({ type, effectiveLevel = 0, destroyed = false, artSet = null } = {}) {
  const key = text(type);
  const visualState = visualStateFor(effectiveLevel, destroyed);
  // effectiveInstitutionLevel reports `base` separately and intentionally
  // returns level 0 for a tombstone.  Keep the old operating level when it is
  // available so a level-4 institution can resolve a level-4 ruin texture.
  const level = visualState === "destroyed" && effectiveLevel && typeof effectiveLevel === "object"
    ? Math.max(levelValue(effectiveLevel), Math.floor(Number(effectiveLevel.base) || 0))
    : levelValue(effectiveLevel);
  const baseKey = baseArtKey(key, level);
  const stateAssetKey = visualState === "operating" ? baseKey : `${baseKey}.${visualState}`;
  const resolved = resolveArt(artSet ?? configuredArtSet, baseKey, visualState, {
    type: key,
    effectiveLevel: level,
    destroyed: visualState === "destroyed"
  });
  const supported = Boolean(resolved.src);
  const explicitlyUnsupported = UNSUPPORTED_TYPES.has(key) && !supported;
  const substituted = resolved.substituted === true;
  return {
    src: resolved.src,
    label: resolved.label ?? institutionLabel(key),
    assetKey: baseKey,
    logicalKey: baseKey,
    stateAssetKey,
    resolvedAssetKey: resolved.key,
    visualState,
    effectiveLevel: level,
    supported,
    substituted,
    substitutionReason: resolved.substitutionReason ?? null,
    unsupported: !supported,
    needsArt: !supported,
    reason: substituted
      ? "substituted"
      : explicitlyUnsupported ? "art-needed" : (!supported ? "asset-unresolved" : null)
  };
}

function assetForHousing(artSet, visualState = "operating", index = 0) {
  let resolved = null;
  const pools = [artSet?.housingPool, artSet?.assets?.housingPool];
  if (visualState === "operating") {
    for (const pool of pools) {
      if (!Array.isArray(pool) || pool.length === 0) continue;
      const poolIndex = Math.abs(Math.floor(Number(index) || 0)) % pool.length;
      const converted = artEntrySource(pool[poolIndex]);
      if (converted?.src) {
        resolved = { ...converted, key: `${HOUSING_ASSET_KEY}.${poolIndex}`, stateSpecific: false };
        break;
      }
    }
  }
  resolved ??= resolveArt(artSet, HOUSING_ASSET_KEY, visualState, { kind: "housing", index });
  return {
    src: resolved.src,
    label: resolved.label ?? "Housing",
    assetKey: HOUSING_ASSET_KEY,
    logicalKey: HOUSING_ASSET_KEY,
    stateAssetKey: visualState === "operating" ? HOUSING_ASSET_KEY : `${HOUSING_ASSET_KEY}.${visualState}`,
    resolvedAssetKey: resolved.key,
    visualState,
    supported: Boolean(resolved.src),
    substituted: resolved.substituted === true,
    substitutionReason: resolved.substitutionReason ?? null,
    unsupported: !resolved.src,
    needsArt: !resolved.src,
    reason: resolved.src ? null : "asset-unresolved"
  };
}

/** Legacy five-step presentation tier retained for UI compatibility. */
export function housingTierForProsperity(prosperity = 0) {
  const value = clampProsperity(prosperity);
  return Math.max(0, Math.min(5, Math.floor((value + 10) / 4)));
}

/** Compatibility alias retained for callers that use the old 0..5 display tier. */
export function housingCountForProsperity(prosperity = 0) {
  return housingTierForProsperity(prosperity);
}

/** Number of canonical housing plots selected at this Prosperity. */
export function canonicalHousingCountForProsperity(prosperity = 0) {
  return canonicalPrefixCount(prosperity, CANONICAL_HOUSING_SLOTS.length);
}

function institutionModifiers(village, institution) {
  return (village?.activeEffects ?? []).filter(effect =>
    (effect?.kind === "merchantLevel" && (effect.scope === "all" || effect.target === institution?.id))
    || (effect?.kind === "institutionLevel" && effect.target === institution?.id)
  );
}

/** Effective-level view used by both art and diffing. */
export function effectiveInstitutionForMap(institution, village) {
  const effective = effectiveInstitutionLevel(institution, {
    prosperity: village?.prosperity ?? 0,
    cycle: village?.cycle ?? null,
    modifiers: institutionModifiers(village, institution)
  });
  if (!effective.ok || effective.destroyed) return effective;
  const closedByEffect = (village?.activeEffects ?? []).some(effect =>
    ((effect?.kind === "ceaseOperations" || effect?.kind === "artisanShutdown")
      && (effect.scope === "all" || effect.target === institution?.id))
  );
  const explicitlyClosed = institution?.closed === true || institution?.operating === false;
  if (!closedByEffect && !explicitlyClosed) return effective;
  return {
    ...effective,
    level: 0,
    closed: true,
    closureReason: closedByEffect ? "active-effect" : "institution-closed"
  };
}

function textureFor(asset) {
  return {
    src: asset?.src ?? null,
    anchorX: 0.5,
    anchorY: 0.5,
    fit: "fill",
    scaleX: 1,
    scaleY: 1,
    tint: "#ffffff",
    alphaThreshold: 0
  };
}

function villageTileFlag({ kind, villageId, generatorVersion: version, ...identity }) {
  return {
    kind,
    villageId: String(villageId),
    generatorVersion: version,
    ...identity
  };
}

function baseTileData({ name, asset, position, width, height, sort, flag, rotation = 0 }) {
  return {
    name,
    texture: textureFor(asset),
    x: Math.round(Number(position?.x) || 0),
    y: Math.round(Number(position?.y) || 0),
    width: Math.max(0, Math.round(Number(width) || 0)),
    height: Math.max(0, Math.round(Number(height) || 0)),
    elevation: 0,
    sort: Math.round(Number(sort) || 0),
    // A v14 Tile is anchored at its middle, so x/y above is the centre of the
    // art and rotation turns it about that same point.
    rotation: Math.round(Number(rotation) || 0),
    alpha: 1,
    hidden: false,
    locked: false,
    flags: { crows: { village: clone(flag) } }
  };
}

/**
 * The art a canonical institution plot uses when the caller names none.
 *
 * `prepareCanonicalMap` already composes the authored stamps for the scene
 * bootstrap, so a Ref's map looks right. Calling `buildVillageProjection`
 * directly did not — it fell through to the configured catalogue, the legacy
 * PNG set — so the same village rendered with different buildings depending on
 * which entry point asked, and the tests asserted against the entry point that
 * disagreed with what ships. This closes that gap.
 *
 * Non-operating states delegate onward: the authored set has no ruin art and
 * the catalogue does, so a destroyed institution keeps resolving as before.
 */
const canonicalInstitutionArtSet = {
  id: "crows-canonical-institutions",
  resolve(context = {}) {
    const { type, visualState } = context;
    const standing = !visualState || visualState === "operating" || visualState === "closed";
    const src = standing ? CANONICAL_INSTITUTION_ART[String(type ?? "")] : null;
    if (src) return { src, label: institutionLabel(type) };
    return typeof configuredArtSet?.resolve === "function"
      ? configuredArtSet.resolve(context)
      : null;
  },
  get assets() { return configuredArtSet?.assets; },
  get housingPool() { return configuredArtSet?.housingPool; }
};

export function institutionTileData(village, institution, options = {}) {
  const effective = effectiveInstitutionForMap(institution, village);
  const slot = options.slot ?? null;
  const placedAt = null;
  const fitted = slot
    ? { width: slot.width, height: slot.height }
    : fitTileToPlot(
        placedAt,
        tileDimensionFor(options, "institution", "Width"),
        tileDimensionFor(options, "institution", "Height")
      );
  const tileWidth = fitted.width;
  const tileHeight = fitted.height;
  const asset = assetForInstitution({
    type: institution?.type,
    effectiveLevel: effective,
    destroyed: institution?.destroyed === true,
    // A canonical plot names the drawing that stands on it, the same way a
    // housing slot does. Without this the twelve institutions fell through to
    // whatever catalogue was configured — the legacy PNG set — and landed on
    // the canonical map as raster over vector. An explicitly supplied art set
    // still wins, so a Ref's override and the tests' fixtures behave as before.
    artSet: options.artSet ?? (slot ? canonicalInstitutionArtSet : configuredArtSet)
  });
  const version = generatorVersion(options);
  const position = slot
    ? { x: slot.x, y: slot.y }
    : institutionPosition(village, institution, {
        ...options,
        width: options.sceneWidth ?? options.width,
        height: options.sceneHeight ?? options.height,
        tileWidth,
        tileHeight
      });
  const name = text(institution?.name) || institutionLabel(institution?.type);
  return baseTileData({
    name: `${name} [${asset.visualState}]`,
    asset,
    position,
    width: tileWidth,
    height: tileHeight,
    rotation: options.rotateToStreet === false ? 0 : (slot?.rotation ?? planRotationFor(placedAt)),
    sort: options.sort ?? 100,
    flag: villageTileFlag({
      kind: "institution",
      villageId: village?.villageId,
      generatorVersion: version,
      slotId: slot?.id ?? null,
      institutionType: String(institution?.type ?? ""),
      institutionId: String(institution?.id ?? institution?.type ?? ""),
      assetKey: asset.assetKey,
      stateAssetKey: asset.stateAssetKey,
      visualState: asset.visualState,
      substituted: asset.substituted,
      substitutionReason: asset.substitutionReason,
      unsupported: asset.unsupported
    })
  });
}

export function housingTileData(village, index, options = {}) {
  const slot = options.slot ?? null;
  const placedAt = null;
  const fitted = slot
    ? { width: slot.width, height: slot.height }
    : fitTileToPlot(
        placedAt,
        tileDimensionFor(options, "housing", "Width"),
        tileDimensionFor(options, "housing", "Height")
      );
  const tileWidth = fitted.width;
  const tileHeight = fitted.height;
  // Which art a canonical housing plot uses is decided per plot, not by whether
  // an art set was supplied at all.
  //
  // The old rule was that any `artSet` turned canonical housing off. That reads
  // as "an explicit override wins", and for a set that actually carries housing
  // art it should. But a caller overriding only *institution* art supplies a set
  // with no housing entry, and every one of the sixty-nine houses then resolved
  // to an empty texture — no art, no error, no way to notice except by looking.
  //
  // So an override wins only when it has something to offer. Otherwise the plot
  // keeps the source building the layout named for it. `canonicalHousing: false`
  // still forces the old behaviour outright.
  // `canonicalHousing` is three-state: true demands the source buildings, false
  // refuses them, and unset lets the art on offer decide.
  const demanded = options.canonicalHousing;
  const overrideAsset = demanded === true ? null
    : (options.artSet || demanded === false)
      ? assetForHousing(options.artSet ?? configuredArtSet, "operating", index)
      : null;
  const useCanonicalHousing = Boolean(slot?.asset) && demanded !== false && !overrideAsset?.src;
  const asset = useCanonicalHousing
    ? {
        src: slot.asset,
        assetKey: slot.sourceId ?? slot.id,
        stateAssetKey: slot.sourceId ?? slot.id,
        visualState: "operating",
        substituted: false,
        substitutionReason: null,
        unsupported: false
      }
    : overrideAsset ?? assetForHousing(options.artSet ?? configuredArtSet, "operating", index);
  const version = generatorVersion(options);
  const position = slot
    ? { x: slot.x, y: slot.y }
    : housingPosition(village, index, {
        ...options,
        width: options.sceneWidth ?? options.width,
        height: options.sceneHeight ?? options.height,
        tileWidth,
        tileHeight
      });
  return baseTileData({
    name: `Housing ${index + 1}`,
    asset,
    position,
    width: tileWidth,
    height: tileHeight,
    rotation: options.rotateToStreet === false ? 0 : (slot?.rotation ?? planRotationFor(placedAt)),
    sort: options.housingSort ?? 1000 + index,
    flag: villageTileFlag({
      kind: "housing",
      villageId: village?.villageId,
      generatorVersion: version,
      slotId: slot?.id ?? null,
      housingIndex: index,
      assetKey: asset.assetKey,
      stateAssetKey: asset.stateAssetKey,
      visualState: asset.visualState,
      substituted: asset.substituted,
      substitutionReason: asset.substitutionReason,
      unsupported: asset.unsupported
    })
  });
}

/** @deprecated Runtime planning is disabled; caller-supplied plans pass through for compatibility. */
export function villagePlanFor(_village, options = {}) {
  return options.plan ?? null;
}

/**
 * Where a village's drawn backdrop lives.
 *
 * Under the world's own assets rather than the system's: the file is generated
 * from *this* world's Village record, so it belongs with the world's data and
 * not in a directory that a system update would replace. One stable name per
 * village, so regenerating overwrites rather than accumulating orphans.
 */
export function villageBackgroundPath(villageId, worldId = null) {
  const world = text(worldId) || text(globalThis.game?.world?.id) || "world";
  // Separators are already gone once anything outside this set becomes a dash,
  // so no traversal survives; the dot rules exist so a villageId cannot produce
  // a filename that merely *looks* like one ("..-..-etc-passwd") or a hidden
  // dotfile the Ref cannot see in their own assets folder.
  const id = (text(villageId) || "village")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\-]+/, "")
    || "village";
  const dir = `worlds/${world}/assets/crows-village`;
  return { dir, file: `${id}.svg`, path: `${dir}/${id}.svg` };
}

/**
 * Draw the plan's ground and write it into the world as an SVG.
 *
 * SVG rather than a raster: Foundry accepts it as an image, it stays sharp at
 * any zoom, and a whole village is ~60KB where a 4800x6600 PNG is megabytes.
 * Written as a file rather than embedded as a data URI because the backdrop
 * would otherwise live inside the Scene document and be pushed to every client
 * on every update — ~120KB of base64 in a field that syncs.
 *
 * Returns the path to use as a backdrop, or null if it could not be written;
 * a failed backdrop must not stop a Scene being made.
 */
/**
 * Where every stamped building will actually stand, in plan coordinates.
 *
 * Exported so the backdrop's shadow layer can be laid out from the same numbers
 * the Tiles are built from. A shadow that guesses at its building's size or
 * angle is worse than no shadow at all, and the sizing rules — the grid
 * defaults, the fit into the plot, the quarter-turn onto the street — all live
 * here with the tiles rather than with the renderer.
 */
export function stampFootprints(plan, options = {}) {
  const plotById = new Map((plan?.plots ?? []).map(plot => [plot.id, plot]));
  const footprints = [];

  const push = (kind, placement, extra) => {
    const plot = plotById.get(placement?.plotId);
    if (!plot || plot.use === "vacant" || plot.destroyed) return;
    const fitted = fitTileToPlot(
      { frontage: plot.frontage, depth: plot.depth },
      tileDimensionFor(options, kind, "Width"),
      tileDimensionFor(options, kind, "Height")
    );
    const angle = Number(placement.angle);
    footprints.push({
      kind,
      ...extra,
      center: placement.center,
      // The same quarter-turn `planRotationFor` applies to the Tile.
      angle: (Number.isFinite(angle) ? angle : 0) + Math.PI / 2,
      width: fitted.width,
      height: fitted.height
    });
  };

  for (const placement of plan?.assignment?.institutions ?? []) {
    const plot = plotById.get(placement?.plotId);
    push("institution", placement, {
      type: plot?.institutionType ?? null,
      level: plot?.institutionLevel ?? 1
    });
  }
  (plan?.assignment?.housing ?? []).forEach((placement, index) => {
    push("housing", placement, { index });
  });
  return footprints;
}

/**
 * Load the dressing stamps and prepare them for inlining into the backdrop.
 *
 * They have to be inlined rather than referenced: the backdrop is uploaded as
 * one file and used as a Scene texture, and an SVG loaded as an image will not
 * resolve an external `href`. Fetched here, in the async wrapper, so
 * `renderPlanToSvg` stays a pure string function.
 *
 * Returns null when nothing loads — the renderer falls back to drawing the
 * dressing itself, so a failed fetch costs detail, never a backdrop.
 */
export async function loadVillageDressingSprites() {
  const bodies = {};
  const boxes = {};
  const order = [];

  const load = async (src, id, extract) => {
    try {
      const route = globalThis.foundry?.utils?.getRoute?.(src) ?? src;
      const response = await fetch(route);
      if (!response?.ok) return;
      const body = extract(await response.text());
      if (!body) return;
      bodies[id] = { body };
      boxes[id] = contentBoxFor(src);
      order.push(id);
    } catch { /* a sprite that will not load is simply not drawn */ }
  };

  // Dressing: inlined into the ground because the backdrop is one file.
  for (const entry of [...TREE_STAMPS, ...FARM_PLOT_STAMPS]) {
    await load(entry.src, `vp-${slugFor(entry.src)}`, stampBody);
  }
  // Building shadows: the buildings themselves are Tiles, but a Tile takes no
  // SVG filter, so their shadows are painted onto the ground they fall on.
  for (const entry of [...Object.values(INSTITUTION_STAMPS), ...HOUSING_STAMPS]) {
    const shadow = shadowSrcFor(entry.src);
    if (shadow) await load(shadow, `vp-shadow-${slugFor(entry.src)}`, stampShadowBody);
  }
  return order.length ? { bodies, boxes, order } : null;
}

export async function writeVillagePlanBackground({
  plan, villageId, style = null, worldId = null, showTitle = true, sprites = undefined,
  // Tile sizing, so the shadows painted onto the ground match the Tiles that
  // will stand on it.
  tileOptions = {}
} = {}) {
  if (!plan) return null;
  const picker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation
    ?? globalThis.FilePicker;
  if (typeof picker?.upload !== "function") return null;

  const { dir, file, path } = villageBackgroundPath(villageId, worldId);
  try {
    const resolved = sprites === undefined ? await loadVillageDressingSprites() : sprites;
    const svg = villageBackgroundSvg(plan, {
      style,
      showTitle,
      sprites: resolved,
      footprints: stampFootprints(plan, tileOptions)
    });
    try {
      await picker.createDirectory("data", dir);
    } catch { /* already present, which is the common case */ }
    const upload = new File([svg], file, { type: "image/svg+xml" });
    const result = await picker.upload("data", dir, upload, {}, { notify: false });
    return text(result?.path) || path;
  } catch (error) {
    console.error("crows | could not write the village backdrop", error);
    return null;
  }
}

/**
 * The drawn building art, as one file per shape.
 *
 * One file per *shape* rather than per institution: `INSTITUTION_SHAPES` already
 * collapses twelve institutions and their level bands onto fourteen shapes, and
 * a church is the same drawing whichever village it stands in. Housing gets a
 * few material variants so a street is not a row of identical roofs.
 *
 * Names are stable, so regenerating overwrites in place.
 */
export const DRAWN_HOUSING_VARIANTS = Object.freeze(["thatch", "wood", "thatch", "wood", "wood"]);

export function drawnArtPath(name, worldId = null) {
  const world = text(worldId) || text(globalThis.game?.world?.id) || "world";
  const dir = `worlds/${world}/assets/crows-village/art`;
  return { dir, file: `${name}.svg`, path: `${dir}/${name}.svg` };
}

/**
 * An art set that resolves the shipped logical keys onto drawn SVG files.
 *
 * The logical keys and the drawn shapes already agree by design, except that
 * the catalogue marks the two it has no art for — `unsupported.crypt` and
 * `unsupported.stables` — which map onto the shapes drawn for exactly them.
 */
export function drawnVillageArtSet(paths) {
  const forKey = key => paths[text(key).replace(/^unsupported\./, "")] ?? null;
  return {
    resolve({ key, assetKey, visualState, kind }) {
      if (kind === "background") return null;
      if (visualState === "destroyed" && paths.ruin) {
        return { src: paths.ruin, label: "Ruin" };
      }
      const src = forKey(assetKey ?? key);
      return src ? { src, label: text(assetKey ?? key) } : null;
    },
    housingPool: DRAWN_HOUSING_VARIANTS.map((_, i) => paths[`house-${i}`]).filter(Boolean)
  };
}

/**
 * Draw every building shape once and write it into the world.
 *
 * Returns an art set ready to hand to the projection, or null if nothing could
 * be written — in which case the shipped PNG catalogue is still there.
 */
export async function writeVillagePlanArt({ worldId = null, style = null, size = 512 } = {}) {
  const picker = globalThis.foundry?.applications?.apps?.FilePicker?.implementation
    ?? globalThis.FilePicker;
  if (typeof picker?.upload !== "function") return null;

  const { dir } = drawnArtPath("probe", worldId);
  // Materials follow the institution that uses the shape, so a temple is slate
  // and a smithy clay just as they are on the drawn map. Every level band is
  // walked, not just the last, or the first-level shapes (smith, church) would
  // be drawn in the fallback material.
  const materialByShape = {};
  for (const [type, def] of Object.entries(INSTITUTION_ART_KEYS)) {
    for (const band of def.levels ?? []) {
      const shape = text(band.key).replace(/^unsupported\./, "");
      if (shape && !(shape in materialByShape)) materialByShape[shape] = materialForInstitution(type);
    }
  }

  const jobs = [];
  for (const shape of BUILDING_SHAPES) {
    if (shape === "house") continue;
    jobs.push([shape, { material: materialByShape[shape] ?? null }]);
  }
  DRAWN_HOUSING_VARIANTS.forEach((material, i) => jobs.push([`house-${i}`, { shape: "house", material, institution: false }]));
  jobs.push(["ruin", { shape: "cathedral", destroyed: true }]);

  const paths = {};
  try {
    try { await picker.createDirectory("data", dir); } catch { /* already present */ }
    for (const [name, opts] of jobs) {
      const svg = shapeSvg(opts.shape ?? name, {
        ...opts,
        style,
        size,
        // Never bake a shadow into Tile art; the Tile rotates and the shadow
        // would rotate with it.
        shadow: false,
        // The drawn backdrop already supplies the ground, so a filled yard here
        // would sit on the map as a pale card under the building.
        ground: false,
        // `drawBuilding` already insets to 0.94; padding on top of that leaves
        // buildings visibly smaller than the plots they were fitted to.
        padding: 0
      });
      const { dir: d, file, path } = drawnArtPath(name, worldId);
      const result = await picker.upload("data", d, new File([svg], file, { type: "image/svg+xml" }), {}, { notify: false });
      paths[name] = text(result?.path) || path;
    }
  } catch (error) {
    console.error("crows | could not write the drawn building art", error);
    return Object.keys(paths).length ? drawnVillageArtSet(paths) : null;
  }
  return drawnVillageArtSet(paths);
}

/** Build one immutable canonical field/tree tile. */
function canonicalDressingTileData(village, slot, index, kind, options = {}) {
  const tile = baseTileData({
    name: `${kind === "farmland" ? "Field" : "Dressing"} ${index + 1}`,
    asset: { src: slot.asset },
    position: slot,
    width: slot.width,
    height: slot.height,
    rotation: slot.rotation ?? 0,
    sort: (kind === "farmland" ? 10 : 3000) + index,
    flag: villageTileFlag({
      kind,
      villageId: village?.villageId,
      generatorVersion: generatorVersion(options),
      slotId: slot.id,
      sourceId: slot.sourceId,
      assetKey: slot.asset,
      visualState: "operating",
      unsupported: false
    })
  });
  return tile;
}

function unbuiltInstitutionTileData(village, type, slot, index, options = {}) {
  return baseTileData({
    name: `Unbuilt ${institutionLabel(type)} plot`,
    asset: { src: CANONICAL_UNBUILT_PLOT },
    position: slot,
    width: slot.width,
    height: slot.height,
    rotation: slot.rotation,
    sort: 100 + index,
    flag: villageTileFlag({
      kind: "institution",
      villageId: village?.villageId,
      generatorVersion: generatorVersion(options),
      slotId: slot.id,
      institutionType: type,
      institutionId: null,
      assetKey: "unbuilt-plot",
      stateAssetKey: "unbuilt-plot",
      visualState: "unbuilt",
      substituted: false,
      substitutionReason: null,
      unsupported: false
    })
  });
}

/** Build all desired generated data without touching Foundry documents. */
export function buildVillageProjection(village, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const institutionTypes = Object.keys(CANONICAL_INSTITUTION_SLOTS);
  const institutions = institutionTypes.map((type, index) => {
    const slot = CANONICAL_INSTITUTION_SLOTS[type];
    const institution = findLiveInstitution(type, source)
      ?? source.institutions.find(candidate => String(candidate?.type ?? "") === type)
      ?? null;
    return institution
      ? institutionTileData(source, institution, { ...options, slot, sort: options.sort ?? 100 + index })
      : unbuiltInstitutionTileData(source, type, slot, index, options);
  });

  const housingTier = housingTierForProsperity(source.prosperity);
  const housingCount = canonicalHousingCountForProsperity(source.prosperity);
  const housing = CANONICAL_HOUSING_SLOTS.slice(0, housingCount).map((slot, index) =>
    housingTileData(source, index, { ...options, slot })
  );
  const farmlandCount = canonicalPrefixCount(source.prosperity, CANONICAL_FARMLAND_SLOTS.length);
  const farmland = CANONICAL_FARMLAND_SLOTS.slice(0, farmlandCount).map((slot, index) =>
    canonicalDressingTileData(source, slot, index, "farmland", options)
  );
  const dressingCount = canonicalPrefixCount(source.prosperity, CANONICAL_DRESSING_SLOTS.length);
  const dressing = CANONICAL_DRESSING_SLOTS.slice(0, dressingCount).map((slot, index) =>
    canonicalDressingTileData(source, slot, index, "dressing", options)
  );
  const tiles = [...farmland, ...institutions, ...housing, ...dressing];

  return {
    villageId: source.villageId,
    sceneSeed: source.sceneSeed,
    plan: null,
    housingTier,
    housingCount: housing.length,
    farmlandCount: farmland.length,
    dressingCount: dressing.length,
    institutions,
    housing,
    farmland,
    dressing,
    tiles,
    unsupported: tiles
      .filter(tile => tile.flags?.crows?.village?.unsupported)
      .map(tile => ({
        kind: tile.flags.crows.village.kind,
        institutionId: tile.flags.crows.village.institutionId,
        housingIndex: tile.flags.crows.village.housingIndex,
        assetKey: tile.flags.crows.village.assetKey
      }))
  };
}

export const projectVillageTiles = buildVillageProjection;
export const villageMapProjection = buildVillageProjection;

function institutionProjection(institution, village) {
  const effective = effectiveInstitutionForMap(institution, village);
  return {
    id: String(institution?.id ?? institution?.type ?? ""),
    type: text(institution?.type),
    name: text(institution?.name),
    level: effective.level,
    closed: effective.closed,
    destroyed: institution?.destroyed === true,
    pendingLevel: institution?.pendingLevel ?? null,
    pendingFromCycle: institution?.pendingFromCycle ?? null
  };
}

function projectionState(village) {
  const source = normalizeVillage(village ?? {});
  return {
    institutions: new Map(source.institutions.map(institution => [
      String(institution?.type ?? ""), institutionProjection(institution, source)
    ])),
    prosperity: clampProsperity(source.prosperity)
  };
}

function projectionScope(next, previous, options = {}) {
  if (options.force === true || options.cacheMiss === true || previous == null) {
    return {
      all: true,
      institutions: new Set(next.institutions.map(institution => String(institution?.type ?? ""))),
      housing: true
    };
  }
  const current = projectionState(next);
  const prior = projectionState(previous);
  const institutions = new Set();
  const keys = new Set([...current.institutions.keys(), ...prior.institutions.keys()]);
  for (const key of keys) {
    if (!equalValue(current.institutions.get(key), prior.institutions.get(key))) institutions.add(key);
  }
  return {
    all: false,
    institutions,
    housing: current.prosperity !== prior.prosperity
  };
}

function mapAuthorityFailure() {
  if (!globalThis.game?.user) return null;
  if (isVillageDesignatedWriter()) return null;
  const active = getActiveVillageGM();
  return {
    ok: false,
    error: "authority-unavailable",
    reason: active ? "request-must-run-on-designated-gm" : "no-active-gm",
    activeGMId: active?.id ?? null,
    reconciliationRequired: false
  };
}

function tileProjection(tile) {
  const source = tile?.toObject?.() ?? tile ?? {};
  return {
    name: source.name ?? tile?.name ?? "",
    texture: {
      src: source.texture?.src ?? tile?.texture?.src ?? null,
      anchorX: Number(source.texture?.anchorX ?? tile?.texture?.anchorX ?? 0.5),
      anchorY: Number(source.texture?.anchorY ?? tile?.texture?.anchorY ?? 0.5),
      fit: source.texture?.fit ?? tile?.texture?.fit ?? "fill",
      scaleX: Number(source.texture?.scaleX ?? tile?.texture?.scaleX ?? 1),
      scaleY: Number(source.texture?.scaleY ?? tile?.texture?.scaleY ?? 1),
      tint: source.texture?.tint ?? tile?.texture?.tint ?? "#ffffff",
      alphaThreshold: Number(source.texture?.alphaThreshold ?? tile?.texture?.alphaThreshold ?? 0)
    },
    x: Number(source.x ?? tile?.x ?? 0),
    y: Number(source.y ?? tile?.y ?? 0),
    width: Number(source.width ?? tile?.width ?? 0),
    height: Number(source.height ?? tile?.height ?? 0),
    elevation: Number(source.elevation ?? tile?.elevation ?? 0),
    sort: Number(source.sort ?? tile?.sort ?? 0),
    rotation: Number(source.rotation ?? tile?.rotation ?? 0),
    alpha: Number(source.alpha ?? tile?.alpha ?? 1),
    hidden: Boolean(source.hidden ?? tile?.hidden),
    locked: Boolean(source.locked ?? tile?.locked),
    flag: tileFlag(tile)
  };
}

function tileMatches(tile, desired) {
  const current = tileProjection(tile);
  const wanted = tileProjection(desired);
  return equalValue(current, wanted);
}

function updateForTile(tile, desired) {
  const id = tileId(tile);
  return {
    _id: id,
    name: desired.name,
    texture: clone(desired.texture),
    x: desired.x,
    y: desired.y,
    width: desired.width,
    height: desired.height,
    elevation: desired.elevation,
    sort: desired.sort,
    rotation: desired.rotation,
    alpha: desired.alpha,
    hidden: desired.hidden,
    locked: desired.locked,
    flags: clone(desired.flags)
  };
}

function resultError(message, details = {}) {
  return {
    ok: false,
    error: "reconciliation-failed",
    message: String(message),
    reconciliationRequired: true,
    repairRequired: true,
    state: "unknown",
    ...details
  };
}

function sceneInitialLevelDocument(scene) {
  const source = scene?.toObject?.() ?? scene ?? {};
  const id = source.initialLevel ?? scene?.initialLevel ?? DEFAULT_LEVEL_ID;
  return scene?.levels?.get?.(id)
    ?? scenesFrom(scene?.levels).find(level => String(level?.id ?? level?._id ?? "") === String(id))
    ?? null;
}

/** Migrate only the generated Scene envelope; manual placeables remain inert. */
async function ensureCanonicalSceneEnvelope(scene, village, options = {}) {
  const source = scene?.toObject?.() ?? scene ?? {};
  const existingFlag = villageSceneFlag(scene);
  const persistedCustomBackground = existingFlag?.backgroundKey === "custom"
    ? text(existingFlag?.backgroundSrc)
    : "";
  const desired = villageSceneData(village, operationToken(options.operationId), persistedCustomBackground
    ? { ...options, backgroundSrc: text(options.backgroundSrc) || persistedCustomBackground }
    : options);
  const flag = villageSceneFlag(scene);
  const staleVersion = flag?.generatorVersion !== VILLAGE_MAP_GENERATOR_VERSION;
  const widthMismatch = Number(source.width) !== desired.width;
  const heightMismatch = Number(source.height) !== desired.height;
  const backgroundSrc = desired.background?.src ?? desired.levels?.[0]?.background?.src ?? null;
  const level = sceneInitialLevelDocument(scene);
  const levelSource = level?.toObject?.() ?? level ?? {};
  const backgroundMismatch = Boolean(backgroundSrc) && levelSource.background?.src !== backgroundSrc;
  if (!staleVersion && !widthMismatch && !heightMismatch && !backgroundMismatch) {
    return { ok: true, writes: [] };
  }

  const writes = [];
  if (staleVersion || widthMismatch || heightMismatch) {
    if (typeof scene?.update !== "function") {
      return resultError("Scene envelope migration is unavailable", { operation: "scene-update" });
    }
    try {
      await scene.update({
        width: desired.width,
        height: desired.height,
        "flags.crows.village": clone(desired.flags.crows.village)
      });
      writes.push({ operation: "scene-update", count: 1 });
    } catch (error) {
      return resultError(error?.message ?? error, { operation: "scene-update", count: 1 });
    }
  }

  if (backgroundMismatch) {
    if (typeof level?.update !== "function") {
      return resultError("Scene Level background migration is unavailable", {
        operation: "level-update",
        writes
      });
    }
    try {
      await level.update({ background: { src: backgroundSrc } });
      writes.push({ operation: "level-update", count: 1 });
    } catch (error) {
      return resultError(error?.message ?? error, { operation: "level-update", count: 1, writes });
    }
  }
  return { ok: true, writes };
}

const projectionFlights = new Map();

function withProjectionFlight(villageId, task) {
  const key = text(villageId) || "__unknown__";
  const previous = projectionFlights.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  projectionFlights.set(key, current);
  current.finally(() => {
    if (projectionFlights.get(key) === current) projectionFlights.delete(key);
  }).catch(() => undefined);
  return current;
}

async function reconcileVillageSceneInternal(nextInput, previousInput, options = {}) {
  const authority = mapAuthorityFailure();
  if (authority) return authority;
  const next = normalizeVillage(nextInput ?? getVillage());
  const previous = previousInput == null ? null : normalizeVillage(previousInput);
  let scope = projectionScope(next, previous, options);

  let scene = options.scene ?? sceneById(next.sceneId, options.scenes ?? globalThis.game?.scenes);
  if (!scene) {
    const classification = classifyVillageScenes(next.villageId, options.scenes ?? globalThis.game?.scenes);
    if (classification.status === "multiple") {
      return {
        ok: false,
        error: "bootstrap-duplicate",
        code: "duplicate-scene",
        duplicate: true,
        repairRequired: true,
        reconciliationRequired: true,
        candidates: classification.candidates
      };
    }
    scene = classification.scenes[0] ?? null;
  }
  if (!scene) {
    return {
      ok: false,
      error: "scene-missing",
      repairRequired: true,
      reconciliationRequired: true,
      villageId: next.villageId
    };
  }

  const staleGenerated = generatedVillageTiles(scene, next.villageId)
    .some(tile => tileFlag(tile)?.generatorVersion !== VILLAGE_MAP_GENERATOR_VERSION);
  if (staleGenerated || villageSceneFlag(scene)?.generatorVersion !== VILLAGE_MAP_GENERATOR_VERSION) {
    scope = {
      all: true,
      institutions: new Set(next.institutions.map(institution => String(institution?.type ?? ""))),
      housing: true
    };
  }
  if (!scope.all && !scope.housing && scope.institutions.size === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "unrelated-village-change",
      villageId: next.villageId,
      writes: [],
      tileIds: generatedVillageTiles(scene, next.villageId).map(tileId).filter(Boolean)
    };
  }

  const envelope = await ensureCanonicalSceneEnvelope(scene, next, options);
  if (!envelope.ok) return { ...envelope, villageId: next.villageId, sceneId: sceneId(scene) };

  const projection = buildVillageProjection(next, options);
  const desired = new Map(projection.tiles.map(tile => [tileIdentityKey(tileFlag(tile)), tile]));
  const existing = generatedVillageTiles(scene, next.villageId);
  const existingByKey = new Map();
  for (const tile of existing) {
    const key = tileIdentityKey(tileFlag(tile));
    if (!key) continue;
    const prior = existingByKey.get(key);
    if (prior) {
      // A duplicate generated identity is managed content too.  Keep the
      // first document for update and remove the duplicate during a full
      // repair or when that identity is part of the current diff.
      const duplicates = existingByKey.get(`${key}:duplicates`) ?? [];
      duplicates.push(tile);
      existingByKey.set(`${key}:duplicates`, duplicates);
    } else existingByKey.set(key, tile);
  }

  const shouldTouchInstitution = key => scope.all || scope.institutions.has(key.slice("institution:".length));
  const shouldTouchHousing = key => scope.all || scope.housing;
  const creates = [];
  const updates = [];
  const deletes = [];
  for (const [key, wanted] of desired) {
    const kind = key.split(":", 1)[0];
    const shouldTouch = kind === "institution" ? shouldTouchInstitution(key) : shouldTouchHousing(key);
    if (!shouldTouch) continue;
    const current = existingByKey.get(key);
    if (!current) creates.push(wanted);
    else if (!tileMatches(current, wanted)) updates.push(updateForTile(current, wanted));
    for (const duplicate of existingByKey.get(`${key}:duplicates`) ?? []) {
      if (shouldTouch) deletes.push(tileId(duplicate));
    }
  }
  for (const tile of existing) {
    const key = tileIdentityKey(tileFlag(tile));
    if (!key || desired.has(key)) continue;
    const kind = key.split(":", 1)[0];
    const shouldTouch = kind === "institution" ? shouldTouchInstitution(key) : shouldTouchHousing(key);
    if (shouldTouch) deletes.push(tileId(tile));
  }

  const writes = [...envelope.writes];
  const failed = [];
  if (creates.length) {
    try {
      await scene.createEmbeddedDocuments("Tile", clone(creates));
      writes.push({ operation: "create", count: creates.length });
    } catch (error) {
      failed.push(resultError(error?.message ?? error, { operation: "create", count: creates.length }));
    }
  }
  if (updates.length) {
    try {
      await scene.updateEmbeddedDocuments("Tile", clone(updates));
      writes.push({ operation: "update", count: updates.length });
    } catch (error) {
      failed.push(resultError(error?.message ?? error, { operation: "update", count: updates.length }));
    }
  }
  const deleteIds = [...new Set(deletes.filter(Boolean))];
  if (deleteIds.length) {
    try {
      await scene.deleteEmbeddedDocuments("Tile", clone(deleteIds));
      writes.push({ operation: "delete", count: deleteIds.length });
    } catch (error) {
      failed.push(resultError(error?.message ?? error, { operation: "delete", count: deleteIds.length }));
    }
  }

  const nowFlagged = generatedVillageTiles(scene, next.villageId);
  const tileIds = nowFlagged.map(tileId).filter(Boolean);
  if (failed.length) {
    return {
      ...failed[0],
      villageId: next.villageId,
      sceneId: sceneId(scene),
      writes,
      failures: failed,
      tileIds,
      flaggedOnly: true
    };
  }
  return {
    ok: true,
    villageId: next.villageId,
    sceneId: sceneId(scene),
    scene,
    writes,
    creates: creates.length,
    updates: updates.length,
    deletes: deleteIds.length,
    flaggedOnly: true,
    tileIds,
    projection
  };
}

/** Reconcile only the flagged generated set; manual Scene decoration is inert. */
export function reconcileVillageScene(next, previous = null, options = {}) {
  const villageId = normalizeVillage(next ?? getVillage()).villageId;
  return withProjectionFlight(villageId, () => reconcileVillageSceneInternal(next, previous, options));
}

export const reconcileVillageMap = reconcileVillageScene;
export const reconcileScene = reconcileVillageScene;

function sceneGridData(options = {}) {
  const supplied = options.grid && typeof options.grid === "object" ? clone(options.grid) : {};
  const value = (optionKey, suppliedKey, fallback) => {
    const candidate = Number(options[optionKey] ?? supplied[suppliedKey] ?? fallback);
    return Number.isFinite(candidate) ? candidate : fallback;
  };
  return {
    ...SCENE_DEFAULTS.grid,
    ...supplied,
    type: Math.max(0, Math.floor(value("gridType", "type", SCENE_DEFAULTS.grid.type))),
    size: Math.max(1, Math.floor(value("gridSize", "size", SCENE_DEFAULTS.grid.size))),
    distance: Math.max(1, value("gridDistance", "distance", SCENE_DEFAULTS.grid.distance)),
    units: options.gridUnits ?? supplied.units ?? SCENE_DEFAULTS.grid.units,
    style: options.gridStyle ?? supplied.style ?? SCENE_DEFAULTS.grid.style,
    thickness: Math.max(0, Math.floor(value("gridThickness", "thickness", SCENE_DEFAULTS.grid.thickness))),
    color: options.gridColor ?? supplied.color ?? SCENE_DEFAULTS.grid.color,
    alpha: Math.max(0, Math.min(1, value("gridAlpha", "alpha", SCENE_DEFAULTS.grid.alpha)))
  };
}

export function villageSceneData(village, operationId, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const version = generatorVersion(options);
  // An explicit/configured backdrop remains an additive Ref override; otherwise
  // the canonical background set is selected through the late-bound resolver.
  const background = text(options.backgroundSrc)
    ? { src: text(options.backgroundSrc), variant: "custom", key: "custom" }
    : resolveVillageBackground({
        variant: options.backgroundVariant ?? SCENE_DEFAULTS.backgroundVariant,
        artSet: options.artSet,
        backgroundSet: options.backgroundSet
      });
  return {
    name: source.name || "Village",
    // Canonical slot coordinates are authored against this one square canvas.
    width: SCENE_DEFAULTS.width,
    height: SCENE_DEFAULTS.height,
    padding: 0,
    grid: sceneGridData(options),
    // A v14 Scene has NO `background` field: the backdrop moved onto the Level
    // documents in `Scene#levels`, and `Scene#background` survives only as a
    // deprecated getter over `initialLevel`. Foundry's `Scene#_preCreate` does
    // carry a legacy `data.background` onto a default Level, but that branch is
    // guarded by `!this.levels.size`, and the schema has already materialized
    // `defaultLevel0000` by the time it runs — so a legacy-shaped payload is
    // accepted without error and silently drops the backdrop. Verified against
    // a live v14.367 world: `{background:{src}}` on create yields a null Level
    // background; the explicit `levels` form below is what sticks.
    //
    // `background` is still emitted because the projection's own consumers and
    // assertions read it as the resolved backdrop; `levels` is what Foundry
    // actually stores. Keep the two in step.
    ...(background.src
      ? {
          background: { src: background.src },
          initialLevel: DEFAULT_LEVEL_ID,
          levels: [{
            _id: DEFAULT_LEVEL_ID,
            name: "Level",
            background: { src: background.src }
          }]
        }
      : {}),
    // The village map is a shared overview the whole table reads, not a place
    // anyone explores with a torch — which is why it grants Observer below.
    // Foundry's defaults fight that: token vision on, no global light, and
    // per-user fog exploration. A player opening the village would see black.
    // FOG_EXPLORATION_MODES.DISABLED is 0.
    tokenVision: false,
    fog: { mode: 0 },
    navigation: true,
    ownership: { default: sceneOwnershipObserver() },
    flags: {
      crows: {
        village: {
          villageId: source.villageId,
          generatorVersion: version,
          bootstrap: String(operationId ?? source.bootstrap?.txId ?? ""),
          backgroundVariant: background.variant,
          backgroundKey: background.key,
          backgroundSrc: background.src
        }
      }
    }
  };
}

export const buildVillageSceneData = villageSceneData;

function creatorConnection(input = {}) {
  const source = input.npcConnection ?? input.connection ?? {};
  return {
    name: text(source.name ?? input.connectionName),
    relationship: text(source.relationship ?? input.connectionRelationship),
    benefit: text(source.benefit ?? source.benefitId ?? input.connectionBenefit ?? input.benefit),
    notes: text(source.notes ?? input.connectionNotes)
  };
}

function chosenInstitution(input = {}) {
  return text(input.groupInstitution ?? input.sixthInstitution ?? input.startingInstitution
    ?? input.choice ?? input.institution);
}

/** Validate creator choices without writing settings or documents. */
export function validateVillageCreatorInput(input = {}, { requireBenefit = false } = {}) {
  const errors = [];
  const name = text(input.name ?? input.villageName);
  if (!name) errors.push("village-name-required");
  const choice = chosenInstitution(input);
  if (!choice) errors.push("starting-institution-choice-required");
  else if (!INSTITUTION_KEYS.includes(choice)) errors.push("starting-institution-invalid");
  else if (STARTING_INSTITUTIONS.includes(choice)) errors.push("starting-institution-must-be-additional");
  if (STARTING_INSTITUTION_CHOICES !== 1) errors.push("starting-institution-choice-configuration-invalid");
  const connection = creatorConnection(input);
  if (!connection.name) errors.push("connection-name-required");
  if (!connection.relationship) errors.push("connection-relationship-required");
  if (connection.benefit && !CONNECTION_BENEFITS.some(benefit => benefit.id === connection.benefit)) {
    errors.push("connection-benefit-invalid");
  } else if (requireBenefit && !connection.benefit) errors.push("connection-benefit-required");
  return {
    ok: errors.length === 0,
    errors,
    name,
    choice,
    connection
  };
}

function startingInstitutionRecord(village, type, index) {
  const existing = village.institutions.find(institution => institution.type === type);
  if (existing) return clone(existing);
  return {
    id: `${village.villageId}-institution-${index}-${type}`,
    type,
    name: institutionLabel(type),
    level: 1,
    steward: "",
    foundedOnCycle: village.cycle ?? 0,
    operatingFromCycle: village.cycle ?? 0,
    pendingLevel: null,
    pendingFromCycle: null,
    destroyed: false,
    destroyedOnCycle: null,
    destruction: null
  };
}

/** Build the durable first Village record used by the creator/bootstrap saga. */
export function createVillageRecord(input = {}, { village = null } = {}) {
  const validation = validateVillageCreatorInput(input, { requireBenefit: false });
  if (!validation.ok) return validation;
  const source = normalizeVillage(village ?? defaultVillage());
  const fixed = STARTING_INSTITUTIONS.map((type, index) => startingInstitutionRecord(source, type, index));
  const chosen = startingInstitutionRecord(source, validation.choice, fixed.length);
  const byType = new Map([...fixed, chosen].map(institution => [institution.type, institution]));
  const remainder = source.institutions.filter(institution => !byType.has(institution.type));
  const next = normalizeVillage({
    ...source,
    name: validation.name,
    isHome: true,
    tracksCycles: true,
    canInvest: true,
    npcConnection: validation.connection,
    institutions: [...byType.values(), ...remainder]
  }, { identity: { villageId: source.villageId, sceneSeed: source.sceneSeed } });
  return { ok: true, village: next, choice: validation.choice, connection: validation.connection };
}

export const prepareVillageCreator = createVillageRecord;

function hasCreatorFields(options = {}) {
  return Object.prototype.hasOwnProperty.call(options, "name")
    || Object.prototype.hasOwnProperty.call(options, "villageName")
    || Object.prototype.hasOwnProperty.call(options, "groupInstitution")
    || Object.prototype.hasOwnProperty.call(options, "sixthInstitution")
    || Object.prototype.hasOwnProperty.call(options, "startingInstitution")
    || Object.prototype.hasOwnProperty.call(options, "npcConnection")
    || Object.prototype.hasOwnProperty.call(options, "connectionName")
    || Object.prototype.hasOwnProperty.call(options, "connectionRelationship")
    || Object.prototype.hasOwnProperty.call(options, "connectionBenefit")
    || Object.prototype.hasOwnProperty.call(options, "connectionNotes");
}

function operationToken(value) {
  return text(value);
}

function phaseAtLeast(actual, expected) {
  if (actual === "uncertain") return false;
  return (PHASE_ORDER[actual] ?? -1) >= (PHASE_ORDER[expected] ?? 0);
}

function phasePatch(bootstrap, patch) {
  const current = bootstrap && typeof bootstrap === "object" ? clone(bootstrap) : {};
  const desiredPhase = patch.phase ?? current.phase ?? "prepared";
  const currentPhase = current.phase ?? "prepared";
  let phase = desiredPhase;
  if (currentPhase === "committed" && desiredPhase !== "uncertain") phase = "committed";
  else if (currentPhase !== "uncertain" && desiredPhase !== "uncertain"
    && phaseAtLeast(currentPhase, desiredPhase)) phase = currentPhase;
  return {
    ...current,
    ...clone(patch),
    phase,
    txId: patch.txId ?? current.txId ?? null,
    candidateSceneId: patch.candidateSceneId ?? current.candidateSceneId ?? null
  };
}

async function persistBootstrapPhase(current, patch, operationId, options = {}) {
  const next = normalizeVillage(current, { identity: { villageId: current.villageId, sceneSeed: current.sceneSeed } });
  next.bootstrap = phasePatch(next.bootstrap, patch);
  if (patch.candidateSceneId != null) next.sceneId = String(patch.candidateSceneId);
  const changed = !equalValue(next.bootstrap, current.bootstrap)
    || next.sceneId !== current.sceneId
    || (patch.forceState && !equalValue(next, current));
  if (!changed) return current;
  return saveVillage(next, {
    prev: current,
    operationId,
    settingOptions: options.settingOptions,
    sourceUserId: options.sourceUserId
  });
}

async function uncertainBootstrap(current, operationId, details = {}) {
  const live = normalizeVillage(getVillage());
  const sceneIdValue = details.sceneId ?? live.sceneId ?? live.bootstrap?.candidateSceneId ?? null;
  const patch = {
    txId: operationId,
    phase: "uncertain",
    candidateSceneId: sceneIdValue,
    tileIds: details.tileIds ?? live.bootstrap?.tileIds ?? [],
    reason: details.reason ?? "acknowledgement-lost"
  };
  try {
    const saved = await persistBootstrapPhase(live, patch, operationId, {});
    return {
      ok: false,
      error: "write-failed",
      state: "unknown",
      reconciliationRequired: true,
      repairRequired: true,
      phase: "uncertain",
      operationId,
      village: clone(saved),
      ...details
    };
  } catch (error) {
    return {
      ok: false,
      error: "write-failed",
      state: "unknown",
      reconciliationRequired: true,
      repairRequired: true,
      phase: "uncertain",
      operationId,
      message: String(error?.message ?? error),
      ...details
    };
  }
}

/** Resolve immutable canonical art without planning or uploading world assets. */
async function prepareCanonicalMap(_village, options = {}) {
  const baseArtSet = options.artSet ?? configuredArtSet;
  const next = {
    ...options,
    plan: null,
    backgroundSet: options.backgroundSet ?? configuredBackgroundSet,
    // Explicit/configured art sets remain an additive override. The default
    // catalogue keeps the source-extracted housing that defines this layout.
    canonicalHousing: options.canonicalHousing ?? (!options.artSet && configuredArtSet === VILLAGE_ART_SET)
  };
  if (!text(options.backgroundSrc)) delete next.backgroundSrc;
  if (!options.artSet && options.stampArt !== false) {
    next.artSet = composeStampArtSet(baseArtSet);
  }
  return next;
}

async function bootstrapVillageSceneInternal(options = {}) {
  let current = normalizeVillage(options.village ?? getVillage());
  const authority = mapAuthorityFailure();
  if (authority) return authority;
  if (current.canInvest === false || current.isHome === false) {
    return { ok: false, error: "non-home-village", villageId: current.villageId };
  }

  const requestedToken = operationToken(options.operationId ?? options.txId);
  const operationId = requestedToken || operationToken(current.bootstrap?.txId)
    || `village-bootstrap-${Math.random().toString(36).slice(2, 14)}`;
  const existingToken = operationToken(current.bootstrap?.txId);
  if (existingToken && existingToken !== operationId && current.bootstrap?.phase !== "committed") {
    return {
      ok: false,
      error: "operation-pending",
      phase: current.bootstrap?.phase ?? "prepared",
      operationId,
      pendingOperationId: existingToken,
      reconciliationRequired: current.bootstrap?.phase === "uncertain"
    };
  }

  let prepared = current;
  let creatorResult = null;
  if (hasCreatorFields(options)) {
    creatorResult = createVillageRecord(options, { village: current });
    if (!creatorResult.ok) return creatorResult;
    prepared = creatorResult.village;
  }
  const inputFingerprint = options.inputFingerprint
    ?? current.bootstrap?.inputFingerprint
    ?? (creatorResult ? JSON.stringify(stableValue({
      name: creatorResult.village.name,
      choice: creatorResult.choice,
      connection: creatorResult.connection
    })) : null);
  const preparedBootstrap = phasePatch(prepared.bootstrap, {
    txId: operationId,
    phase: existingToken === operationId ? (prepared.bootstrap?.phase ?? "prepared") : "prepared",
    candidateSceneId: prepared.sceneId ?? prepared.bootstrap?.candidateSceneId ?? null,
    inputFingerprint,
    generatorVersion: generatorVersion(options)
  });
  prepared.bootstrap = preparedBootstrap;
  const shouldPrepare = !equalValue(prepared, current)
    || operationToken(current.bootstrap?.txId) !== operationId;
  if (shouldPrepare) {
    try {
      current = await saveVillage(prepared, {
        prev: current,
        operationId,
        settingOptions: options.settingOptions,
        sourceUserId: options.sourceUserId
      });
    } catch (error) {
      return uncertainBootstrap(current, operationId, {
        phase: "prepared",
        message: String(error?.message ?? error),
        reason: "prepared-setting-write"
      });
    }
  } else current = prepared;

  const collection = options.scenes ?? globalThis.game?.scenes;
  let classification = classifyVillageScenes(current.villageId, collection);
  let scene = classification.scenes[0] ?? null;
  if (classification.status === "multiple") {
    return {
      ok: false,
      error: "bootstrap-duplicate",
      code: "duplicate-scene",
      duplicate: true,
      repairRequired: true,
      reconciliationRequired: true,
      operationId,
      villageId: current.villageId,
      candidates: classification.candidates,
      phase: current.bootstrap?.phase ?? "prepared"
    };
  }
  // A previously attached canonical id is useful after a setting write was
  // acknowledged but the collection index has not caught up locally.  It is
  // still accepted only when the document carries the same Village flag.
  if (!scene && current.sceneId) {
    const attached = sceneById(current.sceneId, collection);
    if (attached && villageSceneFlag(attached)?.villageId === current.villageId) scene = attached;
  }

  // Resolve the canonical background before anything is created, so the Scene
  // and its Tiles are committed against the same immutable layout rather than
  // being created against one backdrop and repainted a moment later. Both the
  // Scene payload and tile reconciliation read from the same options.
  const mapOptions = await prepareCanonicalMap(current, options);

  if (!scene) {
    const createScene = sceneCreateFunction(options);
    if (!createScene) {
      return uncertainBootstrap(current, operationId, {
        phase: "prepared",
        reason: "scene-create-unavailable"
      });
    }
    try {
      scene = await createScene(villageSceneData(current, operationId, mapOptions));
      if (Array.isArray(scene)) scene = scene[0];
    } catch (error) {
      return uncertainBootstrap(current, operationId, {
        phase: "prepared",
        message: String(error?.message ?? error),
        reason: "scene-create"
      });
    }
    if (!scene || !sceneId(scene)) {
      return uncertainBootstrap(current, operationId, {
        phase: "prepared",
        reason: "scene-create-no-ack"
      });
    }
  }

  const attachedSceneId = sceneId(scene);
  try {
    current = await persistBootstrapPhase(current, {
      txId: operationId,
      phase: "scene-created",
      candidateSceneId: attachedSceneId,
      generatorVersion: generatorVersion(options)
    }, operationId, options);
  } catch (error) {
    return uncertainBootstrap(current, operationId, {
      phase: "scene-created",
      sceneId: attachedSceneId,
      message: String(error?.message ?? error),
      reason: "scene-phase-write"
    });
  }
  // A setting write may have succeeded while the designated GM changed.  The
  // state is durable but the saga's observation is no longer authoritative.
  if (!isVillageDesignatedWriter()) {
    return {
      ok: false,
      error: "write-failed",
      state: "unknown",
      reconciliationRequired: true,
      repairRequired: true,
      phase: current.bootstrap?.phase,
      operationId,
      sceneId: attachedSceneId
    };
  }

  const reconciled = await reconcileVillageScene(current, null, {
    ...mapOptions,
    scene,
    force: true,
    generatorVersion: generatorVersion(options)
  });
  if (!reconciled.ok) {
    return uncertainBootstrap(current, operationId, {
      phase: "uncertain",
      sceneId: attachedSceneId,
      tileIds: reconciled.tileIds ?? [],
      reason: reconciled.error ?? "tile-reconciliation",
      message: reconciled.message
    });
  }

  try {
    current = await persistBootstrapPhase(current, {
      txId: operationId,
      phase: "tiles-created",
      candidateSceneId: attachedSceneId,
      tileIds: reconciled.tileIds ?? []
    }, operationId, options);
  } catch (error) {
    return uncertainBootstrap(current, operationId, {
      phase: "tiles-created",
      sceneId: attachedSceneId,
      tileIds: reconciled.tileIds ?? [],
      message: String(error?.message ?? error),
      reason: "tiles-phase-write"
    });
  }
  try {
    current = await persistBootstrapPhase(current, {
      txId: operationId,
      phase: "committed",
      candidateSceneId: attachedSceneId,
      tileIds: reconciled.tileIds ?? []
    }, operationId, options);
  } catch (error) {
    return uncertainBootstrap(current, operationId, {
      phase: "uncertain",
      sceneId: attachedSceneId,
      tileIds: reconciled.tileIds ?? [],
      message: String(error?.message ?? error),
      reason: "commit-phase-write"
    });
  }
  const finalAuthority = mapAuthorityFailure();
  if (finalAuthority) {
    return {
      ...finalAuthority,
      state: "unknown",
      reconciliationRequired: true,
      repairRequired: true,
      phase: current.bootstrap?.phase,
      operationId,
      sceneId: attachedSceneId,
      village: clone(current)
    };
  }
  return {
    ok: true,
    operationId,
    villageId: current.villageId,
    sceneId: attachedSceneId,
    scene,
    tileIds: reconciled.tileIds ?? [],
    writes: reconciled.writes ?? [],
    phase: current.bootstrap?.phase ?? "committed",
    replayed: existingToken === operationId,
    village: clone(current),
    creator: creatorResult ? {
      choice: creatorResult.choice,
      connection: clone(creatorResult.connection)
    } : null
  };
}

/** Idempotent local single-flight around the setting/Scene saga. */
export function bootstrapVillageScene(options = {}) {
  const village = normalizeVillage(options.village ?? getVillage());
  return withProjectionFlight(`bootstrap:${village.villageId}`, () => bootstrapVillageSceneInternal(options));
}

export const bootstrapVillage = bootstrapVillageScene;
export const createVillageScene = bootstrapVillageScene;
export const createVillage = bootstrapVillageScene;

const CANONICAL_BACKGROUND_SET = Object.freeze({
  defaultVariant: "day",
  day: Object.freeze({ key: "canonical", src: CANONICAL_VILLAGE_BACKGROUND }),
  night: Object.freeze({ key: "canonical", src: CANONICAL_VILLAGE_BACKGROUND })
});

let configuredArtSet = VILLAGE_ART_SET;
let configuredBackgroundSet = CANONICAL_BACKGROUND_SET;
export function configureVillageArtSet(artSet) {
  configuredArtSet = artSet ?? VILLAGE_ART_SET;
  configuredBackgroundSet = artSet && artSet !== VILLAGE_ART_SET
    ? (configuredArtSet?.backgrounds ?? CANONICAL_BACKGROUND_SET)
    : CANONICAL_BACKGROUND_SET;
  return configuredArtSet;
}

export const setVillageArtSet = configureVillageArtSet;
export const getVillageArtSet = () => configuredArtSet;

export function configureVillageBackgroundSet(backgroundSet) {
  configuredBackgroundSet = backgroundSet ?? CANONICAL_BACKGROUND_SET;
  return configuredBackgroundSet;
}

export const setVillageBackgroundSet = configureVillageBackgroundSet;
export const getVillageBackgroundSet = () => configuredBackgroundSet;

const mapRefreshListeners = new Set();
let mapHooksRegistered = false;

export function villageMapReadModel(village = null, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const selectedArtSet = options.artSet ?? configuredArtSet;
  const projection = buildVillageProjection(source, {
    ...options,
    artSet: selectedArtSet,
    canonicalHousing: options.canonicalHousing ?? selectedArtSet === VILLAGE_ART_SET
  });
  return {
    village: clone(source),
    sceneId: source.sceneId,
    villageId: source.villageId,
    projection,
    unsupported: clone(projection.unsupported)
  };
}

export const getVillageMap = villageMapReadModel;
export const villageMapModel = villageMapReadModel;

export function registerVillageMapListener(listener) {
  if (typeof listener !== "function") return () => {};
  mapRefreshListeners.add(listener);
  return () => mapRefreshListeners.delete(listener);
}

export const subscribeVillageMap = registerVillageMapListener;

/**
 * Register the one map consumer of the foundations dispatcher.  The setting
 * onChange listener remains owned by village.mjs; this hook only refreshes
 * read models on every client and lets the foundations gate Scene writes to
 * the designated GM.
 */
export function registerVillageMapHooks({ artSet = null, backgroundSet = null, onRefresh = null } = {}) {
  if (artSet !== null) {
    configuredArtSet = artSet ?? VILLAGE_ART_SET;
    configuredBackgroundSet = configuredArtSet !== VILLAGE_ART_SET
      ? (configuredArtSet?.backgrounds ?? CANONICAL_BACKGROUND_SET)
      : CANONICAL_BACKGROUND_SET;
  }
  if (backgroundSet !== null) configuredBackgroundSet = backgroundSet ?? CANONICAL_BACKGROUND_SET;
  const unsubscribeRefresh = onRefresh ? registerVillageMapListener(onRefresh) : () => {};
  if (mapHooksRegistered) return unsubscribeRefresh;
  mapHooksRegistered = true;
  registerVillageChangeListener((next, previous, metadata) => {
    const model = villageMapReadModel(next, { artSet: configuredArtSet });
    for (const listener of mapRefreshListeners) {
      try { listener(clone(model), clone(previous), clone(metadata)); }
      catch (error) { console.error("crows | Village map refresh failed", error); }
    }
  });
  setVillageSceneReconciliationEnqueuer((next, previous, metadata = {}) => {
    if (!isVillageDesignatedWriter()) return mapAuthorityFailure();
    return reconcileVillageScene(next, previous, {
      artSet: configuredArtSet,
      backgroundSet: configuredBackgroundSet,
      canonicalHousing: configuredArtSet === VILLAGE_ART_SET,
      cacheMiss: metadata.cacheMiss === true,
      operationId: metadata.operationId
    });
  });
  return unsubscribeRefresh;
}

export const registerVillageSceneHooks = registerVillageMapHooks;
export const registerVillageMapIntegration = registerVillageMapHooks;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function creatorTemplateContext(options = {}) {
  const current = normalizeVillage(options.village ?? getVillage());
  return {
    village: current,
    institutionChoices: INSTITUTION_KEYS
      .filter(type => !STARTING_INSTITUTIONS.includes(type))
      .map(type => ({ value: type, label: institutionLabel(type) })),
    connectionBenefits: CONNECTION_BENEFITS.map(benefit => ({ value: benefit.id, label: benefit.label })),
    name: text(options.name ?? (current.name === "Unnamed Village" ? "" : current.name)),
    connection: creatorConnection(options)
  };
}

function creatorFallbackMarkup(context) {
  const options = context.institutionChoices
    .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("");
  const benefits = context.connectionBenefits
    .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`).join("");
  return `<div class="crows village-creator">
    <label>Village name <input required name="name" value="${escapeHtml(context.name)}"></label>
    <fieldset><legend>Starting institutions</legend>
      <p>Blacksmith, Crypt, General Store, Inn, and Temple</p>
      <label>Choose one more <select required name="groupInstitution">${options}</select></label>
    </fieldset>
    <fieldset><legend>NPC connection</legend>
      <label>Name <input required name="connectionName" value="${escapeHtml(context.connection.name)}"></label>
      <label>Relationship <input required name="connectionRelationship" value="${escapeHtml(context.connection.relationship)}"></label>
      <label>Benefit <select name="connectionBenefit"><option value="">Choose later</option>${benefits}</select></label>
      <label>Notes <textarea name="connectionNotes">${escapeHtml(context.connection.notes)}</textarea></label>
    </fieldset>
  </div>`;
}

/** Open the creator dialog; the existing GM Village dialog is untouched. */
export async function openVillageCreator(options = {}) {
  const authority = mapAuthorityFailure();
  if (authority) {
    globalThis.ui?.notifications?.warn?.("Village creation must run on the designated GM.");
    return authority;
  }
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (typeof DialogV2?.wait !== "function") {
    return { ok: false, error: "creator-unavailable" };
  }
  const context = creatorTemplateContext(options);
  let content = creatorFallbackMarkup(context);
  const renderTemplate = globalThis.foundry?.applications?.handlebars?.renderTemplate;
  if (typeof renderTemplate === "function") {
    try {
      content = await renderTemplate("systems/crows/templates/apps/village-creator.hbs", context);
    } catch { /* fallback markup keeps the dialog usable in a partial world */ }
  }
  const result = await DialogV2.wait({
    window: { title: "Create Village", resizable: true, width: 600 },
    content,
    buttons: [
      { action: "cancel", label: "Cancel", callback: () => null },
      {
        action: "create",
        label: "Create",
        default: true,
        callback: (event, button, dialog) => {
          const form = dialog?.element ?? button?.form;
          const value = name => form?.querySelector?.(`[name="${name}"]`)?.value?.trim() ?? "";
          return {
            name: value("name"),
            groupInstitution: value("groupInstitution"),
            connectionName: value("connectionName"),
            connectionRelationship: value("connectionRelationship"),
            connectionBenefit: value("connectionBenefit"),
            connectionNotes: value("connectionNotes")
          };
        }
      }
    ]
  });
  if (!result || result === "cancel") return { ok: false, cancelled: true };
  return bootstrapVillageScene({
    ...options,
    ...result,
    artSet: options.artSet ?? configuredArtSet,
    canonicalHousing: options.canonicalHousing ?? ((options.artSet ?? configuredArtSet) === VILLAGE_ART_SET),
    operationId: options.operationId ?? null
  });
}

export const openVillageCreatorDialog = openVillageCreator;
