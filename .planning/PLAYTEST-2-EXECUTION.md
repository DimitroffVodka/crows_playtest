# Crows Playtest 2 — Execution Plan & Sub-Agent Breakdown

Companion to [PLAYTEST-2-MIGRATION.md](PLAYTEST-2-MIGRATION.md), which holds the rules delta and rationale.
This document is the **work breakdown**: what each sub-agent owns, what it may read, what it must deliver, and how its output is checked.

**Doc line refs** are to `Crows Playtest 2 - Master.md` (8,379 lines) unless stated.
**Repo root:** `/home/patricks/FoundryV14/Data/systems/crows`

---

## Part 0 — Dispatch model

### 0.1 The one rule that makes parallelism work

**Every task has exclusive write ownership of a file set. No two concurrent tasks write the same file.**

This repo has two contention magnets:

| File | Lines | Why it's contended |
| --- | --- | --- |
| `module/sheets/crow-sheet.mjs` | 921 | Every feature wants to touch it |
| `templates/actor/crow/sheet.hbs` | 469 | Same |
| `module/config.mjs` | 43 | Every feature reads it |

Handle them differently:
- `config.mjs` and the data models are the **contract**. Written once, first, by a single agent. Then **frozen** for the rest of the wave. Everything downstream reads them and codes against them.
- `crow-sheet.mjs` and `sheet.hbs` are **deferred**. Wave 1 agents write pure helpers with no sheet code at all. A single sheet-owner agent integrates them in Wave 2.

If you'd rather not enforce discipline, `isolation: "worktree"` on the Agent tool gives each agent its own git worktree. But then you own the merges — and for Wave 1 the file sets are genuinely disjoint, so worktrees add merge cost for no benefit. **Recommend: single tree, file-disjoint, for Waves 0–2. Worktrees only for Wave 3 content** (many agents, mechanical output, trivial merges) or if you want to race competing implementations of the roll engine.

### 0.2 Verification gates

Existing harness, all of it reusable:

- `./verify.sh` — syntax check + v14 anti-pattern guards. **Every task must leave this passing.** Note it already encodes correct v14 idioms: `renderChatMessageHTML` (not `renderChatMessage`), `CONST.ACTIVE_EFFECT_CHANGE_TYPES` (not `ACTIVE_EFFECT_MODES`), ApplicationV2 only.
- `dev/probes/p*.mjs` — live in-world probes, run via the foundry-vtt MCP `evaluate` tool, each returning `{pass: boolean}`. Helpers are reachable as `game.crows.*`.
- `dev/fixtures/setup.mjs` / `teardown.mjs` — idempotent test-world data.
- `docs/discrepancies/` — per-pack YAML-vs-source cross-validation with HIGH/MED/LOW/INFO severities.

> **Two conventions that will silently waste your work if you get them wrong.**
>
> 1. **Unit tests must be named `*.test.mjs`, never `*.test.js`.** The runner is
>    `node --test "test/**/*.test.mjs"` (T0.3). A `.js` file is not matched by that
>    glob, so it never executes — and `npm test` still reports **green**, because it
>    simply never saw the file. Every Wave 1 brief said `.test.js` until this was
>    caught pre-dispatch; they now say `.mjs`. A test that cannot fail is worse
>    than no test, because it buys false confidence.
> 2. **`dev/` is gitignored.** Probes there are real and runnable, but they will
>    never be committed — so anything another agent must READ cannot live there.
>    Unit-test fixtures are in **`test/fixtures/actors/`** for exactly that reason.

> **Discrepancy with the research doc you supplied:** `foundry-system-development-best-practices.md` says to use `CONST.ACTIVE_EFFECT_MODES`. This repo's `verify.sh` blocks that and requires `CONST.ACTIVE_EFFECT_CHANGE_TYPES` for v14. The repo guard was written against a live v14 world, so trust it — but have T0.1 confirm against the v14 API mirror and record the answer, because getting this wrong silently breaks every Active Effect.

**Missing piece:** there is no unit-test runner. Wave 1 is mostly pure functions with tricky truth tables (edge/bane resolution, slot packing, migration mapping) that must not require a running Foundry to test. **T0.3 adds one.**

### 0.3 Sub-agent brief template

Each task below is written to be pasted directly as an Agent prompt. The shape is:

```
TASK <id> — <title>
OWNS (exclusive write):   <file paths>
READS (do not modify):    <file paths>
SOURCE:                   <doc path + line ranges>
CONTRACT:                 <the frozen interfaces you code against>
DELIVERABLE:              <precise>
ACCEPTANCE:               <how it's checked>
DO NOT:                   <scope fence — usually "touch sheets/templates">
```

The **DO NOT** line is load-bearing. Agents drift into adjacent files without it.

---

## Part 1 — WAVE 0: The Contract (sequential, blocks everything)

Three tasks. Run T0.1 → T0.2 → T0.3, or T0.1 then T0.2 and T0.3 in parallel. **Do not start Wave 1 until T0.2 is reviewed and frozen.**

### T0.1 — API verification & branch setup

```
TASK T0.1 — Branch, hygiene, API verification
OWNS:    .gitignore, .gitattributes, system.json, package.json, .planning/API-NOTES.md
READS:   verify.sh, .planning/PLAYTEST-2-MIGRATION.md
SOURCE:  n/a

DELIVERABLE:
1. Branch `playtest-2` off master.
2. Resolve packs/ git churn: packs/ is tracked, so every Foundry launch dirties
   CURRENT and MANIFEST-*. Either gitignore generated LevelDB (src/packs/*.yaml
   stays the committed source, packs built at release) or add `packs/** binary`
   to .gitattributes. Recommend the former; state which you chose and why.
3. system.json: version 0.2.0, compatibility {minimum: "14", verified: "14"},
   description updated to the Aug-Sept 2026 playtest.
4. Write .planning/API-NOTES.md answering, against the v14 API mirror
   (wiki MCP `search`/`read_document`, sources foundry-api/*):
   - Active Effect change modes: CONST.ACTIVE_EFFECT_CHANGE_TYPES or
     ACTIVE_EFFECT_MODES? verify.sh blocks the latter. Confirm and cite.
   - The current chat-message render hook name and signature.
   - How to attach a click handler to a button inside chat message content in
     v14, and how to re-render a single chat message after updating its flags.
   - DocumentSheetConfig.registerSheet namespace in v14.
   Each answer needs a citation to the mirror. Where the mirror is silent, say so.

ACCEPTANCE: ./verify.sh passes. `git status` clean after a Foundry launch.
            API-NOTES.md has a cited answer or an explicit "unverified" per question.
DO NOT:     touch module/, templates/, or src/packs/.
```

### T0.2 — The frozen contract: config + data models

This is the highest-leverage task in the project. Everything downstream codes against its output. **One agent, reviewed by you before Wave 1 starts.**

```
TASK T0.2 — config.mjs + all data models (THE CONTRACT)
OWNS (exclusive write):
  module/config.mjs
  module/data/actor/crow.mjs
  module/data/actor/monster.mjs
  module/data/item/background.mjs
  module/data/item/trait.mjs
  module/conditions.mjs
  lang/en.json
READS:   all of module/ (to understand current usage), .planning/PLAYTEST-2-MIGRATION.md
SOURCE:  Master.md R:164–174 (characteristics), R:290–358 (expertises),
         R:410–498 (sizes + inventory + corpses), R:526–558 (conditions),
         C:22–42 (creation), C:603–659 (advancement),
         F:688–732 (creature stats: power, slots, X/Rest)

DELIVERABLE: See "Part 1.1 Contract specification" in this document. Implement it
exactly. Where the spec is under-determined, decide, and add a `// CONTRACT:`
comment explaining the choice — downstream agents will read those comments.

Also produce .planning/CONTRACT.md: the final shape of CROWS and every schema,
as reference for parallel agents who must not read your in-progress files.

ACCEPTANCE:
  - ./verify.sh passes.
  - node --check on every changed file.
  - Every string that reaches a user has a lang/en.json key (30 expertises with
    label + hint, 6 conditions, TYPES entries, sheet labels).
  - No remaining reference to `boned` or `skills` in any owned file.
  - .planning/CONTRACT.md matches the code.
DO NOT: touch helpers/, sheets/, or templates/. Downstream code WILL break —
        that is expected and is Wave 1's job. Do not try to fix it.
```

### T0.3 — Test harness

```
TASK T0.3 — Unit test runner for pure helpers
OWNS:    package.json (test scripts + devDeps only — coordinate with T0.1 which
         owns the rest of the file; run T0.3 after T0.1 lands), vitest.config.js,
         test/**, test/fixtures/actors/*.json
READS:   verify.sh, dev/probes/*, module/helpers/*
SOURCE:  n/a

DELIVERABLE:
1. Add vitest (or node:test if you prefer zero deps — justify the choice).
   Constraint: tests must run WITHOUT a Foundry runtime. Pure helpers only.
2. `npm test` script.
3. A stub/shim module providing the globals pure helpers touch (foundry.utils.*,
   Math.clamp, Roll where unavoidable) so helpers can be imported in node.
   Keep the shim minimal and honest — if a helper genuinely needs Foundry, it is
   not a pure helper and belongs in a probe instead.
4. Fixture actors in test/fixtures/actors/: at minimum one Playtest 1 crow with
   skills, wounds, boned, and a full inventory — this is the migration test input.
   Include a partial-update-delta fixture (a bare {"system":{"skills":{"climb":
   {"bonus":0}}}} object), because migrateData runs on deltas, not just whole docs.
5. One example passing test against an existing pure helper (classifyTier) to
   prove the harness works.

ACCEPTANCE: `npm test` green. `./verify.sh` passes. No Foundry required.
DO NOT: write tests for functions that don't exist yet. Wave 1 authors own those.
```

### Part 1.1 — Contract specification

T0.2 implements this. Downstream agents code against it.

> **Revised 2026-08-20.** Citations converted to `Book:Line` form (`R:` Rules, `C:` Characters, `F:` Ref — see the migration plan's header for the mapping).
>
> **Round 1** — five defects: monster slots/expertises (B2), concrete type definitions (B3), tier precedence as early returns (B4), derived expertise max (H6), coin purse (H7).
> **Round 2** — wound/speed reading (c), the A1 commit point, migration budget (H5), wound-slot bound (M12).
> **Round 3 (pre-freeze read-through)** — ten more:
>
> | | |
> |---|---|
> | C1 | the expertise budget was specified in the pure per-document layer, where it provably cannot run. Split into layer (a) shape-only and layer (b) reconcile. |
> | C2 | `canSpendExpertise` had no `state` check — a declined card was still spendable. |
> | C3 | `total` typed `number` but `null` on every terminal path. |
> | C4 | `resolveTier` returns a `TierResolution`, not a `TestResult`; multi-target semantics defined. |
> | C5 | `speedPenaltyFromWounds` was sitting inside the schema field list. |
> | C6 | `expertiseMaxForTxp(0)` was undefined — now returns `expertiseMaxAtCreation`. |
> | C7 | conditions vs Active Effects settled: system booleans authoritative, effects mirror. |
> | C8 | the render hook fires twice (verified live) — idempotent binding is mandatory. |
> | C9 | `Layout.capacities` was missing the six magic slots. |
> | C10 | `resolveTier` takes a `TargetRef` snapshot, not a Foundry document. |
>
> C7 and C8 are new information from T0.1, verified against Foundry 14.367 — see `.planning/API-NOTES.md`.

**`module/config.mjs`**

```js
export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  charRange: { min: -5, max: 5 },     // R:174 — schema bounds; magic may exceed the PC cap
  charPcCap: 4,                        // C:640, enforced in advancement not schema

  tiers: { t1Max: 11, t2Max: 16 },
  doomFaces: [2, 3],                   // NB: these are 2d10 SUMS, not die faces
  critFaces: [19, 20],                 //     (see L14 in the critique — rename deferred)

  edgeBane: { numeric: 2 },            // single edge +2 / single bane -2 (R:264)

  // Expertises (R:298-348). Category gates what a test may apply.
  expertises: {
    general: ["alchemy","athletics","blacksmithing","enchanting","endurance",
              "gymnastics","handlePet","historicalLore","lift","magicLore",
              "monsterLore","natureLore","navigate","pickLock","religiousLore",
              "search","stealth","thievery"],
    spellcasting: ["alteration","benefaction","conjuration","elemental",
                   "illusion","necromancy"],
    weapon: ["bashing","bow","chopping","slashing","stabbing","unarmed"]
  },

  // Carry containers vs magic-item slots are now SEPARATE axes (R:426 vs R:438).
  carryContainers: { hand: 2, belt: 4, backpack: 10 },   // belt was 2 in PT1
  magicSlots: ["head","neck","waist","arms","finger","feet"],  // 1 item each

  stackLimits: { potion: 5, lock: 3, oil: 2 },   // R:432; default 1. Same KIND only;
                                                 // hand slots never stack (R:432).

  // --- Money (H7). Two ways a slot can carry coin, not one. ---------------
  // C:1917: "An inventory slot can hold 250 loose coins OR 1 purse that holds
  // up to 500 gc." Every PC starts with an empty coin purse (C:36), the Coin
  // Bursting Purse (C:1737) is the ONLY published capacity increase; there is no
  // per-quality-tier purse capacity (an earlier note cited C:1940 for that, but
  // C:1940 is the Gear Prices row). One trait
  // grants +500 gc of purse capacity (C:1737). Modelling only `coinPerSlot`
  // makes starting equipment unrepresentable.
  coinPerSlot: 250,                              // loose coins, 1 slot
  pursePerSlot: 1,                               // a purse occupies its slot alone
  purseBaseCapacity: 500,                        // C:1917. NOT overridden by quality
                                                 // tier — Bursting Purse (C:1737) is the
                                                 // only published increase.

  corpseSlots: { tiny: 1, small: 2, medium: 4, large: 8, huge: 16, holyShit: 32 },
  corpseStack: { tiny: 3 },                      // R:486; all others 1

  sizes: ["tiny","small","medium","large","huge","holyShit"],
  harvestDice: { tiny:"1d6", small:"1d6", medium:"1d6",
                 large:"2d6", huge:"3d6", holyShit:"4d6" },   // R:652

  greedBonus: { 1: 0.30, 2: 0.20, 3: 0.10 },     // R:590, by DT number
  encounter: { defaultEN: 9, crowdedEN: 8, bothEN: 7, immediateOn: 10 },  // R:622

  conditions: ["blessed","grabbed","prone","vulnerable","unconscious","weakened"],
  // NOTE: `boned` is DELETED. `hidden`/`invisible` were PT1 additions not in the
  // PT2 condition list — keep them only if the sheet needs them, and mark clearly.

  expertiseAdvancement: [                        // C:621
    { txp: 100,    bonus: 1,  maxUses: 2 },
    { txp: 500,    bonus: 2,  maxUses: 2 },
    { txp: 1250,   bonus: 3,  maxUses: 2 },
    { txp: 2250,   bonus: 4,  maxUses: 2 },
    { txp: 3500,   bonus: 5,  maxUses: 2 },
    { txp: 5000,   bonus: 6,  maxUses: 3 },
    { txp: 10000,  bonus: 7,  maxUses: 3 },
    { txp: 20000,  bonus: 8,  maxUses: 4 },
    { txp: 30000,  bonus: 9,  maxUses: 4 }
  ],
  expertiseAdvancementRepeat: 30000,             // "every 30,000 after", maxUses 4
  charAdvancement: [5000, 15000, 30000],         // C:642
  charAdvancementRepeat: 30000,
  retirementTXP: 60000,                          // changelog

  // H6: expertise `max` is DERIVED from TXP, never stored. At creation (TXP 0)
  // the cap is the table's first row, 2 — which is what makes a background's
  // "Benefaction (2 uses)" grant legal on a brand-new crow.
  expertiseMaxAtCreation: 2,                     // C:621 first row

  // unchanged from PT1 — re-verify in Wave 3 but do not restructure now
  weaponTypes: [...], weaponQualities: [...], armorTypes: [...],
  armorBaseAD: {...}, armorSlots: {...}, disciplines: [...],
  traitTrees: [...], traitTierXP: {...}, creatureTypes: [...],
  castTypes: [...], usageExpiry: [...], qualityTiers: [...], gearSubtypes: [...]
};
```

**`CrowData` schema — changed fields only**

```js
// REPLACES `skills`.
// H6 FIX: `max` is NOT stored. It is a pure function of the actor's TXP via
// CROWS.expertiseAdvancement, computed in prepareDerivedData. Storing it meant
// a freshly created crow had uses=2 (from its background, C:103) against max=0
// — the schema contradicted the creation rules. Deriving it removes the whole
// class of drift, and R:294 backs this: uses are "determined at character
// creation and can be increased through character advancement" — the CAP is a
// property of advancement, not of the actor.
expertises: new SchemaField(
  Object.fromEntries(allExpertiseKeys.map(k => [k, new SchemaField({
    value: new NumberField({ initial: 0, min: 0, integer: true }),  // REMAINING now
    max:   new NumberField({ initial: 0, min: 0, integer: true })   // OWNED, persistent
  })]))
),
// THREE quantities. Conflating any two of them corrupts characters — a single
// mutable count cannot survive spend-then-rest, because at 0 nothing
// distinguishes "granted 1 and spent" from "granted 2 and spent twice" from
// "never owned", and restoring to the CAP mints uses nobody bought.
//   value        stored, remaining right now  — spending decrements this
//   max          stored, permanently owned    — background + advancement
//   expertiseCap derived, the legal 2/3/4 ceiling for this TXP
//
// derived, in prepareDerivedData:
//   const cap = expertiseMaxForTxp(this.xp.txp);   // 2 -> 3 at 5,000 -> 4 at 20,000
//   for (const e of Object.values(this.expertises)) {
//     e.overCap = Math.max(0, e.max - cap);        // surface, never silently clamp
//     e.overMax = Math.max(0, e.value - e.max); }  // should be 0; report, don't trust
//
// WHO WRITES WHAT — frozen, because four Wave 1 tasks touch this:
//   migration (T1.3)   value = max = converted grant
//   spend     (T1.1)   value -= 1        (never touches max)
//   rest      (T1.5)   value = max       (R:628)
//   …in Miasma (T1.5)  leave value alone (R:1375) — inexpressible with one field
//   advancement (T1.4) max += n, and value += n with it (C:615)
//   H5 enforce (T1.3)  trims max, then clamps value <= max
//   H5 budget  (T1.3)  reads max, NEVER value — otherwise the reported
//                      over-budget figure shrinks every time a player spends

characteristics: { agility|mind|strength: { value: NumberField({min:-5, max:5}) } },
// was min:-1 max:3 — both wrong for PT2 (R:174 gives the -5..5 range)

conditions: new SchemaField({
  blessed:     new BooleanField({ initial: false }),   // was NumberField (leveled)
  grabbed:     new BooleanField({ initial: false }),
  prone:       new BooleanField({ initial: false }),
  vulnerable:  new BooleanField({ initial: false }),   // NEW R:544
  unconscious: new BooleanField({ initial: false }),
  weakened:    new BooleanField({ initial: false })    // NEW R:556
  // `boned` DELETED
}),

// Wounds occupy PLAYER-CHOSEN backpack slots (R:524), not a bare count.
//
// M12 FIX: NO `max` on the schema. The earlier draft used `max: 9`, hardcoding
// a 10-slot backpack — but backpack size is config (`carryContainers.backpack`)
// and slot-granting traits exist (C:737). More fundamentally, schema validation
// runs on SOURCE, before derived data exists, so it cannot see a capacity that
// traits and items contribute to. Capacity is enforced in derived data and at
// the mutation site, where a useful error can be given.
woundSlots: new SetField(new NumberField({ min: 0, integer: true })),

// derived, in prepareDerivedData — capacity-relative, and NON-DESTRUCTIVE:
//   const cap = this.backpackCapacity;         // config + trait/item grants
//   const held     = [...this.woundSlots].filter(i => i <  cap);
//   const orphaned = [...this.woundSlots].filter(i => i >= cap);
//   this.wounds           = held.length;       // back-compat scalar
//   this.orphanedWounds   = orphaned;          // SURFACE, never drop
//   this.woundCapacityFilled = held.length >= cap;  // R:524 "all backpack slots"
//   REPORTING ONLY — never adjudicate death here; it can flip true because
//   CAPACITY SHRANK. Death is decided at the wound-GAIN mutation.
//
// Two things the old `max: 9` was hiding, both worth stating outright:
//  1. NEVER clamp or discard an out-of-range index. If a slot-granting trait is
//     removed, its wounds must not silently evaporate — that would spontaneously
//     heal a character. Orphan them and show them on the sheet.
//  2. Death is capacity-relative, not `>= 10`. Evaluate it on wound GAIN only.
//     If you also evaluate it when capacity SHRINKS, removing a trait can
//     instantly kill a wounded PC. Flag that case for the Ref instead.
//
// Humans and animals have slots too (F:698), so MonsterData needs the same
// `woundSlots` field and the same derivation whenever `slots > 0`.

// Wound speed penalty is NOT a schema field — see "Derived helpers" below.

xp: { txp, spendable, expertiseBonusesSpent, charBonusesSpent },
// renamed from skillBonusesSpent

preparedTask: new SchemaField({          // R:658-664: now a task, not a skill
  task:  new StringField({ blank: true, initial: "" }),
  bonus: new NumberField({ initial: 2, integer: true }),   // was +1, now +2
  setOn: new StringField({ blank: true, initial: "" })
}),

npcConnection: new SchemaField({          // NEW C:40 / C:2551
  name: new StringField({ blank: true }),
  relationship: new StringField({ blank: true }),
  notes: new HTMLField()
})
```

**Derived helpers** — *not schema fields. These are plain functions; do not paste them into `defineSchema()`.*

```js
/** C6: the per-expertise cap, derived from TXP. Below the table's first row
 *  (txp 100) it is CROWS.expertiseMaxAtCreation — NOT 0 and NOT undefined.
 *  Getting this wrong reinstates the H6 bug: a background grants 2 uses
 *  (C:103) to a TXP-0 crow, which must be legal on day one. */
function expertiseMaxForTxp(txp = 0) {
  const rows = CROWS.expertiseAdvancement.filter(r => txp >= r.txp);
  if (!rows.length) return CROWS.expertiseMaxAtCreation;   // 2
  return rows.at(-1).maxUses;                              // 2 -> 3 @5k -> 4 @20k
}

/** Over-budget surfacing. REQUIRED because `crows.migrationExpertiseBudget`
 *  defaults to "report-only" — the migration reports and writes nothing, so an
 *  over-budget character stays over-budget indefinitely. A migration-time
 *  journal entry scrolls away; this does not.
 *
 *  Derived, never stored. Zero for any legally-advanced crow, so it costs
 *  nothing on a normal sheet and is loud on a migrated one. The crow sheet
 *  (T2.1) shows a badge when it is non-zero. */
function expertiseOverBudget(actor) {
  const spent  = Object.values(actor.system.expertises)
                       .reduce((n, e) => n + (e.max ?? 0), 0);   // OWNED, not remaining
  const budget = expertiseBudgetForTxp(
    actor.system.xp?.txp ?? 0,
    backgroundUsesFor(actor),                 // sums the background item
    actor.system.xp?.expertiseBonusesSpent
  );
  return Math.max(0, spent - budget);
}

/** Wound speed penalty. DEFAULT = reading (c) — see the migration plan §1.4.
 *  (c) counts only backpack slots holding BOTH a wound and an item; it is the
 *  only reading under which "a backpack slot of the PC's CHOICE" (R:524) bears
 *  on the sentence it introduces, and it is never harsher than (b) because the
 *  penalty is a subset of the wounds. Reading (a) — every occupied slot — is
 *  rejected outright: speed is 5 (C:24) against a 10-slot backpack (R:428), so
 *  a loaded but UNWOUNDED PC would already be immobile. */
function speedPenaltyFromWounds(layout, rule = "wound-and-item") {
  const p = rule === "wound-only" ? (s => s.wound)
                                  : (s => s.wound && s.items.length > 0);
  return layout.slots.filter(s => s.container === "backpack" && p(s)).length;
}
// world setting `crows.woundSpeedRule`: "wound-and-item" (default) | "wound-only"
// Flip only this. Speed floors at 0 (R:524); apply AFTER other speed effects so
// prone-halving and this don't fight over rounding.
```

**C7 — conditions vs Active Effects. Decide once, here.**

> **The `system.conditions` booleans are authoritative.** The roll pipeline reads them directly (`target.conditions.unconscious`, Weakened → a bane, Blessed → an edge). Foundry status effects **mirror** them for the token HUD and are driven *from* them — never the reverse. Do not implement condition mechanics as Active Effect `changes`; two sources of truth for "is this creature weakened" will desync, and the roll pipeline must not have to resolve a disagreement mid-roll.
>
> Active Effects are still the right tool for **durational backlash effects** (R:1561, "UD for backlash effects are rolled at the end of each DT") and for magic items. When you write one, v14 changed the shape — verified live on 14.367 in `.planning/API-NOTES.md` §1:
>
> ```js
> changes: [{ key: "system.speed", value: "-1", type: "add" }]   // string type
> ```
>
> The numeric `mode:` field is legacy and auto-migrates. **`CONST.ACTIVE_EFFECT_CHANGE_TYPES` values are PRIORITIES, not modes** — `.add` is `20`, so `type: CONST.ACTIVE_EFFECT_CHANGE_TYPES.add` writes `20` where `"add"` was meant. Use the key string.

**`MonsterData` — additions**

> **B2 FIX.** Two defects corrected against a real stat block (`F:1397`):
> `**Sage (Power 6) Size:** Medium **Power:** 6 **Type:** Human **Stamina:** 20 **Speed:** 5 **Slots:** 10 **Agility:** 1 **Mind:** 3 **Strength:** 0 **Expertises:** Historical Lore (2 uses), Magic Lore (2 uses)…`
> — slots are a **count**, not a flag, and monsters carry **expertises**.

```js
power:    new NumberField({ initial: 0, min: 0, integer: true }),           // F:704
// NB: F:704 scales power "from 0 to 50, though future products could go even
// higher" — a soft cap. Do NOT set max: 50; validate with a warning instead.
// Observed range across the whole Ref Book is 1-11.

reactions: new NumberField({ initial: 1, min: 0, integer: true }),          // F:708

// WAS `hasSlots: BooleanField`. F:698: "Monsters don't have slots and die when
// they are reduced to 0 Stamina. Humans and animals … do have slots, which count
// as backpack slots for them." Wounds and death depend on the NUMBER, and stat
// blocks print it (`**Slots:**10`, `**Slots:**15`). 0 means "no slots" — the
// monster case — so the boolean is `slots > 0` and needs no separate field.
slots:    new NumberField({ initial: 0, min: 0, integer: true }),           // F:698
// F:700: a creature that gains another creature's stats KEEPS its original
// slot count — so migration/polymorph must not overwrite this from a stat block.

// NEW. Same THREE-QUANTITY model as CrowData — a creature that spends an
// expertise and then rests has to restore to something, and that something is
// `max`. NOT the same shape as BackgroundData: a background stores a one-off
// GRANT (`uses`), whereas this is a live pool that is spent and refreshed.
// Bare name in a stat block = 1; "(2 uses)" = 2 (F:1397). Migration and content
// both write value = max = the printed number.
// `key` is constrained so an OCR-split or misspelled name fails at load rather
// than entering content silently.
expertises: new ArrayField(new SchemaField({
              key:   new StringField({ required: true, choices: ALL_EXPERTISES }),
              value: new NumberField({ initial: 1, min: 0, integer: true }),
              max:   new NumberField({ initial: 1, min: 0, integer: true })
            })),

size:     new StringField({ choices: CROWS.sizes, initial: "medium" }),
type:     new StringField({ blank: true }),   // "Human", "Animal", "Blood", … (F:1397)
xRest:    new ArrayField(new SchemaField({
            name: new StringField(), max: new NumberField(), used: new NumberField()
          }))                                                              // F:710
// F:714: a crit refunds 1 spent use of an X/Rest feature — wire in T1.1, not here.
```

**`BackgroundData` — changed fields**

```js
// REPLACES `skills: [String]`. Backgrounds grant 1 use in most expertises but
// 2 in some (e.g. Acolyte of the Gardner: Benefaction 2, Elemental 2 — C:103).
expertises: new ArrayField(new SchemaField({
  key:  new StringField({ required: true }),
  uses: new NumberField({ initial: 1, min: 1, integer: true })
})),

// SEMANTIC CHANGE: now names the characteristic SET TO 2, not a +1 bonus (C:28)
characteristicOptionsAt2: new ArrayField(
  new StringField({ choices: Object.keys(CROWS.characteristics) }), { initial: [] }
),
// An ARRAY. The 36 shipped backgrounds hold 30 fixed, 4 two-way choices
// ("mind or strength") and 2 "any" — a singular string cannot encode a choice.
// This is the background's ALLOWED SET; the player's pick lands on the actor.

startingGold: new StringField({ initial: "3d6" })   // C:36
```

**Shared types** — *B3 FIX. These were named but never defined. `Layout` alone is consumed by T1.2 and T1.3 running in parallel; `TestResult` by T1.1, T1.7 and T2.2. Freezing signatures without freezing the shapes they pass just relocates the collision from files to data. Concrete shapes, frozen with the rest:*

```js
/** A labelled reason for an edge, a bane, or a numeric modifier. */
type Label = { key: string, label: string, source?: string };
//   { key: "flanking", label: "Flanking", source: "Actor.abc123" }

/** A numeric bonus/penalty. SEPARATE channel from edges/banes (R:286) — these
 *  never count toward an edge or bane tally. */
type Mod = { key: string, label: string, value: number };
//   { key: "range", label: "Beyond normal range (3 sq)", value: -6 }

/** One inventory slot. `items` holds >1 entry only for a legal stack (R:432). */
type Slot = {
  container: "hand" | "belt" | "backpack" | "head" | "neck" | "waist"
           | "arms" | "finger" | "feet",
  index: number,                  // 0-based within its container
  items: Array<{ id: string, kind: string }>,
  wound: boolean,                 // backpack only (R:524)
  spanId: string | null           // shared id across a multi-slot item's slots
};

/** The whole positional inventory. Contiguity and stacking are properties OF
 *  this structure, so every packing rule is testable without Foundry. */
type Layout = {
  actorId: string,
  // C9: every container in Slot.container appears here. The six magic slots are
  // 1 each (CROWS.magicSlots) and are listed explicitly rather than assumed, so
  // a trait that ever grants a second finger slot has somewhere to say so.
  capacities: {
    hand: number, belt: number, backpack: number,
    head: number, neck: number, waist: number,
    arms: number, finger: number, feet: number
  },
  slots: Slot[],                  // dense, ordered by container then index
  coin: { loose: number, purses: Array<{ id: string, held: number, cap: number }> }
};

/** C10: what resolveTier receives for the target. A PLAIN SNAPSHOT, not a Token,
 *  TokenDocument or Actor — that is what keeps resolveTier pure and unit-testable.
 *  The caller flattens: { tokenId, conditions: actor.system.conditions }. */
type TargetRef = {
  tokenId: string,
  conditions: { unconscious: boolean, prone: boolean, grabbed: boolean,
                blessed: boolean, weakened: boolean, vulnerable: boolean }
};

/** Everything needed to render, re-render, and audit one test. Persisted
 *  verbatim to `message.flags.crows.test`. */
type TestResult = {
  actorId: string,
  characteristic: "agility" | "mind" | "strength",
  rawSum: number,                 // unmodified 2d10
  charVal: number,
  mods: Mod[],
  eb: EdgeBaneResolution,
  // C3: null on every terminal path. A doom/crit/unconscious result returns
  // before a modified total is ever computed, and reporting a total there would
  // imply the modifiers mattered. They did not.
  total: number | null,
  tier: 1 | 2 | 3,
  doom: boolean,
  crit: boolean,
  terminal: null | "doom" | "crit" | "unconscious",  // which early return fired
  kind: "test" | "attack" | "casting",

  // C4: MULTI-TARGET. R:961 — one roll, but per-target edges/banes can resolve
  // to different tiers. `tier` above is the BASE resolution, computed with only
  // the roll-level edges/banes and no target. Each entry below is a separate
  // resolveTier() call sharing this same `rawSum`, with that target's edges and
  // banes appended. A single-target attack has exactly one entry whose tier may
  // still differ from the base (e.g. the target is prone).
  // Read `targets[].tier` to apply damage; read `tier` only to describe the roll.
  targets: Array<{ tokenId: string, tier: 1|2|3, edges: Label[], banes: Label[],
                   terminal: null | "doom" | "crit" | "unconscious" }>,
  expertiseSpent: string | null,  // expertise key, or null

  // --- A1 COMMIT POINT ---------------------------------------------------
  // Rules that key on "a tier N result" read the FINAL, post-expertise tier.
  // A miss is *defined* as a tier 1 result on an attack (R:921), so if triggers
  // read the pre-expertise value, a weapon expertise could never convert a
  // miss — which is the entire purpose of the six weapon expertises. R:292
  // agrees: an expertise improves "the test's RESULT".
  //
  // Therefore NOTHING downstream may fire while `state === "pending"`.
  state: "pending" | "committed",
  commitReason: "no-legal-spend" | "spent" | "declined" | "terminal" | null
};

// C8 — IDEMPOTENCY IS NOT OPTIONAL, and lag is not the main threat.
// Verified live on Foundry 14.367 (.planning/API-NOTES.md §2): the
// `renderChatMessageHTML` hook FIRES TWICE per render. A handler bound the
// naive way is bound twice, so ONE click spends TWO uses. Bind behind a marker:
//
//   const btn = html.querySelector('[data-action="crows-spend-expertise"]');
//   if (!btn || btn.dataset.crowsBound === "1") return;
//   btn.dataset.crowsBound = "1";
//
// Note `html` is a native HTMLLIElement, NOT jQuery — `html.find()` will throw.
// The hook also re-fires after any flag update, which is exactly how the card
// re-renders itself; that is confirmed and is the mechanism this design rests on.

type EdgeBaneResolution = {
  numeric: -2 | 0 | 2,            // single edge/bane only
  tierShift: -1 | 0 | 1,          // double edge/bane only
  edges: Label[], banes: Label[], // as supplied, for the card's explanation
  explanation: string
};
```

**Frozen function contracts** (Wave 1 implements; nobody changes the signatures)

```js
// helpers/edges.mjs — pure, no Foundry
resolveEdgesBanes(edges: Label[], banes: Label[]) => EdgeBaneResolution
// Algorithm (verified against R:278-284): clamp each side to 2, then subtract.
//   E = min(edges.length, 2); B = min(banes.length, 2); net = E - B
//   net=+2 -> tierShift +1 | net=+1 -> numeric +2 | net=0 -> neutral
//   net=-1 -> numeric -2   | net=-2 -> tierShift -1
// Clamp-then-subtract is what makes "3 edges + 1 bane = ONE edge" come out right.
// NB: the earlier draft also returned netEdges/netBanes. Dropped — they
// overdetermine a single net value and invite drift (critique L20).

// helpers/roll.mjs
rollTest({ actor, characteristic, mods: Mod[], edges: Label[], banes: Label[],
           flavor, attack, casting, targets }) => Promise<TestResult>
applyExpertise(message: ChatMessage, expertiseKey: string) => Promise<TestResult>
declineExpertise(message: ChatMessage) => Promise<TestResult>
// ^ REQUIRED. Without an explicit decline, a card with a legal spend available
//   stays `pending` forever and its downstream effects never fire.

// A1: the commit lifecycle. T1.1 owns this; T1.7, T1.8 and T2.2 consume it.
//
//   rollTest()
//     ├─ terminal (doom/crit/unconscious)   -> committed, "terminal"
//     ├─ no legal spend available            -> committed, "no-legal-spend"
//     └─ otherwise                           -> PENDING, card shows spend/decline
//   applyExpertise()   -> committed, "spent"
//   declineExpertise() -> committed, "declined"
//
// On commit — and ONLY on commit — emit `crowsTestCommitted` with the final
// TestResult. Everything that reads a tier hangs off that hook:
//   * miss / damage application            (T1.7, R:915)
//   * Counter reaction window              (T1.7, R:985)
//   * chaos roll -> backlash               (T1.8, R:1567)
//   * Silent armor -> weakened             (T1.7, C:2140)
//   * card re-render into its final state  (T2.2)
//
// A doom commits immediately, because it can't be rescued (R:246). Note it
// does NOT route through the chaos roll: R:1563 gives two independent paths to
// a backlash, and a doom on a casting IS one of them. The chaos roll is the
// other, and fires only on "a tier 1 result that isn't a doom" (R:1567).

// helpers/slots.mjs — pure, no Foundry
packItem(layout: Layout, item, container, index) => {ok: boolean, reason?: string}
canStack(a, b) => boolean
layoutFor(actor) => Layout
retrieveFromBackpack(layout, itemId, d10: number) => {ok, slotsMatched: number[]}

// helpers/migration.mjs — TWO LAYERS. Conflating them is the classic bug, and
// C1 showed the contract itself had conflated them.
//
// ---- LAYER (a): TypeDataModel.migrateData(source) ------------------------
// Per-document, pure, and runs on PARTIAL UPDATE DELTAS as well as whole
// documents. It sees `system` and nothing else: no embedded items, no sibling
// fields it did not receive, possibly no `xp` at all.
migrateCrowSystem(source: object) => object      // safe on partial deltas
migrateBackgroundSystem(source: object) => object
SKILL_TO_EXPERTISE: Record<string, string>
// Layer (a) does the SHAPE work only: skills -> expertises via the map (max wins
// on collapsing pairs), boned dropped, blessed number -> boolean, preparedTask
// .skill -> .task, wounds count -> woundSlots indices.
// It MUST NOT attempt the expertise budget. See below for why.

// ---- LAYER (b): world migration on `ready` --------------------------------
// Has the whole Actor, including embedded items. T2.3 wires it; T1.3 writes it.
reconcileActorExpertises(actor) => {
  granted: Record<string, number>,
  trimmed: Array<{ key: string, from: number, to: number }>,
  desired: number, budget: number, overBudget: number
}
//
// CALLED FROM TWO PLACES, not one. The world migration runs once, gated on the
// world's stored version — but a PT1 actor IMPORTED AFTER that point (dragged
// in from another world, restored from a compendium or a backup) never passes
// through it and would silently keep its over-budget uses. So also call it from
// a createActor hook when the incoming actor carries pre-0.2.0 shape.
//   1. world migration on `ready`  — the bulk pass, gated on system version
//   2. createActor                 — the straggler pass, gated on the actor's
//                                    own stored version stamp
// Stamp each reconciled actor (`flags.crows.expertiseReconciled`) so neither
// path can run twice on the same document.

// H5 FIX — the expertise budget. Converting PT1 skill bonuses 1:1 and clamping
// only PER-EXPERTISE mints characters far outside anything PT2 advancement can
// produce: a PT1 crow with 12 skills at bonus 2 lands on 24 uses, while a bonus
// grants at most 3 (C:615). The total pool needs its own ceiling.
//
// C1 — WHY THIS IS LAYER (b) AND CANNOT BE LAYER (a):
//   * `backgroundUses` needs the background's GRANTS, and the actor stores only
//     `system.background` (a NAME) — there is no embedded Background Item at
//     all. Resolving it means a compendium lookup, which a pure per-document
//     transform cannot do.
//   * The budget needs `xp.txp`. A partial delta may not carry `xp` at all —
//     test/fixtures/actors/pt1-crow-delta.json deliberately omits it.
//   * Running it per-delta would re-trim on every subsequent partial update,
//     compounding the reduction each time a player edited an unrelated field.
// So layer (a) converts shape and leaves `max` possibly over-budget; layer (b)
// reconciles once, against the whole actor, and reports.
expertiseBudgetForTxp(txp, backgroundUses, expertiseBonusesSpent) => number
//   bonusesEarned    = rows of CROWS.expertiseAdvancement with txp <= actor txp,
//                      plus one per expertiseAdvancementRepeat beyond the last row
//   bonusesToUses    = min(expertiseBonusesSpent ?? bonusesEarned, bonusesEarned)
//   budget           = backgroundUses + 3 * bonusesToUses      // 3 = C:615 max
//
// PT1 recorded how many bonuses went to skills in `xp.skillBonusesSpent`; carry
// it, but never trust it above what the PT2 table says the actor has earned.
//
// !! `backgroundUses` HAS NO EMBEDDED SOURCE — read this before implementing !!
//
// An earlier draft said "the sum over the actor's BACKGROUND ITEM's expertises".
// There is no such item. `applyBackground()` writes `system.background = bg.name`
// (helpers/creation.mjs) and CrowData stores it as a bare StringField: the
// background is a NAME, not an embedded document. There is nothing to sum.
//
// FROZEN LOOKUP ROUTE:
//   1. resolve `system.backgroundId` against the crows-backgrounds compendium
//   2. else resolve `system.background` (the name), trimmed, case-insensitive
//   3. on success stamp `backgroundId`, so later runs survive a rename
//   4. on failure REPORT IT and skip this actor's budget entirely.
//      An unresolved background must NEVER be read as backgroundUses = 0. That
//      yields the smallest possible budget and therefore the LARGEST possible
//      over-budget figure — the migration would report a character as wildly
//      over-allocated at exactly the moment it knows least about them.
//
// DEPENDENCY, previously undeclared: this needs PT2 background content in the
// compendium, which is T3.1's output, not Wave 1's. It is survivable because the
// budget runs in LAYER (b) at world-migration time, long after packs are built,
// and because the default is report-only. But it means:
//   * T1.3 implements the lookup and the unresolved-reporting path in Wave 1;
//   * the budget is only MEANINGFUL once T3.1 has landed;
//   * T1.3's tests must cover the unresolved case explicitly — until T3.1 lands
//     the unresolved case is the ONLY case.
// PLAYTEST-2-MIGRATION.md §2.3 item 7 explains why backgrounds are re-transcribed
// rather than migrated, which is what creates this ordering.

reconcileExpertiseBudget(converted, budget, maxPerExpertise) => {
  granted: Record<string, number>,
  trimmed: Array<{ key: string, from: number, to: number }>,
  desired: number, budget: number
}
// Deterministic, and it must be — the tests pin the exact distribution.
//   1. Clamp each expertise to `maxPerExpertise` (the TXP-derived per-key cap).
//   2. While total > budget: remove 1 use from whichever expertise currently has
//      the MOST uses; ties broken by the alphabetically-FIRST key.
//   3. Never top up. If desired < budget the difference is simply unspent.
// Water-levelling rather than greedy-by-strength: it preserves the character's
// BREADTH of training, which is what a PT1 sheet full of low bonuses actually
// represented. Every removal lands in `trimmed` and must reach the GM report.
//
// World setting `crows.migrationExpertiseBudget`:
//   "report-only" (DEFAULT) — compute the budget, report it, WRITE NOTHING.
//                             Step 2 does not run. `trimmed` is still populated
//                             so the GM can see exactly what enforcing would do.
//   "enforce"               — apply step 2 and write the trimmed distribution.
//
// Report-only is the default because an over-budget character is a BALANCE
// problem, not a data-integrity one: nothing crashes, the sheet is just strong.
// That makes it the GM's call, not the migration's, and a migration should not
// silently rewrite a player's sheet to win an argument about balance.
//
// CONSEQUENCE — because the default writes nothing, the over-budget state is
// PERMANENT until a GM acts on it. A one-time journal entry is not enough
// visibility for a permanent state, so prepareDerivedData must surface it on
// the sheet as well (see Derived helpers: `expertiseOverBudget`). Without that,
// the report scrolls away and the character stays quietly over-powered forever.
```

**Tier resolution precedence** — implement exactly this, it is the most error-prone thing in the project.

> **B4 FIX.** The earlier draft numbered ten sequential steps and marked step 2 "TERMINAL" — but the list kept running to step 10, so "terminal" was unenforceable. It collided concretely: a **doom on an attack against an unconscious target** hit both step 2 (tier 1, terminal) and step 8 (tier 3). Rewritten as **early returns**, so terminal means terminal, and the doom/unconscious collision is resolved explicitly rather than by step order.

> **C4.** `resolveTier` returns a **`TierResolution`, not a `TestResult`** — the tier-resolution subset only: `{rawSum, charVal, mods, eb, doom, crit, total, tier, terminal}`. It has no `state`, `commitReason`, `actorId`, `characteristic`, `kind`, `targets` or `expertiseSpent`. `rollTest()` calls it — once for the base resolution with no target, then once per target with that target's edges/banes appended — and assembles the `TestResult` from the results. `resolveTier` is pure: it takes a `TargetRef` snapshot, never a Foundry document.

```js
function resolveTier({ rawSum, charVal, mods, edges, banes, kind, target }) {
  // target?: TargetRef — a plain snapshot. Omit it for the base resolution.
  const doom = CROWS.doomFaces.includes(rawSum);   // 2d10 SUM of 2 or 3 (R:246)
  const crit = CROWS.critFaces.includes(rawSum);   // 2d10 SUM of 19 or 20 (R:244)
  const eb   = resolveEdgesBanes(edges, banes);
  const base = { rawSum, charVal, mods, eb, doom, crit };

  // (1) Attack vs an unconscious target. R:554: "Attacks against you always
  //     achieve a tier 3 result (though the attacker can roll to see if they
  //     get a crit)." That parenthetical narrows what the roll is still FOR —
  //     crit detection — which implies the tier is already settled. So this
  //     outranks doom. `doom` is still reported so the Ref can adjudicate the
  //     "major setback" (R:246) narratively; it does not lower the tier.
  //     SEE OPEN QUESTION 7 — flip this one constant if MCDM says otherwise.
  if (kind === "attack" && target?.conditions?.unconscious) {
    // NB `crit` stays in `base` and is still reported. R:554 explicitly keeps
    // the crit roll live here, so T1.7 must still grant the crit's extra action
    // (R:957) off `crit`, not off `terminal`.
    return { ...base, total: null, tier: 3, terminal: "unconscious" };
  }

  // (2) Doom. Tier 1 "regardless of edges, expertises, and other bonuses"
  //     (R:246). Expertise CANNOT rescue it — enforced at the spend gate too.
  if (doom) return { ...base, total: null, tier: 1, terminal: "doom" };

  // (3) Crit. Tier 3 "regardless of banes or other penalties" (R:244).
  if (crit) return { ...base, total: null, tier: 3, terminal: "crit" };

  // (4) Ordinary resolution.
  const total = rawSum + charVal + sum(mods.map(m => m.value)) + eb.numeric;
  const tier  = clamp(classifyTier(total) + eb.tierShift, 1, 3);
  return { ...base, total, tier, terminal: null };
}
```

The expertise spend is a separate gate, and it is **not** simply `if (!doom)`:

```js
// R:292: improve by one tier, max 3; one expertise and one use per test.
function canSpendExpertise(result, key, actor) {
  // C2 — STATE FIRST. Without this a declined card is still spendable: decline
  // sets state "committed"/"declined" but leaves expertiseSpent null, so every
  // other guard passes and the spend lands AFTER downstream effects have
  // already fired off the committed tier. This check must come first.
  if (result.state === "committed")      return "already resolved";
  if (result.terminal === "doom")        return "a doom can't be improved";   // R:246
  if (result.tier >= 3)                  return "already tier 3";             // no-op burn
  if (result.expertiseSpent)             return "one expertise per test";     // R:292
  if (!categoryAllows(result.kind, key)) return "wrong expertise category";   // R:913/R:384
  if ((actor.system.expertises[key]?.value ?? 0) < 1) return "no uses left";
  return null;   // ok
}
```

Note the `tier >= 3` guard: without it a player can burn a limited use on a
result that cannot improve. `terminal === "crit"` and `terminal === "unconscious"`
are both already tier 3, so that one check covers them.

The `state === "committed"` guard subsumes the terminal cases too — a terminal
result commits on creation — but keep the explicit `terminal === "doom"` line
anyway: it is the one the tests assert against, and it names the rule.

Store the whole `TestResult` (shape above) at `message.flags.crows.test` so the
card is re-renderable and the spend is idempotent under lag or double-click.

---

## Part 2 — WAVE 1: Pure helpers (8 agents, fully parallel)

All eight start together once T0.2 is frozen. **None of them touch sheets or templates.** Every one writes unit tests under `test/`.

Wave 1 leaves the system **non-functional in-world** — sheets still reference deleted fields. That's expected. Wave 2 fixes it.

### T1.1 — Edge/bane resolver + roll pipeline ⭐ highest risk

```
TASK T1.1 — Edge/bane resolution and two-phase roll pipeline
OWNS:    module/helpers/edges.mjs (new), module/helpers/roll.mjs,
         module/helpers/expertise.mjs (new), test/edges.test.mjs, test/roll.test.mjs
READS:   .planning/CONTRACT.md, .planning/API-NOTES.md, module/config.mjs,
         module/data/actor/crow.mjs, templates/chat/test-card.hbs (read only —
         T2.2 owns the rewrite)
SOURCE:  R:242-248 (crits/dooms), R:256-288 (edges/banes/bonuses),
         R:290-358 (expertise), R:364-376 (assist), R:378-386 (attacks/castings)

DELIVERABLE:
1. helpers/edges.mjs — resolveEdgesBanes per the contract. Pure, no Foundry.
2. helpers/roll.mjs — rollTest() implementing `resolveTier` from CONTRACT.md
   exactly. It is a chain of EARLY RETURNS, not a numbered list — "terminal"
   has to actually terminate. Two independent modifier channels: edges/banes
   (counted, then resolved) and mods (summed). Per R:286 these NEVER mix — a
   masterwork tool's +2 is not an edge.
3. helpers/expertise.mjs — applyExpertise(message, key) AND
   declineExpertise(message). Must enforce the `canSpendExpertise` gate:
   - actor owner only
   - once per message (idempotent under double-click / lag)
   - `value > 0`; decrement `value` on success. NEVER touch `max` — that is the
     owned pool and only advancement/enforcement may change it.
   - CATEGORY GATE: weapon expertises only on weapon attacks, spellcasting only
     on castings and spell attacks, general on neither (R:913 / R:384)
   - REFUSE on doom. Expertise cannot rescue a doom (R:246). Test this explicitly.
   - REFUSE when tier is already 3, so a limited use can't be burned for nothing.
3b. YOU OWN THE A1 COMMIT LIFECYCLE. Every rule that keys on "a tier N result"
   reads the FINAL, post-expertise tier, so nothing downstream may fire while
   `state === "pending"`. Set state/commitReason per the contract and emit
   `crowsTestCommitted` with the final TestResult on commit — exactly once.
   T1.7 (miss, Counter, Silent armor), T1.8 (chaos roll) and T2.2 (final card
   render) all hang off that hook and cannot work without it.
4. Delete all `boned` handling. Blessed is now an edge source, not a ±1.
5. Export everything through game.crows for probes.
6. Rewrite dev/probes/p05-roll.mjs for the new engine.

ACCEPTANCE:
  - Unit tests covering the FULL edge/bane truth table: (0..3 edges) x (0..3 banes),
    16 cases, each asserting numeric + tierShift. Include 3-edges-plus-1-bane = ONE
    edge, which is the case a naive implementation gets wrong.
  - Tests asserting doom is terminal against: double edge, expertise spend,
    +10 of mods, and all three at once.
  - Tests asserting crit is terminal against a double bane.
  - Test asserting a weapon expertise is REFUSED on a casting.
  - Test asserting a spend is REFUSED when the tier is already 3.
  - COMMIT LIFECYCLE tests:
      * terminal result           -> state "committed", reason "terminal", on the
                                     first render, with no pending window at all
      * no uses / no legal category -> "committed", "no-legal-spend"
      * legal spend available     -> "pending", and NO commit event emitted yet
      * applyExpertise            -> "committed", "spent", event emitted once
      * declineExpertise          -> "committed", "declined", event emitted once
      * double-click on either    -> still exactly ONE commit event
  - ./verify.sh passes; npm test green.
DO NOT: touch sheets/, templates/, or any other helper. If another helper calls
        rollTest with the old signature, leave it broken — its owner fixes it.
```

### T1.2 — Positional slot model

```
TASK T1.2 — Inventory slot rewrite
OWNS:    module/helpers/slots.mjs, module/helpers/corpses.mjs (new),
         test/slots.test.mjs
READS:   .planning/CONTRACT.md, module/config.mjs, module/data/item/*.mjs
SOURCE:  R:426-498 (slots, magic slots, equipped, armor, swapping,
         corpses), R:524 (wounds and speed)

CONTEXT: The current slots.mjs (34 lines) is a capacity SUM with no positional
model. This is a rewrite, not a patch.

DELIVERABLE:
1. Positional layout: hand[2], belt[4], backpack[10], plus six magic slots as a
   SEPARATE axis (R:438). Do not model magic slots as carry containers.
2. Contiguity: a multi-slot item occupies adjacent indices IN ONE container.
   Reject hand+belt spanning; reject backpack 2 and 7 (R:430).
3. Stacking: per CROWS.stackLimits, same KIND only — 5 different potions stack,
   3 potions + 2 locks do not (R:432). Hand slots never stack.
4. Coinage: 250 gc loose per slot.
5. Wounds occupy player-chosen backpack indices (system.woundSlots).
6. Speed penalty — RESOLVED 2026-08-20, implement exactly as specified in the
   contract's `speedPenaltyFromWounds`. Setting `crows.woundSpeedRule` takes
   "wound-and-item" (DEFAULT) and "wound-only". Do not invent a third value.
7. retrieveFromBackpack(layout, itemId, d10): maneuver + 1d10 >= at least one of
   the item's backpack slot numbers (R:478).
7b. CAPACITY: layoutFor() MUST call CROWS effectiveCapacities() with the actor's
   collected trait slotGrants. Do NOT start from CROWS.carryContainers directly.
   CrowData.prepareDerivedData calls the same function with the same grants, and
   if you build capacity a second way the wound derivation and the layout WILL
   disagree the moment a slot-granting trait exists (C:737 is a real one).
   NOTE wounds do not REDUCE capacity — they OCCUPY slots within it.
7c. COIN: build Layout.coin from GearData.purse {isPurse, held, baseCapacity}
   plus loose CrowData.currency. Bursting Purse (C:1737) adds
   CROWS.purseTraitBonus to exactly ONE purse — the greatest baseCapacity, ties
   broken by lowest item id. That allocation is frozen in gear.mjs; implement it,
   do not invent another. Acceptance: a base purse and a trait-boosted purse both
   round-trip coins in and out, and the C:36 starting kit (empty purse + 3d6 gc
   loose) builds.
8. Magic slot overload: >1 magic item in a slot -> flag `magicOverload`, consumed
   by T1.7 (1d6 wounds/DT) and T1.5 (cannot rest). Expose the flag; do not
   implement those effects here.
9. helpers/corpses.mjs: corpse slot cost by size + carried equipment (R:484).

RESOLVED AMBIGUITY (was: "do not resolve unilaterally"):
  R:524 reads "Each wound they take fills up a backpack slot of the PC's choice.
  For each slot occupied by a wound and an item, your speed is reduced by 1."
  Three readings; the decision is reading (c) — count only backpack slots holding
  BOTH a wound and an item:
    (a) every occupied slot   REJECTED — speed is 5 (C:24), backpack is 10
                              (R:428), so a loaded but UNWOUNDED PC is at speed 0.
    (b) every wound           available as `crows.woundSpeedRule: "wound-only"`.
    (c) wound AND item        DEFAULT. The only reading under which "of the PC's
                              choice" bears on the sentence it introduces, and
                              never harsher than (b) — the penalty is a subset
                              of the wounds.
  Consequence for this task: the penalty is a property of the LAYOUT, not of
  `woundSlots.size`. Your `Layout` must let a caller ask, per backpack slot,
  whether it holds a wound and whether it holds items — `Slot.wound` and
  `Slot.items` in the contract already do. Do not collapse wounds to a count.
  Logged in docs/discrepancies/playtest-2-source-issues.md (I2) and carried to
  MCDM as question A2; the setting exists so a reversal is one value change.

ACCEPTANCE:
  - Unit tests: contiguity rejection (cross-container and non-adjacent),
    stack-kind rejection, hand-stack rejection, coinage overflow, wound slots
    reducing capacity, retrieval roll at boundary (d10 exactly equal to the
    lowest slot number = success).
  - Both speed rules tested.
  - ./verify.sh passes; npm test green.
DO NOT: touch sheets/ or templates/. Drag-and-drop UI is T2.1.
```

### T1.3 — World migration

```
TASK T1.3 — Playtest 1 -> Playtest 2 data migration
OWNS:    module/helpers/migration.mjs (new), test/migration.test.mjs,
         dev/probes/p12-migration.mjs (new)
READS:   .planning/CONTRACT.md, module/data/**, test/fixtures/actors/*,
         git show master:module/data/actor/crow.mjs  (the OLD schema — read it
         from git, the working tree already has the new one)
SOURCE:  Master.md R:290–358, PLAYTEST-2-MIGRATION.md section 2.3

CONTEXT: Two distinct migration layers, and conflating them is the classic bug:
  (a) TypeDataModel.migrateData(source) — per-document field transforms, runs on
      load AND ON PARTIAL UPDATE DELTAS. Must never assume sibling fields exist.
  (b) A world migration on `ready` — cross-document work (slot re-layout,
      GM report). Runs once, gated on the world's stored system version.
This task writes the pure functions for both. T2.3 wires (b) into crows.mjs.

DELIVERABLE:
1. SKILL_TO_EXPERTISE map. Collapsing cases take the MAX of the source bonuses:
     climb|jump|swim -> athletics
     hide|sneak      -> stealth
     sabotage|sleightOfHand -> thievery
     handleAnimal    -> handlePet
   All others map 1:1 by name. pickLock survives as its own expertise.
2. bonus -> uses conversion, 1:1, writing BOTH `value` and `max` to the converted
   amount, clamped to the max-uses for that actor's TXP
   band (CROWS.expertiseAdvancement).
2b. THEN THE TOTAL BUDGET — but IN LAYER (b), NOT HERE. Per-expertise clamping
   alone is not enough: a PT1 crow with 12 skills at bonus 2 converts to 24
   uses, while a PT2 bonus grants at most 3 (C:615). But the budget needs the
   background's GRANTS — and the actor stores only `system.background`, a NAME,
   with NO embedded Background Item to sum, so resolving it needs a compendium
   lookup — and `xp.txp` (absent
   from partial deltas), and re-running it per-delta would compound the trim on
   every unrelated edit. So:
     - layer (a) `migrateCrowSystem` converts shape and may leave `max` over
       budget. That is correct and expected.
     - layer (b) `reconcileActorExpertises(actor)` calls expertiseBudgetForTxp()
       then reconcileExpertiseBudget(), once, against the whole actor.
   DEFAULT IS "report-only" — compute the budget, populate `trimmed` so the GM
   can see what enforcing would do, and WRITE NOTHING. Only `"enforce"` applies
   the water-level trim. An over-budget character is a balance problem, not a
   data-integrity one, so it is the GM's call and not the migration's.
   Because the default writes nothing, also implement `expertiseOverBudget()`
   as derived data — the over-budget state is permanent until a GM acts, and a
   one-time journal entry is not enough visibility for a permanent state.
   Call reconcileActorExpertises from BOTH the `ready` world migration and a
   createActor hook, stamped with `flags.crows.expertiseReconciled` so neither
   runs twice — an actor imported after the world pass would otherwise never be
   checked at all.
3. Conditions: drop `boned` — it has no PT2 equivalent, do not silently convert
   it to `weakened` (different duration and semantics). `blessed > 0` -> true.
4. Wounds: `wounds: N` -> N backpack indices, PREFERRING EMPTY SLOTS, lowest
   index first, and only then occupied ones. PT1 filled bottom-up regardless of
   contents; under wound/speed reading (c) a wound on an occupied slot costs 1
   speed, so naive bottom-up would silently slow every migrated character.
   Report any wound forced onto an occupied slot.
   Write indices only — do NOT clamp them to 10. Capacity is derived (M12), and
   an index past the current capacity is orphaned and surfaced, never dropped.
5. Slot re-layout: belt 2->4 is a safe widening. Magic-slot items move from the
   old containers map to the new magic axis by matching equipSlotTypes. Items
   whose placement is now ILLEGAL under contiguity get COLLECTED AND REPORTED,
   never silently relocated.
6. preparedTask.skill -> preparedTask.task as free text, with a note.
7. buildMigrationReport(results) -> JournalEntry data listing everything touched,
   everything flagged, and everything dropped. Nothing disappears silently.

ACCEPTANCE:
  - Tests against the PT1 fixture crow: expertises correct, boned gone, wounds
    placed, belt widened.
  - A test passing a PARTIAL DELTA (e.g. {system:{skills:{climb:{bonus:0}}}})
    asserting no crash and no invented sibling fields.
  - A zero-value test: bonus 0 survives as value=max=0, not dropped as falsy.
  - A collapse test: climb bonus 1 + swim bonus 2 -> athletics value=max=2.
  - BACKGROUND LOOKUP tests (there is no embedded Background Item):
      * resolves by `backgroundId` when present
      * falls back to `background` name, trimmed and case-insensitive
      * stamps `backgroundId` on first successful resolution
      * UNRESOLVED -> reported AND the actor's budget skipped entirely.
        Assert it is NOT treated as backgroundUses = 0. Until T3.1 lands this
        is the only reachable case, so it is the one that must be right.
  - An illegal-placement test asserting the item is reported, not moved.
  - LAYER SEPARATION tests (C1):
      * migrateCrowSystem() on the delta fixture (no xp, no items) does NOT
        attempt a budget and does NOT throw
      * migrateCrowSystem() on the full fixture leaves `max` OVER budget —
        assert 24, i.e. shape-only conversion, no trim
      * reconcileActorExpertises() on the same actor performs the trim
  - BUDGET tests (H5):
      * the pathological case — 12 skills at bonus 2, low TXP — lands inside
        expertiseBudgetForTxp() and reports every trimmed use
      * water-levelling is EXACT and stable: assert the full granted map, not
        just the total, including the alphabetically-first tie-break
      * desired < budget is NOT topped up
      * DEFAULT "report-only" WRITES NOTHING — assert stored value/max are byte-for-
        byte unchanged after reconcile, while `trimmed` is still populated
      * "enforce" is the only mode that mutates
      * per-expertise max still applies after the total trim
      * expertiseOverBudget() returns 0 for a legally-advanced crow and the
        exact surplus for the 24-use fixture
      * reconcile is stamped and does not run twice: calling it again after the
        world pass is a no-op
      * an actor created AFTER the world migration still gets reconciled by the
        createActor path
  - WOUND-INDEX tests (M12):
      * wounds prefer empty backpack slots; a wound forced onto an occupied slot
        is reported
      * an index >= current capacity is preserved and surfaced as orphaned,
        NOT clamped and NOT dropped
  - npm test green; ./verify.sh passes.
DO NOT: register hooks or touch crows.mjs. Pure functions only — T2.3 wires them.
```

### T1.4 — Advancement

```
TASK T1.4 — Advancement tables and trait purchase
OWNS:    module/helpers/advancement.mjs, test/advancement.test.mjs
READS:   .planning/CONTRACT.md, module/config.mjs, module/data/item/trait.mjs
SOURCE:  Master.md C:603–659 (XP, both tables, new PC after death),
         C:661–671 (buying traits, minimum modifier)

CONTEXT: advancement.mjs has 32 `skill` references. Both TXP tables are fully
replaced — do not try to preserve the old numbers.

DELIVERABLE:
1. New Expertise & Stamina table (CROWS.expertiseAdvancement) with the max-uses
   curve 2/2/2/2/2/3/3/4/4 and "every 30,000 after".
2. Each bonus is a THREE-WAY choice (C:613): 3 expertise uses distributed freely
   (including into expertises you don't have) without exceeding max; OR +2 Stamina
   max; OR 1 use + 1 Stamina max. Return the options; do not auto-pick.
3. Characteristic table 5000/15000/30000/+30k, cap 4, and if all three are at 4
   the bonus becomes +2 Stamina instead (C:640).
4. XP accrual: treasure value / player count, excluding purchased, crafted,
   taken-from-innocent, and ally-owned goods (C:605). Unique items carry an
   explicit XP value.
5. Spending is gated to end-of-rest (C:609).
6. Traits: starting traits 500 XP; a trait must connect by line to one you own on
   the same tree; one purchase each (C:667).
7. New PC after death: extra background rolls equal to the dead PC's bonus count;
   optional TXP floor matching the party's lowest (C:653–657).
8. Retirement threshold 60,000 TXP.

ACCEPTANCE:
  - Table boundary tests: 99/100 TXP, 29,999/30,000, and 60,000 and 90,000 for
    the repeat rule.
  - Test that the 3-use distribution refuses to exceed the current max.
  - Test the all-characteristics-at-4 overflow to +2 Stamina.
  - npm test green; ./verify.sh passes.
DO NOT: touch the trait-tree purchase UI (that grid lives in crow-sheet.mjs, T2.1).
        Expose the data it needs; do not render it.
```

### T1.5 — Rest, dungeon turns, encounters

```
TASK T1.5 — Rest, DT, encounters, greed bonus
OWNS:    module/helpers/rest.mjs, module/helpers/dungeon-turn.mjs,
         module/helpers/greed.mjs (new), test/rest.test.mjs
READS:   .planning/CONTRACT.md, module/helpers/usage-die.mjs, module/helpers/miasma.mjs
SOURCE:  Master.md R:586–624 (end of DT, greed, encounters), R:626–680 (resting,
         rest encounters, all rest activities, town activities)

DELIVERABLE:
1. Rest restores ALL Stamina, ALL expertise uses, and removes 1 wound OF THE
   PLAYER'S CHOICE. Concretely, for every expertise: `value = max`. Do NOT write
   `max` — that is the owned pool. Expertise refresh is BLOCKED when resting in
   the Miasma (R:1375): leave `value` exactly as it is and apply every OTHER
   effect of the rest normally. That suppression is only expressible because
   value and max are separate; do not "optimise" it back into one number.
1b. ALSO reset every trait use pool on the same rest: for each trait item with
   `system.usePool`, set `usePool.used = 0`. FOUR published traits depend on
   this and nothing else resets them — C:921, C:1361, C:1501 (Mind-sized) and
   C:1739 (Agility-sized), all "regaining all uses when you finish a rest".
   A trait pool is NOT suppressed by the Miasma; R:1375 names expertises only.
   You own the reset. T2.1 owns displaying remaining/overused on the sheet, and
   the derivation itself (max = max(0, characteristic), overused = used - max)
   is specified in CONTRACT.md §5 — implement it where you read it, and do not
   clamp `used` downward when a characteristic drops.
2. Halfway-point rule: end-of-DT effects end and end-of-DT UD roll at the rest's
   midpoint (R:630).
3. Rest activities — revised and new:
   - Prepare for Task: now +2 (was +1), binds to a task string not a skill,
     lasts until the next completed rest.
   - Tend Wounds: target needs >=2 wounds, CANNOT be self, removes 2, once/rest.
   - Harvest: generic monster parts, 1d6/2d6/3d6/4d6 by corpse size (R:652).
   - Repair Armor (NEW): restore one armor/shield to full AD.
   - Seclude Camp (NEW): EN -1 for this rest; one person per group; does NOT
     require finishing the rest.
   - Craft Equipment, Identify Item: carry forward.
4. Town rest activities (R:678): up to 4/day without sleeping, ~2h each, benefits
   land after the 2 hours rather than at end of rest. Tend Wounds is the exception
   — still needs 4h sleep, once/day.
5. Rest is blocked entirely if the actor has the magicOverload flag from T1.2 (R:460).
6. Encounter check: 1d10 >= EN. EN 9 default, 8 if crowded (>20 creatures) OR
   chaos left behind, 7 if BOTH. A rolled 10 fires immediately; a triggering 9 or
   lower telegraphs a sign now and fires during the next DT (R:622–624).
7. helpers/greed.mjs: +30%/+20%/+10% on treasure found in DTs 1-3 of a first
   entry, once per dungeon per PLAYER GROUP — persists across characters, so key
   a world flag by dungeon id, not by actor (R:600).
8. Delete blessed/boned reset; replace with end-of-DT expiry for blessed,
   vulnerable, and weakened.
9. Configurable DT length: 30 default / 60 / 20 / 1d6-rooms (R:616).

ACCEPTANCE:
  - Test: Miasma rest does NOT refresh expertise uses.
  - Test: Tend Wounds refuses self-targeting and refuses a 1-wound target.
  - Test: EN escalation 9 -> 8 -> 7 across all four crowded/chaos combinations.
  - Test: greed bonus applies once then never again for the same dungeon id.
  - Test: harvest dice by each of the six sizes.
  - npm test green; ./verify.sh passes.
DO NOT: touch damage.mjs or conditions (T1.7 owns those).
```

### T1.6 — Village, crafting, institutions

```
TASK T1.6 — Village, institutions, crafting, hirelings
OWNS:    module/helpers/village.mjs, module/helpers/crafting.mjs,
         module/helpers/hirelings.mjs (new), test/village.test.mjs
READS:   .planning/CONTRACT.md, module/helpers/crypt.mjs
SOURCE:  Master.md C:2535–2689 (village, prosperity, trade, village crafting),
         C:2690–3137 (all 13 institutions), C:3138–3179 (home, retirement, other
         villages), C:2499–2534 (hirelings), R:1665–1736 (crafting, IDing items)
         Institution line starts: Alchemist 4458, Auction House 4497, Barracks 4511,
         Beacon 4558, Blacksmith 4591, Bookseller 4635, Crypt 4665, Enchanter 4716,
         General Store 4744, Inn 4779, Stables 4799, Temple 4850

DELIVERABLE:
1. DELETE the availability-roll code. Item availability is now purely a function
   of merchant institution level (changelog). Institution level counts changed —
   re-derive every one from C:2690–3137, do not assume PT1 values.
2. New institutions: Barracks (C:2759), Beacon (C:2806).
3. Temple no longer sells crafting materials but CAN craft for you (C:3098).
4. Auction house no longer sells monster parts (C:2745).
5. Prosperity can be raised by spending 10,000 gc on village items.
6. Crafting on generic monster PARTS, not specific organs.
7. helpers/hirelings.mjs: employment terms, control, death-of-PC handling
   (C:2499–2534).
8. Not Your Village / Founding Other Villages / Other Villages (C:2541, C:3158, C:3164).

ACCEPTANCE:
  - Zero references to availability rolls remain.
  - A table test asserting every institution's level count matches the doc, with
    the source line cited in a comment per institution.
  - npm test green; ./verify.sh passes.
DO NOT: touch crypt.mjs (crypt boons are PT1 work that survives — verify only,
        and report to the orchestrator if C:2913 has changed it).
```

### T1.7 — Damage, conditions, combat resolution

```
TASK T1.7 — Damage, conditions, combat
OWNS:    module/helpers/damage.mjs, module/helpers/combat.mjs (new),
         module/helpers/attack.mjs, test/damage.test.mjs
READS:   .planning/CONTRACT.md, module/helpers/edges.mjs (T1.1 — coordinate on
         the Label shape via CONTRACT.md, do not edit it), module/data/actor/*
SOURCE:  Master.md R:504–524 (AD, piercing, stamina, wounds), R:526–558 (conditions),
         R:909–990 (attacks, melee, ranged, crits, multi-target, flanking, high
         ground, reactions, counter), R:755–782 (cover, concealment)

DELIVERABLE:
1. Conditions rewritten (see CONTRACT.md): boned deleted; blessed now grants an
   edge AND bonus damage equal to the attack's characteristic; vulnerable adds
   1d6 per damage instance; weakened is a bane on all tests. All three expire at
   end of DT. Conditions are strictly boolean now — you cannot gain a second
   instance (R:528).
2. Status-effect sync for all six conditions. You own the LOGIC; T2.3 owns
   `module/conditions.mjs` and the hook registration. Export what you need from
   your own files and let T2.3 wire it — do not edit conditions.mjs or crows.mjs.
   NOT a naive bidirectional sync —
   that loops, or leaves two sources disagreeing. Freeze the COMMAND FLOW
   (CONTRACT.md §5b):
     a. intercept the Token HUD toggle and translate it into an update to
        `system.conditions.<key>` — the toggle is INTENT, it does not write state
     b. the boolean is canonical; every rule reads it
     c. an idempotent, LOOP-GUARDED mirror adds/removes the status effect to
        match. Mirror only when presence disagrees with the boolean; no-op when
        they already agree, or (c) re-triggers (a).
   `dead` maps to `conditions.defeated` — the one id where the vocabularies differ.
   Condition mechanics are NEVER Active Effect `changes`; the roll engine reads
   the booleans. Effects are for durational backlash (R:1561) and magic items,
   and there v14 takes a STRING `type: "add"` — ACTIVE_EFFECT_CHANGE_TYPES holds
   PRIORITIES, not modes. See .planning/API-NOTES.md §1; verify.sh guards both.
3. Damage: AD -> Stamina -> wounds. Piercing bypasses AD. Multi-AD priority
   dialog survives from PT1. Vulnerable adds 1d6 BEFORE AD is applied.
4. Wounds land in a player-chosen backpack slot — call into T1.2's layout API.
5. helpers/combat.mjs:
   - Counter reaction (R:983): triggered by an adjacent attacker's T1 on a melee
     attack / Grab / Knockback / Escape Grab. Deals the counterer's weapon tier 2;
     on the trigger's DOOM, tier 3 instead. NOT triggered by a T1 opportunity attack.
   - Crit on an attack grants an extra action (R:957).
   - Ranged miss with allies adjacent (R:943): roll any die, on ODD hit a random
     adjacent ally for tier 2. On a DOOM, hit an ally for tier 3 automatically (R:945).
   - Ranged beyond normal range: -2 per square. This is a PENALTY, not a bane (R:941).
   - Ranged at an adjacent target: a BANE (R:947).
   - Flanking (R:965) and high ground (R:973): edge sources. Emit Labels for T1.1.
   - Multi-target (R:961): ONE roll, but per-target edges/banes can resolve to
     DIFFERENT TIERS per target. The result shape must be per-target.
6. Cover and concealment (R:755–782) as edge/bane sources.

ACCEPTANCE:
  - Test: vulnerable adds 1d6 and it is absorbed by AD (not piercing-like).
  - Test: counter deals tier 2 normally and tier 3 on the trigger's doom.
  - Test: counter does NOT fire off a T1 opportunity attack.
  - Test: multi-target with an edge on target A and a bane on target B resolves
    to different tiers from a single roll.
  - Test: ranged range penalty is in `mods`, and adjacent-ranged is in `banes` —
    asserting they land in different channels.
  - npm test green; ./verify.sh passes.
DO NOT: touch roll.mjs or edges.mjs. Consume them; do not edit them.
```

### T1.8 — Spellcasting, chaos, backlash

```
TASK T1.8 — Spellcasting pipeline and backlash
OWNS:    module/helpers/spellcasting.mjs, module/helpers/backlash.mjs,
         module/helpers/chaos.mjs, module/data/item/spellbook.mjs,
         test/spellcasting.test.mjs
READS:   .planning/CONTRACT.md, module/helpers/roll.mjs (T1.1 — consume, do not edit)
SOURCE:  R:1445-1549 (spellbooks: rank, discipline, casting time, target,
         range, AoE, duration, UD), R:1551-1567 (summons, backlash triggers,
         chaos roll), R:1573-1659 (the 105-row backlash table)

CONTEXT — THE BIG CHANGE: Playtest 1 modelled backlash risk as a GM-secret
WORLD-LEVEL CHAOS COUNT that accumulated across casts and fired at a threshold.
chaos.mjs (102 lines) implements that. PLAYTEST 2 DELETES THE ACCUMULATOR — but
NOT every trace of chaos. Read deliverable 1b before you delete anything.

DELIVERABLE:
1. GUT the accumulator in chaos.mjs. Backlash now triggers on exactly two
   independent events (R:1563):
     a. doom on a casting  — goes STRAIGHT to backlash, no chaos roll
     b. chaos roll: on a TIER 1 THAT IS NOT A DOOM, roll 1d6; a 1 = backlash
   No threshold, no world flag. Report to T1.3's owner that any stored count is
   dead data to drop with a note in the migration report.
1b. DO NOT conclude the mechanic is gone. All six Discipline Mastery traits
   still read "...don't add to the chaos count" (Alteration C:765, Benefaction
   C:917, Conjuration C:1117, Elemental C:1173, Illusion C:1275, Necromancy
   C:1507). The term appears NOWHERE in the Rules Book — it is stale Playtest 1
   phrasing, and the intended reading is:
       rank 0-1 spells of your discipline DON'T TRIGGER A CHAOS ROLL.
   So expose a per-discipline, per-rank suppression hook on the chaos roll.
   The traits' second clause (rank 2+ treated as 2 ranks lower on the backlash
   table) needs no reinterpretation — R:1559 is unchanged. See
   docs/discrepancies/playtest-2-source-issues.md H1 and MCDM question A3.
1c. TIMING — the chaos roll fires on the COMMITTED tier, never the phase-1 tier.
   T1.1 owns the commit lifecycle and emits `crowsTestCommitted`; subscribe to
   that. A caster who rolls a tier 1 and then spends a spellcasting expertise to
   reach tier 2 gets NO chaos roll, because a miss is defined as a tier 1
   *result* (R:921) and expertise improves "the test's result" (R:292). Do not
   read the tier before commit.
2. Spellbook UD roll on EVERY cast (R:1543). A CRIT SKIPS THE UD ROLL (R:1545).
3. Backlash resolution: d100 + spell rank on the table. Resolves INSTEAD of the
   spell, but STILL COSTS THE UD ROLL (R:1559). Duplicate durational backlashes
   re-roll unless they stack. Backlash UD roll at end of DT.
4. If a backlash needs a creature target but the spell targeted an object, the
   CASTER becomes the target (R:1561).
5. Spellbook schema: rank 0-5, discipline, castingTime (action/maneuver/reaction/
   outOfCombat), target, range, areaOfEffect (aura/cube/line), duration
   (instant/DT/UD), ud.
6. Casting is ALWAYS a Mind test; only the matching spellcasting expertise applies.
7. Summoned creatures behave as pets but need no command test (R:1553).

BACKLASH TABLE ERRATA — transcribe verbatim, then log to
docs/discrepancies/crows-rules.md, do NOT silently correct:
  - Row "62-64" overlaps row "61-62". Likely meant 63-64.
  - Row 51-52 calls for a "Might RR". No such characteristic exists in this game
    (Agility/Mind/Strength). Probably Strength.

ACCEPTANCE:
  - Test: doom on a casting triggers backlash AND still rolls UD, WITHOUT a
    chaos roll — the two backlash routes are independent (R:1563).
  - Test: committed tier 1 non-doom rolls 1d6; only a 1 triggers.
  - Test: tier 2 and tier 3 never trigger a chaos roll.
  - Test: a tier 1 raised to tier 2 by an expertise spend triggers NO chaos roll
    — i.e. you subscribed to the commit event and not the phase-1 result.
  - Test: no chaos roll fires while the test is still `pending`.
  - Test: Mastery suppression — a rank 0 and a rank 1 spell of the matching
    discipline skip the chaos roll; rank 2 does not; a non-matching discipline
    at rank 0 does not.
  - Test: crit skips the UD roll.
  - Test: all 105 table rows parse, and d100+rank clamps correctly at the top.
  - Zero references to a chaos counter/threshold remain (the SUPPRESSION HOOK is
    not a counter — it stays).
  - npm test green; ./verify.sh passes.
DO NOT: touch roll.mjs or edges.mjs. Consume them.
```

---

## Part 3 — WAVE 2: Integration (3 agents, mostly sequential)

Wave 2 makes the system functional again. T2.1 is the bottleneck — it owns the two contended files.

| Task | Owns | Parallel with |
| --- | --- | --- |
| T2.1 | `module/sheets/crow-sheet.mjs`, `templates/actor/crow/sheet.hbs` | T2.2, T2.3 |
| T2.2 | `templates/chat/*.hbs`, `css/crows.css`, `module/sheets/monster-sheet.mjs`, `templates/actor/monster.hbs` | T2.1, T2.3 |
| T2.3 | `module/crows.mjs`, `module/helpers/character-creator.mjs`, `module/helpers/creation.mjs` | T2.1, T2.2 |

### T2.1 — Crow sheet

```
TASK T2.1 — Crow sheet rewrite for Playtest 2
OWNS:    module/sheets/crow-sheet.mjs (921 lines), templates/actor/crow/sheet.hbs (469)
READS:   everything in module/helpers/ and module/data/ (all frozen by now),
         .planning/CONTRACT.md
SOURCE:  Master.md R:426–498 (slots), R:290–358 (expertises), C:603–671 (advancement)

CONTEXT: 57 `skill` refs in the .mjs and 37 in the .hbs. This is the largest
single integration job. ApplicationV2 + HandlebarsApplicationMixin throughout —
verify.sh blocks `new Application(`.

DELIVERABLE:
1. Expertise panel replacing the skills panel: three category groups, uses/max
   per expertise, spend affordance. Uses are a POOL, not a bonus — the UI must
   read as a resource, because that is the single biggest player-facing change.
2. Inventory grid rebuilt on T1.2's positional model: hand[2], belt[4] (was 2),
   backpack[10], plus a separate six-slot magic panel. Drag-and-drop must respect
   contiguity and stacking, and must REFUSE illegal drops with a reason, not
   silently reject.
3. Wound overlay: player picks which backpack slot a wound occupies.
4. Conditions row: blessed / grabbed / prone / vulnerable / unconscious / weakened.
   Booleans now, not levels. Remove boned.
5. Advancement tab on T1.4's new tables, incl. the three-way bonus choice dialog.
6. Trait tree purchase grid — carry forward from PT1, re-point at the new XP data.
7. NPC connection field.
8. Every user-visible string via lang keys. No hardcoded English.

ACCEPTANCE:
  - ./verify.sh passes; zero `skill`/`boned` refs remain in both files.
  - Live: open a migrated PT1 crow and a fresh crow, no console errors.
  - Live: drag a 2-slot item across hand+belt -> refused with a visible reason.
  - Live: spend an expertise use from the sheet, confirm decrement and rest refresh.
  - dev/probes/p09-crow.mjs updated and passing.
DO NOT: touch chat templates or css (T2.2), or crows.mjs (T2.3).
```

### T2.2 — Chat cards, monster sheet, styles

```
TASK T2.2 — Interactive test card, monster sheet, styles
OWNS:    templates/chat/*.hbs, module/sheets/monster-sheet.mjs,
         templates/actor/monster.hbs, css/crows.css
READS:   module/helpers/roll.mjs, expertise.mjs, combat.mjs, .planning/API-NOTES.md
SOURCE:  Master.md R:242–248, R:256–292, F:688–732 (creature stats)

DELIVERABLE:
1. Rewrite templates/chat/test-card.hbs (currently 19 lines) as the INTERACTIVE
   card. It must show: raw 2d10, characteristic, each labelled bonus/penalty, the
   edge/bane resolution with its explanation, the resulting tier, and doom/crit.
   Then, for the owner only, per-eligible-expertise spend buttons.
   - Wire clicks via the hook named in .planning/API-NOTES.md (verify.sh blocks
     the pre-v14 `renderChatMessage`).
   - Re-render from message flags after a spend — do not create a second message.
   - Buttons need type="button" or the surrounding form may submit.
   - Escape actor and item names; the card builds HTML from user-controlled data.
2. Multi-target cards: one roll, a per-target tier row (T1.7 supplies the shape).
3. Monster sheet: add power (unbounded, see contract), reactions, X/Rest features
   with use tracking, size, type, and expertises. Monsters have no slots; humans
   and animals do (F:698) — the sheet switches on `slots > 0`, and renders the
   slot grid with that many backpack slots when it is.
4. CSS for the expertise panel, the 4-slot belt, the magic-slot panel, the six
   conditions, and the interactive card.

ACCEPTANCE:
  - Live: roll a test, spend an expertise from the card, see the tier update in
    place. Click twice rapidly -> only one use consumed.
  - Live: a non-owner sees no spend buttons.
  - Live: a doom card offers no spend button at all.
  - dev/probes/p08-monster.mjs updated and passing.
DO NOT: touch crow-sheet.mjs or its template (T2.1).
```

### T2.3 — Entry point, hooks, character creator

```
TASK T2.3 — Registration, migration wiring, character creator
OWNS:    module/crows.mjs, module/helpers/character-creator.mjs,
         module/helpers/creation.mjs, module/conditions.mjs
         (module/conditions.mjs is HANDED OFF from T0.2 after the contract
          freeze — it is the status-effect REGISTRATION and belongs with the
          entry point. Wave 0 is complete before Wave 1 starts, so this is a
          sequential handoff, not concurrent ownership. T1.7 supplies the
          condition MECHANICS and the mirror logic and must not edit this file.)
READS:   all helpers and data models, .planning/CONTRACT.md
SOURCE:  Master.md C:14–42 (crow creation), C:89–602 (all 36 backgrounds)

DELIVERABLE:
1. crows.mjs: register data models INDIVIDUALLY (CONFIG.Actor.dataModels.crow = ...),
   never by replacing the whole object. Register the new helpers on game.crows so
   probes can reach them.
2. Wire T1.3's world migration on `ready`, gated on the world's stored system
   version being < 0.2.0. Post the migration report journal. Make it idempotent —
   a second run must be a no-op.
3. Register the six status effects; remove boned.
4. Character creator rebuilt for PT2:
   - 2d6 background roll or pick from 36 (unchanged mechanic).
   - Background sets ONE characteristic to 2 (C:28) — this is a SET, not a +1.
     Remaining two: player picks {1, 0} or {-1, 2}, assigned freely.
   - Background grants expertise USES (1 or 2 each), not skill bonuses.
   - Universal kit: empty coin purse, knife, rope, 6 rations, and 3d6 gc (C:36).
   - New step: NPC connection (C:40).
   - Starting speed 5.

ACCEPTANCE:
  - Live: create a crow end to end, verify characteristics land as 2/{1,0} or
    2/{-1,2}, expertise uses populate, 3d6 gc rolls, kit items appear.
  - Live: open a PT1 world, confirm migration runs once, report journal appears,
    reload confirms it does not run again.
  - dev/probes/p11-creation.mjs and p02-config.mjs updated and passing.
DO NOT: touch sheets or templates.
```

---

## Part 4 — WAVE 3: Content (highly parallel)

Wave 3 can start as soon as **T0.2 is frozen** — content agents write YAML against the schema, not against code. Run it concurrently with Waves 1–2.

**Partition by pack directory.** Each agent owns `src/packs/<pack>/**` plus its own `docs/discrepancies/<pack>.md`. Zero overlap, zero merge risk.

**Universal preamble for every Wave 3 brief:**

```
Every source YAML MUST have both `_id` (16-char) and `_key`, or fvtt-cli SILENTLY
skips it with no error (node_modules/@foundryvtt/foundryvtt-cli/lib/package.mjs:322).
Key format: !items!<id> for Items, !actors!<id> for Actors, !journal!<id> for
JournalEntry, !journal.pages!<parentId>.<pageId> for pages.
PRESERVE EXISTING _id VALUES on documents that already exist — changing an id
breaks every reference to it in the compendium and in existing worlds.
Build with: npm run pack:<name>
Log every source-vs-YAML divergence to docs/discrepancies/<pack>.md using the
existing HIGH/MED/LOW/INFO severity format.

CITING CARD DATA (added 2026-08-25, T3.0): the four books contain NO per-item
stat blocks. Spell tier bands, costs, stack sizes and crafting recipes live only
on the inventory cards. Cite those with the I-prefixes against the pinned text in
docs/source/ — IC: is the main deck. Read docs/source/README.md first: the cards
are a GRID, so one line spans several unrelated cards and a value must be read
down its column, never across the row. Reading across a row is what produced all
8 HIGH findings in the Playtest 1 pass.
Do NOT cite R:/C:/F:/D: for a card value — those books do not contain it, and a
passing mention of an item name is not its stat block.

SOURCE FIDELITY (added 2026-08-25, measured across all 276 traits): the BOOK
markdown silently corrects MCDM's typos — ~33 times in 276 documents, and zero
fabrications. Use it for structure and for what a rule MEANS. Take anything you
ship as quoted prose or as a NAME from the PDF via `pdftotext -layout`.
The CARD text (IC:/IP:/IL:/IA:/IS:) is pdftotext output and IS faithful — quote
it freely. Same directory, different trust level. Full rule and per-ticket
guidance: see "Source fidelity" below.
```

**Before anything else in Wave 3:** `docs/discrepancies/SUMMARY.md` records **8 unresolved HIGH-severity findings** from the Playtest 1 pass — `bone-capture` and `minor-curse` have literally swapped tier effects, `minor-healing` is wrong on all three tiers, Rage Potion is priced 5× off. **T3.0 confirms these were fixed before anyone re-validates against Playtest 2**, or they get baked into v0.2.0.

| Task | Pack | Docs | Notes |
| --- | --- | --- | --- |
| T3.0 | — | — | Audit the 8 open HIGH findings from `docs/discrepancies/SUMMARY.md`. Fix or confirm fixed. **Blocks T3.6 and T3.7.** |
| T3.1 | `crows-backgrounds` | 36 | **Every one changed.** C:89–602, per-background line starts listed below. `skills` → `expertises` as `{key, uses}` (bare name = 1 use, "(2 uses)" = 2); `characteristicOptionsAt2` as an ARRAY (fixed → 1 entry, "X or Y" → 2, "any" → all 3); starting equipment per the changelog (many swaps: bear traps, smoke bombs, gluepots, nets, ball bearings). |
| T3.2 | `crows-traits` | 276 | 23 trees, C:707–1878. Leverage confirmed changed (Stacks on Stacks replaces Groundroll). Split across 3–4 agents by tree: **A** Alchemy→Blacksmithing (2459–2778), **B** Camping→Enchantment (2779–3016), **C** Illusion→Pets (3017–3358), **D** Reputation→Unarmed (3359–3630). Note the source's own typo: tree heading reads "Blackmsithing" at C:957. |
| T3.3 | `crows-weapons` + `crows-armor` + `crows-ammunition` | 25 | C:1997–2404. Armor types/upgrades/enchantments C:2001–2189; weapon types/qualities/upgrades/enchantments C:2194–2404. |
| T3.4 | `crows-gear` + `crows-consumables` + `crows-loot` | 63 | C:1883–1996 (cards, fine/masterwork, gear, money), C:2405–2428 (crafting materials, treasure). Monster parts are now generic. |
| T3.5 | `crows-monsters` | 11 → more | F:688–2123. Add `power`, `reactions`, `slots` (a **count** — 0 for monsters, the printed `**Slots:**N` for humans/animals), `size`, `creatureType` (NOT `type`), `expertises` as `{key, value, max}` with value = max = the printed uses (bare name = 1, "(2 uses)" = 2), and `xRest` to every stat block. A human or animal MUST have `slots > 0` (F:698) — a 0 there is an incomplete transcription, and `suspectMissingSlots` flags it. Expand: Animals/Potential Pets (5657–6131), Humans (6132–6553), Blood Creatures (6630), Ring Collector (6717), Undead (6760). |
| T3.6 | `crows-spellbooks` | 25 | R:1445–1664. **Depends on T3.0** — this pack holds 5 of the 8 open HIGH findings. |
| T3.7 | `crows-rules` | 1 journal, ~16 pages | Full rewrite: expertises, edges/banes, six conditions, new advancement tables, greed bonus, encounter EN, rest activities, sizes, corpse slots. **Depends on T3.0** and on T0.2 for terminology. |

**New content (T3.8–T3.11)** — new packs, so fully independent:

| Task | Deliverable | Source |
| --- | --- | --- |
| T3.8 | `crows-adventures` (JournalEntry): Blood Library, 8 rooms | D:193–576 |
| T3.9 | `crows-adventures`: Floating Manor, 15 rooms | D:577–1168 |
| T3.10 | `crows-adventures`: POI Ruined Tower, POI Ruined Windmill, village of Gadwick, dungeon hooks, awarding treasures | D:12–192 |
| T3.11 | `crows-tables` (RollTable): travel encounters — Any Monster, Bad Weather, Merchant, Miasma-Touched, Monster from Nearby, Strong Miasma, Traveler, Wild Animal, Interesting Things | F:10–687 |

T3.8 and T3.9 both target `crows-adventures`. Give them separate subdirectories under `src/packs/crows-adventures/` and have one agent add the pack to `system.json` — or simpler, give each its own pack and merge later.

---

## ⚠️ EVERY CITATION IN THE TABLES ABOVE IS STALE — re-derived 2026-08-25

The books were rebuilt that morning (Rules 1,736→1,388, Characters 3,179→2,678, Ref
2,122→1,727, Dungeons 1,167→832). **The numbers in the Wave 3 tables above predate that and
point into the wrong chapters.** `T3.9`'s `D:577–1168` runs past the end of a file that is
now 832 lines.

The books are now pinned in [`docs/source/`](../docs/source/README.md), so these numbers are
tied to a commit and `docs/source/sync-books.sh --check` detects drift. **Cite the pinned
copies.** Everything below was derived by content — never by offset, because the drift is
not constant.

| Ticket | Was | **Now** | Verified |
|---|---|---|---|
| T3.1 backgrounds | `C:89–602` | **`C:81–374`** | 36 headings, 8 lines apart |
| T3.2 traits | `C:707–1878` | **`C:428–1692`** | 23 trees |
| T3.3 weapons/armor/ammo | `C:1997–2404` | **`C:1797–2102`** | Armor 1797, Armor Ench. 1888, Weapons 1944, Weapon Ench. 2045 |
| T3.4 gear/consumables/loot | `C:1883–1996`, `C:2405–2428` | **`C:1697–1796`** + **`C:2103–2125`** | Inventory Cards 1697, Gear 1722; Crafting Materials 2103, Treasure 2122 |
| T3.5 monsters | `F:688–2123` | **`F:653–1727`** | Creature Stats 653, Animals 685, Humans 1047, Monsters 1401 |
| T3.6 spellbooks | `R:1445–1664` | **`R:1174–1330`** + the cards | see the warning below |
| T3.7 rules journal | — | **`R:12–1388`** | 26 H1 chapters |
| T3.8 Blood Library | `D:193–576` | **`D:141–405`** | **8 numbered rooms** — matches the plan |
| T3.9 Floating Manor | `D:577–1168` | **`D:406–833`** | **15 numbered rooms** — matches the plan |
| T3.10 POIs/Gadwick/hooks | `D:12–192` | **`D:10–140`** | Gadwick 10, Hooks 38, Ruined Tower 49, Ruined Windmill 78 |
| T3.11 travel tables | `F:10–687` | **`F:6–652`** | all nine tables present |

### T3.6 — the spellbook citation was wrong in kind, not just in number

`R:1174–1330` is the spellcasting **system** — rank, discipline, the chaos roll. It contains
**no per-spell stat blocks**. Every spell's tier bands, range, target and cost live only on
the inventory cards. Cite `IC:` for those; T3.0 established the prefixes. The old
`R:1445–1664` pointed at a chapter that never held what T3.6 needs.

### T3.10 — "awarding treasures" is a callout, not a section

It is a `> [!tip] Awarding Treasures` block at **`D:28`**, inside Village: Gadwick. Do not go
looking for a chapter.

### T3.11 — the nine travel tables

Any Monster `F:27`, Bad Weather `F:45`, Merchant `F:118`, Miasma-Touched `F:179`, Monster
from Nearby `F:246`, Strong Miasma `F:254`, Traveler `F:264`, Wild Animal `F:334`,
Interesting Things `F:504`. The section ends at Creature Stats (`F:653`), which is T3.5's.

### T3.2 — "Blackmsithing" is CANONICAL. Checked 2026-08-25.

**Verdict: preserve it.** The Characters Book PDF, page 13, prints the tree heading as
**`Blackmsithing`** over "For creating armor and weapons". It occurs exactly once in the
whole PDF against 28 correct `Blacksmithing`, which is the signature of a real one-off
authoring typo rather than an extraction fault.

### ⚠️ AND THE MARKDOWN SILENTLY CORRECTS SOME TYPOS — this is the bigger finding

The pinned markdown reads `## Blacksmithing` at `C:792`. **The extraction fixed MCDM's typo
without saying so**, and it does this inconsistently:

| Typo | In the PDF | In the markdown | |
|---|---:|---:|---|
| `Blackmsithing` | 1 | **0** | silently corrected |
| `vulenarble` | 1 | **0** | silently corrected |
| `wile` (Seeing Things) | 1 | **0** | silently corrected |
| `Sieze` | 2 | 3 | preserved |
| `Stabathon` | 1 | 2 | preserved |

**Three of five canonical typos are gone from the markdown.** So the rebuilt extraction is
structurally better — no column bleed, regular records — but **less faithful for verbatim
prose** than the version it replaced.

**Consequences for T3.2, which owns 276 trait documents and is where the
preserve-canonical-typos policy actually bites:**

- Use the markdown for **structure and navigation** — headings, ordering, which trait sits
  in which tree and tier.
- Use `pdftotext -layout` on the PDF as the authority for **verbatim prose and names**.
  Anything that looks like a typo must be checked there before it is normalised *or*
  preserved, because the markdown will have quietly picked one.
- A trait *name* is the highest-risk case: a silently corrected name ships the wrong string
  and breaks name-based lookup, which is how this system resolves items.

This also retroactively validates `bashing-t3-c3` (Bone Breaker), transcribed with
`vulenarble` intact on 2026-08-25 **because it was checked against the PDF**. Had it been
taken from the current markdown it would have shipped `vulnerable` and lost the canonical
text.

Same method that rejected `_repair take_ , _shape_` as an extraction artifact: when the
markdown and the PDF disagree, the PDF wins.

### Pets moved chapters

Equipment-side Pets is now **`C:2126–2176`**, not `C:2429`. Vehicles `C:2177`, Hirelings
`C:2195`.

---

## Source fidelity — WHICH pinned source to trust for WHAT

Measured across all 276 traits by the four T3.2 agents, 2026-08-25. This is not a guess.

| Group | Traits | Markdown silently CORRECTED MCDM | Markdown INTRODUCED an error |
|---|---:|---:|---:|
| A Alchemy–Blacksmithing | 84 | 11 | **0** |
| B Camping–Enchantment | 60 | 3 clear + 1 likely | **0** |
| C Illusion–Pets | 60 | 6 | **0** |
| D Reputation–Unarmed | 72 | 12 | **0** |
| **Total** | **276** | **~33** | **0** |

### The rule

**The book markdown never fabricates, but it silently repairs.** Roughly one document in
eight. So:

| What you need | Source | Why |
|---|---|---|
| Structure — tree/tier/column, ordering, which section a thing is in | **`R:`/`C:`/`F:`/`D:` markdown** | Never fabricates, and the rebuild made structure *better* |
| What a rule **means** | **markdown** | Meaning is reliable; it corrects toward the intended sense |
| Anything shipped as **quoted prose or a name** | **the PDF**, via `pdftotext -layout` | The markdown will have quietly repaired it |

### The two pinned sources in `docs/source/` do NOT have the same fidelity

This is the part that catches people, because they sit in one directory:

- **`R-`/`C-`/`F-`/`D-*.md`** are **OCR/build pipeline** output. They correct MCDM. Trust for
  structure and meaning, **not** for verbatim text.
- **`IC-`/`IP-`/`IL-`/`IA-`/`IS-*.txt`** are **`pdftotext -layout`** output — a direct text
  extraction with no repair pass. **Faithful.** Card text can be quoted verbatim.

### The corrections are not all cosmetic

Assuming "typo repair" would be a mistake. Confirmed cases change grammatical number and
phrasing, which changes how a Ref reads the rule:

- `attack` → `attacks against` (Pets, Dungeon Critter)
- `against target in darkness` → `against targets` (Chopping, Hurl in the Dark)
- `one the same turn` → `on the same turn` (Unrelenting Death)
- `Blackmsithing` → `Blacksmithing`, `vulenarble` → `vulnerable`, `wile` → `while`

Six canonical typos are now pinned by `test/trait-corpus.test.mjs`, so re-transcribing any
of them from the markdown fails the suite rather than silently diverging.

**Lexical vs encoding are different axes.** The PDF governs *words* — typos, singular/plural,
missing articles. The repo's ASCII apostrophe convention governs *encoding*, because
name-based lookup depends on it. Following the PDF's curly quote to "preserve" it would break
lookups while preserving nothing that matters.

**Not every delta is a finding.** `non-weapon` vs `nonweapon` is hyphenation, not a
correction. Log it INFO and move on.

### ⚠️ Anything transcribed BEFORE 2026-08-25 07:44 has the opposite problem

The **previous** extraction generation *introduced* errors rather than correcting them —
column bleed across card grids, and mangled multi-word italics (`_repair take_ , _shape_`
where the book prints `*repair*, *take shape*`). Different generation, opposite failure mode.
Content transcribed from a pre-rebuild file should be re-derived, not spot-checked.

### Per-ticket

- **T3.3** — weapons/armor/ammunition are mostly structured numbers, so the markdown is fine
  for stats and costs. **Item names and weapon/armor quality names ship as text**: take those
  from the PDF.
- **T3.6** — the least exposed ticket. Per-spell stat blocks live only on the **cards**, and
  the card text is `pdftotext` output, so it is already faithful. Quote `IC:` freely. Only
  `R:1174–1330` (the spellcasting system) is markdown.
- **T3.7** — **the most exposed ticket in Wave 3.** The rules journal ships the book's prose
  verbatim to players. Take every quoted line from the PDF. Using the markdown here would
  ship a rules reference that disagrees with the book players are reading at the table, in
  ways they cannot see.

**Background line starts** for T3.1 (note the source is not strictly alphabetical).

> ### ⚠️ CORRECTED 2026-08-25 — the numbers here were in the DEAD `L####` SCHEME
>
> This list was never converted when the rest of the plans moved to `Book:Line` form. Every
> value was a master-concatenation offset needing **−1752** for the Characters Book, exactly
> as the migration plan warns. Taken literally they land in the *traits and equipment
> chapters* — `1845` is an improvised-weapon trait, `1859` is "Bashing Benefits", `2341` is a
> gash weapon rule. All plausible-looking game text, none of it a background. An agent
> following the old numbers would have transcribed 36 backgrounds' worth of the wrong
> chapter without anything erroring.
>
> The values below are **re-derived by content** — every one lands on a
> `### **<Name>**` heading — and verified to match the old list minus 1752 exactly.
>
> ### ⚠️⚠️ AND THEN THE BOOKS WERE REGENERATED, HOURS LATER, THE SAME DAY
>
> At **07:44 and 07:49 on 2026-08-25** the Rules Book (1,736 → 1,388 lines) and Characters
> Book (3,179 → 2,678) were rewritten by the OCR/build pipeline, invalidating the numbers
> immediately below *and* every other `R:`/`C:` citation in this repo. `F:` and `D:` are
> untouched.
>
> **The current values are in the table further down.** The list immediately below is kept
> only as the audit trail for the `L####` correction.
>
> **The lesson is not "renumber again".** This is **L1** in
> `docs/discrepancies/playtest-2-source-issues.md` landing for real, twice in one session.
> Book line numbers are not a stable address: the books are generated artifacts living
> outside the repo. Until they are pinned the way `docs/source/` pins the cards,
> **cite backgrounds by `### <Name>` heading and treat every `C:`/`R:` number as a hint.**

Acolyte of the Gardner **C:93**, Acolyte of the Healer **C:107**, Acolyte of the Smith **C:121**,
Acolyte of the Three **C:135**, Acolyte of the Warrior **C:141**, Alchemist **C:151**,
Apprentice Mage **C:165**, Archer **C:179**, Assassin **C:205**, Beggar **C:219**,
Cartographer **C:233**, Conjurer **C:247**, Cook **C:261**, Blacksmith **C:263**,
Duelist **C:289**, Bodyguard **C:291**, Entertainer **C:321**, Executioner **C:335**,
Hunter **C:339**, Hydromancer **C:353**, Farmer **C:367**, Illusionist **C:383**,
Gladiator **C:397**, Keraunomancer **C:419**, Knight **C:437**, Pugilist **C:449**,
Pyromancer **C:459**, Merchant **C:461**, Sage **C:487**, Miner **C:489**, Noble **C:503**,
Soldier **C:529**, Thief **C:547**, Tinkerer **C:561**, Transmuter **C:575**,
Village Watch **C:589**.

The chapter ran `C:89`–`C:602` in the pre-regeneration file, which is what the T3.1 row above
said — the two were inconsistent, and the row was the correct one.

### Current values — post-regeneration, 2026-08-25 07:49

The new extraction is **strictly alphabetical** (the "not strictly alphabetical" note above
was itself an artifact of the old column-bleeding extraction), records are a regular **8
lines apart**, and fields are clean `- **Field:**` bullets. Backgrounds run **C:81–C:372**.

Acolyte of the Gardner **C:85**, Acolyte of the Healer **C:93**, Acolyte of the Smith **C:101**,
Acolyte of the Three **C:109**, Acolyte of the Warrior **C:117**, Alchemist **C:125**,
Apprentice Mage **C:133**, Archer **C:141**, Assassin **C:149**, Beggar **C:157**,
Blacksmith **C:165**, Bodyguard **C:173**, Cartographer **C:181**, Conjurer **C:189**,
Cook **C:197**, Duelist **C:205**, Entertainer **C:213**, Executioner **C:221**,
Farmer **C:229**, Gladiator **C:237**, Hunter **C:245**, Hydromancer **C:253**,
Illusionist **C:261**, Keraunomancer **C:269**, Knight **C:277**, Merchant **C:285**,
Miner **C:293**, Noble **C:301**, Pugilist **C:309**, Pyromancer **C:317**, Sage **C:325**,
Soldier **C:333**, Thief **C:341**, Tinkerer **C:349**, Transmuter **C:357**,
Village Watch **C:365**.

The two `###` headings after Village Watch — "Expertise & Stamina Advancement" and
"Characteristics Advancement" — are **not backgrounds**. The count is still exactly 36.

**Content is stable across both extractions; only the rendering improved.** The
`Characteristic at 2:` distribution is byte-for-byte identical in the old and new files —
Mind 15, Strength 9, Agility 6, Mind-or-Strength 2, Agility-or-Mind 1, Agility-or-Strength 1,
Any 2 = 36. Use that as the transcription check; it survives regeneration when line numbers
do not.

**The old extraction mangled multi-word italic tokens.** Transmuter's spellbooks rendered as
`_repair take_ , _shape_` where the book means `*repair*, *take shape*`. Anything transcribed
from the pre-07:49 files should be re-derived, because that error class reads as plausible
content rather than as corruption.

---

## Part 5 — Dependency graph

```
T0.1 (branch/api) ──┬─> T0.2 (CONTRACT) ══FREEZE══┬─> Wave 1 (T1.1 … T1.8, parallel)
                    └─> T0.3 (test harness) ──────┤        │
                                                   │        ├─> T2.1 (crow sheet)
                                                   │        ├─> T2.2 (chat/monster/css)
                                                   │        └─> T2.3 (entry/creator)
                                                   │                 │
                                                   │                 └─> GATE: live v14
                                                   │
                                                   └─> Wave 3 content (parallel, from freeze)
                                                         T3.0 ─> T3.6, T3.7
```

**Critical path:** T0.2 → T1.1 → T2.2 → live verification. Everything else has slack.

**Hard serialization points:**
1. **T0.2 must be reviewed by you before Wave 1 dispatches.** Eight agents coding against a wrong contract is the single most expensive failure mode here.
2. **T1.1 and T1.2 must land before T2.1.** The sheet consumes both APIs.
3. **T3.0 before T3.6/T3.7.**

**Concurrency ceiling:** the Agent tool caps at `min(16, cores-2)` concurrent agents. Wave 1 at 8 plus Wave 3 at ~8 sits right at the ceiling — stagger Wave 3 if you want headroom.

---

## Part 6 — Gates

**Gate A — after Wave 0.** You personally review `.planning/CONTRACT.md`. Everything downstream is expensive to redo.

**Gate B — after Wave 1.** `npm test` green, `./verify.sh` passes. The system is *deliberately broken in-world* here — sheets still reference deleted fields. Do not try to launch it.

**Gate C — after Wave 2.** Full live verification on Foundry v14:
- Clean world: create a crow and a monster, every item sub-type, no console errors.
- **Migration: a real Playtest 1 world.** Characters playable, report journal present, second launch is a no-op.
- Roll a test; spend an expertise; confirm the tier updates in place and the use decrements.
- Doom card offers no spend button. Non-owner sees no buttons.
- Drag a 2-slot item across hand+belt; confirm refusal with a reason.
- Active Effects: actor-level and transferred item-level, toggle, token bars.
- Sheets as a read-only user.

**Gate D — after Wave 3.** All 11+ packs build via `npm run pack`. Import every pack from the generated ZIP into a clean world. `docs/discrepancies/SUMMARY.md` regenerated with zero unresolved HIGH findings.

**Gate E — release.** Only then set `verified: 14`, on the exact artifact you tested.

Pack build reminder: Foundry holds exclusive LevelDB locks while a world is open. Return to Setup before rebuilding, and a full world launch (not `reload_foundry`) is required for newly declared packs.

---

## Part 7 — Questions for MCDM

Carry these into the playtest feedback channel. **Each states the reading we shipped**, so MCDM only has to confirm or correct rather than answer from scratch. Every default is one constant or one predicate — all are cheaply reversible.

### A. Blocking a real implementation decision

**A1 — When does a "tier N result" trigger read: before or after an expertise is spent?**
*Affects T1.1, T1.7, T1.8, T2.2 — four agents dispatched in parallel.*

Expertise is spent *after* the roll and raises the tier by one (R:292). At least five rules key on "get a tier 1 result": a miss (R:915, R:921), the Counter reaction (R:985), the chaos roll (R:1567), Silent armor (C:2140) and the unarmoured sneak reroll (C:1725). If a caster gets a tier 1, then spends a spellcasting expertise to reach tier 2 — was there a chaos roll? If an attacker gets a tier 1 and then spends a weapon expertise — could the defender still Counter?

**Shipping: triggers read the FINAL, post-expertise tier.** The reasoning is that a miss is defined as a tier 1 result on an attack (R:921); if triggers read the pre-expertise value, a weapon expertise could never convert a miss into a hit, which would make all six weapon expertises nearly worthless. R:292 agrees — an expertise improves "the test's **result**."

Consequence, and the reason this is worth answering first: downstream effects cannot fire until the expertise window closes, so the interactive chat card needs an explicit **commit point** rather than resolving in one step.

**A2 — R:524 wound/speed: which of three readings?**

> "Each wound they take fills up a backpack slot of the PC's choice. For each slot occupied by a wound and an item, your speed is reduced by 1 (to a minimum of 0)."

| | Reading | Note |
|---|---|---|
| (a) | every occupied slot — wound *or* item | Excluded: speed is 5 (C:24) and the backpack is 10 slots (R:428), so a fully-loaded **unwounded** PC would already be at speed 0 |
| (b) | every wound | Makes "of the PC's choice" have no bearing on the rule that immediately follows it |
| (c) | every slot holding **both** a wound and an item | Placement becomes the decision the sentence implies; never harsher than (b); dropping gear is a maneuver (R:480), so the incentive is actionable |

**Shipping: (c), with (b) behind a system setting.** Note that slots holding both a wound and an item must already be a legal state — otherwise a fully-loaded PC could not take wounds at all, and since death is "all backpack slots have wounds," they would be unkillable by wounds.

**A3 — Do the Discipline Mastery traits' "chaos count" clauses now mean the chaos roll?**

All six Mastery traits (Alteration C:765, Benefaction C:917, Conjuration C:1117, Elemental C:1173, Illusion C:1275, Necromancy C:1507) still read "Non-doom tier 1 results of rank 0 and 1 *«discipline»* spells you cast don't add to **the chaos count**." The chaos count was replaced by the per-cast chaos roll (R:1563–1567), and the term appears **nowhere in the Rules Book**.

**Shipping: read as "rank 0–1 spells of your discipline don't trigger a chaos roll."** The intent maps exactly, since a non-doom tier 1 is precisely the chaos roll's trigger. The traits' second clause (rank 2+ treated as 2 ranks lower on the backlash table) needs no reinterpretation — R:1559 is unchanged. Logged in `docs/discrepancies/playtest-2-source-issues.md` H1.

**A4 — Doom vs. an unconscious target.**

R:554 says attacks against an unconscious creature "always achieve a tier 3 result (though the attacker can roll to see if they get a crit)". R:246 says a doom is "automatically a tier 1 result." A doomed attack on a sleeping target satisfies both.

**Shipping: unconscious wins, the tier stays 3**, with the doom still flagged so the Ref can adjudicate the "major setback" narratively. The R:554 parenthetical narrows what the roll is still *for* — crit detection — which implies the tier is already settled.

**A5 — Expertise vs. double bane ordering.**

A double bane is −1 tier, an expertise is +1 tier. Do they net out, and does application order matter? No rule text covers it. **Shipping: commutative net-shift.**

**A6 — Background expertise uses.**

C:24 says a background gives "1 use in some expertises," but entries list parentheticals like "Benefaction (2 uses)" (C:103). Is the parenthetical the total, or an addition to the base 1? **Shipping: the total.**

### B. Bug reports — no answer needed to proceed

**B1 — Elemental Mastery describes *conjuration* spells (C:1169 / C:1173).**

The Elemental Mastery body names "conjuration spells" in both clauses. It is the only one of the six Mastery traits that doesn't name its own discipline. Taken literally the trait grants an elementalist nothing.

**This was already reported for Playtest 1** and is unchanged in the PT2 packet — see `docs/discrepancies/SUMMARY.md` line 49. **Shipping: implemented as "elemental"**, with the source text retained in a `sourceNote` for audit. One-word fix on MCDM's side.

### C. Lower priority

**C1 — Greed Bonus scope.** "Can't apply in that dungeon again to the group (or another group of PCs played by the same players)" implies tracking across characters and campaigns. **Shipping: a per-world, per-dungeon flag.**

**C2 — Monster `power`.** Is a published figure expected for every stat block, including uniques like the Ring Collector? F:704 says the 0–50 scale "could go even higher" in future products — should the ceiling be treated as soft? **Shipping: unbounded, validated with a warning.** Observed range in the Ref Book is 1–11.

**C3 — Does “use” expend Boons of Disappearance and Flight?** The Crypt preamble says that after you *expend* a boon you no longer have it (C:2921), and most boons explicitly say “expend.” Disappearance and Flight instead say “use” (C:2925, C:2929), while Rescue also says “use” but explicitly grants level-many uses before it is expended (C:2937). **Shipping: Disappearance and Flight each have one use, matching the ordinary single-use boon default; Rescue alone has uses equal to the Crypt's boon-effect level.**

---

*Withdrawn:* **Counter damage vs. AD.** R:985 says you "deal the tier 2 result of the weapon you're wielding" — ordinary weapon damage with no AD exemption stated, so it interacts with AD normally. No question to ask.
