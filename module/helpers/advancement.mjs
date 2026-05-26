/**
 * Advancement & trait purchase helpers.
 *
 * Rules Booklet:
 *  - Two XP trackers: TXP (lifetime, never decreases) + spendable XP.
 *  - Earning XP: returning to village + finishing a rest, loot ÷ players.
 *  - Skill/Stamina advancement bonus thresholds (TXP): 100, 500, 1250, 2250,
 *    3500, 5000, then every 5000 thereafter.
 *  - Characteristics advancement: 5000 first, +15000 each thereafter; +1 each
 *    (max 3); if all three are already 3, gain 4 Stamina instead.
 *  - Trait purchase: tier 1 starting OR connected by a line to a trait you
 *    already own in the same tree. Cost = 500/1000/1500/2000 by tier.
 */

import { CROWS } from "../config.mjs";

const SKILL_STAM_THRESHOLDS = [100, 500, 1250, 2250, 3500, 5000];

export function bonusesEarned(txp) {
  txp = Math.max(0, Number(txp) || 0);
  let skill = 0;
  for (const t of SKILL_STAM_THRESHOLDS) if (txp >= t) skill++;
  if (txp > 5000) skill += Math.floor((txp - 5000) / 5000);

  let char = 0;
  if (txp >= 5000) char = 1;
  if (txp >= 15000) char = 1 + Math.floor((txp - 5000) / 15000);   // 5000 + 15000=20000 → 2; 5000 + 30000=35000 → 3; etc.
  // Note: the 1st is 5000, then every 15000 after that (15k step from the 1st)
  return { skill, char };
}

export function nextBonusTXP(txp) {
  txp = Math.max(0, Number(txp) || 0);
  for (const t of SKILL_STAM_THRESHOLDS) if (t > txp) return t;
  return (Math.floor(txp / 5000) + 1) * 5000;
}

export async function gainXP(actor, amount, { silent = false } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  amount = Math.floor(Number(amount) || 0);
  if (!amount) return { ok: false, error: "zero amount" };
  const sys = actor.system ?? {};
  const txpBefore = sys.xp?.txp ?? 0;
  const spendBefore = sys.xp?.spendable ?? 0;
  const txpAfter = Math.max(0, txpBefore + amount);
  const spendAfter = Math.max(0, spendBefore + amount);
  await actor.update({
    "system.xp.txp": txpAfter,
    "system.xp.spendable": spendAfter
  });

  if (!silent) {
    const bonusesBefore = bonusesEarned(txpBefore);
    const bonusesAfter = bonusesEarned(txpAfter);
    const skillDelta = bonusesAfter.skill - bonusesBefore.skill;
    const charDelta = bonusesAfter.char - bonusesBefore.char;
    const deltas = [];
    if (skillDelta > 0) deltas.push(`+${skillDelta} skill/stamina advancement bonus${skillDelta > 1 ? "es" : ""}`);
    if (charDelta > 0) deltas.push(`+${charDelta} characteristic advancement`);
    const deltaLine = deltas.length ? `<div class="adv-delta"><strong>New:</strong> ${deltas.join(", ")}</div>` : "";
    await ChatMessage.create({
      content: `<div class="crows xp-gain">
        <header><strong>${actor.name}</strong> gains <strong>${amount} XP</strong></header>
        <div>TXP: ${txpBefore} → ${txpAfter} · Spendable: ${spendBefore} → ${spendAfter}</div>
        ${deltaLine}
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }
  return { ok: true, txp: txpAfter, spendable: spendAfter };
}

/**
 * Is `trait` buyable for `actor`?
 *   - tier-1 starting traits: always buyable.
 *   - otherwise: an edge (bidirectional `connectsTo`) to an owned trait in
 *     the same tree.
 *
 * Returns { ok: bool, reason: string }.
 */
export function isTraitBuyable(actor, trait) {
  if (!actor || !trait) return { ok: false, reason: "no trait" };
  const sys = trait.system ?? {};
  // Already owned? (by name match — trait IDs differ between compendium and embedded copy)
  if (actor.items.some(i => i.type === "trait" && i.name === trait.name && i.system?.tree === sys.tree)) {
    return { ok: false, reason: "already owned" };
  }
  // Tier 1 starting trait: always buyable.
  if (sys.tier === 1 && sys.isStarting) return { ok: true, reason: "starting" };
  // Same-tree connection: bidirectional check.
  const ownedInTree = actor.items.filter(i => i.type === "trait" && i.system?.tree === sys.tree);
  const myConn = sys.connectsTo ?? [];
  for (const owned of ownedInTree) {
    const otherConn = owned.system?.connectsTo ?? [];
    if (otherConn.includes(trait.name)) return { ok: true, reason: `connected from ${owned.name}` };
    if (myConn.includes(owned.name)) return { ok: true, reason: `connects to owned ${owned.name}` };
  }
  return { ok: false, reason: "no connecting owned trait" };
}

/**
 * Purchase a trait — validates, deducts spendable XP, creates embedded item.
 * `trait` is a compendium (or any source) trait document.
 */
export async function purchaseTrait(actor, trait) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (!trait || trait.type !== "trait") return { ok: false, error: "not a trait" };

  const check = isTraitBuyable(actor, trait);
  if (!check.ok) {
    ui.notifications?.warn(`Cannot buy ${trait.name}: ${check.reason}.`);
    return { ok: false, reason: check.reason };
  }

  const cost = CROWS.traitTierXP[trait.system?.tier] ?? 0;
  const spendBefore = actor.system?.xp?.spendable ?? 0;
  if (spendBefore < cost) {
    ui.notifications?.warn(`Not enough XP for ${trait.name}: need ${cost}, have ${spendBefore}.`);
    return { ok: false, reason: "insufficient XP" };
  }

  // Create the trait item on the actor (toObject strips _id so a fresh id is assigned)
  const itemData = trait.toObject ? trait.toObject() : { ...trait };
  delete itemData._id;
  delete itemData._key;
  await actor.createEmbeddedDocuments("Item", [itemData]);
  await actor.update({ "system.xp.spendable": spendBefore - cost });

  await ChatMessage.create({
    content: `<div class="crows trait-purchase">
      <strong>${actor.name}</strong> learns <strong>${trait.name}</strong>
      <em>(${trait.system.tree} t${trait.system.tier} · ${cost} XP spent · ${spendBefore - cost} left)</em>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, cost, remainingXP: spendBefore - cost };
}
