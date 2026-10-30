#!/bin/bash
# SessionEnd Hook: end the muninn session and refresh the context cache.
#
# Registered on SessionEnd (once per Claude session), not Stop (every turn).
# Everything runs detached via setsid so it survives Claude Code exiting.

command -v muninn >/dev/null 2>&1 || exit 0

setsid bash -c '
  active_session=$(timeout 15 muninn session last --json 2>/dev/null | jq -r "select(.ended_at == null) | .id" 2>/dev/null)
  if [ -n "$active_session" ] && [ "$active_session" != "null" ]; then
    timeout 30 muninn session end "$active_session" >/dev/null 2>&1
  fi
  timeout 120 muninn context refresh >/dev/null 2>&1
' </dev/null >/dev/null 2>&1 &

exit 0
