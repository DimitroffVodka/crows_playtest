const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class BackgroundData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      flavor: new fields.StringField({ blank: true }),
      characteristicBonus: new fields.StringField({ initial: "any" }),
      stamina: new fields.NumberField({ initial: 5, min: 1, integer: true }),
      startingTrait: new fields.StringField({ blank: true }),
      skills: new fields.ArrayField(new fields.StringField({ choices: CROWS.skills })),
      equipment: new fields.ArrayField(new fields.StringField()),
      spellbooks: new fields.ArrayField(new fields.StringField())
    };
  }
}
