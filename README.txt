================================================================================
  GODHULI DAIRY PLANT — Accounts & Stock Management System
                    Setup & Running Guide
================================================================================

  This guide covers every way to run the application:
    • Locally (development)
    • Web app (browser-based)
    • Desktop app (Electron)
    • Windows
    • macOS / Linux
    • USB / Portable mode (no installation)


TABLE OF CONTENTS
-----------------

  1. PREREQUISITES
  2. QUICK START (WEB — Recommended)
  3. RUNNING ON WINDOWS
  4. RUNNING ON macOS / LINUX
  5. RUNNING AS DESKTOP APP (ELECTRON)
  6. USB / PORTABLE MODE
  7. CONFIGURATION
  8. DATA EXCHANGE (EXCEL / CSV)
  9. TROUBLESHOOTING


================================================================================
1. PREREQUISITES
================================================================================

  Before you begin, make sure you have:

  [✓] Node.js 16 or higher
      Download from: https://nodejs.org
      Verify:        node -v         (should show v16.x.x or higher)

  [✓] npm (comes with Node.js)
      Verify:        npm -v          (should show 8.x.x or higher)

  [✓] A terminal / command prompt
      Windows:       Command Prompt, PowerShell, or Git Bash
      macOS/Linux:   Terminal

  [✓] (Optional) Git
      Only needed if cloning from a repository.
      Download:      https://git-scm.com



================================================================================
2. QUICK START (WEB MODE — Recommended for most users)
================================================================================

  This is the easiest way to use the app. Open it in any browser.

  ── Step 1: Open a terminal ──

    Windows:  Open "Command Prompt" or "PowerShell"
    macOS:    Open "Terminal" (⌘+Space → type "Terminal")
    Linux:    Open "Terminal"

  ── Step 2: Navigate to the project folder ──

    cd path/to/dairy-plant-accounts

    (Replace "path/to" with the actual location of the folder)

  ── Step 3: Install dependencies (one-time only) ──

    npm install --omit=optional

    Wait for it to finish. You'll see:
      "✅ better-sqlite3 rebuilt successfully"
      or
      "✅ better-sqlite3 is already compatible"

  ── Step 4: Start the web server ──

    npm start
    # OR
    node server.js

    You'll see:
      🐄  Godhuli Dairy Plant — Web Server
      URL:       http://localhost:3000
      Login:     http://localhost:3000/login

  ── Step 5: Open in your browser ──

    Open Chrome, Firefox, Edge, or Safari and go to:
      http://localhost:3000

  ── Step 6: Log in ──

    Username:  admin
    Password:  admin123

    (Change these in production — see Section 7)


  ── To stop the server ──

    Press Ctrl+C in the terminal window.



================================================================================
3. RUNNING ON WINDOWS
================================================================================

  ─── 3a. One-Click Launcher (Easiest) ───

    Simply double-click the file:
      start.bat

    The script will:
      1. Check if Node.js is installed
      2. Install dependencies automatically (first time only)
      3. Start the web server
      4. Open http://localhost:3000 in your default browser

    To use a custom port:
      start.bat --port 8080

  ─── 3b. Manual Setup (Command Prompt) ───

    Open "Command Prompt" (cmd.exe) and run:

      cd C:\path\to\dairy-plant-accounts
      npm install --omit=optional
      npm start

    Then open http://localhost:3000 in your browser.

  ─── 3c. Desktop App Mode (Electron) ───

    Double-click:
      start-electron.bat

    OR manually:

      cd C:\path\to\dairy-plant-accounts
      npm install            (installs Electron too — slower)
      npm run seed           (optional: load demo data)
      npm run start:electron



================================================================================
4. RUNNING ON macOS / LINUX
================================================================================

  ─── 4a. One-Click Launcher (Easiest) ───

    Open Terminal and run:

      cd /path/to/dairy-plant-accounts
      chmod +x start.sh      (only needed first time)
      ./start.sh

    The script will:
      1. Check if Node.js is installed
      2. Install dependencies automatically (first time only)
      3. Start the web server
      4. Tell you to open http://localhost:3000

    To use a custom port:
      ./start.sh --port 8080

  ─── 4b. Manual Setup ───

      cd /path/to/dairy-plant-accounts
      npm install --omit=optional
      npm start

    Then open http://localhost:3000 in your browser.

  ─── 4c. Desktop App Mode (Electron) ───

    Run:

      ./start-electron.sh

    OR manually:

      cd /path/to/dairy-plant-accounts
      npm install
      npm run seed           (optional: load demo data)
      npm run start:electron



================================================================================
5. RUNNING AS DESKTOP APP (ELECTRON)
================================================================================

  The desktop mode opens the app as its own window (no browser needed).
  It works offline and has native print-to-PDF support.

  ─── Step 1: Install ALL dependencies (includes Electron) ───

    npm install

    ⚠️  This takes longer because Electron (~150 MB) is downloaded.
       Internet connection required for the first install.

  ─── Step 2: Seed demo data (optional) ───

    npm run seed              (for desktop)
    # OR
    npm run seed:web          (for web — if you switch modes)

  ─── Step 3: Launch the app ───

    npm run start:electron

    A new window titled "Godhuli Dairy Plant" will open.

  ─── Keyboard Shortcuts (Desktop) ───

    F12 / Ctrl+Shift+I     Open Developer Tools
    Ctrl+R                 Reload the app
    Ctrl+Shift+R           Hard reload

  ─── Building an Installer ───

    Windows installer (.exe):
      npm run dist:win

    macOS installer (.dmg):
      npm run dist:mac

    Linux AppImage:
      npm run dist:linux

    The installer will be in the "dist/" folder.



================================================================================
6. USB / PORTABLE MODE
================================================================================

  You can run the app entirely from a USB drive without installing anything
  on the host computer. All data stays on the USB drive.

  ─── Step 1: Copy the project to a USB drive ───

    Copy the entire "dairy-plant-accounts" folder to your USB drive.

  ─── Step 2: Run from USB ───

    Windows:
      Open the USB drive folder
      Double-click:  start.bat          (Web mode)
        OR
      Double-click:  start-electron.bat (Desktop mode)

    macOS / Linux:
      Open Terminal
      cd /Volumes/USB/dairy-plant-accounts    (adjust path)
      ./start.sh                               (Web mode)
        OR
      ./start-electron.sh                      (Desktop mode)

    ⚠️  The first run on a new computer will install Node dependencies.
       This takes 1-2 minutes and requires internet.

  ─── How it works ───

    • The database file (data/dairy-plant.db) stays on the USB drive
    • Nothing is written to the host computer's registry or AppData
    • When you plug the USB into another computer, just run the launcher again
    • All your data, settings, and transactions travel with the USB drive



================================================================================
7. CONFIGURATION
================================================================================

  ─── 7a. Change the Port ───

    PORT=8080 npm start                    (macOS/Linux)
    set PORT=8080 && npm start             (Windows Command Prompt)
    $env:PORT=8080; npm start              (Windows PowerShell)

  ─── 7b. Change Login Credentials ───

    AUTH_USERNAME=owner AUTH_PASSWORD=securepass npm start

    ⚠️  IMPORTANT: Change the password from "admin123" before using
       the app on a network.

  ─── 7c. Using a .env File ───

    Create a file named ".env" in the project folder with:

      PORT=8080
      HOST=0.0.0.0
      AUTH_USERNAME=admin
      AUTH_PASSWORD=your-secure-password
      AUTO_BACKUP_INTERVAL=3600000

    The app will read these settings automatically on startup.

  ─── 7d. Allow Only Local Access ───

    HOST=127.0.0.1 npm start

    This makes the server only accessible from your own computer,
    not from other devices on the network.



================================================================================
8. DATA EXCHANGE (EXCEL / CSV)
================================================================================

  ─── Export Database to Excel ───

    npm run data:export

  ─── Import Excel to Database ───

    npm run data:import

  ─── Export to CSV ───

    npm run data:export-csv

  ─── Import from CSV ───

    npm run data:import-csv

  The Excel file is generated at:  Godhuli_Dairy_Plant_Workbook.xlsx
  CSV files are in:                csv_exports/



================================================================================
9. TROUBLESHOOTING
================================================================================

  ─── "better-sqlite3" native module error ───

    Problem:  Error: The module was compiled against a different Node.js version
    Solution: npm rebuild better-sqlite3
              # OR
              rm -rf node_modules && npm install

  ─── Port 3000 already in use ───

    Problem:  Error: listen EADDRINUSE :::3000
    Solution: Use a different port:
                PORT=3001 npm start
              OR find and stop the other process:
                lsof -i :3000          (macOS/Linux)
                netstat -ano | findstr :3000   (Windows)

  ─── Database is empty after restart ───

    Problem:  All data is gone when you restart the server
    Solution: Make sure you're not running on Render without a persistent disk.
              The database file should be in:  data/dairy-plant.db
              Check that the folder exists and is writable.

  ─── Electron window doesn't open ───

    Problem:  The terminal shows output but no window appears
    Solution: Run: npm run rebuild
              Then try again: npm run start:electron

  ─── Login page shows but cannot log in ───

    Problem:  "Invalid username or password"
    Solution: Default credentials are: admin / admin123
              If you set custom credentials via .env or environment variables,
              use those instead.

  ─── "npm install" is very slow ───

    Solution: Use the web-only install (faster, no Electron):
                npm install --omit=optional
              Only use npm install (full install) if you need the Electron
              desktop app.

  ─── I forgot my password ───

    Solution: Delete the database file:  data/dairy-plant.db
              Restart the server — it will recreate the database with
              default admin/admin123 credentials.
              ⚠️  This deletes all your data! Create a backup first:
                cp data/dairy-plant.db data/backup.db



================================================================================
  Need help? Open an issue or contact the project maintainer.
================================================================================
