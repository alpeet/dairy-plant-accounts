/**
 * Web API Client
 * Drop-in replacement for Electron's preload.js (contextBridge)
 * Uses fetch() instead of ipcRenderer.invoke()
 * All methods return { success: true, data: result } or { success: false, error: message }
 *
 * IMPORTANT: In Electron, the preload.js already sets window.api via contextBridge.
 * This file only provides the API when running in a web browser (no Electron).
 */

// Check if we're running in Electron — if so, preload.js via contextBridge handles the API
// In Electron, loadFile() uses file:// protocol. In web browser, it's http:// or https://
if (typeof location !== 'undefined' && location.protocol === 'file:') {
    console.log('Electron mode: using IPC-based API from preload.js');
} else {
    // Web browser mode — provide fetch-based API
    const API_BASE = '/api';

    async function apiPost(endpoint, data = {}) {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            
            // Read response as text first to handle empty body gracefully
            const text = await response.text();
            
            // Check for non-OK status
            if (!response.ok) {
                return { 
                    success: false, 
                    error: `Server error (${response.status}): ${response.statusText}` 
                };
            }
            
            // Check for empty body
            if (!text || text.trim().length === 0) {
                return { 
                    success: false, 
                    error: `Server returned empty response for ${endpoint}` 
                };
            }
            
            // Parse JSON
            try {
                return JSON.parse(text);
            } catch (parseErr) {
                console.error(`API Parse Error (${endpoint}):`, text.substring(0, 200));
                return { 
                    success: false, 
                    error: `Invalid JSON response: ${text.substring(0, 100)}` 
                };
            }
        } catch (err) {
            console.error(`API Error (${endpoint}):`, err);
            return { success: false, error: `Connection error: ${err.message}` };
        }
    }

    window.api = {
        // Dashboard
        getDashboard: () => apiPost('/dashboard'),

        // Parties
        getParties: (opts) => apiPost('/parties/list', opts || {}),
        getParty: (id) => apiPost('/parties/get', { id }),
        saveParty: (party) => apiPost('/parties/save', party),
        deleteParty: (id) => apiPost('/parties/delete', { id }),
        getLedger: (opts) => apiPost('/parties/ledger', opts || {}),

        // Products
        getProducts: (opts) => apiPost('/products/list', opts || {}),
        getProduct: (id) => apiPost('/products/get', { id }),
        saveProduct: (product) => apiPost('/products/save', product),
        deleteProduct: (id) => apiPost('/products/delete', { id }),

        // Stock
        getStockCurrent: (opts) => apiPost('/stock/current', opts || {}),
        getStockMovements: (opts) => apiPost('/stock/movements', opts || {}),
        adjustStock: (data) => apiPost('/stock/adjust', data),

        // Sales
        getSales: (opts) => apiPost('/sales/list', opts || {}),
        getSale: (id) => apiPost('/sales/get', { id }),
        saveSale: (sale) => apiPost('/sales/save', sale),
        deleteSale: (id) => apiPost('/sales/delete', { id }),

        // Purchases
        getPurchases: (opts) => apiPost('/purchases/list', opts || {}),
        getPurchase: (id) => apiPost('/purchases/get', { id }),
        savePurchase: (purchase) => apiPost('/purchases/save', purchase),
        deletePurchase: (id) => apiPost('/purchases/delete', { id }),

        // Milk Collections
        getMilkCollections: (opts) => apiPost('/milk/list', opts || {}),
        getMilkCollection: (id) => apiPost('/milk/get', { id }),
        saveMilkCollection: (data) => apiPost('/milk/save', data),
        deleteMilkCollection: (id) => apiPost('/milk/delete', { id }),
        getMilkSummary: (opts) => apiPost('/milk/summary', opts || {}),

        // Farmer Payments
        getFarmerOutstanding: () => apiPost('/farmer/outstanding'),
        bulkPayFarmers: (data) => apiPost('/farmer/bulk-pay', data),

        // Reports
        // Reports
        getSalesReport: (opts) => apiPost('/reports/sales', opts || {}),
        getPurchasesReport: (opts) => apiPost('/reports/purchases', opts || {}),
        getDayBook: (opts) => apiPost('/reports/daybook', opts || {}),
        getFarmerStatement: (opts) => apiPost('/reports/farmer-statement', opts || {}),
        getReceivables: () => apiPost('/reports/receivables'),
        getPayables: () => apiPost('/reports/payables'),
        getSalesRegister: (opts) => apiPost('/reports/sales-register', opts || {}),
        getPurchaseRegister: (opts) => apiPost('/reports/purchase-register', opts || {}),
        getTodaySummary: () => apiPost('/reports/today-summary'),

        // Statements
        getPartyStatement: (opts) => apiPost('/statements/party', opts || {}),
        getPartiesWithBalance: (opts) => apiPost('/statements/parties-with-balance', opts || {}),

        // Daily Cash Collection
        getDailyCashCollection: (opts) => apiPost('/cash/daily-collection', opts || {}),

        // Denomination
        getDenominations: (opts) => apiPost('/denominations/list', opts || {}),
        getDenomination: (id) => apiPost('/denominations/get', { id }),
        getDenominationByDate: (date) => apiPost('/denominations/get-by-date', { date }),
        saveDenomination: (data) => apiPost('/denominations/save', data),
        deleteDenomination: (id) => apiPost('/denominations/delete', { id }),

        // Petty Cash
        getPettyCashList: (opts) => apiPost('/petty-cash/list', opts || {}),
        getPettyCash: (id) => apiPost('/petty-cash/get', { id }),
        savePettyCash: (data) => apiPost('/petty-cash/save', data),
        deletePettyCash: (id) => apiPost('/petty-cash/delete', { id }),
        getPettyCashSummary: (opts) => apiPost('/petty-cash/summary', opts || {}),

        // Salary
        getSalaryList: (opts) => apiPost('/salary/list', opts || {}),
        getSalaryRecord: (id) => apiPost('/salary/get', { id }),
        saveSalaryRecord: (data) => apiPost('/salary/save', data),
        deleteSalaryRecord: (id) => apiPost('/salary/delete', { id }),
        getSalarySummary: (opts) => apiPost('/salary/summary', opts || {}),

        // Vehicle Expenses
        getVehicleExpenses: (opts) => apiPost('/vehicle-expenses/list', opts || {}),
        getVehicleExpense: (id) => apiPost('/vehicle-expenses/get', { id }),
        saveVehicleExpense: (data) => apiPost('/vehicle-expenses/save', data),
        deleteVehicleExpense: (id) => apiPost('/vehicle-expenses/delete', { id }),
        getVehicleExpensesSummary: (opts) => apiPost('/vehicle-expenses/summary', opts || {}),

        // Other Expenses
        getOtherExpenses: (opts) => apiPost('/other-expenses/list', opts || {}),
        getOtherExpense: (id) => apiPost('/other-expenses/get', { id }),
        saveOtherExpense: (data) => apiPost('/other-expenses/save', data),
        deleteOtherExpense: (id) => apiPost('/other-expenses/delete', { id }),
        getExpenseCategories: () => apiPost('/other-expenses/categories'),
        getExpensesSummary: (opts) => apiPost('/other-expenses/summary', opts || {}),

        // Routes
        getRoutes: (opts) => apiPost('/routes/list', opts || {}),
        getRoute: (id) => apiPost('/routes/get', { id }),
        saveRoute: (data) => apiPost('/routes/save', data),
        deleteRoute: (id) => apiPost('/routes/delete', { id }),
        getRouteSummary: (opts) => apiPost('/routes/summary', opts || {}),

        // Rate Charts
        getRateCharts: () => apiPost('/rates/list'),
        getRateChart: (id) => apiPost('/rates/get', { id }),
        saveRateChart: (data) => apiPost('/rates/save', data),
        deleteRateChart: (id) => apiPost('/rates/delete', { id }),
        getEffectiveRate: (date) => apiPost('/rates/effective', { date }),
        calculateMilkRate: (data) => apiPost('/rates/calculate', data),

        // Production
        getProductionBatches: (opts) => apiPost('/production/list', opts || {}),
        getProductionBatch: (id) => apiPost('/production/get', { id }),
        saveProductionBatch: (data) => apiPost('/production/save', data),
        deleteProductionBatch: (id) => apiPost('/production/delete', { id }),
        getProcessTypes: () => apiPost('/production/process-types'),

        // Partner Capital
        getPartnerCapitalList: (opts) => apiPost('/partners/capital-list', opts || {}),
        getPartnerCapital: (id) => apiPost('/partners/capital-get', { id }),
        savePartnerCapital: (data) => apiPost('/partners/capital-save', data),
        deletePartnerCapital: (id) => apiPost('/partners/capital-delete', { id }),
        getPartnerStatement: (opts) => apiPost('/partners/statement', opts || {}),
        getPartnersWithBalance: () => apiPost('/partners/with-balance'),

        // Audit
        getAuditLogs: (opts) => apiPost('/audit/logs', opts || {}),

        // Payments
        savePayment: (payment) => apiPost('/payments/save', payment),
        getPayments: (opts) => apiPost('/payments/list', opts || {}),

        // Users (auth management)
        listUsers: () => apiPost('/auth/users/list'),
        createUser: (data) => apiPost('/auth/users/create', data),
        deleteUser: (id) => apiPost('/auth/users/delete', { id }),
        changePassword: (data) => apiPost('/auth/users/change-password', data),

        // Settings
        getSettings: () => apiPost('/settings/get'),
        saveSettings: (settings) => apiPost('/settings/save', settings),

        // Backup
        backupDatabase: () => apiPost('/backup'),
        listBackups: () => apiPost('/backup/list'),
        deleteBackup: (filename) => apiPost('/backup/delete', { filename }),
        getDatabasePath: () => apiPost('/db-path'),

        // Print / PDF (web version: returns HTML, use window.print() instead)
        printToPDF: async (opts) => {
            // For web: open HTML in new window for printing/saving as PDF
            if (opts && opts.html) {
                // Determine paper size: from opts first, then settings cache
                let paperSize = opts.pageSize || 'A4';
                if (!opts.pageSize) {
                    try {
                        const cached = typeof _settingsCache !== 'undefined' && _settingsCache;
                        if (cached && cached.paper_size) {
                            paperSize = cached.paper_size;
                        } else if (typeof getSettingsCached === 'function') {
                            const settings = await getSettingsCached();
                            if (settings && settings.paper_size) paperSize = settings.paper_size;
                        }
                    } catch(e) {}
                }

                const printWindow = window.open('', '_blank', 'width=800,height=600');
                if (!printWindow) {
                    return { success: false, error: 'Popup blocked. Allow pop-ups for printing.' };
                }
                const css = window.PRINT_CSS || '';
                printWindow.document.write('<html><head><title>Print</title>');
                printWindow.document.write('<style>');
                printWindow.document.write(css);
                printWindow.document.write(`@page { size: ${paperSize}; }`);
                printWindow.document.write('</style></head><body>');
                printWindow.document.write(opts.html);
                printWindow.document.write('</body></html>');
                printWindow.document.close();
                printWindow.focus();
                // Auto-open print dialog after a short delay
                setTimeout(() => printWindow.print(), 500);
                return { success: true, path: 'printed' };
            }
            return { success: false, error: 'No HTML content' };
        },

        // Dialog (web version: no native dialogs, just return mock)
        showSaveDialog: async (opts) => {
            return { canceled: true };
        }
    };
}
