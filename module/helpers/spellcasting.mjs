/**
 * Spell casting orchestrator.
 *
 * Per the rules (Rules Booklet pp.23–24):
 *  - A casting is a Mind test plus the matching spellcasting skill.
 *  - On Doom: backlash triggers immediately. The caster still rolls UD.
 *  - On Tier-1 non-doom: Chaos Count += 1d6 + rank; if CC ≥ 13 → backlash + reset.
 *  - On Crit: the spellbook's UD is NOT rolled.
 *  - Otherwise: roll the spellbook's UD normally; on a 1 or 2 it depletes.
 *  - The effect text from the matching tier band is posted for narration.
 */

import { rollTest } from "./roll.mjs";
import { rollUsageDie } from "./usage-die.mjs";
import { addToChaos, setChaos } from "./chaos.mjs";
import { rollBacklash } from "./backlash.mjs";

/**
 * @param {Actor} actor       The caster.
 * @param {Item}  spellbook   A spellbook item (item.type === "spellbook").
 * @param {object} [opts]
 * @returns {Promise<{ok, tier?, doom?, crit?, udResult?, chaos?, backlash?, error?}>}
 */
export async function castSpell(actor, spellbook /*, opts = {} */) {
  if (!actor) return { ok: false, error: "no caster" };
  if (!spellbook || spellbook.type !== "spellbook") return { ok: false, error: "not a spellbook" };

  // Hard rules-gate: unconscious can't take actions.
  if (actor.type === "crow" && actor.system?.conditions?.unconscious) {
    ui.notifications?.warn(`${actor.name} is unconscious and cannot cast.`);
    return { ok: false, error: "unconscious" };
  }

  const sys = spellbook.system ?? {};
  const ud = sys.usageDie ?? {};
  if (ud.enabled && (ud.udCurrent ?? 0) <= 0) {
    ui.notifications?.warn(`${spellbook.name} has no usage dice remaining (rest to restore).`);
    return { ok: false, error: "no UD" };
  }

  const rank = Math.max(0, Number(sys.rank) || 0);
  const discipline = sys.discipline ?? "elemental";

  const flavor = `${actor.name} casts ${spellbook.name} (R${rank} ${discipline})`;
  const rollRes = await rollTest({
    actor,
    characteristic: "mind",
    skill: discipline,
    flavor,
    casting: { rank, discipline, spellbookName: spellbook.name }
  });

  const out = { ok: true, tier: rollRes.tier, doom: !!(rollRes.doom || rollRes.autoDoom), crit: !!rollRes.crit };

  // --------- Outcome routing ---------
  if (out.doom) {
    out.backlash = await rollBacklash(rank, { cause: "doom", actor });
    // UD still rolls on doom (unless crit, but doom and crit are mutually exclusive).
    if (!out.crit) out.udResult = await rollUsageDie(spellbook);
  } else if (out.tier === 1) {
    // Tier-1 non-doom: add 1d6 + rank to chaos.
    const chaosRoll = await new Roll(`1d6 + ${rank}`).evaluate();
    const added = chaosRoll.total;
    const chaos = await addToChaos(added);
    out.chaos = { added, before: chaos.before, after: chaos.after };
    if (chaos.threshold) {
      out.backlash = await rollBacklash(rank, { cause: `chaos reached ${chaos.after}`, actor });
      await setChaos(0);
      out.chaos.resetTo = 0;
    }
    if (!out.crit) out.udResult = await rollUsageDie(spellbook);
  } else {
    // Tier 2 / Tier 3 success. Crit skips UD.
    if (!out.crit) out.udResult = await rollUsageDie(spellbook);
  }

  // --------- Effect narration ---------
  const bands = sys.effectBands ?? {};
  const tierKey = out.tier === 1 ? "t1" : out.tier === 2 ? "t2" : "t3";
  const tierEffect = (bands[tierKey] || "").trim();
  if (tierEffect && !out.doom) {           // doom → backlash replaces effect
    await ChatMessage.create({
      content: `<div class="crows spell-effect">
        <header><strong>${spellbook.name}</strong> — tier ${out.tier} effect</header>
        <div class="se-text">${tierEffect}</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }

  return out;
}
