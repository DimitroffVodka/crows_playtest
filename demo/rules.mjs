/**
 * What an institution's levels actually buy you.
 *
 * The rules are already in the system as data — `INSTITUTIONS` in
 * `village.mjs` carries every institution's founding price, its advancement
 * table with the price to reach each level, and the Prosperity 10 capstone,
 * each with its rulebook citation. This module only turns a row of that table
 * into a sentence.
 *
 * The wording is per *axis*, not per institution: `availability.axis` names what
 * a level actually raises — how many expertise uses an artisan can craft
 * against, the Power of hireling a barracks will supply, the rank of spellbook
 * on a shelf. Twelve hand-written descriptions would drift from the table the
 * moment a level's numbers changed; a formatter keyed on the axis cannot.
 */

import {
  INSTITUTIONS,
  advancementRow,
  institutionMaxLevel,
  institutionPurchasableMaxLevel,
  upgradePrice
} from "../module/helpers/village.mjs";

export { institutionMaxLevel, institutionPurchasableMaxLevel };

const gc = value => `${Number(value).toLocaleString("en-GB")} gc`;

const titleCase = value => String(value).replace(/^./, c => c.toUpperCase());

/**
 * One advancement row as a phrase.
 *
 * Returns null where a level grants nothing the table can name — the crypt and
 * the temple, whose levels feed boons and services rather than a stocked shelf.
 * The caller says so in words rather than printing an empty cell.
 */
export function levelEffect(type, level) {
  const def = INSTITUTIONS[type];
  const row = advancementRow(type, level);
  if (!def || !row) return null;

  switch (def.availability?.axis) {
    case "expertiseUses": {
      const expertise = titleCase(def.availability.expertise ?? "its craft");
      const uses = `Crafts and stocks up to ${row.expertiseUses} ${expertise} use${row.expertiseUses === 1 ? "" : "s"}`;
      // The blacksmith stocks enchanted goods alongside its own craft.
      return row.enchantingUses
        ? `${uses}; enchanted goods up to ${row.enchantingUses} Enchanting use${row.enchantingUses === 1 ? "" : "s"}`
        : uses;
    }
    case "percentChance":
      return `Valued items ${row.valued}% to appear, unique items ${row.unique}%`;
    case "maxPower":
      return `${type === "stables" ? "Animals" : "Hirelings"} up to Power ${row.maxPower}`;
    case "hexRadius":
      return `Signals and transport reach ${row.hexRadius} hex${row.hexRadius === 1 ? "" : "es"}`;
    case "spellRank":
      return row.spellRank === 0
        ? "Cantrips only — no ranked spellbooks yet"
        : `Spellbooks up to rank ${row.spellRank}`;
    case "quality":
      return `Stocks ${row.quality} goods`;
    case "maxBet":
      return `Games of chance up to ${gc(row.maxBetBase)} a stake`;
    default:
      return null;
  }
}

/** What the whole institution is for, when its levels have no stocked axis. */
const UNAXED = Object.freeze({
  crypt: "Each level opens another of the ten crypt boons.",
  temple: "Each level deepens the services the temple can perform."
});

/**
 * Everything the panel needs about one institution at one level.
 *
 * `level` of null means the plot is still waiting, in which case the price
 * shown is what it costs to found rather than to raise.
 */
export function institutionRules(type, level = null) {
  const def = INSTITUTIONS[type];
  if (!def) return null;

  const top = institutionMaxLevel(type);
  const purchasableTop = institutionPurchasableMaxLevel(type);
  const rows = def.advancement.map(row => ({
    level: row.level,
    price: row.price,
    effect: levelEffect(type, row.level),
    current: row.level === level,
    /** The temple's sixth row exists but has no price: Prosperity grants it. */
    purchasable: row.level === 1 || row.price != null
  }));

  // The rulebook citations on `def.source` and `def.prosperity10.source` are
  // deliberately not carried out of here. They are how the system's own data
  // stays checkable against the book; on a page for someone looking at a map
  // they are a reference number next to a sentence they can already read.
  return {
    label: def.label,
    roles: def.roles ?? [],
    foundingPrice: def.foundingPrice,
    top,
    purchasableTop,
    rows,
    /** Blank for the crypt and temple, whose level is the effect. */
    ladderNote: UNAXED[type] ?? null,
    nextPrice: level == null ? def.foundingPrice : upgradePrice(type, level + 1),
    capstone: def.prosperity10
      ? {
          atLevel: def.prosperity10.atLevel,
          text: def.prosperity10.text,
          met: level != null && level >= def.prosperity10.atLevel
        }
      : null
  };
}
