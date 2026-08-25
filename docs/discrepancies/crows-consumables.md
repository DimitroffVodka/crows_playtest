# Consumables Cross-Validation Report

**Generated:** 2026-08-25
**PT2 source:** `docs/source/IC-inventory-cards.txt` (`IC:` citations)
**YAMLs:** `src/packs/crows-consumables/*.yaml` (16 files)

The HIGH/MEDIUM/LOW findings below from the earlier audit remain open unless explicitly
changed. The final section records the two PT2 consumables added in T3.4a.

---

## HIGH Severity — prior audit findings

| Item | Field | YAML Value | Card/markdown value | Notes |
|------|-------|-----------|---------------------|-------|
| Rage Potion | `system.cost` | `50` gc | `250` gc | Cost row confirmed in both prior markdown sources. |
| Ball Bearings | `system.bands.t2` | Includes speed reduction | `Prone` only | The speed penalty belongs to t1 (≤11). |
| Soothing Candy | `system.cost` | `0` gc | Cost cell absent/cut off | The extracted sources do not verify a price; original card needs adjudication. |

### Soothing Candy cost — investigation result

The Soothing Candy cost cell is missing from both prior markdown files. The card text ends
at “yourself.” and the adjacent costs are present, but Soothing Candy's own cell is blank.
The shipped `cost: 0` remains unverified and may be wrong.

---

## MEDIUM Severity — prior audit findings

| Item | Field | Finding |
|------|-------|---------|
| Acid Vial / Strong Acid Vial | `system.useAction` | Each card has both a Maneuver pouring mode and an Action ranged-attack mode; the current field stores only one mode. |
| Rage Potion | `system.duration` | YAML uses a shortened display string for the card's “as long as you keep making attacks” duration. |

---

## LOW Severity — prior audit findings

| Item | Field | Finding |
|------|-------|---------|
| Acid Vial | `system.bands.t3` | Spacing differs (`8 + A` vs `8+ A`); no mechanical difference. |
| Healing Potion | `system.bands` | The card has a flat healing effect and no tier bands; empty bands are intentional. |

---

## PT2 additions — LOW schema note

| Item | Card fact | Source | Limitation |
|------|-----------|--------|------------|
| Smoke Bomb | Heavy concealment becomes light concealment after d6 combat rounds, then dissipates after another d6 rounds. | `IC:234-246` | `ConsumableData` has no structured concealment/effect stages; the full timing is retained in `description` and the display `duration` string. |

The Glue Pot has no unrepresented scalar field: its three RR bands map to `bands.t1/t2/t3`,
its action and non-attack range map to `useAction`/`thrown`, and its Stack 2 / 125 gc values
are transcribed from `IC:120-144`.

---

## INFO — PT2 classification and naming notes

| Item | Classification / issue |
|------|-------------------------|
| Glue Pot | Consumable: one-use area effect with an RR and three outcome bands, structurally matching Ball Bearings and Caltrops. Card name is exactly **Glue Pot** (two words); background `gluepot` remains a separate resolution mismatch. |
| Smoke Bomb | Consumable: thrown one-shot item, matching Fire Bomb. Stack 2, range 10, maneuver, 50 gc. |

---

## Usage-die notes

The 14 historical consumables have `usageDie.enabled: false`; Speed Potion's `1 UD` is a
duration, not a usage die. Glue Pot and Smoke Bomb likewise have usage dice disabled. The UD
entries for Soap and Surgical Kit belong to the gear pack, not this pack.

## Summary

The pack now has 16 source YAMLs. The two T3.4a consumables match their PT2 card names,
stack/cost/action/range/band fields. Smoke Bomb's staged concealment remains a documented
text-only limitation of the current schema; no unsupported fields were added.
