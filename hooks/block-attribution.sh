#!/bin/bash
# PreToolUse Hook (Bash, GitHub MCP): block Claude attribution in commits, tags and PRs.
#
# settings.json `attribution` is the first layer; this catches attribution that
# instructions (system reminders, templates) add anyway. Exit 2 = block, stderr
# goes back to Claude. Greps the raw JSON so it works without jq.

input=$(cat)

attribution='co-authored-by:.{0,80}(claude|anthropic)|generated with \[?claude code|noreply@anthropic\.com'
# git commit -F/--file: the message lives in a file, so append its contents to the scanned text.
if echo "$input" | grep -qE 'git commit'; then
  cwd=$(echo "$input" | grep -oE '"cwd" *: *"[^"]*"' | head -1 | sed -E 's/^"cwd" *: *"(.*)"$/\1/')
  for f in $(echo "$input" | grep -oE '(^|[ "])(-F ?|--file[ =])[^ "\\]+' | sed -E 's/^[ "]?(-F ?|--file[ =])//'); do
    [ "$f" = "-" ] && continue
    case "$f" in /*) ;; *) f="$cwd/$f" ;; esac
    [ -r "$f" ] && input="$input
$(head -c 65536 "$f" 2>/dev/null)"
  done
fi

echo "$input" | grep -qiE "$attribution" || exit 0

tool=$(echo "$input" | grep -oE '"tool_name" *: *"[^"]*"' | head -1)
case "$tool" in
  *'"Bash"'*) echo "$input" | grep -qE '(^|[^a-z_-])(git|gh) ' || exit 0 ;;
  *github*) ;;
  *) exit 0 ;;
esac

echo "BLOCKED: no Claude attribution in commits, tags or PRs (no Co-Authored-By: Claude, no 'Generated with Claude Code'). Remove those lines and retry." >&2
exit 2
