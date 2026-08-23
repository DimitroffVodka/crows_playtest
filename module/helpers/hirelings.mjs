/**
 * Hirelings — new in Playtest 2.
 *
 * Citations are `C:<line>` into the Characters book: the hireling rules are
 * C:2499-2533, and the barracks that supplies them is C:2759-2783.
 *
 * A hireling is an ordinary creature actor (its stat block lives in the
 * Bestiary, so `MonsterData`), not a new document type. What makes it a
 * hireling is an employment record, which is why this file stores state in a
 * flag rather than proposing a schema change — no ticket in this wave owns the
 * actor models.
 *
 * ## The three rules that carry teeth
 *
 * 1. **Payment is daily and up front** (C:2507): `power x 10` gc, minimum 10,
 *    *plus a day's worth of food*, at the START of each day of service. The
 *    food is as binding as the coin and is tracked alongside it.
 * 2. **Death is expensive and deferred** (C:2509): equipment (or treasure of
 *    equal value) + salary already paid + `power x 500`, owed to the family
 *    *upon returning to the village where the hireling was hired*. Not to the
 *    corpse, not where you happen to be standing.
 * 3. **Default is a reputation, not a fine** (C:2511): miss a daily payment or
 *    stiff a dead hireling's family and hirelings refuse to work with that PC
 *    *and other crows associated with them* until the debt is paid. The debt
 *    is therefore a village-level fact about a party, not a per-actor one.
 *
 * The pure half of this file computes wages, debts and eligibility and is what
 * `test/village.test.mjs` exercises. The Foundry half is flags and chat cards.
 */

import { INSTITUTIONS, capstoneActive, advancementRow } from "./village.mjs";

const NS = "crows";
const FLAG_EMPLOYMENT = "employment";

/* -------------------------------------------------------------------------- */
/*  Employment terms (C:2503-2511)                                             */
/* -------------------------------------------------------------------------- */

export const WAGE_PER_POWER = 10;        // C:2507
export const WAGE_MINIMUM = 10;          // C:2507 — "(minimum 10 gc)"
export const DEATH_PAYMENT_PER_POWER = 500;  // C:2509
export const RATIONS_PER_DAY = 1;        // C:2507 — "a day's worth of food"

/** C:2507 — daily gc owed at the start of each day of service. */
export function dailyWage(power = 0) {
  return Math.max(WAGE_MINIMUM, Math.max(0, Math.floor(Number(power) || 0)) * WAGE_PER_POWER);
}

/** C:2507 — the whole daily obligation: coin AND food. Missing either defaults. */
export function dailyUpkeep(power = 0) {
  return { gc: dailyWage(power), rations: RATIONS_PER_DAY };
}

/** C:2509 — the death payment component alone. */
export function deathPayment(power = 0) {
  return Math.max(0, Math.floor(Number(power) || 0)) * DEATH_PAYMENT_PER_POWER;
}

/**
 * C:2509 — everything owed to a dead hireling's family, and where it is owed.
 *
 * `salaryPaid` is the salary ALREADY PAID, which the text says is owed *again*
 * to the family — the hireling's earnings pass to them on top of the death
 * payment. It is not a credit against the bill, and treating it as one halves
 * the debt on exactly the roll that should hurt.
 */
export function settleHirelingDeath({ power = 0, salaryPaid = 0, equipmentValue = 0, hiredInVillage = null } = {}) {
  const death = deathPayment(power);
  const salary = Math.max(0, Math.floor(Number(salaryPaid) || 0));
  const equipment = Math.max(0, Math.floor(Number(equipmentValue) || 0));
  return {
    deathPayment: death,
    salaryOwed: salary,
    equipmentOwed: equipment,
    total: death + salary + equipment,
    owedTo: "family",
    payableInVillage: hiredInVillage,        // C:2509 — where they were hired
    payableOn: "return"
  };
}

/* -------------------------------------------------------------------------- */
/*  Default and reputation (C:2511)                                            */
/* -------------------------------------------------------------------------- */

/**
 * C:2511 — "If a hireling doesn't receive payment, they leave the service of
 * the PC." Unpaid for a day, they are gone; and word gets around.
 *
 * The blackball covers the employer AND "other crows associated with them", so
 * `blacklistedParty` is true rather than naming one actor: a party cannot route
 * around the debt by sending a different member to the barracks.
 */
export function applyMissedPayment(employment = {}) {
  return {
    ...employment,
    status: "left",
    leftReason: "unpaid",
    unpaidDays: (Math.floor(Number(employment.unpaidDays) || 0)) + 1,
    outstandingDebt: (Math.floor(Number(employment.outstandingDebt) || 0)) + dailyWage(employment.power),
    blacklistedParty: true
  };
}

/** C:2511 — hirelings refuse work while any debt stands. */
export function canHireWhileInDebt(outstandingDebt = 0) {
  return (Math.floor(Number(outstandingDebt) || 0)) <= 0;
}

/** Paying the debt off clears the blackball (C:2511 — "until the debt is paid"). */
export function payDebt(employment = {}, amount = 0) {
  const remaining = Math.max(0, (Math.floor(Number(employment.outstandingDebt) || 0)) - Math.max(0, Math.floor(Number(amount) || 0)));
  return { ...employment, outstandingDebt: remaining, blacklistedParty: remaining > 0 };
}

/* -------------------------------------------------------------------------- */
/*  Availability from the barracks (C:2773-2783)                               */
/* -------------------------------------------------------------------------- */

/** C:2777 — the highest-power hireling the barracks can supply at this level. */
export function hireableMaxPower(barracksLevel = 0) {
  const lvl = Math.floor(Number(barracksLevel) || 0);
  if (lvl <= 0) return 0;                 // no barracks, or closed for business
  return advancementRow("barracks", lvl)?.maxPower ?? 0;
}

/** Can this creature be hired from a barracks at that level? */
export function canHireFromBarracks({ power = 0 } = {}, barracksLevel = 0) {
  const max = hireableMaxPower(barracksLevel);
  const p = Math.floor(Number(power) || 0);
  return { ok: max > 0 && p <= max, maxPower: max, power: p };
}

/**
 * C:2769 — at barracks level 5 with Prosperity 10, each hireling arrives with
 * 12 rations of their own, which they eat before you start owing them food.
 */
export const PROVISIONS_RATIONS = 12;

export function hirelingStartingRations(barracksLevel = 0, prosperity = 0) {
  return capstoneActive("barracks", barracksLevel, prosperity) ? PROVISIONS_RATIONS : 0;
}

/**
 * Days you can field a hireling before the food obligation starts, given their
 * own provisions. Purely informational, but it is the number a table actually
 * asks for.
 */
export function daysBeforeFeeding(barracksLevel = 0, prosperity = 0) {
  return hirelingStartingRations(barracksLevel, prosperity) / RATIONS_PER_DAY;
}

/* -------------------------------------------------------------------------- */
/*  Control (C:2513-2517)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * C:2515-2517, stated as data so a sheet can render it and a rule can check it.
 *
 * The one mechanical clause is `noXP`: hirelings follow every PC rule *except*
 * that they can't gain or spend XP. Everything else — equipment, expertises,
 * actions, maneuvers, rest activities — is explicitly permitted, so anything
 * gating on "is a PC" should gate on this instead.
 */
export const HIRELING_CONTROL = Object.freeze({
  controlledBy: "employer",              // C:2515 — the player of the hiring PC
  refMayOverride: true,                  // C:2515 — out of character, or outlandishly dangerous
  refOverrideReasons: Object.freeze([
    "very out of character",
    "outlandishly dangerous for little to no reward"
  ]),
  followsPCRules: true,                  // C:2517
  noXP: true,                            // C:2517 — can't gain OR spend XP
  mayUseEquipment: true,                 // C:2517
  hasExpertises: true,                   // C:2517
  mayTakeRestActivities: true,           // C:2517
  returnsBorrowedEquipment: true,        // C:2517
  source: "C:2513-2517"
});

/** C:2517 — hirelings never accrue or spend XP; every XP path must skip them. */
export function canGainXP(employment = null) {
  return !employment || employment.status !== "active" ? true : !HIRELING_CONTROL.noXP;
}

/* -------------------------------------------------------------------------- */
/*  Death of the employer (C:2531-2533)                                        */
/* -------------------------------------------------------------------------- */

/**
 * C:2533 — when a hireling learns their employer died, they approach any living
 * PCs and ask whether those PCs want to keep working with them. If nobody is
 * willing, they return to the village where they were hired.
 *
 * Note "living PCs", not "the party": a hireling whose employer dies with no
 * survivors present has nobody to ask and goes home. The willing PC becomes the
 * new employer on the same terms — the text describes continuing the same
 * arrangement, not renegotiating, so wage and accrued salary carry over.
 */
export function onEmployerDeath(employment = {}, { willingPCs = [] } = {}) {
  const candidates = (willingPCs ?? []).filter(Boolean);
  if (!candidates.length) {
    return {
      ...employment,
      status: "returnedHome",
      employerId: null,
      returnedTo: employment.hiredInVillage ?? null,
      offerMade: true,
      source: "C:2533"
    };
  }
  const next = candidates[0];
  return {
    ...employment,
    status: "active",
    employerId: next?.id ?? next,
    previousEmployerId: employment.employerId ?? null,
    offerMade: true,
    source: "C:2533"
  };
}

/* ========================================================================== */
/*  Foundry-facing half — employment records live in an actor flag.            */
/* ========================================================================== */

/** A fresh employment record. `power` is copied so wages survive a stat edit. */
export function newEmployment({ employerId, power = 0, hiredInVillage = null, hiredOnCycle = 0, startingRations = 0 } = {}) {
  return {
    employerId: employerId ?? null,
    power: Math.max(0, Math.floor(Number(power) || 0)),
    hiredInVillage,
    hiredOnCycle,
    status: "active",
    daysServed: 0,
    salaryPaid: 0,
    rationsProvided: 0,
    startingRations: Math.max(0, Math.floor(Number(startingRations) || 0)),
    unpaidDays: 0,
    outstandingDebt: 0,
    blacklistedParty: false
  };
}

export function readEmployment(actor) {
  return actor?.getFlag?.(NS, FLAG_EMPLOYMENT) ?? null;
}

async function writeEmployment(actor, employment) {
  await actor.setFlag(NS, FLAG_EMPLOYMENT, employment);
  return employment;
}

/**
 * Hire a creature from the barracks. Refuses above the barracks' maximum power
 * (C:2777) and while the party owes a hireling debt (C:2511).
 */
export async function hire(hirelingActor, {
  employer, barracksLevel = 0, prosperity = 0, village = null, cycle = 0, outstandingDebt = 0
} = {}) {
  if (!hirelingActor) return { ok: false, error: "no hireling" };
  if (!canHireWhileInDebt(outstandingDebt)) {
    return { ok: false, error: "hirelings refuse to work with this party until the debt is paid (C:2511)" };
  }
  const power = hirelingActor.system?.power ?? 0;
  const gate = canHireFromBarracks({ power }, barracksLevel);
  if (!gate.ok) {
    return { ok: false, error: `the barracks supplies hirelings up to power ${gate.maxPower}; ${hirelingActor.name} is power ${gate.power}` };
  }

  const employment = newEmployment({
    employerId: employer?.id ?? null,
    power,
    hiredInVillage: village,
    hiredOnCycle: cycle,
    startingRations: hirelingStartingRations(barracksLevel, prosperity)
  });
  await writeEmployment(hirelingActor, employment);

  const upkeep = dailyUpkeep(power);
  await ChatMessage.create({
    content: `<div class="crows hireling-hired">
      <header><strong>${employer?.name ?? "A crow"}</strong> hires <strong>${hirelingActor.name}</strong> (power ${power})</header>
      <div>Daily terms: <strong>${upkeep.gc} gc</strong> and ${upkeep.rations} ration, paid at the start of each day.</div>
      <div>If they die: ${deathPayment(power)} gc plus equipment and salary paid, owed to their family in ${village ?? "the village where they were hired"}.</div>
      ${employment.startingRations ? `<div>Arrives with ${employment.startingRations} rations of their own (C:2769).</div>` : ""}
    </div>`,
    speaker: { alias: "Barracks" }
  });
  return { ok: true, employment, upkeep };
}

/**
 * Pay (or fail to pay) a day's service. `paid` false is a default: the hireling
 * leaves and the party is blackballed until the debt clears (C:2511).
 */
export async function payDay(hirelingActor, { paid = true, rationProvided = true } = {}) {
  const employment = readEmployment(hirelingActor);
  if (!employment) return { ok: false, error: "not a hireling" };
  if (employment.status !== "active") return { ok: false, error: `not in service (${employment.status})` };

  // C:2507 — coin AND food. Withholding either is a missed payment.
  const wage = dailyWage(employment.power);
  const ownRationsLeft = Math.max(0, employment.startingRations - employment.rationsProvided);
  const needsRationFromYou = ownRationsLeft <= 0;

  if (!paid || (needsRationFromYou && !rationProvided)) {
    const next = applyMissedPayment(employment);
    await writeEmployment(hirelingActor, next);
    await ChatMessage.create({
      content: `<div class="crows hireling-unpaid">
        <strong>${hirelingActor.name}</strong> goes unpaid and leaves service.
        <div>Owed <strong>${next.outstandingDebt} gc</strong>. Until it is paid, hirelings refuse to work with this crow or those associated with them (C:2511).</div>
      </div>`,
      speaker: { alias: "Barracks" }
    });
    return { ok: true, paid: false, employment: next };
  }

  const next = {
    ...employment,
    daysServed: employment.daysServed + 1,
    salaryPaid: employment.salaryPaid + wage,
    rationsProvided: employment.rationsProvided + (needsRationFromYou ? 0 : RATIONS_PER_DAY)
  };
  await writeEmployment(hirelingActor, next);
  return { ok: true, paid: true, wage, usedOwnRation: !needsRationFromYou, employment: next };
}

/** Record a hireling's death and post the bill owed to their family (C:2509). */
export async function recordDeath(hirelingActor, { equipmentValue = 0 } = {}) {
  const employment = readEmployment(hirelingActor);
  if (!employment) return { ok: false, error: "not a hireling" };
  const bill = settleHirelingDeath({
    power: employment.power,
    salaryPaid: employment.salaryPaid,
    equipmentValue,
    hiredInVillage: employment.hiredInVillage
  });
  const next = { ...employment, status: "dead", outstandingDebt: employment.outstandingDebt + bill.total };
  await writeEmployment(hirelingActor, next);

  await ChatMessage.create({
    content: `<div class="crows hireling-died">
      <header><strong>${hirelingActor.name}</strong> dies in service</header>
      <div>Owed to their family on your return to ${bill.payableInVillage ?? "the village where they were hired"}:</div>
      <ul>
        <li>Equipment or treasure of equal value: ${bill.equipmentOwed} gc</li>
        <li>Salary already paid: ${bill.salaryOwed} gc</li>
        <li>Death payment (power ${employment.power} &times; ${DEATH_PAYMENT_PER_POWER}): ${bill.deathPayment} gc</li>
      </ul>
      <div><strong>Total: ${bill.total} gc.</strong> Leave it unpaid and no hireling will work with this crow or those associated with them (C:2511).</div>
    </div>`,
    speaker: { alias: "Barracks" }
  });
  return { ok: true, bill, employment: next };
}

/** C:2533 — the employer died; offer the contract on, or send them home. */
export async function handleEmployerDeath(hirelingActor, { willingPCs = [] } = {}) {
  const employment = readEmployment(hirelingActor);
  if (!employment) return { ok: false, error: "not a hireling" };
  const next = onEmployerDeath(employment, { willingPCs });
  await writeEmployment(hirelingActor, next);

  await ChatMessage.create({
    content: `<div class="crows hireling-employer-died">
      ${next.status === "active"
        ? `<strong>${hirelingActor.name}</strong> agrees to continue on the same terms with a surviving crow.`
        : `<strong>${hirelingActor.name}</strong> finds no crow willing to keep them on and returns to ${next.returnedTo ?? "the village where they were hired"}.`}
    </div>`,
    speaker: { alias: "Barracks" }
  });
  return { ok: true, employment: next };
}

/** Barracks label and founding price, for a sheet that wants to name the source. */
export const BARRACKS = INSTITUTIONS.barracks;
