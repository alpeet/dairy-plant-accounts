@echo off
title Prarambha Excel Import - Portable
color 0A
setlocal enabledelayedexpansion

echo.
echo  ============================================
echo   Prarambha - Excel Upsert Import (Portable)
echo  ============================================
echo.

set "BASE_DIR=%~dp0"
set "NODE_DIR=%BASE_DIR%node-runtime"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_DIR=%NODE_DIR%\node_modules\npm\bin"
set "NODE_URL=https://nodejs.org/dist/v20.18.3/node-v20.18.3-win-x64.zip"
set "NODE_ZIP=%BASE_DIR%node-runtime.zip"

REM --- Check if Excel file exists ---
if not exist "%BASE_DIR%Dairy_Accounts_Professional.xlsx" (
    echo  [ERROR] Dairy_Accounts_Professional.xlsx not found!
    echo  Place the Excel file in the same folder as this script.
    echo.
    pause
    exit /b 1
)

REM --- Check if portable Node.js exists ---
if exist "%NODE_EXE%" (
    echo  [OK] Portable Node.js found.
    goto :run
)

echo  [INFO] First-time setup: downloading portable Node.js (~30MB)...
echo  URL: %NODE_URL%
echo.

REM --- Download Node.js portable ---
echo  Downloading...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%' -UseBasicParsing" 2>nul

if not exist "%NODE_ZIP%" (
    echo  [ERROR] Download failed!
    echo  Please download Node.js manually from: https://nodejs.org
    echo  Extract the zip to a folder named "node-runtime" in this directory.
    echo.
    pause
    exit /b 1
)

echo  Extracting Node.js...
powershell -Command "Expand-Archive -Path '%NODE_ZIP%' -DestinationPath '%BASE_DIR%' -Force" 2>nul

REM --- Rename extracted folder ---
for /d %%D in ("%BASE_DIR%node-v*-win-x64") do (
    if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
    rename "%%D" "node-runtime"
)

del "%NODE_ZIP%" 2>nul

if not exist "%NODE_EXE%" (
    echo  [ERROR] Node.js extraction failed.
    echo  Please manually extract Node.js to a folder named "node-runtime".
    echo.
    pause
    exit /b 1
)

echo  [OK] Portable Node.js installed.
echo.

:run
echo  Node.js: %NODE_EXE%
"%NODE_EXE%" -v
echo.

REM --- Install dependencies if needed ---
if not exist "%BASE_DIR%node_modules\better-sqlite3" (
    echo  [INFO] Installing dependencies (first run only)...
    echo.
    "%NODE_EXE%" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" install --production 2>nul
    if %ERRORLEVEL% NEQ 0 (
        "%NODE_EXE%" "%NODE_DIR%\node_modules\npm\bin\npm-cli.js" install
    )
    echo.
)

REM --- Run the upsert import ---
echo  ============================================
echo   Running Excel Upsert Import...
echo  ============================================
echo.

"%NODE_EXE%" "%BASE_DIR%import-excel-upsert.js"

echo.
echo  ============================================
echo   Done! Press any key to exit.
echo  ============================================
echo.
pause
