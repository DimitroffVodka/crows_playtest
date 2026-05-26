/**
 * Village — community institution shell (Rules pp.5546–5910).
 *
 * Tracks the village name, Prosperity (-10..+10), 10-day cycle counter,
 * and the list of established institutions. Institution upgrades and
 * foundings raise Prosperity by 1; a cycle ending without an upgrade
 * lowers it by 1. End-of-cycle rolls a d10 + Prosperity event from a
 * 20-entry table.
 *
 * This is the M3 v1 — generic institutions registry only. Per-institution
 * merchant tables (item availability, restocking) and the full Village
 * Crafting workflow are deferred to a later pass; the Crypt institution
 * IS integrated (its level seeds from village.institutions[crypt]).
 *
 * Institution types (per the booklet, mostly p.6121+):
 *   blacksmith, bookseller, crypt, enchanter, generalStore, herbalist,
 *   inn, market, mageGuild, scriptorium, smithy, temple
 *
 * Starting institutions per Rules p.5585: blacksmith, crypt, generalStore,
 * inn, temple, plus one chosen by the party. All begin at level 1.
 */

const NS = "crows";
const KEY_VILLAGE = "village";

const PROSPERITY_MIN = -10;
const PROSPERITY_MAX = 10;
const CYCLE_DAYS = 10;

export const STARTING_INSTITUTIONS = ["blacksmith", "crypt", "generalStore", "inn", "temple"];

export const INSTITUTION_TYPES = {
  blacksmith:   "Blacksmith",
  bookseller:   "Bookseller",
  crypt:        "Crypt",
  enchanter:    "Enchanter",
  generalStore: "General Store",
  herbalist:    "Herbalist",
  inn:          "Inn",
  market:       "Market",
  mageGuild:    "Mage Guild",
  scriptorium:  "Scriptorium",
  temple:       "Temple"
};

export function registerVillageSettings() {
  game.settings.register(NS, KEY_VILLAGE, {
    scope: "world",
    config: false,
    type: Object,
    default: _defaultVillage()
  });
}

function _defaultVillage() {
  // Seed with the starting institutions (all level 1, anonymous stewards).
  // Player groups can rename via the GM dialog after the world spins up.
  const institutions = STARTING_INSTITUTIONS.map((type, idx) => ({
    id: `seed-${idx}-${type}`,
    type,
    name: INSTITUTION_TYPES[type] ?? type,
    level: 1,
    steward: "",
    foundedOnCycle: 0
  }));
  return {
    name: "Unnamed Village",
    prosperity: 0,
    cycle: 0,                // village cycle index (starts at 0; each is 10 days)
    hasUpgradedThisCycle: true,  // start true so first cycle-end doesn't dock Prosperity
    institutions,
    pendingEvent: null       // last event roll, kept for GM reference
  };
}

export function getVillage() {
  try {
    const v = game.settings.get(NS, KEY_VILLAGE);
    // Defensive: backfill missing fields from default.
    return Object.assign(_defaultVillage(), v ?? {});
  } catch { return _defaultVillage(); }
}
async function _save(v) {
  return game.settings.set(NS, KEY_VILLAGE, v);
}

export async function setVillage(patch = {}) {
  const v = getVillage();
  const next = Object.assign({}, v, patch);
  next.prosperity = Math.max(PROSPERITY_MIN, Math.min(PROSPERITY_MAX, Number(next.prosperity) || 0));
  await _save(next);
  return next;
}

/**
 * Found a new institution. Raises Prosperity by 1 (Rules p.5621).
 * `id` is auto-generated if missing. Returns the new institution record.
 */
export async function foundInstitution({ type, name = null, steward = "", level = 1 }) {
  if (!INSTITUTION_TYPES[type]) return { ok: false, error: `unknown type: ${type}` };
  const v = getVillage();
  const id = `inst-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
  const inst = {
    id, type,
    name: name ?? INSTITUTION_TYPES[type],
    level: Math.max(1, Math.min(5, Number(level) || 1)),
    steward,
    foundedOnCycle: v.cycle
  };
  v.institutions.push(inst);
  v.prosperity = Math.min(PROSPERITY_MAX, (v.prosperity ?? 0) + 1);
  v.hasUpgradedThisCycle = true;
  await _save(v);
  await ChatMessage.create({
    content: `<div class="crows village-found">
      <strong>${v.name}</strong> founds <strong>${inst.name}</strong> (${INSTITUTION_TYPES[type]})${steward ? ` — steward: ${steward}` : ""}.
      Prosperity now <strong>${v.prosperity}</strong>.
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, institution: inst, prosperity: v.prosperity };
}

/** Upgrade an institution by id. Raises Prosperity by 1. */
export async function upgradeInstitution(id) {
  const v = getVillage();
  const inst = v.institutions.find(i => i.id === id);
  if (!inst) return { ok: false, error: "no such institution" };
  if (inst.level >= 5) return { ok: false, error: "max level" };
  inst.level += 1;
  v.prosperity = Math.min(PROSPERITY_MAX, (v.prosperity ?? 0) + 1);
  v.hasUpgradedThisCycle = true;
  await _save(v);
  await ChatMessage.create({
    content: `<div class="crows village-upgrade">
      <strong>${inst.name}</strong> upgraded to level <strong>${inst.level}</strong>. Prosperity now <strong>${v.prosperity}</strong>.
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, institution: inst, prosperity: v.prosperity };
}

/** Demote (used by negative events / damage). Returns destroyed boolean. */
export async function damageInstitution(id, { destroy = false } = {}) {
  const v = getVillage();
  const idx = v.institutions.findIndex(i => i.id === id);
  if (idx < 0) return { ok: false, error: "no such institution" };
  const inst = v.institutions[idx];
  if (destroy || inst.level <= 1) {
    v.institutions.splice(idx, 1);
    await _save(v);
    await ChatMessage.create({
      content: `<div class="crows village-destroyed"><strong>${inst.name}</strong> destroyed.</div>`,
      speaker: { alias: "Village" }
    });
    return { ok: true, destroyed: true, institution: inst };
  }
  inst.level -= 1;
  await _save(v);
  await ChatMessage.create({
    content: `<div class="crows village-damaged"><strong>${inst.name}</strong> damaged — level now ${inst.level}.</div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, destroyed: false, institution: inst };
}

/** Set Prosperity directly (clamps to [-10, +10]). */
export async function setProsperity(value, { silent = false } = {}) {
  const v = getVillage();
  const before = v.prosperity;
  v.prosperity = Math.max(PROSPERITY_MIN, Math.min(PROSPERITY_MAX, Math.floor(Number(value) || 0)));
  await _save(v);
  if (!silent) {
    await ChatMessage.create({
      content: `<div class="crows village-prosperity">Prosperity: ${before} → <strong>${v.prosperity}</strong></div>`,
      speaker: { alias: "Village" }
    });
  }
  return v.prosperity;
}

/** Sale percentage table (Rules p.5691). */
export function sellPercentage(prosperity = null) {
  const p = prosperity == null ? getVillage().prosperity : Number(prosperity);
  if (p <= -10) return 30;
  if (p <= -6)  return 40;
  if (p <= -2)  return 45;
  if (p <=  1)  return 50;
  if (p <=  5)  return 55;
  if (p <=  9)  return 60;
  return 70;
}

/** Check item availability per buy rules (Rules p.5657). */
export async function rollAvailability({ baseAvailability, prosperity = null, itemName = "item" }) {
  const p = prosperity == null ? getVillage().prosperity : Number(prosperity);
  const threshold = Math.max(0, Math.min(100, baseAvailability + p));
  const roll = await new Roll("1d100").evaluate();
  const available = roll.total <= threshold;
  await ChatMessage.create({
    content: `<div class="crows village-avail ${available ? "yes" : "no"}">
      <strong>${itemName}</strong> availability: 1d100=${roll.total} vs ${threshold}+ → ${available ? "<strong>available</strong>" : "<em>out of stock</em>"}
    </div>`,
    speaker: { alias: "Village" }
  });
  return { available, roll: roll.total, threshold };
}

/**
 * End the village cycle: if no upgrade happened, Prosperity -= 1.
 * Then roll a village event (d10 + Prosperity).
 * Resets `hasUpgradedThisCycle` to false for the new cycle.
 */
export async function endCycle({ skipEvent = false } = {}) {
  const v = getVillage();
  const prevProsp = v.prosperity;
  let prosperityDelta = 0;
  if (!v.hasUpgradedThisCycle) {
    v.prosperity = Math.max(PROSPERITY_MIN, v.prosperity - 1);
    prosperityDelta = v.prosperity - prevProsp;
  }
  v.cycle = (v.cycle ?? 0) + 1;
  v.hasUpgradedThisCycle = false;

  // Roll the event.
  let event = null;
  if (!skipEvent) {
    const eventResult = await rollVillageEvent({ silent: true });
    event = eventResult.event;
    v.pendingEvent = { rolled: eventResult.rolled, total: eventResult.total, event };
  }
  await _save(v);

  const eventBlock = event
    ? `<div><strong>Event:</strong> d10=${v.pendingEvent.rolled} + Prosperity ${prevProsp} = <strong>${v.pendingEvent.total}</strong></div>
       <div class="ve-text">${event.text}</div>`
    : `<div><em>Event skipped.</em></div>`;
  await ChatMessage.create({
    content: `<div class="crows village-endcycle">
      <header><strong>End of Cycle ${v.cycle - 1} — entering Cycle ${v.cycle}</strong></header>
      <div>Prosperity: ${prevProsp}${prosperityDelta !== 0 ? ` → <strong>${v.prosperity}</strong> (no upgrade this cycle)` : ` (unchanged)`}</div>
      ${eventBlock}
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, cycle: v.cycle, prosperity: v.prosperity, event };
}

/**
 * Village Event table (Rules p.5729). 20 buckets indexed by d10 + Prosperity.
 * Clamped to [-9, 20]; negative is bad, positive is good.
 */
const VILLAGE_EVENTS = {
  "-9": { id: "monsterDestroy", text: "A monster attack destroys an institution." },
  "-8": { id: "monsterDamage2", text: "A monster attack seriously damages two institutions. Each loses 1 level; 1st-level ones are destroyed instead." },
  "-7": { id: "banditRaid",     text: "Bandits raid an institution. Its level decreases by 1; if 1st level, it is destroyed." },
  "-6": { id: "monsterLossPop", text: "A monster attack leaves many dead. Prosperity -1; if already -10, an institution is destroyed." },
  "-5": { id: "blameCrows",     text: "Villagers blame the crows. Until they found a new institution, no one in the village does business with them." },
  "-4": { id: "quartersRaided", text: "A PC's quarters are vandalized. One mundane item in storage or possession is destroyed." },
  "-3": { id: "recession",      text: "Slight recession: items sold to institutions have their sale percentage reduced by 5%." },
  "-2": { id: "stewardMurder",  text: "An institution's steward is murdered. That institution ceases operations next cycle (not a retired PC)." },
  "-1": { id: "artisanVandal",  text: "Villagers vandalize an artisan institution. Next cycle it can't craft or sell tools/materials." },
  "0":  { id: "merchRob30",     text: "A merchant institution is devastatingly robbed. Its item availability decreases by 30% next cycle." },
  "1":  { id: "merchThefts",    text: "A merchant institution suffers small thefts. Item availability decreases by 10% next cycle." },
  "3":  { id: "merchLowStock",  text: "A merchant institution is low on supplies. Item availability decreases by 5% next cycle." },
  "5":  { id: "merchLowAffluent", text: "A merchant institution is low on stock but can afford more. Availability -5%; sale percentage +5%." },
  "7":  { id: "merchSurplus5",  text: "A merchant institution has a small surplus. Item availability increases by 5% next cycle." },
  "9":  { id: "rations6",       text: "Grateful villagers supply the PCs with 6 rations each for their next outing." },
  "11": { id: "merchSurplus10", text: "A merchant institution has a surplus. Item availability increases by 10% next cycle." },
  "12": { id: "credit100",      text: "A merchant institution rewards the PCs: each PC has 100 gc of credit at it (expires end of cycle)." },
  "13": { id: "rushCrafting",   text: "An artisan institution hires help: makes two crafting rolls per day toward each item it crafts next cycle." },
  "14": { id: "healPotions",    text: "Grateful villagers buy each PC a healing potion." },
  "15": { id: "boom5",          text: "Slight economic boom: all items sold to institutions have their sale percentage increased by 5%." },
  "16": { id: "festival",       text: "A merchant festival! Availability of all merchant items increases by 5%." },
  "17": { id: "abnormalGrowth", text: "Abnormally prosperous cycle: Prosperity +1; if already 10, availability of all merchant items increases by 10% next cycle." },
  "18": { id: "credit500",      text: "A merchant institution rewards the PCs: each PC has 500 gc of credit at it (expires end of cycle)." },
  "19": { id: "instGrowth",     text: "An institution with level < 5 had a profitable cycle. Its level increases by 1." },
  "20": { id: "foundQuery",     text: "Villagers with money to spare want to found an institution and ask the PCs what to build." }
};

/** Roll a village event. Returns the event entry, with rolled/total. */
export async function rollVillageEvent({ silent = false } = {}) {
  const v = getVillage();
  const r = await new Roll("1d10").evaluate();
  const total = Math.max(-9, Math.min(20, r.total + (v.prosperity ?? 0)));
  // Bucket lookup: pick the highest defined key ≤ total.
  let key = -9;
  for (const k of Object.keys(VILLAGE_EVENTS).map(Number).sort((a,b) => a - b)) {
    if (k <= total) key = k;
  }
  const event = VILLAGE_EVENTS[key];
  if (!silent) {
    await ChatMessage.create({
      content: `<div class="crows village-event">
        <header><strong>Village Event</strong> — d10=${r.total} + Prosperity ${v.prosperity} = <strong>${total}</strong> (bucket ${key})</header>
        <div>${event.text}</div>
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return { ok: true, rolled: r.total, total, key, event };
}

/**
 * Get the level of an institution by type. Used by the Crypt module so
 * its level is sourced from the Village when one exists, otherwise falls
 * back to the standalone crows.cryptLevel setting.
 */
export function getInstitutionLevel(type) {
  const v = getVillage();
  const inst = v.institutions?.find(i => i.type === type);
  return inst?.level ?? 0;
}

/** Resolve an institution by id. */
export function getInstitution(id) {
  const v = getVillage();
  return v.institutions?.find(i => i.id === id) ?? null;
}
