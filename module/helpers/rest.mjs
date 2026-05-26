/**
 * Rest (6-hour rest, 4h sleeping minimum).
 *
 * Rules Booklet p.11:
 *  - Regain all Stamina.
 *  - Remove 1 wound (or 2 via the Tend Wounds rest activity).
 *  - Spellbooks regain all UD on rest (and any "rest"-expiry items).
 *  - Encounter check every 2 hours (3 checks during the 6-hour rest).
 *  - Blessed/Boned levels also wipe (since they end at end-of-DT).
 *
 *  Town rest variant has NO encounter checks; pass {inTown: true}.
 */

import { rollEncounterCheck } from "./dungeon-turn.mjs";

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
 * @param {boolean} [opts.tendedBy=false]    Tend Wounds rest activity (extra wound removed).
 * @param {boolean} [opts.inTown=false]      Town rest — no encounter checks.
 * @param {string}  [opts.activity]          Free-text rest-activity label for the summary.
 */
export async function takeRest(actor, { tendedBy = false, inTown = false, activity = null } = {}) {
  if (!actor) return { ok: false, error: "no actor" };
  if (actor.type !== "crow") return { ok: false, error: "rest is for crows only" };

  const sys = actor.system ?? {};
  const stamMax = sys.stamina?.max ?? 0;
  const woundsBefore = sys.wounds ?? 0;
  const woundReduction = tendedBy ? 2 : 1;
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
  const ecBlock = inTown
    ? `<li><em>Town rest — no encounter checks.</em></li>`
    : `<li>Encounter checks: ${ecResults.length} (${ecResults.filter(r => r.triggered).length} triggered)${ecResults.some(r => r.triggered) ? " — <strong>rest interrupted!</strong>" : ""}</li>`;
  const content = `<div class="crows rest-summary">
  <header><strong>${actor.name} rests</strong>${activity ? ` <em>(${activity})</em>` : ""}</header>
  <ul>
    <li>Stamina: ${stamBefore} → <strong>${stamMax}</strong></li>
    <li>Wounds: ${woundsBefore} → <strong>${woundsAfter}</strong>${tendedBy ? " <em>(Tend Wounds)</em>" : ""}</li>
    <li>Blessed/Boned reset to 0</li>
    <li>Rest-expiry usage dice restored on <strong>${restored.restored}</strong> item(s)</li>
    ${ecBlock}
  </ul>
</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });

  return {
    ok: true,
    stamina: { before: stamBefore, after: stamMax },
    wounds: { before: woundsBefore, after: woundsAfter },
    restoredUds: restored.restored,
    encounters: ecResults,
    interrupted: ecResults.some(r => r.triggered)
  };
}
