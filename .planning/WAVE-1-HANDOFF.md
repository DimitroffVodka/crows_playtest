# Wave 1 — close-out and handoff register

**Closed:** 2026-08-22 · **747 tests / 137 suites / 0 fail** · `verify.sh` and `--strict` both exit 0
**Started at:** 42 tests. All eight agents (T1.1–T1.8) reported done.

---

## Why this file exists

T1.1, on discovering that a rule it had flagged in a report was still wired to nothing:

> *"A flag in a report is not a caller. I should have chased whether anything picked it up rather than treating my own note as discharging it. Three of my four cross-agent findings this round were 'X assumes Y wired it', and none of them would have surfaced from either file alone."*

That is the orchestration gap this wave exposed. Eight agents produced dozens of handoffs inside prose reports, and a handoff nobody tracks is indistinguishable from a handoff nobody needed. **Everything below is an open obligation, not a note.**

---

## 1. ~~Open handoffs — T2.3 (entry point)~~ — **CLOSED `eb40076`**

**The system boots.** All seven dead bindings removed, `KNOWN_UNWIRED = {}`, entry point evaluates
through init/ready, and every wiring item below landed. Verified independently: 753 tests / 141
suites / 0 fail, `verify.sh` and `--strict` both exit 0.

Retained below for the record — and because §2 gained an item from it.

### Boot blockers — the system does not start today

| Dead import | From | Why it died |
|---|---|---|
| `rollAvailability` | `helpers/village.mjs` | T1.6 deleted PT1's `baseAvailability + prosperity` vs 1d100 roll — availability is now institution level |
| `registerChaosSetting`, `getChaos`, `setChaos`, `addToChaos`, `resetChaos`, `showChaosDialog` | `helpers/chaos.mjs` | T1.8 gutted the PT1 Chaos Count tally; PT2 has a per-cast chaos roll and no accumulator |

**Seven dead named bindings out of 98** in `crows.mjs`, from **two** suppliers. An ESM named import of a missing export is a hard load failure — invisible to `npm test` and `verify.sh`, which is why `test/boot.test.mjs` (T1.2) now guards it. Its `KNOWN_UNWIRED` list is a **ratchet**: a separate test fails if an entry is fixed and not deleted, so the list can only shrink.

### Wiring nothing else can do

- `Object.assign(game.crows, ROLL_API)` — T1.1's surface, **23 keys** (T1.1 reported 22; `preparedTaskMod` was added later with the Prepare for Task correction, verified by T2.3). `dev/probes/p05-roll.mjs` reports `not wired onto game.crows` until this lands.
- `Hooks.on("renderChatMessageHTML", (m, html) => bindTestCardActions(m, html))` — T1.1.
- `registerSlotSettings()` from `init` — T1.2. Until then `crows.woundSpeedRule` silently defaults forever (degraded, not broken).
- `registerSpellcastingHooks()` — T1.8. Nothing else subscribes to `crowsTestCommitted` for castings.
- `registerCombatHooks({ autoApply: false })` in `ready` — T1.7.
- Expose T1.5's: `takeTownActivity`, `beginRestSession`/`endRestSession`, `enterDungeon`/`leaveDungeon`/`applyGreedBonus`, `resolvePendingEncounter`, `getDTLength`.
- Expose T1.7's: `setCondition`, `mirrorConditions`, `expireDungeonTurnConditions`.
- ~~Delete T1.4's deprecated `spendSkillBonus` stub~~ — **DEFERRED, and the ordering matters.**
  T2.3 correctly refused: `crow-sheet.mjs:8` still name-imports it (used at `:141`, `:635`), so
  deleting the stub now recreates a hard boot failure through CrowSheet — the exact class T2.3 was
  dispatched to fix, reintroduced by its own cleanup. **Two steps, in order: T2.1 removes the
  import first, then the stub can go.** My original wording stated this as unconditional; T2.3
  spotted that the 'once the import is gone' clause was not satisfied.

### ⚠ The HUD interception trap — CORRECTED, the hook must be SYNCHRONOUS

The original wording here said to `await handleStatusToggleIntent(...)` and cancel core when it returns `handled: true`. **That is unimplementable.** T2.3 read the v14 source and found `preCreate`/`preDelete` are dispatched synchronously — core does not await the handler, so an `async` hook returns a truthy Promise and **core proceeds regardless**. Confirmed by probe on live 14.367: an async handler resolving `false` was ignored and the effect was created; a synchronous `false` cancelled.

The working shape: a **synchronous** hook that passes through immediately when `isMirroring(actor)` or the status is not ours, and otherwise starts `handleStatusToggleIntent(...)` fire-and-forget with rejection logging before returning `false`.

Two things that still hold from the original: the mirror's own write **must** pass through, or the pair deadlocks — that is what `isMirroring` is for; and rejection must be logged loudly, because cancelling core then failing to re-apply leaves the boolean set and the effect absent. See CONTRACT §5b for the code shape and the caveat that the gates must be genuinely synchronous.

---

## 2. Open handoffs — T2.1 (crow sheet)

- **FIRST, because it unblocks a deletion:** remove the `spendSkillBonus` named import at
  `crow-sheet.mjs:8` and its uses at `:141` and `:635`, replacing them with
  `spendExpertiseBonus(actor, option, { distribution })`. Until this lands, T1.4's deprecated stub
  cannot be deleted without breaking the boot again.

- `crow-sheet.mjs:241,453` read the **deleted** `CROWS.backpackSize`.
- `crow-sheet.mjs:488` reads `prep.skill` / `prep.detail` — neither exists; the schema is `task` / `bonus` / `setOn`.
- **Prepare for Task is live in the helper and dead in the product.** T1.1 wired `rollTest({ ..., task })` and T1.5 owns the match, but *nothing passes `task`*. Read `system.preparedTask.task` and pass it through. Fold into the `:488` fix so the file is touched once.
  > T1.1 deliberately did **not** infer the task from `flavor` or `characteristic`: R:658 binds the bonus to "a specific task in a specific location", and guessing would silently consume a player's one-shot on an unrelated roll.
- Render `expertiseOverBudget` as a badge when it is a positive number. It is `null` when uncomputed — do not render on null.
- Ask for the wound slot on rest. T1.5 falls back to the lowest index with `autoChosen: true` so a rest never hard-fails, but the player should choose (R:524 "of the PC's choice").
- Display trait `usePool` remaining / `overused`.
- Advancement surface changed: `spendExpertiseBonus(actor, option, { distribution })` replaces `spendSkillBonus(...)`. `advancementOptions(crow)` supplies the dialog and tree grid, including `traitPurchaseInfo` per trait, and `.window` explains why a button is disabled.

## 3. Open handoffs — T2.2 (chat cards)

- **Read `legalExpertiseSpends(result, actor)`** (`expertise.mjs:109`). Do **not** filter by category yourself, or you will render six spend buttons where one is legal — the discipline gate (R:1451) is a refinement of the category check.
- The spellbook template reads `system.castType` and `system.duration`-as-string; both renamed. Use `system.durationLabel` and `system.target.text`.
- `targets[].tier` is what damage reads; the message-level `tier` only describes the roll.

---

## 4. ~~Unowned~~ — all three assigned, 2026-08-23

**Nothing in this section is unowned any more.** One closed, two dispatched.

| Item | Owner | State |
|---|---|---|
| `helpers/usage-die.mjs` | orchestrator | **CLOSED `03049bd`** |
| Pets (C:2429) | **T2.5** (`4ef6e99b`) | dispatched — rules + data only, no sheet UI |
| `helpers/crypt.mjs` | **T2.4** (`ac87edba`) | dispatched |

Scope notes made at dispatch, because both one-liners below understate their items:

- **Pets is a subsystem, not an item.** C:2429 onward specifies ownership and transfer, a 2d10+Mind taming test with a full tier table, pet backpack slots that **take wounds like a PC's**, riding costing **6 slots**, daily feeding scaled by size (Large ×2 / Huge ×4 / "Holy Shit" ×8), and a barding table (Medium ×2/+0, Large ×4/+2, Huge ×8/+4). Nothing exists today: `spellcasting.mjs:163` credits "the pet machinery" to T1.6, but T1.6 only gated a stables purchase by power — that comment is a dangling reference. `actsAsPet` is consumed by **nothing**. T2.5 is scoped to model + rules + tests and must hand back a named UI field list, because T2.1 and T2.2 are live in every sheet a pet would touch. `MonsterData` already carries `size` and `power`, which is what barding and the Pet Shop need.
- **The crypt "invisible" framing below is already false.** `crypt.mjs:45-51` models Boon of Disappearance as `applyTo: "narrative"` — it emits text and sets no condition. The real gap is that C:2925's duration (*"invisible for a number of **combat rounds** equal to the crypt's level"*) is tracked by nothing, and combat rounds are a different clock from the dungeon-turn expiry the conditions use. T2.4 decides narrative-with-a-reason vs real duration tracking.
- **Also flagged to T2.4 as an MCDM question:** the book says *"you can **use** this boon"* for Disappearance and Flight but *"**expend**"* for the rest, while the preamble says expending removes it and Boon of Rescue explicitly grants multiple uses "before it is expended". Whether "use" consumes is genuinely ambiguous.

| Original detail | |
|---|---|
| ~~**`helpers/usage-die.mjs`**~~ | **CLOSED `03049bd`.** Rolled **one** d6 regardless of pool size; R:**562** (not R:200 — that is the Tests chapter) says roll *all* and remove each showing 1-2, so a 3-UD torch decayed at **⅓** the published rate. Fixed by sharing `resolveUsageDicePool`, which the backlash path already had right — the rule now has one implementation, moved to `usage-die.mjs` and re-exported from `dungeon-turn.mjs`. 14 tests, mutation-verified. Also hardened that function's input filter: `Number(null)` is 0, finite and `<= 2`, so a null face silently removed a die. |
| **Pets (C:2429)** | Nobody in Wave 1 owns them. T1.6 models only the stables gating purchase by power. T1.8's `summonBehaviour(system)` returns `{summons, actsAsPet, requiresCommandTest:false}` — trust `actsAsPet` **only** for `kind === "creature"`; a summoned object is not yours to drive. |
| **`helpers/crypt.mjs`** | Boon of Disappearance (C:2925) grants "invisible", but `invisible` was deleted as a condition — hiding is a *test* in PT2 (R:408). Needs a home that is not a condition flag. Also `getInstitutionLevel("crypt")` now returns 6 at crypt 5 + Prosperity 10 (C:2943), which can disagree with the standalone `crows.cryptLevel` fallback by 1. |

---

## 5. Open decisions

1. **Per-target expertise gating.** `canSpendExpertise` gates on the **base** `result.tier >= 3`, not per-target. Reachable: base tier 3 with a target at tier 1 (two banes) refuses a spend that would help. Frozen, so T1.1 implemented it literally. Wave 2 or MCDM.
2. **F:714 crit X/Rest refund** does not say *which* feature when several have spent uses. T1.1 refunds the first in stored order — deterministic and identical on every client. If it is a player choice, the picker belongs on the card and `xRestRefundOnCrit(xRest, name)` already takes an explicit name.
3. **Per-target modifiers have no input channel.** `rollTest` takes edges/banes/mods at roll level only, but flanking, high ground, cover, concealment and the range penalty are all per-target. T1.7 promotes on single-target (resolves identically) and warns on multi-target rather than applying one target's cover to everyone. The proper fix is `rollTest` accepting per-target modifiers — `TestResult.targets[]` already carries them, so only the input signature lags.
4. **Backlash UD storage shape.** T1.5 proposed `effect.flags.crows.ud = {current, max}` and said plainly it was inventing a contract for T1.8. Dead code until something writes the flag; T1.8 may move it.

---

## 6. Wave 3 content dependencies

- **`ArmorData` has no `qualities` field** (weapons do), so "Silent" (C:2140) has nowhere to live. T1.7 falls back to the item name.
- **`coin-purse.yaml` does not set `purse.isPurse: true`** — no shipped purse is a purse yet. **Confirmed live on 2026-08-23** against the booted world: the compendium Coin Purse reads `{isPurse: false, held: 0, baseCapacity: 500}`, and `src/packs/crows-gear/coin-purse.yaml` has **no `purse:` block at all**, so the value is only the schema default. Nothing else in `crows-gear` claims `isPurse`.
  **This is a live player-facing bug, not just missing content.** `character-creator.mjs:191` name-matches `wantedItem.name === "Coin Purse"` and stamps `{isPurse: true, held: 0, baseCapacity: 500}` at creation, so a **wizard-made crow gets a working purse while a purse dragged in from the compendium does not** — it silently holds no coins. The name match also means a renamed purse, or any second purse item, gets nothing.
  p11 passes *because* of the workaround and therefore hides the bug — the same "green on the happy path, wrong on the other path" shape as §7. Fix: stamp the YAML, repack, then delete the creation-time special case. Do not add a second name match anywhere.
- **`targetNeedsReview` flags 5 of 25 spellbooks** — Summon Object, Cacophony, Create Water, Deadspeech, Minor Phantasm. Transcribe PT2 target lines using R:1467's vocabulary and the `Summoned` keyword.
- **Backgrounds are re-transcribed, not migrated** (C:89–602). Until then, H5's budget reports "skipped" for every actor — correct by design.
- **`CrowData.crafting.projects`** still carries PT1's `prereqBonus`/`hasRecipe` and has no field for the PT2 prerequisite (expertise **+ uses**, R:1540). T1.6 validates at project start and does not persist it.
- **`stackKind` has no home in `physicalItemFields()`** — T1.2 resolves it, then falls back to `type:subtype:stackMax`.
- **`TraitData` cannot declare "grants purse capacity"** — T1.2 matches Bursting Purse by compendium id `ctthie42brstprs0` with a name fallback.

---

## 8. Live verification — world `crow-test` reloaded onto 0.2.0, 2026-08-23

Hard-reloaded at `923cb5a` after 13.8h on 0.1.3. **The system boots clean.**

| Check | Result |
|---|---|
| Console errors since reload | **zero** (one benign MCP-relay warn) |
| `CONFIG.statusEffects` | `blessed, grabbed, prone, unconscious, vulnerable, weakened, dead` — `boned` gone |
| id-keyed status access | **works** — `CONFIG.statusEffects["vulnerable"]` resolves, so T2.3's proxy fix holds |
| `game.crows` surface | 61 keys |
| Actor / Item types | `crow, monster` / 8 item types |
| **p02 config** | **PASS** — 30 expertises, belt 4, 6 conditions, `skills` and `backpackSize` both `undefined` |
| **p11 creation** | **PASS** — every sub-check; *Acolyte of the Gardner*, 7 expertises, 3d6=10 gold, 6 rations, actor and chat cards cleaned up |

**`system.json` version still reports `0.1.3`** from the server. That is expected and cosmetic: Foundry reads the manifest at *world launch*, not at tab reload, so the string is stale while the executing code is 0.2.0. The v0.1.3→HEAD diff of `system.json` touches only `description`, `version` and `compatibility.minimum` — no `documentTypes`, packs or esmodules change — which is *why* a browser reload is sufficient here. A future manifest change to any of those **will** require a real world relaunch, not a reload.

### p11 was stale, not broken
It destructured `createCharacter` from `game.crows.creator`, but the public name is `creator.create` (`module/crows.mjs:203`) — same function, same signature. It failed with `createCharacter is not a function`, which reads like a wiring gap and is not one. Fixed to bind the public name, so the probe now tests what actually ships.

### ⚠ `dev/` is in `.gitignore` — the probes are not version-controlled
`.gitignore:17` ignores `dev/`, so every probe named in a Wave 2 acceptance criterion lives on **one disk only**, never appears in `git status`, and is absent from a fresh clone. Agent updates to p08/p09 are therefore invisible to review and unrecoverable if this checkout is lost. Same failure mode as the two untracked template partials that `7bcc486` rescued. **Decide whether to track `dev/probes/`** — deliberately not changed mid-wave, because un-ignoring `dev/` would change what both running agents' `git add` picks up.

## 7. The failure shape this wave kept producing

Every significant defect had the same signature: **no error, no red test, a confident wrong answer on real data.**

| Found by | Defect |
|---|---|
| T1.8 | `summonBehaviour` matched **0 of 25** shipped spellbooks — including *Summon Object* |
| T1.8 | Any of six spellcasting expertises passed on any casting (R:1451 names *the* discipline) |
| T1.7 | Edges double-counted at the seam — they clamp at 2, so one duplicate is a whole tier shift |
| T1.2 | `schema.mjs` boot blocker — the shim never imports data models, so that tree is untested by construction |
| T1.2 | Six more dead imports from `chaos.mjs`, in a second file, on nobody's list |
| T1.3 | Migration flagged a **legal** potion stack as broken — a false alarm on correct data |
| T1.5 | `usage-die` rolls one d6 for any pool size |
| T1.5 | `consumePreparedTask` had no caller — set, stored, read by nothing |
| T1.4 | `C:669` "Minimum Modifier" says the floor is **1**; the contract froze 0 |
| T1.3 | The test fixture invented `system.containers`, a key that never existed in any commit |
| — | `config.test.mjs` asserted three wrong numbers and **passed anyway** (`24 > 22`, true for the wrong reason) |

**What actually caught them:** running code against the **real corpus** rather than a fixture; reading the **source book** rather than reasoning from first principles; and **mutation-testing the guard** — T1.2 broke its own boot test three ways to prove it could fail.

**What did not catch them:** four rounds of adversarial contract review, 42 passing tests, and `verify.sh`.
