/**
 * Damage, wounds and death — Playtest 2.
 *
 * R:508 AD -> R:516 Stamina -> R:524 wounds. Piercing (R:512) skips AD and hits
 * Stamina first. A wound fills a backpack slot of the PC's CHOICE, and when all
 * of a creature's backpack slots hold wounds, they die.
 *
 * FOUR THINGS THIS FILE EXISTS TO GET RIGHT
 *
 * 1. Vulnerable (R:544) adds 1d6 BEFORE AD, not after. "Each time you take
 *    damage you take an additional 1d6 dam" — that is more damage arriving, not
 *    damage that bypasses armor, so armor absorbs it like any other. Doing it
 *    after AD would quietly turn Vulnerable into piercing.
 *
 * 2. DEATH IS ADJUDICATED HERE, at the wound-GAIN mutation, by comparing
 *    pre-state to post-state. NEVER from `woundCapacityFilled` in derived data:
 *    that flag can flip true because CAPACITY SHRANK (a slot-granting trait was
 *    removed), and removing a trait must not instantly kill a wounded PC.
 *
 * 3. Wound slots are the PLAYER's choice and come from T1.2's Layout. This file
 *    does not compute capacity or occupancy; it reads them off the Layout and
 *    picks among what is offered.
 *
 * 4. `boned` is gone. It was a leveled condition adding cumulative bonus damage
 *    taken; PT2 has no equivalent and the old netBoned arithmetic here has been
 *    deleted rather than remapped onto Weakened, which is a bane on tests and
 *    has nothing to do with damage.
 *
 * Everything above the "Foundry-facing" banner is pure and unit-tested in
 * test/damage.test.mjs.
 */

import { CROWS, effectiveCapacities } from "../config.mjs";
import { setCondition } from "./combat.mjs";

/* ==========================================================================
 * Pure core
 * ========================================================================== */

/**
 * Split an incoming damage instance across AD, Stamina and wounds.
 *
 * @param {object} p
 * @param {number} p.amount              damage before Vulnerable
 * @param {boolean} [p.piercing]         R:512 — skip AD entirely
 * @param {boolean} [p.vulnerable]       R:544 — the TARGET is vulnerable
 * @param {number} [p.vulnerableRoll]    the 1d6, injected so this stays pure
 * @param {Array<{id?, name?, current: number}>} [p.armor]  AD pools, in the
 *        order they will be consumed. The wearer chooses that order (R:508);
 *        the caller has already applied the choice.
 * @param {number} [p.stamina]
 * @param {number} [p.woundCapacity]     backpack slots (PC) or `slots` (F:698)
 * @param {number} [p.woundsHeld]        wounds already held within capacity
 * @param {boolean} [p.takesWounds]      false for a monster with no slots
 */
export function allocateDamage({
  amount = 0,
  piercing = false,
  vulnerable = false,
  vulnerableRoll = 0,
  armor = [],
  stamina = 0,
  woundCapacity = 0,
  woundsHeld = 0,
  takesWounds = true
} = {}) {
  const raw = Math.max(0, Math.floor(Number(amount) || 0));

  // R:544 — BEFORE AD. Vulnerable makes the hit bigger; it does not make it
  // piercing, so armor still eats it.
  const vulnerableBonus = vulnerable ? Math.max(0, Math.floor(Number(vulnerableRoll) || 0)) : 0;
  const total = raw + vulnerableBonus;

  let remaining = total;
  const armorResult = [];
  let absorbedByArmor = 0;

  if (!piercing) {
    for (const pool of armor) {
      const before = Math.max(0, Math.floor(Number(pool.current) || 0));
      if (before <= 0) continue;
      const absorbed = Math.min(before, remaining);
      const after = before - absorbed;
      remaining -= absorbed;
      absorbedByArmor += absorbed;
      if (absorbed > 0) {
        armorResult.push({
          id: pool.id ?? null,
          name: pool.name ?? null,
          before,
          after,
          absorbed,
          // R:508 — "When an item's AD drops to 0, the item can no longer be
          // used to stop damage." Broken means emptied by THIS hit; a pool that
          // was already 0 was skipped above and is not re-reported.
          broken: after === 0
        });
      }
      if (remaining <= 0) break;
    }
  }

  const staminaBefore = Math.max(0, Math.floor(Number(stamina) || 0));
  const staminaAbsorbed = Math.min(staminaBefore, remaining);
  const staminaAfter = staminaBefore - staminaAbsorbed;
  remaining -= staminaAbsorbed;

  const capacity = Math.max(0, Math.floor(Number(woundCapacity) || 0));
  const heldBefore = Math.max(0, Math.floor(Number(woundsHeld) || 0));
  const room = takesWounds ? Math.max(0, capacity - heldBefore) : 0;
  const woundsGained = Math.min(room, Math.max(0, remaining));
  const heldAfter = heldBefore + woundsGained;
  remaining -= woundsGained;

  // Death, decided by comparing pre-state to post-state at the mutation.
  //   with slots  — R:524, all backpack slots hold wounds
  //   without     — F:698/R:520, a Ref-controlled creature dies at 0 Stamina
  const defeatedBefore = takesWounds
    ? (capacity > 0 && heldBefore >= capacity)
    : staminaBefore <= 0;
  const defeatedAfter = takesWounds
    ? (capacity > 0 && heldAfter >= capacity)
    : staminaAfter <= 0;

  return {
    raw,
    vulnerableBonus,
    total,
    absorbed: { armor: absorbedByArmor, stamina: staminaAbsorbed, wounds: woundsGained },
    armor: armorResult,
    stamina: { before: staminaBefore, after: staminaAfter },
    wounds: { before: heldBefore, after: heldAfter, gained: woundsGained, capacity },
    // Damage with nowhere left to go: a slotless creature already at 0 Stamina,
    // or a PC whose backpack is full. Reported rather than dropped so a chat
    // card can say so.
    unallocated: Math.max(0, remaining),
    defeated: defeatedAfter,
    becameDefeated: defeatedAfter && !defeatedBefore
  };
}

/**
 * Pick which backpack slots the new wounds fill, from T1.2's Layout.
 *
 * R:524 gives the choice to the PC, so `preferred` (what they picked) wins.
 * The automatic fallback prefers EMPTY slots, because a slot holding both a
 * wound and an item costs 1 speed (R:524, reading (c)) and an empty one does
 * not — the cheapest legal placement is the right default for a player who
 * clicked through the prompt.
 *
 * @param {object} layout   a Layout from `slots.mjs`
 * @param {number} count
 * @param {object} [opts]
 * @param {number[]} [opts.preferred]  indices the player chose, in order
 * @returns {{indices: number[], short: number, occupied: number[]}}
 */
export function chooseWoundSlots(layout, count = 1, { preferred = [] } = {}) {
  const want = Math.max(0, Math.floor(Number(count) || 0));
  const backpack = (layout?.slots ?? [])
    .filter(s => s.container === "backpack" && !s.wound)
    .sort((a, b) => a.index - b.index);

  const byIndex = new Map(backpack.map(s => [s.index, s]));
  const chosen = [];

  for (const i of preferred) {
    if (chosen.length >= want) break;
    if (byIndex.has(i) && !chosen.includes(i)) chosen.push(i);
  }

  const auto = [
    ...backpack.filter(s => !(s.items?.length)),
    ...backpack.filter(s => s.items?.length)
  ];
  for (const s of auto) {
    if (chosen.length >= want) break;
    if (!chosen.includes(s.index)) chosen.push(s.index);
  }

  return {
    indices: chosen,
    short: Math.max(0, want - chosen.length),
    occupied: chosen.filter(i => byIndex.get(i)?.items?.length)
  };
}

/**
 * Degraded placement, used only when the Layout is unavailable (T1.2's helper
 * missing or throwing). Lowest free index first. Flagged by its caller so a
 * silent downgrade cannot masquerade as a player choice.
 */
export function fallbackWoundSlots(capacity, existing = [], count = 1) {
  const held = new Set([...existing].map(Number));
  const out = [];
  for (let i = 0; i < capacity && out.length < count; i++) if (!held.has(i)) out.push(i);
  return out;
}

/* ==========================================================================
 * Defeat invariant
 * ========================================================================== */

const nonNegativeInteger = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Resolve the wound capacity used by the defeat rule for one actor. */
function woundCapacityFor(actor) {
  const sys = actor?.system ?? {};
  if (actor?.type === "monster") return nonNegativeInteger(sys.slots);

  const stored = Number(sys.backpackCapacity ?? sys.capacities?.backpack);
  if (Number.isFinite(stored)) return nonNegativeInteger(stored);

  const grants = [];
  for (const item of actor?.items ?? []) {
    if (item?.type !== "trait") continue;
    grants.push(...(item.system?.slotGrants ?? []));
  }
  return nonNegativeInteger(effectiveCapacities(grants).backpack);
}

/**
 * Compute the defeat state from the actor's current wounds or Stamina.
 *
 * The boolean remains stored on `system.conditions` because it is the
 * authority mirrored to the `dead` status effect. This function is the one
 * invariant calculation every wound/Stamina mutation calls afterwards.
 */
export function defeatedForActor(actor) {
  const sys = actor?.system ?? {};
  const capacity = woundCapacityFor(actor);
  if (actor?.type === "monster" && capacity <= 0) {
    return nonNegativeInteger(sys.stamina?.value) <= 0;
  }

  const slots = sys.woundSlots == null ? [] : [...sys.woundSlots];
  const held = slots
    .map(Number)
    .filter(index => Number.isInteger(index) && index >= 0 && index < capacity)
    .length;
  return capacity > 0 && held >= capacity;
}

/** Reconcile the stored defeat boolean and its mirrored status effect. */
export async function syncDefeatedCondition(actor, { override = undefined } = {}) {
  if (!actor) return { ok: false, reason: "no actor" };
  const defeated = override === undefined ? defeatedForActor(actor) : !!override;
  const current = !!actor.system?.conditions?.defeated;
  if (current === defeated) return { ok: true, changed: false, defeated };
  const result = await setCondition(actor, "defeated", defeated);
  return { ...result, defeated };
}

/* ==========================================================================
 * Foundry-facing. Everything below touches documents.
 * ========================================================================== */

/**
 * Apply damage to an actor. AD -> Stamina -> wounds, with the Vulnerable die
 * rolled first and death adjudicated at the wound-gain mutation.
 *
 * @param {Actor} actor
 * @param {number} amount
 * @param {object} [opts]
 * @param {boolean} [opts.piercing=false]
 * @param {string}  [opts.source]
 * @param {string}  [opts.armorChoice]      armor item id to consume first
 * @param {boolean} [opts.skipDialog=false] never prompt (programmatic callers)
 * @param {number}  [opts.vulnerableRoll]   supply the 1d6 instead of rolling
 * @param {number[]} [opts.woundSlots]      the player's chosen slot indices
 */
export async function applyDamage(actor, amount, {
  piercing = false,
  source = null,
  armorChoice = null,
  skipDialog = false,
  vulnerableRoll = null,
  woundSlots: preferredSlots = null
} = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  const sys = actor.system ?? {};
  const conditions = sys.conditions ?? {};

  // R:544. Rolled up front so the player sees the die that made the hit bigger.
  const vulnerable = !!conditions.vulnerable;
  let vulnRoll = vulnerableRoll;
  if (vulnerable && vulnRoll == null) vulnRoll = await _roll1d6();

  // ---- AD pools, in consumption order -----------------------------------
  // R:508 — "If a creature has more than one source of AD ... they choose which
  // item first loses AD." For a crow that is worn armor items; a monster has a
  // single flat pool on its stat block.
  let armorItems = [];
  let armorPools = [];
  if (!piercing) {
    if (actor.type === "monster") {
      const ad = Math.max(0, sys.ad ?? 0);
      if (ad > 0) armorPools = [{ id: null, name: "AD", current: ad }];
    } else {
      const priority = { shield: 0, light: 1, medium: 2, heavy: 3 };
      armorItems = actor.items
        .filter(i => i.type === "armor" && i.system?.worn)
        .sort((a, b) => (priority[a.system.armorType] ?? 99) - (priority[b.system.armorType] ?? 99));
      const live = armorItems.filter(a => _adOf(a) > 0);
      if (live.length >= 2 && !skipDialog) {
        const pickedId = armorChoice ?? await _pickArmorDialog(actor, live);
        const picked = pickedId ? armorItems.find(a => a.id === pickedId) : null;
        if (picked) armorItems = [picked, ...armorItems.filter(a => a.id !== picked.id)];
      } else if (armorChoice) {
        const picked = armorItems.find(a => a.id === armorChoice);
        if (picked) armorItems = [picked, ...armorItems.filter(a => a.id !== picked.id)];
      }
      armorPools = armorItems.map(a => ({ id: a.id, name: a.name, current: _adOf(a) }));
    }
  }

  // ---- Wound capacity, read from derived data, never recomputed ----------
  // F:698 — monsters have no slots and die at 0 Stamina; humans and animals
  // have slots which count as backpack slots for them.
  const takesWounds = actor.type === "monster" ? ((sys.slots ?? 0) > 0) : true;
  const capacity = actor.type === "monster"
    ? (sys.slots ?? 0)
    : (sys.backpackCapacity ?? sys.capacities?.backpack ?? CROWS.carryContainers.backpack);
  const woundsHeld = sys.wounds ?? [...(sys.woundSlots ?? [])].filter(i => i < capacity).length;

  const result = allocateDamage({
    amount, piercing, vulnerable, vulnerableRoll: vulnRoll,
    armor: armorPools, stamina: sys.stamina?.value ?? 0,
    woundCapacity: capacity, woundsHeld, takesWounds
  });

  // ---- Where do the new wounds land? ------------------------------------
  let placement = { indices: [], short: 0, occupied: [], fallback: false };
  if (result.wounds.gained > 0) {
    placement = await _placeWounds(actor, result.wounds.gained, preferredSlots, skipDialog, capacity);
  }

  // ---- Writes ------------------------------------------------------------
  if (armorItems.length && result.armor.length) {
    const byId = new Map(result.armor.map(a => [a.id, a]));
    const updates = armorItems
      .filter(a => byId.has(a.id))
      .map(a => ({ _id: a.id, "system.adCurrent": byId.get(a.id).after }));
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  const updates = { "system.stamina.value": result.stamina.after };
  if (actor.type === "monster" && !piercing && result.absorbed.armor > 0) {
    // MonsterData has a single `ad` field and no adCurrent/adMax pair, so the
    // pool IS the stat-block number and consuming it is destructive. Reported
    // to the coordinator as a data-model gap.
    updates["system.ad"] = Math.max(0, (sys.ad ?? 0) - result.absorbed.armor);
  }
  if (placement.indices.length) {
    updates["system.woundSlots"] = [...new Set([...(sys.woundSlots ?? []), ...placement.indices])];
  }
  await actor.update(updates);

  // ---- Conditions, all through the canonical boolean ---------------------
  // R:554 — "If you take any damage while unconscious, you wake up and the
  // condition ends."
  if (result.total > 0 && conditions.unconscious) await setCondition(actor, "unconscious", false);
  await syncDefeatedCondition(actor);

  return {
    ok: true,
    actorType: actor.type,
    actorName: actor.name,
    source, piercing,
    ...result,
    woundSlots: placement.indices,
    woundSlotsShort: placement.short,
    woundSlotsFallback: placement.fallback,
    // R:524 reading (c): each of these costs 1 speed. slots.mjs applies the
    // penalty; this only reports which placements incurred it.
    woundSlotsWithItems: placement.occupied,
    armorBroken: result.armor.filter(a => a.broken).map(a => a.name).filter(Boolean)
  };
}

/**
 * Heal Stamina, and optionally remove wounds.
 *
 * Wounds are removed from the HIGHEST index first, which unwinds the backpack
 * in the reverse of the order it filled and never strands an orphaned index
 * below a healed one. Pass `woundSlots` to remove specific slots instead.
 */
export async function applyHealing(actor, { stamina = 0, wounds = 0, woundSlots = null, revive = false } = {}) {
  if (!actor) return { ok: false };
  const sys = actor.system ?? {};
  const updates = {};
  let vitalityBonus = 0;

  // Boon of Vitality: when regaining Stamina, expend for extra.
  if (stamina > 0 && actor.type === "crow") {
    try {
      const { consumeBoonOnHeal } = await import("./crypt.mjs");
      const r = await consumeBoonOnHeal(actor);
      vitalityBonus = r.extra || 0;
    } catch { /* crypt module not loaded */ }
  }

  if (stamina > 0) {
    const max = sys.stamina?.max ?? 0;
    updates["system.stamina.value"] = Math.min(max, (sys.stamina?.value ?? 0) + stamina + vitalityBonus);
  }

  const held = [...(sys.woundSlots ?? [])].sort((a, b) => b - a);
  let removed = [];
  if (woundSlots?.length) {
    removed = held.filter(i => woundSlots.includes(i));
  } else if (wounds > 0) {
    removed = held.slice(0, wounds);
  }
  if (removed.length) {
    updates["system.woundSlots"] = held.filter(i => !removed.includes(i));
  }

  if (Object.keys(updates).length) await actor.update(updates);

  // Reconcile after every healing write. `revive` remains an explicit escape
  // hatch for callers that intentionally clear the stored condition; ordinary
  // healing follows the same wound/Stamina invariant as damage and rest.
  await syncDefeatedCondition(actor, { override: revive ? false : undefined });

  return { ok: true, vitalityBonus, woundsRemoved: removed, ...updates };
}

/**
 * R:508 — "A PC can restore ONE item's AD as a rest activity." Singular; PT1
 * restored every worn piece at once. Defaults to the most damaged worn item.
 * Pass `all: true` only for a deliberate GM override.
 */
export async function repairArmor(actor, { itemId = null, all = false } = {}) {
  if (!actor) return { ok: false };
  const worn = actor.items.filter(i => i.type === "armor" && i.system?.worn);
  const damaged = worn.filter(a => _adOf(a) < (a.system.ad ?? 0));
  if (!damaged.length) return { ok: true, repaired: 0, items: [] };

  let targets;
  if (all) targets = damaged;
  else if (itemId) targets = damaged.filter(a => a.id === itemId);
  else targets = [damaged.sort((a, b) => (_adOf(a) - (a.system.ad ?? 0)) - (_adOf(b) - (b.system.ad ?? 0)))[0]];

  const updates = targets.filter(Boolean).map(a => ({ _id: a.id, "system.adCurrent": a.system.ad }));
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return { ok: true, repaired: updates.length, items: targets.map(a => a?.name).filter(Boolean) };
}

/* ---- internals ---------------------------------------------------------- */

/** `adCurrent` is nullable and means "never damaged" — fall back to `ad`. */
function _adOf(armor) {
  return Math.max(0, armor.system?.adCurrent ?? armor.system?.ad ?? 0);
}

async function _roll1d6() {
  const Roll = globalThis.Roll;
  if (!Roll) return 0;
  const r = await new Roll("1d6").evaluate();
  return r.total;
}

/**
 * Wound placement. Reads T1.2's Layout — this file never computes slots — and
 * only falls back if that helper is unavailable, saying so in the result.
 */
async function _placeWounds(actor, count, preferredSlots, skipDialog, capacity) {
  let layout = null;
  try {
    const slots = await import("./slots.mjs");
    if (typeof slots.layoutFor === "function") layout = slots.layoutFor(actor);
  } catch (err) {
    console.warn("crows | layoutFor unavailable, falling back to lowest free slot", err);
  }

  if (!layout) {
    const indices = fallbackWoundSlots(capacity, actor.system?.woundSlots ?? [], count);
    return { indices, short: Math.max(0, count - indices.length), occupied: [], fallback: true };
  }

  let preferred = preferredSlots;
  if (!preferred?.length && !skipDialog) preferred = await _pickWoundSlotsDialog(actor, layout, count);
  const chosen = chooseWoundSlots(layout, count, { preferred: preferred ?? [] });
  return { ...chosen, fallback: false };
}

/** Pick which armor absorbs first (R:508). Resolves to an item id, or null. */
async function _pickArmorDialog(actor, armorList) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return armorList[0]?.id ?? null;
  const rows = armorList.map((a, n) => `<label class="armor-pick-row">
      <input type="radio" name="armor-pick" value="${a.id}" ${n === 0 ? "checked" : ""}>
      <strong>${a.name}</strong> <em>(${a.system.armorType})</em> — AD ${_adOf(a)}/${a.system.ad}
    </label>`).join("");
  try {
    const result = await DialogV2.prompt({
      window: { title: "Choose Armor to Absorb" },
      content: `<div class="crows armor-pick">
        <p>${actor.name} has more than one source of AD. Choose which loses AD first:</p>${rows}
      </div>`,
      ok: {
        label: "Absorb",
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button?.form;
          return root?.querySelector?.('input[name="armor-pick"]:checked')?.value ?? armorList[0]?.id ?? null;
        }
      }
    });
    return result ?? armorList[0]?.id ?? null;
  } catch {
    return armorList[0]?.id ?? null;      // cancelled -> default priority order
  }
}

/**
 * R:524 — "Each wound they take fills up a backpack slot of the PC's choice."
 * Resolves to chosen indices, or null to let `chooseWoundSlots` decide.
 */
async function _pickWoundSlotsDialog(actor, layout, count) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (!DialogV2) return null;
  const free = (layout.slots ?? [])
    .filter(s => s.container === "backpack" && !s.wound)
    .sort((a, b) => a.index - b.index);
  if (!free.length) return null;

  const rows = free.map(s => {
    const holding = s.items?.length ? s.items.map(i => i.kind ?? i.id).join(", ") : "empty";
    const cost = s.items?.length ? " — costs 1 speed" : "";
    return `<label class="wound-pick-row">
      <input type="checkbox" name="wound-slot" value="${s.index}">
      Backpack ${s.index + 1} <em>(${holding})</em>${cost}
    </label>`;
  }).join("");

  try {
    return await DialogV2.prompt({
      window: { title: `Place ${count} Wound${count === 1 ? "" : "s"}` },
      content: `<div class="crows wound-pick">
        <p>${actor.name} takes ${count} wound${count === 1 ? "" : "s"}. Choose which backpack slot${count === 1 ? "" : "s"} they fill.</p>
        <p class="hint">A slot holding both a wound and an item costs 1 speed (R:524).</p>${rows}
      </div>`,
      ok: {
        label: "Take Wounds",
        callback: (event, button, dialog) => {
          const root = dialog?.element ?? button?.form;
          const picked = [...(root?.querySelectorAll?.('input[name="wound-slot"]:checked') ?? [])];
          return picked.map(el => Number(el.value)).slice(0, count);
        }
      }
    });
  } catch {
    return null;                          // cancelled -> automatic placement
  }
}

/**
 * One `<li>` of the "Damage applied" chat summary.
 *
 * Extracted from the inline builder in `crows.mjs` so it can be tested. It was
 * inline, and two of its branches had been dead for a long time without anyone
 * noticing: the Crow branch read `r.dead` and the boned note read
 * `r.bonedBonus`, neither of which `applyDamage` returns. The Crow summary
 * therefore never printed `(dead)` even when the actor was defeated and the
 * token had been given the skull, which reads as "the damage did not kill
 * them" — the opposite of what happened.
 *
 * `defeated` is the canonical boolean for both Actor types (`damage.mjs`
 * computes it, `syncDefeatedCondition` maintains it). Only the WORD differs:
 * a monster is *defeated*, a Crow is *dead*, which is the one id where the two
 * status vocabularies diverge (`combat.mjs`).
 */
export function damageSummaryLine(result) {
  if (!result?.ok) return "";
  const name = result.actorName ?? "Unknown";
  if (result.actorType === "monster") {
    const defeated = result.defeated ? " <em>(defeated)</em>" : "";
    return `<li><b>${name}</b>: ${result.total} → Stamina ${result.stamina.before}→${result.stamina.after}${defeated}</li>`;
  }
  const parts = [];
  if (result.absorbed?.armor) parts.push(`armor ${result.absorbed.armor}`);
  if (result.absorbed?.stamina) parts.push(`stamina ${result.absorbed.stamina}`);
  if (result.absorbed?.wounds) parts.push(`wounds ${result.absorbed.wounds}`);
  const broken = result.armorBroken?.length ? ` <em>broken: ${result.armorBroken.join(", ")}</em>` : "";
  const dead = result.defeated ? " <strong>(dead)</strong>" : "";
  return `<li><b>${name}</b>: ${result.total} → ${parts.join(" · ") || "no effect"}${broken}${dead}</li>`;
}
