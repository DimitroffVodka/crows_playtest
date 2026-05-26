# Cross-Validation: crows-loot pack vs. Markdown source
**Source:** `06_MCDM_Crows_Dungeon_Loot_Cards_for_May_June_2026_Playtest.md`
**Pack:** `src/packs/crows-loot/*.yaml` (6 items)
**Date:** 2026-05-26

---

## HIGH Severity

_No HIGH discrepancies found._
(cost, slots, udMax all match.)

---

## MEDIUM Severity

| # | Item | Field | YAML value | MD / expected value | Notes |
|---|------|-------|-----------|---------------------|-------|
| M1 | Boom Wand | `usageDie.expiry` | `activate` | `useless` | Card: "(Useless; Activate)". First token = state-at-depletion = `useless`. YAML maps the trigger ("Activate") to `expiry` instead. Should be `expiry: useless`. |
| M2 | Minor Telekinesis Ring | `usageDie.expiry` | `activate` | `rest` | Card: "(Rest; Activate)". First token = refuel-on-rest = `rest`. YAML maps the trigger ("Activate") to `expiry`. Should be `expiry: rest`. |
| M3 | Minor Telekinesis Ring | `usageDie.refuelWith` | `rest` | `""` | `rest` is a valid `expiry` enum value (rest-refuel), not a refuel item. `refuelWith` should be blank; the rest-refuel is expressed via `expiry: rest`. This is the known refuelWith/expiry inversion. |

---

## LOW Severity

| # | Item | Field | YAML value | MD / expected value | Notes |
|---|------|-------|-----------|---------------------|-------|
| L1 | Blood Concoction | `description` | Ends with "Unique item from the Ring Collector encounter." | Not present in MD source | Added flavor not in the playtest PDF. Harmless but unverified by source. |

---

## INFO

| # | Item | Note |
|---|------|------|
| I1 | Magic Wand | No cost in MD (mystery item). YAML `cost: 0` — correct placeholder. |
| I2 | Magic Ring | No cost in MD (mystery item). YAML `cost: 0` — correct placeholder. |
| I3 | Potion | No cost in MD (mystery item). YAML `cost: 0` — correct placeholder. |
| I4 | Blood Concoction | "Unique Item" label in MD; YAML `cost: 0`. No sell-price in source — acceptable. |
| I5 | All 6 items | All present in both YAML pack and MD source. No missing items either side. |

---

## Summary

**Counts:** 0 HIGH · 3 MEDIUM · 1 LOW · 5 INFO

**Critical fix (M1 + M2 + M3 — all three are one conceptual bug):**

The `(Expiry; Trigger)` card notation was misread when the YAMLs were authored. The schema's `expiry` field encodes *what happens at depletion* (`useless`, `rest`, `refuel`, `dt`), while the trigger (activate) is implicit/separate. The author instead put the *trigger* in `expiry` and tried to use `refuelWith` to carry the depletion behavior.

Correct mapping:
- **Boom Wand** `(Useless; Activate)` → `expiry: useless`, `refuelWith: ""`
- **Minor Telekinesis Ring** `(Rest; Activate)` → `expiry: rest`, `refuelWith: ""`

Current YAML has both items with `expiry: activate`, and the ring has `refuelWith: rest` (backwards). This is the "refuelWith/expiry inversion" called out in the task brief.

No cost, slots, or udMax errors were found. Mystery/identified flags are correct on all three mystery items (Magic Wand, Magic Ring, Potion). Subtypes (wand, ring, utility) are consistent with `CROWS.gearSubtypes` enum.
