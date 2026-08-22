/**
 * Crows system configuration — Playtest 2 (v0.2.0).
 *
 * THIS IS THE CONTRACT. Wave 1 codes against it and must not restructure it.
 * See .planning/CONTRACT.md for the frozen shape and .planning/PLAYTEST-2-MIGRATION.md
 * for the rules delta. Citations are `Book:Line` into the four MCDM Playtest 2
 * books — R: Rules, C: Characters, F: Ref, D: Dungeons.
 */

/** The six magic-item slots. One item each (R:438). Named once, used twice. */
const MAGIC_SLOTS = ["head", "neck", "waist", "arms", "finger", "feet"];

/** Carry containers. SEPARATE axis from magic slots in PT2 (R:426 vs R:438). */
const CARRY_CONTAINERS = { hand: 2, belt: 4, backpack: 10 };   // belt was 2 in PT1

export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  charRange: { min: -5, max: 5 },       // R:174 — schema bounds; magic may exceed the PC cap
  charPcCap: 4,                          // C:640 — enforced in advancement, not the schema

  tiers: { t1Max: 11, t2Max: 16 },       // <=11 t1, 12-16 t2, 17+ t3
  doomFaces: [2, 3],                     // NB: 2d10 SUMS, not die faces
  critFaces: [19, 20],                   // rename to doomSums/critSums deferred (critique L14)

  edgeBane: { numeric: 2 },              // single edge +2 / single bane -2 (R:264)

  // --- Expertises (R:298-348). Category gates what a test may apply. --------
  // Attacks accept weapon OR spellcasting (R:913); castings accept spellcasting
  // only (R:384); general applies to neither.
  expertises: {
    general: ["alchemy", "athletics", "blacksmithing", "enchanting", "endurance",
              "gymnastics", "handlePet", "historicalLore", "lift", "magicLore",
              "monsterLore", "natureLore", "navigate", "pickLock", "religiousLore",
              "search", "stealth", "thievery"],
    spellcasting: ["alteration", "benefaction", "conjuration", "elemental",
                   "illusion", "necromancy"],
    weapon: ["bashing", "bow", "chopping", "slashing", "stabbing", "unarmed"]
  },

  // --- Inventory -----------------------------------------------------------
  carryContainers: CARRY_CONTAINERS,
  magicSlots: MAGIC_SLOTS,

  // CONTRACT: the contract splits carry containers and magic slots into two
  // axes, but item schemas still need ONE list of every legal container value.
  // `containerKeys` is that union and is the only thing a `choices:` should use.
  // Do not reintroduce a merged `containers` map — the capacities of the two
  // axes are read differently (a number vs. always-1).
  containerKeys: [...Object.keys(CARRY_CONTAINERS), ...MAGIC_SLOTS],

  // CONTRACT: alias retained because helpers/schema.mjs consumes this name for
  // an item's `equipSlotType`. Same six values as `magicSlots`; prefer that name
  // in new code. Wave 1 may collapse the two when it rewrites schema.mjs.
  equipSlotTypes: MAGIC_SLOTS,

  // CONTRACT: `backpackSize` is DELETED. Backpack capacity is config plus trait
  // grants and is computed in prepareDerivedData (critique M12), so a single
  // frozen constant is exactly the bug we removed. Read
  // `carryContainers.backpack` for the BASE, never as the effective capacity.
  // Known callers still on the old constant, all owned by Wave 1/2:
  //   helpers/damage.mjs, helpers/slots.mjs, sheets/crow-sheet.mjs

  stackLimits: { potion: 5, lock: 3, oil: 2 },   // R:432; default 1, same KIND only
  handSlotsNeverStack: true,                     // R:432

  // Money. Two ways a slot can carry coin, not one (C:1917).
  coinPerSlot: 250,                       // loose coins in 1 slot (C:1917)
  pursePerSlot: 1,                        // a purse occupies its slot alone (C:1917)
  purseBaseCapacity: 500,                 // C:1917 — "1 purse that holds up to 500 gc"
  // The only published capacity increase is the Bursting Purse trait, C:1737:
  // "You can carry an additional 500 gc in a coin purse." (An earlier note here
  // cited C:1940 for per-quality-tier capacity — C:1940 is the Gear Prices row
  // and says no such thing. Corrected after review.)
  purseTraitBonus: 500,                   // C:1737

  corpseSlots: { tiny: 1, small: 2, medium: 4, large: 8, huge: 16, holyShit: 32 },  // R:486
  corpseStack: { tiny: 3 },               // R:486; every other size is 1

  sizes: ["tiny", "small", "medium", "large", "huge", "holyShit"],
  harvestDice: { tiny: "1d6", small: "1d6", medium: "1d6",
                 large: "2d6", huge: "3d6", holyShit: "4d6" },   // R:652

  // --- Dungeon turns -------------------------------------------------------
  greedBonus: { 1: 0.30, 2: 0.20, 3: 0.10 },                      // R:590, by DT number
  encounter: { defaultEN: 9, crowdedEN: 8, bothEN: 7, immediateOn: 10 },  // R:622

  // --- Conditions (R:526-558) ----------------------------------------------
  // `boned` is DELETED — replaced by banes plus Weakened. `hidden`/`invisible`
  // were PT1 additions with no PT2 condition entry.
  // CONTRACT: they are dropped from the condition list rather than carried, so
  // nothing can read them as rules-backed. Hidden/sneaking is a TEST (R:408),
  // not a condition. If the sheet needs a marker, use a flag, not this list.
  conditions: ["blessed", "grabbed", "prone", "unconscious", "vulnerable", "weakened"],

  // --- Advancement (C:621) -------------------------------------------------
  expertiseAdvancement: [
    { txp: 100,   bonus: 1, maxUses: 2 },
    { txp: 500,   bonus: 2, maxUses: 2 },
    { txp: 1250,  bonus: 3, maxUses: 2 },
    { txp: 2250,  bonus: 4, maxUses: 2 },
    { txp: 3500,  bonus: 5, maxUses: 2 },
    { txp: 5000,  bonus: 6, maxUses: 3 },
    { txp: 10000, bonus: 7, maxUses: 3 },
    { txp: 20000, bonus: 8, maxUses: 4 },
    { txp: 30000, bonus: 9, maxUses: 4 }
  ],
  expertiseAdvancementRepeat: 30000,      // "every 30,000 after", maxUses stays 4
  expertiseMaxAtCreation: 2,              // C:621 first row — see expertiseMaxForTxp
  expertiseUsesPerBonus: 3,               // C:615 — the ceiling the H5 budget uses
  charAdvancement: [5000, 15000, 30000],  // C:642
  charAdvancementRepeat: 30000,
  retirementTXP: 60000,                   // changelog

  // --- Unchanged from PT1. Re-verified in Wave 3; do not restructure now. ---
  weaponTypes: ["bashing", "bow", "chopping", "slashing", "stabbing", "unarmed"],
  weaponQualities: ["brutal", "cumbersome", "disengage", "dismember", "light",
                    "parry", "pummeling", "reload"],
  armorTypes: ["shield", "light", "medium", "heavy"],
  armorBaseAD: { shield: 5, light: 5, medium: 10, heavy: 15 },
  armorSlots: { shield: 1, light: 2, medium: 3, heavy: 4 },
  disciplines: ["alteration", "benefaction", "conjuration", "elemental",
                "illusion", "necromancy"],
  traitTrees: [
    "alchemy", "alteration", "archery", "armor", "bashing", "benefaction",
    "blacksmithing", "camping", "chopping", "conjuration", "elemental",
    "enchantment", "illusion", "knowledge", "leverage", "necromancy", "pets",
    "reputation", "slashing", "stabbing", "thievery", "travel", "unarmed"
  ],
  traitTierXP: { 1: 500, 2: 1000, 3: 1500, 4: 2000 },
  creatureTypes: ["animal", "blood", "undead", "demon", "angel", "plant", "unique",
                  "human"],   // CONTRACT: `human` added — F:1397 prints Type: Human
  castTypes: ["action", "maneuver", "reaction", "attack", "outOfCombat"],
  usageExpiry: ["useless", "refuel", "rest", "activate", "dt"],
  qualityTiers: ["standard", "fine", "masterwork"],
  gearSubtypes: ["tool", "utility", "light", "wand", "ring", "wornMagic", "treasure"]
};

/**
 * Every expertise key, flattened in CATEGORY order (general -> spellcasting ->
 * weapon). This is the DISPLAY order — sheets group by category and rely on it.
 *
 * It is NOT a tie-break order. The migration's water-levelling breaks ties on
 * the alphabetically-first key, and category order is not alphabetical:
 * `blacksmithing` precedes `bashing` here but follows it alphabetically, so the
 * two orders trim different expertises. Use EXPERTISES_ALPHABETICAL for that.
 */
export const ALL_EXPERTISES = [
  ...CROWS.expertises.general,
  ...CROWS.expertises.spellcasting,
  ...CROWS.expertises.weapon
];

/**
 * The same 30 keys, sorted for DETERMINISTIC TIE-BREAKS. Locale-independent by
 * construction — plain codepoint comparison, never localeCompare, so a French
 * client and an English client trim the same expertise.
 */
export const EXPERTISES_ALPHABETICAL = [...ALL_EXPERTISES]
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Effective container capacities = the config base plus validated trait grants.
 *
 * PURE, and deliberately so: both the wound derivation on the actor and the
 * positional layout in slots.mjs must call THIS, or they can disagree about how
 * many backpack slots exist the moment a slot-granting trait is present
 * (review finding 5).
 *
 * `grants` is a flat list of {container, count, appliesTo} — the caller collects
 * them from the actor's trait items. Counts below 1 are ignored rather than
 * subtracting: no published trait removes a slot, and a negative grant would let
 * bad content silently kill a character by shrinking capacity into their wounds.
 */
export function effectiveCapacities(grants = []) {
  const caps = { ...CROWS.carryContainers };
  for (const m of CROWS.magicSlots) caps[m] = 1;
  for (const g of grants) {
    if (!g || !(g.container in caps)) continue;
    const n = Number(g.count);
    if (!Number.isInteger(n) || n < 1) continue;
    caps[g.container] += n;
  }
  return caps;
}

/** Which category an expertise belongs to, or undefined if the key is unknown. */
export function expertiseCategory(key) {
  for (const [cat, keys] of Object.entries(CROWS.expertises)) {
    if (keys.includes(key)) return cat;
  }
  return undefined;
}

/**
 * The per-expertise cap, derived from TXP — never stored (critique H6).
 *
 * Below the table's first row (txp 100) this is `expertiseMaxAtCreation`, NOT 0
 * and NOT undefined: a background grants 1-2 uses (C:103) to a TXP-0 crow and
 * that must be legal on day one.
 */
export function expertiseMaxForTxp(txp = 0) {
  const rows = CROWS.expertiseAdvancement.filter(r => txp >= r.txp);
  if (!rows.length) return CROWS.expertiseMaxAtCreation;
  return rows.at(-1).maxUses;
}

/** How many advancement bonuses a crow has earned at this TXP (C:621). */
export function bonusesEarnedAtTxp(txp = 0) {
  const table = CROWS.expertiseAdvancement;
  if (txp < table[0].txp) return 0;
  const last = table.at(-1);
  if (txp < last.txp) return table.filter(r => txp >= r.txp).length;
  return last.bonus + Math.floor((txp - last.txp) / CROWS.expertiseAdvancementRepeat);
}
