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

  // Char advancement: 1st at 5000, 2nd at 15000, then every 15000 after.
  // 5000→1, 15000→2, 30000→3, 45000→4, …
  let char = 0;
  if (txp >= 5000) char = 1;
  if (txp >= 15000) char = 1 + 1 + Math.floor((txp - 15000) / 15000);
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

/**
 * Available unspent advancement bonuses for an actor (skill/stam vs char).
 */
export function bonusesAvailable(actor) {
  const earned = bonusesEarned(actor.system?.xp?.txp ?? 0);
  return {
    skill: Math.max(0, earned.skill - (actor.system?.xp?.skillBonusesSpent ?? 0)),
    char:  Math.max(0, earned.char  - (actor.system?.xp?.charBonusesSpent  ?? 0))
  };
}

/**
 * Apply a single skill/stamina advancement bonus per one of the rules options:
 *   "twoSkills":  { skillA, skillB } — each +1, capped at +2
 *   "stamina4":   +4 Stamina max
 *   "skillStam":  { skill } — +1 skill (capped +2) and +2 Stamina max
 * Increments skillBonusesSpent on success.
 */
export async function spendSkillBonus(actor, option, { skillA, skillB, skill } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const avail = bonusesAvailable(actor);
  if (avail.skill <= 0) {
    ui.notifications?.warn(`${actor.name} has no skill/stamina bonuses available.`);
    return { ok: false, error: "none available" };
  }
  const updates = {};
  if (option === "twoSkills") {
    if (!skillA || !skillB || skillA === skillB) return { ok: false, error: "need two distinct skills" };
    const bonusA = actor.system?.skills?.[skillA]?.bonus ?? 0;
    const bonusB = actor.system?.skills?.[skillB]?.bonus ?? 0;
    updates[`system.skills.${skillA}.bonus`] = Math.min(2, bonusA + 1);
    updates[`system.skills.${skillB}.bonus`] = Math.min(2, bonusB + 1);
  } else if (option === "stamina4") {
    const stamMax = actor.system?.stamina?.max ?? 0;
    updates["system.stamina.max"] = stamMax + 4;
  } else if (option === "skillStam") {
    if (!skill) return { ok: false, error: "need skill" };
    const cur = actor.system?.skills?.[skill]?.bonus ?? 0;
    updates[`system.skills.${skill}.bonus`] = Math.min(2, cur + 1);
    updates["system.stamina.max"] = (actor.system?.stamina?.max ?? 0) + 2;
  } else {
    return { ok: false, error: "unknown option" };
  }
  updates["system.xp.skillBonusesSpent"] = (actor.system?.xp?.skillBonusesSpent ?? 0) + 1;
  await actor.update(updates);

  const summary = option === "twoSkills" ? `+1 ${skillA}, +1 ${skillB}`
                : option === "stamina4"  ? "+4 Stamina max"
                : `+1 ${skill}, +2 Stamina max`;
  await ChatMessage.create({
    content: `<div class="crows adv-spend"><strong>${actor.name}</strong> spends a skill/stam advancement: ${summary}</div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true };
}

/**
 * Apply a single characteristic advancement:
 *   - normal: +1 to one of agility/mind/strength (capped at 3)
 *   - if all three are 3 already, +4 Stamina instead
 * Increments charBonusesSpent on success.
 */
export async function spendCharBonus(actor, characteristic = null) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const avail = bonusesAvailable(actor);
  if (avail.char <= 0) {
    ui.notifications?.warn(`${actor.name} has no characteristic advancements available.`);
    return { ok: false, error: "none available" };
  }
  const c = actor.system?.characteristics ?? {};
  const allMax = (c.agility?.value ?? 0) >= 3 && (c.mind?.value ?? 0) >= 3 && (c.strength?.value ?? 0) >= 3;
  const updates = {};
  let summary;
  if (allMax) {
    updates["system.stamina.max"] = (actor.system?.stamina?.max ?? 0) + 4;
    summary = "all chars at 3 → +4 Stamina max instead";
  } else {
    if (!characteristic || !["agility","mind","strength"].includes(characteristic))
      return { ok: false, error: "need characteristic" };
    const cur = c[characteristic]?.value ?? 0;
    if (cur >= 3) return { ok: false, error: `${characteristic} already at 3` };
    updates[`system.characteristics.${characteristic}.value`] = cur + 1;
    summary = `+1 ${characteristic} (now ${cur + 1})`;
  }
  updates["system.xp.charBonusesSpent"] = (actor.system?.xp?.charBonusesSpent ?? 0) + 1;
  await actor.update(updates);
  await ChatMessage.create({
    content: `<div class="crows adv-spend"><strong>${actor.name}</strong> spends a characteristic advancement: ${summary}</div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true };
}
