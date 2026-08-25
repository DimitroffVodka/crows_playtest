#!/usr/bin/env bash
#
# Regenerate the checked-in Playtest 2 inventory-card text.
#
# PT2 ships markdown for the four books ONLY. Every per-item stat block — spell
# tier bands, costs, stack sizes, crafting recipes — exists solely in the card
# PDFs. This script pins that text to a commit so Wave 3 content agents have
# something citable. See README.md in this directory for the citation prefixes.
#
#   ./extract-cards.sh          regenerate the .txt files
#   ./extract-cards.sh --check  verify the checked-in files still reproduce
#
# The source PDFs are NOT in this repo (they are MCDM's packet, distributed to
# playtesters). Point CROWS_PT2_PACKET at your copy if it is not in the default
# location.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKET="${CROWS_PT2_PACKET:-$HOME/FoundryVTT-Projects/TTRPG Hub/Crows/MCDM Crows Public Playtest August-Sept 2026}"
CARDS="$PACKET/Inventory Cards"

# prefix<TAB>output-slug<TAB>source pdf
MAP=$(cat <<'EOF'
IS	inventory-sheet	01 Crows Inventory Sheet for Playtest 2.pdf
IC	inventory-cards	02 Crows Invetory Cards for Public Playtest 2.pdf
IP	cards-by-profession	03 Crows Inventory Cards by Profession for Public Playtest 2.pdf
IL	cards-pois-dungeons	04 Crows Inventory Cards for POIs and Dungeons.pdf
IA	cards-annotated	05 Crows Inventory Cards for Public Playtest 2 - Annotated.pdf
EOF
)

mode="${1:-generate}"

if ! command -v pdftotext >/dev/null 2>&1; then
  echo "error: pdftotext not found (install poppler-utils)" >&2
  exit 1
fi

# Line numbers are only stable for a given poppler release. The pinned version
# is recorded in README.md; a mismatch is a warning, not a failure, because the
# MANIFEST check below is the real drift detector.
PINNED="26.08.0"
have="$(pdftotext -v 2>&1 | awk '/^pdftotext version/{print $3; exit}')"
[ "$have" = "$PINNED" ] || \
  echo "warning: pdftotext $have != pinned $PINNED — line numbers may shift" >&2

extract_one() {
  # -layout preserves the card grid. Without it the columns interleave, which is
  # the exact defect that produced the 8 HIGH findings in the Playtest 1 pass.
  # Form feeds become page markers, matching the book markdown's convention.
  pdftotext -layout "$1" - \
    | awk 'BEGIN { RS = "\f" } { printf "<!-- PDF page %d -->\n%s", NR, $0 }'
}

if [ "$mode" = "--check" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  status=0
  while IFS=$'\t' read -r prefix slug pdf; do
    [ -n "$prefix" ] || continue
    out="$HERE/$prefix-$slug.txt"
    extract_one "$CARDS/$pdf" > "$tmp/$prefix.txt"
    if cmp -s "$tmp/$prefix.txt" "$out"; then
      echo "ok      $prefix  $prefix-$slug.txt"
    else
      echo "DRIFT   $prefix  $prefix-$slug.txt does not reproduce" >&2
      status=1
    fi
  done <<< "$MAP"
  exit $status
fi

while IFS=$'\t' read -r prefix slug pdf; do
  [ -n "$prefix" ] || continue
  src="$CARDS/$pdf"
  if [ ! -f "$src" ]; then
    echo "error: missing source PDF: $src" >&2
    exit 1
  fi
  out="$HERE/$prefix-$slug.txt"
  extract_one "$src" > "$out"
  printf '%-4s %-24s %5s lines\n' "$prefix" "$prefix-$slug.txt" "$(wc -l < "$out")"
done <<< "$MAP"

# Hash the SOURCE pdfs, not the output — this is what proves the packet itself
# has not been silently replaced under us.
( cd "$CARDS" && sha256sum *.pdf ) > "$HERE/SOURCE-PDFS.sha256"
echo "wrote SOURCE-PDFS.sha256"
