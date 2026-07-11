#!/bin/bash
# Seed helper script
# Rebuilds better-sqlite3 for system Node, runs seed, then rebuilds for Electron
# Usage: bash scripts/seed.sh

set -e
cd "$(dirname "$0")/.."

echo "=== Rebuilding better-sqlite3 for system Node.js ==="
npm rebuild better-sqlite3

echo ""
echo "=== Seeding demo data ==="
node database/seed.js

echo ""
echo "=== Rebuilding better-sqlite3 for Electron ==="
npm run rebuild

echo ""
echo "=== Seed complete! ==="
echo "Run 'npm start' to launch the application."
