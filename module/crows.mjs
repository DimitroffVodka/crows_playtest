import { CROWS } from "./config.mjs";
import { CrowsItemSheet } from "./sheets/item-sheet.mjs";
import { CrowData } from "./data/actor/crow.mjs";
import { MonsterData } from "./data/actor/monster.mjs";
import { WeaponData } from "./data/item/weapon.mjs";
import { ArmorData } from "./data/item/armor.mjs";
import { AmmunitionData } from "./data/item/ammunition.mjs";
import { ConsumableData } from "./data/item/consumable.mjs";
import { GearData } from "./data/item/gear.mjs";
import { SpellbookData } from "./data/item/spellbook.mjs";
import { TraitData } from "./data/item/trait.mjs";
import { BackgroundData } from "./data/item/background.mjs";
import { rollTest, classifyTier, classifyDoomCrit } from "./helpers/roll.mjs";
import { applyBackground } from "./helpers/creation.mjs";
import { applyDamage, applyHealing, repairArmor } from "./helpers/damage.mjs";
import { registerChaosSetting, getChaos, setChaos, addToChaos, resetChaos, showChaosDialog } from "./helpers/chaos.mjs";
import { rollBacklash, lookupBacklash } from "./helpers/backlash.mjs";
import { castSpell } from "./helpers/spellcasting.mjs";
import {
  registerDungeonTurnSettings, endDungeonTurn, rollEncounterCheck,
  getDT, setDT, bumpDT, getDungeonEN
} from "./helpers/dungeon-turn.mjs";
import { takeRest, restoreSpellbookUds } from "./helpers/rest.mjs";
import { gainXP, bonusesEarned, nextBonusTXP, isTraitBuyable, purchaseTrait, bonusesAvailable, spendSkillBonus, spendCharBonus } from "./helpers/advancement.mjs";
import { attackWithWeapon } from "./helpers/attack.mjs";
import { registerConditions } from "./conditions.mjs";
import { MonsterSheet } from "./sheets/monster-sheet.mjs";
import { CrowSheet } from "./sheets/crow-sheet.mjs";

Hooks.once("init", () => {
  console.log("crows | init");
  CONFIG.CROWS = CROWS;
  // Handlebars helpers used by the crow sheet (re-register safely; built-in eq/lt/gt are overwritten with same behavior)
  Handlebars.registerHelper("gte", (a, b) => Number(a) >= Number(b));
  Handlebars.registerHelper("add", (a, b) => Number(a) + Number(b));
  registerConditions();
  Object.assign(CONFIG.Item.dataModels, {
    weapon: WeaponData, armor: ArmorData, ammunition: AmmunitionData,
    consumable: ConsumableData, gear: GearData, spellbook: SpellbookData,
    trait: TraitData, background: BackgroundData
  });
  Object.assign(CONFIG.Actor.dataModels, { crow: CrowData, monster: MonsterData });
  registerChaosSetting();
  registerDungeonTurnSettings();
  game.crows = Object.assign(game.crows ?? {}, {
    rollTest, classifyTier, classifyDoomCrit,
    applyBackground,
    applyDamage, applyHealing, repairArmor,
    castSpell, rollBacklash, lookupBacklash,
    takeRest, restoreSpellbookUds,
    gainXP, bonusesEarned, nextBonusTXP, isTraitBuyable, purchaseTrait, bonusesAvailable, spendSkillBonus, spendCharBonus,
    attackWithWeapon,
    chaos: { get: getChaos, set: setChaos, add: addToChaos, reset: resetChaos, show: showChaosDialog },
    dt: { get: getDT, set: setDT, bump: bumpDT, end: endDungeonTurn, encounterCheck: rollEncounterCheck, getDungeonEN }
  });
  foundry.documents.collections.Items.registerSheet("crows", CrowsItemSheet, { makeDefault: true, label: "Crows Item Sheet" });
  foundry.documents.collections.Actors.registerSheet("crows", MonsterSheet, { types: ["monster"], makeDefault: true, label: "Crows Monster Sheet" });
  foundry.documents.collections.Actors.registerSheet("crows", CrowSheet, { types: ["crow"], makeDefault: true, label: "Crow Sheet" });
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/crow/sheet.hbs"]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/chat/test-card.hbs"]);
  foundry.applications.handlebars.loadTemplates([
    "systems/crows/templates/partials/physical-item.hbs",
    "systems/crows/templates/partials/usage-die.hbs"
  ]);
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/actor/monster.hbs"]);
});

Hooks.once("ready", () => {
  console.log("crows | ready");
});

/**
 * Sync Active Effects ↔ system.conditions on crows.
 *   - Boolean conditions (grabbed/prone/unconscious): mirror the AE's
 *     presence onto the boolean field.
 *   - Leveled conditions (blessed/boned): each AE add increments the
 *     counter; each delete decrements (clamped at 0). Players who want
 *     to set a level directly should use the +/− buttons on the sheet.
 */
const _BOOL_CONDS = ["grabbed", "prone", "unconscious"];
const _LEVELED_CONDS = ["blessed", "boned"];

Hooks.on("createActiveEffect", async (effect /*, options, userId */) => {
  const actor = effect.parent;
  if (!actor || actor.type !== "crow") return;
  const statuses = [...(effect.statuses ?? [])];
  if (!statuses.length) return;
  const updates = {};
  for (const id of statuses) {
    if (_BOOL_CONDS.includes(id)) updates[`system.conditions.${id}`] = true;
    if (_LEVELED_CONDS.includes(id)) updates[`system.conditions.${id}`] = (actor.system.conditions?.[id] ?? 0) + 1;
  }
  if (Object.keys(updates).length) await actor.update(updates);
});

Hooks.on("deleteActiveEffect", async (effect) => {
  const actor = effect.parent;
  if (!actor || actor.type !== "crow") return;
  const statuses = [...(effect.statuses ?? [])];
  if (!statuses.length) return;
  const updates = {};
  for (const id of statuses) {
    if (_BOOL_CONDS.includes(id)) {
      // Only clear if no other AE on the actor still carries this status.
      const stillHas = actor.effects.some(e => e.id !== effect.id && e.statuses?.has?.(id));
      if (!stillHas) updates[`system.conditions.${id}`] = false;
    }
    if (_LEVELED_CONDS.includes(id)) updates[`system.conditions.${id}`] = Math.max(0, (actor.system.conditions?.[id] ?? 0) - 1);
  }
  if (Object.keys(updates).length) await actor.update(updates);
});

/**
 * Wire chat-card actions (e.g. "Apply T2/T3" damage buttons).
 * v14 uses renderChatMessageHTML (per CLAUDE.md). We delegate clicks on
 * [data-action="applyDamage"] to game.crows.applyDamage against the
 * currently-controlled token(s); fall back to the user's character if no
 * token is selected.
 */
Hooks.on("renderChatMessageHTML", (message, html /*, context */) => {
  const buttons = html.querySelectorAll('[data-action="applyDamage"]');
  for (const btn of buttons) {
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const amount = Number(ev.currentTarget.dataset.amount) || 0;
      const piercing = ev.currentTarget.dataset.piercing === "true";
      const actors = [];
      if (canvas.tokens?.controlled?.length) {
        for (const t of canvas.tokens.controlled) if (t.actor) actors.push(t.actor);
      } else if (game.user.character) {
        actors.push(game.user.character);
      }
      if (!actors.length) {
        ui.notifications?.warn("Select a token to apply damage to.");
        return;
      }
      const results = [];
      for (const a of actors) results.push(await applyDamage(a, amount, { piercing }));
      // Brief summary in chat (whisper to GM if rollMode is whisper; otherwise public)
      const lines = results.filter(r => r?.ok).map(r => {
        if (r.actorType === "monster") return `<li><b>${r.actorName}</b>: ${r.total} → Stamina ${r.stamina.before}→${r.stamina.after}${r.defeated ? " <em>(defeated)</em>" : ""}</li>`;
        const parts = [];
        if (r.absorbed.armor) parts.push(`armor ${r.absorbed.armor}`);
        if (r.absorbed.stamina) parts.push(`stamina ${r.absorbed.stamina}`);
        if (r.absorbed.wounds) parts.push(`wounds ${r.absorbed.wounds}`);
        const broken = r.armorBroken?.length ? ` <em>broken: ${r.armorBroken.join(", ")}</em>` : "";
        const bonedNote = r.bonedBonus ? ` <em>+${r.bonedBonus} boned</em>` : "";
        const dead = r.dead ? " <strong>(dead)</strong>" : "";
        return `<li><b>${r.actorName}</b>: ${r.total}${bonedNote} → ${parts.join(" · ") || "no effect"}${broken}${dead}</li>`;
      });
      const summary = `<div class="crows damage-applied"><strong>Damage applied:</strong><ul>${lines.join("")}</ul></div>`;
      await ChatMessage.create({ content: summary, speaker: { alias: "Damage" } });
    });
  }
});
