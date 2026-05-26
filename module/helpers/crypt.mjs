/**
 * Crypt — village institution that grants boons via dead crows.
 *
 * Rules Booklet pp.6158–6235.
 *
 *   - When a crow dies, their remains can be interred in the village
 *     Crypt. The player picks a boon for the dead crow.
 *   - Once per cycle, the dead crow can grant their boon to a living
 *     crow who prays at their grave.
 *   - A living crow can have only one active boon at a time. Praying
 *     while holding a boon overwrites the old one.
 *   - Expending a boon takes no action; once expended, it's gone.
 *
 * The Crypt has a level 1–5 (+6 unlock at Prosperity 10). Level affects
 * the magnitude of every boon. This module currently stores the level
 * as a world setting; the M3 Village system will fold this into the
 * full institution model.
 */

const NS = "crows";
const KEY_LEVEL = "cryptLevel";
const KEY_INTERMENTS = "cryptInterments";
const KEY_CYCLE = "cryptCycleId";

/**
 * Full boon registry. Each entry:
 *   id          internal key (matches activeBoon.boonId)
 *   label       display name
 *   summary     one-line for chat cards
 *   uses(lvl)   number of charges granted; default 1 (single-use)
 *   text(lvl)   rules text expanded with current crypt level
 *   applyTo     'heal' | 'damage' | 'speed' | 'roll' | 'narrative'
 *                — declares which automatic integration point reads it.
 *                'narrative' means GM adjudicates manually.
 *   value(lvl)  numeric bonus for automatic integrations.
 */
export const CRYPT_BOONS = {
  cooperation: {
    id: "cooperation", label: "Boon of Cooperation", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => 2 * lvl,
    summary: (lvl) => `Next assist grants an extra +${2 * lvl} to the test you aid.`,
    text: (lvl) => `When you make an assist, expend this boon to grant an additional bonus to the test you aid equal to twice the crypt's level (+${2 * lvl}).`
  },
  disappearance: {
    id: "disappearance", label: "Boon of Disappearance", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => lvl,
    summary: (lvl) => `Become invisible for ${lvl} combat round${lvl > 1 ? "s" : ""}.`,
    text: (lvl) => `Use this boon to become invisible for a number of combat rounds equal to the crypt's level (${lvl}).`
  },
  escape: {
    id: "escape", label: "Boon of Escape", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => 3 * lvl,
    summary: (lvl) => `Teleport ${3 * lvl} squares.`,
    text: (lvl) => `Expend this boon to teleport a number of squares equal to three times the crypt's level (${3 * lvl}).`
  },
  flight: {
    id: "flight", label: "Boon of Flight", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => lvl,
    summary: (lvl) => `Gain flying speed = your speed for ${lvl} combat round${lvl > 1 ? "s" : ""}.`,
    text: (lvl) => `Use this boon to gain a flying speed equal to your speed for a number of combat rounds equal to the crypt's level (${lvl}).`
  },
  fury: {
    id: "fury", label: "Boon of Fury", applyTo: "damage",
    uses: () => 1,
    value: (lvl) => lvl,                          // +lvl × d6 damage
    summary: (lvl) => `Add ${lvl}d6 damage to your next damaging attack.`,
    text: (lvl) => `When you deal damage with an attack, expend this boon to deal an additional ${lvl}d6 damage to the target.`
  },
  greed: {
    id: "greed", label: "Boon of Greed", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => lvl,
    summary: (lvl) => `Learn the location of the ${lvl} most valuable treasures on this dungeon level.`,
    text: (lvl) => `In a dungeon, expend this boon to learn the direction of (and number of chambers to) the ${lvl} most valuable treasures on the same level as you.`
  },
  knowledge: {
    id: "knowledge", label: "Boon of Knowledge", applyTo: "narrative",
    uses: () => 1,
    value: (lvl) => lvl,
    summary: (lvl) => `Ask the Ref up to ${lvl} honest questions about a named subject.`,
    text: (lvl) => `Expend this boon, choose a specific creature, place, event, or organization by name. Ask the Ref up to ${lvl} questions about the subject; they must answer honestly.`
  },
  rescue: {
    id: "rescue", label: "Boon of Rescue", applyTo: "narrative",
    uses: (lvl) => lvl,                           // multi-use: lvl charges
    value: () => 1,
    summary: (lvl) => `After a Recovery Roll, improve the result by 1 tier (${lvl} use${lvl > 1 ? "s" : ""}).`,
    text: (lvl) => `After you roll a Recovery Roll, use this boon to improve the result by 1 tier. You can use this boon ${lvl} time${lvl > 1 ? "s" : ""} before it's expended.`
  },
  swiftness: {
    id: "swiftness", label: "Boon of Swiftness", applyTo: "speed",
    uses: () => 1,
    value: (lvl) => lvl,
    summary: (lvl) => `Speed +${lvl} until end of DT.`,
    text: (lvl) => `When you expend this boon, your speed increases by ${lvl} until the end of the DT.`
  },
  vitality: {
    id: "vitality", label: "Boon of Vitality", applyTo: "heal",
    uses: () => 1,
    value: (lvl) => 2 * lvl,
    summary: (lvl) => `Regain an additional +${2 * lvl} Stamina the next time you regain Stamina.`,
    text: (lvl) => `When you regain Stamina, expend this boon to regain an additional ${2 * lvl} Stamina.`
  }
};

export const BOON_IDS = Object.keys(CRYPT_BOONS);

export function registerCryptSettings() {
  game.settings.register(NS, KEY_LEVEL, {
    scope: "world",
    config: true,
    name: "Crypt Level",
    hint: "The village Crypt institution's level (1–5; 6 at Prosperity 10). Scales every boon's magnitude.",
    type: Number,
    range: { min: 0, max: 6, step: 1 },
    default: 1
  });
  game.settings.register(NS, KEY_INTERMENTS, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
  game.settings.register(NS, KEY_CYCLE, {
    scope: "world",
    config: false,
    type: Number,
    default: 0
  });
}

export function getCryptLevel() {
  try { return Math.max(0, Math.min(6, Number(game.settings.get(NS, KEY_LEVEL)) || 0)); } catch { return 1; }
}
export async function setCryptLevel(lvl) {
  return game.settings.set(NS, KEY_LEVEL, Math.max(0, Math.min(6, Math.floor(Number(lvl) || 0))));
}

export function getCycleId() {
  try { return Number(game.settings.get(NS, KEY_CYCLE)) || 0; } catch { return 0; }
}
export async function bumpCycle() {
  const cur = getCycleId();
  await game.settings.set(NS, KEY_CYCLE, cur + 1);
  // Clear once-per-cycle gates by NOT clearing actor.activeBoon — only "prayedOnCycle"
  // is consulted; bumping the world cycle makes all dead crows grantable again.
  await ChatMessage.create({
    content: `<div class="crows crypt-cycle"><strong>New village cycle:</strong> dead crows can grant boons again.</div>`,
    speaker: { alias: "Village Crypt" }
  });
  return cur + 1;
}

/** Get interment list. Returns [{ crowName, boonId, interredOn, interredBy }]. */
export function listInterments() {
  try { return [...(game.settings.get(NS, KEY_INTERMENTS) ?? [])]; } catch { return []; }
}

/**
 * Inter a dead crow with their chosen boon. Idempotent on crowName: if
 * already interred, updates the boon choice (so a player can change their
 * mind once before the next session settles in).
 */
export async function inter({ crowName, boonId, interredBy = null }) {
  if (!crowName || !boonId) return { ok: false, error: "need name+boon" };
  if (!CRYPT_BOONS[boonId]) return { ok: false, error: "unknown boon" };
  const list = listInterments();
  const idx = list.findIndex(e => e.crowName === crowName);
  const entry = { crowName, boonId, interredBy, interredOn: getCycleId() };
  if (idx >= 0) list[idx] = entry; else list.push(entry);
  await game.settings.set(NS, KEY_INTERMENTS, list);
  const boon = CRYPT_BOONS[boonId];
  await ChatMessage.create({
    content: `<div class="crows crypt-inter"><strong>${crowName}</strong> is interred in the Crypt with the <strong>${boon.label}</strong>.</div>`,
    speaker: { alias: "Village Crypt" }
  });
  return { ok: true, entry };
}

/**
 * Living crow `actor` prays at dead crow `crowName`'s grave.
 *  - Granting the boon is gated once per cycle PER GRAVE — we track via
 *    actor.activeBoon.prayedOnCycle = cycleId; world-level dedup happens
 *    because a single dead crow can only be the "source" of one boon
 *    holder at a time (the rule that "only one crow can have that dead
 *    crow's boon at a time" — but enforcement of that across the party
 *    requires GM oversight; we surface a warning if the grave is taken).
 */
export async function pray(actor, crowName) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const interred = listInterments();
  const grave = interred.find(e => e.crowName === crowName);
  if (!grave) return { ok: false, error: `${crowName} is not interred` };

  // Once-per-cycle gate.
  const cycle = getCycleId();
  const last = actor.system?.activeBoon?.prayedOnCycle ?? -1;
  if (last === cycle) {
    ui.notifications?.warn(`${actor.name} has already prayed this cycle.`);
    return { ok: false, error: "already prayed this cycle" };
  }

  // "Only one crow has that dead crow's boon at a time" — soft check via party scan.
  const conflicting = game.actors?.filter(a =>
    a.type === "crow" && a.id !== actor.id &&
    a.system?.activeBoon?.boonId === grave.boonId &&
    a.system?.activeBoon?.sourceCrowName === crowName
  ) ?? [];
  if (conflicting.length) {
    ui.notifications?.warn(`${conflicting[0].name} already holds ${crowName}'s boon. They must expend it first.`);
    return { ok: false, error: "boon already held" };
  }

  const boon = CRYPT_BOONS[grave.boonId];
  const lvl = getCryptLevel();
  const uses = boon.uses(lvl);
  await actor.update({
    "system.activeBoon.boonId": grave.boonId,
    "system.activeBoon.sourceCrowName": crowName,
    "system.activeBoon.usesLeft": uses,
    "system.activeBoon.prayedOnCycle": cycle
  });
  await ChatMessage.create({
    content: `<div class="crows crypt-pray">
      <header><strong>${actor.name}</strong> prays at <strong>${crowName}</strong>'s grave and receives the <strong>${boon.label}</strong></header>
      <div>${boon.summary(lvl)}</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { ok: true, boonId: grave.boonId, uses };
}

/**
 * Expend the actor's active boon. For automatic-integration boons this
 * just emits the chat card describing the effect — the actual numeric
 * bonus is computed by the integration point that called expendBoon().
 * Multi-use boons (Rescue) decrement; reach zero → cleared.
 */
export async function expendBoon(actor, { silent = false } = {}) {
  if (!actor || actor.type !== "crow") return { ok: false, error: "not a crow" };
  const ab = actor.system?.activeBoon;
  if (!ab?.boonId) return { ok: false, error: "no active boon" };
  const boon = CRYPT_BOONS[ab.boonId];
  if (!boon) {
    // Unknown boon id — clear it defensively.
    await actor.update({
      "system.activeBoon.boonId": "",
      "system.activeBoon.sourceCrowName": "",
      "system.activeBoon.usesLeft": 0
    });
    return { ok: false, error: "unknown boon id (cleared)" };
  }
  const lvl = getCryptLevel();
  const usesLeft = (ab.usesLeft ?? 1) - 1;
  if (usesLeft <= 0) {
    await actor.update({
      "system.activeBoon.boonId": "",
      "system.activeBoon.sourceCrowName": "",
      "system.activeBoon.usesLeft": 0
    });
  } else {
    await actor.update({ "system.activeBoon.usesLeft": usesLeft });
  }
  if (!silent) {
    await ChatMessage.create({
      content: `<div class="crows crypt-expend">
        <header><strong>${actor.name}</strong> expends <strong>${boon.label}</strong>${usesLeft > 0 ? ` (${usesLeft} charge${usesLeft > 1 ? "s" : ""} left)` : ""}</header>
        <div><em>${boon.text(lvl)}</em></div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor })
    });
  }
  return { ok: true, boon, lvl, value: boon.value(lvl), usesLeft };
}

/**
 * Helper for `damage` integration: peek the active boon and, if it's
 * Boon of Fury, roll the bonus dice and expend.
 * Returns { extra: number, rolledFormula?: string }.
 */
export async function consumeBoonOnDamage(actor) {
  const ab = actor?.system?.activeBoon;
  if (!ab?.boonId || ab.boonId !== "fury") return { extra: 0 };
  const lvl = getCryptLevel();
  const dice = Math.max(1, lvl);
  const r = await new Roll(`${dice}d6`).evaluate();
  await expendBoon(actor, { silent: true });
  await ChatMessage.create({
    content: `<div class="crows crypt-expend">
      <header><strong>${actor.name}</strong> expends <strong>Boon of Fury</strong></header>
      <div>+${r.total} extra damage (${dice}d6 = ${r.terms?.[0]?.results?.map(x => x.result).join(", ") ?? r.total})</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { extra: r.total, rolledFormula: `${dice}d6=${r.total}` };
}

/**
 * Helper for `heal` integration: if the active boon is Vitality, add the
 * fixed bonus to the heal amount and expend.
 */
export async function consumeBoonOnHeal(actor) {
  const ab = actor?.system?.activeBoon;
  if (!ab?.boonId || ab.boonId !== "vitality") return { extra: 0 };
  const lvl = getCryptLevel();
  const extra = 2 * lvl;
  await expendBoon(actor, { silent: true });
  await ChatMessage.create({
    content: `<div class="crows crypt-expend">
      <header><strong>${actor.name}</strong> expends <strong>Boon of Vitality</strong></header>
      <div>+${extra} extra Stamina restored.</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { extra };
}

/**
 * Helper for `speed` integration: if the active boon is Swiftness, set
 * a temporary speed bonus on the actor that the prepareDerivedData of
 * crow.mjs adds to base speed. Cleared at end of DT by endDungeonTurn.
 */
export async function consumeBoonOnSwiftness(actor) {
  const ab = actor?.system?.activeBoon;
  if (!ab?.boonId || ab.boonId !== "swiftness") return { extra: 0 };
  const lvl = getCryptLevel();
  await expendBoon(actor, { silent: true });
  // Stamp a speed-bonus flag the DT-end cleanup can read.
  await actor.setFlag("crows", "swiftnessUntilDtEnd", lvl);
  await ChatMessage.create({
    content: `<div class="crows crypt-expend">
      <header><strong>${actor.name}</strong> expends <strong>Boon of Swiftness</strong></header>
      <div>+${lvl} speed until end of DT.</div>
    </div>`,
    speaker: ChatMessage.getSpeaker({ actor })
  });
  return { extra: lvl };
}

/** Clear all per-DT boon side-effects (called by endDungeonTurn). */
export async function clearPerDtBoonFlags() {
  for (const a of game.actors ?? []) {
    if (a.type !== "crow") continue;
    if (a.getFlag("crows", "swiftnessUntilDtEnd")) {
      await a.unsetFlag("crows", "swiftnessUntilDtEnd");
    }
  }
}
