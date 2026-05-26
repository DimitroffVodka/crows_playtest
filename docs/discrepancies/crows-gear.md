# Gear Pack Cross-Validation Report

**Generated:** 2026-05-26  
**Source:** `src/packs/crows-gear/*.yaml` (43 files)  
**Primary ref:** `MCDM_Crows_Annotated_Inventory_Cards_for_May_June_2026_Playtest.md`  
**Cross-check:** `05_MCDM_Crows_Inventory_Cards_for_May_June_2026_Playtest.md`  
**Fields checked:** name, subtype, slots, stackMax, cost, weightless, light.{enabled,bright,dim}, usageDie.{enabled,udMax,expiry,refuelWith}, treasure.{size,value}

---

## HIGH Severity

_(none)_

---

## MEDIUM Severity

_(none)_

---

## LOW Severity

_(none)_

---

## INFO

| # | Item | Issue |
|---|------|-------|
| 1 | Ball Bearings | Present in MD (Stack 2, 5 gc) — not in `crows-gear` pack (correctly moved to consumables). |
| 2 | Caltrops | Present in MD (Stack 2, 5 gc) — not in `crows-gear` pack (correctly moved to consumables). |
| 3 | Alteration Stone | No price listed on the MD card; YAML has `cost: 0`. Consistent — item has no market price. |
| 4 | Gem | No price listed on MD card ("value determined by Ref"); YAML has `cost: 0`. Consistent. |
| 5 | Art Object, Tiny/Small/Medium | No prices on MD cards ("value determined by Ref"); YAML has `cost: 0`. Consistent. |
| 6 | Crafting Material, Tiny/Small/Medium/Large | No prices on MD cards ("determined by Ref"); YAML has `cost: 0`. Consistent. |
| 7 | Healing Potion / Soothing Candy / Fire Bomb / Rage Potion / Poison Vials / Rations / Speed Potion | Present in MD gear-card pages — not in `crows-gear` pack (consumables, expected). |

---

## Summary

**43 YAML files checked. 0 discrepancies found.**

All 43 gear items in `src/packs/crows-gear/` match the canonical markdown across:
- cost (gc)
- slots (including 2-slot items: Ladder, Ten-Foot Pole, Tent, Art Object Medium, Crafting Material Medium/Large)
- stackMax
- subtype (tool/utility/light/treasure)
- light.enabled / light.bright / light.dim (Lantern 10/10, Torch 5/5)
- usageDie.udMax (Lantern 2, Torch 1)
- usageDie.expiry (Lantern `refuel`, Torch `useless`)
- usageDie.refuelWith (Lantern `oil flask`)
- treasure.size (tiny/small/medium/large for gems, art objects, crafting materials)
- weightless (all false)

**Items in MD not in pack:** Ball Bearings, Caltrops — correctly absent (now consumables).

**Notable UD notes verified:**
- Torch: `UD:1 (Useless; DT)` in MD → YAML `expiry: useless`, `udMax: 1` ✓ ("Useless" = expiry type, "DT" = roll timing, not a separate YAML field)
- Lantern: `UD:2 (Refuel w oil; DT)` in MD → YAML `expiry: refuel`, `refuelWith: oil flask`, `udMax: 2` ✓
