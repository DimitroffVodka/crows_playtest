const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { ALL_EXPERTISES, CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";
import { applyDamage, applyHealing } from "../helpers/damage.mjs";
import { adjustXRestUse, monsterViewData, toggleMonsterWound } from "../helpers/monster-view.mjs";

export class MonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "monster"],
    position: { width: 620, height: 760 },
    actions: {
      rollAttack:      MonsterSheet._onRollAttack,
      addAttack:       MonsterSheet._onAddAttack,
      deleteAttack:    MonsterSheet._onDeleteAttack,
      togglePiercing:  MonsterSheet._onTogglePiercing,
      addTrait:        MonsterSheet._onAddTrait,
      deleteTrait:     MonsterSheet._onDeleteTrait,
      damageSelf:      MonsterSheet._onDamageSelf,
      healSelf:        MonsterSheet._onHealSelf,
      toggleCondition: MonsterSheet._onToggleCondition,
      addXRest:        MonsterSheet._onAddXRest,
      deleteXRest:     MonsterSheet._onDeleteXRest,
      adjustXRest:     MonsterSheet._onAdjustXRest,
      addExpertise:    MonsterSheet._onAddExpertise,
      deleteExpertise: MonsterSheet._onDeleteExpertise,
      toggleWound:     MonsterSheet._onToggleWound
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };
  static PARTS = { body: { template: "systems/crows/templates/actor/monster.hbs" } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.document.system;
    ctx.system = sys;
    ctx.actor = this.document;
    ctx.CROWS = CROWS;
    ctx.isGM = !!game.user?.isGM;
    ctx.isOwner = this.document.isOwner === true;

    Object.assign(ctx, monsterViewData(sys, {
      expertiseKeys: ALL_EXPERTISES,
      conditionKeys: CROWS.conditions,
      localize: (key) => game.i18n?.localize?.(key) ?? key
    }));

    // Speed display: base + named modes (e.g. "6, climb 4, fly 6")
    const modes = (sys.speed?.modes ?? []).filter(m => m?.name && m?.value);
    ctx.speedDisplay = [sys.speed?.value ?? 0, ...modes.map(m => `${m.name} ${m.value}`)].join(", ");

    // Defeated flag (visible badge).
    ctx.defeated = (sys.stamina?.value ?? 0) <= 0 || !!sys.conditions?.defeated;

    // Decorate attacks for grid rendering.
    ctx.attacks = (sys.attacks ?? []).map((a, i) => ({
      ...a, idx: i,
      tarSuffix: (a.targets ?? 1) > 1 ? ` (${a.targets} tar)` : ""
    }));

    // Decorate traits for rendering.
    ctx.traits = (sys.traits ?? []).map((t, i) => ({ ...t, idx: i }));

    return ctx;
  }

  // ────────────────────────────────────────────────────────────── actions
  static async _onRollAttack(event, target) {
    const idx = Number(target.dataset.index);
    const atk = this.document.system.attacks[idx];
    if (!atk) return;
    const isMelee = /^melee/i.test(atk.range ?? "");
    await rollTest({
      actor: this.document,
      mods: [{ value: atk.toHit ?? 0, label: `${atk.name} +${atk.toHit ?? 0}` }],
      flavor: `${this.document.name}: ${atk.name}`,
      attack: {
        t2: atk.dmgT2, t3: atk.dmgT3,
        isMelee, piercing: !!atk.piercing,
        weaponName: atk.name,
        targets: atk.targets ?? 1
      }
    });
  }

  static async _onAddAttack() {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const attacks = [...(this.document.system.attacks ?? [])];
    attacks.push({
      name: "New Attack",
      toHit: 0,
      range: "Melee 1",
      targets: 1,
      dmgT2: 1,
      dmgT3: 2,
      piercing: false,
      riderRef: ""
    });
    await this.document.update({ "system.attacks": attacks });
  }

  static async _onDeleteAttack(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const idx = Number(target.dataset.index);
    const attacks = [...(this.document.system.attacks ?? [])];
    attacks.splice(idx, 1);
    await this.document.update({ "system.attacks": attacks });
  }

  static async _onTogglePiercing(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const idx = Number(target.dataset.index);
    const attacks = [...(this.document.system.attacks ?? [])];
    if (!attacks[idx]) return;
    attacks[idx] = { ...attacks[idx], piercing: !attacks[idx].piercing };
    await this.document.update({ "system.attacks": attacks });
  }

  static async _onAddTrait() {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const traits = [...(this.document.system.traits ?? [])];
    traits.push({ name: "New Trait", effect: "", uses: "", linkedAttack: "" });
    await this.document.update({ "system.traits": traits });
  }

  static async _onDeleteTrait(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const idx = Number(target.dataset.index);
    const traits = [...(this.document.system.traits ?? [])];
    traits.splice(idx, 1);
    await this.document.update({ "system.traits": traits });
  }

  static async _onDamageSelf() {
    const DialogV2 = foundry.applications.api.DialogV2;
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${this.document.name} — Apply damage` },
        content: `<div class="crows monster-dmg-form">
          <label>Amount: <input type="number" name="amount" value="1" min="0" step="1" autofocus></label>
          <label><input type="checkbox" name="piercing"> Piercing (bypasses AD)</label>
        </div>`,
        ok: {
          label: "Apply",
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            return {
              amount: Number(root?.querySelector?.('input[name="amount"]')?.value ?? 0),
              piercing: !!root?.querySelector?.('input[name="piercing"]')?.checked
            };
          }
        }
      });
      if (!choice || !choice.amount) return;
      await applyDamage(this.document, choice.amount, { piercing: choice.piercing });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onHealSelf() {
    const DialogV2 = foundry.applications.api.DialogV2;
    try {
      const choice = await DialogV2.prompt({
        window: { title: `${this.document.name} — Apply healing` },
        content: `<div class="crows monster-heal-form">
          <label>Stamina: <input type="number" name="stamina" value="1" min="0" step="1" autofocus></label>
        </div>`,
        ok: {
          label: "Heal",
          callback: (event, button, dialog) => {
            const root = dialog.element ?? button?.form;
            return { stamina: Number(root?.querySelector?.('input[name="stamina"]')?.value ?? 0) };
          }
        }
      });
      if (!choice || !choice.stamina) return;
      await applyHealing(this.document, { stamina: choice.stamina });
      this.render();
    } catch { /* dismissed */ }
  }

  static async _onToggleCondition(event, target) {
    if (this.document.isOwner !== true) return;
    const cond = target.dataset.condition;
    if (!cond) return;
    const cur = !!(this.document.system.conditions?.[cond]);
    await this.document.update({ [`system.conditions.${cond}`]: !cur });
  }

  static async _onAddXRest() {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const features = [...(this.document.system.xRest ?? [])];
    features.push({ name: "New Feature", max: 1, used: 0 });
    await this.document.update({ "system.xRest": features });
  }

  static async _onDeleteXRest(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const index = Number(target.dataset.index);
    const features = [...(this.document.system.xRest ?? [])];
    if (!Number.isInteger(index) || index < 0 || index >= features.length) return;
    features.splice(index, 1);
    await this.document.update({ "system.xRest": features });
  }

  static async _onAdjustXRest(event, target) {
    if (this.document.isOwner !== true) return;
    const features = adjustXRestUse(
      this.document.system.xRest,
      target.dataset.index,
      target.dataset.delta
    );
    await this.document.update({ "system.xRest": features });
  }

  static async _onAddExpertise() {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const expertises = [...(this.document.system.expertises ?? [])];
    const owned = new Set(expertises.map((entry) => entry?.key));
    const key = ALL_EXPERTISES.find((candidate) => !owned.has(candidate));
    if (!key) { ui.notifications?.warn("This creature already has every expertise."); return; }
    expertises.push({ key, value: 1, max: 1 });
    await this.document.update({ "system.expertises": expertises });
  }

  static async _onDeleteExpertise(event, target) {
    if (!game.user.isGM) { ui.notifications?.warn("GM only."); return; }
    const index = Number(target.dataset.index);
    const expertises = [...(this.document.system.expertises ?? [])];
    if (!Number.isInteger(index) || index < 0 || index >= expertises.length) return;
    expertises.splice(index, 1);
    await this.document.update({ "system.expertises": expertises });
  }

  static async _onToggleWound(event, target) {
    if (this.document.isOwner !== true) return;
    const woundSlots = toggleMonsterWound(
      this.document.system.woundSlots,
      target.dataset.index,
      this.document.system.slots
    );
    await this.document.update({ "system.woundSlots": woundSlots });
  }
}
