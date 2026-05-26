const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class GearData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      subtype: new fields.StringField({ initial: "utility", choices: CROWS.gearSubtypes }),
      light: new fields.SchemaField({
        enabled: new fields.BooleanField({ initial: false }),
        bright: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        dim: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      isMagic: new fields.BooleanField({ initial: false }),
      mystery: new fields.BooleanField({ initial: false }),
      identified: new fields.BooleanField({ initial: true }),
      treasure: new fields.SchemaField({
        size: new fields.StringField({ blank: true, choices: ["tiny","small","medium","large"] }),
        value: new fields.NumberField({ initial: 0, min: 0, integer: true })
      })
    };
  }
}
