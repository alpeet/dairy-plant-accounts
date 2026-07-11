const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Dashboard
    getDashboard: () => ipcRenderer.invoke('db:dashboard'),

    // Parties
    getParties: (opts) => ipcRenderer.invoke('db:parties:list', opts),
    getParty: (id) => ipcRenderer.invoke('db:parties:get', id),
    saveParty: (party) => ipcRenderer.invoke('db:parties:save', party),
    deleteParty: (id) => ipcRenderer.invoke('db:parties:delete', id),
    getLedger: (opts) => ipcRenderer.invoke('db:parties:ledger', opts),

    // Products
    getProducts: (opts) => ipcRenderer.invoke('db:products:list', opts),
    getProduct: (id) => ipcRenderer.invoke('db:products:get', id),
    saveProduct: (product) => ipcRenderer.invoke('db:products:save', product),
    deleteProduct: (id) => ipcRenderer.invoke('db:products:delete', id),

    // Stock
    getStockCurrent: (opts) => ipcRenderer.invoke('db:stock:current', opts),
    getStockMovements: (opts) => ipcRenderer.invoke('db:stock:movements', opts),
    adjustStock: (data) => ipcRenderer.invoke('db:stock:adjust', data),

    // Sales
    getSales: (opts) => ipcRenderer.invoke('db:sales:list', opts),
    getSale: (id) => ipcRenderer.invoke('db:sales:get', id),
    saveSale: (sale) => ipcRenderer.invoke('db:sales:save', sale),
    deleteSale: (id) => ipcRenderer.invoke('db:sales:delete', id),

    // Purchases
    getPurchases: (opts) => ipcRenderer.invoke('db:purchases:list', opts),
    getPurchase: (id) => ipcRenderer.invoke('db:purchases:get', id),
    savePurchase: (purchase) => ipcRenderer.invoke('db:purchases:save', purchase),
    deletePurchase: (id) => ipcRenderer.invoke('db:purchases:delete', id),

    // Milk Collections
    getMilkCollections: (opts) => ipcRenderer.invoke('db:milk:list', opts),
    getMilkCollection: (id) => ipcRenderer.invoke('db:milk:get', id),
    saveMilkCollection: (data) => ipcRenderer.invoke('db:milk:save', data),
    deleteMilkCollection: (id) => ipcRenderer.invoke('db:milk:delete', id),
    getMilkSummary: (opts) => ipcRenderer.invoke('db:milk:summary', opts),

    // Farmer Payments
    getFarmerOutstanding: () => ipcRenderer.invoke('db:farmer:outstanding'),
    bulkPayFarmers: (data) => ipcRenderer.invoke('db:farmer:bulk-pay', data),

    // Reports
    getSalesReport: (opts) => ipcRenderer.invoke('db:reports:sales', opts),
    getPurchasesReport: (opts) => ipcRenderer.invoke('db:reports:purchases', opts),
    getDayBook: (date) => ipcRenderer.invoke('db:reports:daybook', { date }),
    getReceivables: () => ipcRenderer.invoke('db:reports:receivables'),
    getPayables: () => ipcRenderer.invoke('db:reports:payables'),

    // Payments
    savePayment: (payment) => ipcRenderer.invoke('db:payments:save', payment),
    getPayments: (opts) => ipcRenderer.invoke('db:payments:list', opts),

    // Settings
    getSettings: () => ipcRenderer.invoke('db:settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('db:settings:save', settings),

    // Backup
    backupDatabase: () => ipcRenderer.invoke('db:backup'),
    getDatabasePath: () => ipcRenderer.invoke('db:path'),

    // Print / PDF
    printToPDF: (opts) => ipcRenderer.invoke('print:pdf', opts),

    // Dialog
    showSaveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts)
});
