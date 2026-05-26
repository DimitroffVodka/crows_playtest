const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { physicalItemFields } from "../../helpers/schema.mjs";

export class AmmunitionData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      description: new fields.HTMLField(),
      ammoFor: new fields.StringField({ initial: "" }),
      countPerUnit: new fields.NumberField({ initial: 20, min: 1, integer: true })
    };
  }
}
