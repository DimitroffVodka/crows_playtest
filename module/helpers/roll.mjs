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

export async function rollTest({ actor, characteristic = null, skill = null, mods = [], flavor = "Test", attack = null, casting = null } = {}) {
  const charVal = characteristic ? (actor?.system.characteristics?.[characteristic]?.value ?? actor?.system.characteristics?.[characteristic] ?? 0) : 0;
  const skillBonus = skill ? (actor?.system.skills?.[skill]?.bonus ?? 0) : 0;
  const flat = mods.reduce((a, m) => a + (m.value ?? 0), 0);
  const formula = `2d10 + ${charVal} + ${skillBonus} + ${flat}`;
  const roll = await new Roll(formula).evaluate();
  const d10s = roll.dice.find(d => d.faces === 10);
  const rawSum = d10s ? d10s.results.reduce((a, r) => a + r.result, 0) : roll.total;
  const tier = classifyTier(roll.total);
  const { doom, crit } = classifyDoomCrit(rawSum);

  const data = {
    flavor, tier, doom, crit, total: roll.total, rawSum,
    char: characteristic, charVal, skill, skillBonus,
    attack, casting,
    bandLabel: tier === 1 ? "≤11 (Tier 1)" : tier === 2 ? "12–16 (Tier 2)" : "17+ (Tier 3)"
  };
  const content = await foundry.applications.handlebars.renderTemplate("systems/crows/templates/chat/test-card.hbs", data);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor, content }, { rollMode: game.settings.get("core", "rollMode") });
  return { roll, tier, doom, crit };
}
