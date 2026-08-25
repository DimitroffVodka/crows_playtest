import "./shim/foundry.mjs";
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { CROWS, effectiveCapacities } from "../module/config.mjs";
import {
  CARRY_CONTAINERS, MAGIC_CONTAINERS, CONTAINER_ORDER,
  DEFAULT_WOUND_SPEED_RULE, WOUND_SPEED_RULES, currentWoundSpeedRule,
  slotsNeeded, quantityOf, stackKindOf, stackLimitFor, canStack,
  collectSlotGrants, emptyLayout, slotAt, layoutFor,
  placeAt, packItem, unpackItem, occupancy, planSwap, occupantsOfSpan,
  wieldRefusal, WIELDING_CONTAINER, WIELD_REFUSALS,
  speedPenaltyFromWounds, applyWoundSpeedPenalty,
  retrieveFromBackpack, magicOverloadFor,
  BURSTING_PURSE_ID, hasBurstingPurse, purseEntriesFor,
  looseCoinSlots, coinSummary, depositCoins, withdrawCoins
} from "../module/helpers/slots.mjs";
import {
  CORPSE_SIZES, isKnownSize, corpseSlotCost, corpseStackLimit,
  harvestDieFor, equipmentSlotCost, corpseCost, canCarryCorpse
} from "../module/helpers/corpses.mjs";

/**
 * T1.2 — the positional slot model.
 *
 * Every test here pins a RULE, not an implementation detail. The whole reason
 * `Layout` is a plain structure is that R:430 (contiguity), R:432 (stacking),
 * R:478 (retrieval) and R:524 (wounds and speed) become assertions about it
 * that need no Foundry at all.
 */

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

let nextId = 0;
function mkItem({
  id, name = "", type = "gear", subtype = "utility", slots = 1, stackMax = 1,
  quantity = 1, weightless = false, stackKind = "", container = null, index = 0,
  purse = null
} = {}) {
  const _id = id ?? `item${String(++nextId).padStart(3, "0")}`;
  const system = { subtype, slots, stackMax, quantity, weightless, stackKind };
  if (container) system.location = { container, index, length: slots };
  if (purse) system.purse = { isPurse: true, held: 0, baseCapacity: CROWS.purseBaseCapacity, ...purse };
  return { id: _id, _id, name, type, system };
}

function mkTrait({ id, name = "Trait", slotGrants = [] } = {}) {
  const _id = id ?? `trait${String(++nextId).padStart(3, "0")}`;
  return { id: _id, _id, name, type: "trait", system: { slotGrants } };
}

/** A purse item as the C:36 starting kit ships it: empty, base capacity. */
const emptyPurse = (id, baseCapacity = CROWS.purseBaseCapacity) =>
  mkItem({ id, name: "Coin Purse", container: "backpack", index: 0,
           purse: { held: 0, baseCapacity } });

function mkActor({ id = "actorA", items = [], woundSlots = [], currency = 0 } = {}) {
  return { id, _id: id, items, system: { woundSlots, currency } };
}

const potion = (id, q = 1) =>
  mkItem({ id, type: "consumable", subtype: "", stackMax: 5, quantity: q });
const padlock = (id) => mkItem({ id, name: "Padlock", stackMax: 3 });
const oilFlask = (id) => mkItem({ id, name: "Oil Flask", stackMax: 2 });

const fresh = () => emptyLayout("actorA", effectiveCapacities());

/* -------------------------------------------------------------------------- */

describe("layout shape", () => {
  test("nine containers — three carry plus six magic, on separate axes (R:426, R:438)", () => {
    assert.deepEqual(CARRY_CONTAINERS, ["hand", "belt", "backpack"]);
    assert.equal(MAGIC_CONTAINERS.length, 6);
    assert.equal(CONTAINER_ORDER.length, 9);
    const l = fresh();
    for (const c of CONTAINER_ORDER) assert.ok(c in l.capacities, `${c} missing from capacities`);
  });

  test("slots are dense and ordered: 2 hand, 4 belt, 10 backpack, 1 each magic", () => {
    const l = fresh();
    assert.equal(l.slots.filter(s => s.container === "hand").length, 2);
    assert.equal(l.slots.filter(s => s.container === "belt").length, 4);
    assert.equal(l.slots.filter(s => s.container === "backpack").length, 10);
    for (const m of MAGIC_CONTAINERS) {
      assert.equal(l.slots.filter(s => s.container === m).length, 1);
    }
    assert.equal(l.slots.length, 2 + 4 + 10 + 6);
    // Dense: index 0..cap-1 with no gaps.
    const backpack = l.slots.filter(s => s.container === "backpack").map(s => s.index);
    assert.deepEqual(backpack, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("layoutFor builds capacity through effectiveCapacities() with the actor's trait grants", () => {
    // C:737 — "an additional belt slot that can only be used to hold alchemy
    // items". If layoutFor read CROWS.carryContainers directly this would still
    // say 4 and the layout would disagree with CrowData.capacities.
    const trait = mkTrait({
      name: "Alchemist's Belt",
      slotGrants: [{ container: "belt", count: 1, restriction: { dimension: "gearSubtype", values: ["tool"] } }]
    });
    const l = layoutFor(mkActor({ items: [trait] }));
    assert.equal(l.capacities.belt, CROWS.carryContainers.belt + 1);
    assert.equal(l.slots.filter(s => s.container === "belt").length, 5);
    // …and it agrees with what CrowData.prepareDerivedData would compute.
    assert.deepEqual(l.capacities, effectiveCapacities(collectSlotGrants(mkActor({ items: [trait] }))));
  });

  test("a backpack grant moves backpack capacity, and there is no backpackSize constant", () => {
    assert.equal(CROWS.backpackSize, undefined);
    const trait = mkTrait({ slotGrants: [{ container: "backpack", count: 2 }] });
    const l = layoutFor(mkActor({ items: [trait] }));
    assert.equal(l.capacities.backpack, 12);
    assert.equal(occupancy(l, "backpack").capacity, 12);
  });
});

describe("contiguity (R:430)", () => {
  test("a span may not cross containers", () => {
    const l = fresh();
    const axe = mkItem({ id: "axe", type: "weapon", subtype: "", slots: 2 });
    const res = placeAt(l, axe, [{ container: "hand", index: 1 }, { container: "belt", index: 0 }]);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "cross-container");
    assert.equal(l.slots.every(s => s.items.length === 0), true, "layout must be untouched on failure");
  });

  test("a span may not skip slots — backpack 2 and 7 is not one item's worth of room", () => {
    const l = fresh();
    const tent = mkItem({ id: "tent", slots: 2 });
    const res = placeAt(l, tent, [{ container: "backpack", index: 2 }, { container: "backpack", index: 7 }]);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "non-contiguous");
  });

  test("packItem cannot spill out of the end of a container", () => {
    // Hand holds 2. A two-slot weapon at index 1 would need hand 1 and hand 2,
    // and hand 2 does not exist — this is how "hand + belt" gets refused.
    const l = fresh();
    const axe = mkItem({ id: "axe", type: "weapon", subtype: "", slots: 2 });
    assert.equal(packItem(l, axe, "hand", 1).reason, "out-of-bounds");
    assert.equal(packItem(l, axe, "hand", 0).ok, true);
  });

  test("a placed multi-slot item fills every slot of its span and shares one spanId", () => {
    const l = fresh();
    const tent = mkItem({ id: "tent", slots: 3 });
    const res = packItem(l, tent, "backpack", 4);
    assert.equal(res.ok, true);
    assert.deepEqual(res.indices, [4, 5, 6]);
    for (const i of [4, 5, 6]) {
      const s = slotAt(l, "backpack", i);
      assert.equal(s.items.length, 1);
      assert.equal(s.items[0].id, "tent");
      assert.equal(s.spanId, "tent");
    }
    assert.equal(slotAt(l, "backpack", 3).spanId, null);
  });

  test("a multi-slot item never shares a slot, even where the kind would stack", () => {
    const l = fresh();
    assert.equal(packItem(l, potion("p1"), "backpack", 5).ok, true);
    const tent = mkItem({ id: "tent", slots: 2 });
    assert.equal(packItem(l, tent, "backpack", 4).reason, "occupied");
  });

  test("unpackItem vacates the whole span", () => {
    const l = fresh();
    const tent = mkItem({ id: "tent", slots: 3 });
    packItem(l, tent, "backpack", 0);
    const res = unpackItem(l, "tent");
    assert.equal(res.ok, true);
    assert.equal(res.vacated.length, 3);
    assert.equal(occupancy(l, "backpack").used, 0);
    assert.equal(l.slots.every(s => s.spanId === null), true);
  });
});

describe("stacking (R:432)", () => {
  test("stack kind falls back to type:subtype:stackMax, so a lock is not an oil flask", () => {
    assert.notEqual(stackKindOf(padlock("a")), stackKindOf(oilFlask("b")));
    assert.equal(stackKindOf(potion("p1")), stackKindOf(potion("p2")));
    // An explicit stackKind reaches CROWS.stackLimits by name.
    const named = mkItem({ id: "n", stackKind: "potion", stackMax: 1 });
    assert.equal(stackKindOf(named), "potion");
    assert.equal(stackLimitFor(named), CROWS.stackLimits.potion);
  });

  test("five different potions share one slot; a sixth does not", () => {
    const l = fresh();
    for (const id of ["p1", "p2", "p3", "p4", "p5"]) {
      assert.equal(packItem(l, potion(id), "backpack", 0).ok, true, `${id} should fit`);
    }
    assert.equal(slotAt(l, "backpack", 0).items.length, 5);
    assert.equal(packItem(l, potion("p6"), "backpack", 0).reason, "stack-full");
  });

  test("quantity counts toward the stack, not just the number of items", () => {
    const l = fresh();
    assert.equal(packItem(l, potion("p1", 3), "backpack", 0).ok, true);
    assert.equal(packItem(l, potion("p2", 2), "backpack", 0).ok, true);
    assert.equal(packItem(l, potion("p3", 1), "backpack", 0).reason, "stack-full");
  });

  test("3 potions + 2 locks do not stack — same KIND only", () => {
    const l = fresh();
    for (const id of ["p1", "p2", "p3"]) packItem(l, potion(id), "backpack", 1);
    assert.equal(packItem(l, padlock("lock1"), "backpack", 1).reason, "stack-kind");
    assert.equal(canStack(potion("p1"), padlock("lock1")), false);
    assert.equal(canStack(potion("p1"), potion("p2")), true);
  });

  test("a kind that does not stack at all is simply occupied", () => {
    const l = fresh();
    const rope = mkItem({ id: "rope", stackMax: 1 });
    assert.equal(packItem(l, rope, "belt", 0).ok, true);
    assert.equal(packItem(l, mkItem({ id: "rope2", stackMax: 1 }), "belt", 0).reason, "occupied");
    assert.equal(canStack(rope, mkItem({ id: "rope2", stackMax: 1 })), false);
  });

  test("hand slots never stack, whatever the kind allows elsewhere", () => {
    const l = fresh();
    assert.equal(packItem(l, potion("p1"), "hand", 0).ok, true);
    assert.equal(packItem(l, potion("p2"), "hand", 0).reason, "hand-no-stack");
    // The same pair stacks fine in the backpack.
    assert.equal(packItem(l, potion("p2"), "backpack", 0).ok, true);
  });
});

describe("weightless items", () => {
  test("occupy no slot and therefore hold no index", () => {
    const l = fresh();
    const feather = mkItem({ id: "feather", weightless: true });
    assert.equal(slotsNeeded(feather), 0);
    const res = packItem(l, feather, "backpack", 0);
    assert.equal(res.ok, true);
    assert.equal(res.weightless, true);
    assert.equal(occupancy(l, "backpack").used, 0);
    assert.deepEqual(l.weightless.map(w => w.id), ["feather"]);
  });
});

describe("wounds occupy slots — they never reduce capacity (R:524)", () => {
  test("capacity is unchanged by wounds; the slot is simply marked", () => {
    const actor = mkActor({ woundSlots: [0, 1, 2] });
    const l = layoutFor(actor);
    const occ = occupancy(l, "backpack");
    assert.equal(occ.capacity, CROWS.carryContainers.backpack, "capacity must not shrink");
    assert.equal(occ.wounded, 3);
    assert.equal(occ.free, 10, "a wound alone does not consume the slot for items");
  });

  test("an item can still go into a wounded slot — that is what the penalty is for", () => {
    const l = layoutFor(mkActor({ woundSlots: [3] }));
    assert.equal(packItem(l, potion("p1"), "backpack", 3).ok, true);
    assert.equal(occupancy(l, "backpack").woundedWithItems, 1);
  });

  test("wound indices at or beyond capacity are not placed — CrowData reports them", () => {
    const l = layoutFor(mkActor({ woundSlots: [9, 10, 42] }));
    assert.equal(occupancy(l, "backpack").wounded, 1);
    assert.equal(slotAt(l, "backpack", 9).wound, true);
  });

  test("wounds are never collapsed to a count — the penalty is positional", () => {
    const l = layoutFor(mkActor({ woundSlots: [0, 1, 2, 3] }));
    packItem(l, potion("p1"), "backpack", 0);
    packItem(l, padlock("lock1"), "backpack", 2);
    packItem(l, oilFlask("oil1"), "backpack", 7);   // item, no wound
    // Four wounds, but only two of them share a slot with an item.
    assert.equal(speedPenaltyFromWounds(l, "wound-and-item"), 2);
  });
});

describe("both wound speed rules", () => {
  const wounded = () => {
    const l = layoutFor(mkActor({ woundSlots: [0, 1, 2, 3, 4] }));
    packItem(l, potion("p1"), "backpack", 0);
    packItem(l, padlock("lock1"), "backpack", 1);
    return l;
  };

  test("the default is reading (c) — wound AND item", () => {
    assert.equal(DEFAULT_WOUND_SPEED_RULE, "wound-and-item");
    assert.deepEqual(WOUND_SPEED_RULES, ["wound-and-item", "wound-only"]);
    assert.equal(currentWoundSpeedRule(), "wound-and-item", "no game object -> default");
    assert.equal(speedPenaltyFromWounds(wounded()), 2);
  });

  test("wound-only counts every wound", () => {
    assert.equal(speedPenaltyFromWounds(wounded(), "wound-only"), 5);
  });

  test("(c) is never harsher than (b) — the penalty is a subset of the wounds", () => {
    const l = wounded();
    assert.ok(speedPenaltyFromWounds(l, "wound-and-item") <= speedPenaltyFromWounds(l, "wound-only"));
  });

  test("only the backpack counts — a wound cannot exist elsewhere and belt clutter is free", () => {
    const l = wounded();
    packItem(l, potion("p9"), "belt", 0);
    assert.equal(speedPenaltyFromWounds(l, "wound-and-item"), 2);
  });

  test("applied after the other speed effects, and floors at 0", () => {
    const l = wounded();
    assert.equal(applyWoundSpeedPenalty(5, l, "wound-and-item"), 3);
    assert.equal(applyWoundSpeedPenalty(2, l, "wound-only"), 0, "must not go negative");
    assert.equal(applyWoundSpeedPenalty(0, l, "wound-only"), 0);
  });
});

describe("retrieval from the backpack (R:478)", () => {
  const buried = () => {
    const l = fresh();
    packItem(l, mkItem({ id: "rope", slots: 2 }), "backpack", 5);   // slot numbers 6 and 7
    packItem(l, potion("p1"), "backpack", 8);                        // slot number 9
    return l;
  };

  test("d10 exactly equal to the lowest slot number succeeds", () => {
    const res = retrieveFromBackpack(buried(), "rope", 6);
    assert.equal(res.ok, true);
    assert.deepEqual(res.slotsMatched, [6]);
    assert.deepEqual(res.slotNumbers, [6, 7]);
  });

  test("one below the lowest slot number fails", () => {
    const res = retrieveFromBackpack(buried(), "rope", 5);
    assert.equal(res.ok, false);
    assert.deepEqual(res.slotsMatched, []);
  });

  test("slot numbers are 1-based — index 8 is slot 9", () => {
    assert.equal(retrieveFromBackpack(buried(), "p1", 8).ok, false);
    assert.equal(retrieveFromBackpack(buried(), "p1", 9).ok, true);
  });

  test("reaching past the span matches every slot the item sits in", () => {
    assert.deepEqual(retrieveFromBackpack(buried(), "rope", 10).slotsMatched, [6, 7]);
  });

  test("an item that is not in the backpack is not a failed roll", () => {
    const l = buried();
    packItem(l, potion("p2"), "belt", 0);
    const res = retrieveFromBackpack(l, "p2", 10);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "not-in-backpack");
  });
});

describe("magic slots (R:438, R:460)", () => {
  test("magic slots are their own axis and do not eat backpack space", () => {
    const ring = mkItem({ id: "ring", subtype: "ring", container: "finger", index: 0 });
    const l = layoutFor(mkActor({ items: [ring] }));
    assert.equal(occupancy(l, "finger").used, 1);
    assert.equal(occupancy(l, "backpack").used, 0);
    assert.equal(l.magicOverload, false);
  });

  test("two items in one magic slot flag magicOverload", () => {
    const items = [
      mkItem({ id: "ring1", subtype: "ring", container: "finger", index: 0 }),
      mkItem({ id: "ring2", subtype: "ring", container: "finger", index: 0 })
    ];
    const l = layoutFor(mkActor({ items }));
    assert.equal(l.magicOverload, true);
    const report = magicOverloadFor(l);
    assert.deepEqual(report.containers, ["finger"]);
    assert.deepEqual(report.slots[0].itemIds, ["ring1", "ring2"]);
  });

  test("packItem still refuses the second one — layoutFor is tolerant, the drop is not", () => {
    const l = fresh();
    assert.equal(packItem(l, mkItem({ id: "ring1", subtype: "ring" }), "finger", 0).ok, true);
    assert.equal(packItem(l, mkItem({ id: "ring2", subtype: "ring" }), "finger", 0).reason, "occupied");
  });
});

describe("coin (C:1917)", () => {
  test("250 loose coins to a slot, rounded up", () => {
    assert.equal(CROWS.coinPerSlot, 250);
    assert.equal(looseCoinSlots(0), 0);
    assert.equal(looseCoinSlots(250), 1);
    assert.equal(looseCoinSlots(251), 2);
    assert.equal(looseCoinSlots(1000), 4);
  });

  test("the C:36 starting kit builds: an empty purse and 3d6 gc loose", () => {
    const l = layoutFor(mkActor({ items: [emptyPurse("purse1")], currency: 11 }));
    assert.equal(l.coin.loose, 11);
    assert.deepEqual(l.coin.purses, [{ id: "purse1", held: 0, cap: 500 }]);
    // The purse is an ITEM and still occupies its slot.
    assert.equal(occupancy(l, "backpack").used, 1);
    const sum = coinSummary(l);
    assert.equal(sum.totalHeld, 11);
    assert.equal(sum.looseSlots, 1);
    assert.equal(sum.overflow, 0);
  });

  test("coinage overflow is reported, never spilled", () => {
    const over = mkItem({ id: "purse1", container: "backpack", purse: { held: 620, baseCapacity: 500 } });
    const sum = coinSummary(layoutFor(mkActor({ items: [over] })));
    assert.equal(sum.overflow, 120);
    assert.equal(sum.purses[0].over, 120);
    assert.equal(sum.purses[0].held, 620, "the coins are still there");
  });
});

describe("Bursting Purse (C:1737) — the frozen allocation", () => {
  const bursting = () => mkTrait({ id: BURSTING_PURSE_ID, name: "Bursting Purse" });

  test("no trait, no bonus", () => {
    const actor = mkActor({ items: [emptyPurse("purse1")] });
    assert.equal(hasBurstingPurse(actor), false);
    assert.deepEqual(purseEntriesFor(actor), [{ id: "purse1", held: 0, cap: 500 }]);
  });

  test("the trait adds purseTraitBonus to exactly one purse", () => {
    const actor = mkActor({ items: [emptyPurse("purse1"), bursting()] });
    assert.equal(hasBurstingPurse(actor), true);
    const purses = purseEntriesFor(actor);
    assert.equal(purses.length, 1);
    assert.equal(purses[0].cap, 500 + CROWS.purseTraitBonus);
  });

  test("with two purses it lands on the greatest baseCapacity — the bonus does not split", () => {
    const actor = mkActor({
      items: [emptyPurse("bbb", 500), emptyPurse("aaa", 750), bursting()]
    });
    const purses = purseEntriesFor(actor);
    assert.equal(purses.find(p => p.id === "aaa").cap, 750 + CROWS.purseTraitBonus);
    assert.equal(purses.find(p => p.id === "bbb").cap, 500);
    assert.equal(purses.reduce((n, p) => n + p.cap, 0), 750 + 500 + CROWS.purseTraitBonus);
  });

  test("ties break on the lowest item id, and document order cannot change the answer", () => {
    const a = () => emptyPurse("aaa", 500);
    const b = () => emptyPurse("zzz", 500);
    const one = purseEntriesFor(mkActor({ items: [b(), a(), bursting()] }));
    const two = purseEntriesFor(mkActor({ items: [a(), b(), bursting()] }));
    assert.equal(one.find(p => p.id === "aaa").cap, 500 + CROWS.purseTraitBonus);
    assert.equal(one.find(p => p.id === "zzz").cap, 500);
    assert.deepEqual(
      [...one].sort((x, y) => x.id < y.id ? -1 : 1),
      [...two].sort((x, y) => x.id < y.id ? -1 : 1),
      "the allocation must not depend on inventory order"
    );
  });

  test("the trait is also recognised by name on a hand-made copy", () => {
    assert.equal(hasBurstingPurse(mkActor({ items: [mkTrait({ id: "homebrew", name: "bursting purse" })] })), true);
  });
});

describe("coins round-trip in and out of a purse", () => {
  test("a base purse", () => {
    const l = layoutFor(mkActor({ items: [emptyPurse("purse1")], currency: 600 }));
    const inn = depositCoins(l, 500, "purse1");
    assert.equal(inn.ok, true);
    assert.deepEqual([l.coin.loose, l.coin.purses[0].held], [100, 500]);
    // It is full at its base capacity.
    const over = depositCoins(l, 100, "purse1");
    assert.equal(over.ok, false);
    assert.equal(over.reason, "purse-full");
    assert.equal(over.moved, 0);

    const out = withdrawCoins(l, 500, "purse1");
    assert.equal(out.ok, true);
    assert.deepEqual([l.coin.loose, l.coin.purses[0].held], [600, 0]);
    assert.equal(coinSummary(l).totalHeld, 600, "no coin is created or lost by a round trip");
  });

  test("a trait-boosted purse takes the extra 500", () => {
    const actor = mkActor({
      items: [emptyPurse("purse1"), mkTrait({ id: BURSTING_PURSE_ID, name: "Bursting Purse" })],
      currency: 1000
    });
    const l = layoutFor(actor);
    assert.equal(l.coin.purses[0].cap, 1000);
    assert.equal(depositCoins(l, 1000, "purse1").ok, true);
    assert.deepEqual([l.coin.loose, l.coin.purses[0].held], [0, 1000]);
    assert.equal(coinSummary(l).overflow, 0);
    assert.equal(withdrawCoins(l, 1000, "purse1").ok, true);
    assert.equal(coinSummary(l).totalHeld, 1000);
  });

  test("you cannot deposit coin you are not carrying", () => {
    const l = layoutFor(mkActor({ items: [emptyPurse("purse1")], currency: 40 }));
    const res = depositCoins(l, 100, "purse1");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "insufficient-loose");
    assert.equal(res.moved, 40);
    assert.equal(l.coin.loose, 0);
  });

  test("withdrawing more than the purse holds moves what is there", () => {
    const l = layoutFor(mkActor({ items: [mkItem({ id: "purse1", container: "backpack", purse: { held: 30 } })] }));
    const res = withdrawCoins(l, 100, "purse1");
    assert.equal(res.ok, false);
    assert.equal(res.reason, "purse-empty");
    assert.equal(res.moved, 30);
    assert.equal(l.coin.loose, 30);
  });
});

describe("stored layouts that do not fit", () => {
  test("an item beyond capacity is reported, not silently dropped", () => {
    const stray = mkItem({ id: "stray", container: "backpack", index: 14 });
    const l = layoutFor(mkActor({ items: [stray] }));
    assert.deepEqual(l.unplaced, [{ id: "stray", reason: "out-of-bounds" }]);
    assert.equal(occupancy(l, "backpack").used, 0);
  });

  test("an unknown container is reported too", () => {
    const stray = mkItem({ id: "stray", container: "saddlebag", index: 0 });
    assert.equal(layoutFor(mkActor({ items: [stray] })).unplaced[0].reason, "unknown-container");
  });

  test("the item's own `slots` wins over a stale location.length", () => {
    const tent = mkItem({ id: "tent", slots: 3, container: "backpack", index: 0 });
    tent.system.location.length = 1;    // stale mirror written by an old drop
    const l = layoutFor(mkActor({ items: [tent] }));
    assert.equal(occupancy(l, "backpack").used, 3);
  });
});

describe("corpses (R:484-486)", () => {
  test("slot cost by size", () => {
    assert.deepEqual(CORPSE_SIZES, ["tiny", "small", "medium", "large", "huge", "holyShit"]);
    assert.equal(corpseSlotCost("tiny"), 1);
    assert.equal(corpseSlotCost("medium"), 4);
    assert.equal(corpseSlotCost("holyShit"), 32);
    assert.equal(isKnownSize("gargantuan"), false);
    assert.equal(corpseSlotCost("gargantuan"), 0);
  });

  test("only tiny corpses stack, three to a slot", () => {
    assert.equal(corpseStackLimit("tiny"), 3);
    for (const s of ["small", "medium", "large", "huge", "holyShit"]) {
      assert.equal(corpseStackLimit(s), 1, `${s} must not stack`);
    }
    assert.equal(corpseCost({ size: "tiny", count: 3 }).slots, 1);
    assert.equal(corpseCost({ size: "tiny", count: 4 }).slots, 2);
    assert.equal(corpseCost({ size: "medium", count: 2 }).slots, 8);
  });

  test("the corpse's own equipment is carried too", () => {
    const kit = [mkItem({ id: "mail", type: "armor", subtype: "", slots: 2 }),
                 mkItem({ id: "sword", type: "weapon", subtype: "", slots: 1 }),
                 mkItem({ id: "charm", weightless: true })];
    assert.equal(equipmentSlotCost(kit), 3);
    const cost = corpseCost({ size: "medium", equipment: kit });
    assert.equal(cost.bodySlots, 4);
    assert.equal(cost.equipmentSlots, 3);
    assert.equal(cost.slots, 7);
    assert.equal(corpseCost({ size: "medium", equipment: 3 }).slots, 7, "a plain number works too");
  });

  test("harvest dice scale with size (R:652)", () => {
    assert.equal(harvestDieFor("medium"), "1d6");
    assert.equal(harvestDieFor("large"), "2d6");
    assert.equal(harvestDieFor("holyShit"), "4d6");
    assert.equal(harvestDieFor("nonsense"), null);
  });

  test("fitting a corpse is measured against free slots in a real layout", () => {
    const l = fresh();
    assert.equal(canCarryCorpse(l, { size: "medium" }).ok, true);
    assert.equal(canCarryCorpse(l, { size: "huge" }).ok, false, "16 slots do not fit in 10");
    assert.equal(canCarryCorpse(l, { size: "huge" }).reason, "not-enough-slots");
    // Fill 7 of the 10 backpack slots and the Medium body no longer fits.
    packItem(l, mkItem({ id: "bulk", slots: 7 }), "backpack", 0);
    const res = canCarryCorpse(l, { size: "medium" });
    assert.equal(res.ok, false);
    assert.equal(res.free, 3);
    assert.equal(res.needed, 4);
  });

  test("a wound does not cost corpse space — it costs speed", () => {
    const l = layoutFor(mkActor({ woundSlots: [0, 1, 2, 3, 4, 5] }));
    assert.equal(canCarryCorpse(l, { size: "medium" }).ok, true);
  });

  test("an unknown size is refused rather than priced at zero", () => {
    const res = canCarryCorpse(fresh(), { size: "gargantuan" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "unknown-size");
  });
});

describe("misc invariants", () => {
  test("quantityOf and slotsNeeded default sanely on junk", () => {
    assert.equal(slotsNeeded({}), 1);
    assert.equal(slotsNeeded({ system: { slots: "x" } }), 1);
    assert.equal(quantityOf({}), 1);
    assert.equal(quantityOf({ system: { quantity: 0 } }), 1);
  });

  test("a layout with no actor still has the full shape", () => {
    const l = layoutFor(undefined);
    assert.equal(l.actorId, "");
    assert.equal(l.slots.length, 22);
    assert.deepEqual(l.coin, { loose: 0, purses: [] });
  });
});

/* -------------------------------------------------------------------------- */
/*  Swapping two cards                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Dropping a card onto an occupied slot trades the two rather than refusing.
 *
 * The rule these pin is that a swap is only offered when BOTH halves are legal.
 * The return trip is the one that fails, and it fails silently if you only
 * check the outbound move — so every test here that expects a refusal is
 * refusing on the way BACK.
 */
describe("planSwap", () => {
  const at = (id, container, index, slots = 1) =>
    mkItem({ id, slots, container, index, stackMax: 1 });

  test("two one-slot cards trade places", () => {
    const a = at("a", "backpack", 0);
    const b = at("b", "backpack", 3);
    const l = layoutFor(mkActor({ items: [a, b] }));

    const res = planSwap(l, a, b, { container: "backpack", index: 3 }, a.system.location);
    assert.equal(res.ok, true);
    assert.deepEqual(res.moving, { container: "backpack", index: 3, length: 1 });
    assert.deepEqual(res.occupant, { container: "backpack", index: 0, length: 1 });
  });

  test("swaps across containers", () => {
    const a = at("a", "belt", 1);
    const b = at("b", "backpack", 7);
    const l = layoutFor(mkActor({ items: [a, b] }));

    const res = planSwap(l, a, b, { container: "backpack", index: 7 }, a.system.location);
    assert.equal(res.ok, true);
    assert.equal(res.moving.container, "backpack");
    assert.equal(res.occupant.container, "belt");
  });

  test("refuses when the occupant cannot fit the origin — the return trip is what fails", () => {
    // A two-slot tent at backpack 0-1, a one-slot torch at 5, and 6 taken.
    // The torch reaches 0 fine; the tent has nowhere contiguous to go back to.
    const tent = at("tent", "backpack", 0, 2);
    const torch = at("torch", "backpack", 5);
    const blocker = at("blocker", "backpack", 6);
    const l = layoutFor(mkActor({ items: [tent, torch, blocker] }));

    const res = planSwap(l, torch, tent, { container: "backpack", index: 0 }, torch.system.location);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "swap-back-occupied");
  });

  test("the same pair DOES swap when the origin can hold the wider card", () => {
    const tent = at("tent", "backpack", 0, 2);
    const torch = at("torch", "backpack", 5);
    const l = layoutFor(mkActor({ items: [tent, torch] }));

    const res = planSwap(l, torch, tent, { container: "backpack", index: 0 }, torch.system.location);
    assert.equal(res.ok, true);
    assert.deepEqual(res.occupant, { container: "backpack", index: 5, length: 2 });
  });

  test("refuses a card with no recorded origin — there is nowhere to send the occupant", () => {
    const a = mkItem({ id: "a" });          // never placed
    const b = at("b", "backpack", 3);
    const l = layoutFor(mkActor({ items: [b] }));

    assert.equal(planSwap(l, a, b, { container: "backpack", index: 3 }, null).reason, "no-origin");
    assert.equal(planSwap(l, a, b, { container: "backpack", index: 3 }, a.system.location).reason,
                 "no-origin");
  });

  test("refuses to swap a card with itself", () => {
    const a = at("a", "backpack", 0);
    const l = layoutFor(mkActor({ items: [a] }));
    assert.equal(planSwap(l, a, a, { container: "backpack", index: 0 }, a.system.location).reason,
                 "same-item");
  });

  test("does not mutate the layout it was given — a rejected swap must leave nothing moved", () => {
    const tent = at("tent", "backpack", 0, 2);
    const torch = at("torch", "backpack", 5);
    const blocker = at("blocker", "backpack", 6);
    const l = layoutFor(mkActor({ items: [tent, torch, blocker] }));
    const before = structuredClone(l);

    planSwap(l, torch, tent, { container: "backpack", index: 0 }, torch.system.location);
    assert.deepEqual(l, before);
  });
});

describe("occupantsOfSpan", () => {
  const at = (id, container, index, slots = 1) =>
    mkItem({ id, slots, container, index, stackMax: 1 });

  test("reports the span owner from a continuation slot", () => {
    // The tent's second slot holds an entry for the tent; landing on backpack 1
    // must name the tent, not report an empty slot.
    const tent = at("tent", "backpack", 0, 2);
    const l = layoutFor(mkActor({ items: [tent] }));
    assert.deepEqual(occupantsOfSpan(l, at("x", "backpack", 4), "backpack", 1), ["tent"]);
  });

  test("never reports the moving card itself, even when its span overlaps the target", () => {
    // Sliding a two-slot card one slot along overlaps its own second slot.
    const tent = at("tent", "backpack", 0, 2);
    const l = layoutFor(mkActor({ items: [tent] }));
    unpackItem(l, "tent");
    assert.deepEqual(occupantsOfSpan(l, tent, "backpack", 1), []);
  });

  test("reports both when a wide card would land across two different cards", () => {
    // Two occupants means no single partner to trade with — the sheet refuses.
    const a = at("a", "backpack", 2);
    const b = at("b", "backpack", 3);
    const l = layoutFor(mkActor({ items: [a, b] }));
    const wide = at("wide", "backpack", 8, 2);
    assert.deepEqual(occupantsOfSpan(l, wide, "backpack", 2).sort(), ["a", "b"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Wielding                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * R:392 — "to use any other item, including a weapon... the item must first be
 * placed in a hand slot. Items in hand slots are equipped and being wielded."
 * R:762 — an attack "must be made with a weapon or spellbook you are wielding."
 *
 * The sheet shipped a live Attack button on BELT weapons, which handed out a
 * free Draw From Belt maneuver every round. These pin the rule so it cannot
 * drift back.
 */
describe("wieldRefusal (R:392, R:762)", () => {
  const inSlot = (container, index = 0) =>
    mkItem({ id: `w-${container}`, type: "weapon", container, index });

  test("only the hand container wields", () => {
    assert.equal(WIELDING_CONTAINER, "hand");
    assert.equal(wieldRefusal(inSlot("hand")), null);
  });

  test("a belt weapon is NOT wielded — it is one maneuver away (R:396)", () => {
    assert.equal(wieldRefusal(inSlot("belt")), "in-belt");
  });

  test("a backpack weapon is not wielded", () => {
    assert.equal(wieldRefusal(inSlot("backpack")), "in-backpack");
  });

  test("a worn magic item is exempt from R:392 but still is not held", () => {
    for (const c of MAGIC_CONTAINERS) assert.equal(wieldRefusal(inSlot(c)), "worn");
  });

  test("an item in no slot at all reports unplaced, and nothing throws on junk", () => {
    assert.equal(wieldRefusal(mkItem({ id: "loose", type: "weapon" })), "unplaced");
    assert.equal(wieldRefusal(null), "unplaced");
    assert.equal(wieldRefusal({}), "unplaced");
    assert.equal(wieldRefusal({ system: {} }), "unplaced");
  });

  test("every refusal token has a message in en.json", async () => {
    // The sheet builds `CROWS.Sheet.Crow.attackBlocked.${token}`; a token with
    // no message renders the raw key on a card.
    const lang = JSON.parse(
      await (await import("node:fs/promises")).readFile("lang/en.json", "utf8"));
    const tokens = WIELD_REFUSALS;
    const missing = tokens.filter(k => !(`CROWS.Sheet.Crow.attackBlocked.${k}` in lang));
    assert.deepEqual(missing, []);
  });
});
