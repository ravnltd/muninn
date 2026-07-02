#!/bin/bash
# PreCompact Hook: persist a session digest before context compaction.
#
# Compaction discards everything the summary misses. This extracts what the
# session was about (user goals, files edited) from the transcript and writes
# it to the hub — so the knowledge survives into future sessions on any
# machine. Runs fully detached; compaction is never delayed.

input=$(cat)

command -v jq >/dev/null 2>&1 || exit 0
command -v muninn >/dev/null 2>&1 || exit 0

transcript=$(echo "$input" | jq -r '.transcript_path // ""' 2>/dev/null)
[ -n "$transcript" ] && [ -f "$transcript" ] || exit 0

( timeout 60 muninn session digest "$transcript" >/dev/null 2>&1 & ) &

exit 0
