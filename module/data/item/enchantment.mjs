const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { migrateEnchantmentSystem } from "../../helpers/migration.mjs";

/**
 * A catalogue entry from the Armor or Weapon Enchantments tables
 * (C:1917–1943, C:2076–2102).
 *
 * Item cards store only `key` values in their `enchantments` arrays. Keeping
 * each entry as its own Item document lets the Ref browse the printed prose,
 * materials, price, and expertise-use cost without making an equipment card
 * carry a copy of that catalogue data.
 */
export class EnchantmentData extends TypeDataModel {
  static migrateData(source) {
    return super.migrateData(migrateEnchantmentSystem(source));
  }

  static defineSchema() {
    return {
      key: new fields.StringField({ required: true }),
      kind: new fields.StringField({ required: true, choices: ["armor", "weapon"] }),
      price: new fields.NumberField({ required: true, min: 1, integer: true }),
      uses: new fields.NumberField({ required: true, min: 1, max: 4, integer: true }),
      applies: new fields.StringField({ initial: "", blank: true, choices: ["", "both", "suit", "shield"] }),
      materials: new fields.StringField({ required: true }),
      goal: new fields.NumberField({ required: true, min: 1, integer: true }),
      description: new fields.HTMLField()
    };
  }
}
