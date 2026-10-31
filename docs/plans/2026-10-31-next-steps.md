# Muninn: where things stand and what's next (2026-10-31)

## Shipped 2026-10-30/31

- **v10.1.0 (Phase 0)**
  - `~/.muninn/config.json` gives hooks and MCP one shared mode: the split brain is fixed.
  - Session end moved from the Stop hook (every turn) to SessionEnd.
  - Permanent rules render in full.
  - `remember` and `track` integrity fixes; FTS matches any word.
  - Tests isolated from the real home directory.
  - CI on the self-hosted node1 runner.
- **Hub stability**
  - The HTTP adapter closes every hrana stream. Unclosed streams exhausted sqld's pool and caused a 429 outage.
  - Batches are atomic and surface `step_errors`.
- **Repo identity**
  - Migration 52: `projects.repo_key` (owner/repo from origin) and `project_locations` (each checkout per machine).
  - Lookup order: this machine's checkout → root path → legacy per-dir row → repo key.
  - `muninn projects dupes` and `muninn projects merge <from> <into> [--dry-run]`, with paged JSON backups in `~/.muninn/merge-backups/`.
  - Merged: raven-intelligence Mac→node1, elsker lanes→elsker, `/tmp`→home. Deleted 9 empty strays. 44 → 31 projects.
- **Fleet**
  - node1 (the hub host), Helsinki, coid, node2 and the Mac are all on the hub.
  - All run `install.sh`'s cron auto-update every 10 min (`scripts/auto-update.sh`): fast-forward, build check, rollback, skip dirty checkouts. Log: `~/.muninn/auto-update.log`.
- **Attribution guard**
  - `install-hooks` forces attribution off in settings.
  - A PreToolUse hook blocks Claude attribution in git, gh and GitHub MCP calls, including `git commit -F` files.
- **Cleanup**
  - Migration 53 drops 7 dead tables; `GLOBAL_DDL` no longer recreates `deployments`.
  - CI cancels superseded runs.

## Working rules learned

- **On node1, `~/muninn` is the live install.** Saving a file deploys it, migrations included. Develop in a worktree (`git worktree add ~/muninn-<topic>`, symlink `node_modules`).
- **Rehearse migrations first.** Copy `~/muninn-hub` and run a throwaway sqld:
  ```
  docker run -d --rm --name muninn-sqld-rehearsal --memory=512m -p 127.0.0.1:18081:8080 -v <copy>:/var/lib/sqld ghcr.io/tursodatabase/libsql-server:latest
  ```
  Then point the CLI at it with `MUNINN_MODE=http MUNINN_PRIMARY_URL=http://127.0.0.1:18081`.
- **Every push to main reaches every machine within about 10 minutes.** The pre-commit hook (typecheck, lint, full suite) is the gate. Run commits through `node1-heavy`.

## Open items

- **work-m4-macbook:** offline. When it's back, run:
  ```
  cd ~/.local/share/muninn && git fetch origin && git merge --ff-only origin/main && ./install.sh
  ```
  If history diverged, use `git reset --hard origin/main` instead of the merge.
- **Hub issue #49:** a fresh local-mode database fails ("Migration 1 validation failed / no such table: projects"). The fleet is all in HTTP mode, so nothing live is affected.

## Next: Step 1, hub security and safety

1. **Per-machine hub tokens.** sqld JWT auth, one revocable token per machine, written to that machine's `config.json` as `authToken`. The adapter already sends `Authorization: Bearer`. Roll out without an outage: give every machine its token first, then turn on enforcement.
2. **Hub watchdog.** A health probe that runs a real query (not just `/health`, which stayed 200 during the 429 lockup). It restarts `muninn-sqld` on failure and sends an alert.
3. **Nightly hub snapshots** with retention, taken safely while sqld runs.

## After that

Design doc: "Muninn for Both of Us", https://claude.ai/artifact/5gB4daiGA5bc3q4T7geEMU. Single tenant, decided (no SaaS).

- **Step 2:** park `cloud/` and `api/` in `ravnltd/muninn-cloud`; add `engine = "v10" | "daemon"` to `config.json`.
- **Step 3:** muninnd. The edge role on every machine (local socket for hooks and MCP, offline write queue, live caches); the hub role on node1 (append-only event log).
- **Step 4:**
  - Approved hard rules go to `~/.claude/rules/muninn-rules.md` and repo rules files.
  - A review inbox for proposed memories.
  - Real usefulness labels on injections.
- **Step 5:** dashboard views: Rules, Now, Sessions, Fleet, Quality, Preview.
- **Step 6:** retire the v10 internals the daemon replaces.
