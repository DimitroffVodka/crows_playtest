/**
 * Rest (6-hour rest, 4h sleeping minimum).
 *
 * Rules Booklet p.11:
 *  - Regain all Stamina.
 *  - Remove 1 wound (or 2 via the Tend Wounds rest activity).
 *  - Spellbooks regain all UD on rest (and any "rest"-expiry items).
 *  - Encounter check every 2 hours (3 checks during the 6-hour rest).
 *  - Blessed/Boned levels also wipe (since they end at end-of-DT).
 *  - Each crow may take ONE rest activity (Tend Wounds, Identify Item,
 *    Prepare for Task, Craft Equipment, or Harvest).
 *
 *  Town rest variant has NO encounter checks; pass {inTown: true}.
 *
 * Activity dispatch:
 *  - "tendWounds"     → -2 wounds (instead of -1) + summary card line.
 *  - "identifyItem"   → mechanical no-op; posts a card naming the item being
 *                       identified so the GM can reveal its properties.
 *  - "prepareForTask" → writes system.preparedTask = { skill, detail, setOn }
 *                       so the next rollTest on that skill gets +1 (one-shot).
 *  - "craftEquipment" → mechanical no-op (full crafting system is M3); posts
 *                       a card naming the project so the GM can adjudicate.
 *  - "harvest"        → mechanical no-op; posts a card naming the target.
 */

import { rollEncounterCheck, getDT } from "./dungeon-turn.mjs";

const ACTIVITIES = new Set(["none","tendWounds","identifyItem","prepareForTask","craftEquipment","harvest"]);

/**
 * Restore all "rest"-expiry usage dice on an actor's items (spellbooks etc.).
 */
export async function restoreSpellbookUds(actor) {
  if (!actor) return { ok: false, restored: 0 };
  const updates = [];
  for (const i of actor.items) {
    const ud = i.system?.usageDie;
    if (!ud?.enabled) continue;
    if (ud.expiry !== "rest") continue;
    if ((ud.udCurrent ?? 0) >= (ud.udMax ?? 0)) continue;
    updates.push({ _id: i.id, "system.usageDie.udCurrent": ud.udMax });
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  return { ok: true, restored: updates.length };
}

/**
 * @param {Actor} actor       The resting crow.
 * @param {object} [opts]
 * @param {boolean} [opts.tendedBy=false]   Legacy alias for activity="tendWounds".
 * @param {boolean} [opts.inTown=false]     Town rest — no encounter checks.
 * @param {string}  [opts.activity]         One of: none|tendWounds|identifyItem|prepareForTask|craftEquipment|harvest.
 * @param {object}  [opts.activityData]     Activity-specific payload (see _postActivityCard).
 */
export async function takeRest(actor, { tendedBy = false, inTown = false, activity = "none", activityData = null } = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  if (actor.type !== "crow") return { ok: false, error: "rest is for crows only" };

  // Legacy: tendedBy bool implies the Tend Wounds activity.
  if (tendedBy && activity === "none") activity = "tendWounds";
  if (!ACTIVITIES.has(activity)) activity = "none";

  const sys = actor.system ?? {};
  const stamMax = sys.stamina?.max ?? 0;
  const woundsBefore = sys.wounds ?? 0;
  const woundReduction = (activity === "tendWounds") ? 2 : 1;
  const woundsAfter = Math.max(0, woundsBefore - woundReduction);
  const stamBefore = sys.stamina?.value ?? 0;

  const updates = {
    "system.stamina.value": stamMax,
    "system.wounds": woundsAfter,
    "system.conditions.blessed": 0,
    "system.conditions.boned": 0
  };
  await actor.update(updates);

  // Restore rest-expiry UDs (spellbooks etc.)
  const restored = await restoreSpellbookUds(actor);

  // Encounter checks every 2 hours during the 6-hour rest (3 checks unless in town).
  const ecResults = [];
  if (!inTown) {
    for (let i = 0; i < 3; i++) {
      const ec = await rollEncounterCheck({ label: `Rest hour ${(i + 1) * 2}` });
      ecResults.push(ec);
      if (ec.triggered) break;     // First triggered encounter interrupts the rest
    }
  }

  // Summary chat card.
  const activityLabel = _activityLabel(activity);
  const ecBlock = inTown
    ? `<li><em>Town rest — no encounter checks.</em></li>`
    : `<li>Encounter checks: ${ecResults.length} (${ecResults.filter(r => r.triggered).length} triggered)${ecResults.some(r => r.triggered) ? " — <strong>rest interrupted!</strong>" : ""}</li>`;
  const content = `<div class="crows rest-summary">
  <header><strong>${actor.name} rests</strong>${activity !== "none" ? ` <em>(${activityLabel})</em>` : ""}${inTown ? " <em>[town]</em>" : ""}</header>
  <ul>
    <li>Stamina: ${stamBefore} → <strong>${stamMax}</strong></li>
    <li>Wounds: ${woundsBefore} → <strong>${woundsAfter}</strong>${activity === "tendWounds" ? " <em>(Tend Wounds)</em>" : ""}</li>
    <li>Blessed/Boned reset to 0</li>
    <li>Rest-expiry usage dice restored on <strong>${restored.restored}</strong> item(s)</li>
    ${ecBlock}
  </ul>
</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });

  // Activity sub-workflow (after the summary).
  let activityResult = null;
  if (activity !== "none" && activity !== "tendWounds") {
    activityResult = await _postActivityCard(actor, activity, activityData);
  }

  // Miasma resist test — outdoor non-town rests in Cornath (Rules p.1117).
  // Indoor or town rests are exempt. The test resolves to +1 boned and/or
  // an effect-table roll on tier 1/2.
  let miasmaResult = null;
  if (!inTown) {
    const { getInMiasma, rollMiasmaResist } = await import("./miasma.mjs");
    if (getInMiasma() && !actor.system?.miasma?.permanentNPC) {
      miasmaResult = await rollMiasmaResist(actor);
    }
  }

  return {
    ok: true,
    activity,
    stamina: { before: stamBefore, after: stamMax },
    wounds: { before: woundsBefore, after: woundsAfter },
    restoredUds: restored.restored,
    encounters: ecResults,
    interrupted: ecResults.some(r => r.triggered),
    activityResult,
    miasmaResult
  };
}

function _activityLabel(activity) {
  return ({
    none: "no activity",
    tendWounds: "Tend Wounds",
    identifyItem: "Identify Item",
    prepareForTask: "Prepare for Task",
    craftEquipment: "Craft Equipment",
    harvest: "Harvest"
  })[activity] ?? activity;
}

/**
 * Dispatches activity-specific behavior and posts a chat card. Tend Wounds is
 * handled in the main rest flow (just a wound modifier). The other activities
 * are mostly narrative/GM-facing in M1; only Prepare for Task writes state.
 */
async function _postActivityCard(actor, activity, data = null) {
  data = data ?? {};
  const speaker = ChatMessage.getSpeaker({ actor });
  const dt = (() => { try { return getDT(); } catch { return 0; } })();

  if (activity === "identifyItem") {
    const itemName = (data.itemName || "").trim() || "<em>(unnamed item)</em>";
    const itemId = data.itemId || null;
    let foundDesc = "";
    if (itemId) {
      const it = actor.items.get(itemId);
      if (it?.system?.description) foundDesc = `<div class="rest-activity-desc">${it.system.description}</div>`;
    }
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity identify-item">
        <header><strong>${actor.name}</strong> spends the rest identifying <strong>${itemName}</strong></header>
        ${foundDesc || `<em>GM reveals identified properties.</em>`}
      </div>`
    });
    return { ok: true, activity, itemName };
  }

  if (activity === "prepareForTask") {
    const skill = (data.skill || "").trim();
    const detail = (data.detail || "").trim() || "the task";
    if (!skill) {
      ui.notifications?.warn("Prepare for Task: no skill chosen — preparation NOT recorded.");
      return { ok: false, activity, error: "no skill" };
    }
    await actor.update({
      "system.preparedTask.skill": skill,
      "system.preparedTask.detail": detail,
      "system.preparedTask.setOn": dt
    });
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity prepare-for-task">
        <header><strong>${actor.name}</strong> prepares for <strong>${detail}</strong></header>
        <div>Next <strong>${skill}</strong> test gets <strong>+1</strong> (one-shot, consumed on use).</div>
      </div>`
    });
    return { ok: true, activity, skill, detail };
  }

  if (activity === "craftEquipment") {
    const project = (data.project || "").trim() || "<em>(unnamed project)</em>";
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity craft-equipment">
        <header><strong>${actor.name}</strong> crafts <strong>${project}</strong></header>
        <em>GM adjudicates progress (full crafting economy is M3 scope).</em>
      </div>`
    });
    return { ok: true, activity, project };
  }

  if (activity === "harvest") {
    const target = (data.target || "").trim() || "<em>(unnamed quarry)</em>";
    await ChatMessage.create({
      speaker,
      content: `<div class="crows rest-activity harvest">
        <header><strong>${actor.name}</strong> harvests <strong>${target}</strong></header>
        <em>GM rolls/awards harvested components.</em>
      </div>`
    });
    return { ok: true, activity, target };
  }

  return { ok: false, activity, error: "unknown activity" };
}

/**
 * Consume a Prepare-for-Task buff if it matches `skill`. Returns the +1 modifier
 * if consumed, or 0 if not applicable. Idempotent on the actor when no match.
 */
export async function consumePreparedTask(actor, skill) {
  if (!actor || actor.type !== "crow") return 0;
  const prep = actor.system?.preparedTask;
  if (!prep?.skill || prep.skill !== skill) return 0;
  // Clear it.
  await actor.update({
    "system.preparedTask.skill": "",
    "system.preparedTask.detail": "",
    "system.preparedTask.setOn": 0
  });
  return 1;
}
