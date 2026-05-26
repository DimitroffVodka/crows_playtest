/**
 * Character creation helper — stamps a Background onto a crow.
 *
 * Sets stamina/background, increments listed skills (capped at +2), creates
 * inventory items for equipment + spellbooks, and (NEW) auto-embeds the
 * starting trait by looking it up in the trait compendium.
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
  const sys = bg.system ?? {};
  const updates = {
    "system.background": bg.name,
    "system.stamina.max": sys.stamina,
    "system.stamina.value": sys.stamina
  };
  for (const s of sys.skills ?? []) {
    const cur = actor.system.skills?.[s]?.bonus ?? 0;
    updates[`system.skills.${s}.bonus`] = Math.min(2, cur + 1);
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
    startingTrait: parsed?.name ?? null,
    startingTraitEmbedded,
    itemsCreated: toCreate.length
  };
}
