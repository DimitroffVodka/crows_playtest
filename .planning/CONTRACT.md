# CONTRACT — the frozen shape (v0.2.0)

**Produced by:** T0.2
**Date:** 2026-08-20
**Status:** FROZEN. Wave 1 codes against this and must not restructure it.

This is the reference for parallel agents who must not read T0.2's in-progress
files. It describes what `module/config.mjs` and the data models **actually
contain** — it was written against the shipped code and the values below were
dumped from it, not transcribed.

Citations are `Book:Line` into the four MCDM Playtest 2 books: `R:` Rules,
`C:` Characters, `F:` Ref, `D:` Dungeons. See `.planning/PLAYTEST-2-MIGRATION.md`
for the mapping and `.planning/API-NOTES.md` for the verified v14 API facts.

---

## 1. `CROWS` — `module/config.mjs`

### Core resolution

| Key | Value | Source |
|---|---|---|
| `characteristics` | `{agility:"A", mind:"M", strength:"S"}` | |
| `charRange` | `{min:-5, max:5}` | R:174 |
| `charPcCap` | `4` — an **advancement** rule, not a schema bound | C:640 |
| `tiers` | `{t1Max:11, t2Max:16}` | R:210 |
| `doomFaces` | `[2,3]` — **2d10 sums**, not die faces | R:246 |
| `critFaces` | `[19,20]` — **2d10 sums** | R:244 |
| `edgeBane` | `{numeric:2}` — single edge +2 / single bane −2 | R:264 |

### Expertises (30, three categories)

Category gates what a test may apply. Attacks accept **weapon or spellcasting**
(R:913); castings accept **spellcasting only** (R:384); general applies to neither.

- **general** (18): `alchemy athletics blacksmithing enchanting endurance gymnastics handlePet historicalLore lift magicLore monsterLore natureLore navigate pickLock religiousLore search stealth thievery`
- **spellcasting** (6): `alteration benefaction conjuration elemental illusion necromancy`
- **weapon** (6): `bashing bow chopping slashing stabbing unarmed`

Exports:

- `ALL_EXPERTISES` — flattened in **category order** (general → spellcasting → weapon). This is the **display** order; sheets group by category and rely on it.
- `EXPERTISES_ALPHABETICAL` — the same 30 keys sorted by codepoint, **never `localeCompare`**. This is the **tie-break** order the migration's water-levelling uses.
- `expertiseCategory(key)`, `expertiseMaxForTxp(txp)`, `bonusesEarnedAtTxp(txp)`, `effectiveCapacities(grants)`.

> **These two orders are not interchangeable.** `blacksmithing` precedes `bashing` in category order and follows it alphabetically, so a tie containing both trims a *different* expertise depending on which list you use. The migration spec says alphabetically-first; use `EXPERTISES_ALPHABETICAL`.

### Inventory

| Key | Value | Note |
|---|---|---|
| `carryContainers` | `{hand:2, belt:4, backpack:10}` | belt was 2 in PT1 (R:428) |
| `magicSlots` | `["head","neck","waist","arms","finger","feet"]` | 1 item each (R:438) |
| `containerKeys` | `hand belt backpack head neck waist arms finger feet` | **the union — the only thing a `choices:` should use** |
| `equipSlotTypes` | alias of `magicSlots` | kept for `helpers/schema.mjs` |
| `stackLimits` | `{potion:5, lock:3, oil:2}` | default 1, same KIND only (R:432) |
| `handSlotsNeverStack` | `true` | R:432 |
| `coinPerSlot` | `250` | loose coins in one slot (C:1917) |
| `pursePerSlot` / `purseBaseCapacity` | `1` / `500` | a purse occupies its slot alone (C:1917) |
| `purseTraitBonus` | `500` | Bursting Purse, the only published increase (C:1737) |
| `corpseSlots` | `{tiny:1, small:2, medium:4, large:8, huge:16, holyShit:32}` | R:486 |
| `corpseStack` | `{tiny:3}` | every other size is 1 |
| `harvestDice` | `{tiny/small/medium:"1d6", large:"2d6", huge:"3d6", holyShit:"4d6"}` | R:652 |

> **`backpackSize` is DELETED.** Capacity is config **plus trait grants**, computed in `prepareDerivedData` (critique M12). Read `carryContainers.backpack` as the BASE only, never as the effective capacity. Wave 1 moved every former caller in `helpers/damage.mjs`, `helpers/slots.mjs`, and `sheets/crow-sheet.mjs` to the derived layout/capacity seams; no runtime caller remains on the deleted constant.

### Dungeon turns

`greedBonus {1:0.30, 2:0.20, 3:0.10}` (R:590) · `encounter {defaultEN:9, crowdedEN:8, bothEN:7, immediateOn:10}` (R:622)

### Conditions

`["blessed","grabbed","prone","unconscious","vulnerable","weakened"]` — R:526-558.

`boned` is **deleted** (replaced by banes + Weakened). `hidden`/`invisible` are **deleted** — hiding is a *test* in PT2 (R:408), not a condition. `module/conditions.mjs` exports `REMOVED_STATUS_IDS` listing all three so the migration can report them.

### Advancement (C:621, C:642)

| TXP | Bonus | Max uses |
|---|---|---|
| 100 / 500 / 1,250 / 2,250 / 3,500 | 1–5 | 2 |
| 5,000 / 10,000 | 6–7 | 3 |
| 20,000 / 30,000 | 8–9 | 4 |
| every 30,000 after | 10+ | 4 |

`expertiseMaxAtCreation: 2` · `expertiseUsesPerBonus: 3` (C:615) · `charAdvancement [5000,15000,30000]` · `retirementTXP 60000`

**End-of-rest advancement lifecycle.** The book defines when advancement is
available but not how long that interaction lasts, so Wave 1 adopts this
explicit product policy: a `takeRest()` call that reaches its `{ok:true}`
completion opens `flags.crows.advancementWindow`; the next `rollTest()` closes
it, awaited before prepared-task consumption, dice, chat, or commit hooks.
Current rest semantics deliberately grant benefits and return `ok:true` even
with `interrupted:true`, so that path opens too. The opener runs after the
automatic Miasma resistance test, otherwise that test would close the phase it
just created. Multiple legal bonus claims and distinct trait purchases remain
allowed while open; advancement writes never close it.

The flag is additive authority, not a `CrowData` field. `true` is open and
`false` is closed. Absent/null remains permissive as a migration compatibility
state until the first real lifecycle write; no migration bulk-stamps it false.
"Next test" is intentionally narrower than "next action": direct non-test
crafting, crypt, inventory, condition, and sheet mutations do not close the
window in this slice.

Rest benefits, its summary card, and any rest activity are already committed
before the final lifecycle transition. If the automatic Miasma test or the
window-open write then fails, `takeRest()` returns the explicit non-retryable
partial result `{ok:false, completed:true, partial:true, retryRest:false}` and
shows a visible "do not repeat the rest" error. It does not roll benefits back.
A Miasma-test failure never opens advancement and best-effort restores the
closed gate. The Ref can retry only the gate transition through
`game.crows.advancementWindow.open(actor)`; `get` and `close` expose the same
persisted authority for diagnosis and recovery.

**Exported helpers** (verified by `test/config.test.mjs`):

```js
expertiseMaxForTxp(txp = 0)   // 0->2, 99->2, 5000->3, 20000->4, 1e6->4
                              // BELOW the first row returns expertiseMaxAtCreation, NOT 0
bonusesEarnedAtTxp(txp = 0)   // 0->0, 100->1, 3500->5, 30000->9, 60000->10, 90000->11
```

---

## 2. `CrowData` — `module/data/actor/crow.mjs`

**Changed from PT1:**

```js
expertises: SchemaField({ <30 keys>: SchemaField({
  value: NumberField(min 0),   // uses REMAINING now — spending decrements this
  max:   NumberField(min 0)    // uses OWNED (background + advancement) — persistent
}) })
// The legal ceiling 2/3/4 is DERIVED as `expertiseCap`, and is a THIRD number.

characteristics.{agility|mind|strength}.value : NumberField(min -5, max 5)   // was -1..3

woundSlots: SetField(NumberField(min 0))     // NO max — capacity is derived (M12)
                                             // REPLACES the `wounds` number

conditions: SchemaField({ blessed grabbed prone unconscious vulnerable weakened
                          defeated })        // all BooleanField; `boned` deleted
                                             // `defeated` mirrors MonsterData so the
                                             // `dead` status has ONE mapping, not an
                                             // actor-type-dependent one

xp.expertiseBonusesSpent                     // renamed from skillBonusesSpent
preparedTask: { task: String, bonus: 2, setOn: String }   // setOn is a STRING
npcConnection: { name, relationship, notes }       // NEW (C:40, C:2551)
crafting.projects[].expertise                      // renamed from .skill
currency: NumberField                              // LOOSE coin only; purses are ITEMS
background:   StringField                          // the background's NAME
backgroundId: StringField                          // NEW — stable compendium id,
                                                   // stamped on first resolution
```

> **There is no embedded Background Item.** `applyBackground()` writes `system.background = bg.name` and that is all a PT1 actor carries. Anything needing the background's *grants* — H5's `backgroundUses` above all — must resolve `backgroundId`, else the name, against the `crows-backgrounds` compendium, stamp the id on success, and **report** on failure. An unresolved background must never be read as `0`: that produces the smallest budget and therefore the largest over-budget figure, exactly when the migration knows least about the character.

> **The three expertise quantities.** `R:294`: *"Each expertise has a number of uses, which is determined at character creation and can be increased through character advancement. You can use an expertise a number of times equal its uses. You regain all uses of an expertise when you finish a rest."*
>
> | | Stored? | Meaning |
> |---|---|---|
> | `value` | yes | remaining right now |
> | `max` | yes | permanently owned |
> | `expertiseCap` | **derived** | legal ceiling 2/3/4 for this TXP |
>
> A single mutable count cannot survive spend-then-rest: at 0 you cannot tell an expertise granted at 1 from one granted at 2 from one never owned, so rest cannot restore correctly — and restoring to the *cap* would mint uses nobody bought.
>
> - rest (`R:628`) → `value = max`
> - **rest in the Miasma (`R:1375`) → leave `value` alone**, everything else about the rest applies. This is inexpressible with one field.
> - advancement (`C:615`) → raise `max`, and `value` with it
> - **the H5 budget reads `max`**, never `value` — otherwise the reported over-budget figure shrinks every time a player spends.

**Derived (`prepareDerivedData`):**

| Field | Meaning |
|---|---|
| `ad` / `adMax` | summed from worn armor |
| `expertiseCap` | `expertiseMaxForTxp(xp.txp)` — the legal ceiling, 2/3/4 |
| `expertises[k].overCap` | `max − cap` — an over-allocation, **surfaced, never clamped** |
| `expertises[k].overMax` | `value − max` — should always be 0; reported, not trusted |
| `expertiseOwnedTotal` | Σ `max`. **This is the H5 budget's input.** |
| `expertiseRemainingTotal` | Σ `value` |
| `capacities` | `effectiveCapacities(grants)` — every container, base + trait grants |
| `backpackCapacity` | `capacities.backpack` |
| `wounds` | count of wound slots **within** capacity (back-compat scalar) |
| `orphanedWounds` | indices **beyond** capacity — preserved, never dropped |
| `woundCapacityFilled` | **REPORTING ONLY.** Renamed from `deadFromWounds`, which invited exactly the misuse its own comment warned against — it can flip true because capacity *shrank*. Death is adjudicated at the wound-**gain** mutation by comparing pre/post state and emitting `becameDead`. **Nothing may adjudicate from derived preparation.** |
| `effectiveSpeed` / `speedNote` | grabbed/unconscious → 0, prone → halved |
| `bonusesEarned` | `bonusesEarnedAtTxp(xp.txp)` |

> **Capacity has exactly one implementation.** `prepareDerivedData` collects `slotGrants` from the actor's trait items and calls the shared pure `effectiveCapacities()`. `slots.mjs` must call the same function. Previously this read a config constant and nothing summed grants anywhere, so the trait-aware capacity the contract promised was notional and the wound derivation could disagree with the layout.

> **`conditionNet` is DELETED.** It was `(blessed − boned)` as a ±1 on every roll. PT2 has no `boned`, and Blessed is an **edge** (R:532), not a numeric modifier — the two channels are explicitly separate (R:286). `helpers/roll.mjs` must build edges/banes instead. **T1.1 owns that.**
>
> The **wound speed penalty** (R:524, reading (c) — slots holding both a wound and an item) needs the positional `Layout`, so it is applied by `slots.mjs`, **not** here.

---

## 3. `MonsterData` — `module/data/actor/monster.mjs`

Covers monsters, humans and animals. Modelled against `F:1397` (the Sage).

```js
power:      NumberField(min 0)          // NO max — F:704 calls 0-50 a soft scale
slots:      NumberField(min 0)          // a COUNT; 0 means "a monster" (F:698)
woundSlots: SetField(NumberField)       // creatures WITH slots take wounds
reactions:  NumberField(initial 1)      // F:708
characteristics.*: NumberField(min -5, max 5)   // R:174 bounds EVERY creature
expertises: ArrayField({ key: choices(ALL_EXPERTISES), value, max })
                                        // same 3-quantity model as CrowData;
                                        // key CONSTRAINED so an OCR-split name
                                        // fails at load, not silently in content
xRest:      ArrayField({name, max, used})   // F:710; a crit refunds 1 use (T1.1 wires it)
creatureType: + "human"                 // F:1397 prints Type: Human
conditions: the six, plus `defeated`    // `boned` deleted here too
```

Derived: `hasSlots` (`slots > 0` — deliberately **no** separate boolean to drift), `wounds`, `orphanedWounds`, `woundCapacityFilled` (reporting only, as on CrowData), and `suspectMissingSlots` — true when a `human`/`animal` has `slots: 0`, which `F:698` says should not happen and is almost certainly an incomplete transcription for Wave 3 to fix.

> F:700 — a creature that gains another creature's stats **keeps its original slot count**. Migration and polymorph must not overwrite `slots` from a stat block.

### Pet bonding rest lifecycle

`bondPet` is a registered completion activity. Its durable input is
`activityData.petUuid`, always a full Foundry UUID; an Actor id is never a
fallback. World Actors resolve directly. A TokenDocument UUID resolves through
its `.actor`; a synthetic Actor UUID may retry only its exact parent Token UUID.
Raw ids and compendium Actor UUIDs are rejected before resolution, so this path
cannot mutate a source-pack document.

The rest engine reads a finite, nonnegative `game.time.worldTime` at the
activity-completion boundary and delegates eligibility to
`planBondingCompletion(animal, human, {now, restCompleted})`. That helper's
guard order and `petOwnerUpdate()` are authoritative. Only an `owned` plan is
persisted, exactly once, against the animal. The resting crow is the candidate
owner; the pet is never resolved by raw id and the crow is never given the pet
update.

- An uninterrupted `takeRest()` passes `restCompleted:true`. An interrupted
  rest passes `false`, so bonding remains `waiting-for-rest` with
  no animal write even though the separate frozen rest/advancement policy still
  grants ordinary benefits and returns `ok:true`.
- `takeTownActivity()` passes `true`: its two-hour rest activity is the printed
  town completion boundary.
- Missing/unknown/non-animal/wrong-owner/already-owned/expired inputs are an
  explicit nested activity failure. The enclosing rest/town activity keeps its
  existing top-level success contract, and validation never writes the animal.
- If `animal.update()` rejects, cross-document state is uncertain. The nested
  result is `pet-update-failed`, `state:"unknown"`, `retryRest:false`; never
  replay the completed rest. Later Miasma/window failures likewise do not roll
  back an already committed bond.

This is an engine/API slice. The CrowSheet picker remains with its deferred
sheet owner. The current pet state cannot prove that bonding was literally the
*next* activity after tier-2 taming, and Foundry provides no cross-document CAS;
both are explicit residuals rather than invented state in this slice.

---

## 4. `BackgroundData` — `module/data/item/background.mjs`

```js
expertises: ArrayField({ key: choices(ALL_EXPERTISES), uses: NumberField(min 1) })
                            // REPLACES skills:[String]. C:103 — "Benefaction (2 uses)"
characteristicOptionsAt2: ArrayField(StringField({ choices: agility|mind|strength }))
startingGold: "3d6"         // C:36
```

Derived: `totalExpertiseUses` — the sum. **This is the number the H5 budget needs**, and the reason the budget must run in the world-migration layer: it requires reading the background **Item**, which `migrateData(source)` cannot see.

> **`characteristicOptionsAt2` is an ARRAY, and that is load-bearing.** `C:28`: *"Your background makes one of your characteristics a 2. Sometimes the background assigns this increase. Other times it gives you a choice."* The 36 shipped backgrounds already contain all three forms — 30 fixed, **4 two-way choices** (`"mind or strength"`, `"agility or strength"`, `"agility or mind"`), and **2 `any`**. A singular string cannot hold a choice, and invites content to encode one as prose that T2.3 would have to parse and guess at.
>
> This is the background's **allowed set**. The player's actual pick lands in the actor's `characteristics`, never here.
> `fixed → ["mind"]` · `choice → ["mind","strength"]` · `any → ["agility","mind","strength"]`

---

## 5. `TraitData` — `module/data/item/trait.mjs`

Unchanged: `description tree tier column connectsTo isStarting restActivity`, derived `xpCost`.

**Two additions, both marked `// CONTRACT:` in the source:**

```js
slotGrants: ArrayField({
  container: choices(containerKeys),
  count:     NumberField(min 1),          // min 1 — see below
  restriction: { dimension: ""|itemType|gearSubtype|weaponType, values: [String] }
})
usePool: { sizedBy: ""|agility|mind|strength, fixedMax: Number, used: Number }
```

**Each restriction dimension names a real document path**, frozen so T1.2 does not have to invent one:

| `dimension` | path tested | legal values |
|---|---|---|
| `""` | *(unrestricted)* | — |
| `itemType` | `item.type` | `weapon` `armor` `gear` `consumable` … |
| `gearSubtype` | `item.system.subtype` | `CROWS.gearSubtypes` |
| `weaponType` | `item.system.type` | `CROWS.weaponTypes` |

> A first draft listed `consumableKind`, which **does not exist** on `ConsumableData`, and gave `weaponType` no path when the real one is `system.type`. Both were unimplementable.

`slotGrants` exists because critique M12 states backpack capacity is "config plus trait grants" and has `prepareDerivedData` read `backpackCapacity` — but **nothing could express a grant**, so capacity could never vary and the capacity-relative design was theoretical. `C:737` is the real case: *"You gain an additional belt slot that can only be used to hold alchemy items."*

- `count` is **min 1**. No published trait removes a slot, and a negative grant could shrink capacity into a character's wounds and kill them.
- The restriction is **structured, not a free string**. A bare `"alchemy"` is ambiguous — item type? gear subtype? trait tree? — and T1.2 would have to guess. `dimension` names the axis; `values` lists what passes on it. This also covers a holster restricted by `weaponType`.

`usePool` is a per-rest pool **sized by a characteristic**, which **four** published traits need — an earlier count of three missed the Agility one:

| Trait | Sized by |
|---|---|
| `C:921` benefaction | Mind |
| `C:1361` knowledge | Mind |
| `C:1501` necromancy | Mind |
| `C:1739` armor | **Agility** — *"a number of times equal to your Agility and then must finish a rest before"* |

**Frozen semantics**, because a characteristic is not a constant:

```
max       = sizedBy ? Math.max(1, actor.characteristics[sizedBy].value) : fixedMax
remaining = max(0, max - used)
rest      = used -> 0   (R:628)
overused  = max(0, used - max)
```

> **CORRECTED — the floor is 1, not 0.** This said `max(0, …)` and argued at length that a floor of zero "is not an error state." That was reasoning from first principles about a rule that exists and says the opposite. `C:669` is a titled rule, **"Minimum Modifier"**:
>
> *"Whenever a trait increases or decreases a number equal to one of your characteristics, the minimum number of that increase or decrease is 1, even if your characteristic is lower."* — `C:671`
>
> A Mind −1 crow gets **one** use, not zero. Found by T1.4, which implemented `max(1, …)` in `advancement.mjs` and correctly declined to edit a frozen T0.2 file to match.
>
> **The rule is general.** It governs *every* trait that scales off a characteristic, not just these pools — anywhere a trait increases or decreases by a characteristic, the magnitude floors at 1.

`overused` is reachable without cheating — spend at Mind 3, then take a Mind drain to 1. **Report it; never refund, and never clamp `used` downward**, which would silently hand back a spent use. `used` is stored rather than `remaining` for the same reason expertises store `{value, max}`: the pool size is derived and can move underneath you, so the durable fact is what was *spent*.

> **`expertiseGrants` was here and has been REMOVED.** Review found **no** trait in the corpus that grants a fixed expertise to its own owner. The real cases are dynamic and target something else: Tricks/Extra Tricks grant a *choice* of expertises to a **pet**, and Memorization grants the expertise of a chosen lore book *until replaced*. A fixed `{key, uses}` array on the owning crow's trait models neither, and the H5 budget spec never included trait grants. Those belong on the affected actor with source and expiry — T1.6's (pets) and T1.4's (advancement) call.

---

## 5a. `GearData` — the coin purse

```js
purse: { isPurse: Boolean, held: Number, baseCapacity: Number = 500 }
// derived: purseBaseCap (0 for non-purses), purseOverBase
```

**Trait-adjusted capacity — the allocation is frozen, because it is not divisible.** `C:1737` (Bursting Purse): *"You can carry an additional 500 gc in a coin **purse**."* Singular. With two purses the bonus cannot split and cannot repeat, so it lands on exactly one, and *which* must be deterministic or two clients compute different capacities.

```
effectiveCap(purse) = baseCapacity + (isBonusTarget ? CROWS.purseTraitBonus : 0)
bonus target        = greatest baseCapacity; ties -> lowest item id
```

Greatest-first because it is the only choice that never *reduces* total carrying capacity; the id tiebreak is stable across clients and reloads in a way inventory **order** is not. `gear.mjs` cannot see the actor, so it exposes the base only — **`slots.mjs` applies the bonus** when building `Layout.coin`.

Part 1.1 freezes `Layout.coin.purses[]` as `{id, held, cap}`, but **nothing owned either number** — `CrowData.currency` is explicitly *loose coin only* and a purse is an Item, so T1.2 had no source and the universal starting kit (*"an empty coin purse ... and 3d6 gc"*, `C:36`) was unrepresentable.

`C:1917` — *"An inventory slot can hold 250 loose coins or 1 purse that holds up to 500 gc."* `C:1737` (Bursting Purse) is the **only** published capacity increase: *"an additional 500 gc in a coin purse"* → `CROWS.purseTraitBonus`.

> An earlier note cited `C:1940` for per-quality-tier purse capacity. **`C:1940` is the Gear Prices row and says no such thing** — corrected.

---

## 4b. `TestResult` — amended during Wave 1 and D1

Five fields were **added** after the freeze. Additive only: no existing field changed meaning.

```js
attack:             object | null,    // the attack context, if this test was one
casting:            object | null,    // the casting context, if this test was one
miasma:             object | null,    // {kind:"resist"} for a Miasma resist test
petContext:         object | null,    // exact taming/command purpose and actor UUIDs
allowedExpertises: string[] | null,   // exact applicability, or legacy fallback
```

**Why it had to change.** `rollTest` was rendering the card with both and then discarding them, which broke the contract's own invariant — `API-NOTES.md` §4 requires the card to be a pure function of `message.flags.crows.test`, and a late-joining client could not render the Apply-T2/T3 buttons or name the spell from a flag that had dropped them. Two consumers were already reaching for them:

- `spellcasting.mjs resolveCastContext()` reads `result.casting.castId` first and otherwise scans `_pendingCasts` by actorId — ambiguous the moment one caster has two casts in flight. It was silently on that fallback.
- `combat.mjs onTestCommitted()` computes damage from `ctx.attack ?? {}`, and the hook path never supplied one.

**D1 makes expertise applicability part of that same persisted authority.** Both `rollTest({allowedExpertises})` and `buildTestResult({allowedExpertises})` default to `null`; new results always own the field, while an older flag with the field absent behaves as `null`. Arrays are copied into the result so a caller cannot mutate a posted decision later.

- `null` or absent uses the legacy kind/category table.
- `[]` declares that no expertise applies and therefore commits `"no-legal-spend"` immediately.
- A non-empty array is the exact allowed set and **replaces** the broad category table. The known-key check and spell-discipline defense still apply.

For a targetful result, efficacy reads the actual `targets[].tier` values and a spend is legal when **any** target is below tier 3. The base `tier` is used only for a targetless test. One spend raises the base and every target once, capped at 3.

**Miasma is also commit-bound once Endurance is legal.** A resist test persists `miasma: {kind:"resist"}`; the initiator posts the roll and applies nothing. The Miasma subscriber recognizes that marker on `crowsTestCommitted` and only then stamps the test, adds boned and rolls any tier-1 effect. Matching on the exact Endurance list would be lossy — an ordinary Endurance test is not a Miasma resist — and reading the tier in `rollMiasmaResist` would apply a pre-expertise result.

**Pet tests use the same durable purpose-marker pattern.** Fresh results own `petContext: null`; absent/null legacy and ordinary flags are harmless. Taming persists `{kind:"taming", animalUuid, humanUuid, friendly:true, startedAt}` and a tested dangerous command persists `{kind:"command", animalUuid, humanUuid, needsTest:true}`. `startedAt` is the finite world clock captured when the taming test begins, so a pending expertise choice cannot move the 24-hour follow window. Ordinary commands and summoned creatures that require no test create no context or commit event.

The pet subscriber accepts only a committed, targetless ordinary test whose exact applicability is `['handlePet']`, with no attack/casting/Miasma payload. It resolves the full live Actor UUIDs from the flag, verifies they are the documents returned, verifies the human is the actor who rolled, and rechecks animal/human/owner state after any pending window. Taming tiers then resolve to refusal, prospective following, or ownership. Command tiers resolve to their pure command plan; the tier-2 `weakened: true` condition write remains the separate Wave 1 item 3. No actor-id pending map or transient card option is authoritative.

**The emit signature is `(result, message)`.** T1.8 matched it; T1.7 subscribed as `(result, ctx = {})`, so a ChatMessage lands in its `ctx` and `ctx.attack` never arrives. Fix relayed.

**Also from T1.1, worth knowing before you read expertises anywhere:** a crow's `expertises` is a keyed object but a **creature's is an ARRAY** (§3). The frozen `canSpendExpertise` does `actor.system.expertises[key]?.value`, which refuses *every* monster spend as "no uses left". Use `readExpertiseUses(actor, key)`, which handles both shapes.

`resolveTier` also gained an optional `autoDoom` flag for R:552 (an unconscious creature auto-dooms Agility and Strength tests). It **suppresses `crit`**, so a rule-mandated doom on a raw 19 does not also grant a crit's extra action.

### The discipline gate changes card LIFECYCLE, not just which button is refused

`canSpendExpertise` originally gated by **category** only, so on a casting all six spellcasting expertises passed — a caster of an *alteration* spell could improve their result by spending *necromancy*. `R:1459` is singular: the discipline names **the** expertise. Found by T1.8, fixed by T1.1 in `2f2ce7e`. D1 keeps that discipline check after the new applicability branch:

```
state -> doom/terminal -> actual outcome improvable -> expertiseSpent
      -> known key -> (legacy category IF null | exact membership otherwise)
      -> DISCIPLINE -> uses
```

**The consequence Wave 2 must know about.** The gate feeds `hasLegalSpend`, and `hasLegalSpend` decides the A1 commit state. So a caster holding only necromancy and illusion who casts *alteration* now commits **`"no-legal-spend"` on the first render** instead of sitting `pending`. That is correct — the old path stranded T1.8's chaos roll and T1.7's Counter window behind a spend the player could never legally make — but it means the rule affects the card's lifecycle, not merely its buttons.

> **T2.2:** read the exported `legalExpertiseSpends(result, actor)`. Do **not** filter by category yourself, or you will render choices the persisted applicability gate rejects.

**A hazard class worth generalising**, from T1.8's `state` bug: a destructured **default** upstream of a correct guard — `state = "committed"` — turned `undefined` into a committed test before the guard ever saw it. The guard reads correctly in review and the defect is invisible at the assertion site. Audit defaults on any parameter that *gates* behaviour. T1.1 notes `buildTestResult` defaults `actor = null` with the same shape; that one is deliberate and tested (a null actor genuinely has no spend), but it is the same trap if ever called while intending to pass an actor.

---

## 4c. Backlash UD ActiveEffect lifecycle — D4

D4 covers exactly the 12 backlash rows whose canonical table text declares UD: nine at 1 UD (`01-02`, `03-04`, `39-40`, `43-44`, `45-46`, `47-48`, `59-60`, `73-74`, `77-78`) and three at 2 UD (`83-84`, `97-98`, `99-100`). The other 14 durational rows have no frozen expiry kind and remain outside this lifecycle; the system must not invent one.

`rollBacklash()` owns duplicate detection and creation. After the final row is selected (including the one allowed duplicate reroll), a UD row creates one embedded ActiveEffect on the caster with this sole persisted authority:

```js
flags.crows.backlash = {
  sourceRange,
  duration: { kind: "ud", current }
}
```

There is no `max`, no core ActiveEffect `duration`, and no parallel actor-model array. The effect carries a stable name and the row text as its description, but no `system.changes`: D4 is the complete UD identity/clock/deletion lifecycle, not a claim that arbitrary prose mechanics have been structured. Any future authored v14 change uses string `type: "add"`, never numeric `mode` or the priority constant.

A UD result without a caster Actor refuses before posting its backlash card. Posting a plausible chat result while silently omitting the only persisted lifecycle would recreate the half-seam D4 removed. Non-UD rows retain the existing narration-only path.

`tickBacklashUsageDice(actors, {rollD6})` is the focused clock seam; `runEndOfDtEffects()` delegates all world Actors to it while keeping item UD and condition expiry crow-specific. The clock rolls exactly one d6 per current die and passes the faces to the single R:562 owner, `resolveUsageDicePool()`.

- A partial decay updates `flags.crows.backlash.duration.current` on the re-resolved embedded effect.
- At zero, including an already-persisted `current: 0`, delete the entire ActiveEffect.
- Re-resolve by effect id before every update/delete. If it disappeared, skip the write; a delete error after the document is demonstrably gone is idempotent success. Never recreate it.
- This is a **single-GM clock** contract. Foundry document updates provide no compare-and-swap token, so simultaneous independent clients are outside D4; the re-resolution and deletion-wins rules are best-effort guards, not cross-client serialization.

---

## 5b. Conditions — authority AND command flow

`system.conditions` is **authoritative**; Foundry status effects mirror it for the token HUD. But "driven from the boolean, never the reverse" was too blunt and contradicted T1.7's brief, which says *bidirectional sync*. Taken literally, a Ref toggling a condition on the Token HUD would create a status effect the roll engine never sees. What is one-way is **authority**, not user intent:

```
1. HUD toggle is INTERCEPTED and translated into an update to
   system.conditions.<key>          — the toggle expresses intent, not state
2. the boolean is canonical         — every rule reads it
3. an idempotent, LOOP-GUARDED mirror adds/removes the status effect to match
```

> ### ⚠️ The interception hook MUST be synchronous. Verified on live 14.367.
>
> An earlier version of this section said to `await handleStatusToggleIntent(...)` and cancel core when it returns `handled: true`. **That is unimplementable.** Foundry dispatches `preCreate`/`preDelete` lifecycle hooks **synchronously** — it does not await the handler — so an `async` hook returns a Promise, the Promise is truthy, and **core proceeds regardless**. Found by T2.3, which read the v14 source rather than trusting this document. Confirmed by probe:
>
> | probe on `preCreateActiveEffect` | result |
> |---|---|
> | handler returns a Promise resolving `false` | **ignored** — the effect was created |
> | handler returns `false` synchronously | **cancels** |
>
> This is the project's recurring failure shape in its purest form: the code reads correctly, the `await` resolves, the cancel silently never happens, and the boolean and the effect drift apart with nothing erroring.
>
> **The shape that works:**
>
> ```js
> Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => {
>   if (isMirroring(actor) || !isOurStatus(effect)) return true;   // sync gates
>   handleStatusToggleIntent(actor, statusId, active)              // fire-and-forget
>     .catch(err => console.warn("crows | status intent failed", err));
>   return false;                                                  // cancel core
> });
> ```
>
> **The gates must be genuinely synchronous.** `isMirroring` and the is-this-ours check have to complete *before* the hook returns. If either sits behind an `await` inside the handler, the guard has not run by the time you return `false` — and you are back in the deadlock the loop-guard exists to prevent.
>
> **Log loudly on rejection.** Cancelling core and then re-applying asynchronously means a rejected promise leaves the boolean set and the status effect absent. A visible desync a Ref can fix beats an invisible one.

The guard is not optional: without it step 3 re-triggers step 1. Mirror only when the effect's presence actually disagrees with the boolean, and make the write a no-op when they already agree.

**`dead` ↔ `conditions.defeated`** is the one id where the two vocabularies differ. **Both** `CrowData` and `MonsterData` now carry `defeated`, so the mapping is a single rule with no actor-type branch — previously only monsters had it, and the mirror had nowhere to write for a PC.

**Ownership:** `module/conditions.mjs` and the hook registration in `module/crows.mjs` belong to **T2.3** (entry point), not T1.7. T1.7 supplies the condition *mechanics* and the mirror logic; T2.3 wires it. Neither may edit the other's file.

Condition *mechanics* are never Active Effect `changes`. Active Effects remain right for durational backlash effects (`R:1561`) and magic items — and there, v14 takes a **string** `type: "add"`; `CONST.ACTIVE_EFFECT_CHANGE_TYPES` holds priorities, not modes (`.add` is `20`). See `.planning/API-NOTES.md` §1.

---

## 6. Localization — `lang/en.json`

138 keys. Every one of the 30 expertises has a **label and a hint**, the hints taken verbatim from the rules' Use column (`R:300-347`) with OCR spacing artifacts repaired. Also: all 6 conditions + `defeated` with hints, `TYPES.*` for 2 actor and 8 item types, characteristics, tier/roll vocabulary, sheet labels, and three warning strings (`expertiseOverBudget`, `orphanedWounds`, `magicSlotOverload`).

---

## 7. What Wave 1 will find broken

This is expected and is Wave 1's job. Do not "fix" it from another task.

| Consumer | Breaks on | Owner |
|---|---|---|
| `helpers/roll.mjs` | `conditionNet` gone; needs the edge/bane channels | T1.1 |
| `helpers/slots.mjs` | `CROWS.containers`, `CROWS.backpackSize` gone | T1.2 |
| `helpers/damage.mjs` | `CROWS.backpackSize`, `wounds` as a stored number | T1.7 |
| `helpers/schema.mjs` | `CROWS.containers` → use `containerKeys` | T1.2 |
| `sheets/crow-sheet.mjs` | ~~`CROWS.skills`, `backpackSize`, leveled conditions~~ — closed by the Playtest 2 sheet rebuild | T2.1 |
| `helpers/crafting.mjs` | `crafting.projects[].skill` → `.expertise` | T1.6 |
| `data/item/*.mjs` (others) | `equipSlotTypes` still works — alias retained | — |

---

## 8. Verification

```
npm test        42 tests, 12 suites, 0 fail
./verify.sh     exit 0
node --check    clean on all changed files
```

`test/config.test.mjs` pins the invariants above — the `expertiseMaxForTxp(0) === 2` boundary, the `bonusesEarnedAtTxp` repeat rule, the 30-expertise catalogue, the deleted PT1 skill keys, `backpackSize === undefined`, and that the migration fixture is genuinely over budget. If a later edit drifts from this document, those fail.
