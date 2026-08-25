/**
 * Miasma — environmental corrupting fog (Rules Booklet R:1121–1148).
 *
 * Playtest 2 replaces the old `boned` condition with a Miasma-owned integer
 * resource: `system.miasma.cruelty`.  A human tests at the end of every rest
 * spent in the Miasma:
 *
 *   2d10 + M - cruelty
 *     Tier 1: gain one cruelty and roll the paired Effects row
 *     Tier 2: no effect
 *     Tier 3: clear all your cruelty (the other-human branch is narrative)
 *
 * The effects table deliberately stores the rolled bucket on the actor, as
 * PT1 worlds already do.  Each bucket now resolves to a pair of records; the
 * pair is the unit of deduplication and both records are gained together.
 */

import { getDT } from "./dungeon-turn.mjs";

const NS = "crows";
const KEY_IN_MIASMA = "inMiasma";

/**
 * The unresolved tier-3 alternative is a Ref-adjudicated narrative choice.
 * Foundry has no cross-document transaction for another human's unresolved
 * test, so this is intentionally metadata for a Ref decision, not a pending
 * marker or an attempted second-actor update (D-M4).
 */
export const MIASMA_TIER3_OTHER_HUMAN = Object.freeze({
  applyTo: "narrative",
  reason: "Improve another resting human's Miasma result by one tier; the Ref adjudicates the other test."
});

export function registerMiasmaSettings() {
  game.settings.register(NS, KEY_IN_MIASMA, {
    scope: "world",
    config: true,
    name: "Party is in the Miasma",
    hint: "Outdoor Cornath areas. When enabled, every non-town rest automatically starts a Miasma resist test for each human.",
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

/* -------------------------------------------------------------------------- */
/*  Paired Effects table                                                      */
/* -------------------------------------------------------------------------- */

function effect({ id, label, text, endsOn, kind = "harm", applyTo = "rules", ...mechanics }) {
  return { id, label, text, endsOn, kind, applyTo, ...mechanics };
}

function benefit({ id, label, text, applyTo = "narrative", ...mechanics }) {
  return { id, label, text, kind: "benefit", applyTo, ...mechanics };
}

/**
 * Create one row. `second.endsOn` is forced to the first effect's duration,
 * because R:1140 says the second effect lasts as long as the first.
 *
 * The top-level first-effect fields are retained as a read-only compatibility
 * view for the existing sheet. New code must use `.first`, `.second`, or
 * `.effects`; the pair itself is the authoritative table value.
 */
function pairedRow(rowId, first, second) {
  const a = Object.freeze({ ...first });
  const b = Object.freeze({ ...second, endsOn: first.endsOn });
  return Object.freeze({
    ...a,
    rowId,
    first: a,
    second: b,
    effects: Object.freeze([a, b])
  });
}

const ROWS = [
  ["despondent-sneak", [1, 2],
    effect({
      id: "despondent", label: "Despondent", endsOn: "leaveMiasma",
      text: "You become despondent. You only speak if spoken to first and give one-word responses until you exit the Miasma.",
      applyTo: "narrative"
    }),
    benefit({
      id: "sneak-edge", label: "Sneak's Edge", applyTo: "hideSneak",
      text: "You have an edge on tests made to sneak or hide."
    })],
  ["ravenous-forager", [3, 4],
    effect({
      id: "ravenous", label: "Ravenous", endsOn: "leaveMiasma",
      text: "You become ravenous and greedy. You must eat at least 2 rations during a rest to get the benefits of a rest until you are out of the Miasma.",
      applyTo: "rest"
    }),
    benefit({
      id: "forager-benefit", label: "Forager's Benefit", applyTo: "forage",
      text: "Your ravenous nature makes you good at finding food. You gain a +2 bonus on tests made related to the forage role.",
      value: 2
    })],
  ["destructive-restorative", [5, 6],
    effect({
      id: "destroy", label: "Destructive Rage", endsOn: "immediate",
      text: "You enter a destructive rage and destroy one mundane item randomly chosen by the Ref from your backpack.",
      applyTo: "inventory"
    }),
    benefit({
      id: "restorative", label: "Restorative Surge", applyTo: "narrative",
      text: "Destroying something makes you feel good. You regain 3 Stamina or, if your Stamina is full, lose 1 wound.",
      stamina: 3,
      woundIfFull: 1
    })],
  ["deceitful-benefit", [7, 8],
    effect({
      id: "deceitful", label: "Deceitful", endsOn: "leaveMiasma",
      text: "You become deceitful for the sake of it. You only communicate in lies and try to get away with it until you are out of the Miasma.",
      applyTo: "narrative"
    }),
    benefit({
      id: "self-expertise", label: "Self-Deception Expertise", applyTo: "choice",
      text: "You lie even to yourself. Choose an expertise you do not have. You gain that expertise.",
      choice: "expertise"
    })],
  ["lazy-wounds", [9, 10],
    effect({
      id: "lazy", label: "Lazy", endsOn: "leaveMiasma",
      text: "You become lazy. You refuse to have any travel role until you are out of the Miasma.",
      applyTo: "narrative"
    }),
    benefit({
      id: "extra-wound-rest", label: "Restful Recovery", applyTo: "rest",
      text: "When you rest, you recover 2 wounds instead of 1.",
      woundCount: 2
    })],
  ["violent-damage", [11, 12],
    effect({
      id: "violent", label: "Violence", endsOn: "loseCruelty",
      text: "You relish violence. In combat, you must keep pursuing and fighting your foes until you can no longer sense them. This effect ends when you are no longer have cruelty.",
      applyTo: "narrative"
    }),
    benefit({
      id: "weapon-damage", label: "Violent Damage", applyTo: "weaponAttack",
      text: "Your relish in violence gives you a +1 damage bonus on weapon attacks.",
      value: 1
    })],
  ["permanent-npc-expertise", [13],
    effect({
      id: "permanent-npc", label: "Permanent NPC", endsOn: "permanent", kind: "catastrophic",
      text: "All of your other Miasma effects end and all your levels of cruelty disappear. You can't suffer any new Miasma effects and are permanently selfish and cruel. You become an NPC controlled by the Ref.",
      applyTo: "narrative"
    }),
    benefit({
      id: "miasma-expertise-refresh", label: "Miasma Expertise Refresh", applyTo: "rest",
      text: "Finishing a rest in the Miasma regains the uses of your expertises."
    })]
];

const effects = {};
for (const [rowId, buckets, first, second] of ROWS) {
  const row = pairedRow(rowId, first, second);
  for (const bucket of buckets) effects[bucket] = row;
}

/** Bucket → paired first/second effect row. */
export const MIASMA_EFFECTS = Object.freeze(effects);

/** Return the paired row for a 1d10 + cruelty total (13+ uses the 13+ row). */
export function lookupEffects(roll) {
  const n = Number(roll);
  if (!Number.isFinite(n)) return null;
  return MIASMA_EFFECTS[n >= 13 ? 13 : Math.max(1, Math.min(12, Math.floor(n)))] ?? null;
}

/**
 * Compatibility lookup for callers that only render the first effect.
 * New code should use lookupEffects(), because every row grants both records.
 */
export function lookupEffect(roll) {
  return lookupEffects(roll)?.first ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Shared state helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Crows and human stat blocks are the humans named by R:1127. */
export function isMiasmaHuman(actor) {
  if (actor?.type === "crow") return true;
  return actor?.type === "monster"
    && String(actor.system?.creatureType ?? "").toLowerCase() === "human";
}

export function crueltyLevel(actor) {
  return Math.max(0, Math.floor(Number(actor?.system?.miasma?.cruelty) || 0));
}

/** R:1134 — each cruelty level is a −1 penalty to Miasma RRs only. */
export function miasmaCrueltyPenalty(actor) {
  return -crueltyLevel(actor);
}

/** Modifier payload consumed by roll.mjs; ordinary tests never receive it. */
export function miasmaResistMods(actor) {
  const value = miasmaCrueltyPenalty(actor);
  return value
    ? [{ key: "cruelty", label: "Miasma cruelty", value }]
    : [];
}

/**
 * The 9–10 paired benefit changes a Miasma rest's wound choice from one to
 * two. Tend Wounds already resolves to two, so this is a max rather than a
 * stacking increment (R:1126, R:1146).
 */
export function miasmaRestWoundCount(actor, baseCount = 1, { inMiasma = true } = {}) {
  const base = Math.max(0, Math.floor(Number(baseCount) || 0));
  if (!inMiasma) return base;
  const active = actor?.system?.miasma?.effects ?? [];
  const extra = active.some(bucket => lookupEffects(bucket)?.second?.id === "extra-wound-rest");
  return extra ? Math.max(base, 2) : base;
}

function effectsEndingOn(active, ending) {
  return (active ?? []).filter(bucket =>
    lookupEffects(bucket)?.effects?.some(record => record.endsOn === ending)
  );
}

/**
 * Clear cruelty and any effect explicitly tied to the resource reaching zero.
 * This is used by the tier-3 self choice and by a completed rest outside the
 * Miasma. It never touches a different condition or invents `weakened`.
 */
export async function clearCruelty(actor, {
  announce = true,
  reason = "restOutsideMiasma"
} = {}) {
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };

  const before = crueltyLevel(actor);
  const active = [...(actor.system?.miasma?.effects ?? [])];
  const keep = active.filter(bucket => !effectsEndingOn([bucket], "loseCruelty").length);
  const effectsRemoved = active.length - keep.length;
  const update = {};
  if (before > 0) update["system.miasma.cruelty"] = 0;
  if (effectsRemoved) update["system.miasma.effects"] = keep;
  if (Object.keys(update).length) await actor.update(update);

  if (announce && (before > 0 || effectsRemoved > 0)) {
    await ChatMessage.create({
      content: `<div class="crows miasma-clear-cruelty"><strong>${actor.name}</strong> clears ${before} cruelty level${before === 1 ? "" : "s"}${reason === "tier3" ? " (tier 3)" : " after resting outside the Miasma"}.</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }

  return {
    ok: true,
    before,
    cruelty: 0,
    cleared: before,
    effectsRemoved,
    reason
  };
}

/* -------------------------------------------------------------------------- */
/*  Resist lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/** Start a Miasma resist. Consequences resolve only at the committed hook. */
export async function rollMiasmaResist(actor, { silent = false } = {}) {
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };
  if (actor.system?.miasma?.permanentNPC) {
    if (!silent) globalThis.ui?.notifications?.warn?.(`${actor.name} is already a permanent NPC — Miasma test skipped.`);
    return { ok: false, error: "permanent NPC" };
  }
  const { rollTest } = await import("./roll.mjs");
  const res = await rollTest({
    actor,
    characteristic: "mind",
    // D-M2: this closed decision remains unchanged even though PT2 describes
    // the test as 2d10 + M and does not name an expertise.
    allowedExpertises: ["endurance"],
    mods: miasmaResistMods(actor),
    flavor: "Miasma Resist",
    miasma: { kind: "resist" }
  });
  if (!res) return { ok: false, error: "no roll" };
  return { ok: true, pending: res.state !== "committed", test: res, resolution: null };
}

/** Apply a FINAL Miasma-resist tier. Pending results are never readable here. */
export async function resolveMiasmaResist(result, actor) {
  if (result?.state !== "committed") return { ok: false, error: "test-pending" };
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };
  if (!result?.tier) return { ok: false, error: "no roll" };

  await actor.update({ "system.miasma.lastTestOn": getDT() });

  // PT2 Tier 3 is a choice. This implementation ships the self branch; the
  // other-human branch is the narrative Ref decision above (D-M4).
  if (result.tier >= 3) {
    const cruelty = await clearCruelty(actor, { announce: false, reason: "tier3" });
    await ChatMessage.create({
      content: `<div class="crows miasma-result tier3"><strong>${actor.name}</strong> clears all cruelty (tier 3). The alternative — improving another resting human's result — is Ref-adjudicated narrative.</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return {
      ok: true,
      tier: 3,
      cruelty: 0,
      crueltyCleared: cruelty.cleared,
      effect: null
    };
  }

  // PT2 Tier 2 has no effect and does not add cruelty.
  if (result.tier === 2) {
    const cruelty = crueltyLevel(actor);
    await ChatMessage.create({
      content: `<div class="crows miasma-result tier2"><strong>${actor.name}</strong> resists the Miasma (tier 2): no effect; cruelty remains ${cruelty}.</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, tier: 2, cruelty, effect: null };
  }

  // PT2 Tier 1 gains one cruelty, then rolls using the new level.
  const before = crueltyLevel(actor);
  const cruelty = before + 1;
  await actor.update({ "system.miasma.cruelty": cruelty });
  const effectRoll = await rollMiasmaEffect(actor);
  return { ok: true, tier: 1, cruelty, effect: effectRoll.effect };
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

/* -------------------------------------------------------------------------- */
/*  Effects and leaving                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Roll 1d10 + cruelty on the paired Effects table. The bucket is stored once;
 * lookupEffects() exposes both gained records. 13+ is catastrophic.
 */
export async function rollMiasmaEffect(actor) {
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };

  const cruelty = crueltyLevel(actor);
  const activeArr = [...(actor.system?.miasma?.effects ?? [])];
  const activeRows = new Set(activeArr.map(bucket => lookupEffects(bucket)?.rowId).filter(Boolean));

  let rolled = 0, total = 0, tries = 0, duplicate = true;
  const MAX_TRIES = 16;
  while (tries < MAX_TRIES) {
    tries++;
    const r = await new Roll("1d10").evaluate();
    rolled = r.total;
    total = rolled + cruelty;
    if (total >= 13) { duplicate = false; break; }
    const candidate = lookupEffects(total);
    if (candidate && !activeRows.has(candidate.rowId)) { duplicate = false; break; }
  }

  if (duplicate) {
    await ChatMessage.create({
      content: `<div class="crows miasma-effect"><strong>${actor.name}</strong> rolls on the Miasma Effects table (1d10=${rolled} + cruelty ${cruelty} = <strong>${total}</strong>) — all available paired rows are already active.</div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, total, rolled, cruelty, effect: null, effects: [], duplicate: true };
  }

  // Catastrophic 13+ — clears the Miasma state and locks out future effects.
  if (total >= 13) {
    await actor.update({
      "system.miasma.effects": [],
      "system.miasma.permanentNPC": true,
      "system.miasma.cruelty": 0
    });
    await ChatMessage.create({
      content: `<div class="crows miasma-effect catastrophic"><header><strong>${actor.name}</strong> is consumed by the Miasma (1d10=${rolled} + cruelty ${cruelty} = <strong>${total}</strong>)</header><div>All other paired Miasma effects end. Cruelty disappears, no new Miasma effects can apply, and the character becomes a permanent Ref-controlled NPC.</div></div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
    return { ok: true, total, rolled, cruelty, catastrophic: true, effect: null, effects: [] };
  }

  const row = lookupEffects(total);
  const newEffects = [...activeArr, total];
  await actor.update({ "system.miasma.effects": newEffects });
  await ChatMessage.create({
    content: `<div class="crows miasma-effect"><header><strong>${actor.name}</strong> gains <strong>${row.first.label}</strong> and <strong>${row.second.label}</strong> (1d10=${rolled} + cruelty ${cruelty} = <strong>${total}</strong>)</header><div>${row.first.text}</div><div>${row.second.text}</div></div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });

  // An immediate first effect makes the paired row immediate as well: the
  // second lasts as long as the first (R:1140).
  if (row.first.endsOn === "immediate") {
    const stripped = newEffects.filter(v => v !== total);
    await actor.update({ "system.miasma.effects": stripped });
  }

  return { ok: true, total, rolled, cruelty, effect: row, effects: row.effects };
}

/**
 * Clear effects that end when leaving the Miasma. Cruelty is intentionally
 * separate: it clears only on a completed rest outside the Miasma.
 */
export async function clearMiasma(actor, { onlyLeave = true } = {}) {
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };
  if (actor.system?.miasma?.permanentNPC) return { ok: false, error: "permanent NPC" };
  const active = [...(actor.system?.miasma?.effects ?? [])];
  const keep = onlyLeave
    ? active.filter(bucket => !lookupEffects(bucket)?.effects?.some(e => e.endsOn === "leaveMiasma" || e.endsOn === "immediate"))
    : [];
  const removed = active.length - keep.length;
  if (!removed) return { ok: true, removed: 0, kept: keep.length };
  await actor.update({ "system.miasma.effects": keep });
  await ChatMessage.create({
    content: `<div class="crows miasma-clear"><strong>${actor.name}</strong> leaves the Miasma — ${removed} paired effect row${removed > 1 ? "s" : ""} cleared${keep.length ? ` (${keep.length} cruelty-tied row retained)` : ""}.</div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, removed, kept: keep.length };
}

/** Remove effects whose duration is tied to cruelty reaching zero. */
export async function onCrueltyCleared(actor) {
  if (!isMiasmaHuman(actor)) return { ok: false, error: "not a Miasma human" };
  const active = [...(actor.system?.miasma?.effects ?? [])];
  const keep = active.filter(bucket => !effectsEndingOn([bucket], "loseCruelty").length);
  if (keep.length === active.length) return { ok: true, removed: 0 };
  await actor.update({ "system.miasma.effects": keep });
  return { ok: true, removed: active.length - keep.length };
}

// The PT1 alias `onBonedCleared` was REMOVED on 2026-08-25. Keeping it would
// have preserved a name whose MEANING changed: a PT1 macro calling it expected
// boned semantics and would silently have got cruelty semantics instead. A
// clean break fails loudly, which is the better failure. Use onCrueltyCleared.
