const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class TraitData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      tree: new fields.StringField({ initial: "armor", choices: CROWS.traitTrees }),
      tier: new fields.NumberField({ initial: 1, min: 1, max: 4, integer: true }),
      column: new fields.NumberField({ initial: 1, min: 1, max: 3, integer: true }),
      connectsTo: new fields.ArrayField(new fields.StringField()),
      isStarting: new fields.BooleanField({ initial: false }),
      restActivity: new fields.BooleanField({ initial: false })
    };
  }
  prepareDerivedData() {
    this.xpCost = CROWS.traitTierXP[this.tier] ?? 0;
  }
}
