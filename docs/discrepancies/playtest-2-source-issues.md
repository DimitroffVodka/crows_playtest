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

### H3 — The Soothing Candy card still removes a "boned level", a condition PT2 deleted

Found during the **T3.0 audit, 2026-08-25**, by reading the PT2 inventory-card PDFs rather
than the books.

The changelog is unambiguous (`Changelog:119`):

> Conditions — Boned is no longer a condition and has been replaced by two conditions, weakened and vulnerable

`boned` appears **zero times** across all four PT2 books. But the Soothing Candy card in
`Inventory Cards/02 Crows Invetory Cards for Public Playtest 2.pdf` still reads:

> **Maneuver:** Consume a candy to remove 1 **boned** level from yourself.

**This is the same class of error as H1 and H2 — a deleted mechanic surviving in content
MCDM did not re-read.** The card was carried over from Playtest 1 unedited. Note that MCDM
*did* update the neighbouring poison cards for exactly this change (`Changelog:86`,
"Poison — Effects have changed as a result of the boned rules changing"), which is what
makes the omission look like an oversight rather than an intentional holdover.

**Assessment:** unlike H2, there is no single obvious reading. Boned was replaced by *two*
conditions, and the card does not say which one a candy should clear:

| Candidate reading | Argument for | Argument against |
|---|---|---|
| Removes `weakened` | Poison, the other former-boned consumable, now inflicts `weakened` — a candy that answers poison is coherent | Makes the candy a hard counter to the main poison effect |
| Removes `vulnerable` | Leaves poison's counterplay intact | Nothing else in the item set applies `vulnerable` to a PC |
| Removes either, holder's choice | Matches "1 boned level" being a single generic step | Invents a choice the card never offered |

**Action:** do **not** guess this one silently. Transcribe with the source text preserved
in a `sourceNote`, ship the `weakened` reading as the default (it is the only one with a
mechanical partner in the same product), flag it in the pack's discrepancy log, and add it
to the MCDM question list. Unlike H2 this is genuinely ambiguous, so the "implement the
obvious intent" precedent does not carry over.

**Also affected, same root cause:** `soothing-candy` is one of 9 shipped YAMLs still
referencing `boned` — see the T3.0 section of [`SUMMARY.md`](SUMMARY.md) for the full list
and the poison-vial band changes.

### ~~H4 — PT2 ships no markdown for the inventory cards, only the four books~~ — **RESOLVED 2026-08-25**

**Resolution.** All five card PDFs are extracted with `pdftotext -layout` and checked into
[`docs/source/`](../source/README.md) with page markers, a reproducible
`extract-cards.sh` (plus `--check` drift detection), and `SOURCE-PDFS.sha256` pinning the
packet they came from. Five citation prefixes are defined — `IS:`, `IC:`, `IP:`, `IL:`,
`IA:`, all beginning with `I` so they cannot collide with `R:`/`C:`/`F:`/`D:` — and are
registered in `.planning/PLAYTEST-2-MIGRATION.md` and in the Wave 3 universal preamble in
`.planning/PLAYTEST-2-EXECUTION.md`.

Unlike the four books, these **are** pinned to a commit, so `IC:368` means the same thing to
every agent and stays verifiable. **L1 still applies to the books themselves.** Original
finding below.

### H4 (original) — PT2 ships no markdown for the inventory cards, only the four books

Every per-item stat block in Playtest 2 — spell tier bands, costs, stack sizes, crafting
recipes — exists **only** in `Inventory Cards/*.pdf`. The markdown export covers the four
books plus the changelog and read-me.

This breaks an assumption baked into the Wave 3 briefs, which tell every content agent to
cite `R:`/`C:`/`F:`/`D:` line numbers. Those prefixes address book markdown, and **no card
value is in it.** An agent that validates a card against the books will either find nothing
or, worse, find a passing reference and treat it as the stat block — the "green on the happy
path, wrong on the other path" shape that Wave 1's retro identifies as this project's
recurring failure mode.

Concrete instance: **Soothing Candy is absent from all four PT2 books** but present on a
card. Markdown-only validation would conclude the item was cut from Playtest 2.

**Action:** `pdftotext -layout` extracts all five card PDFs cleanly and preserves the column
structure (this is how H3 and the whole T3.0 audit were established — the PT1 markdown's
column interleave is precisely what generated the original 8 HIGH findings). Extract once,
check the text into the repo so line citations are pinned to a commit per **L1**, and define
a card citation prefix before T3.3, T3.4 and T3.6 dispatch.

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

Four HIGH findings. **H1** and **H2** are both in the Discipline Mastery traits and both
affect the same six documents. **H1** is a PT2 regression in terminology — the rules deleted
the chaos count but the traits still name it — and it changes what `T1.8` has to build,
because the plan currently assumes the mechanic is entirely gone. **H2** is a functional
authoring bug that has now survived two playtest packets unreported, and is the one case in
this project where the "preserve MCDM's canonical text" policy should be overridden, because
preserving it ships a trait that does nothing for the character who takes it.

H1 and H2 are not blocked on MCDM: both have a clear intended reading, and both should be
implemented against that reading with the source text retained for audit.

**H3** and **H4** were added by the T3.0 audit on 2026-08-25. **H3** is the same shape as H1
— a deleted mechanic surviving in unedited content — but it is the one finding here that
should *not* be resolved by inference, because `boned` was replaced by two conditions and the
card names neither. **H4** is not a rulebook contradiction at all but a sourcing gap: PT2
publishes no markdown for the inventory cards, so the citation scheme the Wave 3 briefs
mandate cannot address any per-item stat block. H4 should be settled before Wave 3 content
agents dispatch, because it determines what they are able to validate against.
