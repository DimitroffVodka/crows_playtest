/**
 * Dungeon Turn (DT) tracker, end-of-DT pipeline, and encounter checks.
 *
 * PLAYTEST 2 (R:586-624). Three things changed from PT1 and all three are
 * behavioural, not cosmetic:
 *
 *  1. The encounter check is **1d10 >= EN**, not 1d6. EN is DERIVED, not a
 *     free-typed number: 9 by default, 8 if the level is crowded (>20 creatures)
 *     OR the PCs left obvious chaos behind, 7 if BOTH (R:622). The PT1 setting
 *     let a Ref type any 2-6, which cannot express "crowded and chaotic" and
 *     silently kept a 1d6-era 6 in every existing world. It is gone; the two
 *     facts that actually determine EN are the settings now.
 *  2. A rolled **10 lands immediately**. Any other triggering roll telegraphs a
 *     sign NOW and the encounter lands during the NEXT DT (R:624). That pending
 *     encounter is world state — it has to survive a reload, so it is a setting
 *     and not a module-level variable.
 *  3. Blessed/Boned no longer "reset". `boned` is deleted (CONTRACT §1), and
 *     blessed is a boolean. What ends at end-of-DT is the trio of durational
 *     conditions: blessed, vulnerable, weakened.
 *
 * DT length is configurable (R:616): 30 min default, 60 relaxed, 20 intense, or
 * 1d6 rooms.
 *
 * Rests sit OUTSIDE dungeon turns (R:630). Starting one ends the current DT with
 * NO encounter check, and the end-of-DT pipeline runs at the rest's halfway
 * point instead. rest.mjs drives that via endDungeonTurnForRest() and
 * runEndOfDtEffects(); both are exported for exactly that reason.
 */

import { CROWS } from "../config.mjs";
import { rollUsageDie, resolveUsageDicePool } from "./usage-die.mjs";
import { registerGreedSettings } from "./greed.mjs";

const NS = "crows";
const KEY_DT = "dtCounter";
const KEY_CROWDED = "dungeonCrowded";
const KEY_CHAOS = "dungeonChaosLeftBehind";
const KEY_DT_LENGTH = "dtLength";
const KEY_PENDING = "pendingEncounter";

// --- pure core -------------------------------------------------------------

/**
 * DT lengths (R:616). `rooms` has no fixed minute count — the DT ends after
 * 1d6 rooms are explored — so its `minutes` is null rather than a made-up
 * number that downstream clocks would quietly believe.
 */
export const DT_LENGTHS = {
  standard: { minutes: 30, label: "30 minutes (default)" },
  relaxed:  { minutes: 60, label: "60 minutes (relaxed)" },
  intense:  { minutes: 20, label: "20 minutes (intense)" },
  rooms:    { minutes: null, rooms: "1d6", label: "1d6 rooms" }
};

/**
 * The conditions that end at the end of a dungeon turn (R:532, R:544, R:556).
 * `boned` is NOT here — it does not exist in PT2.
 */
export const DT_EXPIRING_CONDITIONS = ["blessed", "vulnerable", "weakened"];

/**
 * Encounter Number (R:622). Both flags true is 7, not 9-1-1: the rule states
 * three discrete values, so they are read from config rather than computed by
 * subtraction, which would drift the moment a fourth modifier appears.
 *
 * Seclude Camp (R:672) is the one published EN modifier and it IS arithmetic:
 * "EN -1 during the rest".
 *
 * Clamped to [2, 10]: a threshold of 1 or lower makes every 1d10 trigger, which
 * is not "very dangerous" but "broken", and above 10 nothing can ever trigger.
 */
export function encounterNumber({ crowded = false, chaos = false, secludeCamp = false } = {}) {
  const { defaultEN, crowdedEN, bothEN } = CROWS.encounter;
  let en = defaultEN;
  if (crowded && chaos) en = bothEN;
  else if (crowded || chaos) en = crowdedEN;
  if (secludeCamp) en -= 1;
  return Math.max(2, Math.min(10, en));
}

/**
 * Resolve one encounter check against a threshold (R:622-624).
 *
 * `immediate` is keyed on the raw face being CROWS.encounter.immediateOn (10),
 * not on "roll >= en + something": at EN 7 a 9 triggers but does not land now,
 * and only a 10 ever does regardless of EN.
 *
 * @param {number} roll 1d10 result
 * @param {number} en   the Encounter Number
 * @returns {{roll:number, en:number, triggered:boolean, immediate:boolean, telegraph:boolean}}
 */
export function resolveEncounterCheck(roll, en) {
  const total = Number(roll) || 0;
  const threshold = Math.max(2, Math.min(10, Number(en) || CROWS.encounter.defaultEN));
  const triggered = total >= threshold;
  const immediate = triggered && total === CROWS.encounter.immediateOn;
  return { roll: total, en: threshold, triggered, immediate, telegraph: triggered && !immediate };
}

/**
 * Resolve a whole usage-die pool against R:562: roll ALL of the dice, and every
 * die showing a 1 or a 2 is removed. At 0 the effect ends.
 *
 * MOVED to `helpers/usage-die.mjs`, which is where the rule belongs, and
 * re-exported here so existing importers keep their path. T1.5 wrote this
 * correctly and noted that `rollUsageDie` rolled a single d6 for any pool size
 * — a third of the published decay rate — but the file was not T1.5's to
 * change. It has since been fixed to share this function, so the rule now has
 * exactly one implementation.
 *
 * The citation was R:200 here; that is the Tests chapter. Re-derived by
 * content, not by offset.
 */
export { resolveUsageDicePool };

/**
 * A durational backlash (R:1561) carries its own usage dice, and rolling them at
 * the end of a dungeon turn is the DT clock's job rather than the backlash
 * table's — which is why this lives here and not in backlash.mjs.
 *
 * `backlash.mjs` creates the effect with the canonical D4 flag:
 *
 *     flags.crows.backlash = {
 *       sourceRange,
 *       duration: { kind: "ud", current: <n> }
 *     }
 *
 * There is deliberately no `max` and no core ActiveEffect duration. When the
 * pool reaches zero the entire embedded ActiveEffect is deleted.
 */
/** The pool size on an effect, or 0 when it carries none. */
export function effectUsageDice(effect) {
  return backlashEffectUsageDice(effect);
}

/** The canonical UD pool on a D4 backlash effect. */
function backlashEffectDuration(effect) {
  const duration = effect?.flags?.crows?.backlash?.duration;
  return duration?.kind === "ud" ? duration : null;
}

function backlashEffectUsageDice(effect) {
  const duration = backlashEffectDuration(effect);
  return Math.max(0, Math.floor(Number(duration?.current) || 0));
}

/** Resolve an embedded effect again before mutating it. */
function actorEffectById(actor, id) {
  const effects = actor?.effects;
  if (typeof effects?.get === "function") return effects.get(id) ?? null;
  return [...(effects ?? [])].find(effect => effect?.id === id) ?? null;
}

/** Delete one embedded effect, treating an already-completed delete as success. */
async function deleteActorEffect(actor, id) {
  const live = actorEffectById(actor, id);
  if (!live) return;
  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
  } catch (error) {
    // Another single-GM clock may have completed the same deletion between
    // re-resolution and the document call. Missing is the desired terminal
    // state; any error while it still exists is real.
    if (actorEffectById(actor, id)) throw error;
  }
}

/**
 * Tick the UD clock for canonical backlash ActiveEffects on any Actor.
 *
 * `rollD6` is the deterministic public test/probe seam. The normal DT
 * orchestrator omits it and rolls Foundry dice. This is intentionally a
 * single-GM clock: re-resolution prevents resurrection after deletion, but
 * Foundry exposes no compare-and-swap primitive for independent clients.
 */
export async function tickBacklashUsageDice(actors, { rollD6 = null } = {}) {
  const die = rollD6 ?? (async () => (await new Roll("1d6").evaluate()).total);
  const out = [];

  for (const actor of actors ?? []) {
    for (const snapshot of [...(actor?.effects ?? [])]) {
      if (!backlashEffectDuration(snapshot)) continue;
      const pool = backlashEffectUsageDice(snapshot);
      if (pool <= 0) {
        await deleteActorEffect(actor, snapshot.id);
        out.push({
          actor: actor.name, effect: snapshot.name,
          removed: 0, remaining: 0, depleted: true, faces: []
        });
        continue;
      }

      const faces = [];
      for (let index = 0; index < pool; index++) {
        faces.push(await die({ actor, effect: snapshot, index }));
      }
      const result = resolveUsageDicePool(faces);
      if (result.depleted) {
        await deleteActorEffect(actor, snapshot.id);
      } else if (result.removed) {
        const live = actorEffectById(actor, snapshot.id);
        if (live) {
          await live.update({
            "flags.crows.backlash.duration.current": result.remaining
          });
        }
      }
      out.push({ actor: actor.name, effect: snapshot.name, ...result });
    }
  }

  return out;
}

/**
 * The update that ends the durational conditions on one creature, or null when
 * none of them are set. Returning null rather than an all-false object keeps
 * endDungeonTurn from writing to every actor in the world every single turn.
 */
export function conditionExpiryUpdate(conditions = {}) {
  const update = {};
  for (const key of DT_EXPIRING_CONDITIONS) {
    if (conditions[key]) update[`system.conditions.${key}`] = false;
  }
  return Object.keys(update).length ? update : null;
}

// --- settings --------------------------------------------------------------

export function registerDungeonTurnSettings() {
  game.settings.register(NS, KEY_DT, {
    scope: "world", config: false, type: Number, default: 0
  });

  // EN is derived from these two, per R:622. There is deliberately no setting
  // that sets EN directly — see the header note.
  game.settings.register(NS, KEY_CROWDED, {
    scope: "world", config: true, type: Boolean, default: false,
    name: "Dungeon level is crowded",
    hint: "More than 20 creatures on the level. Lowers the Encounter Number from 9 to 8, or to 7 if the party has also left chaos behind."
  });
  game.settings.register(NS, KEY_CHAOS, {
    scope: "world", config: true, type: Boolean, default: false,
    name: "Party left chaos behind",
    hint: "Corpses, sprung traps, open doors. Lowers the Encounter Number from 9 to 8, or to 7 on a crowded level."
  });

  game.settings.register(NS, KEY_DT_LENGTH, {
    scope: "world", config: true, type: String, default: "standard",
    name: "Dungeon Turn length",
    hint: "Affects fiction and usage-die pacing, not the encounter check.",
    choices: Object.fromEntries(Object.entries(DT_LENGTHS).map(([k, v]) => [k, v.label]))
  });

  // A telegraphed encounter waiting to land next DT (R:624). World state,
  // because it must survive a reload.
  game.settings.register(NS, KEY_PENDING, {
    scope: "world", config: false, type: Object, default: null
  });

  registerGreedSettings();
}

export function getDT() {
  try { return Number(game.settings.get(NS, KEY_DT)) || 0; } catch { return 0; }
}
export async function setDT(n) {
  return game.settings.set(NS, KEY_DT, Math.max(0, Math.floor(Number(n) || 0)));
}
export async function bumpDT() {
  const next = getDT() + 1;
  await setDT(next);
  return next;
}

export function getDTLength() {
  let key = "standard";
  try { key = String(game.settings.get(NS, KEY_DT_LENGTH) || "standard"); } catch { /* default */ }
  return DT_LENGTHS[key] ?? DT_LENGTHS.standard;
}

/** The live Encounter Number, derived from the crowded/chaos world settings. */
export function getDungeonEN({ secludeCamp = false } = {}) {
  let crowded = false, chaos = false;
  try {
    crowded = !!game.settings.get(NS, KEY_CROWDED);
    chaos = !!game.settings.get(NS, KEY_CHAOS);
  } catch { /* defaults */ }
  return encounterNumber({ crowded, chaos, secludeCamp });
}

export function getPendingEncounter() {
  try { return game.settings.get(NS, KEY_PENDING) ?? null; } catch { return null; }
}
async function setPendingEncounter(v) {
  return game.settings.set(NS, KEY_PENDING, v);
}

/**
 * Consume a telegraphed encounter. Called at the top of endDungeonTurn (the
 * encounter landed somewhere in the DT that just elapsed) and callable directly
 * by a Ref who wants to drop it at a chosen moment mid-turn.
 */
export async function resolvePendingEncounter() {
  const pending = getPendingEncounter();
  if (!pending) return { ok: false, pending: null };
  await setPendingEncounter(null);
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({
    content: `<div class="crows encounter-check triggered">
      <header><strong>Telegraphed encounter lands</strong></header>
      <div>Signed during DT #${pending.dt} (1d10=${pending.roll} vs ${pending.en}+). Roll on the encounter table.</div>
    </div>`,
    whisper,
    speaker: { alias: "Encounter" }
  });
  return { ok: true, pending };
}

// --- encounter checks ------------------------------------------------------

/**
 * Roll 1d10 against the Encounter Number and post a GM card.
 *
 * A triggering roll below 10 does NOT set the pending flag here — the caller
 * decides, because a rest's 2-hourly checks (R:668) resolve inside the rest and
 * must not queue themselves onto the next dungeon turn.
 */
export async function rollEncounterCheck({ en = null, label = "Dungeon", secludeCamp = false } = {}) {
  const threshold = en == null ? getDungeonEN({ secludeCamp }) : Math.max(2, Math.min(10, Number(en) || 9));
  const roll = await new Roll("1d10").evaluate();
  const res = resolveEncounterCheck(roll.total, threshold);

  const verdict = res.immediate
    ? "<strong>Encounter NOW — a 10 lands immediately.</strong>"
    : res.telegraph
      ? "<strong>A sign, now.</strong> Distant roar, half-eaten corpse, fresh tracks — the encounter lands during the next dungeon turn."
      : "<em>No encounter.</em>";

  const content = `<div class="crows encounter-check ${res.triggered ? "triggered" : "clear"}">
    <header><strong>${label} encounter check</strong></header>
    <div>1d10 = <strong>${res.roll}</strong> vs EN <strong>${res.en}+</strong>${secludeCamp ? " <em>(Seclude Camp −1)</em>" : ""}</div>
    <div class="ec-result">${verdict}</div>
  </div>`;
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({ content, whisper, speaker: { alias: "Encounter Check" } });
  return res;
}

// --- end-of-DT pipeline ----------------------------------------------------

/**
 * The end-of-DT EFFECTS only: roll DT-expiry usage dice, end the durational
 * conditions, clear per-DT crypt boon flags.
 *
 * Deliberately separate from endDungeonTurn(): R:630 fires exactly this at a
 * rest's halfway point, with no counter bump and no encounter check. Inlining
 * it would have forced rest.mjs to duplicate the loop and the two would drift.
 */
export async function runEndOfDtEffects() {
  const actors = [...(game.actors ?? [])];
  const crows = actors.filter(a => a.type === "crow");

  const udRolls = [];
  for (const crow of crows) {
    for (const item of crow.items) {
      const ud = item.system?.usageDie;
      if (ud?.enabled && ud.expiry === "dt" && (ud.udCurrent ?? 0) > 0) {
        const res = await rollUsageDie(item);
        udRolls.push({
          actor: crow.name, item: item.name,
          rolls: res.rolls, removed: res.removed,
          udCurrent: res.udCurrent, depleted: res.depleted
        });
      }
    }
  }

  const expired = [];
  // Conditions are creature state, so every actor carrying one gets the
  // end-of-DT expiry. The item usage-die pass above stays crow-only: monsters
  // do not track a crow's carried inventory resources.
  for (const actor of actors) {
    const update = conditionExpiryUpdate(actor.system?.conditions ?? {});
    if (!update) continue;
    await actor.update(update);
    expired.push({
      actor: actor.name,
      conditions: Object.keys(update).map(k => k.split(".").pop())
    });
  }

  const backlash = await tickBacklashUsageDice(actors);

  try {
    const { clearPerDtBoonFlags } = await import("./crypt.mjs");
    await clearPerDtBoonFlags();
  } catch { /* crypt module not loaded */ }

  return { udRolls, expired, backlash };
}

/**
 * End the current dungeon turn: land any telegraphed encounter, run the
 * end-of-DT effects, bump the counter, roll a fresh encounter check.
 */
export async function endDungeonTurn() {
  // The encounter signed at the end of the LAST DT landed somewhere in the DT
  // that has just elapsed. Resolve it before rolling a new check, so a second
  // telegraph cannot overwrite an unresolved first one.
  const landed = await resolvePendingEncounter();

  const { udRolls, expired } = await runEndOfDtEffects();
  const dt = await bumpDT();
  const ec = await rollEncounterCheck({ label: "End-of-DT" });

  if (ec.telegraph) await setPendingEncounter({ dt, roll: ec.roll, en: ec.en });

  const udBlock = udRolls.length
    ? `<div><strong>Usage dice rolled (${udRolls.length}):</strong><ul>${udRolls.map(r =>
        `<li>${r.actor} — ${r.item}: ${r.rolls.length}d6=[${r.rolls.join(", ")}]${r.removed ? ` <em>(${r.removed === 1 ? "1 die" : `${r.removed} dice`} removed; ${r.depleted ? "depleted" : `${r.udCurrent} left`})</em>` : ""}</li>`
      ).join("")}</ul></div>`
    : `<div><em>No DT-expiry usage dice to roll.</em></div>`;
  const expiredBlock = expired.length
    ? `<div><strong>Conditions ended (${expired.length}):</strong> ${expired.map(e => `${e.actor} (${e.conditions.join(", ")})`).join("; ")}</div>`
    : "";
  const landedBlock = landed.ok
    ? `<div><strong>The telegraphed encounter landed this turn.</strong></div>`
    : "";
  const ecBlock = `<div><strong>Encounter check:</strong> 1d10=${ec.roll} vs ${ec.en}+ → ${
    ec.immediate ? "<strong>IMMEDIATE</strong>" : ec.telegraph ? "<strong>signed — lands next DT</strong>" : "no encounter"
  }</div>`;

  const content = `<div class="crows dt-summary">
  <header><strong>End of Dungeon Turn #${dt}</strong> <em>(${getDTLength().label})</em></header>
  ${landedBlock}
  ${udBlock}
  ${expiredBlock}
  ${ecBlock}
</div>`;
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({ content, whisper, speaker: { alias: "Dungeon Turn" } });

  return {
    dt,
    udRolls: udRolls.length,
    udDepleted: udRolls.filter(r => r.depleted).length,
    expired: expired.length,
    encounter: ec,
    landedTelegraph: landed.ok
  };
}

/**
 * Starting a rest ends the current dungeon turn with NO encounter check
 * (R:630) — the rest's own 2-hourly checks cover that stretch of time instead,
 * and the end-of-DT effects fire at the rest's halfway point, not here.
 */
export async function endDungeonTurnForRest() {
  return bumpDT();
}
