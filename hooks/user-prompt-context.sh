#!/bin/bash
# Inject cached task context on user prompt
# FAST: reads temp file only (~5ms). No CLI spawns.
# FAIL-OPEN: any error -> no context injected (silent).

# Consume stdin (required by hook protocol)
cat >/dev/null

# Find project-specific context cache
cwd_hash=$(echo -n "$PWD" | sha256sum 2>/dev/null | cut -c1-12) || exit 0
discovery="/tmp/muninn-discovery-${cwd_hash}.json"

[ ! -f "$discovery" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  context_path=$(jq -r '.contextPath // ""' "$discovery" 2>/dev/null) || exit 0
else
  context_path=$(grep -oP '"contextPath"\s*:\s*"\K[^"]+' "$discovery" 2>/dev/null | head -1) || exit 0
fi

[ -z "$context_path" ] && exit 0
[ ! -f "$context_path" ] && exit 0
[ ! -s "$context_path" ] && exit 0

# Output to stdout — injected into Claude's context
echo "## Muninn Context (auto-loaded)"
head -50 "$context_path"  # Safety cap: max 50 lines
echo ""
echo "REMINDER: Call muninn_check before editing any file."
