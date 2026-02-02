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
