import "./shim/foundry.mjs";
import { describe, test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CONNECTION_BENEFITS,
  INSTITUTION_KEYS,
  defaultVillage,
  registerVillageSettings
} from "../module/helpers/village.mjs";
import {
  DEFAULT_LEVEL_ID,
  INSTITUTION_ART_KEYS,
  SCENE_DEFAULTS,
  VILLAGE_MAP_GENERATOR_VERSION,
  assetForInstitution,
  bootstrapVillageScene,
  buildVillageProjection,
  classifyVillageScenes,
  createVillageRecord,
  deterministicPosition,
  effectiveInstitutionForMap,
  configureVillageBackgroundSet,
  getVillageBackgroundSet,
  getVillageArtSet,
  housingCountForProsperity,
  openVillageCreator,
  reconcileVillageScene,
  resolveVillageBackground,
  validateVillageCreatorInput,
  villageSceneData
} from "../module/helpers/village-map.mjs";
import {
  VILLAGE_ART_ASSET_ROOT,
  VILLAGE_ART_BACKGROUND_FILENAMES,
  VILLAGE_ART_FILENAMES,
  VILLAGE_ART_SET
} from "../module/helpers/village-art.mjs";

const clone = value => structuredClone(value);

let settingConfig;
let store;
let scenes;
let sceneCreateCalls;
let sceneTileCalls;
let gmId;
let failSetting;
let loseSettingAckOnCall;
let settingCallCount;
let loseSceneAck;
let loseTileAck;

function makeScene(id, data = {}) {
  const villageFlag = data.flags?.crows?.village;
  const canonicalBackground = "systems/crows/assets/village/canonical/background.svg";
  const sourceLevels = data.levels ?? (villageFlag ? [{
    _id: DEFAULT_LEVEL_ID,
    background: { src: canonicalBackground }
  }] : []);
  const levelDocuments = sourceLevels.map(levelData => {
    const level = { ...clone(levelData), id: levelData.id ?? levelData._id };
    level.update = async update => {
      if (update.background) level.background = clone(update.background);
      return level;
    };
    return level;
  });
  const scene = {
    id,
    _id: id,
    name: data.name ?? `Scene ${id}`,
    navigation: data.navigation,
    ownership: clone(data.ownership ?? {}),
    flags: clone(data.flags ?? {}),
    width: data.width ?? (villageFlag ? 6000 : undefined),
    height: data.height ?? (villageFlag ? 6000 : undefined),
    initialLevel: data.initialLevel ?? (villageFlag ? DEFAULT_LEVEL_ID : undefined),
    levels: {
      contents: levelDocuments,
      get: levelId => levelDocuments.find(level => level.id === levelId)
    },
    tiles: [],
    failCreate: false,
    failUpdate: false,
    failDelete: false,
    async update(update) {
      for (const [key, value] of Object.entries(update)) {
        if (key === "flags.crows.village") scene.flags.crows.village = clone(value);
        else scene[key] = clone(value);
      }
      return scene;
    },
    async createEmbeddedDocuments(kind, entries) {
      assert.equal(kind, "Tile");
      sceneTileCalls.push({ operation: "create", entries: clone(entries) });
      if (scene.failCreate) throw new Error("tile create rejected");
      const created = entries.map((entry, index) => ({
        ...clone(entry),
        id: entry._id ?? `${id}-tile-${scene.tiles.length + index + 1}`
      }));
      scene.tiles.push(...created);
      if (loseTileAck) {
        loseTileAck = false;
        throw new Error("tile create acknowledgement lost");
      }
      return created;
    },
    async updateEmbeddedDocuments(kind, entries) {
      assert.equal(kind, "Tile");
      sceneTileCalls.push({ operation: "update", entries: clone(entries) });
      if (scene.failUpdate) throw new Error("tile update rejected");
      for (const entry of entries) {
        const tile = scene.tiles.find(candidate => candidate.id === entry._id);
        if (!tile) continue;
        for (const [key, value] of Object.entries(entry)) {
          if (key === "_id") continue;
          tile[key] = clone(value);
        }
      }
      return entries.map(entry => scene.tiles.find(tile => tile.id === entry._id));
    },
    async deleteEmbeddedDocuments(kind, ids) {
      assert.equal(kind, "Tile");
      sceneTileCalls.push({ operation: "delete", ids: [...ids] });
      if (scene.failDelete) throw new Error("tile delete rejected");
      scene.tiles = scene.tiles.filter(tile => !ids.includes(tile.id));
      return ids;
    }
  };
  return scene;
}

function installWorld(raw = defaultVillage()) {
  store = clone(raw);
  scenes = [];
  sceneCreateCalls = [];
  sceneTileCalls = [];
  gmId = "gm-a";
  failSetting = false;
  loseSettingAckOnCall = null;
  settingCallCount = 0;
  loseSceneAck = false;
  loseTileAck = false;
  settingConfig = null;
  globalThis.Hooks = { callAll() {} };
  globalThis.game = {
    user: { id: "gm-a", isGM: true, active: true },
    users: {
      get activeGM() {
        return gmId ? { id: gmId, isGM: true, active: true, role: 4 } : null;
      }
    },
    scenes: {
      contents: scenes,
      get: id => scenes.find(scene => scene.id === id),
      documentClass: globalThis.Scene
    },
    settings: {
      register: (_namespace, _key, data) => { settingConfig = data; },
      get: () => clone(store),
      set: async (_namespace, _key, value) => {
        settingCallCount += 1;
        if (failSetting) throw new Error("setting write rejected");
        store = clone(value);
        if (settingCallCount === loseSettingAckOnCall) {
          loseSettingAckOnCall = null;
          throw new Error("setting acknowledgement lost");
        }
        settingConfig?.onChange?.(clone(store), {}, globalThis.game.user.id);
        return clone(value);
      }
    }
  };
  registerVillageSettings();
}

const artSet = {
  assets: {
    circle: "/art/circle.png",
    "guild-hall": "/art/guild-hall.png",
    "market-tents": "/art/market-tents.png",
    "tower-square": "/art/tower-square.png",
    "tower-circle": "/art/tower-circle.png",
    smith: "/art/smith.png",
    foundry: "/art/foundry.png",
    library: "/art/library.png",
    church: "/art/church.png",
    cathedral: "/art/cathedral.png",
    housing: "/art/housing.png",
    "smith.destroyed": "/art/smith-ruins.png",
    "cathedral.destroyed": "/art/church-ruins.png"
  }
};

beforeEach(() => {
  globalThis.Scene = class Scene {
    static async create(data) {
      sceneCreateCalls.push(clone(data));
      const scene = makeScene(`scene-${sceneCreateCalls.length}`, data);
      scenes.push(scene);
      if (loseSceneAck) {
        loseSceneAck = false;
        throw new Error("Scene acknowledgement lost");
      }
      return scene;
    }
  };
  installWorld();
  globalThis.game.scenes.documentClass = globalThis.Scene;
});

afterEach(() => {
  delete globalThis.Scene;
  delete globalThis.game;
  delete globalThis.Hooks;
});

describe("Village creator data and art resolution", () => {
  test("requires an explicit additional institution and connection", () => {
    const invalid = validateVillageCreatorInput({ name: "Rookery" });
    assert.equal(invalid.ok, false);
    assert.ok(invalid.errors.includes("starting-institution-choice-required"));
    assert.ok(invalid.errors.includes("connection-name-required"));

    const valid = validateVillageCreatorInput({
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      connectionBenefit: "crafty"
    });
    assert.equal(valid.ok, true);
    assert.ok(CONNECTION_BENEFITS.some(benefit => benefit.id === valid.connection.benefit));
  });

  test("builds five printed institutions plus one explicit group choice", () => {
    const result = createVillageRecord({
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      connectionBenefit: "crafty"
    }, { village: defaultVillage() });
    assert.equal(result.ok, true);
    assert.equal(result.village.institutions.length, 6);
    assert.equal(result.village.institutions.filter(institution => institution.level === 1).length, 6);
    assert.equal(result.village.institutions.at(-1).type, "barracks");
    assert.deepEqual(result.village.npcConnection, {
      name: "Mara", relationship: "mentor", benefit: "crafty", notes: ""
    });
  });

  test("uses effective level and records deliberate substitutions", () => {
    assert.equal(INSTITUTION_ART_KEYS.blacksmith.levels.length, 2);
    const smith = assetForInstitution({ type: "blacksmith", effectiveLevel: 1, artSet });
    const foundry = assetForInstitution({ type: "blacksmith", effectiveLevel: { level: 2 }, artSet });
    const church = assetForInstitution({ type: "temple", effectiveLevel: 1, artSet });
    const cathedral = assetForInstitution({ type: "temple", effectiveLevel: 2, artSet });
    const closed = assetForInstitution({ type: "temple", effectiveLevel: { level: 0, closed: true }, artSet });
    const destroyed = assetForInstitution({ type: "temple", effectiveLevel: 2, destroyed: true, artSet });
    const crypt = assetForInstitution({ type: "crypt", effectiveLevel: 1, artSet: VILLAGE_ART_SET });
    const stables = assetForInstitution({ type: "stables", effectiveLevel: 1, artSet: VILLAGE_ART_SET });

    assert.equal(smith.assetKey, "smith");
    assert.equal(foundry.assetKey, "foundry");
    assert.equal(church.assetKey, "church");
    assert.equal(cathedral.assetKey, "cathedral");
    assert.equal(closed.visualState, "closed");
    assert.equal(destroyed.visualState, "destroyed");
    assert.equal(destroyed.src, "/art/church-ruins.png");
    assert.equal(crypt.unsupported, false);
    assert.equal(crypt.substituted, true);
    assert.equal(crypt.reason, "substituted");
    assert.equal(crypt.src, `${VILLAGE_ART_ASSET_ROOT}Cliff, cave entrance.png`);
    assert.equal(stables.unsupported, false);
    assert.equal(stables.substituted, true);
    assert.equal(stables.reason, "substituted");
    assert.equal(stables.src, `${VILLAGE_ART_ASSET_ROOT}Building, straw 5.png`);

    // A caller can still inject a partial catalogue and receive the original
    // needs-art classification for a future institution without a mapping.
    const unresolved = assetForInstitution({
      type: "crypt",
      effectiveLevel: 1,
      artSet: { assets: {} }
    });
    assert.equal(unresolved.needsArt, true);
    assert.equal(unresolved.reason, "art-needed");
  });

  test("the default catalogue is concrete, complete, and keeps institutions distinct", () => {
    assert.equal(getVillageArtSet(), VILLAGE_ART_SET);
    assert.equal(VILLAGE_ART_FILENAMES.length, 70);
    assert.equal(new Set(VILLAGE_ART_FILENAMES).size, 70);
    assert.deepEqual(
      readdirSync("assets/village").filter(file => file.endsWith(".png")).sort(),
      [...VILLAGE_ART_FILENAMES].sort()
    );
    const missing = VILLAGE_ART_FILENAMES.filter(file => !existsSync(join("assets/village", file)));
    assert.deepEqual(missing, []);
    assert.equal(VILLAGE_ART_BACKGROUND_FILENAMES.length, 2);
    assert.deepEqual(
      readdirSync("assets/village/backgrounds").filter(file => file.endsWith(".jpg")).sort(),
      [...VILLAGE_ART_BACKGROUND_FILENAMES].sort()
    );
    const missingBackgrounds = VILLAGE_ART_BACKGROUND_FILENAMES
      .filter(file => !existsSync(join("assets/village/backgrounds", file)));
    assert.deepEqual(missingBackgrounds, []);
    const notice = readFileSync("NOTICE.md", "utf8");
    assert.match(notice, /Meadow Picnic/);
    for (const file of VILLAGE_ART_BACKGROUND_FILENAMES) assert.ok(notice.includes(file));
    assert.equal(VILLAGE_ART_SET.root, VILLAGE_ART_ASSET_ROOT);
    assert.equal(VILLAGE_ART_SET.resolution, "300 DPI");
    assert.equal(VILLAGE_ART_SET.license.shortName, "CC BY-NC 4.0");
    assert.equal(VILLAGE_ART_SET.housingPool.length, 4);
    assert.deepEqual(
      VILLAGE_ART_SET.housingPool.map(asset => asset.src),
      [1, 2, 3, 4].map(index => `${VILLAGE_ART_ASSET_ROOT}Building, straw ${index}.png`)
    );
    assert.equal(
      VILLAGE_ART_SET.assets["unsupported.stables"].src,
      `${VILLAGE_ART_ASSET_ROOT}Building, straw 5.png`
    );

    const institutions = Object.keys(INSTITUTION_ART_KEYS)
      .map(type => assetForInstitution({ type, effectiveLevel: 1 }));
    assert.equal(new Set(institutions.map(asset => asset.src)).size, institutions.length);
    assert.deepEqual(
      institutions.filter(asset => asset.substituted).map(asset => asset.assetKey).sort(),
      ["unsupported.crypt", "unsupported.stables"]
    );
    assert.ok(institutions.every(asset => asset.supported));
  });

  test("maps pending, cycle-modified, capstone, and closed institution state", () => {
    const village = defaultVillage();
    village.prosperity = 10;
    village.cycle = 1;
    const temple = village.institutions.find(institution => institution.type === "temple");
    temple.level = 5;
    assert.equal(effectiveInstitutionForMap(temple, village).level, 6);
    temple.pendingLevel = 2;
    temple.pendingFromCycle = 1;
    assert.equal(effectiveInstitutionForMap(temple, village).level, 6);
    village.activeEffects = [{ kind: "ceaseOperations", target: temple.id, duration: "cycle" }];
    assert.equal(effectiveInstitutionForMap(temple, village).closed, true);
    assert.equal(assetForInstitution({
      type: temple.type,
      effectiveLevel: effectiveInstitutionForMap(temple, village),
      artSet
    }).visualState, "closed");
  });

  test("housing tier is bounded and deterministic coordinates are seed-stable", () => {
    const tiers = Array.from({ length: 21 }, (_, index) => housingCountForProsperity(index - 10));
    assert.equal(tiers[0], 0);
    assert.equal(tiers.at(-1), 5);
    for (let index = 1; index < tiers.length; index += 1) assert.ok(tiers[index] >= tiers[index - 1]);
    assert.deepEqual(
      deterministicPosition({ sceneSeed: "seed-a", identity: "institution-1" }),
      deterministicPosition({ sceneSeed: "seed-a", identity: "institution-1" })
    );
    assert.notDeepEqual(
      deterministicPosition({ sceneSeed: "seed-a", identity: "institution-1" }),
      deterministicPosition({ sceneSeed: "seed-b", identity: "institution-1" })
    );
  });
});

describe("Village Scene projection", () => {
  test("projection carries generated identity flags and preserves deterministic layout", () => {
    const village = defaultVillage();
    village.villageId = "village-test";
    village.sceneSeed = "seed-test";
    const first = buildVillageProjection(village, { artSet });
    const second = buildVillageProjection(village, { artSet });
    assert.deepEqual(first, second);
    assert.equal(first.housingTier, 2);
    assert.equal(first.tiles.length, 97);
    assert.ok(first.housing.every(tile => tile.texture.src === "/art/housing.png"));
    for (const tile of first.tiles) {
      const flag = tile.flags.crows.village;
      assert.equal(flag.villageId, "village-test");
      assert.equal(flag.generatorVersion, VILLAGE_MAP_GENERATOR_VERSION);
      assert.ok(["farmland", "institution", "housing", "dressing"].includes(flag.kind));
      assert.ok(flag.slotId);
      if (flag.kind === "institution") assert.ok(flag.institutionType);
      if (flag.kind === "housing") assert.ok(Number.isInteger(flag.housingIndex));
    }
  });

  test("portrait scene dimensions keep all twelve institutions and housing in bounds", () => {
    const village = defaultVillage();
    village.villageId = "portrait-village";
    village.sceneSeed = "portrait-seed";
    village.prosperity = 3;
    const template = village.institutions[0];
    village.institutions = INSTITUTION_KEYS.map((type, index) => ({
      ...template,
      id: `portrait-${index}-${type}`,
      type,
      name: type
    }));

    const projection = buildVillageProjection(village, {
      width: SCENE_DEFAULTS.width,
      height: SCENE_DEFAULTS.height
    });
    assert.equal(projection.institutions.length, 12);
    assert.equal(projection.housingCount, 45);
    // x/y is the middle of a v14 Tile; its extent runs half a tile either side.
    for (const tile of projection.tiles) {
      assert.ok(tile.x - tile.width / 2 >= 0);
      assert.ok(tile.y - tile.height / 2 >= 0);
      assert.ok(tile.x + tile.width / 2 <= SCENE_DEFAULTS.width, `${tile.name} exceeds scene width`);
      assert.ok(tile.y + tile.height / 2 <= SCENE_DEFAULTS.height, `${tile.name} exceeds scene height`);
    }
    assert.equal(new Set(projection.institutions.map(tile => `${tile.x},${tile.y}`)).size, 12);
  });

  test("canonical projection stays fixed while grid size remains a Scene option", () => {
    const village = defaultVillage();
    village.sceneSeed = "custom-grid-seed";
    village.prosperity = 3;
    const baseline = buildVillageProjection(village);
    const projection = buildVillageProjection(village, {
      width: 2400,
      height: 3600,
      grid: { type: 1, size: 150 }
    });
    assert.deepEqual(projection.tiles, baseline.tiles);

    const scene = villageSceneData(village, "custom-grid", {
      width: 2400,
      height: 3600,
      grid: { type: 1, size: 150 }
    });
    assert.equal(scene.width, 6000);
    assert.equal(scene.height, 6000);
    assert.equal(scene.grid.size, 150);
    assert.equal(scene.grid.type, 1);
  });

  test("Scene data explicitly grants Observer visibility and navigation", () => {
    const village = defaultVillage();
    const data = villageSceneData(village, "boot-1");
    assert.equal(SCENE_DEFAULTS.width, 6000);
    assert.equal(SCENE_DEFAULTS.height, 6000);
    assert.equal(SCENE_DEFAULTS.grid.size, 300);
    assert.equal(data.width, 6000);
    assert.equal(data.height, 6000);
    assert.equal(data.grid.type, 1);
    assert.equal(data.grid.size, 300);
    assert.equal(data.grid.distance, 5);
    assert.equal(data.grid.units, "sq");
    assert.equal(data.background.src, "systems/crows/assets/village/canonical/background.svg");
    assert.equal(data.flags.crows.village.backgroundVariant, "day");
    const night = villageSceneData(village, "boot-night", { backgroundVariant: "night" });
    assert.equal(night.background.src, "systems/crows/assets/village/canonical/background.svg");
    assert.equal(night.flags.crows.village.backgroundVariant, "night");
    assert.equal(data.navigation, true);
    assert.equal(data.ownership.default, 2);
    assert.equal(data.flags.crows.village.villageId, village.villageId);
    assert.equal(data.flags.crows.village.bootstrap, "boot-1");
  });

  test("the village map is lit and unfogged, because the table reads it", () => {
    // The Scene grants Observer to every player. Foundry's defaults — token
    // vision on, global light off, per-user fog — would hand those players a
    // black rectangle. Observed live before the fix.
    const data = villageSceneData(defaultVillage(), "boot-vision");
    assert.equal(data.ownership.default, 2, "players must be able to open the map");
    assert.equal(data.tokenVision, false);
    assert.equal(data.fog.mode, 0, "FOG_EXPLORATION_MODES.DISABLED");
  });

  test("no Scene padding, so a tile coordinate is a background pixel", () => {
    // Foundry places Tiles in canvas space and shifts the background image by
    // the padding (rounded up to a whole grid square per axis). This projection
    // places buildings from (0, 0) against the image, so any padding puts the
    // left and top of the settlement in the grey gutter beside the map — as it
    // did live, with the crypt and inn off the edge of the meadow.
    assert.equal(SCENE_DEFAULTS.padding, 0);
    assert.equal(villageSceneData(defaultVillage(), "boot-pad").padding, 0);
    assert.equal(villageSceneData(defaultVillage(), "boot-pad", { padding: 0.25 }).padding, 0);

    // With no offset, every tile must land inside the background image itself.
    const village = defaultVillage();
    const { width, height } = SCENE_DEFAULTS;
    for (const tile of buildVillageProjection(village).tiles) {
      // x/y is the middle of a v14 Tile, so the span is half a tile either side.
      const [x0, x1] = [tile.x - tile.width / 2, tile.x + tile.width / 2];
      const [y0, y1] = [tile.y - tile.height / 2, tile.y + tile.height / 2];
      assert.ok(x0 >= 0 && x1 <= width, `${tile.name} spans ${x0}..${x1}, outside 0..${width}`);
      assert.ok(y0 >= 0 && y1 <= height, `${tile.name} spans ${y0}..${y1}, outside 0..${height}`);
    }
  });

  test("the backdrop rides on a Level, because a v14 Scene has no background field", () => {
    // A v14 Scene stores its backdrop on `Scene#levels`; `Scene#background` is
    // a deprecated getter. Foundry accepts a legacy `{background:{src}}` create
    // payload WITHOUT error and silently drops the image, because the legacy
    // branch in `Scene#_preCreate` is guarded by `!this.levels.size` and the
    // schema has already made `defaultLevel0000`. Verified live on v14.367.
    // Asserting only `data.background.src` therefore cannot catch a blank map,
    // which is exactly how this shipped. Pin the shape Foundry actually reads.
    const village = defaultVillage();
    for (const variant of ["day", "night"]) {
      const data = villageSceneData(village, `boot-${variant}`, { backgroundVariant: variant });
      assert.equal(data.initialLevel, DEFAULT_LEVEL_ID);
      assert.equal(data.levels.length, 1);
      assert.equal(data.levels[0]._id, DEFAULT_LEVEL_ID);
      assert.ok(data.levels[0].background.src, `${variant} Level carries no backdrop`);
      assert.equal(data.levels[0].background.src, data.background.src,
        `${variant} Level backdrop drifted from the resolved background`);
    }
  });

  test("background resolver is late-bound for a Ref's day/night map", () => {
    const custom = {
      defaultVariant: "day",
      day: { src: "worlds/custom-village-day.jpg", label: "Custom day" },
      night: { src: "worlds/custom-village-night.jpg", label: "Custom night" }
    };
    configureVillageBackgroundSet(custom);
    try {
      assert.equal(getVillageBackgroundSet(), custom);
      assert.deepEqual(resolveVillageBackground({ variant: "night" }), {
        src: "worlds/custom-village-night.jpg",
        label: "Custom night",
        substituted: false,
        substitutionReason: null,
        key: "night",
        variant: "night",
        supported: true,
        unsupported: false,
        needsArt: false,
        reason: null
      });
      assert.equal(
        villageSceneData(defaultVillage(), "boot-custom").background.src,
        "worlds/custom-village-day.jpg"
      );
    } finally {
      configureVillageBackgroundSet(null);
    }
  });
});

describe("Village bootstrap saga and flagged-only reconciliation", () => {
  test("looks up before create, creates one Scene and embedded Tiles, and commits", async () => {
    const result = await bootstrapVillageScene({
      operationId: "boot-1",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      connectionBenefit: "crafty",
      artSet
    });
    assert.equal(result.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, 1);
    assert.equal(store.bootstrap.phase, "committed");
    assert.equal(store.sceneId, "scene-1");
    assert.equal(sceneCreateCalls[0].navigation, true);
    assert.equal(sceneCreateCalls[0].ownership.default, 2);
    assert.equal(sceneCreateCalls[0].width, 6000);
    assert.equal(sceneCreateCalls[0].height, 6000);
    assert.equal(sceneCreateCalls[0].background.src,
      "systems/crows/assets/village/canonical/background.svg");
    assert.equal(sceneCreateCalls[0].initialLevel, DEFAULT_LEVEL_ID);
    assert.equal(sceneCreateCalls[0].levels[0]._id, DEFAULT_LEVEL_ID);
    assert.equal(sceneCreateCalls[0].levels[0].background.src,
      "systems/crows/assets/village/canonical/background.svg");
    assert.equal(scenes[0].tiles.length, 97);

    const retry = await bootstrapVillageScene({ operationId: "boot-1", artSet });
    assert.equal(retry.ok, true);
    assert.equal(retry.replayed, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, 1);
  });

  test("the normal creator path keeps canonical source housing", async () => {
    const priorFoundry = globalThis.foundry;
    globalThis.foundry = {
      ...priorFoundry,
      applications: {
        ...priorFoundry?.applications,
        api: {
          ...priorFoundry?.applications?.api,
          DialogV2: {
            wait: async () => ({
              name: "Rookery",
              groupInstitution: "barracks",
              connectionName: "Mara",
              connectionRelationship: "mentor",
              connectionBenefit: "crafty",
              connectionNotes: ""
            })
          }
        }
      }
    };
    try {
      const result = await openVillageCreator({ operationId: "creator-canonical-housing" });
      assert.equal(result.ok, true);
      const housing = scenes[0].tiles.filter(tile => tile.flags?.crows?.village?.kind === "housing");
      assert.equal(housing.length, 35);
      assert.ok(housing.every(tile => tile.texture.src.startsWith("systems/crows/assets/village/canonical/housing/")));
    } finally {
      globalThis.foundry = priorFoundry;
    }
  });

  test("migrates a legacy generated Scene envelope before replacing its generated Tiles", async () => {
    const village = defaultVillage();
    village.villageId = "legacy-village";
    village.sceneId = "legacy-scene";
    const scene = makeScene("legacy-scene", {
      flags: { crows: { village: { villageId: village.villageId, generatorVersion: "village-map-1" } } }
    });
    scene.width = 4800;
    scene.height = 6600;
    scene.initialLevel = DEFAULT_LEVEL_ID;
    const levelUpdates = [];
    const level = {
      id: DEFAULT_LEVEL_ID,
      background: { src: "/legacy-village.svg" },
      async update(data) {
        levelUpdates.push(clone(data));
        level.background = clone(data.background);
      }
    };
    scene.levels = { get: id => id === DEFAULT_LEVEL_ID ? level : null, contents: [level] };
    const sceneUpdates = [];
    const updateScene = scene.update;
    scene.update = async data => {
      sceneUpdates.push(clone(data));
      return updateScene(data);
    };
    scene.tiles = buildVillageProjection(village, { artSet }).tiles.map((tile, index) => ({
      ...clone(tile),
      id: `legacy-${index}`,
      flags: { crows: { village: { ...tile.flags.crows.village, generatorVersion: "village-map-1" } } }
    }));
    const refTile = { id: "ref-lamp", name: "Ref lamp", texture: { src: "/ref/lamp.svg" }, x: 42, y: 84 };
    scene.tiles.push(clone(refTile));
    scenes.push(scene);

    const result = await reconcileVillageScene(village, null, { scene, artSet });

    assert.equal(result.ok, true);
    assert.deepEqual(sceneUpdates, [{
      width: 6000,
      height: 6000,
      "flags.crows.village": {
        villageId: village.villageId,
        generatorVersion: VILLAGE_MAP_GENERATOR_VERSION,
        bootstrap: "",
        backgroundVariant: "day",
        backgroundKey: "day",
        backgroundSrc: "systems/crows/assets/village/canonical/background.svg"
      }
    }]);
    assert.deepEqual(levelUpdates, [{
      background: { src: "systems/crows/assets/village/canonical/background.svg" }
    }]);
    assert.equal(scene.tiles.length, 98);
    assert.ok(scene.tiles.filter(tile => tile.id !== refTile.id)
      .every(tile => tile.flags.crows.village.generatorVersion === VILLAGE_MAP_GENERATOR_VERSION));
    assert.deepEqual(scene.tiles.find(tile => tile.id === refTile.id), refTile);
    assert.ok(result.writes.some(write => write.operation === "scene-update"));
    assert.ok(result.writes.some(write => write.operation === "level-update"));
  });

  test("retries a failed Level background repair on an otherwise current Scene", async () => {
    const village = defaultVillage();
    village.villageId = "background-retry-village";
    village.sceneId = "background-retry-scene";
    const scene = makeScene(village.sceneId, {
      width: 6000,
      height: 6000,
      initialLevel: DEFAULT_LEVEL_ID,
      levels: [{ _id: DEFAULT_LEVEL_ID, background: { src: "/wrong-background.svg" } }],
      flags: { crows: { village: {
        villageId: village.villageId,
        generatorVersion: VILLAGE_MAP_GENERATOR_VERSION
      } } }
    });
    scene.tiles = buildVillageProjection(village, { artSet }).tiles.map((tile, index) => ({
      ...clone(tile), id: `current-${index}`
    }));
    const level = scene.levels.get(DEFAULT_LEVEL_ID);
    let failLevelUpdate = true;
    level.update = async data => {
      if (failLevelUpdate) {
        failLevelUpdate = false;
        throw new Error("level update rejected");
      }
      level.background = clone(data.background);
      return level;
    };
    scenes.push(scene);

    const first = await reconcileVillageScene(village, null, { scene, artSet });
    assert.equal(first.ok, false);
    assert.equal(first.operation, "level-update");
    assert.equal(sceneTileCalls.length, 0);

    const retry = await reconcileVillageScene(village, null, { scene, artSet });
    assert.equal(retry.ok, true);
    assert.equal(level.background.src, "systems/crows/assets/village/canonical/background.svg");
  });

  test("persists an explicit custom background across later Village reconciliation", async () => {
    const village = defaultVillage();
    village.villageId = "custom-background-village";
    village.sceneId = "scene-custom-background";
    const customBackground = "/custom/village-background.svg";
    const data = villageSceneData(village, "custom-background-policy", {
      artSet,
      backgroundSrc: customBackground
    });
    const scene = makeScene(village.sceneId, data);
    scene.tiles = buildVillageProjection(village, { artSet }).tiles.map((tile, index) => ({
      ...clone(tile),
      id: `custom-background-tile-${index}`
    }));
    scenes.push(scene);

    const previous = clone(village);
    village.prosperity += 1;
    sceneTileCalls = [];
    const result = await reconcileVillageScene(village, previous, { scene, artSet });

    assert.equal(result.ok, true);
    assert.equal(scene.levels.get(DEFAULT_LEVEL_ID).background.src, customBackground);
    assert.equal(result.writes.some(write => write.operation === "level-update"), false);
  });

  test("stamps complete canonical identity when the legacy Scene version is missing", async () => {
    const village = defaultVillage();
    village.villageId = "missing-version-village";
    village.sceneId = "missing-version-scene";
    const scene = makeScene(village.sceneId, {
      width: 6000,
      height: 6000,
      initialLevel: DEFAULT_LEVEL_ID,
      levels: [{ _id: DEFAULT_LEVEL_ID, background: { src: "systems/crows/assets/village/canonical/background.svg" } }],
      flags: { crows: { village: { villageId: village.villageId } } }
    });
    scene.tiles = buildVillageProjection(village, { artSet }).tiles.map((tile, index) => ({
      ...clone(tile), id: `missing-version-${index}`
    }));
    const updates = [];
    const updateScene = scene.update;
    scene.update = async data => {
      updates.push(clone(data));
      return updateScene(data);
    };
    scenes.push(scene);

    const result = await reconcileVillageScene(village, null, { scene, artSet });

    assert.equal(result.ok, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]["flags.crows.village"].generatorVersion, VILLAGE_MAP_GENERATOR_VERSION);
    assert.equal(scene.flags.crows.village.villageId, village.villageId);
  });

  test("classifies duplicate flagged Scenes without deleting either", () => {
    const village = defaultVillage();
    village.villageId = "village-duplicate";
    scenes.push(makeScene("a", {flags: {crows: {village: {
      villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION
    }}}}));
    scenes.push(makeScene("b", {flags: {crows: {village: {
      villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION
    }}}}));
    const classification = classifyVillageScenes(village.villageId, globalThis.game.scenes);
    assert.equal(classification.status, "multiple");
    assert.deepEqual(classification.candidates, ["a", "b"]);
    assert.equal(sceneCreateCalls.length, 0);
  });

  test("same token recovers when the prepared setting acknowledgement is lost", async () => {
    loseSettingAckOnCall = 1;
    const first = await bootstrapVillageScene({
      operationId: "lost-prepared",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      artSet
    });
    assert.equal(first.ok, false);
    assert.equal(first.reconciliationRequired, true);
    assert.equal(store.bootstrap.phase, "uncertain");

    const retry = await bootstrapVillageScene({ operationId: "lost-prepared", artSet });
    assert.equal(retry.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(scenes[0].tiles.length, 97);
  });

  test("same token reuses a Scene whose create acknowledgement was lost", async () => {
    loseSceneAck = true;
    const first = await bootstrapVillageScene({
      operationId: "lost-scene",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      artSet
    });
    assert.equal(first.ok, false);
    assert.equal(first.reconciliationRequired, true);
    assert.equal(scenes.length, 1);
    assert.equal(store.bootstrap.phase, "uncertain");

    const retry = await bootstrapVillageScene({ operationId: "lost-scene", artSet });
    assert.equal(retry.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(scenes[0].tiles.length, 97);
  });

  test("same token repairs a flagged Tile set whose create acknowledgement was lost", async () => {
    loseTileAck = true;
    const first = await bootstrapVillageScene({
      operationId: "lost-tiles",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      artSet
    });
    assert.equal(first.ok, false);
    assert.equal(first.reconciliationRequired, true);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].tiles.length, 97);

    const createsBeforeRetry = sceneTileCalls.filter(call => call.operation === "create").length;
    const retry = await bootstrapVillageScene({ operationId: "lost-tiles", artSet });
    assert.equal(retry.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, createsBeforeRetry);
  });

  test("same token resumes after scene and tile phase setting acknowledgements are lost", async () => {
    loseSettingAckOnCall = 2;
    const scenePhase = await bootstrapVillageScene({
      operationId: "lost-scene-phase",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      artSet
    });
    assert.equal(scenePhase.ok, false);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].tiles.length, 0);
    const afterScenePhaseLoss = await bootstrapVillageScene({ operationId: "lost-scene-phase", artSet });
    assert.equal(afterScenePhaseLoss.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(scenes[0].tiles.length, 97);

    // New world/setting state is installed for the second half of this test.
    installWorld();
    loseSettingAckOnCall = 3;
    const tilePhase = await bootstrapVillageScene({
      operationId: "lost-tile-phase",
      name: "Rookery",
      groupInstitution: "barracks",
      connectionName: "Mara",
      connectionRelationship: "mentor",
      artSet
    });
    assert.equal(tilePhase.ok, false);
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].tiles.length, 97);
    const tilePhaseRetry = await bootstrapVillageScene({ operationId: "lost-tile-phase", artSet });
    assert.equal(tilePhaseRetry.ok, true);
    assert.equal(sceneCreateCalls.length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, 1);
  });

  test("updates only changed flagged institution Tiles and leaves Ref decoration byte-for-byte", async () => {
    const village = defaultVillage();
    village.villageId = "village-test";
    village.sceneSeed = "seed-test";
    village.sceneId = "scene-existing";
    const scene = makeScene("scene-existing", {
      flags: { crows: { village: { villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION } } }
    });
    scenes.push(scene);
    const initial = await reconcileVillageScene(village, null, { scene, artSet });
    assert.equal(initial.ok, true);
    const changedInstitutionId = village.institutions[0].id;
    const changedTileId = scene.tiles.find(tile =>
      tile.flags?.crows?.village?.institutionId === changedInstitutionId)?.id;
    assert.ok(changedTileId);
    const decoration = { id: "ref-tree", name: "Ref decoration", texture: {src: "/ref/tree.png"}, x: 17, y: 29 };
    scene.tiles.push(clone(decoration));
    const beforeScene = clone(decoration);
    const previous = clone(village);
    village.institutions[0].level = 2;
    sceneTileCalls = [];
    const result = await reconcileVillageScene(village, previous, { scene, artSet });
    assert.equal(result.ok, true);
    assert.equal(sceneTileCalls.filter(call => call.operation === "update").length, 1);
    assert.deepEqual(scene.tiles.find(tile => tile.id === "ref-tree"), beforeScene);
    const update = sceneTileCalls.find(call => call.operation === "update").entries[0];
    assert.equal(update._id, changedTileId);
    assert.equal(update.flags.crows.village.kind, "institution");
  });

  test("founds an institution by updating its waiting plot in place", async () => {
    const village = defaultVillage();
    village.villageId = "village-founding-plot";
    village.sceneSeed = "founding-plot-seed";
    village.sceneId = "scene-founding-plot";
    const scene = makeScene(village.sceneId, {
      flags: { crows: { village: { villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION } } }
    });
    scenes.push(scene);
    await reconcileVillageScene(village, null, { scene, artSet });
    const waiting = scene.tiles.find(tile => tile.flags?.crows?.village?.institutionType === "beacon");
    assert.equal(waiting.flags.crows.village.visualState, "unbuilt");
    const waitingId = waiting.id;

    const previous = clone(village);
    village.institutions.push({ id: "beacon-built", type: "beacon", name: "Beacon", level: 1, steward: "" });
    sceneTileCalls = [];
    const result = await reconcileVillageScene(village, previous, { scene, artSet });

    assert.equal(result.ok, true);
    assert.equal(sceneTileCalls.filter(call => call.operation === "update").length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, 0);
    assert.equal(sceneTileCalls.filter(call => call.operation === "delete").length, 0);
    const founded = scene.tiles.find(tile => tile.flags?.crows?.village?.institutionType === "beacon");
    assert.equal(founded.id, waitingId);
    assert.equal(founded.flags.crows.village.institutionId, "beacon-built");
    assert.notEqual(founded.flags.crows.village.visualState, "unbuilt");

    const beforeRemoval = clone(village);
    village.institutions = village.institutions.filter(institution => institution.type !== "beacon");
    sceneTileCalls = [];
    const removed = await reconcileVillageScene(village, beforeRemoval, { scene, artSet });
    assert.equal(removed.ok, true);
    assert.equal(sceneTileCalls.filter(call => call.operation === "update").length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "delete").length, 0);
    const returnedWaiting = scene.tiles.find(tile => tile.flags?.crows?.village?.institutionType === "beacon");
    assert.equal(returnedWaiting.id, waitingId);
    assert.equal(returnedWaiting.flags.crows.village.visualState, "unbuilt");
  });

  test("tombstoned institutions keep their flagged Tile and switch to a ruin asset", async () => {
    const village = defaultVillage();
    village.villageId = "village-ruins";
    village.sceneSeed = "ruin-seed";
    village.sceneId = "scene-ruins";
    const scene = makeScene("scene-ruins", {
      flags: { crows: { village: { villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION } } }
    });
    scenes.push(scene);
    await reconcileVillageScene(village, null, { scene, artSet });
    const previous = clone(village);
    const blacksmith = village.institutions.find(institution => institution.type === "blacksmith");
    blacksmith.destroyed = true;
    blacksmith.destroyedOnCycle = village.cycle;
    sceneTileCalls = [];
    const result = await reconcileVillageScene(village, previous, { scene, artSet });
    assert.equal(result.ok, true);
    assert.equal(sceneTileCalls.filter(call => call.operation === "update").length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "delete").length, 0);
    const ruinTile = scene.tiles.find(tile => tile.flags?.crows?.village?.institutionId === blacksmith.id);
    assert.equal(ruinTile.texture.src, "/art/smith-ruins.png");
    assert.equal(ruinTile.flags.crows.village.visualState, "destroyed");
  });

  test("Prosperity housing shrink deletes only the flagged suffix and retries a failed update", async () => {
    const village = defaultVillage();
    village.villageId = "village-housing";
    village.sceneSeed = "housing-seed";
    village.sceneId = "scene-housing";
    const scene = makeScene("scene-housing", {
      flags: { crows: { village: { villageId: village.villageId, generatorVersion: VILLAGE_MAP_GENERATOR_VERSION } } }
    });
    scenes.push(scene);
    await reconcileVillageScene(village, null, { scene, artSet });
    scene.tiles.push({ id: "ref-lamp", name: "Ref lamp", texture: {src: "/ref/lamp.png"} });

    const previous = clone(village);
    village.prosperity = -10;
    sceneTileCalls = [];
    const shrink = await reconcileVillageScene(village, previous, { scene, artSet });
    assert.equal(shrink.ok, true);
    const deletion = sceneTileCalls.find(call => call.operation === "delete");
    assert.ok(deletion);
    assert.equal(deletion.ids.length, 85);
    assert.ok(deletion.ids.every(id => id.includes("tile")));
    assert.ok(scene.tiles.some(tile => tile.id === "ref-lamp"));

    village.institutions[0].level = 2;
    const retryPrevious = clone(village);
    village.institutions[0].level = 3;
    scene.failUpdate = true;
    sceneTileCalls = [];
    const failed = await reconcileVillageScene(village, retryPrevious, { scene, artSet });
    assert.equal(failed.ok, false);
    assert.equal(failed.repairRequired, true);
    scene.failUpdate = false;
    sceneTileCalls = [];
    const repaired = await reconcileVillageScene(village, retryPrevious, { scene, artSet });
    assert.equal(repaired.ok, true);
    assert.equal(sceneTileCalls.filter(call => call.operation === "update").length, 1);
    assert.equal(sceneTileCalls.filter(call => call.operation === "create").length, 0);
    assert.equal(sceneTileCalls.filter(call => call.operation === "delete").length, 0);
  });
});
