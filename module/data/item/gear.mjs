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
      }),

      // CONTRACT: coin purse state. Part 1.1 freezes Layout.coin.purses[] as
      // {id, held, cap}, but nothing OWNED either number — CrowData.currency is
      // explicitly LOOSE coin only and a purse is an Item, so T1.2 had no source
      // and the universal starting kit ("an empty coin purse ... and 3d6 gc",
      // C:36) was unrepresentable.
      //
      // C:1917 — "An inventory slot can hold 250 loose coins or 1 purse that
      // holds up to 500 gc." C:1737 (Bursting Purse) is the only published
      // capacity increase: "an additional 500 gc in a coin purse".
      //
      // `isPurse` gates the rest, so ordinary gear carries three inert fields
      // instead of the system needing a separate item type for one object.
      purse: new fields.SchemaField({
        isPurse: new fields.BooleanField({ initial: false }),
        held: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        baseCapacity: new fields.NumberField({
          initial: CROWS.purseBaseCapacity, min: 0, integer: true
        })
      })
    };
  }

  prepareDerivedData() {
    // Effective capacity = base + trait bonuses. The owning actor applies
    // CROWS.purseTraitBonus when it has Bursting Purse (C:1737); this model
    // exposes the base so slots.mjs can build Layout.coin.purses[].cap from one
    // place. Non-purses report 0 rather than a misleading 500.
    this.purseCapacity = this.purse?.isPurse ? (this.purse.baseCapacity ?? 0) : 0;
    this.purseOverfull = (this.purse?.held ?? 0) > this.purseCapacity;
  }
}
