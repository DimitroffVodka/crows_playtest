# Spellbook YAML Cross-Validation Report

**Generated:** 2026-05-26  
**Scope:** 25 spellbook YAMLs vs canonical markdown sources  
**Sources:**
- PRIMARY R0: `MCDM_Crows_Annotated_Inventory_Cards_for_May_June_2026_Playtest.md`
- CROSSCHECK R0: `05_MCDM_Crows_Inventory_Cards_for_May_June_2026_Playtest.md`
- PRIMARY R1: `06_MCDM_Crows_Dungeon_Loot_Cards_for_May_June_2026_Playtest.md`

---

## Summary

| Severity | Count |
|----------|-------|
| HIGH     | 5     |
| MEDIUM   | 3     |
| LOW      | 5     |
| INFO     | 1     |
| **TOTAL**| **14**|

**Headline findings:**
- `bone-capture` and `minor-curse` have their tier effects **swapped** — game-breaking for both spells.
- `minor-healing` has wrong values at all three tiers (agent-flagged suspicion confirmed: layout scramble during extraction).
- `repair` is missing its correct tier progression; all three tiers are wrong.
- `light` uses an M-scaled formula that does not match the fixed `bright/dim` values on the card.

---

## HIGH Severity

| Spell | Field | YAML Value | MD Canonical | Evidence |
|-------|-------|-----------|--------------|----------|
| `bone-capture` | `effectBands.t1` | `"No effect"` | *(empty — attack spell, no ≤11 band)* | Annotated MD line 284 col28-44: attack spell, tier row starts at 12-16 |
| `bone-capture` | `effectBands.t2` | `"Boned"` | `"2+M damage"` | Annotated MD line 284 col32: `2+M`; col38: `Target 1 creat.`; col40: `17+` |
| `bone-capture` | `effectBands.t3` | `"Boned Twice"` | `"4+M damage, prone"` | Annotated MD line 284 col42-44: `4+M / prone` |
| `minor-curse` | `effectBands.t1` | `"No effect"` | `"No effect"` ✓ | Matches — col55-57 |
| `minor-curse` | `effectBands.t2` | `"Prone"` | `"Boned"` | Annotated MD line 284 col59: `Boned` |
| `minor-curse` | `effectBands.t3` | `"2+M damage; prone"` | `"Twice Boned"` | Annotated MD line 284 col61-63: `Twice Boned` |
| `minor-healing` | `effectBands.t1` | `"No effect"` | `"1+M Stamina regained"` | Annotated MD line 236 col: `1+M` under ≤11 header |
| `minor-healing` | `effectBands.t2` | `"1+M Stamina regained"` | `"2+M Stamina regained"` | Annotated MD line 236: `2+M` under 12-16 header |
| `minor-healing` | `effectBands.t3` | `"2+M Stamina regained"` | `"4+M Stamina regained"` | Annotated MD line 236: `4+M` under 17+ header |
| `repair` | `effectBands.t1` | `"No effect"` | `"1+M Stamina regained"` | Annotated MD line 239: `1+M` under ≤11 (Repair column) |
| `repair` | `effectBands.t2` | `"1+M Stamina regained"` | `"4+M Stamina regained"` | Annotated MD line 239: `4+M` under 12-16 |
| `repair` | `effectBands.t3` | `"4+M Stamina regained"` | `"8+M Stamina regained"` | Annotated MD line 239: `8+M` under 17+ |
| `light` | `effectBands.t1` | `""` (empty) | `"0 bright / 5 dim squares"` | Annotated MD line 285 col1-5: `0/5 \| 5/5 \| 10/10` |
| `light` | `effectBands.t2` | `"2+M radius (dim)"` | `"5 bright / 5 dim squares"` | MD shows fixed paired values, not M-scaled formula |
| `light` | `effectBands.t3` | `"4+M radius (bright)"` | `"10 bright / 10 dim squares"` | MD card shows fixed `10/10`; YAML formula does not match |

**Notes on HIGH items:**

**bone-capture / minor-curse swap:** The two spells' tier bands are entirely swapped relative to MD. `bone-capture` is a Necromancy Attack spell — its MD tiers are damage values (`2+M`, `4+M + prone`), matching a damage-dealing attack. `minor-curse` is a Necromancy Action spell — its MD tiers apply the `Boned` condition. Whoever entered the data placed each spell's effect in the other spell's YAML.

**minor-healing (agent-flagged):** Confirmed layout scramble. The annotated MD table places Minor Healing adjacent to Minor Blessing and Minor Ward in a multi-column row. YAML picked up `No effect / 1+M / 2+M` (which are Minor Healing ≤11=1+M → shifted down by one tier, plus minor-ward's ≤11 `No effect` in t1). Correct values: `≤11=1+M`, `12-16=2+M`, `17+=4+M`.

**light:** YAML was encoded as an M-based formula (2+M dim, 4+M bright) matching how other spells scale. MD card shows fixed paired values `0/5`, `5/5`, `10/10` (bright_squares/dim_squares format). The formulaic interpretation does not align with the published card values. Recommend verifying with design intent — if the card values are final, all three bands need replacing.

---

## MEDIUM Severity

| Spell | Field | YAML Value | MD Canonical | Notes |
|-------|-------|-----------|--------------|-------|
| `stream` | `system.aoe.size` | `"L 5 x W 1"` | `"5 x 1"` (compact) | Same dimensions, different notation. YAML verbose form. Not a functional error — confirm preferred format. |
| `monster-sense` | `system.aoe.size` | `"1"` (static) | Not stated as aoe; detection range is tier-based (1/5/10 via casting) | YAML encodes a static aoe.size of 1. The dynamic range is represented in effectBands t1/t2/t3. The `aoeSize="1"` is either the ≤11 radius (which is redundant with t1) or a mismodel. Recommend clarification. |
| `jaunt` | `effectBands` | `t1="No effect"; t2="5+M squares"; t3="10+M squares"` | ≤11=No effect; 12-16=5+M; 17+=10+M | **MATCHES** — flagged previously was a false alarm. Verified from annotated MD lines 253-254. No discrepancy. Listed MED for traceability only. |

---

## LOW Severity

*(Prose verbosity differences only — same mechanical meaning)*

| Spell | Field | YAML | MD | Notes |
|-------|-------|------|----|-------|
| `cacophony` | `t2`, `t3` | `"Heard up to 5+M squares away"` / `"10+M..."` | `"5+M"` / `"10+M"` | YAML expands compact card label. |
| `animal-form` | `t1`, `t2`, `t3` | `"Tier 0/2/4 animal form"` | `"0"` / `"2"` / `"4"` | YAML adds "Tier N animal form" label around the number. |
| `deadspeech` | `t1`, `t2`, `t3` | `"Target answers 1/3/5 questions honestly"` | `"1"` / `"3"` / `"5"` | YAML expands question-count into sentence. |
| `shrink` | `t1`, `t2`, `t3` | `"Reduced 0 categories / weapon attack damage +0/+0"` etc. | `"0/0"` / `"1/-2"` / `"2/-4"` | Same values; YAML verbose, MD compact. |
| `stubborn-object` | `t1`, `t2`, `t3` | `"Fixed; immovable by Strength 2/3/4 or higher"` | `"2"` / `"3"` / `"4"` | YAML expands Strength threshold into sentence. |

---

## INFO

| Spell | Field | Notes |
|-------|-------|-------|
| `jaunt` | `effectBands` (verification) | Agent-flagged as unverifiable. Now verified: **no discrepancy**. See MED row above. |

---

## Spells with No Discrepancies (all fields match)

The following 16 spells had no HIGH, MED, or LOW discrepancies beyond those listed above:

`animal-form` (LOW only), `bone-capture`* (HIGH), `cacophony` (LOW only), `corrupt` ✓, `create-water` ✓, `deadspeech` (LOW only), `fire-hands` ✓, `fire-lance` ✓, `jaunt` ✓, `light`* (HIGH), `minor-blessing` ✓, `minor-curse`* (HIGH), `minor-healing`* (HIGH), `minor-phantasm` ✓, `minor-ward` ✓, `monster-sense` (MED only), `repair`* (HIGH), `shrink` (LOW only), `spark` ✓, `stream` (MED only), `stubborn-object` (LOW only), `summon-object` ✓, `take-shape` ✓, `teleport-object` ✓, `thunder` ✓

*(asterisk = has HIGH severity item)*

**Clean spells (no issues at any severity):** `corrupt`, `create-water`, `fire-hands`, `fire-lance`, `jaunt`, `minor-blessing`, `minor-phantasm`, `minor-ward`, `spark`, `summon-object`, `take-shape`, `teleport-object`, `thunder` (13 of 25).

---

## Special Checks (Agent-Flagged)

### minor-healing
**Verdict: CONFIRMED discrepancy.** All three tier values are wrong due to column bleed during PDF-to-markdown extraction. The annotated MD table places Minor Healing next to Minor Blessing and Minor Ward, and the ≤11 tier row for Minor Healing (`1+M Stamina`) was shifted to t2, with `No effect` (from an adjacent column) landing in t1. Correct YAML values:
- `t1: "1+M Stamina regained"`
- `t2: "2+M Stamina regained"`
- `t3: "4+M Stamina regained"`

### minor-curse
**Verdict: CONFIRMED discrepancy — and it pairs with bone-capture.** The tier effects for `minor-curse` and `bone-capture` are swapped in the YAMLs. Minor Curse (Necromancy **Action**) applies the `Boned` condition; it is not a damage spell. Bone Capture (Necromancy **Attack**) deals `2+M` or `4+M` damage (with prone at t3). Both spells are mechanically wrong as entered.
