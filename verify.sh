#!/usr/bin/env bash
set -u
fail=0
# Syntax check all module files
while IFS= read -r f; do
  node --check "$f" || { echo "SYNTAX FAIL: $f"; fail=1; }
done < <(find module -name '*.mjs')
# BLOCK patterns (real-bug guards)
block() { if grep -rnE "$1" module 2>/dev/null; then echo "BLOCK: $2"; fail=1; fi; }
block 'this\.senderId' 'socketlib: use this.socketdata?.userId, not senderId'
block 'Math\.(floor|ceil|round|min|max)\([^)]*safeEval' 'safeEval has no Math.* — use bare fn names'
# v14 Active Effect changes. Verified live on Foundry 14.367 — .planning/API-NOTES.md §1.
# The change schema takes a STRING `type` plus `phase`; {mode:2} auto-migrates to
# {type:"add",phase:"initial"}. The old message here said "use
# CONST.ACTIVE_EFFECT_CHANGE_TYPES", which invited `type: CONST.ACTIVE_EFFECT_CHANGE_TYPES.add`
# — and that writes 20, because the CONST's VALUES are priorities, not modes.
block 'CONST\.ACTIVE_EFFECT_MODES' 'v14: effect changes take `type: "add"` (a string), not a numeric mode'
# The subtler error the old message caused, which nothing was catching. Assigning
# the CONST's value to type:/mode: is always wrong; reading it for `priority:` is
# correct and stays allowed.
block '(type|mode)[[:space:]]*:[[:space:]]*CONST\.ACTIVE_EFFECT_CHANGE_TYPES\.' 'v14: use the key string ("add") — ACTIVE_EFFECT_CHANGE_TYPES values are PRIORITIES (add=20)'
block 'renderChatMessage[^H]|renderChatMessage$' 'v14: use renderChatMessageHTML'
block 'new Application\(' 'use ApplicationV2'
# WARN patterns (non-blocking, or fatal under --strict)
#
# NB the --strict redefinition used to sit AFTER the only warn call, so it never
# applied to anything and `--strict` was a no-op that silently always passed.
# Define the mode first, then run the warns.
#
# warn <pattern> <message> [exclusion-pattern]
# The optional third argument filters out KNOWN-INTENTIONAL matches, so --strict
# can stay meaningful instead of being permanently red for reasons everyone has
# learned to ignore. Keep exclusions exact — a broad one recreates the trap.
STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1
warn() {
  local hits
  hits=$(grep -rnE "$1" module 2>/dev/null) || true
  [ -n "${3:-}" ] && hits=$(printf '%s\n' "$hits" | grep -vE "$3") || true
  [ -n "$hits" ] || return 0
  printf '%s\n' "$hits"
  if [ "$STRICT" = "1" ]; then echo "STRICT-FAIL: $2"; fail=1; else echo "WARN: $2"; fi
}
# The two `crows | init` / `crows | ready` lifecycle logs are deliberate and
# long-standing; anything else calling console.log is not.
warn 'console\.log' 'stray console.log' 'console\.log\("crows \| (init|ready)"\)'
exit $fail
