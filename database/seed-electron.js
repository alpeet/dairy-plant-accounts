/**
 * Seed launcher for Electron environment.
 * This ensures better-sqlite3 runs against the correct Node ABI.
 */
const { app } = require('electron');
const path = require('path');

app.whenReady().then(() => {
    try {
        // Set DB_PATH to Electron's userData directory
        process.env.DB_PATH = app.getPath('userData');
        process.env.SEED_ELECTRON = '1';
        
        require(path.join(__dirname, 'seed.js'));
        
        console.log('Seed completed. Exiting...');
        app.quit();
        process.exit(0);
    } catch (err) {
        console.error('Seed failed:', err);
        app.quit();
        process.exit(1);
    }
});
