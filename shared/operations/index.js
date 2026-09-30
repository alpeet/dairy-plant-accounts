/**
 * Prarambha Account & Stock Management — Operations Index
 * =======================================
 * Exports all shared business operations for use by
 * both the Electron desktop app (main.js) and the web server (server.js).
 *
 * Usage:
 *   const ops = require('./shared/operations');
 *   const dashboard = ops.getDashboard(db);
 *   ops.saveSale(db, saleData);
 */

const { getDashboard } = require('./dashboard');
const { globalSearch } = require('./search');

const {
    listParties, getParty, saveParty, deleteParty, getPartyLedger
} = require('./parties');

const {
    listProducts, getProduct, saveProduct, deleteProduct
} = require('./products');

const {
    getCurrentStock, getStockMovements, adjustStock
} = require('./stock');

const {
    listSales, getSale, saveSale, deleteSale
} = require('./sales');

const {
    listPurchases, getPurchase, savePurchase, deletePurchase
} = require('./purchases');

const {
    getOrCreateRawMilkProduct,
    listMilkCollections, getMilkCollection,
    saveMilkCollection, deleteMilkCollection, getMilkSummary
} = require('./milk');

const {
    getFarmerOutstanding, bulkPayFarmers
} = require('./farmer');

const {
    savePayment, listPayments, deletePayment, updatePayment
} = require('./payments');

const {
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables,
    getSalesRegister, getPurchaseRegister, getTodaySummary, getFarmerStatement
} = require('./reports');

const {
    getSettings, saveSettings
} = require('./settings');

const { backupDatabase, backupDatabaseToPath, restoreDatabase, restoreDatabaseFromPath, listBackups, deleteBackup, formatFileSize, getBackupDir } = require('./backup');

// ── New modules ──
const { getPartyStatement, listPartiesWithBalance } = require('./statements');
const { getPartyAccountSummary } = require('./party_account');
const { getDailyCashCollection, saveCashCollection, deleteCashCollection } = require('./cash');
const {
    listDenominations, getDenomination, getDenominationByDate,
    saveDenomination, deleteDenomination
} = require('./denominations');
const {
    listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary
} = require('./petty_cash');
const {
    listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary,
    listEmployees, saveEmployee, deleteEmployee
} = require('./salary');
const {
    listVehicleExpenses, getVehicleExpense, saveVehicleExpense,
    deleteVehicleExpense, getVehicleExpensesSummary
} = require('./vehicle');
const {
    listOtherExpenses, getOtherExpense, saveOtherExpense,
    deleteOtherExpense, getExpenseCategories, getExpensesSummary
} = require('./expenses');
const { logAudit, getAuditLogs } = require('./audit');
const { getFreshStartStatus, getFreshStartWipePlan, setSecurityCode, performCleanup, verifyBackupFile, FRESH_START_KEEP_TABLES } = require('./data_cleanup');
const { runIntegrityChecks } = require('./integrity');
const { getTableInfo } = require('./table_info');
const { sendEmail, getSmtpSettings, isValidEmail } = require('./email');

// ── Financial Reports ──
const { getProfitLoss, getProfitLossByMonth, getStockStatement, getEnhancedDaybook } = require('./financial_reports');

// ── Cash Deposits ──
const {
    listCashDeposits, getCashDeposit, saveCashDeposit,
    deleteCashDeposit, getCashDepositSummary, generateDepositNo
} = require('./cash_deposit');

// ── Routes, Rates, Production, Partners ──
const { listRoutes, getRoute, saveRoute, deleteRoute, getRouteSummary } = require('./routes');
const { listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate } = require('./rates');
const { listProductionBatches, getProductionBatch, saveProductionBatch, deleteProductionBatch, getProcessTypes } = require('./production');
const { listPartnerCapital, getPartnerCapital, savePartnerCapital, deletePartnerCapital, getPartnerStatement, listPartnersWithBalance } = require('./partners');

// ── Production Costing — lots, FIFO, NRV, real COGS ──
const costing = require('./production_costing');

// ── Bank Transactions ──
const {
    ensureBankTable, listBankTransactions, getBankTransaction, getBankReviewQueue,
    getBankStatement, saveBankTransaction, deleteBankTransaction, setBankMatch,
    postBankToLedger, importBankRows, findPartyByName, normalizeName,
    bankRowClass, isNonPartyRow
} = require('./bank');

// ── Accounting core (money precision, account mapping, settlement, reconcile) ──
const accounting = require('./accounting');

// ── Bulk (date-wise) entry — same backend as single entry & Excel import ──
const bulkEntry = require('./bulk_entry');

// ── Post-Dated Cheques (PDC register + lifecycle) ──
const {
    listPdcCheques, getPdcCheque, listPdcOpenDocuments, getPdcPosition,
    getPdcRegisterReport, getPdcDueReport, getPdcBouncedReport,
    savePdcCheque, allocatePdc, setPdcStatus, deletePdcCheque,
    ensurePdcTables, newPdcDefaults, PDC_STATUSES, PDC_TYPES,
    PDC_TRANSITIONS, PDC_PERMISSIONS, PDC_ACTIONS
} = require('./pdc');

module.exports = {
    // Dashboard
    getDashboard,

    // Global search
    globalSearch,

    // Parties
    listParties, getParty, saveParty, deleteParty, getPartyLedger,

    // Products
    listProducts, getProduct, saveProduct, deleteProduct,

    // Stock
    getCurrentStock, getStockMovements, adjustStock,

    // Sales
    listSales, getSale, saveSale, deleteSale,

    // Purchases
    listPurchases, getPurchase, savePurchase, deletePurchase,

    // Milk Collections
    getOrCreateRawMilkProduct,
    listMilkCollections, getMilkCollection, saveMilkCollection,
    deleteMilkCollection, getMilkSummary,

    // Farmer Bulk Payment
    getFarmerOutstanding, bulkPayFarmers,

    // Payments
    savePayment, listPayments, deletePayment, updatePayment,

    // Reports
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables,
    getSalesRegister, getPurchaseRegister, getTodaySummary, getFarmerStatement,

    // Settings
    getSettings, saveSettings,

    // Fresh Start / Handover Reset — admin password + security code gated
    getFreshStartStatus, setSecurityCode, performCleanup,

    // Backup
    backupDatabase,
    backupDatabaseToPath,
    restoreDatabase,
    restoreDatabaseFromPath,
    listBackups,
    deleteBackup,
    formatFileSize,
    getBackupDir,

    // Fresh Start / Handover Reset
    getFreshStartStatus,
    getFreshStartWipePlan,
    verifyBackupFile,
    FRESH_START_KEEP_TABLES,

    // ── New modules ──
    // Statements
    getPartyStatement, listPartiesWithBalance, getPartyAccountSummary,

    // Cash
    getDailyCashCollection, saveCashCollection, deleteCashCollection,

    // Denominations
    listDenominations, getDenomination, getDenominationByDate,
    saveDenomination, deleteDenomination,

    // Petty Cash
    listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary,

    // Salary
    listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary,
    listEmployees, saveEmployee, deleteEmployee,

    // Vehicle Expenses
    listVehicleExpenses, getVehicleExpense, saveVehicleExpense,
    deleteVehicleExpense, getVehicleExpensesSummary,

    // Other Expenses
    listOtherExpenses, getOtherExpense, saveOtherExpense,
    deleteOtherExpense, getExpenseCategories, getExpensesSummary,

    // Financial Reports
    getProfitLoss, getProfitLossByMonth, getStockStatement, getEnhancedDaybook,

    // Cash Deposits
    listCashDeposits, getCashDeposit, saveCashDeposit,
    deleteCashDeposit, getCashDepositSummary, generateDepositNo,

    // Database Table Info
    getTableInfo,

    // Email
    sendEmail, getSmtpSettings, isValidEmail,

    // Audit
    logAudit, getAuditLogs,

    // Data Integrity Doctor (read-only)
    runIntegrityChecks,

    // Routes
    listRoutes, getRoute, saveRoute, deleteRoute, getRouteSummary,

    // Rate Charts
    listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate,

    // Production
    listProductionBatches, getProductionBatch, saveProductionBatch, deleteProductionBatch, getProcessTypes,

    // Production Costing — raw-milk lots, finished-goods lots, FIFO COGS,
    // NRV allocation, expiry/wastage, daily reconciliation, batch margin.
    // lotTracked guards every entry point; before cutover it is all no-op/pass-through.
    getLotCutover: costing.getLotCutover,
    setLotCutover: costing.setLotCutover,
    lotTracked: costing.lotTracked,
    getMilkLots: costing.getMilkLots,
    getStockLots: costing.getStockLots,
    suggestMilkConsumption: costing.suggestMilkConsumption,
    postProductionBatch: costing.postProductionBatch,
    previewBatchCosting: costing.previewBatchCosting,
    reverseProductionBatch: costing.reverseProductionBatch,
    costSaleItem: costing.costSaleItem,
    reverseSaleCosting: costing.reverseSaleCosting,
    getExpiredLots: costing.getExpiredLots,
    writeOffExpiredStock: costing.writeOffExpiredStock,
    recordWastage: costing.recordWastage,
    getWastageReport: costing.getWastageReport,
    getDailyReconciliation: costing.getDailyReconciliation,
    getBatchMargin: costing.getBatchMargin,
    createOpeningStockLots: costing.createOpeningStockLots,

    // Partner Capital
    listPartnerCapital, getPartnerCapital, savePartnerCapital, deletePartnerCapital, getPartnerStatement, listPartnersWithBalance,

    // Bank Transactions
    ensureBankTable, listBankTransactions, getBankTransaction, getBankReviewQueue,
    getBankStatement, saveBankTransaction, deleteBankTransaction, setBankMatch,
    postBankToLedger, importBankRows, findPartyByName, normalizeName,
    bankRowClass, isNonPartyRow,

    // Accounting Core — ONE source of truth for precision, the debit/credit
    // account mapping, milk cost recognised once, bank-row classification,
    // sale settlement from actual receipts, cash/bank position and the
    // cross-module reconciliation.
    CURRENCY_TOLERANCE: accounting.CURRENCY_TOLERANCE,
    round2: accounting.round2,
    moneyEq: accounting.moneyEq,
    paymentStatus: accounting.paymentStatus,
    ACCOUNT: accounting.ACCOUNT,
    classifyTransaction: accounting.classifyTransaction,
    classifyBankRow: accounting.classifyBankRow,
    listClassifiedBankRows: accounting.listClassifiedBankRows,
    getMilkCostSummary: accounting.getMilkCostSummary,
    getSaleSettlements: accounting.getSaleSettlements,
    getCashBankPosition: accounting.getCashBankPosition,
    getExpenseSummary: accounting.getExpenseSummary,
    getReconciliation: accounting.getReconciliation,

    // Bulk (date-wise) entry — Mode B data entry. Every row reuses
    // saveMilkCollection/savePurchase/saveSale, so validation, ledger, stock,
    // milk lots, audit and reports are identical to one-by-one entry.
    saveBulkCollections: bulkEntry.saveBulkCollections,
    saveBulkPurchases: bulkEntry.saveBulkPurchases,
    saveBulkSales: bulkEntry.saveBulkSales,
    loadBulkCollections: bulkEntry.loadBulkCollections,
    loadBulkSales: bulkEntry.loadBulkSales,
    loadBulkPurchases: bulkEntry.loadBulkPurchases,

    // Post-Dated Cheques — an instrument, not money: nothing is posted while a
    // cheque is HELD/DEPOSITED; clearing posts one normal receipt/payment, and
    // bouncing a cleared cheque reverses exactly that row.
    listPdcCheques, getPdcCheque, listPdcOpenDocuments, getPdcPosition,
    getPdcRegisterReport, getPdcDueReport, getPdcBouncedReport,
    savePdcCheque, allocatePdc, setPdcStatus, deletePdcCheque,
    ensurePdcTables, newPdcDefaults,
    PDC_STATUSES, PDC_TYPES, PDC_TRANSITIONS, PDC_PERMISSIONS, PDC_ACTIONS
};
