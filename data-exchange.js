#!/usr/bin/env node
/**
 * Godhuli Dairy Plant — Data Exchange Script
 * ============================================
 * Two-way data sync between the SQLite database and the Excel workbook.
 *
 * Usage:
 *   node data-exchange.js export        # DB → Excel (overwrites data sheets)
 *   node data-exchange.js import        # Excel → DB (upserts into database)
 *   node data-exchange.js export --csv  # DB → CSV files (one per table)
 *   node data-exchange.js import --csv  # CSV files → DB
 *
 * Data Mapping (Table → Sheet):
 *   parties              →  Parties
 *   products             →  Products
 *   sales                →  Sales
 *   sales_items          →  Sales_Items
 *   purchases            →  Purchases
 *   purchase_items       →  Purchase_Items
 *   stock_movements      →  Stock
 *   milk_collections     →  Milk
 *   payments             →  Payments
 *   ledger_entries       →  Ledger
 *
 * The script preserves all other Excel sheets (Dashboard, Instructions, etc.).
 *
 * Requirements: better-sqlite3, xlsx (SheetJS)
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

// ──────────────────────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = __dirname;
const DB_PATH = path.join(PROJECT_ROOT, 'data', 'dairy-plant.db');
const EXCEL_PATH = path.join(PROJECT_ROOT, 'Godhuli_Dairy_Plant_Workbook.xlsx');
const CSV_DIR = path.join(PROJECT_ROOT, 'csv_exports');

// ──────────────────────────────────────────────────────────────
// TABLE-TO-SHEET MAPPING
// ──────────────────────────────────────────────────────────────
//
// Each table entry defines:
//   table         – SQLite table name
//   sheet         – Excel / CSV sheet name
//   columns       – Array of Excel header names (in order)
//   dbColumns     – Array of DB column names matching INSERT placeholders
//                   (excludes display-only JOIN columns like party_name)
//   query         – SQL SELECT — every column is aliased to match `columns` via colToCamel()
//   insertSQL     – INSERT/REPLACE with ? placeholders matching dbColumns length

const MAPPINGS = [
  // ── Parties ──
  {
    table: 'parties',
    sheet: 'Parties',
    columns: ['ID', 'Name', 'Phone', 'Address', 'PAN/VAT', 'Type',
              'Opening Balance', 'Notes', 'Created At', 'Updated At'],
    dbColumns: ['id', 'name', 'phone', 'address', 'pan_vat', 'type',
                'opening_balance', 'notes', 'created_at', 'updated_at'],
    query: `SELECT id, name, phone, address, pan_vat, type,
                   opening_balance, notes, created_at, updated_at
            FROM parties ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO parties
                (id, name, phone, address, pan_vat, type, opening_balance, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Products ──
  {
    table: 'products',
    sheet: 'Products',
    columns: ['ID', 'Name', 'Unit', 'Category', 'Opening Stock', 'Reorder Level',
              'Rate', 'GST Rate (%)', 'HSN Code', 'Notes', 'Created At', 'Updated At'],
    dbColumns: ['id', 'name', 'unit', 'category', 'opening_stock', 'reorder_level',
                'rate', 'gst_rate', 'hsn_code', 'notes', 'created_at', 'updated_at'],
    query: `SELECT id, name, unit, category, opening_stock, reorder_level, rate,
                   gst_rate, hsn_code, notes, created_at, updated_at
            FROM products ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO products
                (id, name, unit, category, opening_stock, reorder_level, rate,
                 gst_rate, hsn_code, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Sales ──
  {
    table: 'sales',
    sheet: 'Sales',
    columns: ['ID', 'Invoice No', 'Date', 'Party ID', 'Party Name',
              'Subtotal', 'Discount', 'Disc%', 'Tax',
              'Grand Total', 'Paid Amount', 'Payment Mode', 'Status',
              'Notes', 'Created At', 'Updated At'],
    // Party Name is display-only (JOINed) — not in the DB insert
    dbColumns: ['id', 'invoice_no', 'date', 'party_id',
                'subtotal', 'discount', 'discount_percent', 'tax',
                'grand_total', 'paid_amount', 'payment_mode', 'status',
                'notes', 'created_at', 'updated_at'],
    query: `SELECT s.id, s.invoice_no, s.date, s.party_id, p.name AS party_name,
                   s.subtotal, s.discount, s.discount_percent AS disc,
                   s.tax, s.grand_total, s.paid_amount, s.payment_mode, s.status,
                   s.notes, s.created_at, s.updated_at
            FROM sales s
            LEFT JOIN parties p ON s.party_id = p.id
            ORDER BY s.id`,
    insertSQL: `INSERT OR REPLACE INTO sales
                (id, invoice_no, date, party_id, subtotal, discount,
                 discount_percent, tax, grand_total, paid_amount,
                 payment_mode, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Sales Items ──
  {
    table: 'sales_items',
    sheet: 'Sales_Items',
    columns: ['ID', 'Sale ID', 'Product ID', 'Product Name',
              'Quantity', 'Unit', 'Rate', 'Amount'],
    dbColumns: ['id', 'sale_id', 'product_id', 'product_name',
                'quantity', 'unit', 'rate', 'amount'],
    query: `SELECT si.id, si.sale_id, si.product_id, si.product_name,
                   si.quantity, si.unit, si.rate, si.amount
            FROM sales_items si ORDER BY si.id`,
    insertSQL: `INSERT OR REPLACE INTO sales_items
                (id, sale_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Purchases ──
  {
    table: 'purchases',
    sheet: 'Purchases',
    columns: ['ID', 'Bill No', 'Date', 'Party ID', 'Party Name',
              'Subtotal', 'Discount', 'Tax', 'Transport', 'Extra Charges',
              'Grand Total', 'Paid Amount', 'Payment Mode', 'Status',
              'Notes', 'Created At', 'Updated At'],
    dbColumns: ['id', 'bill_no', 'date', 'party_id',
                'subtotal', 'discount', 'tax', 'transport_charges', 'extra_charges',
                'grand_total', 'paid_amount', 'payment_mode', 'status',
                'notes', 'created_at', 'updated_at'],
    query: `SELECT pr.id, pr.bill_no, pr.date, pr.party_id, p.name AS party_name,
                   pr.subtotal, pr.discount, pr.tax, pr.transport_charges, pr.extra_charges,
                   pr.grand_total, pr.paid_amount, pr.payment_mode, pr.status,
                   pr.notes, pr.created_at, pr.updated_at
            FROM purchases pr
            LEFT JOIN parties p ON pr.party_id = p.id
            ORDER BY pr.id`,
    insertSQL: `INSERT OR REPLACE INTO purchases
                (id, bill_no, date, party_id, subtotal, discount, tax,
                 transport_charges, extra_charges, grand_total, paid_amount,
                 payment_mode, status, notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Purchase Items ──
  {
    table: 'purchase_items',
    sheet: 'Purchase_Items',
    columns: ['ID', 'Purchase ID', 'Product ID', 'Product Name',
              'Quantity', 'Unit', 'Rate', 'Amount'],
    dbColumns: ['id', 'purchase_id', 'product_id', 'product_name',
                'quantity', 'unit', 'rate', 'amount'],
    query: `SELECT pi.id, pi.purchase_id, pi.product_id, pi.product_name,
                   pi.quantity, pi.unit, pi.rate, pi.amount
            FROM purchase_items pi ORDER BY pi.id`,
    insertSQL: `INSERT OR REPLACE INTO purchase_items
                (id, purchase_id, product_id, product_name, quantity, unit, rate, amount)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Stock Movements ──
  {
    table: 'stock_movements',
    sheet: 'Stock',
    columns: ['ID', 'Product ID', 'Product Name', 'Date', 'Type',
              'Reference Type', 'Reference ID',
              'Inward Qty', 'Outward Qty', 'Balance After', 'Rate',
              'Notes', 'Created At'],
    dbColumns: ['id', 'product_id',
                'date', 'type', 'reference_type', 'reference_id',
                'inward_qty', 'outward_qty', 'balance_after', 'rate',
                'notes', 'created_at'],
    query: `SELECT sm.id, sm.product_id, p.name AS product_name,
                   sm.date, sm.type,
                   sm.reference_type, sm.reference_id,
                   sm.inward_qty, sm.outward_qty, sm.balance_after, sm.rate,
                   sm.notes, sm.created_at
            FROM stock_movements sm
            LEFT JOIN products p ON sm.product_id = p.id
            ORDER BY sm.id`,
    insertSQL: `INSERT OR REPLACE INTO stock_movements
                (id, product_id, date, type, reference_type, reference_id,
                 inward_qty, outward_qty, balance_after, rate, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Milk Collections ──
  {
    table: 'milk_collections',
    sheet: 'Milk',
    columns: ['ID', 'Collection No', 'Date', 'Party ID', 'Farmer Name',
              'Milk Type', 'Quantity (L)', 'Fat %', 'SNF %',
              'Rate', 'Amount', 'Shift', 'Status', 'Notes',
              'Created At', 'Updated At'],
    dbColumns: ['id', 'collection_no', 'date', 'party_id',
                'milk_type', 'quantity_liters', 'fat_percent', 'snf_percent',
                'rate', 'amount', 'shift', 'status', 'notes',
                'created_at', 'updated_at'],
    query: `SELECT mc.id, mc.collection_no, mc.date, mc.party_id, p.name AS farmer_name,
                   mc.milk_type, mc.quantity_liters AS quantity_l,
                   mc.fat_percent AS fat, mc.snf_percent AS snf,
                   mc.rate, mc.amount, mc.shift, mc.status, mc.notes,
                   mc.created_at, mc.updated_at
            FROM milk_collections mc
            LEFT JOIN parties p ON mc.party_id = p.id
            ORDER BY mc.id`,
    insertSQL: `INSERT OR REPLACE INTO milk_collections
                (id, collection_no, date, party_id, milk_type, quantity_liters,
                 fat_percent, snf_percent, rate, amount, shift, status, notes,
                 created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Payments ──
  {
    table: 'payments',
    sheet: 'Payments',
    columns: ['ID', 'Party ID', 'Party Name', 'Date', 'Type',
              'Amount', 'Mode', 'Reference Type', 'Reference ID',
              'Notes', 'Created At'],
    dbColumns: ['id', 'party_id',
                'date', 'type', 'amount', 'mode',
                'reference_type', 'reference_id', 'notes', 'created_at'],
    query: `SELECT pm.id, pm.party_id, p.name AS party_name,
                   pm.date, pm.type,
                   pm.amount, pm.mode, pm.reference_type, pm.reference_id,
                   pm.notes, pm.created_at
            FROM payments pm
            LEFT JOIN parties p ON pm.party_id = p.id
            ORDER BY pm.id`,
    insertSQL: `INSERT OR REPLACE INTO payments
                (id, party_id, date, type, amount, mode,
                 reference_type, reference_id, notes, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── Ledger Entries ──
  {
    table: 'ledger_entries',
    sheet: 'Ledger',
    columns: ['ID', 'Party ID', 'Party Name', 'Date', 'Reference Type',
              'Reference ID', 'Description', 'Debit', 'Credit',
              'Balance', 'Created At'],
    dbColumns: ['id', 'party_id',
                'date', 'reference_type', 'reference_id',
                'description', 'debit', 'credit', 'balance', 'created_at'],
    query: `SELECT le.id, le.party_id, p.name AS party_name,
                   le.date, le.reference_type,
                   le.reference_id, le.description, le.debit, le.credit, le.balance,
                   le.created_at
            FROM ledger_entries le
            LEFT JOIN parties p ON le.party_id = p.id
            ORDER BY le.id`,
    insertSQL: `INSERT OR REPLACE INTO ledger_entries
                (id, party_id, date, reference_type, reference_id,
                 description, debit, credit, balance, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
];

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

function getDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`❌ Database not found: ${DB_PATH}`);
    console.error('   Start the app first (node server.js) or run seed script.');
    process.exit(1);
  }
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

/**
 * Convert an Excel column header to a camelCase key matching SQL aliases.
 * e.g. "Invoice No" → "invoice_no", "Disc%" → "disc", "Fat %" → "fat"
 */
function colToCamel(header) {
  let key = header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  key = key.replace(/_$/, '');
  return key;
}

/**
 * Some Excel headers produce colToCamel keys that don't match their DB column names.
 * This override maps colToCamel output → actual DB column name.
 */
const HEADER_TO_DB_OVERRIDE = {
  'disc': 'discount_percent',
  'fat': 'fat_percent',
  'snf': 'snf_percent',
  'quantity_l': 'quantity_liters',
};

/**
 * Resolve an Excel column header to its DB column name.
 * Uses the override map where applicable, otherwise falls back to colToCamel.
 */
function colToDbColumn(header) {
  const camel = colToCamel(header);
  return HEADER_TO_DB_OVERRIDE[camel] || camel;
}

/**
 * Safely convert a SQLite value for Excel.
 * Date strings → JS Date objects so Excel stores them as dates.
 */
function toExcelValue(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val + (val.length === 10 ? 'T00:00:00' : ''));
    if (!isNaN(d.getTime())) return d;
  }
  return val;
}

/**
 * Convert Excel value to a SQLite string.
 * Dates → "YYYY-MM-DD", other values → strings/numbers.
 */
function fromExcelValue(val) {
  if (val === null || val === undefined) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number' && Number.isInteger(val) === false) {
    return val; // keep numbers numeric
  }
  return String(val);
}


// ──────────────────────────────────────────────────────────────
// EXPORT: Database → Excel
// ──────────────────────────────────────────────────────────────

function cmdExport() {
  console.log('🐄  Godhuli Dairy Plant — Data Export (DB → Excel)');
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Excel:    ${EXCEL_PATH}`);
  console.log('');

  const db = getDb();

  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('❌ Excel workbook not found. Generate it first:');
    console.error('   python3 generate_godhuli_excel.py');
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  console.log('   Loaded existing workbook.');

  // Track which sheets we update
  const updatedSheets = new Set();

  for (const m of MAPPINGS) {
    console.log(`  📄 ${m.table.padEnd(20)} → ${m.sheet}`);

    const rows = db.prepare(m.query).all();
    console.log(`     ${rows.length} rows`);

    // Build array of arrays for xlsx
    const headerRow = m.columns;
    const dataRows = rows.map(row => {
      return m.columns.map(col => {
        const key = colToCamel(col);
        return toExcelValue(row[key]);
      });
    });

    const sheetData = [headerRow, ...dataRows];

    // Replace worksheet in workbook (preserve other sheets)
    if (workbook.SheetNames.includes(m.sheet)) {
      delete workbook.Sheets[m.sheet];
      workbook.SheetNames = workbook.SheetNames.filter(n => n !== m.sheet);
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths
    ws['!cols'] = m.columns.map((col, i) => {
      let maxLen = col.length;
      for (const row of dataRows.slice(0, 10)) {
        const val = row[i];
        if (val) maxLen = Math.max(maxLen, String(val).length);
      }
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });

    ws['!freeze'] = { x: 0, y: 1 };
    workbook.Sheets[m.sheet] = ws;
    workbook.SheetNames.push(m.sheet);
    updatedSheets.add(m.sheet);
  }

  XLSX.writeFile(workbook, EXCEL_PATH, { bookType: 'xlsx', type: 'file' });
  console.log('');
  console.log(`✅ Export complete. Updated ${updatedSheets.size} data sheets in:`);
  console.log(`   ${EXCEL_PATH}`);
  console.log(`   Dashboard, Instructions, Sales_Analysis sheets preserved.`);

  db.close();
}


// ──────────────────────────────────────────────────────────────
// IMPORT: Excel → Database
// ──────────────────────────────────────────────────────────────

function cmdImport() {
  console.log('🐄  Godhuli Dairy Plant — Data Import (Excel → DB)');
  console.log(`   Excel:    ${EXCEL_PATH}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log('');

  if (!fs.existsSync(EXCEL_PATH)) {
    console.error('❌ Excel workbook not found:', EXCEL_PATH);
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const db = getDb();

  // Wrap all imports in a transaction
  const importAll = db.transaction(() => {
    for (const m of MAPPINGS) {
      if (!workbook.SheetNames.includes(m.sheet)) {
        console.log(`  ⚠️  Sheet "${m.sheet}" not found, skipping ${m.table}`);
        continue;
      }

      const ws = workbook.Sheets[m.sheet];
      const rawData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      if (rawData.length < 2) {
        console.log(`  📄 ${m.table.padEnd(20)} ← ${m.sheet} (empty, skipped)`);
        continue;
      }

      // Verify header row
      const headerRow = rawData[0];
      const mismatch = m.columns.find((c, i) => {
        if (!headerRow[i]) return false;
        return String(headerRow[i]).trim().toLowerCase() !== c.trim().toLowerCase();
      });
      if (mismatch) {
        console.error(`  ❌ Column mismatch in "${m.sheet}":`);
        console.error(`     Expected one of: "${m.columns.slice(0, 5).join('", "')}..."`);
        console.error(`     Found:           "${headerRow.slice(0, 5).join('", "')}..."`);
        process.exit(1);
      }

      // Data rows (skip header)
      const dataRows = rawData.slice(1).filter(row =>
        row.some(cell => cell !== null && cell !== '')
      );

      // Build the position-based mapping: Excel column → INSERT param index
      // display-only columns (like Party Name) map to -1 and are skipped
      const excelPosToDbParam = m.columns.map(h => {
        return m.dbColumns.indexOf(colToDbColumn(h));
      });

      const stmt = db.prepare(m.insertSQL);
      let count = 0;

      for (const row of dataRows) {
        // Build values by position, not by name lookup
        const values = new Array(m.dbColumns.length).fill(null);
        excelPosToDbParam.forEach((paramIdx, colIdx) => {
          if (paramIdx >= 0) {
            values[paramIdx] = fromExcelValue(row[colIdx]);
          }
        });

        try {
          stmt.run(...values);
          count++;
        } catch (err) {
          if (err.message.includes('FOREIGN KEY')) {
            const id = values[0];
            console.warn(`     ⚠️  Skipping ${m.table} id=${id}: ${err.message.split('\n')[0]}`);
          } else if (err.message.includes('UNIQUE') || err.message.includes('PRIMARY KEY')) {
            const id = values[0];
            console.warn(`     ⚠️  Skipping ${m.table} id=${id} (duplicate): ${err.message.split('\n')[0]}`);
          } else {
            console.error(`     ❌ Error inserting into ${m.table}:`, err.message.split('\n')[0]);
            console.error(`     Row values (first 5):`, values.slice(0, 5).join(', '), '...');
          }
        }
      }

      console.log(`  📄 ${m.table.padEnd(20)} ← ${m.sheet} (${count} rows imported)`);
    }
  });

  try {
    importAll();
    console.log('');
    console.log('✅ Import complete.');
    console.log('   ⚠️  Note: This replaces existing rows by ID.');
    console.log('   ⚠️  Stock, Sales_Items, Purchase_Items tables are updated directly.');
    console.log('   ⚠️  Run "node server.js" after import to recalculate derived data.');
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}


// ──────────────────────────────────────────────────────────────
// CSV EXPORT / IMPORT
// ──────────────────────────────────────────────────────────────

function cmdExportCSV() {
  console.log('🐄  Godhuli Dairy Plant — CSV Export');
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   Output:   ${CSV_DIR}/`);
  console.log('');

  if (!fs.existsSync(CSV_DIR)) {
    fs.mkdirSync(CSV_DIR, { recursive: true });
  }

  const db = getDb();

  for (const m of MAPPINGS) {
    const rows = db.prepare(m.query).all();
    const csvPath = path.join(CSV_DIR, `${m.table}.csv`);

    const headerRow = m.columns.map(escapeCSV).join(',');
    const dataRows = rows.map(row => {
      return m.columns.map(col => {
        const key = colToCamel(col);
        return escapeCSV(toExcelValue(row[key]));
      }).join(',');
    });

    const csv = [headerRow, ...dataRows].join('\n');
    fs.writeFileSync(csvPath, csv, 'utf8');
    console.log(`  📄 ${m.table.padEnd(20)} → ${csvPath} (${rows.length} rows)`);
  }

  db.close();
  console.log('');
  console.log('✅ CSV export complete.');
}

function cmdImportCSV() {
  console.log('🐄  Godhuli Dairy Plant — CSV Import');
  console.log(`   Input:    ${CSV_DIR}/`);
  console.log(`   Database: ${DB_PATH}`);
  console.log('');

  if (!fs.existsSync(CSV_DIR)) {
    console.error(`❌ CSV directory not found: ${CSV_DIR}`);
    process.exit(1);
  }

  const db = getDb();

  const importAll = db.transaction(() => {
    for (const m of MAPPINGS) {
      const csvPath = path.join(CSV_DIR, `${m.table}.csv`);
      if (!fs.existsSync(csvPath)) {
        console.log(`  ⚠️  ${csvPath} not found, skipping ${m.table}`);
        continue;
      }

      const csv = fs.readFileSync(csvPath, 'utf8');
      const lines = csv.split('\n').filter(l => l.trim());
      if (lines.length < 2) {
        console.log(`  📄 ${m.table.padEnd(20)} ← (empty, skipped)`);
        continue;
      }

      const headerRow = parseCSVLine(lines[0]);
      const mismatch = m.columns.find((c, i) => {
        if (!headerRow[i]) return false;
        return String(headerRow[i]).trim().toLowerCase() !== c.trim().toLowerCase();
      });
      if (mismatch) {
        console.error(`  ❌ Column mismatch: expected "${mismatch}"`);
        process.exit(1);
      }

      // Build position mapping once (same logic as Excel import)
      const csvPosToDbParam = m.columns.map(h => {
        return m.dbColumns.indexOf(colToDbColumn(h));
      });

      const stmt = db.prepare(m.insertSQL);
      let count = 0;

      for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);

        const values = new Array(m.dbColumns.length).fill(null);
        csvPosToDbParam.forEach((paramIdx, colIdx) => {
          if (paramIdx >= 0) {
            values[paramIdx] = fromExcelValue(row[colIdx]);
          }
        });

        try {
          stmt.run(...values);
          count++;
        } catch (err) {
          if (err.message.includes('FOREIGN KEY') || err.message.includes('UNIQUE')) {
            console.warn(`     ⚠️  Skipping ${m.table} row ${i + 1}: ${err.message.split('\n')[0]}`);
          } else {
            console.error(`     ❌ Error row ${i + 1}: ${err.message.split('\n')[0]}`);
          }
        }
      }

      console.log(`  📄 ${m.table.padEnd(20)} ← ${csvPath} (${count} rows)`);
    }
  });

  try {
    importAll();
    console.log('');
    console.log('✅ CSV import complete.');
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

function escapeCSV(val) {
  const s = val instanceof Date ? val.toISOString().split('T')[0] : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}


// ──────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
🐄  Godhuli Dairy Plant — Data Exchange Tool
=============================================

  node data-exchange.js <command> [options]

Commands:
  export          Export database → Excel workbook (preserves Dashboard/other sheets)
  import          Import Excel workbook → database
  export --csv    Export database → CSV files in ./csv_exports/
  import --csv    Import CSV files from ./csv_exports/ → database
  help            Show this help

Examples:
  node data-exchange.js export
  node data-exchange.js import
  node data-exchange.js export --csv
  node data-exchange.js import --csv
`);
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const isCSV = args.includes('--csv');

  if (!cmd || cmd === 'help' || cmd === '--help') {
    printHelp();
    return;
  }

  if (cmd === 'export') {
    if (isCSV) cmdExportCSV();
    else cmdExport();
  } else if (cmd === 'import') {
    if (isCSV) cmdImportCSV();
    else cmdImport();
  } else {
    console.error(`❌ Unknown command: "${cmd}"`);
    printHelp();
    process.exit(1);
  }
}

main();
