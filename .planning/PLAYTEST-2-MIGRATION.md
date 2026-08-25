# Crows — Playtest 2 Migration Plan (v0.1.3 → v0.2.0)

**Created:** 2026-08-20
**Re-cited:** 2026-08-20 — all line refs converted from the deleted concatenated master to `Book:Line` form. No claims changed.
**Source of truth:** `~/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026/Crows Playtest 2 Markdown/`

> ## ✅ THE BOOKS ARE NOW PINNED IN THE REPO — 2026-08-25
>
> `R:`/`C:`/`F:`/`D:` now address the copies in [`docs/source/`](../docs/source/README.md),
> not the Hub. **Cite those.** `docs/source/sync-books.sh --check` reports whether they still
> match the packet. This closes **L1** and makes the two-copies warning below moot — but read
> it anyway, because it explains the failure mode.
>
> **Every citation in this file and its siblings predates the 2026-08-25 rebuild and is
> stale.** All four books were regenerated between 07:44 and 07:59 that day: Rules
> 1,736→1,388, Characters 3,179→2,678, Ref 2,122→1,727, Dungeons 1,167→832. The line counts
> in the table below are the *pre-rebuild* numbers, kept as the audit trail.
>
> **Re-derive by content; never by offset.** The drift is not constant — the Miasma section
> moved 104 lines while the Conditions chapter moved 85.

Citations below use a book prefix:

| Prefix | Pinned file in `docs/source/` | Lines now | Lines before rebuild |
| --- | --- | ---: | ---: |
| `R:` | `R-rules-book.md` | 1,388 | 1,735 |
| `C:` | `C-characters-book.md` | 2,678 | 3,178 |
| `F:` | `F-ref-book.md` | 1,727 | 2,122 |
| `D:` | `D-dungeons-book.md` | 832 | 1,167 |
| `X:` | `X-changelog.md` | 149 | 149 |

Also referenced: `Crows Playtest Changelog.md` (MCDM's own PT1→PT2 delta), cited as "changelog".

**Card prefixes — added 2026-08-25 (T3.0 / H4).** The four books above contain **no
per-item stat blocks**. Spell tier bands, item costs, stack sizes and crafting recipes exist
only on the inventory cards, which PT2 ships as PDF. Those are extracted and pinned in
[`docs/source/`](../docs/source/README.md) — cite them with these prefixes, which all begin
with `I` so they cannot collide with the four above:

| Prefix | File in `docs/source/` | Pages | Lines |
| --- | --- | ---: | ---: |
| `IS:` | `IS-inventory-sheet.txt` | 1 | 21 |
| `IC:` | `IC-inventory-cards.txt` — **the main deck** | 7 | 465 |
| `IP:` | `IP-cards-by-profession.txt` | 36 | 1,878 |
| `IL:` | `IL-cards-pois-dungeons.txt` | 6 | 268 |
| `IA:` | `IA-cards-annotated.txt` | 7 | 461 |

Unlike `R:`/`C:`/`F:`/`D:`, these **are** pinned to a commit, and `docs/source/extract-cards.sh --check`
proves they still reproduce. Read the README before citing them: the cards are a grid, so
one line spans several unrelated cards and a value must be read down a column, never across
a row.

> ## ⚠️ THERE ARE TWO COPIES OF THESE BOOKS. Only the path above is authoritative.
>
> A second, **stale** copy sits at `~/FoundryVTT-Projects/obsidian-memory/obsidian-memory/10-Active-Projects/Crows/`. It looks identical — same five filenames — and it is not.
>
> | Book | TTRPG Hub *(authoritative)* | obsidian *(stale)* | |
> |---|---|---|---|
> | 01 Rules | **1,736** | 1,603 | **differs — 776 chars** |
> | 02 Characters | 3,179 | 3,179 | byte-identical |
> | 03 Ref | 2,123 | 2,123 | byte-identical |
> | 04 Dungeons | 1,168 | 1,168 | byte-identical |
>
> Every `R:` citation in these plans is against the **Hub** copy. In the stale copy `R:524` is a blank line and `R:983` is a forced-movement sentence — so a reader of the wrong copy concludes the citations are broken and "fixes" working numbers into broken ones. That nearly happened: T1.6 read the stale copy, reported a "~133-line drift", and warned that T1.8's backlash range ran past the end of the file. It did not; T1.8 had already transcribed all 105 rows from the Hub copy.
>
> **The drift is NOT a constant, so never bulk-fix by adding an offset.** Rest activities shift by 66 (`R:580-590` → `R:646-654`) while the crafting chapter shifts by 133 (`R:1532-1580` → `R:1665-1713`). An offset that fixes one lands in the wrong section for the other. Re-derive each citation by content.
>
> ~~`C:`, `F:` and `D:` citations are safe in either copy — those three books are byte-identical.~~
>
> **No longer true, and there is a THIRD copy.** The 2026-08-25 rebuild rewrote all four
> books, so no citation is safe in any unpinned copy. A third Rules Book also sits at the
> **packet root** (`…/MCDM Crows Public Playtest August-Sept 2026/01 …md`, 1,887 lines,
> stale since Aug 20) and was never documented here. Three divergent copies, all plausible.
>
> Pinning removes the question entirely: read `docs/source/`.

> **Why this changed.** The first draft cited a single `Crows Playtest 2 - Master.md` (8,379 lines), a concatenation of the four books behind a 14-line preamble. That file no longer exists and cannot be reproduced exactly. Every original citation was nevertheless *correct* — they resolve under a constant per-book offset (Rules −14, Characters −1752, Ref −4933), and all 76 were verified against the real text before conversion. If you meet an old `L####` ref in a sibling doc, subtract the offset for its book.

## Decisions

| Decision | Choice |
| --- | --- |
| Approach | Migrate the existing system in place on a branch → v0.2.0, **with** a world-data migration so Playtest 1 characters survive |
| Content scope | Full re-verify of all 437 existing docs **plus** new Dungeons Book / Ref Book content |
| Foundry floor | `minimum: 14, verified: 14` — drop the v13 claim |

Rationale for migrating rather than rewriting: the 2d10 tier core is unchanged (T1 ≤11 / T2 12–16 / T3 17+, doom on raw 2–3, crit on raw 19–20). Playtest 2 is a revision. 4,853 lines of live-verified module code and 437 transcribed docs are worth keeping.

---

## Part 1 — Rules delta

### 1.1 Breaking: Skills → Expertises (R:290–358)

The single largest change. **Not a rename.**

| | Playtest 1 (implemented) | Playtest 2 |
| --- | --- | --- |
| Shape | `skills.<key>.bonus` (0–2), added into the roll formula | `expertises.<key>.value` (remaining) / `.max` (owned), a spendable pool |
| When applied | Pre-roll, baked into `2d10 + char + skillBonus` | **Post-roll** — after seeing the result, spend 1 use to improve the result by one tier (max T3) |
| Limit | None | One expertise **and** one use per test |
| Refresh | n/a | All uses restored on finishing a rest (R:628); **not** restored when resting in Miasma |

Three categories, and category gates what a test can apply:
- **General** (18): Alchemy, Athletics, Blacksmithing, Enchanting, Endurance, Gymnastics, Handle Pet, Historical Lore, Lift, Magic Lore, Monster Lore, Nature Lore, Navigate, Pick Lock, Religious Lore, Search, Stealth, Thievery
- **Spellcasting** (6): Alteration, Benefaction, Conjuration, Elemental, Illusion, Necromancy — *castings only*
- **Weapon** (6): Bashing, Bow, Chopping, Slashing, Stabbing, Unarmed — *weapon attacks only*

Attacks accept weapon **or** spellcasting expertises (R:913); castings accept spellcasting only (R:384).

Key re-mapping from the PT1 skill list (34 → 30):

| PT1 skill | PT2 expertise |
| --- | --- |
| `climb`, `jump`, `swim` | **Athletics** |
| `hide`, `sneak` | **Stealth** |
| `sabotage`, `sleightOfHand` | **Thievery** (also absorbs lockpicking overlap) |
| `handleAnimal` | **Handle Pet** |
| `pickLock` | **Pick Lock** (retained, overlaps Thievery by design, R:350) |
| `lift`, `search`, `endurance`, `gymnastics`, all Lore, `alchemy`, `blacksmithing`, `enchanting`, `navigate` | unchanged |

Also new: "You're An Expert" (R:356) — having an expertise can waive a test entirely at Ref discretion. GM-facing, no automation needed.

**Blast radius:** 17 files. `crow-sheet.mjs` (57 refs), `advancement.mjs` (32), `crafting.mjs` (19), `rest.mjs` (13), `roll.mjs` (11), `sheet.hbs` (37). Plus 45 pack YAMLs.

### 1.2 Breaking: Edges & Banes (R:256–288)

Replaces most circumstantial ± modifiers.

- Edge = **+2**. Bane = **−2**.
- **Double edge** (2+): adds *nothing numeric*; improves outcome one tier (max T3).
- **Double bane** (2+): subtracts nothing; worsens outcome one tier (min T1).
- Cancellation (R:278–284): edge+bane → neither. Double edge + 1 bane → 1 edge. Double bane + 1 edge → 1 bane. Double edge + double bane → neither.
- **Bonuses and penalties are a separate track** (R:286) — masterwork tools' +2, ranged range penalty, Assist results, Prepare for Task. These explicitly do **not** count toward edge/bane tallies.

This means `rollTest` needs two independent modifier channels: `edges[]` / `banes[]` (counted, then resolved) and `mods[]` (summed). The current single `mods` chain conflates them.

Known edge/bane sources to wire: flanking (edge, R:965), high ground (edge, R:973), attacking a prone creature in melee (edge) / at range (bane) (R:542), hidden attacker (edge, R:408), ranged attack against adjacent creature (bane, R:947), improvised weapon (bane, R:953), sneaking above half speed (bane, R:408), Weakened (bane on all, R:558), Blessed (edge on all, R:532), grabbed target (edge, R:536), unconscious Mind-to-notice (double bane, R:554).

### 1.3 Breaking: Conditions (R:526–558)

| Condition | Status |
| --- | --- |
| **Boned** | **DELETED.** Replaced by banes + Weakened. ~65 refs across 11 files. |
| **Blessed** | **Redefined.** Was leveled ±1. Now: edge on all tests, and your attacks deal bonus damage equal to the characteristic used for the attack. Ends at end of DT. No longer leveled. |
| **Vulnerable** | **NEW.** Each time you take damage, take an extra 1d6. Ends at end of DT. |
| **Weakened** | **NEW.** Bane on all tests. Ends at end of DT. |
| Grabbed | Expanded — speed 0, can't flank, attacks against you gain an edge, you move with grabber, grabber's speed halved if same size or smaller, grabber can reposition you as a maneuver. Ends if grabber dies/goes prone/unconscious/lets go or moves out of range. |
| Prone | Expanded — speed halved, bane on melee attacks, can't flank, melee vs you gains edge, ranged vs you takes bane. |
| Unconscious | Mostly unchanged. Auto-doom on Agility and Strength tests, **double bane** on Mind tests to notice surroundings, attacks against you always hit at T3 (attacker may still roll for crit), any damage wakes you, a shout wakes everyone within 10 squares. |

"You can't gain a second instance of a condition you already have" (R:528) — conditions are now strictly boolean. The leveled `blessed`/`boned` NumberFields must become BooleanFields.

### 1.4 Breaking: Inventory (R:426–498)

- Belt: **2 → 4 slots.**
- The six magic-item slots (head/neck/waist/arms/finger/feet) are now a **separate axis** from carry containers (R:438). `CROWS.containers` currently conflates them into one map.
- **Contiguity:** a multi-slot item must occupy adjacent slots *of the same type*. No 10-foot pole across one hand + one belt; no backpack slots 2 and 7.
- **Stacking:** 5 potions, 3 locks, 2 oil flasks per slot. Same *kind* only (5 different potions is fine; 3 potions + 2 locks is not). Hand slots can't stack.
- **Coinage:** 250 gc max loose per slot — this is why a coin purse matters.
- **Wounds:** fill a backpack slot **of the PC's choice** (PT1 filled bottom-up). Speed −1 per backpack slot holding **both** a wound and an item (see the ambiguity note below). All backpack slots wounded = death.
- **Combat backpack retrieval (R:478):** maneuver, declare item, roll 1d10; if ≥ at least one of the item's backpack slot numbers you draw it, else you may only rearrange.
- **Magic slot overload (R:460):** more than one magic item in the same slot → can't rest, and 1d6 wounds at end of each DT.
- **Corpse slots (R:486):** Tiny 1 (stack 3), Small 2, Medium 4, Large 8, Huge 16, Holy Shit! 32 — plus the corpse's own equipment.
- Armor: choose one suit in your backpack as worn; can only change outside combat rounds (R:472).

> **Ambiguity to flag to MCDM (decided 2026-08-20 — shipping (c)):** R:524 reads "Each wound they take fills up a backpack slot of the PC's choice. For each slot occupied by a wound and an item, your speed is reduced by 1." Three readings:
>
> | | Reading | |
> |---|---|---|
> | (a) | every occupied slot — wound *or* item | **Rejected.** Speed is 5 (C:24) and the backpack is 10 slots (R:428), so a fully-loaded *unwounded* PC would already be at speed 0. |
> | (b) | every wound | Leaves "of the PC's choice" with no bearing on the sentence it introduces. |
> | **(c)** | every slot holding **both** a wound and an item | **Shipping.** Placement becomes the decision the text implies; dropping gear is a maneuver (R:480), so the incentive is actionable. |
>
> (c) is never harsher than (b) — the penalty is a subset of the wounds — and slots holding both must already be a legal state, or a fully-loaded PC could never take a wound and would be unkillable by wounds. Reading (b) stays available via the world setting `crows.woundSpeedRule: "wound-only"`.

### 1.5 Breaking: Creation & Advancement (C:14–42, C:603–659)

**Creation:**
- Background sets one characteristic to **2**. Remaining two are the player's choice of **{1, 0} or {−1, 2}** assigned freely.
- Characteristic cap is now **4** (schema currently `min: -1, max: 3` — both bounds wrong; needs −5..5 range with a PC-facing cap of 4).
- Starting kit: empty coin purse, knife, rope, 6 rations, **3d6 gc**.
- Background grants **1 use in some expertises** (some grant 2 — e.g. Acolyte of the Gardner gives Benefaction 2 / Elemental 2), a Stamina score, and a starting trait.
- Starting speed 5.
- New step 4: make an **NPC connection** in your village (C:40, C:2551).

**Expertise & Stamina Advancement (C:621)** — table fully replaced:

| TXP | Bonus | Expertise max uses |
| --- | --- | --- |
| 100 | 1st | 2 |
| 500 | 2nd | 2 |
| 1,250 | 3rd | 2 |
| 2,250 | 4th | 2 |
| 3,500 | 5th | 2 |
| 5,000 | 6th | 3 |
| 10,000 | 7th | 3 |
| 20,000 | 8th | 4 |
| 30,000 | 9th | 4 |
| every 30,000 after | 10th+ | 4 |

Each bonus is a choice of: 3 expertise uses distributed freely (including into expertises you don't have) without exceeding the max; **or** +2 Stamina max; **or** 1 expertise use +1 Stamina max.

**Characteristics Advancement (C:642):** 5,000 / 15,000 / 30,000 / every 30,000 after. +1 to one characteristic, cap 4. If all three are at 4, gain +2 Stamina max instead.

XP is earned from recovered treasure value ÷ number of players, excluding purchased/crafted/ally-owned/innocent-taken goods (C:605). Spending only at end of rest. Traits: starting traits 500 XP, must connect by line on the same tree, one purchase each (C:667). Retirement now needs **60,000 TXP**.

### 1.5b Breaking: Chaos Count deleted (R:1555–1567)

Playtest 1 modelled backlash risk as a **GM-secret, world-level Chaos Count** that accumulated across casts and triggered a backlash at a threshold. The v0.1.3 system implements this in `helpers/chaos.mjs` (102 lines).

**Playtest 2 replaces it with a per-cast roll.** Backlash now triggers on exactly two events:

1. **Doom on a casting.**
2. **Chaos roll** — on a **tier 1 that isn't a doom**, roll **1d6**; a **1** triggers backlash.

There is no accumulator, no threshold, and no world state. `chaos.mjs` should be **gutted, not migrated** — its world-flag counter has no Playtest 2 equivalent, and any existing world's stored count is dead data the migration should drop with a note.

Other spellcasting changes:
- Spellbook UD are rolled on **every cast** (R:1543); a **crit skips the UD roll entirely** (R:1545), making crits effectively free casts.
- Backlash still rolls **d100 + spell rank** on the 105-row table, resolves *instead of* the spell, but **still costs the UD roll** (R:1559).
- Duplicate durational backlashes re-roll unless they stack.

### 1.6 Rest changes (R:626–680)

- Rest = 6 uninterrupted hours, ≥4 sleeping, consume 1 ration. Restores **all** Stamina, **all** expertise uses, and removes **1 wound of your choice**.
- At the halfway point, effects that end at end-of-DT end, and end-of-DT UD are rolled (R:630).
- Rest activities — **Repair Armor** and **Seclude Camp** are new; others revised:
  - **Prepare for Task** — now **+2** (was +1), attaches to a *specific task in a specific location*, not a skill. Lasts until you finish another rest. (Current schema stores `preparedTask.skill` — needs to become free-text task + bonus.)
  - **Tend Wounds** — target must have ≥2 wounds, **can't be yourself**, they lose 2 instead of 1, once per rest.
  - **Harvest** — generic **monster parts** now, not specific organs: 1d6 (Medium or smaller) / 2d6 (Large) / 3d6 (Huge) / 4d6 (Holy Shit!).
  - **Repair Armor** — restore one armor/shield to full AD.
  - **Seclude Camp** — EN −1 during the rest; one person per group; doesn't require finishing the rest.
- **Rest Activities in Town (R:678):** up to **4 activities per day** without sleeping, each ~2 hours, benefits landing after the 2 hours instead of at end of rest. Exception: Tend Wounds still requires 4 hours' sleep and is once per day.

### 1.7 Encounters, DTs, Greed (R:586–624)

- Encounter check: roll **1d10 ≥ EN**. Default EN **9**; 8 if the level is crowded (>20 creatures) **or** the PCs left chaos behind; **7** if both.
- A rolled **10** = encounter happens immediately. A triggering roll of 9 or lower = the Ref telegraphs a sign now, encounter lands at their chosen point in the next DT.
- **Greed Bonus (R:590) — new:** treasure found in the first three DTs of a first-time dungeon entry is worth **+30% / +20% / +10%**. Once per dungeon per group of players.
- Outside a dungeon, 2 hours of fiction = 1 DT for UD purposes.
- DT length is configurable: 30 min default, 60 relaxed, 20 intense, or 1d6 rooms.

### 1.8 Combat (R:783–1114)

Mostly additive, but several automatable rules are new or restated:

- **Counter (R:983)** — reaction. When a creature within your melee reach gets a T1 on a melee attack / Grab / Knockback / Escape Grab against you, deal your weapon's **tier 2** damage. On their **doom**, deal **tier 3** instead. Doesn't trigger off a T1 opportunity attack.
- **Crit on an attack (R:957)** grants an extra action.
- **Ranged miss near allies (R:943)** — roll any die; on odd, hit a random adjacent ally for the weapon's tier 2 damage. On a **doom**, hit an ally for tier 3 automatically (R:945).
- Ranged beyond normal range: **−2 per square** (a bonus/penalty, not a bane).
- Flanking → edge; high ground (≥1 square above) → edge; ranged vs adjacent → bane.
- **Multiple targets (R:961):** one roll, but per-target edges/banes can make the resolved tier differ per target. Chat card must support per-target resolution.
- New sections to model or at least document: Reactions, Movement, Pets in Combat, Forced Movement, Toppling Objects, Surprised, Cover & Concealment (R:755–782).

### 1.9 Creature stats (F:688–732)

- **`power` is a new stat** — 0 to 50, general threat rating. Not on the current monster model.
- **Monsters have no slots** and die at 0 Stamina. **Humans and animals do have slots**, which count as backpack slots — so they can take wounds and be allies/pets.
- **`X/Rest` features** — limited-use abilities; a crit refunds 1 use.
- Some creatures have more than 1 reaction per round.
- Grab capacity: attacking ungrabbed targets forces release of an equal number of grabbed creatures (F:694).

### 1.10 Village, equipment, misc

- **No availability rolls.** Item availability is now purely a function of merchant institution level (changelog). The PT1 availability-roll code should be deleted, and institution level counts have changed.
- New institutions: **Barracks**, **Beacon**. Temple no longer sells crafting materials but *can craft for you*. Auction house no longer sells monster parts.
- Prosperity can be raised by spending 10,000 gc on village items.
- **Hirelings (C:2499)** — employment terms, control rules, what happens on PC death.
- **NPC Connection (C:2551)**, **Not Your Village (C:3158)**, **Founding Other Villages (C:3164)** — all new.
- **Sizes (R:410)** — Tiny → Holy Shit!. Already in `CROWS.sizes` but unused; now load-bearing for corpses and harvesting.
- **Pets (C:2429)** with stats and barding; **Vehicles (C:2489)**.
- **Overland travel** — hexes, travel procedure, pace, **Travel Roles (R:1171)**, Lost, Miasma.
- Monster parts genericized throughout — crafting materials simplify.

---

## Part 2 — Architecture changes

### 2.1 Roll pipeline rewrite (`helpers/roll.mjs`)

This is the keystone. Current `rollTest` computes a flat formula and posts an immutable chat card. Playtest 2 needs a **two-phase** resolution:

```
Phase 1 (roll):   2d10 + characteristic + Σ(bonuses/penalties) + Σ(edge/bane net)
                  → rawSum → doom/crit → base tier
                  → apply double-edge / double-bane tier shifts
                  → post an *interactive* chat card
Phase 2 (spend):  player clicks "Apply <expertise>" on the card
                  → decrement uses, improve tier by 1 (max 3), re-render card
```

Design notes:
- Doom and crit are computed from the **unmodified 2d10 sum** and override tier shifts in both directions (R:244–248: crit → T3 "regardless of banes"; doom → T1 "regardless of edges, expertises, and other bonuses"). **Expertise cannot rescue a doom** — enforce this.
- The expertise-spend button must be gated: only the actor's owner, only once per card, only a category-legal expertise, only if `value > 0` (the remaining pool, not the owned `max`).
- Store the resolution state in a message flag (`flags.crows.test`) so the card is re-renderable and the spend is idempotent under lag/double-click.
- `edges`/`banes` arrive as labelled arrays so the card can explain *why* ("flanking", "high ground", "weakened").

### 2.2 Data model changes

**`data/actor/crow.mjs`**
- `skills` → `expertises`: `{ <key>: { value: Number, max: Number } }` — `value` is remaining, `max` is owned. A single count cannot survive spend-then-rest.
- `characteristics.*.value`: `min: -5, max: 5` (PC cap of 4 enforced in advancement, not schema — magic can exceed)
- `conditions`: drop `boned`; `blessed` NumberField → BooleanField; add `vulnerable`, `weakened` BooleanFields
- `wounds`: Number → the wound *slot assignment* must be player-chosen, so this becomes a set of occupied backpack slot indices. **Unbounded above** — backpack capacity is config plus trait grants, and schema validation runs on source before derived data exists, so the bound is enforced in `prepareDerivedData` and at the mutation site. An index past the current capacity is orphaned and surfaced, never clamped or dropped; otherwise removing a slot-granting trait would silently heal a wounded character. Death is capacity-relative and evaluated on wound *gain* only, so a shrinking capacity flags for the Ref rather than instantly killing someone.
- `xp.skillBonusesSpent` → `xp.expertiseBonusesSpent`
- `preparedTask`: `{ skill, detail, setOn }` → `{ task: String, bonus: 2, setOn }`
- New: `npcConnection`, `greedBonusClaimed` (per-dungeon flag lives better on a Scene/journal flag — decide during M2)

**`data/actor/monster.mjs`**
- Add `power` (0–50), `reactions` (default 1), `hasSlots` (false for monsters, true for humans/animals), `xRestFeatures[]`

**`data/item/background.mjs`**
- `skills: [String]` → `expertises: [{ key, uses }]` (backgrounds grant 1 or 2 uses per expertise)
- `characteristicBonus` semantics change: now names the characteristic set to **2**, not a +1

**`config.mjs`**
- Split `containers` into `carryContainers` (hand 2, belt **4**, backpack 10) and `magicSlots` (head/neck/waist/arms/finger/feet, 1 each)
- Replace `skills[]` with `expertises` keyed by category
- Add `stackLimits`, `coinPerSlot: 250`, `corpseSlots`, `greedBonus`, `encounterNumber`, `harvestDice`
- Delete `boned` from `conditions`; add `vulnerable`, `weakened`

**`helpers/slots.mjs`** — needs real rewriting, not patching. It currently does a capacity sum with no positional model. Playtest 2 requires per-slot occupancy with contiguity and stacking. This is the second-largest code change after the roll pipeline.

### 2.3 World data migration

Runs on `init` when `system.version` on a world predates 0.2.0.

1. **Skills → expertises.** Apply the mapping table (§1.1). Where two PT1 skills collapse into one PT2 expertise (climb/jump/swim → Athletics), take the **max** bonus, then convert bonus → uses 1:1 clamped to the tier max for the actor's TXP.

   **Then reconcile against a total budget.** Clamping each expertise individually is not enough: a PT1 crow with 12 skills at bonus 2 converts to 24 uses, while a PT2 advancement bonus grants at most 3 (C:615). Without a pool ceiling the migration mints characters no amount of PT2 advancement could produce.

   ```
   bonusesEarned = rows of CROWS.expertiseAdvancement at or below the actor's TXP
                   (+1 per 30,000 beyond the last row)
   budget        = backgroundUses + 3 × min(xp.skillBonusesSpent, bonusesEarned)
   ```

   **The default is `"report-only"` — the migration computes the budget, reports it, and writes nothing.** An over-budget character is a balance problem, not a data-integrity one: nothing breaks, the sheet is just strong. That makes it the GM's call rather than the migration's, and a migration should not silently rewrite a player's sheet to win an argument about balance.

   Setting `crows.migrationExpertiseBudget: "enforce"` applies the trim: **water-level down** — repeatedly remove one use from whichever expertise currently has the most, ties broken by the alphabetically-first key — until it fits. Water-levelling rather than keeping the strongest few, because a PT1 sheet full of modest bonuses represented *breadth* of training, and that is the part worth preserving. Never top up when the total comes in under budget. Either way the full desired-vs-budget table goes in the GM report, so the GM can see exactly what enforcing would do.

   **Two consequences of defaulting to report-only:**
   - The over-budget state is **permanent** until a GM acts, so it must be visible on the sheet, not only in a migration-time journal that scrolls away. `expertiseOverBudget()` is derived data and the crow sheet shows a badge when it is non-zero.
   - Reconciliation must also run from a **`createActor` hook**, not only the one-time world migration. A Playtest 1 actor imported *after* the world pass — dragged in from another world, restored from a backup or a compendium — would otherwise never be checked at all. Both paths stamp `flags.crows.expertiseReconciled` so neither runs twice.

   Which layer this runs in matters and is not a free choice — see §2.3a.
2. **Conditions.** Delete `boned` (its penalty has no PT2 equivalent to preserve). `blessed > 0` → `blessed: true`.
3. **Slots.** Belt capacity grows 2→4 — safe, no data loss. Magic-slot items move from `containers` to the new magic axis by matching `equipSlotTypes`. Items whose contiguity is now illegal get flagged, not silently moved: emit a GM report listing them.
4. **Wounds.** `wounds: N` → assign to N backpack slot indices. **Prefer empty slots, lowest index first, and only then occupied ones.** PT1 filled bottom-up regardless of contents, but under reading (c) a wound landing on an occupied slot costs 1 speed — so a naive bottom-up migration would silently slow existing characters. Placing into empty slots first reproduces the PT1 speed profile as closely as the new rule allows; list any wound forced onto an occupied slot in the GM report. The player can rearrange afterwards.
5. **Characteristics.** No transform needed, but the schema's old `max: 3` means no existing data can be out of range.
6. **`preparedTask.skill`** → drop into `task` as free text with a note. `setOn` is a **StringField** in PT2 — canonicalise both historical numeric DT counters and date strings into it. It was a NumberField, which coerced the fixture's `"2026-05-20"` to `0`.

7. **Backgrounds are NOT migrated — they are REPLACED.** Two independent reasons, both verified against the 36 shipped documents:

   - **The `uses` data does not exist in PT1.** A PT1 background stores a bare list (`skills: [handleAnimal, natureLore, ...]`). PT2 needs per-key uses — `C:103` for that same background reads *"Benefaction (2 uses), Elemental (2 uses)"*. The number 2 appears nowhere in PT1 data, so no transform can produce it.
   - **Collapsing pairs silently reduce the grant COUNT.** 43 PT1 keys across 25 of 36 backgrounds map onto a shared PT2 expertise, and **8 backgrounds grant both halves of a pair** — Thief loses two (`hide+sneak`, `sabotage+sleightOfHand`: 7 skills → 5 expertises). For an *actor* max-wins handles a collapse; for a *background* there is no bonus to max, so two grants become one.

   `migrateBackgroundSystem` therefore does **best-effort shape conversion only**, and its output is **overwritten** by the re-transcribed Wave 3 content (T3.1, `C:89–602`). This matters beyond content: **H5's `backgroundUses` must read the re-transcribed background**, never a migrated one, or the budget input is wrong and the GM decides on bad numbers.

### 2.3a Which migration layer does what

Two layers, and conflating them is the classic bug — the first draft of this plan conflated them.

| | **(a)** `DataModel.migrateData(source)` | **(b)** world migration on `ready` |
| --- | --- | --- |
| Sees | the raw `system` object, nothing else | the whole Actor, embedded Items included |
| Runs | every load, **and on partial update deltas** | once, gated on the stored system version |
| Intent | idempotent **shape coercion** | one-time **policy** |
| Does | skills→expertises, boned dropped, blessed→boolean, preparedTask, wounds→slot indices | the expertise budget, slot re-layout, the GM report |

**The expertise budget cannot run in layer (a).** Three independent reasons:

1. `backgroundUses` needs the background's **grants**, and the actor stores only `system.background` — a NAME. There is **no embedded Background Item** to sum. Resolving it requires a compendium lookup (id first, then name; stamp the id; report and skip on failure), which a pure per-document transform cannot perform. This one is a hard blocker.
2. The budget needs `xp.txp`, and a partial delta may omit `xp` entirely — the delta fixture deliberately does. No TXP means either a throw or an assumed `0`, which would trim a character to nothing on a routine field edit.
3. `migrateData` has no way to know it has already run. Applied there, the budget would also hit already-migrated Playtest 2 characters who legitimately earned their uses.

So layer (a) converts shape and is *expected* to leave `max` over budget; layer (b) reconciles, once, against the whole actor. Write both as pure functions in `helpers/migration.mjs` with unit tests over the fixtures in `test/fixtures/actors/`, so they are testable without a live world. **Test against update deltas, not just whole documents** — `migrateData` runs on partial updates too.

Emit a GM-visible summary journal of everything the migration touched or flagged. Do not silently drop data.

### 2.4 Repo hygiene

`packs/` is git-tracked, so every Foundry launch dirties `CURRENT` and churns `MANIFEST-*` files — that's the noise in the current working tree. Fix as part of M0: gitignore the generated LevelDB, keep `src/packs/*.yaml` as the only committed source, and build packs in CI/release. If the packs must stay tracked for installability, at minimum add `packs/** binary` to `.gitattributes`.

---

## Part 3 — Milestones

### M0 — Branch, hygiene, scaffolding
- Branch `playtest-2` off master.
- Resolve the `packs/` git churn (§2.4).
- `system.json`: version 0.2.0, `compatibility.minimum: 14, verified: 14`, description updated to Aug–Sept 2026.
- Stand up a test harness for pure helpers (see `/foundry-test`) — the roll resolver, slot packer, and migration functions must be unit-testable outside Foundry.

### M1 — Engine core (highest risk, do first)
- `config.mjs` restructure.
- Two-channel modifier model + edge/bane resolution, with a full truth table under test.
- Two-phase roll pipeline and the interactive expertise chat card.
- Doom/crit override precedence, with tests asserting expertise cannot rescue a doom.
- Delete `boned` everywhere; add Vulnerable and Weakened; redefine Blessed.
- **Gate:** unit tests green + live-verified in a Foundry v14 world.

### M2 — Actor & item models + world migration
- Crow, monster, background model changes (§2.2).
- `helpers/migration.mjs` + fixture tests, including update-delta cases.
- GM migration report journal.
- **Gate:** a Playtest 1 world opens, migrates, and its characters are playable with no console errors.

### M3 — Inventory rewrite
- Positional slot model with contiguity, stacking, and the 250 gc coinage rule.
- Magic-item slot axis, incl. the overload penalty.
- Player-chosen wound slots; speed penalty per reading (c) — slots holding both a wound and an item — with reading (b) behind the `crows.woundSpeedRule` setting.
- Combat backpack retrieval (maneuver + 1d10 ≥ slot number).
- Corpse slots by size.
- **Gate:** slot packer unit tests + sheet drag/drop verified live.

### M4 — Subsystem updates
- Advancement: new TXP tables, expertise max-uses curve, three-way bonus choice, characteristic cap 4 with Stamina overflow.
- Rest: new/revised activities, Repair Armor, Seclude Camp, town's 4-activities-per-day, Miasma blocking expertise refresh.
- Encounters: EN 9/8/7, the roll-of-10 immediate rule, telegraphed encounters.
- Greed Bonus tracking.
- Village: delete availability rolls, add Barracks and Beacon, revise institution levels and Temple crafting.
- Crafting/Harvest on generic monster parts.
- Character creator: new characteristic spread, 3d6 gc, NPC connection step.

### M5 — Combat & new subsystems
- Counter reaction, crit-grants-action, ranged-miss-hits-ally, multi-target per-target resolution.
- Flanking / high ground / cover / concealment as edge-bane sources.
- Assist (tiered −1/+1/+2) and Group tests.
- Hirelings, Pets in Combat, Forced Movement, Toppling Objects, Vehicles.
- Overland travel: hexes, pace, Travel Roles.

### M6 — Content re-verification (all 437 docs)
Highest-volume, lowest-risk — parallelizable and largely mechanical.
- **36 backgrounds** — every one changed (expertises + starting equipment).
- **276 traits** — re-verify against PT2 trees; Leverage confirmed changed (Stacks on Stacks replaces Groundroll).
- 19 weapons, 4 armor, 43 gear, 14 consumables, 2 ammunition, 25 spellbooks, 11 monsters (+ `power`), 6 loot.
- Rules journal — rewrite for expertises, edges/banes, new conditions, new tables.
- Keep the existing `docs/discrepancies/` practice for PDF typos and rules ambiguities.

### M7 — New Playtest 2 content
- Dungeons Book: **Blood Library** (8 rooms), **Floating Manor** (15 rooms), POI Ruined Tower, POI Ruined Windmill, village of **Gadwick**.
- Ref Book: travel encounter tables (Any Monster, Bad Weather, Merchant, Miasma-Touched, Monster from Nearby, Strong Miasma, Traveler, Wild Animal), Interesting Things.
- Expanded bestiary: Animals/Potential Pets, Humans, Blood Creatures, Ring Collector, Undead.
- Consider new packs: `crows-adventures` (JournalEntry), `crows-pets` (Actor), `crows-tables` (RollTable).

---

## Part 4 — Verification

Per the best-practices checklist, before setting `verified: 14`:
- Every manifest path exists in the packaged ZIP.
- Clean v14 world: create each Actor and Item sub-type, confirm defaults and sheet registration.
- **Migration:** a real Playtest 1 world, plus fixture update-deltas including zero values.
- Sheets as editor and as read-only user — the expertise-spend button must respect ownership.
- Rolls: doom/crit precedence, edge/bane truth table, expertise category gating, invalid formulas, escaping.
- Active Effects: actor-level and transferred item-level, derived-data ordering, toggle behavior, token bars.
- Import and open every pack from the generated ZIP.

**Pack build reminder (from STATUS.md, still applies):** every source YAML needs both `_id` (16 char) and `_key` or `fvtt-cli` silently skips it. Foundry holds exclusive LevelDB locks while a world is open — Return to Setup before rebuilding, and a full world launch is required for newly declared packs.

---

## Part 5 — Open questions

1. **R:524 wound/speed reading** — "for each slot occupied by a wound and an item" reads three ways (§1.4). **Decided 2026-08-20: shipping (c)**, slots holding both a wound and an item, with (b) behind `crows.woundSpeedRule`. Still worth confirming with MCDM — see question A2 in the execution plan's Part 7.
2. **Expertise uses at creation** — backgrounds grant "1 use in some expertises" but several list "(2 uses)" entries. Confirm whether the parenthetical is the whole grant or an addition.
3. **Expertise vs. double bane ordering** — if a test has a double bane (−1 tier) and the player spends an expertise (+1 tier), do they cancel, and does order matter? Currently no rule text. Assume commutative net-shift; flag it.
4. **Counter damage vs. AD** — Counter deals "the tier 2 result of the weapon"; confirm whether that damage interacts with AD normally.
5. **Greed Bonus persistence** — "can't apply in that dungeon again to the group (or another group played by the same players)" implies per-player-group tracking across characters. Model as a world-level flag keyed by dungeon.
6. Does the Ring Collector / unique monster set need `power` values MCDM hasn't published?
