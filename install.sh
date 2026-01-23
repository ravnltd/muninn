#!/bin/bash
# Install Claude Context CLI globally

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${HOME}/.local/bin"
echo "Installing Claude Context CLI..."

# Create directories
mkdir -p "$INSTALL_DIR"

# Compile to standalone binary
echo "Compiling CLI..."
cd "$SCRIPT_DIR"
bun build ./src/index.ts --compile --outfile "$INSTALL_DIR/context"
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
