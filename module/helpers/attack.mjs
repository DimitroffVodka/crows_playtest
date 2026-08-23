/**
 * Weapon attacks — Playtest 2.
 *
 * Assembles an attack from a weapon item and hands it to T1.1's `rollTest`.
 * This file owns NO tier logic and NO damage application: it builds the roll's
 * inputs, and `combat.mjs` reads the COMMITTED result back out.
 *
 * WHAT CHANGED FROM PT1, and why each one is not cosmetic:
 *
 *  - `skill` is gone. PT1 passed a skill name and `rollTest` added a stored
 *    bonus before the roll. PT2 expertises are a post-roll SPEND (R:292), so the
 *    weapon's type reaches the pipeline as `attack.weaponType` and gates which
 *    expertise may be spent — it is never a pre-roll number.
 *  - Conditions are edges and banes, not ±1 mods (R:286 keeps the channels
 *    separate). This file emits NONE of them: `rollTest` derives the roller's
 *    and each target's own condition labels itself, and emitting them here too
 *    would double-count a channel that clamps at two.
 *  - Multi-target is real (R:961): one roll, per-target tiers.
 *  - Nothing here reads a tier. A weapon expertise can convert a miss into a
 *    hit, so the outcome is read on `crowsTestCommitted` — see combat.mjs.
 */

import { rollTest } from "./roll.mjs";
import { buildAttackLabels, targetRef } from "./combat.mjs";

/**
 * Substitute A/S/M into a damage formula and evaluate it.
 *
 * Returns an integer, or — when the formula will not evaluate — the substituted
 * string, so the card still shows something truthful instead of NaN.
 */
export function evalDamage(formula, actor) {
  if (typeof formula !== "string") return 0;
  const c = actor?.system?.characteristics ?? {};
  const a = c.agility?.value ?? 0;
  const s = c.strength?.value ?? 0;
  const m = c.mind?.value ?? 0;
  let f = String(formula).trim();
  if (!f) return 0;
  // Compound first ("A or S" -> the better of the two), then the singles.
  f = f.replace(/\bA\s+or\s+S\b/gi, String(Math.max(a, s)));
  f = f.replace(/\bA\b/g, String(a));
  f = f.replace(/\bS\b/g, String(s));
  f = f.replace(/\bM\b/g, String(m));

  // Every published weapon formula is "<n> + <characteristic>", which after
  // substitution is plain integer addition. Summing it directly keeps the whole
  // damage path pure and unit-testable; `Roll.safeEval` is the fallback for
  // anything more exotic and needs a live Foundry.
  const sum = _sumIntegers(f);
  if (sum != null) return sum;

  try {
    const v = globalThis.Roll?.safeEval?.(f);
    return Number.isFinite(v) ? v : f;
  } catch {
    return f;
  }
}

/**
 * Sum "3 + -1 + 2", or null if the string is anything but signed integers.
 *
 * The double signs are not hypothetical: R:174 allows a characteristic of -5, so
 * "3 + S" substitutes to "3 + -5" for a drained crow and must come out as -2,
 * not as an unevaluated string on the chat card.
 */
function _sumIntegers(f) {
  const strip = (s) => s.replace(/\s+/g, "");
  const normalised = strip(f)
    .replace(/\+-|-\+/g, "-")
    .replace(/--/g, "+")
    .replace(/\+\+/g, "+");
  const tokens = normalised.match(/[+-]?\d+/g);
  if (!tokens) return null;
  if (tokens.join("") !== normalised) return null;
  return tokens.reduce((a, t) => a + Number(t), 0);
}

/**
 * Which characteristic tests this weapon. `either` (the "A or S" weapons) takes
 * the better of the two, which is what the formula does for damage.
 */
export function attackCharacteristic(actor, weapon) {
  const stat = weapon?.system?.attackStat;
  if (stat === "agility" || stat === "strength") return stat;
  const a = actor?.system?.characteristics?.agility?.value ?? 0;
  const s = actor?.system?.characteristics?.strength?.value ?? 0;
  return a >= s ? "agility" : "strength";
}

/**
 * Is this attack melee?
 *
 * R:993 — a thrown weapon has both ranges and "you decide BEFORE you make the
 * test if it is melee or ranged", so the caller's choice wins and the weapon's
 * own ranges only supply the default. A melee-only weapon is ranged 0 (R:941).
 */
export function isMeleeAttack(weapon, { thrown = null } = {}) {
  const range = weapon?.system?.range ?? {};
  const melee = range.melee ?? 0;
  const ranged = range.ranged ?? 0;
  if (thrown != null) return !thrown;
  if (melee > 0 && ranged > 0) return true;      // versatile: melee unless thrown
  return melee > 0 || ranged === 0;
}

/**
 * R:532 — "attacks you make deal additional damage equal to the characteristic
 * used to make the attack" while blessed.
 *
 * Floored at 0: R:174 allows a characteristic of -5, and "additional damage" of
 * -5 would make a blessing a curse.
 */
export function blessedDamageBonus(actor, characteristic) {
  if (!actor?.system?.conditions?.blessed) return 0;
  return Math.max(0, actor.system?.characteristics?.[characteristic]?.value ?? 0);
}

/**
 * The attack payload carried on the TestResult through to commit, from which
 * `combat.mjs` computes each target's damage.
 */
export function weaponAttackPayload(actor, weapon, { isMelee, characteristic, furyBonus = 0, situation = {} } = {}) {
  const sys = weapon?.system ?? {};
  const t2 = evalDamage(sys.damage?.t2, actor);
  const t3 = evalDamage(sys.damage?.t3, actor);
  const add = (v) => (Number.isFinite(Number(v)) ? Number(v) + furyBonus : v);
  return {
    t2: furyBonus ? add(t2) : t2,
    t3: furyBonus ? add(t3) : t3,
    isMelee,
    piercing: !!sys.piercing,                       // R:512 — "P" damage skips AD
    weaponName: weapon?.name ?? null,
    weaponId: weapon?.id ?? null,
    weaponType: sys.type ?? null,                   // gates the weapon expertise (R:913)
    normalRange: sys.range?.ranged ?? 0,
    furyBonus,
    blessedBonus: blessedDamageBonus(actor, characteristic),   // R:532
    // R:943/R:945 — a ranged miss can stray into an ally standing next to the
    // target. Carried so the committed result can adjudicate it without asking
    // the canvas what the board looked like when the arrow left the bow.
    alliesAdjacent: situation.alliesAdjacent ?? [],
    onOwnTurn: situation.onOwnTurn ?? true
  };
}

/**
 * Make a weapon attack.
 *
 * @param {Actor} actor    the wielder
 * @param {Item}  weapon   an item of type "weapon"
 * @param {object} [opts]
 * @param {Array} [opts.targets]  per-target situation:
 *        {tokenId, conditions, distance, adjacent, flanking, highGround,
 *         cover, concealment}. Defaults to the user's current targets.
 * @param {boolean} [opts.thrown]      R:993 — declare a thrown weapon ranged
 * @param {boolean} [opts.improvised]  R:1023 — a bane
 * @param {object}  [opts.situation]   {alliesAdjacent, onOwnTurn}
 * @param {Mod[]}   [opts.mods]        caller-supplied numeric modifiers
 */
export async function attackWithWeapon(actor, weapon, {
  targets = null,
  thrown = null,
  improvised = false,
  situation = {},
  mods: extraMods = []
} = {}) {
  if (!actor || !weapon) return { ok: false, error: "missing args" };
  if (weapon.type !== "weapon") return { ok: false, error: "not a weapon" };

  // R:552 — an unconscious creature can't take actions at all. Blocked here
  // rather than rolled and auto-doomed: an attack is an action, and there is no
  // action to take.
  if (actor.system?.conditions?.unconscious) {
    globalThis.ui?.notifications?.warn?.(`${actor.name} is unconscious and cannot attack.`);
    return { ok: false, error: "unconscious" };
  }

  const characteristic = attackCharacteristic(actor, weapon);
  const isMelee = isMeleeAttack(weapon, { thrown });
  const normalRange = weapon.system?.range?.ranged ?? 0;

  const situations = targets ?? _situationsFromUserTargets();
  const labels = buildAttackLabels({
    attacker: { id: actor.id, conditions: actor.system?.conditions ?? {} },
    isMelee,
    improvised,
    normalRange,
    targets: situations
  });
  if (labels.warnings.length) {
    globalThis.ui?.notifications?.warn?.(
      "This attack gives different modifiers to different targets, but Crows cannot resolve them separately yet. No attack was rolled."
    );
    return { ok: false, error: "per-target-modifiers-unsupported" };
  }

  // Boon of Fury: expends now and raises BOTH tiers, since which one lands is
  // not known until the result commits.
  let furyBonus = 0;
  if (actor.type === "crow" && actor.system?.activeBoon?.boonId === "fury") {
    try {
      const { consumeBoonOnDamage } = await import("./crypt.mjs");
      furyBonus = (await consumeBoonOnDamage(actor)).extra || 0;
    } catch { /* crypt module not loaded */ }
  }

  const attack = weaponAttackPayload(actor, weapon, { isMelee, characteristic, furyBonus, situation });

  const flavorBits = [`${actor.name} attacks with ${weapon.name}`];
  if (furyBonus) flavorBits.push(`(+${furyBonus} fury)`);
  if (attack.blessedBonus) flavorBits.push(`(+${attack.blessedBonus} blessed dam)`);

  return await rollTest({
    actor,
    characteristic,
    mods: [...extraMods, ...labels.mods],
    edges: labels.edges,
    banes: labels.banes,
    flavor: flavorBits.join(" "),
    attack,
    // TargetRef snapshots (C10): plain data, never a Token or an Actor.
    targets: situations.map(t => targetRef(t.tokenId, t.conditions))
  });
}

/**
 * The user's current targets, flattened into situations.
 *
 * Position — distance, flanking, high ground, cover, concealment — is NOT read
 * off the canvas. Cover and concealment are Ref judgements (R:757, R:761) and
 * flanking has a geometric definition (R:967) that needs both allies' spaces;
 * guessing any of them would silently apply an edge nobody agreed to. They come
 * from the caller, and default to absent.
 */
function _situationsFromUserTargets() {
  const targets = globalThis.game?.user?.targets ?? [];
  return [...targets].map(t => ({
    tokenId: t?.id ?? null,
    conditions: { ...(t?.actor?.system?.conditions ?? {}) }
  }));
}
