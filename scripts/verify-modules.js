#!/usr/bin/env node
// Smoke test: verify every module operation works against the target DB
const D = require('better-sqlite3');
const ops = require('../shared/operations');

const dbPath = process.argv[2] || '/Users/sushilgautam/Library/Application Support/prarambha-account-stock/data/dairy-plant.db';
const db = new D(dbPath, { readonly: true });

const tests = [
    ['dashboard', () => ops.getDashboard(db)],
    ['parties', () => ops.listParties(db, {})],
    ['products', () => ops.listProducts(db, {})],
    ['stock', () => ops.getCurrentStock(db, {})],
    ['sales', () => ops.listSales(db, {})],
    ['purchases', () => ops.listPurchases(db, {})],
    ['milk', () => ops.listMilkCollections(db, {})],
    ['milk-summary', () => ops.getMilkSummary(db, {})],
    ['farmer-outstanding', () => ops.getFarmerOutstanding(db)],
    ['payments', () => ops.listPayments(db, {})],
    ['profit-loss', () => ops.getProfitLoss(db, {})],
    ['stock-statement', () => ops.getStockStatement(db, {})],
    ['enhanced-daybook', () => ops.getEnhancedDaybook(db, {})],
    ['sales-register', () => ops.getSalesRegister(db, {})],
    ['purchase-register', () => ops.getPurchaseRegister(db, {})],
    ['today-summary', () => ops.getTodaySummary(db)],
    ['farmer-statement', () => ops.getFarmerStatement(db, {})],
    ['party-statement', () => ops.getPartyStatement(db, {})],
    ['parties-with-balance', () => ops.listPartiesWithBalance(db, {})],
    ['cash-daily', () => ops.getDailyCashCollection(db, {})],
    ['cash-deposits', () => ops.listCashDeposits(db, {})],
    ['denominations', () => ops.listDenominations(db, {})],
    ['petty-cash', () => ops.listPettyCash(db, {})],
    ['salary', () => ops.listSalaryRecords(db, {})],
    ['salary-summary', () => ops.getSalarySummary(db, {})],
    ['vehicle', () => ops.listVehicleExpenses(db, {})],
    ['other-expenses', () => ops.listOtherExpenses(db, {})],
    ['expense-categories', () => ops.getExpenseCategories(db)],
    ['routes', () => ops.listRoutes(db, {})],
    ['rate-charts', () => ops.listRateCharts(db)],
    ['effective-rate', () => ops.getEffectiveRate(db, null)],
    ['production', () => ops.listProductionBatches(db, {})],
    ['process-types', () => ops.getProcessTypes(db)],
    ['partner-capital', () => ops.listPartnerCapital(db, {})],
    ['partners-with-balance', () => ops.listPartnersWithBalance(db)],
    ['audit-logs', () => ops.getAuditLogs(db, {})],
    ['settings', () => ops.getSettings(db)],
    ['table-info', () => ops.getTableInfo(db)],
    ['receivables', () => ops.getReceivables(db)],
    ['payables', () => ops.getPayables(db)],
    ['daybook', () => ops.getDaybook(db, {})]
];

let pass = 0, fail = 0;
for (const [name, fn] of tests) {
    try {
        const r = fn();
        const ok = r && typeof r === 'object';
        pass++;
        console.log(`  ✅ ${name.padEnd(22)} ${ok ? 'OK' : '??'}`);
    } catch (e) {
        fail++;
        console.log(`  ❌ ${name.padEnd(22)} ${e.message.split('\n')[0]}`);
    }
}
console.log(`\n  ${pass} passed, ${fail} failed`);
db.close();
process.exit(fail ? 1 : 0);
