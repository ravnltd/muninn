#!/bin/bash
# SessionStart Hook: Auto-resume from muninn memory
# FAST: Single `muninn startup` call replaces 3 separate CLI processes
#
# stdout → injected into Claude's context (AI sees this)
# stderr → shown in user's terminal only

if ! command -v muninn >/dev/null 2>&1; then
  echo "[Muninn] muninn CLI not found" >&2
  exit 0
fi

# Auto-initialize if needed (rare)
if [ ! -d ".claude" ]; then
  muninn init >/dev/null 2>&1
  echo "[Muninn] Initialized .claude for $(basename "$PWD")" >&2
fi

# --- STDOUT: Injected into Claude's context ---
echo "## Session Resume (auto-loaded by SessionStart hook)"
echo ""

# Single muninn startup call: resume + smart-status + session-start in one process
STARTUP_JSON=$(muninn startup "New session" 2>/dev/null)

if [ -n "$STARTUP_JSON" ]; then
  # Extract and output resume markdown
  echo "$STARTUP_JSON" | jq -r '.resume // empty' 2>/dev/null
  echo ""

  # Check for update notification
  UPDATE_COUNT=$(echo "$STARTUP_JSON" | jq -r '.updateAvailable.count // empty' 2>/dev/null)
  UPDATE_CMD=$(echo "$STARTUP_JSON" | jq -r '.updateAvailable.command // empty' 2>/dev/null)
  if [ -n "$UPDATE_COUNT" ] && [ "$UPDATE_COUNT" != "null" ] && [ "$UPDATE_COUNT" -gt 0 ] 2>/dev/null; then
    echo "## Update Available"
    echo "Muninn is **${UPDATE_COUNT} commit(s) behind**. To update:"
    echo '```'
    echo "$UPDATE_CMD"
    echo '```'
    echo ""
    # Also show in user's terminal
    echo "" >&2
    echo "** Muninn update available (${UPDATE_COUNT} commits behind) **" >&2
    echo "   Run: ${UPDATE_CMD}" >&2
    echo "" >&2
  fi

  # Extract and format smart status
  echo "## Smart Status"
  echo "$STARTUP_JSON" | jq -r '
    "Health: \(.smartStatus.health // "unknown")" +
    "\nActions:\n" +
    ((.smartStatus.actions // []) | map("- \(.action) (\(.reason))") | join("\n")) +
    "\nWarnings:\n" +
    ((.smartStatus.warnings // []) | map("- \(.)") | join("\n"))
  ' 2>/dev/null
  echo ""
else
  # Fallback: run separate commands if startup fails
  muninn resume 2>/dev/null | jq -r '.markdown // empty' 2>/dev/null || muninn resume 2>/dev/null
  echo ""
  echo "## Smart Status"
  muninn ss 2>/dev/null | jq -r '
    "Health: \(.projectHealth // "unknown")\n" +
    "Actions:\n" +
    ((.actions // []) | map("- \(.action) (\(.reason))") | join("\n")) +
    "\nWarnings:\n" +
    ((.warnings // []) | map("- \(.)") | join("\n"))
  ' 2>/dev/null || muninn ss 2>/dev/null | head -10
  echo ""
  muninn session start "New session" >/dev/null 2>&1 &
fi

echo "Session active. Context loaded. Do NOT call muninn_session_start — it is already running."

# --- STDERR: User's terminal only (minimal) ---
echo "" >&2
echo "🧠 muninn commands: check, query, ss, resume, predict, suggest" >&2
