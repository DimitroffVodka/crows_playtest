# Consumables Cross-Validation Report

**Generated:** 2026-05-26  
**Sources:**
- PRIMARY: `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/MCDM_Crows_Annotated_Inventory_Cards_for_May_June_2026_Playtest.md`
- CROSS-CHECK: `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/05_MCDM_Crows_Inventory_Cards_for_May_June_2026_Playtest.md`
- YAMLs: `E:/FoundryVTTv14/Data/systems/crows/src/packs/crows-consumables/*.yaml` (14 files)

---

## HIGH Severity

| Item | Field | YAML Value | Markdown Value | Notes |
|------|-------|-----------|----------------|-------|
| Rage Potion | `system.cost` | `50` gc | `250` gc | Cost row confirmed in both markdown sources |
| Ball Bearings | `system.bands.t2` | `"Prone and speed reduced until healed"` | `"Prone"` (only) | Markdown 12-16 column: just "Prone"; speed penalty is only in t1 (≤11) |
| Soothing Candy | `system.cost` | `0` gc | **CUT OFF** — cost cell absent in both markdown sources | See note below |

### Soothing Candy Cost — Investigation Result

The Soothing Candy cost cell is missing from both markdown files. In both sources the card text ends at "yourself." and the cost row has no value in the Soothing Candy column — the adjacent column costs (Gem Stack 5 = 2 gc, Art Object Tiny = 5 gc) are present but Soothing Candy's own cost cell is blank. This appears to be a PDF extraction artifact (the card was cut off at the page boundary or column edge).

**Verdict:** YAML cost of `0` cannot be confirmed or contradicted from markdown. Flag as HIGH — cost is unknown/unverified; likely non-zero based on other consumable prices. Requires checking the original PDF or game document directly.

---

## MEDIUM Severity

| Item | Field | YAML Value | Markdown Value | Notes |
|------|-------|-----------|----------------|-------|
| Acid Vial | `system.useAction` | `action` | Card shows two modes: `Maneuver:` (pour description) and `Action:` (ranged attack) | YAML encodes the attack action type; the item's primary description opens with "Maneuver:" |
| Strong Acid Vial | `system.useAction` | `action` | Same dual-mode card as Acid Vial | Same issue |
| Rage Potion | `system.duration` | `"While attacking each round"` | "Lasts as long as you keep making attacks against creatures each round" | YAML wording is a shortened paraphrase — functionally equivalent but not verbatim |

---

## LOW Severity

| Item | Field | YAML Value | Markdown Value | Notes |
|------|-------|-----------|----------------|-------|
| Acid Vial | `system.bands.t3` | `"8 + A"` | `"8+ A"` | Spacing difference only |
| Strong Acid Vial | `system.bands.t3` | `"14 + A"` | `"14 + A"` | Matches |
| Healing Potion | `system.bands` (all) | all `""` | Card text: "regain 1d6 Stamina or remove 1 wound" | No band tiers in markdown either — heal is a flat effect. Bands correctly empty. INFO-level note only. |

---

## INFO — Items with No Discrepancies

The following 10 consumables match across all checked fields:

| Item | useAction | bands (t1/t2/t3) | thrown.isAttack | thrown.range | duration | usageDie | slots | stackMax | cost |
|------|-----------|------------------|-----------------|--------------|----------|----------|-------|----------|------|
| Acid Vial (bands/range/cost) | — see MEDIUM | t1="" / t2="4+A" / t3="8+A" ✓ | true ✓ | 5 ✓ | — | disabled ✓ | 1 ✓ | 5 ✓ | 10 gc ✓ |
| Strong Acid Vial (bands/range/cost) | — see MEDIUM | t1="" / t2="7+A" / t3="14+A" ✓ | true ✓ | 5 ✓ | — | disabled ✓ | 1 ✓ | 5 ✓ | 250 gc ✓ |
| Animal Feed | maneuver ✓ | all empty ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 6 ✓ | 1 gc ✓ |
| Caltrops | maneuver ✓ | "4 dam -2 spd" / "2 dam" / "No effect" ✓ | false ✓ | 5 ✓ | — | disabled ✓ | 1 ✓ | 2 ✓ | 5 gc ✓ |
| Fire Bomb | action ✓ | "10 dam" / "5 dam" / "0 dam" ✓ | false ✓ (AoE RR, not targeted) | 10 ✓ | — | disabled ✓ | 1 ✓ | 2 ✓ | 250 gc ✓ |
| Healing Potion | maneuver ✓ | all empty ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 5 ✓ | 100 gc ✓ |
| Hearty Ration | maneuver ✓ | all empty ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 6 ✓ | 2 gc ✓ |
| Poison Vial | maneuver ✓ | "Twice Boned" / "Boned" / "No effect" ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 5 ✓ | 10 gc ✓ |
| Poison Vial (Strong) | maneuver ✓ | "Thrice Boned" / "Twice Boned" / "No effect" ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 5 ✓ | 250 gc ✓ |
| Ration | maneuver ✓ | all empty ✓ | false ✓ | 0 ✓ | — | disabled ✓ | 1 ✓ | 6 ✓ | 2 gc ✓ |
| Speed Potion | maneuver ✓ | all empty ✓ | false ✓ | 0 ✓ | "1 UD" ✓ | disabled ✓ | 1 ✓ | 5 ✓ | 100 gc ✓ |

---

## Notes on usageDie

All 14 YAMLs have `usageDie.enabled: false` and `udMax: 0`. The markdown cards do not show UD fields for any of these consumables (Speed Potion uses UD for duration tracking, but that is the duration, not a usage die). No discrepancies here.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| HIGH | 3 | Rage Potion (cost 50→250), Ball Bearings (t2 band), Soothing Candy (cost unverifiable) |
| MEDIUM | 2 | Acid Vial (useAction), Strong Acid Vial (useAction) |
| LOW | 1 | Acid Vial t3 spacing |
| INFO | 0 | — |
| CLEAN | 10 | All other fields on all other items |

**Headline:** Rage Potion cost is **5x wrong** (50 gc YAML vs 250 gc markdown — confirmed in both sources). Soothing Candy cost is **unknown** — both markdown sources have the cost cell missing due to PDF extraction; YAML has 0 gc which is almost certainly wrong. Ball Bearings t2 band incorrectly adds "and speed reduced until healed" — that effect belongs to t1 only.
