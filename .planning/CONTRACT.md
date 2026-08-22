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

Exports: `ALL_EXPERTISES` (flattened, **stable order** general → spellcasting → weapon — sheets and migration tie-breaks depend on it) and `expertiseCategory(key)`.

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
| `pursePerSlot` / `purseBaseCapacity` | `1` / `500` | a purse occupies its slot alone (C:1917, C:1940) |
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
expertises: SchemaField({ <30 keys>: SchemaField({ uses: NumberField(min 0) }) })
// `max` is NOT stored — derived from TXP in prepareDerivedData (H6)

characteristics.{agility|mind|strength}.value : NumberField(min -5, max 5)   // was -1..3

woundSlots: SetField(NumberField(min 0))     // NO max — capacity is derived (M12)
                                             // REPLACES the `wounds` number

conditions: SchemaField({ blessed grabbed prone unconscious vulnerable weakened })
                                             // all BooleanField; `boned` deleted

xp.expertiseBonusesSpent                     // renamed from skillBonusesSpent
preparedTask: { task: String, bonus: 2, setOn }    // was { skill, detail, setOn }, +1 -> +2
npcConnection: { name, relationship, notes }       // NEW (C:40, C:2551)
crafting.projects[].expertise                      // renamed from .skill
currency: NumberField                              // LOOSE coin only; purses are ITEMS
```

**Derived (`prepareDerivedData`):**

| Field | Meaning |
|---|---|
| `ad` / `adMax` | summed from worn armor |
| `expertiseMax` | `expertiseMaxForTxp(xp.txp)` |
| `expertises[k].max` / `.overMax` | the cap, and any surplus — **surfaced, never clamped** |
| `expertiseSpentTotal` | total uses held |
| `backpackCapacity` | config base; a Wave 1 trait pass may raise it |
| `wounds` | count of wound slots **within** capacity (back-compat scalar) |
| `orphanedWounds` | indices **beyond** capacity — preserved, never dropped |
| `deadFromWounds` | `wounds >= capacity` (R:524). **Reporting, not adjudication** — evaluate death on wound GAIN, so a shrinking capacity cannot auto-kill |
| `effectiveSpeed` / `speedNote` | grabbed/unconscious → 0, prone → halved |
| `bonusesEarned` | `bonusesEarnedAtTxp(xp.txp)` |

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
expertises: ArrayField({key, uses})     // F:1397 — bare name = 1 use, "(2 uses)" = 2
xRest:      ArrayField({name, max, used})   // F:710; a crit refunds 1 use (T1.1 wires it)
creatureType: + "human"                 // F:1397 prints Type: Human
conditions: the six, plus `defeated`    // `boned` deleted here too
```

Derived: `hasSlots` (`slots > 0` — deliberately **no** separate boolean to drift), `wounds`, `orphanedWounds`, `deadFromWounds`.

> F:700 — a creature that gains another creature's stats **keeps its original slot count**. Migration and polymorph must not overwrite `slots` from a stat block.

---

## 4. `BackgroundData` — `module/data/item/background.mjs`

```js
expertises: ArrayField({ key: choices(ALL_EXPERTISES), uses: NumberField(min 1) })
                            // REPLACES skills:[String]. C:103 — "Benefaction (2 uses)"
characteristicAt2: String   // SEMANTIC CHANGE: names the characteristic SET TO 2 (C:28),
                            // not a +1. Renamed from characteristicBonus so no reader
                            // can mistake the meaning.
startingGold: "3d6"         // C:36
```

Derived: `totalExpertiseUses` — the sum. **This is the number the H5 budget needs**, and the reason the budget must run in the world-migration layer: it requires reading the background **Item**, which `migrateData(source)` cannot see.

---

## 5. `TraitData` — `module/data/item/trait.mjs`

Unchanged: `description tree tier column connectsTo isStarting restActivity`, derived `xpCost`.

**Two additions, both marked `// CONTRACT:` in the source:**

```js
slotGrants: ArrayField({ container: choices(containerKeys), count, restrictedTo })
expertiseGrants: ArrayField({ key: choices(ALL_EXPERTISES), uses })
```

`slotGrants` exists because critique M12 states backpack capacity is "config plus trait grants" and has `prepareDerivedData` read `backpackCapacity` — but **nothing could express a grant**, so capacity could never vary and the capacity-relative design was theoretical. `C:737` is a real case: *"You gain an additional belt slot that can only be used to hold alchemy items"* — `restrictedTo` carries that clause; `slots.mjs` (T1.2) enforces it.

`expertiseGrants` lets the H5 budget account for trait-granted uses instead of mistaking them for over-spend. Wave 3 populates it while re-verifying the 276 traits.

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
