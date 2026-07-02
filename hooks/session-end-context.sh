#!/bin/bash
# Stop Hook: end the muninn session and refresh the context cache.
#
# Phase 0 contract: everything network-bound runs detached in the background.
# The only synchronous work is a local git status for the user's terminal.

if command -v muninn >/dev/null 2>&1; then
  (
    # End the active session (session end resolves the active one server-side),
    # then refresh the cache so the next session starts with fresh orientation.
    active_session=$(timeout 15 muninn session last --json 2>/dev/null | jq -r 'select(.ended_at == null) | .id' 2>/dev/null)
    if [ -n "$active_session" ] && [ "$active_session" != "null" ]; then
      timeout 30 muninn session end "$active_session" >/dev/null 2>&1
    fi
    timeout 120 muninn context refresh >/dev/null 2>&1
  ) &
fi

# Uncommitted-changes notice (local, fast, user-facing only)
if git rev-parse --git-dir >/dev/null 2>&1; then
  changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$changes" -gt 0 ]; then
    echo "[Muninn] $changes uncommitted file(s)" >&2
  fi
fi

exit 0
