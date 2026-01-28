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
