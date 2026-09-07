/**
 * Prarambha Account & Stock Management — Export to Daily Account Pro Excel
 * =======================================================================
 * Exports all data from the SQLite database into the same sheet layout
 * as Dairy_Accounts_Professional.xlsx so it can be opened in any spreadsheet app.
 *
 * Sheets exported:
 *   Party_Master    — all parties with opening balances
 *   Stock_Master    — products with current stock
 *   Sales_Entry     — all sales with items
 *   Purchase_Entry  — all purchases with items
 *   Collection      — all cash collections/payments
 *   Party_Ledger    — all ledger entries
 *
 * Usage (server-side):
 *   const { exportToDailyAccountExcel } = require('./shared/export-daily-account');
 *   const result = exportToDailyAccountExcel(db, outputPath);
 *
 * Returns: { success, filePath, rowCount }
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

/**
 * Convert a YYYY-MM-DD date string to a JS Date object (midnight UTC).
 */
function strToDate(val) {
    if (!val) return new Date();
    if (val instanceof Date) return val;
    const s = String(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return new Date(s);
    return new Date(s);
}

/**
 * Convert a YYYY-MM-DD string to a BS-compatible display string or keep as-is.
 * We use the raw date string for the Excel export (it matches the import format).
 */
function dateStr(val) {
    if (!val) return '';
    return String(val).split('T')[0];
}

/**
 * Main export function.
 * @param {object} db - better-sqlite3 database instance
 * @param {string} outputPath - full path to write the .xlsx file
 * @returns {{ success: boolean, filePath: string, rowCount: number, error?: string }}
 */
function exportToDailyAccountExcel(db, outputPath) {
    try {
        const wb = XLSX.utils.book_new();

        // ── Party_Master ──────────────────────────────────────
        const parties = db.prepare(`
            SELECT p.name, p.type, p.phone, p.email, p.address, p.opening_balance,
                   COALESCE((SELECT SUM(s.grand_total) FROM sales s WHERE s.party_id = p.id), 0) as total_sales,
                   COALESCE((SELECT SUM(pm.amount) FROM payments pm WHERE pm.party_id = p.id AND pm.type = 'receipt'), 0) as total_recvd,
                   p.notes
            FROM parties p
            ORDER BY p.name
        `).all();

        const partyRows = [
            ['', '', '', '', '', '', '', '', '', ''],
            ['Party Name', 'Type', 'Phone', 'Email', 'Address', 'Opening Balance', 'Total Sales/Dr', 'Total Recd/Cr', 'Running Balance', 'Status'],
        ];
        for (const p of parties) {
            const running = (p.opening_balance || 0) + (p.total_sales || 0) - (p.total_recvd || 0);
            partyRows.push([
                p.name || '',
                p.type || 'Customer',
                p.phone || '',
                p.email || '',
                p.address || '',
                p.opening_balance || 0,
                p.total_sales || 0,
                p.total_recvd || 0,
                running,
                running > 0 ? 'Receivable' : running < 0 ? 'Payable' : 'Settled'
            ]);
        }
        const wsParties = XLSX.utils.aoa_to_sheet(partyRows);
        wsParties['!cols'] = [
            { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 28 }, { wch: 25 }, { wch: 15 },
            { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsParties, 'Party_Master');

        // ── Stock_Master ──────────────────────────────────────
        const products = db.prepare(`
            SELECT pr.name, pr.unit, pr.opening_stock, pr.category, pr.rate, pr.reorder_level,
                   COALESCE((SELECT SUM(sm.inward_qty) FROM stock_movements sm WHERE sm.product_id = pr.id AND sm.type = 'purchase'), 0) as purchases_in,
                   COALESCE((SELECT SUM(sm.outward_qty) FROM stock_movements sm WHERE sm.product_id = pr.id AND sm.type = 'sale'), 0) as sales_out
            FROM products pr
            ORDER BY pr.name
        `).all();

        const stockRows = [
            ['', '', '', '', '', '', '', '', '', ''],
            ['Product Name', 'Unit', 'Opening Stock', 'Purchases In', 'Sales Out', 'Current Stock', 'Reorder Level', 'Rate (Rs)', 'Stock Value', 'Status'],
        ];
        for (const p of products) {
            const currentStock = (p.opening_stock || 0) + (p.purchases_in || 0) - (p.sales_out || 0);
            stockRows.push([
                p.name || '',
                p.unit || 'kg',
                p.opening_stock || 0,
                p.purchases_in || 0,
                p.sales_out || 0,
                currentStock,
                p.reorder_level || 0,
                p.rate || 0,
                currentStock * (p.rate || 0),
                currentStock <= 0 ? 'Out of Stock' : currentStock <= (p.reorder_level || 0) ? 'Low Stock' : 'In Stock'
            ]);
        }
        const wsStock = XLSX.utils.aoa_to_sheet(stockRows);
        wsStock['!cols'] = [
            { wch: 25 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
            { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, wsStock, 'Stock_Master');

        // ── Sales_Entry ───────────────────────────────────────
        const sales = db.prepare(`
            SELECT s.date, s.invoice_no, p.name as party_name, s.subtotal, s.discount,
                   s.discount_percent, s.grand_total, s.paid_amount, s.payment_mode,
                   s.status, s.notes
            FROM sales s
            LEFT JOIN parties p ON s.party_id = p.id
            ORDER BY s.date, s.invoice_no
        `).all();

        const salesItems = db.prepare(`
            SELECT si.sale_id, si.product_name, si.quantity, si.unit, si.rate, si.amount
            FROM sales_items si
            ORDER BY si.sale_id
        `).all();

        // Group items by sale_id
        const saleItemsMap = {};
        for (const item of salesItems) {
            if (!saleItemsMap[item.sale_id]) saleItemsMap[item.sale_id] = [];
            saleItemsMap[item.sale_id].push(item);
        }

        const salesRows = [
            ['', '', '', '', '', '', '', '', '', '', '', ''],
            ['Date', '', 'Invoice No', 'Party Name', 'Product', 'Quantity', 'Rate', 'Amount', 'Discount %', 'Net Amount', 'Payment Mode', 'Status', 'Remarks'],
        ];
        let totalSales = 0;
        for (const s of sales) {
            const items = saleItemsMap[s.id] || [];
            if (items.length === 0) {
                // Sale with no items
                salesRows.push([
                    dateStr(s.date), '', s.invoice_no, s.party_name || '', '', 0, 0,
                    s.subtotal || 0, s.discount_percent || 0, s.grand_total || 0,
                    s.payment_mode || 'cash', s.status || 'paid', s.notes || ''
                ]);
            } else {
                for (const item of items) {
                    salesRows.push([
                        dateStr(s.date), '', s.invoice_no, s.party_name || '',
                        item.product_name || '', item.quantity || 0, item.rate || 0,
                        item.amount || 0, s.discount_percent || 0, s.grand_total || 0,
                        s.payment_mode || 'cash', s.status || 'paid', s.notes || ''
                    ]);
                }
            }
            totalSales += s.grand_total || 0;
        }

        // Add totals row
        salesRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '']);
        salesRows.push(['', '', '', 'TOTALS', '', '', '', totalSales, '', totalSales, '', '', '']);

        const wsSales = XLSX.utils.aoa_to_sheet(salesRows);
        wsSales['!cols'] = [
            { wch: 12 }, { wch: 3 }, { wch: 14 }, { wch: 25 }, { wch: 20 },
            { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
            { wch: 12 }, { wch: 10 }, { wch: 20 }
        ];
        XLSX.utils.book_append_sheet(wb, wsSales, 'Sales_Entry');

        // ── Purchase_Entry ────────────────────────────────────
        const purchases = db.prepare(`
            SELECT pr.date, pr.bill_no, p.name as party_name, pr.subtotal,
                   pr.transport_charges, pr.grand_total, pr.paid_amount,
                   pr.payment_mode, pr.status, pr.notes
            FROM purchases pr
            LEFT JOIN parties p ON pr.party_id = p.id
            ORDER BY pr.date, pr.bill_no
        `).all();

        const purchaseItems = db.prepare(`
            SELECT pi.purchase_id, pi.product_name, pi.quantity, pi.unit, pi.rate, pi.amount
            FROM purchase_items pi
            ORDER BY pi.purchase_id
        `).all();

        const purchaseItemsMap = {};
        for (const item of purchaseItems) {
            if (!purchaseItemsMap[item.purchase_id]) purchaseItemsMap[item.purchase_id] = [];
            purchaseItemsMap[item.purchase_id].push(item);
        }

        const purchaseRows = [
            ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
            ['Date', '', 'Bill No', 'Supplier Name', 'Shift', 'Product', 'FAT %', 'SNF %', 'Extra/Unit', 'Rate Type', 'Fixed Rate', 'Rate/Unit', 'Quantity', 'Amount', 'Transport', 'Net Amount', 'Payment Mode', 'Status', 'Remarks'],
        ];
        let totalPurchases = 0;
        for (const p of purchases) {
            const items = purchaseItemsMap[p.id] || [];
            if (items.length === 0) {
                purchaseRows.push([
                    dateStr(p.date), '', p.bill_no, p.party_name || '', '', '',
                    '', '', '', '', '', '', 0, p.subtotal || 0, p.transport_charges || 0,
                    p.grand_total || 0, p.payment_mode || 'cash', p.status || 'paid', p.notes || ''
                ]);
            } else {
                let first = true;
                for (const item of items) {
                    purchaseRows.push([
                        dateStr(p.date), '', p.bill_no, p.party_name || '', '',
                        item.product_name || '', '', '', '', 'FIXED', '', item.rate || 0,
                        item.quantity || 0, item.amount || 0,
                        first ? (p.transport_charges || 0) : 0,
                        p.grand_total || 0,
                        p.payment_mode || 'cash', p.status || 'paid',
                        first ? (p.notes || '') : ''
                    ]);
                    first = false;
                }
            }
            totalPurchases += p.grand_total || 0;
        }

        purchaseRows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']);
        purchaseRows.push(['', '', '', 'TOTALS', '', '', '', '', '', '', '', '', '', totalPurchases, '', totalPurchases, '', '', '']);

        const wsPurchases = XLSX.utils.aoa_to_sheet(purchaseRows);
        wsPurchases['!cols'] = [
            { wch: 12 }, { wch: 3 }, { wch: 14 }, { wch: 25 }, { wch: 10 },
            { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
            { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
            { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 20 }
        ];
        XLSX.utils.book_append_sheet(wb, wsPurchases, 'Purchase_Entry');

        // ── Collection ────────────────────────────────────────
        const payments = db.prepare(`
            SELECT pm.date, pm.party_id, p.name as party_name, pm.type,
                   pm.amount, pm.mode, pm.reference_type, pm.reference_id, pm.notes
            FROM payments pm
            LEFT JOIN parties p ON pm.party_id = p.id
            ORDER BY pm.date
        `).all();

        const collRows = [
            ['', '', '', '', '', '', '', '', '', '', '', ''],
            ['Date', '', 'Receipt No', 'Customer Name', 'Against Bill', 'Type', 'Opening Due', 'Collected', 'Paid', 'Payment Mode', 'Closing Due', 'REMARKS'],
        ];
        for (const pm of payments) {
            const payType = pm.type === 'receipt' ? 'Collection' : pm.type === 'payment' ? 'Payment' : 'Advance';
            const collected = pm.type === 'receipt' ? pm.amount : 0;
            const paid = pm.type === 'payment' ? pm.amount : 0;
            collRows.push([
                dateStr(pm.date), '',
                pm.reference_id || '', pm.party_name || '',
                pm.reference_type || '', payType, '', collected, paid,
                pm.mode || 'cash', '', pm.notes || ''
            ]);
        }
        // Add total row
        const totalCollected = payments.filter(p => p.type === 'receipt').reduce((s, p) => s + (p.amount || 0), 0);
        const totalPaid = payments.filter(p => p.type === 'payment').reduce((s, p) => s + (p.amount || 0), 0);
        collRows.push(['', '', '', '', '', '', '', '', '', '', '', '']);
        collRows.push(['', '', '', 'TOTALS', '', '0', '', totalCollected, totalPaid, '', '', '']);

        const wsCollection = XLSX.utils.aoa_to_sheet(collRows);
        wsCollection['!cols'] = [
            { wch: 12 }, { wch: 3 }, { wch: 12 }, { wch: 25 }, { wch: 14 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
            { wch: 12 }, { wch: 25 }
        ];
        XLSX.utils.book_append_sheet(wb, wsCollection, 'Collection');

        // ── Party_Ledger ──────────────────────────────────────
        const ledgerEntries = db.prepare(`
            SELECT le.date, p.name as party_name, le.reference_type, le.reference_id,
                   le.description, le.debit, le.credit, le.balance
            FROM ledger_entries le
            LEFT JOIN parties p ON le.party_id = p.id
            ORDER BY le.date, le.id
        `).all();

        const ledgerRows = [
            ['', '', '', '', '', '', '', '', '', '', ''],
            ['Date', '', 'Party Name', 'Txn Type', 'Reference', 'Description', 'Debit', 'Credit', 'Balance', 'Remarks', 'MatchIdx'],
        ];
        for (const le of ledgerEntries) {
            ledgerRows.push([
                dateStr(le.date), '', le.party_name || '',
                le.reference_type || '', le.reference_id || '',
                le.description || '', le.debit || 0, le.credit || 0,
                le.balance || 0, '', ''
            ]);
        }

        const wsLedger = XLSX.utils.aoa_to_sheet(ledgerRows);
        wsLedger['!cols'] = [
            { wch: 12 }, { wch: 3 }, { wch: 25 }, { wch: 16 }, { wch: 14 },
            { wch: 30 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 10 }
        ];
        XLSX.utils.book_append_sheet(wb, wsLedger, 'Party_Ledger');

        // ── Write workbook ────────────────────────────────────
        // Ensure the output directory exists
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        XLSX.writeFile(wb, outputPath, { bookType: 'xlsx', type: 'file' });

        const rowCount = parties.length + products.length + sales.length + purchases.length
                       + payments.length + ledgerEntries.length;

        return {
            success: true,
            filePath: outputPath,
            rowCount,
            sheets: {
                parties: parties.length,
                products: products.length,
                sales: sales.length,
                purchases: purchases.length,
                payments: payments.length,
                ledger: ledgerEntries.length
            }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = { exportToDailyAccountExcel };
