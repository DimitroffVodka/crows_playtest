/**
 * Positional inventory — T1.2 (Playtest 2).
 *
 * The PT1 file this replaces was a capacity SUM: it added up `system.slots`
 * per container and compared the total to a constant. That model cannot express
 * any of the PT2 rules — contiguity (R:430), same-kind stacking (R:432), the
 * per-slot wound/speed interaction (R:524), or the backpack retrieval roll
 * (R:478), all of which are statements about WHICH slot a thing is in.
 *
 * So the unit here is the `Slot`, and `Layout` is a dense, ordered array of
 * them. Every packing rule becomes a property of that structure and is testable
 * without Foundry — see test/slots.test.mjs. Nothing in this file touches a
 * document; `layoutFor(actor)` only READS an actor, and the mutators mutate the
 * plain `Layout` object. Persisting a layout is the sheet's job (T2.1).
 *
 * Sources: R:426-498 (slots, magic slots, equipped, swapping, corpses),
 * R:524 (wounds and speed), C:1917 / C:1737 (coin and purses).
 */

import { CROWS, effectiveCapacities } from "../config.mjs";

/* -------------------------------------------------------------------------- */
/*  Containers                                                                 */
/* -------------------------------------------------------------------------- */

/** hand / belt / backpack — the things you carry stuff IN (R:426). */
export const CARRY_CONTAINERS = Object.keys(CROWS.carryContainers);

/**
 * head / neck / waist / arms / finger / feet — a SEPARATE axis (R:438), not a
 * carry container. A ring does not compete with a rope for backpack space.
 */
export const MAGIC_CONTAINERS = [...CROWS.magicSlots];

/** The union, in display order. `Slot.container` is always one of these. */
export const CONTAINER_ORDER = [...CROWS.containerKeys];

/* -------------------------------------------------------------------------- */
/*  The wound/speed rule setting                                               */
/* -------------------------------------------------------------------------- */

const NS = "crows";

export const WOUND_SPEED_RULE_KEY = "woundSpeedRule";
export const DEFAULT_WOUND_SPEED_RULE = "wound-and-item";
export const WOUND_SPEED_RULES = ["wound-and-item", "wound-only"];

/**
 * R:524 has three readings and the migration resolved to (c) — count only the
 * backpack slots holding BOTH a wound and an item. Reading (b), one point per
 * wound, is available behind this setting so a ruling from MCDM is a one-value
 * change rather than a code change. Reading (a) — every occupied slot — is not
 * offered: speed is 5 (C:24) against a 10-slot backpack (R:428), so a loaded
 * but UNWOUNDED crow would already be immobile.
 *
 * Must be called from the `init` hook. The entry point (T2.3) wires it; this
 * file only supplies it, exactly as chaos.mjs / miasma.mjs do.
 */
export function registerSlotSettings() {
  game.settings.register(NS, WOUND_SPEED_RULE_KEY, {
    name: "Wound speed penalty (R:524)",
    hint: "Which backpack slots cost speed. Default counts only slots holding both a wound and an item.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "wound-and-item": "Slots holding a wound AND an item (default)",
      "wound-only": "Every slot holding a wound"
    },
    default: DEFAULT_WOUND_SPEED_RULE
  });
}

/** The configured rule, or the default anywhere `game` is unavailable (tests). */
export function currentWoundSpeedRule() {
  if (typeof game === "undefined") return DEFAULT_WOUND_SPEED_RULE;
  try {
    const v = game.settings.get(NS, WOUND_SPEED_RULE_KEY);
    return WOUND_SPEED_RULES.includes(v) ? v : DEFAULT_WOUND_SPEED_RULE;
  } catch {
    return DEFAULT_WOUND_SPEED_RULE;
  }
}

/* -------------------------------------------------------------------------- */
/*  Reading an item                                                            */
/* -------------------------------------------------------------------------- */

const sys = (item) => item?.system ?? {};

/** Foundry documents expose `id`; raw source objects only have `_id`. */
export function itemId(item) {
  return item?.id ?? item?._id ?? null;
}

/**
 * How many slots this item occupies. `weightless` items return 0 and are kept
 * OUT of the positional layout entirely — a thing that occupies nothing has no
 * index, and giving it one would make it count toward `Slot.items.length`,
 * which is the predicate the R:524 speed penalty reads.
 *
 * NOTE `system.location.length` is deliberately NOT consulted. It is a
 * denormalised mirror the sheet writes on drop; `system.slots` is the rules
 * fact. When they disagree the item's own size wins.
 */
export function slotsNeeded(item) {
  if (sys(item).weightless) return 0;
  const n = Number(sys(item).slots);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

/** How many of the thing this one item represents. */
export function quantityOf(item) {
  const n = Number(sys(item).quantity);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/**
 * The stacking KIND (R:432 — "same kind only"): 5 different potions share a
 * slot, 3 potions and 2 locks do not.
 *
 * DECISION, not in the contract: nothing in the data model names a kind.
 * `CROWS.stackLimits` is keyed by `potion` / `lock` / `oil`, but no item
 * carries those words in a field — Padlock and Oil Flask are both
 * `gear` / `utility` and differ only in `stackMax` (3 vs 2). So:
 *
 *   1. `system.stackKind`, if content sets it. This is the ONLY way to reach a
 *      `CROWS.stackLimits` key by name, and the field has no home in the schema
 *      yet — see the T1.2 report.
 *   2. otherwise `type:subtype:stackMax`. Two items that declare DIFFERENT
 *      stack limits are demonstrably different kinds, so folding `stackMax`
 *      into the identity is what stops Padlock and Oil Flask stacking together
 *      while still letting Speed Potion and Rage Potion (both `consumable`,
 *      both `stackMax: 5`) share a slot, which is the case R:432 names.
 */
export function stackKindOf(item) {
  const s = sys(item);
  const explicit = typeof s.stackKind === "string" ? s.stackKind.trim() : "";
  if (explicit) return explicit;
  const subtype = typeof s.subtype === "string" ? s.subtype : "";
  const declared = Number(s.stackMax);
  const max = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 1;
  return `${item?.type ?? "item"}:${subtype}:${max}`;
}

/** How many of `item`'s kind fit in one slot. The named rule wins over content. */
export function stackLimitFor(item) {
  const named = CROWS.stackLimits[stackKindOf(item)];
  if (Number.isInteger(named) && named > 0) return named;
  const declared = Number(sys(item).stackMax);
  return Number.isInteger(declared) && declared > 0 ? declared : 1;
}

/**
 * Could these two share a slot at all? Ignores how full the slot already is —
 * `placeAt` does that — and ignores the container, because "hand slots never
 * stack" (R:432) is a property of the destination, not of the pair.
 */
export function canStack(a, b) {
  if (!a || !b) return false;
  // Multi-slot items never stack, and a weightless item (0) has no slot to
  // share. Only genuine one-slot items are candidates.
  if (slotsNeeded(a) !== 1 || slotsNeeded(b) !== 1) return false;
  if (stackKindOf(a) !== stackKindOf(b)) return false;
  return stackLimitFor(a) > 1 && stackLimitFor(b) > 1;
}

/* -------------------------------------------------------------------------- */
/*  Building a Layout                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every trait slot grant on the actor, flattened. Collected exactly as
 * `CrowData.prepareDerivedData` collects them so the two cannot diverge.
 */
export function collectSlotGrants(actor) {
  const grants = [];
  for (const i of actor?.items ?? []) {
    if (i?.type !== "trait") continue;
    for (const g of i?.system?.slotGrants ?? []) grants.push(g);
  }
  return grants;
}

/**
 * An empty Layout at the given capacities.
 *
 * Beyond the four frozen keys (`actorId`, `capacities`, `slots`, `coin`) this
 * carries three ADDITIVE fields. Nothing frozen is restructured; consumers that
 * only know the frozen shape are unaffected.
 *
 *   magicOverload  the flag T1.5 (cannot rest) and T1.7 (1d6 wounds/DT) need
 *                  from deliverable 8. Also available as `magicOverloadFor()`.
 *   unplaced       items whose stored location does not fit the layout at all,
 *                  so a bad drop is REPORTED rather than silently vanishing.
 *   weightless     items that occupy no slot and therefore have no index.
 */
export function emptyLayout(actorId = "", capacities = effectiveCapacities()) {
  const caps = {};
  const slots = [];
  for (const c of CONTAINER_ORDER) {
    const n = Number(capacities?.[c]);
    const cap = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    caps[c] = cap;
    for (let i = 0; i < cap; i++) {
      slots.push({ container: c, index: i, items: [], wound: false, spanId: null });
    }
  }
  return {
    actorId: String(actorId ?? ""),
    capacities: caps,
    slots,
    coin: { loose: 0, purses: [] },
    magicOverload: false,
    unplaced: [],
    weightless: []
  };
}

export function slotAt(layout, container, index) {
  return (layout?.slots ?? []).find(s => s.container === container && s.index === index) ?? null;
}

/**
 * The positional inventory of an actor.
 *
 * CAPACITY: this calls `effectiveCapacities()` with the actor's collected trait
 * grants — the same function `CrowData.prepareDerivedData` calls with the same
 * grants. It must never start from `CROWS.carryContainers` directly, or the
 * wound derivation and the layout would disagree the moment a slot-granting
 * trait exists (C:737 is a real one).
 *
 * TOLERANT BY DESIGN: stored data can be illegal — two rings in one finger
 * slot, an item left behind by a removed capacity grant. This reproduces what
 * is stored (so `magicOverload` can actually fire) and reports what would not
 * fit, rather than enforcing the packing rules and quietly discarding things.
 * Enforcement belongs at the DROP, which is `packItem`.
 */
export function layoutFor(actor) {
  const capacities = effectiveCapacities(collectSlotGrants(actor));
  const layout = emptyLayout(actor?.id ?? actor?._id ?? "", capacities);

  for (const item of actor?.items ?? []) {
    const loc = item?.system?.location;
    if (!loc?.container) continue;              // traits, backgrounds, spellbooks…
    const id = itemId(item);
    if (!id) continue;

    const need = slotsNeeded(item);
    if (need === 0) {
      layout.weightless.push({ id, kind: stackKindOf(item) });
      continue;
    }

    const index = Math.floor(Number(loc.index) || 0);
    const refs = [];
    for (let k = 0; k < need; k++) refs.push({ container: loc.container, index: index + k });

    const res = placeAt(layout, item, refs, { enforce: false });
    if (!res.ok) layout.unplaced.push({ id, reason: res.reason });
  }

  // Wounds OCCUPY slots inside capacity; they never REDUCE it, and they do not
  // block an item — R:524's penalty clause only has meaning if a slot can hold
  // both a wound and an item. Indices at or beyond capacity are orphans and
  // have no slot here; `CrowData.orphanedWounds` preserves and reports them.
  const backpackCap = layout.capacities.backpack ?? 0;
  for (const w of actor?.system?.woundSlots ?? []) {
    const i = Number(w);
    if (!Number.isInteger(i) || i < 0 || i >= backpackCap) continue;
    const s = slotAt(layout, "backpack", i);
    if (s) s.wound = true;
  }

  layout.coin = { loose: looseCoinOf(actor), purses: purseEntriesFor(actor) };
  layout.magicOverload = magicOverloadFor(layout).overloaded;
  return layout;
}

/* -------------------------------------------------------------------------- */
/*  Placement                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Place `item` into an explicit set of slot references.
 *
 * This is the general form and the one that can express the two illegal shapes
 * R:430 rules out: a span crossing containers, and a span that is not adjacent.
 * `packItem` is the contiguous convenience wrapper over it.
 *
 * On success the layout is MUTATED. On failure it is untouched — every check
 * runs before the first write.
 *
 * `reason` values: bad-arguments · no-item-id · no-slots · cross-container ·
 * unknown-container · bad-index · non-contiguous · wrong-span · out-of-bounds ·
 * occupied · hand-no-stack · stack-kind · stack-full
 */
export function placeAt(layout, item, refs, { enforce = true } = {}) {
  if (!layout || !item) return { ok: false, reason: "bad-arguments" };
  const id = itemId(item);
  if (!id) return { ok: false, reason: "no-item-id" };

  const need = slotsNeeded(item);
  if (need === 0) {
    // Occupies nothing, so there is nothing to validate and no slot to take.
    if (!layout.weightless.some(w => w.id === id)) {
      layout.weightless.push({ id, kind: stackKindOf(item) });
    }
    return { ok: true, weightless: true, container: null, indices: [], spanId: null };
  }

  const list = [...(refs ?? [])];
  if (!list.length) return { ok: false, reason: "no-slots" };

  const container = list[0].container;
  if (list.some(r => r.container !== container)) return { ok: false, reason: "cross-container" };
  if (!(container in layout.capacities)) return { ok: false, reason: "unknown-container" };

  const idx = list.map(r => Number(r.index));
  if (idx.some(n => !Number.isInteger(n))) return { ok: false, reason: "bad-index" };
  idx.sort((a, b) => a - b);
  for (let k = 1; k < idx.length; k++) {
    if (idx[k] !== idx[k - 1] + 1) return { ok: false, reason: "non-contiguous" };
  }
  if (idx.length !== need) return { ok: false, reason: "wrong-span" };

  const cap = layout.capacities[container] ?? 0;
  if (idx[0] < 0 || idx[idx.length - 1] >= cap) return { ok: false, reason: "out-of-bounds" };

  const targets = idx.map(i => slotAt(layout, container, i));
  if (targets.some(s => !s)) return { ok: false, reason: "out-of-bounds" };

  if (enforce) {
    const blocked = targets.filter(s => s.items.length > 0);
    if (blocked.length) {
      // A multi-slot item claims its whole span exclusively — a two-handed axe
      // cannot half-share a slot with a potion.
      if (need > 1) return { ok: false, reason: "occupied" };
      // R:432 — hand slots never stack, whatever the kind allows elsewhere.
      if (container === "hand") return { ok: false, reason: "hand-no-stack" };
      const slot = targets[0];
      const limit = stackLimitFor(item);
      if (limit <= 1) return { ok: false, reason: "occupied" };
      const kind = stackKindOf(item);
      if (slot.items.some(e => e.kind !== kind)) return { ok: false, reason: "stack-kind" };
      const held = slot.items.reduce((n, e) => n + (e.qty ?? 1), 0);
      if (held + quantityOf(item) > limit) return { ok: false, reason: "stack-full" };
    }
  }

  // `spanId` ties a multi-slot item's slots together (frozen `Slot.spanId`).
  // The item id is already unique per actor and is shared by construction.
  const spanId = need > 1 ? id : null;
  const entry = { id, kind: stackKindOf(item), qty: quantityOf(item) };
  for (const s of targets) {
    s.items.push({ ...entry });     // a copy per slot; no aliasing across slots
    if (spanId) s.spanId = spanId;
  }
  return { ok: true, container, indices: idx, spanId };
}

/**
 * Place `item` starting at `index`, occupying `slotsNeeded(item)` ADJACENT
 * slots in the one container (R:430). A span that would run past the end of the
 * container is `out-of-bounds`, which is also how "hand + belt" is rejected:
 * an item cannot spill from one container into the next.
 */
export function packItem(layout, item, container, index) {
  const need = slotsNeeded(item);
  if (need === 0) return placeAt(layout, item, [], { enforce: true });
  const start = Math.floor(Number(index));
  if (!Number.isInteger(start)) return { ok: false, reason: "bad-index" };
  const refs = [];
  for (let k = 0; k < need; k++) refs.push({ container, index: start + k });
  return placeAt(layout, item, refs);
}

/**
 * Plan a two-card swap: `moving` goes to `target`, whatever sits there goes to
 * `origin`.
 *
 * Pure and non-mutating — it works on its own copy and returns the two
 * locations to write, so a half-completed swap can never be persisted. Both
 * placements are validated BEFORE either is reported as ok, because the return
 * trip is the one that fails: dropping a 1-slot torch onto a 2-slot greatsword
 * leaves the greatsword needing a contiguous pair the torch's single origin
 * slot cannot give it.
 *
 * @returns {{ok: true, moving: object, occupant: object}|{ok: false, reason: string}}
 */
export function planSwap(layout, moving, occupant, target, origin) {
  if (!layout || !moving || !occupant) return { ok: false, reason: "bad-arguments" };
  const movingId = itemId(moving);
  const occupantId = itemId(occupant);
  if (!movingId || !occupantId) return { ok: false, reason: "no-item-id" };
  if (movingId === occupantId) return { ok: false, reason: "same-item" };
  if (!origin || !Number.isInteger(Number(origin.index))) return { ok: false, reason: "no-origin" };

  const trial = structuredClone(layout);
  unpackItem(trial, movingId);
  unpackItem(trial, occupantId);

  const there = packItem(trial, moving, target.container, Number(target.index));
  if (!there.ok) return { ok: false, reason: there.reason };
  const back = packItem(trial, occupant, origin.container, Number(origin.index));
  if (!back.ok) return { ok: false, reason: `swap-back-${back.reason}` };

  return {
    ok: true,
    moving: { container: target.container, index: Number(target.index), length: slotsNeeded(moving) },
    occupant: { container: origin.container, index: Number(origin.index), length: slotsNeeded(occupant) }
  };
}

/**
 * Which item ids occupy the span an item would claim at `container:index`?
 * Includes span owners, so a slot that is the tail of a two-slot weapon
 * reports that weapon rather than nothing.
 */
export function occupantsOfSpan(layout, item, container, index) {
  const need = Math.max(1, slotsNeeded(item));
  const start = Number(index);
  const ids = new Set();
  for (let k = 0; k < need; k++) {
    const slot = slotAt(layout, container, start + k);
    if (!slot) continue;
    for (const entry of slot.items) ids.add(entry.id);
    if (slot.spanId) ids.add(slot.spanId);
  }
  ids.delete(itemId(item));
  return [...ids];
}

/** Remove every trace of an item from the layout. Returns the slots it vacated. */
export function unpackItem(layout, id) {
  const vacated = [];
  for (const s of layout?.slots ?? []) {
    const before = s.items.length;
    s.items = s.items.filter(e => e.id !== id);
    if (s.items.length !== before) {
      vacated.push({ container: s.container, index: s.index });
      if (s.spanId === id) s.spanId = null;
    }
  }
  if (layout?.weightless) layout.weightless = layout.weightless.filter(w => w.id !== id);
  return { ok: vacated.length > 0, vacated };
}

/**
 * What a container currently looks like.
 *
 * `capacity` is what `effectiveCapacities()` says and is NOT reduced by wounds.
 * `wounded` slots still accept items — that is the whole point of R:524's
 * second sentence — so they are counted separately rather than subtracted.
 */
export function occupancy(layout, container) {
  const slots = (layout?.slots ?? []).filter(s => s.container === container);
  const used = slots.filter(s => s.items.length > 0).length;
  return {
    container,
    capacity: layout?.capacities?.[container] ?? 0,
    used,
    free: slots.length - used,
    wounded: slots.filter(s => s.wound).length,
    woundedWithItems: slots.filter(s => s.wound && s.items.length > 0).length
  };
}

/* -------------------------------------------------------------------------- */
/*  Wounds and speed (R:524)                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Speed lost to wounds. Verbatim from the contract.
 *
 * The penalty is a property of the LAYOUT, not of `woundSlots.size` — which is
 * why wounds are never collapsed to a count here.
 */
export function speedPenaltyFromWounds(layout, rule = DEFAULT_WOUND_SPEED_RULE) {
  const p = rule === "wound-only"
    ? (s => s.wound)
    : (s => s.wound && s.items.length > 0);
  return (layout?.slots ?? []).filter(s => s.container === "backpack" && p(s)).length;
}

/**
 * Apply the penalty to an already-computed speed.
 *
 * AFTER everything else — `CrowData.effectiveSpeed` has already resolved
 * grabbed/unconscious/prone — so the prone halving and this do not fight over
 * rounding. Floors at 0 (R:524).
 */
export function applyWoundSpeedPenalty(speed, layout, rule = currentWoundSpeedRule()) {
  const base = Number(speed);
  return Math.max(0, (Number.isFinite(base) ? base : 0) - speedPenaltyFromWounds(layout, rule));
}

/* -------------------------------------------------------------------------- */
/*  Retrieval from the backpack (R:478)                                        */
/* -------------------------------------------------------------------------- */

/**
 * Fish something out of the backpack: a maneuver plus 1d10, which must reach at
 * least ONE of the slot numbers the item sits in. A big item spanning slots 3-5
 * is therefore easier to find than a small one buried at 9.
 *
 * Slot NUMBERS are 1-based (`Slot.index` is 0-based). `d10 === lowest number`
 * succeeds — the roll must reach the slot, not beat it.
 */
export function retrieveFromBackpack(layout, id, d10) {
  const slotNumbers = (layout?.slots ?? [])
    .filter(s => s.container === "backpack" && s.items.some(e => e.id === id))
    .map(s => s.index + 1)
    .sort((a, b) => a - b);

  if (!slotNumbers.length) {
    return { ok: false, reason: "not-in-backpack", slotsMatched: [], slotNumbers: [], roll: null };
  }
  const roll = Math.floor(Number(d10));
  if (!Number.isInteger(roll)) {
    return { ok: false, reason: "bad-roll", slotsMatched: [], slotNumbers, roll: null };
  }
  const slotsMatched = slotNumbers.filter(n => roll >= n);
  return { ok: slotsMatched.length > 0, slotsMatched, slotNumbers, roll };
}

/* -------------------------------------------------------------------------- */
/*  Magic slot overload (R:460)                                                */
/* -------------------------------------------------------------------------- */

/**
 * More than one magic item in one magic slot. This helper only FLAGS it —
 * T1.7 owns the 1d6 wounds per DT, T1.5 owns "cannot rest".
 */
export function magicOverloadFor(layout) {
  const bad = (layout?.slots ?? [])
    .filter(s => MAGIC_CONTAINERS.includes(s.container) && s.items.length > 1);
  return {
    overloaded: bad.length > 0,
    containers: [...new Set(bad.map(s => s.container))],
    slots: bad.map(s => ({ container: s.container, index: s.index, itemIds: s.items.map(e => e.id) }))
  };
}

/* -------------------------------------------------------------------------- */
/*  Coin (C:1917, C:1737)                                                      */
/* -------------------------------------------------------------------------- */

/** The Bursting Purse trait, `crows-traits/thievery-t4-c2.yaml`. */
export const BURSTING_PURSE_ID = "ctthie42brstprs0";
const BURSTING_PURSE_NAME = "bursting purse";

function traitIdentifiers(item) {
  const out = [];
  const id = itemId(item);
  if (id) out.push(String(id));
  const src = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? "";
  if (src) out.push(String(src).split(".").pop());
  return out;
}

/**
 * Does the actor have Bursting Purse (C:1737)?
 *
 * DECISION, not in the contract: nothing on `TraitData` expresses "grants purse
 * capacity" — `slotGrants` is about containers and `usePool` about per-rest
 * uses. So this matches the shipped trait by its stable compendium id, falling
 * back to its name for a hand-made or renamed copy. See the T1.2 report: a
 * declarative field on TraitData would be better, but that model is not mine.
 */
export function hasBurstingPurse(actor) {
  for (const i of actor?.items ?? []) {
    if (i?.type !== "trait") continue;
    if (traitIdentifiers(i).includes(BURSTING_PURSE_ID)) return true;
    if (String(i?.name ?? "").trim().toLowerCase() === BURSTING_PURSE_NAME) return true;
  }
  return false;
}

/** Loose coin carried on the person (C:1917). Purses are Items, not this. */
export function looseCoinOf(actor) {
  const n = Number(actor?.system?.currency);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * `Layout.coin.purses` — `{id, held, cap}` with the trait bonus already applied.
 *
 * The allocation is frozen by the contract and is NOT negotiable here:
 * C:1737 grants "an additional 500 gc in a coin purse", SINGULAR, so with two
 * purses the bonus neither splits nor repeats. It lands on the purse with the
 * greatest `baseCapacity` — the only choice that never reduces total carrying
 * capacity — ties broken by the lowest item id, which is stable across clients
 * and reloads in a way that inventory ORDER is not.
 *
 * `gear.mjs` deliberately cannot see the actor, so it publishes the base only
 * and this is where the bonus is applied.
 */
export function purseEntriesFor(actor) {
  const purses = [];
  for (const i of actor?.items ?? []) {
    const p = i?.system?.purse;
    if (!p?.isPurse) continue;
    const held = Number(p.held);
    const base = Number(p.baseCapacity ?? CROWS.purseBaseCapacity);
    purses.push({
      id: String(itemId(i) ?? ""),
      held: Number.isFinite(held) && held > 0 ? Math.floor(held) : 0,
      cap: Number.isFinite(base) && base > 0 ? Math.floor(base) : 0
    });
  }
  if (purses.length && hasBurstingPurse(actor)) {
    // Selection reads BASE capacity — the bonus has not been added yet — and is
    // order-independent, so document order cannot change the answer.
    const target = purses.reduce((best, p) =>
      (p.cap > best.cap || (p.cap === best.cap && p.id < best.id)) ? p : best);
    target.cap += CROWS.purseTraitBonus;
  }
  return purses;
}

/** Slots eaten by loose coin: 250 to a slot (C:1917), rounded up. */
export function looseCoinSlots(loose) {
  const n = Math.max(0, Math.floor(Number(loose) || 0));
  return Math.ceil(n / CROWS.coinPerSlot);
}

/**
 * Everything a sheet needs to render money, plus the overflow figure.
 *
 * `overflow` is coin held beyond a purse's effective capacity. It is REPORTED,
 * never silently spilled — the same stance the contract takes on orphaned
 * wounds and over-cap expertises.
 */
export function coinSummary(layout) {
  const coin = layout?.coin ?? { loose: 0, purses: [] };
  const purses = (coin.purses ?? []).map(p => ({ ...p, over: Math.max(0, p.held - p.cap) }));
  const purseHeld = purses.reduce((n, p) => n + p.held, 0);
  const purseCapacity = purses.reduce((n, p) => n + p.cap, 0);
  const loose = Math.max(0, Math.floor(Number(coin.loose) || 0));
  return {
    loose,
    looseSlots: looseCoinSlots(loose),
    purses,
    purseHeld,
    purseCapacity,
    purseRoom: Math.max(0, purseCapacity - purseHeld),
    totalHeld: loose + purseHeld,
    overflow: purses.reduce((n, p) => n + p.over, 0)
  };
}

function findPurse(layout, purseId) {
  const purses = layout?.coin?.purses ?? [];
  if (!purses.length) return null;
  if (purseId == null) return purses[0];
  return purses.find(p => p.id === purseId) ?? null;
}

/**
 * Move loose coin INTO a purse. Mutates `layout.coin`; the caller persists.
 * Partial moves are performed and reported — moving what fits is the useful
 * behaviour, and `ok` says whether the full amount made it.
 */
export function depositCoins(layout, amount, purseId = null) {
  const coin = layout?.coin;
  if (!coin) return { ok: false, moved: 0, reason: "no-coin" };
  const purse = findPurse(layout, purseId);
  if (!purse) return { ok: false, moved: 0, reason: "no-purse" };

  const want = Math.max(0, Math.floor(Number(amount) || 0));
  const room = Math.max(0, purse.cap - purse.held);
  const moved = Math.min(want, room, coin.loose);
  purse.held += moved;
  coin.loose -= moved;

  const ok = moved === want;
  return {
    ok, moved, purseId: purse.id, loose: coin.loose, held: purse.held,
    // Which limit bit: if the purse had no more room it is full, otherwise the
    // crow simply did not have that much loose coin on them.
    ...(ok ? {} : { reason: room <= moved ? "purse-full" : "insufficient-loose" })
  };
}

/** Move coin OUT of a purse and back to loose. */
export function withdrawCoins(layout, amount, purseId = null) {
  const coin = layout?.coin;
  if (!coin) return { ok: false, moved: 0, reason: "no-coin" };
  const purse = findPurse(layout, purseId);
  if (!purse) return { ok: false, moved: 0, reason: "no-purse" };

  const want = Math.max(0, Math.floor(Number(amount) || 0));
  const moved = Math.min(want, purse.held);
  purse.held -= moved;
  coin.loose += moved;

  const ok = moved === want;
  return {
    ok, moved, purseId: purse.id, loose: coin.loose, held: purse.held,
    ...(ok ? {} : { reason: "purse-empty" })
  };
}
