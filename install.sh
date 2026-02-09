#!/bin/bash
# Install Muninn CLI and MCP server globally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"

echo "Installing Muninn..."

# Check for Bun
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is required. Install it with:"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
fi

# Create directories
mkdir -p "$INSTALL_DIR"

# Install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR"
    bun install
fi

# Create CLI wrapper script (runs from source to support native modules)
echo "Creating CLI wrapper..."
cat > "$INSTALL_DIR/muninn" << EOF
#!/bin/bash
exec bun run "$SCRIPT_DIR/src/index.ts" "\$@"
EOF
chmod +x "$INSTALL_DIR/muninn"
echo "✓ CLI installed to $INSTALL_DIR/muninn"

# Create MCP server wrapper script
echo "Creating MCP server wrapper..."
cat > "$INSTALL_DIR/muninn-mcp" << EOF
#!/bin/bash
exec bun run "$SCRIPT_DIR/src/mcp-server.ts" "\$@"
EOF
chmod +x "$INSTALL_DIR/muninn-mcp"
echo "✓ MCP server installed to $INSTALL_DIR/muninn-mcp"

# Create background worker wrapper script
echo "Creating worker wrapper..."
cat > "$INSTALL_DIR/muninn-worker" << EOF
#!/bin/bash
exec bun run "$SCRIPT_DIR/src/worker.ts" "\$@"
EOF
chmod +x "$INSTALL_DIR/muninn-worker"
echo "✓ Worker installed to $INSTALL_DIR/muninn-worker"

# Install Claude Code hooks (symlinks + settings.json merge)
echo ""
echo "Installing Claude Code hooks..."
if bun run "$SCRIPT_DIR/scripts/install-hooks.ts" 2>&1; then
    echo "✓ Claude Code hooks installed"
else
    echo "⚠️  Hook installation failed (non-critical)"
    echo "   Run manually: bun run $SCRIPT_DIR/scripts/install-hooks.ts"
fi

# Install git post-commit hook (if in a git repo)
install_git_hook() {
    local git_dir="$1"
    local hooks_dir="$git_dir/hooks"
    local hook_file="$hooks_dir/post-commit"

    mkdir -p "$hooks_dir"

    # Check if hook already has muninn
    if [ -f "$hook_file" ] && grep -q "muninn ingest commit" "$hook_file"; then
        echo "✓ Git hook already installed in $git_dir"
        return
    fi

    # Append to existing hook or create new one
    if [ -f "$hook_file" ]; then
        # Append to existing hook
        cat >> "$hook_file" << 'HOOKEOF'

# Muninn: auto-ingest git commits (background, non-blocking)
if command -v muninn &> /dev/null; then
    muninn ingest commit &>/dev/null &
fi
HOOKEOF
    else
        # Create new hook
        cat > "$hook_file" << 'HOOKEOF'
#!/bin/bash
# Muninn: auto-ingest git commits (background, non-blocking)
if command -v muninn &> /dev/null; then
    muninn ingest commit &>/dev/null &
fi
HOOKEOF
    fi

    chmod +x "$hook_file"
    echo "✓ Git post-commit hook installed in $git_dir"
}

# Offer to install git hook if in a git repo
if git rev-parse --git-dir &> /dev/null; then
    GIT_DIR="$(git rev-parse --git-dir)"
    echo ""
    echo "Git repository detected."
    if [ -t 0 ]; then
        read -p "Install post-commit hook for automatic tracking? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_git_hook "$GIT_DIR"
        fi
    else
        echo "To install the git hook manually:"
        echo "  muninn install-hook"
    fi
fi

# Check if in PATH
PATH_OK=false
if [[ ":$PATH:" == *":$INSTALL_DIR:"* ]]; then
    PATH_OK=true
fi

if [ "$PATH_OK" = false ]; then
    echo ""
    echo "⚠️  ~/.local/bin is not in your PATH"
    echo "   Add to your shell profile (~/.bashrc or ~/.zshrc):"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "   Then restart your shell or run:"
    echo "   source ~/.bashrc  # or ~/.zshrc"
    echo ""
fi

# Check for Claude Code and offer to register
if command -v claude &> /dev/null; then
    echo ""
    # Check if already registered
    if claude mcp list 2>/dev/null | grep -q "muninn"; then
        echo "✓ MCP server already registered with Claude Code"
        echo ""
        echo "To update the registration (if needed):"
        echo "  claude mcp remove muninn"
        echo "  claude mcp add --scope user muninn -- muninn-mcp"
    else
        echo "Register MCP server with Claude Code:"
        echo "  claude mcp add --scope user muninn -- muninn-mcp"
    fi
else
    echo ""
    echo "Claude Code not found in PATH."
    echo "After installing Claude Code, register the MCP server:"
    echo "  claude mcp add --scope user muninn -- muninn-mcp"
fi

# Final verification
echo ""
if [ "$PATH_OK" = true ] && command -v muninn &> /dev/null; then
    echo "✓ Installation complete!"
    echo ""
    echo "Verify with:"
    echo "  muninn --help"
    echo "  claude mcp list"
else
    echo "Installation complete."
    echo ""
    echo "After updating your PATH, verify with:"
    echo "  muninn --help"
fi
