#!/usr/bin/env node
/**
 * Prarambha — Fresh Import from Dairy_Accounts_Professional.xlsx
 * =============================================================
 * Clears ALL transactional data and re-imports everything fresh from the Excel
 * workbook (BS dates, correct column mappings). Also rebuilds the stock ledger.
 *
 * Usage:
 *   node import-fresh.js
 *   DB_DIR=/path/to/data node import-fresh.js      # custom data directory
 *   EXCEL_PATH=/path/to/file.xlsx node import-fresh.js
 */

const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = __dirname;
const DB_DIR = process.env.DB_DIR || path.join(PROJECT_ROOT, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'dairy-plant.db');
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(PROJECT_ROOT, 'Dairy_Accounts_Professional.xlsx');

const { importExcelFile } = require('./shared/excel-import');

function main() {
    console.log('');
    console.log('  ⚠️  All transactional data will be cleared and re-imported from:');
    console.log('      ' + EXCEL_PATH);
    console.log('');

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`  ❌ Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    importExcelFile({ excelPath: EXCEL_PATH, dbPath: DB_PATH, mode: 'fresh' });
}

module.exports = { main };

if (require.main === module) {
    main();
}