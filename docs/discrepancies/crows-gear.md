# Gear Pack Cross-Validation Report

**Generated:** 2026-08-25
**Source:** `src/packs/crows-gear/*.yaml` (52 files)
**Primary PT2 ref:** `docs/source/IC-inventory-cards.txt` (`IC:` citations)
**Additional PT2 ref:** `docs/source/IL-cards-pois-dungeons.txt` (`IL:` lore-book cards)
**Scope:** the 43 previously shipped gear cards plus the T3.4a PT2 additions/revision.

The older May–June audit is retained in the INFO notes below. PT2 card text is authoritative
for the new items; the card grid must be read down each item's column, never across a row.

---

## HIGH Severity

_(none)_

---

## MEDIUM Severity

| Item | Field | Card/source | Finding and shipped handling |
|------|-------|-------------|-----------------------------|
| 11-Foot Pole | `name` / source identity | `IC:456-465` | PT2 renamed the existing Ten-Foot Pole and added the fishing-rod sentence. The YAML file is renamed, but `_id: crowsgear0tenfpo` and `_key` are preserved so the existing identity is not duplicated or orphaned. |
| Lore Book (Monster/Magic/Nature/Historical Lore) | printed name vs lookup name | `IL:40-56` | Every card prints plain `Lore Book`, but name-based creation lookup needs deterministic specialization. Four distinct names are deliberate and resolve the six background strings; the divergence is not a card transcription error. |
| Lore Book (Monster/Magic/Nature/Historical Lore) | expertise selector | `IL:40-51` | The card's expertise is only retained in the description because `GearData` has no expertise field. Adding an unknown YAML key would be silently dropped. A schema/mechanic follow-up must make this queryable for the rest activity and Quick Reference trait. |

---

## LOW Severity — card facts with no structured field

These facts are preserved in the item description. No new schema fields were invented.

| Item | Card fact | Source | Limitation |
|------|-----------|--------|------------|
| Bear Trap | The trap has 10 Stamina. | `IC:53-67` | `GearData` has no durability/Stamina field; it is prose-only. |
| Net | The net has 5 Stamina. | `IC:194-213` | `GearData` has no durability/Stamina field; it is prose-only. |
| Shovel | It “might break.” | `IC:234-246` | There is no breakage/durability field; the warning is prose-only. |
| Musical Instrument | Playing it occupies both hand slots. | `IC:175-192` | The item model has no two-hand occupancy flag; the rule is prose-only. |

---

## INFO

| # | Item | Issue |
|---|------|-------|
| 1 | Ball Bearings | Present in the card deck (Stack 2, 5 gc) — not in `crows-gear` (correctly a consumable). |
| 2 | Caltrops | Present in the card deck (Stack 2, 5 gc) — not in `crows-gear` (correctly a consumable). |
| 3 | Quiver of Arrows | The ammunition pack already contains `Quiver of 20 Arrows`; this is a naming mismatch, not missing content. No duplicate was created. |
| 4 | Extra Knife | `Knife` already exists in `crows-weapons` and is in the universal starting kit; “extra” is a quantity modifier, not a new item. No duplicate was created. |
| 5 | Musical Instrument | `src/packs/crows-gear/musical-instrument.yaml` already matched the generic `IC:175` card. The background's `(lute)` is a flavor example, not a parameter; no `Musical Instrument (Lute)` variant was created. |
| 6 | Quill & Inkpot | The cards use `&`; background strings use `quill and inkpot` / `quill and ink pot`. The exact card name is retained; resolution remains a separate issue. |
| 7 | Alteration Stone | No price listed on the card; YAML `cost: 0` is intentional. |
| 8 | Gem | Value is determined by the Ref; YAML `cost: 0` is intentional. |
| 9 | Art Objects and Crafting Materials | Value is determined by the Ref; YAML `cost: 0` is intentional. |
| 10 | Consumable cards | Healing Potion, Soothing Candy, Fire Bomb, Rage Potion, Poison Vials, Rations, Speed Potion, Glue Pot, and Smoke Bomb are in `crows-consumables`, not this pack. |

---

## PT2 gear transcriptions

| Item | Classification | Card facts transcribed |
|------|----------------|------------------------|
| Bear Trap | gear — durable, reusable trap with its own Stamina | `IC:53-67`; Stack 1, 1 slot, 250 gc |
| Net | gear — reusable tool; the net is not expended by the Grab maneuver | `IC:194-213`; Stack 1, 1 slot, 5 gc |
| Quill & Inkpot | gear — durable writing tool | `IC:216-232`; Stack 5, 1 slot, 5 gc; `&` retained in the name |
| Shovel | gear — durable tool | `IC:234-246`; Stack 1, 1 slot, 10 gc |
| Soap | gear — utility item with UD 1 (Useless; Activate) | `IC:249-264`; Stack 3, 1 slot, 1 gc |
| Surgical Kit | gear — durable tool with UD 1 (Useless; Activate) | `IC:249-264`; Stack 1, 1 slot, 100 gc |
| Lore Book (Monster Lore) | gear — named specialization | `IL:40-56`; Stack 1, 1 slot, 50 gc; existing id preserved |
| Lore Book (Magic Lore) | gear — named specialization | `IL:40-56`; Stack 1, 1 slot, 50 gc |
| Lore Book (Nature Lore) | gear — named specialization | `IL:40-56`; Stack 1, 1 slot, 50 gc |
| Lore Book (Historical Lore) | gear — named specialization | `IL:40-56`; Stack 1, 1 slot, 50 gc |
| 11-Foot Pole | gear — durable utility; revision of the existing pole id | `IC:456-465`; Stack 1, occupies 2 slots, 5 gc |

The generic `Musical Instrument` is an existing gear item, not a new YAML in this slice.

---

## Usage-die notes

- Soap and Surgical Kit map `UD: 1 (Useless; Activate)` to `usageDie.enabled: true`,
  `udMax: 1`, `udCurrent: 1`, `expiry: useless`, and blank `refuelWith`.
- “Useless” is the depletion state; “Activate” is the trigger and is not a separate
  schema field, matching the existing Torch/Lantern convention.

## Summary

The pack now has 52 source YAMLs. The new scalar fields (name, stack, slots, cost, subtype,
and usage-die values) match the PT2 cards cited above. The remaining discrepancies are the
intentional lore-book naming/schema decision, the preserved pole identity during the PT2
rename, and the LOW-severity card facts that the current data model can only show in prose.
