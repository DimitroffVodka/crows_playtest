const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields } from "../../helpers/schema.mjs";

export class ArmorData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      armorType: new fields.StringField({ initial: "light", choices: CROWS.armorTypes }),
      ad: new fields.NumberField({ initial: 5, min: 0, integer: true }),
      adCurrent: new fields.NumberField({ required: false, min: 0, integer: true, nullable: true, initial: null }), // null = "use ad as starting value"
      worn: new fields.BooleanField({ initial: false }),
      enchantment: new fields.StringField({ required: false, blank: true }),
      qualityTier: new fields.StringField({ initial: "standard", choices: CROWS.qualityTiers })
    };
  }
}
