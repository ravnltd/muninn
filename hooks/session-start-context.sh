#!/bin/bash
# SessionStart Hook: inject precomputed orientation from the context cache.
#
# Phase 0 contract: NEVER hit the network or database synchronously.
# This hook only cats a precomputed file, then triggers a detached background
# refresh so the NEXT session gets fresh context. Missing cache = near-silence.
#
# stdout -> injected into Claude's context (AI sees this)
# stderr -> shown in user's terminal only

CACHE=".muninn/context"

# --- STDOUT: instant, from cache only ---
if [ -f "$CACHE/session-start.md" ]; then
  cat "$CACHE/session-start.md"
else
  echo "Muninn: no cached context yet for this project — indexing in background. Per-file context will appear as you work."
fi

# Global tier: cross-project forever memory (machine-wide, exists even in new repos)
GLOBAL="$HOME/.muninn/context/global.md"
if [ -s "$GLOBAL" ]; then
  echo ""
  cat "$GLOBAL"
fi

# --- STDERR: user-facing notices from cached metadata ---
if [ -f "$CACHE/meta.json" ] && command -v jq >/dev/null 2>&1; then
  GENERATED=$(jq -r '.generatedAt // empty' "$CACHE/meta.json" 2>/dev/null)
  [ -n "$GENERATED" ] && echo "[Muninn] Context cache from $GENERATED (refreshing in background)" >&2
fi

# --- Background refresh: fully detached, bounded, silent on failure ---
if command -v muninn >/dev/null 2>&1; then
  ( timeout 120 muninn context refresh >/dev/null 2>&1 & ) &
fi

exit 0
