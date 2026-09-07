/**
 * shared/excel-import.js
 * ======================
 * BS-aware Excel import engine shared by:
 *   - main.js          (Electron first-run import + in-app "Update Data from Excel")
 *   - server.js        (web first-run import + /api/excel/import upload)
 *   - import-fresh.js  (CLI: clears transactional data, full re-import)
 *   - import-excel-upsert.js (CLI: non-destructive, adds new / updates existing)
 *
 * Sources a single Dairy_Accounts_Professional.xlsx workbook:
 *   Party_Master   → parties (+ opening-balance ledger entries)
 *   Stock_Master   → products
 *   Sales_Entry    → sales + sales_items (+ sale ledger + stock movements in fresh mode)
 *   Purchase_Entry → purchases + purchase_items (+ purchase ledger + stock movements in fresh mode)
 *   Collection     → payments (customer receipts / payments)
 *   Party_Ledger   → ledger_entries (dedup against auto-generated ones)
 *   Party Email    → party emails (if present)
 *
 * Modes:
 *   'fresh'  → clears all transactional data first, then imports everything and
 *              rebuilds the stock movement ledger from opening stock + sales + purchases.
 *   'upsert' → never deletes anything; adds new records and updates existing ones by
 *              invoice/bill number (no duplicates). New parties/products are auto-created.
 *
 * All dates are stored as BS (Bikram Sambat) strings YYYY-MM-DD, matching the app.
 */

const fs = require('fs');
const XLSX = require('xlsx');

const SHEET_DATA_START_ROW = 2;

// ════════════════════════════════════════════════════════════════
// BS CALENDAR DATA (2080-2090, from renderer/js/nepali-date.js)
// ════════════════════════════════════════════════════════════════
const BS_CALENDAR_DATA = {
    2080: [30, 32, 31, 31, 30, 29, 30, 29, 30, 30, 30, 30],
    2081: [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2082: [31, 32, 32, 31, 31, 30, 29, 29, 30, 30, 29, 30],
    2083: [31, 32, 32, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2084: [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30, 29],
    2085: [31, 32, 31, 32, 31, 30, 29, 29, 30, 29, 30, 30],
    2086: [31, 32, 31, 32, 31, 30, 29, 30, 29, 30, 29, 30],
    2087: [31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 29, 30],
    2088: [31, 32, 31, 32, 31, 30, 29, 29, 30, 30, 29, 30],
    2089: [31, 32, 31, 32, 31, 30, 29, 30, 29, 30, 29, 30],
    2090: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 29],
};
const BS_MONTH_DEFAULT_DAYS = [31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 29, 30];

function getBSDaysInMonth(year, month) {
    const data = BS_CALENDAR_DATA[year];
    return data ? data[month - 1] : BS_MONTH_DEFAULT_DAYS[month - 1];
}

function pad2(n) {
    return String(n).padStart(2, '0');
}

/**
 * Convert an AD date string (YYYY-MM-DD) to BS (YYYY-MM-DD).
 * Reference: BS 2082-01-01 = AD 2025-04-14.
 */
function adToBS(adDateStr) {
    if (!adDateStr || typeof adDateStr !== 'string') return null;
    const parts = adDateStr.split('-');
    if (parts.length !== 3) return null;
    const adYear = parseInt(parts[0], 10);
    const adMonth = parseInt(parts[1], 10);
    const adDay = parseInt(parts[2], 10);
    if (isNaN(adYear) || isNaN(adMonth) || isNaN(adDay)) return null;

    const refAD = new Date(2025, 3, 14); // April 14, 2025
    const targetAD = new Date(adYear, adMonth - 1, adDay);
    const diffDays = Math.round((targetAD - refAD) / 86400000);

    let bsYear = 2082;
    let bsMonth = 1;
    let bsDay = 1;
    let remaining = diffDays;

    if (remaining >= 0) {
        while (remaining > 0) {
            const daysInMonth = getBSDaysInMonth(bsYear, bsMonth);
            const daysLeft = daysInMonth - bsDay + 1;
            if (remaining < daysLeft) {
                bsDay += remaining;
                remaining = 0;
            } else {
                remaining -= daysLeft;
                bsMonth++;
                if (bsMonth > 12) { bsYear++; bsMonth = 1; }
                bsDay = 1;
            }
        }
    } else {
        while (remaining < 0) {
            if (bsDay + remaining >= 1) {
                bsDay += remaining;
                remaining = 0;
            } else {
                remaining += (bsDay - 1);
                bsMonth--;
                if (bsMonth < 1) { bsYear--; bsMonth = 12; }
                bsDay = getBSDaysInMonth(bsYear, bsMonth);
            }
        }
    }

    return `${bsYear}-${pad2(bsMonth)}-${pad2(bsDay)}`;
}

/**
 * Convert any Excel date value to a BS date string (YYYY-MM-DD).
 *
 * Handles:
 *   - BS serial numbers (>= 60000): the workbook stores BS dates as Excel serials,
 *     e.g. 66915 → 2083-03-15. Format directly (no conversion).
 *   - AD serial numbers (< 60000): e.g. 46202 → 2026-06-29 → BS 2083-03-15.
 *   - Date objects and 'YYYY/MM/DD' text (BS or AD).
 */
function toBSDate(val) {
    if (val === null || val === undefined || val === '') return null;

    if (typeof val === 'number' && !isNaN(val)) {
        const d = new Date((val - 25569) * 86400 * 1000);
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const str = `${y}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        if (val >= 60000) return str;      // BS serial → the string IS the BS date
        return adToBS(str);                // AD serial → convert to BS
    }

    if (val instanceof Date && !isNaN(val.getTime())) {
        const y = val.getFullYear();
        const m = pad2(val.getMonth() + 1);
        const d = pad2(val.getDate());
        // Years >= 2050 are already BS dates (this workbook serializes BS dates
        // as AD-style Dates); younger years are AD dates that need conversion.
        if (y >= 2050) return `${y}-${m}-${d}`;
        return adToBS(`${y}-${m}-${d}`);
    }

    const s = String(val).trim();

    // BS date text like "2083/03/15" — already BS, normalize
    let m = s.match(/^(20[89]\d)[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (m) return `${m[1]}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`;

    // AD date text like "2026-06-29"
    m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (m) {
        const year = parseInt(m[1], 10);
        const dateStr = `${m[1]}-${pad2(parseInt(m[2], 10))}-${pad2(parseInt(m[3], 10))}`;
        if (year > 2100) return dateStr;   // likely BS already
        return adToBS(dateStr);
    }

    return null;
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════

function toNum(val) {
    if (val === null || val === undefined || val === '') return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    const n = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}

function toStr(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function normalize(str) {
    return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}

function baseName(str) {
    return normalize(str)
        .replace(/\s*\([^)]*\)/g, ' ')
        .replace(/[-–,]\s*\d+$/, '')
        .replace(/\s+\d+$/, '')
        .trim()
        .replace(/\s+/g, ' ');
}

function mapPartyType(type) {
    const t = normalize(type);
    if (t === 'customer') return 'customer';
    if (t === 'supplier') return 'supplier';
    if (t === 'both') return 'both';
    if (t === 'farmer') return 'farmer';
    return 'customer';
}

function mapPaymentMode(mode) {
    const m = normalize(mode);
    if (m === 'cash') return 'cash';
    if (m === 'credit') return 'credit';
    if (m === 'bank' || m === 'bank transfer' || m === 'bank_transfer' || m === 'online') return 'bank';
    if (m === 'upi' || m === 'qr' || m === 'qr code') return 'upi';
    if (m === 'cheque') return 'bank';
    return 'cash';
}

function mapStatus(status) {
    const s = normalize(status);
    if (s === 'paid' || s === 'payment') return 'paid';
    if (s === 'unpaid') return 'unpaid';
    if (s === 'partial') return 'partial';
    return 'paid';
}

function detectCategory(name) {
    const n = name.toLowerCase();
    if (n.includes('milk')) return 'Milk';
    if (n.includes('ghee')) return 'Ghee';
    if (n.includes('paneer') || n.includes('chena') || n.includes('chhena')) return 'Paneer';
    if (n.includes('curd') || n.includes('dahi') || n.includes('yogurt')) return 'Curd';
    if (n.includes('butter')) return 'Butter';
    if (n.includes('cream') || n.includes('malai')) return 'Cream';
    if (n.includes('khoya') || n.includes('khoa') || n.includes('mawa')) return 'Khoya';
    if (n.includes('lassi') || n.includes('buttermilk') || n.includes('chaas') || n.includes('chhach')) return 'Beverage';
    if (n.includes('ice cream')) return 'Ice Cream';
    return 'Other';
}

// ════════════════════════════════════════════════════════════════
// PARTY / PRODUCT RESOLVERS
// ════════════════════════════════════════════════════════════════

let partyIndex = null;
let productIndex = null;
let autoCreatedParties = 0;

function buildPartyIndex(db) {
    const parties = db.prepare('SELECT id, name, type FROM parties').all();
    partyIndex = { exact: {}, base: {}, keys: [] };
    for (const p of parties) {
        const n = normalize(p.name);
        partyIndex.exact[n] = p.id;
        const b = baseName(p.name);
        if (b && !partyIndex.base[b]) partyIndex.base[b] = p.id;
        partyIndex.keys.push(n);
    }
}

function resolveParty(name, db, autoCreate) {
    if (!partyIndex) return null;
    const n = normalize(name);
    if (!n) return null;
    if (/^cancel/.test(n) || n.includes('total')) return null;

    if (partyIndex.exact[n]) return partyIndex.exact[n];

    const b = baseName(name);
    if (b && b !== n && partyIndex.base[b]) return partyIndex.base[b];

    for (const k of partyIndex.keys) {
        if (k.length >= 4 && (k.includes(n) || n.includes(k))) {
            return partyIndex.exact[k];
        }
    }

    if (autoCreate) {
        let sql = `
            INSERT INTO parties (name, type, phone, address, opening_balance, notes, created_at)
            VALUES (?, 'customer', '', '', 0, 'Auto-created from Excel import', ?)
        `;
        try {
            db.prepare('PRAGMA table_info(parties)').all().some(c => c.name === 'email');
            const hasEmail = db.prepare('PRAGMA table_info(parties)').all().some(c => c.name === 'email');
            if (hasEmail) {
                sql = `
                    INSERT INTO parties (name, type, phone, email, address, opening_balance, notes, created_at)
                    VALUES (?, 'customer', '', '', '', 0, 'Auto-created from Excel import', ?)
                `;
            }
        } catch (e) { /* fall through to no-email insert */ }
        const result = db.prepare(sql).run(name, new Date().toISOString());
        const id = result.lastInsertRowid;
        partyIndex.exact[n] = id;
        if (b && !partyIndex.base[b]) partyIndex.base[b] = id;
        partyIndex.keys.push(n);
        autoCreatedParties++;
        return id;
    }

    return null;
}

function buildProductIndex(db) {
    const products = db.prepare('SELECT id, name FROM products').all();
    productIndex = {};
    for (const p of products) {
        productIndex[normalize(p.name)] = p.id;
    }
}

function resolveProduct(name, db, autoCreate) {
    if (!productIndex) return null;
    const n = normalize(name);
    if (!n) return null;
    if (productIndex[n]) return productIndex[n];

    // Never auto-create totals rows or opening-balance pseudo-products
    if (n.includes('total') || n === 'opening') return null;

    if (autoCreate) {
        const result = db.prepare(`
            INSERT INTO products (name, unit, category, notes, created_at)
            VALUES (?, 'kg', 'Other', 'Auto-created from Excel import', ?)
        `).run(name, new Date().toISOString());
        productIndex[n] = result.lastInsertRowid;
        return productIndex[n];
    }

    return null;
}

// ════════════════════════════════════════════════════════════════
// IMPORT: PARTIES
// ════════════════════════════════════════════════════════════════

function importParties(db, sheetData, opts) {
    const log = opts.log;
    log('\n  📋 Importing Parties...');

    // Older databases may lack the email column — adapt the SQL at runtime.
    const hasEmailColumn = db.prepare('PRAGMA table_info(parties)').all().some(c => c.name === 'email');

    const insertParty = hasEmailColumn
        ? db.prepare(`
            INSERT INTO parties (name, type, phone, email, address, opening_balance, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        : db.prepare(`
            INSERT INTO parties (name, type, phone, address, opening_balance, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
    const updateParty = hasEmailColumn
        ? db.prepare(`
            UPDATE parties SET
                phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                email = CASE WHEN ? != '' THEN ? ELSE email END,
                address = CASE WHEN ? != '' THEN ? ELSE address END,
                type = CASE WHEN ? != 'customer' THEN ? ELSE type END,
                opening_balance = ?,
                updated_at = ?
            WHERE id = ?
        `)
        : db.prepare(`
            UPDATE parties SET
                phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                address = CASE WHEN ? != '' THEN ? ELSE address END,
                type = CASE WHEN ? != 'customer' THEN ? ELSE type END,
                opening_balance = ?,
                updated_at = ?
            WHERE id = ?
        `);
    const findParty = db.prepare('SELECT id FROM parties WHERE name = ?');
    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'opening', '', 'Opening Balance', ?, ?, ?, ?)
    `);
    const findLedger = db.prepare(`
        SELECT id FROM ledger_entries WHERE party_id = ? AND reference_type = 'opening'
    `);

    // Col 0: Party Name, 1: Type, 2: Phone, 3: Address, 4: Opening Balance
    const nameIdx = 0, typeIdx = 1, phoneIdx = 2, addrIdx = 3, balIdx = 4;

    const headerRow = sheetData[SHEET_DATA_START_ROW - 1] || [];
    let emailIdx = -1;
    for (let h = 0; h < headerRow.length; h++) {
        if (String(headerRow[h]).trim().toLowerCase().includes('email')) {
            emailIdx = h;
            break;
        }
    }

    let inserted = 0, updated = 0, openingLedger = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[nameIdx]) continue;
            const name = toStr(row[nameIdx]);
            if (!name || normalize(name) === 'party name') continue;

            const type = mapPartyType(toStr(row[typeIdx]));
            const phone = toStr(row[phoneIdx]);
            const address = toStr(row[addrIdx]);
            const openingBal = toNum(row[balIdx]);
            const email = emailIdx >= 0 ? toStr(row[emailIdx]) : '';

            try {
                const existing = findParty.get(name);
                if (existing) {
                    if (hasEmailColumn) {
                        updateParty.run(phone, phone, email, email, address, address, type, type, openingBal, now, existing.id);
                    } else {
                        updateParty.run(phone, phone, address, address, type, type, openingBal, now, existing.id);
                    }
                    updated++;
                    // Refresh opening-balance ledger entry when balance changed
                    if (opts.mode === 'fresh') {
                        const le = findLedger.get(existing.id);
                        if (openingBal !== 0) {
                            const debit = openingBal > 0 ? openingBal : 0;
                            const credit = openingBal < 0 ? Math.abs(openingBal) : 0;
                            if (le) {
                                db.prepare('UPDATE ledger_entries SET debit = ?, credit = ?, balance = ? WHERE id = ?')
                                    .run(debit, credit, openingBal, le.id);
                            } else {
                                insertLedger.run(existing.id, '2082-01-01', debit, credit, openingBal, now);
                                openingLedger++;
                            }
                        }
                    }
                } else {
                    if (hasEmailColumn) {
                        insertParty.run(name, type, phone, email, address, openingBal, 'Imported from Excel', now);
                    } else {
                        insertParty.run(name, type, phone, address, openingBal, 'Imported from Excel', now);
                    }
                    inserted++;
                    if (opts.mode === 'fresh' && openingBal !== 0) {
                        const pid = findParty.get(name).id;
                        const debit = openingBal > 0 ? openingBal : 0;
                        const credit = openingBal < 0 ? Math.abs(openingBal) : 0;
                        insertLedger.run(pid, '2082-01-01', debit, credit, openingBal, now);
                        openingLedger++;
                    }
                }
            } catch (e) {
                /* skip row */
            }
        }
    });
    trx();

    // Backfill party codes
    db.prepare(`
        UPDATE parties SET party_code = 'P' || printf('%04d', id)
        WHERE party_code = '' OR party_code IS NULL
    `).run();

    log(`  ✅ Parties: ${inserted} inserted, ${updated} updated` + (openingLedger ? ` (${openingLedger} opening-balance ledger entries)` : ''));
    return { inserted, updated };
}

function importPartyEmails(db, sheetData, opts) {
    const log = opts.log;
    let headerIdx = -1, emailCol = -1, nameCol = -1;
    for (let r = 0; r < Math.min(3, sheetData.length); r++) {
        const row = sheetData[r] || [];
        for (let c = 0; c < row.length; c++) {
            const cell = String(row[c]).trim().toLowerCase();
            if (cell.includes('email')) { emailCol = c; break; }
        }
        if (emailCol >= 0) {
            headerIdx = r;
            nameCol = emailCol === 0 ? 1 : 0;
            break;
        }
    }

    if (headerIdx < 0 || emailCol < 0) {
        log('  ⚠️  Party Email sheet: no "Email" header column found, skipped');
        return 0;
    }

    let updateEmail;
    try {
        updateEmail = db.prepare('UPDATE parties SET email = ? WHERE id = ?');
    } catch (e) {
        log('  ⚠️  Party Email sheet: this database has no email column, skipped');
        return 0;
    }
    const findParty = db.prepare('SELECT id FROM parties WHERE name = ?');
    let applied = 0, skipped = 0;

    const trx = db.transaction(() => {
        for (let i = headerIdx + 1; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[nameCol]) continue;
            const name = toStr(row[nameCol]);
            const email = toStr(row[emailCol]);
            if (!name || !email || !email.includes('@')) { skipped++; continue; }

            const existing = findParty.get(name) || findParty.get(baseName(name));
            if (!existing) { skipped++; continue; }
            updateEmail.run(email, existing.id);
            applied++;
        }
    });
    trx();

    log(`  📧 Party Email sheet: ${applied} emails applied${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
    return applied;
}

// ════════════════════════════════════════════════════════════════
// IMPORT: PRODUCTS
// ════════════════════════════════════════════════════════════════

function importProducts(db, sheetData, opts) {
    const log = opts.log;
    log('\n  📋 Importing Products...');

    const insertProduct = db.prepare(`
        INSERT INTO products (name, unit, category, opening_stock, reorder_level, rate, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProduct = db.prepare(`
        UPDATE products SET
            unit = CASE WHEN ? != '' THEN ? ELSE unit END,
            category = CASE WHEN ? != '' THEN ? ELSE category END,
            reorder_level = CASE WHEN ? > 0 THEN ? ELSE reorder_level END,
            rate = CASE WHEN ? > 0 THEN ? ELSE rate END,
            opening_stock = ?,
            updated_at = ?
        WHERE id = ?
    `);
    const findProduct = db.prepare('SELECT id FROM products WHERE name = ?');

    // Col 0: Product Name, 1: Unit, 2: Opening Stock, 6: Reorder Level, 7: Rate
    const nameIdx = 0, unitIdx = 1, openingIdx = 2, reorderIdx = 6, rateIdx = 7;

    let inserted = 0, updated = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[nameIdx]) continue;
            const name = toStr(row[nameIdx]);
            if (!name || normalize(name) === 'product name' || normalize(name).includes('total')) continue;

            const unit = toStr(row[unitIdx]) || 'kg';
            const opening = toNum(row[openingIdx]);
            const reorder = toNum(row[reorderIdx]);
            const rate = toNum(row[rateIdx]);
            const category = detectCategory(name);

            try {
                const existing = findProduct.get(name);
                if (existing) {
                    updateProduct.run(unit, unit, category, category, reorder, reorder, rate, rate, opening, now, existing.id);
                    updated++;
                } else {
                    insertProduct.run(name, unit, category, opening, reorder, rate, 'Imported from Excel', now);
                    inserted++;
                }
            } catch (e) { /* skip */ }
        }
    });
    trx();

    log(`  ✅ Products: ${inserted} inserted, ${updated} updated`);
    return { inserted, updated };
}

// ════════════════════════════════════════════════════════════════
// IMPORT: SALES
// ════════════════════════════════════════════════════════════════

function importSales(db, sheetData, opts) {
    const log = opts.log;
    const autoCreate = opts.mode === 'upsert';
    log('\n  📋 Importing Sales...');

    const findSale = db.prepare('SELECT id FROM sales WHERE invoice_no = ?');
    const deleteSaleItems = db.prepare('DELETE FROM sales_items WHERE sale_id = ?');
    const insertSale = db.prepare(`
        INSERT INTO sales (invoice_no, date, party_id, subtotal, discount, discount_percent,
            tax, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSaleItem = db.prepare(`
        INSERT INTO sales_items (sale_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateSale = db.prepare(`
        UPDATE sales SET date=?, party_id=?, subtotal=?, discount=?, discount_percent=?,
            grand_total=?, paid_amount=?, payment_mode=?, status=?, notes=?, updated_at=?
        WHERE id=?
    `);
    // Upsert mode keeps the existing per-invoice ledger representation: new invoices
    // get one ledger entry (debit = grand_total). Fresh mode imports Party_Ledger instead.
    const insertLedger = opts.genLedger ? db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'sale', ?, ?, ?, 0, ?, ?)
    `) : null;

    // Col: 0=Date(BS serial/text), 1=AD Date, 2=InvoiceNo, 3=PartyName, 4=Product, 5=Qty,
    // 6=Rate, 7=Amount, 8=Disc%, 9=NetAmount, 10=PaymentMode, 11=Status, 12=Remarks
    const dateIdx = 0, adDateIdx = 1, invIdx = 2, partyIdx = 3, prodIdx = 4,
          qtyIdx = 5, rateIdx = 6, amtIdx = 7, discPctIdx = 8,
          netIdx = 9, modeIdx = 10, statusIdx = 11, remarkIdx = 12;

    const invoiceGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || !row[invIdx]) continue;
        const invNo = toStr(row[invIdx]);
        if (!invNo) continue;
        if (!invoiceGroups[invNo]) invoiceGroups[invNo] = [];
        invoiceGroups[invNo].push(row);
    }

    let inserted = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (const [invNo, rows] of Object.entries(invoiceGroups)) {
            const firstRow = rows[0];

            const bsDate = toBSDate(firstRow[dateIdx]) || toBSDate(firstRow[adDateIdx]) || '2082-01-01';

            const partyName = toStr(firstRow[partyIdx]);
            const partyId = resolveParty(partyName, db, autoCreate);
            if (!partyId) { skipped++; continue; }

            let subtotal = 0, totalDiscPct = 0;
            for (const row of rows) {
                subtotal += toNum(row[amtIdx]) || (toNum(row[qtyIdx]) * toNum(row[rateIdx]));
                totalDiscPct = Math.max(totalDiscPct, toNum(row[discPctIdx]));
            }

            let grandTotal;
            if (rows.length === 1) {
                grandTotal = toNum(firstRow[netIdx]) || (subtotal * (1 - totalDiscPct / 100));
            } else {
                grandTotal = rows.reduce((sum, r) => sum + toNum(r[netIdx]), 0) || (subtotal * (1 - totalDiscPct / 100));
            }

            const paymentMode = mapPaymentMode(toStr(firstRow[modeIdx]));
            const status = mapStatus(toStr(firstRow[statusIdx]));
            const remarks = toStr(firstRow[remarkIdx]);

            let paidAmount = 0;
            if (status === 'paid') paidAmount = grandTotal;
            else if (status === 'partial') paidAmount = grandTotal * 0.5;

            const existing = findSale.get(invNo);
            let saleId;
            if (existing) {
                updateSale.run(bsDate, partyId, subtotal, 0, totalDiscPct,
                    grandTotal, paidAmount, paymentMode, status, remarks, now, existing.id);
                saleId = existing.id;
                deleteSaleItems.run(saleId);
                updated++;
            } else {
                const result = insertSale.run(invNo, bsDate, partyId, subtotal, 0, totalDiscPct,
                    grandTotal, paidAmount, paymentMode, status, remarks, now, now);
                saleId = result.lastInsertRowid;
                inserted++;
                if (insertLedger) {
                    insertLedger.run(partyId, bsDate, invNo, `Sale ${invNo}${remarks ? ' - ' + remarks : ''}`.substring(0, 200), grandTotal, grandTotal, now);
                }
            }

            for (const row of rows) {
                const productName = toStr(row[prodIdx]);
                const productId = resolveProduct(productName, db, autoCreate);
                if (!productId) continue; // unknown product (e.g. OPENING rows) → skip item
                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateIdx]);
                const amount = toNum(row[amtIdx]) || (qty * rate);

                insertSaleItem.run(saleId, productId, productName, qty, 'kg', rate, amount);
            }
        }
    });
    trx();

    log(`  ✅ Sales: ${inserted} inserted, ${updated} updated (${skipped} skipped - no party)`);
    return { inserted, updated, skipped };
}

// ════════════════════════════════════════════════════════════════
// IMPORT: PURCHASES
// ════════════════════════════════════════════════════════════════

function importPurchases(db, sheetData, opts) {
    const log = opts.log;
    const autoCreate = opts.mode === 'upsert';
    log('\n  📋 Importing Purchases...');

    const findPurchase = db.prepare('SELECT id FROM purchases WHERE bill_no = ?');
    const deletePurchaseItems = db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?');
    const insertPurchase = db.prepare(`
        INSERT INTO purchases (bill_no, date, party_id, subtotal, discount, tax,
            transport_charges, extra_charges, grand_total, paid_amount, payment_mode, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertPurchaseItem = db.prepare(`
        INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updatePurchase = db.prepare(`
        UPDATE purchases SET date=?, party_id=?, subtotal=?, discount=?, tax=?,
            transport_charges=?, extra_charges=?, grand_total=?, paid_amount=?,
            payment_mode=?, status=?, notes=?, updated_at=?
        WHERE id=?
    `);
    // Upsert mode: new bills get one ledger entry (credit = grand_total).
    const insertLedger = opts.genLedger ? db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'purchase', ?, ?, 0, ?, ?, ?)
    `) : null;

    // Col: 0=Date, 1=AD Date, 2=BillNo, 3=Supplier, 4=Shift, 5=Product, 6=FAT%,
    // 7=SNF%, 8=Extra/Unit, 9=RateType, 10=FixedRate, 11=Rate/Unit, 12=Qty, 13=Amount,
    // 14=Transport, 15=NetAmount, 16=PaymentMode, 17=Status, 18=Remarks
    const dateIdx = 0, adDateIdx = 1, billIdx = 2, partyIdx = 3, prodIdx = 5,
          fatIdx = 6, snfIdx = 7, extraIdx = 8, rateTypeIdx = 9,
          fixedRateIdx = 10, rateUnitIdx = 11, qtyIdx = 12, amtIdx = 13,
          transportIdx = 14, netIdx = 15, modeIdx = 16, statusIdx = 17, remarkIdx = 18;

    const billGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || !row[billIdx]) continue;
        const billNo = toStr(row[billIdx]);
        if (!billNo) continue;
        if (!billGroups[billNo]) billGroups[billNo] = [];
        billGroups[billNo].push(row);
    }

    let inserted = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (const [billNo, rows] of Object.entries(billGroups)) {
            const firstRow = rows[0];

            const bsDate = toBSDate(firstRow[dateIdx]) || toBSDate(firstRow[adDateIdx]) || '2082-01-01';

            const supplierName = toStr(firstRow[partyIdx]);
            const partyId = resolveParty(supplierName, db, autoCreate);
            if (!partyId) { skipped++; continue; }

            let subtotal = 0, totalTransport = 0;
            for (const row of rows) {
                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateUnitIdx]) || toNum(row[fixedRateIdx]) || toNum(row[extraIdx]);
                const amount = toNum(row[amtIdx]) || (qty * rate);
                subtotal += amount;
                totalTransport += toNum(row[transportIdx]);
            }

            let grandTotal = rows.reduce((sum, r) => sum + toNum(r[netIdx]), 0);
            if (!grandTotal) grandTotal = subtotal + totalTransport;

            const paymentMode = mapPaymentMode(toStr(firstRow[modeIdx]));
            const status = mapStatus(toStr(firstRow[statusIdx]));
            const remarks = toStr(firstRow[remarkIdx]);

            let paidAmount = 0;
            if (status === 'paid') paidAmount = grandTotal;
            else if (status === 'partial') paidAmount = grandTotal * 0.5;

            const existing = findPurchase.get(billNo);
            let purchaseId;
            if (existing) {
                updatePurchase.run(bsDate, partyId, subtotal, 0, 0,
                    totalTransport, 0, grandTotal, paidAmount,
                    paymentMode, status, remarks, now, existing.id);
                purchaseId = existing.id;
                deletePurchaseItems.run(purchaseId);
                updated++;
            } else {
                const result = insertPurchase.run(billNo, bsDate, partyId, subtotal, 0, 0,
                    totalTransport, 0, grandTotal, paidAmount,
                    paymentMode, status, remarks, now, now);
                purchaseId = result.lastInsertRowid;
                inserted++;
                if (insertLedger) {
                    insertLedger.run(partyId, bsDate, billNo, `Purchase ${billNo}${remarks ? ' - ' + remarks : ''}`.substring(0, 200), grandTotal, -grandTotal, now);
                }
            }

            for (const row of rows) {
                const productName = toStr(row[prodIdx]);
                const productId = resolveProduct(productName, db, autoCreate);
                if (!productId) continue; // unknown product (e.g. OPENING/DISSEL rows) → skip item
                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateUnitIdx]) || toNum(row[fixedRateIdx]) || toNum(row[extraIdx]);
                const amount = toNum(row[amtIdx]) || (qty * rate);

                insertPurchaseItem.run(purchaseId, productId, productName, qty, 'liter', rate, amount);
            }
        }
    });
    trx();

    log(`  ✅ Purchases: ${inserted} inserted, ${updated} updated (${skipped} skipped - no party)`);
    return { inserted, updated, skipped };
}

// ════════════════════════════════════════════════════════════════
// IMPORT: COLLECTIONS (payments)
// ════════════════════════════════════════════════════════════════

function importCollections(db, sheetData, opts) {
    const log = opts.log;
    const autoCreate = opts.mode === 'upsert';
    log('\n  📋 Importing Collections...');

    const findPayment = db.prepare(`
        SELECT id FROM payments WHERE party_id = ? AND date = ? AND type = ? AND ABS(amount - ?) < 0.01
    `);
    const insertPayment = db.prepare(`
        INSERT INTO payments (party_id, date, type, amount, mode, reference_type, reference_id, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Upsert mode: new payments get a matching payment_received ledger entry.
    const insertLedger = opts.genLedger ? db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, 'payment_received', ?, 'Payment received', 0, ?, ?, ?)
    `) : null;

    // Col: 0=Date, 1=AD Date, 2=Receipt No, 3=Customer, 4=Against Bill, 5=Type,
    // 6=Opening Due, 7=Collected, 8=Paid, 9=Mode, 10=Closing Due, 11=Remarks
    const dateIdx = 0, adDateIdx = 1, recIdx = 2, custIdx = 3, billIdx = 4, typeIdx = 5,
          collectedIdx = 7, paidIdx = 8, modeIdx = 9, remarkIdx = 11;

    let inserted = 0, skippedDup = 0, skipped = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[custIdx]) continue;
            const customerName = toStr(row[custIdx]);
            const rowType = normalize(toStr(row[typeIdx]));
            if (rowType === '0' || rowType === 'total' || normalize(customerName).includes('total')) continue;

            const partyId = resolveParty(customerName, db, autoCreate);
            if (!partyId) { skipped++; continue; }

            const bsDate = toBSDate(row[dateIdx]) || toBSDate(row[adDateIdx]) || '2082-01-01';

            let payType = 'receipt';
            let amount = toNum(row[collectedIdx]);
            if (rowType === 'payment' || rowType === 'advance' || rowType.includes('petty')) {
                payType = 'payment';
                amount = toNum(row[paidIdx]);
            }
            if (amount <= 0) {
                const alt = (payType === 'receipt') ? toNum(row[paidIdx]) : toNum(row[collectedIdx]);
                if (alt > 0) amount = alt;
                else continue;
            }

            const receiptNo = toNum(row[recIdx]) > 0 ? String(toNum(row[recIdx])) : '';
            const againstBill = toStr(row[billIdx]);
            const mode = mapPaymentMode(toStr(row[modeIdx]));
            const remarks = `${againstBill ? 'Against: ' + againstBill + ' | ' : ''}${toStr(row[remarkIdx])}`;

            const existing = findPayment.get(partyId, bsDate, payType, amount);
            if (existing) { skippedDup++; continue; }

            insertPayment.run(partyId, bsDate, payType, amount, mode,
                receiptNo || againstBill, receiptNo || againstBill, remarks, now);
            inserted++;
            if (insertLedger) {
                insertLedger.run(partyId, bsDate,
                    receiptNo || againstBill || String(inserted), amount, -amount, now);
            }
        }
    });
    trx();

    log(`  ✅ Collections: ${inserted} inserted (${skippedDup} duplicates skipped${skipped ? `, ${skipped} no party` : ''})`);
    return { inserted, skippedDup };
}

// ════════════════════════════════════════════════════════════════
// IMPORT: PARTY LEDGER
// ════════════════════════════════════════════════════════════════

function importPartyLedger(db, sheetData, opts) {
    const log = opts.log;
    const autoCreate = opts.mode === 'upsert';
    // Fresh mode imports EVERY row (the sheet is line-level — multiple rows per
    // invoice). Dedup is only needed in upsert mode to avoid re-inserting rows
    // that were already imported on a previous run.
    const dedup = opts.mode === 'upsert';
    log('\n  📋 Importing Party Ledger...');

    const checkExisting = db.prepare(`
        SELECT id FROM ledger_entries WHERE party_id = ? AND date = ? AND reference_type = ? AND reference_id = ?
    `);
    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Col: 0=Date, 1=AD Date, 2=PartyName, 3=TxnType, 4=Reference, 5=Description,
    // 6=Debit, 7=Credit, 8=Balance, 9=Remarks
    const dateIdx = 0, adDateIdx = 1, partyIdx = 2, txnIdx = 3, refIdx = 4, descIdx = 5,
          debitIdx = 6, creditIdx = 7, balIdx = 8;

    let inserted = 0, skippedDup = 0, skipped = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
            const row = sheetData[i];
            if (!row || !row[partyIdx]) continue;

            const partyName = toStr(row[partyIdx]);
            const partyId = resolveParty(partyName, db, autoCreate);
            if (!partyId) { skipped++; continue; }

            const bsDate = toBSDate(row[dateIdx]) || toBSDate(row[adDateIdx]) || '2082-01-01';
            const txnType = toStr(row[txnIdx]).toLowerCase();
            // Skip totals / void (cancelled) rows that carry no amounts
            if (txnType === '0' || txnType === 'total') continue;
            const ref = toStr(row[refIdx]);
            const desc = toStr(row[descIdx]);
            const debit = toNum(row[debitIdx]);
            const credit = toNum(row[creditIdx]);
            const balance = toNum(row[balIdx]);

            let refType = 'adjustment';
            if (txnType.includes('sale')) refType = 'sale';
            else if (txnType.includes('purchase')) refType = 'purchase';
            else if (txnType.includes('collection') || txnType.includes('receipt') || txnType.includes('payment')
                     || txnType.includes('advance') || txnType.includes('petty') || txnType.includes('bank')) refType = 'payment_received';
            else if (txnType.includes('opening')) refType = 'opening';

            if (dedup) {
                const existing = checkExisting.get(partyId, bsDate, refType, ref);
                if (existing) { skippedDup++; continue; }
            }

            insertLedger.run(partyId, bsDate, refType, ref || null, desc || 'Ledger entry',
                debit, credit, balance, now);
            inserted++;
        }
    });
    trx();

    log(`  ✅ Ledger: ${inserted} inserted (${skippedDup} duplicates skipped${skipped ? `, ${skipped} no party` : ''})`);
    return { inserted, skippedDup };
}

// ════════════════════════════════════════════════════════════════
// STOCK LEDGER REBUILD (fresh mode only)
// ════════════════════════════════════════════════════════════════

/**
 * Rebuild the stock movement ledger from opening stock + purchases + sales,
 * with correct running balances, sorted by BS date.
 */
function rebuildStockLedger(db, log) {
    log('\n  📦 Rebuilding stock ledger (opening + purchases + sales)...');

    const products = db.prepare('SELECT id, name, opening_stock FROM products').all();
    const movements = [];

    for (const p of products) {
        if (toNum(p.opening_stock) > 0) {
            movements.push({
                product_id: p.id,
                date: '2082-01-01',
                type: 'opening',
                inward: toNum(p.opening_stock),
                outward: 0,
                rate: 0,
                notes: 'Opening Stock from Excel',
                ref_type: null,
                ref_id: null
            });
        }
    }

    const purchases = db.prepare(`
        SELECT pi.product_id, p.date, pi.quantity, pi.rate, p.bill_no, p.id AS purchase_id
        FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    `).all();
    for (const it of purchases) {
        if (toNum(it.quantity) <= 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'purchase',
            inward: toNum(it.quantity),
            outward: 0,
            rate: toNum(it.rate),
            notes: 'Purchase ' + it.bill_no,
            ref_type: 'purchase',
            ref_id: it.purchase_id
        });
    }

    const sales = db.prepare(`
        SELECT si.product_id, s.date, si.quantity, si.rate, s.invoice_no, s.id AS sale_id
        FROM sales_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id IS NOT NULL
    `).all();
    for (const it of sales) {
        if (toNum(it.quantity) <= 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'sale',
            inward: 0,
            outward: toNum(it.quantity),
            rate: toNum(it.rate),
            notes: 'Sale ' + it.invoice_no,
            ref_type: 'sale',
            ref_id: it.sale_id
        });
    }

    // Order per product: BS date (string compare works for YYYY-MM-DD), then opening first
    movements.sort((a, b) => {
        if (a.product_id !== b.product_id) return a.product_id - b.product_id;
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.type === 'opening') return -1;
        if (b.type === 'opening') return 1;
        return 0;
    });

    const insertStock = db.prepare(`
        INSERT INTO stock_movements (product_id, date, type, inward_qty, outward_qty,
            balance_after, rate, notes, reference_type, reference_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const balances = {};
    const trx = db.transaction(() => {
        for (const m of movements) {
            const bal = (balances[m.product_id] || 0) + m.inward - m.outward;
            balances[m.product_id] = bal;
            insertStock.run(m.product_id, m.date, m.type, m.inward, m.outward, bal, m.rate,
                m.notes, m.ref_type, m.ref_id, new Date().toISOString());
        }
    });
    trx();

    log(`  ✅ Stock ledger rebuilt with ${movements.length} movements`);
    return movements.length;
}

// ════════════════════════════════════════════════════════════════
// MAIN ENTRY
// ════════════════════════════════════════════════════════════════

const TRANSACTIONAL_TABLES = [
    'ledger_entries', 'stock_movements', 'sales_items', 'sales',
    'purchase_items', 'purchases', 'payments', 'milk_collections',
    'petty_cash', 'salary_records', 'vehicle_expenses', 'other_expenses',
    'cash_deposits', 'denomination_counts', 'partner_capital',
    'production_batches', 'production_inputs', 'production_outputs',
    'audit_log'
];

/**
 * Import an Excel workbook into the given database.
 *
 * @param {object} db       better-sqlite3 connection (schema already applied)
 * @param {string} excelPath  Path to Dairy_Accounts_Professional.xlsx
 * @param {object} opts
 *   @param {'fresh'|'upsert'} opts.mode
 *   @param {function} [opts.log]  log callback (defaults to console.log)
 * @returns {object} summary of inserted/updated counts
 */
function runExcelImport(db, excelPath, opts = {}) {
    const mode = opts.mode || 'fresh';
    const log = opts.log || ((msg) => console.log(msg));

    log('');
    log(`  🐄  Prarambha — Excel Import (${mode === 'fresh' ? 'fresh - clears & re-imports transactional data' : 'upsert - adds new / updates existing, no deletions'})`);
    log('  ═══════════════════════════════════════════════════════');

    if (!fs.existsSync(excelPath)) {
        throw new Error(`Excel file not found: ${excelPath}`);
    }

    log('  📂 Loading workbook...');
    // NOTE: no cellDates — this workbook stores BS dates as raw serial numbers
    // (>= 60000) and AD dates as serials (< 60000). Keeping them as numbers makes
    // the conversion deterministic (no timezone shifts from Date objects).
    const workbook = XLSX.readFile(excelPath);
    log(`  ✅ Found ${workbook.SheetNames.length} sheets`);

    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    if (mode === 'fresh') {
        log('\n  🗑️  Clearing existing transactional data...');
        db.transaction(() => {
            for (const t of TRANSACTIONAL_TABLES) {
                try { db.prepare(`DELETE FROM ${t}`).run(); } catch (e) { /* table may not exist */ }
            }
            db.prepare('UPDATE parties SET opening_balance = 0').run();
            db.prepare('UPDATE products SET opening_stock = 0').run();
        })();
        log('  ✅ Transactional data cleared');
    }

    buildPartyIndex(db);
    buildProductIndex(db);
    autoCreatedParties = 0;

    const results = { mode };
    const sheet = (name) => {
        if (!workbook.SheetNames.includes(name)) return null;
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
        return data.length > 1 ? data : null;
    };

    // 1. Parties
    const partySheet = sheet('Party_Master');
    if (partySheet) {
        results.parties = importParties(db, partySheet, { mode, log });
        buildPartyIndex(db);
    }

    // 1.5 Party emails
    const emailSheet = sheet('Party Email');
    if (emailSheet) {
        results.partyEmails = importPartyEmails(db, emailSheet, { mode, log });
    }

    // 2. Products
    const productSheet = sheet('Stock_Master');
    if (productSheet) {
        results.products = importProducts(db, productSheet, { mode, log });
        buildProductIndex(db);
    }

    // Upsert keeps the existing ledger representation (one entry per invoice/payment,
    // as created by the app itself), so newly inserted sales/purchases/payments generate
    // matching ledger entries. Fresh mode imports the Excel's own Party_Ledger sheet.
    const genLedger = mode === 'upsert';

    // 3. Sales
    const salesSheet = sheet('Sales_Entry');
    if (salesSheet && salesSheet.length > 2) {
        results.sales = importSales(db, salesSheet, { mode, log, genLedger });
    }

    // 4. Purchases
    const purchaseSheet = sheet('Purchase_Entry');
    if (purchaseSheet && purchaseSheet.length > 2) {
        results.purchases = importPurchases(db, purchaseSheet, { mode, log, genLedger });
    }

    // 5. Collections → payments
    const collSheetName = workbook.SheetNames.includes('Collection') ? 'Collection'
        : workbook.SheetNames.includes('Cash_Collection') ? 'Cash_Collection' : null;
    if (collSheetName) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[collSheetName], { header: 1, defval: '' });
        if (data.length > 2) {
            results.collections = importCollections(db, data, { mode, log, genLedger });
        }
    }

    // 6. Party ledger (fresh mode only — line-level sheet is incompatible with the
    //    per-invoice ledger entries the app maintains)
    if (mode === 'fresh') {
        const ledgerSheet = sheet('Party_Ledger');
        if (ledgerSheet && ledgerSheet.length > 2) {
            results.ledger = importPartyLedger(db, ledgerSheet, { mode, log });
        }
    }

    // Fresh mode: rebuild the stock ledger with correct running balances
    if (mode === 'fresh') {
        results.stockMovements = rebuildStockLedger(db, log);
    }

    // Summary
    log('\n  ═══════════════════════════════════════════════════════');
    log('  📊 IMPORT SUMMARY');
    log('');
    const tables = ['parties', 'products', 'sales', 'sales_items', 'purchases',
        'purchase_items', 'payments', 'ledger_entries', 'stock_movements'];
    results.tableCounts = {};
    for (const t of tables) {
        try {
            const c = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c;
            results.tableCounts[t] = c;
            log(`  ${t.padEnd(20)}: ${c}`);
        } catch (e) {
            log(`  ${t.padEnd(20)}: error - ${e.message}`);
        }
    }
    if (autoCreatedParties > 0) {
        log(`\n  ⚠️  ${autoCreatedParties} new party(ies) auto-created`);
    }
    log('\n  ✅ Import complete!');
    log('');

    return results;
}

/**
 * CLI entry — opens its own database connection.
 * Used by import-fresh.js / import-excel-upsert.js.
 */
function importExcelFile({ excelPath, dbPath, mode, log }) {
    const Database = require('better-sqlite3');
    const path = require('path');
    const db = new Database(dbPath);
    try {
        return runExcelImport(db, excelPath, { mode, log });
    } finally {
        db.close();
    }
}

module.exports = {
    runExcelImport,
    importExcelFile,
    adToBS,
    toBSDate,
    TRANSACTIONAL_TABLES
};