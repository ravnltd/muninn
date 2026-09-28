# Plan: fix the hook/MCP split brain (2026-09-28)

Status: planned, not started. Review before executing.

## Diagnosis (verified 2026-09-28 on node1)

1. **Two databases.** MCP server is registered `MUNINN_MODE=http` → sqld hub
   at `http://127.0.0.1:8081` (docker `muninn-sqld`). Hooks call bare `muninn`,
   which reads mode only from env (`src/config/index.ts:33`, default `local`).
   Claude Code passes no muninn env to hooks, so every hook-driven command
   (`context refresh`, `session end`, `hook post-edit`, `session digest`) runs
   against `~/.muninn/memory.db`. Writes from `remember`/`track` go to the hub
   and never come back through injection.

   | | Hub | Local file |
   |---|---|---|
   | Projects | 20 | 1 |
   | Decisions | 36 | 10 |
   | Permanent decisions | 5 | 3 |
   | Sessions | 291 | 1937 |
   | Files for /home/ross/muninn | 0 | 3432 |

2. **All repos collapse into one local project.** Local-mode rename detection
   in `src/database/connection/ensure.ts` (lines ~30-60) re-paths the project
   with the most files to whatever cwd the hook runs in. The single local
   project has been repointed 60 times (see `previous_paths`). Result:
   orientation shows other repos' issues, zero per-file bundles here
   (`meta.json`: bundles 0, skipped 190), 1937 auto-sessions.

3. **Global memory drops the body.** `differs()` in `src/v9/context-cache.ts:818`
   suppresses the body when it starts with the title. Titles are the first
   ~57 chars of the body, so it always does. Injected rule reads
   "NEVER put his" with nothing after it. Hub decisions 14 and 15
   (2026-09-14, permanent) never reach any session.

Intermittent MCP errors were noise: two sqld 429s in September, "executable
not found" errors are from February.

## Fix (est. 30-45 min on this box)

### A. Config file fallback (~10 min)
- `src/config/index.ts`: resolution order env → `~/.muninn/config.json` →
  default local. Zod-validate the file `{ mode, primaryUrl }`.
- `install.sh`: when `MUNINN_MODE=http` and `MUNINN_PRIMARY_URL` are set,
  write `~/.muninn/config.json`. Add `muninn config set mode http url <u>`
  or equivalent so it can be done without reinstalling.
- Test: config loads from file when env unset; env still wins.

### B. global.md body (~5 min)
- Replace `differs()` with: append body when `body.length > title.length + 10`,
  strip the title prefix from the body if present so it doesn't repeat.
- Test: permanent decision with truncated title renders full text.

### C. Reconcile this box (~10 min)
- `mv ~/.muninn/memory.db ~/.muninn/memory.db.split-brain-2026-09-28.bak`
  (discard the 1937 auto-sessions; they carry no goals or digests).
- Write `~/.muninn/config.json` → http, `http://127.0.0.1:8081`.
- `muninn context refresh` in each active repo: muninn, intelligence-engine,
  geo-email, elsker, raven-intelligence, denveropenmic, dmv-wt/content.
- Confirm hub project 20 (`/home/ross/muninn`) gets files indexed; hub
  currently has 0 files for it.

### D. Verify (~10-15 min)
- Fresh session in two repos: orientation shows that repo's issues only,
  global.md shows full rule text, per-file bundles appear on Read.
- `muninn status` from a hook-like env (`env -i PATH=$PATH muninn status`)
  reports HTTP mode.
- Stop hook ends the hub session (check `sessions.ended_at`).

### E. Mac (separate pass, after push)
- Fleet update command from CLAUDE.md, then write config.json with the
  Tailscale hub URL, then `context refresh` per repo. Same split almost
  certainly exists there (Mac sessions on hub come from MCP only).

## Not in scope
- Hub schema changes (none needed).
- Reworking rename detection; it becomes moot once local mode is not used
  on fleet machines. Consider guarding it behind an explicit flag later.
