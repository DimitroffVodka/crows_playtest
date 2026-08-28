import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildVillageProjection } from "../module/helpers/village-map.mjs";
import { VILLAGE_ART_SET } from "../module/helpers/village-art.mjs";
import { composeStampArtSet } from "../module/helpers/village-stamp-art.mjs";

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

const slotCoordinates = projection => Object.fromEntries(projection.institutions.map(tile => [
  tile.flags.crows.village.institutionType,
  { x: tile.x, y: tile.y, width: tile.width, height: tile.height, rotation: tile.rotation }
]));

const identities = entries => entries.map(tile => tile.flags.crows.village.slotId);

describe("village map | canonical projection", () => {
  it("uses the same twelve institution plots for every village state", () => {
    const expected = {
      alchemist: { x: 3145, y: 1823 },
      auctionHouse: { x: 4406, y: 2636 },
      barracks: { x: 2332, y: 2265 },
      beacon: { x: 5012, y: 3162 },
      blacksmith: { x: 1564, y: 4548 },
      bookseller: { x: 1762, y: 3651 },
      crypt: { x: 2834, y: 1226 },
      enchanter: { x: 3647, y: 3157 },
      generalStore: { x: 1725, y: 2655 },
      inn: { x: 2385, y: 3887 },
      stables: { x: 3264, y: 5394 },
      temple: { x: 3657, y: 2593 }
    };
    const source = gadwick();
    const first = buildVillageProjection(source);
    const changed = buildVillageProjection(gadwick({
      sceneSeed: "a different village cannot move the streets",
      prosperity: 10,
      institutions: [...source.institutions].reverse().map((institution, index) => ({
        ...institution,
        id: `different-record-${index}`,
        level: 5
      }))
    }));

    assert.equal(first.plan, null, "runtime planning survived the canonical selector");
    assert.equal(first.institutions.length, 12);
    assert.equal(changed.institutions.length, 12);
    assert.deepEqual(slotCoordinates(changed), slotCoordinates(first));
    for (const tile of first.institutions) {
      const type = tile.flags.crows.village.institutionType;
      assert.deepEqual({ x: tile.x, y: tile.y }, expected[type], `${type} moved off its frozen plot`);
      assert.equal(tile.width, tile.height, `${type} stamp was stretched`);
    }
  });

  it("renders an in-fiction waiting plot until its institution is founded", () => {
    const before = buildVillageProjection(gadwick());
    const waiting = before.institutions.find(tile => tile.flags.crows.village.institutionType === "beacon");
    assert.ok(waiting);
    assert.equal(waiting.flags.crows.village.visualState, "unbuilt");
    assert.match(waiting.texture.src, /unbuilt-plot\.svg$/);

    const after = buildVillageProjection(gadwick({
      institutions: [...gadwick().institutions, { id: "new-beacon", type: "beacon", level: 1 }]
    }));
    const founded = after.institutions.find(tile => tile.flags.crows.village.institutionType === "beacon");
    assert.equal(founded.flags.crows.village.institutionId, "new-beacon");
    assert.equal(founded.flags.crows.village.visualState, "operating");
    assert.deepEqual({ x: founded.x, y: founded.y }, { x: waiting.x, y: waiting.y });

    const empty = buildVillageProjection(gadwick({ institutions: [] }));
    assert.equal(empty.institutions.length, 12);
    assert.ok(empty.institutions.every(tile => tile.flags.crows.village.visualState === "unbuilt"));
  });

  it("prefers a surviving institution over a later tombstone of the same type", () => {
    const village = gadwick();
    village.institutions.find(institution => institution.type === "blacksmith").id = "blacksmith-live";
    village.institutions.push({
      id: "blacksmith-old-ruin",
      type: "blacksmith",
      level: 2,
      destroyed: true,
      destroyedOnCycle: 3
    });
    const tile = buildVillageProjection(village).institutions.find(candidate =>
      candidate.flags.crows.village.institutionType === "blacksmith");
    assert.equal(tile.flags.crows.village.institutionId, "blacksmith-live");
    assert.notEqual(tile.flags.crows.village.visualState, "destroyed");
  });

  it("selects exact ordered prefixes for growth and decline", () => {
    const poor = buildVillageProjection(gadwick({ prosperity: -10 }));
    const middle = buildVillageProjection(gadwick({ prosperity: 0 }));
    const rich = buildVillageProjection(gadwick({ prosperity: 10 }));
    assert.deepEqual(
      [poor.housing.length, middle.housing.length, rich.housing.length],
      [0, 35, 69]
    );
    assert.deepEqual(
      [poor.farmland.length, middle.farmland.length, rich.farmland.length],
      [0, 11, 22]
    );
    assert.deepEqual(
      [poor.dressing.length, middle.dressing.length, rich.dressing.length],
      [0, 39, 77]
    );

    for (let prosperity = -10; prosperity <= 10; prosperity += 1) {
      const projection = buildVillageProjection(gadwick({ prosperity }));
      assert.deepEqual(identities(projection.housing), identities(rich.housing).slice(0, projection.housing.length));
      assert.deepEqual(identities(projection.farmland), identities(rich.farmland).slice(0, projection.farmland.length));
      assert.deepEqual(identities(projection.dressing), identities(rich.dressing).slice(0, projection.dressing.length));
      const revisited = buildVillageProjection(gadwick({ prosperity }));
      assert.deepEqual(identities(revisited.tiles), identities(projection.tiles), `Prosperity ${prosperity} did not restore its exact prefix`);
    }
  });

  it("keeps every selected body inside the square canonical background", () => {
    const projection = buildVillageProjection(gadwick({ prosperity: 10 }));
    for (const tile of [
      ...projection.institutions,
      ...projection.housing,
      ...projection.farmland,
      ...projection.dressing
    ]) {
      assert.ok(tile.x - tile.width / 2 >= 0, `${tile.name} crosses the left edge`);
      assert.ok(tile.y - tile.height / 2 >= 0, `${tile.name} crosses the top edge`);
      assert.ok(tile.x + tile.width / 2 <= 6000, `${tile.name} crosses the right edge`);
      assert.ok(tile.y + tile.height / 2 <= 6000, `${tile.name} crosses the bottom edge`);
    }
  });

  it("ships every canonical texture through the release payload", () => {
    const payload = readFileSync("release.sh", "utf8").match(/^PAYLOAD=\((.*)\)$/m)?.[1]?.split(/\s+/) ?? [];
    assert.ok(payload.includes("assets"), "assets/ missing from release payload");

    const projection = buildVillageProjection(gadwick({ prosperity: 10 }));
    const canonicalTextures = projection.tiles
      .map(tile => tile.texture.src)
      .filter(src => src.startsWith("systems/crows/assets/village/canonical/"));
    canonicalTextures.push("systems/crows/assets/village/canonical/background.svg");
    assert.ok(canonicalTextures.length > 150, "canonical texture coverage is suspiciously narrow");
    assert.deepEqual(
      canonicalTextures.filter(src => !existsSync(src.replace("systems/crows/", ""))),
      []
    );
  });
});

describe("village map | canonical art wiring", () => {
  const institutionSrc = projection => Object.fromEntries(projection.institutions.map(tile => [
    tile.flags.crows.village.institutionType, tile.texture.src
  ]));

  it("draws every institution from the authored institution set", () => {
    // The village export draws houses and nothing else, so none of its 81
    // buildings reads as a temple or a smithy. These are the only assets in the
    // project that do.
    const src = institutionSrc(buildVillageProjection(gadwick()));
    for (const [type, path] of Object.entries(src)) {
      if (type === "beacon") continue;                    // unbuilt in this fixture
      assert.match(path, /^systems\/crows\/assets\/institutions\/[a-z-]+\.svg$/, `${type} is off-set`);
    }
    assert.match(src.temple, /\/temple\.svg$/);
    assert.match(src.blacksmith, /\/blacksmith\.svg$/);
    assert.match(src.crypt, /\/crypt\.svg$/);
  });

  it("never places a shadow companion as a building", () => {
    const projection = buildVillageProjection(gadwick({ prosperity: 10 }));
    const shadows = projection.tiles
      .map(tile => tile.texture?.src ?? "")
      .filter(src => src.includes(".shadow."));
    assert.deepEqual(shadows, []);
  });

  it("puts nothing from the legacy catalogue on the canonical map", () => {
    const projection = buildVillageProjection(gadwick({ prosperity: 10 }));
    const strays = projection.tiles
      .map(tile => tile.texture?.src ?? "")
      .filter(src => !src.startsWith("systems/crows/assets/village/canonical/")
        && !src.startsWith("systems/crows/assets/institutions/"));
    assert.deepEqual(strays, []);
  });

  it("keeps the bootstrap and the bare projection on the same drawing", () => {
    // The bootstrap used to layer the separately-drawn stamp set over the map,
    // so one village had two appearances depending on the entry point.
    const direct = institutionSrc(buildVillageProjection(gadwick()));
    const bootstrapped = institutionSrc(buildVillageProjection(gadwick(), {
      plan: null, canonicalHousing: true
    }));
    assert.deepEqual(direct, bootstrapped);
  });

  it("does not let a forwarded catalogue repaint the canonical institutions", () => {
    // This is how the legacy PNGs kept coming back. `villageMapReadModel` named
    // the configured catalogue when it built a projection, so merely reading the
    // map — opening the Village UI does it — re-dressed all twelve institutions
    // in watercolour raster on a vector map.
    const override = { resolve: ({ type }) => ({ src: `/override/${type}.png` }) };
    const src = institutionSrc(buildVillageProjection(gadwick(), { artSet: override }));
    assert.match(src.temple, /\/assets\/institutions\/temple\.svg$/);
    assert.match(src.blacksmith, /\/assets\/institutions\/blacksmith\.svg$/);

    // The legacy set specifically, which is what gets forwarded in practice.
    const legacy = institutionSrc(buildVillageProjection(gadwick(), { artSet: VILLAGE_ART_SET }));
    assert.deepEqual(
      Object.values(legacy).filter(path => path.endsWith(".png")),
      []
    );
  });

  it("keeps canonical housing when an override carries no housing art", () => {
    // Supplying an art set used to disable canonical housing outright. A caller
    // overriding only institution art supplies a set with no housing entry, so
    // all sixty-nine houses resolved to an empty texture: no art, no error.
    const institutionsOnly = {
      resolve: ({ type, kind }) => kind === "housing" || !type ? null : { src: `/override/${type}.png` }
    };
    const projection = buildVillageProjection(gadwick({ prosperity: 10 }), { artSet: institutionsOnly });
    assert.equal(projection.housing.length, 69);
    assert.deepEqual(projection.housing.filter(tile => !tile.texture?.src), []);
    for (const tile of projection.housing) {
      assert.match(tile.texture.src, /\/canonical\/housing\/building-\d+\.svg$/);
    }
  });

  it("still lets an art set that does carry housing art supply it", () => {
    // The override is only ignored when it has nothing to offer; a set that
    // genuinely provides housing keeps winning, as it always did.
    const withHousing = { assets: { housing: "/override/housing.png" } };
    const projection = buildVillageProjection(gadwick({ prosperity: 10 }), { artSet: withHousing });
    assert.ok(projection.housing.every(tile => tile.texture.src === "/override/housing.png"));

    // And opting out entirely stays available.
    const opted = buildVillageProjection(gadwick({ prosperity: 10 }), { canonicalHousing: false });
    assert.ok(opted.housing.every(tile => !/\/canonical\/housing\//.test(tile.texture?.src ?? "")));
  });

  it("rasterizes every placeable SVG at twice its largest canonical display size", () => {
    const founded = gadwick({
      prosperity: 10,
      institutions: [
        ...gadwick().institutions,
        { id: "beacon", type: "beacon", level: 1 }
      ]
    });
    const projections = [
      buildVillageProjection(founded),
      buildVillageProjection(gadwick({ institutions: [] }))
    ];
    const largestPlacementBySrc = new Map();

    for (const projection of projections) {
      for (const tile of projection.tiles) {
        const src = tile.texture?.src ?? "";
        // Institutions come from the authored set; everything else from the
        // village export. Both are placed, so both must be exercised here.
        const placeable = src.startsWith("systems/crows/assets/village/canonical/")
          || src.startsWith("systems/crows/assets/institutions/");
        if (!placeable || src.endsWith("background.svg")) continue;
        const prior = largestPlacementBySrc.get(src) ?? { width: 0, height: 0 };
        largestPlacementBySrc.set(src, {
          width: Math.max(prior.width, tile.width),
          height: Math.max(prior.height, tile.height)
        });
      }
    }

    assert.equal(largestPlacementBySrc.size, 181, "not every placeable canonical SVG was exercised");
    for (const [src, placement] of largestPlacementBySrc) {
      const svg = readFileSync(src.replace("systems/crows/", ""), "utf8");
      const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
      const intrinsicWidth = Number(root.match(/\bwidth="([^"]+)"/)?.[1]);
      const intrinsicHeight = Number(root.match(/\bheight="([^"]+)"/)?.[1]);
      assert.ok(
        intrinsicWidth >= placement.width * 2,
        `${src} rasterizes ${intrinsicWidth}px wide for a ${placement.width}px Tile`
      );
      assert.ok(
        intrinsicHeight >= placement.height * 2,
        `${src} rasterizes ${intrinsicHeight}px high for a ${placement.height}px Tile`
      );
    }
  });

  it("does not embed cast-shadow blobs in placeable canonical art", () => {
    const founded = gadwick({
      prosperity: 10,
      institutions: [
        ...gadwick().institutions,
        { id: "beacon", type: "beacon", level: 1 }
      ]
    });
    const placeableSources = new Set([
      ...buildVillageProjection(founded).tiles.map(tile => tile.texture?.src),
      ...buildVillageProjection(gadwick({ institutions: [] })).tiles.map(tile => tile.texture?.src)
    ].filter(src => src?.startsWith("systems/crows/assets/village/canonical/")
      || src?.startsWith("systems/crows/assets/institutions/")));

    assert.equal(placeableSources.size, 181, "not every placeable canonical SVG was exercised");
    for (const src of placeableSources) {
      const svg = readFileSync(src.replace("systems/crows/", ""), "utf8");
      assert.doesNotMatch(svg, /#9699AE|<g\b[^>]*(?:id="shadow"|opacity="0\.55")/i, `${src} still embeds a cast shadow`);
    }
  });

  it("carries no white shading pixels into the canonical background", () => {
    // The shading layer is a 128x128 bitmap emitted one path per pixel and
    // composited with mix-blend-mode: multiply, under which white is a no-op.
    // Foundry rasterises the background as a texture without applying the blend
    // mode, so every white pixel painted opaque and fogged the terrain.
    const svg = readFileSync("assets/village/canonical/background.svg", "utf8");
    assert.equal((svg.match(/<path\b[^>]*?fill="#FFFFFF"/g) ?? []).length, 0);
    assert.ok(svg.length < 2_000_000, "background is heavier than a scene texture should be");
  });
});
