# Crows Traits Batch C — Playtest 2 Cross-Validation

**Trees:** illusion, knowledge, leverage, necromancy, pets
**YAMLs checked:** 60 (`src/packs/crows-traits/{illusion,knowledge,leverage,necromancy,pets}-t*-c*.yaml`)
**Primary source:** *MCDM Crows Public Playtest August–September 2026*, Characters Book for Playtest 2, PDF pp. 20–24.
**Structure cross-check:** `docs/source/C-characters-book.md` (tree, tier, column, and order only)
**Date:** 2026-08-25

The PDF is authoritative for names and prose. The pinned Markdown silently fixes some PDF typos, so PDF-only wording is called out below. All 60 files have the expected tree, tier, column, starting flag, and tier-derived XP cost; no `xpCost` field is stored.

## MEDIUM — replacement applied in place

| File | Field | YAML | PDF | Status |
|------|-------|------|-----|--------|
| `leverage-t4-c2.yaml` | `name` and `description` | `Stacks on Stacks` and the PT2 stack-limit rule | `Stacks on Stacks` — “When you carry an item with a stack limit greater than 1, its stack limit increases by 1.” (p. 22) | **Replacement, not a rename.** The existing `_id`/`_key` were retained in place; the `grndrl` slug is now an opaque, cosmetic handle. |

`leverage-t3-c2.yaml` now points at `Stacks on Stacks` in `connectsTo`. No `_id` or `_key` has been changed.

## MEDIUM — resolved PT2 content drift

These were stale PT1 or terminology-only values and are now transcribed from the PDF:

| File(s) | Change |
|---------|--------|
| `knowledge-t3-c1.yaml` | `skill bonus` → `expertise` in Shared Knowledge. |
| `knowledge-t4-c1.yaml` | `skill bonus` → `expertise` in Memorization. |
| `pets-t1-c2.yaml` (Tricks) | Removed PT1 skills; now grants two PT2 expertises from Athletics, Endurance, Lift, Search, or Stealth. |
| `pets-t3-c2.yaml` (Extra Tricks) | Same PT2 expertise vocabulary and list; stacks with Tricks. |

The Pets changes are mechanical content changes, not wording-only edits: Climb, Hide, Jump, and Sneak do not exist in PT2.

## LOW — PDF/Markdown variation and canonical typos

| File | PDF text retained in YAML | Markdown variation / note |
|------|---------------------------|---------------------------|
| `illusion-t4-c3.yaml` — Telepathic Connection | `within 5 squares of your to become invisible` (p. 20) | Markdown silently repairs `your` to `you`; the PDF typo is preserved. |
| `knowledge-t1-c3.yaml` — Improvised Equipment | `If the item has a duration, it's duration becomes 1 DT.` (p. 21) | Markdown silently changes `it's` to `its`; the PDF wording is preserved. |
| `knowledge-t4-c3.yaml` — Special Item | `non-weapon, non-armor` (p. 21) | Markdown uses `nonweapon`; PDF hyphenation is retained. |
| `pets-t1-c2.yaml` — Tricks | `a two expertises ... from the following list` (p. 24) | Markdown drops the printed `a`; the PDF grammar typo is retained. |
| `pets-t2-c3.yaml` — Dungeon Critter | `grant a bonus to attack the pets you own` (p. 24) | Markdown has plural `attacks`; PDF singular is retained. |
| `pets-t3-c2.yaml` — Extra Tricks | `a two expertises ... from the following list` (p. 24) | Same printed grammar typo as Tricks; retained. |
| `pets-t4-c2.yaml` — Share Food | `pets you car for can eat rations` (p. 24) | Markdown silently repairs `car` to `care`; PDF typo is retained. |

## INFO — agreed readings and verification notes

- **H1 chaos wording:** Illusion Mastery and Necromancy Mastery retain MCDM’s printed “don’t add to the chaos count” wording. The agreed project reading is that rank 0–1 spells of the relevant discipline do not trigger a chaos roll; no replacement mechanics text was added to the trait descriptions.
- `necromancy-t2-c1.yaml` (Many Curses) and `necromancy-t3-c2.yaml` (Blessings for a Curse) were verified against PDF p. 23 and left unchanged: Many Curses has the Mind-many use pool and applies `weakened`; Blessings removes `blessed` to make the target `vulnerable`.
- No assigned trait contains the deleted `boned` condition.
- `connectsTo` is present in every YAML but is not explicitly represented in the Markdown; the edge values follow the PDF tree layout. The Leverage replacement edge now resolves to the PT2 name, and a sweep found no dangling targets in the five owned trees.
- Every existing `_id` and `_key` remains unchanged, and no `xpCost` field was added.

## Summary

| Severity | Count |
|----------|-------|
| HIGH | 0 |
| MEDIUM | 1 resolved replacement; four PT2 content drifts resolved |
| LOW | 7 PDF/Markdown variations or canonical typos |
| INFO | 5 structural/source-fidelity notes |
