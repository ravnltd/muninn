#!/bin/bash
# Muninn PreToolUse Hook (Edit/Write)
# Checks file fragility before allowing edits

# Fragility threshold (1-10). Files at or above this trigger warnings.
THRESHOLD=7

# Check if muninn is available
if ! command -v muninn &> /dev/null; then
    exit 0  # Allow edit if muninn not available
fi

# Extract file path from tool input (passed as JSON)
# The tool input contains file_path for both Edit and Write tools
FILE_PATH=$(echo "$1" | grep -oP '"file_path"\s*:\s*"\K[^"]+' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
    exit 0  # No file path found, allow edit
fi

# Get relative path from absolute
if [[ "$FILE_PATH" == /* ]]; then
    # Convert absolute to relative
    RELATIVE_PATH="${FILE_PATH#$(pwd)/}"
else
    RELATIVE_PATH="$FILE_PATH"
fi

# Run fragility check
RESULT=$(muninn hook check "$RELATIVE_PATH" --threshold "$THRESHOLD" 2>/dev/null)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
    # Hook check returned non-zero, meaning file is fragile
    # Exit 1 to block the edit (requires user explanation)
    exit 1
fi

exit 0
