# Rules Book — Backlashes Table Errata

**Date:** 2026-08-22
**Logged by:** T1.8 (spellcasting, chaos, backlash)
**Scope:** the 55-row Backlashes table at `R:1573`–`R:1659`, transcribed into
`module/helpers/backlash.mjs` as `BACKLASH_TABLE`.

Citations use the book-prefix scheme from `.planning/PLAYTEST-2-MIGRATION.md`:
`R:` Rules Book · `C:` Characters Book · `F:` Ref Book · `D:` Dungeons Book.

> **Policy.** Every row is transcribed **verbatim**. Where the source is wrong
> or unusable, the printed text stays in `text`, the printed range stays in
> `sourceRange`, and the divergence is recorded in `sourceNote` on the row
> **and** here. Nothing is silently corrected. The two HIGH items below both
> have an interpretation applied in code, because the table cannot be used at
> all without one; both are one-word fixes on MCDM's side.

---

## HIGH Severity

### R1 — Row "62-64" overlaps row "61-62"

`R:1622`–`R:1631`. The table runs in pairs — `01-02`, `03-04`, … `61-62` —
and then prints the quicksand row as **`62-64`**, a three-wide range whose
first value is already taken by the row directly above it.

| | |
|---|---|
| Printed | `61-62` hands-become-feet · `62-64` quicksand |
| Consequence | **62 belongs to two rows** and **63 belongs to none** |
| Every other row | exactly two values wide (`01-02` … `99-100`), then singles at `101`–`105` |

**Reading applied:** `63-64`. It is the only reading that keeps the table
total — every value from 1 to 105 resolving to exactly one row — and it
preserves the two-wide pairing that holds for all 50 pair rows. The
alternative (61 alone, 62-64 as printed) would make the table the only place
in the book where a d100 row is three wide, and would leave `61-62`'s printed
range wrong instead.

**In code:** `{ lo: 63, hi: 64, sourceRange: "62-64", sourceNote: "…" }`.
`test/spellcasting.test.mjs` pins both halves — that 62 still resolves to the
`61-62` row, and that the quicksand row keeps `"62-64"` as its printed range.

**Ask MCDM:** confirm 63-64.

### R2 — Row `51-52` calls for a "Might RR"

`R:1601`. The demonic-bees row: *"You and each creature within 3 squares of you
must make a **Might RR**."*

**There is no Might in this game.** The characteristics are Agility, Mind and
Strength (`R:174`, and `CROWS.characteristics` in `module/config.mjs`). "Might"
appears nowhere else in any of the four books.

**Reading:** almost certainly **Strength** — it is the physical-resilience
characteristic, and the parallel rows use the obvious body characteristic for
the effect (`55-56` falling dirt calls for an Agility RR, `62-64` quicksand
likewise).

**Not applied in code.** Unlike R1, the table is usable without resolving this:
`BACKLASH_TABLE` carries the row's text as printed, and the RR is adjudicated
by the Ref, not by the system. Correcting it in the transcription would hide a
real source bug behind a plausible guess. The row's `sourceNote` records the
reading for whoever reads it at the table.

**Ask MCDM:** confirm Strength.

---

## MEDIUM Severity

### R3 — RR sub-tables arrive from the OCR pipeline unreadable

Three rows (`51-52`, `55-56`, `62-64`) contain a tiered RR result table. The
generated markdown runs the tier number into its result, losing the only thing
that marks it as a table:

| Source markdown | Transcribed as |
|---|---|
| `16 damage; weakened` | `Tier 1: 6 damage; weakened.` |
| `23 damage` | `Tier 2: 3 damage.` |
| `3No effect` | `Tier 3: No effect.` |

Read literally the first line is "16 damage", which is wrong by a factor of
nearly three and is exactly the kind of error that survives review because it
looks like a number.

**Handling:** tier labels restored, spacing repaired, **no wording changed**.
This follows the precedent set for `lang/en.json`, whose expertise hints are
taken verbatim from `R:300`–`R:347` with OCR spacing artifacts repaired
(CONTRACT §6).

### R4 — Words run together throughout the table

Same pipeline, same cause, ~30 occurrences: `accordionplays`, `by1d6`,
`ofyou`, `thatyou`, `bodyare`, `enemyor`, `nothingelse`, `isgood or bad`,
`1UD`, `bythe Ref`, `andyougain`, and others.

**Handling:** spacing repaired, wording untouched. Flagged because anyone
diffing `BACKLASH_TABLE` against the source markdown will find these and should
know they are deliberate.

### R5 — Row `57-58` carries a stray bold marker

`R:1601`: *"Your magic summons 1d6**blood A** creatures…"*.

`blood` is a real creature type (`CROWS.creatureTypes`), so the intended text is
almost certainly *"1d6 blood creatures"*; the `A` looks like a
cross-reference or table marker the pipeline flattened into the sentence.

**Handling:** transcribed as *"Your magic summons 1d6 blood creatures who
appear…"*. The stray `A` is dropped, which is the one place in the table where
a character is removed rather than re-spaced.

---

## LOW Severity

### R6 — Two typos carried through verbatim

Both are MCDM's, both are harmless, and both are preserved per the
"preserve canonical typos" policy in `SUMMARY.md`:

- Row `77-78`: *"Your size **us** Tiny"* (for "is").
- Row `104`: *"Your Stamina is **reduce** to 0"* (for "reduced").

Row `03-04`'s *"makes you feels so good"* is likewise as printed.

---

## Related — logged elsewhere, not repeated here

Both of these are Characters Book issues affecting the same six Discipline
Mastery traits, and are recorded in
`docs/discrepancies/playtest-2-source-issues.md`:

- **H1** — all six Mastery traits still reference the deleted "chaos count".
  Implemented as *rank 0-1 spells of your discipline don't trigger a chaos
  roll* (`module/helpers/chaos.mjs`).
- **H2** — Elemental Mastery's body text says "conjuration spells", unfixed
  since Playtest 1. Implemented as **elemental**, resolved from the trait's own
  `system.tree` so MCDM's text stays intact in the item.

---

## Summary

| ID | Severity | Row | Issue | Applied in code? |
|---|---|---|---|---|
| R1 | HIGH | `62-64` | overlaps `61-62`; 63 uncovered | **yes** — read as 63-64 |
| R2 | HIGH | `51-52` | "Might RR" — no such characteristic | no — text kept as printed |
| R3 | MEDIUM | 3 rows | RR sub-tables run together by OCR | formatting only |
| R4 | MEDIUM | ~20 | words run together by OCR | formatting only |
| R5 | MEDIUM | `57-58` | stray `A` bold marker | yes — dropped |
| R6 | LOW | 2 rows | canonical typos | no — preserved |

R1 and R2 are worth reporting to MCDM: R1 makes the table unusable as printed
without a house ruling, and R2 names a characteristic the game does not have.
