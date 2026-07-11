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
    getSalesReport, getPurchasesReport, getDaybook, getReceivables, getPayables
} = require('./reports');

const {
    getSettings, saveSettings
} = require('./settings');

const { backupDatabase } = require('./backup');

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

    // Settings
    getSettings, saveSettings,

    // Backup
    backupDatabase,
};
