#!/bin/bash
# Stop Hook: Auto-save session state to muninn memory
# Streamlined: single network call, no blocking operations
#
# Requires: muninn CLI

input=$(cat)

if ! command -v muninn >/dev/null 2>&1; then
  echo "$input"
  exit 0
fi

# Get active session ID and end it (single network call)
active_session=$(muninn session last --json 2>/dev/null | jq -r 'select(.ended_at == null) | .id' 2>/dev/null)

if [ -n "$active_session" ] && [ "$active_session" != "null" ]; then
  # End session without --analyze to avoid API call latency
  muninn session end "$active_session" >/dev/null 2>&1 &
  echo "[Muninn] Ending session #$active_session" >&2
fi

# Check for uncommitted changes (local operation, fast)
if git rev-parse --git-dir > /dev/null 2>&1; then
  changes=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$changes" -gt 0 ]; then
    echo "[Muninn] $changes uncommitted file(s)" >&2
  fi
fi

echo "$input"
