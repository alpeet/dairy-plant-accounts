/**
 * Godhuli Dairy Plant — CSV Data Exchange Module
 * ==============================================
 * Provides CSV import/export functionality for all data-entry tables,
 * with auto-generated sample CSV templates.
 *
 * Used by:
 *   - server.js (web API routes)
 *   - renderer/js/settings.js (UI)
 */

// ──────────────────────────────────────────────────────────────
// TABLE DEFINITIONS
// ──────────────────────────────────────────────────────────────
// Each entry defines:
//   table         – SQLite table name
//   displayName   – Human-readable name for UI
//   description   – Brief description
//   columns       – CSV header column names
//   dbColumns     – DB column names (matching INSERT placeholders)
//   sampleRow     – Example data row for sample CSV generation
//   query         – SQL SELECT to export all data
//   insertSQL     – INSERT OR REPLACE with ? placeholders

const TABLE_DEFS = [
  // ── 1. PARTIES ──
  {
    table: 'parties',
    displayName: 'Parties (Customers / Suppliers / Farmers)',
    description: 'Master list of all parties: customers, suppliers, farmers, and partners',
    columns: ['ID', 'Name *', 'Phone', 'Address', 'PAN/VAT', 'Type', 'Opening Balance', 'Route ID', 'Notes'],
    dbColumns: ['id', 'name', 'phone', 'address', 'pan_vat', 'type', 'opening_balance', 'route_id', 'notes'],
    sampleRow: [1, 'Sample Farmer', '9841234567', 'Kathmandu', '123456789', 'farmer', 0.0, null, 'Sample farmer entry'],
    query: `SELECT id, name, phone, address, pan_vat, type, opening_balance, route_id, notes FROM parties ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO parties (id, name, phone, address, pan_vat, type, opening_balance, route_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 2. PRODUCTS ──
  {
    table: 'products',
    displayName: 'Products (Inventory Items)',
    description: 'Master list of all products/items in inventory',
    columns: ['ID', 'Name *', 'Unit', 'Category', 'Opening Stock', 'Reorder Level', 'Rate', 'GST Rate (%)', 'HSN Code', 'Notes'],
    dbColumns: ['id', 'name', 'unit', 'category', 'opening_stock', 'reorder_level', 'rate', 'gst_rate', 'hsn_code', 'notes'],
    sampleRow: [1, 'Fresh Cow Milk', 'liter', 'Milk', 100.0, 20.0, 65.0, 0, '040120', 'Sample product'],
    query: `SELECT id, name, unit, category, opening_stock, reorder_level, rate, gst_rate, hsn_code, notes FROM products ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO products (id, name, unit, category, opening_stock, reorder_level, rate, gst_rate, hsn_code, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 3. ROUTES ──
  {
    table: 'routes',
    displayName: 'Routes / Collection Centers',
    description: 'Milk collection routes and centers',
    columns: ['ID', 'Name *', 'Area', 'Assigned Vehicle', 'Assigned Staff', 'Notes'],
    dbColumns: ['id', 'name', 'area', 'assigned_vehicle', 'assigned_staff', 'notes'],
    sampleRow: [1, 'East Zone Route', 'East Kathmandu', 'BA 1 JA 1234', 'Hari Ram', 'Daily morning collection'],
    query: `SELECT id, name, area, assigned_vehicle, assigned_staff, notes FROM routes ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO routes (id, name, area, assigned_vehicle, assigned_staff, notes) VALUES (?, ?, ?, ?, ?, ?)`,
  },
  // ── 4. MILK RATE CHART ──
  {
    table: 'milk_rate_chart',
    displayName: 'Milk Rate Chart',
    description: 'Milk pricing rules with effective dates',
    columns: ['ID', 'Effective From *', 'Rate Type', 'Fat Multiplier', 'SNF Multiplier', 'Extra Per Unit', 'Fixed Rate', 'Notes'],
    dbColumns: ['id', 'effective_from', 'rate_type', 'fat_multiplier', 'snf_multiplier', 'extra_per_unit', 'fixed_rate', 'notes'],
    sampleRow: [1, '2024-01-01', 'formula', 7.15, 4.55, 0.0, 0.0, 'Standard rate'],
    query: `SELECT id, effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes FROM milk_rate_chart ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO milk_rate_chart (id, effective_from, rate_type, fat_multiplier, snf_multiplier, extra_per_unit, fixed_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 5. SALES ──
  {
    table: 'sales',
    displayName: 'Sales Invoices',
    description: 'Sales transactions (main header)',
    columns: ['ID', 'Invoice No *', 'Date *', 'Party ID *', 'Subtotal', 'Discount', 'Discount %', 'Tax', 'Grand Total', 'Paid Amount', 'Payment Mode', 'Status', 'Notes'],
    dbColumns: ['id', 'invoice_no', 'date', 'party_id', 'subtotal', 'discount', 'discount_percent', 'tax', 'grand_total', 'paid_amount', 'payment_mode', 'status', 'notes'],
    sampleRow: [1, 'INV-2024-001', '2024-01-15', 1, 5000.0, 100.0, 2.0, 0.0, 4900.0, 4900.0, 'cash', 'paid', 'Sample sale'],
    query: `SELECT id, invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes FROM sales ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO sales (id, invoice_no, date, party_id, subtotal, discount, discount_percent, tax, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 6. SALES ITEMS ──
  {
    table: 'sales_items',
    displayName: 'Sales Invoice Items',
    description: 'Individual line items within sales invoices',
    columns: ['ID', 'Sale ID *', 'Product ID *', 'Product Name *', 'Quantity *', 'Unit', 'Rate *', 'Amount *'],
    dbColumns: ['id', 'sale_id', 'product_id', 'product_name', 'quantity', 'unit', 'rate', 'amount'],
    sampleRow: [1, 1, 1, 'Fresh Cow Milk', 50.0, 'liter', 65.0, 3250.0],
    query: `SELECT id, sale_id, product_id, product_name, quantity, unit, rate, amount FROM sales_items ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO sales_items (id, sale_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 7. PURCHASES ──
  {
    table: 'purchases',
    displayName: 'Purchase Bills',
    description: 'Purchase transactions (main header)',
    columns: ['ID', 'Bill No *', 'Date *', 'Party ID *', 'Subtotal', 'Discount', 'Tax', 'Transport', 'Extra Charges', 'Grand Total', 'Paid Amount', 'Payment Mode', 'Status', 'Notes'],
    dbColumns: ['id', 'bill_no', 'date', 'party_id', 'subtotal', 'discount', 'tax', 'transport_charges', 'extra_charges', 'grand_total', 'paid_amount', 'payment_mode', 'status', 'notes'],
    sampleRow: [1, 'BILL-2024-001', '2024-01-15', 2, 30000.0, 500.0, 0.0, 1500.0, 0.0, 31000.0, 31000.0, 'bank', 'paid', 'Sample purchase'],
    query: `SELECT id, bill_no, date, party_id, subtotal, discount, tax, transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes FROM purchases ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO purchases (id, bill_no, date, party_id, subtotal, discount, tax, transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 8. PURCHASE ITEMS ──
  {
    table: 'purchase_items',
    displayName: 'Purchase Bill Items',
    description: 'Individual line items within purchase bills',
    columns: ['ID', 'Purchase ID *', 'Product ID *', 'Product Name *', 'Quantity *', 'Unit', 'Rate *', 'Amount *'],
    dbColumns: ['id', 'purchase_id', 'product_id', 'product_name', 'quantity', 'unit', 'rate', 'amount'],
    sampleRow: [1, 1, 2, 'Packaging Material', 100.0, 'pcs', 15.0, 1500.0],
    query: `SELECT id, purchase_id, product_id, product_name, quantity, unit, rate, amount FROM purchase_items ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO purchase_items (id, purchase_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 9. MILK COLLECTIONS ──
  {
    table: 'milk_collections',
    displayName: 'Milk Collections',
    description: 'Daily milk collection records from farmers',
    columns: ['ID', 'Collection No *', 'Date *', 'Party ID *', 'Milk Type', 'Quantity (L) *', 'Fat %', 'SNF %', 'Rate', 'Amount', 'Shift', 'Status', 'Notes'],
    dbColumns: ['id', 'collection_no', 'date', 'party_id', 'milk_type', 'quantity_liters', 'fat_percent', 'snf_percent', 'rate', 'amount', 'shift', 'status', 'notes'],
    sampleRow: [1, 'MC-2024-001', '2024-01-15', 1, 'cow', 120.5, 3.5, 8.5, 65.0, 7832.5, 'morning', 'processed', 'Morning collection'],
    query: `SELECT id, collection_no, date, party_id, milk_type, quantity_liters, fat_percent, snf_percent, rate, amount, shift, status, notes FROM milk_collections ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO milk_collections (id, collection_no, date, party_id, milk_type, quantity_liters, fat_percent, snf_percent, rate, amount, shift, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 10. STOCK MOVEMENTS ──
  {
    table: 'stock_movements',
    displayName: 'Stock Movements',
    description: 'Inventory stock movement records',
    columns: ['ID', 'Product ID *', 'Date *', 'Type *', 'Reference Type', 'Reference ID', 'Inward Qty', 'Outward Qty', 'Balance After', 'Rate', 'Notes'],
    dbColumns: ['id', 'product_id', 'date', 'type', 'reference_type', 'reference_id', 'inward_qty', 'outward_qty', 'balance_after', 'rate', 'notes'],
    sampleRow: [1, 1, '2024-01-15', 'opening', '', null, 100.0, 0.0, 100.0, 65.0, 'Opening stock entry'],
    query: `SELECT id, product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes FROM stock_movements ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO stock_movements (id, product_id, date, type, reference_type, reference_id, inward_qty, outward_qty, balance_after, rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 11. PAYMENTS ──
  {
    table: 'payments',
    displayName: 'Payments / Receipts',
    description: 'Payment records (receipts received and payments made)',
    columns: ['ID', 'Party ID *', 'Date *', 'Type *', 'Amount *', 'Mode', 'Reference Type', 'Reference ID', 'Notes'],
    dbColumns: ['id', 'party_id', 'date', 'type', 'amount', 'mode', 'reference_type', 'reference_id', 'notes'],
    sampleRow: [1, 1, '2024-01-15', 'receipt', 5000.0, 'cash', 'sale', 1, 'Payment for invoice INV-2024-001'],
    query: `SELECT id, party_id, date, type, amount, mode, reference_type, reference_id, notes FROM payments ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO payments (id, party_id, date, type, amount, mode, reference_type, reference_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 12. SALARY RECORDS ──
  {
    table: 'salary_records',
    displayName: 'Salary / Payroll',
    description: 'Employee salary and payroll records',
    columns: ['ID', 'Employee Name *', 'Position', 'Month *', 'Basic Salary', 'Allowance', 'Advance', 'Deduction', 'Net Salary', 'Payment Date', 'Payment Mode', 'Remarks'],
    dbColumns: ['id', 'employee_name', 'position', 'month', 'basic_salary', 'allowance', 'advance', 'deduction', 'net_salary', 'payment_date', 'payment_mode', 'remarks'],
    sampleRow: [1, 'Ram Sharma', 'Plant Operator', '2024-01', 18000.0, 2000.0, 0.0, 500.0, 19500.0, '2024-01-30', 'cash', 'January salary'],
    query: `SELECT id, employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks FROM salary_records ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO salary_records (id, employee_name, position, month, basic_salary, allowance, advance, deduction, net_salary, payment_date, payment_mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 13. VEHICLE EXPENSES ──
  {
    table: 'vehicle_expenses',
    displayName: 'Vehicle Expenses',
    description: 'Vehicle operational expenses (fuel, repair, maintenance)',
    columns: ['ID', 'Date *', 'Vehicle Name *', 'Driver Name', 'Route ID', 'Expense Type', 'Fuel Amount', 'Repair Amount', 'Maint. Amount', 'Toll/Parking', 'Other Amount', 'Total Amount', 'Remarks'],
    dbColumns: ['id', 'date', 'vehicle_name', 'driver_name', 'route_id', 'expense_type', 'fuel_amount', 'repair_amount', 'maintenance_amount', 'toll_parking_amount', 'other_amount', 'total_amount', 'remarks'],
    sampleRow: [1, '2024-01-15', 'BA 1 JA 1234', 'Sita Devi', 1, 'fuel', 5000.0, 0.0, 0.0, 100.0, 0.0, 5100.0, 'Weekly fuel'],
    query: `SELECT id, date, vehicle_name, driver_name, route_id, expense_type, fuel_amount, repair_amount, maintenance_amount, toll_parking_amount, other_amount, total_amount, remarks FROM vehicle_expenses ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO vehicle_expenses (id, date, vehicle_name, driver_name, route_id, expense_type, fuel_amount, repair_amount, maintenance_amount, toll_parking_amount, other_amount, total_amount, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 14. OTHER EXPENSES ──
  {
    table: 'other_expenses',
    displayName: 'Other Expenses',
    description: 'Miscellaneous business expenses register',
    columns: ['ID', 'Date *', 'Category *', 'Expense Head *', 'Description', 'Amount *', 'Paid To', 'Payment Mode', 'Reference No', 'Remarks'],
    dbColumns: ['id', 'date', 'category', 'expense_head', 'description', 'amount', 'paid_to', 'payment_mode', 'reference_no', 'remarks'],
    sampleRow: [1, '2024-01-15', 'Office', 'Stationery', 'Printer paper and ink', 2500.0, 'Stationery Shop', 'cash', '', 'Monthly office supplies'],
    query: `SELECT id, date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks FROM other_expenses ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO other_expenses (id, date, category, expense_head, description, amount, paid_to, payment_mode, reference_no, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 15. PETTY CASH ──
  {
    table: 'petty_cash',
    displayName: 'Petty Cash',
    description: 'Small cash expense entries',
    columns: ['ID', 'Voucher No *', 'Date *', 'Expense Head *', 'Description', 'Amount *', 'Paid To', 'Approved By', 'Payment Mode', 'Remarks'],
    dbColumns: ['id', 'voucher_no', 'date', 'expense_head', 'description', 'amount', 'paid_to', 'approved_by', 'payment_mode', 'remarks'],
    sampleRow: [1, 'PC-2024-001', '2024-01-15', 'Tea & Snacks', 'Office tea supplies', 500.0, 'Tea Shop', 'Manager', 'cash', 'Daily tea expense'],
    query: `SELECT id, voucher_no, date, expense_head, description, amount, paid_to, approved_by, payment_mode, remarks FROM petty_cash ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO petty_cash (id, voucher_no, date, expense_head, description, amount, paid_to, approved_by, payment_mode, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 16. CASH DEPOSITS ──
  {
    table: 'cash_deposits',
    displayName: 'Cash Deposits (Bank)',
    description: 'Bank deposit records',
    columns: ['ID', 'Date *', 'Deposit No *', 'Bank Name *', 'Branch', 'Account No', 'Amount *', 'Cash Source', 'Deposit Mode', 'Reference No', 'Remarks'],
    dbColumns: ['id', 'date', 'deposit_no', 'bank_name', 'branch', 'account_no', 'amount', 'cash_source', 'deposit_mode', 'reference_no', 'remarks'],
    sampleRow: [1, '2024-01-15', 'DEP-2024-001', 'Nepal Bank Ltd.', 'Main Branch', '123456789012', 50000.0, 'sales', 'cash', 'SLIP123', 'Daily sales deposit'],
    query: `SELECT id, date, deposit_no, bank_name, branch, account_no, amount, cash_source, deposit_mode, reference_no, remarks FROM cash_deposits ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO cash_deposits (id, date, deposit_no, bank_name, branch, account_no, amount, cash_source, deposit_mode, reference_no, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 17. DENOMINATION COUNTS ──
  {
    table: 'denomination_counts',
    displayName: 'Denomination Counts (Daily Cash)',
    description: 'Daily cash counting and denomination tally',
    columns: ['ID', 'Date *', 'Note 1000', 'Note 500', 'Note 100', 'Note 50', 'Note 20', 'Note 10', 'Note 5', 'Note Other', 'Note Other Value', 'Coin 5', 'Coin 2', 'Coin 1', 'Total Cash', 'Expected Cash', 'Difference', 'Remarks'],
    dbColumns: ['id', 'date', 'note_1000', 'note_500', 'note_100', 'note_50', 'note_20', 'note_10', 'note_5', 'note_other', 'note_other_value', 'coin_5', 'coin_2', 'coin_1', 'total_cash', 'expected_cash', 'difference', 'remarks'],
    sampleRow: [1, '2024-01-15', 10, 20, 50, 30, 100, 50, 20, 5, 250.0, 10, 20, 30, 38500.0, 38000.0, 500.0, 'Daily cash count'],
    query: `SELECT id, date, note_1000, note_500, note_100, note_50, note_20, note_10, note_5, note_other, note_other_value, coin_5, coin_2, coin_1, total_cash, expected_cash, difference, remarks FROM denomination_counts ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO denomination_counts (id, date, note_1000, note_500, note_100, note_50, note_20, note_10, note_5, note_other, note_other_value, coin_5, coin_2, coin_1, total_cash, expected_cash, difference, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 18. PRODUCTION BATCHES ──
  {
    table: 'production_batches',
    displayName: 'Production Batches',
    description: 'Milk processing batch records',
    columns: ['ID', 'Batch No *', 'Date *', 'Shift', 'Process Type *', 'Input Qty', 'Input Unit', 'Output Qty', 'Output Unit', 'Std Yield %', 'Actual Yield %', 'Wastage Qty', 'Wastage Reason', 'Operator', 'Remarks'],
    dbColumns: ['id', 'batch_no', 'date', 'shift', 'process_type', 'input_quantity', 'input_unit', 'output_quantity', 'output_unit', 'standard_yield_percent', 'actual_yield_percent', 'wastage_quantity', 'wastage_reason', 'operator_name', 'remarks'],
    sampleRow: [1, 'BATCH-2024-001', '2024-01-15', 'morning', 'Pasteurization', 500.0, 'liter', 490.0, 'liter', 98.0, 98.0, 10.0, 'Evaporation loss', 'Ram Sharma', 'Morning batch'],
    query: `SELECT id, batch_no, date, shift, process_type, input_quantity, input_unit, output_quantity, output_unit, standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks FROM production_batches ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO production_batches (id, batch_no, date, shift, process_type, input_quantity, input_unit, output_quantity, output_unit, standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 19. PRODUCTION INPUTS ──
  {
    table: 'production_inputs',
    displayName: 'Production Inputs (Raw Materials)',
    description: 'Raw materials consumed in production batches',
    columns: ['ID', 'Batch ID *', 'Product ID *', 'Product Name *', 'Quantity *', 'Unit', 'Rate', 'Amount'],
    dbColumns: ['id', 'batch_id', 'product_id', 'product_name', 'quantity', 'unit', 'rate', 'amount'],
    sampleRow: [1, 1, 1, 'Fresh Cow Milk', 500.0, 'liter', 65.0, 32500.0],
    query: `SELECT id, batch_id, product_id, product_name, quantity, unit, rate, amount FROM production_inputs ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO production_inputs (id, batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 20. PRODUCTION OUTPUTS ──
  {
    table: 'production_outputs',
    displayName: 'Production Outputs (Finished Goods)',
    description: 'Finished products produced in production batches',
    columns: ['ID', 'Batch ID *', 'Product ID *', 'Product Name *', 'Quantity *', 'Unit', 'Rate', 'Amount'],
    dbColumns: ['id', 'batch_id', 'product_id', 'product_name', 'quantity', 'unit', 'rate', 'amount'],
    sampleRow: [1, 1, 3, 'Ghee (Clarified Butter)', 25.0, 'kg', 800.0, 20000.0],
    query: `SELECT id, batch_id, product_id, product_name, quantity, unit, rate, amount FROM production_outputs ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO production_outputs (id, batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
  // ── 21. PARTNER CAPITAL ──
  {
    table: 'partner_capital',
    displayName: 'Partner Capital Transactions',
    description: 'Partner capital contributions and withdrawals',
    columns: ['ID', 'Party ID *', 'Date *', 'Type *', 'Amount *', 'Mode', 'Reference No', 'Notes'],
    dbColumns: ['id', 'party_id', 'date', 'type', 'amount', 'mode', 'reference_no', 'notes'],
    sampleRow: [1, 5, '2024-01-15', 'contribution', 500000.0, 'bank', 'TRF001', 'Initial capital contribution'],
    query: `SELECT id, party_id, date, type, amount, mode, reference_no, notes FROM partner_capital ORDER BY id`,
    insertSQL: `INSERT OR REPLACE INTO partner_capital (id, party_id, date, type, amount, mode, reference_no, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  },
];

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Escape a value for CSV output.
 */
function escapeCSV(val) {
  const s = val === null || val === undefined ? '' : String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Parse a single CSV line into an array of values.
 */
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
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Convert a CSV value from string to appropriate type for DB.
 */
function fromCSVValue(val) {
  if (val === null || val === undefined || val === '') return null;
  // Try number
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== '') return num;
  // Try date
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val;
  return String(val);
}

// ──────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────

/**
 * Get all table definitions.
 */
function getAllTableDefs() {
  return TABLE_DEFS.map(t => ({
    table: t.table,
    displayName: t.displayName,
    description: t.description,
    columns: t.columns,
  }));
}

/**
 * Get a specific table definition by table name.
 */
function getTableDef(tableName) {
  return TABLE_DEFS.find(t => t.table === tableName);
}

/**
 * Generate a sample CSV string for a given table.
 * Includes header row + 2 sample data rows.
 */
function generateSampleCSV(tableName) {
  const def = getTableDef(tableName);
  if (!def) return null;

  const headerRow = def.columns.map(escapeCSV).join(',');
  const sampleRow1 = def.columns.map((col, i) => {
    const val = def.sampleRow[i];
    if (i === 0) return '1'; // ID
    return escapeCSV(val);
  }).join(',');

  // Generate a second sample with slightly different values
  const sampleRow2 = def.columns.map((col, i) => {
    if (i === 0) return '2';
    const sampleVal = def.sampleRow[i];
    if (typeof sampleVal === 'number') {
      // Slightly different number
      if (sampleVal === 0) return 0;
      if (Number.isInteger(sampleVal)) return sampleVal + 1;
      return (sampleVal * 1.1).toFixed(1);
    }
    if (typeof sampleVal === 'string' && sampleVal) {
      return sampleVal.replace(/1/g, '2').replace(/Sample/g, 'Another');
    }
    return sampleVal;
  }).join(',');

  // Add instruction rows at the top (visible as data rows in spreadsheet apps)
  // Use a unique sentinel prefix (>) so importFromCSV can reliably skip them
  const instructions = '> INSTRUCTIONS: CSV Template for ' + def.displayName + '\n' +
    '> Fields marked with * are required. Date format: YYYY-MM-DD\n' +
    '> Leave ID empty for auto-assigned IDs (new records). Include ID to update existing records.\n' +
    '> Party types: customer | supplier | both | farmer | partner\n';

  return instructions + headerRow + '\n' + sampleRow1 + '\n' + sampleRow2 + '\n';
}

/**
 * Export a table's data to CSV string.
 * @param {Object} db - Database instance
 * @param {string} tableName - Table name
 * @returns {string|null} CSV string or null if table not found
 */
function exportToCSV(db, tableName) {
  const def = getTableDef(tableName);
  if (!def) return null;

  const rows = db.prepare(def.query).all();
  const headerRow = def.columns.map(escapeCSV).join(',');
  const dataRows = rows.map(row => {
    return def.columns.map((col, i) => {
      const dbCol = def.dbColumns[i];
      return escapeCSV(row[dbCol]);
    }).join(',');
  });

  return headerRow + '\n' + dataRows.join('\n') + '\n';
}

/**
 * Import CSV data into a table.
 * @param {Object} db - Database instance
 * @param {string} tableName - Table name
 * @param {string} csvContent - Full CSV content
 * @returns {Object} { success, count, errors }
 */
function importFromCSV(db, tableName, csvContent) {
  const def = getTableDef(tableName);
  if (!def) return { success: false, error: 'Unknown table: ' + tableName };

  // Strip UTF-8 BOM if present
  let cleanContent = csvContent;
  if (cleanContent.charCodeAt(0) === 0xFEFF) {
    cleanContent = cleanContent.slice(1);
  }

  const lines = cleanContent.split('\n')
    .map(l => l.replace(/\r$/, '').trim())
    .filter(l => l && !l.startsWith('>'));

  if (lines.length < 1) {
    return { success: false, error: 'CSV file is empty or has no data rows' };
  }

  // Parse header row
  const headerRow = parseCSVLine(lines[0]);
  const expectedHeaders = def.columns.map(c => c.replace(/\s*\*$/, '').trim().toLowerCase());
  const actualHeaders = headerRow.map(h => h.replace(/\s*\*$/, '').trim().toLowerCase());

  // Validate headers
  const matched = expectedHeaders.filter(h => actualHeaders.includes(h));
  if (matched.length < 2) {
    return {
      success: false,
      error: 'CSV headers do not match expected format.\nExpected: ' + def.columns.join(', ') + '\nFound: ' + headerRow.join(', ')
    };
  }

  // Build column position mapping: CSV column index → DB column index
  const csvColToDbIdx = actualHeaders.map(h => {
    const idx = expectedHeaders.indexOf(h);
    return idx >= 0 ? idx : -1;
  });

  // Check if ID column exists (column 0)
  const hasIdColumn = actualHeaders.includes(expectedHeaders[0]);

  const stmt = db.prepare(def.insertSQL);
  let count = 0;
  const errors = [];

  const trx = db.transaction(() => {
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

      const values = new Array(def.dbColumns.length).fill(null);

      csvColToDbIdx.forEach((dbIdx, csvIdx) => {
        if (dbIdx >= 0 && csvIdx < row.length) {
          values[dbIdx] = fromCSVValue(row[csvIdx]);
        }
      });

      // Auto-generate ID if it's 0 or empty or null
      if (values[0] === null || values[0] === 0 || values[0] === '0' || values[0] === '') {
        values[0] = null; // Let SQLite auto-increment
      }

      try {
        stmt.run(...values);
        count++;
      } catch (err) {
        // Provide helpful error messages
        const msg = err.message.split('\n')[0];
        if (msg.includes('FOREIGN KEY')) {
          errors.push(`Row ${i + 1}: Foreign key violation — the referenced record may not exist: ${msg}`);
        } else if (msg.includes('UNIQUE') || msg.includes('PRIMARY KEY')) {
          errors.push(`Row ${i + 1}: Duplicate entry — a record with this ID already exists: ${msg}`);
        } else if (msg.includes('NOT NULL')) {
          errors.push(`Row ${i + 1}: Missing required field: ${msg}`);
        } else {
          errors.push(`Row ${i + 1}: ${msg}`);
        }
      }
    }
  });

  try {
    trx();
    return { success: true, count, errors, table: tableName, displayName: def.displayName };
  } catch (err) {
    return { success: false, error: 'Import transaction failed: ' + err.message, count, errors };
  }
}

module.exports = {
  getAllTableDefs,
  getTableDef,
  generateSampleCSV,
  exportToCSV,
  importFromCSV,
};
