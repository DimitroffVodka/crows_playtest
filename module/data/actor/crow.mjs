const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import {
  CROWS, ALL_EXPERTISES, MATERIAL_IDENTITY_KEYS,
  expertiseMaxForTxp, bonusesEarnedAtTxp, effectiveCapacities
} from "../../config.mjs";
import { migrateCrowSystem, expertiseOverBudget } from "../../helpers/migration.mjs";

const CRAFTING_PROJECT_STATUSES = ["active", "blocked", "pending"];
const CRAFTING_MATERIAL_IDENTITIES = [
  "", ...MATERIAL_IDENTITY_KEYS, "creatureTypeParts"
];
const CRAFTING_MATERIAL_FORMS = ["", "bar", "log", "part"];
const CRAFTING_MATERIAL_SIZES = ["", "tiny", "small", "medium", "large"];

function craftingMaterialField() {
  return new fields.SchemaField({
    id: new fields.StringField({ initial: "" }),
    quantity: new fields.NumberField({ initial: 1, min: 1, integer: true }),
    identity: new fields.StringField({ initial: "", blank: true, choices: CRAFTING_MATERIAL_IDENTITIES }),
    form: new fields.StringField({ initial: "", blank: true, choices: CRAFTING_MATERIAL_FORMS }),
    size: new fields.StringField({ initial: "", blank: true, choices: CRAFTING_MATERIAL_SIZES }),
    params: new fields.SchemaField({
      // Slaying is the one parameterized recipe. Keeping the parameter nested
      // means a future recipe can add parameters without changing identity.
      creatureType: new fields.StringField({ initial: "", blank: true, choices: ["", ...CROWS.creatureTypes] })
    }),
    label: new fields.StringField({ initial: "", blank: true }),
    legacyText: new fields.StringField({ initial: "", blank: true })
  });
}

function craftingTargetField() {
  return new fields.SchemaField({
    actorUuid: new fields.StringField({ initial: "", blank: true }),
    itemId: new fields.StringField({ initial: "", blank: true }),
    itemUuidAtStart: new fields.StringField({ initial: "", blank: true }),
    fingerprint: new fields.StringField({ initial: "", blank: true })
  });
}

// A few lightweight schema-bound probes intentionally provide only the fields
// needed by the existing actor model. Foundry v14 has ObjectField, but falling
// back to a StringField keeps those probes able to exercise the lifecycle
// schema without changing their minimal runtime contract. Production Foundry
// always takes the ObjectField branch and preserves the Ref descriptor object.
function craftingObjectField() {
  const Field = fields.ObjectField ?? fields.StringField;
  return new Field({ initial: {} });
}

function craftingOutputField() {
  return new fields.SchemaField({
    kind: new fields.StringField({ initial: "equipment", choices: ["equipment", "enchantment"] }),
    name: new fields.StringField({ initial: "", blank: true }),
    label: new fields.StringField({ initial: "", blank: true }),
    // The Ref-facing template is intentionally opaque to this actor model;
    // it is a descriptor, never an embedded output Item.
    template: craftingObjectField(),
    target: craftingTargetField()
  });
}

function craftingOutputClaimField() {
  return new fields.SchemaField({
    id: new fields.StringField({ initial: "" }),
    projectId: new fields.StringField({ initial: "" }),
    transactionId: new fields.StringField({ initial: "", blank: true }),
    copy: new fields.NumberField({ initial: 1, min: 1, integer: true }),
    kind: new fields.StringField({ initial: "equipment", choices: ["equipment", "enchantment"] }),
    name: new fields.StringField({ initial: "", blank: true }),
    label: new fields.StringField({ initial: "", blank: true }),
    output: craftingObjectField(),
    target: craftingTargetField(),
    state: new fields.StringField({ initial: "ready", choices: ["ready", "attached", "attach-failed"] })
  });
}

function craftingTransactionField() {
  return new fields.SchemaField({
    txId: new fields.StringField({ initial: "" }),
    phase: new fields.StringField({
      initial: "prepared",
      choices: ["prepared", "quantities-applied", "items-deleted", "finalized", "recovery-required"]
    }),
    actorRevision: new fields.StringField({ initial: "", blank: true }),
    projectRevision: new fields.StringField({ initial: "", blank: true }),
    projectId: new fields.StringField({ initial: "" }),
    copies: new fields.NumberField({ initial: 1, min: 1, integer: true }),
    preQuantities: new fields.ArrayField(new fields.SchemaField({
      itemId: new fields.StringField({ initial: "" }),
      before: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      after: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      delete: new fields.BooleanField({ initial: false })
    }), { initial: [] }),
    postQuantities: new fields.ArrayField(new fields.SchemaField({
      itemId: new fields.StringField({ initial: "" }),
      quantity: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      present: new fields.BooleanField({ initial: true })
    }), { initial: [] }),
    updates: new fields.ArrayField(craftingObjectField(), { initial: [] }),
    exhaustedIds: new fields.ArrayField(new fields.StringField(), { initial: [] }),
    failedPhase: new fields.StringField({ initial: "", blank: true }),
    error: new fields.StringField({ initial: "", blank: true }),
    result: craftingObjectField()
  });
}

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
  /**
   * LAYER (a) of the PT1 -> PT2 migration. Wired here because `migrateData` can
   * only live on the model, and T1.3 correctly would not edit a T0.2 file.
   * Without this the entire layer (a) transform is dead code.
   *
   * NOTE THE RETURN, and do not "tidy" it into a merge. Several transforms in
   * `migrateCrowSystem` work by DELETING a key — `skills`, `wounds`, `boned` —
   * so the returned object must REPLACE source. Merging it onto the original
   * resurrects every field the migration just removed, silently.
   *
   * Runs on every load AND on partial update deltas, so it must never assume a
   * sibling field is present. That is `migrateCrowSystem`'s contract, tested.
   */
  static migrateData(source) {
    return super.migrateData(migrateCrowSystem(source));
  }

  static defineSchema() {
    // REPLACES `skills`. THREE distinct quantities, and conflating any two of
    // them corrupts characters (review finding 1):
    //
    //   value  — uses REMAINING right now. Spending decrements this.
    //   max    — uses OWNED, from background + advancement. Persistent.
    //   cap    — the legal ceiling 2/3/4 for this TXP. DERIVED, not stored.
    //
    // R:294: "Each expertise has a number of uses, which is determined at
    // character creation and can be increased through character advancement.
    // You can use an expertise a number of times equal its uses. You regain all
    // uses of an expertise when you finish a rest."
    //
    // A single mutable count cannot survive spend-then-rest: once it hits 0
    // there is no way to tell an expertise granted at 1 from one granted at 2
    // from one never owned, so rest cannot restore correctly. Restoring to the
    // derived cap instead would MINT uses nobody purchased.
    //
    // {value, max} also matches `stamina` in this same schema, so the rest/
    // refresh idiom reads the same way for both.
    //   rest (R:628)              -> value = max
    //   rest in Miasma (R:1125)   -> leave value alone, everything else applies
    //   advancement (C:615)       -> raise max, and value with it
    const expertises = {};
    for (const key of ALL_EXPERTISES) {
      expertises[key] = new fields.SchemaField({
        value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 0, min: 0, integer: true })
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
        weakened:    new fields.BooleanField({ initial: false }),  // R:556 NEW
        // The `dead` status effect maps here, exactly as it does on MonsterData.
        // Review found `dead` had NO crow-side destination: only MonsterData
        // owned `defeated`, so the mirror in conditions.mjs had nowhere to write
        // for a PC and the mapping was silently actor-type-dependent. Symmetric
        // now — one mapping, no branching. Set by the death adjudication at the
        // wound-gain mutation (R:524), never from derived data.
        defeated:    new fields.BooleanField({ initial: false })
      }),

      // The background's NAME. This is what applyBackground() has always
      // written and it is all a PT1 actor carries.
      background: new fields.StringField({ blank: true }),

      // CONTRACT: stable identity for the background, added because H5's budget
      // needs the background's expertise grants and there is NO embedded
      // Background Item to read them from — `background` is a bare name string.
      // Resolution is by id when present, falling back to name; layer (b)
      // stamps the id once it resolves, so later runs are stable against
      // renames. An unresolved lookup is REPORTED, never treated as zero.
      backgroundId: new fields.StringField({ blank: true, initial: "" }),

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
        // StringField per Part 1.1. It was a NumberField, which would coerce the
        // PT1 fixture's "2026-05-20" to 0 and lose the audit value. Holds either
        // a DT counter rendered as text or a date — migration canonicalises.
        setOn: new fields.StringField({ blank: true, initial: "" })
      }),

      // PT2's accumulating Miasma resource. This is deliberately a plain
      // integer in the Miasma namespace, not a condition or Active Effect:
      // conditions cannot stack, while cruelty explicitly does (R:443,
      // R:1130, R:1134).
      miasma: new fields.SchemaField({
        cruelty: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Effects retain their persisted bucket representation so PT1 worlds
        // do not lose their table rolls. The helper resolves each bucket to a
        // PT2 first/second pair; both records are gained from one bucket.
        effects: new fields.ArrayField(
          new fields.NumberField({ min: 1, max: 12, integer: true }), { initial: [] }
        ),
        permanentNPC: new fields.BooleanField({ initial: false }),
        lastTestOn: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),

      crafting: new fields.SchemaField({
        // Monotonic observation number for receipts/journals. It is not a
        // compare-and-swap fence; Foundry v14 exposes no such primitive.
        revision: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        projects: new fields.ArrayField(new fields.SchemaField({
          id: new fields.StringField({ initial: "" }),
          name: new fields.StringField({ initial: "" }),
          // renamed from `skill` — crafting rolls use an expertise in PT2
          expertise: new fields.StringField({ initial: "" }),
          goal: new fields.NumberField({ initial: 100, min: 1, integer: true }),
          points: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          // `points` is surplus toward the next copy. Completed copies are
          // durable and therefore remain visible after an exact-goal roll.
          completed: new fields.NumberField({ initial: 0, min: 0, integer: true }),
          status: new fields.StringField({ initial: "active", choices: CRAFTING_PROJECT_STATUSES }),
          materials: new fields.ArrayField(craftingMaterialField(), { initial: [] }),
          output: craftingOutputField(),
          notes: new fields.StringField({ initial: "" })
        }), { initial: [] }),
        // Finalize records a Ref-facing handoff here. It does not embed or
        // grant the finished Item; the Ref/GM performs that terminal action.
        outputClaims: new fields.ArrayField(craftingOutputClaimField(), { initial: [] }),
        // Bounded material sagas remain recoverable after an uncertain Item
        // update/delete. Never infer completion from a missing journal entry.
        transactions: new fields.ArrayField(craftingTransactionField(), { initial: [] })
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

    // --- Expertise cap (H6). Derived, never stored. -------------------------
    // NOTE the vocabulary: `cap` is the ADVANCEMENT CEILING for this TXP.
    // `e.max` is what this crow actually OWNS and is stored. They are different
    // numbers and conflating them is review finding 1.
    const cap = expertiseMaxForTxp(this.xp?.txp ?? 0);
    this.expertiseCap = cap;
    let ownedTotal = 0, remainingTotal = 0;
    for (const e of Object.values(this.expertises ?? {})) {
      // Surface an over-cap allocation rather than clamping it. The migration
      // legitimately leaves one (report-only is the default), and clamping would
      // hide exactly what the GM is supposed to be deciding on.
      e.overCap = Math.max(0, (e.max ?? 0) - cap);
      // A rest sets value = max; nothing should ever leave value above max, but
      // report it rather than trust it.
      e.overMax = Math.max(0, (e.value ?? 0) - (e.max ?? 0));
      ownedTotal += e.max ?? 0;
      remainingTotal += e.value ?? 0;
    }
    // The H5 budget compares OWNED against the budget. It must not use
    // `remaining`, or the reported over-budget figure would shrink every time a
    // player spent a use, even though their permanent allocation never changed.
    this.expertiseOwnedTotal = ownedTotal;
    this.expertiseRemainingTotal = remainingTotal;

    // --- Capacity (M12 + review finding 5) ----------------------------------
    // Sum this actor's trait slot grants and run them through the ONE shared
    // pure function, so this and slots.mjs cannot disagree about how many
    // backpack slots exist. Previously this read a config constant and the
    // grants were never summed anywhere, which made the trait-aware capacity
    // the contract promised purely notional.
    const grants = [];
    for (const i of this.parent.items) {
      if (i.type !== "trait") continue;
      for (const g of i.system?.slotGrants ?? []) grants.push(g);
    }
    this.capacities = effectiveCapacities(grants);
    const backpackCap = this.capacities.backpack;
    this.backpackCapacity = backpackCap;

    // --- Wounds. Capacity-relative and NON-DESTRUCTIVE. ---------------------
    const all = [...(this.woundSlots ?? [])];
    const held = all.filter(i => i < backpackCap);
    // NEVER drop an out-of-range index: if a slot-granting trait is removed its
    // wounds must not evaporate, which would spontaneously heal the character.
    this.orphanedWounds = all.filter(i => i >= backpackCap);
    this.wounds = held.length;                 // back-compat scalar

    // REPORTING ONLY — deliberately not named `dead`. R:524 kills a creature
    // when all backpack slots hold wounds, but this flag can also flip to true
    // because CAPACITY SHRANK (a trait removed), and that must alert the Ref,
    // never kill anyone. Death is adjudicated at the wound-GAIN mutation by
    // comparing pre/post state and emitting a `becameDead` event. Nothing may
    // adjudicate from derived preparation.
    this.woundCapacityFilled = backpackCap > 0 && held.length >= backpackCap;

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

    // --- Over-budget surfacing (H5) ----------------------------------------
    // CONTRACT CORRECTION, found by T1.3. The contract specified this as plain
    // derived data, but its input `backgroundUses` needs an ASYNC compendium
    // lookup and `prepareDerivedData` is synchronous — there is no embedded
    // Background Item to read (see `background` above). So layer (b) caches the
    // resolved figure on `flags.crows.backgroundUses` at reconcile time and this
    // reads the cache.
    //
    // It returns NULL, not 0, when the cache is absent. That distinction is the
    // whole point: 0 reads as "this crow is fine", which is the same failure as
    // treating an unresolved background as a zero budget — it would report a
    // migrated character as maximally over-allocated exactly when we know least
    // about them. Null means "not yet computed"; the sheet shows nothing.
    //
    // Required because the budget defaults to REPORT-ONLY, so the over-budget
    // state is permanent until a GM acts and a migration-time journal entry
    // scrolls away. T2.1 renders a badge when this is a positive number.
    this.expertiseOverBudget = expertiseOverBudget(this.parent);
  }
}
