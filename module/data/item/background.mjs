const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { ALL_EXPERTISES } from "../../config.mjs";

export class BackgroundData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      flavor: new fields.StringField({ blank: true }),

      // SEMANTIC CHANGE (C:28): PT1 stored the characteristic receiving a +1.
      // PT2 backgrounds SET one characteristic to 2 — "You background makes one
      // of your characteristics a 2" — and the player assigns {1,0} or {-1,2}
      // to the rest. Renamed so no downstream reader can mistake the meaning.
      characteristicAt2: new fields.StringField({ initial: "any" }),

      stamina: new fields.NumberField({ initial: 5, min: 1, integer: true }),
      startingTrait: new fields.StringField({ blank: true }),

      // REPLACES `skills: [String]`. Backgrounds grant 1 use in most expertises
      // but 2 in some — Acolyte of the Gardner has "Benefaction (2 uses),
      // Elemental (2 uses)" (C:103). A bare name in the source is 1 use.
      expertises: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, choices: ALL_EXPERTISES }),
        uses: new fields.NumberField({ initial: 1, min: 1, integer: true })
      }), { initial: [] }),

      equipment: new fields.ArrayField(new fields.StringField()),
      spellbooks: new fields.ArrayField(new fields.StringField()),

      // C:36 — "Every PC has an empty coin purse, a knife, a rope, six rations,
      // and 3d6 gc". The kit is universal; only the gold is rolled.
      startingGold: new fields.StringField({ initial: "3d6" })
    };
  }

  prepareDerivedData() {
    // Total uses this background grants. The H5 migration budget needs it, and
    // it is the one number that requires reading the background ITEM — which is
    // why the budget runs in the world-migration layer, not in migrateData.
    this.totalExpertiseUses = (this.expertises ?? [])
      .reduce((n, e) => n + (e.uses ?? 1), 0);
  }
}
