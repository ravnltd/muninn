#!/bin/bash
# Install Claude Context CLI globally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
CLAUDE_DIR="${HOME}/.claude"

echo "Installing Claude Context CLI..."

# Create directories
mkdir -p "$INSTALL_DIR"
mkdir -p "$CLAUDE_DIR"

# Copy schema
cp "$SCRIPT_DIR/schema.sql" "$CLAUDE_DIR/schema.sql"
echo "✓ Schema installed to $CLAUDE_DIR/schema.sql"

# Compile to standalone binary
echo "Compiling CLI..."
cd "$SCRIPT_DIR"
bun build context.ts --compile --outfile "$INSTALL_DIR/context"
chmod +x "$INSTALL_DIR/context"
echo "✓ CLI installed to $INSTALL_DIR/context"

# Check if in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "⚠️  Add to your shell profile (~/.bashrc or ~/.zshrc):"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
fi

# Verify installation
if command -v context &> /dev/null; then
    echo "✓ Installation complete! Run 'context' to verify."
else
    echo "Installation complete. Restart your shell or run:"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
