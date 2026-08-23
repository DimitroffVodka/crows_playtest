/**
 * Pure creature-sheet view transforms.
 *
 * This lives outside the Foundry sheet class so layout decisions can be tested
 * against every shipped monster without booting a world. Keep this module free
 * of Foundry globals; callers supply the config catalogues and localization.
 */

const asNonNegativeInteger = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

const titleCaseKey = (key) => String(key ?? "")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/^./, (c) => c.toUpperCase());

function localizedLabel(key, prefix, localize) {
  const localizationKey = `${prefix}.${key}`;
  const translated = localize?.(localizationKey);
  return translated && translated !== localizationKey ? translated : titleCaseKey(key);
}

/**
 * Build the Foundry-free view model consumed by the PT2 creature sheet.
 *
 * Keeping this pure matters because the real compendium corpus can exercise the
 * slot/X-Rest/expertise layout without booting a world. The sheet itself only
 * adds documents and localization.
 */
export function monsterViewData(system = {}, {
  expertiseKeys = [],
  conditionKeys = [],
  localize = (key) => key
} = {}) {
  const slotCount = asNonNegativeInteger(system.slots);
  const woundSlots = new Set(
    [...(system.woundSlots ?? [])]
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
  );

  const expertiseChoices = expertiseKeys.map((key) => ({
    key,
    label: localizedLabel(key, "CROWS.Expertise", localize)
  }));

  return {
    hasSlots: slotCount > 0,
    slotCount,
    slotCells: Array.from({ length: slotCount }, (_, index) => ({
      index,
      label: `Slot ${index + 1}`,
      wounded: woundSlots.has(index)
    })),
    orphanedWoundCount: [...woundSlots].filter((index) => index >= slotCount).length,

    reactions: asNonNegativeInteger(system.reactions),
    xRestFeatures: (system.xRest ?? []).map((feature, index) => {
      const max = asNonNegativeInteger(feature?.max);
      const used = asNonNegativeInteger(feature?.used);
      return {
        ...feature,
        index,
        max,
        used,
        remaining: Math.max(0, max - used),
        overused: Math.max(0, used - max),
        canSpend: used < max,
        canRefund: used > 0
      };
    }),

    expertises: (system.expertises ?? []).map((entry, index) => ({
      ...entry,
      index,
      label: localizedLabel(entry?.key, "CROWS.Expertise", localize),
      choices: expertiseChoices.map((choice) => ({
        ...choice,
        selected: choice.key === entry?.key
      }))
    })),

    conditions: conditionKeys.map((key) => ({
      key,
      label: localizedLabel(key, "CROWS.Condition", localize),
      hint: localize?.(`CROWS.Condition.${key}Hint`) ?? "",
      active: system.conditions?.[key] === true
    }))
  };
}

/** Toggle one in-capacity wound while preserving every orphaned wound. */
export function toggleMonsterWound(woundSlots = [], index, slotCount) {
  const target = Number(index);
  const cap = asNonNegativeInteger(slotCount);
  const next = new Set(
    [...(woundSlots ?? [])]
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
  );
  if (!Number.isInteger(target) || target < 0 || target >= cap) return [...next].sort((a, b) => a - b);
  if (next.has(target)) next.delete(target);
  else next.add(target);
  return [...next].sort((a, b) => a - b);
}

/** Spend or refund exactly one X/Rest use without normalizing other data. */
export function adjustXRestUse(features = [], index, delta) {
  const target = Number(index);
  const direction = Math.sign(Number(delta) || 0);
  return (features ?? []).map((feature, i) => {
    const next = { ...feature };
    if (i !== target || !direction) return next;
    const used = asNonNegativeInteger(feature?.used);
    const max = asNonNegativeInteger(feature?.max);
    if (direction > 0 && used < max) next.used = used + 1;
    if (direction < 0 && used > 0) next.used = used - 1;
    return next;
  });
}
