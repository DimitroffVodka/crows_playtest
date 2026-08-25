#!/usr/bin/env bash
#
# Pin the four Playtest 2 rulebooks (plus MCDM's changelog) into the repo.
#
# WHY THIS EXISTS — this is L1 in docs/discrepancies/playtest-2-source-issues.md.
# The books are generated artifacts produced by an OCR/build pipeline living
# outside the repo. Rebuilding them shifts every line number, and there are
# multiple divergent copies on disk. On 2026-08-25 that cost three separate
# rounds of rework in a single session:
#
#   1. T3.1's background line starts were in the dead L#### scheme.
#   2. Hours after that was corrected, the pipeline regenerated the Rules and
#      Characters books, invalidating the correction and every other R:/C: ref.
#   3. An agent in a worktree concluded the Miasma effects table did not exist,
#      because the books are not in the repo, and was about to invent
#      placeholder mechanics.
#
# Pinned copies make R:/C:/F:/D: a stable address tied to a commit.
#
#   ./sync-books.sh          copy the books in and record source hashes
#   ./sync-books.sh --check  report whether the pinned copies still match source
#
# A --check failure is NOT corruption. It means the pipeline regenerated the
# books and every citation in the repo needs re-deriving BY CONTENT. Never fix
# citations by applying an offset: the drift is not constant. On 2026-08-25 the
# Miasma section moved 104 lines while the Conditions chapter moved 85.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKET="${CROWS_PT2_PACKET:-$HOME/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026}"
BOOKS="$PACKET/Crows Playtest 2 Markdown"

# prefix<TAB>output-slug<TAB>source filename
MAP=$(cat <<'EOF'
R	rules-book	01 Crows The Rules Book for Playtest 2.md
C	characters-book	02 Crows Characters Book for Playtest 2.md
F	ref-book	03 Crows The Ref Book for Playtest 2.md
D	dungeons-book	04 Crows Dungeons Book for Playtest 2.md
X	changelog	Crows Playtest Changelog.md
EOF
)

mode="${1:-sync}"

if [ ! -d "$BOOKS" ]; then
  echo "error: book directory not found: $BOOKS" >&2
  echo "       set CROWS_PT2_PACKET to your copy of the packet" >&2
  exit 1
fi

if [ "$mode" = "--check" ]; then
  status=0
  while IFS=$'\t' read -r prefix slug src; do
    [ -n "$prefix" ] || continue
    pinned="$HERE/$prefix-$slug.md"
    if [ ! -f "$pinned" ]; then
      echo "MISSING $prefix  $prefix-$slug.md not pinned" >&2; status=1; continue
    fi
    if cmp -s "$BOOKS/$src" "$pinned"; then
      echo "ok      $prefix  $prefix-$slug.md"
    else
      echo "DRIFT   $prefix  source has been regenerated — RE-DERIVE CITATIONS BY CONTENT" >&2
      echo "        pinned $(wc -l < "$pinned") lines, source $(wc -l < "$BOOKS/$src") lines" >&2
      status=1
    fi
  done <<< "$MAP"
  exit $status
fi

while IFS=$'\t' read -r prefix slug src; do
  [ -n "$prefix" ] || continue
  if [ ! -f "$BOOKS/$src" ]; then
    echo "error: missing source book: $BOOKS/$src" >&2
    exit 1
  fi
  cp "$BOOKS/$src" "$HERE/$prefix-$slug.md"
  printf '%-3s %-26s %5s lines\n' "$prefix" "$prefix-$slug.md" "$(wc -l < "$HERE/$prefix-$slug.md")"
done <<< "$MAP"

( cd "$BOOKS" && sha256sum *.md ) > "$HERE/SOURCE-BOOKS.sha256"
echo "wrote SOURCE-BOOKS.sha256"
