# Crows Traits Batch C — Cross-Validation Discrepancies

**Trees:** illusion, knowledge, leverage, necromancy, pets, reputation  
**YAMLs diffed:** 72 files (`src/packs/crows-traits/{tree}-t*-c*.yaml`)  
**Markdown source:** `02_MCDM_Crows_Characters_Booklet_May_June_2026_Playtest.md`  
**Fields checked:** name, system.tree, system.tier, system.column, system.isStarting, system.description, xpCost (computed from tier)  
**Date:** 2026-05-26

---

## HIGH — Tier, xpCost, or tree-name mismatch

| File | Field | YAML | Markdown | Notes |
|------|-------|------|----------|-------|
| — | — | — | — | None found |

All 72 traits have correct tier (1–4), tree name, and column. xpCost is not stored in any YAML — it is computed from tier (500/1000/1500/2000). All markdown XP Cost values are consistent with the tier-to-cost mapping. No HIGH discrepancies.

---

## MEDIUM — Column, isStarting, or name drift

| File | Field | YAML | Markdown | Notes |
|------|-------|------|----------|-------|
| `knowledge-t2-c1.yaml` | name | `Specific Research` | `Specifc Research` | Markdown has OCR/typo; YAML is correct |
| `necromancy-t4-c1.yaml` | name | `Sacrifice` | `Sacrifce` | Markdown has OCR/typo; YAML is correct |

---

## LOW — Description variation, preserved typos, restActivity flag drift

| File | Trait | YAML | Markdown | Notes |
|------|-------|------|----------|-------|
| `illusion-t1-c1.yaml` | Lasting Illusion | `add an additional 1 UD` | `add an addtioinal 1 UD` | Markdown typo; YAML corrected |
| `illusion-t3-c3.yaml` | Goodbye | `This invisibility ends` | `This invisibilty ends` | Markdown typo; YAML corrected |
| `leverage-t3-c3.yaml` | Lights Out | `be extinguished and destroyed` | `be extinquished and destroyed` | Markdown typo; YAML corrected |
| `necromancy-t4-c1.yaml` | Sacrifice | `you can choose to take 1d6` | `you can choose to tak ~~e~~ 1d6` | Markdown has strikethrough artifact; YAML clean |
| `necromancy-t4-c3.yaml` | Angelic Presence | `within 2 squares of you` | `within 2 ~~sq~~ uares of you` | Markdown has strikethrough artifact; YAML clean |
| `pets-t4-c2.yaml` | Share Food | `pets you car for can eat rations` | `pets you car for can can eat rations` | Both preserve "car for" typo (should be "care for") per spec; YAML dropped one duplicate "can" from markdown — **preserve as LOW** |
| `reputation-t3-c3.yaml` | Have it in the Back | `There's a 20% chance they have the materials` | `There's a 20% they have the materials` | YAML added "chance"; minor description variation |
| `knowledge-t4-c3.yaml` | Special Item | `non-weapon, non-armor mundane item` | `nonweapon, non-armor mundane item` | Hyphenation drift; YAML normalised |
| `pets-t1-c1.yaml` | Buddy | YAML description clean and accurate | MD L1651 merged two-column PDF text garbles Buddy+Tricks descriptions | PDF extraction artifact; YAML correct — LOW |
| `pets-t1-c2.yaml` | Tricks | YAML description clean | Same merged-column artifact as Buddy | PDF extraction artifact; YAML correct — LOW |

**Note on reputation-t4-c2 (On Sale):** Both YAML and markdown read "Items affect by your Discount trait" (missing "ed"). Typo preserved identically in both — no discrepancy per spec.

---

## INFO — Structural notes, missing-from-either-side

| Item | Notes |
|------|-------|
| xpCost field | Absent in all 72 YAMLs across all 6 trees. Computed from `system.tier` (500/1000/1500/2000). Systemic design choice; no per-file defects. |
| pets-t1 markdown heading | Markdown L1647 reads `**Tricks Mounted Speed**` (two traits merged into one heading) — PDF two-column layout artifact. YAMLs correctly separate `pets-t1-c2 Tricks` and `pets-t1-c3 Mounted Speed`. |
| connectsTo | Not diffed per task spec. INFO-once: markdown does not show visible graph edges. |

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 0 |
| MEDIUM | 2 |
| LOW | 10 |
| INFO | 3 |

**72 YAMLs checked. 0 HIGH, 2 MEDIUM (both markdown OCR typos corrected in YAML), 10 LOW (mostly markdown typos/artifacts corrected in YAML or minor wording variation), 3 INFO.**
