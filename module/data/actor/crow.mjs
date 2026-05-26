const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

const charField = () => new fields.SchemaField({
  value: new fields.NumberField({ initial: 0, min: -1, max: 3, integer: true })
});

export class CrowData extends TypeDataModel {
  static defineSchema() {
    const skills = {};
    for (const s of CROWS.skills) skills[s] = new fields.SchemaField({
      bonus: new fields.NumberField({ initial: 0, min: 0, max: 2, integer: true })
    });
    return {
      characteristics: new fields.SchemaField({
        agility: charField(), mind: charField(), strength: charField()
      }),
      skills: new fields.SchemaField(skills),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      wounds: new fields.NumberField({ initial: 0, min: 0, max: CROWS.backpackSize, integer: true }),
      speed: new fields.NumberField({ initial: 5, min: 0, integer: true }),
      xp: new fields.SchemaField({
        txp: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        spendable: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      currency: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      conditions: new fields.SchemaField({
        blessed: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        boned: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      background: new fields.StringField({ blank: true }),
      cryptBoon: new fields.StringField({ blank: true }),
      details: new fields.SchemaField({ feature: new fields.HTMLField() })
    };
  }

  prepareDerivedData() {
    let ad = 0;
    for (const i of this.parent.items) {
      if (i.type === "armor" && i.system.worn) ad += i.system.ad ?? 0;
    }
    this.ad = ad;
    const net = (this.conditions.blessed ?? 0) - (this.conditions.boned ?? 0);
    this.conditionNet = net;
  }
}
