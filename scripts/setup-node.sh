#!/bin/bash
# Muninn Network Node Setup Script
# Run this on any Tailscale-connected server to connect to the central Muninn database

set -e

PRIMARY_URL="http://YOUR_SQLD_HOST:8080"
MUNINN_REPO="https://github.com/ravnltd/muninn.git"
INSTALL_DIR="${MUNINN_DIR:-$HOME/muninn}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Muninn Network Node Setup ===${NC}\n"

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v bun &> /dev/null; then
    echo -e "${YELLOW}Bun not found. Installing...${NC}"
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi
echo -e "  ${GREEN}✓${NC} Bun: $(bun --version)"

if ! command -v git &> /dev/null; then
    echo -e "${RED}✗ Git not found. Please install git first.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Git: $(git --version | cut -d' ' -f3)"

if ! command -v tailscale &> /dev/null; then
    echo -e "${RED}✗ Tailscale not found. Please install and connect to tailnet first.${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Tailscale: connected"

# Test connectivity to primary
echo -e "\nTesting connection to primary ($PRIMARY_URL)..."
if curl -s -f -X POST "$PRIMARY_URL/" -H "Content-Type: application/json" -d '{"statements": ["SELECT 1"]}' > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Primary reachable"
else
    echo -e "${RED}✗ Cannot reach primary at $PRIMARY_URL${NC}"
    echo "  Make sure you're connected to Tailscale and the primary is running."
    exit 1
fi

# Clone or update repo
echo -e "\nSetting up Muninn..."
if [ -d "$INSTALL_DIR" ]; then
    echo "  Updating existing installation at $INSTALL_DIR"
    cd "$INSTALL_DIR"
    git pull --ff-only 2>/dev/null || echo "  (skipping git pull)"
else
    echo "  Cloning to $INSTALL_DIR"
    git clone "$MUNINN_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install dependencies
echo -e "\nInstalling dependencies..."
bun install --silent

# Configure environment
echo -e "\nConfiguring environment..."

SHELL_RC="$HOME/.bashrc"
[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"

# Check if already configured
if grep -q "MUNINN_MODE=network" "$SHELL_RC" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} Already configured in $SHELL_RC"
else
    echo "" >> "$SHELL_RC"
    echo "# Muninn Network Mode" >> "$SHELL_RC"
    echo "export MUNINN_MODE=network" >> "$SHELL_RC"
    echo "export MUNINN_PRIMARY_URL=$PRIMARY_URL" >> "$SHELL_RC"
    echo -e "  ${GREEN}✓${NC} Added to $SHELL_RC"
fi

# Export for current session
export MUNINN_MODE=network
export MUNINN_PRIMARY_URL="$PRIMARY_URL"

# Initialize network mode
echo -e "\nInitializing network mode..."
cd "$INSTALL_DIR"
bun run src/index.ts network init 2>&1 | grep -v "^{" || true

# Verify
echo -e "\nVerifying setup..."
RESULT=$(bun run src/index.ts network status 2>&1)
if echo "$RESULT" | grep -q "connected.*true\|Mode: network"; then
    echo -e "  ${GREEN}✓${NC} Connected to Muninn network"
else
    echo -e "  ${YELLOW}!${NC} Check status with: muninn network status"
fi

# Create alias
if ! grep -q "alias muninn=" "$SHELL_RC" 2>/dev/null; then
    echo "alias muninn='bun run $INSTALL_DIR/src/index.ts'" >> "$SHELL_RC"
    echo -e "  ${GREEN}✓${NC} Added 'muninn' alias"
fi

echo -e "\n${GREEN}=== Setup Complete ===${NC}"
echo ""
echo "Run 'source $SHELL_RC' or start a new terminal, then:"
echo "  muninn network status   # Check connection"
echo "  muninn query \"topic\"    # Search knowledge"
echo ""
