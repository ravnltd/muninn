#!/bin/bash
# SessionStart Hook: Auto-resume from muninn memory
# Simplified: resume context only, no workflow enforcement
#
# stdout -> injected into Claude's context (AI sees this)
# stderr -> shown in user's terminal only

if ! command -v muninn >/dev/null 2>&1; then
  echo "[Muninn] muninn CLI not found" >&2
  exit 0
fi

# Auto-initialize if needed
if [ ! -d ".claude" ]; then
  INIT_OUTPUT=$(muninn init 2>&1)
  echo "[Muninn] Initialized .claude for $(basename "$PWD")" >&2
  # Show bootstrap summary if files were indexed
  BOOTSTRAP_FILES=$(echo "$INIT_OUTPUT" | grep -oP 'Bootstrapped \K\d+' 2>/dev/null || true)
  if [ -n "$BOOTSTRAP_FILES" ] && [ "$BOOTSTRAP_FILES" -gt 0 ] 2>/dev/null; then
    echo "[Muninn] Bootstrapped $BOOTSTRAP_FILES files from git history" >&2
  fi
fi

# --- STDOUT: Injected into Claude's context ---
echo "## Session Resume (auto-loaded by SessionStart hook)"
echo ""

# Single muninn startup call
STARTUP_JSON=$(muninn startup "New session" 2>/dev/null)

if [ -n "$STARTUP_JSON" ]; then
  # Resume context
  echo "$STARTUP_JSON" | jq -r '.resume // empty' 2>/dev/null
  echo ""

  # Update notification
  UPDATE_COUNT=$(echo "$STARTUP_JSON" | jq -r '.updateAvailable.count // empty' 2>/dev/null)
  UPDATE_CMD=$(echo "$STARTUP_JSON" | jq -r '.updateAvailable.command // empty' 2>/dev/null)
  if [ -n "$UPDATE_COUNT" ] && [ "$UPDATE_COUNT" != "null" ] && [ "$UPDATE_COUNT" -gt 0 ] 2>/dev/null; then
    echo "## Update Available"
    echo "Muninn is **${UPDATE_COUNT} commit(s) behind**. Run: ${UPDATE_CMD}"
    echo ""
    echo "** Muninn update available (${UPDATE_COUNT} commits behind) **" >&2
  fi

  # Smart status (brief)
  echo "## Smart Status"
  echo "$STARTUP_JSON" | jq -r '
    "Health: \(.smartStatus.health // "unknown")" +
    (if ((.smartStatus.warnings // []) | length) > 0 then
      "\nWarnings:\n" + ((.smartStatus.warnings // []) | map("- \(.)") | join("\n"))
    else "" end)
  ' 2>/dev/null
  echo ""
else
  # Fallback
  muninn resume 2>/dev/null | jq -r '.markdown // empty' 2>/dev/null || muninn resume 2>/dev/null
  echo ""
  muninn session start "New session" >/dev/null 2>&1 &
fi

echo "Session active. Context loaded. Do NOT call muninn_session_start — it is already running."
