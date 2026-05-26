# Crows Traits Batch A — Cross-Validation Report

**Trees:** alchemy, alteration, archery, armor, bashing, benefaction  
**YAMLs checked:** 72 (all present, no missing files)  
**Markdown source:** `02_MCDM_Crows_Characters_Booklet_May_June_2026_Playtest.md`  
**Date:** 2026-05-26

---

## HIGH Severity

_No HIGH discrepancies found._

---

## MEDIUM Severity

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| `alchemy-t4-c3` | `name` | Alchemy Bell | Alchemy Belt |

**Note:** The YAML `_id` (`ctalch43alchblt0`) and `description` ("You gain a third belt slot…") both confirm the intent is "Alchemy **Belt**". The name field has a single-letter typo ("Bell" → "Belt").

---

## LOW Severity

Canonical typos in the markdown that the YAML either preserves or silently corrects, and minor name-format differences. Per spec, note but do not require fixes.

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| `alteration-t1-c1` | `system.description` | "additional 1 UD" | "addtioinal 1 UD" (markdown typo corrected in YAML) |
| `alteration-t2-c2` | `system.description` | "alteration spell" ×3 (Hooves, Horns, Wings) | "altearation spell" (markdown typo corrected in YAML) |
| `alteration-t3-c2` | `system.description` | "alteration spell" | "altearation spell" (markdown typo corrected in YAML) |
| `alteration-t4-c2` | `system.description` | "alteration spell" | "altearation spell" (markdown typo corrected in YAML) |
| `alteration-t2-c3` | `system.description` | "A creature who holds" | "A creautre who holds" (markdown typo corrected in YAML) |
| `alteration-t4-c3` | `system.description` | "absorbs and destroys" | "absorbs and destorys" (markdown typo corrected in YAML) |
| `armor-t2-c2` | `name` | Sacrifice Armor | "Sacrifce Armor" (markdown typo corrected in YAML) |
| `armor-t3-c3` | `name` | Jury-Rig Repairs | "- Jury Rig Repairs" (markdown has leading dash prefix and no hyphen; YAML normalises to hyphenated form) |
| `armor-t4-c1` | `system.description` | "When get a tier 3 result…" | "When get a tier 3 result…" (canonical markdown omission of "you" preserved in YAML — matches source) |
| `bashing-t1-c1` | `system.description` | "1 additional square. This trait stacks" | "1 addtional square. This trait statcks" (two markdown typos corrected in YAML) |
| `bashing-t2-c1` | `system.description` | "1 additional square. This trait stacks" | "1 addtional square. This trait statcks" (two markdown typos corrected in YAML) |
| `benefaction-t1-c1` | `system.description` | "additional 1 UD" | "addtioinal 1 UD" (markdown typo corrected in YAML) |

**Additional LOW notes:**

- **Archery t1 merged heading:** Markdown L839 lists "Range Finder Prone Position XP Cost: 500 (Starting) XP Cost: 500 (Starting)" as a single line, combining two traits. YAML correctly splits them into `archery-t1-c2` (Range Finder) and `archery-t1-c3` (Prone Position) with the correct descriptions assigned to each.
- **Bashing t1 merged heading:** Markdown L959 lists "Destructive Tripping Counter XP Cost: 500 (Starting) XP Cost: 500 (Starting)" as a single header for two traits. YAML correctly splits into `bashing-t1-c2` (Destructive) and `bashing-t1-c3` (Tripping Counter) with correct descriptions.

---

## INFO

| Slug | Field | YAML | Markdown |
|------|-------|------|----------|
| `(all 72)` | `connectsTo` | present in all YAMLs | not verifiable — markdown lacks visible graph edges |

**connectsTo not verified** — the markdown contains no explicit connection arrows or adjacency annotations. Column-aligned defaults from extraction are accepted as-is.

---

## Summary

Batch A (72 traits across 6 trees) is in excellent shape. There are **zero HIGH discrepancies**: all tier values, XP costs (none written in YAML, correctly computed from tier), tree assignments, column assignments, and `isStarting` flags match the markdown exactly. There is **one MEDIUM issue**: `alchemy-t4-c3` has name "Alchemy Bell" where the markdown reads "Alchemy Belt" (both the description text and the `_id` confirm "Belt" is the intended name — single-character typo). The **twelve LOW notes** are all cases where the YAML silently corrects obvious markdown typos (misspellings of "additional," "alteration," "creature," "destroys," "Sacrifice," "stacks") or normalises formatting (Jury-Rig Repairs name, merged trait headings in Archery and Bashing); one LOW note flags a canonical markdown omission ("When **you** get a tier 3 result" → "When get a tier 3 result") in Shield Bash that was preserved faithfully in the YAML. No traits are missing from either the YAML set or the markdown.
