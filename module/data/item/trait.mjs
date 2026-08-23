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
      // T1.2 would have to guess.
      //
      // Each dimension names a REAL DOCUMENT PATH, frozen here so T1.2 does not
      // have to invent one. A first draft listed `consumableKind`, which does
      // not exist on ConsumableData at all, and `weaponType`, whose actual path
      // is `system.type` — both would have been unimplementable:
      //
      //   dimension     path tested            legal values
      //   ------------- --------------------- --------------------------------
      //   ""            (unrestricted)         —
      //   itemType      item.type              weapon|armor|gear|consumable|…
      //   gearSubtype   item.system.subtype    CROWS.gearSubtypes
      //   weaponType    item.system.type       CROWS.weaponTypes
      //
      // C:737's "only ... alchemy items" is `{dimension:"gearSubtype",
      // values:["tool"]}` or an itemType restriction, whichever Wave 3 finds
      // matches the actual alchemy item set — that call is content's, not this
      // model's, but the AXIS is frozen either way.
      slotGrants: new fields.ArrayField(new fields.SchemaField({
        container: new fields.StringField({ choices: CROWS.containerKeys }),
        count: new fields.NumberField({ initial: 1, min: 1, integer: true }),
        restriction: new fields.SchemaField({
          dimension: new fields.StringField({
            blank: true, initial: "",
            choices: ["", "itemType", "gearSubtype", "weaponType"]
          }),
          values: new fields.ArrayField(new fields.StringField(), { initial: [] })
        })
      }), { initial: [] }),

      // CONTRACT: a per-rest use pool, sized by a CHARACTERISTIC rather than a
      // fixed number. FOUR published traits need exactly this — an initial draft
      // said three and missed the Agility one:
      //   C:921  benefaction — "a number of times equal to your Mind, regaining
      //                         all uses when you finish [a rest]"
      //   C:1361 knowledge   — Mind
      //   C:1501 necromancy  — Mind
      //   C:1739 armor       — "equal to your Agility and then must finish a
      //                         rest before" — same shape, different stat
      //
      // FROZEN SEMANTICS, because a characteristic is not a constant:
      //   max        = sizedBy ? Math.max(1, actor.characteristics[sizedBy].value)
      //                        : fixedMax
      //
      // CORRECTED (found by T1.4). This said `max(0, …)` and argued at length
      // that a floor of 0 "is not an error state" — reasoning from first
      // principles about a rule that exists and says the opposite. C:669 is a
      // titled rule, "Minimum Modifier":
      //
      //   "Whenever a trait increases or decreases a number equal to one of
      //    your characteristics, the minimum number of that increase or
      //    decrease is 1, even if your characteristic is lower."  — C:671
      //
      // So a Mind -1 crow gets ONE use, not zero. The floor is 1, and the rule
      // is general: it governs every trait scaling off a characteristic, not
      // just these pools.
      //   remaining  = max(0, max - used)
      //   rest       = used -> 0 (R:628). Nothing else resets it.
      //   overused   = max(0, used - max). Reachable WITHOUT cheating: spend at
      //                Mind 3, then take a Mind drain to 1. Report it; never
      //                retroactively refund, and never clamp `used` downward —
      //                that would silently hand back a spent use.
      //
      // `used` is stored rather than `remaining` for the same reason expertises
      // store {value,max}: the pool size is derived and can move underneath you,
      // so the durable fact is what was SPENT, not what is left.
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
