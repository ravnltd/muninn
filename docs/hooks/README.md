# Claude Code Hooks for Muninn

This directory contains example hook configurations for integrating Muninn with Claude Code.

## Quick Setup

Copy the example settings to your Claude Code configuration:

```bash
# Backup existing settings (if any)
cp ~/.claude/settings.json ~/.claude/settings.json.backup 2>/dev/null

# Copy example settings
cp docs/hooks/settings.example.json ~/.claude/settings.json
```

Or merge the hook configurations into your existing settings manually.

## Hook Types

### SessionStart

**When**: Runs when a new Claude Code session begins.

**Purpose**:
- Auto-initializes the `.claude/` database for the project
- Loads context from the last session (goal, outcome, next steps)
- Shows smart status (health, warnings, actions needed)
- Starts a new session automatically

### PreToolUse (Edit/Write)

**When**: Runs before Claude edits or writes a file.

**Purpose**:
- Checks file fragility score
- Warns about high-risk files (fragility >= 7)
- Can block edits to force explanation of approach

### PostToolUse (Edit/Write)

**When**: Runs after Claude edits or writes a file.

**Purpose**:
- Tracks which files were modified in the session
- Reminds to update file knowledge for new files
- Notes when fragile files are modified

### Stop

**When**: Runs when the Claude Code session ends.

**Purpose**:
- Saves session state (files touched, outcome)
- Ensures continuity for next session

## Files

- `settings.example.json` - Complete example Claude Code settings with all hooks
- `session-start.sh` - SessionStart hook script
- `pre-edit.sh` - PreToolUse hook for Edit/Write tools
- `post-edit.sh` - PostToolUse hook for Edit/Write tools
- `session-end.sh` - Stop hook script

## Installation

1. Copy hook scripts to `~/.claude/hooks/`:

```bash
mkdir -p ~/.claude/hooks
cp docs/hooks/*.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/*.sh
```

2. Update `~/.claude/settings.json` with the hook configurations (see `settings.example.json`)

3. Restart Claude Code

## Customization

### Fragility Threshold

By default, files with fragility >= 7 trigger warnings. Adjust in `pre-edit.sh`:

```bash
THRESHOLD=7  # Change to your preference (1-10)
```

### Blocking vs Warning

The pre-edit hook can either warn or block:
- **Warn**: Shows message but allows edit (default)
- **Block**: Requires explanation before proceeding

To enable blocking, the hook script exits with code 1.

## Context Enrichment Hooks

Muninn includes a powerful context enrichment system that automatically injects relevant context before tool calls.

### Enrichment Hook Setup

Add the enrichment hook to inject context before Read/Edit/Write operations:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write",
        "hooks": [{
          "type": "command",
          "command": "muninn enrich $TOOL_NAME \"$TOOL_INPUT\""
        }]
      }
    ]
  }
}
```

### What Enrichment Provides

When you read or edit a file, the enrichment layer automatically surfaces:

1. **File Knowledge** - Fragility score, purpose, type, dependencies
2. **Blocking** - Hard blocks on fragility >= 9, soft blocks on 8
3. **Learnings** - Relevant patterns and gotchas
4. **Issues** - Open issues affecting the file
5. **Decisions** - Active architectural decisions
6. **Blast Radius** - Impact score if file is modified
7. **Correlations** - Files that often change together
8. **Test Files** - Related tests to update

### Output Format (Transformer-Native)

Enrichment uses a dense, token-efficient format:

```
## Muninn Context (auto-injected)
F[src/auth/login.ts|frag:8|purpose:User auth flow|deps:12]
K[gotcha|ent:auth,jwt|when:token refresh|do:check expiry race|conf:90]
D[JWT over sessions|choice:stateless|why:horizontal scaling|conf:85]
I[#23|sev:7|Race condition in token refresh]
B[score:45|direct:8|trans:24|tests:3|risk:medium]
R[cochangers:session.ts,middleware.ts|tests:auth.test.ts]
```

### Approval Workflow

When editing a file with fragility >= 9:

1. Enrichment blocks the operation with an operation ID
2. You must either:
   - Explain your approach (soft block)
   - Run `muninn approve <operation-id>` (hard block)
3. Then retry the edit

Example blocked message:
```
!BLOCKED: Fragility 9/10 - This file is critical.
File: src/core/engine.ts

To proceed: muninn approve op_abc123
```

### MCP Tools

Use these MCP tools for enrichment:

- `muninn_enrich` - Auto-inject context for a tool call
- `muninn_approve` - Approve a blocked operation

### CLI Commands

```bash
# Run enrichment for a tool call
muninn enrich Edit '{"file_path": "src/index.ts"}'

# Approve a blocked operation
muninn approve op_abc123

# Check enrichment engine status
muninn enrich-status
```
