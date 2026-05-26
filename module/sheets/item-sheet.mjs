const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
import { CROWS } from "../config.mjs";

export class CrowsItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["crows", "sheet", "item"],
    position: { width: 480, height: "auto" },
    form: { submitOnChange: true },
    window: { resizable: true }
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
    return ctx;
  }
}
