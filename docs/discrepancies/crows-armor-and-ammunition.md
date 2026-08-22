# Armor & Ammunition Cross-Validation Report

**Generated:** 2026-05-26
**Canonical source:** `MCDM_Crows_Annotated_Inventory_Cards_for_May_June_2026_Playtest.md`
**YAMLs checked:** `src/packs/crows-armor/` (4 files) + `src/packs/crows-ammunition/` (2 files)

## Summary

| Section | HIGH | MED | LOW | INFO | Total issues |
|---------|------|-----|-----|------|-------------|
| Armor | 0 | 0 | 0 | 0 | **0** |
| Ammunition | 0 | 0 | 0 | 0 | **0** |
| **Combined** | **0** | **0** | **0** | **0** | **0** |

**Result: All 6 items match the canonical markdown exactly. No discrepancies found.**

---

## Armor

### Data extracted (YAML vs markdown)

| Item | Field | YAML value | Markdown value | Match |
|------|-------|-----------|----------------|-------|
| Shield | armorType | `shield` | Shield (Armor type) | YES |
| Shield | ad | 5 | **AD:**5 | YES |
| Shield | slots | 1 | Stack1 (no "Occupies X Slots" = 1 slot) | YES |
| Shield | stackMax | 1 | Stack1 | YES |
| Shield | cost | 15 | 15 gc | YES |
| Light Armor | armorType | `light` | Light Armor (_Armor_) | YES |
| Light Armor | ad | 5 | **AD**5 | YES |
| Light Armor | slots | 2 | Stack1 (Occupies 2 Slots) | YES |
| Light Armor | stackMax | 1 | Stack1 | YES |
| Light Armor | cost | 50 | 50 gc | YES |
| Medium Armor | armorType | `medium` | Medium Armor (_Armor_) | YES |
| Medium Armor | ad | 10 | **AD**10 | YES |
| Medium Armor | slots | 3 | Stack1 (Occupies 3 Slots) | YES |
| Medium Armor | stackMax | 1 | Stack1 | YES |
| Medium Armor | cost | 150 | 150 gc | YES |
| Heavy Armor | armorType | `heavy` | Heavy Armor (_Armor_) | YES |
| Heavy Armor | ad | 15 | **AD**15 | YES |
| Heavy Armor | slots | 4 | Stack1 (Occupies 4 Slots) | YES |
| Heavy Armor | stackMax | 1 | Stack1 | YES |
| Heavy Armor | cost | 400 | 400 gc | YES |

### HIGH severity issues
_None._

### MEDIUM severity issues
_None._

### LOW severity issues
_None._

### INFO
_None._

### Section summary
All 4 armor items match the canonical markdown on every checked field. The YAML `slots` field correctly maps the card's "Occupies X Slots" notation (Stack1 with no qualifier = 1 slot for Shield; explicit slot counts for Light/Medium/Heavy). Costs align exactly: 15/50/150/400 gc.

---

## Ammunition

### Data extracted (YAML vs markdown)

| Item | Field | YAML value | Markdown value | Match |
|------|-------|-----------|----------------|-------|
| Quiver of 20 Arrows | name | `Quiver of 20 Arrows` | **Quiver of 20 Arrows** | YES |
| Quiver of 20 Arrows | ammoFor | `"shortbows and longbows"` | "shortbows and longbows" | YES |
| Quiver of 20 Arrows | countPerUnit | 20 | 20 (name-embedded) | YES |
| Quiver of 20 Arrows | slots | 1 | Stack1 (no "Occupies" qualifier = 1 slot) | YES |
| Quiver of 20 Arrows | stackMax | 1 | Stack1 | YES |
| Quiver of 20 Arrows | cost | 5 | 5 gc | YES |
| Case of 20 Bolts | name | `Case of 20 Bolts` | **Case of 20 Bolts** | YES |
| Case of 20 Bolts | ammoFor | `"crossbows"` | "crossbows" | YES |
| Case of 20 Bolts | countPerUnit | 20 | 20 (name-embedded) | YES |
| Case of 20 Bolts | slots | 1 | Stack1 (no "Occupies" qualifier = 1 slot) | YES |
| Case of 20 Bolts | stackMax | 1 | Stack1 | YES |
| Case of 20 Bolts | cost | 5 | 5 gc | YES |

### HIGH severity issues
_None._

### MEDIUM severity issues
_None._

### LOW severity issues
_None._

### INFO
- `countPerUnit` is not explicitly shown as a separate field on the card face — it is embedded in the item name ("20 Arrows", "20 Bolts") and confirmed by the card's Stack notation. YAML value of 20 is consistent.
- The YAML description fields render "shortbows and longbows" / "crossbows" as paragraph text. The card uses the same wording inline. No deviation.

### Section summary
Both ammunition items match the canonical markdown exactly. The `ammoFor` text is word-for-word identical to the card descriptions. Costs (5 gc each) and stack/slot values (Stack1 = 1 slot each) are correct.
