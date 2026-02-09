#!/usr/bin/env bun
/**
 * Install Muninn Claude Code hooks.
 *
 * 1. Symlinks hooks/*.sh from the repo into ~/.claude/hooks/context-integration/
 * 2. Merges hook registrations into ~/.claude/settings.json (preserves non-muninn hooks)
 *
 * Idempotent: safe to re-run. Removes stale entries before adding fresh ones.
 */

import {
  existsSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  lstatSync,
  readlinkSync,
} from "fs"
import { join, resolve } from "path"

const REPO_HOOKS = resolve(import.meta.dir, "../hooks")
const HOME = process.env.HOME
if (!HOME) {
  console.error("  ERROR: HOME not set")
  process.exit(1)
}

const CLAUDE_DIR = join(HOME, ".claude")
const TARGET_DIR = join(CLAUDE_DIR, "hooks", "context-integration")
const SETTINGS = join(CLAUDE_DIR, "settings.json")

// ---------------------------------------------------------------------------
// 1. Symlink hook scripts
// ---------------------------------------------------------------------------

mkdirSync(TARGET_DIR, { recursive: true })

const hookFiles = readdirSync(REPO_HOOKS).filter((f) => f.endsWith(".sh"))
if (hookFiles.length === 0) {
  console.error("  ERROR: No .sh files found in hooks/")
  process.exit(1)
}

for (const file of hookFiles) {
  const source = join(REPO_HOOKS, file)
  const target = join(TARGET_DIR, file)

  // Remove existing entry (file, broken symlink, or valid symlink)
  try {
    const stat = lstatSync(target)
    if (stat) unlinkSync(target)
  } catch {
    // Doesn't exist — fine
  }

  symlinkSync(source, target)
  console.log(`  Linked ${file} -> ${target}`)
}

// Remove stale .sh files in target that are NOT in the repo hooks dir
try {
  for (const file of readdirSync(TARGET_DIR).filter((f) => f.endsWith(".sh"))) {
    if (!hookFiles.includes(file)) {
      const stale = join(TARGET_DIR, file)
      try {
        const stat = lstatSync(stale)
        // Only remove if it's a symlink (don't delete user-created scripts)
        if (stat.isSymbolicLink()) {
          unlinkSync(stale)
          console.log(`  Removed stale symlink: ${file}`)
        }
      } catch {
        // ignore
      }
    }
  }
} catch {
  // ignore readdir errors
}

// ---------------------------------------------------------------------------
// 2. Merge hook registrations into settings.json
// ---------------------------------------------------------------------------

/** Hook definitions that Muninn registers with Claude Code */
const MUNINN_HOOKS: Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>> = {
  PreToolUse: [
    {
      matcher: 'tool == "Edit" || tool == "Write"',
      hooks: [
        {
          type: "command",
          command: "~/.claude/hooks/context-integration/enforce-check.sh",
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: 'tool == "Edit" || tool == "Write"',
      hooks: [
        {
          type: "command",
          command: "~/.claude/hooks/context-integration/post-edit-track.sh",
        },
      ],
    },
  ],
  SessionStart: [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "~/.claude/hooks/context-integration/session-start-context.sh",
        },
      ],
    },
  ],
  Stop: [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "~/.claude/hooks/context-integration/session-end-context.sh",
        },
      ],
    },
  ],
  UserPromptSubmit: [
    {
      matcher: "*",
      hooks: [
        {
          type: "command",
          command: "~/.claude/hooks/context-integration/user-prompt-context.sh",
        },
      ],
    },
  ],
}

/** Check if a hook group contains a context-integration command */
function isMuninnHookGroup(group: { hooks?: Array<{ command?: string }> }): boolean {
  return (group.hooks ?? []).some((h) => (h.command ?? "").includes("context-integration/"))
}

// Read existing settings (or start fresh)
let settings: Record<string, unknown> = {}
if (existsSync(SETTINGS)) {
  try {
    const raw = readFileSync(SETTINGS, "utf-8")
    settings = JSON.parse(raw)
  } catch (err) {
    // Corrupt JSON — backup and start fresh
    const backup = SETTINGS + ".backup"
    try {
      renameSync(SETTINGS, backup)
      console.log(`  WARNING: settings.json was corrupt — backed up to ${backup}`)
    } catch {
      console.log("  WARNING: settings.json was corrupt and could not be backed up")
    }
    settings = {}
  }
}

// Ensure hooks object exists
const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>
settings.hooks = hooks

// For each hook type: remove old muninn entries, append fresh ones
for (const [type, muninnEntries] of Object.entries(MUNINN_HOOKS)) {
  const existing = (hooks[type] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>

  // Filter out any existing muninn hook groups
  const filtered = existing.filter((group) => !isMuninnHookGroup(group))

  // Append fresh muninn entries
  hooks[type] = [...filtered, ...muninnEntries]
}

// Atomic write: write to .tmp then rename
const tmp = SETTINGS + ".tmp"
writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n")
renameSync(tmp, SETTINGS)

console.log("  Settings updated: ~/.claude/settings.json")

// Summary
const total = Object.values(MUNINN_HOOKS).reduce((sum, entries) => sum + entries.length, 0)
console.log(`  Registered ${total} hook(s) across ${Object.keys(MUNINN_HOOKS).length} event types`)
