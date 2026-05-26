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
  const charVal = characteristic ? (actor?.system.characteristics?.[characteristic]?.value ?? actor?.system.characteristics?.[characteristic] ?? 0) : 0;
  const skillBonus = skill ? (actor?.system.skills?.[skill]?.bonus ?? 0) : 0;

  // Auto blessed/boned net modifier on the actor's tests.
  const allMods = [...mods];
  if (actor?.type === "crow") {
    const blessed = actor.system?.conditions?.blessed ?? 0;
    const boned = actor.system?.conditions?.boned ?? 0;
    const net = blessed - boned;
    if (net !== 0) {
      const label = net > 0 ? `blessed ${blessed}` : `boned ${boned}`;
      allMods.push({ value: net, label });
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
