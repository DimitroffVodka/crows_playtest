# Discrepancies — Traits Batch B (Blacksmithing, Camping, Chopping, Conjuration, Elemental, Enchantment)

**Source:** `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/02_MCDM_Crows_Characters_Booklet_May_June_2026_Playtest.md`
**YAMLs:** `E:/FoundryVTTv14/Data/systems/crows/src/packs/crows-traits/{blacksmithing,camping,chopping,conjuration,elemental,enchantment}-t*-c*.yaml` (72 files)
**Date:** 2026-05-26

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 2     |
| LOW      | 4     |
| INFO     | 2     |

All 72 files present (12 per tree × 6 trees). No missing files, no extra files. Tier, xpCost (implied by tier), tree, isStarting, and column values are correct for all 72 traits. Discrepancies are limited to two name divergences in the Chopping tree and description-level issues.

---

## HIGH Severity

_(none)_

---

## MEDIUM Severity

Name spelling / wording diverges between YAML and markdown.

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| chopping-t3-c2 | name | `Stop Chopping` | `Stop` |
| chopping-t3-c3 | name | `Crit` | `Chopping Crit` |

**Notes:**
- `chopping-t3-c2`: Markdown heading reads simply `**Stop**`; YAML expanded to `Stop Chopping`. The YAML expansion adds specificity but is not verbatim. Canonical form should be verified against the PDF layout — the markdown column layout occasionally drops the tree-qualifier prefix that is present in the PDF grid header.
- `chopping-t3-c3`: Markdown reads `**Chopping Crit**`; YAML shortened to `Crit`. The YAML name loses the tree qualifier that the markdown carries. The PDF extraction session (page 16 output) confirmed the name as `Chopping Crit`. **YAML should be corrected to `Chopping Crit`.**

---

## LOW Severity

Description semantic variation or preserved-typo status.

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| elemental-t2-c2 | description (canonical typo) | `"elemental spells"` (YAML corrected) | `"conjuration spells"` (canonical MCDM typo — should be preserved per spec) |
| conjuration-t1-c1 | description (minor typo fix) | `"additional 1 UD"` (corrected spelling) | `"addtioinal 1 UD"` (typo in source) |
| chopping-t1-c1 | description (grammar fix) | `"its non-melee range"` (corrected) | `"it's non-melee range"` (apostrophe error in source) |
| chopping-t2-c3 | description (minor typo fix) | `"on the same turn"` (corrected) | `"one the same turn"` (typo in source) |

**Notes:**
- `elemental-t2-c2` (Elemental Mastery): The markdown body reads `"Non-doom tier 1 results of rank 0 and 1 conjuration spells you cast..."` — using `conjuration` where `elemental` is semantically expected. This is the canonical MCDM typo called out in the diff spec. The YAML **corrects** it to `"elemental spells"`, which deviates from the spec requirement to **preserve** the canonical typo. Severity is LOW per spec guidance; however, the project chose to silently correct rather than preserve-and-note. Recommend adding an HTML comment or keeping the YAML aligned with the PDF text pending an official MCDM errata.
- Spelling/grammar fixes in conjuration-t1-c1, chopping-t1-c1, and chopping-t2-c3 are editorially appropriate and do not affect mechanical meaning.

---

## INFO

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| enchantment-t1-c2 | description source | Full description present in YAML | Description absent from markdown (garbled 2-column PDF-to-markdown extraction) |
| — | connectsTo | No graph edges checked | Markdown lacks visible graph edge data (expected per spec) |

**Notes:**
- `enchantment-t1-c2` (Twice Enchanted): The markdown section for the Enchantment tree has a multi-column layout that the Markdown converter collapsed into a single garbled line (L1378–L1382). As a result, the body text for `Twice Enchanted` is absent from the markdown. The YAML description (`"When you work on crafting an enchanting item as part of the Craft Equipment rest activity, you can make two crafting rolls for the item or make a second crafting roll for a different enchanting item."`) was derived from PDF source and is mechanically coherent. No change needed; noting the markdown gap.
- `connectsTo` fields are not diffed per spec — once-INFO note recorded here.
- The markdown heading for the Blacksmithing tree reads `## **Blackmsithing**` (L1084) — a typo in the source document. YAML uses `tree: blacksmithing` (correct). No YAML correction needed; this is a markdown source artifact.
- The Camping tree's column 3 traits (`Delayed Inspiration`, `Bard`) appear as stand-alone `##` headings in the markdown (not as `**Name** XP Cost:` inline entries), indicating PDF-column extraction inconsistency. The YAML correctly assigns these to tier 3 and tier 4 column 3. No discrepancy in the data.

---

All 72 traits in Batch B are structurally sound. The two MEDIUM name issues in the Chopping tree are the only actionable findings. The Elemental Mastery LOW issue warrants a decision on canonical-typo preservation policy.
