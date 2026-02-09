#!/bin/bash
# PostToolUse Hook: Auto-track edited files in context memory
# Uses the optimized 'hook post-edit' command
#
# Requires: muninn CLI

input=$(cat)
file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""')

# Only track if we have a valid path and muninn CLI exists
if [ -n "$file_path" ] && [ -f "$file_path" ] && command -v muninn >/dev/null 2>&1; then
  # Get relative path from project root
  rel_path="$file_path"
  if [ -d ".git" ]; then
    git_root=$(git rev-parse --show-toplevel 2>/dev/null)
    if [ -n "$git_root" ]; then
      rel_path="${file_path#$git_root/}"
    fi
  fi

  # Use the optimized hook post-edit command
  # This tracks the file in active session and prompts for memory updates
  muninn hook post-edit "$rel_path" 2>&1 | head -10
fi

echo "$input"
