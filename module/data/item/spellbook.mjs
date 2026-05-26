const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";

export class SpellbookData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),
      discipline: new fields.StringField({ initial: "elemental", choices: CROWS.disciplines }),
      rank: new fields.NumberField({ initial: 0, min: 0, max: 5, integer: true }),
      castType: new fields.StringField({ initial: "action", choices: CROWS.castTypes }),
      range: new fields.SchemaField({
        kind: new fields.StringField({ initial: "ranged", choices: ["self","melee","ranged"] }),
        value: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      target: new fields.StringField({ initial: "1 creature" }),
      aoe: new fields.SchemaField({
        shape: new fields.StringField({ blank: true, choices: ["aura","cube","line"] }),
        size: new fields.StringField({ blank: true })
      }),
      duration: new fields.StringField({ initial: "instant" }),
      effectBands: new fields.SchemaField({
        t1: new fields.StringField({ blank: true }),
        t2: new fields.StringField({ blank: true }),
        t3: new fields.StringField({ blank: true })
      })
    };
  }
}
