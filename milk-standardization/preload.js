/**
 * Milk Standardization Calculator — preload bridge
 * ============================================================
 * The renderer talks to the main process only through this surface.
 * contextIsolation is on and nodeIntegration is off, so the UI never
 * touches the file system directly.
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const MENU_CHANNELS = [
    'menu:new',
    'menu:save',
    'menu:print',
    'menu:pdf',
    'menu:csv',
    'menu:backup',
    'menu:go:standardize',
    'menu:go:history',
    'menu:go:tools',
    'menu:go:settings'
];

contextBridge.exposeInMainWorld('api', {
    __milkDesktop: true,

    info: () => ipcRenderer.invoke('app:info'),

    getSettings: () => ipcRenderer.invoke('settings:get'),
    saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
    resetSettings: () => ipcRenderer.invoke('settings:reset'),

    listHistory: () => ipcRenderer.invoke('history:list'),
    addHistory: (entry) => ipcRenderer.invoke('history:add', entry),
    updateHistory: (id, patch) => ipcRenderer.invoke('history:update', id, patch),
    deleteHistory: (id) => ipcRenderer.invoke('history:delete', id),
    clearHistory: () => ipcRenderer.invoke('history:clear'),

    saveTextFile: (payload) => ipcRenderer.invoke('file:save-text', payload),
    savePdf: (payload) => ipcRenderer.invoke('file:pdf', payload),
    printHtml: (payload) => ipcRenderer.invoke('file:print', payload),

    backup: () => ipcRenderer.invoke('data:backup'),
    restore: (options) => ipcRenderer.invoke('data:restore', options),
    openDataFolder: () => ipcRenderer.invoke('data:open-folder'),

    /** Subscribe to application-menu commands. Returns an unsubscribe function. */
    onMenu: (handler) => {
        const listeners = MENU_CHANNELS.map((channel) => {
            const fn = () => handler(channel.replace('menu:', ''));
            ipcRenderer.on(channel, fn);
            return { channel, fn };
        });
        return () => listeners.forEach(({ channel, fn }) => ipcRenderer.removeListener(channel, fn));
    }
});
