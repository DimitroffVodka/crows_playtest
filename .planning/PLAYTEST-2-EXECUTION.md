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
SOURCE:  Master.md L178-188 (characteristics), L304-372 (expertises),
         L424-512 (sizes + inventory + corpses), L540-572 (conditions),
         L1774-1794 (creation), L2355-2411 (advancement),
         L5621-5665 (creature stats: power, slots, X/Rest)

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
         test/**, dev/fixtures/actors/*.json
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
4. Fixture actors in dev/fixtures/actors/: at minimum one Playtest 1 crow with
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

**`module/config.mjs`**

```js
export const CROWS = {
  id: "crows",
  characteristics: { agility: "A", mind: "M", strength: "S" },
  charRange: { min: -5, max: 5 },     // schema bounds; magic may exceed the PC cap
  charPcCap: 4,                        // L188, enforced in advancement not schema

  tiers: { t1Max: 11, t2Max: 16 },
  doomFaces: [2, 3],
  critFaces: [19, 20],

  edgeBane: { numeric: 2 },            // single edge +2 / single bane -2 (L278/284)

  // Expertises (L312-362). Category gates what a test may apply.
  expertises: {
    general: ["alchemy","athletics","blacksmithing","enchanting","endurance",
              "gymnastics","handlePet","historicalLore","lift","magicLore",
              "monsterLore","natureLore","navigate","pickLock","religiousLore",
              "search","stealth","thievery"],
    spellcasting: ["alteration","benefaction","conjuration","elemental",
                   "illusion","necromancy"],
    weapon: ["bashing","bow","chopping","slashing","stabbing","unarmed"]
  },

  // Carry containers vs magic-item slots are now SEPARATE axes (L440 vs L452).
  carryContainers: { hand: 2, belt: 4, backpack: 10 },   // belt was 2 in PT1
  magicSlots: ["head","neck","waist","arms","finger","feet"],  // 1 item each

  stackLimits: { potion: 5, lock: 3, oil: 2 },   // L446; default 1
  coinPerSlot: 250,                              // L446 / changelog

  corpseSlots: { tiny: 1, small: 2, medium: 4, large: 8, huge: 16, holyShit: 32 },
  corpseStack: { tiny: 3 },                      // L500; all others 1

  sizes: ["tiny","small","medium","large","huge","holyShit"],
  harvestDice: { tiny:"1d6", small:"1d6", medium:"1d6",
                 large:"2d6", huge:"3d6", holyShit:"4d6" },   // L666

  greedBonus: { 1: 0.30, 2: 0.20, 3: 0.10 },     // L604, by DT number
  encounter: { defaultEN: 9, crowdedEN: 8, bothEN: 7, immediateOn: 10 },  // L636

  conditions: ["blessed","grabbed","prone","vulnerable","unconscious","weakened"],
  // NOTE: `boned` is DELETED. `hidden`/`invisible` were PT1 additions not in the
  // PT2 condition list — keep them only if the sheet needs them, and mark clearly.

  expertiseAdvancement: [                        // L2373
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
  charAdvancement: [5000, 15000, 30000],         // L2394
  charAdvancementRepeat: 30000,
  retirementTXP: 60000,                          // changelog

  // unchanged from PT1 — re-verify in Wave 3 but do not restructure now
  weaponTypes: [...], weaponQualities: [...], armorTypes: [...],
  armorBaseAD: {...}, armorSlots: {...}, disciplines: [...],
  traitTrees: [...], traitTierXP: {...}, creatureTypes: [...],
  castTypes: [...], usageExpiry: [...], qualityTiers: [...], gearSubtypes: [...]
};
```

**`CrowData` schema — changed fields only**

```js
// REPLACES `skills`
expertises: new SchemaField(
  Object.fromEntries(allExpertiseKeys.map(k => [k, new SchemaField({
    uses: new NumberField({ initial: 0, min: 0, integer: true }),
    max:  new NumberField({ initial: 0, min: 0, integer: true })
  })]))
),

characteristics: { agility|mind|strength: { value: NumberField({min:-5, max:5}) } },
// was min:-1 max:3 — both wrong for PT2

conditions: new SchemaField({
  blessed:     new BooleanField({ initial: false }),   // was NumberField (leveled)
  grabbed:     new BooleanField({ initial: false }),
  prone:       new BooleanField({ initial: false }),
  vulnerable:  new BooleanField({ initial: false }),   // NEW L558
  unconscious: new BooleanField({ initial: false }),
  weakened:    new BooleanField({ initial: false })    // NEW L570
  // `boned` DELETED
}),

// Wounds occupy PLAYER-CHOSEN backpack slots (L538), not a bare count.
woundSlots: new SetField(new NumberField({ min: 0, max: 9, integer: true })),
// derive `wounds` as woundSlots.size in prepareDerivedData for back-compat

xp: { txp, spendable, expertiseBonusesSpent, charBonusesSpent },
// renamed from skillBonusesSpent

preparedTask: new SchemaField({          // L672-678: now a task, not a skill
  task:  new StringField({ blank: true, initial: "" }),
  bonus: new NumberField({ initial: 2, integer: true }),   // was +1, now +2
  setOn: new StringField({ blank: true, initial: "" })
}),

npcConnection: new SchemaField({          // NEW L1792 / L4303
  name: new StringField({ blank: true }),
  relationship: new StringField({ blank: true }),
  notes: new HTMLField()
})
```

**`MonsterData` — additions**

```js
power:    new NumberField({ initial: 0, min: 0, max: 50, integer: true }),  // L5637
reactions: new NumberField({ initial: 1, min: 0, integer: true }),          // L5641
hasSlots: new BooleanField({ initial: false }),  // monsters false; humans/animals true (L5631)
size:     new StringField({ choices: CROWS.sizes, initial: "medium" }),
xRest:    new ArrayField(new SchemaField({
            name: new StringField(), max: new NumberField(), used: new NumberField()
          }))                                                              // L5643
```

**`BackgroundData` — changed fields**

```js
// REPLACES `skills: [String]`. Backgrounds grant 1 use in most expertises but
// 2 in some (e.g. Acolyte of the Gardner: Benefaction 2, Elemental 2 — L1855).
expertises: new ArrayField(new SchemaField({
  key:  new StringField({ required: true }),
  uses: new NumberField({ initial: 1, min: 1, integer: true })
})),

// SEMANTIC CHANGE: now names the characteristic SET TO 2, not a +1 bonus (L1780)
characteristicAt2: new StringField({ initial: "any" }),

startingGold: new StringField({ initial: "3d6" })   // L1788
```

**Frozen function contracts** (Wave 1 implements; nobody changes the signatures)

```js
// helpers/edges.mjs — pure, no Foundry
resolveEdgesBanes(edges: Label[], banes: Label[]) => {
  netEdges: 0|1|2, netBanes: 0|1|2,
  numeric: -2|0|2,        // single edge/bane only
  tierShift: -1|0|1,      // double edge/bane only
  explanation: string
}
// Algorithm (verified against L292-298): clamp each side to 2, then subtract.
//   E = min(edges.length, 2); B = min(banes.length, 2); net = E - B
//   net=+2 -> tierShift +1 | net=+1 -> numeric +2 | net=0 -> neutral
//   net=-1 -> numeric -2   | net=-2 -> tierShift -1
// Clamp-then-subtract is what makes "3 edges + 1 bane = ONE edge" come out right.

// helpers/roll.mjs
rollTest({ actor, characteristic, mods: Mod[], edges: Label[], banes: Label[],
           flavor, attack, casting, targets }) => Promise<TestResult>
applyExpertise(message: ChatMessage, expertiseKey: string) => Promise<TestResult>

// helpers/slots.mjs — pure, no Foundry
packItem(layout: Layout, item, container, index) => {ok: boolean, reason?: string}
canStack(a, b) => boolean
layoutFor(actor) => Layout
retrieveFromBackpack(layout, itemId, d10: number) => {ok, slotsMatched}

// helpers/migration.mjs — pure
migrateCrowSystem(source: object) => object      // safe on partial deltas
migrateBackgroundSystem(source: object) => object
SKILL_TO_EXPERTISE: Record<string, string>
```

**Tier resolution precedence** — implement exactly this order, it is the most error-prone thing in the project:

```
1. rawSum = 2d10 unmodified
2. if rawSum in doomFaces  -> tier 1, TERMINAL.
      Not rescuable by edges, expertise, bonuses, or anything else (L260).
3. if rawSum in critFaces  -> tier 3, TERMINAL upward, regardless of banes (L258).
4. eb = resolveEdgesBanes(edges, banes)
5. total = rawSum + charVal + sum(mods) + eb.numeric
6. tier = classifyTier(total)
7. tier = clamp(tier + eb.tierShift, 1, 3)
8. if attack && target.unconscious -> tier = max(tier, 3)   (L568)
9. post interactive card
10. on expertise spend (only if !doom): tier = min(tier + 1, 3)  (L306)
```

Store as `message.flags.crows.test = {rawSum, charVal, mods, eb, tier, doom, crit,
expertiseSpent: null, actorId}` so the card is re-renderable and the spend is
idempotent under double-click.

---

## Part 2 — WAVE 1: Pure helpers (8 agents, fully parallel)

All eight start together once T0.2 is frozen. **None of them touch sheets or templates.** Every one writes unit tests under `test/`.

Wave 1 leaves the system **non-functional in-world** — sheets still reference deleted fields. That's expected. Wave 2 fixes it.

### T1.1 — Edge/bane resolver + roll pipeline ⭐ highest risk

```
TASK T1.1 — Edge/bane resolution and two-phase roll pipeline
OWNS:    module/helpers/edges.mjs (new), module/helpers/roll.mjs,
         module/helpers/expertise.mjs (new), test/edges.test.js, test/roll.test.js
READS:   .planning/CONTRACT.md, .planning/API-NOTES.md, module/config.mjs,
         module/data/actor/crow.mjs, templates/chat/test-card.hbs (read only —
         T2.2 owns the rewrite)
SOURCE:  Master.md L256-262 (crits/dooms), L270-302 (edges/banes/bonuses),
         L304-372 (expertise), L378-390 (assist), L392-400 (attacks/castings)

DELIVERABLE:
1. helpers/edges.mjs — resolveEdgesBanes per the contract. Pure, no Foundry.
2. helpers/roll.mjs — rollTest() implementing the 10-step precedence in
   CONTRACT.md exactly. Two independent modifier channels: edges/banes (counted,
   then resolved) and mods (summed). Per L300 these NEVER mix — a masterwork
   tool's +2 is not an edge.
3. helpers/expertise.mjs — applyExpertise(message, key). Must enforce:
   - actor owner only
   - once per message (idempotent under double-click / lag)
   - uses > 0, decrement on success
   - CATEGORY GATE: weapon expertises only on weapon attacks, spellcasting only
     on castings and spell attacks, general on neither (L394/L398)
   - REFUSE on doom. Expertise cannot rescue a doom (L260). Test this explicitly.
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
  - ./verify.sh passes; npm test green.
DO NOT: touch sheets/, templates/, or any other helper. If another helper calls
        rollTest with the old signature, leave it broken — its owner fixes it.
```

### T1.2 — Positional slot model

```
TASK T1.2 — Inventory slot rewrite
OWNS:    module/helpers/slots.mjs, module/helpers/corpses.mjs (new),
         test/slots.test.js
READS:   .planning/CONTRACT.md, module/config.mjs, module/data/item/*.mjs
SOURCE:  Master.md L440-512 (slots, magic slots, equipped, armor, swapping,
         corpses), L538 (wounds and speed)

CONTEXT: The current slots.mjs (34 lines) is a capacity SUM with no positional
model. This is a rewrite, not a patch.

DELIVERABLE:
1. Positional layout: hand[2], belt[4], backpack[10], plus six magic slots as a
   SEPARATE axis (L452). Do not model magic slots as carry containers.
2. Contiguity: a multi-slot item occupies adjacent indices IN ONE container.
   Reject hand+belt spanning; reject backpack 2 and 7 (L444).
3. Stacking: per CROWS.stackLimits, same KIND only — 5 different potions stack,
   3 potions + 2 locks do not (L446). Hand slots never stack.
4. Coinage: 250 gc loose per slot.
5. Wounds occupy player-chosen backpack indices (system.woundSlots).
6. Speed penalty — SEE THE AMBIGUITY BELOW. Implement behind a system setting
   `crows.woundSpeedRule` with values "wounds-only" (default) and "literal".
7. retrieveFromBackpack(layout, itemId, d10): maneuver + 1d10 >= at least one of
   the item's backpack slot numbers (L492).
8. Magic slot overload: >1 magic item in a slot -> flag `magicOverload`, consumed
   by T1.7 (1d6 wounds/DT) and T1.5 (cannot rest). Expose the flag; do not
   implement those effects here.
9. helpers/corpses.mjs: corpse slot cost by size + carried equipment (L498).

AMBIGUITY (do not resolve unilaterally, and do not paper over):
  L538 reads "For each slot occupied by a wound and an item, your speed is
  reduced by 1." Literally — each backpack slot holding EITHER a wound or an item
  — a loaded PC hits speed 0 almost immediately. Default to the wound-only
  reading, implement "literal" behind the setting, and append the case to
  docs/discrepancies/SUMMARY.md.

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
OWNS:    module/helpers/migration.mjs (new), test/migration.test.js,
         dev/probes/p12-migration.mjs (new)
READS:   .planning/CONTRACT.md, module/data/**, dev/fixtures/actors/*,
         git show master:module/data/actor/crow.mjs  (the OLD schema — read it
         from git, the working tree already has the new one)
SOURCE:  Master.md L304-372, PLAYTEST-2-MIGRATION.md section 2.3

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
2. bonus -> uses conversion, 1:1, clamped to the max-uses for that actor's TXP
   band (CROWS.expertiseAdvancement).
3. Conditions: drop `boned` — it has no PT2 equivalent, do not silently convert
   it to `weakened` (different duration and semantics). `blessed > 0` -> true.
4. Wounds: `wounds: N` -> woundSlots = the bottom N indices, preserving PT1
   bottom-up behavior as the initial arrangement.
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
  - A zero-value test: bonus 0 survives as uses 0, is not dropped as falsy.
  - A collapse test: climb bonus 1 + swim bonus 2 -> athletics uses 2.
  - An illegal-placement test asserting the item is reported, not moved.
  - npm test green; ./verify.sh passes.
DO NOT: register hooks or touch crows.mjs. Pure functions only — T2.3 wires them.
```

### T1.4 — Advancement

```
TASK T1.4 — Advancement tables and trait purchase
OWNS:    module/helpers/advancement.mjs, test/advancement.test.js
READS:   .planning/CONTRACT.md, module/config.mjs, module/data/item/trait.mjs
SOURCE:  Master.md L2355-2411 (XP, both tables, new PC after death),
         L2413-2423 (buying traits, minimum modifier)

CONTEXT: advancement.mjs has 32 `skill` references. Both TXP tables are fully
replaced — do not try to preserve the old numbers.

DELIVERABLE:
1. New Expertise & Stamina table (CROWS.expertiseAdvancement) with the max-uses
   curve 2/2/2/2/2/3/3/4/4 and "every 30,000 after".
2. Each bonus is a THREE-WAY choice (L2365): 3 expertise uses distributed freely
   (including into expertises you don't have) without exceeding max; OR +2 Stamina
   max; OR 1 use + 1 Stamina max. Return the options; do not auto-pick.
3. Characteristic table 5000/15000/30000/+30k, cap 4, and if all three are at 4
   the bonus becomes +2 Stamina instead (L2392).
4. XP accrual: treasure value / player count, excluding purchased, crafted,
   taken-from-innocent, and ally-owned goods (L2357). Unique items carry an
   explicit XP value.
5. Spending is gated to end-of-rest (L2361).
6. Traits: starting traits 500 XP; a trait must connect by line to one you own on
   the same tree; one purchase each (L2419).
7. New PC after death: extra background rolls equal to the dead PC's bonus count;
   optional TXP floor matching the party's lowest (L2405-2409).
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
         module/helpers/greed.mjs (new), test/rest.test.js
READS:   .planning/CONTRACT.md, module/helpers/usage-die.mjs, module/helpers/miasma.mjs
SOURCE:  Master.md L600-638 (end of DT, greed, encounters), L640-694 (resting,
         rest encounters, all rest activities, town activities)

DELIVERABLE:
1. Rest restores ALL Stamina, ALL expertise uses, and removes 1 wound OF THE
   PLAYER'S CHOICE. Expertise refresh is BLOCKED when resting in Miasma (L642).
2. Halfway-point rule: end-of-DT effects end and end-of-DT UD roll at the rest's
   midpoint (L644).
3. Rest activities — revised and new:
   - Prepare for Task: now +2 (was +1), binds to a task string not a skill,
     lasts until the next completed rest.
   - Tend Wounds: target needs >=2 wounds, CANNOT be self, removes 2, once/rest.
   - Harvest: generic monster parts, 1d6/2d6/3d6/4d6 by corpse size (L666).
   - Repair Armor (NEW): restore one armor/shield to full AD.
   - Seclude Camp (NEW): EN -1 for this rest; one person per group; does NOT
     require finishing the rest.
   - Craft Equipment, Identify Item: carry forward.
4. Town rest activities (L692): up to 4/day without sleeping, ~2h each, benefits
   land after the 2 hours rather than at end of rest. Tend Wounds is the exception
   — still needs 4h sleep, once/day.
5. Rest is blocked entirely if the actor has the magicOverload flag from T1.2 (L474).
6. Encounter check: 1d10 >= EN. EN 9 default, 8 if crowded (>20 creatures) OR
   chaos left behind, 7 if BOTH. A rolled 10 fires immediately; a triggering 9 or
   lower telegraphs a sign now and fires during the next DT (L636-638).
7. helpers/greed.mjs: +30%/+20%/+10% on treasure found in DTs 1-3 of a first
   entry, once per dungeon per PLAYER GROUP — persists across characters, so key
   a world flag by dungeon id, not by actor (L614).
8. Delete blessed/boned reset; replace with end-of-DT expiry for blessed,
   vulnerable, and weakened.
9. Configurable DT length: 30 default / 60 / 20 / 1d6-rooms (L630).

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
         module/helpers/hirelings.mjs (new), test/village.test.js
READS:   .planning/CONTRACT.md, module/helpers/crypt.mjs
SOURCE:  Master.md L4287-4441 (village, prosperity, trade, village crafting),
         L4442-4889 (all 13 institutions), L4890-4933 (home, retirement, other
         villages), L4251-4286 (hirelings), L1679-1752 (crafting, IDing items)
         Institution line starts: Alchemist 4458, Auction House 4497, Barracks 4511,
         Beacon 4558, Blacksmith 4591, Bookseller 4635, Crypt 4665, Enchanter 4716,
         General Store 4744, Inn 4779, Stables 4799, Temple 4850

DELIVERABLE:
1. DELETE the availability-roll code. Item availability is now purely a function
   of merchant institution level (changelog). Institution level counts changed —
   re-derive every one from L4442-4889, do not assume PT1 values.
2. New institutions: Barracks (L4511), Beacon (L4558).
3. Temple no longer sells crafting materials but CAN craft for you (L4850).
4. Auction house no longer sells monster parts (L4497).
5. Prosperity can be raised by spending 10,000 gc on village items.
6. Crafting on generic monster PARTS, not specific organs.
7. helpers/hirelings.mjs: employment terms, control, death-of-PC handling
   (L4251-4286).
8. Not Your Village / Founding Other Villages / Other Villages (L4293, L4910, L4916).

ACCEPTANCE:
  - Zero references to availability rolls remain.
  - A table test asserting every institution's level count matches the doc, with
    the source line cited in a comment per institution.
  - npm test green; ./verify.sh passes.
DO NOT: touch crypt.mjs (crypt boons are PT1 work that survives — verify only,
        and report to the orchestrator if L4665 has changed it).
```

### T1.7 — Damage, conditions, combat resolution

```
TASK T1.7 — Damage, conditions, combat
OWNS:    module/helpers/damage.mjs, module/helpers/combat.mjs (new),
         module/helpers/attack.mjs, test/damage.test.js
READS:   .planning/CONTRACT.md, module/helpers/edges.mjs (T1.1 — coordinate on
         the Label shape via CONTRACT.md, do not edit it), module/data/actor/*
SOURCE:  Master.md L518-538 (AD, piercing, stamina, wounds), L540-572 (conditions),
         L923-1004 (attacks, melee, ranged, crits, multi-target, flanking, high
         ground, reactions, counter), L769-796 (cover, concealment)

DELIVERABLE:
1. Conditions rewritten (see CONTRACT.md): boned deleted; blessed now grants an
   edge AND bonus damage equal to the attack's characteristic; vulnerable adds
   1d6 per damage instance; weakened is a bane on all tests. All three expire at
   end of DT. Conditions are strictly boolean now — you cannot gain a second
   instance (L542).
2. Bidirectional Active Effect sync for all six conditions.
   Use CONST.ACTIVE_EFFECT_CHANGE_TYPES — see .planning/API-NOTES.md, and note
   verify.sh BLOCKS ACTIVE_EFFECT_MODES.
3. Damage: AD -> Stamina -> wounds. Piercing bypasses AD. Multi-AD priority
   dialog survives from PT1. Vulnerable adds 1d6 BEFORE AD is applied.
4. Wounds land in a player-chosen backpack slot — call into T1.2's layout API.
5. helpers/combat.mjs:
   - Counter reaction (L997): triggered by an adjacent attacker's T1 on a melee
     attack / Grab / Knockback / Escape Grab. Deals the counterer's weapon tier 2;
     on the trigger's DOOM, tier 3 instead. NOT triggered by a T1 opportunity attack.
   - Crit on an attack grants an extra action (L971).
   - Ranged miss with allies adjacent (L957): roll any die, on ODD hit a random
     adjacent ally for tier 2. On a DOOM, hit an ally for tier 3 automatically (L959).
   - Ranged beyond normal range: -2 per square. This is a PENALTY, not a bane (L955).
   - Ranged at an adjacent target: a BANE (L961).
   - Flanking (L979) and high ground (L987): edge sources. Emit Labels for T1.1.
   - Multi-target (L975): ONE roll, but per-target edges/banes can resolve to
     DIFFERENT TIERS per target. The result shape must be per-target.
6. Cover and concealment (L769-796) as edge/bane sources.

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
         test/spellcasting.test.js
READS:   .planning/CONTRACT.md, module/helpers/roll.mjs (T1.1 — consume, do not edit)
SOURCE:  Master.md L1459-1563 (spellbooks: rank, discipline, casting time, target,
         range, AoE, duration, UD), L1565-1581 (summons, backlash triggers,
         chaos roll), L1587-1673 (the 105-row backlash table)

CONTEXT — THE BIG CHANGE: Playtest 1 modelled backlash risk as a GM-secret
WORLD-LEVEL CHAOS COUNT that accumulated across casts and fired at a threshold.
chaos.mjs (102 lines) implements that. PLAYTEST 2 DELETES IT ENTIRELY.

DELIVERABLE:
1. GUT chaos.mjs. Backlash now triggers on exactly two events (L1577-1581):
     a. doom on a casting
     b. chaos roll: on a TIER 1 THAT IS NOT A DOOM, roll 1d6; a 1 = backlash
   No accumulator, no threshold, no world flag. Do not try to preserve the
   counter. Report to T1.3's owner that any stored count is dead data to drop
   with a note in the migration report.
2. Spellbook UD roll on EVERY cast (L1557). A CRIT SKIPS THE UD ROLL (L1559).
3. Backlash resolution: d100 + spell rank on the table. Resolves INSTEAD of the
   spell, but STILL COSTS THE UD ROLL (L1573). Duplicate durational backlashes
   re-roll unless they stack. Backlash UD roll at end of DT.
4. If a backlash needs a creature target but the spell targeted an object, the
   CASTER becomes the target (L1575).
5. Spellbook schema: rank 0-5, discipline, castingTime (action/maneuver/reaction/
   outOfCombat), target, range, areaOfEffect (aura/cube/line), duration
   (instant/DT/UD), ud.
6. Casting is ALWAYS a Mind test; only the matching spellcasting expertise applies.
7. Summoned creatures behave as pets but need no command test (L1567).

BACKLASH TABLE ERRATA — transcribe verbatim, then log to
docs/discrepancies/crows-rules.md, do NOT silently correct:
  - Row "62-64" overlaps row "61-62". Likely meant 63-64.
  - Row 51-52 calls for a "Might RR". No such characteristic exists in this game
    (Agility/Mind/Strength). Probably Strength.

ACCEPTANCE:
  - Test: doom on a casting triggers backlash AND still rolls UD.
  - Test: tier 1 non-doom rolls 1d6; only a 1 triggers.
  - Test: tier 2 and tier 3 never trigger a chaos roll.
  - Test: crit skips the UD roll.
  - Test: all 105 table rows parse, and d100+rank clamps correctly at the top.
  - Zero references to a chaos counter/threshold remain.
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
SOURCE:  Master.md L440-512 (slots), L304-372 (expertises), L2355-2423 (advancement)

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
SOURCE:  Master.md L256-262, L270-306, L5621-5665 (creature stats)

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
3. Monster sheet: add power (0-50), reactions, X/Rest features with use tracking,
   size. Monsters have no slots; humans and animals do (L5631) — the sheet must
   switch on hasSlots.
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
         module/helpers/creation.mjs
READS:   all helpers and data models, .planning/CONTRACT.md
SOURCE:  Master.md L1766-1794 (crow creation), L1841-2354 (all 36 backgrounds)

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
   - Background sets ONE characteristic to 2 (L1780) — this is a SET, not a +1.
     Remaining two: player picks {1, 0} or {-1, 2}, assigned freely.
   - Background grants expertise USES (1 or 2 each), not skill bonuses.
   - Universal kit: empty coin purse, knife, rope, 6 rations, and 3d6 gc (L1788).
   - New step: NPC connection (L1792).
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
```

**Before anything else in Wave 3:** `docs/discrepancies/SUMMARY.md` records **8 unresolved HIGH-severity findings** from the Playtest 1 pass — `bone-capture` and `minor-curse` have literally swapped tier effects, `minor-healing` is wrong on all three tiers, Rage Potion is priced 5× off. **T3.0 confirms these were fixed before anyone re-validates against Playtest 2**, or they get baked into v0.2.0.

| Task | Pack | Docs | Notes |
| --- | --- | --- | --- |
| T3.0 | — | — | Audit the 8 open HIGH findings from `docs/discrepancies/SUMMARY.md`. Fix or confirm fixed. **Blocks T3.6 and T3.7.** |
| T3.1 | `crows-backgrounds` | 36 | **Every one changed.** L1841–2354, per-background line starts listed below. `skills` → `expertises` with uses; `characteristicAt2`; starting equipment per the changelog (many swaps: bear traps, smoke bombs, gluepots, nets, ball bearings). |
| T3.2 | `crows-traits` | 276 | 23 trees, L2459–3630. Leverage confirmed changed (Stacks on Stacks replaces Groundroll). Split across 3–4 agents by tree: **A** Alchemy→Blacksmithing (2459–2778), **B** Camping→Enchantment (2779–3016), **C** Illusion→Pets (3017–3358), **D** Reputation→Unarmed (3359–3630). Note the source's own typo: tree heading reads "Blackmsithing" at L2709. |
| T3.3 | `crows-weapons` + `crows-armor` + `crows-ammunition` | 25 | L3749–4156. Armor types/upgrades/enchantments L3753–3941; weapon types/qualities/upgrades/enchantments L3946–4156. |
| T3.4 | `crows-gear` + `crows-consumables` + `crows-loot` | 63 | L3635–3748 (cards, fine/masterwork, gear, money), L4157–4180 (crafting materials, treasure). Monster parts are now generic. |
| T3.5 | `crows-monsters` | 11 → more | L5621–7058. Add `power`, `reactions`, `hasSlots`, `size`, `xRest` to every stat block. Expand: Animals/Potential Pets (5657–6131), Humans (6132–6553), Blood Creatures (6630), Ring Collector (6717), Undead (6760). |
| T3.6 | `crows-spellbooks` | 25 | L1459–1678. **Depends on T3.0** — this pack holds 5 of the 8 open HIGH findings. |
| T3.7 | `crows-rules` | 1 journal, ~16 pages | Full rewrite: expertises, edges/banes, six conditions, new advancement tables, greed bonus, encounter EN, rest activities, sizes, corpse slots. **Depends on T3.0** and on T0.2 for terminology. |

**New content (T3.8–T3.11)** — new packs, so fully independent:

| Task | Deliverable | Source |
| --- | --- | --- |
| T3.8 | `crows-adventures` (JournalEntry): Blood Library, 8 rooms | L7249–7632 |
| T3.9 | `crows-adventures`: Floating Manor, 15 rooms | L7633–8228 |
| T3.10 | `crows-adventures`: POI Ruined Tower, POI Ruined Windmill, village of Gadwick, dungeon hooks, awarding treasures | L7059–7248 |
| T3.11 | `crows-tables` (RollTable): travel encounters — Any Monster, Bad Weather, Merchant, Miasma-Touched, Monster from Nearby, Strong Miasma, Traveler, Wild Animal, Interesting Things | L4943–5620 |

T3.8 and T3.9 both target `crows-adventures`. Give them separate subdirectories under `src/packs/crows-adventures/` and have one agent add the pack to `system.json` — or simpler, give each its own pack and merge later.

**Background line starts** for T3.1 (note the source is not strictly alphabetical):
Acolyte of the Gardner 1845, Healer 1859, Smith 1873, Three 1887, Warrior 1893, Alchemist 1903, Apprentice Mage 1917, Archer 1931, Assassin 1957, Beggar 1971, Cartographer 1985, Conjurer 1999, Cook 2013, Blacksmith 2015, Duelist 2041, Bodyguard 2043, Entertainer 2073, Executioner 2087, Hunter 2091, Hydromancer 2105, Farmer 2119, Illusionist 2135, Gladiator 2149, Keraunomancer 2171, Knight 2189, Pugilist 2201, Pyromancer 2211, Merchant 2213, Sage 2239, Miner 2241, Noble 2255, Soldier 2281, Thief 2299, Tinkerer 2313, Transmuter 2327, Village Watch 2341.

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

Carry these into the playtest feedback channel. Each is currently blocking a real implementation decision:

1. **L538 wound/speed** — "for each slot occupied by a wound and an item" reads two ways, and the literal reading collapses a loaded PC's speed to 0 almost immediately. (Shipping the wound-only reading behind a setting.)
2. **Expertise vs. double bane ordering** — a double bane is −1 tier and an expertise is +1 tier. Do they simply net out, and does application order matter? No rule text covers this. (Assuming commutative.)
3. **Background expertise uses** — L1776 says a background gives "1 use in some expertises," but entries list parentheticals like "Benefaction (2 uses)". Is the parenthetical the total or an addition to the base 1?
4. **Counter damage vs. AD** — Counter deals "the tier 2 result of the weapon." Does that damage interact with Armor Defense normally?
5. **Greed Bonus scope** — "can't apply in that dungeon again to the group (or another group of PCs played by the same players)" implies tracking across characters and campaigns. Is a per-world, per-dungeon flag the intent?
6. **Monster `power` values** — is a published power figure expected for every stat block, including uniques like the Ring Collector?
