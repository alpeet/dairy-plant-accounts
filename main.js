const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ops = require('./shared/operations');
const auth = require('./shared/auth');
const dataCSV = require('./shared/data-csv');
const excelImport = require('./shared/excel-import');
const { initDatabase, safeRun } = require('./shared/db');

let mainWindow;
let db = null;

// Currently logged-in desktop user (null = locked). Sessions are kept in memory
// only — every app launch requires a fresh login.
let currentUser = null;

// ============================================================
// Database initialization
// ============================================================

/**
 * Database directory — where the database + backups live.
 *
 * Priority:
 *   1. DB_DIR environment variable (custom setups)
 *   2. PORTABLE_EXECUTABLE_DIR — set automatically by the portable .exe build.
 *      Data is stored in a `data` folder NEXT TO the exe, so copying the folder
 *      (e.g. onto a USB stick) carries the database and backups with it.
 *   3. app.getPath('userData')/data — standard Electron user data (NSIS installs)
 *   4. path.join(__dirname, 'data') — project root (development mode)
 */
function getDbDir() {
    if (process.env.DB_DIR) return process.env.DB_DIR;
    if (process.env.PORTABLE_EXECUTABLE_DIR) {
        return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data');
    }
    if (app.isPackaged) {
        return path.join(app.getPath('userData'), 'data');
    }
    return path.join(__dirname, 'data');
}

/**
 * On the very first run (empty database), import the bundled business data from
 * Dairy_Accounts_Professional.xlsx so the installed app is ready to use.
 * Import is idempotent — it only runs when the database has no parties yet.
 */
function importBundledExcelData(dbDir) {
    try {
        const partyCount = db.prepare('SELECT COUNT(*) as c FROM parties').get().c;
        if (partyCount > 0) {
            console.log(`  ✅ Database has ${partyCount} parties — skipping Excel import.`);
            return;
        }
        const excelPath = path.join(__dirname, 'Dairy_Accounts_Professional.xlsx');
        if (!fs.existsSync(excelPath)) {
            console.log('  ℹ️  No bundled Excel file found — starting with an empty database.');
            return;
        }
        console.log('  📂 First run detected — importing bundled business data...');
        excelImport.runExcelImport(db, excelPath, { mode: 'fresh' });
        console.log('  ✅ Excel import finished.');
    } catch (err) {
        console.error('  ❌ Excel import failed:', err.message);
        console.error('     The app will continue with an empty database.');
    }
}

function initAppDatabase() {
    const dbDir = getDbDir();

    // Ensure dbDir exists
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }

    db = initDatabase(dbDir, 'dairy-plant.db');
    console.log('Desktop app - using database at:', path.join(dbDir, 'dairy-plant.db'));

    // Pre-load business data on first run
    importBundledExcelData(dbDir);

    return path.join(dbDir, 'dairy-plant.db');
}

// ============================================================
// Desktop authentication (in-memory session + login throttle)
// ============================================================

// Brute-force throttle (in-memory, per username) — mirrors the web server
const loginThrottle = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes

function recordLoginAttempt(username, success) {
    const key = (username || '').toLowerCase();
    if (!key) return;
    if (success) { loginThrottle.delete(key); return; }
    const now = Date.now();
    const rec = loginThrottle.get(key) || { count: 0, first: now };
    rec.count += 1;
    loginThrottle.set(key, rec);
}

function isLoginThrottled(username) {
    const key = (username || '').toLowerCase();
    const rec = loginThrottle.get(key);
    if (!rec) return false;
    if (Date.now() - rec.first > LOGIN_THROTTLE_MS) { loginThrottle.delete(key); return false; }
    return rec.count >= MAX_LOGIN_ATTEMPTS;
}

function remainingAttempts(username) {
    const key = (username || '').toLowerCase();
    const rec = loginThrottle.get(key);
    return rec ? Math.max(0, MAX_LOGIN_ATTEMPTS - rec.count) : MAX_LOGIN_ATTEMPTS;
}

/**
 * Wrap a database IPC handler so it is only reachable after login.
 * This is the desktop equivalent of the web server's requireAuth() middleware.
 */
function authHandle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
        if (!currentUser || !db) {
            return { success: false, error: 'Not authenticated. Please login.' };
        }
        return fn(event, ...args);
    });
}

function isAdmin() {
    return !!currentUser && currentUser.role === 'admin';
}

// ============================================================
// Auto-backup (hourly, local)
// ============================================================

let autoBackupTimer = null;
let lastBackupTime = 0;
const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // every 60 minutes
const MIN_BACKUP_GAP_MS = 30 * 60 * 1000;        // don't create two backups within 30 min

function createBackupNow(silent = false) {
    if (!db) return null;
    const dbPath = path.join(getDbDir(), 'dairy-plant.db');
    const now = Date.now();
    if (now - lastBackupTime < MIN_BACKUP_GAP_MS) return null;
    try {
        const result = ops.backupDatabase(dbPath, db); // WAL-safe (checkpoints first)
        lastBackupTime = now;
        if (!silent) {
            console.log(`  💾 Backup created: ${result.filename} (${ops.formatFileSize(result.size)})`);
        }
        return result;
    } catch (e) {
        console.error('  ❌ Backup failed:', e.message);
        return null;
    }
}

function startAutoBackup() {
    if (autoBackupTimer) return;
    autoBackupTimer = setInterval(() => {
        // Only auto-backup while someone is logged in (avoids backing up an idle screen)
        if (!currentUser || !db) return;
        const result = createBackupNow();
        if (result) {
            console.log(`  ⏰ Auto-backup: ${result.filename} (${ops.formatFileSize(result.size)})`);
        }
    }, AUTO_BACKUP_INTERVAL_MS);
    console.log('  ⏰ Auto-backup active (every 60 minutes, stored locally)');
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
                {
                    label: 'Lock / Logout',
                    accelerator: 'CmdOrCtrl+L',
                    click: () => {
                        if (mainWindow) {
                            mainWindow.webContents.executeJavaScript('window.logout && window.logout()');
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
                ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
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
                    label: 'About Prarambha Account & Stock Management',
                    click: () => {
                        dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About Prarambha Account & Stock Management',
                            message: 'Prarambha Account & Stock Management',
                            detail: `Version ${app.getVersion()}\n\nAccounts & Stock Management Software\nBuilt with Electron & SQLite\n\nDatabase location:\n${path.join(getDbDir(), 'dairy-plant.db')}`
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
        title: 'Prarambha Account & Stock Management',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        },
        show: false
    });

    // Always start at the login / first-run setup screen.
    // After a successful login the renderer navigates to index.html.
    mainWindow.loadFile(path.join(__dirname, 'renderer', 'login-electron.html'));

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

    // Open external links in the default browser, deny everything else.
    // Exception: the in-app print helper (renderer/js/utils.js printHTML) opens an
    // about:blank popup, writes the report HTML into it, and calls window.print().
    // Denying that popup broke printing in the desktop app ("Please allow pop-ups").
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (!url || url === 'about:blank') {
            return {
                action: 'allow',
                overrideBrowserWindowOptions: {
                    webPreferences: {
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: false
                    }
                }
            };
        }
        if (url.startsWith('https://') || url.startsWith('http://')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    // Never allow the window to navigate away from our app pages
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
        }
    });

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }
}

// ============================================================
// IPC Handlers — Authentication
// ============================================================

// auth:status — is a login required? is this the first run (setup needed)?
ipcMain.handle('auth:status', async () => {
    const needsSetup = db ? auth.countUsers(db) === 0 : true;
    return {
        success: true,
        data: {
            authenticated: !!currentUser,
            needsSetup,
            user: currentUser
                ? { id: currentUser.id, username: currentUser.username, role: currentUser.role }
                : null
        }
    };
});

// auth:setup — first-run only: create the initial admin account (no defaults)
ipcMain.handle('auth:setup', async (event, { username, password } = {}) => {
    if (!db) return { success: false, error: 'Database not ready' };
    if (auth.countUsers(db) > 0) {
        return { success: false, error: 'Setup has already been completed.' };
    }
    if (!password || String(password).length < 4) {
        return { success: false, error: 'Password must be at least 4 characters.' };
    }
    const result = auth.createUser(db, { username, password, role: 'admin' });
    if (!result.success) return result;
    currentUser = { id: result.data.id, username: result.data.username, role: 'admin' };
    return {
        success: true,
        data: { username: currentUser.username, role: currentUser.role }
    };
});

// auth:login — verify credentials (with brute-force throttling)
ipcMain.handle('auth:login', async (event, { username, password } = {}) => {
    if (!db) return { success: false, error: 'Database not ready' };

    if (isLoginThrottled(username)) {
        const rec = loginThrottle.get((username || '').toLowerCase());
        const elapsed = rec ? Date.now() - rec.first : 0;
        const lockoutMinutes = Math.max(1, Math.ceil((LOGIN_THROTTLE_MS - elapsed) / 60000));
        return {
            success: false,
            error: 'Account temporarily locked due to too many failed attempts.',
            lockoutMinutes,
            remainingAttempts: 0
        };
    }

    const user = auth.getUserByUsername(db, username);
    if (user && user.is_active && auth.verifyPassword(password, user.password_hash)) {
        currentUser = { id: user.id, username: user.username, role: user.role };
        recordLoginAttempt(username, true);
        return {
            success: true,
            data: {
                username: user.username,
                role: user.role,
                mustChangePassword: auth.isDefaultPassword(user.password_hash)
            }
        };
    }

    recordLoginAttempt(username, false);
    const remaining = remainingAttempts(username);
    const errMsg = remaining <= 0
        ? 'Account locked. Too many failed attempts. Try again later.'
        : `Invalid username or password. ${remaining} attempt${remaining > 1 ? 's' : ''} remaining before temporary lockout.`;
    return { success: false, error: errMsg, remainingAttempts: remaining };
});

// auth:logout — clear the in-memory session
ipcMain.handle('auth:logout', async () => {
    currentUser = null;
    return { success: true, data: { message: 'Logged out' } };
});

// auth:me — current logged-in user
ipcMain.handle('auth:me', async () => {
    if (!currentUser) return { success: false, error: 'Not authenticated' };
    return {
        success: true,
        data: { id: currentUser.id, username: currentUser.username, role: currentUser.role }
    };
});

// auth:users:list — list all users (admin only)
ipcMain.handle('auth:users:list', async () => {
    if (!isAdmin()) return { success: false, error: 'Only admin can manage users' };
    return safeRun(() => auth.listUsers(db));
});

// auth:users:create — create a new user (admin only)
ipcMain.handle('auth:users:create', async (event, data) => {
    if (!isAdmin()) return { success: false, error: 'Only admin can create users' };
    return auth.createUser(db, data || {});
});

// auth:users:delete — delete a user (admin only; cannot delete self)
ipcMain.handle('auth:users:delete', async (event, id) => {
    if (!isAdmin()) return { success: false, error: 'Only admin can delete users' };
    return auth.deleteUser(db, id, currentUser.id);
});

// auth:users:change-password — change own password (any authenticated user)
ipcMain.handle('auth:users:change-password', async (event, { currentPassword, newPassword } = {}) => {
    return auth.changePassword(db, currentUser.id, currentPassword, newPassword);
});

// ============================================================
// IPC Handlers — Export to Daily Account Pro Excel
// ============================================================
const { exportToDailyAccountExcel } = require('./shared/export-daily-account');

authHandle('export:daily-account', async (event, { outputPath } = {}) => {
    if (!db) return { success: false, error: 'Database not ready' };
    const defaultPath = path.join(getDbDir(), 'Daily_Account_Professional_Export.xlsx');
    const savePath = outputPath || defaultPath;
    return exportToDailyAccountExcel(db, savePath);
});

// ============================================================
// IPC Handlers - Database Operations (auth-gated)
// ============================================================

// --- Dashboard ---
authHandle('db:dashboard', async () => {
    return safeRun(() => ops.getDashboard(db));
});

// --- Parties ---
authHandle('db:parties:list', async (event, params = {}) => {
    return safeRun(() => ops.listParties(db, params));
});

authHandle('db:parties:get', async (event, id) => {
    return safeRun(() => ops.getParty(db, id));
});

authHandle('db:parties:save', async (event, party) => {
    return safeRun(() => ops.saveParty(db, party));
});

authHandle('db:parties:delete', async (event, id) => {
    return safeRun(() => ops.deleteParty(db, id, currentUser && currentUser.id));
});

authHandle('db:parties:ledger', async (event, params) => {
    return safeRun(() => ops.getPartyLedger(db, params));
});

// --- Products ---
authHandle('db:products:list', async (event, params = {}) => {
    return safeRun(() => ops.listProducts(db, params));
});

authHandle('db:products:get', async (event, id) => {
    return safeRun(() => ops.getProduct(db, id));
});

authHandle('db:products:save', async (event, product) => {
    return safeRun(() => ops.saveProduct(db, product));
});

authHandle('db:products:delete', async (event, id) => {
    return safeRun(() => ops.deleteProduct(db, id, currentUser && currentUser.id));
});

// --- Stock ---
authHandle('db:stock:current', async (event, params = {}) => {
    return safeRun(() => ops.getCurrentStock(db, params));
});

authHandle('db:stock:movements', async (event, params = {}) => {
    return safeRun(() => ops.getStockMovements(db, params));
});

authHandle('db:stock:adjust', async (event, params) => {
    return safeRun(() => ops.adjustStock(db, params));
});

// --- Sales ---
authHandle('db:sales:list', async (event, params = {}) => {
    return safeRun(() => ops.listSales(db, params));
});

authHandle('db:sales:get', async (event, id) => {
    return safeRun(() => ops.getSale(db, id));
});

authHandle('db:sales:save', async (event, saleData) => {
    return safeRun(() => ops.saveSale(db, saleData));
});

authHandle('db:sales:delete', async (event, id) => {
    return safeRun(() => ops.deleteSale(db, id, currentUser && currentUser.id));
});

// --- Purchases ---
authHandle('db:purchases:list', async (event, params = {}) => {
    return safeRun(() => ops.listPurchases(db, params));
});

authHandle('db:purchases:get', async (event, id) => {
    return safeRun(() => ops.getPurchase(db, id));
});

authHandle('db:purchases:save', async (event, purchaseData) => {
    return safeRun(() => ops.savePurchase(db, purchaseData));
});

authHandle('db:purchases:delete', async (event, id) => {
    return safeRun(() => ops.deletePurchase(db, id, currentUser && currentUser.id));
});

// --- Milk Collections ---
authHandle('db:milk:list', async (event, params = {}) => {
    return safeRun(() => ops.listMilkCollections(db, params));
});

authHandle('db:milk:get', async (event, id) => {
    return safeRun(() => ops.getMilkCollection(db, id));
});

authHandle('db:milk:save', async (event, data) => {
    return safeRun(() => ops.saveMilkCollection(db, data));
});

authHandle('db:milk:delete', async (event, id) => {
    return safeRun(() => ops.deleteMilkCollection(db, id, currentUser && currentUser.id));
});

authHandle('db:milk:summary', async (event, params = {}) => {
    return safeRun(() => ops.getMilkSummary(db, params));
});

// --- Reports ---
authHandle('db:reports:sales', async (event, params) => {
    return safeRun(() => ops.getSalesReport(db, params));
});

authHandle('db:reports:purchases', async (event, params) => {
    return safeRun(() => ops.getPurchasesReport(db, params));
});

authHandle('db:reports:daybook', async (event, params) => {
    return safeRun(() => ops.getDaybook(db, params));
});

authHandle('db:reports:receivables', async () => {
    return safeRun(() => ops.getReceivables(db));
});

authHandle('db:reports:payables', async () => {
    return safeRun(() => ops.getPayables(db));
});

// --- Farmer Bulk Payment ---
authHandle('db:farmer:outstanding', async () => {
    return safeRun(() => ops.getFarmerOutstanding(db));
});

authHandle('db:farmer:bulk-pay', async (event, params) => {
    return safeRun(() => ops.bulkPayFarmers(db, params));
});

// --- Payments ---
authHandle('db:payments:save', async (event, payment) => {
    return safeRun(() => ops.savePayment(db, payment));
});

authHandle('db:payments:list', async (event, params = {}) => {
    return safeRun(() => ops.listPayments(db, params));
});

authHandle('db:payments:delete', async (event, id) => {
    return safeRun(() => ops.deletePayment(db, id));
});

authHandle('db:payments:update', async (event, data) => {
    return safeRun(() => ops.updatePayment(db, data));
});

// --- Financial Reports (Profit/Loss, Stock Statement, Enhanced Daybook) ---
authHandle('db:reports:profit-loss', async (event, params = {}) => {
    return safeRun(() => ops.getProfitLoss(db, params));
});

authHandle('db:reports:profit-loss-by-month', async (event, params = {}) => {
    return safeRun(() => ops.getProfitLossByMonth(db, params));
});

authHandle('db:reports:stock-statement', async (event, params = {}) => {
    return safeRun(() => ops.getStockStatement(db, params));
});

authHandle('db:reports:enhanced-daybook', async (event, params = {}) => {
    return safeRun(() => ops.getEnhancedDaybook(db, params));
});

authHandle('db:reports:sales-register', async (event, params = {}) => {
    return safeRun(() => ops.getSalesRegister(db, params));
});

authHandle('db:reports:purchase-register', async (event, params = {}) => {
    return safeRun(() => ops.getPurchaseRegister(db, params));
});

authHandle('db:reports:today-summary', async () => {
    return safeRun(() => ops.getTodaySummary(db));
});

authHandle('db:reports:farmer-statement', async (event, params = {}) => {
    return safeRun(() => ops.getFarmerStatement(db, params));
});

// --- Statements ---
authHandle('db:statements:party', async (event, params = {}) => {
    return safeRun(() => ops.getPartyStatement(db, params));
});

authHandle('db:statements:parties-with-balance', async (event, params = {}) => {
    return safeRun(() => ops.listPartiesWithBalance(db, params));
});

// --- Daily Cash Collection ---
authHandle('db:cash:daily-collection', async (event, params = {}) => {
    return safeRun(() => ops.getDailyCashCollection(db, params));
});

authHandle('db:cash:collection-save', async (event, data = {}) => {
    return safeRun(() => ops.saveCashCollection(db, data));
});

authHandle('db:cash:collection-delete', async (event, id) => {
    return safeRun(() => ops.deleteCashCollection(db, id));
});

// --- Cash Deposits ---
authHandle('db:cash-deposits:list', async (event, params = {}) => {
    return safeRun(() => ops.listCashDeposits(db, params));
});

authHandle('db:cash-deposits:get', async (event, id) => {
    return safeRun(() => ops.getCashDeposit(db, id));
});

authHandle('db:cash-deposits:save', async (event, data) => {
    return safeRun(() => ops.saveCashDeposit(db, data));
});

authHandle('db:cash-deposits:delete', async (event, id) => {
    return safeRun(() => ops.deleteCashDeposit(db, id));
});

authHandle('db:cash-deposits:summary', async (event, params = {}) => {
    return safeRun(() => ops.getCashDepositSummary(db, params));
});

// --- Denominations ---
authHandle('db:denominations:list', async (event, params = {}) => {
    return safeRun(() => ops.listDenominations(db, params));
});

authHandle('db:denominations:get', async (event, id) => {
    return safeRun(() => ops.getDenomination(db, id));
});

authHandle('db:denominations:get-by-date', async (event, { date } = {}) => {
    return safeRun(() => ops.getDenominationByDate(db, date));
});

authHandle('db:denominations:save', async (event, data) => {
    return safeRun(() => ops.saveDenomination(db, data));
});

authHandle('db:denominations:delete', async (event, id) => {
    return safeRun(() => ops.deleteDenomination(db, id, currentUser && currentUser.id));
});

// --- Petty Cash ---
authHandle('db:petty-cash:list', async (event, params = {}) => {
    return safeRun(() => ops.listPettyCash(db, params));
});

authHandle('db:petty-cash:get', async (event, id) => {
    return safeRun(() => ops.getPettyCash(db, id));
});

authHandle('db:petty-cash:save', async (event, data) => {
    return safeRun(() => ops.savePettyCash(db, data));
});

authHandle('db:petty-cash:delete', async (event, id) => {
    return safeRun(() => ops.deletePettyCash(db, id, currentUser && currentUser.id));
});

authHandle('db:petty-cash:summary', async (event, params = {}) => {
    return safeRun(() => ops.getPettyCashSummary(db, params));
});

// --- Bank Transactions ---
authHandle('db:bank:list', async (event, params = {}) => {
    return safeRun(() => ops.listBankTransactions(db, params));
});

authHandle('db:bank:get', async (event, id) => {
    return safeRun(() => ops.getBankTransaction(db, id));
});

authHandle('db:bank:save', async (event, data) => {
    return safeRun(() => ops.saveBankTransaction(db, data, currentUser && currentUser.id));
});

authHandle('db:bank:delete', async (event, id) => {
    return safeRun(() => ops.deleteBankTransaction(db, id));
});

authHandle('db:bank:review-queue', async () => {
    return safeRun(() => ops.getBankReviewQueue(db));
});

authHandle('db:bank:statement', async (event, params = {}) => {
    return safeRun(() => ops.getBankStatement(db, params));
});

authHandle('db:bank:match', async (event, data) => {
    return safeRun(() => ops.setBankMatch(db, data.id, data));
});

authHandle('db:bank:post', async (event, id) => {
    return safeRun(() => ops.postBankToLedger(db, id));
});

// --- Salary ---
authHandle('db:salary:list', async (event, params = {}) => {
    return safeRun(() => ops.listSalaryRecords(db, params));
});

authHandle('db:salary:get', async (event, id) => {
    return safeRun(() => ops.getSalaryRecord(db, id));
});

authHandle('db:salary:save', async (event, data) => {
    return safeRun(() => ops.saveSalaryRecord(db, data));
});

authHandle('db:salary:delete', async (event, id) => {
    return safeRun(() => ops.deleteSalaryRecord(db, id, currentUser && currentUser.id));
});

authHandle('db:salary:summary', async (event, params = {}) => {
    return safeRun(() => ops.getSalarySummary(db, params));
});

// --- Vehicle Expenses ---
authHandle('db:vehicle-expenses:list', async (event, params = {}) => {
    return safeRun(() => ops.listVehicleExpenses(db, params));
});

authHandle('db:vehicle-expenses:get', async (event, id) => {
    return safeRun(() => ops.getVehicleExpense(db, id));
});

authHandle('db:vehicle-expenses:save', async (event, data) => {
    return safeRun(() => ops.saveVehicleExpense(db, data));
});

authHandle('db:vehicle-expenses:delete', async (event, id) => {
    return safeRun(() => ops.deleteVehicleExpense(db, id, currentUser && currentUser.id));
});

authHandle('db:vehicle-expenses:summary', async (event, params = {}) => {
    return safeRun(() => ops.getVehicleExpensesSummary(db, params));
});

// --- Other Expenses ---
authHandle('db:other-expenses:list', async (event, params = {}) => {
    return safeRun(() => ops.listOtherExpenses(db, params));
});

authHandle('db:other-expenses:get', async (event, id) => {
    return safeRun(() => ops.getOtherExpense(db, id));
});

authHandle('db:other-expenses:save', async (event, data) => {
    return safeRun(() => ops.saveOtherExpense(db, data));
});

authHandle('db:other-expenses:delete', async (event, id) => {
    return safeRun(() => ops.deleteOtherExpense(db, id, currentUser && currentUser.id));
});

authHandle('db:other-expenses:categories', async () => {
    return safeRun(() => ops.getExpenseCategories(db));
});

authHandle('db:other-expenses:summary', async (event, params = {}) => {
    return safeRun(() => ops.getExpensesSummary(db, params));
});

// --- Routes ---
authHandle('db:routes:list', async (event, params = {}) => {
    return safeRun(() => ops.listRoutes(db, params));
});

authHandle('db:routes:get', async (event, id) => {
    return safeRun(() => ops.getRoute(db, id));
});

authHandle('db:routes:save', async (event, data) => {
    return safeRun(() => ops.saveRoute(db, data));
});

authHandle('db:routes:delete', async (event, id) => {
    return safeRun(() => ops.deleteRoute(db, id, currentUser && currentUser.id));
});

authHandle('db:routes:summary', async (event, params = {}) => {
    return safeRun(() => ops.getRouteSummary(db, params));
});

// --- Milk Rate Charts ---
authHandle('db:rates:list', async () => {
    return safeRun(() => ops.listRateCharts(db));
});

authHandle('db:rates:get', async (event, id) => {
    return safeRun(() => ops.getRateChart(db, id));
});

authHandle('db:rates:save', async (event, data) => {
    return safeRun(() => ops.saveRateChart(db, data));
});

authHandle('db:rates:delete', async (event, id) => {
    return safeRun(() => ops.deleteRateChart(db, id, currentUser && currentUser.id));
});

authHandle('db:rates:effective', async (event, { date } = {}) => {
    return safeRun(() => ops.getEffectiveRate(db, date));
});

authHandle('db:rates:calculate', async (event, data = {}) => {
    return safeRun(() => {
        const { fat, snf, rateChart } = data;
        const rate = ops.calculateMilkRate(fat, snf, rateChart);
        return { rate };
    });
});

// --- Production ---
authHandle('db:production:list', async (event, params = {}) => {
    return safeRun(() => ops.listProductionBatches(db, params));
});

authHandle('db:production:get', async (event, id) => {
    return safeRun(() => ops.getProductionBatch(db, id));
});

authHandle('db:production:save', async (event, data) => {
    return safeRun(() => ops.saveProductionBatch(db, data));
});

authHandle('db:production:delete', async (event, id) => {
    return safeRun(() => ops.deleteProductionBatch(db, id, currentUser && currentUser.id));
});

authHandle('db:production:process-types', async () => {
    return safeRun(() => ops.getProcessTypes(db));
});

// --- Partner Capital ---
authHandle('db:partners:capital-list', async (event, params = {}) => {
    return safeRun(() => ops.listPartnerCapital(db, params));
});

authHandle('db:partners:capital-get', async (event, id) => {
    return safeRun(() => ops.getPartnerCapital(db, id));
});

authHandle('db:partners:capital-save', async (event, data) => {
    return safeRun(() => ops.savePartnerCapital(db, data));
});

authHandle('db:partners:capital-delete', async (event, id) => {
    return safeRun(() => ops.deletePartnerCapital(db, id, currentUser && currentUser.id));
});

authHandle('db:partners:statement', async (event, params = {}) => {
    return safeRun(() => ops.getPartnerStatement(db, params));
});

authHandle('db:partners:with-balance', async () => {
    return safeRun(() => ops.listPartnersWithBalance(db));
});

// --- Audit Logs ---
authHandle('db:audit:logs', async (event, params = {}) => {
    return safeRun(() => ops.getAuditLogs(db, params));
});

// --- Settings ---
authHandle('db:settings:get', async () => {
    return safeRun(() => ops.getSettings(db));
});

authHandle('db:settings:save', async (event, settings) => {
    return safeRun(() => ops.saveSettings(db, settings));
});

// --- Email ---
authHandle('email:send', async (event, opts = {}) => {
    return ops.sendEmail(db, opts);
});

// --- Database table info ---
authHandle('db:table-info', async () => {
    return safeRun(() => ops.getTableInfo(db));
});

// --- CSV data exchange (mirrors the web /api/data-csv/* routes) ---
authHandle('data-csv:tables', async () => {
    return { success: true, data: dataCSV.getAllTableDefs() };
});

authHandle('data-csv:sample', async (event, { table } = {}) => {
    if (!table) return { success: false, error: 'Table name is required' };
    try {
        return { success: true, data: dataCSV.generateSampleCSV(table) };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

authHandle('data-csv:export', async (event, { table } = {}) => {
    if (!table) return { success: false, error: 'Table name is required' };
    return safeRun(() => dataCSV.exportToCSV(db, table));
});

authHandle('data-csv:import', async (event, { table, csv } = {}) => {
    if (!table) return { success: false, error: 'Table name is required' };
    if (!csv) return { success: false, error: 'CSV content is required' };
    try {
        return dataCSV.importFromCSV(db, table, csv);
    } catch (err) {
        return { success: false, error: err.message };
    }
});

authHandle('data-csv:export-all', async () => {
    return safeRun(() => {
        const tables = dataCSV.getAllTableDefs();
        const files = {};
        for (const t of tables) {
            files[t.table + '.csv'] = dataCSV.exportToCSV(db, t.table);
        }
        return files;
    });
});

// ============================================================
// IPC Handlers — Excel data update (in-app "Update Data from Excel")
// ============================================================

/**
 * Import a Dairy Account Pro Excel file into the database.
 * - No filePath → shows an open-file dialog first.
 * - mode 'fresh'  → clears transactional data and re-imports everything (backup first)
 * - mode 'upsert' → adds new / updates existing records only (no deletions)
 */
authHandle('excel:import-file', async (event, { filePath, mode } = {}) => {
    let excelPath = filePath;
    if (!excelPath) {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Select Dairy Account Pro Excel file (Dairy_Accounts_Professional.xlsx)',
            properties: ['openFile'],
            filters: [{ name: 'Excel Workbook', extensions: ['xlsx', 'xlsm', 'xls'] }]
        });
        if (result.canceled || !result.filePaths || !result.filePaths[0]) {
            return { success: false, canceled: true };
        }
        excelPath = result.filePaths[0];
    }

    if (!excelPath || !fs.existsSync(excelPath)) {
        return { success: false, error: 'Excel file not found: ' + excelPath };
    }

    const importMode = mode === 'fresh' ? 'fresh' : 'upsert';

    // Safety backup before any import
    let backup = null;
    try { backup = createBackupNow(true); } catch (e) { /* non-fatal */ }

    try {
        const results = excelImport.runExcelImport(db, excelPath, {
            mode: importMode,
            log: (msg) => console.log(msg)
        });
        return { success: true, data: { mode: importMode, results, backup } };
    } catch (err) {
        console.error('  ❌ Excel import failed:', err.message);
        return { success: false, error: err.message };
    }
});

// --- Backup (manual) ---
authHandle('db:backup', async () => {
    const result = createBackupNow();
    return result
        ? { success: true, data: result }
        : { success: false, error: 'A backup was created very recently. Please wait a moment.' };
});

// --- Backup list ---
authHandle('db:backup:list', async () => {
    return safeRun(() => ops.listBackups(path.join(getDbDir(), 'dairy-plant.db')));
});

// --- Backup delete ---
authHandle('db:backup:delete', async (event, filename) => {
    return safeRun(() => ops.deleteBackup(path.join(getDbDir(), 'dairy-plant.db'), filename));
});

// --- Backup download (copy a backup to a user-chosen location) ---
authHandle('db:backup:download', async (event, filename) => {
    const backups = ops.listBackups(path.join(getDbDir(), 'dairy-plant.db'));
    const target = backups.find(b => b.filename === filename);
    if (!target) return { success: false, error: 'Backup not found' };
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: filename,
        filters: [{ name: 'Database Backup', extensions: ['db'] }]
    });
    if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
    }
    fs.copyFileSync(target.path, result.filePath);
    return { success: true, data: { path: result.filePath } };
});

// --- Restore ---
authHandle('db:restore', async (event, filename) => {
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
authHandle('print:pdf', async (event, { html, landscape, pageSize } = {}) => {
    try {
        // Read paper size from settings (DB), fall back to passed param, then default
        let paperSize = pageSize || 'A4';
        if (!pageSize && db) {
            try {
                const setting = db.prepare("SELECT value FROM settings WHERE key = 'paper_size'").get();
                if (setting && setting.value) paperSize = setting.value;
            } catch(e) {}
        }

        // Move <tfoot> totals into <tbody> so the total prints only on the final page
        // (browsers otherwise repeat <tfoot> on every printed page).
        html = String(html || '').replace(
            /<tbody>([\s\S]*?)<\/tbody>\s*<tfoot>([\s\S]*?)<\/tfoot>/gi,
            (m, body, foot) => '<tbody>' + body + foot.replace(/<tr/gi, '<tr class="total-row"') + '</tbody>'
        );

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
                <title>Prarambha Account &amp; Stock Management - Export</title>
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
            // NOTE: Electron printToPDF margins are in INCHES. Values like 10
            // previously produced a nearly-blank PDF (10" margins). The page
            // margins are now controlled by the @page rule in print.css.
            margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
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
authHandle('dialog:save', async (event, options) => {
    return dialog.showSaveDialog(mainWindow, options);
});

// --- Get database path ---
authHandle('db:path', async () => {
    return path.join(getDbDir(), 'dairy-plant.db');
});

// ============================================================
// App lifecycle
// ============================================================
app.whenReady().then(() => {
    initAppDatabase();
    startAutoBackup();
    buildAppMenu();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if (!db) initAppDatabase();
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    // Save a final backup of the session's data before closing
    if (db) {
        if (currentUser) {
            createBackupNow(true);
        }
        try { db.close(); } catch (e) { /* ignore */ }
        db = null;
    }
});
