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

## Scope — the four books are still unpinned

This resolves H4 for cards only. **L1 remains open:** the four book markdown files still
live outside the repo, so `R:`/`C:`/`F:`/`D:` line numbers are not pinned to any commit, and
there are two divergent copies of the Rules Book. See the warning at the top of
`.planning/PLAYTEST-2-MIGRATION.md` before trusting an `R:` citation.
