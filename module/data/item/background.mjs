const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS, ALL_EXPERTISES } from "../../config.mjs";

export class BackgroundData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      flavor: new fields.StringField({ blank: true }),

      // SEMANTIC CHANGE (C:28): PT1 stored the characteristic receiving a +1.
      // PT2 backgrounds SET one characteristic to 2 — "Your background makes one
      // of your characteristics a 2. Sometimes the background assigns this
      // increase. Other times it gives you a choice."
      //
      // An ARRAY, not a string. The shipped 36 backgrounds already contain three
      // distinct forms — a fixed characteristic (30 of them), a two-way choice
      // ("mind or strength", "agility or strength", "agility or mind" — 4), and
      // "any" (2). A singular free string cannot represent the choice cases, and
      // invites content to encode them as prose that T2.3 would have to parse.
      //
      // This is the background's ALLOWED SET. The player's actual pick lands in
      // the actor's `characteristics`, never here.
      //   fixed  -> ["mind"]
      //   choice -> ["mind", "strength"]
      //   any    -> ["agility", "mind", "strength"]
      characteristicOptionsAt2: new fields.ArrayField(
        new fields.StringField({ choices: Object.keys(CROWS.characteristics) }),
        { initial: [] }
      ),

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
