/**
 * Prarambha Account & Stock Management — Global Search
 * =====================================================
 * One search box that looks across every module: parties, sales,
 * purchases, payments, milk collections, products, ledger, petty cash,
 * bank, production, salary, vehicle and other expenses, cash deposits.
 *
 * Read-only. Never writes anything.
 *
 * Usage:
 *   const result = ops.globalSearch(db, { query: 'AAMOSH' });
 */

const PER_TYPE_LIMIT = 8;

function likeParam(query) {
    // Escape LIKE wildcards so "50%" doesn't match everything
    return '%' + String(query).replace(/[\\%_]/g, (m) => '\\' + m) + '%';
}

function countAndRows(db, baseSql, selectSql, params) {
    // baseSql starts with "FROM ..." so it can follow both SELECT COUNT(*) and the column list
    const total = db.prepare(`SELECT COUNT(*) AS c ${baseSql}`).get(...params).c;
    const rows = total > 0 ? db.prepare(selectSql).all(...params) : [];
    return { total, rows };
}

/**
 * Global search across all modules.
 * @param {object} db - better-sqlite3 database instance
 * @param {object} opts - { query: string, perType?: number }
 * @returns {object} { query, total, groups: [{type,label,page,total,rows}] }
 */
function globalSearch(db, opts = {}) {
    const query = String(opts.query || '').trim();
    if (query.length < 2) {
        return { query, total: 0, groups: [] };
    }
    const perType = Math.max(1, Math.min(50, Number(opts.perType) || PER_TYPE_LIMIT));
    const like = likeParam(query);
    const p = [like];
    const groups = [];

    // ── Parties ──
    {
        const base = `FROM parties WHERE archived = 0 AND (
            name LIKE ? ESCAPE '\\' OR party_code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\'
            OR pan_vat LIKE ? ESCAPE '\\' OR address LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT id, party_code, name, phone, type, address ${base} ORDER BY name LIMIT ${perType}`, params);
        groups.push({
            type: 'party', label: '👥 Parties', page: 'parties', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.name,
                subtitle: [r.party_code, r.type, r.phone].filter(Boolean).join(' · '),
                amount: null, date: '', status: ''
            }))
        });
    }

    // ── Sales invoices ──
    {
        const base = `FROM sales s JOIN parties pt ON pt.id = s.party_id
            WHERE (s.invoice_no LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\'
                OR CAST(s.grand_total AS TEXT) LIKE ? ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM sales_items si WHERE si.sale_id = s.id AND si.product_name LIKE ? ESCAPE '\\'))`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT s.id, s.invoice_no, s.date, s.grand_total, s.paid_amount, s.status, pt.name AS party_name ${base}
             ORDER BY s.date DESC, s.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'sale', label: '🧾 Sales Invoices', page: 'sales', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.invoice_no,
                subtitle: `${r.party_name} · ${r.date}`,
                amount: r.grand_total,
                date: r.date,
                status: r.status
            }))
        });
    }

    // ── Purchase bills ──
    {
        const base = `FROM purchases pu JOIN parties pt ON pt.id = pu.party_id
            WHERE (pu.bill_no LIKE ? ESCAPE '\\' OR pu.notes LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\'
                OR CAST(pu.grand_total AS TEXT) LIKE ? ESCAPE '\\'
                OR EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = pu.id AND pi.product_name LIKE ? ESCAPE '\\'))`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT pu.id, pu.bill_no, pu.date, pu.grand_total, pu.paid_amount, pu.status, pt.name AS party_name ${base}
             ORDER BY pu.date DESC, pu.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'purchase', label: '📦 Purchase Bills', page: 'purchases', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.bill_no,
                subtitle: `${r.party_name} · ${r.date}`,
                amount: r.grand_total,
                date: r.date,
                status: r.status
            }))
        });
    }

    // ── Payments (receipts / payments / advances) ──
    {
        const base = `FROM payments pm JOIN parties pt ON pt.id = pm.party_id
            WHERE (pm.notes LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\' OR pm.mode LIKE ? ESCAPE '\\'
                OR CAST(pm.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT pm.id, pm.date, pm.type, pm.amount, pm.mode, pm.notes, pt.name AS party_name ${base}
             ORDER BY pm.date DESC, pm.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'payment', label: '💳 Payments & Receipts', page: 'cash-collection', total,
            rows: rows.map(r => ({
                id: r.id,
                title: `${r.type === 'receipt' ? 'Received from' : r.type === 'payment' ? 'Paid to' : 'Advance to'} ${r.party_name}`,
                subtitle: `${r.date} · ${r.mode}${r.notes ? ' · ' + r.notes : ''}`,
                amount: r.amount,
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Milk collections ──
    {
        const base = `FROM milk_collections mc JOIN parties pt ON pt.id = mc.party_id
            WHERE (mc.collection_no LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\' OR mc.milk_type LIKE ? ESCAPE '\\'
                OR mc.notes LIKE ? ESCAPE '\\' OR CAST(mc.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT mc.id, mc.collection_no, mc.date, mc.milk_type, mc.quantity_liters, mc.amount, mc.status, pt.name AS party_name ${base}
             ORDER BY mc.date DESC, mc.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'milk', label: '🥛 Milk Collections', page: 'milk', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.collection_no,
                subtitle: `${r.party_name} · ${r.date} · ${r.milk_type} · ${r.quantity_liters} L`,
                amount: r.amount,
                date: r.date,
                status: r.status
            }))
        });
    }

    // ── Products / items ──
    {
        const base = `FROM products pr WHERE (pr.name LIKE ? ESCAPE '\\' OR pr.category LIKE ? ESCAPE '\\'
            OR pr.hsn_code LIKE ? ESCAPE '\\' OR pr.notes LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT pr.id, pr.name, pr.unit, pr.category, pr.rate ${base} ORDER BY pr.name LIMIT ${perType}`, params);
        groups.push({
            type: 'product', label: '🏷️ Products', page: 'stock', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.name,
                subtitle: [r.category, `${r.rate}/ ${r.unit}`.replace('/ ', ' @ ')].filter(Boolean).join(' · '),
                amount: null, date: '', status: ''
            }))
        });
    }

    // ── Ledger entries ──
    {
        const base = `FROM ledger_entries le JOIN parties pt ON pt.id = le.party_id
            WHERE (le.description LIKE ? ESCAPE '\\' OR pt.name LIKE ? ESCAPE '\\'
                OR le.reference_type LIKE ? ESCAPE '\\' OR CAST(le.debit AS TEXT) LIKE ? ESCAPE '\\'
                OR CAST(le.credit AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT le.id, le.party_id, le.date, le.reference_type, le.description, le.debit, le.credit, pt.name AS party_name ${base}
             ORDER BY le.date DESC, le.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'ledger', label: '📒 Ledger Entries', page: 'parties', total,
            rows: rows.map(r => ({
                id: r.party_id,
                title: r.party_name,
                subtitle: `${r.date} · ${r.reference_type} · ${r.description || ''}`,
                amount: (r.debit || 0) - (r.credit || 0),
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Petty cash ──
    {
        const base = `FROM petty_cash pc WHERE (pc.voucher_no LIKE ? ESCAPE '\\' OR pc.expense_head LIKE ? ESCAPE '\\'
            OR pc.description LIKE ? ESCAPE '\\' OR pc.paid_to LIKE ? ESCAPE '\\'
            OR CAST(pc.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT pc.id, pc.voucher_no, pc.date, pc.expense_head, pc.description, pc.amount, pc.paid_to ${base}
             ORDER BY pc.date DESC, pc.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'petty_cash', label: '💵 Petty Cash', page: 'petty-cash', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.voucher_no,
                subtitle: `${r.date} · ${r.expense_head}${r.paid_to ? ' · ' + r.paid_to : ''}${r.description ? ' · ' + r.description : ''}`,
                amount: r.amount,
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Bank transactions ──
    {
        const base = `FROM bank_transactions bt WHERE (bt.reference_no LIKE ? ESCAPE '\\' OR bt.counterparty_name LIKE ? ESCAPE '\\'
            OR bt.description LIKE ? ESCAPE '\\' OR bt.bank_account LIKE ? ESCAPE '\\'
            OR CAST(bt.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT bt.id, bt.date, bt.reference_no, bt.counterparty_name, bt.description, bt.amount, bt.debit, bt.credit, bt.txn_type ${base}
             ORDER BY bt.date DESC, bt.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'bank', label: '🏦 Bank Transactions', page: 'bank', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.counterparty_name || r.reference_no || `#${r.id}`,
                subtitle: `${r.date} · ${r.txn_type || (r.credit > 0 ? 'credit' : 'debit')}${r.description ? ' · ' + r.description : ''}`,
                amount: r.amount || (r.credit || r.debit || 0),
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Production batches ──
    {
        const base = `FROM production_batches pb WHERE (pb.batch_no LIKE ? ESCAPE '\\' OR pb.process_type LIKE ? ESCAPE '\\'
            OR pb.operator_name LIKE ? ESCAPE '\\' OR pb.remarks LIKE ? ESCAPE '\\' OR pb.wastage_reason LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT pb.id, pb.batch_no, pb.date, pb.process_type, pb.input_quantity, pb.input_unit, pb.output_quantity, pb.output_unit, pb.actual_yield_percent ${base}
             ORDER BY pb.date DESC, pb.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'batch', label: '🏭 Production Batches', page: 'production', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.batch_no,
                subtitle: `${r.date} · ${r.process_type} · ${r.input_quantity} ${r.input_unit} → ${r.output_quantity} ${r.output_unit} (${r.actual_yield_percent}%)`,
                amount: null,
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Salary records ──
    {
        const base = `FROM salary_records sr WHERE (sr.employee_name LIKE ? ESCAPE '\\' OR sr.month LIKE ? ESCAPE '\\'
            OR sr.position LIKE ? ESCAPE '\\' OR sr.remarks LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT sr.id, sr.employee_name, sr.month, sr.position, sr.net_salary, sr.payment_date ${base}
             ORDER BY sr.month DESC, sr.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'salary', label: '👷 Salary Records', page: 'salary', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.employee_name,
                subtitle: `${r.month}${r.position ? ' · ' + r.position : ''}${r.payment_date ? ' · paid ' + r.payment_date : ''}`,
                amount: r.net_salary,
                date: r.payment_date || r.month,
                status: ''
            }))
        });
    }

    // ── Vehicle expenses ──
    {
        const base = `FROM vehicle_expenses ve WHERE (ve.vehicle_name LIKE ? ESCAPE '\\' OR ve.driver_name LIKE ? ESCAPE '\\'
            OR ve.expense_type LIKE ? ESCAPE '\\' OR ve.remarks LIKE ? ESCAPE '\\'
            OR CAST(ve.total_amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT ve.id, ve.date, ve.vehicle_name, ve.driver_name, ve.expense_type, ve.total_amount, ve.remarks ${base}
             ORDER BY ve.date DESC, ve.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'vehicle', label: '🚚 Vehicle Expenses', page: 'vehicle', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.vehicle_name,
                subtitle: `${r.date} · ${r.expense_type}${r.driver_name ? ' · ' + r.driver_name : ''}${r.remarks ? ' · ' + r.remarks : ''}`,
                amount: r.total_amount,
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Other expenses ──
    {
        const base = `FROM other_expenses oe WHERE (oe.category LIKE ? ESCAPE '\\' OR oe.expense_head LIKE ? ESCAPE '\\'
            OR oe.description LIKE ? ESCAPE '\\' OR oe.paid_to LIKE ? ESCAPE '\\' OR oe.reference_no LIKE ? ESCAPE '\\'
            OR CAST(oe.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT oe.id, oe.date, oe.category, oe.expense_head, oe.description, oe.amount, oe.paid_to ${base}
             ORDER BY oe.date DESC, oe.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'expense', label: '🧹 Other Expenses', page: 'expenses', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.expense_head || r.category,
                subtitle: `${r.date} · ${r.category}${r.paid_to ? ' · ' + r.paid_to : ''}${r.description ? ' · ' + r.description : ''}`,
                amount: r.amount,
                date: r.date,
                status: ''
            }))
        });
    }

    // ── Cash deposits ──
    {
        const base = `FROM cash_deposits cd WHERE (cd.deposit_no LIKE ? ESCAPE '\\' OR cd.bank_name LIKE ? ESCAPE '\\'
            OR cd.reference_no LIKE ? ESCAPE '\\' OR cd.remarks LIKE ? ESCAPE '\\'
            OR CAST(cd.amount AS TEXT) LIKE ? ESCAPE '\\')`;
        const params = [like, like, like, like, like];
        const { total, rows } = countAndRows(db, base,
            `SELECT cd.id, cd.date, cd.deposit_no, cd.bank_name, cd.reference_no, cd.amount, cd.deposit_mode ${base}
             ORDER BY cd.date DESC, cd.id DESC LIMIT ${perType}`, params);
        groups.push({
            type: 'deposit', label: '🏧 Cash Deposits', page: 'cash-deposit', total,
            rows: rows.map(r => ({
                id: r.id,
                title: r.deposit_no,
                subtitle: `${r.date} · ${r.bank_name} · ${r.deposit_mode}${r.reference_no ? ' · ' + r.reference_no : ''}`,
                amount: r.amount,
                date: r.date,
                status: ''
            }))
        });
    }

    // Keep only groups that actually matched something
    const matched = groups.filter(g => g.total > 0);
    return {
        query,
        total: matched.reduce((sum, g) => sum + g.total, 0),
        groups: matched
    };
}

module.exports = { globalSearch };
