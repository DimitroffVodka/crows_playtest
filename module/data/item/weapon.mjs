const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields } from "../../helpers/schema.mjs";

export class WeaponData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      type: new fields.StringField({ initial: "slashing", choices: CROWS.weaponTypes }),
      range: new fields.SchemaField({
        melee: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        ranged: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      attackStat: new fields.StringField({ initial: "strength", choices: ["agility","strength","either"] }),
      damage: new fields.SchemaField({
        t2: new fields.StringField({ initial: "1 + S" }),
        t3: new fields.StringField({ initial: "2 + S" })
      }),
      qualities: new fields.ArrayField(new fields.StringField({ choices: CROWS.weaponQualities })),
      piercing: new fields.BooleanField({ initial: false }),                 // "P" damage — ignores AD
      parryValue: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      enchantment: new fields.StringField({ required: false, blank: true }),
      qualityTier: new fields.StringField({ initial: "standard", choices: CROWS.qualityTiers })
    };
  }
}
