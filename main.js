const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ops = require('./shared/operations');
const { initDatabase, safeRun } = require('./shared/db');

let mainWindow;
let db = null;

// ============================================================
// Database initialization
// ============================================================

/**
 * Shared database directory — same as web server, so data is shared between versions.
 *
 * Priority:
 *   1. DB_DIR environment variable (for custom/USB setups)
 *   2. app.getPath('userData')/data — standard Electron user data (production builds)
 *   3. path.join(__dirname, 'data') — project root (development mode)
 */
function getDbDir() {
    if (process.env.DB_DIR) return process.env.DB_DIR;
    // When packaged (installed via NSIS/DMG), __dirname is inside read-only asar.
    // Use Electron's userData directory which is always writable.
    if (app.isPackaged) {
        return path.join(app.getPath('userData'), 'data');
    }
    return path.join(__dirname, 'data');
}

function initAppDatabase() {
    const dbDir = getDbDir();
    
    // Ensure dbDir exists
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    
    db = initDatabase(dbDir, 'dairy-plant.db');
    console.log('Desktop app - using database at:', path.join(dbDir, 'dairy-plant.db'));
    return path.join(dbDir, 'dairy-plant.db');
}

// ============================================================
// Window state persistence
// ============================================================

const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            return data;
        }
    } catch (e) {
        // Ignore corrupted state
    }
    return {};
}

let saveWindowStateDebounceTimer = null;

function saveWindowState() {
    if (!mainWindow) return;
    if (saveWindowStateDebounceTimer) {
        clearTimeout(saveWindowStateDebounceTimer);
    }
    saveWindowStateDebounceTimer = setTimeout(() => {
        try {
            const bounds = mainWindow.getBounds();
            const maximized = mainWindow.isMaximized();
            fs.writeFileSync(STATE_FILE, JSON.stringify({ ...bounds, maximized }));
        } catch (e) {
            // Ignore
        }
        saveWindowStateDebounceTimer = null;
    }, 300);
}

// ============================================================
// Application menu
// ============================================================

function buildAppMenu() {
    const isMac = process.platform === 'darwin';

    const template = [
        // macOS app menu
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }] : []),

        // File
        {
            label: 'File',
            submenu: [
                {
                    label: 'Backup Database',
                    accelerator: 'CmdOrCtrl+Shift+B',
                    click: async () => {
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript('window.api && window.api.backupDatabase ? window.api.backupDatabase() : null');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Print…',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript('window.print ? window.print() : null');
                        }
                    }
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },

        // Edit
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },

        // View
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },

        // Window
        {
            label: 'Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ] : [
                    { role: 'close' }
                ])
            ]
        },

        // Help
        {
            role: 'help',
            submenu: [
                {
                    label: 'User Manual',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript('window.navigateTo && window.navigateTo("user-manual")');
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'About Godhuli Dairy Plant',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Godhuli Dairy Plant',
                            message: 'Godhuli Dairy Plant',
                            detail: `Version ${app.getVersion()}\n\nAccounts & Stock Management Software\nBuilt with Electron & SQLite`
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// ============================================================
// Create main window
// ============================================================
function createWindow() {
    const savedState = loadWindowState();

    mainWindow = new BrowserWindow({
        width: savedState.width || 1280,
        height: savedState.height || 800,
        x: savedState.x,
        y: savedState.y,
        minWidth: 1024,
        minHeight: 700,
        title: 'Godhuli Dairy Plant',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        },
        show: false
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Restore maximized state
    if (savedState.maximized) {
        mainWindow.maximize();
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Save window state on resize/move
    mainWindow.on('resize', saveWindowState);
    mainWindow.on('move', saveWindowState);
    mainWindow.on('maximize', saveWindowState);
    mainWindow.on('unmaximize', saveWindowState);

    // Open external links in the default browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

// ============================================================
// IPC Handlers - Database Operations
// ============================================================

// --- Dashboard ---
ipcMain.handle('db:dashboard', async () => {
    return safeRun(() => ops.getDashboard(db));
});

// --- Parties ---
ipcMain.handle('db:parties:list', async (event, params = {}) => {
    return safeRun(() => ops.listParties(db, params));
});

ipcMain.handle('db:parties:get', async (event, id) => {
    return safeRun(() => ops.getParty(db, id));
});

ipcMain.handle('db:parties:save', async (event, party) => {
    return safeRun(() => ops.saveParty(db, party));
});

ipcMain.handle('db:parties:delete', async (event, id) => {
    return safeRun(() => ops.deleteParty(db, id));
});

ipcMain.handle('db:parties:ledger', async (event, params) => {
    return safeRun(() => ops.getPartyLedger(db, params));
});

// --- Products ---
ipcMain.handle('db:products:list', async (event, params = {}) => {
    return safeRun(() => ops.listProducts(db, params));
});

ipcMain.handle('db:products:get', async (event, id) => {
    return safeRun(() => ops.getProduct(db, id));
});

ipcMain.handle('db:products:save', async (event, product) => {
    return safeRun(() => ops.saveProduct(db, product));
});

ipcMain.handle('db:products:delete', async (event, id) => {
    return safeRun(() => ops.deleteProduct(db, id));
});

// --- Stock ---
ipcMain.handle('db:stock:current', async (event, params = {}) => {
    return safeRun(() => ops.getCurrentStock(db, params));
});

ipcMain.handle('db:stock:movements', async (event, params = {}) => {
    return safeRun(() => ops.getStockMovements(db, params));
});

ipcMain.handle('db:stock:adjust', async (event, params) => {
    return safeRun(() => ops.adjustStock(db, params));
});

// --- Sales ---
ipcMain.handle('db:sales:list', async (event, params = {}) => {
    return safeRun(() => ops.listSales(db, params));
});

ipcMain.handle('db:sales:get', async (event, id) => {
    return safeRun(() => ops.getSale(db, id));
});

ipcMain.handle('db:sales:save', async (event, saleData) => {
    return safeRun(() => ops.saveSale(db, saleData));
});

ipcMain.handle('db:sales:delete', async (event, id) => {
    return safeRun(() => ops.deleteSale(db, id));
});

// --- Purchases ---
ipcMain.handle('db:purchases:list', async (event, params = {}) => {
    return safeRun(() => ops.listPurchases(db, params));
});

ipcMain.handle('db:purchases:get', async (event, id) => {
    return safeRun(() => ops.getPurchase(db, id));
});

ipcMain.handle('db:purchases:save', async (event, purchaseData) => {
    return safeRun(() => ops.savePurchase(db, purchaseData));
});

ipcMain.handle('db:purchases:delete', async (event, id) => {
    return safeRun(() => ops.deletePurchase(db, id));
});

// --- Milk Collections ---
ipcMain.handle('db:milk:list', async (event, params = {}) => {
    return safeRun(() => ops.listMilkCollections(db, params));
});

ipcMain.handle('db:milk:get', async (event, id) => {
    return safeRun(() => ops.getMilkCollection(db, id));
});

ipcMain.handle('db:milk:save', async (event, data) => {
    return safeRun(() => ops.saveMilkCollection(db, data));
});

ipcMain.handle('db:milk:delete', async (event, id) => {
    return safeRun(() => ops.deleteMilkCollection(db, id));
});

ipcMain.handle('db:milk:summary', async (event, params = {}) => {
    return safeRun(() => ops.getMilkSummary(db, params));
});

// --- Reports ---
ipcMain.handle('db:reports:sales', async (event, params) => {
    return safeRun(() => ops.getSalesReport(db, params));
});

ipcMain.handle('db:reports:purchases', async (event, params) => {
    return safeRun(() => ops.getPurchasesReport(db, params));
});

ipcMain.handle('db:reports:daybook', async (event, params) => {
    return safeRun(() => ops.getDaybook(db, params));
});

ipcMain.handle('db:reports:receivables', async () => {
    return safeRun(() => ops.getReceivables(db));
});

ipcMain.handle('db:reports:payables', async () => {
    return safeRun(() => ops.getPayables(db));
});

// --- Farmer Bulk Payment ---
ipcMain.handle('db:farmer:outstanding', async () => {
    return safeRun(() => ops.getFarmerOutstanding(db));
});

ipcMain.handle('db:farmer:bulk-pay', async (event, params) => {
    return safeRun(() => ops.bulkPayFarmers(db, params));
});

// --- Payments ---
ipcMain.handle('db:payments:save', async (event, payment) => {
    return safeRun(() => ops.savePayment(db, payment));
});

ipcMain.handle('db:payments:list', async (event, params = {}) => {
    return safeRun(() => ops.listPayments(db, params));
});

// --- Settings ---
ipcMain.handle('db:settings:get', async () => {
    return safeRun(() => ops.getSettings(db));
});

ipcMain.handle('db:settings:save', async (event, settings) => {
    return safeRun(() => ops.saveSettings(db, settings));
});

// --- Backup ---
ipcMain.handle('db:backup', async () => {
    return safeRun(() => ops.backupDatabase(path.join(getDbDir(), 'dairy-plant.db')));
});

// --- Restore ---
ipcMain.handle('db:restore', async (event, filename) => {
    return safeRun(() => {
        const result = ops.restoreDatabase(
            path.join(getDbDir(), 'dairy-plant.db'),
            filename,
            () => {
                // Close the current database connection before restore
                try {
                    if (db && typeof db.close === 'function') {
                        db.close();
                        console.log('  → Database connection closed for restore');
                    }
                } catch (e) {
                    console.error('  ⚠️ Error closing database:', e.message);
                }
            }
        );
        // Re-initialize the database after restore
        try {
            db = initDatabase(getDbDir());
            console.log('  ✅ Database re-initialized after restore');
        } catch (err) {
            console.error('  ❌ Failed to re-initialize database after restore:', err.message);
            throw new Error('Backup restored but failed to re-initialize: ' + err.message);
        }
        return result;
    });
});

// --- Print handlers ---
ipcMain.handle('print:pdf', async (event, { html, landscape, pageSize } = {}) => {
    try {
        // Read paper size from settings (DB), fall back to passed param, then default
        let paperSize = pageSize || 'A4';
        if (!pageSize && db) {
            try {
                const setting = db.prepare("SELECT value FROM settings WHERE key = 'paper_size'").get();
                if (setting && setting.value) paperSize = setting.value;
            } catch(e) {}
        }

        const printWindow = new BrowserWindow({
            width: 800,
            height: 600,
            show: false,
            webPreferences: {
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        // Load print CSS from the shared stylesheet (single source of truth)
        const printCssPath = path.join(__dirname, 'renderer', 'css', 'print.css');
        const printCss = fs.existsSync(printCssPath)
            ? fs.readFileSync(printCssPath, 'utf8')
            : '';

        const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Godhuli Dairy Plant - Export</title>
                <style>${printCss}</style>
                <style>@page { size: ${paperSize}; }</style>
            </head>
            <body>
                ${html}
            </body>
            </html>
        `;

        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);

        const pdfData = await printWindow.webContents.printToPDF({
            printBackground: true,
            landscape: landscape || false,
            pageSize: paperSize,
            margins: { top: 10, bottom: 10, left: 10, right: 10 }
        });

        // Show save dialog
        const result = await dialog.showSaveDialog(mainWindow, {
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
            defaultPath: `dairy-report-${new Date().toISOString().split('T')[0]}.pdf`
        });

        if (!result.canceled && result.filePath) {
            fs.writeFileSync(result.filePath, pdfData);
            printWindow.close();
            return { success: true, path: result.filePath };
        }
        printWindow.close();
        return { success: false, canceled: true };
    } catch (error) {
        console.error('PDF Error:', error);
        return { success: false, error: error.message };
    }
});

// --- Save-As dialog ---
ipcMain.handle('dialog:save', async (event, options) => {
    return dialog.showSaveDialog(mainWindow, options);
});

// --- Get database path ---
ipcMain.handle('db:path', async () => {
    return path.join(getDbDir(), 'dairy-plant.db');
});

// ============================================================
// App lifecycle
// ============================================================
app.whenReady().then(() => {
    initAppDatabase();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (!db) initAppDatabase();
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (db) { db.close(); db = null; }
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    if (db) { db.close(); db = null; }
});
