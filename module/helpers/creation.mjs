/**
 * Character creation helper — stamps a Background onto a crow.
 *
 * Sets stamina/background, grants the background's expertise uses, creates its
 * equipment + spellbooks, and embeds the starting trait.
 *
 * Background's `startingTrait` is stored as "Tree: TraitName" (e.g.
 * "Archery: Point Blank"). We parse out the trait name and find the
 * matching trait Item by name in either the trait compendium or world items.
 */

/**
 * Fold a name to a comparison key: case, punctuation and spacing are noise.
 *
 * This is what bridges `gluepot` -> "Glue Pot" and both background spellings of
 * `quill and inkpot` / `quill and ink pot` -> "Quill & Inkpot", generically,
 * without a per-item special case.
 */
function comparisonKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Cross-source naming conflicts that normalization genuinely cannot bridge.
 *
 * The background text and the item card are BOTH canonical MCDM and they
 * disagree, so something has to reconcile them and it cannot be the content:
 * T3.4a named items after their cards deliberately.
 *
 * This is NOT the Coin Purse anti-pattern (see the note in
 * `character-creator.mjs`). That name match STAMPED A PROPERTY the data should
 * have carried, so a compendium-dragged purse silently differed from a
 * wizard-made one. This map only chooses WHICH shipped item to clone; every
 * path produces the same document, and an entry that stops matching shows up
 * as an unresolved string rather than as a silently wrong item.
 *
 * Keep it small, and record the conflict for each entry.
 */
const EQUIPMENT_ALIASES = new Map([
  // Backgrounds say "quiver of arrows"; the ammunition card is "Quiver of 20
  // Arrows". Normalization cannot bridge it because of the embedded count.
  ["quiverofarrows", "Quiver of 20 Arrows"]
]);

const EQUIPMENT_PACKS = [
  ["crows.crows-gear", "gear"],
  ["crows.crows-weapons", "weapon"],
  ["crows.crows-armor", "armor"],
  ["crows.crows-consumables", "consumable"],
  ["crows.crows-ammunition", "ammunition"]
];

async function _lookupItemByName(name, packKey, fallbackType) {
  if (!name) return null;
  // 1) Try the named compendium.
  const pack = packKey ? game.packs?.get(packKey) : null;
  if (pack) {
    const wanted = comparisonKey(name);
    const idx = pack.index?.contents?.find(c => c.name === name)
              ?? pack.index?.contents?.find(c => c.name?.toLowerCase() === name.toLowerCase())
              ?? pack.index?.contents?.find(c => comparisonKey(c.name) === wanted);
    if (idx) return await pack.getDocument(idx._id);
  }
  // 2) Fallback: world item collection (handy for one-offs).
  const wi = game.items?.find(i => i.name === name && (!fallbackType || i.type === fallbackType))
          ?? game.items?.find(i => comparisonKey(i.name) === comparisonKey(name)
                                && (!fallbackType || i.type === fallbackType));
  return wi ?? null;
}

/** Search every equipment pack for one name, in the documented order. */
async function _lookupEquipment(name) {
  for (const [packKey, type] of EQUIPMENT_PACKS) {
    const doc = await _lookupItemByName(name, packKey, type);
    if (doc) return doc;
  }
  const aliased = EQUIPMENT_ALIASES.get(comparisonKey(name));
  if (!aliased) return null;
  for (const [packKey, type] of EQUIPMENT_PACKS) {
    const doc = await _lookupItemByName(aliased, packKey, type);
    if (doc) return doc;
  }
  return null;
}

/**
 * Split one background equipment string into what it actually asks for.
 *
 * PT2 overloads a trailing parenthetical with three unrelated meanings, and a
 * leading "extra" with a fourth:
 *
 *   "animal feed (6)"           -> six of an item        (quantity)
 *   "goat (pet)"                -> a live Actor          (NOT an Item)
 *   "musical instrument (lute)" -> an item, specialised  (qualifier)
 *   "extra knife"               -> another of a kit item (quantity)
 *   "50 gold coins"             -> coins, not an item at all
 *
 * `raw` is preserved so callers can report exactly what failed to resolve.
 */
/**
 * The name an embedded copy should carry.
 *
 * A qualifier is only meaningful when the item was found by its STRIPPED name.
 * If the full string already matched a shipped item — which is the whole point
 * of the four separately-named Lore Books — the qualifier is part of that name
 * already, and appending it produces "Lore Book (Historical Lore) (Historical
 * Lore)". That shipped, and only a live run caught it: the node tests check
 * name RESOLUTION, and this is the item-CONSTRUCTION path.
 *
 * @param {string} docName   name of the resolved compendium document
 * @param {{qualifier: string}} parsed
 * @param {boolean} matchedFullString  did the raw entry resolve directly?
 */
export function embeddedItemName(docName, parsed, matchedFullString) {
  if (!parsed?.qualifier || matchedFullString) return docName;
  const label = parsed.qualifier.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${docName} (${label})`;
}

export function parseEquipmentEntry(input) {
  const raw = String(input ?? "").trim();
  const base = { raw, kind: "item", name: raw, quantity: 1, qualifier: "" };
  if (!raw) return { ...base, kind: "empty" };

  // "50 gold coins" / "50 extra gold coins" — not an item.
  const gold = raw.match(/^(\d+)\s+(?:extra\s+)?gold\s+coins?$/i);
  if (gold) return { ...base, kind: "gold", amount: Number(gold[1]), name: "" };

  let name = raw;
  let quantity = 1;
  let qualifier = "";
  let kind = "item";

  const paren = name.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (paren) {
    const inner = paren[2].trim();
    if (/^pet$/i.test(inner)) { kind = "pet"; name = paren[1].trim(); }
    else if (/^\d+$/.test(inner)) { quantity = Number(inner); name = paren[1].trim(); }
    else { qualifier = inner; name = paren[1].trim(); }
  }

  // "extra knife" is a second Knife alongside the universal kit's (C:36).
  const extra = name.match(/^extra\s+(.*)$/i);
  if (extra) name = extra[1].trim();

  return { raw, kind, name, quantity, qualifier };
}

function _parseStartingTrait(s) {
  if (!s || typeof s !== "string") return null;
  const idx = s.indexOf(":");
  if (idx < 0) return { tree: null, name: s.trim() };
  return { tree: s.slice(0, idx).trim(), name: s.slice(idx + 1).trim() };
}

export async function applyBackground(actor, bg) {
  if (!actor || !bg) return { ok: false, error: "missing args" };
  if (actor.type && actor.type !== "crow") return { ok: false, error: "not a crow" };
  const sys = bg.system ?? {};
  const updates = {
    "system.background": bg.name,
    "system.backgroundId": bg.id ?? bg._id ?? "",
    "system.stamina.max": sys.stamina ?? 5,
    "system.stamina.value": sys.stamina ?? 5
  };

  // Background grants are USES, not PT1's always-on skill bonuses. Both stored
  // quantities rise together: `max` is permanently owned and `value` is the
  // same newly-granted uses available now. Duplicate rows are summed so a bad
  // transcription cannot silently discard one grant.
  const grants = new Map();
  for (const expertise of sys.expertises ?? []) {
    const key = expertise?.key;
    const uses = Math.max(0, Math.floor(Number(expertise?.uses) || 0));
    if (!key || !uses) continue;
    grants.set(key, (grants.get(key) ?? 0) + uses);
  }
  for (const [key, uses] of grants) {
    const current = actor.system?.expertises?.[key] ?? {};
    updates[`system.expertises.${key}.max`] = (Number(current.max) || 0) + uses;
    updates[`system.expertises.${key}.value`] = (Number(current.value) || 0) + uses;
  }
  await actor.update(updates);

  const toCreate = [];

  // Equipment. Each string is parsed before lookup, because PT2 overloads the
  // trailing parenthetical (quantity / live pet / specialisation) and a stub
  // named "goat (pet)" in the backpack is worse than no card at all.
  //
  // A resolvable name still falls back to a minimal stub so the slot gets a
  // card — but the stub is now REPORTED, so "creation looked fine" and "every
  // item resolved" stop being the same thing.
  // Read the declared grants FIRST. `bonusGold` and `pets` are their own schema
  // fields now; the string-shaped forms below are a fallback for content that
  // predates them (a world DataModel migrates on load, but a plain object
  // fixture handed straight to this function does not).
  const bonusGold = Number(sys.bonusGold) ? [Number(sys.bonusGold)] : [];
  const pets = (sys.pets ?? []).map((name) => ({
    raw: String(name), name: String(name), resolved: false, declared: true
  }));
  const stubbed = [];

  for (const entry of sys.equipment ?? []) {
    const parsed = parseEquipmentEntry(entry);
    if (parsed.kind === "empty") continue;

    if (parsed.kind === "gold") {
      bonusGold.push(parsed.amount);
      continue;
    }

    // Try the string exactly as written FIRST. `lore book (historical lore)`
    // resolves to the item of that name, so stripping the parenthetical before
    // lookup would break the very case the four Lore Books were named for.
    let eqDoc = await _lookupEquipment(parsed.raw);
    const matchedFullString = Boolean(eqDoc);
    if (!eqDoc && parsed.name !== parsed.raw) eqDoc = await _lookupEquipment(parsed.name);

    if (parsed.kind === "pet") {
      // Already declared in `system.pets`? Then this is the same grant reaching
      // us twice and must not be doubled.
      if (pets.some((p) => p.name.toLowerCase() === parsed.name.toLowerCase())) continue;
      // A pet is an Actor with an ownership record, not a backpack card. The
      // engine owns that write (`petOwnerUpdate`); creating world Actors during
      // character creation is a separate decision, so report the request and
      // deliberately create NOTHING here.
      pets.push({ raw: parsed.raw, name: parsed.name, resolved: Boolean(eqDoc) });
      continue;
    }

    if (eqDoc) {
      const data = eqDoc.toObject();
      delete data._id; delete data._key;
      // Drop into the backpack so the slot grid picks it up.
      data.system = { ...(data.system ?? {}), location: { container: "backpack", index: 0, length: data.system?.slots ?? 1 } };
      if (parsed.quantity > 1) data.system.quantity = parsed.quantity;
      // A qualifier the item itself cannot hold ("musical instrument (lute)")
      // is kept on the embedded copy's name. Safe because this document is a
      // clone on the actor, so no compendium lookup depends on it.
      data.name = embeddedItemName(data.name, parsed, matchedFullString);
      toCreate.push(data);
    } else {
      stubbed.push(parsed.raw);
      toCreate.push({ name: parsed.raw, type: "gear", system: { location: { container: "backpack", index: 0, length: 1 } } });
    }
  }

  // Spellbooks → look up the matching spell card in the spellbook compendium.
  for (const name of sys.spellbooks ?? []) {
    const spell = await _lookupItemByName(name, "crows.crows-spellbooks", "spellbook");
    if (spell) {
      const data = spell.toObject();
      delete data._id; delete data._key;
      toCreate.push(data);
    } else {
      toCreate.push({ name, type: "spellbook" });
    }
  }

  // Starting trait — parse "Tree: TraitName" and embed the compendium trait.
  const parsed = _parseStartingTrait(sys.startingTrait);
  let startingTraitEmbedded = false;
  if (parsed?.name) {
    const trait = await _lookupItemByName(parsed.name, "crows.crows-traits", "trait");
    if (trait) {
      const data = trait.toObject();
      delete data._id; delete data._key;
      toCreate.push(data);
      startingTraitEmbedded = true;
    }
  }

  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);

  return {
    ok: true,
    applied: bg.name,
    backgroundId: bg.id ?? bg._id ?? "",
    expertiseUses: Object.fromEntries(grants),
    startingTrait: parsed?.name ?? null,
    startingTraitEmbedded,
    itemsCreated: toCreate.length,
    // Coins the background grants on top of the universal 3d6 (C:36). Returned
    // rather than written, because the purse is an Item the caller creates.
    bonusGold: bonusGold.reduce((sum, n) => sum + n, 0),
    // Live animals the background grants. NOT created here — see above.
    pets,
    // Equipment strings that produced a bare stub. Empty is the healthy state;
    // anything here is a real gap between the backgrounds and the item packs.
    stubbed
  };
}

/**
 * Shape a background Item for display on the crow sheet's Bio tab.
 *
 * Pure: it takes the background's `system` object and a localizer, and returns
 * plain data. The sheet resolves the document; this decides what a player sees.
 *
 * WHY THIS EXISTS. The Bio tab showed the background as a free-text input and
 * nothing else, so a player could read their character's origin as a word and
 * learn nothing from it — not the expertise uses it granted, not the trait it
 * started them with, not the animal it gave them. Every one of those is already
 * on the sheet SOMEWHERE, mixed in with everything earned since; what was
 * missing was provenance.
 *
 * @param {object} sys        A BackgroundData system object.
 * @param {(key: string) => string} t   Localizer for expertise labels.
 */
export function backgroundSummary(sys, t = (k) => k) {
  if (!sys) return null;
  const expertises = (sys.expertises ?? [])
    // `many` is precomputed rather than compared in the template: this project
    // registers no `gt` helper, and shaping belongs here regardless.
    .map((e) => ({
      key: e.key, label: t(`CROWS.Expertise.${e.key}`),
      uses: e.uses ?? 1, many: (e.uses ?? 1) > 1
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // A background either FIXES the characteristic at 2 or offers a choice
  // (C:28). Three shipped forms: one option, two, or all three ("any").
  const options = sys.characteristicOptionsAt2 ?? [];
  const characteristic = {
    keys: options,
    labels: options.map((k) => t(`CROWS.Characteristic.${k}`)),
    // Joined here for the same reason — no `join` helper exists.
    labelText: options.map((k) => t(`CROWS.Characteristic.${k}`)).join(", "),
    isChoice: options.length > 1,
    isAny: options.length >= 3
  };

  return {
    flavor: sys.flavor ?? "",
    stamina: sys.stamina ?? 5,
    characteristic,
    startingTrait: sys.startingTrait ?? "",
    expertises,
    totalUses: expertises.reduce((n, e) => n + e.uses, 0),
    equipment: [...(sys.equipment ?? [])],
    spellbooks: [...(sys.spellbooks ?? [])],
    pets: [...(sys.pets ?? [])],
    bonusGold: Number(sys.bonusGold) || 0,
    startingGold: sys.startingGold ?? "3d6"
  };
}
