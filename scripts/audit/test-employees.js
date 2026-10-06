#!/usr/bin/env node
/**
 * D6 — EMPLOYEES & SALARY NORMALIZATION (req 27/28/29)
 * =====================================================
 *  1. bsMonthFromRemarks — payroll month from remarks (stale Month column)
 *  2. resolveEmployee — case/space/spelling-insensitive master resolution
 *  3. saveSalaryRecord — rejects amount-shaped names, stores employee_id +
 *     the canonical master name
 *  4. Salary Advance import — all 9 Excel employee-months (stale Month column
 *     corrected from remarks), no duplicate employees, idempotent re-import
 *  5. findDuplicateEmployees + mergeEmployees — suspects surfaced, records
 *     re-pointed, source deactivated, audit trail written
 *
 * Exit code 0 = all passed, 1 = at least one failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..', '..');
const { initDatabase } = require(path.join(ROOT, 'shared', 'db'));
const xl = require(path.join(ROOT, 'shared', 'excel-import'));
const salaryOps = require(path.join(ROOT, 'shared', 'operations', 'salary'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ FAIL — ' + name + (extra !== undefined ? '   [got ' + JSON.stringify(extra) + ']' : '')); }
}

// ════════════════════════════════════════════════════════════
console.log('\nTEST 1 — bsMonthFromRemarks (payroll month from remarks)');
// ════════════════════════════════════════════════════════════
ok(xl.bsMonthFromRemarks('2083 ASHADH SALARY 15-32') === '2083-03', 'ASHADH → 2083-03', xl.bsMonthFromRemarks('2083 ASHADH SALARY 15-32'));
ok(xl.bsMonthFromRemarks('2083 SHRAWAN SALARY') === '2083-04', 'SHRAWAN → 2083-04', xl.bsMonthFromRemarks('2083 SHRAWAN SALARY'));
ok(xl.bsMonthFromRemarks('2083 BHADRA SALARY') === '2083-05', 'BHADRA → 2083-05', xl.bsMonthFromRemarks('2083 BHADRA SALARY'));
ok(xl.bsMonthFromRemarks('advance by lila sir') === null, 'no month/year in text → null (falls back to the column)');
ok(xl.bsMonthFromRemarks('') === null, 'empty remarks → null');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 2 — resolveEmployee + name validation');
// ════════════════════════════════════════════════════════════
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emp-test-'));
const db = initDatabase(dir, 'test.db');
// Seed the master exactly as the live database has it.
const seed = db.prepare('INSERT INTO employees (code, name, position) VALUES (?, ?, ?)');
const idDipak = Number(seed.run('EMP-001', 'Dipak Nepal', 'Plant Operator').lastInsertRowid);
const idSaw = Number(seed.run('EMP-002', 'Sawaswati Rayamajhi', 'Staff').lastInsertRowid);
const idNB = Number(seed.run('EMP-003', 'Nar Bahadur Rana', 'Driver').lastInsertRowid);

const rExact = salaryOps.resolveEmployee(db, 'Nar Bahadur Rana');
ok(rExact && rExact.id === idNB && rExact.fuzzy === false, 'exact name resolves');
const rCase = salaryOps.resolveEmployee(db, 'DIPAK NEPAL');
ok(rCase && rCase.id === idDipak && rCase.fuzzy === false, 'case-insensitive name resolves (no new employee)');
const rVariant = salaryOps.resolveEmployee(db, 'SARASWATI RAYMAJHI');
ok(rVariant && rVariant.id === idSaw && rVariant.fuzzy === true,
    'spelling variant fuzzy-resolves to the master spelling', rVariant);
ok(salaryOps.resolveEmployee(db, 'HARRY POTTER') === null, 'unknown name → null (no false positive)');
ok(salaryOps.isValidEmployeeName('Dipak Nepal') === true, 'real name is valid');
ok(salaryOps.isValidEmployeeName('10000') === false, '"10000" (amount in the name field) rejected');
ok(salaryOps.isValidEmployeeName('10,000.00') === false, '"10,000.00" rejected');
ok(salaryOps.isValidEmployeeName('   ') === false, 'blank rejected');

// ════════════════════════════════════════════════════════════
console.log('\nTEST 3 — Salary Advance import: 9/9 employee-months, no duplicate employees');
// ════════════════════════════════════════════════════════════
const wb = XLSX.readFile(path.join(ROOT, 'Dairy_Accounts_Professional.xlsx'));
const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets['Salary Advance'], { header: 1, defval: '' });
const rep1 = xl.importSalaryAdvanceSheet(db, sheetRows, { log: () => {} });
ok(rep1.added === 9,
    `all 9 Excel employee-months import (stale Month column corrected from remarks)`, rep1);
const emps = db.prepare('SELECT id, name FROM employees ORDER BY id').all();
ok(emps.length === 3, 'still exactly 3 employees — the spelling variant did not create a duplicate', emps.map(e => e.name));
ok(!emps.some(e => e.name === 'SARASWATI RAYMAJHI'), 'records carry the canonical master name', emps.map(e => e.name));

const byEmp = {};
for (const r of db.prepare('SELECT employee_name, month FROM salary_records').all()) {
    byEmp[r.employee_name] = byEmp[r.employee_name] || new Set();
    byEmp[r.employee_name].add(r.month);
}
const names = Object.keys(byEmp);
ok(names.length === 3, 'salary records span 3 employees', names);
const expectMonths = ['2083-03', '2083-04', '2083-05'];
ok(names.every(n => expectMonths.every(m => byEmp[n].has(m))),
    'each employee has ASHADH + SHRAWAN + BHADRA (3 × 3 = 9, none collapsed)',
    Object.fromEntries(names.map(n => [n, [...byEmp[n]]])));

const rep2 = xl.importSalaryAdvanceSheet(db, sheetRows, { log: () => {} });
ok(rep2.added === 0 && rep2.unchanged === 9 && rep2.failed === 0,
    're-import is idempotent (0 added, 9 unchanged)', rep2);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 4 — saveSalaryRecord: validation + employee linkage');
// ════════════════════════════════════════════════════════════
let threw = null;
try {
    salaryOps.saveSalaryRecord(db, { employee_name: '10000', month: '2083-06', basic_salary: 10000 });
} catch (e) { threw = e; }
ok(!!threw && /number/i.test(threw.message), 'amount-shaped employee name is rejected', threw && threw.message);

const saved = salaryOps.saveSalaryRecord(db, { employee_name: 'DIPAK NEPAL', month: '2083-06', basic_salary: 15000, created_by: null });
const savedRec = salaryOps.getSalaryRecord(db, saved.id);
ok(savedRec.employee_id === idDipak, 'record carries employee_id resolved from the master', savedRec.employee_id);
ok(savedRec.employee_name === 'Dipak Nepal', 'record carries the canonical master name (not the typed variant)', savedRec.employee_name);

const saved2 = salaryOps.saveSalaryRecord(db, { employee_name: 'SARASWATI RAYMAJHI', month: '2083-06', basic_salary: 10000 });
const savedRec2 = salaryOps.getSalaryRecord(db, saved2.id);
ok(savedRec2.employee_id === idSaw && savedRec2.employee_name === 'Sawaswati Rayamajhi',
    'spelling variant lands on the same identity', savedRec2);

// ════════════════════════════════════════════════════════════
console.log('\nTEST 5 — duplicate detection + merge');
// ════════════════════════════════════════════════════════════
// A genuinely duplicate master row (the kind free-text entry used to create).
const idDup = Number(db.prepare("INSERT INTO employees (code, name, position) VALUES ('EMP-009', 'Saraswati Raymajhi', 'Staff')").run().lastInsertRowid);
const dupRec = db.prepare(`INSERT INTO salary_records (employee_id, employee_name, position, month, basic_salary, net_salary)
    VALUES (?, 'Saraswati Raymajhi', 'Staff', '2082-11', 9000, 9000)`).run(idDup);

let dupes = salaryOps.findDuplicateEmployees(db);
ok(dupes.pairs.some(p => (p.a.id === idDup && p.b.id === idSaw) || (p.b.id === idDup && p.a.id === idSaw)),
    'fuzzy duplicate master rows are surfaced', dupes.pairs);
const orphanName = 'Gopal Bohara';
db.prepare(`INSERT INTO salary_records (employee_id, employee_name, position, month, basic_salary, net_salary)
    VALUES (NULL, ?, '', '2082-11', 7000, 7000)`).run(orphanName);
dupes = salaryOps.findDuplicateEmployees(db);
ok(dupes.orphans.some(o => o.name === orphanName), 'salary names with no master row are surfaced as orphans', dupes.orphans);

const merged = salaryOps.mergeEmployees(db, { from_id: idDup, to_id: idSaw, changed_by: null });
ok(merged.merged === true && merged.moved_records >= 1, 'merge re-points the duplicate\'s salary records', merged);
const movedRec = salaryOps.getSalaryRecord(db, Number(dupRec.lastInsertRowid));
ok(movedRec.employee_id === idSaw && movedRec.employee_name === 'Sawaswati Rayamajhi',
    'merged record now belongs to the canonical employee', movedRec);
const dupRow = db.prepare('SELECT active FROM employees WHERE id = ?').get(idDup);
ok(dupRow.active === 0, 'duplicate master row is deactivated (never deleted — history intact)', dupRow);
const auditRows = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE table_name = 'employees' AND record_id IN (?, ?)").get(idSaw, idDup);
ok(auditRows.c >= 2, 'merge + deactivate written to the audit log', auditRows.c);
dupes = salaryOps.findDuplicateEmployees(db);
ok(!dupes.pairs.some(p => p.a.id === idDup || p.b.id === idDup),
    'after the merge the duplicate is no longer reported');

db.close();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
