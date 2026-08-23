/**
 * Miasma — environmental corrupting fog (Rules Booklet pp.1115–1161).
 *
 * Outdoor areas of Cornath are filled with magical haze left by the
 * Necromancer War. Crows resting outdoors must test against it every 24h.
 *
 *  Resist test: 2d10 + Mind + Endurance
 *    - Tier 1 (≤11): +1 boned AND roll on Effects table
 *    - Tier 2 (12-16): +1 boned only
 *    - Tier 3 (17+): no effect
 *
 *  While inside the Miasma the actor cannot lose boned levels.
 *  Effects roll: 1d10 + current boned, dedup if already active.
 *
 *  Effects table (lookup bucket = d10+boned):
 *     1-2  Despondent (one-word replies until leaving Miasma)
 *     3-4  Ravenous (must eat 2 rations to gain rest benefits)
 *     5-6  Destructive rage (destroy 1 mundane backpack item)
 *     7-8  Deceitful (only lies until leaving Miasma)
 *     9-10 Lazy (refuses any travel role)
 *    11-12 Violent (must keep fighting foes once engaged)
 *    13+   PC becomes a permanent NPC (Ref-controlled) — clears all
 *          existing effects and boned levels; locks new ones out.
 */

import { getDT } from "./dungeon-turn.mjs";

const NS = "crows";
const KEY_IN_MIASMA = "inMiasma";

export function registerMiasmaSettings() {
  game.settings.register(NS, KEY_IN_MIASMA, {
    scope: "world",
    config: true,
    name: "Party is in the Miasma",
    hint: "Outdoor Cornath areas. When enabled, rests outside town auto-roll a Miasma resist test for each crow. Indoor/town rests are exempt.",
    type: Boolean,
    default: false
  });
}

export function getInMiasma() {
  try { return !!game.settings.get(NS, KEY_IN_MIASMA); } catch { return false; }
}
export async function setInMiasma(v) {
  return game.settings.set(NS, KEY_IN_MIASMA, !!v);
}

/** Bucket of d10+boned → effect record. */
export const MIASMA_EFFECTS = {
  1: { id: "despondent", label: "Despondent", endsOn: "leaveMiasma", text: "Only speaks if spoken to; one-word responses until leaving the Miasma." },
  2: { id: "despondent", label: "Despondent", endsOn: "leaveMiasma", text: "Only speaks if spoken to; one-word responses until leaving the Miasma." },
  3: { id: "ravenous",   label: "Ravenous",   endsOn: "leaveMiasma", text: "Must eat 2 rations during a rest to gain rest benefits, until leaving the Miasma." },
  4: { id: "ravenous",   label: "Ravenous",   endsOn: "leaveMiasma", text: "Must eat 2 rations during a rest to gain rest benefits, until leaving the Miasma." },
  5: { id: "destroy",    label: "Destructive Rage", endsOn: "immediate", text: "Destroys one mundane backpack item chosen at random by the Ref." },
  6: { id: "destroy",    label: "Destructive Rage", endsOn: "immediate", text: "Destroys one mundane backpack item chosen at random by the Ref." },
  7: { id: "deceitful",  label: "Deceitful",  endsOn: "leaveMiasma", text: "Can only communicate in lies until leaving the Miasma." },
  8: { id: "deceitful",  label: "Deceitful",  endsOn: "leaveMiasma", text: "Can only communicate in lies until leaving the Miasma." },
  9: { id: "lazy",       label: "Lazy",       endsOn: "leaveMiasma", text: "Refuses to take any travel role until leaving the Miasma." },
  10:{ id: "lazy",       label: "Lazy",       endsOn: "leaveMiasma", text: "Refuses to take any travel role until leaving the Miasma." },
  11:{ id: "violent",    label: "Violence",   endsOn: "loseBoned",   text: "Must keep pursuing/fighting foes once engaged. Ends when no longer boned." },
  12:{ id: "violent",    label: "Violence",   endsOn: "loseBoned",   text: "Must keep pursuing/fighting foes once engaged. Ends when no longer boned." }
};

/** Lookup the effect bucket for a numeric roll. 13+ is handled separately. */
export function lookupEffect(roll) {
  if (roll >= 13) return null;          // catastrophic
  return MIASMA_EFFECTS[Math.max(1, Math.min(12, roll))];
}

/**
 * Start a Miasma resist test on `actor`. The 2d10 test goes through rollTest so
 * it shows up in chat with the standard mod chain. Its consequences resolve
 * only from `crowsTestCommitted`; an expertise may still change the tier.
 */
export async function rollMiasmaResist(actor, { silent = false } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (actor.system?.miasma?.permanentNPC) {
    if (!silent) ui.notifications?.warn(`${actor.name} is already a permanent NPC — Miasma test skipped.`);
    return { ok: false, error: "permanent NPC" };
  }
  const { rollTest } = await import("./roll.mjs");
  const res = await rollTest({
    actor, characteristic: "mind", allowedExpertises: ["endurance"],
    flavor: "Miasma Resist (24h)", miasma: { kind: "resist" }
  });
  if (!res) return { ok: false, error: "no roll" };
  return { ok: true, pending: res.state !== "committed", test: res, resolution: null };
}

/** Apply a FINAL Miasma-resist tier. Pending results are never readable here. */
export async function resolveMiasmaResist(result, actor) {
  if (result?.state !== "committed") return { ok: false, error: "test-pending" };
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };
  if (!result?.tier) return { ok: false, error: "no roll" };

  // Stamp lastTestOn (DT counter) — useful for "when did you last test" displays.
  await actor.update({ "system.miasma.lastTestOn": getDT() });

  // Tier 3: nothing.
  if (result.tier >= 3) {
    await ChatMessage.create({
      content: `<div class="crows miasma-result tier3"><strong>${actor.name}</strong> shrugs off the Miasma (tier 3).</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, tier: 3, boned: false, effect: null };
  }

  // Tier 1 & 2: +1 boned.
  const before = actor.system?.conditions?.boned ?? 0;
  await actor.update({ "system.conditions.boned": before + 1 });

  // Tier 2 stops here.
  if (result.tier === 2) {
    await ChatMessage.create({
      content: `<div class="crows miasma-result tier2">
        <strong>${actor.name}</strong> resists badly (tier 2): <em>+1 boned</em> (now ${before + 1}).
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, tier: 2, boned: true, effect: null };
  }

  // Tier 1: +1 boned AND roll on Effects table.
  const eff = await rollMiasmaEffect(actor);
  return { ok: true, tier: 1, boned: true, effect: eff };
}

function defaultGetActor(actorId, message = null) {
  return globalThis.game?.actors?.get?.(actorId) ?? message?.speakerActor ?? null;
}

/** Resolve only tests that carry the persisted Miasma-resist purpose marker. */
export async function onMiasmaTestCommitted(result, message = null, {
  getActor = defaultGetActor
} = {}) {
  if (result?.miasma?.kind !== "resist") return null;
  if (result.state !== "committed") return null;
  const actor = getActor(result.actorId, message);
  if (!actor) return { ok: false, error: "actor unavailable" };
  return resolveMiasmaResist(result, actor);
}

/** Register the Miasma outcome subscriber once per client. */
export function registerMiasmaHooks() {
  if (registerMiasmaHooks._bound) return;
  registerMiasmaHooks._bound = true;
  globalThis.Hooks?.on?.("crowsTestCommitted", (result, message) => {
    void onMiasmaTestCommitted(result, message).catch(err =>
      console.warn("crows | committed Miasma test could not be resolved", err));
  });
}

/**
 * Roll 1d10 + boned on the Miasma Effects table and apply.
 * Auto re-rolls if the bucket is already active.
 * 13+ → catastrophic (permanent NPC).
 */
export async function rollMiasmaEffect(actor) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };

  const boned = actor.system?.conditions?.boned ?? 0;
  const activeArr = actor.system?.miasma?.effects ?? [];
  // Dedup by effect-id (Rules: "If the result is an effect that is already
  // affecting you, roll again." — buckets 1-2 are the same Despondent effect,
  // 3-4 same Ravenous, etc.).
  const activeIds = new Set(activeArr.map(v => lookupEffect(v)?.id).filter(Boolean));

  let rolled = 0, total = 0, tries = 0, duplicate = true;
  const MAX_TRIES = 16;
  while (tries < MAX_TRIES) {
    tries++;
    const r = await new Roll("1d10").evaluate();
    rolled = r.total;
    total = rolled + boned;
    if (total >= 13) { duplicate = false; break; }
    const candidateId = lookupEffect(total)?.id;
    if (!candidateId) continue;
    if (!activeIds.has(candidateId)) { duplicate = false; break; }
  }

  // Max-tries exhausted with no unique effect available: log and bail out.
  if (duplicate) {
    await ChatMessage.create({
      content: `<div class="crows miasma-effect"><strong>${actor.name}</strong> rolls on the Miasma Effects table (1d10=${rolled} + boned ${boned} = <strong>${total}</strong>) — already suffering all rollable effects, no new effect applied.</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, total, rolled, boned, effect: null, duplicate: true };
  }

  // Catastrophic 13+ — wipes existing effects & boned, locks new ones out, PC→NPC.
  if (total >= 13) {
    await actor.update({
      "system.miasma.effects": [],
      "system.miasma.permanentNPC": true,
      "system.conditions.boned": 0
    });
    await ChatMessage.create({
      content: `<div class="crows miasma-effect catastrophic">
        <header><strong>${actor.name}</strong> is consumed by the Miasma (1d10=${rolled} + boned ${boned} = <strong>${total}</strong>)</header>
        <div><strong>All other Miasma effects end. All boned levels disappear. ${actor.name} can no longer suffer new Miasma effects, becomes permanently selfish and cruel, and is now a Ref-controlled NPC.</strong></div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, total, rolled, boned, catastrophic: true };
  }

  // Normal effect — add to active set.
  const eff = lookupEffect(total);
  const newEffects = [...activeArr, total];
  await actor.update({ "system.miasma.effects": newEffects });
  await ChatMessage.create({
    content: `<div class="crows miasma-effect">
      <header><strong>${actor.name}</strong> suffers <strong>${eff.label}</strong> (1d10=${rolled} + boned ${boned} = <strong>${total}</strong>)</header>
      <div>${eff.text}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });

  // Destructive rage is "immediate" — its effect resolves the moment it's
  // rolled (Ref picks an item) and doesn't persist. Remove from active list.
  if (eff.endsOn === "immediate") {
    const stripped = newEffects.filter(v => v !== total);
    await actor.update({ "system.miasma.effects": stripped });
  }

  return { ok: true, total, rolled, boned, effect: eff };
}

/**
 * Clear all Miasma effects on `actor` (when leaving the Miasma).
 * The "violence" effect (buckets 11-12) clears only when boned drops to 0,
 * NOT just when leaving the Miasma — so when called with `{onlyLeave: true}`
 * (the default), we keep violence effects intact.
 * Pass `{onlyLeave: false}` to wipe everything (e.g. via end-of-session).
 */
export async function clearMiasma(actor, { onlyLeave = true } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };
  const active = actor.system?.miasma?.effects ?? [];
  const keep = onlyLeave ? active.filter(v => v >= 11) : [];
  const removed = active.length - keep.length;
  if (!removed) return { ok: true, removed: 0, kept: keep.length };
  await actor.update({ "system.miasma.effects": keep });
  await ChatMessage.create({
    content: `<div class="crows miasma-clear">
      <strong>${actor.name}</strong> leaves the Miasma — ${removed} effect${removed > 1 ? "s" : ""} cleared${keep.length ? ` (${keep.length} retained: violence/boned-tied)` : ""}.
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, removed, kept: keep.length };
}

/**
 * Called when boned drops to 0 — wipes any violence effects (which clear
 * on lose-boned, not on leave-Miasma). Idempotent.
 */
export async function onBonedCleared(actor) {
  if (!actor || actor.type !== "crow") return;
  const active = actor.system?.miasma?.effects ?? [];
  const keep = active.filter(v => v < 11);
  if (keep.length === active.length) return;
  await actor.update({ "system.miasma.effects": keep });
}
