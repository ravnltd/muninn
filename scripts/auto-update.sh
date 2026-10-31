#!/bin/bash
# Fast-forward this muninn install to origin/main, verify it, roll back on failure.
#
# Run by cron every 10 minutes (installed by install.sh). Never touches a
# checkout that has local changes, is off main, or has commits origin lacks:
# on node1 ~/muninn is the dev checkout, and on any machine it is the live install.

set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${MUNINN_HOME:-$HOME/.muninn}"
LOG="$STATE/auto-update.log"
LOCK="$STATE/auto-update.lock"
export PATH="$HOME/.bun/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

mkdir -p "$STATE"
# Keep the log short: last 500 lines
[ -f "$LOG" ] && [ "$(wc -l <"$LOG")" -gt 1000 ] && tail -n 500 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
exec >>"$LOG" 2>&1
log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# mkdir is atomic everywhere (flock is not on macOS); clear a lock left by a crash after 30 min
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ] && rmdir "$LOCK" && mkdir "$LOCK" || exit 0
fi
trap 'rmdir "$LOCK"' EXIT

cd "$REPO" || exit 1
[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || { log "skip: not on main"; exit 0; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { log "skip: local changes"; exit 0; }
git fetch -q origin main || { log "skip: fetch failed"; exit 0; }

old=$(git rev-parse HEAD)
new=$(git rev-parse origin/main)
[ "$old" = "$new" ] && exit 0
git merge-base --is-ancestor "$old" "$new" || { log "skip: local commits not on origin/main"; exit 0; }

changed=$(git diff --name-only "$old" "$new")
deps_changed() { grep -qE '^(package\.json|bun\.lock)' <<<"$changed"; }

rollback() {
  log "FAILED ($1): rolling back to ${old:0:7}"
  git reset -q --hard "$old"
  deps_changed && bun install --frozen-lockfile >/dev/null
  exit 1
}

git merge -q --ff-only "$new" || rollback "merge"
if deps_changed; then bun install --frozen-lockfile >/dev/null || rollback "bun install"; fi
out=$(mktemp -d)
bun build ./src/index.ts ./src/mcp-server.ts --target=bun --outdir="$out" >/dev/null
built=$?
rm -rf "$out"
[ "$built" -eq 0 ] || rollback "build check"
if grep -qE '^(hooks/|scripts/install-hooks\.ts)' <<<"$changed"; then
  bun run scripts/install-hooks.ts >/dev/null || log "warn: install-hooks failed"
fi
log "updated ${old:0:7} -> ${new:0:7}"
