export async function applyBackground(actor, bg) {
  const sys = bg.system;
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
  for (const name of sys.equipment ?? []) toCreate.push({ name, type: "gear", system: { location: { container: "backpack", index: 0, length: 1 } } });
  for (const name of sys.spellbooks ?? []) toCreate.push({ name, type: "spellbook" });
  if (toCreate.length) await actor.createEmbeddedDocuments("Item", toCreate);
  return { ok: true, applied: bg.name };
}
