const fields = foundry.data.fields;
import { CROWS } from "../config.mjs";

export function physicalItemFields() {
  return {
    slots: new fields.NumberField({ initial: 1, min: 0, integer: true }),
    stackMax: new fields.NumberField({ initial: 1, min: 1, integer: true }),
    quantity: new fields.NumberField({ initial: 1, min: 0, integer: true }),
    cost: new fields.NumberField({ initial: 0, min: 0, integer: true }), // gc
    equipSlotType: new fields.StringField({ required: false, blank: true, choices: CROWS.equipSlotTypes }),
    weightless: new fields.BooleanField({ initial: false }),
    location: new fields.SchemaField({
      // CONTRACT §1 — `CROWS.containers` is DELETED. Carry containers and magic
      // slots are separate axes now (R:426 vs R:438); `containerKeys` is the
      // union of the two and is the only thing a `choices:` may use. This read
      // `Object.keys(CROWS.containers)`, which threw a TypeError at module load
      // and stopped every item data model from registering — invisible to the
      // test suite, because the pure-helper shim never imports this file.
      container: new fields.StringField({ initial: "backpack", choices: CROWS.containerKeys }),
      index: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      length: new fields.NumberField({ initial: 1, min: 1, integer: true })
    })
  };
}

export function usageDieFields() {
  return {
    usageDie: new fields.SchemaField({
      enabled: new fields.BooleanField({ initial: false }),
      udMax: new fields.NumberField({ initial: 1, min: 0, integer: true }),
      udCurrent: new fields.NumberField({ initial: 1, min: 0, integer: true }),
      expiry: new fields.StringField({ initial: "dt", choices: CROWS.usageExpiry }),
      refuelWith: new fields.StringField({ required: false, blank: true })
    })
  };
}
