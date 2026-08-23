const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS, ALL_EXPERTISES } from "../../config.mjs";

/**
 * Creature data model — Playtest 2. Covers monsters, humans and animals.
 *
 * Modelled against a real stat block (F:1397):
 *   **Sage (Power 6) Size:** Medium **Power:** 6 **Type:** Human **Stamina:** 20
 *   **Speed:** 5 **Slots:** 10 **Agility:** 1 **Mind:** 3 **Strength:** 0
 *   **Expertises:** Historical Lore (2 uses), Magic Lore (2 uses), ...
 */
export class MonsterData extends TypeDataModel {
  static defineSchema() {
    return {
      // CONTRACT: NO `max` bound. F:704 scales power "from 0 to 50, though
      // future products could go even higher!" — a soft cap, so a hard schema
      // bound would reject future MCDM content for no benefit. Observed range
      // across the whole Ref Book bestiary is 1-11.
      power: new fields.NumberField({ initial: 0, min: 0, integer: true }),   // F:704

      size: new fields.StringField({ initial: "medium", choices: CROWS.sizes }),
      // Default is `blood`, NOT `animal`. F:698 says animals HAVE slots, so the
      // old default paired an animal with `slots: 0` — an internally invalid
      // creature on every freshly created document, which then trips
      // `suspectMissingSlots` for no reason. `blood` is a monster type, for
      // which `slots: 0` is correct.
      creatureType: new fields.StringField({ initial: "blood", choices: CROWS.creatureTypes }),

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
      // R:174 bounds EVERY creature's characteristics to -5..5, not just PCs.
      // These were unbounded, so a transcription typo could ship a Mind of 30.
      characteristics: new fields.SchemaField({
        agility: new fields.NumberField({
          initial: 0, min: CROWS.charRange.min, max: CROWS.charRange.max, integer: true }),
        mind: new fields.NumberField({
          initial: 0, min: CROWS.charRange.min, max: CROWS.charRange.max, integer: true }),
        strength: new fields.NumberField({
          initial: 0, min: CROWS.charRange.min, max: CROWS.charRange.max, integer: true })
      }),
      ad: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // F:698 — "Monsters don't have slots and die when they are reduced to 0
      // Stamina. Humans and animals ... do have slots, which count as backpack
      // slots for them." So this is a COUNT, and 0 means "a monster".
      // F:700 — a creature that gains another creature's stats KEEPS its
      // original slot count, so migration/polymorph must not overwrite it.
      slots: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Creatures WITH slots can take wounds, exactly as a crow does. Same
      // capacity-relative, non-destructive treatment (critique M12).
      woundSlots: new fields.SetField(
        new fields.NumberField({ min: 0, integer: true }), { initial: [] }
      ),

      // C:2429-2445 — pet state lives on the animal, the one side that can
      // enforce a SINGLE owner without a mirrored owner->pets list drifting.
      // UUIDs, not ids: a human owner can be a world Actor or a synthetic token
      // Actor. Empty ownerUuid means ownerless; `isPet` is therefore derived by
      // helpers/pets.mjs from animal + owner rather than stored as a second bit.
      pet: new fields.SchemaField({
        ownerUuid: new fields.StringField({ initial: "", blank: true }),

        // Taming tier 2: follows this prospective owner at a distance for 24h,
        // heeds no commands, and becomes owned only if their bonding rest
        // activity finishes. `followsUntil` is injected world-time seconds; no
        // data-model preparation reaches for `game.time`.
        prospectiveOwnerUuid: new fields.StringField({ initial: "", blank: true }),
        followsUntil: new fields.NumberField({ initial: 0, min: 0 }),

        // A rider occupies 6 inventory slots (C:2443). The occupied amount is
        // derived by pets.mjs; only the identity needed to persist a mount is
        // stored here. Transfer clears this field.
        riderUuid: new fields.StringField({ initial: "", blank: true }),

        // Pets eat daily and must eat during a rest to receive its benefits
        // (C:2445). This records the supplied world-time second of the latest
        // successful forage/feed; feed inventory remains ordinary item data.
        lastFedAt: new fields.NumberField({ initial: 0, min: 0 })
      }),

      // F:708 — "most creatures have only 1 reaction each round, but some have
      // more. If a creature can use more than one ... their stat block will say so."
      reactions: new fields.NumberField({ initial: 1, min: 0, integer: true }),

      // NEW. A bare name in a stat block is 1 use; "(2 uses)" is 2 (F:1397).
      // Same three-quantity model as CrowData: `max` is owned, `value` is what
      // remains this rest. A creature that spends an expertise and then rests
      // has to restore to something, and that something is `max`.
      // `key` is constrained to ALL_EXPERTISES so an OCR-split or misspelled
      // name fails loudly at load instead of entering content silently.
      expertises: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ required: true, choices: ALL_EXPERTISES }),
        value: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 1, min: 0, integer: true })
      }), { initial: [] }),

      // F:710-714 — "X/Rest" limited-use features. A crit refunds 1 spent use;
      // that refund is wired in T1.1, not here.
      xRest: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ initial: "" }),
        max: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        used: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }), { initial: [] }),

      attacks: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField({ initial: "Attack" }),
        toHit: new fields.NumberField({ initial: 0, integer: true }),
        range: new fields.StringField({ initial: "Melee 1" }),
        targets: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        dmgT2: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        dmgT3: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        piercing: new fields.BooleanField({ initial: false }),    // "P" — bypasses AD
        riderRef: new fields.StringField({ blank: true })
      })),
      traits: new fields.ArrayField(new fields.SchemaField({
        name: new fields.StringField(),
        effect: new fields.HTMLField(),
        uses: new fields.StringField({ blank: true }),
        linkedAttack: new fields.StringField({ blank: true })
      })),
      colloquialNames: new fields.ArrayField(new fields.StringField()),

      // Same six PT2 conditions a crow can have, plus `defeated` (0 Stamina,
      // F:698). CONTRACT: `boned` deleted here too.
      conditions: new fields.SchemaField({
        blessed:     new fields.BooleanField({ initial: false }),
        grabbed:     new fields.BooleanField({ initial: false }),
        prone:       new fields.BooleanField({ initial: false }),
        unconscious: new fields.BooleanField({ initial: false }),
        vulnerable:  new fields.BooleanField({ initial: false }),
        weakened:    new fields.BooleanField({ initial: false }),
        defeated:    new fields.BooleanField({ initial: false })
      }),
      notes: new fields.HTMLField()
    };
  }

  prepareDerivedData() {
    // `slots > 0` is the whole "does this creature have slots" test — there is
    // deliberately no separate boolean to drift out of sync with the count.
    this.hasSlots = (this.slots ?? 0) > 0;

    const cap = this.slots ?? 0;
    const all = [...(this.woundSlots ?? [])];
    const held = all.filter(i => i < cap);
    this.orphanedWounds = all.filter(i => i >= cap);
    this.wounds = held.length;
    // REPORTING ONLY, same as CrowData — see the note there. A creature with
    // slots dies when all of them hold wounds (R:524); one WITHOUT slots dies
    // at 0 Stamina instead (F:698). Both are damage.mjs's call at the mutation,
    // never adjudicated from derived preparation.
    this.woundCapacityFilled = this.hasSlots && held.length >= cap;

    // F:698 — humans and animals HAVE slots. A stat block of one of those types
    // with slots: 0 is almost certainly an incomplete transcription rather than
    // a deliberate statement, so surface it for Wave 3 instead of silently
    // treating the creature as a slotless monster.
    this.suspectMissingSlots =
      !this.hasSlots && ["human", "animal"].includes(this.creatureType);
  }
}
