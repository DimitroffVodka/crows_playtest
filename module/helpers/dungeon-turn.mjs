/**
 * Dungeon Turn (DT) tracker + end-of-DT pipeline.
 *
 * Rules Booklet pp.10–11:
 *  - Each DT = 30 minutes (real-time or in-fiction).
 *  - End of every DT:
 *      1. Roll usage dice for items/effects with "DT" expiry.
 *      2. Roll an encounter check (default 1d6 ≥ 6).
 *      3. (system-implemented) Blessed/Boned levels reset to 0.
 *
 * GMs invoke via the crow sheet's "End DT" button or directly via
 *   game.crows.dt.end()
 */

import { rollUsageDie } from "./usage-die.mjs";

const NS = "crows";
const KEY_DT = "dtCounter";
const KEY_EN = "dungeonEN";

export function registerDungeonTurnSettings() {
  game.settings.register(NS, KEY_DT, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
  game.settings.register(NS, KEY_EN, {
    scope: "world",
    config: true,
    name: "Default Dungeon Encounter Number",
    hint: "1d6 result that triggers an encounter check (default 6). Lower for crowded dungeons.",
    type: Number,
    range: { min: 2, max: 6, step: 1 },
    default: 6
  });
}

export function getDT() {
  try { return Number(game.settings.get(NS, KEY_DT)) || 0; } catch { return 0; }
}
export async function setDT(n) {
  return game.settings.set(NS, KEY_DT, Math.max(0, Math.floor(Number(n) || 0)));
}
export async function bumpDT() {
  const cur = getDT();
  await setDT(cur + 1);
  return cur + 1;
}
export function getDungeonEN() {
  try { return Math.max(2, Math.min(6, Number(game.settings.get(NS, KEY_EN)) || 6)); } catch { return 6; }
}

/**
 * Roll a 1d6 encounter check against the threshold. Triggers when the
 * roll is >= the EN (i.e. EN 6 = only 6 triggers; EN 5 = 5 or 6; etc.).
 */
export async function rollEncounterCheck({ en = null, label = "Dungeon" } = {}) {
  const threshold = Math.max(2, Math.min(6, Number(en ?? getDungeonEN()) || 6));
  const roll = await new Roll("1d6").evaluate();
  const triggered = roll.total >= threshold;
  const content = `<div class="crows encounter-check ${triggered ? "triggered" : "clear"}">
    <header><strong>${label} encounter check</strong></header>
    <div>Threshold: <strong>${threshold}+</strong> · Rolled <strong>${roll.total}</strong></div>
    <div class="ec-result">${triggered ? "<strong>Encounter triggered — roll on the encounter table.</strong>" : "<em>No encounter.</em>"}</div>
  </div>`;
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({ content, whisper, speaker: { alias: "Encounter Check" } });
  return { total: roll.total, threshold, triggered };
}

/**
 * End the current dungeon turn:
 *   - Bump DT counter.
 *   - Roll any DT-expiry usage dice on every crow's items.
 *   - Reset blessed/boned levels to 0 on every crow.
 *   - Roll an encounter check.
 *   - Post a single GM-whispered summary chat card.
 */
export async function endDungeonTurn() {
  const dt = await bumpDT();

  // 1) Roll DT-expiry UDs on all crows' items.
  const crows = game.actors.filter(a => a.type === "crow");
  const udRolls = [];
  for (const crow of crows) {
    for (const item of crow.items) {
      const ud = item.system?.usageDie;
      if (ud?.enabled && ud.expiry === "dt" && (ud.udCurrent ?? 0) > 0) {
        const res = await rollUsageDie(item);
        udRolls.push({
          actor: crow.name, item: item.name,
          roll: res.roll, removed: res.removed,
          udCurrent: res.udCurrent, depleted: res.depleted
        });
      }
    }
  }

  // 2) Reset blessed/boned on all crows.
  const resets = [];
  for (const crow of crows) {
    const b = crow.system?.conditions?.blessed ?? 0;
    const n = crow.system?.conditions?.boned ?? 0;
    if (b > 0 || n > 0) {
      await crow.update({ "system.conditions.blessed": 0, "system.conditions.boned": 0 });
      resets.push({ actor: crow.name, blessed: b, boned: n });
    }
  }

  // 3) Encounter check.
  const ec = await rollEncounterCheck({ label: "End-of-DT" });

  // 4) Clear per-DT boon side-effects (Boon of Swiftness speed flag).
  try {
    const { clearPerDtBoonFlags } = await import("./crypt.mjs");
    await clearPerDtBoonFlags();
  } catch { /* crypt module not loaded */ }

  // 5) Summary chat card.
  const udBlock = udRolls.length
    ? `<div><strong>Usage dice rolled (${udRolls.length}):</strong><ul>${udRolls.map(r =>
        `<li>${r.actor} — ${r.item}: 1d6=${r.roll}${r.removed ? ` <em>(die removed; ${r.depleted ? "depleted" : `${r.udCurrent} left`})</em>` : ""}</li>`
      ).join("")}</ul></div>`
    : `<div><em>No DT-expiry usage dice to roll.</em></div>`;
  const resetBlock = resets.length
    ? `<div><strong>Blessed/Boned reset (${resets.length}):</strong> ${resets.map(r => `${r.actor} (b${r.blessed}/n${r.boned})`).join(", ")}</div>`
    : "";
  const ecBlock = `<div><strong>Encounter check:</strong> 1d6=${ec.total} vs ${ec.threshold}+ → ${ec.triggered ? "<strong>TRIGGERED</strong>" : "no encounter"}</div>`;

  const content = `<div class="crows dt-summary">
  <header><strong>End of Dungeon Turn #${dt}</strong></header>
  ${udBlock}
  ${resetBlock}
  ${ecBlock}
</div>`;
  const whisper = ChatMessage.getWhisperRecipients?.("GM") ?? [];
  await ChatMessage.create({ content, whisper, speaker: { alias: "Dungeon Turn" } });

  return {
    dt,
    udRolls: udRolls.length,
    udDepleted: udRolls.filter(r => r.depleted).length,
    resets: resets.length,
    encounter: ec.triggered
  };
}
