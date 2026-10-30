#!/bin/bash
# PreToolUse Hook (Bash, GitHub MCP): block Claude attribution in commits, tags and PRs.
#
# settings.json `attribution` is the first layer; this catches attribution that
# instructions (system reminders, templates) add anyway. Exit 2 = block, stderr
# goes back to Claude. Greps the raw JSON so it works without jq.

input=$(cat)

attribution='co-authored-by:.{0,80}(claude|anthropic)|generated with \[?claude code|noreply@anthropic\.com'
echo "$input" | grep -qiE "$attribution" || exit 0

tool=$(echo "$input" | grep -oE '"tool_name" *: *"[^"]*"' | head -1)
case "$tool" in
  *'"Bash"'*) echo "$input" | grep -qE '(^|[^a-z_-])(git|gh) ' || exit 0 ;;
  *github*) ;;
  *) exit 0 ;;
esac

echo "BLOCKED: no Claude attribution in commits, tags or PRs (no Co-Authored-By: Claude, no 'Generated with Claude Code'). Remove those lines and retry." >&2
exit 2
