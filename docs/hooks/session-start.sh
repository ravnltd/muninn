#!/bin/bash
# Muninn SessionStart Hook
# Initializes context and loads resume point for new Claude Code sessions

set -e

# Check if muninn is available
if ! command -v muninn &> /dev/null; then
    echo "muninn not found in PATH" >&2
    exit 0  # Don't block session start
fi

# Auto-initialize if needed (creates .claude/ directory)
muninn init --quiet 2>/dev/null || true

# Output session resume context
echo "## Session Resume (auto-loaded by SessionStart hook)"
echo ""

# Show resume point from last session
muninn resume 2>/dev/null || echo "No previous session found."
echo ""

# Show smart status
muninn ss 2>/dev/null || true

# Start new session
muninn session start "New session" 2>/dev/null || true

echo ""
echo "Session active. Context loaded."
