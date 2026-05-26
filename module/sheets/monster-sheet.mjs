const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { rollTest } from "../helpers/roll.mjs";

export class MonsterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "monster"],
    position: { width: 520, height: 600 },
    actions: { rollAttack: MonsterSheet._onRollAttack },
    window: { resizable: true },
    form: { submitOnChange: true }
  };
  static PARTS = { body: { template: "systems/crows/templates/actor/monster.hbs" } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.system = this.document.system; ctx.actor = this.document; ctx.CROWS = CROWS;
    return ctx;
  }

  static async _onRollAttack(event, target) {
    const idx = Number(target.dataset.index);
    const atk = this.document.system.attacks[idx];
    const range = atk.range ?? "";
    const isMelee = /^melee/i.test(range);
    await rollTest({
      actor: this.document, mods: [{ value: atk.toHit }],
      flavor: `${this.document.name}: ${atk.name}`,
      attack: {
        t2: atk.dmgT2, t3: atk.dmgT3,
        isMelee,
        piercing: !!atk.piercing
      }
    });
  }
}
