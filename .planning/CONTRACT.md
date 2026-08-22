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

> **`backpackSize` is DELETED.** Capacity is config **plus trait grants**, computed in `prepareDerivedData` (critique M12). Read `carryContainers.backpack` as the BASE only, never as the effective capacity. Callers still on the old constant, all owned by Wave 1/2: `helpers/damage.mjs`, `helpers/slots.mjs`, `sheets/crow-sheet.mjs`.

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

conditions: SchemaField({ blessed grabbed prone unconscious vulnerable weakened })
                                             // all BooleanField; `boned` deleted

xp.expertiseBonusesSpent                     // renamed from skillBonusesSpent
preparedTask: { task: String, bonus: 2, setOn: String }   // setOn is a STRING
npcConnection: { name, relationship, notes }       // NEW (C:40, C:2551)
crafting.projects[].expertise                      // renamed from .skill
currency: NumberField                              // LOOSE coin only; purses are ITEMS
```

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
  restriction: { dimension: ""|itemType|gearSubtype|weaponType|consumableKind,
                 values: [String] }
})
usePool: { sizedBy: ""|agility|mind|strength, fixedMax: Number, used: Number }
```

`slotGrants` exists because critique M12 states backpack capacity is "config plus trait grants" and has `prepareDerivedData` read `backpackCapacity` — but **nothing could express a grant**, so capacity could never vary and the capacity-relative design was theoretical. `C:737` is the real case: *"You gain an additional belt slot that can only be used to hold alchemy items."*

- `count` is **min 1**. No published trait removes a slot, and a negative grant could shrink capacity into a character's wounds and kill them.
- The restriction is **structured, not a free string**. A bare `"alchemy"` is ambiguous — item type? gear subtype? trait tree? — and T1.2 would have to guess. `dimension` names the axis; `values` lists what passes on it. This also covers a holster restricted by `weaponType`.

`usePool` is a per-rest pool **sized by a characteristic**, which three published traits need: `C:921` (benefaction), `C:1361` (knowledge) and `C:1501` (necromancy) all read *"use this trait a number of times equal to your Mind, regaining all uses when you finish a rest."* Same `used`-survives-the-spend reasoning as expertises.

> **`expertiseGrants` was here and has been REMOVED.** Review found **no** trait in the corpus that grants a fixed expertise to its own owner. The real cases are dynamic and target something else: Tricks/Extra Tricks grant a *choice* of expertises to a **pet**, and Memorization grants the expertise of a chosen lore book *until replaced*. A fixed `{key, uses}` array on the owning crow's trait models neither, and the H5 budget spec never included trait grants. Those belong on the affected actor with source and expiry — T1.6's (pets) and T1.4's (advancement) call.

---

## 5a. `GearData` — the coin purse

```js
purse: { isPurse: Boolean, held: Number, baseCapacity: Number = 500 }
// derived: purseCapacity (0 for non-purses), purseOverfull
```

Part 1.1 freezes `Layout.coin.purses[]` as `{id, held, cap}`, but **nothing owned either number** — `CrowData.currency` is explicitly *loose coin only* and a purse is an Item, so T1.2 had no source and the universal starting kit (*"an empty coin purse ... and 3d6 gc"*, `C:36`) was unrepresentable.

`C:1917` — *"An inventory slot can hold 250 loose coins or 1 purse that holds up to 500 gc."* `C:1737` (Bursting Purse) is the **only** published capacity increase: *"an additional 500 gc in a coin purse"* → `CROWS.purseTraitBonus`.

> An earlier note cited `C:1940` for per-quality-tier purse capacity. **`C:1940` is the Gear Prices row and says no such thing** — corrected.

---

## 5b. Conditions — authority AND command flow

`system.conditions` is **authoritative**; Foundry status effects mirror it for the token HUD. But "driven from the boolean, never the reverse" was too blunt and contradicted T1.7's brief, which says *bidirectional sync*. Taken literally, a Ref toggling a condition on the Token HUD would create a status effect the roll engine never sees. What is one-way is **authority**, not user intent:

```
1. HUD toggle is INTERCEPTED and translated into an update to
   system.conditions.<key>          — the toggle expresses intent, not state
2. the boolean is canonical         — every rule reads it
3. an idempotent, LOOP-GUARDED mirror adds/removes the status effect to match
```

The guard is not optional: without it step 3 re-triggers step 1. Mirror only when the effect's presence actually disagrees with the boolean, and make the write a no-op when they already agree.

**`dead` ↔ `conditions.defeated`** is the one id where the two vocabularies differ.

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
| `sheets/crow-sheet.mjs` | `CROWS.skills`, `backpackSize`, leveled conditions | T2.1 |
| `helpers/crafting.mjs` | `crafting.projects[].skill` → `.expertise` | T1.6 |
| `data/item/*.mjs` (others) | `equipSlotTypes` still works — alias retained | — |

---

## 8. Verification

```
npm test        27 tests, 8 suites, 0 fail
./verify.sh     exit 0
node --check    clean on all six changed files
```

`test/config.test.mjs` pins the invariants above — the `expertiseMaxForTxp(0) === 2` boundary, the `bonusesEarnedAtTxp` repeat rule, the 30-expertise catalogue, the deleted PT1 skill keys, `backpackSize === undefined`, and that the migration fixture is genuinely over budget. If a later edit drifts from this document, those fail.
