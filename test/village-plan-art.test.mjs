import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUILDING_SHAPES,
  INSTITUTION_MATERIAL,
  INSTITUTION_SHAPES,
  drawBuilding,
  facetFill,
  institutionSvg,
  materialForInstitution,
  shapeForInstitution
} from "../module/helpers/village-plan-art.mjs";
import {
  DEFAULT_PLAN_STYLE,
  PLAN_STYLES,
  resolveStyle,
  strokesFor
} from "../module/helpers/village-plan-style.mjs";
import { INSTITUTION_ART_KEYS } from "../module/helpers/village-map.mjs";
import { buildVillagePlan } from "../module/helpers/village-plan.mjs";
import { renderPlanToSvg } from "../module/helpers/village-plan-draw.mjs";

const style = PLAN_STYLES[DEFAULT_PLAN_STYLE];

describe("village plan art | mirrors the shipped art keys", () => {
  // INSTITUTION_SHAPES duplicates INSTITUTION_ART_KEYS so the planner stays
  // free of Foundry globals. These tests are what stop the copy drifting.
  it("covers exactly the same institutions", () => {
    assert.deepEqual(Object.keys(INSTITUTION_SHAPES).sort(), Object.keys(INSTITUTION_ART_KEYS).sort());
  });

  it("uses the same level thresholds", () => {
    for (const [type, rows] of Object.entries(INSTITUTION_SHAPES)) {
      const artRows = INSTITUTION_ART_KEYS[type].levels;
      assert.equal(rows.length, artRows.length, `${type} has a different number of level bands`);
      rows.forEach((row, i) => {
        assert.equal(row.max, artRows[i].max, `${type} band ${i} threshold differs`);
      });
    }
  });

  it("draws the two institutions the art set cannot supply", () => {
    // crypt and stables resolve to "unsupported.*" in the PNG catalogue.
    for (const type of ["crypt", "stables"]) {
      assert.ok(INSTITUTION_ART_KEYS[type].levels[0].key.startsWith("unsupported."),
        `${type} is no longer unsupported; this test's premise needs revisiting`);
      assert.ok(BUILDING_SHAPES.includes(shapeForInstitution(type, 1)));
    }
  });
});

describe("village plan art | materials and lighting", () => {
  it("names a real material for every institution", () => {
    const available = Object.keys(style.materials);
    for (const type of Object.keys(INSTITUTION_SHAPES)) {
      assert.ok(available.includes(materialForInstitution(type)),
        `${type} asks for a material the palette does not define`);
    }
  });

  it("keeps the material table aligned with the institutions", () => {
    assert.deepEqual(Object.keys(INSTITUTION_MATERIAL).sort(), Object.keys(INSTITUTION_SHAPES).sort());
  });

  it("lights a facet by its world direction, not its local one", () => {
    // The invariant: rotate the building by t and counter-rotate the facet
    // normal by t, and the facet must keep its colour. Without this, roofs are
    // lit from a different direction on every differently-angled street.
    const pair = style.materials.clay;
    for (const t of [0, 0.4, 1.1, Math.PI / 2, Math.PI, 4.7]) {
      for (const [nx, ny] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const rx = nx * Math.cos(-t) - ny * Math.sin(-t);
        const ry = nx * Math.sin(-t) + ny * Math.cos(-t);
        assert.equal(facetFill(rx, ry, t, pair), facetFill(nx, ny, 0, pair),
          `facet (${nx},${ny}) changed colour when rotated by ${t}`);
      }
    }
  });

  it("lights the upper-left facet and shades the lower-right", () => {
    const pair = style.materials.clay;
    assert.equal(facetFill(-1, -1, 0, pair), pair.light);
    assert.equal(facetFill(1, 1, 0, pair), pair.dark);
  });

  it("uses both sides of the material pair on one roof", () => {
    const svg = drawBuilding({
      shape: "house", center: { x: 0, y: 0 }, angle: 0, width: 300, depth: 260, style, material: "clay"
    });
    assert.ok(svg.includes(style.materials.clay.light), "no lit facet");
    assert.ok(svg.includes(style.materials.clay.dark), "no shaded facet");
  });

  it("scales stroke weight with the building so lines stay proportionate", () => {
    const small = strokesFor(120);
    const large = strokesFor(500);
    assert.ok(large.line > small.line);
    // Clamped at both ends so a tiny plot is not hairlined into invisibility.
    assert.ok(strokesFor(1).line > 0);
    assert.ok(strokesFor(100000).line < 10);
  });
});

describe("village plan art | shape selection", () => {
  it("upgrades the temple from church to cathedral", () => {
    assert.equal(shapeForInstitution("temple", 1), "church");
    assert.equal(shapeForInstitution("temple", 2), "cathedral");
    assert.equal(shapeForInstitution("temple", 6), "cathedral");
  });

  it("upgrades the blacksmith from smith to foundry", () => {
    assert.equal(shapeForInstitution("blacksmith", 1), "smith");
    assert.equal(shapeForInstitution("blacksmith", 3), "foundry");
  });

  it("falls back to a house for an unknown institution", () => {
    assert.equal(shapeForInstitution("nonesuch", 1), "house");
  });

  it("treats a missing or bogus level as first level", () => {
    assert.equal(shapeForInstitution("temple", undefined), "church");
    assert.equal(shapeForInstitution("temple", NaN), "church");
    assert.equal(shapeForInstitution("temple", "not a number"), "church");
  });

  it("knows how to draw every shape it can select", () => {
    for (const type of Object.keys(INSTITUTION_SHAPES)) {
      for (const level of [1, 2, 5, 10]) {
        assert.ok(BUILDING_SHAPES.includes(shapeForInstitution(type, level)));
      }
    }
  });
});

describe("village plan art | drawing", () => {
  const base = { center: { x: 0, y: 0 }, angle: 0, width: 300, depth: 260, style };

  it("draws every shape without throwing and emits geometry", () => {
    for (const shape of BUILDING_SHAPES) {
      const svg = drawBuilding({ ...base, shape });
      assert.ok(svg.startsWith("<g transform="), `${shape} produced no group`);
      assert.ok(/<(path|rect|circle)/.test(svg), `${shape} produced no geometry`);
      assert.ok(!svg.includes("NaN"), `${shape} produced NaN coordinates`);
      assert.ok(!svg.includes("undefined"), `${shape} produced an undefined value`);
    }
  });

  it("places and rotates by transform rather than baking coordinates", () => {
    const svg = drawBuilding({ ...base, shape: "church", center: { x: 120, y: 40 }, angle: Math.PI / 2 });
    assert.match(svg, /translate\(120 40\) rotate\(90\)/);
  });

  it("falls back to a house for an unknown shape", () => {
    assert.ok(drawBuilding({ ...base, shape: "no-such-shape" }).includes("<path"));
  });

  it("draws a destroyed institution as a ruin, not as nothing", () => {
    // C:2266 destroys institutions outright; the map should show the loss.
    // Asserted on the meaning — rubble in the rubble colour inside a broken
    // outline — rather than on which primitive draws it, so restyling the
    // debris does not fail this test.
    const svg = drawBuilding({ ...base, shape: "cathedral", destroyed: true });
    assert.ok(svg.includes(style.rubble) || svg.includes(style.stoneDark), "expected rubble");
    assert.ok(svg.includes("stroke-dasharray"), "expected a broken outline");
    assert.ok(!svg.includes(style.materials.slate.light), "a ruin should have no intact roof");
  });

  it("survives a degenerate plot", () => {
    for (const shape of BUILDING_SHAPES) {
      const svg = drawBuilding({ ...base, shape, width: 0, depth: 0 });
      assert.ok(!svg.includes("NaN"), `${shape} produced NaN at zero size`);
    }
  });

  it("renders in every palette", () => {
    for (const name of Object.keys(PLAN_STYLES)) {
      const svg = drawBuilding({ ...base, shape: "smith", style: resolveStyle(name) });
      assert.ok(!svg.includes("undefined"), `${name} palette left a colour unresolved`);
    }
  });
});

describe("village plan art | standalone institution files", () => {
  it("emits a self-contained SVG document", () => {
    const svg = institutionSvg("temple", { level: 2, size: 256 });
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="256" height="256"/);
    assert.match(svg, /<\/svg>$/);
  });

  it("needs no explicit palette", () => {
    assert.ok(!institutionSvg("inn").includes("undefined"));
  });

  it("reflects level in the emitted document", () => {
    assert.notEqual(institutionSvg("temple", { level: 1 }), institutionSvg("temple", { level: 3 }));
  });

  it("honours an explicit background and defaults to none", () => {
    assert.ok(!institutionSvg("inn").includes("<rect width=\"512\""));
    assert.ok(institutionSvg("inn", { background: "#fff" }).includes("#fff"));
  });

  it("emits a document for every institution", () => {
    for (const type of Object.keys(INSTITUTION_SHAPES)) {
      assert.ok(institutionSvg(type, { level: 3 }).includes("<svg"), `${type} produced no document`);
    }
  });
});

describe("village plan art | on the map", () => {
  const village = {
    name: "Ashmere",
    sceneSeed: "art-map",
    prosperity: 3,
    institutions: [
      { id: "t", type: "temple", level: 4 },
      { id: "b", type: "blacksmith", level: 1 },
      { id: "c", type: "crypt", level: 1 },
      { id: "i", type: "inn", level: 2 }
    ]
  };

  it("carries level and destroyed state onto the plot for the renderer", () => {
    const plan = buildVillagePlan(village);
    const temple = plan.plots.find(p => p.institutionType === "temple");
    assert.ok(temple, "temple was not placed");
    assert.equal(temple.institutionLevel, 4);
  });

  it("draws an upgraded temple differently from a first-level one", () => {
    const low = renderPlanToSvg(buildVillagePlan({
      ...village, institutions: [{ id: "t", type: "temple", level: 1 }]
    }));
    const high = renderPlanToSvg(buildVillagePlan({
      ...village, institutions: [{ id: "t", type: "temple", level: 5 }]
    }));
    assert.notEqual(low, high, "the temple upgrade should be visible on the map");
  });

  it("marks a destroyed institution on the rendered map", () => {
    const plan = buildVillagePlan({
      ...village,
      institutions: [{ id: "t", type: "temple", level: 3, destroyed: true }]
    });
    const plot = plan.plots.find(p => p.institutionType === "temple");
    assert.equal(plot.destroyed, true);
    assert.ok(renderPlanToSvg(plan).includes("stroke-dasharray"));
  });

  it("casts one shadow over the whole buildings layer, not one per building", () => {
    // A per-building filter rotates with its building, so shadows would point
    // in as many directions as there are streets.
    const svg = renderPlanToSvg(buildVillagePlan(village));
    assert.ok(svg.includes('<g id="buildings" filter="url(#vp-shadow)">'));
    assert.equal(svg.split("feDropShadow").length - 1, 1, "expected exactly one shadow filter");
  });

  it("gives institutions their own material on the map", () => {
    const svg = renderPlanToSvg(buildVillagePlan(village));
    // The temple is slate; that pair must appear somewhere on the map.
    assert.ok(svg.includes(style.materials.slate.light) || svg.includes(style.materials.slate.dark));
  });

  it("produces no NaN anywhere in a full map", () => {
    for (const form of ["ruin", "open"]) {
      const svg = renderPlanToSvg(buildVillagePlan(village, { params: { form } }));
      assert.ok(!svg.includes("NaN"), `${form} map contained NaN`);
      assert.ok(!svg.includes("undefined"), `${form} map contained undefined`);
    }
  });
});
