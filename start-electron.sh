#!/usr/bin/env bash
#
# Godhuli Dairy Plant - Portable Electron Desktop Launcher (macOS / Linux)
# ========================================================================
# Run this script from a USB drive or any folder to open the app
# as a desktop window (no browser needed).
#
# All data stays LOCAL — nothing is stored on the host computer.
# The database is at:  ./data/dairy-plant.db  (relative to this script)
#
# Requirements: Node.js 16+ must be installed on the host machine.
#
# Usage:
#   ./start-electron.sh          # normal mode
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Check for node
if ! command -v node &> /dev/null; then
    echo ""
    echo "  ❌ Node.js is not installed!"
    echo "     Please install Node.js 16+ from https://nodejs.org"
    echo "     Then run this script again."
    echo ""
    read -p "  Press Enter to open the Node.js download page..." </dev/null
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "https://nodejs.org"
    else
        xdg-open "https://nodejs.org" 2>/dev/null || true
    fi
    exit 1
fi

echo ""
echo "  🐄 Godhuli Dairy Plant — Desktop App"
echo "  ─────────────────────────────────────"
echo "  Node.js:  $(node -v)"
echo ""

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "  📦 Installing dependencies (one-time)..."
    echo ""
    npm install 2>&1 | tail -5
    echo ""
    echo "  ✅ Dependencies installed!"
    echo ""
fi

echo "  🚀 Launching desktop app..."
echo "  (The app window will open shortly)"
echo ""

# 🔑 Set database directory to stay alongside the app (portable mode)
# Data stays on the USB drive — nothing stored on the host computer.
export DB_DIR="${SCRIPT_DIR}/data"

npm run start:electron
