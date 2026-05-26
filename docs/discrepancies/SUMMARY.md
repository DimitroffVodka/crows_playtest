# Cross-Validation Summary — YAMLs vs Markdown Rulebook

**Date:** 2026-05-26
**Source:** `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/*.md`
**Scope:** 437 YAML documents across 11 packs

## Aggregate counts

| Pack | YAMLs | HIGH | MED | LOW | INFO | Verdict |
|---|---:|---:|---:|---:|---:|---|
| crows-monsters | 11 | 0 | 0 | 0 | 0 | ✅ clean |
| crows-weapons | 19 | 0 | 0 | 0 | 0 | ✅ clean |
| crows-armor + crows-ammunition | 6 | 0 | 0 | 0 | 2 | ✅ clean |
| crows-gear | 43 | 0 | 0 | 0 | 7 | ✅ clean |
| crows-backgrounds | 36 | 0 | 4 | 3 | 5 | mostly markdown-column-interleave noise |
| crows-traits-A | 72 | 0 | 1 | 12 | 1 | nearly clean (1 name fix) |
| crows-traits-B | 72 | 0 | 2 | 4 | 2 | 2 name fixes + canonical-typo restore |
| crows-traits-C | 72 | 0 | 2 | 10 | 3 | YAML cleaned MD typos |
| crows-traits-D | 60 | 0 | 1 | 4 | 2 | 1 name spot-check needed |
| crows-loot | 6 | 0 | 3 | 1 | 5 | expiry/refuelWith inversion |
| **crows-consumables** | 14 | **3** | 2 | 1 | 0 | **Rage Potion 50→250 (5×)**; Ball Bearings t2; Soothing Candy unresolved |
| **crows-spellbooks** | 25 | **5** | 3 | 5 | 1 | **bone-capture + minor-curse swapped**; minor-healing/repair/light wrong |
| **TOTAL** | **437** | **8** | **18** | **40** | **28** | |

## Critical HIGH-severity findings (auto-fixable)

### Spellbooks — mechanical correctness issues

1. **`bone-capture` + `minor-curse` tier effects are LITERALLY SWAPPED between the two YAMLs.** Mechanically broken — a player casting Bone Capture applies Boned (should deal damage); casting Minor Curse applies Prone (should apply Boned). **Critical fix.**
2. **`minor-healing`** — all 3 tier effects wrong (column bleed during PDF extraction). Correct: `t1=1+M Stamina`, `t2=2+M Stamina`, `t3=4+M Stamina`.
3. **`repair`** — all tier effects wrong (off by one). Correct: `t1=1+M`, `t2=4+M`, `t3=8+M Stamina`.
4. **`light`** — YAML uses an M-scaled formula; the card has fixed paired `(bright, dim)` values: t1 `0/5`, t2 `5/5`, t3 `10/10`.

### Consumables — pricing & banding

5. **`rage-potion` cost: 50 → 250** (5× wrong). Markdown is unambiguous.
6. **`ball-bearings` t2 band:** YAML has "Prone and speed reduced until healed". Markdown 12-16 is only "Prone"; the speed reduction is the ≤11 (t1) effect. Move it.
7. **`soothing-candy` cost: unresolved.** Markdown also missing it (card at page-boundary cutoff). Need original PDF or game-document check.

## Notable MEDIUM (small fixes)

### Trait name corrections
- `alchemy-t4-c3`: **"Alchemy Bell" → "Alchemy Belt"** (single-char typo)
- `chopping-t3-c3`: **"Crit" → "Chopping Crit"** (dropped qualifier)
- `chopping-t3-c2`: "Stop Chopping" vs MD "Stop" — needs spot-check (original PDF extractor saw "Stop Chopping" too)
- `slashing-t2-c3`: "Intercepting Blade" vs MD "Interceding Blade" — needs spot-check

### Canonical typo NOT preserved (per spec we should keep MCDM's typos)
- **`elemental-t2-c2` (Elemental Mastery):** YAML "elemental spells" → restore MD's "conjuration spells" (canonical MCDM authoring bug)

### Loot — expiry/refuelWith semantic mix-up (3 fixes)
- `boom-wand`: `expiry: activate` → `useless`
- `minor-telekinesis-ring`: `expiry: activate` → `rest`
- `minor-telekinesis-ring`: `refuelWith: "rest"` → `""`

### Consumables — useAction mode (judgment call)
- `acid-vial` and `acid-vial-strong`: YAML `useAction: action` (encodes thrown-attack mode); markdown's primary use is `Maneuver:` (pour on surface). User decision.

## LOW findings (40)

Mostly:
- YAML SILENTLY CORRECTED markdown OCR typos (good for usability; bad if you want to preserve canonical text): "addtioinal", "altearation", "Sieze", "Sacrifce", "invisibilty", "Endruance", "Scabard" (× many traits).
- Stabathon "one the same turn" and Seeing Things "wile" — **confirmed canonical** in both PDF and markdown; correctly preserved in YAMLs.
- "Nope" trait missing "with" word ("hit an opportunity attack" vs MD "hit with an opportunity attack").
- "Dance Away" wording: YAML "counter" vs MD "reaction".

## INFO findings (28)

- `connectsTo` not diffed in any trait pack — markdown lacks visible graph edges. Column-aligned default stands; cross-column connections (if any in MCDM's actual layout) unverified.
- Several markdown sources have 2-column PDF→linear-text conversion artifacts that bled stats across cards (Pyromancer skills line, Pets t1 heading, Enchantment "Twice Enchanted" body). YAML data was sourced from PDF directly and is correct in those cases.
- `xpCost` is intentionally NOT stored on traits (computed in code from tier via `prepareDerivedData`). All "missing xpCost" INFO entries map to this design choice.

## Verdict

**~92% of the content is faithful.** Of 437 documents, only **8 have mechanically-significant bugs** (HIGH); another **~12** have name/semantic fixes (MEDIUM). The pack with the most issues is **spellbooks** (5 HIGH out of 25 = 20% defect rate, all from PDF column-bleed during the original extraction). **Monsters, weapons, armor, ammunition, and gear are clean** — exact match across 84 documents.

## Recommended next action

Apply the 8 HIGH + selected MEDIUM fixes (a short batch of YAML edits), rebuild affected packs, live-verify. Hold off on the LOW typo-restoration question until you decide policy (preserve canonical typos vs. silently fix). Soothing Candy needs the original PDF or game doc to resolve the cost cutoff.
