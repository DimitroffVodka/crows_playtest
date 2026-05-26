# Weapons Cross-Validation Report

**Date:** 2026-05-26  
**Sources:**
- Canonical: `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/MCDM_Crows_Annotated_Inventory_Cards_for_May_June_2026_Playtest.md`
- Cross-check: `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/05_MCDM_Crows_Inventory_Cards_for_May_June_2026_Playtest.md`
- YAMLs: `E:/FoundryVTTv14/Data/systems/crows/src/packs/crows-weapons/*.yaml` (19 files)

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 0     |
| MEDIUM   | 0     |
| LOW      | 0     |
| INFO     | 0     |

**Total discrepancies: 0**

All 19 YAML weapon entries exactly match the canonical markdown source across every checked field.

---

## Verified Weapon Roster (19 weapons)

| Weapon | File | Type | Melee | Ranged | AttackStat | T2 | T3 | Qualities | ParryVal | Slots | Stack | Cost |
|--------|------|------|-------|--------|------------|----|----|-----------|----------|-------|-------|------|
| Hammer | hammer.yaml | bashing | 1 | 5 | either | 2 + A or S | 4 + A or S | light, pummeling | — | 1 | 2 | 10 gc |
| Mace | mace-1h.yaml | bashing | 1 | 0 | strength | 3 + S | 6 + S | pummeling | — | 1 | 1 | 12 gc |
| Knife | knife.yaml | slashing | 1 | 5 | either | 2 + A or S | 4 + A or S | light, disengage, parry | 2 | 1 | 2 | 10 gc |
| Sword | sword.yaml | slashing | 1 | 0 | strength | 3 + S | 6 + S | disengage, parry | 4 | 1 | 1 | 12 gc |
| Handaxe | handaxe.yaml | chopping | 1 | 5 | either | 2 + A or S | 5 + A or S | light, dismember | — | 1 | 2 | 10 gc |
| Axe | axe.yaml | chopping | 1 | 0 | strength | 3 + S | 7 + S | dismember | — | 1 | 1 | 12 gc |
| Stiletto | stiletto.yaml | stabbing | 1 | 5 | either | 2 + A or S | 5 + A or S | light, brutal | — | 1 | 2 | 10 gc |
| Spear | spear.yaml | stabbing | 1 | 0 | strength | 3 + S | 7 + S | brutal | — | 1 | 1 | 12 gc |
| Mace (Polearm) | mace-2h.yaml | bashing | 2 | 0 | strength | 3 + S | 6 + S | pummeling | — | 2 | 1 | 15 gc |
| Maul | maul.yaml | bashing | 1 | 0 | strength | 4 + S | 8 + S | pummeling | — | 2 | 1 | 15 gc |
| Glaive | glaive.yaml | slashing | 2 | 0 | strength | 3 + S | 6 + S | disengage, parry | 6 | 2 | 1 | 15 gc |
| Greatsword | greatsword.yaml | slashing | 1 | 0 | strength | 4 + S | 8 + S | disengage, parry | 6 | 2 | 1 | 15 gc |
| Halberd | halberd.yaml | chopping | 2 | 0 | strength | 3 + S | 7 + S | dismember | — | 2 | 1 | 15 gc |
| Greataxe | greataxe.yaml | chopping | 1 | 0 | strength | 4 + S | 9 + S | dismember | — | 2 | 1 | 15 gc |
| Pike | pike.yaml | stabbing | 2 | 0 | strength | 3 + S | 7 + S | brutal | — | 2 | 1 | 15 gc |
| Warpick | warpick.yaml | stabbing | 1 | 0 | strength | 4 + S | 9 + S | brutal | — | 2 | 1 | 15 gc |
| Shortbow | shortbow.yaml | bow | 0 | 10 | agility | 1 + A | 2 + A | cumbersome | — | 1 | 1 | 10 gc |
| Longbow | longbow.yaml | bow | 0 | 20 | agility | 2 + A | 3 + A | — | — | 2 | 1 | 12 gc |
| Crossbow | crossbow.yaml | bow | 0 | 15 | agility | 3 + A | 6 + A | reload | — | 2 | 1 | 15 gc |

---

## Notes on Markdown Parsing

- **Mace appears twice** in markdown as expected: 1h Mace (melee 1, 1 slot, `mace-1h.yaml`) and Mace (Polearm) (melee 2, 2 slots, `mace-2h.yaml`). Both entries present and correct.
- **Stiletto qualities** in markdown: `_Stabbing, Light Brutal_` (missing comma between Light and Brutal). Both cross-check and annotated files show this formatting artefact. YAML correctly stores `[light, brutal]` — the parsing is unambiguous.
- **Shortbow** listed in the same table block as Pike and Warpick (2h polearms) but is correctly 1 slot / stackMax 1 in YAML.
- **Longbow qualities** in markdown show only `_Bow_` (no other qualities). `Bow` is the weapon type, not a quality. YAML correctly stores `qualities: []`.
- **Crossbow** in markdown: `_Bow, Reload_`. `Bow` is the type; YAML correctly stores `qualities: [reload]`.
- Both markdown files (annotated and cross-check) are identical for all weapon entries.

---

## Coverage

- Markdown weapons found: 19
- YAML files found: 19
- Weapons in markdown with no YAML: 0
- YAMLs with no matching markdown entry: 0
