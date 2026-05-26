import { CROWS } from "../config.mjs";

export function backpackCapacity(actor) {
  const wounds = actor.system.wounds ?? 0;
  return Math.max(0, CROWS.backpackSize - wounds);
}

export function containerCapacity(actor, container) {
  if (container === "backpack") return backpackCapacity(actor);
  return CROWS.containers[container] ?? 0;
}

export function containerUsed(actor, container) {
  let used = 0;
  for (const i of actor.items) {
    const loc = i.system?.location;
    if (!loc || loc.container !== container) continue;
    if (i.system.weightless) continue;
    used += loc.length ?? (i.system.slots ?? 1);
  }
  return used;
}

export function containerOccupancy(actor, container) {
  return { used: containerUsed(actor, container), capacity: containerCapacity(actor, container) };
}

export function canPlace(actor, item, container, index) {
  const cap = containerCapacity(actor, container);
  const need = item.system?.slots ?? 1;
  const used = containerUsed(actor, container);
  if (container === "hand" && (item.system?.slots ?? 1) > 2) return false;
  return (used + need) <= cap && index >= 0 && (index + need) <= cap;
}
