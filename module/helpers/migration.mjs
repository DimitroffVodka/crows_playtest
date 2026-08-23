import {
  CROWS, ALL_EXPERTISES, EXPERTISES_ALPHABETICAL,
  expertiseMaxForTxp, bonusesEarnedAtTxp, effectiveCapacities
} from "../config.mjs";
import { REMOVED_STATUS_IDS } from "../conditions.mjs";

/**
 * Playtest 1 -> Playtest 2 data migration. PURE FUNCTIONS ONLY — nothing here
 * registers a hook, reads a setting, awaits a compendium or writes a document.
 * T2.3 wires it; see "WIRING" at the bottom of this file for the three call
 * sites and their exact shapes.
 *
 * ============================================================================
 * TWO LAYERS. Conflating them is the classic bug, and the plan's own first
 * draft conflated them (critique C1).
 * ============================================================================
 *
 *   LAYER (a)  `migrateCrowSystem(source)` / `migrateBackgroundSystem(source)`
 *     Per-document, pure, idempotent SHAPE COERCION. Called from
 *     `TypeDataModel.migrateData`, which runs on every load AND ON PARTIAL
 *     UPDATE DELTAS. It sees the raw `system` object and nothing else: no
 *     embedded items, no sibling fields it was not handed, possibly no `xp`
 *     at all. Every transform here is therefore guarded on the key being
 *     PRESENT, and no transform may invent a field the caller did not send.
 *
 *   LAYER (b)  `migrateActorDocument(actor, ...)` and friends
 *     One-time POLICY over the whole Actor, embedded items included, gated on
 *     the world's stored system version. This is where the H5 expertise budget
 *     lives, where slot placements are audited, and where the GM report is
 *     assembled.
 *
 * The budget CANNOT run in layer (a), for three independent reasons:
 *
 *   1. `backgroundUses` needs the background's GRANTS, and the actor stores
 *      only `system.background` — a NAME. There is no embedded Background
 *      Item to sum (`applyBackground()` writes the name and nothing else), so
 *      resolving it takes a compendium lookup a per-document transform cannot
 *      perform. This one is a hard blocker.
 *   2. The budget needs `xp.txp`, and a partial delta may carry no `xp` at all
 *      — `test/fixtures/actors/pt1-crow-delta.json` deliberately omits it.
 *      Assuming 0 would trim a character to nothing on a routine field edit.
 *   3. `migrateData` cannot know it has already run, so the budget would also
 *      hit Playtest 2 characters who legitimately earned their uses.
 *
 * So layer (a) converts shape and is EXPECTED to leave `max` over budget. That
 * is correct output, not a bug.
 *
 * ============================================================================
 * Two rules that are easy to get backwards, restated because getting either
 * wrong is silent:
 * ============================================================================
 *
 *   * An UNRESOLVED BACKGROUND IS NOT `backgroundUses = 0`. Zero is the
 *     smallest possible budget and therefore produces the LARGEST possible
 *     over-budget figure — at exactly the moment the migration knows least
 *     about the character. Unresolved means REPORT AND SKIP that actor's
 *     budget entirely. Until T3.1 re-transcribes the backgrounds this is the
 *     only reachable case, so it is the one that has to be right.
 *
 *   * The budget reads `max` (uses OWNED), never `value` (uses REMAINING).
 *     Reading `value` would shrink the reported surplus every time a player
 *     spent a use, even though their permanent allocation never moved.
 *
 * Nothing here ever clamps a wound index: capacity is derived from config plus
 * trait grants (M12), so an index past it is ORPHANED and surfaced, never
 * dropped. Dropping one would spontaneously heal a character.
 */

/* -------------------------------------------------------------------------- */
/*  Small local utilities. Deliberately not imported from anywhere — this file  */
/*  must stay runnable under `node --test` with only test/shim/foundry.mjs.     */
/* -------------------------------------------------------------------------- */

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** structuredClone, but tolerant of anything exotic that wandered into source. */
function cloneData(value) {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

/** A non-negative integer, or 0. `bonus: 0` must survive — never treat it as falsy. */
function toCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** camelCase key -> human free text. Used only where PT2 stores prose. */
function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

/** Case-insensitive, whitespace-insensitive name key for background lookup. */
function normalizeName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Codepoint tie-break order, with the 30 known keys pinned by the contract. */
function alphabeticalRank(key) {
  const i = EXPERTISES_ALPHABETICAL.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Sort helper for unknown keys, so a stray key still breaks ties predictably. */
function byAlphabetical(a, b) {
  const ra = alphabeticalRank(a);
  const rb = alphabeticalRank(b);
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ========================================================================== */
/*  LAYER (a) — per-document shape coercion. Safe on PARTIAL UPDATE DELTAS.    */
/* ========================================================================== */

/**
 * Playtest 1 skill key -> Playtest 2 expertise key.
 *
 * 34 PT1 skills onto 30 PT2 expertises. Four entries collapse:
 * climb/jump/swim -> athletics, hide/sneak -> stealth,
 * sabotage/sleightOfHand -> thievery, handleAnimal -> handlePet.
 * `pickLock` survives as its own expertise and is NOT folded into thievery.
 *
 * On an ACTOR a collapse takes the MAX of the source bonuses — the character
 * demonstrably had that much training. (On a BACKGROUND there is no bonus to
 * max, so a collapse loses a grant outright; see `migrateBackgroundSystem`.)
 */
export const SKILL_TO_EXPERTISE = Object.freeze({
  // --- collapsing ---
  climb: "athletics", jump: "athletics", swim: "athletics",
  hide: "stealth", sneak: "stealth",
  sabotage: "thievery", sleightOfHand: "thievery",
  // --- renamed ---
  handleAnimal: "handlePet",
  // --- 1:1 ---
  alchemy: "alchemy", blacksmithing: "blacksmithing", enchanting: "enchanting",
  endurance: "endurance", gymnastics: "gymnastics", historicalLore: "historicalLore",
  lift: "lift", magicLore: "magicLore", monsterLore: "monsterLore",
  natureLore: "natureLore", navigate: "navigate", pickLock: "pickLock",
  religiousLore: "religiousLore", search: "search",
  alteration: "alteration", benefaction: "benefaction", conjuration: "conjuration",
  elemental: "elemental", illusion: "illusion", necromancy: "necromancy",
  bashing: "bashing", bow: "bow", chopping: "chopping", slashing: "slashing",
  stabbing: "stabbing", unarmed: "unarmed"
});

/** PT1 condition keys with no PT2 destination. `boned` must NOT become `weakened`. */
export const DROPPED_CONDITION_KEYS = Object.freeze(["boned", "hidden", "invisible"]);

/**
 * Assign `count` wounds to backpack slot indices (R:524).
 *
 * EMPTY SLOTS FIRST, lowest index first, and only then occupied ones. Playtest
 * 1 filled bottom-up regardless of contents; under the wound/speed reading (c)
 * a wound sharing a slot with an item costs 1 speed, so a naive bottom-up
 * migration would silently slow every migrated character. Placing into empty
 * slots first reproduces the PT1 speed profile as closely as the new rule
 * allows, and anything forced onto an occupied slot is REPORTED.
 *
 * Indices past `capacity` are NOT clamped and NOT dropped — they spill past
 * the end and are surfaced as orphaned, exactly as `prepareDerivedData` does.
 *
 * @param {number} count
 * @param {{occupied?: Iterable<number>, capacity?: number}} [options]
 * @returns {{indices: number[], forced: number[], orphaned: number[]}}
 */
export function placeWoundSlots(count, { occupied = [], capacity = CROWS.carryContainers.backpack } = {}) {
  const want = toCount(count);
  const cap = Math.max(0, toCount(capacity));
  const taken = new Set([...occupied].map(toCount));

  const empty = [];
  const full = [];
  for (let i = 0; i < cap; i++) (taken.has(i) ? full : empty).push(i);

  const indices = [];
  const forced = [];
  const orphaned = [];
  let overflow = cap;

  for (let n = 0; n < want; n++) {
    if (empty.length) { indices.push(empty.shift()); continue; }
    if (full.length) { const i = full.shift(); indices.push(i); forced.push(i); continue; }
    // Past capacity. Never clamp — an orphaned wound is visible and recoverable;
    // a dropped one is a character silently healed by the migration.
    const i = overflow++;
    indices.push(i);
    orphaned.push(i);
  }

  indices.sort((a, b) => a - b);
  return { indices, forced, orphaned };
}

/**
 * Which backpack indices the PT1 actor-level `containers` map shows as full.
 * Real PT1 data stores placement per ITEM (`system.location`), which layer (a)
 * cannot see; some captured/fixture data carries this map instead. Both are
 * handled — this one here, item locations in `readPlacements()`.
 */
function occupiedFromContainers(containers, container = "backpack") {
  const list = containers?.[container];
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((entry, i) => { if (entry !== null && entry !== undefined && entry !== "") out.push(i); });
  return out;
}

/**
 * LAYER (a). Coerce a Playtest 1 crow `system` object into Playtest 2 shape.
 *
 * SAFE ON PARTIAL UPDATE DELTAS, which is the whole discipline of this
 * function: every branch is guarded on the key being present, nothing reads a
 * sibling it was not given, and the input is never mutated.
 *
 * It does SHAPE ONLY. It may — and on the fixture does — leave the expertise
 * totals far over any budget PT2 advancement could produce. `reconcileActor-
 * Expertises` decides what to do about that, once, in layer (b).
 *
 * @param {object} source raw `system`, whole document or update delta
 * @returns {object} a NEW object; use it as the source, do not merge onto the old
 *   one — several transforms work by DELETING a key, and a merge would resurrect it.
 */
export function migrateCrowSystem(source) {
  if (!isObject(source)) return source;
  const out = cloneData(source);

  // --- skills -> expertises -------------------------------------------------
  // Uses convert 1:1 from the bonus and land on BOTH `value` and `max`: the
  // character owns that many (max) and, not having spent any yet, has that
  // many left (value).
  if (isObject(out.skills)) {
    // The per-key cap is a function of TXP. A delta may have no `xp` at all —
    // in that case DO NOT assume 0 (which would cap at the creation value and
    // silently shave a veteran's uses on an unrelated field edit). Leave the
    // conversion unclamped and let layer (b), which always has the whole
    // actor, apply the cap.
    const txp = isObject(out.xp) ? Number(out.xp.txp) : NaN;
    const cap = Number.isFinite(txp) ? expertiseMaxForTxp(txp) : null;

    const converted = {};
    for (const [skill, entry] of Object.entries(out.skills)) {
      const key = SKILL_TO_EXPERTISE[skill];
      if (!key) continue;                       // unknown PT1 key: nothing to write to
      const bonus = toCount(isObject(entry) ? entry.bonus : entry);
      // MAX wins on a collapsing pair (climb 1 + swim 2 -> athletics 2).
      converted[key] = Math.max(converted[key] ?? 0, bonus);
    }

    const expertises = isObject(out.expertises) ? { ...out.expertises } : {};
    for (const [key, bonus] of Object.entries(converted)) {
      // A key already carrying PT2 data wins: the only way both shapes coexist
      // is a partially migrated document, where the PT2 side is authoritative.
      if (isObject(expertises[key])) continue;
      const uses = cap === null ? bonus : Math.min(bonus, cap);
      expertises[key] = { value: uses, max: uses };   // 0 is a real value, not "absent"
    }
    out.expertises = expertises;
    delete out.skills;
  }

  // --- conditions -----------------------------------------------------------
  // `blessed` was leveled (a number); PT2 forbids a second instance of a
  // condition you already have (R:528), so any positive level is `true`.
  // `boned` is DELETED — it must NOT be converted to `weakened`, which has a
  // different duration and different semantics.
  if (isObject(out.conditions)) {
    const c = { ...out.conditions };
    if ("blessed" in c) c.blessed = typeof c.blessed === "boolean" ? c.blessed : toCount(c.blessed) > 0;
    for (const key of DROPPED_CONDITION_KEYS) delete c[key];
    out.conditions = c;
  }

  // --- wounds -> woundSlots -------------------------------------------------
  if ("wounds" in out && out.woundSlots === undefined) {
    const { indices } = placeWoundSlots(out.wounds, {
      occupied: occupiedFromContainers(out.containers)
      // capacity: config base. Trait grants are invisible from here; layer (b)
      // re-checks against the real capacity and improves the placement if it can.
    });
    out.woundSlots = indices;
    delete out.wounds;                          // a derived scalar in PT2
  }

  // --- preparedTask ---------------------------------------------------------
  // R:658-664: the bonus attaches to a specific TASK now, not to a skill, and
  // PT1's `detail` has no field of its own. Fold both into free text rather
  // than lose the Ref's note.
  if (isObject(out.preparedTask)) {
    const p = { ...out.preparedTask };
    if (!p.task) {
      const parts = [];
      if (p.skill) parts.push(humanizeKey(p.skill));
      if (p.detail) parts.push(p.detail);
      if (parts.length) p.task = parts.join(" — ");
    }
    delete p.skill;
    delete p.detail;
    if ("setOn" in p) p.setOn = canonicalizeSetOn(p.setOn);
    out.preparedTask = p;
  }

  // --- xp.skillBonusesSpent -> xp.expertiseBonusesSpent ---------------------
  if (isObject(out.xp) && "skillBonusesSpent" in out.xp) {
    const xp = { ...out.xp };
    if (xp.expertiseBonusesSpent === undefined) xp.expertiseBonusesSpent = toCount(xp.skillBonusesSpent);
    delete xp.skillBonusesSpent;
    out.xp = xp;
  }

  // --- crafting.projects[].skill -> .expertise ------------------------------
  // The FIELD rename is data migration and belongs here; the crafting rules
  // that read it are T1.6's.
  if (isObject(out.crafting) && Array.isArray(out.crafting.projects)) {
    out.crafting = {
      ...out.crafting,
      projects: out.crafting.projects.map((proj) => {
        if (!isObject(proj) || !("skill" in proj)) return proj;
        const p = { ...proj };
        if (p.expertise === undefined || p.expertise === "") {
          p.expertise = SKILL_TO_EXPERTISE[p.skill] ?? p.skill ?? "";
        }
        delete p.skill;
        return p;
      })
    };
  }

  // --- coins -> currency ----------------------------------------------------
  // PT2 `currency` is LOOSE coin only (purses are Items). Some captured PT1
  // data stores it as `coins`; carry it rather than drop a character's money.
  if ("coins" in out) {
    if (out.currency === undefined) out.currency = toCount(out.coins);
    delete out.coins;
  }

  // `containers` has no PT2 destination — the positional layout is per-item
  // (`system.location`, T1.2). Drop the dead key AFTER wound placement, which
  // is the one thing that needed it.
  delete out.containers;

  return out;
}

/**
 * PT1 stored `preparedTask.setOn` as a NumberField (a DT counter), but real
 * data also carries dates — the fixture holds "2026-05-20", which the old
 * numeric field would have coerced to 0. PT2 makes it a StringField, so both
 * survive; a DT counter gains its label so the string is self-describing.
 */
function canonicalizeSetOn(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return value > 0 ? `DT ${Math.floor(value)}` : "";
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return Number(s) > 0 ? `DT ${Number(s)}` : "";
  return s;
}

/**
 * LAYER (a). Best-effort shape coercion for a Playtest 1 background.
 *
 * BACKGROUNDS ARE REPLACED, NOT MIGRATED. This function exists so a world does
 * not break on load, and its output is OVERWRITTEN wholesale by the
 * re-transcribed Wave 3 content (T3.1, C:89-602). Two reasons no transform can
 * be correct, both verified against the 36 shipped documents:
 *
 *   * PT1 has NO per-key uses. It stores a bare `skills: [String]`, while
 *     C:103 for that same background reads "Benefaction (2 uses), Elemental
 *     (2 uses)". The number 2 exists nowhere in PT1 data.
 *   * Collapsing pairs silently reduce the grant COUNT. 8 of 36 backgrounds
 *     grant both halves of a pair — the Thief grants hide+sneak AND
 *     sabotage+sleightOfHand, so 7 skills become 5 expertises. For an actor,
 *     max-wins handles a collapse; for a background there is no bonus to max,
 *     so two grants become one and a use is simply gone.
 *
 * Consequence for H5: `backgroundUses` MUST read a re-transcribed background,
 * never a migrated one, or the GM decides on bad numbers. `resolveBackground`
 * therefore reports `migratedShape: true` when it lands on one of these.
 */
export function migrateBackgroundSystem(source) {
  if (!isObject(source)) return source;
  const out = cloneData(source);

  if (Array.isArray(out.skills)) {
    const uses = new Map();
    for (const skill of out.skills) {
      const key = SKILL_TO_EXPERTISE[skill] ?? skill;
      if (!ALL_EXPERTISES.includes(key)) continue;
      // 1 use each: PT1 has no other number to read. A collapsing pair lands
      // on the same key and the second grant is LOST — see the doc comment.
      uses.set(key, 1);
    }
    if (!Array.isArray(out.expertises) || !out.expertises.length) {
      out.expertises = [...uses].map(([key, n]) => ({ key, uses: n }));
    }
    delete out.skills;
  }

  // characteristicBonus (a +1 on one characteristic) -> characteristicOptionsAt2
  // (the SET a background may raise TO 2, C:28). Semantics changed, so this is
  // a shape carry only: "any" opens all three, "mind or strength" opens both.
  if ("characteristicBonus" in out) {
    if (!Array.isArray(out.characteristicOptionsAt2) || !out.characteristicOptionsAt2.length) {
      const raw = String(out.characteristicBonus ?? "").toLowerCase();
      const all = Object.keys(CROWS.characteristics);
      out.characteristicOptionsAt2 = raw === "any" || raw === ""
        ? [...all]
        : all.filter((c) => raw.includes(c));
    }
    delete out.characteristicBonus;
  }

  return out;
}

/* ========================================================================== */
/*  LAYER (b) — one-time policy over the whole Actor.                          */
/* ========================================================================== */

/** Flag stamped on every reconciled actor so no path can run the budget twice. */
export const RECONCILED_FLAG = "expertiseReconciled";
/** Where the resolved background total is cached so DERIVED data can read it. */
export const BACKGROUND_USES_FLAG = "backgroundUses";

/**
 * Build the lookup the background resolution needs.
 *
 * Takes whatever the caller can get hold of — compendium index entries, loaded
 * Items, or plain objects — and keeps this file free of any `await`, so every
 * decision below stays unit-testable without a live world.
 *
 * @param {Array<object>} docs anything with `{id|_id, name, system}`
 */
export function buildBackgroundIndex(docs = []) {
  const byId = new Map();
  const byName = new Map();
  const ambiguous = new Set();

  for (const doc of docs) {
    if (!doc) continue;
    const id = doc.id ?? doc._id ?? null;
    const entry = {
      id,
      name: doc.name ?? "",
      uses: backgroundGrantTotal(doc),
      // A background still carrying PT1 shape cannot give a trustworthy total —
      // PT1 has no per-key uses at all. Flagged so the report can say so.
      migratedShape: Array.isArray(doc.system?.skills) && !doc.system?.expertises?.length,
      doc
    };
    if (id) byId.set(id, entry);
    const key = normalizeName(entry.name);
    if (!key) continue;
    if (byName.has(key)) ambiguous.add(key);
    byName.set(key, entry);
  }

  return { byId, byName, ambiguous, size: byId.size || byName.size };
}

/** Sum a background document's expertise grants. `null` when it has none to sum. */
function backgroundGrantTotal(doc) {
  const list = doc?.system?.expertises;
  if (Array.isArray(list) && list.length) {
    return list.reduce((n, e) => n + toCount(e?.uses ?? 1), 0);
  }
  // `totalExpertiseUses` is derived on a prepared BackgroundData; an index
  // entry will not carry it, hence the array path above first.
  const derived = doc?.system?.totalExpertiseUses;
  return Number.isFinite(derived) ? toCount(derived) : null;
}

/**
 * Resolve the actor's background against the crows-backgrounds compendium.
 *
 * THE FROZEN ROUTE:
 *   1. `system.backgroundId`, if present
 *   2. else `system.background` — the NAME — trimmed and case-insensitive
 *   3. on success the id is stamped (see `reconcileActorExpertises`), so later
 *      runs survive a rename
 *   4. on failure REPORT and skip the budget. NEVER read it as 0 uses.
 *
 * @returns {{ok: boolean, uses: number|null, id: string|null, name: string,
 *            matchedBy: "id"|"name"|null, reason: string|null, migratedShape: boolean}}
 */
export function resolveBackground(actor, index) {
  const name = actor?.system?.background ?? "";
  const id = actor?.system?.backgroundId ?? "";
  const miss = (reason) => ({ ok: false, uses: null, id: id || null, name, matchedBy: null, reason, migratedShape: false });

  if (!index || !(index.byId instanceof Map)) return miss("no-background-index");
  if (!name && !id) return miss("actor-has-no-background");

  let entry = null;
  let matchedBy = null;

  if (id && index.byId.has(id)) { entry = index.byId.get(id); matchedBy = "id"; }

  if (!entry && name) {
    const key = normalizeName(name);
    // Two backgrounds normalising to the same name is unresolvable, not a
    // coin-flip: picking one would hand the GM a number from the wrong sheet.
    if (index.ambiguous?.has(key)) return miss("background-ambiguous");
    if (index.byName.has(key)) { entry = index.byName.get(key); matchedBy = "name"; }
  }

  if (!entry) return miss(id ? "background-id-and-name-unresolved" : "background-name-unresolved");
  if (entry.uses === null) {
    return { ok: false, uses: null, id: entry.id, name: entry.name, matchedBy, reason: "background-has-no-grants", migratedShape: entry.migratedShape };
  }

  return { ok: true, uses: entry.uses, id: entry.id, name: entry.name, matchedBy, reason: null, migratedShape: entry.migratedShape };
}

/**
 * The total expertise-use budget a crow could legally have reached (H5).
 *
 *   bonusesEarned = advancement rows at or below this TXP (+1 per 30,000 after)
 *   bonusesToUses = min(expertiseBonusesSpent ?? bonusesEarned, bonusesEarned)
 *   budget        = backgroundUses + 3 * bonusesToUses          // 3 = C:615 max
 *
 * PT1 recorded how many bonuses went to skills in `xp.skillBonusesSpent`;
 * carry it, but never trust it above what the PT2 table says was earned.
 *
 * `backgroundUses` is REQUIRED and must be a real number. It throws rather
 * than defaulting, because the one dangerous default is 0: it yields the
 * smallest budget and therefore the largest over-budget report, precisely when
 * the background could not be read. Callers must skip the actor instead.
 */
export function expertiseBudgetForTxp(txp, backgroundUses, expertiseBonusesSpent) {
  if (!Number.isFinite(backgroundUses) || backgroundUses < 0) {
    throw new TypeError(
      "expertiseBudgetForTxp: backgroundUses must be a resolved non-negative number. " +
      "An unresolved background is REPORTED and the actor's budget SKIPPED — never read as 0."
    );
  }
  const earned = bonusesEarnedAtTxp(toCount(txp));
  const claimed = Number.isFinite(Number(expertiseBonusesSpent)) ? toCount(expertiseBonusesSpent) : earned;
  const spent = Math.min(claimed, earned);
  return toCount(backgroundUses) + (CROWS.expertiseUsesPerBonus ?? 3) * spent;
}

/**
 * Water-level a converted expertise map down into its budget. Deterministic —
 * the tests pin the exact distribution, not just the total.
 *
 *   1. Clamp every expertise to `maxPerExpertise` (the TXP-derived per-key cap).
 *   2. While the total exceeds the budget, remove ONE use from whichever
 *      expertise currently holds the most; ties break on the alphabetically
 *      FIRST key (EXPERTISES_ALPHABETICAL — NOT the category display order,
 *      in which `blacksmithing` precedes `bashing`).
 *   3. Never top up. A total under budget simply leaves the difference unspent.
 *
 * Water-levelling rather than keeping the strongest few: a PT1 sheet full of
 * modest bonuses represented BREADTH of training, and that is the part worth
 * preserving.
 *
 * This function always computes the full trim, in BOTH migration modes — the
 * "report-only" default needs `trimmed` populated so the GM can see exactly
 * what enforcing would do. Deciding whether to WRITE it is the caller's job.
 *
 * @param {Record<string, number|{max?: number}>} converted
 * @param {number} budget
 * @param {number} maxPerExpertise
 */
export function reconcileExpertiseBudget(converted, budget, maxPerExpertise) {
  const desiredMap = {};
  for (const [key, entry] of Object.entries(converted ?? {})) {
    desiredMap[key] = toCount(isObject(entry) ? entry.max : entry);
  }
  const desired = Object.values(desiredMap).reduce((n, v) => n + v, 0);

  const cap = Number.isFinite(Number(maxPerExpertise)) ? toCount(maxPerExpertise) : Infinity;
  const granted = {};
  for (const [key, uses] of Object.entries(desiredMap)) granted[key] = Math.min(uses, cap);

  const target = toCount(budget);
  let total = Object.values(granted).reduce((n, v) => n + v, 0);

  // Water level. Bounded by `total`, which strictly decreases every iteration.
  while (total > target) {
    let pick = null;
    for (const key of Object.keys(granted).sort(byAlphabetical)) {
      if (granted[key] <= 0) continue;
      if (pick === null || granted[key] > granted[pick]) pick = key;   // ties keep the first, i.e. alphabetically-first
    }
    if (pick === null) break;                     // everything is already 0
    granted[pick] -= 1;
    total -= 1;
  }

  const trimmed = Object.keys(desiredMap)
    .filter((key) => granted[key] < desiredMap[key])
    .sort(byAlphabetical)
    .map((key) => ({ key, from: desiredMap[key], to: granted[key] }));

  return { granted, trimmed, desired, budget: target };
}

/**
 * LAYER (b). The H5 budget for one whole actor.
 *
 * DEFAULT IS "report-only": compute everything, populate `trimmed` so the GM
 * can see what enforcing would do, and WRITE NOTHING to `value`/`max`. An
 * over-budget character is a BALANCE problem, not a data-integrity one —
 * nothing breaks, the sheet is just strong — so it is the GM's call, and a
 * migration should not silently rewrite a player's sheet to win an argument
 * about balance. Only `mode: "enforce"` mutates.
 *
 * Returns the update paths rather than applying them: this file registers no
 * hooks and awaits nothing (T2.3 wires it), and a pure return is what makes
 * the "writes nothing" guarantee testable.
 *
 * @param {object} actor an Actor, or any `{type, system, flags}` shape
 * @param {{backgrounds?: object, mode?: "report-only"|"enforce",
 *          maxPerExpertise?: number|null, force?: boolean}} [options]
 */
export function reconcileActorExpertises(actor, {
  backgrounds = null,
  mode = "report-only",
  maxPerExpertise = null,
  force = false
} = {}) {
  const base = {
    actorId: actor?.id ?? actor?._id ?? null,
    actorName: actor?.name ?? "",
    mode,
    skipped: false,
    reason: null,
    background: null,
    granted: {},
    trimmed: [],
    desired: 0,
    budget: null,
    overBudget: null,
    updates: {}
  };
  const skip = (reason, extra = {}) => ({ ...base, skipped: true, reason, ...extra });

  if (!actor || !isObject(actor.system)) return skip("no-actor-system");
  if (actor.type && actor.type !== "crow") return skip("not-a-crow");

  // Stamped by whichever path got here first — the `ready` world pass or the
  // createActor straggler pass. Neither may run twice on the same document.
  if (!force && actor.flags?.crows?.[RECONCILED_FLAG]) return skip("already-reconciled");

  const expertises = isObject(actor.system.expertises) ? actor.system.expertises : {};
  // OWNED, never REMAINING. Reading `value` would shrink the reported surplus
  // every time a player spent a use.
  const owned = {};
  for (const [key, e] of Object.entries(expertises)) owned[key] = toCount(e?.max);
  const desired = Object.values(owned).reduce((n, v) => n + v, 0);

  const bg = resolveBackground(actor, backgrounds);
  if (!bg.ok) {
    // REPORT AND SKIP. Not "assume 0" — that is the largest-possible-surplus
    // failure mode. Deliberately NOT stamped either: once T3.1 lands the
    // backgrounds, a re-run must be able to reach this actor.
    return skip(bg.reason, { background: bg, granted: { ...owned }, desired });
  }

  const txp = toCount(actor.system.xp?.txp);
  const budget = expertiseBudgetForTxp(
    txp,
    bg.uses,
    actor.system.xp?.expertiseBonusesSpent ?? actor.system.xp?.skillBonusesSpent
  );
  const cap = maxPerExpertise ?? expertiseMaxForTxp(txp);
  const result = reconcileExpertiseBudget(owned, budget, cap);
  const overBudget = Math.max(0, result.desired - budget);

  const updates = {};
  // Stamping the id is identity repair, not a balance decision, so it happens
  // in both modes — it is what makes the lookup survive a later rename.
  if (bg.id && actor.system.backgroundId !== bg.id) updates["system.backgroundId"] = bg.id;
  updates[`flags.crows.${RECONCILED_FLAG}`] = true;
  // Cached so `expertiseOverBudget()` can run in SYNCHRONOUS derived data —
  // the compendium lookup that produced it cannot.
  updates[`flags.crows.${BACKGROUND_USES_FLAG}`] = bg.uses;

  if (mode === "enforce") {
    for (const [key, uses] of Object.entries(result.granted)) {
      if (uses === owned[key]) continue;
      updates[`system.expertises.${key}.max`] = uses;
      // H5 enforce trims `max`, then clamps `value` under it. Never the reverse.
      const value = toCount(expertises[key]?.value);
      if (value > uses) updates[`system.expertises.${key}.value`] = uses;
    }
  }

  return {
    ...base,
    background: bg,
    granted: result.granted,
    trimmed: result.trimmed,
    desired: result.desired,
    budget,
    overBudget,
    updates
  };
}

/**
 * How many expertise uses this crow holds beyond what its advancement allows.
 *
 * REQUIRED because the migration defaults to report-only: nothing is written,
 * so the over-budget state is PERMANENT until a GM acts, and a migration-time
 * journal entry scrolls away. The sheet needs a badge (T2.1), which means this
 * has to run in synchronous derived data — where the compendium lookup that
 * produced `backgroundUses` cannot. Hence the cached flag.
 *
 * Returns `null`, NOT 0, when the background was never resolved. 0 would read
 * as "this crow is fine"; null means "unknown" and the sheet shows nothing.
 */
export function expertiseOverBudget(actor, backgroundUses = actor?.flags?.crows?.[BACKGROUND_USES_FLAG]) {
  if (!isObject(actor?.system)) return null;
  if (!Number.isFinite(Number(backgroundUses))) return null;
  const owned = Object.values(actor.system.expertises ?? {})
    .reduce((n, e) => n + toCount(e?.max), 0);
  const budget = expertiseBudgetForTxp(
    toCount(actor.system.xp?.txp),
    toCount(backgroundUses),
    actor.system.xp?.expertiseBonusesSpent
  );
  return Math.max(0, owned - budget);
}

/* -------------------------------------------------------------------------- */
/*  Slots: audit, never relocate.                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every container capacity for this actor. Prefers the actor's own derived
 * `capacities` (which already summed trait grants through the one shared pure
 * function) and falls back to summing the grants here, so a plain test object
 * behaves the same as a live Actor.
 */
function capacitiesFor(actor) {
  if (isObject(actor?.system?.capacities)) return actor.system.capacities;
  const grants = [];
  for (const item of actor?.items ?? []) {
    if (item?.type !== "trait") continue;
    for (const g of item?.system?.slotGrants ?? []) grants.push(g);
  }
  return effectiveCapacities(grants);
}

/**
 * Where every item sits, from whichever shape this actor carries.
 *
 * Real PT1 data is per-item (`system.location = {container, index, length}`).
 * Captured/fixture data may instead carry an actor-level `containers` map.
 * Item locations win; the map fills in anything they did not place.
 */
function readPlacements(actor) {
  const placed = [];
  const seen = new Set();

  for (const item of actor?.items ?? []) {
    const loc = item?.system?.location;
    if (!isObject(loc) || !loc.container) continue;
    const id = item.id ?? item._id ?? null;
    seen.add(id);
    placed.push({
      id,
      name: item.name ?? "",
      container: loc.container,
      index: toCount(loc.index),
      length: Math.max(1, toCount(loc.length ?? item.system?.slots ?? 1)),
      equipSlotType: item.system?.equipSlotType ?? ""
    });
  }

  const containers = actor?.system?.containers ?? actor?._source?.system?.containers;
  if (isObject(containers)) {
    const byId = new Map();
    for (const item of actor?.items ?? []) byId.set(item.id ?? item._id, item);
    for (const [container, list] of Object.entries(containers)) {
      if (!Array.isArray(list)) continue;
      list.forEach((entry, index) => {
        if (!entry || seen.has(entry)) return;
        const item = byId.get(entry);
        placed.push({
          id: entry,
          name: item?.name ?? entry,
          container,
          index,
          length: Math.max(1, toCount(item?.system?.slots ?? 1)),
          equipSlotType: item?.system?.equipSlotType ?? ""
        });
      });
    }
  }

  return placed.sort((a, b) => (a.container < b.container ? -1 : a.container > b.container ? 1
    : a.index - b.index));
}

/**
 * LAYER (b). Audit an actor's slot placements against the Playtest 2 axes and
 * re-check its wound placement.
 *
 * The belt widening 2 -> 4 needs no work: capacity is config, and widening
 * cannot invalidate anything. The magic slots keep their PT1 keys, so items
 * move from the old combined `containers` map onto the new magic axis by
 * matching `equipSlotTypes` without changing a single index.
 *
 * ANYTHING ILLEGAL IS COLLECTED AND REPORTED, NEVER SILENTLY RELOCATED. A
 * migration that quietly repacks a character's bag makes the Ref debug a
 * layout nobody chose.
 *
 * The one thing it will change is a wound sitting on an occupied slot while an
 * empty one exists — and only when doing so STRICTLY REDUCES the number of
 * shared slots, so it converges and cannot churn. That is not a relocation of
 * anyone's gear; it is deliverable 4's "prefer empty slots" rule applied where
 * the occupancy data actually lives. Layer (a) placed wounds from whatever the
 * `system` object showed, which for real PT1 data is nothing at all.
 */
export function migrateActorSlots(actor) {
  const result = {
    actorId: actor?.id ?? actor?._id ?? null,
    actorName: actor?.name ?? "",
    illegal: [],
    magicOverload: [],
    wounds: { count: 0, indices: [], forcedOntoOccupied: [], orphaned: [], moved: false },
    updates: {}
  };
  if (!actor || !isObject(actor.system)) return result;

  const caps = capacitiesFor(actor);
  const placements = readPlacements(actor);

  // --- placement audit ------------------------------------------------------
  const spans = new Map();          // container -> Map<index, placement>
  const perMagic = new Map();       // magic container -> count
  for (const p of placements) {
    const cap = caps[p.container];
    if (cap === undefined) { result.illegal.push({ ...p, reason: "unknown-container" }); continue; }
    if (p.index + p.length > cap) { result.illegal.push({ ...p, reason: "beyond-capacity", capacity: cap }); continue; }

    const used = spans.get(p.container) ?? new Map();
    let overlaps = false;
    for (let i = p.index; i < p.index + p.length; i++) if (used.has(i)) overlaps = true;
    if (overlaps) {
      result.illegal.push({ ...p, reason: "overlap" });
      continue;
    }
    for (let i = p.index; i < p.index + p.length; i++) used.set(i, p);
    spans.set(p.container, used);

    if (CROWS.magicSlots.includes(p.container)) {
      perMagic.set(p.container, (perMagic.get(p.container) ?? 0) + 1);
      // The item declares which magic slot it belongs in; a mismatch is a
      // content/data error the Ref should see, not something to auto-correct.
      if (p.equipSlotType && p.equipSlotType !== p.container) {
        result.illegal.push({ ...p, reason: "equip-slot-mismatch" });
      }
    }
  }
  for (const [container, n] of perMagic) {
    // R:438 / CROWS.Warn.magicSlotOverload — one item per magic slot.
    if (n > 1) result.magicOverload.push({ container, count: n });
  }

  // --- wounds ---------------------------------------------------------------
  const backpackCap = toCount(caps.backpack);
  const occupied = new Set();
  for (const [index] of (spans.get("backpack") ?? new Map())) occupied.add(index);

  const current = [...(actor.system.woundSlots ?? [])].map(toCount).sort((a, b) => a - b);
  const currentForced = current.filter((i) => i < backpackCap && occupied.has(i));
  const ideal = placeWoundSlots(current.length, { occupied, capacity: backpackCap });

  const useIdeal = ideal.forced.length < currentForced.length;
  const indices = useIdeal ? ideal.indices : current;
  if (useIdeal) result.updates["system.woundSlots"] = indices;

  result.wounds = {
    count: current.length,
    indices,
    forcedOntoOccupied: useIdeal ? ideal.forced : currentForced,
    // NEVER clamped and NEVER dropped — surfaced exactly as prepareDerivedData does.
    orphaned: indices.filter((i) => i >= backpackCap),
    moved: useIdeal
  };

  return result;
}

/**
 * LAYER (b), one call per actor. What the `ready` world pass and the
 * `createActor` straggler pass both run.
 *
 * Applies nothing: returns the merged flattened update paths for the caller to
 * write, plus the record `buildMigrationReport` consumes.
 */
export function migrateActorDocument(actor, options = {}) {
  const expertises = reconcileActorExpertises(actor, options);
  const slots = migrateActorSlots(actor);

  // A world holding a deleted status effect (`boned`, `hidden`, `invisible`)
  // should be told, not silently cleaned — conditions.mjs owns that list.
  const statuses = [];
  for (const effect of actor?.effects ?? []) {
    for (const id of effect?.statuses ?? []) if (REMOVED_STATUS_IDS.includes(id)) statuses.push(id);
  }

  return {
    actorId: actor?.id ?? actor?._id ?? null,
    actorName: actor?.name ?? "",
    type: actor?.type ?? null,
    expertises,
    slots,
    removedStatuses: [...new Set(statuses)],
    updates: { ...slots.updates, ...expertises.updates }
  };
}

/* -------------------------------------------------------------------------- */
/*  The GM report. Nothing disappears silently.                                */
/* -------------------------------------------------------------------------- */

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Turn per-actor results into JournalEntry creation data.
 *
 * Pure — returns plain data. T2.3 calls `JournalEntry.create()` with it.
 * `format: 1` is CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, spelled literally so
 * this file keeps no Foundry global dependency.
 *
 * @param {Array<object>} results output of `migrateActorDocument`
 * @param {{mode?: string, title?: string}} [options]
 */
export function buildMigrationReport(results = [], { mode = "report-only", title = "CROWS — Playtest 2 Migration" } = {}) {
  const rows = Array.isArray(results) ? results.filter(Boolean) : [];

  const overBudget = rows.filter((r) => (r.expertises?.overBudget ?? 0) > 0);
  const unresolved = rows.filter((r) => r.expertises?.skipped && String(r.expertises.reason ?? "").startsWith("background"));
  const withIllegal = rows.filter((r) => r.slots?.illegal?.length);
  const withOverload = rows.filter((r) => r.slots?.magicOverload?.length);
  const withForced = rows.filter((r) => r.slots?.wounds?.forcedOntoOccupied?.length);
  const withOrphans = rows.filter((r) => r.slots?.wounds?.orphaned?.length);
  const withStatuses = rows.filter((r) => r.removedStatuses?.length);

  const parts = [];
  parts.push(`<h2>Summary</h2><ul>`);
  parts.push(`<li>${rows.length} actor(s) examined.</li>`);
  parts.push(`<li>Expertise budget mode: <strong>${esc(mode)}</strong>${
    mode === "enforce" ? " — trims below were WRITTEN." : " — nothing was written; the trims below are what enforcing WOULD do."}</li>`);
  parts.push(`<li>${overBudget.length} actor(s) over the expertise budget.</li>`);
  parts.push(`<li>${unresolved.length} actor(s) whose background could not be resolved — <strong>budget skipped, not assumed zero</strong>.</li>`);
  parts.push(`<li>Belt capacity widened 2 &rarr; 4 (R:428). A widening cannot invalidate an existing placement; no item was moved for it.</li>`);
  parts.push(`</ul>`);

  if (unresolved.length) {
    parts.push(`<h2>Backgrounds not resolved</h2>`);
    parts.push(`<p>These characters' expertise budgets were <strong>skipped entirely</strong>. An unresolved background is never read as zero grants: that would report the largest possible surplus at the moment least is known. Re-run the migration once the Playtest 2 backgrounds are in the compendium.</p><ul>`);
    for (const r of unresolved) {
      parts.push(`<li><strong>${esc(r.actorName)}</strong> — background "${esc(r.expertises?.background?.name ?? "")}" (${esc(r.expertises.reason)})</li>`);
    }
    parts.push(`</ul>`);
  }

  if (overBudget.length) {
    parts.push(`<h2>Expertise budget</h2>`);
    parts.push(`<table><thead><tr><th>Actor</th><th>Owned</th><th>Budget</th><th>Over</th><th>Would trim</th></tr></thead><tbody>`);
    for (const r of overBudget) {
      const e = r.expertises;
      const trims = e.trimmed.map((t) => `${esc(t.key)} ${t.from}&rarr;${t.to}`).join(", ");
      parts.push(`<tr><td>${esc(r.actorName)}</td><td>${e.desired}</td><td>${e.budget}</td><td>${e.overBudget}</td><td>${trims}</td></tr>`);
    }
    parts.push(`</tbody></table>`);
  }

  if (withForced.length || withOrphans.length) {
    parts.push(`<h2>Wounds</h2><ul>`);
    for (const r of withForced) {
      parts.push(`<li><strong>${esc(r.actorName)}</strong> — wound(s) on backpack slot(s) ${r.slots.wounds.forcedOntoOccupied.join(", ")} that also hold an item (costs 1 speed each, R:524). No empty slot was available; rearrange freely.</li>`);
    }
    for (const r of withOrphans) {
      parts.push(`<li><strong>${esc(r.actorName)}</strong> — wound(s) at index ${r.slots.wounds.orphaned.join(", ")} sit beyond current backpack capacity. Preserved, not dropped.</li>`);
    }
    parts.push(`</ul>`);
  }

  if (withIllegal.length || withOverload.length) {
    parts.push(`<h2>Slot placements flagged</h2>`);
    parts.push(`<p>Reported, never moved — a migration that repacks a character's bag makes the Ref debug a layout nobody chose.</p><ul>`);
    for (const r of withIllegal) {
      for (const i of r.slots.illegal) {
        parts.push(`<li><strong>${esc(r.actorName)}</strong> — ${esc(i.name)} at ${esc(i.container)}[${i.index}]: ${esc(i.reason)}</li>`);
      }
    }
    for (const r of withOverload) {
      for (const o of r.slots.magicOverload) {
        parts.push(`<li><strong>${esc(r.actorName)}</strong> — ${o.count} items in the ${esc(o.container)} magic slot. You can't rest, and you gain 1d6 wounds at the end of each dungeon turn.</li>`);
      }
    }
    parts.push(`</ul>`);
  }

  if (withStatuses.length) {
    parts.push(`<h2>Deleted status effects</h2><ul>`);
    for (const r of withStatuses) {
      parts.push(`<li><strong>${esc(r.actorName)}</strong> — ${r.removedStatuses.map(esc).join(", ")}. <em>boned</em> has no Playtest 2 equivalent and was NOT converted to Weakened (different duration, different semantics); hiding is a test now (R:408), not a condition.</li>`);
    }
    parts.push(`</ul>`);
  }

  return {
    name: title,
    pages: [{
      name: "Migration report",
      type: "text",
      title: { show: true, level: 1 },
      text: { content: parts.join("\n"), format: 1 }
    }]
  };
}

/* ==========================================================================
 * WIRING — for T2.3. Nothing below runs; it is the call shape, in one place.
 *
 *   1. LAYER (a), in the data models (this is NOT wired yet — no `migrateData`
 *      exists on CrowData or BackgroundData; whoever owns those files adds it):
 *
 *        static migrateData(source) {
 *          return super.migrateData(migrateCrowSystem(source));
 *        }
 *
 *      Note the RETURN. Several transforms work by deleting a key, so the
 *      returned object must be used as the source — merging it onto the
 *      original resurrects `skills`, `wounds` and `boned`.
 *
 *   2. LAYER (b), on `ready`, gated on the world's stored system version:
 *
 *        const pack = game.packs.get("crows.crows-backgrounds");
 *        const index = buildBackgroundIndex(await pack.getDocuments());
 *        const mode  = game.settings.get("crows", "migrationExpertiseBudget");
 *        const results = [];
 *        for (const actor of game.actors) {
 *          const r = migrateActorDocument(actor, { backgrounds: index, mode });
 *          results.push(r);
 *          if (Object.keys(r.updates).length) await actor.update(r.updates);
 *        }
 *        await JournalEntry.create(buildMigrationReport(results, { mode }));
 *
 *   3. `createActor`, for the stragglers — an actor imported AFTER the world
 *      pass (dragged from another world, restored from a backup or a
 *      compendium) never passes through step 2 and would keep its over-budget
 *      uses unchecked. Same call, one actor. Both paths are stamped, so
 *      neither runs twice.
 *
 * The world setting T2.3 registers:
 *   crows.migrationExpertiseBudget: "report-only" (DEFAULT) | "enforce"
 * ========================================================================== */
