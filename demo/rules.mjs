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
  beaconRadius,
  innMaxBet,
  institutionMaxLevel,
  institutionPurchasableMaxLevel,
  sellPercentage,
  upgradePrice,
  villageCraftingQuote,
  workshopRental
} from "../module/helpers/village.mjs";
import { CRYPT_BOONS, BOON_IDS } from "../module/helpers/crypt.mjs";
import { hireableMaxPower, hirelingStartingRations } from "../module/helpers/hirelings.mjs";

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

/**
 * What the whole institution is for, when its levels have no stocked axis.
 *
 * The crypt's wording matters: every one of the ten boons is available at level
 * 1. The level is what each boon is *worth* — `CRYPT_BOONS[x].value(level)` —
 * so a ladder that read as unlocking more of them would be describing a
 * different game.
 */
const UNAXED = Object.freeze({
  crypt: "All ten boons are available from the start; the level is how strong each one is.",
  temple: "No stocked catalogue — the level scales the services directly."
});

/** Axes that describe a catalogue, as against a capacity. */
const SHELF_AXES = new Set(["expertiseUses", "spellRank", "quality"]);

/**
 * `levelEffect` is phrased for the ladder's "what it buys" column, which reads
 * as a sentence with its verb. Under a "Stocks" label the verb doubles up —
 * "Stocks: Stocks masterwork goods" — and on an artisan it also repeats the
 * Commissions line above it, so the leading verb comes off.
 */
function asShelf(effect) {
  const trimmed = effect
    .replace(/^Crafts and stocks /, "")
    .replace(/^Stocks /, "");
  return trimmed === effect ? effect : trimmed.replace(/^./, c => c.toUpperCase());
}

const list = items => {
  const names = items.map(titleCase);
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
};

/**
 * What you can actually walk in and do, at this level and this Prosperity.
 *
 * The phrasing is authored per institution because the services genuinely
 * differ — there is no axis to derive "rents you its forge" from. Every
 * *number* in them is computed by the system's own functions, so the terms on
 * this page and the terms the system charges cannot disagree.
 */
export function institutionServices(type, level, prosperity = 0) {
  const def = INSTITUTIONS[type];
  if (!def || level == null) return [];
  const out = [];

  if (def.roles.includes("artisan")) {
    const quote = villageCraftingQuote(type, level, 0);
    if (quote.ok) {
      out.push({
        name: "Commissions",
        detail: `Crafts ${list(quote.crafts)} items. Full price up front plus materials, one roll a day at +${quote.craftingBonus}; pay double for two rolls a day.`
      });
    }
  }

  const workshop = workshopRental(type, level);
  if (workshop.ok) {
    out.push({
      name: "Workshop",
      detail: `${gc(workshop.pricePerDay)} a day to work there yourself, at +${workshop.craftingBonus} to ${list(workshop.expertises)}.`
    });
  }

  switch (type) {
    case "auctionHouse":
      out.push({ name: "Auctions", detail: "Sells anything you bring for 1d10 × (10 + Prosperity)% of its value — a swing worth gambling on." });
      out.push({ name: "Buy-back", detail: "Regret it and you can buy it back for the hammer price plus 10% of the item's value." });
      out.push({ name: "Haggling", detail: "Its own stock costs 1d6 × 10% more or less than list, decided on the spot." });
      break;
    case "barracks": {
      const rations = hirelingStartingRations(level, prosperity);
      out.push({ name: "Hirelings", detail: `Hires out anyone up to Power ${hireableMaxPower(level)}. They follow every rule a crow does except gaining XP.` });
      if (rations) out.push({ name: "Provisions", detail: `Each hireling arrives with ${rations} rations of their own.` });
      break;
    }
    case "beacon":
      out.push({ name: "Signal fire", detail: `Burns the Miasma back ${plural(beaconRadius(level, prosperity), "hex", "hexes")} around the village.` });
      out.push({ name: "Transport", detail: `Carries up to ${def.transportCapacity} creatures, ${gc(def.transportCostPerHex)} a hex travelled.` });
      break;
    case "crypt":
      out.push({ name: "Interment", detail: "Keeps your dead, and the register of who lies there." });
      out.push({
        name: "Prayer",
        detail: "Once a cycle, one boon from the ten:",
        boons: BOON_IDS.map(id => ({ label: CRYPT_BOONS[id].label, summary: CRYPT_BOONS[id].summary(level) }))
      });
      break;
    case "inn":
      out.push({ name: "Beds", detail: `${gc(def.nightlyRate)} a night, and a rest here skips the encounter check.` });
      out.push({ name: "Games", detail: `Stakes from 1 gc up to ${gc(innMaxBet(level, prosperity))}.` });
      break;
    case "stables":
      out.push({ name: "Animals", detail: `Sells and boards beasts up to Power ${advancementRow(type, level)?.maxPower ?? 0}.` });
      break;
    case "temple":
      out.push({ name: "Healing", detail: "Tends wounds, blesses those setting out, and reaches back for the recently dead — all three scale with the level." });
      break;
    default:
      break;
  }

  // What is on the shelf, for the merchants whose axis is a catalogue rather
  // than a capacity. The others — hireling Power, stake size, beacon reach —
  // already have their axis named by a line above, and would read twice.
  if (SHELF_AXES.has(def.availability?.axis)) {
    const effect = levelEffect(type, level);
    if (effect) out.push({ name: "Stocks", detail: `${asShelf(effect)}.` });
  }

  if (def.sellsCraftingMaterials) {
    out.push({ name: "Materials", detail: "Stocks the raw materials a commission needs." });
  }

  if (def.roles.includes("merchant") && type !== "auctionHouse") {
    out.push({
      name: "Buys from you",
      detail: `Pays ${sellPercentage(prosperity)}% of value at Prosperity ${prosperity > 0 ? `+${prosperity}` : prosperity}.`
    });
  }

  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

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
