@echo off
title Prarambha - Excel Upsert Import
color 0A

echo.
echo  ============================================
echo   Prarambha Account ^& Stock Management
echo   Excel Upsert Import (Non-Destructive)
echo  ============================================
echo.

REM --- Check if Node.js is installed ---
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo  [ERROR] Node.js is not installed or not in PATH.
    echo.
    echo  Please install Node.js from: https://nodejs.org
    echo  Choose the LTS version, then run this script again.
    echo.
    pause
    exit /b 1
)

REM --- Show Node.js version ---
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  Node.js version: %NODE_VER%
echo.

REM --- Check if Excel file exists ---
if not exist "Dairy_Accounts_Professional.xlsx" (
    echo  [ERROR] Dairy_Accounts_Professional.xlsx not found!
    echo  Please place the Excel file in the same folder as this script.
    echo.
    pause
    exit /b 1
)

REM --- Check if script exists ---
if not exist "import-excel-upsert.js" (
    echo  [ERROR] import-excel-upsert.js not found!
    echo  Please ensure the script is in the same folder as this script.
    echo.
    pause
    exit /b 1
)

REM --- Check if dependencies are installed ---
if not exist "node_modules\better-sqlite3" (
    echo  [INFO] Installing dependencies...
    echo.
    call npm install
    echo.
)

REM --- Run the upsert import ---
echo  Starting import...
echo.
node import-excel-upsert.js

echo.
echo  ============================================
echo   Import finished!
echo  ============================================
echo.
pause
