import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SCENE_DEFAULTS,
  buildVillageProjection,
  housingPosition,
  institutionPosition,
  planRotationFor,
  villageBackgroundPath,
  villagePlanFor,
  villageSceneData,
  writeVillagePlanBackground
} from "../module/helpers/village-map.mjs";
import { buildVillagePlan } from "../module/helpers/village-plan.mjs";
import { renderPlanToSvg, villageBackgroundSvg } from "../module/helpers/village-plan-draw.mjs";

/** Gadwick, from the playtest material. */
function gadwick(overrides = {}) {
  return {
    villageId: "gadwick",
    name: "Gadwick",
    sceneSeed: "gadwick",
    prosperity: 0,
    institutions: [
      "alchemist", "auctionHouse", "barracks", "blacksmith", "bookseller", "enchanter",
      "generalStore", "stables", "temple", "inn", "crypt"
    ].map(type => ({ id: type, type, level: 1 })),
    ...overrides
  };
}

const insideScene = tile =>
  tile.x >= 0 && tile.y >= 0
  && tile.x + tile.width <= SCENE_DEFAULTS.width
  && tile.y + tile.height <= SCENE_DEFAULTS.height;

describe("village map | plan is opt-in", () => {
  it("lays out on the grid when no plan is asked for", () => {
    const projection = buildVillageProjection(gadwick());
    assert.equal(projection.plan, null);
    assert.equal(projection.housingCount, projection.housingTier);
    for (const tile of projection.tiles) assert.equal(tile.rotation, 0);
  });

  it("produces identical tiles with and without the option absent", () => {
    // The plan must not change any existing behaviour by merely existing.
    assert.deepEqual(buildVillageProjection(gadwick()), buildVillageProjection(gadwick(), {}));
  });

  it("uses a plan when asked", () => {
    const projection = buildVillageProjection(gadwick(), { usePlan: true });
    assert.ok(projection.plan, "no plan was built");
    assert.equal(projection.institutions.length, 11);
  });

  it("accepts a plan built by the caller", () => {
    const plan = buildVillagePlan(gadwick());
    const projection = buildVillageProjection(gadwick(), { plan });
    assert.equal(projection.plan, plan);
  });

  it("falls back to the grid rather than losing the map if planning throws", () => {
    const projection = buildVillageProjection(gadwick(), {
      usePlan: true,
      // An impossible plan space; the planner should fail rather than cope.
      planParams: { width: Number.NaN, height: Number.NaN }
    });
    assert.ok(projection.tiles.length > 0, "the Ref lost their map");
  });
});

describe("village map | tiles sit on their plots", () => {
  const village = gadwick();
  const projection = buildVillageProjection(village, { usePlan: true });
  const plan = projection.plan;

  it("centres each institution tile on its plot", () => {
    // Foundry places a Tile by its top-left corner but the plan works in
    // centres; getting this wrong offsets every building by half its own size.
    for (const tile of projection.institutions) {
      const id = tile.flags.crows.village.institutionId;
      const placed = plan.assignment.institutions.find(a => a.institutionId === id);
      assert.ok(placed, `${id} is not in the plan`);
      const cx = tile.x + tile.width / 2;
      const cy = tile.y + tile.height / 2;
      assert.ok(Math.hypot(cx - placed.center.x, cy - placed.center.y) < 2, `${id} is off its plot`);
    }
  });

  it("keeps every tile inside the scene", () => {
    for (const tile of projection.tiles) {
      assert.ok(insideScene(tile), `${tile.name} escapes the scene at ${tile.x},${tile.y}`);
    }
  });

  it("scales tile art down to the plot it was given", () => {
    // Institution art is configured at 4x3 grid squares — 1200x900 — which is
    // many times the area of a plot. Drawn unscaled every building would swamp
    // its neighbours and hang off the map.
    for (const tile of projection.institutions) {
      assert.ok(tile.width < 1200 && tile.height < 900, `${tile.name} was not scaled to its plot`);
      assert.ok(tile.width > 0 && tile.height > 0);
    }
  });

  it("preserves the art's aspect ratio while fitting", () => {
    const wanted = SCENE_DEFAULTS.institutionWidthGrid / SCENE_DEFAULTS.institutionHeightGrid;
    for (const tile of projection.institutions) {
      assert.ok(Math.abs(tile.width / tile.height - wanted) < 0.02, `${tile.name} was distorted`);
    }
  });

  it("turns tiles to face their streets", () => {
    assert.ok(new Set(projection.tiles.map(t => t.rotation)).size > 1, "every tile has the same rotation");
  });

  it("leaves tiles upright when rotation is declined", () => {
    const upright = buildVillageProjection(village, { usePlan: true, rotateToStreet: false });
    for (const tile of upright.tiles) assert.equal(tile.rotation, 0);
  });

  it("never overlaps two institution tiles", () => {
    const boxes = projection.institutions.map(t => t);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.x + a.width <= b.x || b.x + b.width <= a.x
          || a.y + a.height <= b.y || b.y + b.height <= a.y;
        assert.ok(apart, `${a.name} overlaps ${b.name}`);
      }
    }
  });
});

describe("village map | housing follows the plan", () => {
  it("houses the village beyond the five-tile tier", () => {
    // Without a plan the projection caps housing at MAX_HOUSING_TILES.
    const gridded = buildVillageProjection(gadwick({ prosperity: 10 }));
    const planned = buildVillageProjection(gadwick({ prosperity: 10 }), { usePlan: true });
    assert.ok(gridded.housing.length <= 5);
    assert.ok(planned.housing.length > gridded.housing.length, "the plan added no homes");
  });

  it("gives every home its own position", () => {
    const planned = buildVillageProjection(gadwick({ prosperity: 8 }), { usePlan: true });
    const seen = new Set(planned.housing.map(t => `${t.x},${t.y}`));
    assert.equal(seen.size, planned.housing.length, "homes are stacked on each other");
  });

  it("resolves a plan position directly through the exported seams", () => {
    const plan = buildVillagePlan(gadwick());
    const at = institutionPosition(gadwick(), { id: "temple", type: "temple" }, {
      plan, tileWidth: 300, tileHeight: 225
    });
    const placed = plan.assignment.institutions.find(a => a.institutionId === "temple");
    assert.equal(at.x, Math.round(placed.center.x - 150));
    assert.equal(at.y, Math.round(placed.center.y - 112.5));
  });

  it("falls back to the grid for anything the plan could not place", () => {
    const plan = buildVillagePlan(gadwick());
    const at = institutionPosition(gadwick(), { id: "nowhere", type: "nowhere" }, {
      plan, tileWidth: 300, tileHeight: 225
    });
    assert.ok(Number.isFinite(at.x) && Number.isFinite(at.y));
  });

  it("keeps housing off the clamp when the plan runs past five", () => {
    const plan = buildVillagePlan(gadwick({ prosperity: 10 }));
    const seventh = housingPosition(gadwick({ prosperity: 10 }), 7, {
      plan, tileWidth: 300, tileHeight: 300
    });
    const placed = plan.assignment.housing[7];
    assert.ok(placed, "this test needs at least eight homes");
    assert.equal(seventh.x, Math.round(placed.center.x - 150));
  });
});

describe("village map | growing through the projection", () => {
  it("keeps every tile in place while the village grows", () => {
    const start = buildVillageProjection(gadwick(), { usePlan: true });
    const grown = buildVillageProjection(gadwick({ prosperity: 10 }), {
      usePlan: true,
      previousPlan: start.plan
    });
    for (const before of start.institutions) {
      const id = before.flags.crows.village.institutionId;
      const after = grown.institutions.find(t => t.flags.crows.village.institutionId === id);
      assert.equal(after.x, before.x, `${id} moved`);
      assert.equal(after.y, before.y, `${id} moved`);
    }
    assert.ok(grown.housing.length > start.housing.length, "no villagers were housed");
  });

  it("keeps a founded institution from displacing anyone", () => {
    const start = buildVillageProjection(gadwick(), { usePlan: true });
    const grown = buildVillageProjection(
      gadwick({ institutions: [...gadwick().institutions, { id: "beacon", type: "beacon", level: 1 }] }),
      { usePlan: true, previousPlan: start.plan }
    );
    assert.equal(grown.institutions.length, 12);
    for (const before of start.institutions) {
      const id = before.flags.crows.village.institutionId;
      const after = grown.institutions.find(t => t.flags.crows.village.institutionId === id);
      assert.equal(after.x, before.x, `${id} moved when the beacon was founded`);
    }
  });
});

describe("village map | drawn backdrop", () => {
  const plan = buildVillagePlan(gadwick());

  it("draws the ground without the buildings", () => {
    // On a Scene the buildings are Tiles. Drawing them into the backdrop too
    // would render every building twice, once in the floor and once standing.
    const backdrop = villageBackgroundSvg(plan);
    assert.ok(!backdrop.includes('id="buildings"'), "the backdrop drew buildings");
    assert.ok(backdrop.includes('id="streets"'), "the backdrop has no streets");
    assert.ok(backdrop.includes('id="boundary"'), "the backdrop has no shell");
  });

  it("is smaller than the full map it comes from", () => {
    assert.ok(villageBackgroundSvg(plan).length < renderPlanToSvg(plan).length);
  });

  it("is a self-contained SVG sized to the scene", () => {
    const backdrop = villageBackgroundSvg(plan);
    assert.match(backdrop, new RegExp(`width="${SCENE_DEFAULTS.width}" height="${SCENE_DEFAULTS.height}"`));
    assert.match(backdrop, /<\/svg>$/);
  });

  it("puts a village's backdrop under the world's own assets", () => {
    const at = villageBackgroundPath("gadwick", "crowfresh");
    assert.equal(at.path, "worlds/crowfresh/assets/crows-village/gadwick.svg");
  });

  it("sanitises a villageId that would escape the directory", () => {
    const at = villageBackgroundPath("../../etc/passwd", "w");
    assert.ok(!at.path.includes(".."), `path escapes: ${at.path}`);
    assert.equal(at.file, "etc-passwd.svg");
    assert.equal(at.path, "worlds/w/assets/crows-village/etc-passwd.svg");
  });

  it("never writes a hidden file or an empty name", () => {
    assert.equal(villageBackgroundPath(".hidden", "w").file, "hidden.svg");
    assert.equal(villageBackgroundPath("", "w").file, "village.svg");
    assert.equal(villageBackgroundPath("...", "w").file, "village.svg");
  });

  it("uses a drawn backdrop on the Scene when given one", () => {
    const scene = villageSceneData(gadwick(), "op", { backgroundSrc: "worlds/w/assets/crows-village/g.svg" });
    // v14 stores the backdrop on the Level; both must agree.
    assert.equal(scene.levels[0].background.src, "worlds/w/assets/crows-village/g.svg");
    assert.equal(scene.background.src, "worlds/w/assets/crows-village/g.svg");
    assert.equal(scene.flags.crows.village.backgroundVariant, "plan");
  });

  it("falls back to the shipped catalogue without one", () => {
    const scene = villageSceneData(gadwick(), "op", {});
    assert.notEqual(scene.flags?.crows?.village?.backgroundVariant, "plan");
  });

  it("returns null rather than throwing where no FilePicker exists", async () => {
    // Node has none; a missing backdrop must not stop a Scene being made.
    assert.equal(await writeVillagePlanBackground({ plan, villageId: "g" }), null);
    assert.equal(await writeVillagePlanBackground({ plan: null, villageId: "g" }), null);
  });
});

describe("village map | plan helpers", () => {
  it("returns no plan unless one is wanted", () => {
    assert.equal(villagePlanFor(gadwick(), {}), null);
    assert.ok(villagePlanFor(gadwick(), { usePlan: true }));
  });

  it("turns a placement angle into whole degrees", () => {
    assert.equal(planRotationFor(null), 0);
    assert.equal(planRotationFor({ angle: 0 }), 90);
    assert.equal(planRotationFor({ angle: Math.PI / 2 }), 180);
    assert.equal(planRotationFor({ angle: Number.NaN }), 0);
  });
});
