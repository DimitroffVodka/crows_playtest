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
export function upgradePrice(key, level) {
  return INSTITUTIONS[key]?.advancement.find(r => r.level === level)?.price ?? null;
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
  return {
    name,
    isHome: false,
    prosperity: clampProsperity(prosperity),
    cycle: 0,
    tracksCycles: false,          // C:2226 — the Ref doesn't track these
    canInvest: false,             // C:2226 — "you can't invest in them"
    institutions: institutions.map(i => ({ ...i })),
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

export function registerVillageSettings() {
  game.settings.register(NS, KEY_VILLAGE, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultVillage()
  });
}

export function defaultVillage() {
  const institutions = STARTING_INSTITUTIONS.map((type, idx) => ({
    id: `seed-${idx}-${type}`,
    type,
    name: INSTITUTION_TYPES[type],
    level: 1,                     // C:2232 — all starting institutions are 1st level
    steward: "",
    foundedOnCycle: 0,
    operatingFromCycle: 0,        // the starting five are open on day one
    pendingLevel: null,
    pendingFromCycle: null
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
    institutions,
    activeEffects: [],            // event effects live until the end of their cycle
    pendingEvent: null
  };
}

export function getVillage() {
  try {
    const v = game.settings.get(NS, KEY_VILLAGE);
    return Object.assign(defaultVillage(), v ?? {});
  } catch { return defaultVillage(); }
}

async function save(v) {
  return game.settings.set(NS, KEY_VILLAGE, v);
}

export async function setVillage(patch = {}) {
  const next = Object.assign({}, getVillage(), patch);
  next.prosperity = clampProsperity(next.prosperity);
  await save(next);
  return next;
}

/**
 * Found an institution. Prosperity rises immediately (C:2261); the institution
 * does not open until the start of the next cycle (C:2350).
 */
export async function foundInstitution({ type, name = null, steward = "", level = 1 }) {
  const def = INSTITUTIONS[type];
  if (!def) return { ok: false, error: `unknown institution: ${type}` };
  const v = getVillage();
  if (!v.canInvest) return { ok: false, error: "you can't invest in a village that isn't your home (C:2226)" };

  const inst = {
    id: `inst-${foundry.utils.randomID(10)}`,
    type,
    name: name ?? def.label,
    level: Math.max(1, Math.min(institutionPurchasableMaxLevel(type), Math.floor(Number(level) || 1))),
    steward,
    foundedOnCycle: v.cycle,
    operatingFromCycle: v.cycle + 1,   // C:2350
    pendingLevel: null,
    pendingFromCycle: null
  };
  v.institutions.push(inst);
  v.prosperity = clampProsperity(v.prosperity + 1);
  v.raisingEventThisCycle = true;
  // C:2318 — founding a new institution is what lifts the boycott.
  v.activeEffects = (v.activeEffects ?? []).filter(e => e.kind !== "boycott");
  await save(v);

  await ChatMessage.create({
    content: `<div class="crows village-found">
      <strong>${v.name}</strong> founds <strong>${inst.name}</strong> (${def.label}) for ${def.foundingPrice} gc${steward ? ` — steward: ${steward}` : ""}.
      <div>Opens at the start of cycle <strong>${inst.operatingFromCycle}</strong>. Prosperity now <strong>${v.prosperity}</strong>.</div>
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, institution: inst, prosperity: v.prosperity, price: def.foundingPrice };
}

/**
 * Pay to upgrade. Prosperity rises now; the new level operates from the next
 * cycle (C:2353), so the level is parked in `pendingLevel` until `endCycle`.
 */
export async function upgradeInstitution(id) {
  const v = getVillage();
  if (!v.canInvest) return { ok: false, error: "you can't invest in a village that isn't your home (C:2226)" };
  const inst = v.institutions.find(i => i.id === id);
  if (!inst) return { ok: false, error: "no such institution" };

  const target = (inst.pendingLevel ?? inst.level) + 1;
  const max = institutionPurchasableMaxLevel(inst.type);
  if (target > max) return { ok: false, error: `${INSTITUTION_TYPES[inst.type]} tops out at level ${max}` };
  const price = upgradePrice(inst.type, target);

  inst.pendingLevel = target;
  inst.pendingFromCycle = v.cycle + 1;
  v.prosperity = clampProsperity(v.prosperity + 1);
  v.raisingEventThisCycle = true;
  await save(v);

  await ChatMessage.create({
    content: `<div class="crows village-upgrade">
      <strong>${inst.name}</strong> pays ${price} gc for level <strong>${target}</strong>, operating from cycle ${inst.pendingFromCycle}.
      <div>Prosperity now <strong>${v.prosperity}</strong>.</div>
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, institution: inst, prosperity: v.prosperity, price, operatingFromCycle: inst.pendingFromCycle };
}

/** Demote or destroy (C:2315, C:2316). A 1st-level institution is destroyed. */
export async function damageInstitution(id, { destroy = false } = {}) {
  const v = getVillage();
  const idx = v.institutions.findIndex(i => i.id === id);
  if (idx < 0) return { ok: false, error: "no such institution" };
  const inst = v.institutions[idx];

  if (destroy || inst.level <= 1) {
    v.institutions.splice(idx, 1);
    await save(v);
    await ChatMessage.create({
      content: `<div class="crows village-destroyed"><strong>${inst.name}</strong> destroyed.</div>`,
      speaker: { alias: "Village" }
    });
    return { ok: true, destroyed: true, institution: inst };
  }
  inst.level -= 1;
  if (inst.pendingLevel != null) inst.pendingLevel = Math.max(inst.level, inst.pendingLevel - 1);
  await save(v);
  await ChatMessage.create({
    content: `<div class="crows village-damaged"><strong>${inst.name}</strong> damaged — level now ${inst.level}.</div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, destroyed: false, institution: inst };
}

export async function setProsperity(value, { silent = false } = {}) {
  const v = getVillage();
  const before = v.prosperity;
  v.prosperity = clampProsperity(value);
  if (v.prosperity > before) v.raisingEventThisCycle = true;
  await save(v);
  if (!silent) {
    await ChatMessage.create({
      content: `<div class="crows village-prosperity">Prosperity: ${before} &rarr; <strong>${v.prosperity}</strong></div>`,
      speaker: { alias: "Village" }
    });
  }
  return v.prosperity;
}

/**
 * Record a purchase from a merchant institution. Crossing 10,000 gc in a cycle
 * raises Prosperity by 1, once (C:2261).
 */
export async function recordSpend(amount, { silent = false } = {}) {
  const v = getVillage();
  const result = recordMerchantSpend(v, amount);
  v.spentThisCycle = result.spentThisCycle;
  v.spendBonusAwarded = result.spendBonusAwarded;
  if (result.prosperityDelta) {
    v.prosperity = clampProsperity(v.prosperity + result.prosperityDelta);
    v.raisingEventThisCycle = true;
  }
  await save(v);
  if (result.prosperityDelta && !silent) {
    await ChatMessage.create({
      content: `<div class="crows village-prosperity">
        ${SPEND_FOR_PROSPERITY.toLocaleString()} gc spent with village merchants this cycle — Prosperity now <strong>${v.prosperity}</strong>.
      </div>`,
      speaker: { alias: "Village" }
    });
  }
  return { ok: true, ...result, prosperity: v.prosperity };
}

/**
 * End the cycle: promote paid-for levels, expire cycle-scoped event effects,
 * dock Prosperity if nothing could have raised it, reset the spend tracker,
 * then roll next cycle's event.
 */
export async function endCycle({ skipEvent = false } = {}) {
  const v = getVillage();
  const prevProsperity = v.prosperity;
  const nextCycle = (v.cycle ?? 0) + 1;

  // C:2353 — paid-for levels go live at the start of the new cycle.
  const promoted = [];
  for (const inst of v.institutions) {
    if (inst.pendingLevel != null && nextCycle >= (inst.pendingFromCycle ?? Infinity)) {
      inst.level = inst.pendingLevel;
      inst.pendingLevel = null;
      inst.pendingFromCycle = null;
      promoted.push(inst);
    }
  }

  v.prosperity = prosperityAtCycleEnd(v.prosperity, { raisingEventOccurred: !!v.raisingEventThisCycle });
  v.cycle = nextCycle;
  v.raisingEventThisCycle = false;
  v.spentThisCycle = 0;                    // C:2261 — "during a cycle"
  v.spendBonusAwarded = false;
  v.activeEffects = (v.activeEffects ?? []).filter(e => e.duration !== "cycle");

  let event = null;
  if (!skipEvent) {
    const rolled = await new Roll("1d10").evaluate();
    const total = rolled.total + v.prosperity;
    event = villageEventFor(total);
    v.pendingEvent = { rolled: rolled.total, total, id: event?.id ?? null };
    if (event?.effect?.duration === "cycle") v.activeEffects.push({ ...event.effect, eventId: event.id });
  }
  await save(v);

  await ChatMessage.create({
    content: `<div class="crows village-endcycle">
      <header><strong>End of cycle ${nextCycle - 1} — entering cycle ${nextCycle}</strong></header>
      <div>Prosperity: ${prevProsperity} &rarr; <strong>${v.prosperity}</strong>${v.prosperity < prevProsperity ? " (nothing raised it)" : ""}</div>
      ${promoted.length ? `<div>Now operating: ${promoted.map(i => `${i.name} (level ${i.level})`).join(", ")}</div>` : ""}
      ${event
        ? `<div><strong>Event:</strong> d10=${v.pendingEvent.rolled} + Prosperity ${v.prosperity} = <strong>${v.pendingEvent.total}</strong></div>
           <div class="ve-text">${event.text}</div>`
        : `<div><em>Event skipped.</em></div>`}
    </div>`,
    speaker: { alias: "Village" }
  });
  return { ok: true, cycle: v.cycle, prosperity: v.prosperity, event, promoted };
}

/** Roll a village event immediately (d10 + Prosperity). */
export async function rollVillageEvent({ silent = false } = {}) {
  const v = getVillage();
  const r = await new Roll("1d10").evaluate();
  const total = r.total + (v.prosperity ?? 0);
  const event = villageEventFor(total);
  if (!silent) {
    await ChatMessage.create({
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
  const inst = v.institutions?.find(i => i.type === type);
  if (!inst) return 0;
  const modifiers = (v.activeEffects ?? [])
    .filter(e => (e.kind === "merchantLevel" && (e.scope === "all" || e.target === inst.id))
              || (e.kind === "institutionLevel" && e.target === inst.id));
  return effectiveInstitutionLevel(inst, { prosperity: v.prosperity, cycle: v.cycle, modifiers }).level;
}

/** Resolve an institution record by id. */
export function getInstitution(id) {
  return getVillage().institutions?.find(i => i.id === id) ?? null;
}
