import { CROWS } from "./config.mjs";
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

Hooks.once("init", () => {
  console.log("crows | init");
  CONFIG.CROWS = CROWS;
  Object.assign(CONFIG.Item.dataModels, {
    weapon: WeaponData, armor: ArmorData, ammunition: AmmunitionData,
    consumable: ConsumableData, gear: GearData, spellbook: SpellbookData,
    trait: TraitData, background: BackgroundData
  });
  Object.assign(CONFIG.Actor.dataModels, { crow: CrowData, monster: MonsterData });
  game.crows = Object.assign(game.crows ?? {}, { rollTest, classifyTier, classifyDoomCrit });
  foundry.applications.handlebars.loadTemplates(["systems/crows/templates/chat/test-card.hbs"]);
});

Hooks.once("ready", () => {
  console.log("crows | ready");
});
