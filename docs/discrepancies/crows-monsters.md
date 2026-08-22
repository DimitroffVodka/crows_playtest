# Crows Monsters Cross-Validation Report

**Source:** `03_MCDM_Crows_Monsters_Booklet_May_June_2026_Playtest.md`  
**YAMLs:** `src/packs/crows-monsters/*.yaml` (11 files)  
**Date:** 2026-05-26  
**Scope:** name, power, size, creatureType, stamina (value+max), speed (value+modes),
characteristics (agility/mind/strength), ad, slots, attacks (toHit/range/targets/dmgT2/dmgT3),
colloquialNames

---

## HIGH Severity

*Stamina mismatch, characteristic mismatch, power mismatch, attack damage/toHit mismatch, slots mismatch, AD mismatch.*

| Monster | Field | MD Value | YAML Value |
|---------|-------|----------|------------|
| — | — | — | — |

**No HIGH discrepancies found.**

---

## MEDIUM Severity

*Size, creatureType, range format, attack targets, speed modes.*

| Monster | Field | MD Value | YAML Value |
|---------|-------|----------|------------|
| — | — | — | — |

**No MEDIUM discrepancies found.**

---

## LOW Severity

*Trait effect text variation, name capitalization, colloquialNames ordering.*

| Monster | Field | Notes |
|---------|-------|-------|
| — | — | — |

**No LOW discrepancies found.**

---

## INFO

*Missing monsters either side.*

| Direction | Monster |
|-----------|---------|
| — | — |

**No missing monsters. All 11 YAML files match the 11 stat blocks in the markdown.**

---

## Monster Coverage

| Monster | YAML File | MD Present | Clean |
|---------|-----------|------------|-------|
| Bear | bear.yaml | Yes | Yes |
| Cat (Pet) | cat.yaml | Yes | Yes |
| Dog (Pet) | dog.yaml | Yes | Yes |
| Goat (Pet) | goat.yaml | Yes | Yes |
| Horse (Pet) | horse.yaml | Yes | Yes |
| Rat | rat.yaml | Yes | Yes |
| Wolf | wolf.yaml | Yes | Yes |
| Blood Creature A | blood-creature-a.yaml | Yes | Yes |
| Blood Creature B | blood-creature-b.yaml | Yes | Yes |
| Blood Creature C | blood-creature-c.yaml | Yes | Yes |
| Ring Collector | ring-collector.yaml | Yes | Yes |

---

## Summary

**All 11 monsters pass cross-validation.**

- HIGH: 0
- MEDIUM: 0
- LOW: 0
- INFO: 0

Every checked field matches between the markdown source and the YAML data model:
power, stamina value and max, speed value and modes (including climb modes on Rat,
Blood Creature A, B, C), all three characteristics (agility/mind/strength), ad, slots
(pets: Cat=1, Dog=1, Goat=2, Horse=10; wild/monsters=0), attack toHit/range/targets/dmgT2/dmgT3,
and colloquialNames.

The one field not diffable from the markdown tables is trait `effect` prose (the markdown
layout fragments text across cells). Semantic accuracy of trait descriptions was verified
by manual spot-check; no mismatches observed.
