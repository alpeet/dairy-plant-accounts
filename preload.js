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
    getDayBook: (opts) => ipcRenderer.invoke('db:reports:daybook', opts),
    getReceivables: () => ipcRenderer.invoke('db:reports:receivables'),
    getPayables: () => ipcRenderer.invoke('db:reports:payables'),
    getSalesRegister: (opts) => ipcRenderer.invoke('db:reports:sales-register', opts),
    getPurchaseRegister: (opts) => ipcRenderer.invoke('db:reports:purchase-register', opts),
    getProfitLoss: (opts) => ipcRenderer.invoke('db:reports:profit-loss', opts),
    getStockStatement: (opts) => ipcRenderer.invoke('db:reports:stock-statement', opts),
    getEnhancedDaybook: (opts) => ipcRenderer.invoke('db:reports:enhanced-daybook', opts),
    getTodaySummary: () => ipcRenderer.invoke('db:reports:today-summary'),
    getFarmerStatement: (opts) => ipcRenderer.invoke('db:reports:farmer-statement', opts),

    // Statements
    getPartyStatement: (opts) => ipcRenderer.invoke('db:statements:party', opts),
    getPartiesWithBalance: (opts) => ipcRenderer.invoke('db:statements:parties-with-balance', opts),

    // Daily Cash Collection
    getDailyCashCollection: (opts) => ipcRenderer.invoke('db:cash:daily-collection', opts),
    saveCashCollection: (data) => ipcRenderer.invoke('db:cash:collection-save', data),
    deleteCashCollection: (id) => ipcRenderer.invoke('db:cash:collection-delete', id),

    // Denomination
    getDenominations: (opts) => ipcRenderer.invoke('db:denominations:list', opts),
    getDenomination: (id) => ipcRenderer.invoke('db:denominations:get', id),
    getDenominationByDate: (date) => ipcRenderer.invoke('db:denominations:get-by-date', { date }),
    saveDenomination: (data) => ipcRenderer.invoke('db:denominations:save', data),
    deleteDenomination: (id) => ipcRenderer.invoke('db:denominations:delete', id),

    // Petty Cash
    getPettyCashList: (opts) => ipcRenderer.invoke('db:petty-cash:list', opts),
    getPettyCash: (id) => ipcRenderer.invoke('db:petty-cash:get', id),
    savePettyCash: (data) => ipcRenderer.invoke('db:petty-cash:save', data),
    deletePettyCash: (id) => ipcRenderer.invoke('db:petty-cash:delete', id),
    getPettyCashSummary: (opts) => ipcRenderer.invoke('db:petty-cash:summary', opts),

    // Salary
    getSalaryList: (opts) => ipcRenderer.invoke('db:salary:list', opts),
    getSalaryRecord: (id) => ipcRenderer.invoke('db:salary:get', id),
    saveSalaryRecord: (data) => ipcRenderer.invoke('db:salary:save', data),
    deleteSalaryRecord: (id) => ipcRenderer.invoke('db:salary:delete', id),
    getSalarySummary: (opts) => ipcRenderer.invoke('db:salary:summary', opts),

    // Vehicle Expenses
    getVehicleExpenses: (opts) => ipcRenderer.invoke('db:vehicle-expenses:list', opts),
    getVehicleExpense: (id) => ipcRenderer.invoke('db:vehicle-expenses:get', id),
    saveVehicleExpense: (data) => ipcRenderer.invoke('db:vehicle-expenses:save', data),
    deleteVehicleExpense: (id) => ipcRenderer.invoke('db:vehicle-expenses:delete', id),
    getVehicleExpensesSummary: (opts) => ipcRenderer.invoke('db:vehicle-expenses:summary', opts),

    // Other Expenses
    getOtherExpenses: (opts) => ipcRenderer.invoke('db:other-expenses:list', opts),
    getOtherExpense: (id) => ipcRenderer.invoke('db:other-expenses:get', id),
    saveOtherExpense: (data) => ipcRenderer.invoke('db:other-expenses:save', data),
    deleteOtherExpense: (id) => ipcRenderer.invoke('db:other-expenses:delete', id),
    getExpenseCategories: () => ipcRenderer.invoke('db:other-expenses:categories'),
    getExpensesSummary: (opts) => ipcRenderer.invoke('db:other-expenses:summary', opts),

    // Routes
    getRoutes: (opts) => ipcRenderer.invoke('db:routes:list', opts),
    getRoute: (id) => ipcRenderer.invoke('db:routes:get', id),
    saveRoute: (data) => ipcRenderer.invoke('db:routes:save', data),
    deleteRoute: (id) => ipcRenderer.invoke('db:routes:delete', id),
    getRouteSummary: (opts) => ipcRenderer.invoke('db:routes:summary', opts),

    // Rate Charts
    getRateCharts: () => ipcRenderer.invoke('db:rates:list'),
    getRateChart: (id) => ipcRenderer.invoke('db:rates:get', id),
    saveRateChart: (data) => ipcRenderer.invoke('db:rates:save', data),
    deleteRateChart: (id) => ipcRenderer.invoke('db:rates:delete', id),
    getEffectiveRate: (date) => ipcRenderer.invoke('db:rates:effective', { date }),
    calculateMilkRate: (data) => ipcRenderer.invoke('db:rates:calculate', data),

    // Production
    getProductionBatches: (opts) => ipcRenderer.invoke('db:production:list', opts),
    getProductionBatch: (id) => ipcRenderer.invoke('db:production:get', id),
    saveProductionBatch: (data) => ipcRenderer.invoke('db:production:save', data),
    deleteProductionBatch: (id) => ipcRenderer.invoke('db:production:delete', id),
    getProcessTypes: () => ipcRenderer.invoke('db:production:process-types'),

    // Partner Capital
    getPartnerCapitalList: (opts) => ipcRenderer.invoke('db:partners:capital-list', opts),
    getPartnerCapital: (id) => ipcRenderer.invoke('db:partners:capital-get', id),
    savePartnerCapital: (data) => ipcRenderer.invoke('db:partners:capital-save', data),
    deletePartnerCapital: (id) => ipcRenderer.invoke('db:partners:capital-delete', id),
    getPartnerStatement: (opts) => ipcRenderer.invoke('db:partners:statement', opts),
    getPartnersWithBalance: () => ipcRenderer.invoke('db:partners:with-balance'),

    // Audit
    getAuditLogs: (opts) => ipcRenderer.invoke('db:audit:logs', opts),

    // Payments
    savePayment: (payment) => ipcRenderer.invoke('db:payments:save', payment),
    getPayments: (opts) => ipcRenderer.invoke('db:payments:list', opts),
    deletePayment: (id) => ipcRenderer.invoke('db:payments:delete', id),
    updatePayment: (data) => ipcRenderer.invoke('db:payments:update', data),

    // Cash Deposits
    getCashDeposits: (opts) => ipcRenderer.invoke('db:cash-deposits:list', opts),
    getCashDeposit: (id) => ipcRenderer.invoke('db:cash-deposits:get', id),
    saveCashDeposit: (data) => ipcRenderer.invoke('db:cash-deposits:save', data),
    deleteCashDeposit: (id) => ipcRenderer.invoke('db:cash-deposits:delete', id),
    getCashDepositSummary: (opts) => ipcRenderer.invoke('db:cash-deposits:summary', opts),

    // Settings
    getSettings: () => ipcRenderer.invoke('db:settings:get'),
    saveSettings: (settings) => ipcRenderer.invoke('db:settings:save', settings),
    getTableInfo: () => ipcRenderer.invoke('db:table-info'),

    // Email
    sendEmail: (opts) => ipcRenderer.invoke('email:send', opts),

    // CSV data exchange
    getCSVTables: () => ipcRenderer.invoke('data-csv:tables'),
    getCSVSample: (table) => ipcRenderer.invoke('data-csv:sample', { table }),
    exportCSV: (table) => ipcRenderer.invoke('data-csv:export', { table }),
    importCSV: (table, csv) => ipcRenderer.invoke('data-csv:import', { table, csv }),
    exportAllCSV: () => ipcRenderer.invoke('data-csv:export-all'),

    // Authentication (desktop)
    getAuthStatus: () => ipcRenderer.invoke('auth:status'),
    setupAdmin: (data) => ipcRenderer.invoke('auth:setup', data),
    login: (data) => ipcRenderer.invoke('auth:login', data),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getCurrentUser: () => ipcRenderer.invoke('auth:me'),

    // User management (desktop, admin only)
    listUsers: () => ipcRenderer.invoke('auth:users:list'),
    createUser: (data) => ipcRenderer.invoke('auth:users:create', data),
    deleteUser: (id) => ipcRenderer.invoke('auth:users:delete', id),
    changePassword: (data) => ipcRenderer.invoke('auth:users:change-password', data),

    // Export to Daily Account Pro Excel
    exportDailyAccount: (opts) => ipcRenderer.invoke('export:daily-account', opts),

    // Import from Dairy Account Pro Excel (filePath optional — shows a picker when omitted)
    importExcelFromFile: (opts) => ipcRenderer.invoke('excel:import-file', opts),

    // Backup
    backupDatabase: () => ipcRenderer.invoke('db:backup'),
    listBackups: () => ipcRenderer.invoke('db:backup:list'),
    deleteBackup: (filename) => ipcRenderer.invoke('db:backup:delete', filename),
    downloadBackupFile: (filename) => ipcRenderer.invoke('db:backup:download', filename),
    restoreBackup: (filename) => ipcRenderer.invoke('db:restore', filename),
    getDatabasePath: () => ipcRenderer.invoke('db:path'),

    // Print / PDF
    printToPDF: (opts) => ipcRenderer.invoke('print:pdf', opts),

    // Dialog
    showSaveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts)
});
