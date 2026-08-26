const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";
import { backgroundSummary } from "../helpers/creation.mjs";

/** Localize, tolerating a missing i18n (tests, early init). */
function t(key, data = null) {
  const i18n = globalThis.game?.i18n;
  if (!i18n) return key;
  return data ? i18n.format(key, data) : i18n.localize(key);
}

export class CrowsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "item"],
    position: { width: 480, height: "auto" },
    form: { submitOnChange: true },
    window: { resizable: true },
    actions: {
      castSpell: CrowsItemSheet._onCastSpell
    }
  };

  static PARTS = { body: { template: "systems/crows/templates/item/weapon.hbs" } };

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    parts.body = { template: `systems/crows/templates/item/${this.document.type}.hbs` };
    return parts;
  }

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    ctx.system = this.document.system;
    ctx.item = this.document;
    ctx.CROWS = CROWS;

    if (this.document.type === "background") {
      // Same shaper the crow sheet's Bio tab uses, so the two surfaces cannot
      // disagree about what a background grants.
      ctx.bg = backgroundSummary(this.document.system, t);
      // PT2 backgrounds SET a characteristic to 2, and some offer a CHOICE
      // (C:28) — so this is an array, not a single key. The old sheet bound a
      // <select> to `system.characteristicBonus`, a PT1 field that no longer
      // exists: it displayed nothing and wrote to a path the DataModel drops.
      ctx.characteristicChoices = Object.keys(CROWS.characteristics).map((key) => ({
        key,
        label: t(`CROWS.Characteristic.${key}`),
        selected: (this.document.system.characteristicOptionsAt2 ?? []).includes(key)
      }));
    }
    return ctx;
  }

  /**
   * Cast a spellbook. Caster precedence:
   *   1. The item's owning actor (when the spellbook is embedded on a character).
   *   2. The current user's assigned character.
   *   3. The first controlled token on the canvas.
   *   4. Otherwise prompt the user to select a caster.
   */
  static async _onCastSpell(/* event, target */) {
    const item = this.document;
    if (item.type !== "spellbook") return;
    let caster = item.actor;
    if (!caster) caster = game.user.character ?? canvas.tokens?.controlled?.[0]?.actor ?? null;
    if (!caster) {
      ui.notifications?.warn("No caster selected — assign a character or select a token.");
      return;
    }
    const { castSpell } = await import("../helpers/spellcasting.mjs");
    await castSpell(caster, item);
  }
}
