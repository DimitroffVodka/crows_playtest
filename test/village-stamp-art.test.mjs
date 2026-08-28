import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  INSTITUTION_ART_KEYS,
  assetForInstitution,
  drawnVillageArtSet,
  housingTileData,
  stampFootprints
} from "../module/helpers/village-map.mjs";
import { PLAN_FORMS, buildVillagePlan } from "../module/helpers/village-plan.mjs";
import { renderPlanToSvg, villageBackgroundSvg } from "../module/helpers/village-plan-draw.mjs";
import {
  FARM_PLOT_STAMPS,
  HOUSING_STAMPS,
  INSTITUTION_STAMPS,
  STAMP_PALETTE,
  STAMP_SHADOW_BLUR_RATIO,
  STAMP_SHADOW_OFFSET,
  TREE_STAMPS,
  VILLAGE_STAMP_ASSET_ROOT,
  VILLAGE_STAMP_CATALOGUE,
  composeStampArtSet,
  contentBoxFor,
  shadowSrcFor,
  slugFor,
  stampBody,
  stampForInstitution,
  stampShadowBody
} from "../module/helpers/village-stamp-art.mjs";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

/** `systems/crows/assets/x.svg` -> the file on disk. */
function onDisk(src) {
  assert.ok(src.startsWith(VILLAGE_STAMP_ASSET_ROOT), `${src} is not a stamp path`);
  return join(REPO_ROOT, "assets", src.slice(VILLAGE_STAMP_ASSET_ROOT.length));
}

/** The drawn set as `writeVillagePlanArt` would hand it over. */
function drawnSet() {
  const paths = {};
  for (const shape of [
    "circle", "guild-hall", "tower-square", "tower-circle", "smith", "foundry",
    "library", "crypt", "arcane-hall", "market-tents", "l-house", "stables",
    "church", "cathedral"
  ]) paths[shape] = `worlds/w/art/${shape}.svg`;
  paths.ruin = "worlds/w/art/ruin.svg";
  for (let i = 0; i < 5; i++) paths[`house-${i}`] = `worlds/w/art/house-${i}.svg`;
  return drawnVillageArtSet(paths);
}

describe("village stamp art — coverage", () => {
  test("every institution in the art keys has a stamp", () => {
    for (const type of Object.keys(INSTITUTION_ART_KEYS)) {
      assert.ok(INSTITUTION_STAMPS[type], `${type} has no stamp`);
    }
  });

  test("the stamps do not invent institutions the map does not know", () => {
    for (const type of Object.keys(INSTITUTION_STAMPS)) {
      assert.ok(INSTITUTION_ART_KEYS[type], `${type} is stamped but unknown to the map`);
    }
  });

  test("every shipped stamp and its shadow exist on disk", () => {
    const every = [
      ...Object.values(INSTITUTION_STAMPS),
      ...HOUSING_STAMPS,
      ...TREE_STAMPS,
      ...FARM_PLOT_STAMPS
    ];
    assert.equal(every.length, 24);
    for (const entry of every) {
      assert.ok(existsSync(onDisk(entry.src)), `missing art: ${entry.src}`);
      const shadow = shadowSrcFor(entry.src);
      assert.ok(shadow, `no shadow path derived for ${entry.src}`);
      assert.ok(existsSync(onDisk(shadow)), `missing shadow: ${shadow}`);
    }
  });

  test("the catalogue reports what it ships", () => {
    assert.equal(Object.keys(VILLAGE_STAMP_CATALOGUE.institutions).length, 12);
    assert.equal(VILLAGE_STAMP_CATALOGUE.housing.length, 3);
    assert.equal(VILLAGE_STAMP_CATALOGUE.trees.length, 6);
    assert.equal(VILLAGE_STAMP_CATALOGUE.farmPlots.length, 3);
  });
});

describe("village stamp art — the assets themselves", () => {
  test("every asset is native vector on the shared 512 canvas", () => {
    for (const entry of Object.values(INSTITUTION_STAMPS)) {
      const svg = readFileSync(onDisk(entry.src), "utf8");
      assert.match(svg, /viewBox="0 0 512 512"/, `${entry.src} is off-canvas`);
      // A raster smuggled into the set would defeat the point of shipping SVG.
      assert.doesNotMatch(svg, /<image\b/i, `${entry.src} embeds a raster`);
      assert.doesNotMatch(svg, /foreignObject/i, `${entry.src} uses foreignObject`);
      assert.doesNotMatch(svg, /data:image\//i, `${entry.src} inlines raster data`);
    }
  });

  test("shadows are drawn to one light angle so the map reads coherently", () => {
    for (const entry of Object.values(INSTITUTION_STAMPS)) {
      const svg = readFileSync(onDisk(shadowSrcFor(entry.src)), "utf8");
      assert.match(svg, /translate\(28 16\)/, `${entry.src} shadow is off-angle`);
      assert.match(svg, new RegExp(STAMP_PALETTE.shadowColor, "i"), `${entry.src} shadow is off-palette`);
    }
  });

  test("shadowSrcFor ignores paths that are not ours", () => {
    assert.equal(shadowSrcFor("worlds/w/art/smith.svg"), null);
    assert.equal(shadowSrcFor("systems/crows/assets/village/Arena.png"), null);
    // Already a shadow: idempotent rather than doubly suffixed.
    const shadow = "systems/crows/assets/institutions/inn.shadow.svg";
    assert.equal(shadowSrcFor(shadow), shadow);
  });
});

describe("village stamp art — composition over drawn art", () => {
  test("a stamp wins for every operating institution", () => {
    const set = composeStampArtSet(drawnSet());
    for (const type of Object.keys(INSTITUTION_ART_KEYS)) {
      const asset = assetForInstitution({ type, effectiveLevel: 1, artSet: set });
      assert.equal(asset.src, INSTITUTION_STAMPS[type].src, `${type} did not stamp`);
      assert.equal(asset.supported, true);
    }
  });

  test("crypt and stables are real art now, not substitutions", () => {
    const set = composeStampArtSet(drawnSet());
    for (const type of ["crypt", "stables"]) {
      const asset = assetForInstitution({ type, effectiveLevel: 1, artSet: set });
      assert.equal(asset.substituted, false, `${type} is still substituted`);
      assert.equal(asset.needsArt, false);
    }
  });

  test("a destroyed institution falls through to the drawn ruin", () => {
    const set = composeStampArtSet(drawnSet());
    for (const type of Object.keys(INSTITUTION_ART_KEYS)) {
      const asset = assetForInstitution({
        type, effectiveLevel: 2, destroyed: true, artSet: set
      });
      assert.equal(asset.src, "worlds/w/art/ruin.svg", `${type} lost its ruin`);
      assert.equal(asset.visualState, "destroyed");
    }
  });

  test("composing does not strand the drawn set when a stamp is absent", () => {
    // The regression that motivates chaining: `drawnVillageArtSet` answers only
    // through `resolve`, so overriding it without delegating drops every key the
    // stamps do not cover.
    const set = composeStampArtSet(drawnSet());
    const asset = assetForInstitution({ type: "notAnInstitution", effectiveLevel: 1, artSet: set });
    assert.equal(asset.src, null);
    const drawnOnly = set.resolve({ key: "library", assetKey: "library", visualState: "operating" });
    assert.equal(drawnOnly.src, "worlds/w/art/library.svg");
  });

  test("housing draws from the farmhouses, not the drawn pool", () => {
    const set = composeStampArtSet(drawnSet());
    const seen = new Set();
    for (let i = 0; i < HOUSING_STAMPS.length; i++) {
      const tile = housingTileData({ villageId: "v1" }, i, { artSet: set, width: 4000, height: 4000 });
      const src = tile.texture?.src ?? tile.img;
      assert.ok(src.includes("/rural/farmhouses/"), `housing ${i} used ${src}`);
      seen.add(src);
    }
    assert.equal(seen.size, HOUSING_STAMPS.length, "the pool repeats before it is exhausted");
  });

  test("composition survives a missing drawn set", () => {
    const set = composeStampArtSet(null);
    const asset = assetForInstitution({ type: "temple", effectiveLevel: 1, artSet: set });
    assert.equal(asset.src, INSTITUTION_STAMPS.temple.src);
    assert.equal(set.resolve({ key: "library", assetKey: "library" }), null);
  });
});

describe("village stamp art — the dressing and shadow layers", () => {
  const read = src => readFileSync(onDisk(src), "utf8");

  function sprites() {
    const bodies = {};
    const boxes = {};
    const order = [];
    for (const entry of [...TREE_STAMPS, ...FARM_PLOT_STAMPS]) {
      const id = `vp-${slugFor(entry.src)}`;
      bodies[id] = { body: stampBody(read(entry.src)) };
      boxes[id] = contentBoxFor(entry.src);
      order.push(id);
    }
    for (const entry of [...Object.values(INSTITUTION_STAMPS), ...HOUSING_STAMPS]) {
      const id = `vp-shadow-${slugFor(entry.src)}`;
      bodies[id] = { body: stampShadowBody(read(shadowSrcFor(entry.src))) };
      boxes[id] = contentBoxFor(entry.src);
      order.push(id);
    }
    return { bodies, boxes, order };
  }

  function openPlan(seed = "s1") {
    const institutions = ["temple", "blacksmith", "inn", "barracks"]
      .map(type => ({ id: type, type, level: 1 }));
    return buildVillagePlan(
      { villageId: "v1", name: "Thornwake", prosperity: 8, institutions },
      { seed, params: { form: PLAN_FORMS.OPEN } }
    );
  }

  test("trees are drawn as crowns when the sprites are there", () => {
    const plan = openPlan();
    assert.ok(plan.dressing.trees.length > 0);
    const svg = villageBackgroundSvg(plan, { sprites: sprites() });
    const used = new Set([...svg.matchAll(/href="#(vp-tree-[a-z-]+)"/g)].map(m => m[1]));
    assert.equal(used.size, 4, "the four canopies should all get used");
    // Clusters are for massing an edge, not for standing in as a single tree.
    assert.ok(!used.has("vp-tree-copse"));
    assert.ok(!used.has("vp-tree-forest-edge"));
    // Defined once each and referenced, rather than inlined at every tree —
    // the difference between a 140KB backdrop and a several-megabyte one.
    const symbols = (svg.match(/<symbol /g) ?? []).length;
    assert.equal(symbols, sprites().order.length);
    assert.ok((svg.match(/<use /g) ?? []).length > symbols * 10);
  });

  test("without sprites the backdrop still draws its own trees", () => {
    // A backdrop must never depend on the art being fetchable.
    const plan = openPlan();
    const svg = villageBackgroundSvg(plan, {});
    assert.doesNotMatch(svg, /<use /);
    assert.ok((svg.match(/<circle /g) ?? []).length >= plan.dressing.trees.length);
  });

  test("farmsteads are placed and drawn, and never land on a field", () => {
    const plan = openPlan();
    const steads = plan.dressing.farmsteads;
    assert.ok(steads.length > 0, "no farmsteads placed");
    for (const stead of steads) {
      for (const cell of [...plan.dressing.fields, ...plan.dressing.orchards]) {
        const dx = cell.center.x - stead.center.x;
        const dy = cell.center.y - stead.center.y;
        assert.ok(Math.hypot(dx, dy) >= stead.size / 2, "a farmstead overlaps a field");
      }
    }
    const svg = villageBackgroundSvg(plan, { sprites: sprites() });
    assert.equal((svg.match(/href="#vp-farm-plot/g) ?? []).length, steads.length);
  });

  test("a ruin has no farmsteads", () => {
    const plan = buildVillagePlan({ villageId: "v1", name: "Ash" }, { seed: "s1" });
    assert.equal(plan.form, PLAN_FORMS.RUIN);
    assert.deepEqual(plan.dressing.farmsteads, []);
  });

  test("every stamped building gets a shadow on the ground", () => {
    const plan = openPlan();
    const footprints = stampFootprints(plan, {});
    assert.ok(footprints.length > 0);
    const svg = villageBackgroundSvg(plan, { sprites: sprites(), footprints });
    assert.equal((svg.match(/href="#vp-shadow-/g) ?? []).length, footprints.length);
  });

  test("the light stays world-fixed instead of turning with the building", () => {
    // The whole reason shadows are painted here rather than shipped on the
    // Tile: the displacement must sit outside the rotation.
    const plan = openPlan();
    const footprints = stampFootprints(plan, {});
    const svg = villageBackgroundSvg(plan, { sprites: sprites(), footprints });
    const nodes = [...svg.matchAll(
      /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\) rotate\((-?[\d.]+)\) translate\([^)]+\)"><use href="#vp-shadow-/g
    )];
    assert.equal(nodes.length, footprints.length);
    for (const [i, node] of nodes.entries()) {
      const spot = footprints[i];
      const dx = Number(node[1]) - spot.center.x;
      const dy = Number(node[2]) - spot.center.y;
      // Offset is the set's own light, scaled to the building and never rotated.
      assert.ok(Math.abs(dx - (STAMP_SHADOW_OFFSET.dx / 512) * spot.width) < 0.02);
      assert.ok(Math.abs(dy - (STAMP_SHADOW_OFFSET.dy / 512) * spot.height) < 0.02);
    }
  });

  test("cast shadows are softened, so they read as shadows not as duplicates", () => {
    // A hard-edged silhouette displaced 5.5% of a building's width reads as a
    // misregistered copy, and it would sit beside drawn buildings that are
    // softened by the layer's own feDropShadow.
    const plan = openPlan();
    const footprints = stampFootprints(plan, {});
    const svg = villageBackgroundSvg(plan, { sprites: sprites(), footprints });
    assert.match(svg, /<filter id="vp-stamp-shadow"/);
    assert.match(svg, /id="stamp-shadows" filter="url\(#vp-stamp-shadow\)"/);
    const blur = Number(svg.match(/id="vp-stamp-shadow"[\s\S]*?stdDeviation="([\d.]+)"/)[1]);
    const widths = footprints.map(f => f.width).sort((a, b) => a - b);
    const median = widths[Math.floor(widths.length / 2)];
    assert.ok(Math.abs(blur - median * STAMP_SHADOW_BLUR_RATIO) < 0.01);
    // Softening must stay well under the offset, or the shadow smears into a halo.
    assert.ok(blur < Math.hypot(STAMP_SHADOW_OFFSET.dx, STAMP_SHADOW_OFFSET.dy) / 512 * median);
  });

  test("no shadows means no filter left dangling", () => {
    const plan = openPlan();
    const svg = villageBackgroundSvg(plan, { sprites: sprites(), footprints: [] });
    assert.doesNotMatch(svg, /vp-stamp-shadow/);
  });

  test("the baked-in offset is stripped so it cannot be applied twice", () => {
    const body = stampShadowBody(read(shadowSrcFor(INSTITUTION_STAMPS.temple.src)));
    assert.doesNotMatch(body, /transform="translate\(28 16\)"/);
    assert.match(body, /id="shadow"/);
    // Stripping the transform must not strip the artwork with it.
    assert.ok(body.length > 100);
  });

  test("drawn buildings keep their layer filter and take no painted shadow", () => {
    // Via renderPlanToSvg, not villageBackgroundSvg — the latter is the Scene
    // backdrop and always forces the buildings off.
    const plan = openPlan();
    const drawn = renderPlanToSvg(plan, {
      sprites: sprites(),
      footprints: stampFootprints(plan, {}),
      showBuildings: true
    });
    assert.doesNotMatch(drawn, /id="stamp-shadows"/);
    assert.match(drawn, /filter="url\(#vp-shadow\)"/);
    // And the backdrop, where the buildings are Tiles, is the one that paints.
    const backdrop = villageBackgroundSvg(plan, {
      sprites: sprites(),
      footprints: stampFootprints(plan, {})
    });
    assert.match(backdrop, /id="stamp-shadows"/);
  });
});

describe("village stamp art — level progressions", () => {
  test("the two printed progressions still resolve at level 2", () => {
    // The set ships the level-1 form for both; this holds the line until
    // foundry and cathedral art exist.
    for (const type of ["blacksmith", "temple"]) {
      assert.equal(stampForInstitution(type, 2), INSTITUTION_STAMPS[type]);
    }
  });

  test("a level override takes precedence when one is added", () => {
    // Guards the seam rather than the (currently empty) data.
    const set = composeStampArtSet(drawnSet());
    const base = assetForInstitution({ type: "temple", effectiveLevel: 1, artSet: set });
    const upper = assetForInstitution({ type: "temple", effectiveLevel: 2, artSet: set });
    assert.equal(base.src, upper.src);
    assert.equal(stampForInstitution("temple", 0), INSTITUTION_STAMPS.temple);
    assert.equal(stampForInstitution("", 1), null);
  });
});
