const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";
import { physicalItemFields, usageDieFields } from "../../helpers/schema.mjs";
import { migrateSpellbookSystem, summonBehaviour, targetNeedsReview, TARGET_KINDS }
  from "../../helpers/spellcasting.mjs";

/**
 * The four casting times printed at R:1449–R:1457.
 *
 * NOT `CROWS.castTypes`, which is the frozen PT1 list and carries a fifth
 * value, `attack`. "Attack" is not a casting time in Playtest 2 — it describes
 * what the spell DOES, and seven PT1 spellbooks encode it in this field. The
 * migration below moves those to `action` (the casting time an attack spell
 * actually uses) and sets `isAttack`, so the fact is kept rather than dropped.
 */
export const CASTING_TIMES = ["action", "maneuver", "reaction", "outOfCombat"];

/** R:1483–R:1489. */
export const AREA_SHAPES = ["aura", "cube", "line"];

/** R:1493–R:1499. */
export const DURATION_KINDS = ["instant", "dt", "ud"];

export class SpellbookData extends TypeDataModel {
  static defineSchema() {
    return {
      ...physicalItemFields(),
      ...usageDieFields(),
      description: new fields.HTMLField(),

      // R:1447 — rank 0 to 5.
      rank: new fields.NumberField({ initial: 0, min: 0, max: 5, integer: true }),

      // R:1459 — the discipline also names the spellcasting expertise that may
      // be applied to the casting test. Same six keys as CROWS.expertises.spellcasting.
      discipline: new fields.StringField({ initial: "elemental", choices: CROWS.disciplines }),

      castingTime: new fields.StringField({ initial: "action", choices: CASTING_TIMES }),

      // R:1521 — "If the spell is an attack, that's because it can attack any
      // creature or object." Orthogonal to casting time.
      isAttack: new fields.BooleanField({ initial: false }),

      // R:1461–R:1471. Structured, because the one thing this line has to
      // answer reliably — is this a summon (R:1467/R:1553)? — cannot be
      // answered by matching text against it: not one of the 25 shipped
      // spellbooks says "Summoned", including "Summon Object". `text` keeps
      // the printed line verbatim so a bad parse is recoverable.
      target: new fields.SchemaField({
        count: new fields.NumberField({ initial: 1, min: 0, integer: true }),
        all: new fields.BooleanField({ initial: false }),          // R:1467 "All"
        kind: new fields.StringField({ initial: "creature", choices: TARGET_KINDS }),
        summoned: new fields.BooleanField({ initial: false }),     // R:1467 "Summoned"
        text: new fields.StringField({ blank: true, initial: "" })
      }),

      // R:1475 — range in squares.
      range: new fields.SchemaField({
        kind: new fields.StringField({ initial: "ranged", choices: ["self", "melee", "ranged"] }),
        value: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),

      // R:1479–R:1489.
      areaOfEffect: new fields.SchemaField({
        shape: new fields.StringField({ blank: true, initial: "", choices: ["", ...AREA_SHAPES] }),
        size: new fields.StringField({ blank: true, initial: "" })
      }),

      // R:1493 — instant / DT / UD. Structured because a UD duration carries a
      // COUNT ("This effect has 2 UD") that the end-of-DT clock has to roll,
      // and because R:1499 is explicit that these DT "track the spell's
      // duration, not the spellbook's usage" — two different UD pools that a
      // single free-text field kept inviting people to conflate.
      duration: new fields.SchemaField({
        kind: new fields.StringField({ initial: "instant", choices: DURATION_KINDS }),
        count: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        note: new fields.StringField({ blank: true, initial: "" })
      }),

      // R:1549 — "The outcomes for each casting are listed in the spell's
      // description." One band per tier.
      effectBands: new fields.SchemaField({
        t1: new fields.StringField({ blank: true }),
        t2: new fields.StringField({ blank: true }),
        t3: new fields.StringField({ blank: true })
      })
    };
  }

  /**
   * Layer (a) shape migration. Runs on partial update deltas too, so it only
   * touches keys that are present. The logic lives in helpers/spellcasting.mjs
   * so it can be unit-tested without a Foundry runtime.
   */
  static migrateData(source) {
    migrateSpellbookSystem(source);
    return super.migrateData(source);
  }

  prepareDerivedData() {
    // R:1553 — summoned CREATURES act as pets but need no command test. A
    // summoned object is neither.
    const summon = summonBehaviour(this);
    this.summons = summon.summons;
    this.actsAsPet = summon.actsAsPet;
    this.requiresCommandTest = summon.requiresCommandTest;

    // Reporting only, on the CONTRACT §3 reporting pattern: the
    // target line could not be classified, or the spell talks about summoning
    // while its target line does not. Wave 3 lists these; nothing adjudicates
    // from it.
    this.targetNeedsReview = targetNeedsReview(this, { name: this.parent?.name ?? "" });

    // For sheets and chat cards, so nobody re-derives the printed form.
    this.durationLabel = this.duration.kind === "ud"
      ? `${this.duration.count} UD`
      : this.duration.kind === "dt" ? "End of DT" : "Instant";
  }
}
