# Rules Journal — Playtest 2 transcription and runtime discrepancies

**Date:** 2026-08-25
**Ticket:** T3.7 — rewrite the player-facing rules journal against Playtest 2

This journal is a player-facing transcription. The pinned R-rules-book.md,
C-characters-book.md, and F-ref-book.md files were used for navigation and
stable line anchors only. Every quoted rules line was checked against the
corresponding packet PDF with pdftotext -layout:

- 01 Crows The Rules Book for Playtest 2.pdf, Rules Book pp. 6–37
  (R:154–1388, including the Conditions, Tests, Combat, Dungeon Turns,
  Resting, Miasma, Spellcasting, Backlashes, Travel, and Crafting chapters).
- 02 Crows Characters Book for Playtest 2.pdf, Characters Book pp. 6–7
  (C:375–417) for the advancement tables.
- 03 Crows The Ref Book for Playtest 2.pdf, Ref Book pp. 1–2
  (F:45–114) for the derived Bad Weather page.

The PDF is the prose authority. The book markdown silently repairs MCDM's
typos and, in several places, changes phrasing or grammatical number. The
journal therefore preserves the PDF's printed wording, including the
discrepancies called out below.

## Pages and document keys

Every surviving page was rewritten; no existing surviving page was left alone.
All existing _id and _key values were preserved except for the explicitly
deleted Chaos Count page. The new Edges & Banes page has a fresh 16-character
key.

| Page | _id | Result |
|---|---|---|
| Conditions | crrlpgcondit0001 | rewritten |
| Test Results & Tiers | crrlpgtestres001 | rewritten; PT2 advancement tables added |
| Edges & Banes | crrlpgedgban0001 | **new page** |
| Doom & Crits | crrlpgdoomcrit01 | rewritten |
| Combat Quick Reference | crrlpgcombat0001 | rewritten |
| Common Maneuvers | crrlpgmanvr00001 | rewritten |
| Dungeon Turn | crrlpgduntrn0001 | rewritten |
| Resting & Rest Activities | crrlpgresting001 | rewritten |
| Ranged Attacks & Movement | crrlpgrange00001 | rewritten |
| Line of Effect, Cover & Light | crrlpgflanking01 | rewritten |
| Spellcasting Basics | crrlpgmagic00001 | rewritten |
| Backlashes | crrlpgbacklash01 | rewritten |
| Weather Tables | crrlpgweather001 | derived from the Ref Book |
| The Miasma & Effects | crrlpgmiasma0001 | rewritten completely |
| Overland Travel | crrlpgtravel0001 | rewritten |
| Crafting | crrlpgcraft00001 | rewritten |

Deleted page:

- crrlpgchaoscnt01 / !journal.pages!crowsruleconds01.crrlpgchaoscnt01
  — **Chaos Count**. PT2 removed the accumulating counter and replaced it
  with the per-cast chaos roll. This is the one _id intentionally removed.

The final journal has 16 pages: 15 preserved pages, minus Chaos Count, plus
the new Edges & Banes page.

## Major player-facing corrections

### HIGH — Conditions

The PT1 levelling model was removed. The journal now contains exactly the six
PT2 conditions: Blessed, Grabbed, Prone, Vulnerable, Unconscious, and Weakened.
Conditions do not stack: the PDF says, “You can't gain a second instance of a
condition you already have” (R:441–443). All blessed/boned level language and
the cancellation rule were removed.

### HIGH — Tests, Edges, Banes, Expertises, and Advancement

The old fixed Skills summary was replaced with the PT2 test procedure,
post-roll limited-use Expertises, Resistance Rolls, Group Tests, and the new
Edges & Banes page (R:154–339). The new page covers the double-edge/double-
bane tier changes and cancellation rules.

The PT2 Expertise & Stamina and Characteristics Advancement tables were added
to Test Results & Tiers from the Characters Book PDF (C:375–417). The printed
wording is retained, including “gain one expertise uses” and “the Ref can
decided.”

### HIGH — Combat, Maneuvers, Dungeon Turns, Resting, Ranged Attacks,
Spellcasting, Overland Travel, and Crafting

The surviving pages now follow the PT2 PDF rules, including:

- Grab tier 2 as Push 1 or Shift; Knockback's size limit; Dump Backpack;
  Taunt; pet commands; and the full forced-movement rules.
- 1d10 Dungeon Encounter checks with EN 9/8/7, Greed Bonus, outside-dungeon
  two-hour DT equivalence, and warning-vs-immediate encounter timing.
- One Rest encounter check per rest, expertise refresh with the Miasma
  exception, rest/DT transition semantics, size-scaled corpse harvesting,
  Seclude Camp, and the town activity rules.
- Ranged friendly fire only on an odd die after a miss, ammo destroyed on
  every ranged attack, adjacent attacks taking a bane, and per-target
  modifiers on multi-target attacks.
- Spell target vocabulary (including Summoned, Target, and no-target entries),
  line of effect, ranges, durations, caster death/early ending, spellbook UD,
  and the per-cast Chaos Roll.
- The 5-mile hex travel procedure, pace/EN tradeoffs, road/river/speed
  modifiers, Supporter/Guide/Scout/Tracker tasks, and the PT2 lost procedure.
- Expertise-and-use crafting prerequisites, current harvesting, double-edge
  and expertise +4 treatment, the two-expertise limit, double-bane -4
  treatment, surplus points, and multiple crafters.

### HIGH — The Miasma & Effects

The page was rewritten against R:1121–1148 and MIASMA_EFFECTS:

- The test is at the end of every rest in the Miasma, not every 24 hours.
- The test is 2d10 + M; cruelty is a Miasma-owned integer and applies a
  -1 penalty per level to Miasma RRs.
- Tier 1 gains one cruelty and rolls a paired effects row.
- Tier 2 is **No effect**.
- Tier 3 clears all cruelty or improves another resting human's result by a
  tier.
- Each table row grants both a first effect and a second benefit.
- A rest in the Miasma suppresses expertise refresh; a completed rest outside
  it clears cruelty.
- Indoor immunity is limited to areas entirely enclosed in stone or metal.

The journal's seven table rows now match MIASMA_EFFECTS exactly, including
the printed grammar in “This effect ends when you are no longer have cruelty.”

## Backlash discrepancies

The Backlashes page was rewritten from the Rules Book PDF and then compared
row-for-row with BACKLASH_TABLE (module/helpers/backlash.mjs:43–156).
All 55 journal rows now match the runtime text, including row 39–40.

### HIGH — printed range 62–64 overlaps 61–62

The PDF prints 61–62 followed by 62–64 (R:1289–1307). This gives two rows
for 62 and no row for 63. Runtime applies the only complete-table reading,
63–64, while retaining the printed sourceRange "62-64" and a source note.
The journal preserves the printed range and logs the interpretation here; the
book's pair pattern supports the runtime reading.

### HIGH — row 51–52 says “Might RR”

The PDF says the demonic bees impose a “Might RR,” but the game has Agility,
Mind, and Strength only. Runtime and journal preserve the printed text rather
than silently guessing Strength. The source supports the typo as printed; the
likely interpretation is Strength, but it remains a Ref adjudication.

### MEDIUM — row 39–40 PT1 stacking clause

The old journal said the gas penalty stacked and became stronger. The PDF and
BACKLASH_TABLE end after “This effect has 1 UD.” The journal now follows the
PDF/runtime and removes the old clause. This was the known journal-vs-runtime
disagreement.

### MEDIUM — row 57–58 stray “A”

The PDF extraction prints “1d6 blood A creatures.” Runtime drops the stray
bold/table marker and stores “1d6 blood creatures.” The journal follows the
runtime interpretation. The surrounding PDF layout supports treating A as an
extraction marker, not a creature type.

### Runtime-only follow-up findings

No journal/runtime content disagreement remains after the rewrite. The
independent runtime audit did find two module issues outside this ticket's
ownership; module/ was not edited:

- rollBacklash can normally discover only persisted UD-backed duplicate
  effects, so non-UD durational backlashes may repeat without the required
  duplicate reroll.
- The duplicate path rerolls once rather than verifying that the second result
  is different, and hasDuration misses indefinite rows such as 31–32 and
  85–86.

These are runtime follow-up tickets, not journal transcription changes.

## PDF-versus-markdown fidelity findings

The following printed forms were checked in the PDFs and preserved in the
journal instead of copied from silently repaired markdown:

| Location | PDF | Pinned markdown / old journal | Severity |
|---|---|---|---|
| Backlash 03–04 | “makes you **feels** so good” | “feel” | LOW |
| Backlash 77–78 | “Your size **us** Tiny” | “is” | LOW |
| Backlash 104 | “Magic **lighting**”; “Stamina is **reduce**” | “lightning”; “reduced” | LOW |
| Crits and Dooms | “When a you,” “regardless or,” “automatically gets” | silently normalized in the old journal | LOW |
| Taunt | “choose a creature a creature” | normalized in markdown | LOW |
| Ref Book weather intro | “The bad weather event **the** lasts 24 hours” | repaired in markdown | LOW |
| Ref Book Heat Wave | “a **if** a creature” | repaired in markdown | LOW |
| Ref Book Sandstorm | says role penalties apply “during a **blizzard**” | markdown says “sandstorm” | MEDIUM |
| Travel procedure | PDF says “finally **providers**” | markdown says “finally trackers” | MEDIUM |
| Travel route/lost text | “dstination,” “chose,” “If the you get lost,” and “to instead of one…” | several repaired forms | LOW |
| Characters advancement | “the Ref can **decided**” and “Rest activies” | repaired forms | LOW |

The journal also preserves the PDF's “a spell's rank form,” “expertise than,”
“a group tests,” and other harmless authoring errors where those lines are
quoted. These are source-fidelity records, not gameplay reinterpretations.

## Verification

The new corpus test (test/rules-journal-corpus.test.mjs) asserts:

- the journal and every page have 16-character IDs and the exact Foundry
  _key shape;
- the final page count is 16;
- no page mentions the retired condition or the retired Chaos Count;
- Backlash row 39–40 contains the exact runtime text.

The test was mutation-tested by inserting boned into the Conditions page:
the retired-mechanics assertion failed, and the mutation was restored.
