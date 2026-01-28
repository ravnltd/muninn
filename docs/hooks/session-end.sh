#!/bin/bash
# Muninn Stop Hook
# Saves session state when Claude Code session ends

# Check if muninn is available
if ! command -v muninn &> /dev/null; then
    exit 0
fi

# End the current session with a generic outcome
# The actual outcome should be set during the session via muninn_session
muninn session end --outcome "Session completed" --success 1 2>/dev/null || true

exit 0
