#!/usr/bin/env node
/**
 * Apply the five BANK RECON values that the 76 workbook settles.
 * ============================================================
 * These rows were listed in docs/AUDIT-76.md §5 as “needs your decision”.
 * The current workbook states each value, and three of them are the direct
 * cause of a double-counted expense: the petty-cash register holds the same
 * voucher on the workbook's date, while the stored bank row sat on a later
 * date, so the accounting dedupe (same date + amount + payee) could not see
 * that they are one payment.
 *
 *   QR-012  2083-04-08 → 2083-03-31   electricity 12 010   (petty row: 03-31)
 *   QR-044  2083-05-06 → 2083-04-31   water 2 278           (petty row: 04-31)
 *   QR-082  2083-06-05 → 2083-05-31   electricity 71 825    (petty row: 05-31)
 *   QR-056  counterparty OFFICE EXPENSES → INVESTMENT 10 000 (capital, not opex)
 *   QR-078  credit 4 500 → 4 510      customer receipt
 *
 * Usage:
 *   node scripts/audit/apply-bank-corrections.js [--apply] [--db PATH]
 *
 * Never deletes anything: one audit_log row per corrected field, and the
 * before/after values are also written to a JSON evidence file.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const dbPathArg = args.indexOf('--db') >= 0 ? args[args.indexOf('--db') + 1] : null;
const DB_PATH = dbPathArg || path.join(__dirname, '..', '..', 'data', 'dairy-plant.db');

const CORRECTIONS = [
    { ref: 'QR-012', set: { date: '2083-03-31' }, why: 'workbook date; petty-cash copy dated 2083-03-31' },
    { ref: 'QR-044', set: { date: '2083-04-31' }, why: 'workbook date; petty-cash copy dated 2083-04-31' },
    { ref: 'QR-082', set: { date: '2083-05-31' }, why: 'workbook date; petty-cash copy dated 2083-05-31' },
    { ref: 'QR-056', set: { counterparty_name: 'INVESTMENT' }, why: 'workbook says INVESTMENT — capital, not an operating expense' },
    { ref: 'QR-078', set: { credit: 4510, amount: 4510 }, why: 'workbook amount 4 510 (was 4 500)' }
];

function main() {
    const db = new Database(DB_PATH);
    const changes = [];
    for (const c of CORRECTIONS) {
        const row = db.prepare('SELECT * FROM bank_transactions WHERE reference_no = ? ORDER BY id LIMIT 1').get(c.ref);
        if (!row) { console.log(`SKIP ${c.ref}: no such bank row`); continue; }
        const diff = {};
        for (const [k, v] of Object.entries(c.set)) {
            if (String(row[k]) !== String(v)) diff[k] = { from: row[k], to: v };
        }
        if (!Object.keys(diff).length) { console.log(`OK   ${c.ref}: already correct`); continue; }
        changes.push({ ref: c.ref, id: row.id, before: row, diff, why: c.why });
        console.log(`${APPLY ? 'UPDATE' : 'WOULD UPDATE'} ${c.ref} (id ${row.id}): `
            + Object.entries(diff).map(([k, d]) => `${k} ${d.from} → ${d.to}`).join(', ') + `  — ${c.why}`);
    }
    if (!APPLY) {
        console.log(`\nDry run: ${changes.length} row(s) would be corrected. Re-run with --apply.`);
        db.close();
        return;
    }
    if (!changes.length) { db.close(); return; }

    const stamp = new Date().toISOString();
    const evidenceFile = path.join(path.dirname(DB_PATH), 'backups',
        `bank-corrections-${stamp.replace(/[:.]/g, '-')}.json`);
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify({ generated_at: stamp, database: DB_PATH, changes }, null, 2));

    const { logAudit } = require('../../shared/operations/audit');
    const cols = ['date', 'counterparty_name', 'debit', 'credit', 'amount'];
    db.transaction(() => {
        for (const c of changes) {
            const after = {};
            for (const k of cols) after[k] = (k in c.diff) ? c.diff[k].to : c.before[k];
            db.prepare(`UPDATE bank_transactions SET date=?, counterparty_name=?, debit=?, credit=?, amount=?,
                        remarks=?, updated_at=datetime('now','localtime') WHERE id=?`)
                .run(after.date, after.counterparty_name, after.debit, after.credit, after.amount,
                    `${c.before.remarks || ''} | corrected to workbook v76: ${c.why}`.trim(), c.id);
            logAudit(db, 'bank_transactions', c.id, 'update', c.before, { ...after, reason: c.why }, null);
        }
    })();
    console.log(`\nCorrected ${changes.length} bank row(s). Evidence: ${evidenceFile}`);
    db.close();
}

main();
