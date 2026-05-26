const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class MonsterData extends TypeDataModel {
  static defineSchema() {
    return {
      power: new fields.NumberField({ initial: 1, min: 0, max: 50, integer: true }),
      size: new fields.StringField({ initial: "medium", choices: CROWS.sizes }),
      creatureType: new fields.StringField({ initial: "animal", choices: CROWS.creatureTypes }),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      speed: new fields.SchemaField({
        value: new fields.NumberField({ initial: 6, min: 0, integer: true }),
        modes: new fields.ArrayField(new fields.SchemaField({
          name: new fields.StringField(),
          value: new fields.NumberField({ initial: 0, min: 0, integer: true })
        }))
      }),
      characteristics: new fields.SchemaField({
        agility: new fields.NumberField({ initial: 0, integer: true }),
        mind: new fields.NumberField({ initial: 0, integer: true }),
        strength: new fields.NumberField({ initial: 0, integer: true })
      }),
      ad: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      slots: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      attacks: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ initial: "Attack" }),
        toHit: new fields.NumberField({ initial: 0, integer: true }),
        range: new fields.StringField({ initial: "Melee 1" }),
        targets: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        dmgT2: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        dmgT3: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        riderRef: new fields.StringField({ blank: true })
      })),
      traits: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        effect: new fields.HTMLField(),
        uses: new fields.StringField({ blank: true }),
        linkedAttack: new fields.StringField({ blank: true })
      })),
      colloquialNames: new fields.ArrayField(new fields.StringField())
    };
  }
}
