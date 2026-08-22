# Playtest 2 — Source Issues (rulebook-internal)

**Date:** 2026-08-20
**Source:** `~/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026/Crows Playtest 2 Markdown/`
**Scope:** issues found in the PT2 source itself while planning the v0.1.3 → v0.2.0 migration, *before* any PT2 YAML exists.

Citations use the book-prefix scheme from `.planning/PLAYTEST-2-MIGRATION.md`:
`R:` Rules Book · `C:` Characters Book · `F:` Ref Book · `D:` Dungeons Book.

> **How this file differs from the others here.** Every other report in this
> directory cross-validates *our YAML* against the rulebook. This one records
> places the **rulebook disagrees with itself**, which has to be settled before
> the YAML is written rather than after.

---

## HIGH Severity

### H1 — All six Discipline Mastery traits still reference the deleted "chaos count"

Playtest 1 modelled backlash risk as an accumulating, GM-secret **chaos count**. Playtest 2 replaced it with a per-cast **chaos roll** (`R:1565`–`R:1567`): on a non-doom tier 1 casting, roll 1d6; on a 1, a backlash occurs. `R:1563` is explicit that there are exactly two routes to a backlash — a doom on a casting, or the chaos roll. There is no accumulator, no threshold, and no world state.

**But the term "chaos count" appears nowhere in the Rules Book, and survives in all six Discipline Mastery traits in the Characters Book:**

| Trait | Heading | Body |
|---|---|---|
| Alteration Mastery | `C:763` | `C:765` |
| Benefaction Mastery | `C:915` | `C:917` |
| Conjuration Mastery | `C:1117` | `C:1117` (run-together line) |
| Elemental Mastery | `C:1169` | `C:1173` |
| Illusion Mastery | `C:1273` | `C:1275` |
| Necromancy Mastery | `C:1503` | `C:1507` |

All six read (discipline name varies — see **H2**):

> Non-doom tier 1 results of rank 0 and 1 *«discipline»* spells you cast **don't add to the chaos count**. Your *«discipline»* spells of rank 2 and higher are treated as 2 ranks lower when they trigger a backlash.

**Assessment:** stale PT1 phrasing for a mechanic that still exists in a new form, not a rule that was left in deliberately. The intent maps onto PT2 exactly, because a non-doom tier 1 is precisely what triggers a chaos roll:

> **Reading:** rank 0–1 spells of your discipline **don't trigger a chaos roll.**

The traits' *second* clause needs no reinterpretation — the d100 + spell-rank backlash roll is still live at `R:1559`.

**Impact:**
- **T1.8** (spellcasting/chaos/backlash) must expose a per-discipline, per-rank suppression hook on the chaos roll. The migration plan §1.5b says `chaos.mjs` should be "gutted, not migrated" with "no world state" — correct about the accumulator, but it concludes the mechanic is gone, and six traits still modify it.
- **Wave 3 trait content** — six of the 276 trait documents carry terminology that no longer resolves against any rule. Transcribing verbatim produces six traits a Ref cannot adjudicate.

**Action:** implement the reading above; ask MCDM to confirm (question 3 in the plan's MCDM list). Do **not** transcribe "chaos count" into PT2 YAML without a note.

### H2 — Elemental Mastery describes *conjuration* spells — unfixed since Playtest 1

`C:1169` is the **Elemental Mastery** heading. `C:1173` is its body:

> Non-doom tier 1 results of rank 0 and 1 **conjuration** spells you cast don't add to the chaos count. Your **conjuration** spells of rank 2 and higher are treated as 2 ranks lower when they trigger a backlash.

Verified across all six Mastery traits — five name their own discipline, Elemental is the sole mismatch:

| Trait | Body says | |
|---|---|---|
| Alteration Mastery | alteration | ✅ |
| Benefaction Mastery | benefaction | ✅ |
| Conjuration Mastery | conjuration | ✅ |
| **Elemental Mastery** | **conjuration** | ❌ |
| Illusion Mastery | illusion | ✅ |
| Necromancy Mastery | necromancy | ✅ |

**This is not new.** `SUMMARY.md` already logged it for Playtest 1 under "Canonical typo NOT preserved", against slug `elemental-t2-c2`, recommending the YAML restore MCDM's "conjuration spells" as a canonical authoring bug. **MCDM did not fix it between playtests** — the same copy-paste error is present in the PT2 packet.

**Recommendation — escalate rather than preserve.** The PT1 policy of preserving canonical typos is right for spelling ("addtioinal", "altearation"), but this one is *functional*: taken literally, Elemental Mastery grants an elementalist nothing, because it only affects a discipline they may not even use. That is a broken trait, not a typo.

Suggested handling:
- Implement as **elemental**, matching the trait's name and tree.
- Keep the source text in a `sourceNote` field so the divergence is auditable.
- Report to MCDM — it survived one playtest cycle unreported, and it is a one-word fix on their side.

---

## MEDIUM Severity

_None recorded yet for PT2._

---

## LOW Severity

### L1 — Line citations are into generated markdown, not a stable source

The four book files are produced by the OCR/build pipeline in `_work/` (`build_markdown.py`, `rebuild_formatted.py`, `ocr_deepseek.py`). Rebuilding them shifts every line number, which is exactly what invalidated the original `L####` citations in the planning docs when their concatenated master was deleted.

**Mitigation options** (not yet chosen): cite by section heading rather than line; or check the four books into the repo so the line numbers are pinned to a commit.

---

## INFO

### I1 — `power` values are sparse relative to the published scale

`F:704` states a creature's power "is scaled from 0 to 50, though future products could go even higher!" The observed range across the entire Ref Book bestiary is **1–11**. Any schema bound at 50 will reject future content; treat the ceiling as soft.

### I2 — Wound/speed sentence is ambiguous three ways

`R:524` — "For each slot occupied by a wound and an item, your speed is reduced by 1 (to a minimum of 0)" — supports three readings (every occupied slot / every wound / every slot holding both). The first is excluded because a fully-loaded, *unwounded* PC would have speed 0 (speed 5 at `C:24`, backpack 10 at `R:428`). Tracked as question 1 in the plan's MCDM list; shipping behind a system setting either way.

---

## Summary

Two HIGH findings, both in the Discipline Mastery traits and both affecting the same six documents. **H1** is a PT2 regression in terminology — the rules deleted the chaos count but the traits still name it — and it changes what `T1.8` has to build, because the plan currently assumes the mechanic is entirely gone. **H2** is a functional authoring bug that has now survived two playtest packets unreported, and is the one case in this project where the "preserve MCDM's canonical text" policy should be overridden, because preserving it ships a trait that does nothing for the character who takes it.

Neither is blocked on MCDM: both have a clear intended reading, and both should be implemented against that reading with the source text retained for audit.
