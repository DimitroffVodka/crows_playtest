export async function rollUsageDie(item, { forced = null } = {}) {
  const ud = item.system?.usageDie;
  if (!ud?.enabled || ud.udCurrent <= 0) return { removed: false, udCurrent: ud?.udCurrent ?? 0, depleted: (ud?.udCurrent ?? 0) <= 0 };
  const r = forced ?? (await new Roll("1d6").evaluate()).total;
  const removed = r <= 2;
  const next = removed ? Math.max(0, ud.udCurrent - 1) : ud.udCurrent;
  if (removed) await item.update({ "system.usageDie.udCurrent": next });
  return { removed, roll: r, udCurrent: next, depleted: next <= 0 };
}
