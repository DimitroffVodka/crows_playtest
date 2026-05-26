const { TypeDataModel } = foundry.abstract;
const fields = foundry.data.fields;
import { CROWS } from "../../config.mjs";

const charField = () => new fields.SchemaField({
  value: new fields.NumberField({ initial: 0, min: -1, max: 3, integer: true })
});

export class CrowData extends TypeDataModel {
  static defineSchema() {
    const skills = {};
    for (const s of CROWS.skills) skills[s] = new fields.SchemaField({
      bonus: new fields.NumberField({ initial: 0, min: 0, max: 2, integer: true })
    });
    return {
      characteristics: new fields.SchemaField({
        agility: charField(), mind: charField(), strength: charField()
      }),
      skills: new fields.SchemaField(skills),
      stamina: new fields.SchemaField({
        value: new fields.NumberField({ initial: 5, min: 0, integer: true }),
        max: new fields.NumberField({ initial: 5, min: 0, integer: true })
      }),
      wounds: new fields.NumberField({ initial: 0, min: 0, max: CROWS.backpackSize, integer: true }),
      speed: new fields.NumberField({ initial: 5, min: 0, integer: true }),
      xp: new fields.SchemaField({
        txp: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        spendable: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        skillBonusesSpent: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        charBonusesSpent: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      currency: new fields.NumberField({ initial: 0, min: 0, integer: true }),
      conditions: new fields.SchemaField({
        blessed: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        boned: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        grabbed: new fields.BooleanField({ initial: false }),
        prone: new fields.BooleanField({ initial: false }),
        unconscious: new fields.BooleanField({ initial: false })
      }),
      background: new fields.StringField({ blank: true }),
      // Boon this crow grants from the Crypt — set when their character dies
      // and is interred. Boon ID matches keys in CRYPT_BOONS (helpers/crypt.mjs).
      cryptBoon: new fields.StringField({ blank: true }),
      // Boon currently borrowed from a dead crow (cleared on expenditure).
      activeBoon: new fields.SchemaField({
        boonId: new fields.StringField({ blank: true, initial: "" }),
        sourceCrowName: new fields.StringField({ blank: true, initial: "" }),
        // Optional uses-remaining counter (Rescue uses cryptLevel charges).
        usesLeft: new fields.NumberField({ initial: 0, min: 0, integer: true }),
        // Cycle ID the crow last prayed at the crypt (gate for once-per-cycle limit).
        prayedOnCycle: new fields.NumberField({ initial: -1, integer: true })
      }),
      details: new fields.SchemaField({ feature: new fields.HTMLField() }),
      // Prepare for Task rest activity (Rules p.11): +1 to the next roll of `skill`,
      // consumed on use. `detail` is free-text describing the task; `setOn` is the
      // game time / DT-counter snapshot for display ("set during DT 3").
      preparedTask: new fields.SchemaField({
        skill: new fields.StringField({ blank: true, initial: "" }),
        detail: new fields.StringField({ blank: true, initial: "" }),
        setOn: new fields.NumberField({ initial: 0, min: 0, integer: true })
      }),
      // Miasma effects (Rules p.1115–1161). `effects` holds the d10+boned roll
      // values of active Miasma effects (1-12 only; 13+ flips `permanentNPC`).
      // `lastTestOn` is the DT counter at the last resist test (24h cycle).
      // `permanentNPC` = the catastrophic 13+ result; PC becomes a Ref NPC.
      miasma: new fields.SchemaField({
        effects: new fields.ArrayField(new fields.NumberField({ min: 1, max: 12, integer: true }), { initial: [] }),
        permanentNPC: new fields.BooleanField({ initial: false }),
        lastTestOn: new fields.NumberField({ initial: 0, min: 0, integer: true })
      })
    };
  }

  prepareDerivedData() {
    // Derived AD = sum of worn armor's CURRENT pool (adCurrent), falling back to ad when undamaged/uninitialized.
    let ad = 0;
    let adMax = 0;
    for (const i of this.parent.items) {
      if (i.type !== "armor" || !i.system.worn) continue;
      const cur = i.system.adCurrent ?? i.system.ad ?? 0;
      ad += Math.max(0, cur);
      adMax += i.system.ad ?? 0;
    }
    this.ad = ad;
    this.adMax = adMax;
    this.conditionNet = (this.conditions.blessed ?? 0) - (this.conditions.boned ?? 0);
    this.dead = (this.wounds ?? 0) >= CROWS.backpackSize;

    // Effective speed factoring in conditions:
    //   grabbed / unconscious → 0
    //   prone → halved (rounded down)
    // Then Boon of Swiftness adds its temp +lvl on top until end of DT.
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
  }
}
