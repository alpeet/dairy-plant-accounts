/**
 * Web API Client
 * Drop-in replacement for Electron's preload.js (contextBridge)
 * Uses fetch() instead of ipcRenderer.invoke()
 * All methods return { success: true, data: result } or { success: false, error: message }
 */

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
    getSalesReport: (opts) => apiPost('/reports/sales', opts || {}),
    getPurchasesReport: (opts) => apiPost('/reports/purchases', opts || {}),
    getDayBook: (date) => apiPost('/reports/daybook', { date }),
    getReceivables: () => apiPost('/reports/receivables'),
    getPayables: () => apiPost('/reports/payables'),

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
