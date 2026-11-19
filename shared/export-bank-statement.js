/**
 * Prarambha Account & Stock Management — Bank Statement Excel export
 * =================================================================
 * The workbook is built from `getBankStatement()` — the same engine the Bank
 * Transactions screen renders — so the printed/exported statement and the
 * screen can never disagree.
 *
 * One account  → a single sheet with that account's opening balance, movements,
 *                totals and closing balance.
 * All accounts → an "All_Banks" sheet with the Account column and every row, and
 *                then one sheet per account, each with its OWN opening, totals and
 *                closing balance. Balances are never added into one figure.
 *
 * Read-only: exporting writes a file and changes no business record.
 *
 * Usage:
 *   const { exportBankStatementExcel } = require('./shared/export-bank-statement');
 *   exportBankStatementExcel(db, '/tmp/bank.xlsx', { account_id: 2, from_date, to_date });
 */
const path = require('path');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const safeSheetName = (name, fallback) => {
    const base = String(name || fallback || 'Bank').replace(/[\\/?*[\]:]/g, '-').trim();
    return (base || fallback || 'Bank').slice(0, 31);
};
const TYPE_LABELS = {
    deposit: 'Deposit', withdrawal: 'Withdrawal', bank_charge: 'Bank Charge',
    interest: 'Interest', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', other: 'Other'
};

function accountSheet(account, statement) {
    const rows = [
        [account.bank_name || 'Bank Account'],
        [`Account No: ${account.account_number || '—'}`, account.branch_name ? `Branch: ${account.branch_name}` : ''],
        [`Period: ${statement.from_date || 'all'} → ${statement.to_date || 'all'}`],
        [],
        ['Date', 'Reference No', 'Particulars', 'Transaction Type', 'Debit', 'Credit', 'Running Balance', 'Reconciliation'],
        [`Opening Balance`, '', '', '', '', '', round2(statement.opening_balance), '']
    ];
    for (const r of statement.entries) {
        rows.push([
            r.date, r.reference_no || '', r.description || r.counterparty_name || '',
            TYPE_LABELS[r.txn_category] || r.txn_category || '',
            round2(r.debit || 0), round2(r.credit || 0), round2(r.running_balance),
            r.recon_status || 'unreconciled'
        ]);
    }
    rows.push([]);
    rows.push(['Total', '', '', '', round2(statement.total_debit), round2(statement.total_credit), '', '']);
    rows.push(['Closing Balance', '', '', '', '', '', round2(statement.closing_balance), '']);
    return rows;
}

/**
 * @returns {{ workbook: object, filename: string }} the built workbook (the
 *   caller decides where to write it) — never touches the database.
 */
function buildBankStatementWorkbook(db, opts = {}) {
    const XLSX = require('xlsx');
    const bank = require('./operations/bank');
    const statement = bank.getBankStatement(db, opts || {});
    if (statement.success === false) throw new Error(statement.error || 'Bank statement not available');

    const wb = XLSX.utils.book_new();
    const suffix = [opts.from_date, opts.to_date].filter(Boolean).join('_to_');

    if (statement.mode === 'account') {
        const a = statement.account;
        const name = safeSheetName(`${a.bank_name} ${a.account_number || ''}`, 'Bank_Statement');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accountSheet(a, statement)), name);
        return { workbook: wb, filename: `Bank_${(a.bank_name || 'Statement').replace(/\s+/g, '_')}${suffix ? '_' + suffix : ''}.xlsx` };
    }

    // Consolidated view first: the Account column keeps every row identifiable.
    const all = [
        ['All Bank Accounts — Consolidated Statement'],
        [`Period: ${statement.from_date || 'all'} → ${statement.to_date || 'all'}`],
        ['Balances are shown per account at the end — they are not combined into one balance.'],
        [],
        ['Bank', 'Account No', 'Date', 'Reference No', 'Particulars', 'Transaction Type', 'Debit', 'Credit', 'Running Balance', 'Reconciliation']
    ];
    for (const r of statement.entries) {
        all.push([
            r.account_name || '', r.account_number || '', r.date, r.reference_no || '',
            r.description || r.counterparty_name || '', TYPE_LABELS[r.txn_category] || r.txn_category || '',
            round2(r.debit || 0), round2(r.credit || 0), round2(r.running_balance), r.recon_status || 'unreconciled'
        ]);
    }
    all.push([]);
    all.push(['Total (all accounts)', '', '', '', '', '', round2(statement.total_debit), round2(statement.total_credit), '', '']);
    all.push([]);
    all.push(['Account', 'Opening Balance', 'Total Debits', 'Total Credits', 'Closing Balance']);
    for (const a of statement.accounts) {
        all.push([`${a.bank_name}${a.account_number ? ' — ' + a.account_number : ''}`,
            round2(a.opening_balance), round2(a.total_debit), round2(a.total_credit), round2(a.closing_balance)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(all), 'All_Banks');

    // Then each account on its own sheet, with its own balances. An account
    // with nothing at all in the period is skipped rather than printed blank.
    for (const a of statement.accounts) {
        const one = bank.getBankStatement(db, { ...opts, account_id: a.id });
        const empty = (one.entries || []).length === 0
            && round2(one.opening_balance) === 0 && round2(one.total_debit) === 0 && round2(one.total_credit) === 0;
        if (empty) continue;
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accountSheet(a, one)),
            safeSheetName(`${a.bank_name} ${a.account_number || ''}`, `Account_${a.id}`));
    }
    return { workbook: wb, filename: `Bank_All_Accounts${suffix ? '_' + suffix : ''}.xlsx` };
}

/** Write the workbook to `savePath`. Returns { success, filePath, filename }. */
function exportBankStatementExcel(db, savePath, opts = {}) {
    const XLSX = require('xlsx');
    const { workbook, filename } = buildBankStatementWorkbook(db, opts);
    const target = savePath || path.join(process.cwd(), filename);
    XLSX.writeFile(workbook, target);
    return { success: true, filePath: target, filename };
}

module.exports = { buildBankStatementWorkbook, exportBankStatementExcel };
