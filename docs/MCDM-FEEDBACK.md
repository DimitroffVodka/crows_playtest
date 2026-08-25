# Crows Playtest 2 — feedback for MCDM

**This file is the submission text.** Copy items straight into the survey. The internal
engineering record is Part 7 of `.planning/PLAYTEST-2-EXECUTION.md`; do not submit that one.

## Rules this file follows, and why

| Constraint | Consequence |
|---|---|
| The survey **rejects typo reports** | Every spelling error is omitted. They stay in Part 7 §B5 for our own audit. |
| The survey **will not follow links** | No URLs, no file references, nothing that needs another document open. |
| MCDM cannot resolve our line numbers | **No `R:`/`C:`/`IC:` citations.** Those index our own text extraction, not their book. Each item instead **quotes text they can search for** and names the book, trait, spell or card. |
| A survey box is not a design doc | Each item is a few sentences and one question. |

Ordered by what is worth their time: things that need a decision, then one-word corrections,
then rules ambiguities we resolved ourselves and are flagging in case we guessed wrong.

---

## 1. Soothing Candy removes a condition that no longer exists

The Soothing Candy card reads *"Maneuver: Consume a candy to remove 1 boned level from
yourself."*

The changelog says boned "is no longer a condition and has been replaced by two conditions,
weakened and vulnerable". **Boned appears zero times in the Rules, Characters, Ref and Dungeons
books** — this card is the only place it survives. Conditions also no longer have levels, so
"1 boned level" has no referent either.

It looks like an oversight rather than a decision, because the poison cards changed for exactly
this reason and were updated.

**Question: should the candy remove weakened, vulnerable, or the player's choice of one?**

We shipped player's choice, because the card names neither successor and picking one silently
would invent a rule. If you intended weakened — so the candy answers poison — that is a
one-word fix.

*Also worth a look:* the annotated card deck contains a spell tier table still reading "Boned"
and "Boned Twice". We could not reliably identify which spell it belongs to from the PDF's
column layout, and it does not appear in the standard inventory deck — so it may be a stale
annotation rather than a live card. Flagging it in case the annotated deck is generated from a
separate source that was missed.

## 2. All six Discipline Mastery traits still reference "the chaos count"

Alteration, Benefaction, Conjuration, Elemental, Illusion and Necromancy Mastery each read:
*"Non-doom tier 1 results of rank 0 and 1 «discipline» spells you cast don't add to the chaos
count."*

**The phrase "chaos count" appears nowhere in the Rules Book.** The chaos count was replaced by
the per-cast chaos roll, which a non-doom tier 1 triggers.

**Question: should these read "…don't trigger a chaos roll"?**

That is how we implemented them, since the trigger maps exactly. Their second clause — rank 2+
treated as two ranks lower on the backlash table — needs no reinterpretation.

## 3. Elemental Mastery describes conjuration spells

Elemental Mastery names **conjuration** spells in both of its clauses. It is the only one of the
six Mastery traits that does not name its own discipline, so read literally it grants an
elementalist nothing.

**This was reported for Playtest 1 and is unchanged in the Playtest 2 packet.** One-word fix. We
implemented it as "elemental".

## 4. The "Summoned" target keyword is defined but never used

The Rules Book defines a target keyword: *"Summoned: This spell summons a creature or object
within range."*

**We checked every target line on all five card decks. "Summoned" appears on none of them.**

The one spell that summons an object — **Summon Object** — prints its target as **Self**, and
its description says *"You create a mundane object"*, so there is no wording that identifies it
as a summon either.

**Question: should Summon Object's target read "1 Summoned object"?**

We shipped the card as printed. Related: the rule that summoned creatures "function like pets
in combat except that you don't need to make a test" currently has nothing to apply to, since
Playtest 2 ships no creature-summoning spell.

## 5. The backlash table prints two rows that both claim 62

Consecutive rows read **61-62** and **62-64**. A d100 result of 62 matches both.

We read the second row as 63-64. **Question: which row owns 62?**

## 6. Six animals print "Slots: 0" against a rule saying animals have slots

The Ref Book says *"Monsters don't have slots… Humans and animals have the potential to be
allies, so they do have slots."* But **Chicken, Crow, Hawk, Rat, Snake (Venomous) and Spider**
each print `Slots: 0`.

Six of 32 animals, and it is probably deliberate — a chicken carries nothing. But no property
derives it: **Cat is Tiny with 1 slot while Hawk is Small with 0**, and both are power 1.

**Question: are these zeroes intended, or should the rule read "most animals"?** We shipped the
printed values and removed a validation check that assumed the rule held.

---

## Rules we had to adjudicate ourselves

No answer needed to keep going — we shipped a reading for each and can reverse any of them
cheaply. Listed in case we guessed wrong, since each affects a lot of downstream behaviour.

**a. Does a "tier 1 result" trigger read the tier before or after an expertise is spent?**
At least five rules key on getting a tier 1: a miss, the Counter reaction, the chaos roll,
Silent armour, and the unarmoured sneak reroll. An expertise is spent after the roll and raises
the tier. If a caster rolls tier 1 and spends an expertise to reach tier 2, was there a chaos
roll? **We read triggers against the final, post-expertise tier**, because a miss is defined as
a tier 1 result on an attack — so reading the pre-expertise value would mean a weapon expertise
could never turn a miss into a hit, making all six weapon expertises nearly worthless.

**b. Wounds and speed.** *"Each wound they take fills up a backpack slot of the PC's choice. For
each slot occupied by a wound and an item, your speed is reduced by 1."* We read this as slots
holding **both** a wound and an item. Counting every occupied slot cannot be right — speed is 5
and the backpack is 10 slots, so a fully loaded **unwounded** PC would already be at speed 0.
Counting every wound would make "of the PC's choice" have no bearing on the sentence that
follows it.

**c. Doom against an unconscious target.** Attacks on an unconscious creature "always achieve a
tier 3 result (though the attacker can roll to see if they get a crit)", but a doom is
"automatically a tier 1 result". **We let unconscious win and keep the tier at 3**, reading the
parenthetical as narrowing what the roll is still for.

**d. Expertise against a double bane.** A double bane is −1 tier and an expertise is +1 tier. No
rule covers them meeting. **We net them out, order-independent.**

**e. Background expertise uses.** Backgrounds are described as giving "1 use in some
expertises", but entries print parentheticals like "Benefaction (2 uses)". **We read the
parenthetical as the total, not an addition to a base of 1.**

**f. Do Boons of Disappearance and Flight get expended on use?** Most boons say "expend";
Disappearance and Flight say "use". Rescue also says "use" but explicitly grants level-many uses
first. **We gave Disappearance and Flight one use each**, matching the ordinary single-use
default.

**g. Greed Bonus scope.** *"Can't apply in that dungeon again to the group (or another group of
PCs played by the same players)"* implies tracking across characters and campaigns. **We track
per-world, per-dungeon.**
