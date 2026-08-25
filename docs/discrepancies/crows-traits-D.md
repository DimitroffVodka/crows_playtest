# Discrepancies — Traits Batch D (Reputation, Slashing, Stabbing, Thievery, Travel, Unarmed)

**Structure source:** `docs/source/C-characters-book.md` (C:1375–1692)

**Verbatim source:** `/home/patricks/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026/02 Crows Characters Book for Playtest 2.pdf`, PDF pages 25–30

**YAMLs:** `src/packs/crows-traits/{reputation,slashing,stabbing,thievery,travel,unarmed}-t*-c*.yaml` (72 files)

**Date:** 2026-08-25

## Summary

All 72 owned files were re-transcribed against Playtest 2. Tree, tier, column, ordering, starting status, descriptions, names, and connection targets now match the PT2 layout and prose. Existing `_id` and `_key` values were preserved. No trait stores `xpCost`; the runtime derives the cost from tier.

The PDF and pinned Markdown disagree in twelve prose spellings/omissions. The PDF was followed in every case, including the known canonical typos `one` in *Stabathon* and `wile` in *Seeing Things*. No PDF/Markdown name disagreement remains: the PT2 PDF prints *Interceding Blade*, matching the current YAML and Markdown.

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 12    |
| INFO     | 4     |

## HIGH Severity

_(none)_

## MEDIUM Severity

_(none)_

## LOW Severity — PDF followed

These are source-fidelity differences between the PT2 PDF and the pinned Markdown. They are copy/prose differences, not deliberate mechanics decisions.

| Slug | Field | PT2 PDF | Markdown | Followed |
|------|-------|---------|----------|----------|
| reputation-t2-c2 | description | `5 or more a single item` | `5 or more of a single item` | PDF |
| reputation-t3-c1 | description | `trait increase the AO chances` | `trait increases the AO chances` | PDF |
| reputation-t3-c3 | description | `There's a 20% they have the materials` | `There's a 20% chance they have the materials` | PDF |
| reputation-t4-c2 | description | `Items affect by your Discount trait` | `Items affected by your Discount trait` | PDF |
| slashing-t2-c3 | description | `cause the damage to apply your weapon` | `cause the damage to apply to your weapon` | PDF |
| slashing-t3-c1 | description | `it's non-melee range` | `its non-melee range` | PDF |
| stabbing-t1-c3 | description | `make one the same turn` | `make on the same turn` | PDF |
| thievery-t2-c1 | description | `instead the normal +2 bonus` | `instead of the normal +2 bonus` | PDF |
| thievery-t4-c1 | description | `result a test ... wile you are not wearing armor` | `result on a test ... while you are not wearing armor` | PDF |
| thievery-t4-c3 | description | `before your use it again` | `before you use it again` | PDF |
| travel-t1-c3 | description | `tracker roll` | `tracker role` | PDF |
| travel-t2-c2 | description | `When are in the support role` | `When you are in the support role` | PDF |

The Markdown silently normalizes the known canonical `wile` typo to `while`; the YAML intentionally preserves the PDF's `wile`. The PDF's `one` typo in *Stabathon* is likewise intentional. The possessive/contraction spelling `it's` in *Knife Chucker* is also preserved from the PDF.

## INFO — verified or corrected context

- **`slashing-t2-c3` verdict:** The PT2 PDF heading on page 26 is **Interceding Blade**, not *Intercepting Blade*. The Markdown and YAML now agree with the PDF. The inbound edge from `slashing-t1-c3` was updated to `[Interceding Blade]`; no dangling reference remains.
- **Sieze:** `thievery-t1-c1` keeps the canonical name **Sieze the Advantage**. The PT2 PDF and Markdown both print `Sieze`; it was not normalized to *Seize*.
- **Stabathon:** `stabbing-t1-c3` keeps the PDF's canonical body typo `make one the same turn`; the Markdown silently corrects it to `on`.
- **Seeing Things:** `thievery-t4-c1` keeps the PDF's canonical `wile`; the Markdown silently corrects it to `while`.
- **Nope:** The PT2 PDF and Markdown both say `hit with an opportunity attack`. The YAML was corrected from the old PT1 omission (`hit an opportunity attack`).
- **Dance Away:** The PT2 PDF and Markdown both say `as part of the reaction`. The YAML was corrected from the old PT1 wording `as part of the counter`.
- **`thriple` in the old YAML:** PT2 PDF and Markdown both print `triple`; `stabbing-t2-c3` was corrected to `triple` rather than preserving the old YAML typo.
- **Replacement traits:** PT2 replaces several PT1 Travel and Unarmed entries, including `A Path for All` → `Troubadour`, `Push It Real Good` → `Camp Builder`, `All You Can Eat` → `Specialized Hunter`, and `Pack a Kick` → `Pack a Big Punch`. Their `connectsTo` targets were updated with the names, and a sweep found no dangling targets across the trait pack.
- **`xpCost`:** No owned YAML stores an `xpCost` field. PT2's 500/1,000/1,500/2,000 costs remain derived from tier in `prepareDerivedData`.
