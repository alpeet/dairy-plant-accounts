/**
 * Godhuli Dairy Plant — Production / Batch Processing Operations
 * ================================================================
 * CRUD for production batches with stock updates:
 * - Consumes raw milk stock (stock_movements: production_input)
 * - Creates finished goods stock (stock_movements: production_output)
 * - Tracks yield and wastage
 */

const { logAudit } = require('./audit');

/**
 * List production batches with filters.
 */
function listProductionBatches(db, { from_date, to_date, process_type, search } = {}) {
    let query = `SELECT pb.*, u.username as created_by_name
                 FROM production_batches pb LEFT JOIN users u ON pb.created_by = u.id WHERE 1=1`;
    const params = [];
    if (from_date) { query += " AND pb.date >= ?"; params.push(from_date); }
    if (to_date) { query += " AND pb.date <= ?"; params.push(to_date); }
    if (process_type) { query += " AND pb.process_type = ?"; params.push(process_type); }
    if (search) { query += " AND (pb.batch_no LIKE ? OR pb.operator_name LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
    query += " ORDER BY pb.date DESC, pb.id DESC";
    return db.prepare(query).all(...params);
}

/**
 * Get a single production batch with all inputs and outputs.
 */
function getProductionBatch(db, id) {
    const batch = db.prepare("SELECT * FROM production_batches WHERE id = ?").get(id);
    if (!batch) return null;
    const inputs = db.prepare("SELECT * FROM production_inputs WHERE batch_id = ?").all(id);
    const outputs = db.prepare("SELECT * FROM production_outputs WHERE batch_id = ?").all(id);
    return { ...batch, inputs, outputs };
}

/**
 * Save a production batch (create or update).
 * Updates stock movements: consumes raw materials, produces finished goods.
 */
function saveProductionBatch(db, data) {
    const trx = db.transaction(() => {
        const { id, batch_no, date, shift, process_type, inputs, outputs,
                operator_name, wastage_quantity, wastage_reason, remarks } = data;

        if (id) {
            // Capture old state for audit
            const oldBatch = db.prepare("SELECT * FROM production_batches WHERE id = ?").get(id);

            // Revert old stock movements
            const oldInputs = db.prepare("SELECT * FROM production_inputs WHERE batch_id = ?").all(id);
            const oldOutputs = db.prepare("SELECT * FROM production_outputs WHERE batch_id = ?").all(id);

            // Reverse old inputs (add back to stock)
            for (const inp of oldInputs) {
                const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(inp.product_id);
                const cb = lb ? lb.balance_after : 0;
                db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_output', ?, 0, ?, ?, 'Reversal of batch input #' || ?, 'production', ?)")
                    .run(inp.product_id, date, inp.quantity, cb + inp.quantity, inp.rate, batch_no, id);
            }

            // Reverse old outputs (remove from stock)
            for (const out of oldOutputs) {
                const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(out.product_id);
                const cb = lb ? lb.balance_after : 0;
                db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_input', 0, ?, ?, ?, 'Reversal of batch output #' || ?, 'production', ?)")
                    .run(out.product_id, date, out.quantity, cb - out.quantity, out.rate, batch_no, id);
            }

            // Delete old inputs/outputs
            db.prepare("DELETE FROM production_inputs WHERE batch_id = ?").run(id);
            db.prepare("DELETE FROM production_outputs WHERE batch_id = ?").run(id);

            // Update batch
            db.prepare(`
                UPDATE production_batches SET batch_no=?, date=?, shift=?, process_type=?,
                    input_quantity=?, output_quantity=?, actual_yield_percent=?,
                    wastage_quantity=?, wastage_reason=?, operator_name=?, remarks=?,
                    updated_at=datetime('now','localtime')
                WHERE id=?
            `).run(batch_no, date, shift || 'morning', process_type,
                  inputs.reduce((s, i) => s + parseFloat(i.quantity || 0), 0),
                  outputs.reduce((s, o) => s + parseFloat(o.quantity || 0), 0),
                  outputs.reduce((s, o) => s + parseFloat(o.quantity || 0), 0) / (inputs.reduce((s, i) => s + parseFloat(i.quantity || 0), 0) || 1) * 100,
                  wastage_quantity || 0, wastage_reason || '', operator_name || '', remarks || '', id);
        } else {
            const totalInput = inputs.reduce((s, i) => s + parseFloat(i.quantity || 0), 0);
            const totalOutput = outputs.reduce((s, o) => s + parseFloat(o.quantity || 0), 0);
            const yieldPct = totalInput > 0 ? (totalOutput / totalInput) * 100 : 0;

            const result = db.prepare(`
                INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity, output_quantity, 
                    standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(batch_no, date, shift || 'morning', process_type, totalInput, totalOutput,
                  0, yieldPct, wastage_quantity || 0, wastage_reason || '', operator_name || '', remarks || '', data.created_by || null);
            
            id = result.lastInsertRowid;
        }

        logAudit(db, 'production_batches', id, id === data.id ? 'update' : 'create', id === data.id ? { ...oldBatch, inputs: oldInputs, outputs: oldOutputs } : null, data, data.created_by);

        // Insert new inputs with stock deduction
        for (const inp of inputs) {
            db.prepare("INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .run(id, inp.product_id, inp.product_name || inp.name, inp.quantity, inp.unit || 'liter', inp.rate || 0, (inp.quantity || 0) * (inp.rate || 0));

            const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(inp.product_id);
            const cb = lb ? lb.balance_after : 0;
            const nb = cb - parseFloat(inp.quantity || 0);
            db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_input', 0, ?, ?, ?, 'Production input: ' || ?, 'production', ?)")
                .run(inp.product_id, date, inp.quantity, nb, inp.rate || 0, batch_no, id);
        }

        // Insert new outputs with stock addition
        for (const out of outputs) {
            db.prepare("INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?)")
                .run(id, out.product_id, out.product_name || out.name, out.quantity, out.unit || 'kg', out.rate || 0, (out.quantity || 0) * (out.rate || 0));

            const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(out.product_id);
            const cb = lb ? lb.balance_after : 0;
            const nb = cb + parseFloat(out.quantity || 0);
            db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_output', ?, 0, ?, ?, 'Production output: ' || ?, 'production', ?)")
                .run(out.product_id, date, out.quantity, nb, out.rate || 0, batch_no, id);
        }

        logAudit(db, 'production_batches', id, id === data.id ? 'update' : 'create', id === data.id ? { ...oldBatch, inputs: oldInputs, outputs: oldOutputs } : null, data, data.created_by);
        return { id };
    });
    return trx();
}

/**
 * Delete a production batch with stock reversal.
 */
function deleteProductionBatch(db, id, changedBy = null) {
    const trx = db.transaction(() => {
        const batch = db.prepare("SELECT * FROM production_batches WHERE id = ?").get(id);
        if (!batch) throw new Error('Batch not found');

        const inputs = db.prepare("SELECT * FROM production_inputs WHERE batch_id = ?").all(id);
        const outputs = db.prepare("SELECT * FROM production_outputs WHERE batch_id = ?").all(id);

        // Reverse inputs (add back to stock)
        for (const inp of inputs) {
            const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(inp.product_id);
            const cb = lb ? lb.balance_after : 0;
            db.prepare("INSERT INTO stock_movements (product_id, date, type, inward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_output', ?, ?, ?, 'Deleted batch input #' || ?, 'production', ?)")
                .run(inp.product_id, batch.date, inp.quantity, cb + inp.quantity, inp.rate, batch.batch_no, id);
        }

        // Reverse outputs (remove from stock)
        for (const out of outputs) {
            const lb = db.prepare("SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1").get(out.product_id);
            const cb = lb ? lb.balance_after : 0;
            db.prepare("INSERT INTO stock_movements (product_id, date, type, outward_qty, balance_after, rate, notes, reference_type, reference_id) VALUES (?, ?, 'production_input', ?, ?, ?, 'Deleted batch output #' || ?, 'production', ?)")
                .run(out.product_id, batch.date, out.quantity, cb - out.quantity, out.rate, batch.batch_no, id);
        }

        db.prepare("DELETE FROM production_inputs WHERE batch_id = ?").run(id);
        db.prepare("DELETE FROM production_outputs WHERE batch_id = ?").run(id);
        db.prepare("DELETE FROM production_batches WHERE id = ?").run(id);
        logAudit(db, 'production_batches', id, 'delete', batch, null, changedBy);
        return { deleted: true };
    });
    return trx();
}

/**
 * Get process types list (distinct).
 */
function getProcessTypes(db) {
    return db.prepare("SELECT DISTINCT process_type FROM production_batches WHERE process_type != '' ORDER BY process_type").all();
}

module.exports = { listProductionBatches, getProductionBatch, saveProductionBatch, deleteProductionBatch, getProcessTypes };
