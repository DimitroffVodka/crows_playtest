# Discrepancies — Traits Batch B (Camping, Chopping, Conjuration, Elemental, Enchantment)

**Sources:** `docs/source/C-characters-book.md` (structure and pinned markdown text) and the PT2 Characters Book PDF, pages 15–19:
`$HOME/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026/02 Crows Characters Book for Playtest 2.pdf`

**YAMLs:** `src/packs/crows-traits/{camping,chopping,conjuration,elemental,enchantment}-t*-c*.yaml` (60 files)

**Date:** 2026-08-25

## Summary

| Severity | Count |
|----------|------:|
| HIGH     | 2 |
| MEDIUM   | 1 |
| LOW      | 4 |
| INFO     | 3 |

All 60 assigned files are present: 12 each for Camping, Chopping, Conjuration, Elemental, and Enchantment. Tier, column, tree, starting status, and implied XP cost follow the pinned markdown structure. No `xpCost` field is stored; the system computes it from tier.

The PT2 PDF was used for prose and names. The existing ASCII apostrophe style in YAML was retained where it represents the PDF's typographic apostrophe; lexical wording and canonical typos were not silently normalised.

## HIGH severity

### H1 — Mastery traits retain the deleted “chaos count” wording

The PT2 rules replaced the accumulating chaos count with a per-cast chaos roll, but both the PDF and markdown still print the phrase in the Discipline Mastery bodies. The assigned occurrences are:

| Trait | PDF | Markdown |
|---|---|---|
| Conjuration Mastery (`conjuration-t2-c1`) | p. 17 | `C:966–968` |
| Elemental Mastery (`elemental-t2-c2`) | p. 18 | `C:1023–1025` |

Conjuration Mastery is transcribed with MCDM's printed sentence, including “don't add to the chaos count.” Elemental Mastery is the H2 exception below. The agreed PT2 reading is recorded here, rather than added to a trait description: rank 0–1 spells of your discipline don't trigger a chaos roll. No new mechanics wording was inserted into Conjuration Mastery.

### H2 — Elemental Mastery names the wrong discipline (unchanged from PT1)

The PDF prints this exact sentence on page 18:

> Non-doom tier 1 results of rank 0 and 1 conjuration spells you cast don’t add to the chaos count. Your conjuration spells of rank 2 and higher are treated as 2 ranks lower when they trigger a backlash.

The markdown silently changes both occurrences to `elemental` (`C:1025`). This is the same copy-paste bug present in PT1. Taken literally, the trait would grant an elementalist nothing. Following the shared decision, `elemental-t2-c2.yaml` is implemented with `elemental` in both clauses, matching the trait name and tree. The printed `conjuration` sentence is retained here for audit; the description does not carry an HTML note or invented chaos-roll wording.

## MEDIUM severity

### M1 — Chopping graph references used stale aliases

The PDF and markdown agree that the names are `Stop` and `Chopping Crit`, but several existing `connectsTo` values still used the old aliases `Stop Chopping` and `Crit`. Those references would not resolve to the canonical trait names. They were corrected to `Stop` / `Chopping Crit` in:

| Files | Old reference | Correct reference |
|---|---|---|
| `chopping-t2-c2.yaml`, `chopping-t4-c2.yaml` | `Stop Chopping` | `Stop` |
| `chopping-t2-c3.yaml`, `chopping-t4-c3.yaml` | `Crit` | `Chopping Crit` |

## LOW severity

These are source-level wording differences between the pinned markdown and the PDF. The PDF form was followed.

| Trait/file | Markdown | PDF (followed) |
|---|---|---|
| `chopping-t1-c1.yaml` — Axe Hurler (`C:903`) | `its non-melee range` | `it’s non-melee range` |
| `chopping-t2-c1.yaml` — Mighty Arm (`C:915`) | `its non-melee range` | `it’s non-melee range` |
| `chopping-t2-c3.yaml` — Unrelenting Death (`C:923`) | `on the same turn` | `one the same turn` (canonical typo) |
| `chopping-t3-c1.yaml` — Hurl in the Dark (`C:927`) | `against targets in darkness` | `against target in darkness` (printed singular) |

## INFO

- PDF evidence settles both recorded Chopping name questions. Page 16 prints `Stop` and `Chopping Crit`; the pinned markdown agrees at `C:929` and `C:933`. The YAML names are therefore unchanged. Only stale graph references were fixed.
- `camping-t4-c3.yaml` (Bard) and `enchantment-t1-c1.yaml` (Material Transfer) contained older PT1 wording. They were re-transcribed from the PT2 PDF (pages 15 and 19 respectively); the pinned markdown agrees with the new text.
- `connectsTo` graph edges are not printed in the markdown. Existing graph data was retained except for the canonical Chopping name aliases documented above. `xpCost` is intentionally omitted from every trait and computed from tier in derived data.

## Verification notes

- All 60 assigned YAML documents remain one-document YAML mappings.
- Every `_id` and `_key` is preserved from `HEAD`.
- The only Elemental Mastery divergence from the PDF is the explicitly documented H2 implementation exception; the source sentence is recorded verbatim above.
