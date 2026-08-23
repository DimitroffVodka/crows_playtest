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

## 4. Unowned — needs assigning before it drifts

| Item | Detail |
|---|---|
| **`helpers/usage-die.mjs`** | Rolls **one** d6 regardless of how many UD an item has. R:200 says roll *all* and remove each showing 1-2 — a 3-UD torch decays at **⅓** the published rate. Live rules bug, no Wave 1 brief lists this file. |
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
- **`coin-purse.yaml` does not set `purse.isPurse: true`** — no shipped purse is a purse yet.
- **`targetNeedsReview` flags 5 of 25 spellbooks** — Summon Object, Cacophony, Create Water, Deadspeech, Minor Phantasm. Transcribe PT2 target lines using R:1467's vocabulary and the `Summoned` keyword.
- **Backgrounds are re-transcribed, not migrated** (C:89–602). Until then, H5's budget reports "skipped" for every actor — correct by design.
- **`CrowData.crafting.projects`** still carries PT1's `prereqBonus`/`hasRecipe` and has no field for the PT2 prerequisite (expertise **+ uses**, R:1540). T1.6 validates at project start and does not persist it.
- **`stackKind` has no home in `physicalItemFields()`** — T1.2 resolves it, then falls back to `type:subtype:stackMax`.
- **`TraitData` cannot declare "grants purse capacity"** — T1.2 matches Bursting Purse by compendium id `ctthie42brstprs0` with a name fallback.

---

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
