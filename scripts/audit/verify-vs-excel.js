/**
 * Acceptance verification: app ledger balances vs the Excel workbook's
 * Receivable_Payable sheet (ground truth), plus data sanity checks.
 * =====================================================
 * Usage: node scripts/audit/verify-vs-excel.js [dbPath]
 */

const path = require('path');
const XLSX = require('xlsx');
const { openDatabase, runMigrations } = require(path.join(__dirname, '..', '..', 'shared', 'db.js'));

const ROOT = path.join(__dirname, '..', '..');
const dbPath = process.argv[2] || path.join(ROOT, 'data', 'dairy-plant.db');
const excelPath = process.argv[3] || path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');

const db = openDatabase(dbPath);
runMigrations(db);

// ── Excel ground truth: Receivable_Payable ──
const wb = XLSX.readFile(excelPath);
const rp = XLSX.utils.sheet_to_json(wb.Sheets['Receivable_Payable'], { header: 1, defval: '' });
// Header row = the one whose first cell is "Party Name" (row 6 in this workbook)
let hdr = -1;
for (let i = 0; i < rp.length; i++) {
    if (String(rp[i][0] || '').trim().toLowerCase() === 'party name') { hdr = i; break; }
}
const excelBalances = {}; // normalized name → { receivable, payable }
if (hdr >= 0) {
    // Columns: Party Name(0), Type(1), Debit Dr(2), Credit Cr(3), Net Balance(4), Class(5)
    for (let i = hdr + 1; i < rp.length; i++) {
        const r = rp[i];
        const name = String(r[0] || '').trim();
        if (!name || /total|grand/i.test(name)) continue;
        const dr = parseFloat(r[2]) || 0;
        const cr = parseFloat(r[3]) || 0;
        if (dr === 0 && cr === 0) continue;
        excelBalances[name.toLowerCase()] = { receivable: dr, payable: cr };
    }
}

// ── App balances: sum of ledger debits/credits per party ──
const appBalances = {};
for (const row of db.prepare(`
    SELECT p.id, p.name,
           COALESCE(SUM(l.debit), 0) AS dr,
           COALESCE(SUM(l.credit), 0) AS cr
    FROM parties p LEFT JOIN ledger_entries l ON l.party_id = p.id
    GROUP BY p.id
`).all()) {
    appBalances[String(row.name).trim().toLowerCase()] = { id: row.id, name: row.name, dr: row.dr, cr: row.cr };
}

// ── Compare (exact-name keys) ──
console.log('=== BALANCE VERIFICATION vs Receivable_Payable (Excel) ===');
let exact = 0, mismatch = 0, onlyExcel = 0, onlyApp = 0;
const details = [];
for (const [key, ex] of Object.entries(excelBalances)) {
    const ap = appBalances[key];
    if (!ap) { onlyExcel++; details.push({ name: key, kind: 'in Excel only' }); continue; }
    // App net = dr - cr. Excel receivable = amount due to us = net dr. payable = net cr.
    const appNet = Math.round((ap.dr - ap.cr) * 100) / 100;
    const exNet = Math.round((ex.receivable - ex.payable) * 100) / 100;
    if (appNet === exNet) exact++;
    else { mismatch++; details.push({ name: key, kind: 'MISMATCH', appNet, exNet, appDr: ap.dr, appCr: ap.cr, exRec: ex.receivable, exPay: ex.payable }); }
}
for (const [key, ap] of Object.entries(appBalances)) {
    if (!excelBalances[key] && (ap.dr !== 0 || ap.cr !== 0)) onlyApp++;
}
console.log(`Parties with EXACT match: ${exact}`);
console.log(`Mismatches: ${mismatch}`);
console.log(`In Excel only: ${onlyExcel} | In app only (with activity): ${onlyApp}`);
for (const d of details.slice(0, 20)) {
    if (d.kind === 'MISMATCH') console.log(`  ✗ ${d.name}: app net ${d.appNet} (Dr ${d.appDr} / Cr ${d.appCr}) vs Excel net ${d.exNet} (Rec ${d.exRec} / Pay ${d.exPay})`);
    else console.log(`  · ${d.name}: ${d.kind}`);
}

// ── Sanity checks ──
console.log('\n=== DATA SANITY CHECKS ===');
const sales = db.prepare('SELECT COUNT(*) c, MIN(date) mn, MAX(date) mx FROM sales').get();
const purchases = db.prepare('SELECT COUNT(*) c FROM purchases').get();
const payments = db.prepare("SELECT COUNT(*) c FROM payments").get();
const ledger = db.prepare('SELECT COUNT(*) c FROM ledger_entries').get();
const stock = db.prepare('SELECT COUNT(*) c FROM stock_movements').get();
const bank = db.prepare('SELECT COUNT(*) c FROM bank_transactions').get();
const petty = db.prepare('SELECT COUNT(*) c FROM petty_cash').get();
const denom = db.prepare('SELECT COUNT(*) c FROM denomination_counts').get();
const testRows = db.prepare("SELECT COUNT(*) c FROM sales WHERE invoice_no LIKE '%TEST%'").get().c +
    db.prepare("SELECT COUNT(*) c FROM payments WHERE notes LIKE '%TEST%'").get().c +
    db.prepare("SELECT COUNT(*) c FROM ledger_entries WHERE description LIKE '%TEST%'").get().c;
const archived = db.prepare('SELECT COUNT(*) c FROM parties WHERE archived = 1').get().c;

console.log(`Sales: ${sales.c} (${sales.mn} → ${sales.mx})`);
console.log(`Purchases: ${purchases.c} | Payments: ${payments.c} | Ledger entries: ${ledger.c}`);
console.log(`Stock movements: ${stock.c} | Bank transactions: ${bank.c} | Petty cash: ${petty.c} | Denomination counts: ${denom.c}`);
console.log(`TEST rows: ${testRows} | Archived duplicate parties: ${archived}`);
const integrity = db.pragma('integrity_check');
console.log(`DB integrity: ${Array.isArray(integrity) ? (typeof integrity[0] === 'string' ? integrity.join(', ') : JSON.stringify(integrity[0])) : integrity}`);

const afterCutoff = db.prepare("SELECT COUNT(*) c FROM sales WHERE date > '2083/05/18'").get().c +
    db.prepare("SELECT COUNT(*) c FROM purchases WHERE date > '2083/05/18'").get().c +
    db.prepare("SELECT COUNT(*) c FROM payments WHERE date > '2083/05/18'").get().c;
console.log(`Rows dated after cutoff 2083/05/18: ${afterCutoff}`);
db.close();