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
      worn: new fields.BooleanField({ initial: false }),
      enchantment: new fields.StringField({ required: false, blank: true }),
      qualityTier: new fields.StringField({ initial: "standard", choices: CROWS.qualityTiers })
    };
  }
}
