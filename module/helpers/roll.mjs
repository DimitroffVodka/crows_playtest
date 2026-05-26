import { CROWS } from "../config.mjs";

export function classifyTier(total) {
  if (total <= CROWS.tiers.t1Max) return 1;
  if (total <= CROWS.tiers.t2Max) return 2;
  return 3;
}

export function classifyDoomCrit(rawSum) {
  return {
    doom: CROWS.doomFaces.includes(rawSum),
    crit: CROWS.critFaces.includes(rawSum)
  };
}

/**
 * Roll a Crows test.
 *
 * Auto-applies the Blessed/Boned net modifier whenever the actor has either
 * condition: each net level is ±1 on the test (Blessed +, Boned −). The
 * modifier is shown in the chat card so the player can see why the result
 * shifted. Caller-supplied `mods` are concatenated unchanged.
 */
export async function rollTest({ actor, characteristic = null, skill = null, mods = [], flavor = "Test", attack = null, casting = null } = {}) {
  // ----- Auto-doom: an unconscious crow making an Agility or Strength test
  //       automatically gets a tier-1 doom result with no roll. (Rules p.9)
  if (actor?.type === "crow" && actor.system?.conditions?.unconscious
      && (characteristic === "agility" || characteristic === "strength")) {
    return _autoDoom(actor, characteristic, skill, flavor, attack, casting, "unconscious");
  }

  const charVal = characteristic ? (actor?.system.characteristics?.[characteristic]?.value ?? actor?.system.characteristics?.[characteristic] ?? 0) : 0;
  const skillBonus = skill ? (actor?.system.skills?.[skill]?.bonus ?? 0) : 0;

  // ----- Auto modifiers from conditions -----
  const allMods = [...mods];
  if (actor?.type === "crow") {
    const c = actor.system?.conditions ?? {};
    // Blessed/Boned net mod on every test.
    const net = (c.blessed ?? 0) - (c.boned ?? 0);
    if (net !== 0) {
      const label = net > 0 ? `blessed ${c.blessed}` : `boned ${c.boned}`;
      allMods.push({ value: net, label });
    }
    // Unconscious: -4 on Mind tests to notice surroundings (we apply broadly to all Mind tests).
    if (c.unconscious && characteristic === "mind") {
      allMods.push({ value: -4, label: "unconscious" });
    }
    // Prone: -1 on melee attacks. We rely on attack.isMelee being passed by the caller.
    if (c.prone && attack?.isMelee) {
      allMods.push({ value: -1, label: "prone (melee)" });
    }
  }

  const flat = allMods.reduce((a, m) => a + (m.value ?? 0), 0);
  const formula = `2d10 + ${charVal} + ${skillBonus} + ${flat}`;
  const roll = await new Roll(formula).evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;
  const tier = classifyTier(roll.total);
  const { doom, crit } = classifyDoomCrit(rawSum);

  const data = {
    flavor, tier, doom, crit, total: roll.total, rawSum,
    char: characteristic, charVal, skill, skillBonus,
    mods: allMods,                  // for chat-card display
    attack, casting,
    bandLabel: tier === 1 ? "≤11 (Tier 1)" : tier === 2 ? "12–16 (Tier 2)" : "17+ (Tier 3)"
  };
  const content = await foundry.applications.handlebars.renderTemplate("systems/crows/templates/chat/test-card.hbs", data);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor, content }, { rollMode: game.settings.get("core", "rollMode") });
  return { roll, tier, doom, crit };
}

/**
 * Synthesize a tier-1 doom result without rolling. Used when a condition
 * (e.g. Unconscious + Agi/Str) mandates an automatic doom.
 */
async function _autoDoom(actor, characteristic, skill, flavor, attack, casting, reason) {
  const data = {
    flavor, tier: 1, doom: true, crit: false, total: null, rawSum: null,
    char: characteristic, charVal: 0, skill, skillBonus: 0,
    mods: [{ value: 0, label: `auto-doom (${reason})` }],
    attack, casting,
    bandLabel: `Auto-doom (${reason})`
  };
  const content = await foundry.applications.handlebars.renderTemplate("systems/crows/templates/chat/test-card.hbs", data);
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor,
    content
  });
  return { roll: null, tier: 1, doom: true, crit: false, autoDoom: true, reason };
}
