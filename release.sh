#!/usr/bin/env bash
#
# Build a distributable Foundry system archive — the artifact Gate D installs.
#
#   ./release.sh          build dist/crows.zip and dist/system.json
#   ./release.sh --check  run every prerequisite and report, writing nothing
#
# The archive name is NOT arbitrary. system.json declares
#   download: .../releases/latest/download/crows.zip
# so a GitHub release must carry exactly `crows.zip` and `system.json` as its
# two assets, or manifest-install breaks for everyone.
#
# WHY THIS REBUILDS THE PACKS INSTEAD OF ARCHIVING WHAT IS ON DISK.
# `packs/` is a build artifact of `src/packs/`, and nothing in git tells you
# whether it is current — a LevelDB with stale content looks identical to a
# fresh one. Shipping a release built from stale packs is the exact failure this
# project keeps producing, so the release rebuilds from source every time and
# fails loudly if it cannot. Foundry holds an exclusive lock while a world is
# open, so a release requires the world to be at Setup. That is a feature.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

MODE="${1:-build}"
DIST="$HERE/dist"
STAGE="$DIST/.stage"

# Everything Foundry needs at runtime, and nothing else.
#   fonts/  IS required — css/crows.css references all four woff2 files.
#   assets/ IS required — the canonical Village and institution stamps are runtime textures.
#   playtest-packet/  is NOT — 73M of MCDM art and maps that nothing references.
#   src/ test/ docs/ .planning/  are contributor material, not runtime.
PAYLOAD=(system.json module css fonts icons assets lang packs templates LICENSE NOTICE.md README.md)

say() { printf '  %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

VERSION="$(node -p "require('./system.json').version")"
ID="$(node -p "require('./system.json').id")"
say "system ${ID} v${VERSION}"

# ---------------------------------------------------------------- gates
say "running verify.sh --strict"
./verify.sh --strict >/dev/null 2>&1 || fail "verify.sh --strict did not pass"
say "running the test suite"
npm test >/dev/null 2>&1 || fail "npm test did not pass"

for f in "${PAYLOAD[@]}"; do
  [ -e "$f" ] || fail "payload entry missing: $f"
done

# Every declared pack must exist and be non-empty.
node -e '
const fs=require("fs"); const s=require("./system.json");
let bad=0;
for (const p of s.packs ?? []) {
  const dir=p.path;
  if (!fs.existsSync(dir)) { console.error(`  declared pack has no directory: ${dir}`); bad++; continue; }
  const ldb=fs.readdirSync(dir).filter(f=>f.endsWith(".ldb"));
  if (!ldb.length) { console.error(`  pack has no .ldb sstable: ${dir}`); bad++; }
}
if (bad) { console.error(`${bad} pack problem(s)`); process.exit(1); }
console.log(`  ${(s.packs??[]).length} declared packs present`);
' || fail "declared packs are not all built"

if [ "$MODE" = "--check" ]; then
  say "check mode — prerequisites pass, nothing written"
  say "NOTE: a real build also rebuilds packs, which requires the world at Setup"
  exit 0
fi

# ------------------------------------------------------- rebuild the packs
say "rebuilding packs from src/packs (world must be at Setup)"
if ! npm run pack >/tmp/crows-release-pack.log 2>&1; then
  if grep -qiE 'LEVEL_|not open' /tmp/crows-release-pack.log; then
    fail "Foundry holds the LevelDB lock — return to Setup, then re-run. A release must never be cut from packs that cannot be rebuilt."
  fi
  tail -5 /tmp/crows-release-pack.log >&2
  fail "npm run pack failed"
fi
say "packed $(grep -c '^Packed' /tmp/crows-release-pack.log) documents"

# ------------------------------------------------------------- assemble
rm -rf "$DIST"
mkdir -p "$STAGE"
for f in "${PAYLOAD[@]}"; do cp -R "$f" "$STAGE/"; done
# LevelDB lock/log files are runtime state, never distributable.
find "$STAGE/packs" \( -name LOCK -o -name 'LOG*' \) -delete 2>/dev/null || true

python3 - "$STAGE" "$DIST/${ID}.zip" <<'PY'
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, _, files in os.walk(stage):
        for name in sorted(files):
            full = os.path.join(root, name)
            # Files sit at the ARCHIVE ROOT, not under a wrapper directory —
            # Foundry extracts straight into Data/systems/<id>/.
            z.write(full, os.path.relpath(full, stage))
PY

cp system.json "$DIST/system.json"
rm -rf "$STAGE"

# --------------------------------------------------------------- report
ZIP="$DIST/${ID}.zip"
say ""
say "wrote $(basename "$ZIP")  $(du -h "$ZIP" | cut -f1)"
say "wrote system.json"
say "sha256 $(sha256sum "$ZIP" | cut -c1-16)…"
python3 -c "
import zipfile,collections,sys
z=zipfile.ZipFile('$ZIP')
top=collections.Counter(n.split('/')[0] for n in z.namelist())
print('  %d files:' % len(z.namelist()), ', '.join(f'{k} ({v})' for k,v in sorted(top.items())))
assert 'system.json' in z.namelist(), 'system.json must be at the archive root'
assert 'assets/village/canonical/background.svg' in z.namelist(), 'canonical Village background missing from release'
print('  system.json at archive root: yes')
"
say ""
say "Attach BOTH files to the GitHub release for tag v${VERSION}:"
say "  dist/${ID}.zip     (matches system.json download URL)"
say "  dist/system.json   (matches system.json manifest URL)"
