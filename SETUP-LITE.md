# Godhuli Dairy Plant — Lite Setup Guide

This is the **lite** version of the app — it excludes `node_modules/` to keep the
download small (~1 MB). You'll need to install dependencies on the target machine.

---

## Requirements

- **Node.js 16+** ([download](https://nodejs.org))
- ~500 MB free disk space (for dependencies)
- macOS, Windows 10+, or Linux

---

## Setup Instructions

### macOS / Linux

```bash
# 1. Unzip
unzip dairy-plant-accounts-lite.zip

# 2. Go into the project
cd dairy-plant-accounts

# 3. Install dependencies (one-time, ~450 MB)
npm install

# 4. (Optional) Seed demo data
npm run seed

# 5. Start the app
./start.sh
```

Your browser will open automatically at `http://localhost:3000`.

### Windows

```batch
REM 1. Right-click dairy-plant-accounts-lite.zip → Extract All
REM 2. Open the extracted folder

REM 3. Open Command Prompt or PowerShell in that folder and run:
npm install

REM 4. (Optional) Seed demo data:
npm run seed

REM 5. Start the app — double-click:
start.bat
```

Your browser will open automatically at `http://localhost:3000`.

---

## First Time? Seed Demo Data

```bash
npm run seed
```

This creates sample products, parties, and 25+ days of transactions so you can
explore the app immediately.

---

## Quick Reference

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (required once) |
| `npm run seed` | Load demo data |
| `./start.sh` | Launch (macOS/Linux) |
| `start.bat` | Launch (Windows) |
| `node server.js` | Launch from any terminal |

---

## Verifying Before Transfer

Run this to check everything is ready:

```bash
node verify.js
```

It checks Node.js version, required files, database integrity, and launcher scripts.

---

## Need Help?

See the full **README.md** inside the project for complete documentation.
