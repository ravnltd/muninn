#!/bin/bash
# Muninn PostToolUse Hook (Edit/Write)
# Tracks file edits in the active session

# Check if muninn is available
if ! command -v muninn &> /dev/null; then
    exit 0
fi

# Extract file path from tool input
FILE_PATH=$(echo "$1" | grep -oP '"file_path"\s*:\s*"\K[^"]+' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
    exit 0
fi

# Get relative path
if [[ "$FILE_PATH" == /* ]]; then
    RELATIVE_PATH="${FILE_PATH#$(pwd)/}"
else
    RELATIVE_PATH="$FILE_PATH"
fi

# Track the edit in session
muninn hook post-edit "$RELATIVE_PATH" 2>/dev/null || true

exit 0
