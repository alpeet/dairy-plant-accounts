/**
 * Prarambha Account & Stock Management — Farmer Bulk Payment Operations
 * =====================================================
 * Single source of truth for farmer outstanding queries and bulk payments.
 * Used by both Electron (main.js) and Web (server.js).
 */

const { logAudit } = require('./audit');

/**
 * Get all farmers with outstanding milk collection dues.
 */
function getFarmerOutstanding(db) {
    const farmers = db.prepare(`
        SELECT p.id, p.name, p.phone, p.address,
            COALESCE(SUM(mc.amount), 0) as total_due,
            COUNT(mc.id) as pending_collections
        FROM parties p
        JOIN milk_collections mc ON mc.party_id = p.id
        WHERE mc.status IN ('pending', 'processed')
          AND p.type IN ('supplier', 'both')
        GROUP BY p.id, p.name, p.phone, p.address
        HAVING total_due > 0
        ORDER BY p.name
    `).all();

    return farmers.map(f => {
        const collections = db.prepare(`
            SELECT id, collection_no, date, amount, status, quantity_liters
            FROM milk_collections
            WHERE party_id = ? AND status IN ('pending', 'processed')
            ORDER BY date DESC
        `).all(f.id);
        return { ...f, collections };
    });
}

/**
 * Process bulk payments to farmers.
 * Creates payment records, ledger entries, and updates collection statuses.
 */
function bulkPayFarmers(db, { payments, date, mode, notes, bank_account, bank_reference }, userId = null) {
    const createdIds = [];
    const trx = db.transaction(() => {
        const results = [];
        for (const payment of payments) {
            const { party_id, amount, collection_ids } = payment;
            if (!party_id || !amount || amount <= 0) continue;

            // Create payment record ('payment' type = money going out)
            const payResult = db.prepare(
                "INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes, bank_account, bank_reference) VALUES (?, ?, 'payment', ?, ?, 'milk_collection', ?, ?, ?)"
            ).run(party_id, date, amount, mode, notes || '', bank_account || '', bank_reference || '');
            const paymentId = Number(payResult.lastInsertRowid);
            createdIds.push(paymentId);

            // Add ledger entry for payment made (debit reduces what we owe)
            db.prepare(
                "INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance) VALUES (?, ?, 'payment_made', ?, ?, ?, 0, 0)"
            ).run(party_id, date, payResult.lastInsertRowid, `Bulk Payment - Milk Collection`, amount);

            // Update paid milk collections to 'paid' status
            if (collection_ids && collection_ids.length > 0) {
                const placeholders = collection_ids.map(() => '?').join(',');
                db.prepare(
                    `UPDATE milk_collections SET status = 'paid', updated_at = datetime('now','localtime') WHERE id IN (${placeholders}) AND party_id = ?`
                ).run(...collection_ids, party_id);

                // Update ledger entries for these collections to balance=0
                db.prepare(
                    `UPDATE ledger_entries SET balance = 0 WHERE reference_type = 'milk_collection' AND reference_id IN (${placeholders})`
                ).run(...collection_ids);
            }

            results.push({
                payment_id: paymentId,
                party_id,
                amount,
                collections_cleared: collection_ids ? collection_ids.length : 0
            });
        }
        // D10: a batch payout made by one bank transfer is ONE bank transaction.
        // Create it for the batch total with txn_uid 'pay:<firstPaymentId>' and
        // point EVERY payment of the batch at it, so the cash/bank position
        // counts the transfer once (never once per farmer).
        const ref = String(bank_reference || '').trim();
        if (ref && ['bank', 'upi', 'cheque'].includes(String(mode || 'cash').toLowerCase()) && createdIds.length) {
            const { ensureBankTable } = require('./bank');
            ensureBankTable(db);
            const existing = db.prepare('SELECT id FROM bank_transactions WHERE reference_no = ?').get(ref)
                || db.prepare('SELECT id FROM bank_transactions WHERE txn_uid = ?').get(`pay:${createdIds[0]}`);
            let bankId = existing ? existing.id : null;
            if (!bankId) {
                const total = db.prepare(
                    `SELECT COALESCE(SUM(amount), 0) AS s FROM payments WHERE id IN (${createdIds.map(() => '?').join(',')})`
                ).get(...createdIds).s;
                const ins = db.prepare(`
                    INSERT INTO bank_transactions
                        (date, reference_no, counterparty_name, description, debit, credit, amount,
                         payment_mode, bank_account, txn_type, match_status, accounting_class,
                         remarks, created_by, ledger_posted, ledger_entry_id, txn_uid)
                    VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'payment', 'auto', 'supplier_payment', ?, ?, 1, NULL, ?)
                `).run(date, ref, '', `Bulk farmer payout (${createdIds.length} payments)`,
                    total, total, mode, bank_account || '',
                    `linked to ${createdIds.length} milk-collection payments (ledger posted by the payments)`,
                    userId, `pay:${createdIds[0]}`);
                bankId = Number(ins.lastInsertRowid);
            }
            db.prepare(
                `UPDATE payments SET bank_txn_id = ? WHERE id IN (${createdIds.map(() => '?').join(',')})`
            ).run(bankId, ...createdIds);
        }
        return results;
    });
    const paid = trx();
    // One audit row per payment created (action must satisfy the schema's
    // CHECK constraint on audit_log.action). The summary context — cycle date,
    // mode, notes — rides along in new_values so the bulk payout is still
    // traceable as one operation.
    for (const r of paid) {
        logAudit(db, 'payments', r.payment_id, 'create', null,
            { type: 'farmer_payout', date, mode, notes: notes || '', ...r }, userId);
    }
    return paid;
}

module.exports = { getFarmerOutstanding, bulkPayFarmers };
