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
  getActiveVillageGM,
  getVillage,
  isVillageDesignatedWriter,
  normalizeVillage,
  registerVillageChangeListener,
  saveVillage,
  setVillageSceneReconciliationEnqueuer
} from "./village.mjs";
import { VILLAGE_ART_SET } from "./village-art.mjs";

export const VILLAGE_MAP_GENERATOR_VERSION = "village-map-1";
export const GENERATOR_VERSION = VILLAGE_MAP_GENERATOR_VERSION;

export const SCENE_DEFAULTS = Object.freeze({
  width: 4800,
  height: 6600,
  padding: 0.25,
  institutionWidth: 320,
  institutionHeight: 260,
  housingWidth: 180,
  housingHeight: 150,
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

export function institutionPosition(village, institution, options = {}) {
  if (typeof options.positionForInstitution === "function") {
    return clone(options.positionForInstitution({ village: clone(village), institution: clone(institution) }));
  }
  return deterministicPosition({
    sceneSeed: village?.sceneSeed,
    identity: institution?.id ?? institution?.type,
    kind: "institution",
    width: options.width ?? SCENE_DEFAULTS.width,
    height: options.height ?? SCENE_DEFAULTS.height,
    margin: options.margin ?? 220,
    tileWidth: options.tileWidth ?? options.institutionWidth ?? SCENE_DEFAULTS.institutionWidth,
    tileHeight: options.tileHeight ?? options.institutionHeight ?? SCENE_DEFAULTS.institutionHeight
  });
}

export function housingPosition(village, index, options = {}) {
  if (typeof options.positionForHousing === "function") {
    return clone(options.positionForHousing({ village: clone(village), index }));
  }
  return deterministicPosition({
    sceneSeed: village?.sceneSeed,
    identity: index,
    kind: "housing",
    index,
    width: options.width ?? SCENE_DEFAULTS.width,
    height: options.height ?? SCENE_DEFAULTS.height,
    margin: options.margin ?? 180,
    tileWidth: options.tileWidth ?? options.housingWidth ?? SCENE_DEFAULTS.housingWidth,
    tileHeight: options.tileHeight ?? options.housingHeight ?? SCENE_DEFAULTS.housingHeight
  });
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

/** Monotonic, bounded presentation tier; Prosperity remains Village state. */
export function housingTierForProsperity(prosperity = 0) {
  const value = clampProsperity(prosperity);
  return Math.max(0, Math.min(5, Math.floor((value + 10) / 4)));
}

export const housingCountForProsperity = housingTierForProsperity;

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

function baseTileData({ name, asset, position, width, height, sort, flag }) {
  return {
    name,
    texture: textureFor(asset),
    x: Math.round(Number(position?.x) || 0),
    y: Math.round(Number(position?.y) || 0),
    width: Math.max(0, Math.round(Number(width) || 0)),
    height: Math.max(0, Math.round(Number(height) || 0)),
    elevation: 0,
    sort: Math.round(Number(sort) || 0),
    rotation: 0,
    alpha: 1,
    hidden: false,
    locked: false,
    flags: { crows: { village: clone(flag) } }
  };
}

export function institutionTileData(village, institution, options = {}) {
  const effective = effectiveInstitutionForMap(institution, village);
  const asset = assetForInstitution({
    type: institution?.type,
    effectiveLevel: effective,
    destroyed: institution?.destroyed === true,
    artSet: options.artSet ?? configuredArtSet
  });
  const version = generatorVersion(options);
  const position = institutionPosition(village, institution, {
    ...options,
    width: options.sceneWidth ?? options.width,
    height: options.sceneHeight ?? options.height
  });
  const name = text(institution?.name) || institutionLabel(institution?.type);
  return baseTileData({
    name: `${name} [${asset.visualState}]`,
    asset,
    position,
    width: options.institutionWidth ?? SCENE_DEFAULTS.institutionWidth,
    height: options.institutionHeight ?? SCENE_DEFAULTS.institutionHeight,
    sort: options.sort ?? 100,
    flag: villageTileFlag({
      kind: "institution",
      villageId: village?.villageId,
      generatorVersion: version,
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
  const asset = assetForHousing(options.artSet ?? configuredArtSet, "operating", index);
  const version = generatorVersion(options);
  const position = housingPosition(village, index, {
    ...options,
    width: options.sceneWidth ?? options.width,
    height: options.sceneHeight ?? options.height
  });
  return baseTileData({
    name: `Housing ${index + 1}`,
    asset,
    position,
    width: options.housingWidth ?? SCENE_DEFAULTS.housingWidth,
    height: options.housingHeight ?? SCENE_DEFAULTS.housingHeight,
    sort: options.housingSort ?? 1000 + index,
    flag: villageTileFlag({
      kind: "housing",
      villageId: village?.villageId,
      generatorVersion: version,
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

/** Build all desired generated data without touching Foundry documents. */
export function buildVillageProjection(village, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const institutions = source.institutions.map((institution, index) =>
    institutionTileData(source, institution, { ...options, sort: options.sort ?? 100 + index })
  );
  const housingTier = housingTierForProsperity(source.prosperity);
  const housing = Array.from({ length: housingTier }, (_, index) =>
    housingTileData(source, index, options)
  );
  return {
    villageId: source.villageId,
    sceneSeed: source.sceneSeed,
    housingTier,
    housingCount: housing.length,
    institutions,
    housing,
    tiles: [...institutions, ...housing],
    unsupported: [...institutions, ...housing]
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
      String(institution?.id ?? institution?.type ?? ""), institutionProjection(institution, source)
    ])),
    housingTier: housingTierForProsperity(source.prosperity)
  };
}

function projectionScope(next, previous, options = {}) {
  if (options.force === true || options.cacheMiss === true || previous == null) {
    return {
      all: true,
      institutions: new Set(next.institutions.map(institution => String(institution?.id ?? institution?.type ?? ""))),
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
    housing: current.housingTier !== prior.housingTier
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
  const scope = projectionScope(next, previous, options);
  if (!scope.all && !scope.housing && scope.institutions.size === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "unrelated-village-change",
      villageId: next.villageId,
      writes: [],
      tileIds: generatedVillageTiles(options.scene, next.villageId).map(tileId).filter(Boolean)
    };
  }

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

  const writes = [];
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

export function villageSceneData(village, operationId, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const version = generatorVersion(options);
  const background = resolveVillageBackground({
    variant: options.backgroundVariant ?? SCENE_DEFAULTS.backgroundVariant,
    artSet: options.artSet,
    backgroundSet: options.backgroundSet
  });
  return {
    name: source.name || "Village",
    width: options.width ?? SCENE_DEFAULTS.width,
    height: options.height ?? SCENE_DEFAULTS.height,
    padding: options.padding ?? SCENE_DEFAULTS.padding,
    ...(background.src ? { background: { src: background.src } } : {}),
    navigation: true,
    ownership: { default: sceneOwnershipObserver() },
    flags: {
      crows: {
        village: {
          villageId: source.villageId,
          generatorVersion: version,
          bootstrap: String(operationId ?? source.bootstrap?.txId ?? ""),
          backgroundVariant: background.variant,
          backgroundKey: background.key
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

  if (!scene) {
    const createScene = sceneCreateFunction(options);
    if (!createScene) {
      return uncertainBootstrap(current, operationId, {
        phase: "prepared",
        reason: "scene-create-unavailable"
      });
    }
    try {
      scene = await createScene(villageSceneData(current, operationId, options));
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
    ...options,
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

let configuredArtSet = VILLAGE_ART_SET;
let configuredBackgroundSet = VILLAGE_ART_SET.backgrounds;
export function configureVillageArtSet(artSet) {
  configuredArtSet = artSet ?? VILLAGE_ART_SET;
  configuredBackgroundSet = configuredArtSet?.backgrounds ?? VILLAGE_ART_SET.backgrounds;
  return configuredArtSet;
}

export const setVillageArtSet = configureVillageArtSet;
export const getVillageArtSet = () => configuredArtSet;

export function configureVillageBackgroundSet(backgroundSet) {
  configuredBackgroundSet = backgroundSet ?? VILLAGE_ART_SET.backgrounds;
  return configuredBackgroundSet;
}

export const setVillageBackgroundSet = configureVillageBackgroundSet;
export const getVillageBackgroundSet = () => configuredBackgroundSet;

const mapRefreshListeners = new Set();
let mapHooksRegistered = false;

export function villageMapReadModel(village = null, options = {}) {
  const source = normalizeVillage(village ?? getVillage());
  const projection = buildVillageProjection(source, {
    ...options,
    artSet: options.artSet ?? configuredArtSet
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
    configuredBackgroundSet = configuredArtSet?.backgrounds ?? VILLAGE_ART_SET.backgrounds;
  }
  if (backgroundSet !== null) configuredBackgroundSet = backgroundSet ?? VILLAGE_ART_SET.backgrounds;
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
    operationId: options.operationId ?? null
  });
}

export const openVillageCreatorDialog = openVillageCreator;
