/**
 * Advancement — XP, the two Playtest 2 advancement tracks, and trait purchase.
 *
 * Playtest 2 replaces BOTH tables wholesale (C:603-659). Nothing from Playtest 1
 * survives: the thresholds moved, "skills" became expertises with a
 * {value, max} pool, the bonus is a three-way CHOICE rather than a fixed
 * package, and the characteristic cap went 3 -> 4.
 *
 *  - XP = treasure value / player count, excluding purchased, crafted,
 *    taken-from-an-innocent and ally-owned goods (C:605). TXP is lifetime and
 *    never decreases; `spendable` is what is left to spend.
 *  - Expertise & Stamina track (C:621): 100 / 500 / 1,250 / 2,250 / 3,500 /
 *    5,000 / 10,000 / 20,000 / 30,000, then every 30,000 after — which begins
 *    at 60,000, not immediately after 30,000. Max uses curve 2/2/2/2/2/3/3/4/4.
 *  - Each bonus is a CHOICE (C:615): 3 expertise uses distributed freely, OR
 *    +2 Stamina max, OR 1 use + 1 Stamina max. This module returns the options
 *    and validates a chosen distribution; it never auto-picks.
 *  - Characteristic track (C:642): 5,000 / 15,000 / 30,000 / every 30,000
 *    after. +1 to one characteristic, PC cap 4. All three at the cap -> +2
 *    Stamina max instead.
 *  - Spending and claiming bonuses happen at the END OF A REST (C:609).
 *  - Traits (C:661-671): starting traits 500 XP, anything else must connect by
 *    a line to a trait already owned on that tree, one purchase each. A trait
 *    that scales off a characteristic has a MINIMUM MODIFIER of 1 (C:671).
 *  - Retirement at 60,000 TXP.
 *
 * SHAPE. Everything that decides anything is a pure function over a "crow-like"
 * — any object with `.system` (and `.items` for traits). The async `gain*` /
 * `spend*` / `purchase*` wrappers only apply an already-planned update and
 * announce it, so the rules are unit-testable without a Foundry runtime and
 * `test/shim/foundry.mjs` does not have to grow an Actor.
 *
 * The trait-tree purchase GRID is the crow sheet's (T2.1). This module exposes
 * the data that grid needs and renders nothing.
 */

import {
  CROWS, ALL_EXPERTISES, expertiseCategory, expertiseMaxForTxp, bonusesEarnedAtTxp
} from "../config.mjs";
import { grantItem, makeGrantContext } from "./item-grants.mjs";

/** C:615 — the bonus's third option is "+2 Stamina max". Not in CROWS; see the
 *  note in the T1.4 report. Kept named rather than inline so the three options
 *  below read as the rule does. */
const STAMINA_PER_BONUS = 2;
/** C:615 — the split option: 1 expertise use AND +1 Stamina max. */
const SPLIT_USES = 1;
const SPLIT_STAMINA = 1;
/** C:640 — all three characteristics at the PC cap converts the advancement. */
const CHAR_OVERFLOW_STAMINA = 2;
/** C:671 — a trait scaling off a characteristic never scales below 1. */
export const TRAIT_MIN_MODIFIER = 1;

/** Flag that records whether the end-of-rest spending window is open (C:609).
 *  A flag rather than a schema field: the contract froze `CrowData` without one,
 *  `takeRest` opens it after completion and `rollTest` closes it before the next
 *  test's side effects. */
export const ADVANCEMENT_WINDOW_SCOPE = "crows";
export const ADVANCEMENT_WINDOW_KEY = "advancementWindow";

const CHARACTERISTIC_KEYS = Object.keys(CROWS.characteristics);

const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const sysOf = (crow) => crow?.system ?? {};
const int = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const notify = (kind, msg) => globalThis.ui?.notifications?.[kind]?.(msg);

/* -------------------------------------------------------------------------- */
/* Tables                                                                      */
/* -------------------------------------------------------------------------- */

/** Expertise & Stamina bonuses earned at this TXP (C:621). Delegates to the
 *  tested implementation in config.mjs — the table lives in exactly one place. */
export function expertiseBonusesEarned(txp = 0) {
  return bonusesEarnedAtTxp(Math.max(0, int(txp)));
}

/**
 * Characteristic advancements earned at this TXP (C:642): 5,000 / 15,000 /
 * 30,000, then one per 30,000 after — so 60,000 is the 4th, not 30,001.
 */
export function charBonusesEarned(txp = 0) {
  txp = Math.max(0, int(txp));
  const table = CROWS.charAdvancement;
  if (txp < table[0]) return 0;
  const last = table.at(-1);
  if (txp < last) return table.filter(t => txp >= t).length;
  return table.length + Math.floor((txp - last) / CROWS.charAdvancementRepeat);
}

/** Both tracks at once. Replaces the PT1 `{skill, char}` shape. */
export function bonusesEarned(txp = 0) {
  return { expertise: expertiseBonusesEarned(txp), char: charBonusesEarned(txp) };
}

/** The TXP at which the next Expertise & Stamina bonus lands. */
export function nextExpertiseBonusTXP(txp = 0) {
  txp = Math.max(0, int(txp));
  const table = CROWS.expertiseAdvancement;
  const row = table.find(r => r.txp > txp);
  if (row) return row.txp;
  const last = table.at(-1).txp;
  const step = CROWS.expertiseAdvancementRepeat;
  return last + step * (Math.floor((txp - last) / step) + 1);
}

/** The TXP at which the next characteristic advancement lands. */
export function nextCharBonusTXP(txp = 0) {
  txp = Math.max(0, int(txp));
  const table = CROWS.charAdvancement;
  const next = table.find(t => t > txp);
  if (next) return next;
  const last = table.at(-1);
  const step = CROWS.charAdvancementRepeat;
  return last + step * (Math.floor((txp - last) / step) + 1);
}

/** Both next thresholds. */
export function nextAdvancementTXP(txp = 0) {
  return { expertise: nextExpertiseBonusTXP(txp), char: nextCharBonusTXP(txp) };
}

/** The soonest of the two — kept returning a NUMBER, as PT1's did. */
export function nextBonusTXP(txp = 0) {
  const n = nextAdvancementTXP(txp);
  return Math.min(n.expertise, n.char);
}

/** Retirement (60,000 TXP). */
export function retirementStatus(txp = 0) {
  txp = Math.max(0, int(txp));
  const threshold = CROWS.retirementTXP;
  return { txp, threshold, eligible: txp >= threshold, remaining: Math.max(0, threshold - txp) };
}

/* -------------------------------------------------------------------------- */
/* Availability                                                                */
/* -------------------------------------------------------------------------- */

/** Unspent advancements on both tracks. `expertiseBonusesSpent` was
 *  `skillBonusesSpent` in PT1; the migration (T1.3) carries the value over. */
export function bonusesAvailable(crow) {
  const xp = sysOf(crow).xp ?? {};
  const earned = bonusesEarned(xp.txp ?? 0);
  const spent = {
    expertise: Math.max(0, int(xp.expertiseBonusesSpent)),
    char: Math.max(0, int(xp.charBonusesSpent))
  };
  return {
    expertise: Math.max(0, earned.expertise - spent.expertise),
    char: Math.max(0, earned.char - spent.char),
    earned, spent
  };
}

/** The legal per-expertise ceiling for this crow (2 / 3 / 4). Derived, never
 *  stored — and 2, not 0, below the table's first row. */
export function expertiseCapFor(crow) {
  return expertiseMaxForTxp(sysOf(crow).xp?.txp ?? 0);
}

/** The three options a single Expertise & Stamina bonus offers (C:615). Fresh
 *  objects each call so a caller cannot mutate a shared table. */
export function advancementBonusOptions() {
  return [
    { id: "uses", uses: CROWS.expertiseUsesPerBonus, stamina: 0,
      label: `${CROWS.expertiseUsesPerBonus} expertise uses, distributed freely` },
    { id: "stamina", uses: 0, stamina: STAMINA_PER_BONUS,
      label: `+${STAMINA_PER_BONUS} Stamina max` },
    { id: "useAndStamina", uses: SPLIT_USES, stamina: SPLIT_STAMINA,
      label: `${SPLIT_USES} expertise use and +${SPLIT_STAMINA} Stamina max` }
  ];
}

/**
 * Everything the sheet needs to offer a bonus: what is available, the cap, the
 * three options, and per-expertise room. Data only — the choice is the
 * player's, and this never makes it for them.
 */
export function advancementOptions(crow) {
  const sys = sysOf(crow);
  const avail = bonusesAvailable(crow);
  const cap = expertiseCapFor(crow);
  const current = sys.expertises ?? {};
  const expertises = ALL_EXPERTISES.map(key => {
    const max = Math.max(0, int(current[key]?.max));
    return {
      key,
      category: expertiseCategory(key),
      labelKey: `CROWS.Expertise.${key}`,
      value: Math.max(0, int(current[key]?.value)),
      max,
      room: Math.max(0, cap - max),
      overCap: Math.max(0, max - cap)
    };
  });
  const chars = sys.characteristics ?? {};
  const atCap = CHARACTERISTIC_KEYS.filter(k => int(chars[k]?.value) >= CROWS.charPcCap);
  return {
    available: avail,
    cap,
    charCap: CROWS.charPcCap,
    options: advancementBonusOptions(),
    expertises,
    roomTotal: expertises.reduce((n, e) => n + e.room, 0),
    characteristics: CHARACTERISTIC_KEYS.map(k => ({
      key: k,
      value: int(chars[k]?.value),
      atCap: int(chars[k]?.value) >= CROWS.charPcCap
    })),
    // All three at the cap converts the characteristic advancement (C:640).
    charAdvancementConverts: atCap.length === CHARACTERISTIC_KEYS.length,
    window: spendingWindow(crow),
    retirement: retirementStatus(sys.xp?.txp ?? 0)
  };
}

/* -------------------------------------------------------------------------- */
/* The end-of-rest spending window (C:609)                                     */
/* -------------------------------------------------------------------------- */

/**
 * "You can only spend XP or claim bonuses at the end of a rest."
 *
 * The flag has three states, and the third one matters: UNSET means nothing has
 * ever opened or closed the window, which is what a world looks like before
 * rest (T1.5) is wired to it. Unset is treated as permissive — a missing
 * integration must not silently forbid all advancement — while an explicit
 * `false` is enforced. Every gated call also takes `{ force: true }` for a Ref
 * overriding it deliberately.
 */
export function spendingWindow(crow) {
  const raw = crow?.flags?.[ADVANCEMENT_WINDOW_SCOPE]?.[ADVANCEMENT_WINDOW_KEY];
  if (raw === undefined || raw === null) return { open: true, state: "unset" };
  return { open: !!raw, state: raw ? "open" : "closed" };
}

/** Lifecycle policy: takeRest opens the window after all completion work;
 *  rollTest closes it before any test side effect. "The next test" is the
 *  chosen product boundary — the book defines only "at the end of a rest",
 *  not a duration. Both helpers are no-ops on anything that is not a crow. */
export async function setSpendingWindow(actor, open) {
  if (actor?.type !== "crow") return { ok: false, error: "not a crow" };
  await actor.setFlag?.(ADVANCEMENT_WINDOW_SCOPE, ADVANCEMENT_WINDOW_KEY, !!open);
  return { ok: true, open: !!open };
}
export const openSpendingWindow = (actor) => setSpendingWindow(actor, true);
export const closeSpendingWindow = (actor) => setSpendingWindow(actor, false);

function gateCheck(crow, force) {
  if (force) return null;
  const w = spendingWindow(crow);
  if (w.open) return null;
  return fail("spending is only allowed at the end of a rest (C:609)", { gate: w });
}

/* -------------------------------------------------------------------------- */
/* XP accrual (C:605)                                                          */
/* -------------------------------------------------------------------------- */

const XP_EXCLUSIONS = [
  ["purchased", "purchased"],
  ["crafted", "crafted"],
  ["fromInnocent", "taken from an innocent"],
  ["allyOwned", "originally an ally's"],
  ["fromVillage", "not recovered outside the village"]
];

/**
 * Treasure XP for a haul (C:605): value of what was recovered, divided by the
 * number of players. A unique item may carry an explicit `xpValue`, which is
 * used INSTEAD of its gold value rather than on top of it.
 *
 * Entries: `{ name, value, xpValue?, purchased?, crafted?, fromInnocent?,
 * allyOwned?, fromVillage? }`. Excluded entries are returned with their reason
 * rather than dropped, so the Ref can see what was left out.
 */
export function treasureXP(entries = [], { players = 1 } = {}) {
  const count = Math.max(1, int(players, 1));
  const counted = [];
  const excluded = [];
  let total = 0;
  for (const raw of entries ?? []) {
    if (!raw) continue;
    const name = raw.name ?? "(unnamed)";
    const reason = XP_EXCLUSIONS.find(([flag]) => raw[flag])?.[1];
    if (reason) { excluded.push({ name, reason }); continue; }
    const xp = raw.xpValue === undefined || raw.xpValue === null
      ? Math.max(0, int(raw.value))
      : Math.max(0, int(raw.xpValue));
    counted.push({ name, xp, explicit: raw.xpValue !== undefined && raw.xpValue !== null });
    total += xp;
  }
  return { total, players: count, perPlayer: Math.floor(total / count), counted, excluded };
}

/**
 * Award XP. TXP is lifetime and only ever rises; `spendable` moves with it.
 * A negative `amount` corrects a mis-award: it reduces spendable but leaves TXP
 * alone, because TXP never decreases (C:603).
 */
export async function gainXP(actor, amount, { silent = false } = {}) {
  if (!actor || actor.type !== "crow") return fail("not a crow");
  amount = int(amount);
  if (!amount) return fail("zero amount");
  const sys = sysOf(actor);
  const txpBefore = Math.max(0, int(sys.xp?.txp));
  const spendBefore = Math.max(0, int(sys.xp?.spendable));
  const txpAfter = amount > 0 ? txpBefore + amount : txpBefore;
  const spendAfter = Math.max(0, spendBefore + amount);
  await actor.update({ "system.xp.txp": txpAfter, "system.xp.spendable": spendAfter });

  if (!silent) {
    const before = bonusesEarned(txpBefore);
    const after = bonusesEarned(txpAfter);
    const deltas = [];
    if (after.expertise > before.expertise) {
      const d = after.expertise - before.expertise;
      deltas.push(`+${d} expertise/Stamina bonus${d > 1 ? "es" : ""}`);
    }
    if (after.char > before.char) {
      const d = after.char - before.char;
      deltas.push(`+${d} characteristic advancement${d > 1 ? "s" : ""}`);
    }
    const deltaLine = deltas.length
      ? `<div class="adv-delta"><strong>New:</strong> ${deltas.join(", ")}</div>` : "";
    await globalThis.ChatMessage?.create({
      content: `<div class="crows xp-gain">
        <header><strong>${actor.name}</strong> gains <strong>${amount} XP</strong></header>
        <div>TXP: ${txpBefore} → ${txpAfter} · Spendable: ${spendBefore} → ${spendAfter}</div>
        ${deltaLine}
      </div>`,
      speaker: globalThis.ChatMessage?.getSpeaker({ actor })
    });
  }
  return { ok: true, txp: txpAfter, spendable: spendAfter };
}

/* -------------------------------------------------------------------------- */
/* Expertise & Stamina advancement (C:615, C:621)                              */
/* -------------------------------------------------------------------------- */

/**
 * Validate a free distribution of `uses` expertise uses and return the update.
 *
 * Both quantities move together: a use bought at the end of a rest is available
 * immediately, so `max` AND `value` rise. `value` is never written above `max`
 * — if a stored value is already above its max (which derived data reports and
 * does not trust), the clamp brings it back rather than carrying the excess.
 *
 * The cap is `expertiseMaxForTxp(txp)`, so an expertise already at or over the
 * cap has no room and the whole distribution is refused. Uses may be placed in
 * an expertise the crow does not have yet (C:615) — that is a max of 0 with
 * full room, not an error.
 */
export function planExpertiseDistribution(crow, distribution = {}, { uses = CROWS.expertiseUsesPerBonus } = {}) {
  const sys = sysOf(crow);
  const cap = expertiseCapFor(crow);
  const current = sys.expertises ?? {};
  const roomTotal = ALL_EXPERTISES
    .reduce((n, k) => n + Math.max(0, cap - Math.max(0, int(current[k]?.max))), 0);

  const wanted = Math.max(0, int(uses));
  const updates = {};
  let total = 0;

  for (const [key, rawN] of Object.entries(distribution ?? {})) {
    if (!ALL_EXPERTISES.includes(key)) return fail(`unknown expertise: ${key}`, { cap, roomTotal });
    const n = Number(rawN);
    if (!Number.isInteger(n) || n < 0) {
      return fail(`${key}: allocation must be a non-negative whole number`, { cap, roomTotal });
    }
    if (n === 0) continue;
    total += n;
    const max = Math.max(0, int(current[key]?.max));
    const value = Math.max(0, int(current[key]?.value));
    const newMax = max + n;
    if (newMax > cap) {
      return fail(`${key}: ${newMax} uses would exceed the maximum of ${cap} at this TXP`,
                  { cap, roomTotal, key });
    }
    updates[`system.expertises.${key}.max`] = newMax;
    updates[`system.expertises.${key}.value`] = Math.min(value + n, newMax);
  }

  if (total !== wanted) {
    if (roomTotal < wanted) {
      return fail(`only ${roomTotal} use${roomTotal === 1 ? "" : "s"} of room remain at the maximum of ${cap}`,
                  { cap, roomTotal });
    }
    return fail(`distribute exactly ${wanted} use${wanted === 1 ? "" : "s"} (got ${total})`,
                { cap, roomTotal, total });
  }
  return { ok: true, updates, cap, roomTotal, total };
}

/**
 * Plan one Expertise & Stamina advancement. `option` is one of the ids from
 * `advancementBonusOptions()`; `distribution` is `{ expertiseKey: uses }` and is
 * required for every option that grants uses.
 *
 * Stamina rises in both `max` and `value`, for the same reason expertise uses
 * do: the bonus is claimed at the end of a rest and should be usable at once.
 */
export function planExpertiseBonus(crow, option, { distribution = {} } = {}) {
  const avail = bonusesAvailable(crow);
  if (avail.expertise <= 0) return fail("no expertise/Stamina advancements available", { available: avail });

  const chosen = advancementBonusOptions().find(o => o.id === option);
  if (!chosen) {
    return fail(`unknown option: ${option}`, { options: advancementBonusOptions().map(o => o.id) });
  }

  const updates = {};
  const parts = [];
  if (chosen.uses > 0) {
    const plan = planExpertiseDistribution(crow, distribution, { uses: chosen.uses });
    if (!plan.ok) return plan;
    Object.assign(updates, plan.updates);
    parts.push(Object.entries(distribution)
      .filter(([, n]) => Number(n) > 0)
      .map(([k, n]) => `+${n} ${k}`).join(", "));
  }
  if (chosen.stamina > 0) {
    const sys = sysOf(crow);
    const max = Math.max(0, int(sys.stamina?.max));
    const value = Math.max(0, int(sys.stamina?.value));
    updates["system.stamina.max"] = max + chosen.stamina;
    updates["system.stamina.value"] = Math.min(value + chosen.stamina, max + chosen.stamina);
    parts.push(`+${chosen.stamina} Stamina max`);
  }
  updates["system.xp.expertiseBonusesSpent"] = avail.spent.expertise + 1;
  return { ok: true, updates, option: chosen.id, summary: parts.filter(Boolean).join(" · ") };
}

/** Apply one Expertise & Stamina advancement. Gated to the end of a rest. */
export async function spendExpertiseBonus(actor, option, { distribution = {}, force = false } = {}) {
  if (!actor || actor.type !== "crow") return fail("not a crow");
  const gated = gateCheck(actor, force);
  if (gated) { notify("warn", `${actor.name}: ${gated.error}`); return gated; }

  const plan = planExpertiseBonus(actor, option, { distribution });
  if (!plan.ok) { notify("warn", `${actor.name}: ${plan.error}`); return plan; }

  await actor.update(plan.updates);
  await globalThis.ChatMessage?.create({
    content: `<div class="crows adv-spend"><strong>${actor.name}</strong> takes an expertise/Stamina advancement: ${plan.summary}</div>`,
    speaker: globalThis.ChatMessage?.getSpeaker({ actor })
  });
  return { ok: true, option: plan.option, summary: plan.summary };
}

/* -------------------------------------------------------------------------- */
/* Characteristic advancement (C:640, C:642)                                   */
/* -------------------------------------------------------------------------- */

/**
 * Plan one characteristic advancement. Cap 4 — an ADVANCEMENT rule (C:640), not
 * a schema bound: `CrowData` allows −5..5 because magic may push a
 * characteristic past what advancement can buy. Which is also why the "all three
 * at the cap" test is `>=`, not `===`.
 */
export function planCharAdvancement(crow, characteristic = null) {
  const avail = bonusesAvailable(crow);
  if (avail.char <= 0) return fail("no characteristic advancements available", { available: avail });

  const chars = sysOf(crow).characteristics ?? {};
  const cap = CROWS.charPcCap;
  const updates = { "system.xp.charBonusesSpent": avail.spent.char + 1 };

  if (CHARACTERISTIC_KEYS.every(k => int(chars[k]?.value) >= cap)) {
    const sys = sysOf(crow);
    const max = Math.max(0, int(sys.stamina?.max));
    const value = Math.max(0, int(sys.stamina?.value));
    updates["system.stamina.max"] = max + CHAR_OVERFLOW_STAMINA;
    updates["system.stamina.value"] = Math.min(value + CHAR_OVERFLOW_STAMINA, max + CHAR_OVERFLOW_STAMINA);
    return {
      ok: true, updates, converted: true,
      summary: `all characteristics at ${cap} → +${CHAR_OVERFLOW_STAMINA} Stamina max instead`
    };
  }

  if (!CHARACTERISTIC_KEYS.includes(characteristic)) {
    return fail(`choose one of: ${CHARACTERISTIC_KEYS.join(", ")}`, { characteristics: CHARACTERISTIC_KEYS });
  }
  const cur = int(chars[characteristic]?.value);
  if (cur >= cap) return fail(`${characteristic} is already at the cap of ${cap}`, { cap });
  updates[`system.characteristics.${characteristic}.value`] = cur + 1;
  return { ok: true, updates, converted: false, summary: `+1 ${characteristic} (now ${cur + 1})` };
}

/** Apply one characteristic advancement. Gated to the end of a rest. */
export async function spendCharBonus(actor, characteristic = null, { force = false } = {}) {
  if (!actor || actor.type !== "crow") return fail("not a crow");
  const gated = gateCheck(actor, force);
  if (gated) { notify("warn", `${actor.name}: ${gated.error}`); return gated; }

  const plan = planCharAdvancement(actor, characteristic);
  if (!plan.ok) { notify("warn", `${actor.name}: ${plan.error}`); return plan; }

  await actor.update(plan.updates);
  await globalThis.ChatMessage?.create({
    content: `<div class="crows adv-spend"><strong>${actor.name}</strong> takes a characteristic advancement: ${plan.summary}</div>`,
    speaker: globalThis.ChatMessage?.getSpeaker({ actor })
  });
  return { ok: true, converted: plan.converted, summary: plan.summary };
}

/* -------------------------------------------------------------------------- */
/* Traits (C:661-671)                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Is `trait` buyable for `crow`?
 *   - a starting trait (top of a tree) is always buyable;
 *   - otherwise it must connect by a line to a trait already owned on the SAME
 *     tree. The line is bidirectional — content lists the connection from one
 *     end only, so both directions are checked.
 *   - one purchase each (C:667).
 */
export function isTraitBuyable(crow, trait) {
  if (!crow || !trait) return { ok: false, reason: "no trait" };
  const sys = trait.system ?? {};
  const owned = crow.items?.filter?.(i => i.type === "trait") ?? [];
  // Owned is matched by name+tree: a compendium trait and its embedded copy have
  // different ids.
  if (owned.some(i => i.name === trait.name && i.system?.tree === sys.tree)) {
    return { ok: false, reason: "already owned" };
  }
  if (sys.isStarting) return { ok: true, reason: "starting trait" };

  const inTree = owned.filter(i => i.system?.tree === sys.tree);
  const myConn = sys.connectsTo ?? [];
  for (const o of inTree) {
    if ((o.system?.connectsTo ?? []).includes(trait.name)) return { ok: true, reason: `connected from ${o.name}` };
    if (myConn.includes(o.name)) return { ok: true, reason: `connects to owned ${o.name}` };
  }
  return { ok: false, reason: "no connecting owned trait on this tree" };
}

/** The trait's XP cost — 500 for a starting trait (C:667), otherwise by tier. */
export function traitCost(trait) {
  const sys = trait?.system ?? {};
  if (sys.isStarting) return CROWS.traitTierXP[1];
  return CROWS.traitTierXP[sys.tier] ?? 0;
}

/** Everything the sheet's tree grid needs for one trait. Data only — T2.1 draws
 *  the grid; this module never renders it. */
export function traitPurchaseInfo(crow, trait) {
  const sys = trait?.system ?? {};
  const owned = (crow?.items?.filter?.(i => i.type === "trait") ?? [])
    .some(i => i.name === trait?.name && i.system?.tree === sys.tree);
  const check = isTraitBuyable(crow, trait);
  const cost = traitCost(trait);
  const spendable = Math.max(0, int(sysOf(crow).xp?.spendable));
  return {
    name: trait?.name, tree: sys.tree, tier: sys.tier, column: sys.column,
    owned, buyable: check.ok, reason: check.reason, cost,
    affordable: spendable >= cost, spendable,
    window: spendingWindow(crow)
  };
}

/**
 * C:671 — the minimum modifier rule. When a trait scales off a characteristic,
 * the value it scales by is at least 1, even when the characteristic is lower.
 * A crow with Mind −1 still gets one use of a Mind-sized trait pool.
 */
export function traitMinimumModifier(value) {
  return Math.max(TRAIT_MIN_MODIFIER, int(value));
}

/**
 * The size of a trait's per-rest use pool, applying the minimum modifier rule.
 * The contract's frozen semantics floor a characteristic-sized pool at 0; C:671
 * floors it at 1. See the T1.4 report — this helper implements the rule, and
 * `TraitData` has no derivation of its own to disagree with yet.
 */
export function traitPoolMax(trait, crow) {
  const pool = trait?.system?.usePool ?? {};
  if (!pool.sizedBy) return Math.max(0, int(pool.fixedMax));
  return traitMinimumModifier(sysOf(crow).characteristics?.[pool.sizedBy]?.value);
}

/** Remaining uses in a trait's pool. `used` is stored, never clamped downward. */
export function traitPoolState(trait, crow) {
  const used = Math.max(0, int(trait?.system?.usePool?.used));
  const max = traitPoolMax(trait, crow);
  return { max, used, remaining: Math.max(0, max - used), overused: Math.max(0, used - max) };
}

/** Purchase a trait: validate, deduct spendable XP, embed the item. Gated to
 *  the end of a rest (C:609). */
export async function purchaseTrait(actor, trait, {
  force = false,
  txId = null,
  expectedRevision = null,
  grantContext = null
} = {}) {
  if (!actor || actor.type !== "crow") return fail("not a crow");
  if (!trait || trait.type !== "trait") return fail("not a trait");

  const gated = gateCheck(actor, force);
  if (gated) { notify("warn", `${actor.name}: ${gated.error}`); return gated; }

  const check = isTraitBuyable(actor, trait);
  if (!check.ok) {
    notify("warn", `Cannot buy ${trait.name}: ${check.reason}.`);
    return { ok: false, error: check.reason, reason: check.reason };
  }

  const cost = traitCost(trait);
  const spendBefore = Math.max(0, int(sysOf(actor).xp?.spendable));
  if (spendBefore < cost) {
    notify("warn", `Not enough XP for ${trait.name}: need ${cost}, have ${spendBefore}.`);
    return fail("insufficient XP", { cost, spendable: spendBefore });
  }

  // The grant is deliberately committed before XP is spent: a refused or
  // capacity-blocked Item can never consume XP.  Traits are not positional
  // inventory, so the explicit `none` policy preserves the old no-location
  // embedded copy while still satisfying grantItem's placement contract.
  const grantOptions = {
    ...(grantContext && typeof grantContext === "object" ? grantContext : {}),
    ...(txId == null ? {} : { txId }),
    ...(expectedRevision == null ? {} : { expectedRevision }),
    placement: grantContext?.placement ?? { policy: "none" }
  };
  const grant = await grantItem(actor, trait,
    makeGrantContext(actor, "trait-purchase", grantOptions));
  if (!grant?.ok) {
    notify("warn", `Cannot grant ${trait.name}: ${grant?.reason ?? grant?.error ?? "write failed"}.`);
    return { ...grant, cost, spendable: spendBefore };
  }

  try {
    await actor.update({ "system.xp.spendable": spendBefore - cost });
  } catch (error) {
    // The two Actor writes cannot be asserted as one Foundry transaction. Make
    // the best bounded compensation available and suppress the success card;
    // an uncertain delete remains visible to the GM rather than being retried
    // with a new token.
    let compensated = false;
    const ids = grant.itemIds ?? [];
    if (ids.length && typeof actor.deleteEmbeddedDocuments === "function") {
      try {
        await actor.deleteEmbeddedDocuments("Item", ids);
        compensated = true;
      } catch { /* report the grant as uncertain below */ }
    }
    return fail("write-failed", {
      state: compensated ? "compensated" : "unknown",
      reconciliationRequired: !compensated,
      cost, spendable: spendBefore,
      txId: grant.txId, grant,
      message: String(error?.message ?? error)
    });
  }

  await globalThis.ChatMessage?.create({
    content: `<div class="crows trait-purchase">
      <strong>${actor.name}</strong> learns <strong>${trait.name}</strong>
      <em>(${trait.system.tree} t${trait.system.tier} · ${cost} XP spent · ${spendBefore - cost} left)</em>
    </div>`,
    speaker: globalThis.ChatMessage?.getSpeaker({ actor })
  });
  return { ok: true, cost, remainingXP: spendBefore - cost };
}

/* -------------------------------------------------------------------------- */
/* Death and replacement (C:653-657)                                           */
/* -------------------------------------------------------------------------- */

/**
 * What a replacement PC gets when a crow dies (C:653-657): extra background
 * options to roll and choose from, equal to the dead crow's bonus count; and,
 * optionally, a starting TXP matching the party's lowest, with gold equal to
 * half that TXP for equipment.
 *
 * "Bonus count" is the Expertise & Stamina track — that is the track C:621
 * numbers as 1st/2nd/3rd bonus. The characteristic count is returned alongside
 * it so a Ref reading it the other way has the number to hand.
 */
export function replacementCharacter({ deadTxp = 0, partyTxps = [] } = {}) {
  const dead = bonusesEarned(Math.max(0, int(deadTxp)));
  const txps = (partyTxps ?? []).map(t => Math.max(0, int(t)));
  const lowest = txps.length ? Math.min(...txps) : 0;
  return {
    extraBackgroundRolls: dead.expertise,
    expertiseBonuses: dead.expertise,
    charBonuses: dead.char,
    // Optional (C:657) — offered, never applied automatically.
    suggestedTxp: lowest,
    suggestedGold: Math.floor(lowest / 2)
  };
}
