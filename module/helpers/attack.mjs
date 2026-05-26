/**
 * PC weapon attack workflow.
 *
 * Builds an attack from a weapon item:
 *   - characteristic = weapon.attackStat (or higher of A/S if "either")
 *   - skill = weapon.type (Bashing/Bow/Chopping/Slashing/Stabbing/Unarmed)
 *   - isMelee = range.melee > 0
 *   - damage values t2/t3 evaluated from the formula strings ("3 + S",
 *     "2 + A or S", etc.) against the actor's characteristics
 *   - piercing flag propagates to the chat-card Apply buttons
 */

import { rollTest } from "./roll.mjs";

/**
 * Substitute A/S/M and "A or S" tokens into a damage formula and evaluate.
 * Returns an integer; on failure, returns the substituted-but-unevaluated
 * string so the chat card still shows something useful.
 */
function evalDamage(formula, actor) {
  if (typeof formula !== "string") return 0;
  const c = actor.system?.characteristics ?? {};
  const a = c.agility?.value ?? 0;
  const s = c.strength?.value ?? 0;
  const m = c.mind?.value ?? 0;
  let f = String(formula).trim();
  if (!f) return 0;
  // Compound first ("A or S" → max), then singles
  f = f.replace(/\bA\s+or\s+S\b/gi, String(Math.max(a, s)));
  f = f.replace(/\bA\b/g, String(a));
  f = f.replace(/\bS\b/g, String(s));
  f = f.replace(/\bM\b/g, String(m));
  try {
    const v = Roll.safeEval(f);
    return Number.isFinite(v) ? v : f;
  } catch {
    return f;
  }
}

/**
 * @param {Actor} actor   The wielder.
 * @param {Item}  weapon  A weapon item (item.type === "weapon").
 */
export async function attackWithWeapon(actor, weapon) {
  if (!actor || !weapon) return { ok: false, error: "missing args" };
  if (weapon.type !== "weapon") return { ok: false, error: "not a weapon" };
  if (actor.type === "crow" && actor.system?.conditions?.unconscious) {
    ui.notifications?.warn(`${actor.name} is unconscious and cannot attack.`);
    return { ok: false, error: "unconscious" };
  }
  const sys = weapon.system ?? {};

  // Resolve the attack characteristic.
  let characteristic;
  if (sys.attackStat === "agility") characteristic = "agility";
  else if (sys.attackStat === "strength") characteristic = "strength";
  else {
    const a = actor.system?.characteristics?.agility?.value ?? 0;
    const s = actor.system?.characteristics?.strength?.value ?? 0;
    characteristic = a >= s ? "agility" : "strength";
  }

  // Determine skill and range info.
  const skill = sys.type;
  const isMelee = (sys.range?.melee ?? 0) > 0 && (sys.range?.ranged ?? 0) === 0;
  // "Versatile" weapons (melee>0 && ranged>0): we default to melee here; future
  // UI may prompt for thrown.

  const t2val = evalDamage(sys.damage?.t2, actor);
  const t3val = evalDamage(sys.damage?.t3, actor);

  return await rollTest({
    actor,
    characteristic,
    skill,
    flavor: `${actor.name} attacks with ${weapon.name}`,
    attack: {
      t2: t2val,
      t3: t3val,
      isMelee,
      piercing: !!sys.piercing,
      weaponName: weapon.name
    }
  });
}
