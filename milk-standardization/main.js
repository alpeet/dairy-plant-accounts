/**
 * Milk Standardization Calculator — Electron main process
 * ============================================================
 * Fully offline. Local JSON data store, no network calls, no login.
 *
 *   main.js      → this file (window, menu, IPC, PDF/print, file dialogs)
 *   preload.js   → contextBridge surface exposed as window.api
 *   shared/*.js  → calculation engine + data store (also used by Node tests)
 *   renderer/*   → the UI (also runnable in a browser via dev-server.js)
 */

'use strict';

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const storeLib = require('./shared/store');

const APP_TITLE = 'Milk Standardization Calculator';
const DATA_FILE = 'milk-standardization-data.json';

// `electron . --smoke` boots the shell headlessly, checks the preload bridge,
// the renderer and the calculation engine, prints a verdict and exits.
const SMOKE_TEST = process.argv.includes('--smoke');

let mainWindow = null;
let store = null;

// ============================================================
// Data store
// ============================================================
function dataDir() {
    return app.getPath('userData');
}

function dataPath() {
    return path.join(dataDir(), DATA_FILE);
}

function initStore() {
    store = storeLib.createStore(storeLib.fileAdapter(dataPath()));
}

// ============================================================
// Window
// ============================================================
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1320,
        height: 880,
        minWidth: 1024,
        minHeight: 680,
        title: APP_TITLE,
        backgroundColor: '#f2f5f3',
        show: false,
        autoHideMenuBar: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    mainWindow.once('ready-to-show', () => mainWindow.show());

    if (SMOKE_TEST) runSmokeTest(mainWindow);

    // Never navigate the app shell away from local files; open links externally.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith('file://')) {
            event.preventDefault();
            if (/^https?:/i.test(url)) shell.openExternal(url);
        }
    });

    mainWindow.on('closed', () => { mainWindow = null; });
}

// ============================================================
// Self-test (electron . --smoke)
// ============================================================
function runSmokeTest(win) {
    const script = `(async () => {
        const report = { checks: [] };
        const ok = (name, condition, detail) => report.checks.push({ name, pass: !!condition, detail: detail === undefined ? '' : String(detail) });
        ok('renderer booted', typeof window.MilkApi === 'object', window.MilkApi && window.MilkApi.mode);
        ok('preload bridge is desktop', window.MilkApi && window.MilkApi.mode === 'desktop', window.MilkApi && window.MilkApi.mode);
        const info = await window.MilkApi.info();
        ok('IPC app:info answers', info && info.isDesktop === true, info && info.version);
        ok('engine loaded', typeof window.MilkCalc === 'object');
        const res = window.MilkCalc.compute({ mode: 'cream_separation', quantity: 480, fatInitial: 5.5,
            fatTarget: 3.5, snfInitial: 8.6, creamFat: 40, creamSnf: 2, smpSnf: 96, smpFat: 1 }, {});
        ok('spec example computes 26.30 L cream', res.ok && Math.abs(res.main.streamQty - 26.3013698630137) < 1e-6, res.main && res.main.streamQty);
        const saved = await window.MilkApi.addHistory({ batchRef: '__smoke__', calc: res, modeId: 'cream_separation', unit: 'L' });
        ok('history write works', saved && saved.id, saved && saved.id);
        const list = await window.MilkApi.listHistory();
        ok('history read works', Array.isArray(list) && list.length > 0, list && list.length);
        await window.MilkApi.deleteHistory(saved.id);
        const after = await window.MilkApi.listHistory();
        ok('history delete works', !after.some(r => r.id === saved.id));
        const before = await window.MilkApi.getSettings();
        ok('settings read works', before && typeof before.creamFat === 'number', before && before.creamFat);
        const after2 = await window.MilkApi.saveSettings({ decimals: before.decimals });
        ok('settings write works', after2 && after2.decimals === before.decimals, after2 && after2.decimals);
        return report;
    })()`;

    win.webContents.once('did-finish-load', async () => {
        const log = (...args) => console.log('[smoke]', ...args);
        try {
            // long enough for app.js boot() to finish its async startup
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const report = await win.webContents.executeJavaScript(script, true);
            report.checks.forEach((check) => log((check.pass ? 'ok  ' : 'FAIL'), check.name, check.detail));

            // --smoke-pdf=<file> also exercises the hidden-window PDF pipeline
            const pdfArg = process.argv.find((arg) => arg.startsWith('--smoke-pdf='));
            if (pdfArg) {
                const target = pdfArg.slice('--smoke-pdf='.length);
                const html = await win.webContents.executeJavaScript(`(() => {
                    window.MilkCalculator.loadExample();
                    const record = window.MilkCalculator.getRecord();
                    record.createdAt = new Date().toISOString();
                    return window.MilkReport.standaloneHtml(record, window.MilkApp.settings());
                })()`, true);
                const pdf = await renderPdfBuffer(html);
                fs.writeFileSync(target, pdf);
                const good = pdf.length > 2000 && pdf.slice(0, 5).toString() === '%PDF-';
                report.checks.push({ name: 'PDF export produces a real document', pass: good, detail: pdf.length + ' bytes' });
                log((good ? 'ok  ' : 'FAIL'), 'PDF export produces a real document', pdf.length + ' bytes → ' + target);
            }

            const failed = report.checks.filter((check) => !check.pass);
            log(failed.length ? 'RESULT: FAILED' : 'RESULT: ALL ' + report.checks.length + ' CHECKS PASSED');
            app.exit(failed.length ? 1 : 0);
        } catch (err) {
            log('RESULT: FAILED —', err && err.message ? err.message : err);
            app.exit(1);
        }
    });
}

// ============================================================
// Menu
// ============================================================
function buildMenu() {
    const isMac = process.platform === 'darwin';
    const send = (channel) => () => {
        if (mainWindow) mainWindow.webContents.send(channel);
    };

    const template = [];

    if (isMac) {
        template.push({
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        });
    }

    template.push({
        label: 'File',
        submenu: [
            { label: 'New Calculation', accelerator: 'CmdOrCtrl+N', click: send('menu:new') },
            { type: 'separator' },
            { label: 'Save to Batch History', accelerator: 'CmdOrCtrl+S', click: send('menu:save') },
            { label: 'Print Standardization Report', accelerator: 'CmdOrCtrl+P', click: send('menu:print') },
            { label: 'Export Report as PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: send('menu:pdf') },
            { label: 'Export History as CSV…', click: send('menu:csv') },
            { type: 'separator' },
            { label: 'Backup Data (JSON)…', click: send('menu:backup') },
            { label: 'Open Data Folder', click: () => shell.openPath(dataDir()) },
            { label: 'Reload', role: 'reload' },
            { type: 'separator' },
            isMac ? { role: 'close' } : { role: 'quit' }
        ]
    });

    template.push({
        label: 'View',
        submenu: [
            { label: 'Standardize', click: send('menu:go:standardize') },
            { label: 'Batch History', click: send('menu:go:history') },
            { label: 'Tools', click: send('menu:go:tools') },
            { label: 'Settings', click: send('menu:go:settings') },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'toggleDevTools' },
            { role: 'togglefullscreen' }
        ]
    });

    template.push({
        label: 'Help',
        submenu: [
            {
                label: 'About ' + APP_TITLE,
                click: () => {
                    dialog.showMessageBox(mainWindow, {
                        type: 'info',
                        title: 'About',
                        message: APP_TITLE + ' ' + app.getVersion(),
                        detail: 'Offline fat / SNF standardization calculator.\n\nData folder:\n' + dataDir() +
                            '\n\nMinimum fat and SNF limits are configured by you in Settings — the app ships ' +
                            'placeholder values only. Verify them against the standard that applies in your region.',
                        buttons: ['OK']
                    });
                }
            }
        ]
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// Helpers — writing files
// ============================================================
async function saveTextFile({ defaultName, content, filters, encoding }) {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save file',
        defaultPath: defaultName || 'export.txt',
        filters: filters && filters.length ? filters : [{ name: 'All files', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, content || '', encoding || 'utf8');
    return { ok: true, path: result.filePath };
}

function writeTempHtml(html) {
    const file = path.join(os.tmpdir(), 'milk-standardization-' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 7) + '.html');
    fs.writeFileSync(file, html, 'utf8');
    return file;
}

function cleanup(file, win) {
    setTimeout(() => {
        try { if (win && !win.isDestroyed()) win.destroy(); } catch (err) { /* ignore */ }
        try { fs.unlinkSync(file); } catch (err) { /* ignore */ }
    }, 800);
}

/** Render a report document to PDF bytes with a hidden window (offline). */
async function renderPdfBuffer(html) {
    const tmp = writeTempHtml(html);
    const win = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, javascript: false, sandbox: true }
    });
    try {
        await win.loadFile(tmp);
        // give the print engine a beat to settle its layout before capturing
        await new Promise((resolve) => setTimeout(resolve, 250));
        return await win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: { marginType: 'custom', top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 }
        });
    } finally {
        cleanup(tmp, win);
    }
}

async function exportPdf({ html, defaultName }) {
    if (!html) return { ok: false, error: 'Nothing to export.' };
    let pdf;
    try {
        pdf = await renderPdfBuffer(html);
    } catch (err) {
        return { ok: false, error: 'Could not build the PDF: ' + String(err && err.message ? err.message : err) };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Save report as PDF',
        defaultPath: defaultName || 'standardization-report.pdf',
        filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, pdf);
    return { ok: true, path: result.filePath };
}

async function printHtml({ html }) {
    if (!html) return { ok: false, error: 'Nothing to print.' };
    const tmp = writeTempHtml(html);
    const win = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { contextIsolation: true, nodeIntegration: false, javascript: false, sandbox: true }
    });
    try {
        await win.loadFile(tmp);
    } catch (err) {
        cleanup(tmp, win);
        return { ok: false, error: String(err && err.message ? err.message : err) };
    }
    return new Promise((resolve) => {
        win.webContents.print(
            { silent: false, printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } },
            (success, failureReason) => {
                cleanup(tmp, win);
                if (success) resolve({ ok: true });
                else if (failureReason && /cancel/i.test(failureReason)) resolve({ ok: false, canceled: true });
                else resolve({ ok: false, error: failureReason || 'Printing failed.' });
            }
        );
    });
}

// ============================================================
// IPC
// ============================================================
function registerIpc() {
    ipcMain.handle('app:info', () => ({
        isDesktop: true,
        name: APP_TITLE,
        version: app.getVersion(),
        platform: process.platform,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
        dataDir: dataDir(),
        dataFile: dataPath()
    }));

    ipcMain.handle('settings:get', () => store.getSettings());
    ipcMain.handle('settings:save', (_e, patch) => store.saveSettings(patch));
    ipcMain.handle('settings:reset', () => store.resetSettings());

    ipcMain.handle('history:list', () => store.listHistory());
    ipcMain.handle('history:add', (_e, entry) => store.addHistory(entry));
    ipcMain.handle('history:update', (_e, id, patch) => store.updateHistory(id, patch));
    ipcMain.handle('history:delete', (_e, id) => store.deleteHistory(id));
    ipcMain.handle('history:clear', () => store.clearHistory());

    ipcMain.handle('file:save-text', (_e, payload) => saveTextFile(payload || {}));
    ipcMain.handle('file:pdf', (_e, payload) => exportPdf(payload || {}));
    ipcMain.handle('file:print', (_e, payload) => printHtml(payload || {}));

    ipcMain.handle('data:backup', async () => {
        const state = store.exportState();
        const stamp = new Date().toISOString().slice(0, 10);
        return saveTextFile({
            defaultName: 'milk-standardization-backup-' + stamp + '.json',
            content: JSON.stringify(state, null, 2),
            filters: [{ name: 'JSON backup', extensions: ['json'] }]
        });
    });

    ipcMain.handle('data:restore', async (_e, options) => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: 'Restore data from backup',
            properties: ['openFile'],
            filters: [{ name: 'JSON backup', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
        try {
            const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
            const state = store.importState(raw, options || {});
            return { ok: true, path: result.filePaths[0], state };
        } catch (err) {
            return { ok: false, error: 'Could not read that file: ' + (err && err.message ? err.message : err) };
        }
    });

    ipcMain.handle('data:open-folder', async () => {
        const error = await shell.openPath(dataDir());
        return { ok: !error, error: error || null };
    });
}

// ============================================================
// Bootstrap
// ============================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        initStore();
        registerIpc();
        buildMenu();
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') app.quit();
    });
}
