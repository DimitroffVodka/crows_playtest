# Making a crow

This is the player-and-Ref path for making a Playtest 2 crow and getting them
to the table. A crow is a Foundry **Actor** whose type is `crow`.

## The one-minute version

1. Create a `crow` Actor and give the player ownership of it.
2. Open the sheet's **Bio** tab and choose **Open Character Creator**.
3. Roll `2d6` for a background or pick one of the 36 backgrounds.
4. Choose the characteristic the background sets to 2, then choose `1 / 0` or
   `2 / -1` for the other two characteristics.
5. Enter the name, distinguishing feature, and NPC connection, then click
   **Create**.

The creator supplies the background's Stamina, expertises, equipment,
spellbooks, and starting trait. It also supplies the universal kit, rolls
starting gold, and creates a starting pet when the background grants one.

## Use the character creator

The creator is a dialog with four sections.

**1. Background.** Click **Roll 2d6** or choose a background from the dropdown.
The preview shows the background's characteristic option(s), Stamina, starting
trait, and a description area. The shipped backgrounds do not currently carry
`system.description`, so that area is blank; their flavor text is on the
Background card and in the Bio summary. Rolling is a real `2d6` roll; choosing
from the list is not another roll.

**2. Characteristics.** Choose one of the options the background allows to set
to 2. Then choose a remaining spread:

| Choice | Background characteristic | Remaining two |
| --- | ---: | --- |
| `1 and 0` | 2 | the selected one is 1; the other is 0 |
| `2 and -1` | 2 | the selected one is 2; the other is -1 |

The system writes all three values. It does not roll them. A background with a
fixed option only offers that characteristic; a two-option background lets you
choose between those two; a background with all three options lets you choose
any one.

**3. Name & distinguishing feature.** These are player-entered text. A blank
name leaves the Actor's existing name in place.

**4. NPC connection.** Enter a name, relationship, and notes. These fields are
stored on the crow; the creator does not invent a connection for you.

When you click **Create**, the system sets Speed to 5, records the background
name and stable background id, applies the characteristic spread, and posts a
chat card headed:

> **Crow name — character created**

The card lists the background, characteristics, total expertise uses granted,
starting gold, universal-kit item count, NPC connection, and any bonded pets.
The notification is simply `Crow name created!`.

### Applying creation again

If the Actor already has items or TXP, the creator asks:

> **Apply creation to an existing crow?**
>
> `Crow name already has N item(s) and T TXP. Continuing adds the background's expertise uses and items to the existing actor.`

This is an additive operation, not a reset or undo. It does not clear XP or old
items. It reapplies the background's Stamina and appends its grants; the
universal kit skips a kit item that the Actor already owns by name, but a
background grant itself is not a general-purpose deduplication pass. Do not
click **Create** again to repair an ordinary sheet edit.

For a macro or integration, the same dialog is available as
`game.crows.creator.open(actor)`.

## Backgrounds

A background supplies four kinds of character information:

- a Stamina maximum (and current Stamina) from the background card;
- one characteristic set to 2, either fixed or chosen from its allowed list;
- one or more expertises, with each listed use count;
- a starting trait, equipment, and sometimes spellbooks.

The starting expertise uses are owned uses, not a permanent bonus to every
roll. The creator raises both `max` (uses owned) and `value` (uses remaining)
by the listed amount. For example, an expertise granted as 2 uses starts at
`2 / 2`; if the crow already had `1 / 1`, applying that background makes it
`3 / 3`.

Background equipment is cloned into real Item cards and auto-packed into the
backpack. Spellbooks and the starting trait are embedded without a carry-slot
location. Traits are listed on the Main tab; spellbooks are named in the Bio
provenance panel, but the current Crow sheet does not render no-location
spellbooks as clickable inventory cards. The underlying spellbook Items still
exist. The shipped background equipment names resolve to the shipped item
cards, including specializations such as `Lore Book (Historical Lore)` and
quantities such as `Animal Feed (6)`.

### Background sheets are read-only

The Background sheet is a printed compendium card, not a character editor. Its
content is authored in `src/packs/crows-backgrounds/*.yaml` and rebuilt by
`npm run pack`.

> An edit made on a background sheet is discarded at the next build.

The card is deliberately shown without input controls. Use the creator to
choose a background and let it apply the grants; do not try to repair a
background by editing its sheet. The Bio tab's **What your background gave you**
panel is a record of those grants and does not change the crow.

### Dropping a background onto a crow

Dragging a Background Item onto a Crow sheet is a separate, smaller path. It
calls `applyBackground` and does **not** run the full creator.

| A direct background drop does | A direct background drop does not |
| --- | --- |
| set the background name and id | choose or set characteristics |
| set Stamina current/max to the card's value | set Speed, name, feature, or NPC connection |
| add the background's expertise `max` and `value` | add the universal kit |
| clone its equipment, spellbooks, and starting trait | roll or write the universal `3d6` gold |
|  | apply background bonus gold |
|  | create or bond a live pet |

The Background Item itself is not embedded. The drop has no character-created
summary card, and repeating it adds the expertise uses and item grants again.
Use **Open Character Creator** for a new crow or whenever the universal kit,
gold, characteristics, and starting pet matter.

## Starting equipment and money

Every full creator run gives the universal kit:

- one **Coin Purse**, initially empty;
- one **Knife**;
- one **Rope**;
- six **Ration** units, carried as the ration Item's quantity;
- `3d6` gc in the crow's currency.

The current kit does **not** include a Bedroll. That was part of the Playtest 1
creator, not the current universal kit.

Two shipped backgrounds add money on top of the universal roll: **Merchant**
and **Noble** each grant 50 gc. The creator writes the combined amount. In the
Bio provenance panel this appears as, for example:

> `3d6 plus 50 gc from the background`

A direct background drop does not write either the `3d6` roll or that bonus.
Once the crow exists, the purse, loose coin, capacity, and payment order work
as described in [Money and shopping](money-and-shopping.md).

The four starting animals are also background grants: **Farmer** gives a Goat,
**Hunter** a Dog, and **Knight** and **Noble** a Riding Horse. The full creator
looks up the matching monster stat block, creates an Actor named for its owner
(for example, `Mara's Goat`), copies the crow's ownership, and bonds it to the
crow. A direct background drop returns the pet request to its caller but does
not create the animal, and the drop handler does not show a pet summary.

If a required starter item is missing, or a starter Item batch cannot be
committed, creation reports a failure such as:

> `starter item not found: Coin Purse`

or the underlying grant refusal. A failed starter batch stops the later gold
and pet steps, but earlier identity/background writes are not rolled back. The
missing-item case is awkward: the result is `ok: false`, but the chat card can
still be headed **character created** while the warning names the missing item.
The creator can also make a one-slot Gear stub for a custom background equipment
name that does not resolve; the unresolved name is reported in the result but
does not currently stop the creation card. The shipped 36 backgrounds do not
need that fallback.

## Traits and trait trees

The crow sheet's **Main** tab lists embedded traits. The **Advancement** tab
has a tree picker and a four-tier by three-column grid. The 23 trees are:

`Alchemy`, `Alteration`, `Archery`, `Armor`, `Bashing`, `Benefaction`,
`Blacksmithing`, `Camping`, `Chopping`, `Conjuration`, `Elemental`,
`Enchantment`, `Illusion`, `Knowledge`, `Leverage`, `Necromancy`, `Pets`,
`Reputation`, `Slashing`, `Stabbing`, `Thievery`, `Travel`, and `Unarmed`.

The starting trait from a background is embedded automatically and costs no
XP. It is also possible to buy an unowned starting trait from a tree for 500
XP. Every other trait must connect by a line to a trait already owned on the
same tree. The system checks the connection in either direction, because the
compendium only needs to list it from one end.

Trait costs are fixed by tier:

| Tier | Cost |
| ---: | ---: |
| 1 (including a starting trait) | 500 XP |
| 2 | 1,000 XP |
| 3 | 1,500 XP |
| 4 | 2,000 XP |

Each trait can be bought once. The purchase needs enough **Spendable XP** and
is allowed only at the end of a rest. If the window is closed, the visible
reason is:

> `Advancement can only be claimed at the end of a rest.`

Traits with a configured per-rest pool show `remaining/max uses` on the Main
tab. A pool sized by a characteristic has a minimum of 1, even if that
characteristic is 0 or negative. A rest resets a trait pool's spent uses; a
characteristic drain does not retroactively refund an already-spent use. Trait
cards themselves are shipped content and are also read-only.

## Expertises

An expertise is a per-rest pool. The sheet shows **remaining / owned** uses,
for example `2 / 2`. Spending a use lowers the remaining number; it never
lowers the owned maximum. A completed rest normally restores remaining uses to
their owned maximum. Resting in the Miasma leaves spent expertise uses spent.

The three categories and their actual roll permissions are:

| Category | Expertises | Used for |
| --- | --- | --- |
| General | Alchemy, Athletics, Blacksmithing, Enchanting, Endurance, Gymnastics, Handle Pet, Historical Lore, Lift, Magic Lore, Monster Lore, Nature Lore, Navigate, Pick Lock, Religious Lore, Search, Stealth, Thievery | ordinary tests; not attacks or castings |
| Spellcasting | Alteration, Benefaction, Conjuration, Elemental, Illusion, Necromancy | castings; a spell attack offers the exact spell discipline |
| Weapon | Bashing, Bow, Chopping, Slashing, Stabbing, Unarmed | an attack using the matching weapon type |

After a roll, the owning player may see a pending chat card headed:

> **Apply an Expertise?** — *Improve this result by one tier.*

Choose one of the listed legal expertises to spend one use. A test permits one
expertise spend and the result cannot rise above tier 3. A doom, crit, terminal
result, or test with no legal spend commits without waiting for a choice. If
you do not want to spend a use, click **Resolve as rolled**; leaving the card
pending prevents downstream effects from resolving.

There is a second, easy-to-misread control: the **Spend 1** button beside each
expertise on the Main tab. It directly subtracts one remaining use and posts a
message such as:

> `Mara spends one Bow use (1 remaining).`

It does not attach that use to an existing test. To improve a roll, use the
buttons on that roll's pending chat card.

## Advancement and XP

The **Advancement** tab shows Total XP (TXP), Spendable XP, the next threshold,
and unclaimed bonuses. Positive XP raises both TXP and Spendable XP. TXP is a
lifetime total; a negative correction can reduce Spendable XP but never lowers
TXP.

### Earning treasure XP

Treasure XP is the value of recovered treasure divided by the number of players,
rounded down:

```text
per-player XP = floor(counted recovered value / number of players)
```

The following entries are excluded from the counted value:

| Entry | Reported reason |
| --- | --- |
| purchased | `purchased` |
| crafted | `crafted` |
| taken from an innocent | `taken from an innocent` |
| originally an ally's | `originally an ally's` |
| village-sourced / not recovered outside the village | `not recovered outside the village` |

The Ref-facing calculation returns those excluded entries with their names and
reasons; they are not silently discarded. A unique item's explicit `xpValue`
replaces its gold value. For example, an item worth 1,000 gc with
`xpValue: 250` contributes 250, not 1,250.

There is no treasure ledger or arbitrary-XP calculator on the sheet, and
`treasureXP` is not exposed on `game.crows`. The Advancement tab's GM shortcuts
are only **+100**, **+500**, and **+1,000**. Calculate the per-player amount with
the rules above, then the Ref can award the exact amount with, for example:

```js
await game.crows.gainXP(crowActor, 187)
```

### The two advancement tracks

The Expertise & Stamina track earns bonuses at these TXP thresholds:

| Bonus | TXP | Per-expertise maximum after this threshold |
| ---: | ---: | ---: |
| 1 | 100 | 2 |
| 2 | 500 | 2 |
| 3 | 1,250 | 2 |
| 4 | 2,250 | 2 |
| 5 | 3,500 | 2 |
| 6 | 5,000 | 3 |
| 7 | 10,000 | 3 |
| 8 | 20,000 | 4 |
| 9 | 30,000 | 4 |

After 30,000 TXP, another bonus arrives at 60,000, 90,000, and every 30,000
after that. The per-expertise maximum never exceeds 4. For each unclaimed
Expertise & Stamina bonus, choose one:

- **3 expertise uses, distributed freely**;
- **+2 Stamina max**; or
- **1 expertise use and +1 Stamina max**.

Use distribution must be exact. New expertise uses can go into an expertise the
crow has never owned, and a claimed use is available immediately. The system
refuses an allocation that would exceed that TXP's per-expertise maximum.

The characteristic track arrives at 5,000, 15,000, and 30,000 TXP, then every
30,000 after. Each claim raises one characteristic by 1, up to the PC
advancement cap of 4. If all three characteristics are already at least 4,
that characteristic advancement converts to **+2 Stamina max** instead.

Claiming either kind of bonus is gated to the end of a rest. A completed rest
opens the spending window; the next test closes it. A Ref can deliberately
override the gate, but the normal player action is to claim bonuses before
rolling the next test. Retirement is reported as eligible at 60,000 TXP.

## When a player joins an existing world

For a new player joining an already-current world, the Ref needs to create a
`crow` Actor, give the player ownership, and have them use the Bio-tab creator.
Do not use a dropped Background Item as a substitute for the creator: it omits
the characteristic choices, universal kit, gold, and live pet.

For a world carried over from Playtest 1, let a GM load the world before the
party plays. The system's one-time world migration runs at `ready` when the
stored migration version precedes `0.2.2`. It also handles a legacy Actor
imported after that pass when the Actor still carries an older system version.
The GM should read the generated Journal titled:

> **CROWS — Playtest 2 Migration**

It can report over-budget expertises, unresolved backgrounds, illegal or
overloaded placements, wounds forced onto occupied slots, and dropped
Playtest 1 condition state. Reported problems are deliberately left visible for
Ref adjudication.

### Choose the expertise migration policy

Before the first GM migration pass, open **Game Settings → Configure Settings →
System Settings** and find **Playtest 2 expertise migration**. It is a
GM-restricted setting with two choices:

| Setting | What happens |
| --- | --- |
| **Report only (recommended)** | preserves the Actor's existing expertise uses; the Journal calculates and shows what enforcement would trim |
| **Enforce the Playtest 2 budget** | writes the deterministic Playtest 2 trim to the Actor |

The default is `report-only`. The setting controls expertise trimming; the
migration may still stamp a resolved background id/cache and apply other data
repairs. The budget is based on the background's actual current compendium
grants plus three uses per earned/claimed Expertise & Stamina bonus. It reads
uses owned (`max`), not uses remaining (`value`).

Background resolution tries `backgroundId` first, then a trimmed,
case-insensitive background name. If it cannot resolve, if the name is
ambiguous, or if the background still has no trustworthy grants, the report says
so and **skips that crow's budget**. It never treats an unknown background as
zero grants. Fix the content or adjudicate the character, then follow up with
the Ref; do not accept a largest-possible over-budget trim based on missing
information.

Choose the policy before the first migration. Changing the setting later does
not by itself rerun a world whose migration version is already current. An old
Actor imported later uses the setting that is current when its GM-side
straggler migration runs.
