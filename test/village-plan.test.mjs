import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INSTITUTION_PLACEMENT,
  PLAN_FORMS,
  PLAN_STAGES,
  VILLAGE_PLAN_VERSION,
  buildVillagePlan,
  defaultPlanParams,
  demandFor,
  housingCountFor,
  planPositionForHousing,
  planPositionForInstitution,
  resolveAutoParams
} from "../module/helpers/village-plan.mjs";
import { PLAN_STYLES, renderPlanToSvg } from "../module/helpers/village-plan-draw.mjs";
import {
  Rng,
  convexRingsOverlap,
  dist,
  distToPolyline,
  pointInPolygon,
  streamFor
} from "../module/helpers/village-plan-geom.mjs";

/** C:2232 — the starting six, all 1st level. */
function startingVillage(overrides = {}) {
  return {
    name: "Ashmere",
    sceneSeed: "ashmere-1",
    prosperity: 0,
    institutions: ["blacksmith", "crypt", "generalStore", "inn", "temple", "stables"]
      .map((type, i) => ({ id: `i${i}`, type, level: 1 })),
    ...overrides
  };
}

function grownVillage(overrides = {}) {
  return {
    name: "Highfen",
    sceneSeed: "highfen-1",
    prosperity: 9,
    institutions: Object.keys(INSTITUTION_PLACEMENT).map((type, i) => ({ id: `g${i}`, type, level: 3 })),
    ...overrides
  };
}

describe("village plan | seeded randomness", () => {
  it("gives a stage the same stream for the same seed", () => {
    const a = streamFor("seed", "streets");
    const b = streamFor("seed", "streets");
    assert.equal(a.float(), b.float());
  });

  it("gives different stages different streams", () => {
    const a = streamFor("seed", "streets");
    const b = streamFor("seed", "plots");
    assert.notEqual(a.float(), b.float());
  });

  it("produces values in range", () => {
    const rng = new Rng("range-check");
    for (let i = 0; i < 500; i++) {
      const v = rng.float();
      assert.ok(v >= 0 && v < 1, `float out of range: ${v}`);
      assert.ok(rng.int(3, 7) >= 3 && rng.int(3, 7) <= 7);
    }
  });
});

describe("village plan | determinism", () => {
  it("is byte-identical for the same village and params", () => {
    const a = buildVillagePlan(startingVillage());
    const b = buildVillagePlan(startingVillage());
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  it("differs for a different seed", () => {
    const a = buildVillagePlan(startingVillage({ sceneSeed: "one" }));
    const b = buildVillagePlan(startingVillage({ sceneSeed: "two" }));
    assert.notEqual(JSON.stringify(a.streets), JSON.stringify(b.streets));
  });

  it("serializes to JSON without loss", () => {
    const plan = buildVillagePlan(startingVillage());
    assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
  });

  it("stamps its version", () => {
    assert.equal(buildVillagePlan(startingVillage()).version, VILLAGE_PLAN_VERSION);
  });
});

describe("village plan | stage isolation", () => {
  it("keeps the boundary stable when plot params change", () => {
    // The boundary is sized from the record, so tuning plots must not move it.
    const a = buildVillagePlan(startingVillage());
    const b = buildVillagePlan(startingVillage(), { params: { plots: { gaps: 0.6 } } });
    assert.deepEqual(a.boundary, b.boundary);
  });

  it("keeps the boundary stable when dressing params change", () => {
    const a = buildVillagePlan(grownVillage(), { params: { form: PLAN_FORMS.OPEN } });
    const b = buildVillagePlan(grownVillage(), { params: { form: PLAN_FORMS.OPEN, open: { trees: 10 } } });
    assert.deepEqual(a.boundary, b.boundary);
  });

  it("honours an explicit street lock across a param change", () => {
    const first = buildVillagePlan(startingVillage());
    const locked = buildVillagePlan(startingVillage(), {
      params: { plots: { gaps: 0.6 } },
      previous: first,
      locks: { streets: true }
    });
    assert.deepEqual(locked.streets, first.streets);
  });

  it("drops a locked street network that no longer fits a changed boundary", () => {
    // Locking must not emit streets running outside the shell they are reused
    // against; the planner regenerates rather than keeping a wrong layout.
    // The boundary lock is explicitly released — handing over a previous plan
    // otherwise pins it, and the shell would never move for the streets to
    // stop fitting.
    const wide = buildVillagePlan(startingVillage(), { params: { extent: 0.95 } });
    const narrow = buildVillagePlan(startingVillage(), {
      params: { extent: 0.35 },
      previous: wide,
      locks: { boundary: false, plots: false, streets: true }
    });
    assert.notDeepEqual(narrow.boundary, wide.boundary, "the boundary should have moved");
    for (const street of narrow.streets.streets) {
      for (const p of street.points) {
        assert.ok(pointInPolygon(p, narrow.boundary.interior), "street escaped the boundary it was reused against");
      }
    }
  });

  it("lists every stage it can lock", () => {
    assert.deepEqual([...PLAN_STAGES], ["boundary", "streets", "plots", "assignment", "dressing"]);
  });
});

describe("village plan | growing an existing village", () => {
  // Gadwick, from the playtest material: eleven institutions, Prosperity 0.
  const gadwick = (overrides = {}) => ({
    name: "Gadwick",
    sceneSeed: "gadwick",
    prosperity: 0,
    institutions: [
      { id: "alchemist", type: "alchemist", level: 1, steward: "Brune" },
      { id: "auctionHouse", type: "auctionHouse", level: 1, steward: "Lili" },
      { id: "barracks", type: "barracks", level: 2, steward: "Cormal" },
      { id: "blacksmith", type: "blacksmith", level: 2, steward: "Deirdre" },
      { id: "bookseller", type: "bookseller", level: 1, steward: "Rion" },
      { id: "enchanter", type: "enchanter", level: 1, steward: "Isaac" },
      { id: "generalStore", type: "generalStore", level: 3, steward: "Sorcha" },
      { id: "stables", type: "stables", level: 3, steward: "Anna" },
      { id: "temple", type: "temple", level: 1, steward: "Mackle" },
      { id: "inn", type: "inn", level: 1, steward: "Duna" },
      { id: "crypt", type: "crypt", level: 1, steward: "Oda" }
    ],
    ...overrides
  });

  const centreOf = (plan, id) => plan.assignment.institutions.find(a => a.institutionId === id)?.center;
  const movedBetween = (a, b, ids) => ids.filter(id => {
    const p = centreOf(a, id), q = centreOf(b, id);
    return !p || !q || p.x !== q.x || p.y !== q.y;
  });

  it("places every institution of a real starting village", () => {
    const plan = buildVillagePlan(gadwick());
    assert.equal(plan.stats.unplacedInstitutions, 0);
    assert.equal(plan.assignment.institutions.length, 11);
  });

  it("leaves vacant plots to grow into", () => {
    // Without headroom, founding anything evicts a house and rising Prosperity
    // adds nobody, because every frontage is already taken.
    assert.ok(buildVillagePlan(gadwick()).stats.vacant > 0);
  });

  it("does not move a single existing building when one is founded", () => {
    const before = buildVillagePlan(gadwick());
    const after = buildVillagePlan(
      gadwick({ institutions: [...gadwick().institutions, { id: "beacon", type: "beacon", level: 1 }] }),
      { previous: before }
    );
    const moved = movedBetween(before, after, gadwick().institutions.map(i => i.id));
    assert.deepEqual(moved, [], `${moved.length} existing institutions moved`);
    assert.ok(centreOf(after, "beacon"), "the new institution was not placed");
    assert.deepEqual(after.streets, before.streets, "the streets were redrawn");
  });

  it("adds villagers as Prosperity rises, without disturbing the village", () => {
    const poor = buildVillagePlan(gadwick());
    const rich = buildVillagePlan(gadwick({ prosperity: 6 }), { previous: poor });
    assert.ok(rich.stats.housing > poor.stats.housing, "no new homes were built");
    assert.deepEqual(movedBetween(poor, rich, gadwick().institutions.map(i => i.id)), []);
  });

  it("keeps an upgraded institution on its own plot", () => {
    const before = buildVillagePlan(gadwick());
    const after = buildVillagePlan(
      gadwick({ institutions: gadwick().institutions.map(i => i.id === "temple" ? { ...i, level: 2 } : i) }),
      { previous: before }
    );
    assert.deepEqual(centreOf(after, "temple"), centreOf(before, "temple"));
    assert.equal(after.plots.find(p => p.institutionType === "temple").institutionLevel, 2);
  });

  it("frees the plot of an institution that is removed", () => {
    const before = buildVillagePlan(gadwick());
    const inn = centreOf(before, "inn");
    const after = buildVillagePlan(
      gadwick({ institutions: gadwick().institutions.filter(i => i.id !== "inn") }),
      { previous: before }
    );
    assert.equal(centreOf(after, "inn"), undefined);
    const reused = after.plots.find(p => p.center.x === inn.x && p.center.y === inn.y);
    assert.ok(reused && reused.use !== "institution", "the vacated plot is still held by an institution");
  });

  it("carries the steward through to the placement", () => {
    const plan = buildVillagePlan(gadwick());
    assert.equal(plan.assignment.institutions.find(a => a.type === "crypt").steward, "Oda");
  });

  it("extends the street network when it runs out of ground", () => {
    // Prosperity 10 wants far more homes than the original layout can hold.
    const poor = buildVillagePlan(gadwick());
    const rich = buildVillagePlan(gadwick({ prosperity: 10 }), { previous: poor });
    assert.ok(rich.stats.streets > poor.stats.streets, "the network did not grow");
    assert.ok(rich.stats.plots > poor.stats.plots, "growth produced no new plots");
    assert.equal(rich.stats.growth.lanes > 0, true);
  });

  it("keeps every existing street untouched while growing", () => {
    // Growth appends; it must never redraw what plots are already fronting on.
    const poor = buildVillagePlan(gadwick());
    const rich = buildVillagePlan(gadwick({ prosperity: 10 }), { previous: poor });
    assert.deepEqual(rich.streets.streets.slice(0, poor.streets.streets.length), poor.streets.streets);
    assert.deepEqual(rich.plots.slice(0, poor.plots.length).map(p => p.ring), poor.plots.map(p => p.ring));
  });

  it("does not move a building while the village grows around it", () => {
    const poor = buildVillagePlan(gadwick());
    const rich = buildVillagePlan(gadwick({ prosperity: 10 }), { previous: poor });
    assert.deepEqual(movedBetween(poor, rich, gadwick().institutions.map(i => i.id)), []);
  });

  it("does not grow while plots are still standing empty", () => {
    // Founding one institution into a village with vacant plots should use
    // them, not reach for new ground.
    const before = buildVillagePlan(gadwick());
    assert.ok(before.stats.vacant > 0, "this test needs spare plots to be meaningful");
    const after = buildVillagePlan(
      gadwick({ institutions: [...gadwick().institutions, { id: "beacon", type: "beacon", level: 1 }] }),
      { previous: before }
    );
    assert.deepEqual(after.streets, before.streets);
  });

  it("grows no lane that nobody can build on", () => {
    // Every appended lane must have earned at least one plot, or the village
    // fills with dead ends that serve no one.
    const poor = buildVillagePlan(gadwick());
    const rich = buildVillagePlan(gadwick({ prosperity: 10 }), { previous: poor });
    const added = rich.streets.streets.slice(poor.streets.streets.length);
    for (const lane of added) {
      assert.ok(rich.plots.some(p => p.streetId === lane.id), `${lane.id} earned no plots`);
    }
  });

  it("honours an explicit street lock instead of growing", () => {
    const poor = buildVillagePlan(gadwick());
    const locked = buildVillagePlan(gadwick({ prosperity: 10 }), {
      previous: poor,
      locks: { streets: true }
    });
    assert.deepEqual(locked.streets, poor.streets);
    assert.ok(locked.stats.unbuiltHousing > 0, "a frozen village should report what it cannot house");
  });

  it("can be turned off entirely", () => {
    const poor = buildVillagePlan(gadwick());
    const fixed = buildVillagePlan(gadwick({ prosperity: 10 }), {
      previous: poor,
      params: { growth: false }
    });
    assert.equal(fixed.stats.growth, null);
    assert.deepEqual(fixed.streets, poor.streets);
  });

  it("houses a village across a whole campaign without relocating anyone", () => {
    // The end-to-end shape of the thing: Prosperity climbs, the village grows
    // into its own ruin, and nothing already built ever moves.
    let plan = buildVillagePlan(gadwick());
    const first = plan;
    for (const prosperity of [2, 4, 6, 8, 10]) {
      const next = buildVillagePlan(gadwick({ prosperity }), { previous: plan });
      assert.deepEqual(movedBetween(plan, next, gadwick().institutions.map(i => i.id)), [],
        `buildings moved on the step to Prosperity ${prosperity}`);
      plan = next;
    }
    assert.deepEqual(movedBetween(first, plan, gadwick().institutions.map(i => i.id)), []);
    assert.ok(plan.stats.housing > first.stats.housing * 2, "the village barely grew");
    assert.equal(plan.stats.unbuiltHousing, 0, "villagers went unhoused at the end of the campaign");
  });

  it("still re-rolls the whole village when no previous plan is given", () => {
    const a = buildVillagePlan(gadwick());
    const b = buildVillagePlan(gadwick({ sceneSeed: "gadwick-2" }));
    assert.notDeepEqual(a.streets, b.streets);
  });
});

describe("village plan | forms", () => {
  it("encloses a ruin village with a shell, breaches and rubble", () => {
    const plan = buildVillagePlan(startingVillage(), { params: { form: PLAN_FORMS.RUIN } });
    assert.equal(plan.form, PLAN_FORMS.RUIN);
    assert.ok(plan.boundary.ring.length > 3);
    assert.ok(plan.boundary.gates.length >= 1, "a ruin village needs a way in");
    assert.ok(plan.boundary.wallThickness > 0);
    assert.ok(Array.isArray(plan.boundary.rubble));
    // C:2218 — the settlement is inside a structure, so no farmland sprawl.
    assert.equal(plan.dressing.fields.length, 0);
    assert.equal(plan.dressing.trees.length, 0);
  });

  it("gives an open village farmland and no wall", () => {
    const plan = buildVillagePlan(grownVillage(), { params: { form: PLAN_FORMS.OPEN } });
    assert.equal(plan.form, PLAN_FORMS.OPEN);
    assert.equal(plan.boundary.wallThickness, 0);
    assert.ok(plan.dressing.fields.length > 0, "an open village should have fields");
    assert.ok(plan.dressing.trees.length > 0, "an open village should have trees");
  });

  it("bridges streets only where there is water", () => {
    const dry = buildVillagePlan(grownVillage(), {
      params: { form: PLAN_FORMS.OPEN, open: { water: "none" } }
    });
    assert.equal(dry.streets.bridges.length, 0);
    assert.equal(dry.boundary.water, null);

    // Across seeds at least one river village must produce a crossing.
    const withBridges = ["highfen-1", "highfen-2", "highfen-3", "highfen-4"]
      .map(sceneSeed => buildVillagePlan(grownVillage({ sceneSeed }), {
        params: { form: PLAN_FORMS.OPEN, open: { water: "river" } }
      }))
      .filter(plan => plan.streets.bridges.length > 0);
    assert.ok(withBridges.length > 0, "a river crossing a village should produce a bridge");
  });

  it("puts every bridge on the water it crosses", () => {
    const plan = buildVillagePlan(grownVillage(), { params: { form: PLAN_FORMS.OPEN } });
    for (const bridge of plan.streets.bridges) {
      const d = distToPolyline(bridge.point, plan.boundary.water.path);
      assert.ok(d < 1, `bridge sits ${d.toFixed(2)} from the watercourse`);
    }
  });
});

describe("village plan | plots", () => {
  const plan = buildVillagePlan(grownVillage());

  it("keeps every plot inside the usable boundary", () => {
    for (const plot of plan.plots) {
      for (const p of plot.ring) {
        assert.ok(pointInPolygon(p, plan.boundary.interior), `plot ${plot.id} escapes the boundary`);
      }
    }
  });

  it("never overlaps two plots", () => {
    for (let i = 0; i < plan.plots.length; i++) {
      for (let j = i + 1; j < plan.plots.length; j++) {
        assert.ok(
          !convexRingsOverlap(plan.plots[i].ring, plan.plots[j].ring),
          `${plan.plots[i].id} overlaps ${plan.plots[j].id}`
        );
      }
    }
  });

  it("keeps buildings out of the roadway", () => {
    for (const plot of plan.plots) {
      for (const street of plan.streets.streets) {
        for (const p of plot.ring) {
          assert.ok(
            distToPolyline(p, street.points) >= street.width / 2,
            `plot ${plot.id} sits in ${street.id}`
          );
        }
      }
    }
  });

  it("fronts every plot onto a street that exists", () => {
    const ids = new Set(plan.streets.streets.map(s => s.id));
    for (const plot of plan.plots) assert.ok(ids.has(plot.streetId));
  });

  it("reports why candidate plots were dropped", () => {
    assert.ok(plan.stats.rejectedPlots, "rejection reasons should be reported, not silently swallowed");
    for (const value of Object.values(plan.stats.rejectedPlots)) {
      assert.ok(Number.isInteger(value) && value >= 0);
    }
  });
});

describe("village plan | assignment", () => {
  it("places every institution of a starting village", () => {
    const plan = buildVillagePlan(startingVillage());
    assert.equal(plan.stats.unplacedInstitutions, 0);
    assert.equal(plan.assignment.institutions.length, 6);
  });

  it("gives each institution its own plot", () => {
    const plan = buildVillagePlan(grownVillage());
    const plots = plan.assignment.institutions.map(a => a.plotId);
    assert.equal(new Set(plots).size, plots.length);
  });

  it("resolves an institution to a position", () => {
    const plan = buildVillagePlan(startingVillage());
    const at = planPositionForInstitution(plan, "i0");
    assert.ok(at && Number.isFinite(at.x) && Number.isFinite(at.y));
    assert.equal(planPositionForInstitution(plan, "nope"), null);
  });

  it("resolves housing by index and returns null past the end", () => {
    const plan = buildVillagePlan(startingVillage());
    assert.ok(planPositionForHousing(plan, 0));
    assert.equal(planPositionForHousing(plan, 9999), null);
  });

  it("respects centrality intent: the crypt sits further out than the general store", () => {
    // Averaged over seeds — placement is a soft score, not a guarantee, so a
    // single map can legitimately invert it.
    let cryptFurther = 0;
    const seeds = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
    for (const sceneSeed of seeds) {
      const plan = buildVillagePlan(startingVillage({ sceneSeed }));
      const crypt = plan.assignment.institutions.find(a => a.type === "crypt");
      const store = plan.assignment.institutions.find(a => a.type === "generalStore");
      if (!crypt || !store) continue;
      const square = plan.streets.square.center;
      if (dist(crypt.center, square) > dist(store.center, square)) cryptFurther++;
    }
    assert.ok(cryptFurther >= 6, `crypt was peripheral in only ${cryptFurther}/${seeds.length} villages`);
  });

  it("marks unused plots vacant rather than leaving them unlabelled", () => {
    const plan = buildVillagePlan(startingVillage({ prosperity: -10 }));
    for (const plot of plan.plots) {
      assert.ok(["institution", "housing", "vacant"].includes(plot.use), `plot ${plot.id} has use ${plot.use}`);
    }
  });

  it("reports housing it could not build instead of pretending it did", () => {
    const plan = buildVillagePlan(grownVillage(), { params: { housing: { count: 500 } } });
    assert.ok(plan.stats.unbuiltHousing > 0);
    assert.equal(
      plan.assignment.housing.length + plan.stats.unbuiltHousing,
      plan.assignment.housingTarget
    );
  });
});

describe("village plan | record drives the map", () => {
  it("scales housing with Prosperity", () => {
    const poor = housingCountFor({ prosperity: -8 }, defaultPlanParams());
    const rich = housingCountFor({ prosperity: 10 }, defaultPlanParams());
    assert.ok(rich > poor, `expected more homes at high Prosperity (${poor} -> ${rich})`);
  });

  it("lets an explicit housing count override Prosperity", () => {
    assert.equal(housingCountFor({ prosperity: 10 }, defaultPlanParams({ housing: { count: 9 } })), 9);
  });

  it("counts demand as institutions plus housing", () => {
    const params = defaultPlanParams({ housing: { count: 4 } });
    assert.equal(demandFor(startingVillage(), params), 10);
  });

  it("grows the settlement for a bigger village", () => {
    const small = resolveAutoParams(startingVillage({ prosperity: -5 }), defaultPlanParams());
    const large = resolveAutoParams(grownVillage(), defaultPlanParams());
    assert.ok(large.extent > small.extent, "a thriving village should occupy more ground");
  });

  it("lets an explicit extent pin the size", () => {
    const params = resolveAutoParams(grownVillage(), defaultPlanParams({ extent: 0.5 }));
    assert.equal(params.extent, 0.5);
  });

  it("survives a village with no institutions at all", () => {
    const plan = buildVillagePlan({ name: "Empty", sceneSeed: "e", prosperity: 0, institutions: [] });
    assert.equal(plan.assignment.institutions.length, 0);
    assert.ok(plan.plots.length >= 0);
  });

  it("survives a malformed record", () => {
    const plan = buildVillagePlan({ institutions: [{}, { type: "unknownThing" }] });
    assert.ok(plan.boundary.ring.length > 3);
    assert.equal(plan.stats.unplacedInstitutions, 0);
  });
});

describe("village plan | rendering", () => {
  it("renders both forms to SVG", () => {
    for (const form of [PLAN_FORMS.RUIN, PLAN_FORMS.OPEN]) {
      const svg = renderPlanToSvg(buildVillagePlan(grownVillage(), { params: { form } }));
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(svg, /<\/svg>$/);
      assert.ok(svg.includes('id="buildings"'));
    }
  });

  it("renders every named style", () => {
    const plan = buildVillagePlan(startingVillage());
    for (const name of Object.keys(PLAN_STYLES)) {
      assert.ok(renderPlanToSvg(plan, { style: name }).length > 500);
    }
  });

  it("falls back to a known style for an unknown name", () => {
    const plan = buildVillagePlan(startingVillage());
    assert.ok(renderPlanToSvg(plan, { style: "no-such-style" }).includes("<svg"));
  });

  it("escapes the village name", () => {
    const plan = buildVillagePlan(startingVillage({ name: 'Ash & <Mere>' }));
    const svg = renderPlanToSvg(plan);
    assert.ok(svg.includes("Ash &amp; &lt;Mere&gt;"));
    assert.ok(!svg.includes("<Mere>"));
  });

  it("omits the title when asked", () => {
    const plan = buildVillagePlan(startingVillage());
    assert.ok(!renderPlanToSvg(plan, { showTitle: false }).includes("Ashmere"));
  });
});
