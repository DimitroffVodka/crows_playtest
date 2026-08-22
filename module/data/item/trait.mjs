const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

export class TraitData extends TypeDataModel {
  static defineSchema() {
    return {
      description: new fields.HTMLField(),
      tree: new fields.StringField({ initial: "armor", choices: CROWS.traitTrees }),
      tier: new fields.NumberField({ initial: 1, min: 1, max: 4, integer: true }),
      column: new fields.NumberField({ initial: 1, min: 1, max: 3, integer: true }),
      connectsTo: new fields.ArrayField(new fields.StringField()),
      isStarting: new fields.BooleanField({ initial: false }),
      restActivity: new fields.BooleanField({ initial: false }),

      // CONTRACT: NEW, and required to make critique M12 implementable. That fix
      // states backpack capacity is "config plus trait grants" and has
      // prepareDerivedData read `backpackCapacity` — but nothing could express a
      // grant, so the capacity could never actually vary and the whole
      // capacity-relative design was theoretical. C:737 is a real example:
      // "You gain an additional belt slot that can only be used to hold alchemy
      // items." Slot-granting traits exist; this is where they say so.
      //
      // `count` is min 1: no published trait REMOVES a slot, and a negative
      // grant would let bad content shrink capacity into a character's wounds
      // and kill them.
      //
      // The restriction is a STRUCTURED discriminator, not a free string. A bare
      // "alchemy" is ambiguous — item type? gear subtype? trait tree? — and
      // T1.2 would have to guess. `dimension` names which axis to test and
      // `values` lists the accepted values on it, which also covers cases like a
      // holster restricted to a weaponType. Empty `dimension` = unrestricted.
      slotGrants: new fields.ArrayField(new fields.SchemaField({
        container: new fields.StringField({ choices: CROWS.containerKeys }),
        count: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        restriction: new fields.SchemaField({
          dimension: new fields.StringField({
            blank: true, initial: "",
            choices: ["", "itemType", "gearSubtype", "weaponType", "consumableKind"]
          }),
          values: new fields.ArrayField(new fields.StringField(), { initial: [] })
        })
      }), { initial: [] }),

      // CONTRACT: a per-rest use pool, sized by a CHARACTERISTIC rather than a
      // fixed number. Three published traits need exactly this:
      //   C:921  benefaction — "use this trait a number of times equal to your
      //                        Mind, regaining all uses when you finish [a rest]"
      //   C:1361 knowledge   — same shape
      //   C:1501 necromancy  — same shape
      // `sizedBy` empty means `fixedMax` is the pool; otherwise the pool is the
      // named characteristic and `fixedMax` is ignored. Same value/max split as
      // expertises, for the same reason: `used` must survive a spend so a rest
      // knows what to restore.
      usePool: new fields.SchemaField({
        sizedBy: new fields.StringField({
          blank: true, initial: "",
          choices: ["", ...Object.keys(CROWS.characteristics)]
        }),
        fixedMax: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        used: new fields.NumberField({ initial: 0, min: 0, integer: true })
      })

      // CONTRACT: `expertiseGrants` was here and has been REMOVED. Review found
      // no trait in the corpus that grants a fixed expertise to its own owner.
      // The real cases are dynamic and target something else: Tricks/Extra
      // Tricks grant a CHOICE of expertises to a PET, and Memorization grants
      // the expertise of a chosen lore book until it is replaced. A fixed
      // {key, uses} array on the owning crow's trait models neither. Those
      // belong on the affected actor with source and expiry, which is T1.6's
      // (pets) and T1.4's (advancement) call — not a speculative field here.
    };
  }

  prepareDerivedData() {
    this.xpCost = CROWS.traitTierXP[this.tier] ?? 0;
  }
}
