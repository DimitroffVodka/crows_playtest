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
  normalized.pendingEvent = Object.prototype.hasOwnProperty.call(source, "pendingEvent")
    ? cloneValue(source.pendingEvent) : null;
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
    } catch (error) {
      const uncertain = {
        operationId, action: input.action ?? "village-operation", villageId,
        originCycle: input.originCycle ?? current.cycle,
        expectedRevision, inputFingerprint: fingerprint,
        phase: "uncertain", childOperationIds,
        result: { ok: false, error: "write-failed", state: "unknown", message: String(error?.message ?? error) },
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
      phase, childOperationIds: cloneValue(childOperationIds),
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
  const missing = ["villageId", "sceneSeed", "revision", "sceneId", "bootstrap", "auctionLots", "operationJournal"]
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

/**
 * End the cycle: promote paid-for levels, expire cycle-scoped event effects,
 * dock Prosperity if nothing could have raised it, reset the spend tracker,
 * then roll next cycle's event.
 */
export async function endCycle({ skipEvent = false, operationId = null } = {}) {
  const prev = getVillage();
  const next = cloneValue(prev);
  const prevProsperity = next.prosperity;
  const nextCycle = (next.cycle ?? 0) + 1;

  // C:2353 — paid-for levels go live at the start of the new cycle.
  const promoted = [];
  for (const inst of next.institutions) {
    if (!isLiveInstitution(inst)) continue;
    if (inst.pendingLevel != null && nextCycle >= (inst.pendingFromCycle ?? Infinity)) {
      inst.level = inst.pendingLevel;
      inst.pendingLevel = null;
      inst.pendingFromCycle = null;
      promoted.push(inst);
    }
  }

  next.prosperity = prosperityAtCycleEnd(next.prosperity, {
    raisingEventOccurred: !!next.raisingEventThisCycle
  });
  next.cycle = nextCycle;
  next.raisingEventThisCycle = false;
  next.spentThisCycle = 0;                    // C:2261 — "during a cycle"
  next.spendBonusAwarded = false;
  next.activeEffects = (next.activeEffects ?? []).filter(e => e.duration !== "cycle");

  let event = null;
  if (!skipEvent) {
    const rolled = await new globalThis.Roll("1d10").evaluate();
    const total = rolled.total + next.prosperity;
    event = villageEventFor(total);
    next.pendingEvent = { rolled: rolled.total, total, id: event?.id ?? null };
    if (event?.effect?.duration === "cycle") next.activeEffects.push({ ...event.effect, eventId: event.id });
  }
  const saved = await save(next, { prev, operationId });

  await createVillageChat({
    content: `<div class="crows village-endcycle">
      <header><strong>End of cycle ${nextCycle - 1} — entering cycle ${nextCycle}</strong></header>
      <div>Prosperity: ${prevProsperity} &rarr; <strong>${saved.prosperity}</strong>${saved.prosperity < prevProsperity ? " (nothing raised it)" : ""}</div>
      ${promoted.length ? `<div>Now operating: ${promoted.map(i => `${i.name} (level ${i.level})`).join(", ")}</div>` : ""}
      ${event
        ? `<div><strong>Event:</strong> d10=${saved.pendingEvent.rolled} + Prosperity ${saved.prosperity} = <strong>${saved.pendingEvent.total}</strong></div>
           <div class="ve-text">${event.text}</div>`
        : `<div><em>Event skipped.</em></div>`}
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, cycle: saved.cycle, prosperity: saved.prosperity, event, promoted: cloneValue(promoted) };
}

/** Roll a village event immediately (d10 + Prosperity). */
export async function rollVillageEvent({ silent = false } = {}) {
  const v = getVillage();
  const r = await new globalThis.Roll("1d10").evaluate();
  const total = r.total + (v.prosperity ?? 0);
  const event = villageEventFor(total);
  if (!silent) {
    await createVillageChat({
      content: `<div class="crows village-event">
        <header><strong>Village Event</strong> — d10=${r.total} + Prosperity ${v.prosperity} = <strong>${total}</strong></header>
        <div>${event.text}</div>
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return { ok: true, rolled: r.total, total, event };
}

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
    .filter(e => (e.kind === "merchantLevel" && (e.scope === "all" || e.target === inst.id))
              || (e.kind === "institutionLevel" && e.target === inst.id));
  return effectiveInstitutionLevel(inst, { prosperity: v.prosperity, cycle: v.cycle, modifiers }).level;
}

/** Resolve an institution record by id. */
export function getInstitution(id) {
  return institutionRecordById(id, getVillage());
}

/* ========================================================================== */
/*  Event-aware institution/service policy                                     */
/* ========================================================================== */

/**
 * The policy boundary is deliberately read-only.  It is the one place where
 * a caller turns a durable institution record plus the current cycle effects
 * into terms for a service.  Browse and Ref commit both call this function;
 * neither path is allowed to copy an advancement table or infer availability
 * from a stale card.
 *
 * The first argument may be an explicit Village snapshot (useful to a queued
 * commit preflight), or a request object in which case the live Village is
 * read.  The result is always an owned value, so a template cannot mutate the
 * setting through a policy response.
 */
export function institutionServicePolicy(villageOrRequest = null, requestMaybe = {}) {
  const looksLikeVillage = villageOrRequest && typeof villageOrRequest === "object"
    && (Array.isArray(villageOrRequest.institutions)
      || (Object.prototype.hasOwnProperty.call(villageOrRequest, "name")
        && Object.prototype.hasOwnProperty.call(villageOrRequest, "prosperity")));
  const embeddedVillage = !looksLikeVillage && villageOrRequest?.village
    && typeof villageOrRequest.village === "object"
    && (Array.isArray(villageOrRequest.village.institutions)
      || Object.prototype.hasOwnProperty.call(villageOrRequest.village, "villageId"));
  const village = normalizeVillage(looksLikeVillage ? villageOrRequest
    : embeddedVillage ? villageOrRequest.village : getVillage());
  const request = cloneValue((looksLikeVillage ? requestMaybe : villageOrRequest ?? requestMaybe) ?? {});
  const action = policyAction(request.action ?? request.operation ?? "browse");
  const type = String(request.institutionType ?? request.type ?? request.institutionKey ?? "").trim();
  const requestedId = request.institutionId ?? request.id ?? request.targetId ?? null;
  const institution = requestedId != null
    ? institutionRecordById(String(requestedId), village)
    : (type ? (findLiveInstitution(type, village) ?? village.institutions.find(i => i.type === type) ?? null) : null);
  const key = String(institution?.type ?? type);
  const def = INSTITUTIONS[key] ?? null;
  const actorUuid = request.actorUuid ?? request.beneficiaryActorUuid ?? null;
  const effects = policyEffectsFor(institution, key, village);
  const levelModifiers = effects.flatMap(effect => {
    if (effect.kind === "merchantLevel" && def?.roles?.includes("merchant")
      && policyEffectTargets(effect, institution, key)) return [{ delta: effect.delta }];
    if (effect.kind === "institutionLevel" && policyEffectTargets(effect, institution, key)) return [{ delta: effect.delta }];
    return [];
  });
  const level = institution && def
    ? effectiveInstitutionLevel(institution, {
      prosperity: village.prosperity,
      cycle: village.cycle,
      modifiers: levelModifiers
    })
    : { ok: false, level: 0, closed: true, base: 0, modifierDelta: 0, capstoneActive: false };

  const statuses = [];
  if (!def && key) statuses.push("unknown-institution");
  if (institution?.destroyed) statuses.push("destroyed");
  if (level.notYetOpen) statuses.push("not-yet-open");
  if (institution && !institution.destroyed && level.level <= 0) statuses.push("level-zero");
  const boycott = effects.some(effect => effect.kind === "boycott");
  const ceaseOperations = effects.some(effect => effect.kind === "ceaseOperations"
    && policyEffectTargets(effect, institution, key));
  const artisanShutdown = effects.some(effect => effect.kind === "artisanShutdown"
    && policyEffectTargets(effect, institution, key));
  if (boycott) statuses.push("boycott");
  if (ceaseOperations) statuses.push("cease-operations");
  if (artisanShutdown) statuses.push("artisan-shutdown");

  const rawEventReceipts = [
    ...(Array.isArray(village.eventReceipts) ? village.eventReceipts : []),
    ...(village.eventReceipt ? [village.eventReceipt] : [])
  ].filter(Boolean).map(cloneValue);
  const eventReceiptMap = new Map();
  rawEventReceipts.forEach((receipt, index) => {
    const identity = receipt.resolutionId ?? receipt.eventResolutionId ?? receipt.operationId
      ?? `anonymous-${index}-${villageInputFingerprint(receipt)}`;
    const key = String(identity);
    // The additive latest projection is appended after the archive. Let it
    // replace the archived copy without reporting one event twice to callers.
    eventReceiptMap.delete(key);
    eventReceiptMap.set(key, receipt);
  });
  const eventReceipts = [...eventReceiptMap.values()];
  const latestEventReceipt = eventReceipts[eventReceipts.length - 1] ?? null;
  const eventReceipt = {
    ...(latestEventReceipt ?? {}),
    effects: effects.map(cloneValue),
    receipts: eventReceipts,
    latest: latestEventReceipt,
    boycott,
    ceaseOperations,
    artisanShutdown
  };
  const base = {
    action,
    villageId: village.villageId,
    villageRevision: village.revision,
    institution: institution ? cloneValue(institution) : null,
    institutionId: institution?.id ?? (requestedId == null ? null : String(requestedId)),
    institutionType: key || null,
    rawLevel: institution?.level ?? 0,
    currentLevel: institution?.level ?? 0,
    pendingLevel: institution?.pendingLevel ?? null,
    pendingFromCycle: institution?.pendingFromCycle ?? null,
    effectiveLevel: level.level ?? 0,
    level: cloneValue(level),
    status: policyStatus(statuses, level),
    statuses,
    eventReceipt,
    policy: {
      // These are intentionally labelled implementation choices.  They are
      // not hidden in a price table, and no caller should turn either into an
      // automatic refund or an invented level-one upgrade.
      interveningFreeLevelAbsorbsPaidTarget: true,
      noAutomaticRefund: true,
      levelZeroReopenUsesFoundingSemantics: true
    },
    requiresRef: action !== "browse",
    canInvest: village.canInvest !== false
  };

  // Village-only commands still use this policy/read boundary so a queued
  // Ref commit cannot bypass the expected revision, but they do not target an
  // institution and therefore must not be rejected as an unknown type.
  if (action === "rename" || action === "set-prosperity") {
    return ownedPolicy({
      ...base,
      ok: true,
      reason: null,
      villageOnly: true,
      quote: {
        kind: action,
        value: action === "rename" ? request.name ?? request.requested?.name ?? null
          : request.value ?? request.prosperity ?? request.requested?.value ?? null
      }
    });
  }

  if (!def) {
    return ownedPolicy({
      ...base,
      ok: false,
      reason: key ? "unknown-institution" : "institution-required",
      error: key ? `unknown institution: ${key}` : "institution type or id is required"
    });
  }

  const criteria = {
    ...(request.criteria && typeof request.criteria === "object" ? request.criteria : {}),
    ...(request.itemCriteria && typeof request.itemCriteria === "object" ? request.itemCriteria : {}),
    ...(request.uses != null ? { uses: request.uses } : {}),
    ...(request.expertise != null ? { expertise: request.expertise } : {}),
    ...(request.rank != null ? { rank: request.rank } : {}),
    ...(request.quality != null ? { quality: request.quality } : {}),
    ...(request.power != null ? { power: request.power } : {}),
    ...(request.bet != null ? { bet: request.bet } : {}),
    ...(request.hexes != null ? { hexes: request.hexes } : {}),
    ...(request.kind != null ? { kind: request.kind } : {}),
    prosperity: village.prosperity,
    institutionRecord: institution
  };
  const availability = def.availability
    ? itemAvailability(key, level.level, criteria)
    : { ok: false, reason: "no-catalogue", error: `${def.label} stocks no catalogue to check availability against` };
  const stockPercent = action === "browse" || action === "buy" || action === "auction-buy" || action === "merchant-purchase"
    ? effects.reduce((max, effect) => effect.kind === "outOfStockChance"
      && policyEffectTargets(effect, institution, key)
      ? Math.max(max, Math.max(0, Math.min(100, Math.floor(Number(effect.percent) || 0)))) : max, 0)
    : 0;
  const stockChance = stockPercent > 0 ? {
    kind: "chance",
    percent: stockPercent,
    purchaseId: request.purchaseId == null ? null : String(request.purchaseId),
    resolved: false
  } : null;
  if (stockChance) availability.outOfStockChance = stockChance;

  const saleDelta = effects.reduce((sum, effect) => {
    if (!policyEffectTargets(effect, institution, key)) return sum;
    if (effect.kind === "sellPercentage") return sum + (Math.floor(Number(effect.delta) || 0));
    if (effect.kind === "outOfStockChance") return sum + (Math.floor(Number(effect.sellPercentageDelta) || 0));
    return sum;
  }, 0);
  const salePercent = Math.max(0, Math.min(100, sellPercentage(village.prosperity) + saleDelta));
  const itemPrice = nonNegativeInteger(request.itemPrice ?? request.price ?? request.grossPrice);
  const itemValue = nonNegativeInteger(request.itemValue ?? request.value);
  const creditToConsume = (action === "browse" || action === "buy"
    || action === "merchant-purchase" || action === "service")
    ? policyCredit(effects, institution, key, actorUuid, village.cycle) : null;
  const craftingTerms = def.roles.includes("artisan")
    ? villageCraftingQuote(key, level.level, itemPrice, {
      rush: request.rush === true,
      extraCraftingBonus: request.extraCraftingBonus ?? request.connectionBonus ?? 0
    })
    : null;
  if (craftingTerms) {
    const rollsEffect = effects.find(effect => effect.kind === "craftingRollsPerDay"
      && policyEffectTargets(effect, institution, key));
    if (rollsEffect) craftingTerms.rollsPerDay = Math.max(1, Math.floor(Number(rollsEffect.value) || 1));
  }
  const workshopTerms = def.workshop ? workshopRental(key, level.level) : null;
  const quote = policyQuote({
    action, request, village, key, def, institution, level, salePercent, itemPrice, itemValue,
    availability, creditToConsume, craftingTerms, workshopTerms
  });

  const common = {
    ...base,
    availability: cloneValue(availability),
    salePercentage: salePercent,
    salePercentageBase: sellPercentage(village.prosperity),
    salePercentageDelta: saleDelta,
    creditToConsume: cloneValue(creditToConsume),
    craftingTerms: cloneValue(craftingTerms),
    workshopTerms: cloneValue(workshopTerms),
    quote: cloneValue(quote),
    capstoneActive: capstoneActive(key, level.level, village.prosperity),
    auction: key === "auctionHouse" ? {
      availability: cloneValue(availability),
      salePercentage: { helper: "auctionSalePercentage" },
      priceMultiplier: { helper: "auctionPriceMultiplier" },
      buybackPrice: { helper: "auctionBuybackPrice" }
    } : null
  };

  if (action === "browse") {
    return ownedPolicy({ ...common, ok: true, reason: null, readable: true });
  }
  if (action === "found" || action === "reopen") {
    if (village.canInvest === false) return ownedPolicy({ ...common, ok: false, reason: "foreign-village" });
    if (institution && isLiveInstitution(institution) && Number(institution.level) > 0) {
      return ownedPolicy({ ...common, ok: false, reason: "institution-exists", error: "institution-exists" });
    }
    return ownedPolicy({
      ...common,
      ok: true,
      reason: null,
      recovery: Boolean(institution),
      foundingSemantics: true,
      boycottClearingException: boycott,
      quote: {
        kind: "found",
        price: foundingPrice(key),
        opensAfterCycle: village.cycle + 1,
        operatingFromCycle: village.cycle + 1,
        prosperityDelta: 1,
        foundingSemantics: true,
        noAutomaticRefund: true
      }
    });
  }

  if (!institution) return ownedPolicy({ ...common, ok: false, reason: "institution-not-found" });
  if (action === "upgrade") {
    if (village.canInvest === false) return ownedPolicy({ ...common, ok: false, reason: "foreign-village" });
    if (boycott) return ownedPolicy({ ...common, ok: false, reason: "boycott" });
    if (institution.destroyed) return ownedPolicy({ ...common, ok: false, reason: "institution-destroyed" });
    if (Number(institution.level) <= 0) return ownedPolicy({ ...common, ok: false, reason: "level-zero-recovery" });
    if (level.notYetOpen) return ownedPolicy({ ...common, ok: false, reason: "not-yet-open" });
    if (level.level <= 0) return ownedPolicy({ ...common, ok: false, reason: "institution-closed" });
    if (ceaseOperations) return ownedPolicy({ ...common, ok: false, reason: "cease-operations" });
    const currentPaidLevel = Math.max(0, Math.floor(Number(institution.pendingLevel ?? institution.level) || 0));
    const requestedTarget = request.targetLevel ?? request.target ?? null;
    const target = requestedTarget == null
      ? currentPaidLevel + 1
      : Math.floor(Number(requestedTarget) || 0);
    if (target !== currentPaidLevel + 1) {
      return ownedPolicy({ ...common, ok: false, reason: "invalid-upgrade-target", expectedTarget: currentPaidLevel + 1 });
    }
    const max = institutionPurchasableMaxLevel(key);
    if (target > max) return ownedPolicy({ ...common, ok: false, reason: "upgrade-cap", maxLevel: max });
    const price = upgradePrice(key, target);
    return ownedPolicy({
      ...common,
      ok: price != null,
      reason: price == null ? "upgrade-unpriced" : null,
      targetLevel: target,
      quote: {
        kind: "upgrade", price, targetLevel: target, opensAfterCycle: village.cycle + 1,
        prosperityDelta: 1, noAutomaticRefund: true,
        interveningFreeLevelAbsorbsPaidTarget: true
      }
    });
  }

  const needsMerchant = ["service", "buy", "merchant-purchase", "sell", "auction-sell", "auction-buy", "inn", "beacon"].includes(action);
  const needsArtisan = ["craft", "workshop"].includes(action);
  if (needsMerchant && !def.roles.includes("merchant")) return ownedPolicy({ ...common, ok: false, reason: "not-merchant" });
  if (needsArtisan && !def.roles.includes("artisan")) return ownedPolicy({ ...common, ok: false, reason: "not-artisan" });
  if (action === "workshop" && !def.workshop) return ownedPolicy({ ...common, ok: false, reason: "no-workshop" });
  if (["auction-sell", "auction-buy"].includes(action) && key !== "auctionHouse") {
    return ownedPolicy({ ...common, ok: false, reason: "auction-only" });
  }
  if (boycott) return ownedPolicy({ ...common, ok: false, reason: "boycott" });
  if (institution.destroyed) return ownedPolicy({ ...common, ok: false, reason: "institution-destroyed" });
  if (level.notYetOpen) return ownedPolicy({ ...common, ok: false, reason: "not-yet-open" });
  if (level.level <= 0) return ownedPolicy({ ...common, ok: false, reason: "institution-closed" });
  if (ceaseOperations) return ownedPolicy({ ...common, ok: false, reason: "cease-operations" });
  if (needsArtisan && artisanShutdown) return ownedPolicy({ ...common, ok: false, reason: "artisan-shutdown" });
  if ((action === "buy" || action === "merchant-purchase") && !def.availability) {
    return ownedPolicy({ ...common, ok: false, reason: "no-catalogue" });
  }
  if ((action === "buy" || action === "merchant-purchase") && availability.deterministic === true && availability.available === false) {
    return ownedPolicy({ ...common, ok: false, reason: "unavailable" });
  }
  if (action === "inn" && request.bet != null) {
    const bet = Math.floor(Number(request.bet) || 0);
    const maxBet = innMaxBet(level.level, village.prosperity);
    if (bet < 1) return ownedPolicy({ ...common, ok: false, reason: "invalid-bet" });
    if (bet > maxBet) return ownedPolicy({ ...common, ok: false, reason: "bet-too-high" });
  }
  if (action === "beacon" && (request.hexes != null || request.distance != null)) {
    const hexes = Math.max(0, Math.floor(Number(request.hexes ?? request.distance) || 0));
    const radius = beaconRadius(level.level, village.prosperity);
    if (hexes > radius) return ownedPolicy({ ...common, ok: false, reason: "beacon-out-of-range" });
  }
  if (action === "sell" || action === "auction-sell") {
    return ownedPolicy({ ...common, ok: true, reason: null, sale: { itemValue, percentage: salePercent, proceeds: Math.floor(itemValue * salePercent / 100) } });
  }
  return ownedPolicy({ ...common, ok: true, reason: null });
}

/** Alias retained for callers that call the boundary a service policy. */
export const villageInstitutionServicePolicy = institutionServicePolicy;

function ownedPolicy(value) {
  return cloneValue(value);
}

function policyAction(value) {
  const normalized = String(value ?? "browse").trim().toLowerCase().replace(/[\s_-]+/g, "");
  return {
    browse: "browse", view: "browse", read: "browse",
    found: "found", foundinstitution: "found", foundreopen: "found", reopen: "reopen", recover: "reopen",
    upgrade: "upgrade", levelup: "upgrade",
    service: "service", use: "service", buy: "buy", purchase: "buy", merchantpurchase: "merchant-purchase",
    sell: "sell", sellitem: "sell", craft: "craft", commission: "craft",
    workshop: "workshop", rentworkshop: "workshop", inn: "inn", bet: "inn",
    beacon: "beacon", transport: "beacon", auctionsell: "auction-sell", auctionbuy: "auction-buy",
    buyback: "auction-buy"
  }[normalized] ?? normalized;
}

function policyStatus(statuses, level) {
  if (statuses.includes("unknown-institution")) return "unknown";
  if (statuses.includes("destroyed")) return "destroyed";
  if (statuses.includes("not-yet-open")) return "not-yet-open";
  if (statuses.includes("level-zero")) return "closed";
  if (statuses.includes("boycott")) return "boycotted";
  if (statuses.includes("cease-operations")) return "cease-operations";
  if (statuses.includes("artisan-shutdown")) return "artisan-shutdown";
  return level?.closed ? "closed" : "open";
}

function policyEffectsFor(institution, key, village) {
  const active = (village?.activeEffects ?? []).filter(effect => {
    if (!effect || typeof effect !== "object") return false;
    if (!policyEffectIsCurrent(effect, village?.cycle)) return false;
    return policyEffectTargets(effect, institution, key);
  }).map(cloneValue);
  const receipts = [
    ...(Array.isArray(village?.eventReceipts) ? village.eventReceipts : []),
    ...(village?.eventReceipt ? [village.eventReceipt] : [])
  ];
  const recorded = receipts.flatMap(receipt =>
    (receipt?.normalizedEffects ?? receipt?.effects ?? [])
      .filter(effect => effect && typeof effect === "object")
      .filter(() => !receipt.phase || ["committed", "partial"].includes(String(receipt.phase)))
      .map(effect => ({ effect, receipt }))
  )
    // A receipt is audit/recovery evidence. Permanent level and Village-local
    // outcomes already live in canonical state; replaying them as modifiers
    // would double-apply a committed event after reload. Only service-facing
    // operating terms are projected from the receipt, and cycle-scoped terms
    // expire against the receipt's event cycle when explicit expiry is absent.
    .filter(({ effect }) => !["institutionLevel", "prosperity", "destroyInstitution",
      "foundInstitution", "destroyItem", "grantItem"].includes(effect.kind))
    .filter(({ effect, receipt }) => policyEffectIsCurrent(effect, village?.cycle, receipt))
    .filter(({ effect }) => policyEffectTargets(effect, institution, key))
    .map(({ effect }) => cloneValue(effect));
  const seen = new Set();
  return [...active, ...recorded].filter(effect => {
    const keyValue = villageInputFingerprint(effect);
    if (seen.has(keyValue)) return false;
    seen.add(keyValue);
    return true;
  });
}

function policyEffectIsCurrent(effect, cycle, receipt = null) {
  const expiry = effect?.expiresAfterCycle ?? effect?.expiresOnCycle;
  if (expiry != null) return Number(cycle) <= Number(expiry);
  if (effect?.duration !== "cycle") return true;
  const started = effect?.startCycle ?? effect?.cycle ?? receipt?.cycle
    ?? receipt?.eventCycle ?? receipt?.originCycle ?? receipt?.resolvedCycle;
  return started == null || Number(cycle) <= Number(started);
}

function policyEffectTargets(effect, institution, key) {
  const target = effect?.target ?? effect?.targets ?? effect?.institutionId
    ?? effect?.institutionIds ?? effect?.institutionType ?? null;
  if (Array.isArray(target)) {
    return target.some(entry => String(entry) === String(institution?.id ?? "") || String(entry) === String(key));
  }
  if (target != null && String(target) !== String(institution?.id ?? "") && String(target) !== String(key)) return false;
  if (target != null) return true;
  return effect?.scope === "all" || effect?.scope === "one" || effect?.kind === "boycott";
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function policyCredit(effects, institution, key, actorUuid, cycle) {
  for (const effect of effects) {
    if (effect.kind !== "credit" || !policyEffectTargets(effect, institution, key)) continue;
    const expiresOnCycle = effect.expiresAfterCycle ?? effect.expiresOnCycle;
    if (expiresOnCycle != null && Number(expiresOnCycle) < Number(cycle)) continue;
    const beneficiary = effect.beneficiaryActorUuid ?? effect.beneficiary ?? effect.actorUuid ?? actorUuid;
    if (beneficiary && actorUuid && String(beneficiary) !== String(actorUuid)) continue;
    if (beneficiary && !actorUuid) continue;
    const byActor = effect.remainingByActor ?? effect.amountByActor ?? null;
    const remaining = byActor && actorUuid != null
      ? byActor[actorUuid]
      : effect.remainingAmount ?? effect.amountRemaining ?? effect.remaining
        ?? effect.amount ?? effect.value ?? effect.perPC;
    const amount = nonNegativeInteger(remaining);
    if (amount <= 0) continue;
    return {
      creditId: String(effect.creditId ?? `${effect.eventId ?? "credit"}-${institution?.id ?? key}-${beneficiary ?? "pc"}`),
      grantingInstitutionId: institution?.id ?? key,
      grantingInstitutionType: key,
      beneficiaryActorUuid: beneficiary == null ? null : String(beneficiary),
      remainingAmount: amount,
      amountRemaining: amount,
      amount,
      remaining: amount,
      expiresAfterCycle: effect.expiresAfterCycle ?? effect.expiresOnCycle
        ?? (effect.duration === "cycle" ? cycle : null),
      creditOperationId: String(effect.creditOperationId ?? `${effect.eventId ?? "credit"}-${institution?.id ?? key}-${beneficiary ?? "pc"}`)
    };
  }
  return null;
}

function policyQuote({ action, request, village, key, def, institution, level, salePercent, itemPrice, itemValue,
  availability, creditToConsume, craftingTerms, workshopTerms }) {
  if (action === "found" || action === "reopen") {
    return {
      kind: "found", price: foundingPrice(key), opensAfterCycle: village.cycle + 1,
      operatingFromCycle: village.cycle + 1, prosperityDelta: 1, foundingSemantics: true,
      noAutomaticRefund: true
    };
  }
  if (action === "upgrade") {
    const target = Math.max(1, Math.floor(Number(institution?.pendingLevel ?? institution?.level) || 0) + 1);
    return {
      kind: "upgrade", price: upgradePrice(key, target), targetLevel: target,
      opensAfterCycle: village.cycle + 1, prosperityDelta: 1, noAutomaticRefund: true,
      interveningFreeLevelAbsorbsPaidTarget: true
    };
  }
  if (action === "sell" || action === "auction-sell") {
    return { kind: "sell", itemValue, percentage: salePercent, proceeds: Math.floor(itemValue * salePercent / 100) };
  }
  if (action === "craft") return { ...cloneValue(craftingTerms), kind: "craft", itemPrice };
  if (action === "workshop") return { ...cloneValue(workshopTerms), kind: "workshop" };
  if (action === "inn") return { kind: "inn", minBet: 1, maxBet: innMaxBet(level.level, village.prosperity), bet: nonNegativeInteger(request.bet) };
  if (action === "beacon") {
    const hexes = nonNegativeInteger(request.hexes ?? request.distance);
    return { kind: "beacon", radius: beaconRadius(level.level, village.prosperity), hexes, fare: beaconTransportCost(hexes) };
  }
  if (action === "auction-buy") {
    const soldFor = nonNegativeInteger(request.soldFor);
    return { kind: "auction-buy", buybackPrice: auctionBuybackPrice(soldFor, itemValue), soldFor, itemValue };
  }
  return {
    kind: action === "buy" || action === "merchant-purchase" ? "buy" : action,
    grossPrice: itemPrice,
    creditApplied: Math.min(itemPrice, creditToConsume?.remainingAmount ?? 0),
    netPrice: Math.max(0, itemPrice - (creditToConsume?.remainingAmount ?? 0)),
    availability: cloneValue(availability)
  };
}

/**
 * Resolve a targeted stock chance without using Math.random.  The purchase id
 * is the retry identity, so a timeout/retry gets the same answer and a browse
 * call cannot accidentally consume a roll.  This is a discriminated result,
 * not a boolean folded into `itemAvailability`.
 */
export function resolveVillageStockChance(chance, purchaseId = null) {
  const percent = Math.max(0, Math.min(100, Math.floor(Number(chance?.percent ?? chance) || 0)));
  const id = String(purchaseId ?? chance?.purchaseId ?? "").trim();
  if (!id) return { ok: false, reason: "purchase-id-required", kind: "chance", percent, resolved: false };
  let hash = 2166136261;
  for (const char of id) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const roll = (hash >>> 0) % 100 + 1;
  return { ok: true, kind: "chance", percent, purchaseId: id, roll, outOfStock: roll <= percent, resolved: true };
}

export const drawVillageStockChance = resolveVillageStockChance;
