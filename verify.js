#!/usr/bin/env node
/**
 * Godhuli Dairy Plant — Portable Verification Script
 * ====================================================
 * Run this to check if the app is ready for USB transfer
 * or if all requirements are met on a target machine.
 *
 * Usage:
 *   node verify.js    # Full check
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
let passed = 0;
let failed = 0;
let warnings = 0;

// ============================================================
// Helpers
// ============================================================

function ok(msg) {
    passed++;
    console.log(`  ✅  ${msg}`);
}

function fail(msg, hint = '') {
    failed++;
    console.log(`  ❌  ${msg}`);
    if (hint) console.log(`       ${hint}`);
}

function warn(msg, hint = '') {
    warnings++;
    console.log(`  ⚠️   ${msg}`);
    if (hint) console.log(`       ${hint}`);
}

function sep(title) {
    console.log(`\n ── ${title} ─${'─'.repeat(50)}`);
}

function checkFile(relativePath) {
    const full = path.join(ROOT, relativePath);
    if (fs.existsSync(full)) {
        const stat = fs.statSync(full);
        ok(`${relativePath} (${(stat.size / 1024).toFixed(1)} KB)`);
        return true;
    } else {
        fail(`${relativePath} — MISSING`);
        return false;
    }
}

function checkDir(relativePath) {
    const full = path.join(ROOT, relativePath);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
        const count = fs.readdirSync(full).length;
        ok(`${relativePath}/ (${count} items)`);
        return true;
    } else {
        fail(`${relativePath}/ — MISSING`);
        return false;
    }
}

// ============================================================
// 1. Node.js Version
// ============================================================

sep('Node.js Environment');

try {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    if (major >= 16) {
        ok(`Node.js ${version} (16+ required)`);
    } else {
        fail(`Node.js ${version} — version 16+ required`, 'Download from https://nodejs.org');
    }
} catch (e) {
    fail('Could not determine Node.js version', 'Install Node.js 16+ from https://nodejs.org');
}

// Check npm
try {
    const npmVer = execSync('npm --version', { encoding: 'utf8' }).trim();
    ok(`npm ${npmVer}`);
} catch (e) {
    fail('npm is not available', 'npm should come with Node.js — try reinstalling');
}

// ============================================================
// 2. Required Files & Directories
// ============================================================

sep('Core Application Files');

checkFile('server.js');
checkFile('package.json');
checkFile('database/schema.sql');
checkDir('renderer');
checkFile('renderer/index.html');
checkFile('renderer/css/style.css');

// Renderer JS files
const requiredJs = [
    'api.js', 'app.js', 'dashboard.js', 'sales.js', 'purchases.js',
    'stock.js', 'milk_collection.js', 'party.js', 'farmer_payment.js',
    'reports.js', 'settings.js', 'utils.js'
];
let jsOk = true;
for (const js of requiredJs) {
    if (!fs.existsSync(path.join(ROOT, 'renderer', 'js', js))) {
        fail(`renderer/js/${js} — MISSING`);
        jsOk = false;
    }
}
if (jsOk) ok(`renderer/js/ (${requiredJs.length} modules)`);

// Launcher scripts
checkFile('start.sh');
checkFile('start.bat');

// Check start.sh executable bit (macOS/Linux)
const startShPath = path.join(ROOT, 'start.sh');
if (fs.existsSync(startShPath)) {
    try {
        const mode = fs.statSync(startShPath).mode;
        const isExecutable = (mode & 0o111) !== 0;
        if (!isExecutable && process.platform !== 'win32') {
            warn('start.sh is NOT executable', 'Run: chmod +x start.sh');
        }
    } catch (e) {}
}

// Database
sep('Database');

const dbPath = path.join(ROOT, 'data', 'dairy-plant.db');
if (fs.existsSync(dbPath)) {
    const dbSize = fs.statSync(dbPath).size;
    if (dbSize > 0) {
        ok(`data/dairy-plant.db (${(dbSize / 1024).toFixed(1)} KB)`);
    } else {
        fail('data/dairy-plant.db exists but is EMPTY', 'Run: node database/seed.js');
    }
} else {
    warn('data/dairy-plant.db — not found (will be auto-created on first run)', 'App will work but with no data');
}

// Check for stale WAL files
if (fs.existsSync(path.join(ROOT, 'data', 'dairy-plant.db-wal'))) {
    warn('Stale WAL file found (dairy-plant.db-wal)', 'Run: node -e "new (require(\"better-sqlite3\"))(\"./data/dairy-plant.db\").pragma(\"wal_checkpoint(TRUNCATE)\")"');
}

// ============================================================
// 3. Dependencies
// ============================================================

sep('Dependencies');

const pkgPath = path.join(ROOT, 'package.json');
let pkg = {};
try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch (e) {}

const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

if (fs.existsSync(path.join(ROOT, 'node_modules'))) {
    for (const [dep, ver] of Object.entries(deps)) {
        const depPath = path.join(ROOT, 'node_modules', dep);
        if (fs.existsSync(depPath)) {
            ok(`${dep} ${ver}`);
        } else {
            if (dep === 'electron' || dep === 'electron-builder' || dep === 'electron-rebuild') {
                warn(`${dep} ${ver} — optional (not needed for portable web mode)`);
            } else {
                fail(`${dep} ${ver} — NOT INSTALLED`, 'Run: npm install');
            }
        }
    }
} else {
    warn('node_modules/ — not found (auto-installed by launcher scripts)', 'Run: npm install --omit=optional');
}

// ============================================================
// 4. Package.json Scripts
// ============================================================

sep('Package Scripts');

const expectedScripts = ['start'];
let scriptsOk = true;
for (const s of expectedScripts) {
    if (!pkg.scripts || !pkg.scripts[s]) {
        fail(`npm run ${s} script is missing from package.json`);
        scriptsOk = false;
    }
}
if (scriptsOk) ok('Required npm scripts: start');

// ============================================================
// 5. Summary
// ============================================================

sep('Summary');

const total = passed + failed;
console.log(`  Passed:    ${passed}/${total}`);
console.log(`  Failed:    ${failed}/${total}`);
if (warnings > 0) console.log(`  Warnings:  ${warnings}`);
console.log('');

if (failed === 0) {
    console.log('  🎉 All checks passed! The app is ready for portable transfer.\n');
    process.exit(0);
} else {
    console.log(`  ⚠️  ${failed} check(s) failed. Review the issues above before transferring.\n`);
    process.exit(1);
}
