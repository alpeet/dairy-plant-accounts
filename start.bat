@echo off
REM
REM Godhuli Dairy Plant - Portable Launcher (Windows)
REM ==================================================
REM Run this script from a USB drive to start the application.
REM The database and all data stay local on the USB drive.
REM
REM Requirements: Node.js 16+ must be installed on the host machine.
REM
REM Usage:
REM   start.bat              normal mode
REM   start.bat --port 8080  custom port
REM

setlocal enabledelayedexpansion

set PORT=3000
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

REM Parse port argument
if "%1"=="--port" (
    if not "%2"=="" (
        set PORT=%2
    )
)

echo.
echo   🐄 Godhuli Dairy Plant
echo   ───────────────────────
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo   Node.js:  %NODE_VER%
echo   Port:     %PORT%
echo.

REM Install dependencies if missing
if not exist "node_modules\" (
    echo   📦 Installing dependencies (one-time^)...
    echo.
    call npm install --omit=optional 2>&1 | findstr /v "^$"
    echo.
    echo   ✅ Dependencies installed!
    echo.
)

REM Checkpoint database (merge WAL into main file) for clean state
if exist "data\dairy-plant.db-wal" (
    node -e "try{const D=require('better-sqlite3');const d=new D('./data/dairy-plant.db');d.pragma('journal_mode=DELETE');d.exec('PRAGMA wal_checkpoint(TRUNCATE);');d.close();}catch(e){}" 2>nul
)

echo   🚀 Starting server...
echo.

set PORT=%PORT%
node server.js

echo.
echo   Server stopped.
pause
