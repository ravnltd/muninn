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

# Compile CLI
echo "Compiling CLI..."
cd "$SCRIPT_DIR"
bun build ./src/index.ts --compile --outfile "$INSTALL_DIR/muninn"
chmod +x "$INSTALL_DIR/muninn"
echo "✓ CLI installed to $INSTALL_DIR/muninn"

# Compile MCP server
echo "Compiling MCP server..."
bun build ./src/mcp-server.ts --compile --outfile "$INSTALL_DIR/muninn-mcp"
chmod +x "$INSTALL_DIR/muninn-mcp"
echo "✓ MCP server installed to $INSTALL_DIR/muninn-mcp"

# Check if in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "⚠️  Add to your shell profile (~/.bashrc or ~/.zshrc):"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

# Verify installation
if command -v muninn &> /dev/null; then
    echo ""
    echo "✓ Installation complete!"
    echo ""
    echo "Next steps:"
    echo "  1. Register MCP server with Claude Code:"
    echo "     claude mcp add --scope user muninn -- muninn-mcp"
    echo ""
    echo "  2. Verify:"
    echo "     muninn --help"
    echo "     claude mcp list"
else
    echo ""
    echo "Installation complete. Restart your shell or run:"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
