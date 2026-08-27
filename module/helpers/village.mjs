/**
 * Village — prosperity, cycles, trade, and the twelve institutions.
 *
 * Playtest 2 rewrite. Citations use the `C:` line prefix into the Characters
 * book (`02 Crows Characters Book for Playtest 2.md`); the village chapter
 * runs C:2219-2678. Every number below was read off that text, not carried over
 * from Playtest 1 — the level counts changed and the PT1 registry contained
 * four institutions (herbalist, market, mageGuild, scriptorium) that do not
 * exist and was missing three that do (alchemist, auctionHouse, stables).
 *
 * ## The three things that changed shape, not just value
 *
 * 1. **Availability is no longer a roll.** MCDM changelog: *"You no longer
 *    roll for availability of items at most institutions. Item availability
 *    is now entirely dependent on the merchant institution's level, save for
 *    some items at the auction house."* `rollAvailability()` is DELETED.
 *    `itemAvailability()` replaces it and is a pure function of level —
 *    except for the auction house, whose advancement table (C:2394-2400) is
 *    literally a column of percentages, so it returns a chance instead of a
 *    verdict. That exception is the changelog's, not ours; see
 *    `AVAILABILITY_IS_A_ROLL`.
 *
 * 2. **Village events move effective LEVEL, not availability percentages.**
 *    C:2323 "their level decreases by 3 until the end of the cycle", C:2327
 *    "treat them as 1 level higher", C:2334 "treat each merchant institution
 *    as 1 level higher". A merchant reduced to level 0 is *closed*, which is
 *    a state PT1 could not express.
 *
 * 3. **Founding and upgrading are deferred.** C:2350 / C:2353 — you pay now,
 *    it opens at its new level at the *start of the next cycle*. Prosperity,
 *    by contrast, rises immediately (C:2261). So an institution carries both
 *    an operating `level` and a paid-for `pendingLevel`.
 *
 * The pure half of this file (tables, level maths, event lookup, prosperity
 * arithmetic) touches no Foundry global and is what `test/village.test.mjs`
 * exercises. The `game.settings` / `ChatMessage` half sits below it.
 */

const NS = "crows";
const KEY_VILLAGE = "village";

/**
 * Village state is a world setting, not a Document with Foundry's clone and
 * revision machinery.  Keep the copy/fingerprint helpers local to this
 * boundary so every caller gets the same ownership semantics.  JSON is used
 * only for the operation fingerprint (the setting itself is cloned with
 * Foundry's utility when it exists); sorting object keys makes a retry token
 * insensitive to property insertion order while preserving array order.
 */
function cloneValue(value) {
  if (value === undefined) return undefined;
  try {
    if (typeof globalThis.foundry?.utils?.deepClone === "function") {
      return globalThis.foundry.utils.deepClone(value);
    }
  } catch { /* fall through to the platform-neutral clone */ }
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function randomToken(length = 16) {
  try {
    const token = globalThis.foundry?.utils?.randomID?.(length);
    if (token) return String(token);
  } catch { /* a test shim may expose no randomID */ }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

function newVillageIdentity() {
  return {
    villageId: `village-${randomToken(16)}`,
    sceneSeed: randomToken(24)
  };
}

function stableFingerprintValue(value) {
  if (value === undefined) return "__undefined__";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableFingerprintValue);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableFingerprintValue(value[key])]));
}

/** Stable, order-insensitive input token for the Village operation journal. */
export function villageInputFingerprint(value) {
  return JSON.stringify(stableFingerprintValue(value));
}

// A setting read may occur before the first designated-writer migration.  A
// process-local fallback prevents repeated reads of a legacy/absent setting
// from inventing a new identity, but it is never treated as durable until a
// successful Village write persists it.
let fallbackVillageRecord = null;
let legacyIdentity = null;

export const PROSPERITY_MIN = -10;          // C:2265
export const PROSPERITY_MAX = 10;           // C:2261
export const CYCLE_DAYS = 10;               // C:2251
export const SPEND_FOR_PROSPERITY = 10000;  // C:2261 — 10,000 gc in a cycle -> +1
export const FOUND_VILLAGE_PRICE = 15000;   // C:2676
export const FOUND_VILLAGE_DAYS = 10;       // C:2676
export const RETIREMENT_TXP = 60000;        // C:2656
export const RETIREMENT_TXP_TWO_BENEFITS = 100000; // C:2658

/* -------------------------------------------------------------------------- */
/*  Institutions (C:2342-2646)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The twelve institutions.
 *
 * `advancement` is the institution's own advancement table, one row per level,
 * in level order. `price` is the cost to REACH that level, so row 0 (1st level)
 * always has `price: null` — you reach 1st level by founding, not upgrading.
 * The number of rows IS the institution's level count, which is the thing the
 * changelog says changed and the thing `test/village.test.mjs` pins.
 *
 * `prosperity10` is the institution's capstone: every one of them has a perk
 * that needs both a specific level AND village Prosperity 10. For the crypt and
 * the temple that perk is literally "count as one level higher"; for everyone
 * else it is a named service. Modelling it as a level bump for all twelve would
 * be wrong, so `effectiveLevel` is present only where the text says it.
 */
export const INSTITUTIONS = Object.freeze({
  alchemist: Object.freeze({
    key: "alchemist", label: "Alchemist",
    source: "C:2357", foundingPrice: 3000,
    roles: Object.freeze(["artisan", "merchant"]),
    // C:2361 — crafting rolls at a bonus equal to level; C:2368 workshop, 5 gc/day.
    craftsExpertises: Object.freeze(["alchemy"]),
    workshop: Object.freeze({ pricePerDay: 5, expertises: Object.freeze(["alchemy"]) }),
    // C:2365 — availability by the number of Alchemy uses needed to craft the item.
    availability: Object.freeze({ axis: "expertiseUses", expertise: "alchemy" }),
    advancement: Object.freeze([                                   // C:2373-2378
      Object.freeze({ level: 1, price: null, expertiseUses: 1 }),
      Object.freeze({ level: 2, price: 1500, expertiseUses: 2 }),
      Object.freeze({ level: 3, price: 3000, expertiseUses: 3 }),
      Object.freeze({ level: 4, price: 6000, expertiseUses: 4 })
    ]),
    prosperity10: Object.freeze({ atLevel: 4, id: "loyaltyHealthPotions", source: "C:2369",
      text: "The first time each cycle you buy something, they give you a free healing potion." })
  }),

  auctionHouse: Object.freeze({
    key: "auctionHouse", label: "Auction House",
    source: "C:2382", foundingPrice: 2000,
    roles: Object.freeze(["merchant"]),
    // C:2394-2400 — the ONE institution whose availability is still a percentage.
    // C:2387/C:2389 cover its valued-item and sell-anything services.
    availability: Object.freeze({ axis: "percentChance", kinds: Object.freeze(["valued", "unique"]) }),
    sellsMonsterParts: false,                                      // changelog
    advancement: Object.freeze([                                   // C:2394-2400
      Object.freeze({ level: 1, price: null, valued: 15, unique: 5 }),
      Object.freeze({ level: 2, price: 500, valued: 20, unique: 10 }),
      Object.freeze({ level: 3, price: 1000, valued: 25, unique: 15 }),
      Object.freeze({ level: 4, price: 2000, valued: 30, unique: 20 }),
      Object.freeze({ level: 5, price: 4000, valued: 35, unique: 25 })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "highRollerAuction", source: "C:2390",
      text: "Once per cycle, an item that would sell for under 80% of its sale price sells for 80% instead." })
  }),

  barracks: Object.freeze({
    key: "barracks", label: "Barracks",
    source: "C:2404", foundingPrice: 3000,                         // NEW in Playtest 2
    roles: Object.freeze(["merchant"]),
    // C:2414-2420 — maximum POWER of a hireling you can hire here.
    availability: Object.freeze({ axis: "maxPower" }),
    advancement: Object.freeze([                                   // C:2414-2420
      Object.freeze({ level: 1, price: null, maxPower: 2 }),
      Object.freeze({ level: 2, price: 750, maxPower: 4 }),
      Object.freeze({ level: 3, price: 1500, maxPower: 6 }),
      Object.freeze({ level: 4, price: 3000, maxPower: 8 }),
      Object.freeze({ level: 5, price: 6000, maxPower: 10 })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "provisions", source: "C:2410",
      text: "Each hireling you hire arrives with an additional 12 rations." })
  }),

  beacon: Object.freeze({
    key: "beacon", label: "Beacon",
    source: "C:2424", foundingPrice: 4000,                         // NEW in Playtest 2
    roles: Object.freeze(["merchant"]),
    // C:2430 — the village hex and every hex within the radius is free of Miasma.
    availability: Object.freeze({ axis: "hexRadius" }),
    transportCostPerHex: 100,                                      // C:2433
    transportCapacity: 5,                                          // C:2433 — you + 4 others
    advancement: Object.freeze([                                   // C:2440-2446
      Object.freeze({ level: 1, price: null, hexRadius: 1 }),
      Object.freeze({ level: 2, price: 1500, hexRadius: 2 }),
      Object.freeze({ level: 3, price: 3000, hexRadius: 3 }),
      Object.freeze({ level: 4, price: 6000, hexRadius: 4 }),
      Object.freeze({ level: 5, price: 12000, hexRadius: 5 })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "burnBright", source: "C:2436",
      hexRadius: 6, text: "The fire's effective radius is 6 hexes." })
  }),

  blacksmith: Object.freeze({
    key: "blacksmith", label: "Blacksmith",
    source: "C:2450", foundingPrice: 3000,
    roles: Object.freeze(["artisan", "merchant"]),
    craftsExpertises: Object.freeze(["blacksmithing"]),            // C:2454
    workshop: Object.freeze({ pricePerDay: 5, expertises: Object.freeze(["blacksmithing"]) }), // C:2462
    // C:2458 — TWO axes: blacksmithing items, and magic arms/armour by enchanting
    // uses. The enchanting column starts one level late, which is why it is a
    // separate number and not `level` reused.
    availability: Object.freeze({ axis: "expertiseUses", expertise: "blacksmithing", alsoStocks: Object.freeze(["enchanting"]) }),
    sellsCraftingMaterials: true,                                  // C:2459
    advancement: Object.freeze([                                   // C:2467-2472
      Object.freeze({ level: 1, price: null, expertiseUses: 1, enchantingUses: 0 }),
      Object.freeze({ level: 2, price: 1500, expertiseUses: 2, enchantingUses: 1 }),
      Object.freeze({ level: 3, price: 3000, expertiseUses: 3, enchantingUses: 2 }),
      Object.freeze({ level: 4, price: 6000, expertiseUses: 4, enchantingUses: 3 })
    ]),
    prosperity10: Object.freeze({ atLevel: 4, id: "honeWeapon", source: "C:2463",
      text: "Hone a non-unarmed weapon for 500 gc: +1 damage, lost on a doom." })
  }),

  bookseller: Object.freeze({
    key: "bookseller", label: "Bookseller",
    source: "C:2476", foundingPrice: 3000,
    roles: Object.freeze(["merchant"]),
    availability: Object.freeze({ axis: "spellRank" }),            // C:2481
    advancement: Object.freeze([                                   // C:2487-2494
      Object.freeze({ level: 1, price: null, spellRank: 0 }),
      Object.freeze({ level: 2, price: 750, spellRank: 1 }),
      Object.freeze({ level: 3, price: 1500, spellRank: 2 }),
      Object.freeze({ level: 4, price: 3000, spellRank: 3 }),
      Object.freeze({ level: 5, price: 6000, spellRank: 4 }),
      Object.freeze({ level: 6, price: 12000, spellRank: 5 })
    ]),
    prosperity10: Object.freeze({ atLevel: 6, id: "readALittleLonger", source: "C:2483",
      text: "250 gc buys a spellbook +1 UD until it expires; does not return on a rest." })
  }),

  crypt: Object.freeze({
    key: "crypt", label: "Crypt",
    source: "C:2498", foundingPrice: 2000,
    roles: Object.freeze([]),                                      // neither merchant nor artisan
    advancement: Object.freeze([                                   // C:2521-2527
      Object.freeze({ level: 1, price: null }),
      Object.freeze({ level: 2, price: 500 }),
      Object.freeze({ level: 3, price: 1000 }),
      Object.freeze({ level: 4, price: 2000 }),
      Object.freeze({ level: 5, price: 4000 })
    ]),
    // C:2517 — "considered 6th level for boon effects". A real level bump.
    prosperity10: Object.freeze({ atLevel: 5, id: "sixthForBoons", source: "C:2517",
      effectiveLevel: 6, text: "Counts as 6th level for boon effects." })
  }),

  enchanter: Object.freeze({
    key: "enchanter", label: "Enchanter",
    source: "C:2531", foundingPrice: 3000,
    roles: Object.freeze(["artisan", "merchant"]),
    craftsExpertises: Object.freeze(["enchanting"]),               // C:2535
    workshop: Object.freeze({ pricePerDay: 5, expertises: Object.freeze(["enchanting"]) }), // C:2541
    availability: Object.freeze({ axis: "expertiseUses", expertise: "enchanting" }), // C:2539
    advancement: Object.freeze([                                   // C:2546-2551
      Object.freeze({ level: 1, price: null, expertiseUses: 1 }),
      Object.freeze({ level: 2, price: 1500, expertiseUses: 2 }),
      Object.freeze({ level: 3, price: 3000, expertiseUses: 3 }),
      Object.freeze({ level: 4, price: 6000, expertiseUses: 4 })
    ]),
    prosperity10: Object.freeze({ atLevel: 4, id: "ward", source: "C:2542",
      text: "500 gc buys a creature a personal ward: 10 AD until removed by damage." })
  }),

  generalStore: Object.freeze({
    key: "generalStore", label: "General Store",
    source: "C:2555", foundingPrice: 1000,
    roles: Object.freeze(["merchant"]),
    availability: Object.freeze({ axis: "quality" }),              // C:2560
    advancement: Object.freeze([                                   // C:2565-2569
      Object.freeze({ level: 1, price: null, quality: "standard" }),
      Object.freeze({ level: 2, price: 1500, quality: "fine" }),
      Object.freeze({ level: 3, price: 3000, quality: "masterwork" })
    ]),
    prosperity10: Object.freeze({ atLevel: 3, id: "buyThreeGetOne", source: "C:2561",
      text: "Buy 3 rations, oil pints, or torches of any quality and get a 4th free." })
  }),

  inn: Object.freeze({
    key: "inn", label: "Inn",
    source: "C:2573", foundingPrice: 1000,
    roles: Object.freeze(["merchant"]),
    nightlyRate: 5,                                                // C:2577
    availability: Object.freeze({ axis: "maxBet" }),               // C:2580
    advancement: Object.freeze([                                   // C:2589-2595
      Object.freeze({ level: 1, price: null, maxBetBase: 15 }),
      Object.freeze({ level: 2, price: 250, maxBetBase: 25 }),
      Object.freeze({ level: 3, price: 500, maxBetBase: 35 }),
      Object.freeze({ level: 4, price: 1000, maxBetBase: 45 }),
      Object.freeze({ level: 5, price: 2000, maxBetBase: 60 })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "findItHere", source: "C:2585",
      text: "Once per cycle, buy any priced item from a travelling merchant at +25% cost." })
  }),

  stables: Object.freeze({
    key: "stables", label: "Stables",
    source: "C:2599", foundingPrice: 2000,
    roles: Object.freeze(["merchant"]),
    availability: Object.freeze({ axis: "maxPower" }),             // C:2604 — pets by power
    advancement: Object.freeze([                                   // C:2612-2618
      Object.freeze({ level: 1, price: null, maxPower: 2 }),
      Object.freeze({ level: 2, price: 750, maxPower: 4 }),
      Object.freeze({ level: 3, price: 1500, maxPower: 6 }),
      Object.freeze({ level: 4, price: 3000, maxPower: 8 }),
      Object.freeze({ level: 5, price: 6000, maxPower: 10 })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "buyThreeGetOneFeed", source: "C:2608",
      text: "Buy 3 days of animal feed and get a 4th free." })
  }),

  temple: Object.freeze({
    key: "temple", label: "Temple",
    source: "C:2622", foundingPrice: 2000,
    // C:2626 — the temple is an ARTISAN now. It crafts alchemy, blacksmithing
    // AND enchanting items, the only institution that spans all three, and it
    // no longer sells crafting materials (changelog).
    roles: Object.freeze(["artisan", "merchant"]),
    craftsExpertises: Object.freeze(["alchemy", "blacksmithing", "enchanting"]),
    workshop: null,                                                // no rentable workshop
    sellsCraftingMaterials: false,                                 // changelog
    // The one merchant with NO availability axis: it stocks no catalogue. Its
    // services scale off the level directly — wounds healed (C:2632), blessing
    // days (C:2633), how far back Prayer of Returning reaches (C:2634) — so
    // there is nothing for an availability lookup to gate.
    availability: null,
    // C:2639-2646 — SIX rows, but the 6th has no price. It exists only so the
    // Higher Authority capstone has a row to point at; you cannot buy it.
    advancement: Object.freeze([
      Object.freeze({ level: 1, price: null }),
      Object.freeze({ level: 2, price: 500 }),
      Object.freeze({ level: 3, price: 1000 }),
      Object.freeze({ level: 4, price: 2000 }),
      Object.freeze({ level: 5, price: 4000 }),
      Object.freeze({ level: 6, price: null })
    ]),
    prosperity10: Object.freeze({ atLevel: 5, id: "higherAuthority", source: "C:2635",
      effectiveLevel: 6, text: "Counts as 6th level for its services." })
  })
});

export const INSTITUTION_KEYS = Object.freeze(Object.keys(INSTITUTIONS));

/** key -> display label. Retained under its PT1 name; several sheets import it. */
export const INSTITUTION_TYPES = Object.freeze(
  Object.fromEntries(INSTITUTION_KEYS.map(k => [k, INSTITUTIONS[k].label]))
);

/**
 * C:2232 — "your village institutions include a blacksmith, crypt, general
 * store, inn, and temple. As a group, choose one other institution already
 * established in your village. All these institutions are 1st level."
 *
 * The chosen sixth is a player decision, so it is NOT seeded here.
 */
export const STARTING_INSTITUTIONS = Object.freeze(["blacksmith", "crypt", "generalStore", "inn", "temple"]);
export const STARTING_INSTITUTION_CHOICES = 1;

/** Institutions that can craft for you (C:2303). */
export const ARTISANS = Object.freeze(INSTITUTION_KEYS.filter(k => INSTITUTIONS[k].roles.includes("artisan")));
/** Institutions that buy and sell (C:2277). */
export const MERCHANTS = Object.freeze(INSTITUTION_KEYS.filter(k => INSTITUTIONS[k].roles.includes("merchant")));

/**
 * The single surviving availability ROLL. Everything else is a level lookup.
 * Exported so a test can assert the exception is exactly one institution wide,
 * rather than leaving "most institutions" as prose nobody can check.
 */
export const AVAILABILITY_IS_A_ROLL = Object.freeze(["auctionHouse"]);

export function institutionDef(key) {
  return INSTITUTIONS[key] ?? null;
}

/** Number of rows on the institution's advancement table. */
export function institutionMaxLevel(key) {
  return INSTITUTIONS[key]?.advancement.length ?? 0;
}

/**
 * The highest level you can actually BUY. Differs from `institutionMaxLevel`
 * only for the temple, whose 6th row exists but has no price (C:2646) — pay
 * for it and you would be paying `null` gc for a level the rules only grant
 * through Prosperity.
 */
export function institutionPurchasableMaxLevel(key) {
  const rows = INSTITUTIONS[key]?.advancement ?? [];
  let max = 0;
  for (const row of rows) {
    if (row.level === 1 || row.price != null) max = row.level;
    else break;
  }
  return max;
}

/** Cost to upgrade INTO `level`. `null` when that level is not purchasable. */
export function upgradePrice(key, level, institution = null) {
  if (key && typeof key === "object") {
    institution = key;
    key = institution.type ?? institution.key;
    level = level ?? institution.pendingLevel ?? institution.level;
  }
  if (institution?.destroyed) return null;
  const target = Math.floor(Number(level));
  return INSTITUTIONS[key]?.advancement.find(r => r.level === target)?.price ?? null;
}

/** Cost to establish the institution (C:2350). */
export function foundingPrice(key) {
  return INSTITUTIONS[key]?.foundingPrice ?? null;
}

/** The advancement row for a level, clamped to the table's ends. */
export function advancementRow(key, level) {
  const rows = INSTITUTIONS[key]?.advancement;
  if (!rows?.length) return null;
  const n = Math.max(1, Math.min(rows.length, Math.floor(Number(level) || 1)));
  return rows[n - 1];
}

/* -------------------------------------------------------------------------- */
/*  Effective level                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What level does this institution actually operate at right now?
 *
 * Three things move it, and they compose in this order:
 *
 *   1. `pendingLevel` — paid for, but only live from `pendingFromCycle`
 *      (C:2353). Before that cycle the institution still runs at `level`.
 *   2. event modifiers — C:2323 (-3), C:2324 (-1), C:2327 (+1), C:2329 (+2),
 *      C:2334 (festival, +1 to every merchant). These are cycle-scoped deltas.
 *   3. the Prosperity-10 capstone, but ONLY for the crypt and the temple,
 *      which are the two whose text says "considered 6th level" (C:2517,
 *      C:2635). It is a floor, not a delta — a temple already pushed to 6 by
 *      a festival does not become 7.
 *
 * Dropping to 0 or below is *closed for business*, not level 1 (C:2323).
 * Rising above the table's last row is legal and left unclamped — a festival
 * on a maxed merchant is meant to do something — but flagged via
 * `aboveTableMax` so an availability lookup knows it is off the end.
 */
export function effectiveInstitutionLevel(inst, { prosperity = 0, cycle = null, modifiers = [] } = {}) {
  const key = inst?.type ?? inst?.key;
  const def = INSTITUTIONS[key];
  if (!def) return { ok: false, error: `unknown institution: ${key}`, level: 0, closed: true };

  // (1) paid-for level, if its cycle has arrived.
  let base = Math.max(0, Math.floor(Number(inst.level) || 0));

  // Destruction is deliberately represented as a tombstone in the durable
  // record.  It remains addressable by id for ruins/map reconciliation, but a
  // type/service read must never accidentally revive it through its old level.
  if (inst?.destroyed) {
    return {
      ok: true,
      base,
      level: 0,
      closed: true,
      destroyed: true,
      notYetOpen: false,
      modifierDelta: 0,
      capstoneActive: false,
      aboveTableMax: false
    };
  }

  if (inst.pendingLevel != null && cycle != null && cycle >= (inst.pendingFromCycle ?? Infinity)) {
    base = Math.max(base, Math.floor(Number(inst.pendingLevel) || 0));
  }

  // Not yet open at all (C:2350 — founding does not start operating until the
  // next cycle). `operatingFromCycle` is set when the institution is founded.
  const notYetOpen = cycle != null && inst.operatingFromCycle != null && cycle < inst.operatingFromCycle;

  // (2) cycle-scoped event modifiers.
  const delta = modifiers.reduce((sum, m) => sum + (Math.floor(Number(m?.delta ?? m)) || 0), 0);
  let level = base + delta;

  // (3) the Prosperity-10 floor, where the text grants one.
  const capstone = def.prosperity10;
  const capstoneActive = !!capstone?.effectiveLevel
    && prosperity >= PROSPERITY_MAX
    && base >= capstone.atLevel;
  if (capstoneActive) level = Math.max(level, capstone.effectiveLevel);

  const closed = notYetOpen || level <= 0;
  return {
    ok: true,
    base,
    level: closed ? 0 : level,
    closed,
    notYetOpen,
    modifierDelta: delta,
    capstoneActive,
    aboveTableMax: !closed && level > def.advancement.length
  };
}

/** Is the institution's Prosperity-10 capstone perk live? (C:2369 and kin.) */
export function capstoneActive(key, level, prosperity) {
  const c = INSTITUTIONS[key]?.prosperity10;
  if (!c) return false;
  return prosperity >= PROSPERITY_MAX && level >= c.atLevel;
}

/* -------------------------------------------------------------------------- */
/*  Availability — a level lookup, not a roll                                  */
/* -------------------------------------------------------------------------- */

const QUALITY_ORDER = ["standard", "fine", "masterwork"];   // C:2565-2569

/**
 * Can you buy this from that institution at that level?
 *
 * Returns one of two shapes, and the difference is the whole point:
 *
 *   { deterministic: true,  available: boolean }   — every merchant but one
 *   { deterministic: false, chancePercent: n }     — the auction house (C:2394-2400)
 *
 * A caller that treats the second as the first will silently sell unique
 * artefacts over the counter, so the shape is discriminated rather than
 * collapsed into a boolean with a hidden roll inside.
 *
 * `criteria` keys by axis:
 *   expertiseUses  { uses, expertise? }   alchemist, blacksmith, enchanter
 *   spellRank      { rank }               bookseller
 *   quality        { quality }            generalStore
 *   maxPower       { power }              barracks, stables
 *   maxBet         { bet, prosperity? }   inn
 *   hexRadius      { hexes }              beacon
 *   percentChance  { kind }               auctionHouse
 */
export function itemAvailability(key, level, criteria = {}) {
  // Pure callers normally pass an effective numeric level.  Accepting an
  // optional record here keeps a tombstoned institution from being treated as
  // live by a browse/service caller that already has the durable record in
  // hand; id-based lookup still remains available for ruin rendering.
  let record = (key && typeof key === "object" ? key : null)
    ?? criteria?.institutionRecord ?? criteria?.institution ?? null;
  if (key && typeof key === "object") key = key.type ?? key.key;
  if (level && typeof level === "object") {
    record ??= level;
    level = level.level;
  }
  if (record?.destroyed) {
    return { ok: true, deterministic: true, available: false, closed: true, destroyed: true };
  }
  if (record?.type && (key == null || typeof key !== "string")) key = record.type;
  if (record && level == null) level = record.level;
  const def = INSTITUTIONS[key];
  if (!def) return { ok: false, error: `unknown institution: ${key}` };
  const axis = def.availability?.axis;
  if (!axis) return { ok: false, error: `${def.label} stocks no catalogue to check availability against` };

  const lvl = Math.floor(Number(level) || 0);
  if (lvl <= 0) return { ok: true, deterministic: true, available: false, closed: true };

  // Above the last row, the last row's allowance is the best the table offers.
  const row = advancementRow(key, lvl);

  switch (axis) {
    case "expertiseUses": {
      const uses = Math.floor(Number(criteria.uses) || 0);
      // The blacksmith stocks magic arms and armour on a SECOND, later-starting
      // column (C:2458/C:2470): 1 enchanting use only from 2nd level.
      const wantsAlt = criteria.expertise && criteria.expertise !== def.availability.expertise;
      if (wantsAlt) {
        if (!def.availability.alsoStocks?.includes(criteria.expertise)) {
          return { ok: true, deterministic: true, available: false, reason: "not stocked here" };
        }
        const allowed = row.enchantingUses ?? 0;
        return { ok: true, deterministic: true, available: uses > 0 && uses <= allowed, allowed };
      }
      const allowed = row.expertiseUses ?? 0;
      return { ok: true, deterministic: true, available: uses > 0 && uses <= allowed, allowed };
    }
    case "spellRank": {
      const rank = Math.floor(Number(criteria.rank) || 0);
      const allowed = row.spellRank ?? 0;
      return { ok: true, deterministic: true, available: rank <= allowed, allowed };
    }
    case "quality": {
      const want = QUALITY_ORDER.indexOf(String(criteria.quality ?? "standard"));
      const allowed = QUALITY_ORDER.indexOf(row.quality);
      return { ok: true, deterministic: true, available: want >= 0 && want <= allowed, allowed: row.quality };
    }
    case "maxPower": {
      const power = Math.floor(Number(criteria.power) || 0);
      const allowed = row.maxPower ?? 0;
      return { ok: true, deterministic: true, available: power <= allowed, allowed };
    }
    case "maxBet": {
      // C:2591 — "15 + Prosperity gc". Minimum bet is 1 gc (C:2580).
      const prosperity = Math.floor(Number(criteria.prosperity) || 0);
      const allowed = (row.maxBetBase ?? 0) + prosperity;
      const bet = Math.floor(Number(criteria.bet) || 0);
      return { ok: true, deterministic: true, available: bet >= 1 && bet <= allowed, allowed };
    }
    case "hexRadius": {
      const hexes = Math.floor(Number(criteria.hexes) || 0);
      const allowed = capstoneActive(key, lvl, criteria.prosperity ?? 0)
        ? (def.prosperity10.hexRadius ?? row.hexRadius)
        : row.hexRadius;
      return { ok: true, deterministic: true, available: hexes <= allowed, allowed };
    }
    case "percentChance": {
      const kind = criteria.kind === "unique" ? "unique" : "valued";
      return { ok: true, deterministic: false, kind, chancePercent: row[kind] ?? 0 };
    }
    default:
      return { ok: false, error: `unhandled availability axis: ${axis}` };
  }
}

/** Maximum gamble at the inn (C:2589). Minimum bet is always 1 gc (C:2580). */
export function innMaxBet(level, prosperity = 0) {
  return (advancementRow("inn", level)?.maxBetBase ?? 0) + Math.floor(Number(prosperity) || 0);
}

/** Beacon Miasma-free radius in hexes (C:2440, C:2436). */
export function beaconRadius(level, prosperity = 0) {
  const row = advancementRow("beacon", level);
  if (!row) return 0;
  return capstoneActive("beacon", level, prosperity)
    ? INSTITUTIONS.beacon.prosperity10.hexRadius
    : row.hexRadius;
}

/** Beacon transport fee: hexes travelled x 100 gc, up to five creatures (C:2433). */
export function beaconTransportCost(hexes) {
  return Math.max(0, Math.floor(Number(hexes) || 0)) * INSTITUTIONS.beacon.transportCostPerHex;
}

/* -------------------------------------------------------------------------- */
/*  Trade                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Sale Percentages (C:2289-2299). Unchanged from PT1 in value; restated here
 * against the PT2 table so it is pinned rather than assumed.
 */
export function sellPercentage(prosperity = 0) {
  const p = Math.floor(Number(prosperity) || 0);
  if (p <= -10) return 30;
  if (p <= -6) return 40;
  if (p <= -2) return 45;
  if (p <= 1) return 50;
  if (p <= 5) return 55;
  if (p <= 9) return 60;
  return 70;
}

/**
 * Auction-house sale percentage (C:2389): `1d10 x (10 + Prosperity)%`.
 * Pure — takes the d10 rather than rolling it, so it is testable and so the
 * caller owns the dice. Once committed, the sale happens at whatever this
 * returns; buy-back is the price paid plus 10% of the item's value.
 */
export function auctionSalePercentage(d10, prosperity = 0) {
  return Math.max(0, Math.floor(Number(d10) || 0)) * (10 + Math.floor(Number(prosperity) || 0));
}

/** C:2389 — buy back what you auctioned for the hammer price + 10% of value. */
export function auctionBuybackPrice(soldFor, itemValue) {
  return Math.round((Number(soldFor) || 0) + 0.1 * (Number(itemValue) || 0));
}

/**
 * Auction-house price swing (C:2387): even -> discounted by 1d6 x 10%,
 * odd -> costs 1d6 x 10% more. Pure; the caller supplies both dice.
 */
export function auctionPriceMultiplier(anyDie, d6) {
  const swing = (Math.max(1, Math.floor(Number(d6) || 1)) * 10) / 100;
  const even = (Math.floor(Number(anyDie) || 0) % 2) === 0;
  return even ? 1 - swing : 1 + swing;
}

/* -------------------------------------------------------------------------- */
/*  Prosperity                                                                 */
/* -------------------------------------------------------------------------- */

export function clampProsperity(v) {
  return Math.max(PROSPERITY_MIN, Math.min(PROSPERITY_MAX, Math.floor(Number(v) || 0)));
}

/**
 * C:2261 — "If you spend at least 10,000 gc in a village during a cycle on
 * goods from merchant institutions, the village's prosperity increases by 1."
 *
 * "at least ... during a cycle" is a per-cycle threshold crossing, not a
 * repeating tick: 25,000 gc in one cycle raises Prosperity by 1, not by 2.
 * Tracked as a running total that resets at end of cycle, and a latch so the
 * bonus cannot be re-awarded by spending more in the same cycle.
 */
export function recordMerchantSpend(village, amount) {
  const gc = Math.max(0, Math.floor(Number(amount) || 0));
  const before = Math.max(0, Math.floor(Number(village.spentThisCycle) || 0));
  const after = before + gc;
  const crosses = !village.spendBonusAwarded && after >= SPEND_FOR_PROSPERITY;
  return {
    spentThisCycle: after,
    spendBonusAwarded: village.spendBonusAwarded || crosses,
    prosperityDelta: crosses ? 1 : 0
  };
}

/**
 * C:2265 — "When a village ends a cycle during which nothing occurred that
 * could raise its Prosperity, its Prosperity decreases by 1."
 *
 * NB "nothing that COULD raise it", not "Prosperity did not rise". A village
 * already at 10 that founded an institution is not penalised for the increase
 * having been clamped away.
 */
export function prosperityAtCycleEnd(prosperity, { raisingEventOccurred = false } = {}) {
  return raisingEventOccurred ? clampProsperity(prosperity) : clampProsperity(prosperity - 1);
}

/* -------------------------------------------------------------------------- */
/*  Village events (C:2312-2338)                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Playtest 2 Village Event table, rewritten in full. Playtest 1's version
 * of this table was a different table: it moved *availability percentages*,
 * which no longer exist. Every merchant entry here moves effective LEVEL.
 *
 * Buckets are `[min, max]` on `d10 + Prosperity`, which spans exactly -9..20
 * (d10 1-10, Prosperity -10..10) — the table has no gaps and needs no clamp,
 * though `villageEventFor` clamps anyway rather than returning undefined.
 *
 * `effect` is structured so `effectiveInstitutionLevel` and the trade helpers
 * can consume it without parsing prose. `scope: "all"` means every merchant.
 */
export const VILLAGE_EVENTS = Object.freeze([
  { min: -9, max: -9, id: "monsterDestroysInstitution", source: "C:2314",
    effect: { kind: "destroyInstitution", count: 1 },
    text: "A monster attack destroys an institution." },
  { min: -8, max: -8, id: "monsterDamagesTwo", source: "C:2315",
    effect: { kind: "institutionLevel", delta: -1, count: 2, duration: "permanent", destroyIfAllFirstLevel: true },
    text: "A monster attack seriously damages two institutions. Each level decreases by 1. If both are 1st level before the decrease, one is destroyed instead." },
  { min: -7, max: -7, id: "banditRaid", source: "C:2316",
    effect: { kind: "institutionLevel", delta: -1, count: 1, duration: "permanent", destroyIfFirstLevel: true },
    text: "Bandits raid an institution, killing members and stealing supplies. Its level decreases by 1; if it was 1st level, it is destroyed." },
  { min: -6, max: -6, id: "monsterAttackDead", source: "C:2317",
    effect: { kind: "prosperity", delta: -1, destroyInstitutionIfAtFloor: true },
    text: "A monster attack leaves many dead and homes destroyed. Prosperity decreases by 1; if already -10, an institution is destroyed instead." },
  { min: -5, max: -5, id: "villagersBlamePCs", source: "C:2318",
    effect: { kind: "boycott", clearedBy: "foundInstitution" },
    text: "Villagers blame the PCs for drawing monsters to the town. Until the PCs found a new institution, no one does business with them." },
  { min: -4, max: -4, id: "quartersVandalized", source: "C:2319",
    effect: { kind: "destroyItem", count: 1, itemClass: "mundane" },
    text: "A PC's quarters are broken into and vandalized. A mundane item in storage or their possession is destroyed." },
  { min: -3, max: -3, id: "recession", source: "C:2320",
    effect: { kind: "sellPercentage", delta: -5, duration: "cycle", scope: "all" },
    text: "A slight recession. Items sold to institutions have their sale percentage reduced by 5%." },
  { min: -2, max: -2, id: "stewardMurdered", source: "C:2321",
    effect: { kind: "ceaseOperations", count: 1, duration: "cycle", excludeRetiredPC: true },
    text: "An institution's steward is murdered. It ceases all operations for the next cycle. The murdered steward can't be a retired PC." },
  { min: -1, max: -1, id: "artisanVandalized", source: "C:2322",
    effect: { kind: "artisanShutdown", count: 1, duration: "cycle" },
    text: "Villagers vandalize an artisan institution. Next cycle it can't make crafting rolls or sell tools or crafting materials." },
  { min: 0, max: 0, id: "devastatingRobbery", source: "C:2323",
    effect: { kind: "merchantLevel", delta: -3, count: 1, duration: "cycle", closedAtZero: true },
    text: "A merchant institution suffers a devastating robbery. Its level decreases by 3 until the end of the cycle; if that takes it to 0, it is closed for business." },
  { min: 1, max: 2, id: "smallThefts", source: "C:2324",
    effect: { kind: "merchantLevel", delta: -1, count: 1, duration: "cycle", closedAtZero: true },
    text: "A merchant institution suffers small thefts. Its level decreases by 1 until the end of the cycle; if that takes it to 0, it is closed for business." },
  { min: 3, max: 4, id: "lowOnSupplies", source: "C:2325",
    effect: { kind: "outOfStockChance", percent: 30, count: 1, duration: "cycle" },
    text: "A merchant institution is low on supplies. There is a 30% chance any item you try to buy there is out of stock." },
  { min: 5, max: 6, id: "lowStockButAffluent", source: "C:2326",
    effect: { kind: "outOfStockChance", percent: 30, count: 1, duration: "cycle", sellPercentageDelta: 5 },
    text: "A merchant institution is low on stock but can afford more: as low on supplies, except the sale percentage of goods they buy increases by 5%." },
  { min: 7, max: 8, id: "smallSurplus", source: "C:2327",
    effect: { kind: "merchantLevel", delta: 1, count: 1, duration: "cycle" },
    text: "A merchant institution has a small surplus. Treat it as 1 level higher until the end of the cycle." },
  { min: 9, max: 10, id: "gratefulRations", source: "C:2328",
    effect: { kind: "grantItem", item: "ration", perPC: 6 },
    text: "Grateful villagers supply the PCs with 6 rations each for their next outing." },
  { min: 11, max: 11, id: "surplus", source: "C:2329",
    effect: { kind: "merchantLevel", delta: 2, count: 1, duration: "cycle" },
    text: "A merchant institution has a surplus. Treat it as 2 levels higher until the end of the cycle." },
  { min: 12, max: 12, id: "credit100", source: "C:2330",
    effect: { kind: "credit", perPC: 100, duration: "cycle", scope: "one" },
    text: "A merchant institution gives each PC 100 gc of credit, expiring at the end of the cycle." },
  { min: 13, max: 13, id: "artisanHiresHelp", source: "C:2331",
    effect: { kind: "craftingRollsPerDay", value: 2, count: 1, duration: "cycle" },
    text: "An artisan institution hires more help: it makes two crafting rolls a day toward each item it crafts next cycle." },
  { min: 14, max: 14, id: "healingPotions", source: "C:2332",
    effect: { kind: "grantItem", item: "healingPotion", perPC: 1 },
    text: "Grateful villagers buy a healing potion for each PC." },
  { min: 15, max: 15, id: "economicBoom", source: "C:2333",
    effect: { kind: "sellPercentage", delta: 5, duration: "cycle", scope: "all" },
    text: "A slight economic boom. All items sold to institutions have their sale percentage increased by 5%." },
  { min: 16, max: 16, id: "merchantFestival", source: "C:2334",
    effect: { kind: "merchantLevel", delta: 1, scope: "all", duration: "cycle" },
    text: "A merchant festival! Treat EVERY merchant institution as 1 level higher until the end of the cycle." },
  { min: 17, max: 17, id: "prosperousCycle", source: "C:2335",
    effect: { kind: "prosperity", delta: 1, atCapInstead: { kind: "sellPercentage", delta: 10, duration: "cycle", scope: "all" } },
    text: "An abnormally prosperous cycle. Prosperity increases by 1; if already 10, sale percentages increase by 10% next cycle instead." },
  { min: 18, max: 18, id: "credit500", source: "C:2336",
    effect: { kind: "credit", perPC: 500, duration: "cycle", scope: "one" },
    text: "A merchant institution gives each PC 500 gc of credit, expiring at the end of the cycle." },
  { min: 19, max: 19, id: "profitableCycle", source: "C:2337",
    effect: { kind: "institutionLevel", delta: 1, count: 1, duration: "permanent", onlyBelowLevel: 5 },
    text: "An institution below 5th level had an extremely profitable cycle. Its level increases by 1." },
  { min: 20, max: 20, id: "villagersFound", source: "C:2338",
    effect: { kind: "foundInstitution", chosenBy: "pcs" },
    text: "Villagers with money to spare found an institution the PCs suggest." }
]);

export const VILLAGE_EVENT_MIN = -9;
export const VILLAGE_EVENT_MAX = 20;

/** Look up the event for a `d10 + Prosperity` total. Clamped to the table. */
export function villageEventFor(total) {
  const t = Math.max(VILLAGE_EVENT_MIN, Math.min(VILLAGE_EVENT_MAX, Math.floor(Number(total) || 0)));
  return VILLAGE_EVENTS.find(e => t >= e.min && t <= e.max) ?? null;
}

/** Events that raise Prosperity or level, i.e. the good half of the table. */
export function eventIsBoon(event) {
  return !!event && event.min >= 3;
}

/**
 * The durable shape used by both the cycle writer and the Ref resolver.
 *
 * `id`/`eventId` and `selection`/`selections` are intentionally accepted as
 * aliases: the first Playtest 2 setting shape only stored `{id, rolled,
 * total}`.  Normalization is read-only; assigning a resolution token belongs
 * to a successful cycle/event write or to the Ref's first resolution attempt.
 */
function normalizePendingVillageEvent(value, cycle = 0) {
  if (!value || typeof value !== "object") return null;
  const source = cloneValue(value);
  const eventId = source.eventId ?? source.id ?? null;
  const rolled = Math.max(0, Math.floor(Number(source.rolled ?? source.roll) || 0));
  const total = Math.floor(Number(source.total) || 0);
  const eventCycle = Math.max(0, Math.floor(Number(source.cycle ?? cycle) || 0));
  const statuses = new Set(["pending", "resolving", "blocked", "partial", "uncertain"]);
  const status = statuses.has(String(source.status ?? "")) ? String(source.status) : "pending";
  const selection = source.selection ?? source.selections ?? {};
  return {
    ...source,
    eventId,
    id: source.id ?? eventId,
    rolled,
    roll: source.roll ?? rolled,
    total,
    cycle: eventCycle,
    resolutionId: source.resolutionId ?? null,
    status,
    selection: cloneValue(selection ?? {}),
    selections: cloneValue(source.selections ?? selection ?? {})
  };
}

/* -------------------------------------------------------------------------- */
/*  NPC connection (C:2234) and retirement (C:2654)                            */
/* -------------------------------------------------------------------------- */

/** C:2238-2247 — the ten connection benefits, one chosen at creation. */
export const CONNECTION_BENEFITS = Object.freeze([
  { id: "animalLover", label: "Animal Lover", source: "C:2238",
    text: "Looks after your pets for free. Animals resting with them heal 2 extra wounds, or 3 if Prosperity is 6+." },
  { id: "caretaker", label: "Caretaker", source: "C:2239",
    text: "Rest in their home: heal 2 extra wounds, or 3 if Prosperity is 6+." },
  { id: "concerned", label: "Concerned", source: "C:2240",
    text: "Once per cycle when you leave the village, they give you 1 torch." },
  { id: "crafty", label: "Crafty", source: "C:2241",
    text: "+2 bonus on crafting rolls you make in the village." },
  { id: "foodie", label: "Foodie", source: "C:2242",
    text: "Once per cycle when you leave, rations equal to half the village's Prosperity (minimum 1)." },
  { id: "magicEnthusiast", label: "Magic Enthusiast", source: "C:2243",
    text: "Each day, identifies magic items equal to the village's Prosperity (minimum 1)." },
  { id: "moneyBags", label: "Money Bags", source: "C:2244",
    text: "Lends up to 100 x Prosperity gc (minimum 100). No second loan until the first is repaid." },
  { id: "monsterCollector", label: "Monster Collector", source: "C:2245",
    text: "Trades 1 monster part of a specific monster type for 5 monster parts of another type." },
  { id: "rival", label: "Rival", source: "C:2246",
    text: "Once per cycle, a 50 gc bet on whose delve is more profitable, settled on any die: even you win, odd they win." },
  { id: "smartyPants", label: "Smarty Pants", source: "C:2247",
    text: "Researches one question at a time; the answer arrives 1 day later." }
]);

/** Crafty (C:2241) — +2 on crafting rolls made in the village. */
export const CONNECTION_CRAFTING_BONUS = 2;

/** Monster Collector (C:2245) — the generic-parts exchange rate. */
export const MONSTER_PART_TRADE_RATE = Object.freeze({ give: 5, receive: 1 });

/**
 * C:2245 — parts are generic per monster TYPE now, not named organs.
 * Five of anything buys one of what you need.
 */
export function monsterPartTrade(partsOffered) {
  const n = Math.max(0, Math.floor(Number(partsOffered) || 0));
  return { spent: n - (n % MONSTER_PART_TRADE_RATE.give), received: Math.floor(n / MONSTER_PART_TRADE_RATE.give) };
}

/** C:2662-2666 — retirement benefits. Two of them if you have 100,000 TXP. */
export const RETIREMENT_BENEFITS = Object.freeze([
  { id: "bestStewardEver", label: "Best Steward Ever", source: "C:2662",
    text: "Your retired PC stewards an institution, which always operates as if Prosperity were 10." },
  { id: "crowDaddy", label: "Crow Daddy", source: "C:2663",
    text: "New PCs from the village may start with one starting trait your retired PC knows. A 0-TXP PC may start with at most three traits." },
  { id: "generousBenefactor", label: "Generous Benefactor", source: "C:2664",
    text: "Once per cycle, the PCs receive a gift rolled on the Minor Things table." },
  { id: "masterMentor", label: "Master Mentor", source: "C:2665",
    text: "Up to three of your retired PC's traits cost other PCs half the usual XP." },
  { id: "workWithMyHands", label: "Work With My Hands", source: "C:2666",
    text: "An artisan institution gains +4 to crafting rolls and grants +4 to anyone renting its workshop." }
]);

/** How many retirement benefits this TXP total buys (C:2658). */
export function retirementBenefitCount(txp = 0) {
  const t = Math.floor(Number(txp) || 0);
  if (t >= RETIREMENT_TXP_TWO_BENEFITS) return 2;
  if (t >= RETIREMENT_TXP) return 1;
  return 0;
}

/* -------------------------------------------------------------------------- */
/*  Other villages (C:2225-2228, C:2668-2670)                                  */
/* -------------------------------------------------------------------------- */

/**
 * C:2226 / C:2670 — a village that isn't yours works identically, except you
 * cannot invest in it and the Ref does not track its Prosperity or events. Its
 * institution levels are whatever the Ref says.
 *
 * Modelled as a flag on the village record rather than a second type, so every
 * lookup above keeps working against it unchanged.
 */
export function makeForeignVillage({ name = "Unnamed Village", prosperity = 0, institutions = [] } = {}) {
  const identity = newVillageIdentity();
  return {
    name,
    isHome: false,
    prosperity: clampProsperity(prosperity),
    cycle: 0,
    tracksCycles: false,          // C:2226 — the Ref doesn't track these
    canInvest: false,             // C:2226 — "you can't invest in them"
    villageId: identity.villageId,
    revision: 0,
    sceneId: null,
    sceneSeed: identity.sceneSeed,
    bootstrap: { txId: null, phase: "prepared", candidateSceneId: null },
    auctionLots: [],
    operationJournal: [],
    eventReceipts: [],
    eventReceipt: null,
    institutions: institutions.map((institution, index) =>
      normaliseInstitution(institution, index, identity.villageId)),
    activeEffects: [],
    pendingEvent: null,
    spentThisCycle: 0,
    spendBonusAwarded: false
  };
}

/** C:2676 — 15,000 gc and ten days founds a new village, which becomes home. */
export function foundVillageQuote() {
  return { price: FOUND_VILLAGE_PRICE, days: FOUND_VILLAGE_DAYS, startingInstitutions: [...STARTING_INSTITUTIONS] };
}

/* -------------------------------------------------------------------------- */
/*  Village crafting (C:2301-2308)                                             */
/* -------------------------------------------------------------------------- */

/**
 * What an artisan institution charges to craft an item for you, and how fast.
 *
 * C:2305 — materials plus the item's FULL price up front.
 * C:2306 — one crafting roll per day, at a bonus equal to the institution's level.
 * C:2307 — pay twice as much and it becomes two rolls a day.
 *
 * The rolls themselves belong to `crafting.mjs`; this returns the terms.
 */
export function villageCraftingQuote(key, level, itemPrice, { rush = false, extraCraftingBonus = 0 } = {}) {
  const def = INSTITUTIONS[key];
  if (!def) return { ok: false, error: `unknown institution: ${key}` };
  if (!def.roles.includes("artisan")) return { ok: false, error: `${def.label} is not an artisan` };
  const price = Math.max(0, Math.floor(Number(itemPrice) || 0));
  const lvl = Math.max(0, Math.floor(Number(level) || 0));
  return {
    ok: true,
    institution: key,
    cost: rush ? price * 2 : price,
    rollsPerDay: rush ? 2 : 1,
    craftingBonus: lvl + Math.floor(Number(extraCraftingBonus) || 0),
    materialsRequired: true,
    crafts: [...(def.craftsExpertises ?? [])]
  };
}

/** Daily cost and bonus for renting an artisan's workshop (C:2368, C:2462, C:2541). */
export function workshopRental(key, level) {
  const def = INSTITUTIONS[key];
  if (!def?.workshop) return { ok: false, error: `${def?.label ?? key} has no workshop to rent` };
  return {
    ok: true,
    pricePerDay: def.workshop.pricePerDay,
    craftingBonus: Math.max(0, Math.floor(Number(level) || 0)),
    expertises: [...def.workshop.expertises]
  };
}

/* ========================================================================== */
/*  Foundry-facing half — settings, mutation, chat cards.                      */
/*  Everything above is pure and unit-tested; everything below needs a world.  */
/* ========================================================================== */

/*
 * State-boundary notes
 * --------------------
 * A world setting is a mutable JSON value, while `game.settings.get` returns
 * the value held by Foundry's client-side setting document.  The old shallow
 * Object.assign boundary therefore let a caller mutate the stored
 * institutions/effects arrays before it had decided to save them.  We keep
 * the setting as the one durable source of truth, but clone at every edge and
 * make `saveVillage` the only successful-write notification origin.
 *
 * The migration intentionally does not write from a read.  Generating an id
 * in `getVillage` and hoping a later client converges would create two
 * villages during a simultaneous load.  A designated writer calls
 * `migrateVillageState` (the ready hook wires this for the current GM), which
 * persists the identity once.  A process-local fallback is used only until
 * that write is possible, so repeated legacy reads remain stable without
 * pretending that a local default is durable.
 *
 * Foundry v14 invokes a setting's onChange callback synchronously from the
 * client-document update, before ClientSettings.set resolves.  The local
 * origin marker is consequently registered before set and consumed by the
 * callback; saveVillage emits the authoritative (next, prev) notification
 * after set resolves.  This is deterministic, not an either-order race, and
 * prevents one local setting write from dispatching twice.
 *
 * The queue below is storage/serialization infrastructure only.  It does not
 * decide event targets, prices, Commerce receipts, or saga policy.  The
 * designated-writer check is deliberately a live check immediately before a
 * setting write.  Core has no lease/epoch/fence/CAS for independent clients,
 * so the residual GM-transition window is reported for reconciliation rather
 * than hidden behind a false atomicity claim.
 */

export const VILLAGE_BOOTSTRAP_PHASES = Object.freeze([
  "prepared", "scene-created", "tiles-created", "committed", "uncertain"
]);
export const VILLAGE_OPERATION_TERMINAL_PHASES = Object.freeze([
  "committed", "abandoned", "complete", "resolved", "duplicate-detected"
]);
const TERMINAL_OPERATION_PHASES = new Set(VILLAGE_OPERATION_TERMINAL_PHASES);
export const VILLAGE_OPERATION_RETENTION = Object.freeze({ terminal: 100, cycles: 20 });

let villageSettingsRegistered = false;
let lastObservedVillage = null;
const pendingOriginMarkers = new Map();
const villageChangeListeners = new Set();
const villageQueues = new Map();
let villageSceneReconciliationEnqueuer = null;

function buildDefaultVillage(identity = newVillageIdentity()) {
  const villageId = String(identity.villageId);
  const sceneSeed = String(identity.sceneSeed);
  const institutions = STARTING_INSTITUTIONS.map((type, idx) => ({
    id: `seed-${idx}-${type}`,
    type,
    name: INSTITUTION_TYPES[type],
    level: 1,                     // C:2232 — all starting institutions are 1st level
    steward: "",
    foundedOnCycle: 0,
    operatingFromCycle: 0,        // the starting five are open on day one
    pendingLevel: null,
    pendingFromCycle: null,
    destroyed: false,
    destroyedOnCycle: null,
    destruction: null
  }));
  return {
    name: "Unnamed Village",
    isHome: true,
    prosperity: 0,                // C:2257
    cycle: 0,
    tracksCycles: true,
    canInvest: true,
    raisingEventThisCycle: true,  // start true so the first end-of-cycle is not a penalty
    spentThisCycle: 0,            // C:2261
    spendBonusAwarded: false,
    villageId,
    revision: 0,
    sceneId: null,
    sceneSeed,
    bootstrap: {
      txId: null,
      phase: "prepared",
      candidateSceneId: null
    },
    auctionLots: [],
    operationJournal: [],
    eventReceipts: [],
    eventReceipt: null,
    institutions,
    activeEffects: [],            // event effects live until the end of their cycle
    pendingEvent: null
  };
}

function normaliseInstitution(value, index, villageId) {
  const source = value && typeof value === "object" ? cloneValue(value) : {};
  const type = String(source.type ?? source.key ?? "");
  const generatedId = `${villageId}-institution-${index}-${type || "unknown"}`;
  const def = INSTITUTIONS[type];
  const normalized = {
    id: String(source.id ?? generatedId),
    type,
    name: source.name ?? def?.label ?? type,
    level: Math.max(0, Math.floor(Number(source.level) || 0)),
    steward: source.steward ?? "",
    foundedOnCycle: source.foundedOnCycle ?? 0,
    operatingFromCycle: source.operatingFromCycle ?? 0,
    pendingLevel: source.pendingLevel ?? null,
    pendingFromCycle: source.pendingFromCycle ?? null,
    destroyed: source.destroyed === true,
    destroyedOnCycle: source.destroyedOnCycle ?? null,
    destruction: source.destruction ?? null,
    ...source,
    id: String(source.id ?? generatedId),
    type,
    name: source.name ?? def?.label ?? type,
    level: Math.max(0, Math.floor(Number(source.level) || 0)),
    steward: source.steward ?? "",
    foundedOnCycle: source.foundedOnCycle ?? 0,
    operatingFromCycle: source.operatingFromCycle ?? 0,
    pendingLevel: source.pendingLevel ?? null,
    pendingFromCycle: source.pendingFromCycle ?? null,
    destroyed: source.destroyed === true,
    destroyedOnCycle: source.destroyedOnCycle ?? null,
    destruction: source.destruction ?? null
  };
  return normalized;
}

/** Normalize a legacy or current record without writing it. */
export function normalizeVillage(value, { identity = null } = {}) {
  const source = value && typeof value === "object" ? cloneValue(value) : {};
  const sourceVillageId = typeof source.villageId === "string" ? source.villageId.trim() : source.villageId;
  const sourceSceneSeed = typeof source.sceneSeed === "string" ? source.sceneSeed.trim() : source.sceneSeed;
  if (!identity && sourceVillageId && legacyIdentity?.villageId !== String(sourceVillageId)) {
    legacyIdentity = {
      villageId: String(sourceVillageId),
      sceneSeed: String(sourceSceneSeed || randomToken(24))
    };
  }
  const remembered = identity ?? legacyIdentity ?? (legacyIdentity = newVillageIdentity());
  const villageId = String(sourceVillageId || remembered.villageId);
  const sceneSeed = String(sourceSceneSeed || remembered.sceneSeed);
  if (sourceVillageId || sourceSceneSeed || !legacyIdentity?.villageId) legacyIdentity = { villageId, sceneSeed };

  const defaults = buildDefaultVillage({ villageId, sceneSeed });
  const normalized = { ...defaults, ...source, villageId, sceneSeed };
  normalized.prosperity = clampProsperity(normalized.prosperity);
  normalized.cycle = Math.max(0, Math.floor(Number(normalized.cycle) || 0));
  normalized.revision = Math.max(0, Math.floor(Number(normalized.revision) || 0));
  normalized.spentThisCycle = Math.max(0, Math.floor(Number(normalized.spentThisCycle) || 0));
  normalized.spendBonusAwarded = Boolean(normalized.spendBonusAwarded);
  normalized.raisingEventThisCycle = Boolean(normalized.raisingEventThisCycle);
  normalized.sceneId = normalized.sceneId ?? null;
  normalized.institutions = (Array.isArray(source.institutions)
    ? source.institutions : defaults.institutions)
    .map((institution, index) => normaliseInstitution(institution, index, villageId));
  normalized.activeEffects = Array.isArray(source.activeEffects) ? cloneValue(source.activeEffects) : [];
  normalized.auctionLots = Array.isArray(source.auctionLots) ? cloneValue(source.auctionLots) : [];
  normalized.operationJournal = Array.isArray(source.operationJournal)
    ? cloneValue(source.operationJournal) : [];
  normalized.eventReceipts = Array.isArray(source.eventReceipts)
    ? cloneValue(source.eventReceipts) : [];
  normalized.eventReceipt = source.eventReceipt && typeof source.eventReceipt === "object"
    ? cloneValue(source.eventReceipt) : null;
  // Older event records used `id` and had no lifecycle fields.  Keep those
  // records readable while making the durable resolution shape uniform at the
  // setting boundary.  A missing resolution id is filled by the first Ref
  // resolution (or by the next cycle writer), never invented during a read.
  normalized.pendingEvent = Object.prototype.hasOwnProperty.call(source, "pendingEvent")
    ? normalizePendingVillageEvent(source.pendingEvent, normalized.cycle) : null;
  if (normalized.eventReceipt && !normalized.eventReceipts.some(receipt =>
    String(receipt?.resolutionId ?? "") === String(normalized.eventReceipt.resolutionId ?? ""))) {
    normalized.eventReceipts.push(cloneValue(normalized.eventReceipt));
  }
  if (!normalized.eventReceipt && normalized.eventReceipts.length) {
    normalized.eventReceipt = cloneValue(normalized.eventReceipts.at(-1));
  }
  const bootstrap = source.bootstrap && typeof source.bootstrap === "object" ? source.bootstrap : {};
  normalized.bootstrap = {
    ...defaults.bootstrap,
    ...cloneValue(bootstrap),
    txId: bootstrap.txId == null ? null : String(bootstrap.txId),
    phase: VILLAGE_BOOTSTRAP_PHASES.includes(bootstrap.phase) ? bootstrap.phase : "prepared",
    candidateSceneId: bootstrap.candidateSceneId ?? null
  };
  return cloneValue(normalized);
}

/** British-spelling alias retained for callers that use the plan vocabulary. */
export const normaliseVillage = normalizeVillage;

export function cloneVillage(value = getVillage()) {
  return normalizeVillage(value);
}

export const cloneVillageState = cloneVillage;

export function registerVillageSettings() {
  if (villageSettingsRegistered) return;
  game.settings.register(NS, KEY_VILLAGE, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultVillage(),
    onChange: (value, options, userId) => handleVillageSettingChange(value, options, userId)
  });
  villageSettingsRegistered = true;
}

export function defaultVillage() {
  return cloneValue(buildDefaultVillage());
}

export function getVillage() {
  try {
    const v = game.settings.get(NS, KEY_VILLAGE);
    if (v == null) {
      if (!fallbackVillageRecord) fallbackVillageRecord = normalizeVillage(buildDefaultVillage());
      return cloneValue(fallbackVillageRecord);
    }
    return normalizeVillage(v);
  } catch {
    if (!fallbackVillageRecord) fallbackVillageRecord = normalizeVillage(buildDefaultVillage());
    return cloneValue(fallbackVillageRecord);
  }
}

function settingRawVillage() {
  try { return game.settings.get(NS, KEY_VILLAGE); } catch { return null; }
}

function activeVillageGM() {
  const users = globalThis.game?.users;
  const hasUserCollection = users != null;
  try {
    if (users?.activeGM) return users.activeGM;
  } catch { /* fall through to a collection scan */ }
  let candidates = [];
  try {
    if (typeof users?.filter === "function") candidates = [...users.filter(user => user?.active && user?.isGM)];
    else if (Array.isArray(users)) candidates = users.filter(user => user?.active && user?.isGM);
    else if (Array.isArray(users?.contents)) candidates = users.contents.filter(user => user?.active && user?.isGM);
    else if (typeof users?.[Symbol.iterator] === "function") {
      candidates = [...users].map(entry => Array.isArray(entry) ? entry[1] : entry)
        .filter(user => user?.active && user?.isGM);
    }
  } catch { candidates = []; }
  candidates.sort((a, b) => {
    const roleOrder = (Number(b?.role) || 0) - (Number(a?.role) || 0);
    if (roleOrder) return roleOrder;
    const left = String(a?.id ?? "");
    const right = String(b?.id ?? "");
    return left < right ? -1 : left > right ? 1 : 0;
  });
  if (candidates[0]) return candidates[0];
  // Foundry always exposes game.users, and an explicit empty/activeGM-null
  // collection means there is no designated writer.  Only the tiny pure-test
  // harness with no collection at all falls back to game.user.
  if (hasUserCollection) return null;
  const current = globalThis.game?.user;
  if (current?.isGM && current.active !== false) return current;
  return null;
}

/** The Commerce option-(b) designated writer for a Village operation. */
export function getActiveVillageGM() {
  return activeVillageGM();
}

export const activeGM = getActiveVillageGM;

export function isVillageDesignatedWriter(user = globalThis.game?.user) {
  const designated = activeVillageGM();
  if (!designated) return false;
  if (!user) return true;
  if (user.isGM === false) return false;
  if (user.id == null || designated.id == null) return user === designated;
  return String(user.id) === String(designated.id);
}

export function registerVillageChangeListener(listener) {
  if (typeof listener !== "function") return () => {};
  villageChangeListeners.add(listener);
  return () => villageChangeListeners.delete(listener);
}

export const subscribeVillageChanges = registerVillageChangeListener;

/** Install the later map ticket's enqueue hook without registering onChange twice. */
export function setVillageSceneReconciliationEnqueuer(listener) {
  villageSceneReconciliationEnqueuer = typeof listener === "function" ? listener : null;
  return villageSceneReconciliationEnqueuer;
}

function villageMarkerKey(marker) {
  return `${marker.villageId}:${marker.revision}:${marker.operationId}`;
}

function markerMatches(marker, village, options = {}, userId = null) {
  if (!marker || marker.villageId !== village.villageId || marker.revision !== village.revision) return false;
  if (marker.fingerprint !== villageInputFingerprint(village)) return false;
  const source = marker.sourceUserId;
  return !userId || !source || String(userId) === String(source)
    || String(userId) === String(globalThis.game?.user?.id ?? "");
}

function handleVillageSettingChange(value, options = {}, userId = null) {
  const next = normalizeVillage(value);
  const marker = [...pendingOriginMarkers.values()].find(candidate => markerMatches(candidate, next, options, userId));
  const previous = lastObservedVillage ? cloneValue(lastObservedVillage) : null;
  lastObservedVillage = cloneValue(next);
  if (marker) {
    marker.observed = true;
    return;
  }

  const metadata = {
    villageId: next.villageId,
    revision: next.revision,
    operationId: options?.crowsVillageOperationId ?? options?.operationId ?? null,
    sourceUserId: userId ?? null,
    remote: true,
    cacheMiss: !previous
  };
  notifyVillageChanged(next, previous, metadata);
}

function notifyVillageChanged(next, prev, metadata = {}) {
  const ownedNext = cloneValue(next);
  const ownedPrev = prev == null ? null : cloneValue(prev);
  const ownedMetadata = cloneValue(metadata);
  if (typeof globalThis.Hooks?.callAll === "function") {
    try {
      globalThis.Hooks.callAll("crowsVillageChanged", cloneValue(ownedNext),
        ownedPrev == null ? null : cloneValue(ownedPrev), cloneValue(ownedMetadata));
    } catch (error) { console.error("crows | Village change hook failed", error); }
  }
  for (const listener of villageChangeListeners) {
    try {
      listener(cloneValue(ownedNext), ownedPrev == null ? null : cloneValue(ownedPrev), cloneValue(ownedMetadata));
    }
    catch (error) { console.error("crows | Village change listener failed", error); }
  }
  if (villageSceneReconciliationEnqueuer && isVillageDesignatedWriter()) {
    try {
      Promise.resolve(villageSceneReconciliationEnqueuer(
        cloneValue(ownedNext), ownedPrev == null ? null : cloneValue(ownedPrev), cloneValue(ownedMetadata)
      )).catch(error => console.error("crows | Village scene reconciliation failed", error));
    } catch (error) { console.error("crows | Village scene reconciliation failed", error); }
  }
}

function villageOperationId(value) {
  return String(value ?? "").trim();
}

function operationFingerprint(value) {
  if (typeof value === "string" && value.length) return value;
  return villageInputFingerprint(value ?? {});
}

function operationEntry(village, operationId) {
  return (village.operationJournal ?? []).find(entry => villageOperationId(entry?.operationId) === operationId) ?? null;
}

/** Read one durable operation receipt without exposing the setting's object. */
export function getVillageOperation(operationId, village = getVillage()) {
  const entry = operationEntry(village, villageOperationId(operationId));
  return entry ? cloneValue(entry) : null;
}

export const inspectVillageOperation = getVillageOperation;

function operationResult(entry) {
  if (entry?.result && typeof entry.result === "object") return cloneValue(entry.result);
  return { ok: entry?.phase === "committed", operationId: entry?.operationId, phase: entry?.phase };
}

function journalEntryIsTerminal(entry) {
  return TERMINAL_OPERATION_PHASES.has(String(entry?.phase ?? ""));
}

function journalReferencedOperationIds(journal) {
  const refs = new Set();
  for (const entry of journal) {
    for (const child of entry?.childOperationIds ?? []) refs.add(String(child));
  }
  return refs;
}

/** Keep all recovery entries and the plan's bounded terminal evidence. */
export function pruneVillageOperationJournal(journal = [], currentCycle = 0) {
  const entries = (Array.isArray(journal) ? journal : []).map(cloneValue);
  const terminal = entries.filter(journalEntryIsTerminal);
  if (terminal.length <= VILLAGE_OPERATION_RETENTION.terminal) return entries;
  const referenced = journalReferencedOperationIds(entries);
  const cycleFloor = Math.floor(Number(currentCycle) || 0) - (VILLAGE_OPERATION_RETENTION.cycles - 1);
  const keep = new Set(terminal.slice(-VILLAGE_OPERATION_RETENTION.terminal));
  for (const entry of terminal) {
    if ((Number(entry.originCycle) || 0) >= cycleFloor || referenced.has(String(entry.operationId))) keep.add(entry);
  }
  return entries.filter(entry => !journalEntryIsTerminal(entry) || keep.has(entry));
}

function enqueueVillageTask(villageId, task) {
  const prior = villageQueues.get(villageId) ?? Promise.resolve();
  const current = prior.catch(() => undefined).then(task);
  villageQueues.set(villageId, current);
  current.finally(() => {
    if (villageQueues.get(villageId) === current) villageQueues.delete(villageId);
  }).catch(() => undefined);
  return current;
}

function authorityFailure() {
  const designated = activeVillageGM();
  if (!designated) {
    return { ok: false, error: "authority-unavailable", code: "no-active-gm", reason: "no-active-gm" };
  }
  if (!isVillageDesignatedWriter()) {
    return {
      ok: false,
      error: "authority-unavailable",
      reason: "request-must-run-on-designated-gm",
      activeGMId: designated.id ?? null
    };
  }
  return null;
}

function operationPhase(request, outcome, terminal) {
  const phase = request.phase ?? outcome?.phase ?? (terminal ? "committed" : "prepared");
  return String(phase);
}

/**
 * Generic per-Village designated-writer queue and journal primitive.
 *
 * `execute` is intentionally a storage callback: it receives an owned live
 * snapshot and may return `{ next, result, phase }`.  Later event/interface
 * tickets supply action policy and child sagas; this function only persists
 * their operation token, revision/fingerprint, child ids, and result.
 */
export async function enqueueVillageOperation(request = {}, execute = null) {
  const input = request && typeof request === "object" ? request : {};
  const operationId = villageOperationId(input.operationId ?? input.id);
  const hasFingerprint = Object.prototype.hasOwnProperty.call(input, "inputFingerprint")
    || Object.prototype.hasOwnProperty.call(input, "fingerprint")
    || Object.prototype.hasOwnProperty.call(input, "input");
  const fingerprint = operationFingerprint(input.inputFingerprint ?? input.fingerprint ?? input.input);
  const childOperationIds = [...new Set((input.childOperationIds ?? input.childIds ?? input.children ?? [])
    .map(child => String(child)).filter(Boolean))];
  if (!operationId) return { ok: false, error: "invalid-request", reason: "operation-id-required" };
  if (!hasFingerprint || !fingerprint) {
    return { ok: false, error: "invalid-request", reason: "input-fingerprint-required" };
  }
  const executor = typeof input.execute === "function" ? input.execute
    : typeof input.apply === "function" ? input.apply
      : typeof input.mutate === "function" ? input.mutate : execute;
  const snapshot = getVillage();
  const villageId = String(input.villageId ?? snapshot.villageId);

  return enqueueVillageTask(villageId, async () => {
    const authority = authorityFailure();
    if (authority) return authority;

    const current = getVillage();
    if (current.villageId !== villageId) {
      return { ok: false, error: "conflict", reason: "village-id-mismatch", villageId: current.villageId };
    }
    const existing = operationEntry(current, operationId);
    if (existing) {
      if (String(existing.inputFingerprint ?? "") !== fingerprint) {
        return {
          ok: false, error: "duplicate", code: "input-fingerprint-conflict", conflict: true,
          reason: "input-fingerprint-conflict",
          operation: cloneValue(existing), state: "known"
        };
      }
      if (journalEntryIsTerminal(existing)) {
        return { ...operationResult(existing), operationId, replayed: true, operation: cloneValue(existing) };
      }
      if (!executor && input.next == null && input.nextVillage == null && input.terminalResult == null) {
        return {
          ok: false, error: "operation-pending", phase: existing.phase,
          operation: cloneValue(existing), state: existing.phase === "uncertain" ? "unknown" : "known"
        };
      }
    }

    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      return { ok: false, error: "invalid-request", reason: "expected-revision-required", currentRevision: current.revision };
    }
    if (!existing && current.revision !== expectedRevision) {
      return {
        ok: false, error: "conflict", code: "stale-revision", reason: "stale-revision", stale: true, retryable: true,
        expectedRevision, currentRevision: current.revision
      };
    }

    let outcome;
    try {
      if (executor) outcome = await executor({
        village: cloneValue(current),
        operation: {
          operationId, villageId, expectedRevision, inputFingerprint: fingerprint,
          childOperationIds: cloneValue(childOperationIds)
        }
      });
      else outcome = {
        next: input.nextVillage ?? input.next ?? current,
        result: input.terminalResult ?? { ok: true, operationId },
        phase: input.phase ?? "committed"
      };
      // A caller that owns a bounded multi-document saga may persist its
      // prepared/child/terminal phases through saveVillage while still
      // running inside this per-Village queue.  `persist: false` hands an
      // already-persisted result back without asking the generic writer to
      // write a second stale snapshot.  It is also the read-only escape hatch
      // for a cancelled picker.  A partial-after-commit or uncertain outcome
      // may use this branch only after its receipt was durably written; a
      // preflight refusal before ANY child write may return it read-only.  The
      // request-level `persist: false` spelling is accepted as the same
      // additive opt-out; omitted/default callers retain the old writer path.
      const requestedNoPersist = outcome?.persist === false || input.persist === false;
      const outcomePhase = String(outcome?.phase ?? outcome?.result?.phase ?? "");
      const requiresDurableRecovery = ["partial", "uncertain"].includes(outcomePhase);
      if (requestedNoPersist && (!requiresDurableRecovery || outcome?.persisted === true)) {
        return cloneValue(outcome?.result ?? input.terminalResult ?? { ok: true, operationId });
      }
    } catch (error) {
      const uncertain = {
        operationId, action: input.action ?? "village-operation", villageId,
        originCycle: input.originCycle ?? current.cycle,
        expectedRevision, inputFingerprint: fingerprint,
        phase: "uncertain", childOperationIds,
        result: { ok: false, error: "write-failed", phase: "uncertain", state: "unknown",
          reconciliationRequired: true, message: String(error?.message ?? error) },
        createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now()
      };
      const next = cloneValue(current);
      next.operationJournal = pruneVillageOperationJournal(
        [...(next.operationJournal ?? []).filter(entry => entry.operationId !== operationId), uncertain], next.cycle
      );
      try {
        await saveVillage(next, { prev: current, operationId, action: input.action, incrementRevision: true });
      } catch { /* an unavailable journal write is itself uncertain */ }
      return cloneValue(uncertain.result);
    }

      const returnedNext = outcome?.nextVillage ?? outcome?.next ?? current;
      const next = normalizeVillage(returnedNext, { identity: { villageId, sceneSeed: current.sceneSeed } });
      const result = outcome?.result ?? input.terminalResult ?? { ok: true, operationId };
      const outcomeChildOperationIds = outcome?.childOperationIds
        ?? result?.childOperationIds ?? [];
      const journalChildOperationIds = [...new Set([
        ...childOperationIds,
        ...(Array.isArray(outcomeChildOperationIds) ? outcomeChildOperationIds : [])
      ].map(child => String(child)).filter(Boolean))];
      const explicitPhase = input.phase ?? outcome?.phase;
    const terminal = outcome?.terminal === true
      || input.terminal === true
      || (!explicitPhase && outcome?.terminal !== false && input.terminal !== false)
      || TERMINAL_OPERATION_PHASES.has(operationPhase(input, outcome, input.terminalResult != null));
    const phase = operationPhase(input, outcome, terminal);
    const entry = {
      operationId, action: input.action ?? "village-operation", villageId,
        originCycle: input.originCycle ?? current.cycle,
        expectedRevision, inputFingerprint: fingerprint,
        phase, childOperationIds: cloneValue(journalChildOperationIds),
      result: cloneValue(result),
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
      resultingRevision: current.revision + 1,
      writerUserId: globalThis.game?.user?.id ?? null
    };
    next.operationJournal = pruneVillageOperationJournal(
      [...(next.operationJournal ?? []).filter(candidate => candidate.operationId !== operationId), entry], next.cycle
    );

    const authorityBeforeWrite = authorityFailure();
    if (authorityBeforeWrite) return authorityBeforeWrite;
    // The executor may have awaited an external child operation.  Re-resolve
    // the setting after that wait and immediately before the write; a remote
    // Village change must win over this stale plan rather than being silently
    // overwritten.  This is an observational revision check, not a CAS.
    const liveBeforeWrite = getVillage();
    if (liveBeforeWrite.villageId !== villageId || liveBeforeWrite.revision !== current.revision) {
      return {
        ok: false, error: "conflict", code: "stale-revision", reason: "stale-revision", stale: true,
        retryable: true, expectedRevision, currentRevision: liveBeforeWrite.revision,
        operation: existing ? cloneValue(existing) : undefined
      };
    }
    try {
      const saved = await saveVillage(next, { prev: current, operationId, action: input.action });
      const activeAfterWrite = activeVillageGM();
      const transitioned = !activeAfterWrite || !isVillageDesignatedWriter();
      const response = {
        ...cloneValue(result), operationId, revision: saved.revision,
        operation: { ...cloneValue(entry), resultingRevision: saved.revision }
      };
      if (transitioned) {
        response.ok = false;
        response.error = "write-failed";
        response.reconciliationRequired = true;
        response.state = "unknown";
        response.reason = "gm-transition-overlap";
      }
      return response;
    } catch (error) {
      return {
        ok: false, error: "write-failed", state: "unknown", reconciliationRequired: true,
        operationId, message: String(error?.message ?? error)
      };
    }
  });
}

export const queueVillageOperation = enqueueVillageOperation;
export const runVillageOperation = enqueueVillageOperation;
export const villageOperation = enqueueVillageOperation;
export const commitVillageOperation = enqueueVillageOperation;
export const withVillageOperation = enqueueVillageOperation;
export const recordVillageOperation = enqueueVillageOperation;

/** Persist identity fields from a legacy setting through the designated writer. */
export async function migrateVillageState({ operationId = null } = {}) {
  const raw = settingRawVillage();
  if (!raw || typeof raw !== "object") return { ok: true, migrated: false, village: getVillage() };
  const normalized = normalizeVillage(raw);
  const missing = ["villageId", "sceneSeed", "revision", "sceneId", "bootstrap", "auctionLots", "operationJournal",
    "eventReceipts", "eventReceipt"]
    .some(key => !Object.prototype.hasOwnProperty.call(raw, key));
  if (!missing) return { ok: true, migrated: false, village: normalized };
  const authority = authorityFailure();
  if (authority) return authority;
  try {
    const migrated = await saveVillage(normalized, {
      prev: normalized,
      operationId: operationId ?? `village-migration-${normalized.villageId}`,
      incrementRevision: false,
      action: "village-state-migration"
    });
    return { ok: true, migrated: true, village: migrated };
  } catch (error) {
    return { ok: false, error: "write-failed", state: "unknown", message: String(error?.message ?? error) };
  }
}

export const migrateVillageSettings = migrateVillageState;

async function save(v, options = {}) {
  const previous = normalizeVillage(options.prev ?? getVillage());
  const next = normalizeVillage(v, { identity: { villageId: previous.villageId, sceneSeed: previous.sceneSeed } });
  next.villageId = previous.villageId;
  next.sceneSeed = previous.sceneSeed;
  next.revision = options.incrementRevision === false
    ? previous.revision : previous.revision + 1;
  next.operationJournal = pruneVillageOperationJournal(next.operationJournal, next.cycle);
  const operationId = villageOperationId(options.operationId) || `village-save-${randomToken(12)}`;
  const sourceUserId = options.sourceUserId ?? globalThis.game?.user?.id ?? null;
  const marker = {
    villageId: next.villageId,
    revision: next.revision,
    operationId,
    sourceUserId,
    fingerprint: villageInputFingerprint(next)
  };
  pendingOriginMarkers.set(villageMarkerKey(marker), marker);
  try {
    const persisted = cloneValue(next);
    await game.settings.set(NS, KEY_VILLAGE, persisted, {
      ...(options.settingOptions ?? {}),
      crowsVillageOperationId: operationId
    });
    pendingOriginMarkers.delete(villageMarkerKey(marker));
    lastObservedVillage = cloneValue(next);
    notifyVillageChanged(next, previous, {
      villageId: next.villageId,
      revision: next.revision,
      operationId,
      sourceUserId
    });
    return cloneValue(next);
  } catch (error) {
    pendingOriginMarkers.delete(villageMarkerKey(marker));
    throw error;
  }
}

/** Public name for the one setting-write choke point used by later tickets. */
export const saveVillage = save;
export { save };

export async function setVillage(patch = {}, options = {}) {
  const prev = getVillage();
  const next = cloneValue(prev);
  Object.assign(next, cloneValue(patch ?? {}));
  next.prosperity = clampProsperity(next.prosperity);
  const saved = await save(next, { ...options, prev });
  return cloneValue(saved);
}

async function createVillageChat(data) {
  if (typeof globalThis.ChatMessage?.create !== "function") return null;
  return globalThis.ChatMessage.create(data);
}

/** Tombstones remain addressable, but only non-destroyed records are live. */
export function isLiveInstitution(institution) {
  return Boolean(institution && institution.destroyed !== true);
}

export function liveInstitutionRecords(village = getVillage()) {
  return (village?.institutions ?? []).filter(isLiveInstitution).map(cloneValue);
}

export const liveInstitutions = liveInstitutionRecords;

export function findLiveInstitution(type, village = getVillage()) {
  return (village?.institutions ?? []).find(institution => isLiveInstitution(institution)
    && institution.type === type) ?? null;
}

export const getLiveInstitution = findLiveInstitution;

/** Find a record by id, including a tombstone for ruin/map repair work. */
export function institutionRecordById(id, village = getVillage()) {
  return (village?.institutions ?? []).find(institution => institution.id === id) ?? null;
}

/**
 * Found an institution. Prosperity rises immediately (C:2261); the institution
 * does not open until the start of the next cycle (C:2350).
 */
export async function foundInstitution({ type, name = null, steward = "", level = 1, operationId = null } = {}, options = {}) {
  const def = INSTITUTIONS[type];
  if (!def) return { ok: false, error: `unknown institution: ${type}` };
  const prev = getVillage();
  if (!prev.canInvest) return { ok: false, error: "you can't invest in a village that isn't your home (C:2226)" };
  const next = cloneValue(prev);
  const existing = next.institutions.find(institution => institution.type === type) ?? null;
  if (existing && isLiveInstitution(existing) && Number(existing.level) > 0) {
    return { ok: false, error: "institution-exists", institution: cloneValue(existing) };
  }

  const openingLevel = Math.max(1, Math.min(
    institutionPurchasableMaxLevel(type), Math.floor(Number(level) || 1)
  ));
  const inst = existing
    ? {
      ...existing,
      name: name ?? def.label,
      steward,
      level: openingLevel,
      foundedOnCycle: next.cycle,
      operatingFromCycle: next.cycle + 1,   // C:2350
      pendingLevel: null,
      pendingFromCycle: null,
      destroyed: false,
      revivedOnCycle: next.cycle
    }
    : {
      id: `inst-${randomToken(10)}`,
      type,
      name: name ?? def.label,
      level: openingLevel,
      steward,
      foundedOnCycle: next.cycle,
      operatingFromCycle: next.cycle + 1,   // C:2350
      pendingLevel: null,
      pendingFromCycle: null,
      destroyed: false,
      destroyedOnCycle: null,
      destruction: null
    };
  if (existing) {
    const index = next.institutions.findIndex(institution => institution.id === existing.id);
    next.institutions[index] = inst;
  } else next.institutions.push(inst);
  next.prosperity = clampProsperity(next.prosperity + 1);
  next.raisingEventThisCycle = true;
  // C:2318 — founding a new institution is what lifts the boycott.
  next.activeEffects = (next.activeEffects ?? []).filter(e => e.kind !== "boycott");
  const saved = await save(next, { prev, operationId: options.operationId ?? operationId });
  const savedInstitution = institutionRecordById(inst.id, saved);

  await createVillageChat({
    content: `<div class="crows village-found">
      <strong>${saved.name}</strong> founds <strong>${savedInstitution.name}</strong> (${def.label}) for ${def.foundingPrice} gc${steward ? ` — steward: ${steward}` : ""}.
      <div>Opens at the start of cycle <strong>${savedInstitution.operatingFromCycle}</strong>. Prosperity now <strong>${saved.prosperity}</strong>.</div>
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, institution: cloneValue(savedInstitution), prosperity: saved.prosperity, price: def.foundingPrice };
}

/**
 * Pay to upgrade. Prosperity rises now; the new level operates from the next
 * cycle (C:2353), so the level is parked in `pendingLevel` until `endCycle`.
 */
export async function upgradeInstitution(id, options = {}) {
  const prev = getVillage();
  if (!prev.canInvest) return { ok: false, error: "you can't invest in a village that isn't your home (C:2226)" };
  const next = cloneValue(prev);
  const inst = institutionRecordById(id, next);
  if (!inst) return { ok: false, error: "no such institution" };
  if (!isLiveInstitution(inst)) return { ok: false, error: "institution-destroyed", institution: cloneValue(inst) };
  if (Number(inst.level) <= 0) return { ok: false, error: "institution-closed", institution: cloneValue(inst) };

  const target = (inst.pendingLevel ?? inst.level) + 1;
  const max = institutionPurchasableMaxLevel(inst.type);
  if (target > max) return { ok: false, error: `${INSTITUTION_TYPES[inst.type]} tops out at level ${max}` };
  const price = upgradePrice(inst.type, target);

  inst.pendingLevel = target;
  inst.pendingFromCycle = next.cycle + 1;
  next.prosperity = clampProsperity(next.prosperity + 1);
  next.raisingEventThisCycle = true;
  const saved = await save(next, { prev, operationId: options.operationId });
  const savedInstitution = institutionRecordById(id, saved);

  await createVillageChat({
    content: `<div class="crows village-upgrade">
      <strong>${savedInstitution.name}</strong> pays ${price} gc for level <strong>${target}</strong>, operating from cycle ${savedInstitution.pendingFromCycle}.
      <div>Prosperity now <strong>${saved.prosperity}</strong>.</div>
    </div>`,
    speaker: { alias: "Village" }
  });
  return {
    ok: true, institution: cloneValue(savedInstitution), prosperity: saved.prosperity,
    price, operatingFromCycle: savedInstitution.pendingFromCycle
  };
}

/** Demote or destroy (C:2315, C:2316). A 1st-level institution is destroyed. */
export async function damageInstitution(id, {
  destroy = false, resolutionId = null, resolutionMetadata = null, metadata = null, operationId = null
} = {}) {
  const prev = getVillage();
  const next = cloneValue(prev);
  const idx = next.institutions.findIndex(i => i.id === id);
  if (idx < 0) return { ok: false, error: "no such institution" };
  const inst = next.institutions[idx];

  // A repeated destruction click is a read of the same ruin, not a second
  // write.  The id is intentionally retained for map reconciliation/retry.
  if (inst.destroyed) return { ok: true, destroyed: true, institution: cloneValue(inst), replayed: true };

  if (destroy || inst.level <= 1) {
    const destructionMetadata = resolutionMetadata ?? metadata;
    const destruction = resolutionId || destructionMetadata
      ? {
        ...(inst.destruction ?? {}),
        ...(resolutionId ? { resolutionId: String(resolutionId) } : {}),
        ...(destructionMetadata ? { metadata: cloneValue(destructionMetadata) } : {})
      } : inst.destruction ?? null;
    next.institutions[idx] = {
      ...inst,
      destroyed: true,
      destroyedOnCycle: next.cycle,
      destruction,
      destructionMetadata: cloneValue(destructionMetadata ?? inst.destructionMetadata ?? null),
      pendingLevel: null,
      pendingFromCycle: null
    };
    const saved = await save(next, { prev, operationId });
    const savedInstitution = institutionRecordById(id, saved);
    await createVillageChat({
      content: `<div class="crows village-destroyed"><strong>${savedInstitution.name}</strong> destroyed.</div>`,
      speaker: { alias: "Village" }
    });
    return { ok: true, destroyed: true, institution: cloneValue(savedInstitution) };
  }
  inst.level -= 1;
  if (inst.pendingLevel != null) inst.pendingLevel = Math.max(inst.level, inst.pendingLevel - 1);
  const saved = await save(next, { prev, operationId });
  const savedInstitution = institutionRecordById(id, saved);
  await createVillageChat({
    content: `<div class="crows village-damaged"><strong>${savedInstitution.name}</strong> damaged — level now ${savedInstitution.level}.</div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, destroyed: false, institution: cloneValue(savedInstitution) };
}

export async function setProsperity(value, { silent = false, operationId = null } = {}) {
  const prev = getVillage();
  const next = cloneValue(prev);
  const before = next.prosperity;
  next.prosperity = clampProsperity(value);
  if (next.prosperity > before) next.raisingEventThisCycle = true;
  const saved = await save(next, { prev, operationId });
  if (!silent) {
    await createVillageChat({
      content: `<div class="crows village-prosperity">Prosperity: ${before} &rarr; <strong>${saved.prosperity}</strong></div>`,
      speaker: { alias: "Village" }
    });
  }
  return saved.prosperity;
}

/**
 * Record a purchase from a merchant institution. Crossing 10,000 gc in a cycle
 * raises Prosperity by 1, once (C:2261).
 */
export async function recordSpend(amount, { silent = false, operationId = null } = {}) {
  const prev = getVillage();
  const next = cloneValue(prev);
  const result = recordMerchantSpend(next, amount);
  next.spentThisCycle = result.spentThisCycle;
  next.spendBonusAwarded = result.spendBonusAwarded;
  if (result.prosperityDelta) {
    next.prosperity = clampProsperity(next.prosperity + result.prosperityDelta);
    next.raisingEventThisCycle = true;
  }
  const saved = await save(next, { prev, operationId });
  if (result.prosperityDelta && !silent) {
    await createVillageChat({
      content: `<div class="crows village-prosperity">
        ${SPEND_FOR_PROSPERITY.toLocaleString()} gc spent with village merchants this cycle — Prosperity now <strong>${saved.prosperity}</strong>.
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return { ok: true, ...result, prosperity: saved.prosperity };
}

/* -------------------------------------------------------------------------- */
/*  Durable event resolution                                                  */
/* -------------------------------------------------------------------------- */

const VILLAGE_EVENT_PENDING_STATUSES = Object.freeze([
  "pending", "resolving", "blocked", "partial", "uncertain"
]);
const VILLAGE_EVENT_PENDING_STATUS_SET = new Set(VILLAGE_EVENT_PENDING_STATUSES);
const VILLAGE_EVENT_NONTERMINAL_OPERATION_PHASES = new Set([
  "prepared", "commerce-pending", "commerce-committed", "credit-pending",
  "spend-pending", "partial", "uncertain", "blocked"
]);
const VILLAGE_EVENT_TERMINAL_RECEIPT_PHASES = new Set(["committed", "abandoned"]);

function villageEventStatus(pending) {
  if (!pending) return null;
  const status = String(pending.status ?? "pending");
  return VILLAGE_EVENT_PENDING_STATUS_SET.has(status) ? status : "pending";
}

function villageEventBlock(village, { operationId = null } = {}) {
  const pending = village?.pendingEvent;
  const status = villageEventStatus(pending);
  if (status) {
    return {
      ok: false,
      error: `event-${status}`,
      code: `event-${status}`,
      reason: `event-${status}`,
      pendingEvent: cloneValue(pending)
    };
  }
  const entry = (village?.operationJournal ?? []).find(candidate =>
    candidate?.operationId !== operationId
      && VILLAGE_EVENT_NONTERMINAL_OPERATION_PHASES.has(String(candidate?.phase ?? ""))
  );
  if (!entry) return null;
  return {
    ok: false,
    error: String(entry.phase),
    code: String(entry.phase),
    reason: String(entry.phase),
    operation: cloneValue(entry)
  };
}

function eventResolutionToken(value) {
  const token = String(value ?? "").trim();
  return token || `village-resolution-${randomToken(16)}`;
}

function eventOperationToken(value, village, suffix) {
  const token = String(value ?? "").trim();
  return token || `village-${suffix}-${village.villageId}-${village.cycle}-${randomToken(10)}`;
}

function eventSelectionsValue(selections) {
  if (selections == null) return {};
  if (Array.isArray(selections)) return { institutionIds: selections };
  return typeof selections === "object" ? selections : {};
}

function eventSelectionFingerprint(selections) {
  const input = cloneValue(eventSelectionsValue(selections));
  // Target arrays represent sets.  Keep the operation token stable when a
  // Ref reopens a prepared card and presents the same roster in a different
  // visual order; the child executor still applies its own deterministic
  // Actor-UUID ordering.
  for (const key of ["institutionIds", "recipientActorUuids", "recipientUuids", "actorUuids",
    "pcUuids", "roster", "recipients", "actors", "targets"]) {
    if (Array.isArray(input[key])) input[key] = [...input[key]].map(value =>
      value && typeof value === "object" ? value.uuid ?? value.id ?? value.actorUuid ?? value.institutionId : value
    ).map(value => String(value ?? "")).sort();
  }
  return villageInputFingerprint(input);
}

function eventSelectionList(selections, ...keys) {
  const input = eventSelectionsValue(selections);
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const value = input[key];
    const values = Array.isArray(value) ? value : [value];
    return values.map(item => {
      if (item && typeof item === "object") return item.id ?? item.uuid ?? item.actorUuid ?? item.institutionId;
      return item;
    }).map(value => String(value ?? "").trim()).filter(Boolean);
  }
  return [];
}

function eventSelectedInstitutionIds(selections) {
  return [...new Set(eventSelectionList(
    selections,
    "institutionIds", "institutions", "institution", "targetInstitutionIds", "targets", "targetIds",
    "institutionId", "target", "id", "destroyInstitution", "destroyedInstitutionId"
  ))];
}

function eventSelectedRecipientUuids(selections) {
  const input = eventSelectionsValue(selections);
  const keys = ["recipientActorUuids", "recipientUuids", "actorUuids", "pcUuids", "pcs", "roster",
    "recipients", "actors", "actorUuid", "actorId"];
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const values = Array.isArray(input[key]) ? input[key] : [input[key]];
    return [...new Set(values.map(item => item && typeof item === "object"
      ? item.uuid ?? item.actorUuid ?? item.id : item)
      .map(value => String(value ?? "").trim()).filter(Boolean))];
  }
  return [];
}

function eventSelectedType(selections) {
  const input = eventSelectionsValue(selections);
  const value = input.institutionType ?? input.foundType ?? input.type ?? input.institution ?? "";
  return String(value && typeof value === "object" ? value.type ?? value.id ?? "" : value).trim();
}

function eventSelectedItemId(selections) {
  const input = eventSelectionsValue(selections);
  const item = input.item;
  return String(input.itemId ?? input.embeddedItemId ?? (item && typeof item === "object" ? item.id ?? item._id : item) ?? "").trim();
}

function eventSelectedDestroyId(selections) {
  const input = eventSelectionsValue(selections);
  const value = input.destroyInstitutionId ?? input.destroyedInstitutionId ?? input.destroyOne
    ?? input.destroyId ?? input.destroyInstitution ?? "";
  return String(value && typeof value === "object" ? value.id ?? value.institutionId ?? "" : value).trim();
}

function eventInputFingerprint({ resolutionId, selections, context } = {}) {
  if (typeof context?.inputFingerprint === "string" && context.inputFingerprint) {
    return context.inputFingerprint;
  }
  // Resolver functions, Actor collections, capacity, and other live context
  // are environment, not operation input.  Including them would make a
  // legitimate same-token repair (for example, a freed Commerce slot) look
  // like a new roster.  Callers that have an intentional stable input facet
  // may provide `fingerprintContext` explicitly.
  return villageInputFingerprint({
    resolutionId,
    selections: eventSelectionFingerprint(selections),
    context: context?.fingerprintContext ?? null
  });
}

function villageHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function villageEventD10(options = {}) {
  const supplied = options.rollD10 ?? options.d10 ?? options.roll ?? options.rng;
  if (typeof supplied === "function") {
    const result = await supplied(options);
    return Math.max(1, Math.min(10, Math.floor(Number(result?.total ?? result) || 0)));
  }
  if (supplied && typeof supplied === "object" && supplied.total != null) {
    return Math.max(1, Math.min(10, Math.floor(Number(supplied.total) || 0)));
  }
  if (supplied != null && Number.isFinite(Number(supplied))) {
    return Math.max(1, Math.min(10, Math.floor(Number(supplied))));
  }
  if (typeof globalThis.Roll !== "function") {
    throw new Error("village-event-dice-unavailable");
  }
  const result = await new globalThis.Roll("1d10").evaluate();
  return Math.max(1, Math.min(10, Math.floor(Number(result?.total) || 0)));
}

function villagePendingEvent(event, { rolled, total, cycle, resolutionId } = {}) {
  return {
    eventId: event?.id ?? null,
    id: event?.id ?? null,
    rolled: Math.max(1, Math.min(10, Math.floor(Number(rolled) || 0))),
    roll: Math.max(1, Math.min(10, Math.floor(Number(rolled) || 0))),
    total: Math.floor(Number(total) || 0),
    cycle: Math.max(0, Math.floor(Number(cycle) || 0)),
    resolutionId: resolutionId ?? null,
    status: "pending",
    selection: {},
    selections: {}
  };
}

function eventReceiptFor(village, resolutionId) {
  const token = String(resolutionId ?? "");
  // `eventReceipt` is the additive latest-receipt projection.  Prefer it when
  // a legacy/current setting contains both fields with the same token but
  // different timestamps; the per-resolution list is the recovery archive.
  if (String(village?.eventReceipt?.resolutionId ?? "") === token) {
    return cloneValue(village.eventReceipt);
  }
  const listed = (village?.eventReceipts ?? []).find(receipt =>
    String(receipt?.resolutionId ?? "") === token
  );
  if (listed) return cloneValue(listed);
  return null;
}

function putEventReceipt(next, receipt) {
  const token = String(receipt?.resolutionId ?? "");
  const receipts = (next.eventReceipts ?? []).filter(candidate =>
    String(candidate?.resolutionId ?? "") !== token
  );
  receipts.push(cloneValue(receipt));
  next.eventReceipts = receipts;
  next.eventReceipt = cloneValue(receipt);
}

function eventJournalEntry(next, {
  operationId, phase, expectedRevision, inputFingerprint, childOperationIds = [], result, originCycle
} = {}) {
  const entry = {
    operationId: String(operationId),
    action: "resolve-village-event",
    villageId: next.villageId,
    originCycle: originCycle ?? next.cycle,
    expectedRevision,
    inputFingerprint,
    phase,
    childOperationIds: [...new Set(childOperationIds.map(value => String(value)).filter(Boolean))],
    result: cloneValue(result),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    resultingRevision: next.revision,
    writerUserId: globalThis.game?.user?.id ?? null
  };
  next.operationJournal = [
    ...(next.operationJournal ?? []).filter(candidate => candidate.operationId !== entry.operationId),
    entry
  ];
  return entry;
}

function eventResult({ ok = false, error = null, phase = null, resolutionId, eventId, pendingEvent,
  receipt = null, normalizedEffects = [], childOperationIds = [], ...extra } = {}) {
  return {
    ok,
    ...(error ? { error } : {}),
    ...(phase ? { phase } : {}),
    resolutionId,
    eventId,
    ...(pendingEvent !== undefined ? { pendingEvent: cloneValue(pendingEvent) } : {}),
    ...(receipt ? { receipt: cloneValue(receipt) } : {}),
    normalizedEffects: cloneValue(normalizedEffects),
    childOperationIds: [...new Set(childOperationIds.map(value => String(value)).filter(Boolean))],
    ...extra
  };
}

function eventPicker({ kind, selectionKey, count = null, candidates = [], reason = "selection-required", ...extra } = {}) {
  return {
    kind,
    selectionKey,
    ...(count == null ? {} : { count }),
    reason,
    candidates: candidates.map(candidate => ({
      id: candidate.id,
      type: candidate.type,
      name: candidate.name,
      level: candidate.level,
      steward: candidate.steward
    })),
    ...extra
  };
}

function eventSelectionFailure(pending, event, picker, reason = "selection-required", extra = {}) {
  return eventResult({
    ok: false,
    error: reason,
    phase: "pending",
    resolutionId: pending?.resolutionId ?? null,
    eventId: event?.id ?? pending?.eventId ?? pending?.id ?? null,
    pendingEvent: pending,
    picker,
    requiresSelection: true,
    ...extra
  });
}

function eventInstitutionCandidates(village, kind, { excludeRetiredPC = false, context = {} } = {}) {
  const retired = new Set([
    ...(context.retiredPCUuids ?? []),
  ...(context.retiredActorUuids ?? []),
    ...(context.retiredPCs ?? [])
  ].map(value => String(value?.uuid ?? value?.id ?? value ?? "")));
  const isRetired = steward => retired.has(String(steward?.uuid ?? steward?.id ?? steward ?? ""))
    || steward?.retired === true || steward?.isRetired === true
    || (typeof context.isRetiredPC === "function" && context.isRetiredPC(steward));
  return liveInstitutionRecords(village).filter(institution => {
    const def = INSTITUTIONS[institution.type];
    if (kind === "merchant") return !!def?.roles?.includes("merchant");
    if (kind === "artisan") return !!def?.roles?.includes("artisan");
    if (excludeRetiredPC && isRetired(institution.steward)) return false;
    return true;
  });
}

function validateInstitutionSelection(village, selections, {
  kind = "any", count = 1, excludeRetiredPC = false, pickerKind = "institution", selectionKey = "institutionIds",
  allowEmpty = false, context = {}, event = null, pending = null
} = {}) {
  const candidates = eventInstitutionCandidates(village, kind, { excludeRetiredPC, context });
  const ids = eventSelectedInstitutionIds(selections);
  if (!ids.length && !allowEmpty) {
    return { ok: false, failure: eventSelectionFailure(pending, event, eventPicker({
      kind: pickerKind, selectionKey, count, candidates
    })) };
  }
  const unique = [...new Set(ids)];
  if (unique.length !== count) {
    return { ok: false, failure: eventSelectionFailure(pending, event, eventPicker({
      kind: pickerKind, selectionKey, count, candidates, reason: "exact-target-count"
    }), "exact-target-count", { selected: unique }) };
  }
  const candidateIds = new Set(candidates.map(candidate => String(candidate.id)));
  const invalid = unique.filter(id => !candidateIds.has(String(id)));
  if (invalid.length) {
    return {
      ok: false,
      failure: eventResult({ ok: false, error: "invalid-selection", phase: "pending",
        resolutionId: pending?.resolutionId ?? null, eventId: event?.id ?? null,
        pendingEvent: pending, invalid, selected: unique, eligible: candidates.map(candidate => candidate.id) })
    };
  }
  return { ok: true, ids: unique, candidates };
}

function eventActorItems(actor) {
  const items = actor?.items;
  if (typeof items?.values === "function") return [...items.values()];
  if (Array.isArray(items)) return [...items];
  if (items && typeof items[Symbol.iterator] === "function") return [...items];
  return [];
}

function eventActorItem(actor, itemId) {
  const items = actor?.items;
  if (typeof items?.get === "function") return items.get(itemId) ?? null;
  return eventActorItems(actor).find(item => String(item?.id ?? item?._id ?? "") === String(itemId)) ?? null;
}

async function resolveEventActor(uuid, context = {}) {
  const token = String(uuid ?? "").trim();
  if (!token) return null;
  const resolver = context.resolveActor ?? context.actorResolver ?? context.getActor;
  if (typeof resolver === "function") return resolver(token);
  const direct = context.actorByUuid?.[token] ?? (typeof context.actorByUuid?.get === "function" ? context.actorByUuid.get(token) : null);
  if (direct) return direct;
  const actors = context.actors ?? globalThis.game?.actors;
  if (typeof actors?.get === "function") {
    const found = actors.get(token);
    if (found) return found;
  }
  if (Array.isArray(actors)) return actors.find(actor => String(actor?.uuid ?? actor?.id ?? "") === token) ?? null;
  if (actors && typeof actors[Symbol.iterator] === "function") {
    return [...actors].map(value => Array.isArray(value) ? value[1] : value)
      .find(actor => String(actor?.uuid ?? actor?.id ?? "") === token) ?? null;
  }
  if (typeof globalThis.fromUuid === "function") {
    try { return await globalThis.fromUuid(token); } catch { return null; }
  }
  return null;
}

function eventActorUuid(actor, fallback = "") {
  return String(actor?.uuid ?? actor?.id ?? fallback ?? "").trim();
}

function eventItemIsMundane(item, context = {}) {
  if (!item) return false;
  if (typeof context.isMundaneItem === "function") return !!context.isMundaneItem(item);
  if (item.system?.magical === true || item.flags?.crows?.magical === true) return false;
  const itemClass = item.itemClass ?? item.system?.itemClass ?? item.system?.class
    ?? item.system?.rarity ?? null;
  if (itemClass == null) return true;
  return ["mundane", "common", "standard", "ordinary", "fine", "masterwork"].includes(String(itemClass).toLowerCase());
}

async function eventDeleteItem(actor, item, metadata, context = {}) {
  const executor = context.deleteItem ?? context.deleteEmbeddedItem ?? context.executeDeleteItem;
  try {
    if (typeof executor === "function") {
      return await executor(actor, item, metadata);
    }
    if (typeof actor?.deleteEmbeddedDocuments !== "function") {
      return { ok: false, error: "delete-unavailable", state: "unknown" };
    }
    await actor.deleteEmbeddedDocuments("Item", [item.id ?? item._id]);
    return { ok: true, phase: "committed", deleteId: metadata.deleteId };
  } catch (error) {
    return { ok: false, error: "write-failed", state: "unknown", message: String(error?.message ?? error) };
  }
}

function eventChildCommitted(result) {
  return !!result && result.ok !== false
    && !["prepared", "pending", "uncertain", "partial", "blocked"].includes(String(result.phase ?? ""))
    && result.status !== "uncertain"
    && result.status !== "pending"
    && result.state !== "unknown"
    && !result.reconciliationRequired;
}

function eventChildUncertain(result) {
  return !result || ["prepared", "pending", "uncertain", "partial"].includes(String(result.phase ?? ""))
    || result.state === "unknown"
    || result.status === "uncertain" || result.status === "pending"
    || result.reconciliationRequired || ["write-failed", "item-not-found", "timeout", "unknown"]
      .includes(String(result.error ?? ""));
}

function eventRecordBase(effect, event, resolutionId, village) {
  return {
    ...cloneValue(effect),
    eventId: event.id,
    resolutionId,
    cycle: village.cycle
  };
}

function eventTargetRecord(effect, event, resolutionId, village, institutionId) {
  return {
    ...eventRecordBase(effect, event, resolutionId, village),
    institutionId,
    target: institutionId
  };
}

function eventRecipientRecord(effect, event, resolutionId, village, actorUuid, extra = {}) {
  return {
    ...eventRecordBase(effect, event, resolutionId, village),
    ...extra,
    target: extra.target ?? actorUuid,
    beneficiaryActorUuid: actorUuid,
    recipientActorUuid: actorUuid
  };
}

function eventPendingWithSelection(pending, resolutionId, selections) {
  const selected = cloneValue(eventSelectionsValue(selections));
  return {
    ...cloneValue(pending),
    resolutionId: pending?.resolutionId ?? resolutionId,
    selection: selected,
    selections: selected
  };
}

/**
 * Resolve the Ref's explicit choices against one fresh Village snapshot.
 * Nothing in this function writes a setting, Actor, or Item.  In particular,
 * `scope: "all"` is expanded here, so the normalized receipt records the live
 * merchant ids that were actually affected rather than a future, moving scope.
 */
async function buildEventPlan(village, pending, selections, context, resolutionId) {
  const eventId = pending?.eventId ?? pending?.id;
  const event = VILLAGE_EVENTS.find(candidate => candidate.id === eventId) ?? null;
  if (!event) {
    return { ok: false, result: eventResult({
      ok: false, error: "unknown-event", resolutionId, eventId, pendingEvent: pending
    }) };
  }
  const effect = cloneValue(event.effect ?? {});
  const selected = eventPendingWithSelection(pending, resolutionId, selections);
  const plan = {
    event,
    effect,
    pending: selected,
    normalizedEffects: [],
    childOperationIds: [],
    children: [],
    preflightFailure: null,
    local: true
  };
  const failSelection = (failure) => ({ ok: false, result: failure });

  if (effect.kind === "destroyInstitution") {
    const picked = validateInstitutionSelection(village, selections, {
      count: Math.max(1, Math.floor(Number(effect.count) || 1)),
      event, pending: selected, context
    });
    if (!picked.ok) return failSelection(picked.failure);
    for (const institutionId of picked.ids) {
      plan.normalizedEffects.push(eventTargetRecord(effect, event, resolutionId, village, institutionId));
    }
    return { ok: true, plan };
  }

  if (effect.kind === "institutionLevel" && effect.destroyIfAllFirstLevel) {
    const picked = validateInstitutionSelection(village, selections, {
      count: 2, event, pending: selected, context,
      pickerKind: "institution-group", selectionKey: "institutionIds"
    });
    if (!picked.ok) return failSelection(picked.failure);
    const pair = picked.ids.map(id => institutionRecordById(id, village));
    const allFirstLevel = pair.every(institution => Number(institution?.level) === 1);
    if (allFirstLevel) {
      const destroyId = eventSelectedDestroyId(selections);
      if (!destroyId) {
        return failSelection(eventSelectionFailure(selected, event, eventPicker({
          kind: "institution-group-destroy-one",
          selectionKey: "destroyInstitutionId",
          count: 1,
          candidates: pair,
          reason: "secondary-destroy-selection",
          institutionIds: picked.ids,
          predicate: "all-first-level"
        }), "secondary-destroy-selection", { institutionIds: picked.ids }));
      }
      if (!picked.ids.includes(destroyId)) {
        return failSelection(eventResult({ ok: false, error: "invalid-selection", phase: "pending",
          resolutionId, eventId, pendingEvent: selected, invalid: [destroyId], eligible: picked.ids }));
      }
      plan.normalizedEffects.push({
        ...eventRecordBase(effect, event, resolutionId, village),
        kind: "monsterDamagesTwo",
        institutionIds: [...picked.ids],
        target: destroyId,
        destroyInstitutionId: destroyId,
        predicate: "all-first-level",
        outcome: "destroy-one"
      });
      return { ok: true, plan };
    }
    for (const institutionId of picked.ids) {
      plan.normalizedEffects.push({
        ...eventTargetRecord(effect, event, resolutionId, village, institutionId),
        institutionIds: [...picked.ids],
        predicate: "mixed-levels",
        outcome: "decrement-both"
      });
    }
    return { ok: true, plan };
  }

  if (effect.kind === "prosperity" && effect.destroyInstitutionIfAtFloor
      && village.prosperity <= PROSPERITY_MIN) {
    const picked = validateInstitutionSelection(village, selections, {
      count: 1, event, pending: selected, context,
      pickerKind: "institution-at-floor", selectionKey: "institutionId"
    });
    if (!picked.ok) return failSelection(picked.failure);
    plan.normalizedEffects.push({
      ...eventTargetRecord(effect, event, resolutionId, village, picked.ids[0]),
      kind: "destroyInstitution",
      predicate: "prosperity-floor"
    });
    return { ok: true, plan };
  }

  if (effect.kind === "prosperity") {
    plan.normalizedEffects.push({ ...eventRecordBase(effect, event, resolutionId, village) });
    return { ok: true, plan };
  }

  if (["merchantLevel", "outOfStockChance"].includes(effect.kind)) {
    const candidates = eventInstitutionCandidates(village, "merchant", { context });
    const picked = effect.scope === "all"
      ? { ok: true, ids: candidates.map(institution => institution.id), candidates }
      : validateInstitutionSelection(village, selections, {
        kind: "merchant", count: Math.max(1, Math.floor(Number(effect.count) || 1)),
        event, pending: selected, context, pickerKind: "merchant", selectionKey: "institutionId"
      });
    if (!picked.ok) return failSelection(picked.failure);
    if (!picked.ids.length) {
      return failSelection(eventResult({ ok: false, error: "no-live-target", phase: "pending",
        resolutionId, eventId, pendingEvent: selected }));
    }
    for (const institutionId of picked.ids) {
      plan.normalizedEffects.push(eventTargetRecord(effect, event, resolutionId, village, institutionId));
    }
    return { ok: true, plan };
  }

  if (effect.kind === "institutionLevel") {
    const picked = validateInstitutionSelection(village, selections, {
      count: Math.max(1, Math.floor(Number(effect.count) || 1)), event, pending: selected, context
    });
    if (!picked.ok) return failSelection(picked.failure);
    for (const institutionId of picked.ids) {
      const institution = institutionRecordById(institutionId, village);
      if (effect.onlyBelowLevel != null
          && Number(institution?.level) >= Number(effect.onlyBelowLevel)) {
        return failSelection(eventResult({ ok: false, error: "predicate-failed", phase: "pending",
          resolutionId, eventId, pendingEvent: selected, institutionId,
          predicate: `below-${effect.onlyBelowLevel}` }));
      }
      plan.normalizedEffects.push(eventTargetRecord(effect, event, resolutionId, village, institutionId));
    }
    return { ok: true, plan };
  }

  if (["ceaseOperations", "artisanShutdown", "craftingRollsPerDay"].includes(effect.kind)) {
    const kind = effect.kind === "artisanShutdown" || effect.kind === "craftingRollsPerDay" ? "artisan" : "any";
    const picked = validateInstitutionSelection(village, selections, {
      kind, count: Math.max(1, Math.floor(Number(effect.count) || 1)),
      excludeRetiredPC: !!effect.excludeRetiredPC, event, pending: selected, context
    });
    if (!picked.ok) return failSelection(picked.failure);
    for (const institutionId of picked.ids) {
      plan.normalizedEffects.push(eventTargetRecord(effect, event, resolutionId, village, institutionId));
    }
    return { ok: true, plan };
  }

  if (effect.kind === "sellPercentage" || effect.kind === "boycott") {
    plan.normalizedEffects.push(eventRecordBase(effect, event, resolutionId, village));
    return { ok: true, plan };
  }

  if (effect.kind === "credit") {
    const picked = validateInstitutionSelection(village, selections, {
      kind: "merchant", count: 1, event, pending: selected, context,
      selectionKey: "institutionId"
    });
    if (!picked.ok) return failSelection(picked.failure);
    const recipients = eventSelectedRecipientUuids(selections);
    if (!recipients.length) {
      return failSelection(eventSelectionFailure(selected, event, eventPicker({
        kind: "recipients", selectionKey: "recipientActorUuids", count: "one-or-more",
        candidates: context.rosterSuggestions ?? [], explicitOnly: true
      })));
    }
    for (const actorUuid of [...new Set(recipients)].sort()) {
      const creditId = `${resolutionId}:credit:${picked.ids[0]}:${actorUuid}`;
      plan.normalizedEffects.push(eventRecipientRecord(effect, event, resolutionId, village, actorUuid, {
        kind: "credit",
        creditId,
        institutionId: picked.ids[0],
        target: picked.ids[0],
        amountRemaining: Math.max(0, Math.floor(Number(effect.perPC) || 0)),
        expiresOnCycle: village.cycle,
        beneficiaryActorUuid: actorUuid
      }));
    }
    return { ok: true, plan };
  }

  if (effect.kind === "grantItem") {
    const recipients = eventSelectedRecipientUuids(selections);
    if (!recipients.length) {
      return failSelection(eventSelectionFailure(selected, event, eventPicker({
        kind: "recipients", selectionKey: "recipientActorUuids", count: "one-or-more",
        candidates: context.rosterSuggestions ?? [], explicitOnly: true
      })));
    }
    const uniqueRecipients = [...new Set(recipients)].sort();
    for (const actorUuid of uniqueRecipients) {
      const actor = await resolveEventActor(actorUuid, context);
      if (!actor) {
        plan.preflightFailure = { ok: false, error: "invalid-recipient", actorUuid };
      }
      const grantId = `${resolutionId}:grant:${actorUuid}`;
      plan.childOperationIds.push(grantId);
      plan.children.push({ kind: "grant", grantId, actorUuid, actor, source: effect.item });
      plan.normalizedEffects.push(eventRecipientRecord(effect, event, resolutionId, village, actorUuid, {
        kind: "grant",
        grantId,
        item: effect.item,
        commerceTxId: null
      }));
    }
    plan.local = false;
    return { ok: true, plan };
  }

  if (effect.kind === "destroyItem") {
    const input = eventSelectionsValue(selections);
    const itemSelection = input.item && typeof input.item === "object" ? input.item : {};
    const actorSelection = input.actor ?? input.actorUuid ?? input.actorId
      ?? itemSelection.actorUuid ?? itemSelection.parentUuid ?? "";
    const actorUuid = String(actorSelection && typeof actorSelection === "object"
      ? actorSelection.uuid ?? actorSelection.actorUuid ?? actorSelection.id ?? ""
      : actorSelection).trim();
    const itemId = eventSelectedItemId(selections);
    if (!actorUuid || !itemId) {
      return failSelection(eventSelectionFailure(selected, event, eventPicker({
        kind: "item", selectionKey: "actorUuid/itemId", count: 1, explicitOnly: true
      })));
    }
    const actor = await resolveEventActor(actorUuid, context);
    const item = actor ? eventActorItem(actor, itemId) : null;
    if (!actor) plan.preflightFailure = { ok: false, error: "invalid-recipient", actorUuid };
    else if (!item) plan.preflightFailure = { ok: false, error: "item-not-found", actorUuid, itemId };
    else if (!eventItemIsMundane(item, context)) {
      plan.preflightFailure = { ok: false, error: "invalid-source", reason: "item-not-mundane", actorUuid, itemId };
    }
    const deleteId = `${resolutionId}:delete:${actorUuid}:${itemId}`;
    plan.childOperationIds.push(deleteId);
    plan.children.push({ kind: "deleteItem", deleteId, actorUuid, actor, item, itemId });
    plan.normalizedEffects.push({
      ...eventRecordBase(effect, event, resolutionId, village),
      kind: "destroyItem", target: `${actorUuid}:${itemId}`, actorUuid, itemId,
      itemClass: "mundane", deleteId
    });
    plan.local = false;
    return { ok: true, plan };
  }

  if (effect.kind === "foundInstitution") {
    const type = eventSelectedType(selections);
    if (!INSTITUTIONS[type]) {
      return failSelection(eventSelectionFailure(selected, event, eventPicker({
        kind: "institution-type", selectionKey: "institutionType", count: 1,
        candidates: INSTITUTION_KEYS.map(key => ({ id: key, type: key, name: INSTITUTIONS[key].label })),
        reason: type ? "invalid-institution-type" : "selection-required"
      }), type ? "invalid-institution-type" : "selection-required"));
    }
    const existing = (village.institutions ?? []).find(institution => institution.type === type);
    const liveExisting = (village.institutions ?? []).find(institution => institution.type === type
      && isLiveInstitution(institution) && Number(institution.level) > 0);
    if (liveExisting) {
      return failSelection(eventResult({ ok: false, error: "institution-exists", phase: "pending",
        resolutionId, eventId, pendingEvent: selected, institution: liveExisting }));
    }
    plan.normalizedEffects.push({
      ...eventRecordBase(effect, event, resolutionId, village),
      kind: "foundInstitution", institutionType: type, type,
      target: type,
      name: eventSelectionsValue(selections).name ?? null,
      steward: eventSelectionsValue(selections).steward ?? ""
    });
    return { ok: true, plan };
  }

  return { ok: false, result: eventResult({ ok: false, error: "unsupported-effect", phase: "pending",
    resolutionId, eventId, pendingEvent: selected, effect: effect.kind }) };
}

function eventPendingOperationId(institution) {
  return institution?.pendingOperationId ?? institution?.pendingOperation
    ?? institution?.operationId ?? null;
}

function markEventLinkedOperation(next, institution, outcome, resolutionId) {
  const operationId = eventPendingOperationId(institution);
  if (!operationId) return;
  const entry = (next.operationJournal ?? []).find(candidate =>
    String(candidate?.operationId ?? "") === String(operationId)
  );
  if (!entry) return;
  entry.phase = "committed";
  entry.updatedAt = Date.now();
  entry.result = {
    ...(entry.result && typeof entry.result === "object" ? entry.result : {}),
    ok: true,
    resolutionId,
    pendingDisposition: outcome
  };
}

function markEventInstitutionDestroyed(next, institutionId, { resolutionId, eventId, reason = "event" } = {}) {
  const index = (next.institutions ?? []).findIndex(institution => institution.id === institutionId);
  if (index < 0) return null;
  const institution = next.institutions[index];
  if (institution.destroyed) return institution;
  const linkedOperationId = eventPendingOperationId(institution);
  next.institutions[index] = {
    ...institution,
    destroyed: true,
    destroyedOnCycle: next.cycle,
    pendingLevel: null,
    pendingFromCycle: null,
    pendingOperationId: null,
    pendingOperation: null,
    operationId: null,
    destruction: {
      ...(institution.destruction ?? {}),
      resolutionId,
      eventId,
      reason
    },
    destructionMetadata: { resolutionId, eventId, reason }
  };
  markEventLinkedOperation(next, institution, "superseded-by-destruction", resolutionId);
  // A direct mutation above clears the pointer before the helper can inspect
  // it, so mark the old operation explicitly as well.
  if (linkedOperationId) {
    const entry = (next.operationJournal ?? []).find(candidate =>
      String(candidate?.operationId ?? "") === String(linkedOperationId)
    );
    if (entry) {
      entry.phase = "committed";
      entry.updatedAt = Date.now();
      entry.result = {
        ...(entry.result && typeof entry.result === "object" ? entry.result : {}),
        ok: true,
        pendingDisposition: "superseded-by-destruction",
        resolutionId
      };
    }
  }
  return next.institutions[index];
}

function validEventPendingLevel(institution) {
  if (institution?.pendingLevel == null) return { valid: true, target: null };
  const raw = Math.max(0, Math.floor(Number(institution.level) || 0));
  const target = Math.floor(Number(institution.pendingLevel));
  const max = institutionPurchasableMaxLevel(institution.type);
  return {
    valid: Number.isInteger(target) && target > raw && target <= max,
    target,
    max,
    raw
  };
}

/** Apply a permanent event level delta to canonical raw institution state. */
function applyPermanentEventLevel(next, institutionId, delta, { resolutionId, eventId } = {}) {
  const index = (next.institutions ?? []).findIndex(institution => institution.id === institutionId);
  if (index < 0) return { ok: false, error: "no-such-institution" };
  const institution = next.institutions[index];
  const pending = validEventPendingLevel(institution);
  if (!pending.valid) {
    return { ok: false, error: "invalid-pending-level", institutionId, pendingLevel: institution.pendingLevel };
  }
  const amount = Math.floor(Number(delta) || 0);
  const oldLevel = Math.max(0, Math.floor(Number(institution.level) || 0));
  const nextLevel = Math.max(0, Math.min(institutionMaxLevel(institution.type), oldLevel + amount));
  const changed = { ...institution, level: nextLevel };

  if (nextLevel <= 0) {
    const linkedOperationId = eventPendingOperationId(institution);
    changed.pendingLevel = null;
    changed.pendingFromCycle = null;
    changed.pendingOperationId = null;
    changed.pendingOperation = null;
    changed.operationId = null;
    next.institutions[index] = changed;
    if (linkedOperationId) {
      const entry = (next.operationJournal ?? []).find(candidate =>
        String(candidate?.operationId ?? "") === String(linkedOperationId)
      );
      if (entry) {
        entry.phase = "committed";
        entry.updatedAt = Date.now();
        entry.result = {
          ...(entry.result && typeof entry.result === "object" ? entry.result : {}),
          ok: true, pendingDisposition: "superseded-by-closure", resolutionId
        };
      }
    }
    return { ok: true, institution: changed, oldLevel, newLevel: nextLevel,
      pendingDisposition: "superseded-by-closure" };
  }

  if (pending.target != null) {
    const shifted = Math.min(pending.max, pending.target + amount);
    if (shifted <= nextLevel) {
      // Policy (the book does not settle this collision): an intervening
      // free level absorbs the paid target.  The committed payment receives
      // no automatic refund.
      changed.pendingLevel = null;
      changed.pendingFromCycle = null;
      changed.pendingOperationId = null;
      changed.pendingOperation = null;
      changed.operationId = null;
      markEventLinkedOperation(next, institution, "fulfilled-by-event", resolutionId);
      changed.pendingDisposition = "fulfilled-by-event";
    } else {
      changed.pendingLevel = shifted;
      // The operation remains tied to its original paid-for cycle.  The event
      // can cap or absorb the target but never retimes it.
      changed.pendingFromCycle = institution.pendingFromCycle ?? null;
      changed.pendingOperationId = institution.pendingOperationId ?? institution.pendingOperation
        ?? institution.operationId ?? null;
    }
  }
  next.institutions[index] = changed;
  return { ok: true, institution: changed, oldLevel, newLevel: nextLevel,
    pendingDisposition: changed.pendingDisposition ?? "shifted" };
}

function appendEventActiveEffect(next, effect) {
  const record = cloneValue(effect);
  const duplicate = (next.activeEffects ?? []).some(existing =>
    String(existing?.resolutionId ?? "") === String(record?.resolutionId ?? "")
      && String(existing?.kind ?? "") === String(record?.kind ?? "")
      && String(existing?.target ?? existing?.institutionId ?? "") === String(record?.target ?? record?.institutionId ?? "")
      && String(existing?.beneficiaryActorUuid ?? "") === String(record?.beneficiaryActorUuid ?? "")
  );
  if (!duplicate) next.activeEffects = [...(next.activeEffects ?? []), record];
}

function applyVillagersFoundEvent(next, effect, { resolutionId, eventId } = {}) {
  const type = effect.institutionType ?? effect.type;
  const def = INSTITUTIONS[type];
  if (!def) return { ok: false, error: "unknown-institution", type };
  const existingIndex = (next.institutions ?? []).findIndex(institution => institution.type === type);
  const existing = existingIndex < 0 ? null : next.institutions[existingIndex];
  if (existing && isLiveInstitution(existing) && Number(existing.level) > 0) {
    return { ok: false, error: "institution-exists", institution: cloneValue(existing) };
  }
  const revived = {
    ...(existing ?? {}),
    id: existing?.id ?? `inst-${randomToken(10)}`,
    type,
    name: effect.name ?? existing?.name ?? def.label,
    steward: effect.steward ?? existing?.steward ?? "",
    level: 1,
    foundedOnCycle: next.cycle,
    operatingFromCycle: next.cycle + 1,
    pendingLevel: null,
    pendingFromCycle: null,
    pendingOperationId: null,
    destroyed: false,
    destroyedOnCycle: null,
    destruction: null,
    destructionMetadata: null,
    foundedBy: "villagersFound",
    foundingResolutionId: resolutionId,
    foundingEventId: eventId
  };
  if (existingIndex < 0) next.institutions.push(revived);
  else next.institutions[existingIndex] = revived;
  // This lower-level event mutation deliberately does not touch prosperity,
  // raisingEventThisCycle, or boycott.  The villagers supplied the money;
  // only a PC/Party-funded founding gets those paid-investment side effects.
  return { ok: true, institution: revived };
}

/** Apply all Village-local effects after the complete plan is known. */
function applyEventLocalPlan(next, plan, { resolutionId } = {}) {
  const result = { effects: [], institutions: [], prosperity: next.prosperity };
  for (const effect of plan.normalizedEffects ?? []) {
    const kind = effect.kind;
    if (kind === "grant" || kind === "destroyItem") continue;

    if (kind === "monsterDamagesTwo") {
      const pair = effect.institutionIds ?? [];
      if (effect.outcome === "destroy-one") {
        const destroyed = markEventInstitutionDestroyed(next, effect.destroyInstitutionId, {
          resolutionId, eventId: plan.event.id, reason: "monsterDamagesTwo"
        });
        if (destroyed) result.institutions.push(cloneValue(destroyed));
      } else {
        for (const institutionId of pair) {
          const transition = applyPermanentEventLevel(next, institutionId, -1, {
            resolutionId, eventId: plan.event.id
          });
          if (!transition.ok) return transition;
          result.institutions.push(cloneValue(transition.institution));
        }
      }
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "destroyInstitution") {
      const destroyed = markEventInstitutionDestroyed(next, effect.institutionId ?? effect.target, {
        resolutionId, eventId: plan.event.id, reason: effect.predicate ?? "event"
      });
      if (destroyed) result.institutions.push(cloneValue(destroyed));
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "institutionLevel") {
      const institution = institutionRecordById(effect.institutionId ?? effect.target, next);
      if (!institution) return { ok: false, error: "no-such-institution", institutionId: effect.institutionId };
      if (effect.destroyIfFirstLevel && Number(institution.level) <= 1) {
        const destroyed = markEventInstitutionDestroyed(next, institution.id, {
          resolutionId, eventId: plan.event.id, reason: "destroyIfFirstLevel"
        });
        if (destroyed) result.institutions.push(cloneValue(destroyed));
      } else if (effect.duration === "permanent") {
        const transition = applyPermanentEventLevel(next, institution.id, effect.delta, {
          resolutionId, eventId: plan.event.id
        });
        if (!transition.ok) return transition;
        result.institutions.push(cloneValue(transition.institution));
      } else {
        appendEventActiveEffect(next, effect);
      }
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "merchantLevel" || kind === "outOfStockChance"
        || kind === "ceaseOperations" || kind === "artisanShutdown"
        || kind === "craftingRollsPerDay") {
      appendEventActiveEffect(next, effect);
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "sellPercentage" || kind === "boycott") {
      appendEventActiveEffect(next, effect);
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "credit") {
      appendEventActiveEffect(next, effect);
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "foundInstitution") {
      const founded = applyVillagersFoundEvent(next, effect, {
        resolutionId, eventId: plan.event.id
      });
      if (!founded.ok) return founded;
      result.institutions.push(cloneValue(founded.institution));
      result.effects.push(cloneValue(effect));
      continue;
    }

    if (kind === "prosperity") {
      if (Number(effect.delta) > 0) next.raisingEventThisCycle = true;
      if (next.prosperity >= PROSPERITY_MAX && effect.atCapInstead) {
        appendEventActiveEffect(next, {
          ...eventRecordBase(effect.atCapInstead, plan.event, resolutionId, next),
          ...cloneValue(effect.atCapInstead),
          kind: effect.atCapInstead.kind,
          scope: effect.atCapInstead.scope ?? "all"
        });
      } else {
        next.prosperity = clampProsperity(next.prosperity + Math.floor(Number(effect.delta) || 0));
      }
      result.prosperity = next.prosperity;
      result.effects.push(cloneValue(effect));
      continue;
    }
  }
  result.prosperity = next.prosperity;
  return { ok: true, ...result };
}

function eventGrantFunction(context = {}) {
  if (typeof context.grantItem === "function") return context.grantItem;
  if (typeof context.commerce?.grantItem === "function") return context.commerce.grantItem.bind(context.commerce);
  if (typeof context.commerceGrantItem === "function") return context.commerceGrantItem;
  if (typeof globalThis.game?.crows?.commerce?.grantItem === "function") {
    return globalThis.game.crows.commerce.grantItem.bind(globalThis.game.crows.commerce);
  }
  if (typeof globalThis.game?.crows?.grantItem === "function") return globalThis.game.crows.grantItem;
  return null;
}

function eventGrantPreflightFunction(context = {}) {
  if (typeof context.preflightGrant === "function") return context.preflightGrant;
  if (typeof context.commerce?.preflightGrant === "function") return context.commerce.preflightGrant.bind(context.commerce);
  const grant = eventGrantFunction(context);
  if (typeof grant?.preflight === "function") return grant.preflight.bind(grant);
  return null;
}

async function preflightEventChild(child, plan, context = {}) {
  if (child.kind === "deleteItem") {
    if (!child.actor) return { ok: false, error: "invalid-recipient", actorUuid: child.actorUuid };
    if (!child.item) {
      return { ok: false, error: "conflict", code: "item-not-found", state: "unknown",
        reconciliationRequired: true, actorUuid: child.actorUuid, itemId: child.itemId };
    }
    if (!eventItemIsMundane(child.item, context)) {
      return { ok: false, error: "invalid-source", reason: "item-not-mundane", itemId: child.itemId };
    }
    return { ok: true, phase: "preflight" };
  }
  if (child.kind !== "grant") return { ok: true, phase: "preflight" };
  if (!child.actor) return { ok: false, error: "invalid-recipient", actorUuid: child.actorUuid };
  const grant = eventGrantFunction(context);
  if (!grant) return { ok: false, error: "commerce-unavailable" };

  let source = child.source;
  const resolveSource = context.resolveGrantSource ?? context.resolveItemSource
    ?? context.commerce?.resolveGrantSource;
  if (typeof resolveSource === "function") {
    try {
      source = await resolveSource.call(context.commerce, source, { actor: child.actor, event: plan.event });
    } catch (error) {
      return { ok: false, error: "invalid-source", message: String(error?.message ?? error) };
    }
    if (!source) return { ok: false, error: "invalid-source" };
  }
  child.source = source;

  const preflight = eventGrantPreflightFunction(context);
  if (!preflight) return { ok: true, phase: "preflight", assumed: true };
  try {
    const result = await preflight(child.actor, source, {
      operationId: child.grantId,
      txId: child.grantId,
      grantId: child.grantId,
      source,
      item: source,
      resolutionId: plan.pending.resolutionId,
      eventId: plan.event.id,
      actorUuid: child.actorUuid,
      context
    });
    if (result === false) return { ok: false, error: "no-capacity" };
    if (result && typeof result === "object") return result;
    return { ok: true, phase: "preflight" };
  } catch (error) {
    return { ok: false, error: "write-failed", state: "unknown", message: String(error?.message ?? error) };
  }
}

function eventReceiptChild(receipt, childId) {
  return (receipt?.childResults ?? []).find(child => String(child?.childOperationId ?? child?.id ?? "") === String(childId)) ?? null;
}

function updateEventReceiptChild(receipt, childId, result, extra = {}) {
  const children = (receipt.childResults ?? []).filter(child =>
    String(child?.childOperationId ?? child?.id ?? "") !== String(childId)
  );
  children.push({ childOperationId: childId, ...cloneValue(extra), result: cloneValue(result),
    phase: result?.phase ?? (eventChildUncertain(result) ? "uncertain"
      : result?.ok === false ? "refused" : "committed"), updatedAt: Date.now() });
  receipt.childResults = children;
  return receipt;
}

function eventReceiptForPlan(village, plan, {
  resolutionId, expectedRevision, inputFingerprint, phase = "prepared", result = null
} = {}) {
  const existing = eventReceiptFor(village, resolutionId);
  const receipt = existing ?? {
    resolutionId,
    eventId: plan.event.id,
    villageId: village.villageId,
    createdAt: Date.now()
  };
  receipt.eventId = plan.event.id;
  receipt.villageId = village.villageId;
  receipt.expectedRevision = expectedRevision;
  receipt.inputFingerprint = inputFingerprint;
  receipt.villageRevision = village.revision;
  receipt.revision = village.revision;
  receipt.preStateFingerprint ??= villageInputFingerprint(village);
  receipt.phase = phase;
  receipt.selections = cloneValue(plan.pending.selection ?? {});
  const priorEffects = receipt.normalizedEffects ?? [];
  receipt.normalizedEffects = cloneValue(plan.normalizedEffects ?? []).map(effect => {
    const identity = effect?.grantId ?? effect?.deleteId
      ?? `${effect?.kind ?? ""}:${effect?.institutionId ?? effect?.target ?? ""}`;
    const previous = priorEffects.find(candidate => {
      const previousIdentity = candidate?.grantId ?? candidate?.deleteId
        ?? `${candidate?.kind ?? ""}:${candidate?.institutionId ?? candidate?.target ?? ""}`;
      return String(previousIdentity) === String(identity);
    });
    return previous ? { ...effect, ...Object.fromEntries(["commerceTxId", "childResult"].filter(key =>
      previous[key] !== undefined).map(key => [key, cloneValue(previous[key])])) } : effect;
  });
  receipt.childOperationIds = [...new Set((plan.childOperationIds ?? []).map(value => String(value)))];
  receipt.result = cloneValue(result);
  receipt.updatedAt = Date.now();
  return receipt;
}

/** Persist one managed event phase from inside the shared Village queue. */
async function persistManagedEventPhase(next, previous, {
  operationId, expectedRevision, inputFingerprint, phase, receipt, result, originCycle
} = {}) {
  const authority = authorityFailure();
  if (authority) return { ok: false, failure: authority };
  const live = getVillage();
  if (live.villageId !== previous.villageId || live.revision !== previous.revision) {
    return {
      ok: false,
      failure: { ok: false, error: "conflict", code: "stale-revision", reason: "stale-revision",
        retryable: true, expectedRevision: previous.revision, currentRevision: live.revision }
    };
  }
  const candidate = normalizeVillage(next, { identity: { villageId: live.villageId, sceneSeed: live.sceneSeed } });
    const ownedReceipt = cloneValue(receipt);
    ownedReceipt.phase = phase;
    ownedReceipt.villageRevision = live.revision + 1;
    ownedReceipt.revision = ownedReceipt.villageRevision;
    ownedReceipt.result = cloneValue(result);
    ownedReceipt.updatedAt = Date.now();
  putEventReceipt(candidate, ownedReceipt);
  const priorJournal = (candidate.operationJournal ?? []).find(entry =>
    String(entry?.operationId ?? "") === String(operationId)
  );
  const journal = eventJournalEntry(candidate, {
    operationId, phase, expectedRevision, inputFingerprint,
    childOperationIds: ownedReceipt.childOperationIds ?? [], result,
    originCycle: originCycle ?? candidate.cycle
  });
  journal.createdAt = priorJournal?.createdAt ?? journal.createdAt;
  journal.resultingRevision = live.revision + 1;
  try {
    const saved = await saveVillage(candidate, {
      prev: live, operationId, action: "resolve-village-event"
    });
    // `persistManagedEventPhase` intentionally runs inside the shared queue,
    // but its write is still an independent setting operation.  Re-check the
    // designated GM after acknowledgement so a handover in this residual
    // window is reported as unknown for reconciliation, just like the
    // generic queue's own writer check.
    const activeAfterWrite = activeVillageGM();
    if (!activeAfterWrite || !isVillageDesignatedWriter()) {
      return {
        ok: false,
        failure: { ok: false, error: "write-failed", state: "unknown",
          reconciliationRequired: true, operationId,
          reason: "gm-transition-overlap", village: saved }
      };
    }
    return { ok: true, village: saved, receipt: eventReceiptFor(saved, operationId) ?? ownedReceipt };
  } catch (error) {
    return { ok: false, failure: { ok: false, error: "write-failed", state: "unknown",
      reconciliationRequired: true, operationId,
      message: String(error?.message ?? error) } };
  }
}

function managedEventOutcome({ next, receipt, result, phase, pendingStatus, plan, operationId,
  expectedRevision, inputFingerprint } = {}) {
  const pending = next.pendingEvent ? cloneValue(next.pendingEvent) : null;
  if (pending && pendingStatus) pending.status = pendingStatus;
  if (pending) {
    pending.resolutionId = pending.resolutionId ?? operationId;
    pending.selection = cloneValue(plan?.pending?.selection ?? pending.selection ?? {});
    pending.selections = cloneValue(pending.selection);
    next.pendingEvent = pending;
  }
  const ownedReceipt = cloneValue(receipt);
  ownedReceipt.phase = phase;
  // The enclosing queue will advance this snapshot by one revision when it
  // persists the managed outcome.  Record the revision the receipt will have
  // after that write, rather than leaving blocked/preflight receipts pointing
  // at the stale pre-operation revision.
  ownedReceipt.villageRevision = next.revision + 1;
  ownedReceipt.revision = ownedReceipt.villageRevision;
  ownedReceipt.result = cloneValue(result);
  ownedReceipt.updatedAt = Date.now();
  putEventReceipt(next, ownedReceipt);
  const eventResultValue = {
    ...cloneValue(result),
    operationId,
    resolutionId: operationId,
    eventId: plan?.event?.id ?? next.pendingEvent?.eventId ?? null,
    phase,
    receipt: cloneValue(ownedReceipt),
    pendingEvent: cloneValue(next.pendingEvent),
    normalizedEffects: cloneValue(ownedReceipt.normalizedEffects ?? []),
    childOperationIds: cloneValue(ownedReceipt.childOperationIds ?? [])
  };
  eventJournalEntry(next, {
    operationId, phase, expectedRevision, inputFingerprint,
    childOperationIds: ownedReceipt.childOperationIds ?? [], result: eventResultValue,
    originCycle: plan?.pending?.cycle ?? next.cycle
  });
  return { next, result: eventResultValue, phase, terminal: VILLAGE_EVENT_TERMINAL_RECEIPT_PHASES.has(phase) };
}

/**
 * Persist an uncertain managed phase after a prior saga write has already
 * advanced the Village revision.  The generic queue deliberately compares
 * against the snapshot it captured before the saga began, so handing this
 * outcome back to that writer would produce a false stale-revision conflict.
 * Re-enter the same setting choke point with the live snapshot instead.
 */
async function persistManagedUncertainOutcome({ receipt, result, plan, resolutionId,
  expectedRevision, inputFingerprint } = {}) {
  const live = getVillage();
  const landedReceipt = eventReceiptFor(live, resolutionId);
  if (!live.pendingEvent && landedReceipt?.phase === "committed") {
    // A setting adapter may have applied the final snapshot before losing its
    // acknowledgement.  Do not write an artificial pending/uncertain state
    // over that durable terminal proof: replaying the event would otherwise
    // apply permanent levels a second time.
    return { persist: false, persisted: true, result: {
      ...cloneValue(result), ok: false, phase: "uncertain", state: "unknown",
      reconciliationRequired: true, receipt: cloneValue(landedReceipt), pendingEvent: null
    } };
  }
  const next = cloneValue(live);
  next.pendingEvent = {
    ...cloneValue(plan.pending), status: "uncertain", resolutionId,
    selection: cloneValue(plan.pending.selection), selections: cloneValue(plan.pending.selection)
  };
  const written = await persistManagedEventPhase(next, live, {
    operationId: resolutionId, expectedRevision, inputFingerprint, phase: "uncertain",
    receipt, result, originCycle: plan.pending.cycle
  });
  if (!written.ok) {
    return { persist: false, result: {
      ...cloneValue(result), ok: false, error: written.failure?.error ?? "write-failed",
      phase: "uncertain", state: "unknown", reconciliationRequired: true,
      receipt: cloneValue(receipt), pendingEvent: cloneValue(next.pendingEvent)
    } };
  }
  return { persist: false, persisted: true, result: {
    ...cloneValue(result), ok: false, phase: "uncertain", state: "unknown",
    reconciliationRequired: true, receipt: written.receipt ?? cloneValue(receipt),
    pendingEvent: cloneValue(written.village.pendingEvent)
  } };
}

async function executeManagedEventPlan(village, plan, {
  resolutionId, expectedRevision, inputFingerprint, context = {}
} = {}) {
  const priorReceipt = eventReceiptFor(village, resolutionId);
  const existingChildCount = (priorReceipt?.childResults ?? []).filter(child =>
    String(child?.phase ?? "") === "committed" || eventChildCommitted(child?.result)
  ).length;

  // A delete may have committed before the Actor acknowledgement or final
  // Village write was lost.  An item that is now absent is a terminal success
  // only when the matching delete child receipt proves that exact operation;
  // an unreceipted absence remains a refusal/repair case.
  if (plan.preflightFailure && priorReceipt) {
    const provedChild = (plan.children ?? []).find(child => {
      const childId = child.grantId ?? child.deleteId;
      return childId && eventChildCommitted(eventReceiptChild(priorReceipt, childId)?.result);
    });
    if (provedChild && plan.preflightFailure.error === "item-not-found") plan.preflightFailure = null;
  }

  if (plan.local) {
    const next = cloneValue(village);
    const applied = applyEventLocalPlan(next, plan, { resolutionId });
    if (!applied.ok) {
      return {
        persist: false,
        result: eventResult({ ok: false, error: applied.error ?? "event-apply-refused",
          phase: "pending", resolutionId, eventId: plan.event.id,
          pendingEvent: plan.pending, ...applied })
      };
    }
    next.pendingEvent = null;
    const receipt = eventReceiptForPlan(village, plan, {
      resolutionId, expectedRevision, inputFingerprint, phase: "committed"
    });
    receipt.villageRevision = next.revision + 1;
    receipt.revision = receipt.villageRevision;
    const result = eventResult({
      ok: true,
      phase: "committed",
      resolutionId,
      eventId: plan.event.id,
      cycle: next.cycle,
      prosperity: next.prosperity,
      normalizedEffects: plan.normalizedEffects,
      childOperationIds: plan.childOperationIds,
      applied: { ...applied, effects: applied.effects ?? [] }
    });
    receipt.result = cloneValue(result);
    putEventReceipt(next, receipt);
    return { next, result, phase: "committed", terminal: true };
  }

  // All external children are preflighted before any one is allowed to write.
  // On a retry, an already committed child is proved by its durable child
  // result and is not preflighted or replayed.
  const unresolvedChildren = plan.children.filter(child => {
    const prior = eventReceiptChild(priorReceipt, child.grantId ?? child.deleteId);
    return !eventChildCommitted(prior?.result) && prior?.phase !== "committed";
  });
  let preflightFailure = null;
  for (const child of unresolvedChildren) {
    // Keep probing the complete frozen roster even after the first refusal;
    // the Ref needs one all-recipient preflight result before any grant write.
    let preflight = null;
    if (plan.preflightFailure && String(plan.preflightFailure.actorUuid ?? "") === String(child.actorUuid ?? "")) {
      preflight = plan.preflightFailure;
    } else preflight = await preflightEventChild(child, plan, context);
    if (preflight?.ok === false && !preflightFailure) {
      preflightFailure = { child, result: preflight };
    }
  }
  if (preflightFailure) {
    const { child, result: preflight } = preflightFailure;
    const phase = existingChildCount ? "partial" : eventChildUncertain(preflight) ? "uncertain" : "blocked";
    const pendingStatus = phase;
    const next = cloneValue(village);
    const receipt = eventReceiptForPlan(village, plan, {
      resolutionId, expectedRevision, inputFingerprint, phase
    });
    updateEventReceiptChild(receipt, child.grantId ?? child.deleteId, preflight, {
      actorUuid: child.actorUuid, itemId: child.itemId, grantId: child.grantId, deleteId: child.deleteId
    });
    const resultValue = eventResult({
      ok: false,
      error: preflight.error ?? (phase === "uncertain" ? "write-failed" : "preflight-refused"),
      phase,
      resolutionId,
      eventId: plan.event.id,
      state: phase === "uncertain" ? "unknown" : undefined,
      normalizedEffects: receipt.normalizedEffects,
      childOperationIds: receipt.childOperationIds,
      actorUuid: child.actorUuid,
      itemId: child.itemId,
      reason: preflight.reason
    });
    return managedEventOutcome({ next, receipt, result: resultValue, phase, pendingStatus, plan,
      operationId: resolutionId, expectedRevision, inputFingerprint });
  }

  // If this is the first physical child, persist the immutable prepared
  // roster/plan before calling Commerce or deleting an embedded Item.
  let current = getVillage();
  if (!priorReceipt && current.revision !== village.revision) {
    // Preflight is intentionally awaited before the prepared write.  A new
    // token must still honor the revision captured by the queue before that
    // wait; do not rebase a stale target plan onto a remote Village update.
    return { persist: false, result: {
      ok: false, error: "conflict", code: "stale-revision", reason: "stale-revision",
      stale: true, retryable: true, resolutionId, expectedRevision,
      currentRevision: current.revision, childOperationIds: plan.childOperationIds
    } };
  }
  let receipt = eventReceiptForPlan(current, plan, {
    resolutionId, expectedRevision, inputFingerprint, phase: priorReceipt?.phase ?? "prepared"
  });
  if (!priorReceipt || !["prepared", "partial", "uncertain"].includes(String(priorReceipt.phase))) {
    receipt.phase = "prepared";
  }
  const preparedNext = cloneValue(current);
  preparedNext.pendingEvent = {
    ...cloneValue(plan.pending),
    status: "resolving",
    resolutionId,
    selection: cloneValue(plan.pending.selection),
    selections: cloneValue(plan.pending.selection)
  };
  receipt.phase = "prepared";
  const preparedResult = eventResult({ ok: false, phase: "prepared", resolutionId,
    eventId: plan.event.id, normalizedEffects: receipt.normalizedEffects,
    childOperationIds: receipt.childOperationIds });
  const preparedWrite = await persistManagedEventPhase(preparedNext, current, {
    operationId: resolutionId, expectedRevision, inputFingerprint, phase: "prepared",
    receipt, result: preparedResult, originCycle: plan.pending.cycle
  });
  if (!preparedWrite.ok) {
    const result = eventResult({ ok: false, error: preparedWrite.failure?.error ?? "write-failed",
      phase: "uncertain", resolutionId, eventId: plan.event.id, state: "unknown",
      reconciliationRequired: true, normalizedEffects: receipt.normalizedEffects,
      childOperationIds: receipt.childOperationIds });
    // The prepared write may have failed before any receipt was durable.  Let
    // the enclosing queue make one last ordinary uncertain write so this
    // outcome is not silently collapsed into a non-persisting return.
    return persistManagedUncertainOutcome({ receipt, result, plan, resolutionId,
      expectedRevision, inputFingerprint });
  }
  current = preparedWrite.village;
  receipt = preparedWrite.receipt ?? eventReceiptForPlan(current, plan, {
    resolutionId, expectedRevision, inputFingerprint, phase: "prepared"
  });

  const committedChildren = [];
  for (const child of plan.children) {
    const childId = child.grantId ?? child.deleteId;
    const previousChild = eventReceiptChild(receipt, childId);
    if (eventChildCommitted(previousChild?.result) || previousChild?.phase === "committed") {
      committedChildren.push(childId);
      continue;
    }
    let childResult;
    if (child.kind === "grant") {
      const grant = eventGrantFunction(context);
      const latestActor = await resolveEventActor(child.actorUuid, context);
      if (!latestActor) {
        childResult = { ok: false, error: "invalid-recipient", state: "unknown",
          reconciliationRequired: true, actorUuid: child.actorUuid };
      } else {
        child.actor = latestActor;
        try {
          childResult = await grant(latestActor, child.source, {
            operationId: child.grantId,
            txId: child.grantId,
            grantId: child.grantId,
            source: child.source,
            item: child.source,
            resolutionId,
            eventId: plan.event.id,
            actorUuid: child.actorUuid,
            context
          });
        } catch (error) {
          childResult = { ok: false, error: "write-failed", state: "unknown",
            message: String(error?.message ?? error) };
        }
      }
    } else {
      // Embedded Items are addressed by (parent Actor UUID, item id), not by
      // a stale object captured while the Ref picker was open.  Re-resolve
      // both immediately before the delete.  A disappearance without this
      // delete's durable receipt is an uncertain/conflict outcome; only the
      // committed-child branch above can prove an already-missing Item was
      // removed by this exact operation.
      const latestActor = await resolveEventActor(child.actorUuid, context);
      const latestItem = latestActor ? eventActorItem(latestActor, child.itemId) : null;
      if (!latestActor || !latestItem) {
        childResult = {
          ok: false, error: "item-not-found", code: "item-missing-before-delete",
          state: "unknown", reconciliationRequired: true,
          actorUuid: child.actorUuid, itemId: child.itemId
        };
      } else if (!eventItemIsMundane(latestItem, context)) {
        childResult = { ok: false, error: "invalid-source", reason: "item-not-mundane",
          actorUuid: child.actorUuid, itemId: child.itemId };
      } else {
        childResult = await eventDeleteItem(latestActor, latestItem, {
          deleteId: child.deleteId, operationId: child.deleteId, resolutionId,
          eventId: plan.event.id, actorUuid: child.actorUuid, itemId: child.itemId
        }, context);
      }
    }
    const commerceTxId = childResult?.commerceTxId ?? childResult?.txId ?? childResult?.receipt?.txId
      ?? (eventChildCommitted(childResult) && child.kind === "grant" ? childId : null);
    updateEventReceiptChild(receipt, childId, childResult, {
      actorUuid: child.actorUuid,
      itemId: child.itemId,
      grantId: child.grantId,
      deleteId: child.deleteId,
      commerceTxId
    });
    const normalized = receipt.normalizedEffects.find(effect =>
      String(effect?.grantId ?? effect?.deleteId ?? "") === String(childId)
    );
    if (normalized) {
      if (child.kind === "grant") {
        const commerceTxId = childResult?.commerceTxId ?? childResult?.txId
          ?? childResult?.receipt?.txId;
        if (commerceTxId != null) normalized.commerceTxId = commerceTxId;
        else if (eventChildCommitted(childResult)) {
          normalized.commerceTxId = normalized.commerceTxId ?? childId;
        }
      }
      normalized.childResult = cloneValue(childResult);
    }
    if (eventChildCommitted(childResult)) {
      committedChildren.push(childId);
      const progress = eventResult({ ok: false, phase: "prepared", resolutionId,
        eventId: plan.event.id, normalizedEffects: receipt.normalizedEffects,
        childOperationIds: receipt.childOperationIds, childResults: receipt.childResults });
      const progressNext = cloneValue(getVillage());
      progressNext.pendingEvent = { ...cloneValue(plan.pending), status: "resolving",
        resolutionId, selection: cloneValue(plan.pending.selection), selections: cloneValue(plan.pending.selection) };
      const progressWrite = await persistManagedEventPhase(progressNext, current, {
        operationId: resolutionId, expectedRevision, inputFingerprint, phase: "prepared",
        receipt, result: progress, originCycle: plan.pending.cycle
      });
      if (!progressWrite.ok) {
        const result = eventResult({ ok: false, error: "write-failed", phase: "uncertain",
          resolutionId, eventId: plan.event.id, state: "unknown", reconciliationRequired: true,
          normalizedEffects: receipt.normalizedEffects,
          childOperationIds: receipt.childOperationIds, childResults: receipt.childResults });
        return persistManagedUncertainOutcome({ receipt, result, plan, resolutionId,
          expectedRevision, inputFingerprint });
      }
      current = progressWrite.village;
      receipt = progressWrite.receipt ?? receipt;
      continue;
    }

    const uncertain = eventChildUncertain(childResult);
    const phase = uncertain ? "uncertain" : committedChildren.length ? "partial" : "blocked";
    const pendingStatus = phase;
    const failureResult = eventResult({
      ok: false,
      error: childResult?.error ?? (uncertain ? "write-failed" : "child-refused"),
      phase,
      resolutionId,
      eventId: plan.event.id,
      state: uncertain ? "unknown" : undefined,
      reconciliationRequired: uncertain ? true : undefined,
      normalizedEffects: receipt.normalizedEffects,
      childOperationIds: receipt.childOperationIds,
      childResults: receipt.childResults,
      actorUuid: child.actorUuid,
      itemId: child.itemId
    });
    const failureNext = cloneValue(getVillage());
    failureNext.pendingEvent = { ...cloneValue(plan.pending), status: pendingStatus,
      resolutionId, selection: cloneValue(plan.pending.selection), selections: cloneValue(plan.pending.selection) };
    receipt.phase = phase;
    const failureWrite = await persistManagedEventPhase(failureNext, current, {
      operationId: resolutionId, expectedRevision, inputFingerprint, phase,
      receipt, result: failureResult, originCycle: plan.pending.cycle
    });
    if (!failureWrite.ok) {
      const result = eventResult({ ok: false, error: "write-failed", phase: "uncertain",
        resolutionId, eventId: plan.event.id, state: "unknown", reconciliationRequired: true,
        normalizedEffects: receipt.normalizedEffects,
        childOperationIds: receipt.childOperationIds, childResults: receipt.childResults });
      return persistManagedUncertainOutcome({ receipt, result, plan, resolutionId,
        expectedRevision, inputFingerprint });
    }
    return { persist: false, persisted: true, result: {
      ...failureResult,
      receipt: cloneValue(failureWrite.receipt ?? receipt),
      pendingEvent: cloneValue(failureWrite.village.pendingEvent)
    } };
  }

  // Every physical child is confirmed.  Apply the Village-local effect only
  // now, then consume the pending event and write the terminal receipt.
  const finalNext = cloneValue(getVillage());
  const applied = applyEventLocalPlan(finalNext, plan, { resolutionId });
  if (!applied.ok) {
    const result = eventResult({ ok: false, error: "event-apply-refused", phase: "uncertain",
      resolutionId, eventId: plan.event.id, state: "unknown", childOperationIds: receipt.childOperationIds,
      childResults: receipt.childResults, reason: applied.error });
    finalNext.pendingEvent = { ...cloneValue(plan.pending), status: "uncertain", resolutionId,
      selection: cloneValue(plan.pending.selection), selections: cloneValue(plan.pending.selection) };
    receipt.phase = "uncertain";
    const failed = await persistManagedEventPhase(finalNext, getVillage(), {
      operationId: resolutionId, expectedRevision, inputFingerprint, phase: "uncertain",
      receipt, result, originCycle: plan.pending.cycle
    });
    if (failed.ok) return { persist: false, persisted: true, result: { ...result, receipt: failed.receipt,
      pendingEvent: failed.village.pendingEvent } };
    return persistManagedUncertainOutcome({ receipt, result, plan, resolutionId,
      expectedRevision, inputFingerprint });
  }
  finalNext.pendingEvent = null;
  receipt.phase = "committed";
  const result = eventResult({ ok: true, phase: "committed", resolutionId,
    eventId: plan.event.id, cycle: finalNext.cycle, prosperity: finalNext.prosperity,
    normalizedEffects: receipt.normalizedEffects, childOperationIds: receipt.childOperationIds,
    childResults: receipt.childResults, applied });
  const finalWrite = await persistManagedEventPhase(finalNext, getVillage(), {
    operationId: resolutionId, expectedRevision, inputFingerprint, phase: "committed",
    receipt, result, originCycle: plan.pending.cycle
  });
  if (!finalWrite.ok) {
    const uncertain = eventResult({ ok: false, error: "write-failed", phase: "uncertain",
      resolutionId, eventId: plan.event.id, state: "unknown", reconciliationRequired: true,
      normalizedEffects: receipt.normalizedEffects,
      childOperationIds: receipt.childOperationIds, childResults: receipt.childResults });
    return persistManagedUncertainOutcome({ receipt, result: uncertain, plan, resolutionId,
      expectedRevision, inputFingerprint });
  }
  return { persist: false, persisted: true, result: { ...result, receipt: finalWrite.receipt ?? receipt,
    pendingEvent: null, revision: finalWrite.village.revision } };
}

function eventCyclePromotion(next, nextCycle) {
  const promoted = [];
  for (const inst of next.institutions ?? []) {
    if (!isLiveInstitution(inst)) {
      if (inst.pendingLevel != null) {
        const operationId = eventPendingOperationId(inst);
        inst.pendingLevel = null;
        inst.pendingFromCycle = null;
        inst.pendingOperationId = null;
        inst.pendingOperation = null;
        inst.operationId = null;
        if (operationId) {
          const entry = (next.operationJournal ?? []).find(candidate =>
            String(candidate?.operationId ?? "") === String(operationId)
          );
          if (entry) {
            entry.phase = "committed";
            entry.updatedAt = Date.now();
            entry.result = {
              ...(entry.result && typeof entry.result === "object" ? entry.result : {}),
              ok: true, pendingDisposition: "superseded-by-destruction"
            };
          }
        }
      }
      continue;
    }
    if (inst.pendingLevel == null || nextCycle < (inst.pendingFromCycle ?? Infinity)) continue;
    const pending = validEventPendingLevel(inst);
    const target = Math.floor(Number(inst.pendingLevel));
    if (Number(inst.level) > 0 && pending.valid && target > Number(inst.level)
        && target <= institutionPurchasableMaxLevel(inst.type)) {
      inst.level = target;
      inst.pendingLevel = null;
      inst.pendingFromCycle = null;
      inst.pendingOperationId = null;
      inst.pendingOperation = null;
      inst.operationId = null;
      promoted.push(cloneValue(inst));
    } else if (inst.destroyed || Number(inst.level) <= 0 || !pending.valid) {
      // A closure/tombstone or an invalid paid target cannot be resurrected by
      // the cycle boundary.  Paid level-zero reopening follows founding
      // semantics through the interface/Commerce path; keep this operation's
      // journal as the audit trail instead of promoting it here.
      const operationId = eventPendingOperationId(inst);
      inst.pendingLevel = null;
      inst.pendingFromCycle = null;
      inst.pendingOperationId = null;
      inst.pendingOperation = null;
      inst.operationId = null;
      if (operationId) {
        const entry = (next.operationJournal ?? []).find(candidate =>
          String(candidate?.operationId ?? "") === String(operationId)
        );
        if (entry) {
          entry.phase = "committed";
          entry.updatedAt = Date.now();
          entry.result = {
            ...(entry.result && typeof entry.result === "object" ? entry.result : {}),
            ok: true,
            pendingDisposition: inst.destroyed ? "superseded-by-destruction" : "superseded-by-closure"
          };
        }
      }
    }
  }
  return promoted;
}

function eventCycleChat({ saved, previousProsperity, previousCycle, event, promoted } = {}) {
  const pending = saved.pendingEvent;
  const resolveButton = event && pending?.resolutionId && isVillageDesignatedWriter()
    ? `<button type="button" data-action="resolveVillageEvent" data-resolution-id="${villageHtml(pending.resolutionId)}">Resolve event (Ref)</button>`
    : "";
  return `<div class="crows village-endcycle">
    <header><strong>End of cycle ${previousCycle} — entering cycle ${saved.cycle}</strong></header>
    <div>Prosperity: ${previousProsperity} &rarr; <strong>${saved.prosperity}</strong>${saved.prosperity < previousProsperity ? " (nothing raised it)" : ""}</div>
    ${promoted?.length ? `<div>Now operating: ${promoted.map(i => `${villageHtml(i.name)} (level ${i.level})`).join(", ")}</div>` : ""}
    ${event
      ? `<div><strong>Event:</strong> d10=${pending.rolled} + Prosperity ${saved.prosperity} = <strong>${pending.total}</strong></div>
         <div class="ve-text">${villageHtml(event.text)}</div>${resolveButton}`
      : `<div><em>Event skipped.</em></div>`}
  </div>`;
}

/**
 * End the cycle through the shared designated-writer queue.  A cycle close
 * never appends a targeted effect before a Ref has supplied its target; it
 * only records the immutable roll as a pending event.
 */
export async function endCycle(options = {}) {
  const { skipEvent = false, operationId: requestedOperationId = null,
    expectedRevision: requestedRevision = null } = options ?? {};
  const before = getVillage();
  const operationId = eventOperationToken(requestedOperationId, before, "end-cycle");
  const blocked = villageEventBlock(before, { operationId });
  if (blocked && !operationEntry(before, operationId)) return blocked;
  const expectedRevision = Number.isInteger(Number(requestedRevision))
    ? Number(requestedRevision) : before.revision;
  const inputFingerprint = options.inputFingerprint ?? villageInputFingerprint({
    action: "endCycle", skipEvent: !!skipEvent,
    rollD10: typeof options.rollD10 === "function" ? "injected" : options.rollD10 ?? options.d10 ?? options.roll ?? null
  });
  const result = await enqueueVillageOperation({
    operationId,
    villageId: before.villageId,
    expectedRevision,
    inputFingerprint,
    action: "end-cycle",
    execute: async ({ village }) => {
      const guard = villageEventBlock(village, { operationId });
      if (guard) return { persist: false, result: guard };
      const next = cloneValue(village);
      const previousProsperity = next.prosperity;
      const previousCycle = next.cycle;
      const nextCycle = previousCycle + 1;
      const promoted = eventCyclePromotion(next, nextCycle);
      next.prosperity = prosperityAtCycleEnd(next.prosperity, {
        raisingEventOccurred: !!next.raisingEventThisCycle
      });
      next.cycle = nextCycle;
      next.raisingEventThisCycle = false;
      next.spentThisCycle = 0;                    // C:2261 — "during a cycle"
      next.spendBonusAwarded = false;
      next.activeEffects = (next.activeEffects ?? []).filter(effect => effect.duration !== "cycle");
      let event = null;
      if (!skipEvent) {
        let rolled;
        try {
          rolled = await villageEventD10(options);
        } catch (error) {
          return { persist: false, result: { ok: false, error: "dice-unavailable",
            reason: String(error?.message ?? error) } };
        }
        const total = rolled + next.prosperity;
        event = villageEventFor(total);
        const resolutionId = eventResolutionToken(options.resolutionId ?? `${operationId}:resolution`);
        next.pendingEvent = villagePendingEvent(event, {
          rolled, total, cycle: nextCycle, resolutionId
        });
      } else next.pendingEvent = null;
      return {
        next,
        result: { ok: true, cycle: next.cycle, prosperity: next.prosperity,
          event, promoted, pendingEvent: next.pendingEvent, previousProsperity, previousCycle },
        phase: "committed"
      };
    }
  });
  if (result.ok && !result.replayed && !result.reconciliationRequired) {
    await createVillageChat({
      content: eventCycleChat({
        saved: getVillage(), previousProsperity: result.previousProsperity ?? before.prosperity,
        previousCycle: result.previousCycle ?? before.cycle, event: result.event,
        promoted: result.promoted
      }),
      speaker: { alias: "Village" }
    });
  }
  return result;
}

/** Roll and persist an immediate pending event without advancing the cycle. */
export async function rollVillageEvent(options = {}) {
  const { silent = false, operationId: requestedOperationId = null,
    expectedRevision: requestedRevision = null } = options ?? {};
  const before = getVillage();
  const operationId = eventOperationToken(requestedOperationId, before, "event-roll");
  const blocked = villageEventBlock(before, { operationId });
  if (blocked && !operationEntry(before, operationId)) return blocked;
  const expectedRevision = Number.isInteger(Number(requestedRevision))
    ? Number(requestedRevision) : before.revision;
  const inputFingerprint = options.inputFingerprint ?? villageInputFingerprint({
    action: "rollVillageEvent",
    rollD10: typeof options.rollD10 === "function" ? "injected" : options.rollD10 ?? options.d10 ?? options.roll ?? null
  });
  const result = await enqueueVillageOperation({
    operationId,
    villageId: before.villageId,
    expectedRevision,
    inputFingerprint,
    action: "roll-village-event",
    execute: async ({ village }) => {
      const guard = villageEventBlock(village, { operationId });
      if (guard) return { persist: false, result: guard };
      const next = cloneValue(village);
      let rolled;
      try {
        rolled = await villageEventD10(options);
      } catch (error) {
        return { persist: false, result: { ok: false, error: "dice-unavailable",
          reason: String(error?.message ?? error) } };
      }
      const total = rolled + next.prosperity;
      const event = villageEventFor(total);
      const resolutionId = eventResolutionToken(options.resolutionId ?? `${operationId}:resolution`);
      next.pendingEvent = villagePendingEvent(event, {
        rolled, total, cycle: next.cycle, resolutionId
      });
      return {
        next,
        result: { ok: true, rolled, total, event, resolutionId, pendingEvent: next.pendingEvent },
        phase: "committed"
      };
    }
  });
  if (result.ok && !result.replayed && !silent && !result.reconciliationRequired) {
    const pending = result.pendingEvent ?? getVillage().pendingEvent;
    await createVillageChat({
      content: `<div class="crows village-event">
        <header><strong>Village Event</strong> — d10=${pending.rolled} + Prosperity ${getVillage().prosperity} = <strong>${pending.total}</strong></header>
        <div>${villageHtml(result.event?.text ?? "No event")}</div>
        ${result.event && pending.resolutionId && isVillageDesignatedWriter()
          ? `<button type="button" data-action="resolveVillageEvent" data-resolution-id="${villageHtml(pending.resolutionId)}">Resolve event (Ref)</button>` : ""}
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return result;
}

/**
 * Resolve the one pending event through effect-specific target records and
 * the shared Village operation queue.  A missing/dismissed picker is a
 * read-only response; only a committed or explicitly abandoned resolution
 * consumes the pending event.
 */
export async function resolvePendingEvent({ resolutionId = null, selections = {}, context = {} } = {}) {
  const before = getVillage();
  const token = String(resolutionId ?? "").trim();
  if (!token) return { ok: false, error: "invalid-request", reason: "resolution-id-required" };
  const pending = before.pendingEvent;
  const knownReceipt = eventReceiptFor(before, token);
  if (!pending) {
    if (knownReceipt && VILLAGE_EVENT_TERMINAL_RECEIPT_PHASES.has(String(knownReceipt.phase))) {
      return { ...(knownReceipt.result ?? { ok: true, resolutionId: token }), replayed: true,
        receipt: cloneValue(knownReceipt), phase: knownReceipt.phase };
    }
    return { ok: false, error: "no-pending-event", resolutionId: token };
  }
  if (pending.resolutionId && String(pending.resolutionId) !== token) {
    return { ok: false, error: "conflict", reason: "different-resolution-pending",
      resolutionId: token, pendingEvent: cloneValue(pending) };
  }
  if (context?.isGM === false || context?.user?.isGM === false) {
    return { ok: false, error: "unauthorized", reason: "ref-required" };
  }
  const suppliedSelections = eventSelectionsValue(selections);
  const frozenSelections = knownReceipt?.selections
    ?? pending.selection ?? pending.selections ?? {};
  const hasSuppliedSelections = Object.keys(suppliedSelections).length > 0;
  let resolutionSelections = suppliedSelections;
  if (!hasSuppliedSelections && Object.keys(eventSelectionsValue(frozenSelections)).length > 0) {
    // Prepared/partial/uncertain retries may reuse the immutable selection
    // captured by the receipt.  This is especially important for grant
    // repair: reopening a card should not require the Ref to reconstruct the
    // roster, and it must never silently choose a new one.
    resolutionSelections = cloneValue(frozenSelections);
  } else if (hasSuppliedSelections && Object.keys(eventSelectionsValue(frozenSelections)).length > 0
      && eventSelectionFingerprint(suppliedSelections) !== eventSelectionFingerprint(frozenSelections)) {
    return { ok: false, error: "conflict", reason: "frozen-selection-conflict",
      resolutionId: token, pendingEvent: cloneValue(pending), selections: cloneValue(frozenSelections) };
  } else if (knownReceipt && Object.keys(eventSelectionsValue(frozenSelections)).length > 0) {
    // Keep the first durable representation as the canonical frozen plan even
    // when a retry supplied the same set in a different UI order.
    resolutionSelections = cloneValue(frozenSelections);
  }
  const expectedRevision = Number.isInteger(Number(context.expectedRevision))
    ? Number(context.expectedRevision) : before.revision;
  const inputFingerprint = context?.inputFingerprint ?? knownReceipt?.inputFingerprint
    ?? eventInputFingerprint({ resolutionId: token, selections: resolutionSelections, context });
  const result = await enqueueVillageOperation({
    operationId: token,
    villageId: before.villageId,
    expectedRevision,
    inputFingerprint,
    action: "resolve-village-event",
    childOperationIds: knownReceipt?.childOperationIds ?? [],
    execute: async ({ village }) => {
      const livePending = village.pendingEvent;
      if (!livePending) {
        const receipt = eventReceiptFor(village, token);
        if (receipt && VILLAGE_EVENT_TERMINAL_RECEIPT_PHASES.has(String(receipt.phase))) {
          return { persist: false, result: { ...(receipt.result ?? {}), ok: true,
            resolutionId: token, replayed: true, receipt } };
        }
        return { persist: false, result: { ok: false, error: "no-pending-event", resolutionId: token } };
      }
      if (livePending.resolutionId && String(livePending.resolutionId) !== token) {
        return { persist: false, result: { ok: false, error: "conflict",
          reason: "different-resolution-pending", resolutionId: token,
          pendingEvent: cloneValue(livePending) } };
      }
      const built = await buildEventPlan(village, livePending, resolutionSelections, context, token);
      if (!built.ok) return { persist: false, result: built.result };
      return executeManagedEventPlan(village, built.plan, {
        resolutionId: token, expectedRevision, inputFingerprint, context
      });
    }
  });
  if (result.ok && result.phase === "committed" && !result.replayed && !result.reconciliationRequired) {
    await createVillageChat({
      content: `<div class="crows village-event-resolved">
        <header><strong>Village event resolved</strong> — ${villageHtml(result.eventId)}</header>
        <div>Resolution <code>${villageHtml(token)}</code> committed.</div>
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return result;
}

/** Explicit Ref abandonment for a blocked/partial/uncertain event. */
export async function abandonPendingEvent({ resolutionId = null, context = {}, reason = "ref-abandoned" } = {}) {
  const token = String(resolutionId ?? "").trim();
  const before = getVillage();
  if (!token) return { ok: false, error: "invalid-request", reason: "resolution-id-required" };
  if (context?.isGM === false || context?.user?.isGM === false) {
    return { ok: false, error: "unauthorized", reason: "ref-required" };
  }
  if (!before.pendingEvent) {
    const receipt = eventReceiptFor(before, token);
    if (receipt && String(receipt.phase) === "abandoned") {
      return { ...(receipt.result ?? { ok: true, phase: "abandoned", resolutionId: token }),
        replayed: true, receipt: cloneValue(receipt), phase: "abandoned" };
    }
    return { ok: false, error: "no-pending-event", resolutionId: token };
  }
  if (before.pendingEvent.resolutionId && String(before.pendingEvent.resolutionId) !== token) {
    return { ok: false, error: "conflict", reason: "different-resolution-pending" };
  }
  const operationId = `${token}:abandon`;
  const expectedRevision = Number.isInteger(Number(context.expectedRevision))
    ? Number(context.expectedRevision) : before.revision;
  const inputFingerprint = context.inputFingerprint ?? villageInputFingerprint({ action: "abandon", resolutionId: token, reason });
  const result = await enqueueVillageOperation({
    operationId,
    villageId: before.villageId,
    expectedRevision,
    inputFingerprint,
    action: "abandon-village-event",
    execute: async ({ village }) => {
      const pending = village.pendingEvent;
      if (!pending || (pending.resolutionId && String(pending.resolutionId) !== token)) {
        return { persist: false, result: { ok: false, error: "conflict", reason: "different-resolution-pending" } };
      }
      const next = cloneValue(village);
      next.pendingEvent = null;
      const event = VILLAGE_EVENTS.find(candidate => candidate.id === (pending.eventId ?? pending.id));
      // Preserve the frozen prepared roster/effects and every child result
      // from a blocked, partial, or uncertain attempt.  Rebuilding from an
      // empty plan here would erase repair-forward evidence and make an
      // explicit abandonment look like a fresh, targetless cancellation.
      const existingReceipt = eventReceiptFor(village, token);
      const receipt = existingReceipt ?? eventReceiptForPlan(village, {
        event: event ?? { id: pending.eventId ?? pending.id }, pending,
        normalizedEffects: [], childOperationIds: []
      }, { resolutionId: token, expectedRevision, inputFingerprint, phase: "abandoned" });
      receipt.expectedRevision = expectedRevision;
      receipt.inputFingerprint = inputFingerprint;
      receipt.villageRevision = next.revision + 1;
      receipt.revision = receipt.villageRevision;
      receipt.phase = "abandoned";
      const result = eventResult({ ok: true, phase: "abandoned", resolutionId: token,
        eventId: event?.id ?? pending.eventId ?? pending.id,
        normalizedEffects: receipt.normalizedEffects ?? [],
        childOperationIds: receipt.childOperationIds ?? [],
        childResults: receipt.childResults ?? [],
        skippedChildOperationIds: (receipt.childOperationIds ?? []).filter(childId => {
          const child = eventReceiptChild(receipt, childId);
          return !eventChildCommitted(child?.result) && child?.phase !== "committed";
        }),
        reason });
      receipt.result = cloneValue(result);
      receipt.updatedAt = Date.now();
      putEventReceipt(next, receipt);
      const originalEntry = (next.operationJournal ?? []).find(candidate =>
        String(candidate?.operationId ?? "") === token
      );
      if (originalEntry) {
        originalEntry.phase = "abandoned";
        originalEntry.updatedAt = Date.now();
        originalEntry.result = cloneValue(result);
      }
      return { next, result, phase: "abandoned" };
    }
  });
  if (result.ok && result.phase === "abandoned" && !result.replayed && !result.reconciliationRequired) {
    await createVillageChat({
      content: `<div class="crows village-event-abandoned">
        <header><strong>Village event adjudicated</strong> — ${villageHtml(result.eventId ?? before.pendingEvent.eventId)}</header>
        <div>Resolution <code>${villageHtml(token)}</code> abandoned by the Ref; no unresolved child will be retried.</div>
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return result;
}

export const cancelPendingEvent = abandonPendingEvent;
export const abandonVillageEvent = abandonPendingEvent;
export const resolveVillageEvent = resolvePendingEvent;
export const resolveEvent = resolvePendingEvent;

/**
 * Read-only picker metadata for a Ref card/application.  The resolver remains
 * the authority; this helper only exposes the candidate institution rows and
 * never enumerates world Actors for a recipient roster.
 */
export function villageEventResolutionOptions(village = getVillage(), context = {}) {
  const pending = village?.pendingEvent;
  const event = pending && VILLAGE_EVENTS.find(candidate => candidate.id === (pending.eventId ?? pending.id));
  if (!pending || !event) return null;
  const effect = event.effect ?? {};
  let kind = null;
  let selectionKey = null;
  let count = null;
  let candidates = [];
  if (effect.kind === "destroyInstitution") {
    kind = "institution"; selectionKey = "institutionIds"; count = effect.count ?? 1;
    candidates = eventInstitutionCandidates(village, "any", { context });
  } else if (effect.kind === "institutionLevel") {
    kind = effect.destroyIfAllFirstLevel ? "institution-group" : "institution";
    selectionKey = "institutionIds"; count = effect.count ?? 1;
    candidates = eventInstitutionCandidates(village, "any", { context });
  } else if (effect.kind === "prosperity" && effect.destroyInstitutionIfAtFloor
      && village.prosperity <= PROSPERITY_MIN) {
    kind = "institution-at-floor"; selectionKey = "institutionId"; count = 1;
    candidates = eventInstitutionCandidates(village, "any", { context });
  } else if (["merchantLevel", "outOfStockChance", "credit"].includes(effect.kind)) {
    kind = "merchant"; selectionKey = "institutionId"; count = effect.scope === "all" ? 0 : effect.count ?? 1;
    candidates = eventInstitutionCandidates(village, "merchant", { context });
  } else if (["ceaseOperations"].includes(effect.kind)) {
    kind = "institution"; selectionKey = "institutionIds"; count = effect.count ?? 1;
    candidates = eventInstitutionCandidates(village, "any", { excludeRetiredPC: true, context });
  } else if (["artisanShutdown", "craftingRollsPerDay"].includes(effect.kind)) {
    kind = "artisan"; selectionKey = "institutionIds"; count = effect.count ?? 1;
    candidates = eventInstitutionCandidates(village, "artisan", { context });
  } else if (effect.kind === "destroyItem") {
    return { kind: "item", selectionKey: "actorUuid/itemId", count: 1, explicitOnly: true,
      candidates: cloneValue(context.itemCandidates ?? []) };
  } else if (effect.kind === "grantItem" || effect.kind === "credit") {
    const candidates = (context.rosterSuggestions ?? []).map(actor => ({
      ...cloneValue(actor), id: actor?.uuid ?? actor?.id,
      name: actor?.name ?? actor?.label ?? actor?.uuid ?? actor?.id
    }));
    return eventPicker({ kind: "recipients", selectionKey: "recipientActorUuids", count: "one-or-more",
      explicitOnly: true, candidates });
  } else if (effect.kind === "foundInstitution") {
    return { kind: "institution-type", selectionKey: "institutionType", count: 1,
      candidates: INSTITUTION_KEYS.map(key => ({ id: key, type: key, name: INSTITUTIONS[key].label })) };
  }
  const predicate = effect.kind === "institutionLevel" && effect.destroyIfAllFirstLevel
    ? "all-first-level-or-decrement"
    : effect.kind === "prosperity" && effect.destroyInstitutionIfAtFloor
      ? "prosperity-floor"
      : undefined;
  return kind ? eventPicker({ kind, selectionKey, count, candidates, ...(predicate ? { predicate } : {}) })
    : { kind: "none", candidates: [] };
}

export const eventResolutionOptions = villageEventResolutionOptions;
export const getPendingVillageEvent = (village = getVillage()) => cloneValue(village?.pendingEvent ?? null);
export const getPendingEvent = getPendingVillageEvent;
export function getVillageEventReceipt(resolutionId, village = getVillage()) {
  return eventReceiptFor(village, resolutionId);
}
export const eventReceipt = getVillageEventReceipt;
export const getEventReceipt = getVillageEventReceipt;

/** The target contract used by the generic applier/card, without parsing text. */
export function villageEventTargetMode(eventOrId) {
  const source = typeof eventOrId === "string" ? { eventId: eventOrId } : eventOrId;
  const event = source?.effect ? source
    : VILLAGE_EVENTS.find(candidate => candidate.id === (source?.eventId ?? source?.id));
  const effect = event?.effect ?? {};
  if (effect.scope === "all" && effect.kind === "sellPercentage") return "village-wide";
  if (effect.scope === "all") return "all-merchants";
  if (effect.kind === "grantItem") return "pc-roster";
  if (effect.kind === "destroyItem") return "actor-item";
  if (effect.kind === "foundInstitution") return "institution-type";
  if (effect.kind === "credit") return "merchant-and-pc-roster";
  if (effect.kind === "prosperity" && effect.destroyInstitutionIfAtFloor) return "institution-if-prosperity-floor";
  if (effect.kind === "prosperity" && effect.atCapInstead) return "prosperity-or-sale-cap";
  if (effect.kind === "institutionLevel" && effect.destroyIfAllFirstLevel) return "institution-pair-with-conditional-destroy";
  if (["merchantLevel", "outOfStockChance"].includes(effect.kind)) return "merchant";
  if (["artisanShutdown", "craftingRollsPerDay"].includes(effect.kind)) return "artisan";
  if (Number(effect.count) > 1) return "institution-group";
  if (["destroyInstitution", "institutionLevel", "ceaseOperations"].includes(effect.kind)) return "institution";
  return "none";
}

export const eventTargetMode = villageEventTargetMode;

/**
 * The operating level of an institution by type, including pending upgrades,
 * active event modifiers, and the Prosperity-10 capstone. `crypt.mjs` reads
 * this, which is why the crypt's "considered 6th level" (C:2517) has to live
 * in `effectiveInstitutionLevel` rather than in the caller.
 */
export function getInstitutionLevel(type) {
  const v = getVillage();
  const inst = findLiveInstitution(type, v);
  if (!inst) return 0;
  const modifiers = (v.activeEffects ?? [])
    .filter(e => (e.kind === "merchantLevel" && (e.scope === "all"
      || e.target === inst.id || e.institutionId === inst.id))
              || (e.kind === "institutionLevel" && (e.target === inst.id || e.institutionId === inst.id)));
  return effectiveInstitutionLevel(inst, { prosperity: v.prosperity, cycle: v.cycle, modifiers }).level;
}

/** Resolve an institution record by id. */
export function getInstitution(id) {
  return institutionRecordById(id, getVillage());
}
