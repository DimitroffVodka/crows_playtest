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

- **Read the exported `legalExpertiseSpends(result, actor)`.** Do **not** filter by category yourself, or you will render choices the persisted applicability gate rejects — the discipline gate (R:1459) is a refinement of that applicability check.
- The spellbook template reads `system.castType` and `system.duration`-as-string; both renamed. Use `system.durationLabel` and `system.target.text`.
- `targets[].tier` is what damage reads; the message-level `tier` only describes the roll.

---

## 4. ~~Unowned~~ — all three assigned, 2026-08-23

**Nothing in this section is unowned any more.** One closed, two dispatched.

| Item | Owner | State |
|---|---|---|
| `helpers/usage-die.mjs` | orchestrator | **CLOSED `03049bd`** |
| Pets (C:2429) | **T2.5** (`4ef6e99b`) | dispatched — rules + data only, no sheet UI |
| `helpers/crypt.mjs` | **T2.4** (`ac87edba`) | **CLOSED `16e0040`** |

**T2.4 closed.** `getInstitutionLevel("crypt")` is now the boon-effect authority via an explicit `getCryptBoonLevel()`; all five runtime boon reads go through it, and the pure `resolveCryptBoonLevel({institutionLevel, readFallback})` makes a present institution value win **including 0**, so the legacy standalone value can only be read when there is no authority at all. Disappearance stays `applyTo: "narrative"` with the reason recorded in code. 786 tests / 150 suites / 0 fail, `verify.sh` and `--strict` both 0; commit touches only its three authorized paths. Mutation-verified — inverting the authority guard fails both divergence tests.

Three T2.4 findings worth keeping:
- **The real defect was subtler than this register said.** The old getter *already* hardcoded raw crypt 5 + Prosperity 10 → 6, so that happy path was not returning 5. The actual bug was **two authorities**: a separately settable legacy `cryptLevel` setting plus a duplicated getter that silently ignored pending upgrades and active institution modifiers which `getInstitutionLevel` already handles.
- **PT2 still defines Invisibility** — R:775-777, "treated as if you are in heavy concealment". What was deleted is the *condition flag*; hiding is a test at R:408. That supports narrative adjudication rather than undermining it.
- **No combat-round clock exists anywhere** in module, test or template code — only prose references (Disappearance, Flight, one backlash). T2.4 deliberately added no half-tracked Active Effect.

**Citation correction, and the error was mine:** the capstone sentence is **C:2943**, as this register originally said. I changed it to C:2947 while recording the assignment; C:2947 is the advancement-table lead-in. Re-derived by content (`grep "considered 6th level"`).

**The temple has the identical capstone and is NOT affected.** C:3120 "Higher Authority" is already modelled generically at `village.mjs:288` and resolved through the same `getInstitutionLevel`. The crypt was uniquely exposed because it alone carried a legacy standalone level setting.

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

1. ~~**Per-target expertise gating.**~~ — **DECIDED and IMPLEMENTED by D1, 2026-08-23. CLOSED. No MCDM question.**

   **Verdict (confidence 0.87):** add a roll-level `allowedExpertises: string[] | null` to `TestResult`; keep today's kind/category rules only as the `null` legacy fallback; and replace the base-tier no-op guard with *"at least one **actual target** tier is below 3, or the base tier for a targetless test."* One spend still raises every target by one tier, capped at 3.

   **Implementation closure:** the declaration now survives `rollTest` into the persisted result/flag and late-join card, and the efficacy gate reads actual target tiers. Weapon attacks declare their validated weapon type; castings their discipline; Miasma Endurance; and taming/dangerous pet commands Handle Pet. Natural monster attacks deliberately remain `null` because their schema names no authoritative expertise. Empty/exact/legacy contracts, both efficacy directions, mixed-target capping and all caller boundaries are regression-pinned; the `some`/`every`, empty/null and base/target mutations all went red. After a hard reload, a pure live probe confirmed all three applicability states and both target-efficacy directions.

   Luna's final regression review caught the Miasma caller reading and applying its pre-expertise tier. That path now persists `{kind:"resist"}`, returns without mutation while pending, and resolves actor/chat consequences only from its registered `crowsTestCommitted` subscriber. The Miasma marker is required because an exact Endurance list alone cannot distinguish this outcome from an ordinary Endurance test. A final hard reload confirmed the marked/unmarked flags and all three commit subscribers in the live world, with no system error. Final suite: **833 tests / 158 suites / 0 fail**; both verify modes 0.

   **T2.5 remains open beyond this shared gate.** D1 closes only Handle Pet applicability. Pet context in the persisted result/flags and the pet commit subscriber are still separate obligations in §7.

   `null` (absent) = legacy category path; `[]` = caller declares no expertise applies, commit immediately as `no-legal-spend`; non-empty = exact allowed set. **Absent and empty must stay distinct**, or an additive field becomes a breaking migration for existing flags.

   §5.1 and T2.5's `handlePet` facet are **two semantic questions sharing one gate**: applicability (which keys match the task) vs efficacy (whether the one spend can improve any resolved outcome). Neither should be expressed in terms of the other.

   Guard order, clarified by the owner during implementation: state → doom/terminal → any actual outcome improvable → already spent → known key → applicability (**legacy category only for null/absent; exact allowlist otherwise**) → discipline defense → uses. A non-null declaration replaces rather than narrows the category table.

   **This register's example was wrong.** It claimed "base tier 3 with a target at tier 1 (two banes)". **R:270**: two or more banes make a *double bane*, which subtracts nothing and drops the outcome **one** tier, to a minimum of tier 1 — so two banes give tier 2, not tier 1. The real case is simpler and worse: **a single bane suffices**, since tier 3 starts at 17 and −2 turns an ordinary 17 into 15 (tier 2). A numeric range penalty can drop a target further (17 with three squares beyond range = −6 → tier 1).

   Rules basis, all re-derived by content: **R:292** ("one applicable expertise… one expertise and one use per test", max tier 3) makes the spend roll-level, so do **not** add a per-target picker. **R:913** opens the weapon/spellcasting category on an attack but says *the appropriate* expertise. **R:1459** — *not* R:1451, which is "The spell contained in the pages of a book has the following statistics" — is the discipline precedent. **R:961** makes a multi-target effect one attack whose per-target results may differ.

   **Frequency: reachable, currently uncommon, and about to become common.** `combat.mjs:241-313` promotes per-target modifiers on single-target rolls and only warns on multi-target, so single-target cover lowers base and target together and never triggers this. Only three shipped attacks are multi-target (Spark, Bear/Claws, Ring Collector/Punches). **It becomes ordinary the moment §5.3's plumbing gap is fixed** — which is why D1 explicitly refused to fold §5.3 into this patch.

   Per-target modifiers that can diverge a target from base: cover (R:757), light concealment (R:769), heavy concealment/invisibility (R:773/777), ranged-adjacent (R:947), beyond-range −2/square (R:941), prone vs ranged (R:542); and *upward* — flanking (R:965), high ground (R:973), grabbed (R:536), prone vs melee (R:542), which expose the **inverse** no-op where base tier 2 offers a useless spend though every target is already tier 3. **Vulnerable is not one** (R:546 adds 1d6 damage only) and **Weakened is not one** (R:558 banes the roller's every test, so it hits base and all targets equally).
2. ~~**F:714 crit X/Rest refund**~~ — **DECIDED by D2, 2026-08-23. Route: CODE LATER. No Wave 2 change, no MCDM question.**

   **Verdict (confidence 0.90):** keep T1.1's deterministic first-spent fallback. Add no crit-time picker. Route Ring Collector's missing `xRest` transcription to Wave 3. Reopen only if official content ever ships a creature with two X/Rest features.

   **The decision dissolves on real data, and I verified this independently.** The entire shipped source contains **exactly one** X/Rest ability — `src/packs/crows-monsters/ring-collector.yaml:53`, Vanish, `uses: "1/Rest"` — and **zero files ship `system.xRest` at all**. So the monster model supplies `system.xRest: []` at runtime and **no shipped actor has even one mechanically tracked X/Rest feature**, let alone two spent at once. The multi-feature examples (`Roar`, `Shatter`) exist only in tests. There is no published ambiguous state for MCDM to adjudicate.

   **The premise checked out but `applyCritXRestRefund` is NOT dead** — `roll.mjs:382` calls it after `toMessage()` on every crit, and `rollTest` has monster-sheet, crow-sheet, attack, casting and miasma callers. It is a no-op on shipped content, not unreachable code.

   Rules basis, re-derived by content rather than trusting F:714: *"If a creature who has expended 1 or more uses of an X/Rest feature rolls a crit, they can regain 1 use of that feature as the crit's benefit."* Permissive (`can`) and feature-relative (`that feature`), but it never says "choose", gives no ordering rule and no multi-feature procedure — the authors appear to assume one such feature per creature.

   Cost of the alternative: a picker adds a prompt mid-roll-resolution, card lifecycle state, ownership/permission handling, cross-client race and dedupe, dismissal semantics and stale-card revalidation — all for an unpublished state, and landing on top of T2.2's live card work.

   **If it is ever needed:** keep the 0/1 behaviour untouched and change only the `>1` branch — non-blocking inline choices on the crit card for owner and GM, a Ref fallback for an unattended token, dismissal meaning *no refund* (because the book says `can`), one-shot claims, and revalidation against an at-crit snapshot so an old card cannot refund a later expenditure. `xRestRefundOnCrit(xRest, name)` already takes the explicit name, so the seam is cheap to keep.

   **Wave 3 content item:** transcribe Vanish explicitly as `{name: "Vanish", max: 1, used: 0}`. Do **not** add runtime parsing or name-matching between `traits[].uses` and `xRest` — that would create two mutable authorities, the exact defect shape T2.4 just removed from the crypt and the purse fix removed from creation. Found independently by **T2.2** as well, from a different direction.
3. ~~**Per-target modifiers have no input channel.**~~ — **DECIDED by D3, 2026-08-23. Route: CODE LATER, in a dedicated post-T2.2 ticket. Plus ONE thing to do in this wave.**

   ### Interim refusal CLOSED; the full per-target interface remains open
   **Implemented and live-verified 2026-08-23:** `attackWithWeapon()` now builds the target labels before Boon of Fury or `rollTest`, shows one `ui.notifications.warn`, and returns `{ok:false, error:"per-target-modifiers-unsupported"}` when a multi-target situation label has no lossless route. The worked rule example is pinned independently: raw 12 + characteristic 0 is **T2** against the clear target and **T1** against the covered target. The boundary regression carries an active Fury boon and a Roll sentinel; disabling the guard goes red, while the real guard makes **zero** Fury/attack rolls. After a hard reload, the live sentinel probe reported one warning and zero roll evaluations, roll messages, chat creates, commit events and damage calls. Suite: **814 tests / 155 suites / 0 fail**, both verify modes 0.

   **Why the refusal was required:** the former `attack.mjs:202` loop sent `labels.warnings` to **`console.warn` only**. It was absent from `TestResult`, `testCardData`, the template and `ui.notifications`, so the player saw a confident, ordinary target tier that was wrong. D3 ran the pure path: raw 12, target A clear, target B in cover — the old path gave both **T2 and dealt T2 damage to B**, where B's already-built cover bane gives **T1**. A loud refusal beats a false hit. The residual limitation is unchanged: the ordinary sheet caller supplies only conditions and no geometry, so attacks whose cover/range never enters the input still produce no warning.

   **Adjacent Fury swallowed-error follow-up CLOSED 2026-08-23:** this was fixed as its own test-first refusal/rollback ticket, without widening the per-target patch. The public `attackWithWeapon()` tracer first reproduced the damaging sequence exactly: Fury rolled `1d6`, the actor update cleared the boon, the Fury chat write failed, and the bare catch continued to `2d10`, an attack card and `crowsTestCommitted`, with no player notification. `consumeBoonOnDamage()` now snapshots the full active boon, refuses if it changes while Fury's dice resolve, and on a later failure restores it only while the current value still matches this call's expected spent state. A newer boon is left untouched and reported as `rollback:"conflict"`; an unconfirmed original update reports `"unknown"`; failed compensation reports `"failed"`. The `attackWithWeapon()` catch covers both its dynamic import and the helper call, turning either rejection into one visible notification and `{ok:false,error:"fury-consumption-failed",rollback}` before any attack roll; checked-in failure injection exercises the helper boundary, not a synthetic import rejection.

   The public seam pins pre-d6 failure, post-mutation restore, a pre-expenditure boon swap, a pre-restore concurrent change, an unconfirmed write, rejected or silently ineffective compensation, the warning fallback, and the unchanged success path. Ephemeral mutation probes went red when the notification was removed, cleanup failure lied about restoration, or only `boonId` was restored. After a hard reload, the live no-write sentinel saw the real Crypt-level `3d6`, one consuming update, one rejected Fury chat attempt, one full restore and one error notification; it saw **zero** `2d10` rolls, attack cards or commit events, and the browser reported no new console errors after cleanup. Suite: **841 tests / 158 suites / 0 fail**, both verify modes 0.

   **Explicit transaction boundary:** this is best-effort compensation around Fury consumption, not atomicity Foundry does not provide. Document updates have no compare-and-swap or attempt identity. Two overlapping calls can therefore snapshot the same Fury, both pass the value comparison and both receive the bonus; if one later fails, its value-only rollback can resurrect the other call's successful spend. The pre-spend and pre-restore comparisons catch different-value changes, not that same-snapshot race, and a rejected chat promise may also have committed remotely before the client observed its rejection. The transaction ends when `consumeBoonOnDamage()` succeeds: if the later `2d10`, template, attack card or commit path fails, the already-posted Fury card cannot be atomically unposted and this ticket does not restore the boon. Same-client serialization or a persisted attempt claim, cross-client atomicity, and that later attack-transaction problem all remain separate; do not describe this fix as all-or-nothing across Actor, ChatMessage and Hooks.

   **The register's premise was false.** "Only the input signature lags" holds *only* for target **conditions on weapon attacks**. Verified old trace: `targetLabels()` (`combat.mjs:162-218`) correctly built per-target cover/range, `buildAttackLabels()` left them in `labels.targets[]` on multi-target, and the former path then **discarded them**, passing only `targetRef(tokenId, conditions)`. The interim guard now stops that path instead; it does not create the still-missing channel. `rollTest` still cannot receive cover, flanking, high ground, concealment or range per target. Additionally **`TestResult.targets[]` carries no numeric mods at all** — only edges/banes/tier/terminal — so the claim is literally false for the range penalty before any downstream behaviour.

   **A second collapse, for spell attacks:** `castSpell` passes `casting` but no `attack`, so `rollTest` derives `kind="casting"` and does not snapshot targets; `targetEdgesBanes()` refuses any kind but `attack`; and the casting subscriber reads `result.tier`, never `targets[]`. So per-target resolution works for `attackOutcome` and does **not** work for castings.

   **PT2 genuinely intends one roll against many targets** (R:961) — not a Foundry convenience. Printed content reaches it: Split Shot, Split Alteration, Spark (2 targets), Stream (All).

   **Recommended shape:** extend the existing target snapshot rather than a parallel token-id map — `TargetInput = TargetRef & {modifiers?: {mods?, edges?, banes?}}`, defaults empty so every current caller is unchanged. Compose per target as roll-level + derived target-condition + explicit situation labels, then call `resolveTier()` **once**. Add `mods: Mod[]` to each persisted `targets[]` entry so a late-joining client can still explain why range moved a tier. **Remove the single-target promotion when this lands**, or the same label arrives at both levels. Do not dedupe by key in the resolver — heavy concealment deliberately uses two labels; prevent duplication by interface ownership. Snapshot targets **before** rolling; no post-roll target addition.

   Condition corrections worth keeping: **Weakened is roll-level** (banes the roller's every test), **prone is dual** (attacker's own = roll-level melee; target's = per-target), **Vulnerable never enters `rollTest`** (R:546 adds 1d6 at damage time, handled in `damage.mjs`).

   **MCDM question raised** — for a multi-target spell attack, which tier governs the chaos roll (any target's tier 1? the base tier?), and if a backlash results, does it replace the spell against *every* target including those at tier 2/3?

4. ~~**Backlash UD storage shape.**~~ — **DECIDED by D4, 2026-08-23. Route: CODE NOW as a complete vertical slice, or DELETE. Explicitly reject "keep the seam for later".**

   **My brief's hypothesis was wrong and D4 corrected it.** I suggested the answer might be that one or zero backlash rows carry UD. In fact **12 of 55 rows do** — nine at 1 UD (01-02, 03-04, 39-40, 43-44, 45-46, 47-48, 59-60, 73-74, 77-78) and three at 2 UD (83-84, 97-98, 99-100). Verified independently. This is a first-class lifecycle, not machinery for one odd row.

   **How dead it really is:** nothing initializes `flags.crows.ud`; `backlashUsageDice` has zero runtime callers; `rollBacklash` posts a chat message and never creates an effect. **And there is a second ghost flag** — `activeBacklashRanges` reads `flags.crows.backlashRange` at `spellcasting.mjs:530`, which **nothing writes**, so duplicate-durational detection can never fire. `_rollEffectUsageDice` also only scans `crow` actors, too narrow for an effect-generic clock.

   **Recommended contract:** one backlash-owned flag on an embedded ActiveEffect — `flags.crows.backlash = {sourceRange, duration: {kind: "ud", current}}`. **No `max`**: backlash UD never restores and the initial count is already authoritative in `BACKLASH_TABLE`. Do **not** use core ActiveEffect `duration` (UD is stochastic and advances on the system's end-of-DT event, not seconds/rounds/turns), and do **not** put a live-effect array on a data model — that reimplements embedded-document identity and creates a second authority. On depletion **delete the whole effect**, not just the flag, or its mechanics and duplicate marker survive the rules ending it. Deletion wins any race; re-resolve by id before update, treat a missing delete as idempotent, never recreate.

   Ownership: `backlash.mjs` owns the flag interface and creates the effect; `dungeon-turn.mjs` owns *when* the clock fires; `usage-die.mjs` owns *how* R:562 resolves — every effect roll goes through `resolveUsageDicePool`, no second `1|2` filter. If v14 changes are authored, they are string-typed (`type: "add"`), never numeric `mode`, never `CONST.ACTIVE_EFFECT_CHANGE_TYPES.add` (that is priority 20).

   **Acceptance path:** row 83-84 → effect at current 2 → faces `[1,6]` → current 1 → face `[2]` → effect deleted; a second 83-84 while active must reroll. Pin all 12 parsed row counts, not three samples.

---

## 6. Wave 3 content dependencies

- **`ArmorData` has no `qualities` field** (weapons do), so "Silent" (C:2140) has nowhere to live. T1.7 falls back to the item name.
- ~~**`coin-purse.yaml` does not set `purse.isPurse: true`**~~ — **CLOSED `fb4122d`.** Stamped in the YAML and the packed DB; the creation-time name match is deleted. Verified live across all three paths with the workaround already removed — compendium, **dragged-from-compendium** (the path p11 never covered) and wizard-created all report `{isPurse: true, held: 0, baseCapacity: 500}`. `baseCapacity` is deliberately left out of the content so it keeps tracking `CROWS.purseBaseCapacity`. Original finding below.
- **`coin-purse.yaml` does not set `purse.isPurse: true`** — no shipped purse is a purse yet. **Confirmed live on 2026-08-23** against the booted world: the compendium Coin Purse reads `{isPurse: false, held: 0, baseCapacity: 500}`, and `src/packs/crows-gear/coin-purse.yaml` has **no `purse:` block at all**, so the value is only the schema default. Nothing else in `crows-gear` claims `isPurse`.
  **This is a live player-facing bug, not just missing content.** `character-creator.mjs:191` name-matches `wantedItem.name === "Coin Purse"` and stamps `{isPurse: true, held: 0, baseCapacity: 500}` at creation, so a **wizard-made crow gets a working purse while a purse dragged in from the compendium does not** — it silently holds no coins. The name match also means a renamed purse, or any second purse item, gets nothing.
  p11 passes *because* of the workaround and therefore hides the bug — the same "green on the happy path, wrong on the other path" shape as §7. Fix: stamp the YAML, repack, then delete the creation-time special case. Do not add a second name match anywhere.
- **`targetNeedsReview` flags 5 of 25 spellbooks** — Summon Object, Cacophony, Create Water, Deadspeech, Minor Phantasm. Transcribe PT2 target lines using R:1467's vocabulary and the `Summoned` keyword.
- **Backgrounds are re-transcribed, not migrated** (C:89–602). Until then, H5's budget reports "skipped" for every actor — correct by design.
- **`CrowData.crafting.projects`** still carries PT1's `prereqBonus`/`hasRecipe` and has no field for the PT2 prerequisite (expertise **+ uses**, R:1540). T1.6 validates at project start and does not persist it.
- **`stackKind` has no home in `physicalItemFields()`** — T1.2 resolves it, then falls back to `type:subtype:stackMax`.
- **`TraitData` cannot declare "grants purse capacity"** — T1.2 matches Bursting Purse by compendium id `ctthie42brstprs0` with a name fallback.

Added 2026-08-23 from T2.2 and T2.5, both by counting the real corpus rather than inspecting a fixture:

- **Bear, Rat and Wolf are `animal` with `slots: 0`.** Found independently by both agents. They cannot carry pet inventory or take pet wounds, and they trip the contract's `suspectMissingSlots`. **4 of 7 shipped animals are usable as pets.** Neither agent patched the stat blocks to go green — this is content work.
- **All 11 source monster YAMLs omit `reactions`, `expertises` and `xRest`.** The sheet renders them; there is nothing to render.
- **Ring Collector encodes Vanish as trait `uses: "1/Rest"`** instead of `system.xRest`, so the X/Rest machinery cannot see it.
- **The pet trait tree is stale PT1 content** — Tricks / Extra Tricks still name removed PT1 skills (Climb, Hide, Jump, Sneak) while PT2's tree uses expertise vocabulary. Re-transcribe by book content.
- **`Animal Feed` does exist** (`crows-consumables/animal-feed.yaml`, cost 1, stackMax 6), so pet feeding has real content to consume.

### Pet integration obligations outside T2.5's ownership
Recorded so they are not lost — T2.5 could not land these itself.
1. **A real `bondPet` rest activity** in `REST_ACTIVITIES`/`_resolveActivity`, carrying `activityData.petUuid`, resolving ownership only on successful rest completion. **Unknown activities currently normalize to `none`**, so a sheet-only button would silently fail activity exclusivity — this project's signature failure shape.
2. **`petContext` on `TestResult`** — `{kind: "taming"|"command", animalUuid, humanUuid, friendly?, startedAt?, needsTest?}` through `rollTest` → `message.flags.crows.test`, resolved by a `crowsTestCommitted` subscriber. Avoids an actor-id keyed pending map and keeps late-join card purity.
3. **Command tier 2 returns `weakened: true`** — integration must call canonical `setCondition(pet, "weakened", true)`, never a raw status or Active Effect.

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

### ⚠ The pack build was broken for everyone — fixed in `fb4122d`
Every `npm run pack*` and `npm run unpack` script died with `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`. The fvtt CLI dereferences `currentPackageType` at `commands/package.mjs:308` **unconditionally**, even when `--in`/`--out` are supplied and the early guard above it has already been skipped — so no argument combination avoided it. The scripts now pass `--type System --id crows`.

**The running world holds the LevelDB lock**, so the packer cannot open `packs/` at all while Foundry is up: it fails cleanly (`Iterator is not open` / `Database is not open`) rather than half-writing, and the pack was verified intact both before and after. Content changes therefore either need the world down, or must go through Foundry's own compendium API — which is what `fb4122d` did. **Re-run `npm run pack:gear` when the world is next down** to confirm the build reproduces those bytes.

### ⚠ `dev/` is in `.gitignore` — the probes are not version-controlled
`.gitignore:17` ignores `dev/`, so every probe named in a Wave 2 acceptance criterion lives on **one disk only**, never appears in `git status`, and is absent from a fresh clone. Agent updates to p08/p09 are therefore invisible to review and unrecoverable if this checkout is lost. Same failure mode as the two untracked template partials that `7bcc486` rescued. **Decide whether to track `dev/probes/`** — deliberately not changed mid-wave, because un-ignoring `dev/` would change what both running agents' `git add` picks up.

## 7. The failure shape this wave kept producing

Every significant defect had the same signature: **no error, no red test, a confident wrong answer on real data.**

| Found by | Defect |
|---|---|
| T1.8 | `summonBehaviour` matched **0 of 25** shipped spellbooks — including *Summon Object* |
| T1.8 | Any of six spellcasting expertises passed on any casting (R:1459 names *the* discipline) |
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
