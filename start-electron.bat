@echo off
REM
REM Godhuli Dairy Plant - Portable Electron Desktop Launcher (Windows)
REM ================================================================
REM Run this script from a USB drive or any folder to open the app
REM as a desktop window (no browser needed).
REM
REM All data stays LOCAL — nothing is stored on the host computer.
REM The database is at:  .\data\dairy-plant.db  (relative to this script)
REM
REM Requirements: Node.js 16+ must be installed on the host machine.
REM
REM Usage:
REM   Double-click start-electron.bat
REM

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   ❌ Node.js is not installed!
    echo      Please install Node.js 16+ from https://nodejs.org
    echo      Then run this script again.
    echo.
    pause
    start https://nodejs.org
    exit /b 1
)

echo.
echo   🐄 Godhuli Dairy Plant — Desktop App
echo   ─────────────────────────────────────
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   Node.js:  %NODE_VER%
echo.

REM Install dependencies if missing
if not exist "node_modules\" (
    echo   📦 Installing dependencies (one-time)...
    echo.
    call npm install 2>&1 | findstr /v "^$"
    echo.
    echo   ✅ Dependencies installed!
    echo.
)

echo   🚀 Launching desktop app...
echo   (The app window will open shortly)
echo.

REM 🔑 Set database directory to stay alongside the app (portable mode)
REM Data stays on the USB drive — nothing stored on the host computer.
set DB_DIR=%SCRIPT_DIR%data

npm run start:electron

pause
