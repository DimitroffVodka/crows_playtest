import "./shim/foundry.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

import { CROWS } from "../module/config.mjs";
import { allocateDamage } from "../module/helpers/damage.mjs";
import {
  PET_RIDER_SLOTS,
  TAMING_FOLLOW_SECONDS,
  PET_SHOP_PRICES,
  PET_FEED_MULTIPLIERS,
  PET_BARDING,
  isHumanOwner,
  isAnimal,
  isOwnedPet,
  petOwnerUpdate,
  petPurchaseQuote,
  planPetPurchase,
  planPetTransfer,
  canAttemptTaming,
  planTamingResult,
  rollTamingTest,
  planBondingCompletion,
  planExpiredFollow,
  animalFeedRequired,
  planPetRestFood,
  petBardingQuote,
  effectivePetSlotCapacity,
  petSlotBudget,
  canRidePet,
  planMountPet,
  planDismountPet,
  petCombatProfile,
  planPetCommandResult,
  rollPetCommandTest,
  applyPetPlan
} from "../module/helpers/pets.mjs";

const MONSTER_DIR = new URL("../src/packs/crows-monsters/", import.meta.url).pathname;

function scalar(source, key) {
  const match = source.match(new RegExp(`^  ${key}:\\s*([^\\n#]+)`, "m"));
  return match?.[1]?.trim() ?? null;
}

function shippedMonsters() {
  return readdirSync(MONSTER_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => {
      const source = readFileSync(join(MONSTER_DIR, file), "utf8");
      const power = scalar(source, "power");
      const slots = scalar(source, "slots");
      return {
        file: basename(file),
        name: source.match(/^name:\s*([^\n#]+)/m)?.[1]?.trim() ?? file,
        type: "monster",
        system: {
          creatureType: scalar(source, "creatureType"),
          size: scalar(source, "size"),
          power: power === null ? null : Number(power),
          slots: slots === null ? null : Number(slots),
          pet: {}
        }
      };
    });
}

function crow(uuid = "Actor.crow1", size = "medium") {
  return { uuid, type: "crow", name: "Crow", system: { size } };
}

function human(uuid = "Actor.human1", size = "medium") {
  return { uuid, type: "monster", name: "Human", system: { creatureType: "human", size } };
}

function animal({
  uuid = "Actor.pet1",
  ownerUuid = "",
  prospectiveOwnerUuid = "",
  followsUntil = 0,
  riderUuid = "",
  size = "large",
  power = 4,
  slots = 10
} = {}) {
  return {
    uuid,
    type: "monster",
    name: "Horse",
    system: {
      creatureType: "animal",
      size,
      power,
      slots,
      pet: { ownerUuid, prospectiveOwnerUuid, followsUntil, riderUuid, lastFedAt: 0 }
    }
  };
}

const committed = (tier) => ({ state: "committed", tier });

describe("pet identity and ownership", () => {
  test("only crows and explicitly Human creatures are human owners", () => {
    assert.equal(isHumanOwner(crow()), true);
    assert.equal(isHumanOwner(human()), true);
    assert.equal(isHumanOwner(animal()), false);
    assert.equal(isAnimal(animal()), true);
  });

  test("pet-ness is animal + one owner UUID, not a second stored boolean", () => {
    assert.equal(isOwnedPet(animal()), false);
    assert.equal(isOwnedPet(animal({ ownerUuid: "Actor.crow1" })), true);
    assert.equal(isOwnedPet({ type: "monster", system: { creatureType: "blood", pet: { ownerUuid: "Actor.crow1" } } }), false);
  });

  test("purchase assigns the exact one-owner update and uses the printed price", () => {
    const plan = planPetPurchase(animal({ power: 4 }), crow());
    assert.equal(plan.ok, true);
    assert.equal(plan.price, 500);
    assert.deepEqual(plan.update, petOwnerUpdate("Actor.crow1"));
  });

  test("transfer requires the current giver and a willing human", () => {
    const pet = animal({ ownerUuid: "Actor.crow1", riderUuid: "Actor.crow1" });
    assert.equal(planPetTransfer(pet, {
      giverUuid: "Actor.someoneElse", newOwner: human(), willing: true
    }).reason, "giver-not-owner");
    assert.equal(planPetTransfer(pet, {
      giverUuid: "Actor.crow1", newOwner: human(), willing: false
    }).reason, "new-owner-not-willing");

    const plan = planPetTransfer(pet, {
      giverUuid: "Actor.crow1", newOwner: human(), willing: true
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.update["system.pet.ownerUuid"], "Actor.human1");
    assert.equal(plan.update["system.pet.riderUuid"], "", "the former owner is dismounted");
  });

  test("a successful plan persists only through the injected document", async () => {
    const writes = [];
    const pet = animal();
    pet.update = async (update) => writes.push(update);
    const plan = planPetPurchase(pet, crow());
    assert.equal((await applyPetPlan(pet, plan)).ok, true);
    assert.deepEqual(writes, [plan.update]);
  });
});

describe("Pet Shop and the real shipped animal corpus", () => {
  test("the exact power 0-10 table is pinned and never extrapolated", () => {
    assert.deepEqual(Object.keys(PET_SHOP_PRICES).map(Number), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(Object.values(PET_SHOP_PRICES), [5, 10, 50, 100, 500, 1000, 2500, 5000, 7500, 10000, 15000]);
    assert.equal(petPurchaseQuote(10).price, 15000);
    assert.equal(petPurchaseQuote(11).reason, "unpriced-power");
    assert.equal(petPurchaseQuote(-1).reason, "invalid-power");
    assert.equal(petPurchaseQuote(null).reason, "invalid-power", "missing power is not silently power 0");
    assert.equal(petPurchaseQuote("").reason, "invalid-power", "blank power is not silently power 0");
  });

  test("all 7/7 shipped animals have usable size and power; 3/7 still have zero slots", () => {
    const monsters = shippedMonsters();
    assert.equal(monsters.length, 11, "guard: the real shipped monster corpus was loaded");
    const animals = monsters.filter(isAnimal);
    assert.equal(animals.length, 7, "guard: the real animal subset was loaded");

    for (const pet of animals) {
      assert.ok(CROWS.sizes.includes(pet.system.size), `${pet.name}: invalid size ${pet.system.size}`);
      assert.ok(Number.isInteger(pet.system.power) && pet.system.power >= 0,
        `${pet.name}: power is missing or invalid`);
      assert.equal(petPurchaseQuote(pet.system.power).ok, true, `${pet.name}: unusable power ${pet.system.power}`);
      assert.ok(Number.isInteger(pet.system.slots) && pet.system.slots >= 0,
        `${pet.name}: slots are missing or invalid`);
    }

    assert.deepEqual(
      animals.filter((pet) => pet.system.slots === 0).map((pet) => pet.name).sort(),
      ["Bear", "Rat", "Wolf"]
    );
  });
});

describe("taming and bonding", () => {
  test("only a friendly ownerless animal can be tamed", () => {
    assert.equal(canAttemptTaming(animal(), crow()).reason, "animal-not-friendly");
    assert.equal(canAttemptTaming(animal({ ownerUuid: "Actor.other" }), crow(), { friendly: true }).reason, "already-owned");
    assert.equal(canAttemptTaming(animal(), crow(), { friendly: true }).ok, true);
  });

  test("a pending test never creates a confident early ownership answer", () => {
    const plan = planTamingResult({ state: "pending", tier: 3 }, {
      animal: animal(), human: crow(), friendly: true, now: 100
    });
    assert.equal(plan.reason, "test-pending");
    assert.equal(plan.update, null);
  });

  test("the three printed tiers map to refuse, 24-hour following, and ownership", () => {
    const context = { animal: animal(), human: crow(), friendly: true, now: 1000 };
    assert.deepEqual(planTamingResult(committed(1), context), {
      ok: true, tier: 1, outcome: "refused", update: null
    });

    const tier2 = planTamingResult(committed(2), context);
    assert.equal(tier2.outcome, "follows-at-distance");
    assert.equal(tier2.heedsCommands, false);
    assert.equal(tier2.followsForSeconds, TAMING_FOLLOW_SECONDS);
    assert.equal(tier2.update["system.pet.prospectiveOwnerUuid"], "Actor.crow1");
    assert.equal(tier2.update["system.pet.followsUntil"], 1000 + 86_400);

    const tier3 = planTamingResult(committed(3), context);
    assert.equal(tier3.outcome, "owned");
    assert.equal(tier3.update["system.pet.ownerUuid"], "Actor.crow1");
  });

  test("the roll wrapper injects the existing 2d10+Mind pipeline rather than touching Roll", async () => {
    let seen = null;
    const result = await rollTamingTest(animal(), crow(), {
      friendly: true,
      now: 500,
      edges: [{ key: "buddy" }],
      roll: async (options) => {
        seen = options;
        return committed(3);
      }
    });
    assert.equal(seen.actor.uuid, "Actor.crow1");
    assert.equal(seen.characteristic, "mind");
    assert.deepEqual(seen.edges, [{ key: "buddy" }]);
    assert.equal(result.resolution.outcome, "owned");
  });

  test("the roll wrapper leaves an expertise-pending result unresolved", async () => {
    const result = await rollTamingTest(animal(), crow(), {
      friendly: true,
      roll: async () => ({ state: "pending", tier: 2 })
    });
    assert.equal(result.pending, true);
    assert.equal(result.resolution, null);
  });

  test("bonding lands only when the rest finishes and before following expires", () => {
    const pet = animal({ prospectiveOwnerUuid: "Actor.crow1", followsUntil: 1000 });
    const waiting = planBondingCompletion(pet, crow(), { now: 900, restCompleted: false });
    assert.equal(waiting.outcome, "waiting-for-rest");
    assert.equal(waiting.update, null);

    const done = planBondingCompletion(pet, crow(), { now: 900, restCompleted: true });
    assert.equal(done.outcome, "owned");
    assert.equal(done.update["system.pet.ownerUuid"], "Actor.crow1");
    assert.equal(planBondingCompletion(pet, crow(), { now: 1001, restCompleted: true }).reason, "following-expired");
  });

  test("expired following clears both pending fields, never an existing owner", () => {
    const pet = animal({ prospectiveOwnerUuid: "Actor.crow1", followsUntil: 1000 });
    assert.equal(planExpiredFollow(pet, { now: 1000 }).expired, false);
    assert.deepEqual(planExpiredFollow(pet, { now: 1001 }).update, {
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0
    });
    assert.equal(planExpiredFollow(animal({ ownerUuid: "Actor.crow1", followsUntil: 1000 }), { now: 1001 }).expired, false);
  });
});

describe("feeding, barding, riding, and slots", () => {
  test("all six config sizes have feed rules, including Holy Shit x8", () => {
    assert.deepEqual(Object.keys(PET_FEED_MULTIPLIERS), CROWS.sizes);
    assert.deepEqual(CROWS.sizes.map((size) => animalFeedRequired(size)), [1, 1, 1, 2, 4, 8]);
    assert.equal(PET_FEED_MULTIPLIERS.holyShit, 8);
  });

  test("foraging costs no feed; dungeon rest needs the full size-scaled amount", () => {
    const forage = planPetRestFood({ size: "holyShit", canForage: true, availableFeed: 0, now: 50 });
    assert.equal(forage.canGainRestBenefits, true);
    assert.equal(forage.feedConsumed, 0);
    assert.equal(forage.update["system.pet.lastFedAt"], 50);

    const short = planPetRestFood({ size: "large", availableFeed: 1 });
    assert.equal(short.canGainRestBenefits, false);
    assert.equal(short.shortage, 1);
    assert.equal(short.update, null);

    const fed = planPetRestFood({ size: "large", availableFeed: 2 });
    assert.equal(fed.canGainRestBenefits, true);
    assert.equal(fed.feedConsumed, 2);
  });

  test("barding quotes exactly Medium/Large/Huge and invents no missing row", () => {
    assert.deepEqual(Object.keys(PET_BARDING), ["medium", "large", "huge"]);
    assert.deepEqual(petBardingQuote("medium", { baseCost: 50, baseSlots: 2 }), {
      ok: true, size: "medium", priceMultiplier: 2, addedSlots: 0, price: 100, slots: 2
    });
    assert.equal(petBardingQuote("large", { baseCost: 50, baseSlots: 2 }).price, 200);
    assert.equal(petBardingQuote("large", { baseCost: 50, baseSlots: 2 }).slots, 4);
    assert.equal(petBardingQuote("huge", { baseCost: 50, baseSlots: 2 }).slots, 6);
    assert.equal(petBardingQuote("holyShit", { baseCost: 50, baseSlots: 2 }).reason, "unpriced-size");
    assert.equal(petBardingQuote("tiny", { baseCost: 50, baseSlots: 2 }).reason, "unpriced-size");
    assert.equal(petBardingQuote("medium", { baseCost: null, baseSlots: 2 }).reason, "invalid-base-cost");
    assert.equal(petBardingQuote("medium", { baseCost: 50, baseSlots: "" }).reason, "invalid-base-slots");
  });

  test("pet capacity reuses shared positive-grant semantics and occupancy is one budget", () => {
    assert.equal(effectivePetSlotCapacity(2, [{ container: "backpack", count: 2 }]), 4);
    assert.equal(effectivePetSlotCapacity(2, [
      { container: "backpack", count: -4 },
      { container: "belt", count: 3 },
      { container: "backpack", count: 1.5 }
    ]), 2, "bad or non-backpack grants do not alter pet capacity");

    const budget = petSlotBudget({
      baseSlots: 10,
      riderMounted: true,
      barding: [{ size: "large", baseCost: 50, baseSlots: 2 }],
      otherOccupiedSlots: 1
    });
    assert.equal(budget.riderSlots, PET_RIDER_SLOTS);
    assert.equal(budget.bardingSlots, 4);
    assert.equal(budget.occupied, 11);
    assert.equal(budget.free, 0);
    assert.equal(budget.overfilled, 1);
  });

  test("only the owner can ride, and the pet must be at least one size larger", () => {
    const pet = animal({ ownerUuid: "Actor.crow1", size: "large" });
    assert.equal(canRidePet(pet, crow()).ok, true);
    assert.equal(canRidePet(animal({ ownerUuid: "Actor.crow1", size: "medium" }), crow()).reason, "pet-not-larger");
    assert.equal(canRidePet(pet, crow("Actor.other")).reason, "rider-not-owner");

    const mounted = planMountPet(pet, crow());
    assert.equal(mounted.update["system.pet.riderUuid"], "Actor.crow1");
    const mountedPet = animal({ ownerUuid: "Actor.crow1", riderUuid: "Actor.crow1" });
    assert.equal(planDismountPet(mountedPet, crow()).update["system.pet.riderUuid"], "");
  });

  test("pet wounds stay on the existing wound allocator; rider/barding do not shrink wound capacity", () => {
    const budget = petSlotBudget({
      baseSlots: 2,
      riderMounted: true,
      barding: [{ size: "medium", baseSlots: 2 }]
    });
    assert.equal(budget.capacity, 2);
    const damage = allocateDamage({
      amount: 2,
      stamina: 0,
      woundCapacity: budget.capacity,
      woundsHeld: 0,
      takesWounds: true
    });
    assert.equal(damage.wounds.gained, 2);
    assert.equal(damage.becameDefeated, true);
  });
});

describe("pets and summoned creatures in combat", () => {
  const summoned = (kind) => ({ target: { count: 1, kind, summoned: true, text: `1 Summoned ${kind}` } });

  test("only summoned creatures act as pets; summoned objects never do", () => {
    assert.deepEqual(petCombatProfile({ spellbookSystem: summoned("object") }), {
      actsAsPet: false,
      ownedPet: false,
      summonedCreature: false,
      requiresCommandTest: false
    });
    assert.deepEqual(petCombatProfile({ spellbookSystem: summoned("creature") }), {
      actsAsPet: true,
      ownedPet: false,
      summonedCreature: true,
      requiresCommandTest: false
    });
  });

  test("owned pets test dangerous commands; tier 2 follows and becomes weakened", () => {
    const profile = petCombatProfile({ animal: animal({ ownerUuid: "Actor.crow1" }) });
    assert.equal(profile.requiresCommandTest, true);
    assert.deepEqual(planPetCommandResult(committed(1), profile), {
      ok: true, tier: 1, outcome: "refuses-command", weakened: false, testRequired: true
    });
    assert.equal(planPetCommandResult(committed(2), profile).weakened, true);
    assert.equal(planPetCommandResult(committed(3), profile).weakened, false);
  });

  test("summons and ordinary owned-pet commands skip the test", async () => {
    let rolls = 0;
    const fakeRoll = async () => { rolls += 1; return committed(1); };
    const summonResult = await rollPetCommandTest(null, crow(), {
      spellbookSystem: summoned("creature"),
      roll: fakeRoll
    });
    assert.equal(summonResult.resolution.outcome, "follows-command");

    const ordinary = await rollPetCommandTest(animal({ ownerUuid: "Actor.crow1" }), crow(), {
      needsTest: false,
      roll: fakeRoll
    });
    assert.equal(ordinary.resolution.outcome, "follows-command");
    assert.equal(rolls, 0);
  });

  test("a complex command routes through the same injected 2d10+Mind pipeline", async () => {
    let seen = null;
    const result = await rollPetCommandTest(animal({ ownerUuid: "Actor.crow1" }), crow(), {
      roll: async (options) => {
        seen = options;
        return committed(2);
      }
    });
    assert.equal(seen.characteristic, "mind");
    assert.equal(seen.actor.uuid, "Actor.crow1");
    assert.equal(result.resolution.weakened, true);
  });
});
