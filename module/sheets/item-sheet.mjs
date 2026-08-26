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

    if (this.document.type === "weapon") {
      const sys = this.document.system;
      const n = (v) => `<span class="wp-n">${v}</span>`;
      ctx.typeLabel = t(`CROWS.WeaponType.${sys.type}`);

      // `grip` is not a WeaponData field. Derived from slots until one lands,
      // which cannot express the "Any" the printed Mace card shows.
      ctx.grip = t(`CROWS.Grip.${sys.grip ?? (sys.slots >= 2 ? "two" : "one")}`);

      const r = sys.range ?? {};
      ctx.rangeLine = [
        r.melee ? `${t("CROWS.Weapon.Melee")} ${n(r.melee)}` : null,
        r.ranged ? `${t("CROWS.Weapon.Ranged")} ${n(r.ranged)}` : null
      ].filter(Boolean).join(" &middot; ");

      // `attackStat` really does allow "either" — the printed cards show both
      // boxed initials for "6 + A or S".
      const keys = sys.attackStat === "either" ? ["agility", "strength"] : [sys.attackStat];
      ctx.attackStats = keys.map((k) => {
        const label = t(`CROWS.Characteristic.${k}`);
        return { initial: label[0], rest: label.slice(1) };
      });

      const dam = (x) => String(x ?? "").replace(/\s*\+\s*/, "+").replace(/\s+or\s+/gi, "/").trim();
      ctx.tiers = [
        { roll: `&le;${n(11)}`, kind: "miss",
          // A ranged-only weapon cannot be countered — R:772 ties the counter to reach.
          text: t(r.ranged && !r.melee ? "CROWS.Weapon.Miss" : "CROWS.Weapon.MissCounter") },
        { roll: n("12&ndash;16"), damage: dam(sys.damage?.t2) },
        { roll: n("17+"), damage: dam(sys.damage?.t3) }
      ];

      // Parry carries a number, so it prints as "Parry 6" rather than a bare label.
      ctx.qualityLabels = (sys.qualities ?? []).map((q) =>
        q === "parry" && sys.parryValue ? `${t(`CROWS.Quality.${q}`)} ${sys.parryValue}` : t(`CROWS.Quality.${q}`));

      ctx.physical = [
        `${n(sys.slots)} ${t(sys.slots === 1 ? "CROWS.Slot" : "CROWS.Slots").toLowerCase()}`,
        sys.stackMax > 1 ? `${t("CROWS.Stacks").toLowerCase()} ${n(sys.stackMax)}` : null,
        `${n(sys.cost)} gc`,
        t(`CROWS.QualityTier.${sys.qualityTier}`).toLowerCase()
      ].filter(Boolean).join(" &middot; ");

      ctx.flavor = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        sys.description ?? "", { relativeTo: this.document, secrets: this.document.isOwner }
      );
      // Foundry's full-colour weapon art washes out under the silhouette blend.
      // Dead for our content — every shipped weapon points at our own icons —
      // but a world that repoints one at the stock library still needs it.
      ctx.artColor = String(this.document.img ?? "").startsWith("icons/weapons/");
    }

    if (this.document.type === "trait") {
      const sys = this.document.system;
      // `CROWS.traitTrees` is an ARRAY of names, so Object.keys() would give
      // "0".."22". The 23 tree labels already ship as CROWS.Sheet.Crow.tree.*;
      // a new CROWS.Tree.* family would duplicate every one of them.
      ctx.treeLabel = t(`CROWS.Sheet.Crow.tree.${sys.tree}`);
      // The XP table is `traitTierXP`, not the `traitTierCost` the handoff names.
      ctx.xpCost = CROWS.traitTierXP?.[sys.tier] ?? (Number(sys.tier) || 1) * 500;
      ctx.leadsTo = sys.connectsTo ?? [];
      // The card prints ENRICHED html. A textarea here renders the literal <p>
      // tags on the card face, which is what the first build did.
      ctx.rules = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
        sys.description ?? "", { relativeTo: this.document, secrets: this.document.isOwner }
      );
    }

    if (this.document.type === "background") {
      // Same shaper the crow sheet's Bio tab uses, so the two surfaces cannot
      // disagree about what a background grants.
      ctx.bg = backgroundSummary(this.document.system, t);
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
