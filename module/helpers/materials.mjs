/**
 * Crafting material vocabulary, normalization, and inventory planning.
 *
 * The Characters Book uses two different namespaces: an equipment upgrade is
 * what an item becomes, while a material identity is what a project consumes.
 * Keeping those namespaces separate prevents tempting but incorrect matches
 * such as `steel` (an output tier) consuming a card whose identity is merely
 * blank, or `bloodhide` (an output) consuming blood-creature parts.
 *
 * Everything in this file is pure. The planner reads an Actor-shaped object but
 * never mutates it; the Foundry-facing transaction in crafting.mjs owns writes.
 */

import {
  EQUIPMENT_UPGRADE_KEYS,
  MATERIAL_IDENTITY_KEYS
} from "../config.mjs";

export {
  EQUIPMENT_UPGRADE_KEYS,
  MATERIAL_IDENTITY_KEYS
};

/** A material card may remain unidentified until the Ref names it. */
export const MATERIAL_IDENTITY_CHOICES = Object.freeze([
  "",
  ...MATERIAL_IDENTITY_KEYS,
  "creatureTypeParts"
]);

export const MATERIAL_FORMS = Object.freeze(["", "part", "bar", "log"]);
export const MATERIAL_SIZES = Object.freeze(["", "tiny", "small", "medium", "large"]);

/** Printed output tiers mapped to their distinct consumable input. */
export const EQUIPMENT_UPGRADE_MATERIALS = Object.freeze({
  bloodhide: Object.freeze({ identity: "bloodCreature", form: "part" }),
  undeadBone: Object.freeze({ identity: "undead", form: "part" }),
  demonHide: Object.freeze({ identity: "demon", form: "part" }),
  angelHide: Object.freeze({ identity: "angel", form: "part" }),
  elementalEssence: Object.freeze({ identity: "elemental", form: "part" }),
  steel: Object.freeze({ identity: "treatedIron", form: "bar" }),
  archmageObsidian: Object.freeze({ identity: "archmageObsidian", form: "bar" }),
  necromancerSilver: Object.freeze({ identity: "necromancerSilver", form: "bar" }),
  starDiamond: Object.freeze({ identity: "starDiamond", form: "bar" }),
  yew: Object.freeze({ identity: "yew", form: "log" }),
  archmageWillow: Object.freeze({ identity: "archmageWillow", form: "log" }),
  necromancerDeathtree: Object.freeze({ identity: "necromancerDeathtree", form: "log" }),
  starwood: Object.freeze({ identity: "starwood", form: "log" })
});

const MATERIAL_ALIASES = Object.freeze([
  ["blood creature", "bloodCreature"],
  ["blood creatures", "bloodCreature"],
  ["blood creature part", "bloodCreature"],
  ["blood creature parts", "bloodCreature"],
  ["blood parts", "bloodCreature"],
  ["undead", "undead"],
  ["undead part", "undead"],
  ["undead parts", "undead"],
  ["demon", "demon"],
  ["demon part", "demon"],
  ["demon parts", "demon"],
  ["angel", "angel"],
  ["angel part", "angel"],
  ["angel parts", "angel"],
  ["elemental", "elemental"],
  ["elemental part", "elemental"],
  ["elemental parts", "elemental"],
  ["plant", "plant"],
  ["plant part", "plant"],
  ["plant parts", "plant"],
  ["iron", "iron"],
  ["iron bar", "iron"],
  ["iron bars", "iron"],
  ["treated iron", "treatedIron"],
  ["treated iron bar", "treatedIron"],
  ["treated iron bars", "treatedIron"],
  ["steel bar", "treatedIron"],
  ["steel bars", "treatedIron"],
  ["archmage obsidian", "archmageObsidian"],
  ["archmage obsidian bar", "archmageObsidian"],
  ["archmage obsidian bars", "archmageObsidian"],
  ["necromancer silver", "necromancerSilver"],
  ["necromancer silver bar", "necromancerSilver"],
  ["necromancer silver bars", "necromancerSilver"],
  ["star diamond", "starDiamond"],
  ["star diamond bar", "starDiamond"],
  ["star diamond bars", "starDiamond"],
  ["hickory", "hickory"],
  ["hickory log", "hickory"],
  ["hickory logs", "hickory"],
  ["yew", "yew"],
  ["yew log", "yew"],
  ["yew logs", "yew"],
  ["archmage willow", "archmageWillow"],
  ["archmage willow log", "archmageWillow"],
  ["archmage willow logs", "archmageWillow"],
  ["necromancer deathtree", "necromancerDeathtree"],
  ["necromancer deathtree log", "necromancerDeathtree"],
  ["necromancer deathtree logs", "necromancerDeathtree"],
  ["starwood", "starwood"],
  ["starwood log", "starwood"],
  ["starwood logs", "starwood"],
  ["star wood log", "starwood"],
  ["star wood logs", "starwood"],
  ["parts of the enchantment creature type", "creatureTypeParts"],
  ["part of the enchantment creature type", "creatureTypeParts"],
  ["creature type parts", "creatureTypeParts"]
]);

const CREATURE_TYPES = new Set(["animal", "blood", "undead", "demon", "angel", "plant", "unique", "human"]);
const LEGACY_DESCRIPTORS = new Set([
  "tiny", "small", "medium", "large", "part", "parts", "bar", "bars", "log", "logs",
  "material", "materials", "of", "the", "enchantment", "creature", "type"
]);

function cloneValue(value) {
  try { return structuredClone(value); }
  catch { return value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value; }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Stable prose key used for legacy aliases, never as an identity itself. */
export function materialWords(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    // Treat the book's curly possessive in “enchantment’s creature type” as
    // punctuation, not an extra category token.
    .replace(/[’']s\b/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ");
}

function canonicalIdentity(value) {
  const exact = String(value ?? "").trim();
  if (MATERIAL_IDENTITY_KEYS.includes(exact) || exact === "creatureTypeParts") return exact;
  return "";
}

/**
 * Normalize a legacy/display phrase to the consumable namespace.
 *
 * `legacy` is intentionally opt-in. Structured records must carry a canonical
 * identity; accepting arbitrary prose in that field would turn an unresolved
 * Ref decision into a silently consumed card. Legacy project strings use the
 * alias path and retain their original label regardless.
 */
export function materialIdentityFor(value, { legacy = true } = {}) {
  const exact = canonicalIdentity(value);
  if (exact) return exact;
  if (!legacy) return "";
  const words = materialWords(value);
  if (!words) return "";
  const allowedContext = (context) => context.split(" ").filter(Boolean)
    .every(token => LEGACY_DESCRIPTORS.has(token));
  const hit = MATERIAL_ALIASES.find(([alias]) => {
    if (words === alias) return true;
    if (words.startsWith(`${alias} `)) return allowedContext(words.slice(alias.length + 1));
    if (words.endsWith(` ${alias}`)) return allowedContext(words.slice(0, -(alias.length + 1)));
    return false;
  });
  if (hit) return hit[1];
  // “Steel” is an output tier, but the printed input phrase is treated-iron
  // bars. Keep the conversion exact so “steel sword” cannot become a recipe.
  if (words === "steel" || words === "steel bar" || words === "steel bars") return "treatedIron";
  return "";
}

/** Normalize upgrade output text, including the book's “Elemental Tree” name. */
export function equipmentUpgradeKeyFor(value) {
  const exact = String(value ?? "").trim();
  if (EQUIPMENT_UPGRADE_KEYS.includes(exact)) return exact;
  const words = materialWords(value);
  if (words === "elemental tree" || words === "elemental essence") return "elementalEssence";
  const compact = words.replace(/ /g, "");
  return EQUIPMENT_UPGRADE_KEYS.find(key => key.toLowerCase() === compact) ?? "";
}

export const normalizeMaterialIdentity = materialIdentityFor;
export const normalizeEquipmentUpgradeKey = equipmentUpgradeKeyFor;

function formFor(value) {
  const form = materialWords(value).replace(/s$/, "");
  return MATERIAL_FORMS.includes(form) ? form : "";
}

function sizeFor(value) {
  const size = materialWords(value);
  return MATERIAL_SIZES.includes(size) ? size : "";
}

function countFor(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function parseCreatureType(text) {
  const words = materialWords(text);
  const match = words.match(/\b(animal|blood|undead|demon|angel|plant|unique|human)\b/);
  return match && CREATURE_TYPES.has(match[1]) ? match[1] : "";
}

function creatureTypeFor(value) {
  const words = materialWords(value);
  return CREATURE_TYPES.has(words) ? words : "";
}

/**
 * Convert one project requirement to its durable shape. The function is
 * idempotent and preserves unknown/free text in `legacyText`.
 */
export function normalizeMaterialRequirement(material, index = 0) {
  const fallbackId = `req-${Math.max(0, Math.floor(Number(index) || 0)) + 1}`;

  if (isObject(material)) {
    const source = cloneValue(material) ?? {};
    const rawIdentity = String(source.identity ?? "").trim();
    const identity = materialIdentityFor(rawIdentity, { legacy: false });
    const label = String(source.label ?? source.legacyText ?? rawIdentity).trim();
    const providedLegacyText = String(source.legacyText ?? "").trim();
    const params = isObject(source.params) ? cloneValue(source.params) : {};
    if (!params.creatureType && source.creatureType) params.creatureType = String(source.creatureType).trim();
    if (params.creatureType) params.creatureType = creatureTypeFor(params.creatureType);
    const normalized = {
      id: String(source.id ?? fallbackId),
      quantity: Math.max(1, countFor(source.quantity, 1)),
      identity,
      form: formFor(source.form),
      size: sizeFor(source.size),
      label,
      legacyText: identity ? providedLegacyText : (providedLegacyText || label || rawIdentity)
    };
    if (identity === "creatureTypeParts" || Object.keys(params).length) normalized.params = params;
    if (identity === "creatureTypeParts" && !normalized.form) normalized.form = "part";
    return normalized;
  }

  const label = String(material ?? "").trim();
  const quantityMatch = label.match(/^(\d+)\s+/);
  const quantity = quantityMatch ? Math.max(1, countFor(quantityMatch[1], 1)) : 1;
  const description = quantityMatch ? label.slice(quantityMatch[0].length) : label;
  const words = materialWords(description);
  const identity = materialIdentityFor(description);
  let form = formFor(words.match(/\b(bars?|logs?|parts?)\b/)?.[1]);
  const size = sizeFor(words.match(/\b(tiny|small|medium|large)\b/)?.[1]);
  // “Steel” names the output tier, while its input is treated-iron bars.
  if (identity === "treatedIron" && /\bsteel\b/.test(words)) form = "bar";
  if (identity === "creatureTypeParts") form = "part";
  const params = identity === "creatureTypeParts"
    ? { creatureType: parseCreatureType(description) }
    : {};
  const unresolved = !identity || (identity === "creatureTypeParts" && !params.creatureType);
  const normalized = {
    id: fallbackId,
    quantity,
    identity,
    form,
    size,
    label,
    legacyText: unresolved ? label : ""
  };
  if (identity === "creatureTypeParts") normalized.params = params;
  return normalized;
}

/** Alias used by migration/crafting code and by callers that prefer “crafting”. */
export const normalizeCraftingMaterialRequirement = normalizeMaterialRequirement;

function itemsOf(actor) {
  const items = actor?.items;
  if (!items) return [];
  if (Array.isArray(items)) return [...items];
  if (Array.isArray(items.contents)) return [...items.contents];
  if (typeof items.values === "function") return [...items.values()];
  try { return [...items]; } catch { return []; }
}

function itemIdOf(item) {
  const id = item?.id ?? item?._id;
  return id === undefined || id === null || id === "" ? "" : String(id);
}

function quantityOfMaterial(item) {
  const n = Number(item?.system?.quantity);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 1;
}

function cardRecord(item) {
  if (!item || item.type !== "gear" || item.system?.subtype !== "material") return null;
  // Explicit false is the only safe representation of an unidentified card;
  // schema defaults and plain test fixtures omit it, so omission remains the
  // model's initial identified state.
  if (item.system?.identified === false) return null;
  const material = item.system?.material;
  const identity = materialIdentityFor(material?.identity, { legacy: false });
  if (!identity) return null;
  const params = isObject(material?.params) ? material.params : {};
  const creatureType = String(material?.creatureType ?? params.creatureType ?? "").trim();
  return {
    item,
    itemId: itemIdOf(item),
    quantity: quantityOfMaterial(item),
    identity,
    form: formFor(material?.form),
    size: sizeFor(material?.size),
    creatureType
  };
}

/** True when one identified material card can satisfy the complete requirement identity. */
export function materialItemMatches(item, requirement) {
  const card = cardRecord(item);
  const req = normalizeMaterialRequirement(requirement);
  if (!card || !req.identity || req.legacyText) return false;
  if (card.identity !== req.identity) return false;
  if (req.form && card.form !== req.form) return false;
  if (req.size && card.size !== req.size) return false;
  if (req.identity === "creatureTypeParts") {
    const creatureType = creatureTypeFor(req.params?.creatureType ?? req.creatureType);
    if (!creatureType || card.creatureType !== creatureType) return false;
  }
  return true;
}

function requirementKey(requirement) {
  const params = requirement.params?.creatureType ?? "";
  return [requirement.identity, requirement.form, requirement.size, params].join("|");
}

function missingRecord(requirement, available, required = requirement.quantity) {
  const shortfall = Math.max(0, required - available);
  return {
    ...cloneValue(requirement),
    requirement: cloneValue(requirement),
    required,
    available,
    shortfall,
    missing: shortfall
  };
}

function consumptionRecord(existing, card, quantity, requirement) {
  const before = existing?.beforeQuantity ?? card.quantity;
  const consumed = (existing?.quantity ?? 0) + quantity;
  const after = Math.max(0, before - consumed);
  return {
    ...(existing ?? {}),
    id: card.itemId,
    itemId: card.itemId,
    quantity: consumed,
    beforeQuantity: before,
    afterQuantity: after,
    delete: after === 0,
    requirementIds: [...new Set([...(existing?.requirementIds ?? []), requirement.id])],
    itemName: String(card.item?.name ?? "")
  };
}

/**
 * Pure inventory planner.
 *
 * `fullSets` describes every complete recipe set physically present. Pending
 * project copies reserve those units, so `availableSets` subtracts
 * `project.completed`. `options.copies` asks for a separate exact consumption
 * plan (Finalize uses the pending count); absent that option, a pending project
 * plans its pending copies and a new project plans all currently available
 * sets. No result from this function mutates the Actor or its Items.
 */
export function planCraftingMaterials(actor, project = {}, options = {}) {
  const rawRequirements = Array.isArray(project)
    ? project
    : (Array.isArray(project?.materials) ? project.materials : []);
  const requirements = rawRequirements.map((material, index) => normalizeMaterialRequirement(material, index));
  const unresolved = requirements.filter(req => !req.identity || Boolean(req.legacyText)
    || (req.identity === "creatureTypeParts" && !CREATURE_TYPES.has(req.params?.creatureType ?? "")));

  const cards = itemsOf(actor)
    .map(cardRecord)
    .filter(Boolean)
    .filter(card => card.itemId)
    .sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

  const groups = new Map();
  for (const requirement of requirements) {
    if (!requirement.identity || unresolved.includes(requirement)) continue;
    const key = requirementKey(requirement);
    const group = groups.get(key) ?? { requirement, quantity: 0, requirements: [] };
    group.quantity += requirement.quantity;
    group.requirements.push(requirement);
    groups.set(key, group);
  }

  const missing = [];
  let fullSets = groups.size ? Number.POSITIVE_INFINITY : (unresolved.length ? 0 : Number.POSITIVE_INFINITY);
  const groupCards = new Map();
  for (const [key, group] of groups) {
    const matching = cards.filter(card => materialItemMatches(card.item, group.requirement));
    const available = matching.reduce((sum, card) => sum + card.quantity, 0);
    const sets = Math.floor(available / group.quantity);
    fullSets = Math.min(fullSets, sets);
    groupCards.set(key, matching);
    if (sets < 1) missing.push(missingRecord(group.requirement, available, group.quantity));
  }
  if (unresolved.length) fullSets = 0;

  const completed = Math.max(0, countFor(project?.completed, 0));
  const availableSets = Number.isFinite(fullSets)
    ? Math.max(0, fullSets - completed)
    : Number.POSITIVE_INFINITY;
  const requestedCopies = Object.prototype.hasOwnProperty.call(options ?? {}, "copies")
    ? Math.max(0, countFor(options.copies, 0))
    : completed > 0
      ? completed
      : Number.isFinite(fullSets) ? fullSets : 0;

  const consumptionMap = new Map();
  const canConsume = !unresolved.length && (!groups.size || requestedCopies <= fullSets);
  if (canConsume && requestedCopies > 0) {
    const remainingByItem = new Map(cards.map(card => [card.itemId, card.quantity]));
    // Constrained groups claim first; a blank form/size requirement can then
    // use whatever remains without starving a more specific recipe row.
    const orderedGroups = [...groups.entries()].sort(([, a], [, b]) => {
      const score = group => Number(Boolean(group.requirement.form))
        + Number(Boolean(group.requirement.size))
        + Number(Boolean(group.requirement.params?.creatureType));
      return score(b) - score(a);
    });
    for (const [key, group] of orderedGroups) {
      let remaining = group.quantity * requestedCopies;
      const matching = groupCards.get(key) ?? [];
      for (const card of matching) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, remainingByItem.get(card.itemId) ?? 0);
        if (take <= 0) continue;
        const prior = consumptionMap.get(card.itemId);
        consumptionMap.set(card.itemId, consumptionRecord(prior, card, take, group.requirement));
        remainingByItem.set(card.itemId, (remainingByItem.get(card.itemId) ?? 0) - take);
        remaining -= take;
      }
      // The exact preflight quantity check above should make this impossible;
      // retain an empty plan rather than emitting a partial write if malformed
      // overlapping requirements ever make it reachable.
      if (remaining > 0) {
        consumptionMap.clear();
        break;
      }
    }
  }

  const consumption = [...consumptionMap.values()]
    .sort((a, b) => a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  const updates = consumption.map(entry => ({
    _id: entry.itemId,
    "system.quantity": entry.afterQuantity
  }));
  const exhaustedIds = consumption.filter(entry => entry.afterQuantity === 0).map(entry => entry.itemId);

  return {
    fullSets,
    availableSets,
    missing,
    unresolved: unresolved.map(req => cloneValue(req)),
    consumption,
    updates,
    exhaustedIds,
    requirements,
    copies: requestedCopies
  };
}

/** Short name for callers that treat this as a generic recipe planner. */
export const planMaterials = planCraftingMaterials;
export const planMaterialConsumption = planCraftingMaterials;
