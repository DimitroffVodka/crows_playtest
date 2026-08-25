# Cross-Validation Summary — YAMLs vs Markdown Rulebook

**Date:** 2026-05-26
**Source:** `F:/MCDM_Crows/MCDM Crows Public Playtest May-June 2026/Markdown - Output/*.md`
**Scope:** 437 YAML documents across 11 packs

> **Playtest 2 (2026-08-20):** everything below is the **Playtest 1** pass. PT2
> source issues — found in the rulebook itself, before any PT2 YAML exists — are
> tracked separately in [`playtest-2-source-issues.md`](playtest-2-source-issues.md):
> 2 HIGH, both in the Discipline Mastery traits. One of them (**Elemental Mastery
> describes *conjuration* spells**) is the same bug logged at line 49 below —
> **MCDM did not fix it between playtests**, and the PT2 recommendation reverses
> the PT1 one: implement as "elemental" rather than preserving the canonical text,
> because preserving it ships a trait that does nothing for the character who takes it.

---

## T3.0 audit — 2026-08-25 (Wave 3 entry gate)

**Verdict: all 8 PT1 HIGH findings are addressed in the YAML. 7 of 8 are still correct
under Playtest 2. One — `minor-curse` — was fixed correctly for PT1 and then invalidated
by a PT2 rules change. T3.6 and T3.7 are unblocked, with the caveats below.**

Method: every finding was re-checked against the **PT2 inventory-card PDFs** via
`pdftotext -layout`, not against the PT1 markdown. The PT1 markdown is column-interleaved
(the very defect that produced these 8 findings), so it cannot adjudicate a tier band —
this is what `8f1f311` discovered when a PDF check reversed an earlier "fix".

| # | Item | PT1 fix landed? | Still right under PT2? | Evidence |
|---|---|---|---|---|
| 1 | `bone-capture` | ✅ | ✅ | Card: `Ranged 5`, 12-16 `2+M`, 17+ `4+M` + prone. Corroborated independently by the Cultist stat block (`F:1296-1298`), whose *Knock Prone* trait fires on a tier 3 bone capture. |
| 2 | `minor-curse` | ✅ | ❌ **superseded** | Card now reads ≤11 `No effect` / 12-16 `2+M dam` / 17+ `4+M dam and weakened`. YAML still has PT1's `Boned` / `Twice Boned`. |
| 3 | `minor-healing` | ✅ | ✅ | Card: `1+M` / `2+M` / `4+M`, Benefaction Man., Melee 1. |
| 4 | `repair` | ✅ | ✅ | Card: `1+M` / `4+M` / `8+M`, Alteration Man., Melee 1, Target 1 obj. |
| 5 | `light` | ✅ | ✅ | Card: `0/5` / `5/5` / `10/10`, Illusion Man., Dur. 1 UD. |
| 6 | `rage-potion` cost | ✅ | ✅ | Card: `250 gc`. The `50` that caused the original bug is the **crafting** number (`Alchemy 2 \| 2 monster parts \| 50`) — the same trap is present in the PT2 packet. |
| 7 | `ball-bearings` bands | ✅ | ✅ | Card: `Prone and 4 dam` / `Prone` / `No effect`, 5 gc. |
| 8 | `soothing-candy` cost | ✅ **now resolved** | ✅ | **No printed gc cost on the PT2 card either.** Ref-distributed. YAML `cost: 0` + description note is correct; this finding can be closed rather than carried. |

### Finding 7's remediation advice in this file was wrong — the fix was right anyway

This document told the implementer to *"move"* the speed reduction to Ball Bearings' t1.
That would have been a new bug: `-2 speed until healed` belongs to **Caltrops**, the
adjacent card, and bleeds across in the markdown. Ball Bearings has no speed clause at
all. The applied fix dropped it entirely, which matches the PT2 card. Caltrops was
separately verified as exact (`4 dam and -2 speed until healed` / `2 dam` / `No effect`, 5 gc).

### New blocker discovered — `boned` is deleted in PT2 and 9 shipped YAMLs still use it

The changelog is explicit: *"Boned is no longer a condition and has been replaced by two
conditions, weakened and vulnerable."* `boned` appears **zero times** in all four PT2
books. Across `src/packs`, it still appears **36 times in 9 files**, while `weakened` and
`vulnerable` appear **0 times in any shipped YAML**:

| Pack | Files |
|---|---|
| crows-consumables | `poison-vial` (2), `poison-vial-strong` (2), `soothing-candy` (1) |
| crows-spellbooks | `minor-curse` (2), `corrupt` (2) |
| crows-traits | `bashing-t3-c3` (1), `necromancy-t2-c1` (2), `necromancy-t3-c2` (1) |
| crows-rules | `conditions` (23) |

The changelog separately flags **Poison** as changed *"as a result of the boned rules
changing"*. Confirmed on the PT2 card — Poison Vial is now ≤11 `5 P dam and weakened` /
12-16 `5 P dam` / 17+ `No effect`, and Strong Poison `10 P dam and weakened` / `10 P dam` /
`No effect`. Both YAMLs still carry `Twice Boned` / `Boned` / `Thrice Boned`.

This is **not** a regression in the 8 findings — it is PT2 content debt that T3.2, T3.4,
T3.6 and T3.7 each own a slice of. It is recorded here because T3.0 is the gate that was
supposed to catch it.

### Pipeline gap — PT2 card data exists only as PDF

Wave 3 briefs assume a markdown source per the universal preamble, but the PT2 packet ships
markdown for the **four books only**. Every per-item stat block — spell tier bands, item
costs, stack sizes — lives exclusively in `Inventory Cards/*.pdf`. Two consequences:

- Any Wave 3 agent citing `R:`/`C:`/`F:`/`D:` line numbers for a **card** value is citing a
  source that does not contain it. Cards need their own citation scheme.
- `Soothing Candy` is absent from all four PT2 books yet present on a card — an agent
  validating against markdown alone would wrongly conclude it was cut.

**Closed 2026-08-25.** All five card PDFs are now extracted and pinned in
[`../source/`](../source/README.md) with prefixes `IS:`, `IC:`, `IP:`, `IL:`, `IA:`
(`IC:` is the main deck), a reproducible `extract-cards.sh --check`, and page markers.
The findings above are re-citable against it:

| Item | Citation |
| --- | --- |
| Bone Capture | `IC:368-377` |
| Minor Curse | `IC:368-385` |
| Repair | `IC:294-309` |
| Minor Healing | `IC:311-325` |
| Light | `IC:352-362` |
| Rage Potion | `IC:216-234` |
| Ball Bearings | `IC:53-72` · Caltrops `IC:69-87` |
| Soothing Candy | `IC:249-260` |
| Poison Vial / Strong Poison | `IC:216-228` |

---

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

~~Apply the 8 HIGH + selected MEDIUM fixes (a short batch of YAML edits), rebuild affected packs, live-verify. Hold off on the LOW typo-restoration question until you decide policy (preserve canonical typos vs. silently fix). Soothing Candy needs the original PDF or game doc to resolve the cost cutoff.~~

**Superseded by the T3.0 audit above (2026-08-25).** The 8 HIGH fixes were applied in
`6081248` and one was corrected in `8f1f311`; all 8 are verified landed. Soothing Candy's
cost is resolved — there is no printed cost on either playtest's card. The LOW
typo-restoration policy question is still open and still deliberately deferred.

The live remaining work is **PT2 content debt**, not PT1 defect repair:

1. Re-transcribe the 9 `boned` YAMLs against PT2 (`minor-curse`, `corrupt`, both poison
   vials, `soothing-candy`, 3 traits, and the `conditions` journal).
2. Extract the five PT2 card PDFs to checked-in text and give cards a citation scheme
   before T3.3/T3.4/T3.6 dispatch.
