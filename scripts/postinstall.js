#!/usr/bin/env node
/**
 * Godhuli Dairy Plant — Post-install Script
 * ===========================================
 * Runs after `npm install`.
 *
 * - If Electron is installed AND accessible → runs electron-rebuild
 *   (needed for the Electron desktop app)
 * - If Electron is NOT installed (e.g., Render, web-only deploy) → 
 *   ensures better-sqlite3 is compiled for the current Node.js version
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Check if better-sqlite3's native binary works with the current Node
function checkNativeModule() {
    try {
        const betterSqlite3 = require('better-sqlite3');
        const db = new betterSqlite3(':memory:');
        db.exec('SELECT 1');
        db.close();
        return true;
    } catch (e) {
        return false;
    }
}

// Check if Electron is available
function hasElectron() {
    try {
        require.resolve('electron');
        return true;
    } catch (e) {
        return false;
    }
}

console.log('');
console.log('  📦 Post-install check...');

// If running in a web-only context (no Electron), just rebuild better-sqlite3 for Node
if (!hasElectron()) {
    console.log('  → Electron not detected (web-only mode)');
    
    if (!checkNativeModule()) {
        console.log('  → Rebuilding better-sqlite3 for Node.js...');
        try {
            execSync('npm rebuild better-sqlite3', { 
                stdio: 'inherit',
                cwd: path.join(__dirname, '..')
            });
            console.log('  ✅ better-sqlite3 rebuilt successfully');
        } catch (err) {
            console.error('  ❌ Failed to rebuild better-sqlite3:', err.message);
            process.exit(1);
        }
    } else {
        console.log('  ✅ better-sqlite3 native module is compatible');
    }
} else {
    // Electron mode — rebuild for Electron
    console.log('  → Electron detected (desktop mode)');
    console.log('  → Running electron-rebuild...');
    try {
        execSync('electron-rebuild -f -w better-sqlite3', { 
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });
        console.log('  ✅ Electron rebuild complete');
    } catch (err) {
        console.error('  ❌ Electron-rebuild failed:', err.message);
        process.exit(1);
    }
}

console.log('  ✅ Post-install complete');
console.log('');
