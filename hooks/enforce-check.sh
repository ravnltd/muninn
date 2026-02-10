#!/bin/bash
# Enforce muninn_check before Edit/Write
# FAST: reads temp file only (~5ms). No CLI spawns.
# FAIL-OPEN: any error -> allow edit.
set -o pipefail

# Consume stdin (required by hook protocol)
input=$(cat)

# Fail-open wrapper
allow() { echo "$input"; exit 0; }
deny() { echo "$1" >&2; exit 2; }

# Verify tool type — defense-in-depth (matcher should filter, but be safe)
if command -v jq >/dev/null 2>&1; then
  tool_name=$(echo "$input" | jq -r '.tool_name // ""' 2>/dev/null) || allow
else
  tool_name=$(echo "$input" | grep -oP '"tool_name"\s*:\s*"\K[^"]+' 2>/dev/null | head -1) || allow
fi
case "$tool_name" in
  Edit|Write) ;; # Continue with enforcement
  *) allow ;;    # Not an edit tool — allow
esac

# Extract file path — jq preferred, grep fallback
if command -v jq >/dev/null 2>&1; then
  file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null) || allow
else
  file_path=$(echo "$input" | grep -oP '"file_path"\s*:\s*"\K[^"]+' 2>/dev/null | head -1) || allow
fi

# Skip non-project paths, empty paths, plan files, markdown, test files
case "$file_path" in
  "") allow ;;
  /tmp/*|/var/*|/usr/*) allow ;;
  /home/*/.claude/plans/*) allow ;;
  /home/*/.claude/hooks/*) allow ;;
  /home/*/.claude/settings*) allow ;;
  /home/*/.claude/projects/*/memory/*) allow ;;
  */node_modules/*|*/.git/*) allow ;;
esac

# Skip non-source files (markdown, json config, etc.)
case "$file_path" in
  *.md|*.txt|*.json|*.yaml|*.yml|*.toml|*.lock) allow ;;
esac

# Resolve relative path (fail-open if git unavailable)
rel_path="$file_path"
git_root=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$git_root" ]; then
  rel_path="${file_path#"$git_root"/}"
fi

# Skip files not tracked by git (untracked/gitignored = no fragility data anyway)
if [ -n "$git_root" ]; then
  git ls-files --error-unmatch "$file_path" >/dev/null 2>&1 || allow
fi

# Find the project-specific checked-files list
# MCP server writes a discovery file with the correct temp paths
cwd_hash=$(echo -n "$PWD" | sha256sum 2>/dev/null | cut -c1-12) || allow
discovery="/tmp/muninn-discovery-${cwd_hash}.json"

if [ ! -f "$discovery" ]; then
  # No discovery file = MCP server hasn't written state yet. Allow edit.
  allow
fi

# Read checked-files path from discovery
if command -v jq >/dev/null 2>&1; then
  checked_path=$(jq -r '.checkedPath // ""' "$discovery" 2>/dev/null) || allow
else
  checked_path=$(grep -oP '"checkedPath"\s*:\s*"\K[^"]+' "$discovery" 2>/dev/null | head -1) || allow
fi

[ -z "$checked_path" ] && allow

# Skip enforcement for new projects with no muninn file data
if command -v jq >/dev/null 2>&1; then
  has_data=$(jq -r '.hasFileData // true' "$discovery" 2>/dev/null) || true
else
  has_data=$(grep -oP '"hasFileData"\s*:\s*\K(true|false)' "$discovery" 2>/dev/null | head -1) || true
fi
[ "$has_data" = "false" ] && allow

[ ! -f "$checked_path" ] && deny "BLOCKED: Call muninn_check on $rel_path before editing. No files have been checked yet."

# Check if file was checked (grep -F for literal match, -q for speed)
if grep -qF "$rel_path" "$checked_path" 2>/dev/null; then
  allow
fi

# Also check with absolute path in case check was called with absolute
if grep -qF "$file_path" "$checked_path" 2>/dev/null; then
  allow
fi

deny "BLOCKED: Call muninn_check on $rel_path before editing."
