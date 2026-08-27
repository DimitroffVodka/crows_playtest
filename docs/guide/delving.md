# Delving

Dungeon play is a race against a clock the table can see. The Ref keeps the
real-time timer, decides when the group has reached the end of a Dungeon Turn
(DT), and decides what an encounter means. The system keeps the DT counter,
rolls the clocks that belong to a DT, and records encounter results that need
to carry into the next turn.

This guide is for players and Refs using the current Playtest 2 system.

## The Ref's first pass

When the party enters a dungeon:

1. Give the dungeon a stable id for this campaign and open its first entry for
   Greed:

   ```js
   await game.crows.enterDungeon("blood-library")
   ```

2. Tell the players that DT 1 has begun and start the shared timer. The first
   DT is not started by Foundry's clock; the Ref starts it at the table.
3. During the turn, let the players explore, search, fight, and make tests.
   Make an extra encounter check when they do something that attracts a lot of
   attention.
4. When the timer or the chosen room count says the turn is over, the GM uses
   **End DT** on a Crow sheet, or:

   ```js
   await game.crows.dt.end()
   ```

5. When the party leaves, close the Greed entry:

   ```js
   await game.crows.leaveDungeon("blood-library")
   ```

The dungeon id must not be blank. `enterDungeon` and `leaveDungeon` update a
world record, not an Actor, so a party wipe and replacement Crows do not reset
the first-entry bonus. The system does not reset the DT counter when a new
dungeon is entered; keep the dungeon's within-entry DT number separately for
Greed.

## Dungeon Turns and the DT clock

### What a DT means

A normal DT is **30 minutes of real-world time**. The Ref should run a phone or
similar timer and share it with the players. Do not shorten or lengthen the
timer because a search took five fictional minutes or a combat took twenty;
the pressure is intentionally tied to table time.

The world setting **Dungeon Turn length** offers four choices:

| Setting | What the table uses |
| --- | --- |
| `standard` | 30 minutes (default) |
| `relaxed` | 60 minutes |
| `intense` | 20 minutes |
| `rooms` | End after **1d6 rooms**; there is no fixed minute count |

The setting labels the pacing in the End DT summary. It does not run a timer,
count rooms, or change the encounter roll for you. In `rooms` mode, the Ref
rolls the room count and decides when those rooms have been explored.

The system's `dtCounter` is a world counter. It starts at 0 and advances when
the Ref ends a turn; it is the number displayed in the Crow sheet's Time strip.
Calling `bump` directly only increments that counter and skips the normal
end-of-DT work, so use **End DT** for ordinary play.

### What End DT does

Each **End DT** runs this sequence:

1. A telegraphed encounter saved by the previous End DT is consumed and a GM
   card announces that it landed.
2. The end-of-DT clocks run:
   - Every Crow Item with an enabled usage die whose expiry is `dt` rolls its
     whole pool. Every die showing **1 or 2** is removed; 3–6 survive. More
     than one die can disappear in the same turn.
   - `blessed`, `vulnerable`, and `weakened` end on Crows. `prone`, `grabbed`,
     `unconscious`, and `defeated` do not end just because the DT ends.
   - A canonical backlash usage-die pool on an Active Effect is rolled on any
     Actor, including monsters. When its pool reaches 0, the whole effect is
     deleted.
   - The per-DT side effect of a Swiftness boon is cleared.
3. The world DT counter advances by 1.
4. The system rolls a fresh encounter check and posts its GM card.

The system tracks those state changes and posts the summary. The Ref still
chooses the encounter table, describes signs and encounters, and runs the
encounter. There is no automatic combat encounter or automatic encounter-table
roll.

Playtest 2 has no `boned` condition. It is not an end-of-DT condition and should
not be recreated as `weakened`.

### Encounter checks

Roll **1d10** against the current Encounter Number (EN). A result equal to or
greater than EN triggers.

| Situation | EN |
| --- | ---: |
| Ordinary dungeon level | 9 |
| The level is crowded (more than 20 creatures as a guideline) **or** the PCs left obvious chaos behind | 8 |
| Both crowded and chaotic | 7 |

The GM settings are named **Dungeon level is crowded** and **Party left chaos
behind**. The latter covers things such as corpses, sprung traps, and open
doors. The two settings are facts from which the system derives EN; there is
no free-typed EN setting.

A **10 always lands immediately**, regardless of how far it is above EN. Any
other triggering result gives the players a sign now and schedules the
encounter for a point during the next DT. For example, a 9 at EN 7 triggers but
does not land immediately.

The End DT path stores a sub-10 trigger as a world `pendingEncounter`, so it
survives a reload. The Ref can drop it at the chosen moment with:

```js
await game.crows.resolvePendingEncounter()
```

If it is left pending, the next **End DT** call consumes it before rolling the
new check and posts **“The telegraphed encounter landed this turn.”** The card
does not choose a table or start combat.

The GM **Encounter** button and `game.crows.dt.encounterCheck()` are useful for
noise and other attention-getting actions. An ad-hoc check posts the result,
but a telegraphed ad-hoc result is not saved in `pendingEncounter`; the Ref must
remember to place that encounter during the next DT.

## Greed: value treasure quickly

Greed is a first-entry, once-per-dungeon reward. The group gets it during the
first three DTs of its first entry into a dungeon, even if the characters later
change. It is a group-of-players claim, not a Crow claim.

The Ref must do three things explicitly:

1. Open the entry with `enterDungeon(dungeonId)` before the delve.
2. Keep the **DT within that entry**: 1, 2, or 3. The world DT counter is not
   reset by entering a dungeon, and the system cannot infer which dungeon a
   treasure came from.
3. For each find, call **Apply Greed Bonus** or supply the face value and DT to
   `game.crows.applyGreedBonus`:

   ```js
   await game.crows.applyGreedBonus({
     dungeonId: "blood-library",
     dt: 2,
     value: 33,
     label: "Jade mask"
   })
   ```

The result is a GM chat card. The operation is read-only: it does not change
an Item's stored value, add coins, or award XP automatically. Use its `total`
as the value of an ordinary treasure in later bookkeeping.

| DT within the first entry | Greed bonus |
| ---: | ---: |
| 1 | +30% |
| 2 | +20% |
| 3 | +10% |
| 4 and later | No bonus |

The code rounds the face value to a non-negative whole gc, then rounds the
**bonus**, not the total:

```text
bonus = round(value × multiplier)
total = value + bonus
```

So a 33-gc find on DT 2 is `33 + round(6.6) = 40 gc`. A 33-gc find on DT 1 is
`33 + round(9.9) = 43 gc`. This rounding is deliberate: the chat card's three
numbers always satisfy `total - value === bonus` exactly.

The bonus is refused, with face value unchanged, when the dungeon has no id,
the entry was not opened, the entry has been spent, or the DT is outside the
window. Calling `leaveDungeon(dungeonId)` changes the world record to spent;
that is what burns the claim permanently. Call it when the group leaves, not
when the first find is collected, or DT 2 and DT 3 will lose their bonuses.

## Crypt boons

The Crypt lets the table carry something useful out of a dead Crow's story.
When a Crow dies during an adventure, the Ref can bring the remains to the
village Crypt and inter them. The dead Crow's player chooses one boon. The
current Crow sheet exposes this to a GM as **Inter**.

The active Crypt level is the Village Crypt's effective level. If the Crypt is
5th level and Prosperity is 10, boon effects use level **6**; level 6 is not
stored as a purchasable institution level. When there is no Village authority,
the old hidden Crypt-level setting is only a fallback.

The Crypt's cycle counter is separate from the Village cycle counter. Ending a
Village cycle does not advance it. A GM must use **Advance cycle** in the Crypt
panel, or:

```js
await game.crows.crypt.bumpCycle()
```

Use that exactly once for each Crypt cycle. It does not clear an active boon.

### Pray and expend

1. The Ref inters the dead Crow and records the player's boon choice.
2. A living Crow chooses a grave and presses **Pray**. That Crow can pray once
   per Crypt cycle. The system records the source grave and the number of uses.
3. A Crow can hold one active boon. Praying for another replaces the old boon.
   The system refuses a second Crow trying to hold the same grave's boon at the
   same time.
4. **Expend** takes no action in the rules. It removes one use and posts the
   boon text. Boon of Rescue has a number of uses equal to the Crypt level;
   every other boon has one use.

Let `L` be the effective Crypt level:

| Boon | What one active boon does at level `L` | Current system path |
| --- | --- | --- |
| **Boon of Cooperation** | On the next assist, add **+2L** to the test you aid. | Ref adjudicates the assist. |
| **Boon of Disappearance** | Become invisible for **L combat rounds**. | Ref tracks combat rounds; invisibility is not a condition or DT timer. |
| **Boon of Escape** | Teleport **3L squares**. | Ref adjudicates. |
| **Boon of Flight** | Gain flying speed equal to your speed for **L combat rounds**. | Ref tracks combat rounds. |
| **Boon of Fury** | Add **L d6** damage to a damaging attack. | Wired to a Crow's weapon attack: it rolls `L d6`, adds the result to both tier-2 and tier-3 damage, then rolls the attack. |
| **Boon of Greed** | Learn the direction and number of chambers to the **L most valuable treasures** on the dungeon level. | Ref adjudicates. |
| **Boon of Knowledge** | Ask the Ref up to **L honest questions** about one named creature, place, event, or organization. | Ref adjudicates. |
| **Boon of Rescue** | After a Recovery Roll, improve the result by 1 tier; you may do this **L times**. | Ref adjudicates; there is no generic Recovery Roll action in the system. |
| **Boon of Swiftness** | Increase speed by **L** until the end of the DT. | The helper is available, but the sheet's generic Expend button does not invoke it. Apply it with the Ref or `game.crows.crypt.consumeBoonOnSwiftness(actor)`. |
| **Boon of Vitality** | The next time you regain Stamina, regain **+2L** additional Stamina. | Wired to the Crow healing path and capped at Stamina maximum. |

The generic **Expend** action is therefore not the same as applying a boon in
its situation. Fury and Vitality are consumed by their wired action paths; the
narrative boons only post text; and Swiftness needs its explicit helper or Ref
adjudication. Watch Vitality in particular: a healing operation with a positive
amount can consume it even when the Crow has no room to regain more Stamina.

## Miasma

Miasma is a world environment flag, not a condition on each Crow. The GM
setting is **Party is in the Miasma**. Turn it on for an outdoor Miasma area and
off in town or in a fully enclosed stone or metal space. Foundry does not infer
the geography, so the Ref controls the flag.

Playtest 2 stores Miasma state as an integer `cruelty` resource and paired
effect rows. There is no `boned` condition and no accumulating Playtest 1 chaos
count here.

### Resistance at the end of a rest

The rule calls for every human in the Miasma (a Crow or a human monster Actor)
to make a **Miasma Resist** at the end of a non-town rest:

```text
2d10 + M − cruelty
```

Each cruelty level is a **−1** penalty to this resist only. The system offers
the Crow's **Endurance** expertise on the test card when the Crow has a legal
use. A test card can remain pending until its owner spends Endurance or
declines; the Miasma result is resolved only when the test is committed. The
automatic rest path currently accepts Crows only; a Ref must start the test for
a human monster separately.

| Committed tier | Result |
| ---: | --- |
| 1 (≤11) | Gain 1 cruelty, then roll the Effects table using the new cruelty. |
| 2 (12–16) | No effect; cruelty stays as it is. |
| 3 (17+) | The implemented branch clears all cruelty. The alternative—improve another resting human's result by one tier—is a Ref-adjudicated narrative choice. |

For a tier-1 result, roll **1d10 + current cruelty**. The system stores the
numeric bucket and grants both effects in that row. The second effect lasts as
long as the first. A row already affecting the Crow is rerolled; after the
available rows have all been found, the code can report that no new paired row
was available rather than inventing another effect.

### The Playtest 2 effect pairs

| Roll | First effect | Paired effect |
| ---: | --- | --- |
| 1–2 | **Despondent:** speak only when spoken to first, and then only in one-word responses until out of Miasma. | Edge on tests to sneak or hide. |
| 3–4 | **Ravenous:** eat at least 2 rations during a rest to receive that rest's benefits until out of Miasma. | **+2** on tests related to the forage role. |
| 5–6 | **Destructive Rage:** the Ref randomly chooses and destroys one mundane backpack item immediately. | Regain **3 Stamina**, or if full, lose 1 wound. Both are immediate. |
| 7–8 | **Deceitful:** communicate only in lies until out of Miasma. | Choose an expertise you do not have; gain it. |
| 9–10 | **Lazy:** refuse every travel role until out of Miasma. | **Restful Recovery:** rest removes 2 wounds instead of 1. |
| 11–12 | **Violence:** keep pursuing and fighting foes until you can no longer sense them; it ends when cruelty is gone. | **+1 damage** on weapon attacks. |
| 13+ | **Permanent NPC:** other Miasma effects and cruelty end; no new Miasma effects apply; the Crow is permanently selfish and cruel and becomes a Ref-controlled NPC. | Finishing a rest in Miasma should refresh expertise uses. |

### What the system applies

For a non-catastrophic paired row, the Miasma chat card prints both texts. The
Downtime panel currently renders only the first effect's text for each stored
bucket, so use the chat card and the table above as the complete result. The
13+ catastrophic card prints only the Permanent NPC outcome; its printed
expertise-refresh text remains a Ref handoff.

The current implementation has a few deliberate Ref handoffs and gaps:

- The 9–10 row's **Restful Recovery** is wired into rest and changes the one
  wound removal to two. It does not stack to three with **Tend Wounds**.
- The 1–2, 3–4, 7–8, and 11–12 narrative or numeric benefits are announced but
  are not all automatic rules integrations. The system does not add the
  sneak/hide edge or forage and weapon-damage bonuses, enforce the extra
  ration, grant the chosen Self-Deception expertise, force the violent pursuit,
  or perform the destructive/restorative actions. The Ref must resolve those
  from the card.
- The 5–6 row is removed from the active bucket after it is announced, but the
  system does not itself destroy the item or change Stamina/wounds.
- The 13+ result sets `permanentNPC`, clears the stored cruelty/effect rows, and
  prevents future Miasma tests. It does not implement the paired **Miasma
  Expertise Refresh** benefit; the Ref must adjudicate it if using the printed
  text.

Leaving the Miasma also has two separate pieces of state. Use **Clear Miasma**
or `game.crows.miasma.clear(actor)` to remove rows that end on leaving; merely
turning off the world setting does not do that. A completed rest outside the
Miasma clears all cruelty and the cruelty-tied Violence row, but it does not
automatically clear rows whose duration is “until out of the Miasma.”

## Rest and recovery

A full rest requires **6 uninterrupted in-game hours** in one place, with at
least **4 hours asleep**, no strenuous activity, and at least **1 ration or
equivalent food**. The Ref tracks those requirements. The system's rest action
does not measure elapsed time or consume a ration item.

### A non-town rest timeline

Rests occur outside DTs. When a non-town rest starts, the current DT ends and
the counter advances **without** an encounter check. The system then runs the
rest clock as follows:

| Time in the rest | System action |
| ---: | --- |
| Start | End the current DT; no end-of-DT encounter check. |
| 2 hours | Dungeon-style encounter check. |
| 3 hours | Run end-of-DT effects: DT usage dice, expiring conditions, backlash pools, and per-DT boon cleanup. |
| 4 hours | Dungeon-style encounter check. |
| 6 hours | Dungeon-style encounter check, then apply rest benefits. |

**Seclude Camp** is a rest activity for one person in the group. It lowers EN
by 1 for these rest checks and does not require the rest to finish. A resulting
EN is still bounded at 2, so the setting cannot make every 1d10 trigger.

The system stops later rest checks when one triggers and returns
`interrupted: true`. The printed rule says an interrupted rest must start over;
the current code still applies the normal rest benefits, opens the advancement
window, and does not use a universal restart gate for activities, so the Ref
must decide how to honor the interruption fiction. It also does not start
combat or save a telegraphed rest encounter automatically.

For a group, make the checks once. `takeRest` defaults to checking on each
call; a caller coordinating individual Crows should pass
`encounterChecks: false` for the other Crows rather than rolling the same rest
three times.

### Benefits of a completed rest

The Crow's rest action:

- restores Stamina to its maximum;
- removes one wound from a backpack slot chosen by the player;
- restores each owned expertise's remaining `value` to its owned `max`, except
  in Miasma;
- resets configured per-rest trait pools, including in Miasma;
- restores every Item usage die whose expiry is `rest` to its maximum;
- clears Miasma cruelty when the rest is outside the Miasma; and
- opens that Crow's end-of-rest advancement window.

An overloaded magic slot blocks the rest before any of these writes. The exact
warning is **“Magic item slot overload — two items in one slot. You cannot rest
until one is removed (R:460).”**

The available full-rest activities are:

- **Tend Wounds:** choose another creature with at least 2 wounds. You cannot
  target yourself. That creature's rest removes 2 wounds instead of 1. The
  system handles either order if the target rests before the tending Crow.
- **Identify Item:** identify one magic Item when the rest finishes.
- **Prepare for Task:** name a specific task in a specific place. On the next
  matching test, the stored **+2** bonus is consumed; matching is trimmed and
  case-insensitive. The printed duration is until the next completed rest; the
  current rest path does not clear an unused preparation automatically, so the
  Ref should clear it at that point.
- **Craft Equipment:** make the active project's crafting roll, or leave an
  ad-hoc project for Ref adjudication.
- **Harvest:** destroy a corpse and roll parts; see [Corpses](#corpses).
- **Repair Armor:** restore one suit of armor or shield to full AD.
- **Seclude Camp:** lower EN by 1 for this group's rest, once per group, without
  needing the rest to finish.
- **Bond with Pet:** complete a pending bond only if the rest completes. This
  activity is registered in the rest helper but is not offered in the current
  Rest dialog; use the pet workflow or adjudicate it as Ref.

In a village or other place with no chance of encounters, the separate
`takeTownActivity` path allows up to **4** no-sleep activities per Crow per
day, normally about 2 hours each, with the benefit landing after those 2 hours.
Tend Wounds is the exception: it costs 4 hours of sleep, is once per day, and
does not use one of the four no-sleep slots. The current Crow sheet exposes the
full **Town rest** checkbox, but not a separate town-activity picker; a Ref or
macro must use that path.

The Miasma exception is narrow: in-Miasma rest suppresses only the expertise
refresh. Stamina, wound removal, trait-pool reset, Item recharge, and the
selected activity still apply. The automatic Miasma resist happens after the
rest work. If that test cannot be completed, the system returns
`miasma-resist-failed` after applying the benefits and marks the result
non-retryable; do not repeat the rest.

## Corpses

A corpse is an object, not an Actor or an Item in the inventory. Carrying one
uses the same free slots as other carried things, and the corpse's equipment
comes along too.

| Corpse size | Body slots | Bodies per stack |
| --- | ---: | ---: |
| Tiny | 1 | 3 |
| Small | 2 | 1 |
| Medium | 4 | 1 |
| Large | 8 | 1 |
| Huge | 16 | 1 |
| Holy Shit! | 32 | 1 |

Add the slots occupied by equipment on the body. A Medium corpse with 3 slots
of equipment costs 7 slots. Four Tiny corpses cost 2 body slots. Holy Shit!
corpses may take more slots at the Ref's discretion.

Wounds do not reduce the free-slot count: a wounded backpack slot can still
hold an item or corpse, although a wound-and-item slot can reduce speed. An
unknown size is refused rather than silently treated as free. Corpses are not
embedded Items, and the current sheet has no corpse-carry card or automatic
capacity mutation; the Ref tracks the body and compares its cost with the
Crow's free layout.

### Harvesting

Choose **Harvest** as a full-rest activity and supply the corpse's size:

| Corpse size | Parts roll |
| --- | --- |
| Tiny, Small, or Medium | `1d6` |
| Large | `2d6` |
| Huge | `3d6` |
| Holy Shit! | `4d6` |

Harvesting destroys the corpse. The current dialog accepts a typed target name
and a size, then posts the roll and “The corpse is destroyed (R:652).” It does
not verify that the named object is a corpse or remove one from a scene, so the
Ref must make that adjudication and mark the corpse gone.

## Hirelings

Hirelings come from the village **Barracks** and use Bestiary human stat
blocks. The Barracks' maximum available power is:

| Barracks level | Maximum hireling power |
| ---: | ---: |
| 1 | 2 |
| 2 | 4 |
| 3 | 6 |
| 4 | 8 |
| 5 | 10 |

The system's employment helper can refuse a hireling above that ceiling or a
party with an outstanding hireling debt when the Ref supplies that debt to the
check. The current Crow sheet has no hire button, and hireling helpers are not
exposed on `game.crows`; the Ref must choose the Bestiary Actor and set up the
employment record through the helper or a table ledger.

### Engage and pay

At the **start of each day of service**, pay both parts of the contract:

```text
daily gc = power × 10, minimum 10 gc
food = 1 ration
```

Examples: power 1 costs 10 gc and 1 ration; power 4 costs 40 gc and 1 ration;
power 10 costs 100 gc and 1 ration. At Barracks level 5 and Prosperity 10,
each hireling arrives with **12 rations of their own**, which they use before
the party has to feed them.

The implemented `payDay` path records days served, salary paid, and whether the
hireling's own provisions were used. It does **not** debit `system.currency` or
consume a ration Item. The Ref must move the physical money and food, then
record the day as paid. Once the hireling's own provisions are gone, withholding
either the coin or the required food marks the day unpaid: the hireling leaves,
the outstanding debt increases by the daily wage, and the hireling blackballs
the employer and associated Crows until the debt is paid.

Hirelings are controlled by the player of the hiring Crow. The Ref may take
control if the player makes the hireling do something very out of character or
“outlandishly dangerous for little to no reward.” Hirelings otherwise follow PC
rules: they can use equipment, have expertises, and take actions, maneuvers, and
rest activities. They cannot gain or spend XP. The current `takeRest` action
accepts Crows only, so the Ref must adjudicate a hireling's rest and recovery.

### When a hireling dies

Death is expensive and the bill is deferred until the party returns to the
village where that hireling was hired. The family is owed:

```text
equipment (or treasure of equal value)
+ salary already paid
+ power × 500 gc
```

Salary already paid is added to the bill; it is not a credit. For a power-4
hireling with 240 gc of salary already paid and 300 gc of equipment, the bill is
`300 + 240 + 2,000 = 2,540 gc`.

The system's death path posts a card with the exact amount owed and records the
hireling as dead. It does not take equipment or treasure, transfer coins, or
settle the family claim. At the hired village, the Ref must hand over the
equipment or equal-value treasure and record the debt as paid. A missed daily
payment adds its wage to the same outstanding-debt concept; paying only part
of a debt does not lift the blackball.

If the employer dies, a surviving Crow can take over the hireling on the same
terms. If no living Crow is willing, the hireling returns to the village where
they were hired.

## From recovered treasure to XP

When the party has recovered the haul, use the Greed-adjusted value for an
ordinary treasure and calculate each player's share. The system's `treasureXP`
calculation:

- sums the counted values;
- uses an explicit unique-item `xpValue` **instead of** its gold value;
- excludes anything `purchased`, `crafted`, taken from an innocent, originally
  an ally's, or not recovered outside the village; and
- divides by the number of players, rounding the per-player result down.

For example, 750 gc among 4 players is **187 XP** each. There is no automatic
connection from a recovered Item or a Greed card to XP, so the Ref grants that
share to each Crow. Hirelings do not receive XP. TXP is lifetime; a correction
can reduce spendable XP but does not reduce TXP.

The advancement window opens at the end of a completed rest. See
[Making a crow](making-a-crow.md) for the advancement choices and XP spending
rules.
