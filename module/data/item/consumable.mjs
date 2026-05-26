const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class ConsumableData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      useAction: new fields.StringField({ initial: "action", choices: ["action","maneuver"] }),
      bands: new fields.SchemaField({
        t1: new fields.StringField({ blank: true }),
        t2: new fields.StringField({ blank: true }),
        t3: new fields.StringField({ blank: true })
      }),
      thrown: new fields.SchemaField({
        isAttack: new fields.BooleanField({ initial: false }),
        range: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      duration: new fields.StringField({ blank: true })
    };
  }
}
