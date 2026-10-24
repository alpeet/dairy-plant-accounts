#!/usr/bin/env node
/**
 * run-all-tests.js — the aggregate audit suite
 * =============================================
 *   node scripts/audit/run-all-tests.js          # everything
 *   node scripts/audit/run-all-tests.js monthly  # only files whose name matches "monthly"
 *   npm run test:audit
 *
 * Runs every test in scripts/audit/ one after another and prints a single
 * pass/fail summary, so a release can be verified with one command instead of
 * a hand-copied list (the failure mode this runner exists to prevent: a new
 * test — test-bs-calendar / test-monthly-report / test-xlsx-parts — written
 * but never actually executed before shipping).
 *
 * A file that exists on disk but is missing from the manifest below is reported
 * loudly, so future tests cannot silently skip the suite.
 *
 * Exit code 0 = every test passed, 1 = at least one failed/timed out.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.join(HERE, '..', '..');

/**
 * Tests that must run. `test-pdf.js` is listed in EXCLUDED with the reason —
 * it needs Electron's app.whenReady and cannot run under plain node.
 */
const MANIFEST = [
    // date layer (BS calendar) — foundation for every report
    'test-bs-calendar.js',
    // money & accounting
    'test-accounting-logic.js',
    'test-money-precision.js',
    'test-payment-types.js',
    'test-payment-bank-link.js',
    'test-pdc.js',
    'test-advance-register.js',
    'test-handover-reset.js',
    'test-employees.js',
    'test-company-ledger.js',
    // monthly report (the new report + prepaid rent recognition)
    'test-monthly-report.js',
    // inventory / costing
    'test-stock-statement.js',
    'test-daily-stock-statement.js',
    'test-todays-stock.js',
    'test-milk-costing.js',
    'test-milk-reconciliation.js',
    'test-milk-supplier-identity.js',
    'test-production-costing.js',
    'test-production-settings.js',
    'test-products.js',
    'test-supplier-pricing.js',
    'test-phase26-reconcile.js',
    // imports / round trips
    'test-excel-roundtrip.js',
    // workbook importer regressions found in Dairy_Accounts_Professional 76
    'test-workbook-import-76.js',
    'test-bulk-entry.js',
    'test-bank-idempotency.js',
    // reporting & acceptance
    'test-management-reports.js',
    'test-erp-acceptance.js',
    'test-trust-pack.js',
    // .xlsx part surgery (the lossless Monthly Report sheet writer)
    'test-xlsx-parts.js'
];

const EXCLUDED = {
    'test-pdf.js': 'Electron-only (app.whenReady) — run via the Electron runtime'
};

const filter = (process.argv[2] || '').toLowerCase();
const failures = [];
const results = [];

const filesInDir = fs.readdirSync(HERE).filter(f => /^test-.*\.js$/.test(f));

// Files on disk that nobody registered → the suite would silently skip them.
for (const f of filesInDir) {
    if (!MANIFEST.includes(f) && !(f in EXCLUDED)) {
        console.log(`  ⚠️  ${f} exists but is NOT in the run-all-tests manifest — add it`);
        failures.push(`${f} (not in manifest)`);
    }
}
for (const f of Object.keys(EXCLUDED)) {
    if (!filesInDir.includes(f)) console.log(`  ⚠️  manifest excludes ${f}, but it does not exist`);
}

const queue = MANIFEST.filter(f => filesInDir.includes(f))
    .filter(f => !filter || f.toLowerCase().includes(filter));

console.log('\n' + '='.repeat(70));
console.log(`  🧪 PRARAMBHA AUDIT SUITE — ${queue.length} tests${filter ? ` (filter: "${filter}")` : ''}`);
console.log('='.repeat(70));

queue.forEach((file, i) => {
    const label = `[${String(i + 1).padStart(2)}/${queue.length}] ${file}`;
    process.stdout.write(`${label} … `);
    const started = Date.now();
    const res = spawnSync(process.execPath, [path.join(HERE, file)], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 600 * 1000,
        maxBuffer: 32 * 1024 * 1024
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const out = `${res.stdout || ''}${res.stderr || ''}`;
    const timedOut = res.error && res.error.code === 'ETIMEDOUT';
    const ok = !timedOut && res.status === 0;

    // Summarise the test's own "Result: 121/121 passed" line when it has one.
    const summary = (out.match(/Result:\s*(\d+)\/(\d+)\s*passed[^\n]*/) || [])[0] || '';

    if (ok) {
        console.log(`ok  (${secs}s)${summary ? `  ${summary.replace(/^Result:\s*/, '')}` : ''}`);
    } else {
        console.log(timedOut ? `TIMEOUT after ${secs}s` : `FAILED (exit ${res.status}, ${secs}s)`);
        if (!timedOut) {
            failures.push(file);
            console.log('  ── output tail ──');
            console.log(out.split('\n').slice(-30).map(l => '  │ ' + l).join('\n'));
            console.log('  ─────────────────');
        } else {
            failures.push(`${file} (timeout)`);
        }
    }
    results.push({ file, ok, secs, summary });
});

console.log('\n' + '='.repeat(70));
console.log('  SUMMARY');
console.log('='.repeat(70));
for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.file}${r.summary ? '  ' + r.summary.replace(/^Result:\s*/, '') : ''}`);
}
const bad = results.filter(r => !r.ok).length;
console.log('-'.repeat(70));
console.log(`  ${results.length - bad}/${results.length} test files passed`);
if (failures.length) console.log(`  FAILED: ${failures.join(', ')}`);
console.log('='.repeat(70) + '\n');
process.exit(failures.length ? 1 : 0);