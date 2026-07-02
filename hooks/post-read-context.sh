#!/bin/bash
# PostToolUse Hook (Read|Edit|Write): inject precomputed per-file context.
#
# The push-delivery core: when Claude touches a file that has a context bundle
# (fragility, decisions, issues, co-changers — precomputed by
# `muninn context refresh`), inject it via additionalContext. Once per file per
# session. Files with nothing non-obvious have no bundle: zero tokens injected.
#
# Phase 0 contract: pure file reads, no network, no database. <100ms.

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

file_path=$(echo "$input" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // "nosession"' 2>/dev/null)
[ -z "$file_path" ] && exit 0

# Resolve project root and relative path
root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
rel="${file_path#"$root"/}"

bundle="$root/.muninn/context/files/$rel.md"
[ -f "$bundle" ] || exit 0

# Dedupe: inject each file's context once per Claude session
mark_dir="${TMPDIR:-/tmp}/muninn-injected-$(echo "$session_id" | tr -cd 'a-zA-Z0-9_-')"
mkdir -p "$mark_dir" 2>/dev/null || exit 0
mark="$mark_dir/$(echo "$rel" | tr '/' '_')"
[ -f "$mark" ] && exit 0
touch "$mark" 2>/dev/null

ctx=$(cat "$bundle" 2>/dev/null)
[ -z "$ctx" ] && exit 0

# Feedback ledger: record the injection locally; context refresh ingests it
printf '{"ts":"%s","kind":"file","target":"%s","bytes":%d}\n' \
  "$(date -u +%FT%TZ)" "$rel" "${#ctx}" >> "$root/.muninn/context/injections.log" 2>/dev/null || true

jq -cn --arg ctx "[muninn: $rel]
$ctx" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $ctx}}'
