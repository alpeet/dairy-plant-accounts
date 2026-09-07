#!/usr/bin/env node
/**
 * Prarambha Account & Stock Management — Upsert Import from Dairy_Accounts_Professional.xlsx
 * ==========================================================================================
 * Non-destructive import: only adds NEW records and updates EXISTING ones.
 * Does NOT clear any data. Safe to run repeatedly (idempotent).
 *
 * Data Mapping:
 *   Party_Master    → parties (upsert by name)
 *   Stock_Master    → products (upsert by name)
 *   Sales_Entry     → sales + sales_items (upsert by invoice_no)
 *   Purchase_Entry  → purchases + purchase_items (upsert by bill_no)
 *   Collection      → payments (insert new only, dedup by party+date+amount+type)
 *   (Party_Ledger is NOT re-imported — new sales/purchases/payments get matching
 *    ledger entries so the ledger stays consistent with the app's own records.)
 *
 * Usage:
 *   node import-excel-upsert.js
 *   DB_DIR=/path/to/data node import-excel-upsert.js      # custom data directory
 *   EXCEL_PATH=/path/to/file.xlsx node import-excel-upsert.js
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
    console.log('  (Non-destructive: only adds new / updates changed records)');
    console.log('  Excel: ' + EXCEL_PATH);
    console.log('');

    if (!fs.existsSync(EXCEL_PATH)) {
        console.error(`  ❌ Excel file not found: ${EXCEL_PATH}`);
        process.exit(1);
    }

    importExcelFile({ excelPath: EXCEL_PATH, dbPath: DB_PATH, mode: 'upsert' });
}

module.exports = { main };

if (require.main === module) {
    main();
}