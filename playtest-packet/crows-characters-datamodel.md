# MCDM Crows — Character Data Model (Foundry Schema Notes)

Source: `02 MCDM Crows Characters Booklet May June 2026 Playtest.pdf` (54 pp).
Scope note: This is the **Characters** booklet. Core combat math, full
characteristic/skill definitions, conditions, and roll mechanics live in the
separate **`01 ... The Rules Booklet`** (NOT read for this report). Fields below
that are *referenced but not fully defined here* are flagged `[def in Rules]`.
Items/cards (weapons, armor, alchemy, spellbooks) have their own card data in
booklets 05/06 — this report captures the fields that appear in booklet 02.

---

## 1. Characteristics

Four characteristics. Abbreviations confirmed from usage in trait text
("equal to your Mind", "M", "2d10 + M").

| Characteristic | Abbr | Notes |
|---|---|---|
| Strength | S | Used in damage formulas (`3 + S`), Strength RRs, Parry quality |
| Agility | A | Damage formulas (`+ A`), Agility RRs, Dodge/hide |
| Mind | M | Spell scaling (range/damage = Mind), crafting, social, `2d10 + M` |
| (4th) | — | **AMBIGUOUS** — see below |

**Value range:** Start at **0**. Background raises one to **+1**. Max via
advancement is **+3** (Characteristics Advancement caps each at 3). A
characteristic can be lowered to **-1** at creation (tradeoff to raise another
to +1). So practical range: **-1 to +3**.

**Minimum Modifier rule:** when a trait increases/decreases a number equal to a
characteristic, the minimum magnitude is **1**, even if the characteristic is
lower (i.e. a 0 or negative characteristic still yields effect of 1).

> **GAP / AMBIGUITY:** Only S, A, M (and implicitly the abbreviations) appear in
> booklet 02. Backgrounds only ever grant +1 to **Mind, Strength, Agility**, or
> "Any". No fourth characteristic (e.g. a Constitution/Toughness) is named in
> this booklet, yet Stamina is a flat score (not derived from a characteristic),
> which suggests there may be only **3 characteristics**. The four-attribute
> assumption is unconfirmed — **treat as 3 characteristics (S/A/M) unless the
> Rules booklet says otherwise.** Schema should make characteristic set
> data-driven, not hardcoded to 4.

---

## 2. Skills

Skills get a **+1 bonus** from backgrounds; bonus range is **+0 to +2** (cap
stated in Skill/Stamina Advancement: "to a maximum of +2"). Each skill is a
named bonus value. **This booklet does NOT publish a master skill→characteristic
mapping table** `[def in Rules]`. The full skill list below is the union of all
skill names appearing in background entries (page 2-6) plus trait references.

**All skill names found (alphabetical, deduped):**

Alchemy, Alteration, Bashing, Benefaction, Blacksmithing, Bow, Chopping, Climb,
Conjuration, Elemental, Enchanting, Endurance, Gymnastics, Handle Animal, Hide,
Historical Lore, Illusion, Jump, Lift, Magic Lore, Monster Lore, Nature Lore,
Navigate, Necromancy, Pick Lock, Religious Lore, Sabotage, Search, Slashing,
Sleight of Hand, Sneak, Stabbing, Swim, Unarmed.

Notes on grouping (inferred, not an explicit table in 02):
- **Weapon skills** map 1:1 to weapon `type` (see §11 weapons): Bashing, Bow,
  Chopping, Slashing, Stabbing, Unarmed.
- **Magic/spell skills** map 1:1 to spell disciplines / trait trees: Alteration,
  Benefaction, Conjuration, Elemental, Illusion, Necromancy.
- **Crafting skills:** Alchemy, Blacksmithing, Enchanting (a.k.a. Enchantment).
- **Lore skills:** Historical Lore, Magic Lore, Monster Lore, Nature Lore,
  Religious Lore (+ generic "lore" via Knowledge tree).
- **Physical/utility:** Climb, Endurance, Gymnastics, Handle Animal, Hide, Jump,
  Lift, Navigate, Pick Lock, Sabotage, Search, Sleight of Hand, Sneak, Swim.

> **GAP:** characteristic-per-skill tie is `[def in Rules]`. Inference only:
> weapon/physical skills likely key off S or A; lore/magic/social off M. Do NOT
> hardcode — store `characteristic` as an optional field per skill, populated
> from the Rules booklet.

---

## 3. Derived / Computed Stats

| Stat | Abbr | Source / formula | Range / notes |
|---|---|---|---|
| Stamina | — | **Flat score from background** (5/7/9 in 02). NOT derived from a characteristic. Increased +4 or +2 by Skill/Stamina Advancement. | Background values seen: **5, 7, 9** |
| Speed | — | Flat **5** for all PCs at start ("All PCs have a starting speed on 5"). Modified by traits (e.g. Mounted Speed +1). | start 5 |
| Armor Damage | AD | **From worn armor/shield**, not a characteristic. Light=5, Medium=10, Heavy=15, Shield=5 (base). Increased by upgrades/traits. Some spells/traits grant temporary AD = Mind. | see armor table |
| Wounds | — | Tracked as a count; capacity `[def in Rules]`. Wounds removed by healing/benefaction; "at full Stamina" referenced. Pet/companion backpack slots "take wounds." | count |
| Blessed level(s) | — | Stackable buff counter on a creature ("1 additional blessed level"). | integer |
| Boned level(s) | — | Stackable debuff counter ("1 additional boned level"). | integer |
| Chaos count | — | Spell-backlash tracker; rank 0/1 non-doom results "don't add to the chaos count." | integer `[def in Rules]` |

> Stamina = the HP-like resource. There is **no formula** — it is a starting
> background grant plus advancement. Damage reduces Stamina; reaching 0 / taking
> wounds is `[def in Rules]`.

**Roll mechanics referenced (for sheet context, full rules `[def in Rules]`):**
- Tests/attacks use **d20** (crits when "dice without modifiers equal 18/19/20"
  etc.; non-weapon tests like Handle Animal use **2d10 + M**).
- Result **tiers**: tier 1 (low), tier 2, tier 3 (high). Weapon cards list tier
  2 and tier 3 damage; tier 1 is always a miss.
- **Doom** results and **RR** ("RR" = a resist/saving roll type) referenced
  throughout `[def in Rules]`.
- **UD** = "Usage Die(ce)" on consumable/limited items (mundane gear, spells,
  light sources). Items lose UD on a roll of 1; at 0 UD they are
  used up / "boned." Traits add/modify UD.

---

## 4. Character Creation ("Crow Creation")

Step-by-step (page 1). **No point-buy and no array** — it is **roll for
background + a fixed +1 adjustment**:

1. **Roll for Background** — roll **2d6** on the Backgrounds table (first die =
   left d6 column, second die = right d6 column). Background sets: skill
   bonuses, Stamina score, a starting trait (top of a trait tree), starting
   equipment, and a characteristic adjustment guidance.
2. **Record Statistics:**
   - All characteristics **start at 0**.
   - Background raises **one characteristic to +1** (sometimes a choice of which;
     "Any" = player picks).
   - **Optional tradeoff:** raise an *additional* characteristic to +1, but then
     **lower the leftover one to -1**.
   - Speed = **5** (all PCs).
   - Stamina = background value.
   - Skills = the background's listed `+1 Skills`.
   - Trait = the background's starting trait (one tree's top node).
3. **Name and Feature** — name + one distinguishing feature (flavor; not a
   mechanical field beyond a free-text "feature" string).
4. **Equipment Cards** — background's starting equipment set, **plus every PC
   gets:** a bedroll, an empty coin purse, a knife, a rope, and six rations.
5. **Make a Village** (group-level, shared; see §12).

**Backgrounds enumeration (36 total, 2d6×2d6 grid; alphabetical in book):**

Acolyte of the Gardner, Acolyte of the Healer, Acolyte of the Smith, Acolyte of
the Three, Acolyte of the Warrior, Alchemist, Apprentice Mage, Archer, Assassin,
Beggar, Blacksmith, Bodyguard, Cartographer, Conjurer, Cook, Duelist, Entertainer,
Executioner, Farmer, Gladiator, Hunter, Hydromancer, Illusionist, Keraunomancer,
Knight, Merchant, Miner, Noble, Pugilist, Pyromancer, Sage, Soldier, Thief,
Tinkerer, Transmuter, Village Watch.

**Per-background schema fields** (each background record):
- `name`
- `flavor` (one-line descriptor)
- `characteristicBonus`: +1 to a specific characteristic, OR a choice
  (e.g. "Mind or Strength"), OR "Any"
- `stamina`: integer (5 / 7 / 9)
- `trait`: one starting trait (formatted `Tree: TraitName`,
  e.g. `Enchantment: Material Transfer`)
- `skills`: array of skill names each getting +1
- `equipment`: array of gear/item names
- `spellbooks`: optional array of starting spell names (only for casters)

Example (Acolyte of the Gardner): Char +1 Mind; Stamina 5; Trait
`Enchantment: Material Transfer`; Skills [Handle Animal, Nature Lore, Navigate,
Religious Lore, Swim, Benefaction, Elemental]; Equip [holy symbol, torch];
Spellbooks [fire hands, minor healing, spark].

---

## 5. Ancestries (Species / Lineages)

> **NOT PRESENT.** Booklet 02 has **no ancestry/species/lineage system**.
> Character identity comes entirely from **Background** (§4) and **Traits** (§7).
> Several texts reference "humans" specifically (e.g. "each human with you,"
> "choose one human who rests with you") implying PCs are **human** by default
> and ancestry is either absent or `[def in Rules/Welcome booklet]`. Schema
> should NOT include an ancestry sub-document unless found elsewhere.

---

## 6. Classes / Archetypes

> **NO CLASS SYSTEM.** Crows is **classless**. There are no levels-per-class,
> no class abilities, no class resource pools. Functional role = the set of
> **Trait Trees** a PC buys into (combat style, magic discipline, profession).
> Spellcasting is gated by **possessing spellbooks + the matching trait tree**,
> not by a class.

The closest structural analog to "class/archetype" is the **Trait Tree** (§7).
The closest analog to "level" is **TXP-based advancement** (§8).

---

## 7. Traits / Abilities / Features (the core ability model)

Abilities are **Traits**, organized into **Trait Trees**. This is the central
discrete-item model for the Foundry `Item` type.

**Trait Tree structure:**
- A tree = a named themed group with a "Specialization" descriptor.
- Each tree has a **fixed 4-row × 3-column grid (12 traits)**:
  - **Row 1 (3 traits):** "Starting" tier — XP Cost **500** each. A background
    grants one of these for free. Starting traits can be bought directly.
  - **Row 2 (3 traits):** XP Cost **1,000** each.
  - **Row 3 (3 traits):** XP Cost **1,500** each.
  - **Row 4 (3 traits):** XP Cost **2,000** each.
- **Prerequisite/connection:** you may buy a starting trait, OR a trait
  connected by a line to a trait you already own **on the same tree**.
  (Connections form the tree's edges — schema needs a `prerequisites`/`connectsTo`
  adjacency field per trait.)
- Each trait may be **purchased only once**.

**Trait record schema (Foundry Item "trait"):**
- `name`
- `tree` (enum, see list below)
- `tier` / `row` (1–4) — implies XP cost (500/1000/1500/2000)
- `xpCost` (integer; 500/1000/1500/2000)
- `column` + `connectsTo` (tree-graph position & edges)
- `description` (effect text — free-form rules text)
- `isStarting` (boolean; row 1)

> Traits are **passive/conditional rule modifiers** described in prose
> ("When you cast an X spell..."). They do NOT have the action-type / range /
> cost fields of a typical "active ability." Action economy (action / maneuver /
> reaction) lives in the **effect text** of each trait and in weapons/spells, not
> as structured trait fields. Many traits reference **rest activities**
> ("As a rest activity, ...") — a rest-activity tag would be a useful derived
> field.

**Trait Trees — full enumeration (32 trees):**

| Tree | Specialization | Category |
|---|---|---|
| Alchemy | Creating alchemy items | crafting |
| Alteration | Alteration spells | magic |
| Archery | Bow weapons | combat |
| Armor | Armor and shields | defense |
| Bashing | Bashing weapons | combat |
| Benefaction | Benefaction spells | magic |
| Blacksmithing | Creating armor and weapons | crafting |
| Camping | Rest activities | utility |
| Chopping | Chopping weapons | combat |
| Conjuration | Conjuration spells | magic |
| Elemental | Elemental spells | magic |
| Enchantment | Creating magic items | crafting |
| Illusion | Illusion spells | magic |
| Knowledge | General lore | utility |
| Leverage | Getting the most out of gear | utility |
| Necromancy | Necromancy spells | magic |
| Pets | Directing and raising animals | utility |
| Reputation | Villages | social/economy |
| Slashing | Slashing weapons | combat |
| Stabbing | Stabbing weapons | combat |
| Thievery | Breaking and entering | utility |
| Travel | Overland travel | utility |
| Unarmed | Unarmed attacks | combat |

> Note: the index table on p7 lists 24 rows but lists "Smithing"/"Blacksmithing"
> and detail pages confirm trees by name. Detailed trait-tree pages present
> (each with 12 traits, names extractable per page) for: Alchemy, Alteration,
> Archery, Armor, Bashing, Benefaction, Blacksmithing, Camping, Chopping,
> Conjuration, Elemental, Enchantment, Illusion, Knowledge, Leverage, Necromancy,
> Pets, Reputation, Slashing, Stabbing, Thievery, Travel, Unarmed. (= 23 detailed
> trees; the 6 spell trees + 6 weapon trees + crafting + utility trees.)
> All 12 trait names per tree are present in the PDF page images (pages 8–30) and
> can be transcribed when building compendium content.

---

## 8. Progression / Leveling

**No levels.** Advancement is **XP-spend driven.** Two parallel XP trackers:

- **TXP (Total XP)** — lifetime XP earned; gates advancement tables &
  retirement. Never decreases.
- **XP (spendable)** — earned to buy traits / advancements.

**Earning XP:** On returning to village + finishing a rest after looting a
dungeon: gain XP = (combined gold value of all treasure brought back) ÷ (number
of **players**, not characters). Unique items value 10,000 (or 500 if it becomes
useless after use).

**Spending XP — three options when you get an advancement bonus:**
1. Increase **two** skills you don't already have a bonus in by +1 (max +2), OR
2. Increase **Stamina max by 4**, OR
3. Increase **one** new skill bonus by +1 (max +2) **and** Stamina max by +2.

**Skill and Stamina Advancement table** (TXP → bonus #):
| TXP | Bonus |
|---|---|
| 100 | 1st |
| 500 | 2nd |
| 1,250 | 3rd |
| 2,250 | 4th |
| 3,500 | 5th |
| 5,000 | 6th |
| every 5,000 after | 7th and up |

**Characteristics Advancement table** (TXP → characteristic increase, +1 each,
max 3; if all are 3, gain 4 Stamina instead):
| TXP | Bonus |
|---|---|
| 5,000 | 1st |
| 15,000 | 2nd |
| every 15,000 after | 3rd and up |

**Buying traits:** spend XP after a rest. Starting traits = 500 each; deeper
traits cost per tier (1000/1500/2000); only along owned connections.

**Death / replacement:** new PC rolls extra times on Backgrounds (= dead PC's
number of bonuses) and may start with XP = lowest TXP in party (catch-up rule).

**Retirement:** at **50,000 TXP** a PC may retire (becomes NPC); grants the
village one benefit (two benefits at 100,000 TXP). Retirement benefits:
Best Steward Ever, Crow Daddy, Generous Benefactor, Master Mentor,
Work With My Hands.

**Starting-trait cap for fresh PCs:** "A new PC with 0 TXP can start with a
maximum of three traits" (via Crow Daddy benefit context).

---

## 9. Spellcasting Structure

**Spellbook-based, item-driven.** No spell slots; no per-class spell lists. A
caster simply **possesses spellbooks** (each spellbook = a discrete item card)
and **owns the matching magic Trait Tree** to enhance them.

**Spell disciplines (6)** — each is both a Skill and a Trait Tree:
Alteration, Benefaction, Conjuration, Elemental, Illusion, Necromancy.

**Spell mechanics (from trait text; full spell cards `[in booklet 05/06]`):**
- Spells have a **rank** (rank 0, 1, 2, 3+...). Rank 0/1 non-doom results
  "don't add to the chaos count"; rank 2+ can trigger **backlash**.
- Spells have a **range**: Melee N or Ranged N (squares); scalable by Mind via
  traits (e.g. "range increases by your Mind").
- Spells may have a **duration** measured in **UD** (usage dice) — traits add UD.
- Spells have **effects** (damage = `+ Mind`, AD grants, blessed/boned, summon
  power = Mind, teleport squares = Mind, etc.).
- Casting can produce **doom** results, **chaos count** additions, and
  **backlash** `[def in Rules]`.

**Spell item schema (inferred fields for the spell/spellbook Item):**
- `name`
- `discipline` (enum: Alteration/Benefaction/Conjuration/Elemental/Illusion/Necromancy)
- `rank` (integer ≥0)
- `range` (Melee N / Ranged N)
- `duration` (UD count, optional)
- `effect` (rules text)
- `ud` / `usageDice` (current/max, for limited-use spellbooks)

**Starting spellbook names found** (from caster backgrounds — these are actual
spell names): minor healing, spark, fire hands, minor blessing, minor ward,
minor curse, monster sense, bone capture, summon object, acid spit, jaunt,
light, take shape, thunder, create water, stream, cacophony, minor phantam
(phantasm), fire lance, teleport object, animal form, repair take (repair?),
shape. (Names as printed; some are clearly typos in the playtest doc.)

---

## 10. Starting Inventory / Equipment

**Every PC starts with (universal):** bedroll, empty coin purse, knife, rope,
six rations. **Plus** the background's `equipment` list (and `spellbooks` for
casters).

**Inventory system = slot-based** (this drives the Foundry encumbrance schema):
- Items occupy **inventory slots** (a.k.a. backpack slots). Each card states a
  `slots` value.
- A **coin purse** = 1 slot, holds up to **500 gc** (currency = gold coins, gc).
- Some traits add specialized **belt slots** (e.g. "alchemy belt slot," "bashing
  holster," "chopping holster," "slashing/stabbing holster" — each holds only one
  weapon category).
- **Backpack slot fields** can be reduced/labeled by traits (Labeled Inventory,
  Out of the Pack).

**Item schema fields seen across cards:**
- Gear: `name`, `price` (gc), `fine` price, `masterwork (MW)` price, (slots
  implied). Fine & MW = improved versions (stats on card; stack vs each other = no).
- **Weapons:** `name`, `price`, `slots`, `type` (Bashing/Bow/Chopping/Slashing/
  Stabbing/Unarmed/Ammunition), `range` (Melee N / Ranged N), `qualities[]`,
  tier-2 & tier-3 damage (on card), `enchantment` (optional).
  - Weapon **qualities** enum: Brutal, Cumbersome, Disengage, Dismember, Light,
    Parry X, Pummeling, Reload.
- **Armor:** `name`, `type` (Shield/Light/Medium/Heavy), `price`, `slots`, `AD`.
  - Base: Light 50gc/2slots/AD5; Medium 150gc/3slots/AD10; Heavy 400gc/4slots/
    AD15; Shield 15gc/1slot/AD5. Worn-suit must occupy backpack slots when not
    worn; only one suit worn at a time; can't don/doff outside combat rounds.
  - Upgrades (material) add AD (+4…+20 suit; +2…+10 shield) and have crafting
    skill/material/goal.
  - **Enchantments** (named) require +1 or +2 Enchanting bonus; have price/skill/
    materials/goal. Enum (armor): Banishing, Climbing, Dancing, Deep, Demon's Head,
    Feather, Flying, Glow, Heavy, Luring, Passthrough, Revenge, Silent, Slick,
    Speedy, Spell-Storing, Sustaining, Telepathic Node, Victory, Waterwalking.
  - Weapon enchantments enum: Absorbing, Dancing, Defending, Exploding, Flaming,
    Frosty, Gashing, Hewing, Hungry, Impact, Infinity, Lightning, Poisoning,
    Raging, Returning, Slaying, Sworn Foe, Teleporting, Vicious, Weakening.
- **Alchemy items:** Acid Vial, Acid Vial Strong, Fire Bomb, Healing Potion,
  Poison Vial, Poison Vial Strong, Rage Potion, Speed Potion (each w/ price).
- **Crafting materials:** generic card w/ `size` (Small/Medium) + stack limit;
  e.g. iron bar, archmage obsidian bar, necromancer silver bar, star diamond bar,
  yew log, archmage willow log, necromancer deathtree log, starwood log,
  + monster body parts (hides/hearts/brains/blood by creature type:
  blood/undead/demon/angel/plant/elemental).
- **Treasure:** art objects (generic card, name+value) and gems (generic card).

**Money:** currency = **gold coins (gc)**. Coin purse = 1 slot / 500 gc cap.

---

## 11. Other Character-Sheet Data Fields

Things that become sheet fields / sub-documents:

- **Village (group/shared, not per-PC but linked):** Prosperity (-10 to +10,
  start 0), village cycle (10 days), institutions (each: name, steward NPC,
  level, founding price, advancement table). Institution types found: Alchemist,
  Auction House, Barracks, Blacksmith, Bookseller, Crypt, Enchanter, General
  Store, Inn, Stables, Temple, Wheelwright. Starting institutions: blacksmith,
  crypt, general store, temple + one chosen, all level 1.
- **Pets / companions:** `name`, owner, `power`/`pace`, backpack slots (which can
  take wounds), barding (armor for pets), can be ridden if larger than rider
  (rider occupies 6 of pet's slots). Pet types: Cat, Dog, Goat, Horse.
  Pet acquisition test: `2d10 + M + Handle Animal` (≤11 refuse / 12–16 follow /
  17+ owner). Full pet stat blocks `[in Bestiary]`.
- **Crypt boons** (per-PC buff granted at a fellow crow's death): Boon of
  Cooperation, Disappearance, Escape, Flight, Fury, Greed, Knowledge, Rescue,
  Swiftness, Vitality. (One active at a time; sheet flag.)
- **Conditions/states referenced** (full defs `[in Rules]`): prone, grabbed,
  blessed (level), boned (level), invisible, hidden, blessed/boned counters,
  "wounds." A conditions enum should be sourced from the Rules booklet.
- **Free-text:** name, distinguishing feature.
- **Trackers:** TXP, spendable XP, Stamina (current/max), wounds, Speed,
  characteristic values, per-skill bonus, owned traits[], inventory[], spellbooks[],
  coin (gc), active crypt boon, blessed/boned levels.

---

## Explicit Gaps / Items NOT in Booklet 02 (source elsewhere)

1. **Characteristic count & 4th characteristic** — only S/A/M seen; possibly
   only 3. Confirm in Rules booklet (01).
2. **Skill → characteristic mapping table** — `[in Rules]`.
3. **Conditions list & definitions** (prone, boned, blessed mechanics, wounds
   capacity, doom/RR/tier rules, chaos count, backlash) — `[in Rules]`.
4. **Ancestries/species** — appear to NOT EXIST (PCs are human-default).
5. **Classes** — do NOT EXIST (classless; trait-tree based).
6. **Full per-spell stat cards** (rank/range/effect tables) — `[in booklets
   05/06]`; only spell *names* appear in 02.
7. **Full weapon/armor/item card stats (tier-1/2/3 damage numbers)** — partial
   here; full on cards `[booklets 05/06]`.
8. **Hirelings & vehicles** — explicitly deferred ("included in future
   playtests").
9. **Barracks, Wheelwright details; some Temple/Stables services** — flagged
   "future version" in 02.
