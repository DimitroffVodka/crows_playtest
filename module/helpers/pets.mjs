/**
 * Pets — C:2429-2486 and R:1043-1061.
 *
 * This module is deliberately split at the document boundary. Every rules
 * decision returns a plain plan and is corpus-testable without Foundry. The
 * caller may persist a successful plan with `applyPetPlan`; no helper reaches
 * for `game`, `CONFIG`, `ui`, `Hooks`, or `Roll` at import time.
 *
 * The source book calls the largest size "Holy Shit" (C:2445). The system key
 * is `holyShit` (`CROWS.sizes`); do not rename or sanitise either spelling.
 */

import { CROWS, effectiveCapacities } from "../config.mjs";
import { rollTest } from "./roll.mjs";
import { parseTarget, summonBehaviour } from "./spellcasting.mjs";

export const PET_RIDER_SLOTS = 6;                         // C:2443
export const TAMING_FOLLOW_SECONDS = 24 * 60 * 60;        // C:2437
export const PET_FEED_DAY_SECONDS = 24 * 60 * 60;         // C:2445

/** Exact Pet Shop rows. Power is unbounded in MonsterData; the table is not. */
export const PET_SHOP_PRICES = Object.freeze({
  0: 5,
  1: 10,
  2: 50,
  3: 100,
  4: 500,
  5: 1000,
  6: 2500,
  7: 5000,
  8: 7500,
  9: 10000,
  10: 15000
});

/** Medium and smaller eat one unit; the printed multipliers start at Large. */
export const PET_FEED_MULTIPLIERS = Object.freeze({
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 4,
  holyShit: 8
});

/**
 * Exact barding table. Tiny, Small, and Holy Shit are deliberately absent:
 * the provisional playtest table gives no price or slot rule for them.
 */
export const PET_BARDING = Object.freeze({
  medium: Object.freeze({ priceMultiplier: 2, addedSlots: 0 }),
  large: Object.freeze({ priceMultiplier: 4, addedSlots: 2 }),
  huge: Object.freeze({ priceMultiplier: 8, addedSlots: 4 })
});

const systemOf = (actor) => actor?.system ?? {};
const petDataOf = (actor) => systemOf(actor).pet ?? {};
const uuidOf = (actor) => String(actor?.uuid ?? "").trim();

// `Number(null)` and `Number("")` are both 0. That coercion would silently
// price a missing Pet Shop power as the valid power-0 row, or missing armor as
// free zero-slot barding — the migration's recurring confident-wrong shape.
const explicitNumber = (value) => {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "string" && !value.trim()) return Number.NaN;
  return Number(value);
};

const count = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const time = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const failure = (reason, extra = {}) => ({ ok: false, reason, update: null, ...extra });

/** A PC crow or a creature stat block explicitly typed Human. */
export function isHumanOwner(actor) {
  return actor?.type === "crow"
    || (actor?.type === "monster" && systemOf(actor).creatureType === "human");
}

export function isAnimal(actor) {
  return actor?.type === "monster" && systemOf(actor).creatureType === "animal";
}

/** A pet is derived from one animal + one owner UUID; no second boolean drifts. */
export function isOwnedPet(actor) {
  return isAnimal(actor) && String(petDataOf(actor).ownerUuid ?? "").trim().length > 0;
}

function newOwnerGate(animal, human) {
  if (!isAnimal(animal)) return failure("not-an-animal");
  if (!isHumanOwner(human)) return failure("owner-not-human");
  if (!uuidOf(human)) return failure("owner-missing-uuid");
  return { ok: true };
}

/** The one write shape used by purchase, taming, bonding, and transfer. */
export function petOwnerUpdate(ownerUuid) {
  return {
    "system.pet.ownerUuid": String(ownerUuid ?? "").trim(),
    "system.pet.prospectiveOwnerUuid": "",
    "system.pet.followsUntil": 0,
    // A transfer never leaves the old owner mounted on the pet.
    "system.pet.riderUuid": ""
  };
}

/** C:2464-2486. Unknown powers stay unpriced rather than being interpolated. */
export function petPurchaseQuote(power) {
  const n = explicitNumber(power);
  if (!Number.isInteger(n) || n < 0) return failure("invalid-power", { power: null, price: null });
  if (!Object.hasOwn(PET_SHOP_PRICES, n)) {
    return failure("unpriced-power", { power: n, price: null });
  }
  return { ok: true, power: n, price: PET_SHOP_PRICES[n] };
}

/** Buying an ownerless animal makes the buyer its owner (C:2431). */
export function planPetPurchase(animal, buyer) {
  const gate = newOwnerGate(animal, buyer);
  if (!gate.ok) return gate;
  if (isOwnedPet(animal)) return failure("already-owned");
  const quote = petPurchaseQuote(systemOf(animal).power);
  if (!quote.ok) return quote;
  return {
    ok: true,
    outcome: "purchased",
    price: quote.price,
    power: quote.power,
    update: petOwnerUpdate(uuidOf(buyer))
  };
}

/**
 * C:2431. The current owner must be the giver and the new human must be willing.
 * Storing one owner UUID makes two simultaneous owners unrepresentable.
 */
export function planPetTransfer(animal, {
  giverUuid = "",
  newOwner = null,
  willing = false
} = {}) {
  const gate = newOwnerGate(animal, newOwner);
  if (!gate.ok) return gate;
  const current = String(petDataOf(animal).ownerUuid ?? "").trim();
  if (!current) return failure("ownerless");
  if (current !== String(giverUuid ?? "").trim()) return failure("giver-not-owner");
  if (!willing) return failure("new-owner-not-willing");
  if (current === uuidOf(newOwner)) return failure("already-owner");
  return {
    ok: true,
    outcome: "transferred",
    update: petOwnerUpdate(uuidOf(newOwner))
  };
}

/** The shared precondition for a friendly, ownerless-animal taming attempt. */
export function canAttemptTaming(animal, human, { friendly = false } = {}) {
  const gate = newOwnerGate(animal, human);
  if (!gate.ok) return gate;
  if (!friendly) return failure("animal-not-friendly");
  if (isOwnedPet(animal)) return failure("already-owned");
  return { ok: true };
}

/**
 * Resolve the FINAL result from the ordinary test pipeline.
 *
 * A pending result is never read. An expertise can improve the test's tier, so
 * ownership cannot land until `crowsTestCommitted` has supplied the final tier.
 */
export function planTamingResult(testResult, {
  animal = null,
  human = null,
  friendly = false,
  now = 0
} = {}) {
  const gate = canAttemptTaming(animal, human, { friendly });
  if (!gate.ok) return gate;
  if (testResult?.state !== "committed") return failure("test-pending");

  const tier = Number(testResult?.tier);
  if (![1, 2, 3].includes(tier)) return failure("invalid-tier");
  if (tier === 1) {
    return { ok: true, tier, outcome: "refused", update: null };
  }
  if (tier === 2) {
    const prospectiveOwnerUuid = uuidOf(human);
    return {
      ok: true,
      tier,
      outcome: "follows-at-distance",
      followsForSeconds: TAMING_FOLLOW_SECONDS,
      heedsCommands: false,
      update: {
        "system.pet.prospectiveOwnerUuid": prospectiveOwnerUuid,
        "system.pet.followsUntil": time(now) + TAMING_FOLLOW_SECONDS
      }
    };
  }
  return {
    ok: true,
    tier,
    outcome: "owned",
    update: petOwnerUpdate(uuidOf(human))
  };
}

/**
 * Roll the required 2d10 + Mind test through the existing pipeline.
 *
 * `roll` is injected in tests instead of mocking global Roll. The returned
 * result may still be pending; in that case the caller must wait for the normal
 * expertise commit and call `planTamingResult` with that committed result.
 */
export async function rollTamingTest(animal, human, {
  friendly = false,
  now = 0,
  roll = rollTest,
  ...rollOptions
} = {}) {
  const gate = canAttemptTaming(animal, human, { friendly });
  if (!gate.ok) return gate;
  const result = await roll({
    ...rollOptions,
    actor: human,
    characteristic: "mind",
    flavor: rollOptions.flavor ?? `Tame ${animal?.name ?? "Animal"}`
  });
  if (result?.state !== "committed") {
    return { ok: true, pending: true, test: result, resolution: null };
  }
  return {
    ok: true,
    pending: false,
    test: result,
    resolution: planTamingResult(result, { animal, human, friendly, now })
  };
}

/**
 * Tier 2 becomes ownership only when the chosen bonding rest FINISHES.
 * `now` and `restCompleted` are explicit inputs; the pure helper owns no clock.
 */
export function planBondingCompletion(animal, human, {
  now = 0,
  restCompleted = false
} = {}) {
  const gate = newOwnerGate(animal, human);
  if (!gate.ok) return gate;
  if (isOwnedPet(animal)) return failure("already-owned");

  const pet = petDataOf(animal);
  if (String(pet.prospectiveOwnerUuid ?? "") !== uuidOf(human)) {
    return failure("not-prospective-owner");
  }
  const until = time(pet.followsUntil);
  if (!until || time(now) > until) return failure("following-expired");
  if (!restCompleted) {
    return { ok: true, outcome: "waiting-for-rest", update: null };
  }
  return {
    ok: true,
    outcome: "owned",
    update: petOwnerUpdate(uuidOf(human))
  };
}

/** Clear an expired tier-2 follow without touching valid or already-owned data. */
export function planExpiredFollow(animal, { now = 0 } = {}) {
  if (!isAnimal(animal) || isOwnedPet(animal)) return { ok: true, expired: false, update: null };
  const pet = petDataOf(animal);
  const until = time(pet.followsUntil);
  if (!pet.prospectiveOwnerUuid || !until || time(now) <= until) {
    return { ok: true, expired: false, update: null };
  }
  return {
    ok: true,
    expired: true,
    update: {
      "system.pet.prospectiveOwnerUuid": "",
      "system.pet.followsUntil": 0
    }
  };
}

/** Number of animal-feed units needed for this many days. */
export function animalFeedRequired(size, days = 1) {
  if (!Object.hasOwn(PET_FEED_MULTIPLIERS, size)) return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 0) return null;
  return PET_FEED_MULTIPLIERS[size] * n;
}

/**
 * C:2445. A pet that can forage eats without inventory feed; otherwise the
 * exact size-scaled feed must be available during the rest. The book gives no
 * starvation damage schedule, so this reports eligibility and invents none.
 */
export function planPetRestFood({
  size,
  canForage = false,
  availableFeed = 0,
  now = 0
} = {}) {
  const requiredFeed = animalFeedRequired(size, 1);
  if (requiredFeed === null) return failure("unknown-size", { requiredFeed: null });
  const available = count(availableFeed);
  const feedConsumed = canForage ? 0 : Math.min(requiredFeed, available);
  const ate = canForage || feedConsumed === requiredFeed;
  return {
    ok: true,
    ate,
    canGainRestBenefits: ate,
    avoidsStarvation: ate,
    requiredFeed,
    feedConsumed,
    shortage: ate ? 0 : requiredFeed - feedConsumed,
    source: canForage ? "forage" : "animal-feed",
    update: ate ? { "system.pet.lastFedAt": time(now) } : null
  };
}

/** Exact barding quote for one armor item. Unprinted sizes stay unsupported. */
export function petBardingQuote(size, { baseCost = 0, baseSlots = 0 } = {}) {
  const rule = PET_BARDING[size];
  if (!rule) return failure("unpriced-size", { size, price: null, slots: null });
  const cost = explicitNumber(baseCost);
  const slots = explicitNumber(baseSlots);
  if (!Number.isFinite(cost) || cost < 0) return failure("invalid-base-cost");
  if (!Number.isInteger(slots) || slots < 0) return failure("invalid-base-slots");
  return {
    ok: true,
    size,
    priceMultiplier: rule.priceMultiplier,
    addedSlots: rule.addedSlots,
    price: cost * rule.priceMultiplier,
    slots: slots + rule.addedSlots
  };
}

/**
 * Pet backpack capacity starts from the stat block's `slots`, then composes
 * positive backpack grants through the SAME validator/reducer PCs use.
 *
 * `effectiveCapacities` starts PCs at 10, so subtract that base after it has
 * validated and summed the grants. This keeps one implementation of grant
 * semantics while allowing a dog to start at 1 rather than at the PC base.
 */
export function effectivePetSlotCapacity(baseSlots, grants = []) {
  const base = count(baseSlots);
  const grantCapacity = effectiveCapacities(grants).backpack;
  const bonus = grantCapacity - CROWS.carryContainers.backpack;
  return base + bonus;
}

/**
 * Capacity budget for riding and barding. These OCCUPY slots; they do not
 * shrink wound capacity or orphan existing wound indices. `otherOccupiedSlots`
 * deliberately excludes the worn barding passed here.
 */
export function petSlotBudget({
  baseSlots = 0,
  grants = [],
  riderMounted = false,
  barding = [],
  otherOccupiedSlots = 0
} = {}) {
  const capacity = effectivePetSlotCapacity(baseSlots, grants);
  const riderSlots = riderMounted ? PET_RIDER_SLOTS : 0;
  let bardingSlots = 0;
  const unsupportedBarding = [];
  for (const armor of barding ?? []) {
    const quote = petBardingQuote(armor?.size, {
      baseCost: armor?.baseCost ?? 0,
      baseSlots: armor?.baseSlots ?? 0
    });
    if (!quote.ok) unsupportedBarding.push({ ...armor, reason: quote.reason });
    else bardingSlots += quote.slots;
  }
  const other = count(otherOccupiedSlots);
  const occupied = riderSlots + bardingSlots + other;
  return {
    capacity,
    riderSlots,
    bardingSlots,
    otherOccupiedSlots: other,
    occupied,
    free: Math.max(0, capacity - occupied),
    overfilled: Math.max(0, occupied - capacity),
    unsupportedBarding
  };
}

/** R:1061 — the pet must be owned by the rider and at least one size larger. */
export function canRidePet(animal, rider) {
  if (!isOwnedPet(animal)) return failure("not-an-owned-pet");
  if (!isHumanOwner(rider)) return failure("rider-not-human");
  const riderUuid = uuidOf(rider);
  if (!riderUuid) return failure("rider-missing-uuid");
  if (petDataOf(animal).ownerUuid !== riderUuid) return failure("rider-not-owner");
  const petRank = CROWS.sizes.indexOf(systemOf(animal).size);
  const riderRank = CROWS.sizes.indexOf(systemOf(rider).size ?? "medium");
  if (petRank < 0 || riderRank < 0) return failure("unknown-size");
  if (petRank <= riderRank) return failure("pet-not-larger");
  return { ok: true, riderSlots: PET_RIDER_SLOTS };
}

export function planMountPet(animal, rider) {
  const gate = canRidePet(animal, rider);
  if (!gate.ok) return gate;
  const mounted = String(petDataOf(animal).riderUuid ?? "");
  if (mounted && mounted !== uuidOf(rider)) return failure("already-mounted");
  return {
    ok: true,
    outcome: "mounted",
    riderSlots: PET_RIDER_SLOTS,
    update: { "system.pet.riderUuid": uuidOf(rider) }
  };
}

export function planDismountPet(animal, rider) {
  const riderUuid = uuidOf(rider);
  if (!riderUuid || petDataOf(animal).riderUuid !== riderUuid) {
    return failure("not-mounted-rider");
  }
  return {
    ok: true,
    outcome: "dismounted",
    riderSlots: 0,
    update: { "system.pet.riderUuid": "" }
  };
}

/**
 * Consume `summonBehaviour(...).actsAsPet` at the rules boundary.
 *
 * The target kind is checked again here so even a stale caller that supplies a
 * broad "summons => pet" flag cannot hand pet mechanics to a summoned object.
 */
export function petCombatProfile({ animal = null, spellbookSystem = null } = {}) {
  const ownedPet = isOwnedPet(animal);
  const target = spellbookSystem
    ? (typeof spellbookSystem.target === "object"
        ? spellbookSystem.target
        : parseTarget(spellbookSystem.target))
    : null;
  const summon = spellbookSystem ? summonBehaviour(spellbookSystem) : null;
  const summonedCreature = !!summon?.actsAsPet && target?.kind === "creature";
  return {
    actsAsPet: ownedPet || summonedCreature,
    ownedPet,
    summonedCreature,
    requiresCommandTest: ownedPet && !summonedCreature
  };
}

/** R:1053-1057, after the command test reaches its committed tier. */
export function planPetCommandResult(testResult, profile = {}) {
  if (!profile?.actsAsPet) return failure("not-pet-behaviour");
  if (!profile.requiresCommandTest) {
    return { ok: true, outcome: "follows-command", weakened: false, testRequired: false };
  }
  if (testResult?.state !== "committed") return failure("test-pending");
  const tier = Number(testResult?.tier);
  if (![1, 2, 3].includes(tier)) return failure("invalid-tier");
  if (tier === 1) return { ok: true, tier, outcome: "refuses-command", weakened: false, testRequired: true };
  return {
    ok: true,
    tier,
    outcome: "follows-command",
    weakened: tier === 2,
    testRequired: true
  };
}

/**
 * Complex/particularly dangerous owned-pet commands use the ordinary Mind-test
 * pipeline. Callers set `needsTest:false` for ordinary commands (including the
 * usual attack against a dangerous creature, R:1059). Summons never roll.
 */
export async function rollPetCommandTest(animal, human, {
  needsTest = true,
  spellbookSystem = null,
  roll = rollTest,
  ...rollOptions
} = {}) {
  const profile = petCombatProfile({ animal, spellbookSystem });
  if (!profile.actsAsPet) return failure("not-pet-behaviour");
  if (!profile.requiresCommandTest || !needsTest) {
    return {
      ok: true,
      pending: false,
      test: null,
      resolution: planPetCommandResult(null, { ...profile, requiresCommandTest: false })
    };
  }
  if (petDataOf(animal).ownerUuid !== uuidOf(human)) return failure("commander-not-owner");
  const result = await roll({
    ...rollOptions,
    actor: human,
    characteristic: "mind",
    flavor: rollOptions.flavor ?? `Command ${animal?.name ?? "Pet"}`
  });
  if (result?.state !== "committed") {
    return { ok: true, pending: true, test: result, resolution: null };
  }
  return {
    ok: true,
    pending: false,
    test: result,
    resolution: planPetCommandResult(result, profile)
  };
}

/** Persist one successful pure plan against an injected Actor-like document. */
export async function applyPetPlan(animal, plan) {
  if (!plan?.ok) return plan ?? failure("missing-plan");
  if (!plan.update) return plan;
  if (typeof animal?.update !== "function") return failure("animal-not-updatable");
  await animal.update(plan.update);
  return plan;
}
