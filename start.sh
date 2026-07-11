#!/usr/bin/env bash
#
# Godhuli Dairy Plant - Portable Launcher (macOS / Linux)
# ========================================================
# Run this script from a USB drive to start the application.
# The database and all data stay local — nothing is installed
# system-wide.
#
# Requirements: Node.js 16+ must be installed on the host machine.
#
# Usage:
#   ./start.sh          # normal mode
#   ./start.sh --port 8080   # custom port
#

set -e

PORT=3000
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

# Parse port argument
if [[ "$1" == "--port" && -n "$2" ]]; then
    PORT="$2"
fi

NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])")
echo ""
echo "  🐄 Godhuli Dairy Plant"
echo "  ───────────────────────"
echo "  Node.js:  $(node -v)"
echo "  Port:     $PORT"
echo ""

# Install dependencies if missing
if [ ! -d "node_modules" ]; then
    echo "  📦 Installing dependencies (one-time)..."
    echo ""
    npm install --omit=optional 2>&1 | tail -5
    echo ""
    echo "  ✅ Dependencies installed!"
    echo ""
fi

# Checkpoint database (merge WAL into main file) for clean state
if [ -f "data/dairy-plant.db-wal" ]; then
    node -e "
        try {
            const Database = require('better-sqlite3');
            const db = new Database('./data/dairy-plant.db');
            db.pragma('journal_mode = DELETE');
            db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
            db.close();
        } catch(e) {}
    " 2>/dev/null || true
fi

echo "  🚀 Starting server..."
echo ""

PORT=$PORT node server.js

echo ""
echo "  Server stopped."
