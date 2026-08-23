/**
 * Carrying corpses — T1.2 (Playtest 2), R:484-486.
 *
 * A corpse is not an Item; it is a cost against the same inventory `Layout`
 * that slots.mjs builds. R:484: what you can drag out of a dungeon is limited
 * by slots, and the corpse's OWN equipment is carried too — the thing that
 * makes a Medium body in plate a very different proposition from a bare one.
 *
 * Pure. Nothing here touches a document.
 */

import { CROWS } from "../config.mjs";
import { occupancy } from "./slots.mjs";

/** The sizes R:486 prices. Anything else is unknown, not free. */
export const CORPSE_SIZES = Object.keys(CROWS.corpseSlots);

export function isKnownSize(size) {
  return Object.prototype.hasOwnProperty.call(CROWS.corpseSlots, size);
}

/** Slots for one body of this size (R:486). Unknown sizes cost 0 and are flagged. */
export function corpseSlotCost(size) {
  return CROWS.corpseSlots[size] ?? 0;
}

/** How many bodies of this size share a slot. Only Tiny stacks, at 3 (R:486). */
export function corpseStackLimit(size) {
  const n = CROWS.corpseStack[size];
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** The harvest die for a corpse of this size (R:652). */
export function harvestDieFor(size) {
  return CROWS.harvestDice[size] ?? null;
}

/**
 * Slots taken by the corpse's own kit. Accepts either a ready number or the
 * item list, so a caller that has the documents does not have to pre-sum.
 * Weightless items cost nothing, exactly as in the living inventory.
 */
export function equipmentSlotCost(equipment = []) {
  if (typeof equipment === "number") {
    return Number.isFinite(equipment) && equipment > 0 ? Math.floor(equipment) : 0;
  }
  let total = 0;
  for (const i of equipment ?? []) {
    if (i?.system?.weightless) continue;
    const n = Number(i?.system?.slots);
    total += Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
  }
  return total;
}

/**
 * What it costs to haul `count` corpses of one size, plus their gear.
 *
 * Stacking applies to the BODIES only and is a per-slot allowance, so four Tiny
 * corpses need two slots, not `ceil(4 * 1 / 3)` = two by luck — the distinction
 * matters the moment a size ever stacks at something other than its unit cost.
 */
export function corpseCost({ size, count = 1, equipment = [] } = {}) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const unitSlots = corpseSlotCost(size);
  const stackLimit = corpseStackLimit(size);
  const bodySlots = n === 0 ? 0 : Math.ceil(n / stackLimit) * unitSlots;
  const equipmentSlots = equipmentSlotCost(equipment);
  return {
    size,
    known: isKnownSize(size),
    count: n,
    unitSlots,
    stackLimit,
    bodySlots,
    equipmentSlots,
    slots: bodySlots + equipmentSlots
  };
}

/**
 * Will it fit? Measured against FREE slots, not capacity — a wounded slot is
 * still usable (R:524 lets a slot hold both), so wounds cost speed here rather
 * than space.
 */
export function canCarryCorpse(layout, corpse, container = "backpack") {
  const cost = corpseCost(corpse);
  const occ = occupancy(layout, container);
  if (!cost.known) {
    return { ok: false, reason: "unknown-size", needed: cost.slots, free: occ.free, cost, container };
  }
  const ok = cost.slots > 0 && cost.slots <= occ.free;
  return {
    ok,
    needed: cost.slots,
    free: occ.free,
    cost,
    container,
    ...(ok ? {} : { reason: cost.slots === 0 ? "nothing-to-carry" : "not-enough-slots" })
  };
}
