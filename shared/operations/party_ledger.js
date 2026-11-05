/**
 * Prarambha Account & Stock Management — Derived Party Ledger
 * ===========================================================
 * The Party Ledger is a REPORT, not a register.
 *
 * In the workbook (Dairy_Accounts_Professional 76.xlsx) the `Party_Ledger` sheet
 * is a literal consolidation: row 3 is `=Sales_Entry!A3`, row 4409 is
 * `=Purchase_Entry!A3`, row 6474 is `=Collection!A3`, then Payment, Expenses,
 * PETTY CASH and Advance. Nothing is ever typed into it, and editing a source
 * row moves the ledger row with it.
 *
 * This module reproduces that shape. Every row is read from the register that
 * OWNS the transaction and carries `source_table` + `source_id`, so a statement
 * line can always be traced back to the original record.
 *
 * Invariants:
 *   • Nothing here writes. No function inserts a ledger entry.
 *   • A module never needs a matching `ledger_entries` row for its transaction
 *     to appear in a party statement.
 *   • A milk collection already carried on a purchase bill is NOT counted twice.
 *   • BS dates are compared as strings (2083-03-32 is a valid date here).
 */

const { round2 } = require('./accounting');

const MONEY = (v) => round2(Number(v) || 0);

/** Human labels for each source type, used by statements and the UI. */
const SOURCE_LABEL = {
    sale: 'Sale',
    purchase: 'Purchase',
    milk_collection: 'Milk collection',
    receipt: 'Receipt',
    payment: 'Payment made',
    advance: 'Advance paid',
    advance_returned: 'Advance returned',
    loan_given: 'Loan given',
    loan_received: 'Loan received',
    loan_repayment: 'Loan repayment',
    advance_adjustment: 'Advance adjusted',
    opening: 'Opening balance'
};

/** Shorthand quantity formatting that never invents decimals. */
function trim(v, dp = 2) {
    const n = Number(v);
    if (!isFinite(n)) return '';
    let s = n.toFixed(dp);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
}
const cap = (s) => { const t = String(s || '').trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ''; };

/**
 * Which side of the party account a payment row sits on.
 * debit  = the party owes us more
 * credit = we owe the party more
 * Returns null for rows that are not party transactions.
 */
function paymentSide(p) {
    const tt = String(p.transaction_type || '').toLowerCase();
    if (tt === 'advance') return { side: 'dr', type: 'advance', label: 'Advance paid' };
    if (tt === 'advance_returned') return { side: 'cr', type: 'advance_returned', label: 'Advance returned' };
    if (tt === 'loan_given') return { side: 'dr', type: 'loan_given', label: 'Loan given' };
    if (tt === 'loan_received') return { side: 'cr', type: 'loan_received', label: 'Loan received' };
    if (tt === 'loan_repayment') {
        return p.type === 'receipt'
            ? { side: 'cr', type: 'loan_repayment', label: 'Loan repayment received' }
            : { side: 'dr', type: 'loan_repayment', label: 'Loan repayment paid' };
    }
    if (tt === 'advance_adjustment') return { side: 'dr', type: 'advance_adjustment', label: 'Advance adjusted' };
    if (p.type === 'receipt') return { side: 'cr', type: 'receipt', label: 'Receipt' };
    if (p.type === 'payment') return { side: 'dr', type: 'payment', label: 'Payment made' };
    if (p.type === 'advance') return { side: 'dr', type: 'advance', label: 'Advance paid' };
    return null;
}

/**
 * Read one consolidated row per source transaction, from the owning registers.
 * No filtering by party or date here so callers can compute openings correctly.
 */
function collectModuleRows(db) {
    const rows = [];
    const add = (r) => rows.push(r);

    let sales = [];
    try {
        sales = db.prepare(`SELECT id, date, invoice_no, party_id, grand_total FROM sales
                            WHERE party_id IS NOT NULL`).all();
    } catch (e) { sales = []; }
    for (const s of sales) {
        add({
            party_id: s.party_id, date: s.date, type: 'sale',
            source_table: 'sales', source_id: s.id,
            reference: s.invoice_no || '',
            particulars: `Sale invoice ${s.invoice_no || '#' + s.id}`,
            debit: MONEY(s.grand_total), credit: 0
        });
    }

    let purchases = [];
    try {
        purchases = db.prepare(`SELECT id, date, bill_no, party_id, grand_total FROM purchases
                                WHERE party_id IS NOT NULL`).all();
    } catch (e) { purchases = []; }
    for (const p of purchases) {
        add({
            party_id: p.party_id, date: p.date, type: 'purchase',
            source_table: 'purchases', source_id: p.id,
            reference: p.bill_no || '',
            particulars: `Purchase bill ${p.bill_no || '#' + p.id}`,
            debit: 0, credit: MONEY(p.grand_total)
        });
    }

    // Milk handed in by a farmer that is NOT already carried on a purchase bill.
    // Counting both would double the same litres and the same rupees.
    let milk = [];
    try {
        milk = db.prepare(`SELECT id, date, collection_no, party_id, milk_type, quantity_liters, rate, amount
                           FROM milk_collections
                           WHERE party_id IS NOT NULL AND COALESCE(purchase_ref_id, 0) = 0`).all();
    } catch (e) { milk = []; }
    for (const m of milk) {
        add({
            party_id: m.party_id, date: m.date, type: 'milk_collection',
            source_table: 'milk_collections', source_id: m.id,
            reference: m.collection_no || '',
            particulars: `${cap(m.milk_type) || 'Milk'} milk ${trim(m.quantity_liters)} L @${trim(m.rate)}`,
            debit: 0, credit: MONEY(m.amount)
        });
    }

    let payments = [];
    try {
        payments = db.prepare(`SELECT id, party_id, date, type, transaction_type, amount, notes,
                                      reference_type, reference_id FROM payments`).all();
    } catch (e) { payments = []; }
    for (const p of payments) {
        const side = paymentSide(p);
        if (!side) continue;
        add({
            party_id: p.party_id, date: p.date, type: side.type,
            source_table: 'payments', source_id: p.id,
            reference: p.reference_type ? String(p.reference_type) : '',
            particulars: p.notes || side.label,
            debit: side.side === 'dr' ? MONEY(p.amount) : 0,
            credit: side.side === 'cr' ? MONEY(p.amount) : 0
        });
    }

    return rows;
}

/** Party header row (name/type/opening) or null. */
function getParty(db, partyId) {
    return db.prepare('SELECT id, name, type, phone, party_code, opening_balance FROM parties WHERE id = ?').get(partyId) || null;
}

const sumDr = (rows) => round2(rows.reduce((s, r) => s + (Number(r.debit) || 0), 0));
const sumCr = (rows) => round2(rows.reduce((s, r) => s + (Number(r.credit) || 0), 0));

/**
 * Consolidated statement for ONE party, built from the owning modules.
 *
 * @param {object} opts { party_id, from_date, to_date }  BS date strings
 * @returns {{party, opening_balance, opening_bf, rows, totals, by_source}}
 *   `opening_bf` already includes the party's stored opening balance plus every
 *   transaction before `from_date`, which is what a statement must print.
 */
function getDerivedPartyLedger(db, { party_id, from_date, to_date } = {}) {
    const party = getParty(db, party_id);
    if (!party) return null;

    const all = collectModuleRows(db).filter(r => Number(r.party_id) === Number(party_id));
    const storedOpening = MONEY(party.opening_balance);

    const before = from_date ? all.filter(r => String(r.date) < String(from_date)) : [];
    const openingBf = round2(storedOpening + sumDr(before) - sumCr(before));

    let view = all.filter(r => {
        if (from_date && String(r.date) < String(from_date)) return false;
        if (to_date && String(r.date) > String(to_date)) return false;
        return true;
    });
    view = view.slice().sort((a, b) => {
        const d = String(a.date).localeCompare(String(b.date));
        if (d !== 0) return d;
        const t = String(a.type).localeCompare(String(b.type));
        if (t !== 0) return t;
        return Number(a.source_id) - Number(b.source_id);
    });

    let balance = openingBf;
    const rows = view.map(r => {
        balance = round2(balance + (Number(r.debit) || 0) - (Number(r.credit) || 0));
        return { ...r, label: SOURCE_LABEL[r.type] || r.type, balance };
    });

    const bySource = {};
    for (const r of rows) {
        const k = r.type;
        bySource[k] = bySource[k] || { type: k, label: SOURCE_LABEL[k] || k, count: 0, debit: 0, credit: 0 };
        bySource[k].count += 1;
        bySource[k].debit = round2(bySource[k].debit + (Number(r.debit) || 0));
        bySource[k].credit = round2(bySource[k].credit + (Number(r.credit) || 0));
    }

    return {
        party,
        source: 'modules',
        opening_balance: storedOpening,
        opening_bf: openingBf,
        rows,
        totals: {
            debit: sumDr(rows),
            credit: sumCr(rows),
            closing: round2(balance),
            count: rows.length,
            balance_type: balance > 0.005 ? 'Receivable' : balance < -0.005 ? 'Payable' : 'Settled'
        },
        by_source: Object.values(bySource).sort((a, b) => b.count - a.count)
    };
}

/**
 * One row per party: debit/credit/balance from the modules (+ stored opening).
 * This is the receivable/payable figure; the appliance of `party_account.js`
 * once the ledger stops being a write target.
 */
function getDerivedPartyBalances(db, { as_of_date, type, search } = {}) {
    const rows = collectModuleRows(db);
    const parties = db.prepare('SELECT id, name, type, phone, party_code, opening_balance FROM parties').all();
    const byParty = new Map();
    for (const p of parties) {
        byParty.set(p.id, {
            party_id: p.id, name: p.name, type: p.type, phone: p.phone, party_code: p.party_code,
            opening_balance: MONEY(p.opening_balance), debit: 0, credit: 0, count: 0
        });
    }
    for (const r of rows) {
        if (as_of_date && String(r.date) > String(as_of_date)) continue;
        const acc = byParty.get(Number(r.party_id));
        if (!acc) continue;
        acc.debit = round2(acc.debit + (Number(r.debit) || 0));
        acc.credit = round2(acc.credit + (Number(r.credit) || 0));
        acc.count += 1;
    }
    let list = [...byParty.values()];
    if (type) list = list.filter(p => p.type === type || p.type === 'both');
    if (search) {
        const q = String(search).toLowerCase();
        list = list.filter(p => String(p.name).toLowerCase().includes(q) || String(p.phone || '').includes(q));
    }
    for (const p of list) {
        p.balance = round2(p.opening_balance + p.debit - p.credit);
        p.receivable = p.balance > 0 ? p.balance : 0;
        p.payable = p.balance < 0 ? -p.balance : 0;
        p.balance_type = p.balance > 0.005 ? 'Receivable' : p.balance < -0.005 ? 'Payable' : 'Settled';
    }
    return list.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance) || String(a.name).localeCompare(String(b.name)));
}

/**
 * Compare the derived statement against the stored `ledger_entries` table.
 * Read-only. Used to decide — with numbers, not opinion — whether the stored
 * ledger can be retired or has to be reconciled first.
 */
function reconcileWithStoredLedger(db, { as_of_date } = {}) {
    const derived = getDerivedPartyBalances(db, { as_of_date });
    const storedRows = db.prepare(`
        SELECT le.party_id, COALESCE(SUM(le.debit), 0) dr, COALESCE(SUM(le.credit), 0) cr, COUNT(*) n
        FROM ledger_entries le
        ${as_of_date ? 'WHERE le.date <= ?' : ''}
        GROUP BY le.party_id`).all(...(as_of_date ? [as_of_date] : []));
    const stored = new Map(storedRows.map(r => [Number(r.party_id), {
        debit: MONEY(r.dr), credit: MONEY(r.cr), count: Number(r.n)
    }]));

    const byTypeRows = db.prepare(`
        SELECT reference_type, COUNT(*) n, ROUND(SUM(debit), 2) dr, ROUND(SUM(credit), 2) cr
        FROM ledger_entries GROUP BY reference_type ORDER BY n DESC`).all();

    const ids = new Set([...derived.map(d => Number(d.party_id)), ...stored.keys()]);
    const parties = [];
    let matched = 0, differing = 0, totalDr = 0, totalCr = 0, storedDr = 0, storedCr = 0;

    for (const id of ids) {
        const d = derived.find(x => Number(x.party_id) === id) || null;
        const s = stored.get(id) || { debit: 0, credit: 0, count: 0 };
        const derivedBalance = d ? round2(d.opening_balance + d.debit - d.credit) : 0;
        const storedBalance = round2(s.debit - s.credit);
        const diff = round2(derivedBalance - storedBalance);
        totalDr = round2(totalDr + (d ? d.debit : 0));
        totalCr = round2(totalCr + (d ? d.credit : 0));
        storedDr = round2(storedDr + s.debit);
        storedCr = round2(storedCr + s.credit);
        if (Math.abs(diff) < 0.005) matched++; else differing++;
        parties.push({
            party_id: id,
            name: d ? d.name : `Party #${id}`,
            derived_debit: d ? d.debit : 0,
            derived_credit: d ? d.credit : 0,
            derived_balance: derivedBalance,
            stored_debit: s.debit,
            stored_credit: s.credit,
            stored_balance: storedBalance,
            stored_rows: s.count,
            source_rows: d ? d.count : 0,
            difference: diff
        });
    }

    parties.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
    return {
        parties,
        by_source_type: byTypeRows,
        totals: {
            derived_debit: totalDr,
            derived_credit: totalCr,
            stored_debit: storedDr,
            stored_credit: storedCr,
            difference: round2((totalDr - totalCr) - (storedDr - storedCr)),
            parties_matched: matched,
            parties_differing: differing
        }
    };
}

module.exports = {
    SOURCE_LABEL,
    paymentSide,
    collectModuleRows,
    getDerivedPartyLedger,
    getDerivedPartyBalances,
    reconcileWithStoredLedger
};
