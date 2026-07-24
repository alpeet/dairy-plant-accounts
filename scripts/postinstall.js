#!/usr/bin/env node
/**
 * Godhuli Dairy Plant — Post-install Script
 * ===========================================
 * Runs after `npm install`.
 *
 * Strategy: Try to rebuild for Electron first. If that fails
 * (which it will on cloud hosts like Render where Electron's
 * headers don't match the system Node.js), gracefully falls
 * back to rebuilding for the current Node.js version.
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

console.log('');
console.log('  📦 Post-install: checking native modules...');

// Check if better-sqlite3 already works with this Node.js version
function nativeModuleWorks() {
    try {
        const betterSqlite3 = require('better-sqlite3');
        const db = new betterSqlite3(':memory:');
        db.exec('SELECT 1 + 1');
        db.close();
        return true;
    } catch (e) {
        return false;
    }
}

// Check if electron is installed as a package
function electronInstalled() {
    try {
        require.resolve('electron/package.json');
        return true;
    } catch (e) {
        return false;
    }
}

// If the native module already works, we're done
if (nativeModuleWorks()) {
    console.log('  ✅ better-sqlite3 is already compatible — nothing to do');
    console.log('');
    process.exit(0);
}

// Try @electron/rebuild first (for local Electron development)
if (electronInstalled()) {
    console.log('  → Trying @electron/rebuild (for desktop mode)...');
    try {
        execSync('npx @electron/rebuild -f -w better-sqlite3', { 
            stdio: 'inherit',
            cwd: ROOT
        });
        // Verify the rebuilt binary actually works
        if (nativeModuleWorks()) {
            console.log('  ✅ Rebuilt for Electron successfully');
            console.log('');
            process.exit(0);
        }
        console.log('  → @electron/rebuild binary incompatible with system Node.js, falling back...');
    } catch (e) {
        console.log('  → @electron/rebuild not applicable (web-only mode)');
    }
}

// Fallback: rebuild for current Node.js
console.log('  → Rebuilding better-sqlite3 for Node.js...');
try {
    execSync('npm rebuild better-sqlite3', { 
        stdio: 'inherit',
        cwd: ROOT
    });
    console.log('  ✅ better-sqlite3 rebuilt successfully');
} catch (err) {
    console.error('  ❌ Failed to rebuild better-sqlite3:', err.message);
    process.exit(1);
}

console.log('  ✅ Post-install complete');
console.log('');
