# Tests and conditions

This guide is for players and Refs using the current Playtest 2 system. It
explains what to click, what the system rolls and changes, and which decisions
still belong to the table.

## The one-minute version

- A test is **2d10 + one characteristic + numeric modifiers**, then its edges
  and banes are resolved. The raw dice sum alone decides a doom (2 or 3) or a
  crit (19 or 20).
- A result is tier 1 at 11 or less, tier 2 at 12–16, and tier 3 at 17 or more.
  A tier 1 attack is a miss; tier 2 and tier 3 are hits.
- Edges and banes are counted separately from numeric modifiers. Each side is
  clamped at two before cancellation. Two edges or two banes change the tier;
  one edge or one bane changes the total by 2.
- An applicable expertise is offered **after** the dice. One use improves the
  result by one tier, to a maximum of tier 3. You must spend it or choose
  **Resolve as rolled** before the result is committed.
- The six conditions are Blessed, Grabbed, Prone, Unconscious, Vulnerable, and
  Weakened. They are booleans: a second application does not create another
  level.
- `boned` is not a current condition. It is an old status name, not a seventh
  condition to add or stack.
- Combat uses one side roll per round, not individual initiative. A 1–5 puts
  Enemies first; a 6–10 puts Crows first.
- Damage goes through AD, then Stamina, then wounds. Wounds fill backpack
  slots. A creature with wounds in every slot is defeated; a monster with 0
  slots is defeated at 0 Stamina.

---

## Making a test

### Roll from a Crow sheet

Click the **Strength**, **Agility**, or **Mind** stat box on the Crow sheet.
Those boxes are the system's ordinary test controls. The sheet posts a test
card to chat with the selected characteristic.

For a prepared task, choose **Roll Prepared Task**, choose the characteristic,
and roll. A matching prepared task contributes its stored bonus as a numeric
modifier. The current Playtest 2 task bonus is **+2**; it is tied to the exact
task and location written during the rest activity, not to a general skill.

A Ref can also make an ad-hoc test from the public command surface:

```js
await game.crows.rollTest({
  actor: game.actors.getName("Mara"),
  characteristic: "mind",
  flavor: "Search the blood-stained desk"
})
```

The command accepts the same roll inputs as the sheet. Use it when the table
needs a test that has no dedicated sheet button.

### What the system rolls

The system evaluates a bare **`2d10`**. It records the two-d10 sum as the
**Raw 2d10** value and applies everything else after that:

```text
total = raw 2d10 + characteristic + summed numeric modifiers + edge/bane effect
```

Numeric modifiers are summed. They do not become edges or banes. A prepared
task, a tool bonus, and the **Target surprised** `+1` are examples of modifiers;
they appear as rows in the card's breakdown. A range penalty is also a numeric
modifier: it is **−2 per square** beyond normal range, not a bane.

The ordinary tier bands are:

| Resolved total | Result |
| ---: | --- |
| 11 or less | Tier 1 |
| 12–16 | Tier 2 |
| 17 or more | Tier 3 |

The unmodified dice have two special ranges:

- A raw sum of **2 or 3** is a **doom**. It is tier 1 regardless of edges,
  expertises, or other bonuses. The Ref decides the major setback. Modifiers
  do not rescue it.
- A raw sum of **19 or 20** is a **crit**. It is tier 3 regardless of banes or
  other penalties. The Ref decides the extra benefit. A crit on an attack also
  grants another action; see [Combat flow](#combat-flow).

An Unconscious actor's automatic doom on an Agility or Strength test takes
precedence even if the raw sum is 19 or 20, so that test is not also reported as
a crit.

The card deliberately displays a terminal result's total as **`—`** rather than
pretending that its modifiers mattered. It still shows the raw dice and the
DOOM or CRIT badge.

If the actor has more than one spent X/Rest feature, a crit currently refunds
one use from the first spent feature in stored order. There is no choice prompt
for which feature to refund.

### The expertise decision

When a result has a legal expertise spend, the card remains pending. The owner
sees:

> **Apply an Expertise?** — Improve this result by one tier.

The card offers only the legal expertise buttons and shows each one's remaining
uses. One test can use **one expertise and one use**. Spending it raises the
result one tier, to tier 3 at most; it does not change the displayed total.

The broad categories are:

- General expertises apply to ordinary exploration, investigation, and
  crafting tests.
- Weapon expertises apply to weapon attacks.
- Spellcasting expertises apply to castings. A spell attack uses the matching
  spellcasting discipline; a weapon attack uses its weapon type.

An attack with several targets uses one expertise decision for the roll. One
spend raises every target below tier 3 and leaves targets already at tier 3
there.

Choose **Resolve as rolled** when you do not want to spend a use. That choice
is required: a pending card does not fire the attack, counter, spell, or other
result consequences until someone commits it. A doom, a crit, or a result with
no legal spend commits immediately, so it has no expertise prompt.

Only the test owner can make this decision. Other clients see:

> Waiting for the test owner to resolve expertise.

### Reading the result card

The card is the durable record of the test. Its sections mean:

| Card area | What it tells you |
| --- | --- |
| **Raw 2d10** sigil | The unmodified dice sum, used for doom and crit detection |
| Header | The test kind, flavor, actor/item, tier label, and DOOM/CRIT badges |
| Large total | The ordinary resolved total, or **`—`** for a terminal result |
| Breakdown | Raw 2d10, characteristic, each numeric modifier, and the Result tier |
| **Edges & Banes** | Every roll-level label and the exact count-resolution explanation |
| **Targets** | One row per target when a single roll has per-target outcomes |
| Expertise area | The pending spend buttons, **Resolve as rolled**, or the committed spend note |

The header tier is the roll-level, no-target tier. For a multi-target attack,
read the **tier on each target row**: that is the tier used for that target's
hit, miss, and damage. For example, with raw 12 and no characteristic bonus,
one target with no situational label is tier 2; a target at range with a single
prone-target bane is tier 1. The header remains tier 2 because it describes the
roll without a target. The target rows carry the labels that produced their own
tiers.

Target names come from the current canvas when available. If a token cannot be
resolved, the card uses **Target 1**, **Target 2**, and so on. This is a display
fallback; it does not change the stored target snapshot.

---

## Edge and Bane

An **edge** is a situational advantage. A **bane** is a situational
disadvantage. They are labels in a counted channel, not alternate names for
`+2` and `−2` modifiers.

The system resolves them in this order:

```text
E = min(number of edge labels, 2)
B = min(number of bane labels, 2)
net = E − B
```

Then it applies the result:

| Clamped counts | Effect |
| --- | --- |
| 1 edge, 0 banes | Add **+2** to the total |
| 2 edges, 0 banes | Improve the outcome by **one tier** (maximum tier 3) |
| 0 edges, 1 bane | Add **−2** to the total |
| 0 edges, 2 banes | Worsen the outcome by **one tier** (minimum tier 1) |
| 1 edge, 1 bane | No net effect |
| 2 edges, 1 bane | One edge remains: **+2** |
| 1 edge, 2 banes | One bane remains: **−2** |
| 2 edges, 2 banes | No net effect |

A double edge does not add +4, and a double bane does not subtract −4. They
change the tier instead. A tier shift is applied after the ordinary total is
classified and is clamped to tiers 1–3.

### Clamp before cancel

This order matters when more than two labels are present. **Three edges and one
bane** become two edges and one bane before cancellation, so they resolve as
one edge and **+2**, not a double edge and a tier shift. The card's explanation
is:

> `3 edges vs 1 bane — clamped to 2 vs 1 — single edge: +2`

The mirror case is **one edge and three banes**: it resolves as one bane and
**−2**, not a double bane.

Labels are not deduplicated. This is intentional: a double bane is represented
by two labels. Unconscious on a Mind test, heavy concealment, and invisibility
each use two separate labels where the rule calls for a double bane.

### Several sources at once

The common sources are:

- Blessed: one edge on all tests.
- Weakened: one bane on all tests.
- Your own Prone: one bane on melee attacks you make.
- A Grabbed target: one edge on attacks against it.
- A Prone target: one edge for a melee attack, one bane for a ranged attack.
- Flanking: one edge on a melee attack.
- High ground: one edge on an attack.
- Cover: one bane.
- Light concealment: one bane. Heavy concealment and invisibility: two banes.
- A ranged attack at an adjacent target: one bane.
- An improvised weapon: one bane.

For example, a Weakened Crow making a melee attack against a Prone target has
one bane and one edge, so the condition and target cancel. If the same attack
also has a flanking edge, it has two edges and one bane and gets a single-edge
**+2**. If the Crow is making a Mind test while Unconscious and is also
Weakened, the card shows two separate Unconscious bane labels plus Weakened;
the channel clamps three banes to two, producing a double bane and a one-tier
shift down.

The top **Edges & Banes** section shows the roll-level labels. On a multi-target
attack, the target row also shows that target's full effective labels, so two
targets can resolve differently from the same raw dice.

---

## The six conditions

Conditions are strict booleans. You cannot gain a second instance of one that is
already active. The Crow sheet has six condition checkboxes; the creature sheet
has six condition buttons. The token icon is a mirror of the actor's condition
state, so the actor state is what the roll and damage rules read.

Most content cards describe their own condition riders, but the current system
does not parse every spell, trait, weapon, or monster-text rider into a generic
condition update. When a card says that a target becomes a condition, the Ref
should apply it with the condition control (or the matching Ref procedure) and
confirm that the token icon follows it.

### Blessed

**Apply it:** A spell, rest activity, trait, item, or Ref ruling can make a
creature Blessed. Examples in the shipped content include the Minor Blessing
spell and Song of Rest. In the current UI, the Ref or owner sets the Blessed
condition; the card text itself does not toggle it automatically.

**What it does:** Blessed gives an **edge on all tests**. It also adds damage to
attacks equal to the characteristic used for that attack. The runtime floors
that damage addition at 0, so a negative characteristic never turns the bonus
into a penalty. Blessed is an edge, not a hidden `+1` or `+2` modifier.

**How it ends:** On a Crow, the Ref's **End the dungeon turn** control clears
Blessed automatically. The end-of-dungeon-turn loop currently visits Crow
actors for condition expiry; a Blessed monster or other creature does not get
cleared by that loop and needs the Ref to clear it. That Crow-only expiry is a
current runtime bug/oversight, not a different rule.

### Grabbed

**Apply it:** A successful **Grab** maneuver, a trap, an object, an effect, or a
monster ability can grab a creature. The current runtime does not infer every
such rider from card text, so the Ref normally sets the Grabbed condition.

**What it does:** Your speed is **0**, you cannot flank, and attacks against you
gain an edge. If the grabber moves, you move with it. When the grabber is your
size or smaller, its speed is halved while it keeps you grabbed. The grabber can
change your position while you remain within the effect's range.

**How it ends:** The rules end the grab when the grabber willingly lets go, is
killed, becomes Prone, becomes Unconscious, or moves farther away than the
effect's range. You can also use **Escape Grab**. The current runtime does not
watch movement, death, or Escape Grab to clear the boolean; the Ref must clear
Grabbed when one of those events ends it.

### Prone

**Apply it:** You can drop Prone on your turn with no action. Attacks, spells,
traits, and Ref decisions can also knock a creature Prone.

**What it does:** Speed is halved, rounded down. You take a bane on melee
attacks and cannot flank. Melee attacks against you gain an edge; ranged attacks
against you take a bane.

**How it ends:** **Stand Up** is a maneuver and requires speed at least 1. The
current sheets do not provide a Stand Up action that clears the checkbox, so
the Ref or player must clear Prone after the maneuver. A creature whose speed is
0 cannot use that maneuver until something changes.

### Vulnerable

**Apply it:** A spell, backlash, trait, monster ability, or other effect can
make a creature Vulnerable. For example, the shipped Corrupt spell can apply
it. The current runtime expects the condition to be set explicitly rather than
extracting it from the effect text.

**What it does:** Every time you take damage, the system rolls an extra **1d6**.
That die is added **before AD**, so armor can absorb it. Vulnerable does not make
the extra die piercing. The damage result and the damage-applied chat summary
include the larger total, although the summary does not print the d6 as a
separate line.

**How it ends:** On a Crow, End the dungeon turn clears Vulnerable automatically.
The default expiry loop does not clear it from monsters or other non-Crow
actors; the Ref must clear those conditions. That Crow-only expiry is a current
runtime bug/oversight, not a different rule.

### Unconscious

**Apply it:** Sleeping makes a creature Unconscious, as can an effect or a Ref
ruling. If damage reduces a slotless Ref-controlled creature to 0 Stamina, the
current damage control marks it **Defeated**; it does not offer a knockout
choice automatically. The Ref can set Unconscious when the table's ruling calls
for it.

**What it does:** You are also Prone, your speed is **0**, and you cannot take
actions, maneuvers, or reactions. Agility and Strength tests automatically get a
doom. Mind tests to notice surroundings take a double bane.

The current roll pipeline represents that Mind rule with **two separate
Unconscious labels**. It applies those two banes to every Mind test, because the
test has no narrower “notice surroundings” tag; this is broader than the printed
qualification and is worth remembering at the table.

Attacks against an Unconscious target always achieve **tier 3**. The attacker
can still roll for a crit. On the card, the target row shows tier 3 with an
`unconscious` terminal chip; a raw 19 or 20 can show CRIT as well. The
template's **Forced: target unconscious** header note is only wired for a
message-level terminal, so an ordinary targeted attack relies on that target
row rather than showing the forced badge in the header. The forced tier takes
precedence over a doom against that target, although the card still reports the
doom for the Ref's narrative adjudication.

The attack and casting controls refuse to start an action for an Unconscious
actor and warn, respectively, **`<name> is unconscious and cannot attack.`** and
**`<name> is unconscious and cannot cast.`** A generic characteristic test can
still be clicked, so its Agility or Strength result is reported as a doom.

The rules treat Unconscious as Prone, but the current condition update does not
also set the separate `prone` boolean. Set Prone too when the sheet or token
needs to display that implied state; the attack resolver already uses the
Unconscious target's forced tier.

**How it ends:** Taking any positive damage wakes you and clears Unconscious.
The current implementation does this even when armor absorbs all of that
damage, because the condition ended when damage was taken. Loud-noise wakeups
within 10 squares are not automated; the Ref must clear the condition. There is
no automatic end-of-dungeon-turn expiry for Unconscious.

### Weakened

**Apply it:** Poison, backlash, spell, trait, monster ability, pet command, or a
Ref ruling can make a creature Weakened. The current runtime has specific
automatic paths for some tested effects (such as a tier 2 pet command), but it
does not parse every content description; use the condition control when a rider
requires it.

**What it does:** Weakened is a **bane on all tests**. It is one counted bane,
not a numeric `−1`, and it has no direct damage effect. This is the condition
most often misremembered as a penalty of a different size.

**How it ends:** On a Crow, End the dungeon turn clears Weakened automatically.
The automatic expiry loop currently covers Crows only, so the Ref must clear it
on a monster or other non-Crow actor. That Crow-only expiry is a current
runtime bug/oversight, not a different rule.

---

## Initiative and combat flow

### Who goes first

There is no per-creature initiative in Crows. At the start of each round, one
player rolls **1d10**:

- **1–5:** Enemies act first, then Crows.
- **6–10:** Crows act first, then Enemies.

The system stores the face and first side for that round, sorts the tracker, and
posts a chat message such as:

> Patrick rolled 1d10 (6) — Crows act first

The tracker banner uses the same information: **`1d10: 6 — Crows act first`**.
The side roll happens automatically when combat starts and when a new round is
entered. It is repeated every round; an old round's result does not silently
control the next one.

The side is determined in this order:

1. An explicit `crows.side` override wins. This is the Ref's correction tool.
2. A `crow` actor is on the Crows side, even if the Ref owns it and its token is
   hostile.
3. An actor with a player owner is on the Crows side.
4. A Friendly token is on the Crows side.
5. Anything else is on the Enemies side.

Within the Crows side, players choose their order. The Ref chooses the order
of enemies. The tracker supplies up and down controls for a combatant you own
(or, for the Ref, any combatant); those controls move a combatant within its
side and never across the side boundary.

The stock **Roll All** and **Roll NPCs** controls are removed because they would
try to roll creature initiative. If you use either a non-Crows macro or a
direct initiative command, the system warns:

> Crows uses one side roll per round; creatures do not roll initiative.

#### Current tracker button gap

The current tracker renders **Roll for the round** when a round has no side
roll, but its action table does not register `rollSide`. **The button currently
does nothing.** Have the Ref or an eligible player run the working route:

```js
await game.combat.rollSide()
```

Starting combat and entering a new round call the same method automatically;
use the command whenever a round is still unrolled.

### Surprise

Surprise is a combatant flag, not one of the six conditions. The tracker marks a
row **Surprised** and skips that combatant's turn in round 1. Attacks against a
surprised target gain a flat **+1** numeric modifier. It is not an edge.

After round 1, the flag is ignored by turn selection and attack labeling. The
tracker can still display the old Surprised tag because the flag is not cleared
automatically; the round number is what makes it inactive.

### What is automatic and what is Ref-driven

The system handles the mechanical bookkeeping that has an unambiguous answer:

- it rolls and records the 2d10 test and posts the card;
- it derives the roller's conditions and a target's condition labels;
- it waits for the owner to commit an expertise decision;
- it sorts side order, skips Surprised combatants in round 1, and rerolls sides
  each round;
- it forces an attack against an Unconscious target to tier 3;
- after a committed attack, it computes hit/miss, damage tier, crit extra-action
  information, and any eligible counter or ranged-stray consequence;
- when the Ref/player actually applies damage, it resolves Vulnerable, AD,
  Stamina, wound capacity, and the Unconscious wakeup;
- it clears Blessed, Vulnerable, and Weakened from Crow actors at End the
  dungeon turn.

The tracker advances turns, but it does not track or block a creature's action,
maneuver, or reaction uses. The Ref and players enforce that turn-by-turn
economy.

The Ref or players still make the table decisions:

- what task is being attempted, which characteristic it uses, and which
  situational facts apply;
- cover, concealment, distance, flanking, high ground, and which allies are
  adjacent to a ranged target;
- whether to spend an expertise and, for a pending result, when to resolve it;
- within-side order, surprise flags, condition riders, and condition endings;
- whether a miss opens a counter, whether a defender can take it, and the
  narrative consequence of a doom or crit;
- which attack result to apply, which armor loses AD first, and which backpack
  slots take new wounds.

The ordinary weapon attack control snapshots target **conditions** and round-1
surprise. It does not infer cover, concealment, flanking, high ground, or range
from the canvas. Supply those facts through a caller or Ref procedure when they
matter.

### Attacks, misses, counters, and crits

When the final committed target row is tier 1, the attack is a **miss** and
deals no damage or other attack effect. A tier 2 or tier 3 row is a hit and uses
that weapon's corresponding damage band. The test card's Apply buttons do not
decide this for you: both **Apply T2** and **Apply T3** are shown after commit,
so use the target row and choose the matching button.

A melee miss opens a counter window for the target. The current helper recognizes
these triggers: a melee attack, Grab, Knockback, or Escape Grab that got tier 1.
The defender must have a reaction remaining, be conscious, have a wielded melee
weapon, and be within reach. An opportunity attack cannot be countered. A normal
trigger gives the counterer's tier 2 weapon damage; a triggering doom gives tier
3 damage. The system reports the opportunity but does not run the counter for
the Ref.

A crit grants another action. If that action is gained outside the acting
creature's own turn, it must be used immediately. The tracker does not insert a
new synthetic turn; the Ref keeps the turn moving and enforces that timing.

For a ranged miss, the rules allow a stray hit on an ally adjacent to the target:
an odd extra die hits a randomly chosen adjacent ally for tier 2 damage, while a
doom hits one automatically for tier 3 damage. The normal sheet attack does not
collect the ally list or roll that extra die, so the Ref must adjudicate this
consequence when it applies.

### Multi-target attacks

The rules use one roll for all targets, with per-target edges, banes, and
penalties. The card preserves the target rows, and each row can have a different
tier. However, the current attack command refuses before rolling when a
multi-target attack has divergent situational labels that cannot be routed
losslessly. It warns:

> This attack gives different modifiers to different targets, but Crows cannot resolve them separately yet. No attack was rolled.

This is most likely with cover, concealment, range, a ranged-adjacent target,
flanking, or high ground. Use one target at a time or have the Ref adjudicate
the situation rather than assuming every target received the same modifier.

---

## Damage, wounds, and death

### Applying attack damage

Attack results are deliberately not auto-applied. The committed test hook
computes the outcome, but the normal world wiring leaves the damage buttons for
the table. This prevents one committed message from applying damage once per
connected client and leaves the Ref in control of target choice.

Before clicking **Apply T2** or **Apply T3**:

1. Read the target row and select the intended target token.
2. Choose the matching damage band. A `P` marker means piercing.
3. Click the button once and answer any armor or wound-slot prompt.

The current button handler applies damage to every currently controlled token.
If no token is controlled, it falls back to the user's character. It does not
automatically select the target named on the card. Do not leave several tokens
controlled unless you intentionally want all of them to take the damage.

The monster sheet's **Damage** button instead opens a damage amount dialog for
that monster, with a **Piercing (bypasses AD)** checkbox.

One current card mismatch matters for Blessed attackers: the attack resolver
calculates the Blessed characteristic bonus, but the card's Apply buttons carry
the unadjusted `t2`/`t3` numbers. If the attacker is Blessed, add the attack's
characteristic to the printed band (minimum 0 for a negative characteristic)
before applying it. Use the target's **Damage** control, or run the working
route with the corrected amount:

```js
await game.crows.applyDamage(targetActor, correctedDamage, { piercing: isPiercing })
```

This is a current card/runtime gap; the button does not include that bonus. The
monster sheet's custom-attack path does not carry a Blessed bonus into the
resolver either, so the Ref must make the same correction for a Blessed monster.

### The damage order

For one damage instance, the system resolves:

1. **Vulnerable die:** if the target is Vulnerable, roll an extra 1d6 and add it
   to the incoming damage before anything absorbs it.
2. **Armor Defense:** ordinary damage reduces AD. If a Crow has more than one
   worn armor or shield source, the player chooses which loses AD first. An AD
   pool that reaches 0 is broken and cannot absorb further damage. A monster's
   stat-block AD is one pool.
3. **Stamina:** piercing damage skips AD and reaches Stamina first. Ordinary
   damage reaches Stamina after AD is used.
4. **Wounds:** once AD and Stamina are both 0, a Crow or other creature with
   slots gains one wound for each remaining point of damage.

Piercing damage is shown with `P` on the Apply button. Vulnerable damage is not
piercing-like: the extra d6 can be absorbed by AD. If a hit empties one armor
pool and damage remains, the next available armor pool can absorb the remainder.

### Wounds in the inventory

A Crow's wounds are stored as **wound slots**, not just as a number. The Crow
sheet shows:

> Wounds: `X / Y`

where `Y` is the current backpack capacity. The base backpack has **10** slots;
trait slot grants can increase that capacity. A wound occupies the backpack
slot you choose, but the slot remains a backpack slot: an item can still share
it.

When damage creates wounds, the system asks which backpack slots to fill. The
dialog says:

> A slot holding both a wound and an item costs 1 speed (R:524).

If you cancel or do not supply a choice, the automatic placement prefers empty
slots and only then uses slots already holding items. The current default speed
rule counts only backpack slots containing **both** a wound and an item, one
speed per such slot, to a minimum of 0. A Ref can choose the alternate world
setting **Every slot holding a wound**, which counts every wounded backpack slot
instead.

Wounds do not reduce the capacity number. An empty wounded slot is still a
legal place for an item and still counts as capacity. If a capacity-granting
trait is removed, an out-of-range wound is preserved and the sheet reports that
it is beyond the current capacity; the character is not killed merely because a
derived capacity became smaller.

### Defeated and dead

For a Crow, human, animal, or other creature with slots, death is adjudicated
when new damage gains wounds that fill the last in-capacity slot. The damage
path sets `conditions.defeated` and mirrors it to the token's **dead** status. A
creature that was already full does not “die again”; further damage is reported
as unallocated rather than silently discarded.

A monster with **0 slots** has the other path: it is defeated when its Stamina
reaches 0. A creature that has slots can have 0 Stamina without being defeated
if it still has unwounded slots available.

The `defeated` flag is stored, while the condition it represents is derived
from wounds versus capacity (or 0 Stamina for a slotless monster). **Only the
damage path currently keeps that stored flag fully synchronized.** The other
wound writers can leave it stale in either direction:

- The rest activity and the Crow wound checkbox can leave it wrongly **set** on
  a Crow whose last wound was healed. The Crow checkbox sets the flag when it
  checks the final slot, but does not clear it when that slot is unchecked.
- The monster sheet's wound grid only changes `woundSlots`, so filling its last
  slot there can leave it wrongly **unset**.

The reliable route is to let **Damage** create the final wound, or—after fixing
the wound slots—repair the stored flag explicitly with the tracker control or:

```js
await game.crows.setCondition(actor, "defeated", false) // after a wound is removed
await game.crows.setCondition(actor, "defeated", true)  // after all slots are wounded
```

The monster sheet shows a **DEFEATED** badge; a creature with slots also shows
its slot grid. The Crow sheet shows the wounds in the backpack and the mirrored
token status rather than a separate Defeated checkbox. In the current damage
summary, the monster branch prints `(defeated)` correctly; the Crow branch
still looks for a `dead` result field that the damage helper does not return, so
a Crow's summary can omit the `(dead)` text even though the Defeated state and
skull status were set.

The printed rules do not define a general resurrection procedure, so treat
recovery from a defeated creature as a Ref decision rather than assuming that
healing or a checkbox edit brings a dead Crow back.

### A few damage surprises

- Damage to an Unconscious target wakes it even when AD absorbs the entire
  positive damage amount.
- A slotless monster at 0 Stamina stays defeated; extra damage is reported as
  unallocated.
- Armor, wound placement, and which currently controlled token receives an
  attack card's damage are all table-visible choices. The system does not infer
  them from the narrative.
