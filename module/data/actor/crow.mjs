const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS, ALL_EXPERTISES, expertiseMaxForTxp, bonusesEarnedAtTxp } from "../../config.mjs";

/**
 * Crow (PC) data model — Playtest 2.
 *
 * Changes from Playtest 1 are the ones in .planning/PLAYTEST-2-MIGRATION.md §2.2.
 * The big ones: `skills` -> `expertises` (a spendable post-roll pool, not a
 * pre-roll bonus), `wounds` count -> `woundSlots` player-chosen indices, and
 * `boned` deleted.
 */

const charField = () => new fields.SchemaField({
  value: new fields.NumberField({
    initial: 0,
    min: CROWS.charRange.min,          // R:174 — -5..5. Was min:-1 max:3, both wrong.
    max: CROWS.charRange.max,          // The PC cap of 4 (C:640) is an ADVANCEMENT
    integer: true                      // rule, not a schema bound — magic may exceed it.
  })
});

export class CrowData extends TypeDataModel {
  static defineSchema() {
    // REPLACES `skills`. CONTRACT: `max` is NOT stored — it is a pure function
    // of TXP (see expertiseMaxForTxp). Storing it meant a freshly created crow
    // had uses=2 from its background (C:103) against max=0.
    const expertises = {};
    for (const key of ALL_EXPERTISES) {
      expertises[key] = new fields.SchemaField({
        uses: new fields.NumberField({ initial: 0, min: 0, integer: true })
      });
    }

    return {
      characteristics: new fields.SchemaField({
        agility: charField(), mind: charField(), strength: charField()
      }),
      expertises: new fields.SchemaField(expertises),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),

      // Wounds occupy PLAYER-CHOSEN backpack slots (R:524), not a bare count.
      // CONTRACT: NO `max` here. Backpack capacity is config plus trait grants,
      // and schema validation runs on SOURCE before derived data exists, so it
      // cannot see that capacity at all. Bounds are enforced in
      // prepareDerivedData and at the mutation site (critique M12).
      woundSlots: new fields.SetField(
        new fields.NumberField({ min: 0, integer: true }), { initial: [] }
      ),

      speed: new fields.NumberField({ initial: 5, min: 0, integer: true }),   // C:24
      xp: new fields.SchemaField({
        txp: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        spendable: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // renamed from skillBonusesSpent
        expertiseBonusesSpent: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        charBonusesSpent: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),

      // CONTRACT: `currency` is LOOSE coin carried on the person. A slot holds
      // 250 loose (C:1917); a Coin Purse is an ITEM with its own capacity, so
      // purses live in the inventory, not here. slots.mjs assembles both into
      // Layout.coin — do not add a purse field to the actor.
      currency: new fields.NumberField({ initial: 0, min: 0, integer: true }),

      // Strictly boolean in PT2 — "You can't gain a second instance of a
      // condition you already have" (R:528). `boned` is DELETED; it has no PT2
      // equivalent and must not be silently converted to `weakened`.
      conditions: new fields.SchemaField({
        blessed:     new fields.BooleanField({ initial: false }),  // R:532, was leveled
        grabbed:     new fields.BooleanField({ initial: false }),  // R:536
        prone:       new fields.BooleanField({ initial: false }),  // R:542
        unconscious: new fields.BooleanField({ initial: false }),  // R:554
        vulnerable:  new fields.BooleanField({ initial: false }),  // R:544 NEW
        weakened:    new fields.BooleanField({ initial: false })   // R:556 NEW
      }),

      background: new fields.StringField({ blank: true }),

      // NEW — creation step 4 (C:40, C:2551).
      npcConnection: new fields.SchemaField({
        name: new fields.StringField({ blank: true, initial: "" }),
        relationship: new fields.StringField({ blank: true, initial: "" }),
        notes: new fields.HTMLField()
      }),

      cryptBoon: new fields.StringField({ blank: true }),
      activeBoon: new fields.SchemaField({
        boonId: new fields.StringField({ blank: true, initial: "" }),
        sourceCrowName: new fields.StringField({ blank: true, initial: "" }),
        usesLeft: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        prayedOnCycle: new fields.NumberField({ initial: -1, integer: true })
      }),
      details: new fields.SchemaField({ feature: new fields.HTMLField() }),

      // Prepare for Task (R:658-664). PT2 attaches the bonus to a SPECIFIC TASK
      // in a specific location, not to a skill, and it is +2 (was +1).
      preparedTask: new fields.SchemaField({
        task: new fields.StringField({ blank: true, initial: "" }),
        bonus: new fields.NumberField({ initial: 2, integer: true }),
        setOn: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),

      // CONTRACT: `effects` held a d10+boned roll in PT1. `boned` is gone, so
      // the roll's shape is a Wave 1 question (T1.6 owns miasma). The stored
      // range is unchanged so no data is lost; only the roll that produces it
      // needs revisiting.
      miasma: new fields.SchemaField({
        effects: new fields.ArrayField(
          new fields.NumberField({ min: 1, max: 12, integer: true }), { initial: [] }
        ),
        permanentNPC: new fields.BooleanField({ initial: false }),
        lastTestOn: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),

      crafting: new fields.SchemaField({
        projects: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ initial: "" }),
          name: new fields.StringField({ initial: "" }),
          // renamed from `skill` — crafting rolls use an expertise in PT2
          expertise: new fields.StringField({ initial: "" }),
          goal: new fields.NumberField({ initial: 100, min: 1, integer: true }),
          points: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          prereqBonus: new fields.NumberField({ initial: 0, min: 0, max: 2, integer: true }),
          materials: new fields.ArrayField(new fields.StringField(), { initial: [] }),
          hasRecipe: new fields.BooleanField({ initial: false }),
          notes: new fields.StringField({ initial: "" })
        }), { initial: [] })
      })
    };
  }

  prepareDerivedData() {
    // Derived AD = sum of worn armor's CURRENT pool, falling back to `ad`.
    let ad = 0, adMax = 0;
    for (const i of this.parent.items) {
      if (i.type !== "armor" || !i.system.worn) continue;
      ad += Math.max(0, i.system.adCurrent ?? i.system.ad ?? 0);
      adMax += i.system.ad ?? 0;
    }
    this.ad = ad;
    this.adMax = adMax;

    // --- Expertise caps (H6). Derived, never stored. ------------------------
    const max = expertiseMaxForTxp(this.xp?.txp ?? 0);
    this.expertiseMax = max;
    let spentTotal = 0;
    for (const e of Object.values(this.expertises ?? {})) {
      e.max = max;
      // Surface an over-cap value rather than clamping it. The migration can
      // legitimately leave one here (report-only is the default), and silently
      // clamping would hide exactly what the GM is supposed to be deciding on.
      e.overMax = Math.max(0, (e.uses ?? 0) - max);
      spentTotal += e.uses ?? 0;
    }
    this.expertiseSpentTotal = spentTotal;

    // --- Wounds (M12). Capacity-relative and NON-DESTRUCTIVE. ---------------
    // `backpackCapacity` is the config base; a Wave 1 trait/item pass may raise
    // it, and this must keep working when it does.
    const cap = this.backpackCapacity ?? CROWS.carryContainers.backpack;
    this.backpackCapacity = cap;
    const all = [...(this.woundSlots ?? [])];
    const held = all.filter(i => i < cap);
    // NEVER drop an out-of-range index: if a slot-granting trait is removed its
    // wounds must not evaporate, which would spontaneously heal the character.
    this.orphanedWounds = all.filter(i => i >= cap);
    this.wounds = held.length;                 // back-compat scalar
    // Death is capacity-relative (R:524 "all backpack slots"), not >= 10.
    // Evaluate on wound GAIN only — see the mutation site. Computing it here is
    // reporting, not adjudication: a shrinking capacity must NOT auto-kill.
    this.deadFromWounds = held.length >= cap;

    // --- Effective speed ----------------------------------------------------
    //   grabbed / unconscious -> 0 (R:536, R:554)
    //   prone -> halved, rounded down (R:542)
    // The wound penalty (R:524, reading (c)) needs the positional Layout, which
    // slots.mjs owns, so it is applied by that helper and not here.
    const baseSpeed = this.speed ?? 0;
    const swiftness = Number(this.parent.getFlag?.("crows", "swiftnessUntilDtEnd") ?? 0) || 0;
    const c = this.conditions ?? {};
    let eff = baseSpeed;
    let speedNote = "";
    if (c.grabbed || c.unconscious) { eff = 0; speedNote = c.unconscious ? "unconscious" : "grabbed"; }
    else if (c.prone) { eff = Math.floor(baseSpeed / 2); speedNote = "prone"; }
    if (swiftness > 0 && eff > 0) {
      eff += swiftness;
      speedNote = speedNote ? `${speedNote} +${swiftness} swiftness` : `+${swiftness} swiftness`;
    }
    this.effectiveSpeed = eff;
    this.speedNote = speedNote;

    // CONTRACT: `conditionNet` is DELETED. It was (blessed - boned) as a ±1 on
    // every roll. PT2 has no `boned`, and Blessed is an EDGE (R:532), not a
    // numeric modifier — the two channels are explicitly separate (R:286).
    // helpers/roll.mjs must build edges/banes instead. Wave 1 (T1.1) owns that.

    // Advancement bookkeeping, useful to the sheet and the migration report.
    this.bonusesEarned = bonusesEarnedAtTxp(this.xp?.txp ?? 0);
  }
}
