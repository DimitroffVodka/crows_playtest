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
  game.crows = Object.assign(game.crows ?? {}, { rollTest, classifyTier, classifyDoomCrit, applyBackground });
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
