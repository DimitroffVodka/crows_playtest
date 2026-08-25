const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS, ALL_EXPERTISES } from "../../config.mjs";
import { migrateBackgroundSystem, liftGrantsOutOfEquipment } from "../../helpers/migration.mjs";

export class BackgroundData extends TypeDataModel {
  /**
   * LAYER (a) of the PT1 -> PT2 migration. See the note on CrowData.migrateData:
   * the returned object REPLACES source, it is not merged onto it, because
   * several transforms work by deleting a key.
   *
   * Best-effort SHAPE conversion only. A PT1 background carries no per-key uses
   * at all, and 8 of 36 lose a grant to collapsing pairs (Thief 7 -> 5), so the
   * authoritative content comes from T3.1 re-transcription and overwrites this.
   */
  static migrateData(source) {
    return super.migrateData(liftGrantsOutOfEquipment(migrateBackgroundSystem(source)));
  }

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

      // ITEMS ONLY. Coins and animals used to live in here too, because the
      // book prints them on one Equipment line — and both had to be recovered
      // by pattern-matching the string at creation time. That is precisely how
      // the Noble's 50 gc was silently dropped and Nobles started poor: a grant
      // hidden in an array of the wrong kind, recoverable only by a regex
      // nobody was testing. They are separate fields now; `migrateData` lifts
      // legacy strings out so old content still works.
      equipment: new fields.ArrayField(new fields.StringField()),

      // Coins granted ON TOP of the universal `startingGold` roll. Two
      // backgrounds use it — Merchant ("50 extra gold coins") and Noble
      // ("50 gold coins"). Not equipment: coins go to `system.currency`.
      bonusGold: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Animals the background starts play owning, by card name — Farmer
      // (goat), Hunter (dog), Knight and Noble (riding horse). A pet is an
      // ACTOR that gets bonded to the crow, never a card in a backpack slot,
      // so it cannot be an equipment string without a parser to rescue it.
      pets: new fields.ArrayField(new fields.StringField(), { initial: [] }),

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
