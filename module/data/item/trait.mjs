const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS, ALL_EXPERTISES } from "../../config.mjs";

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
      // `restrictedTo` carries C:737's "only for alchemy items" clause. Empty
      // means unrestricted. slots.mjs (T1.2) enforces it; this model only stores it.
      slotGrants: new fields.ArrayField(new fields.SchemaField({
        container: new fields.StringField({ choices: CROWS.containerKeys }),
        count: new fields.NumberField({ initial: 1, integer: true }),
        restrictedTo: new fields.StringField({ blank: true, initial: "" })
      }), { initial: [] }),

      // CONTRACT: also new. Some traits grant expertise uses outright rather
      // than through advancement. Kept in the same {key, uses} shape as
      // BackgroundData and MonsterData so one helper reads all three, and so
      // the H5 budget can account for them instead of mistaking them for
      // over-spend. Wave 3 populates this while re-verifying the 276 traits.
      expertiseGrants: new fields.ArrayField(new fields.SchemaField({
        key: new fields.StringField({ choices: ALL_EXPERTISES }),
        uses: new fields.NumberField({ initial: 1, min: 0, integer: true })
      }), { initial: [] })
    };
  }

  prepareDerivedData() {
    this.xpCost = CROWS.traitTierXP[this.tier] ?? 0;
  }
}
