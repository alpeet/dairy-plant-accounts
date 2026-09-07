#!/bin/bash
# Create a portable ZIP package for Windows
# Run this on macOS/Linux to create a ZIP the user can extract on Windows

set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$DIR/dist-portable"
PACKAGE_NAME="Prarambha-Excel-Import-Portable"

echo ""
echo "  Creating portable Windows package..."
echo ""

# Clean previous build
rm -rf "$OUT"
mkdir -p "$OUT/$PACKAGE_NAME"

# Copy required files
echo "  Copying files..."
cp "$DIR/import-excel-upsert.js"        "$OUT/$PACKAGE_NAME/"
cp "$DIR/Import-Excel-Portable.bat"     "$OUT/$PACKAGE_NAME/"
cp "$DIR/Dairy_Accounts_Professional.xlsx" "$OUT/$PACKAGE_NAME/" 2>/dev/null || true
cp "$DIR/package.json"                  "$OUT/$PACKAGE_NAME/"
cp -r "$DIR/database"                   "$OUT/$PACKAGE_NAME/"

# Copy better-sqlite3 prebuilt for Windows (if available)
echo "  Checking for Windows native modules..."
if [ -d "$DIR/node_modules/better-sqlite3" ]; then
    mkdir -p "$OUT/$PACKAGE_NAME/node_modules/better-sqlite3"
    cp "$DIR/node_modules/better-sqlite3/package.json" "$OUT/$PACKAGE_NAME/node_modules/better-sqlite3/" 2>/dev/null || true
    # The .bat launcher will run npm install on first run to get correct Windows binaries
fi

# Create a README
cat > "$OUT/$PACKAGE_NAME/README.txt" << 'EOF'
PRARAMBHA - EXCEL UPSERT IMPORT (PORTABLE)
===========================================

HOW TO USE:
  1. Double-click "Import-Excel-Portable.bat"
  2. On first run, it downloads Node.js (~30MB) automatically
  3. Then installs dependencies and runs the import

REQUIREMENTS:
  - Windows 10/11 (64-bit)
  - Internet connection (first run only, to download Node.js)
  - Dairy_Accounts_Professional.xlsx in this folder

WHAT IT DOES:
  - Reads data from Dairy_Accounts_Professional.xlsx
  - Updates existing records and adds new ones
  - Does NOT delete any existing data

FILES:
  Import-Excel-Portable.bat     - Double-click to run
  import-excel-upsert.js        - Import script
  Dairy_Accounts_Professional.xlsx - Your Excel data file
  database/schema.sql           - Database schema
  package.json                  - Dependencies list

TROUBLESHOOTING:
  - If download fails, manually install Node.js from https://nodejs.org
  - Place the Excel file in the same folder as the .bat file
  - Run as Administrator if you get permission errors
EOF

# Create ZIP
echo "  Creating ZIP archive..."
cd "$OUT"
zip -r "$PACKAGE_NAME.zip" "$PACKAGE_NAME/" -x "*.DS_Store" "*node_modules*" "*.git*"

echo ""
echo "  ✅ Package created: $OUT/$PACKAGE_NAME.zip"
echo "  📦 Size: $(du -h "$OUT/$PACKAGE_NAME.zip" | cut -f1)"
echo ""
echo "  Transfer this ZIP to your Windows machine, extract, and double-click"
echo "  Import-Excel-Portable.bat to run."
echo ""
