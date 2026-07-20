/**
 * Godhuli Dairy Plant — Operations Index
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
    savePayment, listPayments
} = require('./payments');

const {
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables,
    getSalesRegister, getPurchaseRegister, getTodaySummary
} = require('./reports');

const {
    getSettings, saveSettings
} = require('./settings');

const { backupDatabase } = require('./backup');

// ── New modules ──
const { getPartyStatement, listPartiesWithBalance } = require('./statements');
const { getDailyCashCollection } = require('./cash');
const {
    listDenominations, getDenomination, getDenominationByDate,
    saveDenomination, deleteDenomination
} = require('./denominations');
const {
    listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary
} = require('./petty_cash');
const {
    listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary
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

// ── Routes, Rates, Production, Partners ──
const { listRoutes, getRoute, saveRoute, deleteRoute, getRouteSummary } = require('./routes');
const { listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate } = require('./rates');
const { listProductionBatches, getProductionBatch, saveProductionBatch, deleteProductionBatch, getProcessTypes } = require('./production');
const { listPartnerCapital, getPartnerCapital, savePartnerCapital, deletePartnerCapital, getPartnerStatement, listPartnersWithBalance } = require('./partners');

module.exports = {
    // Dashboard
    getDashboard,

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
    savePayment, listPayments,

    // Reports
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables,
    getSalesRegister, getPurchaseRegister, getTodaySummary,

    // Settings
    getSettings, saveSettings,

    // Backup
    backupDatabase,

    // ── New modules ──
    // Statements
    getPartyStatement, listPartiesWithBalance,

    // Cash
    getDailyCashCollection,

    // Denominations
    listDenominations, getDenomination, getDenominationByDate,
    saveDenomination, deleteDenomination,

    // Petty Cash
    listPettyCash, getPettyCash, savePettyCash, deletePettyCash, getPettyCashSummary,

    // Salary
    listSalaryRecords, getSalaryRecord, saveSalaryRecord, deleteSalaryRecord, getSalarySummary,

    // Vehicle Expenses
    listVehicleExpenses, getVehicleExpense, saveVehicleExpense,
    deleteVehicleExpense, getVehicleExpensesSummary,

    // Other Expenses
    listOtherExpenses, getOtherExpense, saveOtherExpense,
    deleteOtherExpense, getExpenseCategories, getExpensesSummary,

    // Audit
    logAudit, getAuditLogs,

    // Routes
    listRoutes, getRoute, saveRoute, deleteRoute, getRouteSummary,

    // Rate Charts
    listRateCharts, getRateChart, saveRateChart, deleteRateChart, getEffectiveRate, calculateMilkRate,

    // Production
    listProductionBatches, getProductionBatch, saveProductionBatch, deleteProductionBatch, getProcessTypes,

    // Partner Capital
    listPartnerCapital, getPartnerCapital, savePartnerCapital, deletePartnerCapital, getPartnerStatement, listPartnersWithBalance,
};
