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
- ~~Delete T1.4's deprecated `spendSkillBonus` stub~~ — **CLOSED, 2026-08-23.** The ordering
  warning was correct: `2e1737a` first moved CrowSheet to `spendExpertiseBonus`; only then did this
  close-out delete the obsolete export and replace its keep-alive test with a negative public-API
  contract. The advancement + entry-point boot seam is green, so the cleanup does not recreate the
  named-import boot failure T2.3 prevented.

### ⚠ The HUD interception trap — CORRECTED, the hook must be SYNCHRONOUS

The original wording here said to `await handleStatusToggleIntent(...)` and cancel core when it returns `handled: true`. **That is unimplementable.** T2.3 read the v14 source and found `preCreate`/`preDelete` are dispatched synchronously — core does not await the handler, so an `async` hook returns a truthy Promise and **core proceeds regardless**. Confirmed by probe on live 14.367: an async handler resolving `false` was ignored and the effect was created; a synchronous `false` cancelled.

The working shape: a **synchronous** hook that passes through immediately when `isMirroring(actor)` or the status is not ours, and otherwise starts `handleStatusToggleIntent(...)` fire-and-forget with rejection logging before returning `false`.

Two things that still hold from the original: the mirror's own write **must** pass through, or the pair deadlocks — that is what `isMirroring` is for; and rejection must be logged loudly, because cancelling core then failing to re-apply leaves the boolean set and the effect absent. See CONTRACT §5b for the code shape and the caveat that the gates must be genuinely synchronous.

---

## 2. ~~Open handoffs — T2.1 (crow sheet)~~ — **CLOSED**

The runtime migration landed in `2e1737a`, and the complete Playtest 2 sheet surface landed in
`5ed5f35`: derived backpack layout, `preparedTask.task` display and roll-through, the positive-only
expertise-budget badge, explicit wound-slot selection on rest, trait pool remaining/overused, and
the full `advancementOptions` dialog/tree surface. This close-out removed the final deprecated
`spendSkillBonus` export after proving the current sheet and entry point no longer import it. No
T2.1 obligation remains open. After a hard reload on Foundry 14.367, both the module and
`game.crows` exposed `spendExpertiseBonus` and neither exposed `spendSkillBonus`; the world booted
ready with no new system error. Suite: **854 tests / 159 suites / 0 fail**, both verify modes 0.

### ~~Open cross-owner follow-up — advancement-window lifecycle~~ — **CLOSED**

`takeRest()` now opens `flags.crows.advancementWindow` only after the call reaches its existing
`{ok:true}` completion boundary, including the deliberately benefit-granting `interrupted:true`
path. The write is after the rest card and automatic Miasma resistance test. `rollTest()` is the
agreed close boundary and awaits the persisted `false` before prepared-task consumption, dice,
chat, or commit hooks; failure to close refuses the test. Repeated bonus claims and distinct trait
purchases remain legal during the phase. Failed rests never open it, and absent/null remains the
permissive migration state rather than being bulk-stamped closed.

The final transition is after rest benefits/activity/card have committed, so it is not safe to
retry the whole rest if that transition fails. An automatic Miasma-test or final open failure now
returns `{ok:false, completed:true, partial:true, retryRest:false}`, emits one visible "do not
repeat the rest" error, and retains the applied benefits. The Miasma failure path never opens and
best-effort restores an explicit closed gate. `game.crows.advancementWindow.{get,open,close}` is
the Ref-facing diagnosis/recovery seam; retry only `open(actor)` after resolving the underlying
failure.

This is an explicit product policy: the printed rule says only "at the end of a rest" and defines
no duration. The boundary is intentionally **the next test**, not the old over-broad comment's
"when the crow acts again." Direct non-test crafting, crypt, inventory, condition, and sheet
mutations therefore remain outside this slice. The focused public-seam regression lives in
`test/advancement-window.test.mjs`; live acceptance must use temporary world actors only.

Acceptance on Foundry 14.367 hard-reloaded the checked-out tree and used one temporary crow. It
proved closed -> completed rest/open -> advancement claim/still open -> `rollTest` closed before
the Roll constructor -> later claim refused with no system mutation. An injected final-open
failure returned the non-retryable partial envelope, stayed closed, emitted the visible warning,
and recovered through the public `open(actor)` seam. The actor and all in-memory stubs were removed;
no messages or packs were written and no probe actor remained. Suite: **864 tests / 159 suites /
0 fail**, both verify modes 0. The only longer-window console warning was caused by the acceptance
probe itself calling deprecated `foundry.utils.objectsEqual`; the post-cleanup five-second window
contained no entries.

## 3. ~~Open handoffs — T2.2 (chat cards)~~ — **CLOSED**

`6d053e4` moved the spellbook sheet to `durationLabel` and structured `target.text`; `03c2c51`
made the persisted result flag the interactive card authority. `testCardData` delegates expertise
choices to `legalExpertiseSpends(result, actor)`, and its target rows preserve each
`targets[].tier` rather than substituting the message-level tier. Corpus and card-view tests pin all
three obligations. No T2.2 obligation remains open.

---

## 4. ~~Unowned~~ — all three assigned, 2026-08-23

**Nothing in this section is unowned any more.** All three assignments completed; Pets deliberately
handed its cross-owner product integration back to §7.

| Item | Owner | State |
|---|---|---|
| `helpers/usage-die.mjs` | orchestrator | **CLOSED `03049bd`** |
| Pets (C:2429) | **T2.5** (`4ef6e99b`) | rules + data **CLOSED `802f356`**; integration **OPEN §7** |
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

4. ~~**Backlash UD storage shape.**~~ — **CLOSED by D4, 2026-08-23. The complete 12-row UD lifecycle is implemented and tested.**

   **My brief's hypothesis was wrong and D4 corrected it.** I suggested the answer might be that one or zero backlash rows carry UD. In fact **12 of 55 rows do** — nine at 1 UD (01-02, 03-04, 39-40, 43-44, 45-46, 47-48, 59-60, 73-74, 77-78) and three at 2 UD (83-84, 97-98, 99-100). Verified independently. This is a first-class lifecycle, not machinery for one odd row.

   **Historical failure trace:** nothing initialized `flags.crows.ud`; `backlashUsageDice` had zero runtime callers; `rollBacklash` posted a chat message and never created an effect. A second ghost flag, `flags.crows.backlashRange`, made duplicate-durational detection dead, while the effect clock scanned only `crow` actors. D4 removes both ghost authorities.

   **Implemented contract:** one backlash-owned flag on an embedded ActiveEffect — `flags.crows.backlash = {sourceRange, duration: {kind: "ud", current}}`. There is **no `max`**, no core ActiveEffect `duration`, and no live-effect array on a data model. `rollBacklash` derives duplicate ranges from those live effects and creates the final post-reroll effect. On depletion the clock deletes the whole effect; it re-resolves by id before mutation, treats an already-completed delete as success, and never recreates a missing effect. An already-persisted `current: 0` is cleaned up without another roll.

   Ownership is now live: `backlash.mjs` owns the flag interface and effect creation; `dungeon-turn.mjs` owns *when* the actor-generic clock fires; `usage-die.mjs` owns *how* R:562 resolves — every effect roll goes through `resolveUsageDicePool`, with no second `1|2` filter. No backlash changes are invented from prose. If future v14 changes are authored, they are string-typed (`type: "add"`), never numeric `mode`, never `CONST.ACTIVE_EFFECT_CHANGE_TYPES.add` (that is priority 20).

   **Acceptance is pinned at public seams:** row 83-84 → effect at current 2 → faces `[1,6]` → current 1 → face `[2]` → effect deleted; a second 83-84 while active rerolls. `test/backlash.test.mjs` locks all 12 exact UD row counts and persisted pools, all 14 excluded duration rows, the committed-casting world-actor caller, the crow/monster clock split, orchestrator delegation, legacy sibling-flag absence, create-before-chat ordering, disappearance-before-update, missing-delete idempotence and zero-pool cleanup.

   **Live acceptance, Foundry 14.367 (2026-08-23):** after a hard reload, the public helper created the exact 83-84 flag at current 2 with no `max` or legacy `ud` flag; deterministic `[83,85]` rerolled the active duplicate to 85-86 without stacking; the focused clock persisted 2→1 on `[1,6]` and deleted the effect on `[2]`. The uniquely named probe actor and both probe chat messages were deleted and independently confirmed absent afterward.

   **Deliberate residuals:** D4 covers only the 12 UD rows. The other 14 durational rows still need explicit expiry kinds before they can own effects; arbitrary backlash prose mechanics are not structured; and the clock contract is single-GM because Foundry supplies no compare-and-swap primitive. The committed subscriber is pinned for world Actors; synthetic/unlinked-token actor identity remains outside D4 because the subscriber still re-resolves through `game.actors.get(actorId)`. The normal end-of-DT summary still omits the detailed backlash result even though `runEndOfDtEffects()` returns it.

---

## 6. Wave 3 content dependencies

- **The player-facing Rules journal disagrees with the canonical runtime backlash table at row 39-40.** `src/packs/crows-rules/conditions.yaml` retains a PT1 stacking clause, while `BACKLASH_TABLE` ends after “This effect has 1 UD.” Because stacking is derived from the canonical text, runtime correctly rerolls a duplicate 39-40 under the PT2 transcription. Reconcile the journal content later; do not make D4 read packs or silently change the module table.
- ~~**`ArmorData` has no `qualities` field** (weapons do), so "Silent" (C:2140) has nowhere to live. T1.7 falls back to the item name.~~ **WRONG ON BOTH COUNTS — corrected 2026-08-25 (T3.3).** Silent is an armor **enchantment**, not a quality (`C:1908`, table row `C:1933`), and `ArmorData.enchantment` is a blank-allowed `StringField` with no `choices`, so it holds it today. The real defect was in the consumer: `wearsSilentArmor` read `system.qualities`, which ArmorData never defines, so that branch was **unreachable** and only the item-name fallback could ever fire — a correctly-enchanted armor was invisible. Fixed to read `system.enchantment`; the dead branch is gone and the name match survives only as a fallback.
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
1. ~~**A real `bondPet` rest activity** in `REST_ACTIVITIES`/`_resolveActivity`, carrying `activityData.petUuid`, resolving ownership only on successful rest completion.~~ **CLOSED in the current bond-rest slice.** `bondPet` is registered before normalization, keeps its group/town claim, and the public `takeRest`/`takeTownActivity` paths resolve the exact full UUID at a finite world-time completion boundary. An uninterrupted six-hour rest and a completed two-hour town activity apply the one canonical `petOwnerUpdate`; an encounter-interrupted rest returns `waiting-for-rest` and writes nothing to the animal. Validation failures remain explicit nested activity failures while preserving the existing top-level rest contract. A rejected animal update is reported as unknown/non-retryable rather than confidently unchanged. Focused coverage pins exact expiry, every rule guard (including already-owned before prospective-owner mismatch), pre-benefit failure, one-write ordering, synthetic Token resolution without an id fallback, and the already-committed bond surviving a later non-retryable Miasma failure.

   **Live acceptance:** after a hard browser reload on Foundry 14.367 / Crows 0.2.0, the public `game.crows.takeRest` path bonded two temporary world Actors using the exact owner UUID and canonical four-field ownership update. Dungeon time, chat, and journals were unchanged; the console remained clean; both actors were deleted by captured id with no leak.

   **Deliberate residuals:** this is the Wave 1 engine/API seam; the CrowSheet picker stays with the deferred sheet owner. The stored pet state cannot enforce that this was literally the *next* activity after tier-2 taming, and Foundry has no cross-document CAS/transaction between crow rest writes and the animal ownership write. Do not invent a second pending marker or claim atomic rollback in this item.
2. ~~**`petContext` on `TestResult`** — `{kind: "taming"|"command", animalUuid, humanUuid, friendly?, startedAt?, needsTest?}` through `rollTest` → `message.flags.crows.test`, resolved by a `crowsTestCommitted` subscriber.~~ **CLOSED in the current pet-commit slice.** `rollTamingTest` and tested `rollPetCommandTest` declare exact contexts after caller options; `buildTestResult` clones the marker into the authoritative chat flag; spend and decline preserve it; and a fourth ready-time `crowsTestCommitted` subscriber resolves only the final tier. Taming captures a finite roll-start world clock, maps tiers 1/2/3 to refusal/following/ownership, and applies at most one pet write per message. Command maps all three final tiers; item 3 now owns the tier-2 condition side effect without changing this durable marker or final-tier boundary.

   The subscriber refuses contradictory/non-Handle-Pet results, raw or compendium ids, resolver identity mismatches, a different rolling actor, and stale ownership/type state after a pending card. Old flags with no marker are no-ops; ordinary-command and summoned-creature paths still follow the command inline but create no test marker or subscriber work. A rejected taming write is reported as unknown and non-retryable; same-client duplicate delivery is coalesced by message id.

   **Historical item-2 live acceptance:** after a hard browser reload on Foundry 14.367 / Crows 0.2.0, the public taming wrapper ran through the real `rollTest` flag and four-subscriber commit pipeline against temporary world Actors. A deterministic tier 2 committed once, preserved the exact marker in the chat payload, and wrote only the prospective owner plus the roll-start clock + 86,400 seconds. Before item 3 landed, the tested-command path committed once and returned the exact tier-2 `weakened: true` plan while leaving the canonical condition and every pet ownership field unchanged; item 3's later acceptance supersedes only that condition boundary. The probe created no chat messages; all three Actors were deleted by captured id; actor, chat, journal, world-time and hook counts returned to baseline; and the post-cleanup console was clean. After the final review fix, a second hard reload proved that missing, null, object and string `targets` values all stop before UUID resolution or any write; only canonical `targets: []` is targetless.

   **Residuals:** there is still no player-facing tame/command sheet action; a crash after the durable flag commit is not replayed on late join; different messages/clients can still race because Foundry has no CAS. The bounded ledger is client-local, not an atomic pet claim.
3. ~~**Command tier 2 returns `weakened: true`** — integration must call canonical `setCondition(pet, "weakened", true)`, never a raw status or Active Effect.~~ **CLOSED in the current command-condition slice.** Only a final committed tier-2 command calls and awaits the canonical condition boundary. The authoritative `system.conditions.weakened` boolean is written before its loop-guarded HUD mirror; an already-true condition is not rewritten, a missing mirror is repaired, and tiers 1/3 never clear an existing condition. Pending, stale-owner/type and malformed-context guards still stop before the condition seam, while same-message duplicate delivery shares one in-flight resolution.

   A rejected canonical Actor write returns `pet-condition-failed` with unknown state and `retryTest:false`; the ready-time subscriber shows one visible do-not-reroll/ask-the-Ref message instead of swallowing the fulfilled failure. A status-mirror-only failure leaves the landed canonical boolean authoritative and does not downgrade the command result. Cross-client/different-message races and the absence of a player-facing command action remain the item-2 residuals above.

   **Live acceptance:** after a hard reload on Foundry 14.367 / Crows 0.2.0, the public `game.crows.emitTestCommitted` path ran exact persisted command markers through all four subscribers. Tier 2 made one Actor update whose only system path was `system.conditions.weakened:true` (plus Foundry's `_id`/`_stats` metadata), then created one mirrored `weakened` status; the pet ownership fields did not move. Tier 1, tier 3 and a `needsTest:false` marker made no condition/status writes, while the adjacent taming control still wrote only prospective owner + roll-start time plus 86,400. A repeated tier-2 message id was refused by the public commit ledger. Six scratch Actors were deleted by captured id; the original four Actors, 144 chat messages, 33 journals, world time 0, zero scene tokens, inactive combat and all hook counts returned to baseline, with no new console error.

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
