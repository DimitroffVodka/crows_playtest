const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";

const SPELL_SKILLS = new Set(["alteration","benefaction","conjuration","elemental","illusion","necromancy"]);
const WEAPON_SKILLS = new Set(["bashing","bow","chopping","slashing","stabbing","unarmed"]);

export class CrowSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows","sheet","crow"],
    position: { width: 720, height: 760 },
    actions: {
      tab: CrowSheet._onTab,
      rollSkill: CrowSheet._onRollSkill,
      adjBlessed: CrowSheet._onAdjBlessed,
      adjBoned: CrowSheet._onAdjBoned
    },
    window: { resizable: true },
    form: { submitOnChange: true }
  };

  static PARTS = { body: { template: "systems/crows/templates/actor/crow/sheet.hbs" } };

  _activeTab = "play";

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const sys = this.document.system;
    ctx.system = sys; ctx.actor = this.document; ctx.CROWS = CROWS;
    ctx.activeTab = this._activeTab;
    ctx.tabs = ["play","inventory","traits","advancement","bio"];
    ctx.skills = Object.entries(sys.skills).map(([k,v]) => ({
      key: k, bonus: v.bonus,
      char: WEAPON_SKILLS.has(k) ? "strength" : SPELL_SKILLS.has(k) ? "mind" : "agility"
    }));
    ctx.grid = this._buildGrid();
    ctx.traitItems = this.document.items.filter(i => i.type === "trait");
    return ctx;
  }

  _buildGrid() {
    const sys = this.document.system;
    const byContainer = (c) => this.document.items.filter(i => i.system?.location?.container === c);
    const cap = CROWS.backpackSize;
    const wounds = sys.wounds ?? 0;
    const backpack = [];
    for (let i = 0; i < cap; i++) {
      const isWound = i >= (cap - wounds);
      const item = byContainer("backpack").find(it => it.system.location.index === i) ?? null;
      backpack.push({ index: i, isWound, name: item?.name ?? "" });
    }
    return {
      hand: byContainer("hand").map(i => ({ name: i.name })),
      belt: byContainer("belt").map(i => ({ name: i.name })),
      single: ["waist","neck","gloves","boots","ring","head"].map(c => ({ c, name: byContainer(c)[0]?.name ?? "" })),
      backpack
    };
  }

  async _onDropItem(event, item) {
    if (item.type === "background") {
      const { applyBackground } = await import("../helpers/creation.mjs");
      await applyBackground(this.document, item);
      return false;
    }
    return super._onDropItem(event, item);
  }

  static _onTab(event, target) { this._activeTab = target.dataset.tab; this.render(); }

  static async _onRollSkill(event, target) {
    await rollTest({ actor: this.document, characteristic: target.dataset.characteristic, skill: target.dataset.skill, flavor: `${target.dataset.skill} test` });
  }
  static async _onAdjBlessed(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.blessed": Math.max(0, (this.document.system.conditions.blessed ?? 0) + d) });
  }
  static async _onAdjBoned(event, target) {
    const d = Number(target.dataset.delta);
    await this.document.update({ "system.conditions.boned": Math.max(0, (this.document.system.conditions.boned ?? 0) + d) });
  }
}
