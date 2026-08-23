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

async function _lookupItemByName(name, packKey, fallbackType) {
  if (!name) return null;
  // 1) Try the named compendium.
  const pack = packKey ? game.packs?.get(packKey) : null;
  if (pack) {
    const idx = pack.index?.contents?.find(c => c.name === name)
              ?? pack.index?.contents?.find(c => c.name?.toLowerCase() === name.toLowerCase());
    if (idx) return await pack.getDocument(idx._id);
  }
  // 2) Fallback: world item collection (handy for one-offs).
  const wi = game.items?.find(i => i.name === name && (!fallbackType || i.type === fallbackType));
  return wi ?? null;
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

  // Equipment → as gear by name (looked up in the gear compendium for full card data;
  // falls back to a minimal stub so the slot still gets a card).
  for (const name of sys.equipment ?? []) {
    const eqDoc = await _lookupItemByName(name, "crows.crows-gear", "gear")
              ?? await _lookupItemByName(name, "crows.crows-weapons", "weapon")
              ?? await _lookupItemByName(name, "crows.crows-armor", "armor")
              ?? await _lookupItemByName(name, "crows.crows-consumables", "consumable")
              ?? await _lookupItemByName(name, "crows.crows-ammunition", "ammunition");
    if (eqDoc) {
      const data = eqDoc.toObject();
      delete data._id; delete data._key;
      // Drop into the backpack so the slot grid picks it up.
      data.system = { ...(data.system ?? {}), location: { container: "backpack", index: 0, length: data.system?.slots ?? 1 } };
      toCreate.push(data);
    } else {
      toCreate.push({ name, type: "gear", system: { location: { container: "backpack", index: 0, length: 1 } } });
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
    itemsCreated: toCreate.length
  };
}
