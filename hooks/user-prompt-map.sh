#!/bin/bash
# UserPromptSubmit Hook: inject a task-scoped codebase map.
#
# Matches the prompt against the precomputed .muninn/context/map.json and
# injects likely-relevant files with purposes — so Claude skips the
# Glob/Grep/Read exploration phase. Local file reads only, silence on any
# failure, deduped per session when the match set hasn't changed.
#
# stdout -> injected into Claude's context

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v bun >/dev/null 2>&1 || exit 0

prompt=$(echo "$input" | jq -r '.prompt // ""' 2>/dev/null)
session_id=$(echo "$input" | jq -r '.session_id // "nosession"' 2>/dev/null)
[ -z "$prompt" ] && exit 0

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="$PWD"
map="$root/.muninn/context/map.json"
[ -f "$map" ] || exit 0

# Resolve the muninn repo from this hook's symlink target
hook_real=$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null) || exit 0
repo_dir=$(dirname "$(dirname "$hook_real")")
matcher="$repo_dir/src/v9/prompt-map.ts"
[ -f "$matcher" ] || exit 0

state="${TMPDIR:-/tmp}/muninn-promptmap-$(echo "$session_id" | tr -cd 'a-zA-Z0-9_-')"

printf '%s' "$prompt" | timeout 5 bun "$matcher" "$map" "$state" 2>/dev/null

exit 0
