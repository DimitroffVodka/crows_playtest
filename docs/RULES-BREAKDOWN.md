# Crows (Playtest 2) — Rules Breakdown

Structural analysis of the ruleset, organized by system rather than by book.
Line refs are to `Crows Playtest 2 - Master.md`. Written to support the Foundry build:
each section notes what is *automatable*, what is *Ref judgment*, and what is *ambiguous*.

---

## 0. The shape of the game

Crows is a **dungeon-crawl loot game with a real-time clock**. Three ideas carry the whole design:

1. **One resolution mechanic.** `2d10 + characteristic` → three tiers. Everything else is a reskin.
2. **Time is the scarce resource**, not hit points. The Dungeon Turn is 30 minutes of *real* time, and it drives torches, spells, conditions, and wandering monsters.
3. **Tier 2 is the design's center of gravity.** Not pass/fail — "yes but" is the most common outcome, and the Ref improvises the cost.

The loop: leave the village → travel (hexes, Miasma) → delve (DTs, encounters, loot) → return → spend loot on village institutions → repeat. XP comes from **treasure recovered**, not monsters killed, which makes avoiding fights the optimal play. The rules say so explicitly (L1105: sneaking past is "often the best course of action").

---

## 1. Core resolution

### 1.1 The test (L206–264)

Roll `2d10 + one characteristic`. Three characteristics only: **Agility, Mind, Strength** (L178). There is deliberately no social stat (L198) — talking is resolved by talking.

| Result | Tier | Meaning |
| --- | --- | --- |
| ≤ 11 | **Tier 1** | You don't do it. Setback at Ref's discretion. |
| 12–16 | **Tier 2** | Partial success, or full success at a cost. |
| 17+ | **Tier 3** | Clean success. |

Base probabilities on 2d10 (no modifier):

| Characteristic | Tier 1 | Tier 2 | Tier 3 |
| --- | --- | --- | --- |
| +0 | **55%** | 35% | 10% |
| +2 (starting max) | 36% | 43% | 21% |
| +4 (PC cap) | 21% | 43% | 36% |

A flat 55% failure rate at +0 is the number that explains the rest of the system. Expertises, edges, and assists all exist to claw back tier 1s.

### 1.2 Crits and dooms (L256–264)

Computed on the **raw 2d10 sum, before any modifier**:

- **Crit** on raw 19–20 (3%) → tier 3 "regardless of banes or other penalties", plus a bonus effect.
- **Doom** on raw 2–3 (3%) → tier 1 "regardless of edges, expertises, and other bonuses", plus a major setback.

Both are **terminal and modifier-immune**. This is the single most important precedence rule in the game: nothing rescues a doom, and nothing spoils a crit. 6% of all rolls bypass the entire modifier system.

### 1.3 The four modifier channels

The rules keep these deliberately separate. Conflating them is the classic implementation bug.

| Channel | Effect | Stacks? | When |
| --- | --- | --- | --- |
| **Characteristic** | +score | one only | pre-roll |
| **Bonus / penalty** | ±N numeric | yes, sums | pre-roll |
| **Edge / bane** | see below | counted, then resolved | pre-roll |
| **Expertise** | +1 tier | one per test | **post-roll** |

L300 is explicit: a masterwork tool's +2 is a *bonus*, not an edge, and does not count toward the edge/bane tally. Surprised (+1, L825) and squeezing (+1, L843) are also bonuses, not edges — the designers kept a handful of flat numerics on purpose.

### 1.4 Edges and banes (L270–298)

- **Single edge** = +2. **Single bane** = −2.
- **Double** (two or more) = **no numeric at all**; instead shift the outcome one tier.

Resolution: clamp each side to 2, then subtract.

| Edges | Banes | Result |
| --- | --- | --- |
| 1 | 0 | +2 |
| 2+ | 0 | **+1 tier** |
| 0 | 1 | −2 |
| 0 | 2+ | **−1 tier** |
| 1 | 1 | nothing |
| 2+ | 2+ | nothing |
| 2+ | 1 | +2 (one edge) |
| 1 | 2+ | −2 (one bane) |

Clamp-first is what makes L296 true: three edges and one bane is **one** edge, "regardless of how many individual edges contribute."

**Doubles are categorical, not incremental.** A double edge at +0 turns 55/35/10 into 0/55/45 — it *eliminates tier 1* (barring a doom). A double bane eliminates tier 3 (barring a crit). That's a far bigger swing than two +2s would be, and it's the main reason to hunt for a second edge.

### 1.5 Expertise (L304–372)

**The biggest change from Playtest 1.** Expertise is not a bonus — it's a **spendable pool applied after you see the result**.

- Each expertise has *uses*. Spend 1 to improve a result by one tier (max 3).
- **One expertise and one use per test.**
- All uses refresh on finishing a rest — **except in the Miasma** (L1389).
- Cannot rescue a doom (L260).

Three categories, and category gates applicability:

| Category | Count | Applies to |
| --- | --- | --- |
| **General** | 18 | exploration, investigation, crafting |
| **Spellcasting** | 6 | castings only (L398) |
| **Weapon** | 6 | weapon attacks only |

General: Alchemy, Athletics, Blacksmithing, Enchanting, Endurance, Gymnastics, Handle Pet, Historical Lore, Lift, Magic Lore, Monster Lore, Nature Lore, Navigate, Pick Lock, Religious Lore, Search, Stealth, Thievery.
Spellcasting: Alteration, Benefaction, Conjuration, Elemental, Illusion, Necromancy.
Weapon: Bashing, Bow, Chopping, Slashing, Stabbing, Unarmed.

Overlap is intentional (L364) — Blacksmithing, Enchanting, and Magic Lore could all plausibly identify a magic sword. The player argues, the Ref rules. **"You're An Expert" (L370):** having the expertise can waive the test entirely.

> **Design note:** making this post-roll converts expertise from a passive stat into an active decision every single test — "is this worth a use?" That is the mechanical heartbeat of the new edition, and the sheet UI has to read as a *resource*, not a bonus.

### 1.6 Special tests (L374–418)

- **Assist** (L378) — made *before* the assisted test, tiers give **−1 / +1 / +2** to it. Expires after 1 combat turn. In combat it costs whatever the assisted test costs (maneuver/action/reaction). Note tier 1 actively *hurts* the ally.
- **Attack** (L392) — weapon and spellcasting expertises only.
- **Casting** (L396) — spellcasting expertises only. Some castings are also attacks; both rule sets apply.
- **Resistance Roll (RR)** (L406) — reactive. Gymnastics for Agility RRs, Endurance for Mind/Strength RRs by convention. Crit can counter-harm the source; doom adds 1d10 damage.
- **Group test** (L414) — everyone assists a nominated leader, leader's roll decides for all. On a tier 2 cost, the cost falls on the leader *and anyone who gave them a penalty*.

---

## 2. The character

### 2.1 Characteristics (L178–188)

Agility, Mind, Strength. Range −5 to +5. PCs start between −1 and 2; **hard cap of 4** without magic.

### 2.2 Creation (L1766–1794)

1. **Roll 2d6** on the 36-entry background table (or pick).
2. **Record stats.** Background sets **one characteristic to 2**. The other two are the player's choice of **{1, 0}** or **{−1, 2}**. Background also grants expertise uses (1 in most, 2 in some), a Stamina score, and a starting trait. Speed is 5 for everyone.
3. **Equipment** from the background, plus a universal kit: empty coin purse, knife, rope, 6 rations, **3d6 gc**.
4. **Village stuff.** Make an NPC connection; on a first campaign, build the village collaboratively.

> Note the `{−1, 2}` option means a PC can start with **two** characteristics at 2 by accepting a −1. That's the main build decision at creation.

### 2.3 Advancement (L2355–2411)

XP = **treasure value ÷ number of players**, for loot recovered outside the village that wasn't purchased, crafted, taken from an innocent, or originally an ally's (L2357). Track lifetime **TXP** and spent XP separately. You can only spend or claim bonuses **at the end of a rest**.

**Expertise & Stamina track** — at each TXP threshold, choose one:
- 3 expertise uses distributed freely (including into expertises you don't have), respecting the max; **or**
- +2 Stamina max; **or**
- 1 expertise use + 1 Stamina max.

| TXP | 100 | 500 | 1,250 | 2,250 | 3,500 | 5,000 | 10,000 | 20,000 | 30,000 | +30k each |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bonus | 1st | 2nd | 3rd | 4th | 5th | 6th | 7th | 8th | 9th | 10th+ |
| Max uses | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 4 | 4 | 4 |

**Characteristic track:** 5,000 / 15,000 / 30,000 / every 30,000 after. +1 to one characteristic, cap 4. If all three are at 4, take +2 Stamina instead.

**Traits (L2413–2423):** bought with XP at the end of a rest. Starting traits (top of a tree) cost 500 XP; anything else must connect by a line to a trait you already own on that tree. One purchase each. **Minimum modifier rule (L2421):** when a trait scales off a characteristic, the minimum is 1 even if the characteristic is lower.

**Death (L2403):** a replacement PC rolls extra background options equal to the dead PC's bonus count and picks. Optionally starts at the party's lowest TXP, plus gold equal to half that XP for equipment.

**Retirement:** 60,000 TXP.

---

## 3. Damage, death, and conditions

### 3.1 The damage stack (L518–538)

Damage flows through three layers in order:

```
Armor Defense (AD)  →  Stamina  →  Wounds
```

- **AD** belongs to *items*, not creatures. Each suit of armor and each shield has its own AD pool. With multiple sources you choose which depletes first. At 0 the item stops absorbing until repaired (a rest activity).
- **Piercing (P)** damage **skips AD entirely** and hits Stamina first.
- **Stamina 0** kills a Ref-controlled creature. Players may ask for unconsciousness instead — the Ref may allow it, leaving them at 1 Stamina, waking at end of DT.
- **Wounds** are for PCs, humans, and animals only. 1 damage past 0 Stamina = 1 wound. **Each wound fills a backpack slot of the PC's choice.** All slots wounded = dead.

> This is the game's cleverest piece of design: **injury and encumbrance are the same resource.** Getting hurt literally costs you carrying capacity, so a successful-but-bloody delve brings home less loot.

Monsters have **no slots** and simply die at 0 Stamina (L5631). Humans and animals have slots — which is what makes them potential allies and pets.

### 3.2 Conditions (L540–572)

Strictly boolean — "you can't gain a second instance of a condition you already have" (L542).

| Condition | Effect | Ends |
| --- | --- | --- |
| **Blessed** | Edge on all tests; your attacks deal bonus damage = the characteristic used | end of DT |
| **Grabbed** | Speed 0, can't flank, attacks against you gain an edge, you move with the grabber | grabber lets go / dies / prone / unconscious / moves out of range, or Escape Grab |
| **Prone** | Speed halved, bane on your melee attacks, can't flank, melee vs you gains edge, ranged vs you takes bane | Stand Up maneuver |
| **Vulnerable** | Each time you take damage, take an extra 1d6 | end of DT |
| **Unconscious** | Prone, speed 0, no actions, **auto-doom on Agility and Strength**, double bane on Mind-to-notice, attacks against you auto-hit at tier 3 | any damage; a shout within 10 squares |
| **Weakened** | Bane on all tests | end of DT |

Three of six expire at end of DT, which ties the condition system directly to the clock.

### 3.3 Hazards (L735–758)

- **Falling:** 1d6 P per 10 feet. Reaction RR (2d10+A) reduces by 1d6 / 2d6.
- **Starvation:** one starvation wound per dayless day; *all* clear the moment you eat.
- **Suffocation:** hold breath `3 + Strength` rounds, then 1d6 per round.

---

## 4. Time, light, and the dungeon clock

### 4.1 Dungeon Turns (L592–630)

**A DT is 30 minutes of real-world time**, tracked on a visible timer. Fiction time is explicitly *not* correlated (L598).

At the end of each DT: roll usage dice, expire end-of-DT effects, and the Ref makes an encounter check.

Configurable: 60 min (relaxed), 20 min (intense), or "1d6 rooms" if you hate timers (L630). Outside a dungeon, **2 hours of fiction = 1 DT** for usage-dice purposes (L624).

### 4.2 Usage dice (L574–590)

All UD are **d6**. Roll all of an item's dice; each die showing **1 or 2 is removed**. At 0 UD the effect ends. Four expiry modes: **Useless** (permanently spent), **Refuel** (restored with a named item), **Rest** (restored on rest), **Activate** (rolled on use rather than end of DT).

Elegant: a 2-UD torch doesn't have a fixed lifespan, it has a *decay curve*. You never know if this is the turn it dies.

### 4.3 Encounter checks (L632–638)

Roll **1d10 ≥ EN**. Default **EN 9**; **8** if the level is crowded (>20 creatures) *or* the PCs left obvious chaos; **7** if both.

- Rolled **10** → encounter happens **immediately**.
- Rolled 9 or lower that still triggers → the Ref **telegraphs a sign now** (distant roar, half-eaten corpse), encounter lands sometime next DT.

### 4.4 Greed Bonus (L604)

Treasure found in the **first three DTs** of a first entry is worth **+30% / +20% / +10%**. Once per dungeon per group of players — explicitly including *different characters played by the same people* (L614).

A direct mechanical bribe against caution. It exists to counteract the 10-foot-pole problem.

### 4.5 Light (L696–733)

Notation `X/Y` = X squares bright, Y squares dim beyond that.

- **Dim light:** bane on attacks and on tests to discern or search.
- **Darkness:** **double bane** on the same, and against a silently-moving target you must *guess the square* — wrong guess is an automatic miss.

Campfires by size: Tiny 0/5, Small 5/5, Medium 10/10, Large 15/15, Huge 20/20.
Dousing a UD light source **still costs a UD roll** (L733) — you can't dodge the decay by snuffing it.

### 4.6 Resting (L640–694)

6 uninterrupted hours, ≥4 asleep, consume 1 ration. Restores **all Stamina**, **all expertise uses**, and **1 wound of your choice**.

At the **halfway point**, end-of-DT effects expire and end-of-DT UD roll (L644). Rests sit outside DTs; starting one ends the current DT with no encounter check, and a new DT starts when the rest ends.

**Rest activities** — one per rest, must complete the rest to benefit:

| Activity | Effect |
| --- | --- |
| Craft Equipment | One crafting roll |
| Harvest | Destroy a corpse for parts: 1d6 (Medium or smaller) / 2d6 (Large) / 3d6 (Huge) / 4d6 (Holy Shit!) |
| Identify Item | Learn a magic item's properties |
| Prepare for Task | **+2** to a *specific named task in a specific place*; lasts until your next rest |
| **Repair Armor** | Restore one armor or shield to full AD |
| **Seclude Camp** | EN −1 this rest; one per group; doesn't require finishing |
| Tend Wounds | Target with ≥2 wounds, **not yourself**, loses 2 instead of 1 |

**In town (L692):** up to **4 activities per day** without sleeping, ~2h each, benefits landing after the 2 hours. Tend Wounds is the exception — still needs 4h sleep, once per day.

---

## 5. Inventory

### 5.1 Slots (L440–450)

**2 hand · 4 belt · 10 backpack.** Clothes and the backpack itself are free.

- Multi-slot items must occupy **adjacent slots in the same container**. No pole across hand+belt; no backpack 2 and 7.
- **Stacking:** 5 potions, 3 locks, 2 oil flasks per slot. Same *kind* only — 5 different potions is fine, 3 potions + 2 locks is not. Hands never stack.
- **250 gc** of loose coin per slot — the reason to buy a purse.

### 5.2 Magic item slots (L452–474)

A **separate axis** from carrying: head, neck, waist, arms, finger, feet — one item each.

**Overload penalty:** two magic items in the same slot means you **can't rest** and take **1d6 wounds at the end of every DT** (L474). Brutal, and it makes magic-item slots a real constraint rather than a formality.

### 5.3 Moving things around (L484–494)

Free outside combat. In combat:
- Rearranging hands/belt = a maneuver, and you may drop things free as part of it.
- **Getting something out of your backpack** = a maneuver, declare the item, roll **1d10**; success if the result is ≥ at least one of the item's backpack slot numbers. Fail and you may only rearrange.

So *where* you pack something determines how fast you can reach it under pressure. Slot 10 is nearly always reachable; slot 1 almost never.

### 5.4 Corpses (L496–510)

Slots = size, plus whatever the corpse is wearing: Tiny 1 (stacks 3) · Small 2 · Medium 4 · Large 8 · Huge 16 · Holy Shit! 32.

Hauling a Medium body costs 4 backpack slots — nearly half your capacity, and directly competing with loot and wounds.

---

## 6. Combat

### 6.1 Structure (L797–850)

- **Side initiative, re-rolled every round.** One player rolls 1d10; **6+** means the PCs and allies act first, else enemies do (L837). Within a side, the players choose their own order.
- **Turn:** one maneuver + one action, **or** two maneuvers. Plus **1 reaction per round**, usable on anyone's turn.
- **Surprised** creatures skip their first turn and take **+1** to attacks against them (a bonus, not an edge).
- **Grid:** 5-foot squares, **diagonals cost the same as orthogonals**.

| Size | Squares | Reach |
| --- | --- | --- |
| Tiny / Small / Medium | 1 | 1 |
| Large | 2×2 | 2 |
| Huge | 3×3 | 2 |
| Holy Shit! | 4×4 | 3 |

You can't stop in another creature's space if they're within one size category, and enemy spaces are difficult terrain (L833).

### 6.2 Common maneuvers (L853–906)

Move Speed · Shift (1 square, no opportunity attacks) · Command (a pet) · Draw From Pack · Draw From Belt · Pick Up Item · Dump Backpack · Stand Up · **Grab** · **Escape Grab** · **Knockback**.

The three contested maneuvers are ordinary tiered tests:

| Maneuver | Test | T1 | T2 | T3 |
| --- | --- | --- | --- | --- |
| **Grab** | 2d10+S | target may counter | Push 1, or Shift | target is grabbed |
| **Escape Grab** | 2d10+A or S | grabber may counter | escape, but grabber may counter | escape + move 1 free |
| **Knockback** | 2d10+S | target may counter | Push 1 | Push 2 |

Note the recurring tier-1 punishment: **failing a maneuver hands your opponent a counter**.

**Taunt** (action, L907): a creature within 10 squares takes a bane on attacks that don't include you.
**Ready an Action** (L911): name a trigger, spend your reaction when it fires.

### 6.3 Attacks (L923–988)

Tier 1 = **miss**, tier 2–3 = **hit**, damage per the weapon or spell card.

Unarmed strike: `2d10 + A or S` — T1 target may counter, T2 `1 + A or S`, T3 `2 + A or S`.

**Melee:** miss → the target may counter.
**Ranged:**
- −2 per square beyond normal range (a *penalty*).
- **Bane** if the target is adjacent to you.
- Miss with allies adjacent to the target → roll any die; **odd** hits a random ally for tier 2 damage.
- **Doom** with allies adjacent → automatically hits an ally for **tier 3**.
- Ammunition is destroyed; thrown weapons can be recovered.

**Crit on an attack** → an extra action (L971).
**Multiple targets** (L975) → **one roll**, but per-target edges and banes can resolve to **different tiers per target**.

Edge sources: **flanking** (opposite sides, L979 — blocked if either of you is prone or grabbed), **high ground** (≥1 square above, L987), attacking a prone target in melee, attacking while hidden.

### 6.4 Reactions (L993–1003)

One per round. Two are universal:

- **Counter** — when an adjacent attacker gets **tier 1** on a melee attack, Grab, Knockback, or Escape Grab against you, deal your weapon's **tier 2** damage. On their **doom**, deal **tier 3**. Does *not* trigger off a tier-1 opportunity attack.
- **Opportunity attack** — when a creature leaves your reach (unmodified by weapon reach).

Counter is the game's "fight defensively" mode (L1001): low ceiling, but it turns the enemy's bad rolls into your damage.

### 6.5 Movement (L1005–1055)

Difficult terrain costs +1 per square, and you can't Shift into or within it. Swimming and climbing cost +1 unless you have that speed. Fully submerged without a swim speed = bane on Agility and Strength.

**Jumping** (`2d10 + A or S`, edge if you moved 2+ squares first): T1 = 0 squares, T2 = 2 squares distance / 1 height, T3 = `2 + A or S` (minimum 3) / 1 height.

**Teleport:** no opportunity attacks, needs line of effect to the destination, can't land in an occupied space, ends grabs in both directions, keeps you prone if you were.

**Flying:** knocked prone or reduced to speed 0 → you fall.

### 6.6 Forced movement (L1077–1101)

- **Push X** — straight line directly away, each square increasing distance.
- **Slide X** — any direction, any path, non-vertical.

Ignores difficult terrain, provokes nothing. **Exception:** being pushed into damaging terrain affects you as if you walked in willingly. Can't be forced into an occupied space. **Mundane** effects can't force-move anything larger than you; magical ones can. "Vertical" prefixed effects can move you up or down — and any forced move against a flier is automatically vertical.

### 6.7 Toppling objects (L1107–1123)

Drop an object on a creature of its size or smaller: **1d10 + 2d10 per size category larger**. A Huge object on a Medium creature = 5d10.

By hand: `2d10 + S`, bane if one size larger, double bane if two. T2 topples it but costs you 1d6 P.

### 6.8 Line of effect, cover, concealment (L759–791)

Corner-to-corner: any unobstructed corner-to-corner line grants line of effect. Fragile obstructions may not block at all.

- **Cover** (half the form behind something solid) → bane on attacks against them.
- **Light concealment** (fog, rain) → bane on attacks and discern/search.
- **Heavy concealment** → **double bane**, plus the guess-the-square rule.
- **Invisible** = heavy concealment.

---

## 7. Magic

### 7.1 Spellbooks (L1459–1563)

Magic lives in **books**, not casters. Anyone holding one can try to cast it. A spellbook must be in a **hand slot** to use.

Stats: **Rank** 0–5 · **Discipline** (Alteration / Benefaction / Conjuration / Elemental / Illusion / Necromancy) · **Casting time** (action / maneuver / reaction / out-of-combat 10 min) · **Target** · **Range** · **Area of effect** (Aura X, Cube X, Line A×B) · **Duration** (Instant / DT / UD).

**Casting is always a Mind test.** Only the matching spellcasting expertise can improve it.

**Spellbook UD are rolled on every single cast** (L1557), and refresh on rest. **A crit means you don't roll UD at all** (L1559) — so a crit is effectively a free cast.

### 7.2 Backlash (L1569–1673)

Two triggers, and this is **substantially simpler than Playtest 1**:

1. **Doom on a casting** → backlash.
2. **Chaos roll** — on a **tier 1 that isn't a doom**, roll **1d6**; on a **1**, backlash.

> **⚠ Change from Playtest 1:** the GM-secret world-level *Chaos Count* accumulator is **gone**, replaced by this per-cast 1d6. See §9.

Backlash resolution: Ref rolls **d100 + the spell's rank** on the Backlashes table (105 rows). The backlash happens *instead of* the spell, but **you still roll the spellbook's UD**. Duplicate durational backlashes re-roll unless they stack. Backlash UD roll at end of DT.

The table escalates from comic (donkey head, compulsory rhyming, a ghostly polka accordion) to ruinous (91–92 permanent characteristic loss, 104 Stamina to 0 plus 2d6 wounds, **105 = your character is sucked into Hell and gone**). Because rank is added to the d100, high-rank casting pushes you toward the fatal end of the table.

### 7.3 Summoned creatures (L1565)

Behave like pets, but need no command test.

---

## 8. Downtime

### 8.1 Crafting (L1679–1727)

Prerequisites: the right **expertise with enough uses**, **materials**, and **tools** (Alchemy → alchemist's tools, Blacksmithing → blacksmith's tools, Enchanting → enchanter's tools).

Each item has a **crafting goal**. The Craft Equipment rest activity produces a **crafting roll**, which is a **special Mind test with no tiers** — the *total* becomes crafting points accumulated toward the goal.

Special rules that break the normal test framework:

- Minimum total is **1**, however bad the roll — **unless you doom**, which yields **0**.
- **Crit** → make another crafting roll in the same rest activity.
- **Double edge or an expertise** grants **+4** instead of its usual effect; a **double bane** is **−4**.
- **You may apply up to TWO expertises per crafting roll** — the one deliberate exception to "one expertise per test."
- Surplus points roll over into a second copy of the same item.
- Multiple crafters with the right tools and expertise can pool rolls into one item.

### 8.2 Identifying magic items (L1733–1747)

Ask a relevant NPC, use the Identify Item rest activity, or experiment (which may waste or curse you). Or test `2d10 + M`, **once per item ever**: T1 = you accidentally activate it harmfully, T2 = nothing, T3 = full properties.

---

## 9. Overland travel and the Miasma

### 9.1 Travel (L1129–1183)

**5-mile hexes**, each with a habitat that shapes encounters. Daily procedure:

1. Set pace → 2. everyone declares a travel role and tests (supporters → guide → scout → provider) → 3. encounter check → 4. explore any destination in DTs → 5. rest → 6. **Miasma RR** → 7. repeat.

| Pace | Hexes | EN | Role tests |
| --- | --- | --- | --- |
| Slow | 1 | 8 | **edge** |
| Normal | 2 | 7 | — |
| Fast | 3 | 6 | **bane** |

Pace is capped by the **slowest** creature (or their mount/vehicle): speed ≤3 loses a hex, 7–9 gains one, 10+ gains two. Roads add a hex but reduce EN by 1; crossing or going upstream costs a hex; downstream gains one. **EN can never exceed 10** (L1441).

**Roles:** Supporter, Guide (one only), Scout, Tracker. Up to three creatures each except the guide; anyone else can assist. Vacant roles forgo the benefit *and* the risk. Each role offers several tiered task tests — e.g. Follow Normal Route, Follow Safe Route (edges on the Miasma RR), Make Camp (raise rest EN or buff crafting), Support Everyone.

**Lost (L1375):** the Ref secretly rolls 1d6 per hex exited, counting clockwise from north, and tracks your true position. The guide can test to get back on track, or you find a map or a landmark.

### 9.2 The Miasma (L1385–1431)

A magical haze covering all outdoor Cornath — the residue of the Necromancer War. It cannot enter spaces fully enclosed in stone or metal.

- **Resting in the Miasma does not restore expertise uses.** Everything else about the rest works.
- At the end of every rest in it, each human tests `2d10 + M`:
  - **T1** → gain a level of **cruelty** and roll on the Miasma Effects table.
  - **T2** → nothing.
  - **T3** → clear all your cruelty, *or* bump one companion's result up a tier.
- Each cruelty level is **−1 to future Miasma RRs** — a debt spiral. Cleared by resting somewhere with no Miasma.
- Roll **1d10 + cruelty** on the effects table and gain **both** a first and second effect. They come in **paired good/bad**: despondent but an edge on sneaking; ravenous but better at foraging; enraged and destructive but you heal from it.
- **13+ → your character becomes a permanent Ref-controlled NPC.** Cruelty is a doomsday clock, and the paired benefits are the temptation that makes you climb it.

---

## 10. Creature stats (L5621–5651)

Creatures use PC stats with four exceptions:

- **Power** — a 0–50 threat rating. Starting PCs "stand no chance" against power 11+, and even power 1 creatures in groups are dangerous.
- **Slots** — monsters have none and die at 0 Stamina. Humans and animals have them (which is why they can be allies or pets). A PC who assumes another creature's stats keeps their own slot count.
- **X/Rest** — limited-use features. **A crit refunds one use.**
- **Reactions** — 1 by default, some have more.

Grab capacity: attacking ungrabbed targets forces you to release an equal number of grabbed creatures (L5627).

---

## 11. What's automatable

| Fully automatable | Assisted | Ref judgment |
| --- | --- | --- |
| Tier classification, doom/crit | Edge/bane sources (prompt, don't force) | Tier 2 outcomes — the core Ref craft |
| Edge/bane resolution | Expertise applicability | Whether a test is needed at all |
| Expertise pools + rest refresh | Wound slot placement | Crit/doom specifics |
| Damage stack (AD → Stamina → wounds) | Rest activity selection | "You're An Expert" waivers |
| Usage dice decay | Encounter EN modifiers | Miasma roleplay effects |
| Slot packing, contiguity, stacking | Backpack retrieval roll | Improvised action costs |
| Backlash table, chaos roll | Travel role tests | Hex map, getting lost |
| Advancement thresholds | Crafting point accrual | Treasure XP valuation |
| Condition expiry at end of DT | Counter triggers | Flanking geometry (partly) |

The **DT timer** is worth building well — it's the spine everything hangs off, and it's the one thing a VTT does better than a phone stopwatch.

---

## 12. Ambiguities and source errors

For `docs/discrepancies/`. Each currently blocks or complicates implementation.

1. **L538 — wounds and speed.** "For each slot occupied by a wound and an item, your speed is reduced by 1." Read literally (either a wound or an item), a loaded PC hits speed 0 almost immediately. The wound-only reading is almost certainly intended.
2. **Travel role naming.** The procedure at L1143 says "**providers**", the role list at L1195 says "**Tracker**", and the Miasma table at L1427 references "the **forage** role". Three names, apparently one role.
3. **Expertise vs. double bane ordering.** A double bane is −1 tier; an expertise is +1 tier. Do they simply net out? No rule text addresses it.
4. **L1776 vs. background entries.** "Each background gives you 1 use in some expertises," but entries list parentheticals like "Benefaction (2 uses)". Is the parenthetical the total or an addition?
5. **Counter damage vs. AD.** Counter deals "the tier 2 result of the weapon" — unstated whether AD applies normally.
6. **Greed Bonus scope.** "That group (or another group of PCs played by the same players)" implies tracking across characters and campaigns, not just per-party.
7. **L2709 — tree heading spelled "Blackmsithing."** Source typo.
8. **L1587–1673 backlash table.** Row `62-64` overlaps row `61-62`; likely `63-64`. Also the row at 51–52 references a "**Might** RR" — a characteristic that does not exist in this game (Agility/Mind/Strength). Probably Strength.
9. **Chaos roll vs. Playtest 1 Chaos Count.** The world-level accumulator is gone. Confirm this is intentional simplification rather than an omission from the draft.
10. **L666 vs. L1705 — harvest output.** The rest activity says corpses yield generic "parts"; the crafting section still describes them as "monster organs and vials of blood." The changelog says parts are now generic, so L1705 looks like stale text.
