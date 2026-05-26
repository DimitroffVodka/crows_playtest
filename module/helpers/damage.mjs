/**
 * Damage application — Crows rules:
 *   AD (armor) → Stamina → Wounds. Piercing bypasses AD.
 *   Boned levels add cumulative +1 damage *taken* per net boned level.
 *   Wounds occupy backpack slots; 10 wounds = dead.
 *   When a worn armor's adCurrent reaches 0 it is "broken" (auto-flagged
 *   true; no AD until repaired as a rest activity).
 *
 *   Monsters: simple Stamina pool; 0 = defeated.
 */

import { CROWS } from "../config.mjs";

/**
 * @param {Actor} actor
 * @param {number} amount  Raw damage *before* Boned modifier.
 * @param {object} [opts]
 * @param {boolean} [opts.piercing=false]   Bypass AD.
 * @param {string}  [opts.source]            Optional label for chat output.
 * @returns {Promise<object>} Structured result for chat/log display.
 */
export async function applyDamage(actor, amount, { piercing = false, source = null } = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  const sys = actor.system ?? {};

  // Boned cumulative bonus damage taken (per the rules: "you take additional
  // damage equal to each boned level you have"). Use NET boned (blessed cancels).
  const blessed = sys.conditions?.blessed ?? 0;
  const boned = sys.conditions?.boned ?? 0;
  const netBoned = Math.max(0, boned - blessed);
  const bonedBonus = netBoned;                // each net level = +1 dmg
  const total = amount + bonedBonus;

  // ---- Monster: simple Stamina ----
  if (actor.type === "monster") {
    const stamBefore = sys.stamina?.value ?? 0;
    const stamAfter = Math.max(0, stamBefore - total);
    await actor.update({ "system.stamina.value": stamAfter });
    return {
      ok: true,
      actorType: "monster",
      actorName: actor.name,
      rawAmount: amount,
      bonedBonus,
      total,
      absorbed: { armor: 0, stamina: stamBefore - stamAfter, wounds: 0 },
      stamina: { before: stamBefore, after: stamAfter },
      defeated: stamAfter === 0,
      piercing, source
    };
  }

  // ---- Crow: AD → Stamina → Wounds ----
  let remaining = total;
  let absorbedByArmor = 0;
  const armorUpdates = [];

  if (!piercing) {
    // Multi-armor priority: shield (outermost) → light → medium → heavy.
    // Per rules a creature with multiple AD sources chooses which loses AD
    // first; default to outermost-layer-first. Unknown types fall to end.
    const armorPriority = { shield: 0, light: 1, medium: 2, heavy: 3 };
    const wornArmor = actor.items
      .filter(i => i.type === "armor" && i.system.worn)
      .sort((a, b) => (armorPriority[a.system.armorType] ?? 99) - (armorPriority[b.system.armorType] ?? 99));
    for (const armor of wornArmor) {
      if (remaining <= 0) break;
      const cur = armor.system.adCurrent ?? armor.system.ad ?? 0;
      if (cur <= 0) continue;
      const absorbed = Math.min(cur, remaining);
      absorbedByArmor += absorbed;
      remaining -= absorbed;
      armorUpdates.push({ _id: armor.id, "system.adCurrent": cur - absorbed });
    }
  }

  const stamBefore = sys.stamina?.value ?? 0;
  const stamAbsorbed = Math.min(stamBefore, remaining);
  const stamAfter = stamBefore - stamAbsorbed;
  remaining -= stamAbsorbed;

  const woundsBefore = sys.wounds ?? 0;
  const cap = CROWS.backpackSize;
  const woundsAdded = Math.min(cap - woundsBefore, Math.max(0, remaining));
  const woundsAfter = woundsBefore + woundsAdded;

  if (armorUpdates.length) await actor.updateEmbeddedDocuments("Item", armorUpdates);
  await actor.update({
    "system.stamina.value": stamAfter,
    "system.wounds": woundsAfter
  });

  return {
    ok: true,
    actorType: "crow",
    actorName: actor.name,
    rawAmount: amount,
    bonedBonus,
    total,
    absorbed: { armor: absorbedByArmor, stamina: stamAbsorbed, wounds: woundsAdded },
    stamina: { before: stamBefore, after: stamAfter },
    wounds: { before: woundsBefore, after: woundsAfter },
    dead: woundsAfter >= cap,
    piercing, source,
    armorBroken: armorUpdates
      .filter(u => u["system.adCurrent"] === 0)
      .map(u => actor.items.get(u._id)?.name)
      .filter(Boolean)
  };
}

/**
 * Heal a crow: restore Stamina up to max, then optionally remove wounds.
 * @param {Actor} actor
 * @param {object} [opts]
 * @param {number} [opts.stamina=0]        Amount of Stamina to restore.
 * @param {number} [opts.wounds=0]          Wound count to remove.
 */
export async function applyHealing(actor, { stamina = 0, wounds = 0 } = {}) {
  if (!actor) return { ok: false };
  const sys = actor.system ?? {};
  const updates = {};
  if (stamina > 0) {
    const max = sys.stamina?.max ?? 0;
    const next = Math.min(max, (sys.stamina?.value ?? 0) + stamina);
    updates["system.stamina.value"] = next;
  }
  if (wounds > 0) {
    updates["system.wounds"] = Math.max(0, (sys.wounds ?? 0) - wounds);
  }
  if (Object.keys(updates).length) await actor.update(updates);
  return { ok: true, ...updates };
}

/**
 * Repair worn armor (a Rest activity in the rules). Restores adCurrent to ad.
 */
export async function repairArmor(actor) {
  if (!actor) return { ok: false };
  const worn = actor.items.filter(i => i.type === "armor" && i.system.worn);
  const updates = worn.map(a => ({ _id: a.id, "system.adCurrent": a.system.ad }));
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return { ok: true, repaired: updates.length };
}
