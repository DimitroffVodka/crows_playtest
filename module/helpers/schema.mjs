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
      container: new fields.StringField({ initial: "backpack", choices: Object.keys(CROWS.containers) }),
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
