#!/bin/bash
# PostToolUse Hook (Edit|Write): track edited files + refresh their context bundle.
#
# Phase 0 contract: nothing synchronous. Tracking and bundle refresh both run
# detached in the background; the hook returns immediately.

input=$(cat)

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

if [ -n "$file_path" ] && [ -f "$file_path" ] && command -v muninn >/dev/null 2>&1; then
  # Relative path from project root
  rel_path="$file_path"
  git_root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [ -n "$git_root" ]; then
    rel_path="${file_path#"$git_root"/}"
  fi

  # Track in session, then refresh this file's bundle — detached, bounded, silent
  (
    timeout 30 muninn hook post-edit "$rel_path" >/dev/null 2>&1
    timeout 30 muninn context refresh --file "$rel_path" >/dev/null 2>&1
  ) &
fi

exit 0
