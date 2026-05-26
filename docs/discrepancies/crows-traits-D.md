# Discrepancies — Traits Batch D (Slashing, Stabbing, Thievery, Travel, Unarmed)

**Source:** `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/02_MCDM_Crows_Characters_Booklet_May_June_2026_Playtest.md`
**YAMLs:** `E:/FoundryVTTv14/Data/systems/crows/src/packs/crows-traits/{slashing,stabbing,thievery,travel,unarmed}-t*-c*.yaml` (60 files)
**Date:** 2026-05-26

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 1     |
| LOW      | 4     |
| INFO     | 2     |

All 60 files present (12 per tree × 5 trees). Tier, column, isStarting, tree, and description fields are correct for all but the items noted below. No xpCost field exists in any YAML in this batch (xpCost is not stored in the data model; the tier directly encodes the cost tier). The single MEDIUM issue is a name spelling divergence in the Slashing tree.

---

## HIGH Severity

_(none)_

---

## MEDIUM Severity

Name spelling diverges between YAML and markdown canonical source.

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| slashing-t2-c3 | name | `Intercepting Blade` | `Interceding Blade` |

**Notes:**
- `slashing-t2-c3` (Intercepting Blade): The markdown heading reads `**Interceding Blade**`; the YAML stores `Intercepting Blade`. Both forms appear in published MCDM material for this mechanic style (intercepting vs. interceding). The YAML form (`Intercepting Blade`) is mechanically clearer and consistent with the trait's function. However, the markdown is the canonical source; the YAML deviates. **Recommend verifying against the PDF layout; if the PDF reads `Interceding Blade`, the YAML name should be corrected to match.**

---

## LOW Severity

Description variation, preserved canonical typos, and name-spelling fixes of source typos.

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| slashing-t2-c2 | description | `"…as part of the counter while…"` | `"…as part of the reaction while…"` |
| slashing-t4-c3 | name | `Scabbard` (corrected) | `Scabard` (MD typo) |
| stabbing-t3-c2 | description | `"When you hit an opportunity attack…"` | `"When you hit with an opportunity attack…"` |
| unarmed-t4-c1 | name | `Bashing Benefits` (corrected) | `Bashing Benefts` (MD typo) |

**Notes:**
- `slashing-t2-c2` (Dance Away): The markdown body reads `"…take the Shift maneuver as part of the **reaction** while…"`. The YAML reads `"…as part of the **counter** while…"`. The word "counter" aligns with the earlier clause ("When you counter, you can take the Shift maneuver…") and is mechanically consistent. "Reaction" in the markdown may be the author's intent or a late-edit artifact. LOW — no mechanical change; the counter is the reaction. Monitor for official errata.
- `slashing-t4-c3` (Scabbard): Markdown spells it `Scabard` (missing one 'b'). The YAML correctly uses `Scabbard`. **Canonical MCDM typo — preserve classification LOW; YAML is correct.**
- `stabbing-t3-c2` (Nope): YAML reads `"When you hit an opportunity attack…"` (missing preposition "with"). Markdown reads `"When you hit with an opportunity attack…"`. The missing word is a minor copy omission. LOW description variation; the YAML should add "with" for grammatical correctness.
- `unarmed-t4-c1` (Bashing Benefits): Markdown spells it `Bashing Benefts` (missing 'i'). The YAML correctly uses `Bashing Benefits`. **Canonical MCDM typo — preserve classification LOW; YAML is correct.**

---

## INFO

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| all 60 files | xpCost | field absent from all YAMLs | 500/1000/1500/2000 by tier (T1/T2/T3/T4) |
| — | connectsTo | not diffed | Markdown lacks visible graph edge data (expected per spec) |

**Notes:**
- **xpCost absent**: No YAML in this batch carries a `xpCost` field. The markdown shows a consistent mapping: T1 = 500 XP (Starting), T2 = 1,000 XP, T3 = 1,500 XP, T4 = 2,000 XP. If the system requires xpCost as a stored field, all 60 files need it added. If the runtime derives it from `system.tier`, no action needed.
- **connectsTo not diffed** per spec. INFO-once note: all 60 files contain `connectsTo` arrays; the markdown source does not contain graph-edge data to compare against, so edge correctness cannot be validated from this source alone.
- The markdown heading for `Javelin` (stabbing-t1-c1) is formatted as `## **Javelin** XP Cost: 500 (Starting)` rather than the inline `**Name** XP Cost:` form used by the other stabbing entries. This is a PDF-to-markdown extraction artifact; the YAML data is correct.
- The markdown headings for the Thievery tree T1 entries (`Sieze the Advantage`, `Safe Cracking`, `Stealthy`) appear as `##` headings rather than inline bold entries. This is a formatting inconsistency in the markdown extraction, not a data issue.
- **Preserved canonical typos confirmed present in YAMLs:**
  - `stabbing-t1-c3` (Stabathon): YAML body contains `"any other attacks you make one the same turn"` — typo `one` for `on` preserved. ✓
  - `thievery-t4-c1` (Seeing Things): YAML body contains `"wile you are not wearing"` — typo `wile` for `while` preserved. ✓
  - `stabbing-t2-c3` (Triple Crit): YAML body contains `"you deal thriple the weapon's tier 3 damage"` — typo `thriple` for `triple` preserved. ✓

---

All 60 traits in Batch D are structurally sound. The single MEDIUM finding (Intercepting vs. Interceding Blade) requires a PDF spot-check to determine the authoritative spelling. The LOW finding for Nope (missing "with") is a trivial grammatical fix.
