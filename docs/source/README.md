# Playtest 2 pinned source

Two things live here: the **four rulebooks** (plus MCDM's changelog), and the **inventory
card text**. Both are pinned so `R:`/`C:`/`F:`/`D:` and `IC:`/`IP:`/`IL:`/`IA:`/`IS:` are
stable addresses tied to a commit.

---

# The four books — pinned 2026-08-25, closing L1

| Prefix | File | Lines |
| --- | --- | ---: |
| `R:` | `R-rules-book.md` | 1,388 |
| `C:` | `C-characters-book.md` | 2,678 |
| `F:` | `F-ref-book.md` | 1,727 |
| `D:` | `D-dungeons-book.md` | 832 |
| `X:` | `X-changelog.md` — MCDM's own PT1→PT2 delta | 149 |

**Cite against the files in this directory, not against the Hub copies.**

```sh
./sync-books.sh          # re-copy from the packet and record source hashes
./sync-books.sh --check  # do the pinned copies still match the packet?
```

## Why this exists — it cost three rounds of rework in one day

The books are **generated artifacts** from an OCR/build pipeline outside the repo. On
2026-08-25 that produced three separate failures in a single session:

1. T3.1's background line starts were still in the dead `L####` scheme and pointed into the
   traits chapter — plausible game text, wrong content, nothing erroring.
2. Hours after that was corrected, **the pipeline regenerated every book** (07:44–07:59),
   invalidating the correction and every other citation in the repo.
3. An agent working in a git worktree concluded the Miasma effects table *did not exist* —
   because the books were not in the repo — and was about to invent placeholder mechanics.

## A `--check` failure is not corruption

It means the pipeline regenerated the books and **every citation needs re-deriving by
content**.

**Never fix citations by applying an offset.** The drift is not constant. In the
2026-08-25 rebuild the Miasma section moved 104 lines while the Conditions chapter moved 85.
An earlier draft of the Miasma artifact applied one section's offset to another and produced
a citation pointing into the wrong chapter.

## There are THREE divergent copies of the Rules Book on disk

Only the first is authoritative:

| Copy | Lines | Status |
| --- | ---: | --- |
| `…/Crows Playtest 2 Markdown/` — what `sync-books.sh` reads | 1,388 | **authoritative** |
| `…/MCDM Crows Public Playtest August-Sept 2026/01 …md` (packet root) | 1,887 | stale, Aug 20 |
| `…/obsidian-memory/…/Crows/` | 1,603 | stale, long known |

`.planning/PLAYTEST-2-MIGRATION.md` warns about the obsidian copy. The **packet-root copy was
not previously documented anywhere.** Pinning removes the whole class of problem: read this
directory and the question of which copy never arises.

## The 2026-08-25 rebuild changed every book

| Book | Before | After |
| --- | ---: | ---: |
| Rules | 1,736 | 1,388 |
| Characters | 3,179 | 2,678 |
| Ref | 2,122 | 1,727 |
| Dungeons | 1,167 | 832 |

**Every `R:`, `C:`, `F:` and `D:` citation written before this date is stale.** Earlier notes
in this repo claim `F:` and `D:` were unaffected — that was measured **mid-rebuild**, before
those two files were rewritten, and is wrong.

Known relocations, re-derived by content:

| Was | Now | What |
| --- | --- | --- |
| `R:526` | `R:441` | Conditions chapter |
| `R:528` | `R:443` | "can't gain a second instance of a condition" |
| `R:1225`–`R:1256` | `R:1121`–`R:1148` | Miasma |
| `C:89`–`C:602` | `C:81`–`C:372` | Backgrounds |
| `F:1296`–`F:1298` | `F:1157`–`F:1160` | Cultist stat block / Knock Prone |

The Dungeons book is now **832 lines**, so the execution plan's `D:577`–`D:1168` for T3.9
runs past the end of the file. Re-derive before dispatching T3.8–T3.11.

**The rebuild improved the extraction.** Records are more regular, and the old version
mangled multi-word italic tokens — Transmuter's spellbooks read `_repair take_ , _shape_`
where the book means `*repair*, *take shape*`. Content transcribed from a pre-rebuild file
should be re-derived.

---

# Playtest 2 inventory cards — pinned source text

**Added:** 2026-08-25, resolving **H4** in [`../discrepancies/playtest-2-source-issues.md`](../discrepancies/playtest-2-source-issues.md).

## Why this exists

Playtest 2 ships markdown for the **four books only**. Every per-item stat block —
spell tier bands, item costs, stack sizes, crafting recipes — exists solely in the
inventory-card PDFs.

That broke an assumption baked into the Wave 3 briefs, which tell every content agent to
cite `R:`/`C:`/`F:`/`D:` line numbers. Those prefixes address book markdown, and **no card
value is in it.** An agent validating a card against the books either finds nothing or
finds a passing mention and mistakes it for the stat block.

The concrete proof: **Soothing Candy appears in none of the four PT2 books**, but has a card
(`IC:249`). Markdown-only validation concludes the item was cut from Playtest 2. It wasn't.

## ⚠️ The two pinned sources here do NOT have the same fidelity

They sit in one directory and are produced by different pipelines:

| | Produced by | Faithful to the PDF? |
|---|---|---|
| `R-`/`C-`/`F-`/`D-*.md` — the books | OCR/build pipeline | **No.** Silently corrects MCDM's typos |
| `IC-`/`IP-`/`IL-`/`IA-`/`IS-*.txt` — the cards | `pdftotext -layout` | **Yes.** Direct extraction, no repair pass |

Measured across all 276 trait documents on 2026-08-25: the book markdown corrected MCDM
**~33 times** and introduced an error **zero times**. So it never fabricates — structure and
meaning are reliable — but it is **not a verbatim authority**.

Some corrections change grammatical number or phrasing, not just spelling (`attack` →
`attacks against`, `against target in darkness` → `against targets`), so they are not safely
ignorable.

**Rule:** markdown for structure and for what a rule *means*; the **PDF** for anything shipped
as quoted prose or as a name; **card text is already faithful** and can be quoted directly.

Six canonical typos are pinned by `test/trait-corpus.test.mjs` — `vulenarble`, `Sieze`,
`wile`, `one the same turn`, `car for`, `a two expertises` — so re-transcribing one from the
markdown fails the suite instead of silently diverging.

Per-ticket guidance for the remaining Wave 3 work is in
[`.planning/PLAYTEST-2-EXECUTION.md`](../../.planning/PLAYTEST-2-EXECUTION.md) under "Source
fidelity".

## Citation prefixes

These extend the book-prefix scheme in [`.planning/PLAYTEST-2-MIGRATION.md`](../../.planning/PLAYTEST-2-MIGRATION.md).
All card prefixes start with `I` (inventory), so they cannot collide with `R:`/`C:`/`F:`/`D:`.

| Prefix | File | Source PDF | Pages | Lines |
| --- | --- | --- | ---: | ---: |
| `IS:` | `IS-inventory-sheet.txt` | 01 Crows Inventory Sheet for Playtest 2 | 1 | 21 |
| `IC:` | `IC-inventory-cards.txt` | 02 Crows Invetory Cards for Public Playtest 2 | 7 | 465 |
| `IP:` | `IP-cards-by-profession.txt` | 03 Crows Inventory Cards by Profession | 36 | 1,878 |
| `IL:` | `IL-cards-pois-dungeons.txt` | 04 Crows Inventory Cards for POIs and Dungeons | 6 | 268 |
| `IA:` | `IA-cards-annotated.txt` | 05 Crows Inventory Cards … Annotated | 7 | 461 |

`IC:` is the main deck and will carry the overwhelming majority of citations. Cite as
`IC:368` for a line, `IC:362-371` for a range. Each file carries `<!-- PDF page N -->`
markers matching the book markdown's convention, so a citation can be relocated by page
even if line numbers shift.

**MCDM's filename typo — "Invetory" — is preserved** in the mapping inside
`extract-cards.sh`, because that is the actual filename in the packet. Do not "fix" it.

### Worked examples, from the T3.0 audit

| Item | Citation | What it says |
| --- | --- | --- |
| Bone Capture | `IC:368-377` | `Ranged 5`, 12-16 `2+M`, 17+ `4+M` + prone |
| Minor Curse | `IC:368-385` | ≤11 `No effect`, 12-16 `2+M dam`, 17+ `4+M dam and weakened` |
| Repair | `IC:294-309` | `1+M` / `4+M` / `8+M` |
| Minor Healing | `IC:311-325` | `1+M` / `2+M` / `4+M` |
| Light | `IC:352-362` | `0/5` / `5/5` / `10/10` |
| Rage Potion | `IC:216-234` | 250 gc; the `50` is the Alchemy 2 crafting number |
| Ball Bearings | `IC:53-72` | `Prone and 4 dam` / `Prone` / `No effect`, 5 gc |
| Soothing Candy | `IC:249-260` | no printed gc cost; still says "boned" (see H3) |

## Reproducing

```sh
./extract-cards.sh          # regenerate the .txt files
./extract-cards.sh --check  # verify the checked-in files still reproduce
```

The source PDFs are **not** in this repo — they are MCDM's packet, distributed to
playtesters. The script defaults to
`~/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026`;
override with `CROWS_PT2_PACKET`. `SOURCE-PDFS.sha256` pins the packet those files came
from, so a silently-replaced PDF is detectable.

### Line numbers are pinned to a poppler version

Extraction uses `pdftotext -layout`, pinned to **poppler 26.08.0**. A different release can
reflow the output and shift every line number — the same failure mode **L1** records for
the book markdown. The script warns on a version mismatch; `--check` is the real detector.

**`-layout` is not optional.** Without it the card columns interleave, which is precisely
the defect that generated all 8 HIGH findings in the Playtest 1 cross-validation pass, and
that made the PT1 markdown useless for adjudicating a tier band. If you regenerate these
without `-layout` you will reintroduce the bug this directory exists to prevent.

## Reading the extracted text

Cards are laid out in a grid, so a single line spans **several unrelated cards**. `IC:371`
is one line of five different cards' effect tables. Two consequences:

- **Never read a value off one line.** Establish the column a card occupies from its title
  line, then read down that column's character range.
- **Adjacent columns are the classic trap.** In the PT1 pass, Caltrops' `-2 speed until
  healed` was misread as a Ball Bearings effect, and this repo's own remediation note then
  told the implementer to move it to the wrong band. Ball Bearings (`IC:53`) and Caltrops
  (`IC:69`) are neighbours; verify against the PDF when two cards disagree.

An attack spell prints only `12-16` and `17+`; an action/maneuver spell prints all three
bands including `≤11`. A card with two bands is not a truncated extraction.

## Scope

~~This resolves H4 for cards only. **L1 remains open.**~~ **L1 is now closed too** — the four
books were pinned on 2026-08-25; see the top of this file. Both halves of the source are now
addressable by commit.
