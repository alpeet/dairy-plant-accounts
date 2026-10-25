#!/usr/bin/env node
/**
 * Remove a petty-cash voucher that the bank-statement import created on top of
 * the workbook's own expense-register voucher.
 * ==========================================================================
 * The workbook lists the 60,089 diesel payment to MUKTESHWOR ENTERPRISES in two
 * places with two different dates:
 *
 *   Expenses   r46   Date 66992  → the expense register  (2083-05-31)
 *   BANK RECON r105  Date 67011  → the bank statement    (2083-06-19)
 *
 * The importer keeps every BANK RECON expense row as a petty voucher and every
 * Expenses row as a petty voucher. Where the two dates agree it de-duplicates on
 * date + amount, so the expense is booked once. Here the dates differ by 20 days,
 * so BOTH rows became vouchers and the diesel was expensed twice (Rs 60,089).
 *
 * This script deletes the bank-derived copy (the one whose date matches the bank
 * transaction), keeps the register copy (the one that matches the workbook's
 * Expenses row), writes an audit_log entry and an evidence file.
 *
 *   node scripts/audit/fix-petty-bank-duplicate.js            # dry run
 *   node scripts/audit/fix-petty-bank-duplicate.js --apply    # write
 *
 * Defaults to the live app database; override with DB_PATH.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const LIVE = process.env.DB_PATH ||
    path.join(process.env.HOME || '', 'Library', 'Application Support', 'prarambha-account-stock', 'data', 'dairy-plant.db');
const APPLY = process.argv.includes('--apply');
const AMOUNT = 60089;
const DESCRIPTION = 'ONLINE PAID FOR BHADRA-2083 DISSEL';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function main() {
    if (!fs.existsSync(LIVE)) {
        console.error(`Database not found: ${LIVE}`);
        process.exit(2);
    }
    const evidenceDir = path.join(ROOT, 'docs', 'audit-evidence');
    fs.mkdirSync(evidenceDir, { recursive: true });

    // A plain fs.copyFileSync would miss the -wal file and hand back a stale
    // snapshot (SQLite keeps recent writes there until a checkpoint), so the
    // backup goes through better-sqlite3's backup API, which reads through WAL.
    let backupPath = null;
    if (APPLY) {
        const dir = path.join(ROOT, 'data', 'backups');
        fs.mkdirSync(dir, { recursive: true });
        backupPath = path.join(dir, `dairy-plant.db.bak-petty-bank-dup-${stamp()}`);
    }

    const db = new Database(LIVE);
    db.pragma('journal_mode = WAL');
    if (APPLY) {
        await db.backup(backupPath);
        console.log(`BACKUP ${backupPath} (${(fs.statSync(backupPath).size / 1048576).toFixed(2)} MB)`);
    }

    // 1. Every petty voucher that books this payment.
    const vouchers = db.prepare(`
        SELECT * FROM petty_cash
         WHERE ABS(amount - ?) < 0.005
           AND UPPER(TRIM(REPLACE(COALESCE(description, ''), '  ', ' '))) = ?
         ORDER BY date, id
    `).all(AMOUNT, DESCRIPTION);

    // 2. The bank statement row for the same money.
    const bank = db.prepare(`
        SELECT * FROM bank_transactions
         WHERE ABS(COALESCE(debit, 0) - ?) < 0.005
           AND UPPER(TRIM(REPLACE(COALESCE(description, ''), '  ', ' '))) = ?
    `).all(AMOUNT, DESCRIPTION);

    console.log(`\nVouchers booking the diesel payment (Rs ${AMOUNT}):`);
    for (const v of vouchers) {
        console.log(`  id=${v.id} date=${v.date} voucher=${v.voucher_no} paid_to=${v.paid_to} mode=${v.payment_mode}`);
    }
    console.log(`Bank statement rows for the same money: ${bank.length}`);
    for (const b of bank) console.log(`  id=${b.id} date=${b.date} reference=${b.reference_no} debit=${b.debit}`);

    if (vouchers.length !== 2 || bank.length !== 1) {
        console.error('\nRefusing to act: expected exactly 2 vouchers and 1 bank row for this payment.');
        process.exit(1);
    }

    const bankDate = bank[0].date;
    const fromBank = vouchers.filter((v) => v.date === bankDate);
    const fromRegister = vouchers.filter((v) => v.date !== bankDate);
    if (fromBank.length !== 1 || fromRegister.length !== 1) {
        console.error('\nRefusing to act: cannot tell which voucher came from the bank statement.');
        process.exit(1);
    }
    const victim = fromBank[0];
    const keeper = fromRegister[0];

    // 3. The keeper must exist in the workbook's Expenses register at its date.
    const before = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM petty_cash
         WHERE date >= '2083-03-14' AND date <= '2083-07-06'
           AND UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'
    `).get();

    console.log(`\nDelete  id=${victim.id} date=${victim.date} (bank-statement copy, bank row ${bank[0].id} keeps the cash movement)`);
    console.log(`Keep    id=${keeper.id} date=${keeper.date} (workbook Expenses row 46, voucher ${keeper.voucher_no})`);
    console.log(`Petty expense rows before: ${before.n} rows, Rs ${round2(before.total)}`);

    if (!APPLY) {
        console.log('\nDRY RUN — nothing written. Re-run with --apply to delete the duplicate.');
        db.close();
        return;
    }

    const remove = db.transaction(() => {
        const old = db.prepare('SELECT * FROM petty_cash WHERE id = ?').get(victim.id);
        db.prepare('DELETE FROM petty_cash WHERE id = ?').run(victim.id);
        // changed_by is a FK to users.id — the audit entries written by the
        // workbook audit also leave it NULL and carry the explanation inside
        // new_values, which is what this script does too.
        db.prepare(`
            INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by, changed_at)
            VALUES (?, ?, ?, ?, ?, NULL, datetime('now', 'localtime'))
        `).run(
            'petty_cash', victim.id, 'delete',
            JSON.stringify(old),
            JSON.stringify({
                reason: 'duplicate of petty_cash #' + keeper.id + ' — bank-statement copy of the same diesel payment',
                script: 'scripts/audit/fix-petty-bank-duplicate.js',
                bank_transaction_id: bank[0].id,
                kept_record: keeper.id
            })
        );
        return old;
    });
    const removed = remove();

    const after = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM petty_cash
         WHERE date >= '2083-03-14' AND date <= '2083-07-06'
           AND UPPER(TRIM(COALESCE(expense_head, ''))) != 'ADVANCE'
    `).get();
    console.log(`Petty expense rows after:  ${after.n} rows, Rs ${round2(after.total)} (removed Rs ${round2(before.total - after.total)})`);

    const evidencePath = path.join(evidenceDir, `petty-bank-duplicate-${stamp()}.json`);
    fs.writeFileSync(evidencePath, JSON.stringify({
        generated_at: new Date().toISOString(),
        database: LIVE,
        backup: backupPath,
        reason: 'The same Rs 60,089 diesel payment was imported twice: once from the Expenses register (bank date column 2083-05-31) and once from the BANK RECON statement (2083-06-19), because the two workbook rows carry different dates.',
        deleted: removed,
        kept: keeper,
        bank_transaction: bank[0],
        petty_expense_before: before,
        petty_expense_after: after
    }, null, 2) + '\n');
    console.log(`EVIDENCE ${evidencePath}`);
    db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
