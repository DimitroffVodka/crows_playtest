# Spellbooks against Playtest 2

**Audited:** 2026-08-25
**Scope:** 27 spellbook YAMLs in src/packs/crows-spellbooks/
**Primary source:** the pinned pdftotext -layout card deck (IC:), with the spellcasting vocabulary from R:1174-1330.

The cards are a grid. Each value below was read down the column established by the card's title, never across a row. The book markdown is used for vocabulary only; per-spell stats are card-only, as documented in docs/source/README.md.

## Inventory

The card-derived spell names, with no Monster Part artifact and with Deadspeech's rank recovered from its wrapped title, are:

| Card range | Spells |
|---|---|
| IC:294-310 | Animal Form, Repair |
| IC:311-331 | Take Shape, Minor Blessing, Minor Healing, Minor Ward, Jaunt |
| IC:333-350 | Teleport Object, Summon Object, Create Water, Fire Hands, Fire Lance |
| IC:352-367 | Spark, Stream, Thunder, Cacophony, Light |
| IC:368-391 | Minor Phantasm, Bone Capture, Minor Curse, Monster Sense, Shrink |
| IC:392-414 | Stubborn Object, Group Healing, Wound Closure, Corrupt, Deadspeech |

The source inventory is therefore 27 documents. The two additions in this pass are Group Healing (R1) and Wound Closure (R0), both from IC:392-414.

## Corrections made

| Severity | Spell | Finding | Result | Evidence |
|---|---|---|---|---|
| HIGH | Minor Blessing | The shipped PT1-shaped entry was Melee 1 / one creature / No effect, Blessed, Blessed Twice. The PT2 card is Ranged 3 / Target Varies, with bands 0, 1, 2; Blessed Twice is also invalid under PT2's non-stacking condition rule. | Corrected range, target text, description, and bands. Varies remains an explicit review flag because the schema's target count is an integer. | IC:311-331; R:443 |
| HIGH | Teleport Object | 1 obj. dropped the card's Tiny qualifier and widened what the spell can move. | Corrected to 1 Tiny obj.; the qualifier remains in the target text. | IC:333-350 |
| HIGH | Bone Capture | The card is an attack with only 12-16 and 17+ bands. t1: No effect was an invented third band. | Corrected effectBands.t1 to empty; retained Ranged 5, 2+M, and 4+M; prone. | IC:368-377 |
| HIGH | Deadspeech | “Your eyes are both compound and you can see in the dark” is not Deadspeech text. It is Blood Concoction text that bled across the card grid during the old transcription. | Removed the contaminated sentence. | IC:392-414; contaminant IC:67-81 |
| HIGH | Shrink | “Your lower body is now a slug tail. Your speed is reduced by 2” is Blood Concoction text, not Shrink text. | Removed the contaminated sentences. | IC:368-391; contaminant IC:67-81 |
| INFO | Attack-band shape | Fire Hands, Fire Lance, Spark, Thunder, Corrupt, and Bone Capture print two bands, but Stream genuinely prints ≤11 0 dam / 12-16 2+M / 17+ 4+M. The pattern is not a rule to apply mechanically. | Transcribed each card's bands independently; Stream keeps its printed 0 damage tier. | IC:333-367; IC:351-355 |

The Deadspeech and Shrink contamination is a HIGH source-fidelity defect, not a cosmetic prose difference: Blood Concoction's body transformations were copied into two spellbooks and could grant unrelated mechanics.

## New spellbooks

Both documents have new, unique 16-character IDs and matching _key values:

| Spell | Rank | Card values |
|---|---:|---|
| Group Healing | 1 | Benefaction Maneuver; UD 1 (Rest; Activate); Ranged 3; target 3 creatures; Instant; 1+M / 2+M / 4+M; 500 gc |
| Wound Closure | 0 | Benefaction Action; UD 1 (Rest; Activate); Melee 1; target 1 creature; Instant; 0 / 1 / 2; 500 gc |

creat. is normalized to the parser's PT2 vocabulary (creatures / creature) where a card abbreviation would otherwise be reported as an unclassifiable noun.

## Target reporting and summon behavior

SpellbookData.prepareDerivedData computes targetNeedsReview; there is no stored field to toggle. The corpus test names all six deliberate flags:

| Spell | Target text | Why it remains flagged |
|---|---|---|
| Cacophony | 1 square | A square is not one of the R:1206 target kinds; the effect is placed at a square described in prose. |
| Create Water | 1 vessel or area | A vessel/area is not a single R:1206 target kind, and the card describes creation rather than a discrete target. |
| Deadspeech | 1 corpse | Corpse is not the card vocabulary's creature/object/target kind; guessing would change the target semantics. |
| Minor Blessing | Varies | The card's count varies by casting, but the schema can store only an integer count. The verbatim line is retained in target.text. |
| Minor Phantasm | 1 space | A space is not a R:1206 target kind; the card puts the image within a space in its prose. |
| Summon Object | Self | The card prints Self, while the spell's description creates an object in an inventory slot. Replacing it with 1 Summoned object would invent source text, silently change summon behavior, and erase the diagnostic. |

No pinned card target line uses the Summoned keyword. Consequently summonBehaviour(system) still matches 0 of 27 spellbooks, including Summon Object. That is a code/vocabulary reachability finding for the owner of module/helpers/spellcasting.mjs; this ticket preserves the card text and does not edit that module.

The target vocabulary used here is the one at R:1206, with the Summoned definition at R:1215 and the spellbook field anchors at R:1182, R:1186, R:1197, R:1219, R:1223, R:1237, R:1245, R:1249, and R:1253.

## Previously corrected entries

All six uniquely named corrections in the handoff remain correct against the cards; Minor Curse appears in both the earlier T3.0 swap and the PT2 boned removal, which accounts for the handoff's “seven” correction references:

- Bone Capture — Ranged 5; empty attack t1; 2+M / 4+M damage; prone (IC:368-377).
- Minor Healing — 1+M / 2+M / 4+M Stamina (IC:311-325).
- Repair — 1+M / 4+M / 8+M Stamina (IC:294-309).
- Light — 0/5 / 5/5 / 10/10 bright/dim (IC:352-362).
- Minor Curse — No effect / 2+M damage / 4+M damage and weakened (IC:368-385).
- Corrupt — 4+M damage / 8+M damage; vulnerable (IC:392-411).

The PT2 boned replacement is not interchangeable: Minor Curse uses weakened, while Corrupt uses vulnerable, exactly as the cards print.

## Remaining representation notes

- MEDIUM — Monster Sense's card supplies a dynamic 1 / 5 / 10 detection radius in
  its three bands, not a static Area of Effect line. The existing aura size 1 is
  redundant schema representation of the first band; the dynamic values remain in
  effectBands and no mechanical value was changed in this pass.
- LOW — Stream's card says Line 5 x 1 within 1; the YAML's line size L 5 x W 1 is
  the same dimensions, with the within-1 range held separately in range.value.
- LOW — Several bands expand compact card labels into explanatory prose (for
  example Animal Form's Tier 0/2/4 animal form and Cacophony's heard-up-to text).
  These are semantically equivalent, unlike the corrected stale condition and
  contamination findings above.
- Varies is preserved as text but cannot become a trustworthy integer target.count; this is why Minor Blessing is reported rather than guessed.
- Tiny on Teleport Object is preserved in the verbatim target text; the current structured target parser still classifies the line as an object.
- Stream's card-specific three-band attack progression is preserved even though most attack cards print only two bands.
- The test test/spellbook-corpus.test.mjs asserts the 27-document inventory, IDs and keys, the six named review flags, the no-Summoned card fact, and the high-risk card corrections.
