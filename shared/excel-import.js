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
// Names that must never be fuzzy-matched onto a different party (see resolveParty).
const exactOnlyPartyNames = new Set();

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

function resolveParty(name, db, autoCreate, typeHint) {
    if (!partyIndex) return null;
    const n = normalize(name);
    if (!n) return null;
    if (/^cancel/.test(n) || n.includes('total')) return null;

    if (partyIndex.exact[n]) return partyIndex.exact[n];

    const b = baseName(name);
    if (b && b !== n && partyIndex.base[b]) return partyIndex.base[b];

    // Some names must resolve to their own account and never be fuzzy-matched onto
    // another party ("LOCAL DAMAGE" must not become the counter-sales party "LOCAL").
    if (!exactOnlyPartyNames.has(n)) {
        for (const k of partyIndex.keys) {
            if (k.length >= 4 && (k.includes(n) || n.includes(k))) {
                return partyIndex.exact[k];
            }
        }
    }

    if (autoCreate) {
        const partyType = ['customer', 'supplier', 'both', 'farmer', 'partner'].includes(typeHint) ? typeHint : 'customer';
        let sql = `
            INSERT INTO parties (name, type, phone, address, opening_balance, notes, created_at)
            VALUES (?, '${partyType}', '', '', 0, 'Auto-created from Excel import', ?)
        `;
        try {
            const hasEmail = db.prepare('PRAGMA table_info(parties)').all().some(c => c.name === 'email');
            if (hasEmail) {
                sql = `
                    INSERT INTO parties (name, type, phone, email, address, opening_balance, notes, created_at)
                    VALUES (?, '${partyType}', '', '', '', 0, 'Auto-created from Excel import', ?)
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

// ------------------------------------------------
// MILK CLASSIFICATION (Purchase_Entry -> milk_collections)
// Most Purchase_Entry lines in this workbook are milk bought from
// suppliers; they belong in the Milk Collection module, not generic
// purchases. classifyMilkLine() recognises them from the product name.
// ------------------------------------------------
const MILK_TYPE_BY_PATTERN = [
    [/\bbuffal/i, 'buffalo'],
    [/\bcow\b/i, 'cow'],
];

/**
 * Decide whether a purchase line is raw milk (goes to Milk Collection) and
 * of which type. Returns null for non-milk lines (packaging, Ghee, PANEER,
 * DISSEL...). 'cow' wins over 'mixed' ("Cow Milk" is a real SKU here);
 * /milk/ without cow/buffalo ("Mix Milk", "Milk") is mixed.
 */
function classifyMilkLine(productName) {
    const n = normalize(productName);
    if (!n || !/\bmilks?\b/.test(n)) return null;
    if (/powder/.test(n)) return null; // SMP is not raw milk
    for (const [re, type] of MILK_TYPE_BY_PATTERN) {
        if (re.test(n)) return type;
    }
    return 'mixed';
}

function resolveProduct(name, db, autoCreate) {
    if (!productIndex) return null;
    const n = normalize(name);
    if (!n) return null;
    if (productIndex[n]) return productIndex[n];

    // Never auto-create totals rows or opening-balance pseudo-products
    if (n.includes('total') || n === 'opening') return null;

    // Unambiguous base-name match before creating a duplicate: an Excel line named
    // "SMP" must reuse the existing "SMP (Skimmed Milk Powder)", not create a second
    // item. Only applied when exactly one existing product reduces to the same base.
    const base = baseName(name);
    if (base) {
        const hits = Object.keys(productIndex).filter((k) => k !== n && baseName(k) === base);
        if (hits.length === 1) {
            productIndex[n] = productIndex[hits[0]];
            return productIndex[n];
        }
    }

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
                    const newPartyId = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
                    partyNormIndex[normalize(name)] = newPartyId;
                    if (opts.mode === 'fresh' && openingBal !== 0) {
                        const pid = newPartyId;
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
    // Fresh and upsert imports both auto-create missing parties (context-aware
    // type via resolveParty's typeHint). Requirement: no transaction is ever
    // dropped because its party row is missing.
    const autoCreate = true;
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

    // Rows WITHOUT an invoice number are the workbook's internal issues: milk written
    // off as "LOCAL DAMAGE" (valued 0) and cream drawn by "FACTORY PRODUCTION"
    // (valued at the rate). Dropping them silently loses 379 L of milk and 128 kg of
    // cream, so each date+party gets a deterministic internal document number.
    let internalSeq = 0;
    const orphanGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row) continue;
        if (toStr(row[invIdx])) continue;
        const party = toStr(row[partyIdx]);
        const product = toStr(row[prodIdx]);
        const qty = toNum(row[qtyIdx]);
        const amount = toNum(row[amtIdx]) || toNum(row[netIdx]);
        if (!party || !product || (!qty && !amount)) continue;  // blank template rows
        const bsDate = toBSDate(row[dateIdx]) || toBSDate(row[adDateIdx]) || '2082-01-01';
        const key = `${bsDate}|${normalize(party)}`;
        exactOnlyPartyNames.add(normalize(party));
        if (!orphanGroups[key]) orphanGroups[key] = { bsDate, party, rows: [] };
        orphanGroups[key].rows.push(row);
    }
    for (const g of Object.values(orphanGroups)) {
        const invNo = `INT-${g.bsDate.replace(/-/g, '')}-${String(++internalSeq).padStart(2, '0')}`;
        // The workbook leaves the remarks cell empty (a numeric 0) on these rows;
        // stamp the internal-issue marker so the register shows where it came from.
        const marker = /damage|wastage/i.test(g.party)
            ? `Internal issue from Excel (no invoice) — ${g.party} / wastage`
            : `Internal issue from Excel (no invoice) — ${g.party}`;
        g.rows[0] = [...g.rows[0]];
        g.rows[0][remarkIdx] = marker;
        invoiceGroups[invNo] = g.rows;
    }

    let inserted = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();

    const trx = db.transaction(() => {
        for (const [invNo, rows] of Object.entries(invoiceGroups)) {
            const firstRow = rows[0];

            const bsDate = toBSDate(firstRow[dateIdx]) || toBSDate(firstRow[adDateIdx]) || '2082-01-01';

            const partyName = toStr(firstRow[partyIdx]);
            const partyId = resolveParty(partyName, db, autoCreate, 'both');
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
    // Fresh and upsert imports both auto-create missing parties (context-aware
    // type via resolveParty's typeHint). Requirement: no transaction is ever
    // dropped because its party row is missing.
    const autoCreate = true;
    log('\n  📋 Importing Purchases...');

    const findPurchase = db.prepare('SELECT id FROM purchases WHERE bill_no = ? AND date = ?');
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
    // Milk lines are recorded as milk collections linked back to their bill
    // (purchase_ref_id) so the Milk Collection module and the purchase money
    // stay two views of the same transactions.
    const milkSeqStart = db.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(collection_no, 8) AS INTEGER)), 0) m FROM milk_collections WHERE collection_no LIKE 'MC-IMP-%'"
    ).get().m;
    const insertMilkCollection = db.prepare(`
        INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters,
            fat_percent, snf_percent, rate, amount, shift, status, notes, purchase_ref_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteMilkByRef = db.prepare('DELETE FROM milk_collections WHERE purchase_ref_id = ?');
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
    const dateIdx = 0, adDateIdx = 1, billIdx = 2, partyIdx = 3, shiftIdx = 4, prodIdx = 5,
          fatIdx = 6, snfIdx = 7, extraIdx = 8, rateTypeIdx = 9,
          fixedRateIdx = 10, rateUnitIdx = 11, qtyIdx = 12, amtIdx = 13,
          transportIdx = 14, netIdx = 15, modeIdx = 16, statusIdx = 17, remarkIdx = 18;

    const billGroups = {};
    for (let i = SHEET_DATA_START_ROW; i < sheetData.length; i++) {
        const row = sheetData[i];
        if (!row || !row[billIdx]) continue;
        const billNo = toStr(row[billIdx]);
        if (!billNo) continue;
        // Key on bill number + BS date: the same bill number recurs on
        // different dates in Purchase_Entry (e.g. BILL-5129 on 2083/04/01 and
        // 2083/06/01) and must not collapse into one bill — the old bill-only
        // key silently dropped 62 milk lines worth Rs 119,903.
        const rowDate = toBSDate(row[dateIdx]) || toBSDate(row[adDateIdx]) || '2082-01-01';
        const groupKey = billNo + '||' + rowDate;
        if (!billGroups[groupKey]) billGroups[groupKey] = [];
        billGroups[groupKey].push(row);
    }

    let inserted = 0, updated = 0, skipped = 0;
    const now = new Date().toISOString();
    let milkSeq = milkSeqStart;

    const trx = db.transaction(() => {
        for (const [groupKey, rows] of Object.entries(billGroups)) {
            const firstRow = rows[0];
            const billNo = toStr(firstRow[billIdx]);

            const bsDate = toBSDate(firstRow[dateIdx]) || toBSDate(firstRow[adDateIdx]) || '2082-01-01';

            const supplierName = toStr(firstRow[partyIdx]);
            const partyId = resolveParty(supplierName, db, autoCreate, 'supplier');
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

            const existing = findPurchase.get(billNo, bsDate);
            let purchaseId;
            if (existing) {
                updatePurchase.run(bsDate, partyId, subtotal, 0, 0,
                    totalTransport, 0, grandTotal, paidAmount,
                    paymentMode, status, remarks, now, existing.id);
                purchaseId = existing.id;
                deletePurchaseItems.run(purchaseId);
                deleteMilkByRef.run(purchaseId);
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
                const qty = toNum(row[qtyIdx]);
                const rate = toNum(row[rateUnitIdx]) || toNum(row[fixedRateIdx]) || toNum(row[extraIdx]);
                const amount = toNum(row[amtIdx]) || (qty * rate);

                // Milk lines belong to the Milk Collection module (supplier, type,
                // date, quantity, rate, amount) — not generic purchases.
                const milkType = classifyMilkLine(productName);
                if (milkType && qty !== 0) {
                    milkSeq += 1;
                    const shift = String(row[shiftIdx] || '').toLowerCase().includes('even') ? 'evening' : 'morning';
                    const milkStatus = mapStatus(toStr(row[statusIdx])) === 'paid' ? 'paid' : 'pending';
                    insertMilkCollection.run(
                        'MC-IMP-' + String(milkSeq).padStart(4, '0'),
                        bsDate, partyId, milkType, qty,
                        toNum(row[fatIdx]), toNum(row[snfIdx]),
                        rate, amount, shift, milkStatus,
                        ('Milk purchase - bill ' + billNo + (remarks ? ' - ' + remarks : '')).substring(0, 190),
                        purchaseId
                    );
                    continue;
                }

                const productId = resolveProduct(productName, db, autoCreate);
                if (!productId) continue; // unknown product (e.g. OPENING/DISSEL rows) → skip item

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
    // Fresh and upsert imports both auto-create missing parties (context-aware
    // type via resolveParty's typeHint). Requirement: no transaction is ever
    // dropped because its party row is missing.
    const autoCreate = true;
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

            const partyId = resolveParty(customerName, db, autoCreate, 'customer');
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
    // Fresh and upsert imports both auto-create missing parties (context-aware
    // type via resolveParty's typeHint). Requirement: no transaction is ever
    // dropped because its party row is missing.
    const autoCreate = true;
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
            const partyId = resolveParty(partyName, db, autoCreate, 'customer');
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
// ------------------------------------------------
// MILK -> COLLECTIONS BACKFILL (used by the live-DB migration; the fresh
// import path creates collections directly in importPurchases instead).
// Turns milk lines inside purchase_items into milk_collections rows linked
// to their bill via purchase_ref_id, and removes those lines from
// purchase_items. Money never changes: the purchase header/ledger keep the
// bill totals, so supplier liability stays exactly what was posted before.
// ------------------------------------------------
function resolveMilkProduct(db, milkType) {
    const target = milkType === 'cow' ? 'cow milk'
        : milkType === 'buffalo' ? 'buffalo milk' : 'mix milk';
    const all = db.prepare('SELECT id, name FROM products').all();
    let hit = all.find(p => normalize(p.name) === target);
    if (!hit && milkType !== 'mixed') {
        // fall back to Mix Milk for typed milk if the typed product is missing
        hit = all.find(p => normalize(p.name) === 'mix milk');
    }
    if (!hit) hit = all.find(p => /\bmilk\b/.test(normalize(p.name)) && !/powder/.test(normalize(p.name)));
    return hit ? { id: hit.id, name: hit.name } : null;
}

function backfillMilkCollectionsFromPurchases(db, log) {
    const milkLines = db.prepare(`
        SELECT pi.id, pi.purchase_id, pi.product_name, pi.quantity, pi.rate, pi.amount,
               p.date, p.party_id, p.bill_no, p.status
        FROM purchase_items pi JOIN purchases p ON p.id = pi.purchase_id
    `).all();
    const rows = [];
    for (const it of milkLines) {
        const milkType = classifyMilkLine(it.product_name);
        if (milkType && toNum(it.quantity) !== 0) rows.push({ ...it, milkType });
    }
    if (rows.length === 0) { log('  🥛 Milk collections: no unclassified milk lines found'); return { created: 0 }; }

    const delItem = db.prepare('DELETE FROM purchase_items WHERE id = ?');
    const seqStart = db.prepare(
        "SELECT COALESCE(MAX(CAST(SUBSTR(collection_no, 8) AS INTEGER)), 0) m FROM milk_collections WHERE collection_no LIKE 'MC-IMP-%'"
    ).get().m;
    const insert = db.prepare(`
        INSERT INTO milk_collections (collection_no, date, party_id, milk_type, quantity_liters,
            fat_percent, snf_percent, rate, amount, shift, status, notes, purchase_ref_id)
        VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, 'morning', ?, ?, ?)
    `);

    let seq = seqStart, created = 0;
    const trx = db.transaction(() => {
        for (const r of rows) {
            seq += 1;
            insert.run(
                'MC-IMP-' + String(seq).padStart(4, '0'),
                r.date, r.party_id, r.milkType, toNum(r.quantity),
                toNum(r.rate), toNum(r.amount),
                r.status === 'paid' ? 'paid' : 'pending',
                ('Milk purchase - bill ' + r.bill_no).substring(0, 190),
                r.purchase_id
            );
            delItem.run(r.id);
            created++;
        }
    });
    trx();
    log(`  🥛 Milk collections: ${created} milk purchase lines moved from Purchases to Milk Collection`);
    return { created };
}

// ------------------------------------------------
// PRODUCTION DERIVATION
// The workbook records no production rows, yet its own Stock_Master shows
// finished goods (Ghee, NAUNI, PANEER) sold beyond recorded stock-in, and
// Cow/Buffalo milk converted into Mix Milk. Deriving those batches is what
// stops the mixing/processing from looking like negative stock. Every batch
// is flagged PRD-DRV and documented; nothing outside the recorded figures is
// invented — mixing uses the exact collected quantities, and finished-goods
// batches cover exactly the recorded shortfall (sales beyond stock-in).
// ------------------------------------------------
function deriveProductionBatches(db, log) {
    // Idempotent: previous derivation batches (and their lines) are replaced.
    db.prepare(`DELETE FROM production_outputs WHERE batch_id IN (SELECT id FROM production_batches WHERE batch_no LIKE 'PRD-DRV-%')`).run();
    db.prepare(`DELETE FROM production_inputs WHERE batch_id IN (SELECT id FROM production_batches WHERE batch_no LIKE 'PRD-DRV-%')`).run();
    db.prepare(`DELETE FROM production_batches WHERE batch_no LIKE 'PRD-DRV-%'`).run();

    const findProduct = (target) => {
        const all = db.prepare('SELECT id, name FROM products').all();
        const hit = all.find(p => normalize(p.name) === normalize(target));
        return hit || null;
    };

    const insertBatch = db.prepare(`
        INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity, output_quantity,
            standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, '', 'migration', ?)
    `);
    const insertInput = db.prepare(`
        INSERT INTO production_inputs (batch_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertOutput = db.prepare(`
        INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const lastId = () => db.prepare('SELECT last_insert_rowid() AS id').get().id;

    let mixBatches = 0, gapBatches = 0;
    const trx = db.transaction(() => {
        // ── 1. Mixing: Cow + Buffalo collected on a day become Mix Milk ──
        const byDate = db.prepare(`
            SELECT date, milk_type, SUM(quantity_liters) qty
            FROM milk_collections WHERE quantity_liters > 0
            GROUP BY date, milk_type ORDER BY date
        `).all();
        const mixProduct = findProduct('Mix Milk');
        const cowProduct = findProduct('Cow Milk');
        const bufProduct = findProduct('Buffalo Milk');
        const dayTotals = {};
        for (const r of byDate) {
            if (!dayTotals[r.date]) dayTotals[r.date] = { cow: 0, buffalo: 0 };
            if (r.milk_type === 'cow' && cowProduct) dayTotals[r.date].cow += r.qty;
            else if (r.milk_type === 'buffalo' && bufProduct) dayTotals[r.date].buffalo += r.qty;
            // mixed-type collections already ARE Mix Milk — they flow straight
            // into Mix Milk stock and need no conversion.
        }
        for (const [date, t] of Object.entries(dayTotals)) {
            const inQty = t.cow + t.buffalo;
            if (inQty <= 0 || !mixProduct) continue;
            insertBatch.run(
                'PRD-DRV-MIX-' + date, date, 'morning', 'mixing',
                inQty, inQty, 100,
                'Derived from Excel: cow + buffalo milk collected this day combined into Mix Milk for processing'
            );
            const bid = lastId();
            for (const [prod, qty] of [[cowProduct, t.cow], [bufProduct, t.buffalo]]) {
                if (qty > 0) insertInput.run(bid, prod.id, prod.name, qty, 'liter', 0, 0);
            }
            insertOutput.run(bid, mixProduct.id, mixProduct.name, inQty, 'liter', 0, 0);
            mixBatches++;
        }

        // ── 2. Finished-goods / residual shortfall is derived AFTER the stock
        // ledger rebuild — see deriveShortfallBatches(). It needs the replayed
        // movements, which only exist once rebuildStockLedger has run.
    });
    trx();
    log(`  🏭 Production: ${mixBatches} mixing batch(es) derived (cow+buffalo → Mix Milk)`);
    return { mixBatches, gapBatches };
}

// ------------------------------------------------
// SHORTFALL BATCHES (run AFTER rebuildStockLedger)
// Any product whose replayed balance still goes negative gets a derived
// production batch dated at the first shortfall, covering EXACTLY that
// shortfall — never inventing quantities beyond what the books already sold.
// The remark documents the gap (the workbook's own Stock_Statement shows the
// same negatives) so nothing is silently absorbed.
// ------------------------------------------------
function deriveShortfallBatches(db, log) {
    db.prepare(`DELETE FROM production_outputs WHERE batch_id IN (SELECT id FROM production_batches WHERE batch_no LIKE 'PRD-DRV-FG-%')`).run();
    db.prepare(`DELETE FROM production_inputs WHERE batch_id IN (SELECT id FROM production_batches WHERE batch_no LIKE 'PRD-DRV-FG-%')`).run();
    db.prepare(`DELETE FROM production_batches WHERE batch_no LIKE 'PRD-DRV-FG-%'`).run();

    const insertBatch = db.prepare(`
        INSERT INTO production_batches (batch_no, date, shift, process_type, input_quantity, output_quantity,
            standard_yield_percent, actual_yield_percent, wastage_quantity, wastage_reason, operator_name, remarks)
        VALUES (?, ?, 'morning', 'production', 0, ?, 0, 0, 0, '', 'migration', ?)
    `);
    const insertOutput = db.prepare(`
        INSERT INTO production_outputs (batch_id, product_id, product_name, quantity, unit, rate, amount)
        VALUES (?, ?, ?, ?, 'kg', 0, 0)
    `);
    const lastId = () => db.prepare('SELECT last_insert_rowid() AS id').get().id;

    const products = db.prepare(`
        SELECT DISTINCT sm.product_id, p.name, COALESCE(p.opening_stock, 0) opening
        FROM stock_movements sm JOIN products p ON p.id = sm.product_id
    `).all();

    let created = 0;
    const trx = db.transaction(() => {
        for (const prod of products) {
            const moves = db.prepare(`
                SELECT date, SUM(inward_qty) inw, SUM(outward_qty) outw
                FROM stock_movements WHERE product_id = ?
                GROUP BY date ORDER BY date
            `).all(prod.product_id);
            // Replay fully to find the deepest cumulative deficit and the first
            // dip. One derived batch per product covers the whole gap — smaller
            // batches would still leave the later dips negative.
            let bal = prod.opening || 0;
            let minBal = 0, firstDipDate = null;
            for (const m of moves) {
                bal += (m.inw || 0) - (m.outw || 0);
                if (bal < minBal) minBal = bal;
                if (bal < -0.001 && !firstDipDate) firstDipDate = m.date;
            }
            if (minBal < -0.001 && firstDipDate) {
                const shortfall = -minBal;
                insertBatch.run(
                    'PRD-DRV-FG-' + prod.product_id, firstDipDate, shortfall,
                    ('Derived from Excel: recorded sales exceed recorded stock-in; deepest cumulative gap is ' + shortfall +
                     ' units. The workbook records no production rows for this product — this batch covers exactly that documented shortfall (Excel Stock_Statement shows the same negative)')
                );
                const bid = lastId();
                insertOutput.run(bid, prod.product_id, prod.name, shortfall);
                created++;
            }
        }
    });
    trx();
    if (created) log(`  🏭 Shortfall: ${created} documented shortfall batch(es) derived to cover sales beyond recorded stock-in`);
    return { created };
}

function rebuildStockLedger(db, log) {
    log('\n  📦 Rebuilding stock ledger (opening + purchases + milk + production + sales)...');

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
    // A negative quantity is a return entered on the entry sheet (the customer records
    // a sales return as a negative sale, a purchase return as a negative purchase).
    // Skipping those lines silently breaks stock, so the sign decides the direction:
    // it must never be dropped.
    for (const it of purchases) {
        const qty = toNum(it.quantity);
        if (qty === 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'purchase',
            inward: qty > 0 ? qty : 0,
            outward: qty < 0 ? -qty : 0,
            rate: toNum(it.rate),
            notes: (qty < 0 ? 'Purchase return ' : 'Purchase ') + it.bill_no,
            ref_type: 'purchase',
            ref_id: it.purchase_id
        });
    }

    // Milk collections are raw-milk stock-in (the milk module's own movement type)
    const milkCols = db.prepare(`
        SELECT mc.id, mc.date, mc.quantity_liters, mc.milk_type, mc.rate
        FROM milk_collections mc WHERE mc.quantity_liters > 0
    `).all();
    for (const mc of milkCols) {
        const prod = resolveMilkProduct(db, mc.milk_type);
        if (!prod) continue;
        movements.push({
            product_id: prod.id,
            date: mc.date,
            type: 'milk_collection',
            inward: toNum(mc.quantity_liters),
            outward: 0,
            rate: toNum(mc.rate),
            notes: 'Milk collection ' + (mc.id || ''),
            ref_type: 'milk_collection',
            ref_id: mc.id
        });
    }

    // Production: inputs consume stock, outputs create finished-goods stock
    const prodInputs = db.prepare(`
        SELECT pi.batch_id, pi.product_id, pi.quantity, b.date, b.batch_no
        FROM production_inputs pi JOIN production_batches b ON b.id = pi.batch_id
    `).all();
    for (const it of prodInputs) {
        const qty = toNum(it.quantity);
        if (qty === 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'production_input',
            inward: 0,
            outward: qty,
            rate: 0,
            notes: 'Production input ' + it.batch_no,
            ref_type: 'production',
            ref_id: it.batch_id
        });
    }
    const prodOutputs = db.prepare(`
        SELECT po.batch_id, po.product_id, po.quantity, b.date, b.batch_no
        FROM production_outputs po JOIN production_batches b ON b.id = po.batch_id
    `).all();
    for (const it of prodOutputs) {
        const qty = toNum(it.quantity);
        if (qty === 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'production_output',
            inward: qty,
            outward: 0,
            rate: 0,
            notes: 'Production output ' + it.batch_no,
            ref_type: 'production',
            ref_id: it.batch_id
        });
    }

    const sales = db.prepare(`
        SELECT si.product_id, s.date, si.quantity, si.rate, s.invoice_no, s.id AS sale_id
        FROM sales_items si JOIN sales s ON s.id = si.sale_id
        WHERE si.product_id IS NOT NULL
    `).all();
    for (const it of sales) {
        const qty = toNum(it.quantity);
        if (qty === 0) continue;
        movements.push({
            product_id: it.product_id,
            date: it.date,
            type: 'sale',
            inward: qty < 0 ? -qty : 0,
            outward: qty > 0 ? qty : 0,
            rate: toNum(it.rate),
            notes: (qty < 0 ? 'Sales return ' : 'Sale ') + it.invoice_no,
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
        // Idempotent: a rebuild replaces the derived ledger entirely — running
        // it twice must never double the movements.
        db.prepare('DELETE FROM stock_movements').run();
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

// PETTY CASH / BANK RECON / CASH DENOMINATION sheets
// (field mappings proven in scripts/audit/import-*.js)
// ════════════════════════════════════════════════════════════════

/**
 * PETTY CASH register sheet → petty_cash (+ advance postings to ledger).
 * Cols: 0 Date, [1 AD], 2 Receipt No, 3 Customer, 4 Against Bill, 5 Description,
 *       6 Type, 7 Opening Due, 8 Collected, 9 Paid, 10 Mode, 11 Closing, 12 Remarks
 * - "Payment" rows → petty_cash expense entries.
 * - "Advance" rows → petty_cash entry + 'advance' payment + ledger debit for the
 *   matched party (deduped against advances already in the ledger — the
 *   Salary Advance sheet and Party_Ledger record some of the same advances).
 * - "Collection" rows → skipped: they duplicate the Collection sheet, which
 *   already produced payments/ledger entries.
 */
function importPettyCashSheet(db, data, { log, mode }) {
    const report = { payment: 0, advance: 0, advance_ledger: 0, collection_skipped: 0, unmatched: [], skipped_dup: 0 };
    // Fresh mode: the workbook's Party_Ledger sheet is the party-balance source
    // of truth and already carries every advance (entered at recap dates, e.g.
    // "ADVANCE BY LILA SIR" on 2083-05-24). The PETTY CASH register's daily
    // rows are the same advances seen from the cash box — posting them again
    // double-counts (NAR BAHADUR RANA -47,828 became -116,228). Register the
    // cash movement, but post the party ledger only in upsert mode, where the
    // Party_Ledger sheet is not imported.
    const postAdvanceLedger = mode !== 'fresh';
    const insertPC = db.prepare(`
        INSERT INTO petty_cash (voucher_no, date, expense_head, description, amount, paid_to, payment_mode, remarks, approved_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
    `);
    const insertPay = db.prepare(`
        INSERT INTO payments (party_id, date, type, amount, mode, reference_type, notes, created_by)
        VALUES (?, ?, 'advance', ?, ?, ?, ?, NULL)
    `);
    const insertLedger = db.prepare(`
        INSERT INTO ledger_entries (party_id, date, reference_type, reference_id, description, debit, credit, balance)
        VALUES (?, ?, 'advance', ?, ?, ?, 0, 0)
    `);
    let seq = db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(voucher_no, 4) AS INTEGER)), 0) m FROM petty_cash WHERE voucher_no LIKE 'PC-%'").get().m;

    // Dedup key includes the description: several genuinely different expenses can
    // share a date, amount and payee (e.g. "AUTO FARE 700" vs "IRON ROD TRANSPORT 700").
    const existingPC = new Set(db.prepare('SELECT date, amount, paid_to, expense_head, description FROM petty_cash').all()
        .map(r => `${r.date}|${Math.round(r.amount * 100)}|${(r.paid_to || '').trim().toLowerCase()}|${(r.expense_head || '').trim().toLowerCase()}|${(r.description || '').trim().toLowerCase()}`));
    const existingAdv = new Set(db.prepare('SELECT date, party_id, debit FROM ledger_entries WHERE debit > 0').all()
        .map(r => `${r.date}|${r.party_id}|${Math.round(r.debit * 100)}`));

    for (let i = 2; i < data.length; i++) {
        const r = data[i];
        if (!r) continue;
        const date = toBSDate(r[0]);
        if (!date) continue; // blank tail rows and the TOTAL row
        const type = toStr(r[6]);
        const customer = toStr(r[3]);
        if (/^cancel/i.test(type) || /^cancel/i.test(customer)) continue;

        const receiptNo = toStr(r[2]);
        const desc = toStr(r[5]);
        const paid = toNum(r[9]);
        const modeRaw = toStr(r[10]).toLowerCase();
        const payMode = modeRaw.includes('bank') ? 'bank' : modeRaw.includes('upi') ? 'upi' : 'cash';

        if (type === 'Collection') { report.collection_skipped++; continue; }

        if (type === 'Payment' && paid > 0) {
            const key = `${date}|${Math.round(paid * 100)}|${customer.toLowerCase()}|payment|${desc.toLowerCase()}`;
            if (existingPC.has(key)) { report.skipped_dup++; continue; }
            seq++;
            insertPC.run(receiptNo || `PC-${String(seq).padStart(4, '0')}`, date, 'Payment', desc, paid, customer, payMode, '');
            existingPC.add(key);
            report.payment++;
        } else if (type === 'Advance' && paid > 0) {
            const pid = resolveParty(customer, db, false);
            const pcKey = `${date}|${Math.round(paid * 100)}|${customer.toLowerCase()}|advance|${(desc || 'advance paid').toLowerCase()}`;
            seq++;
            if (!existingPC.has(pcKey)) {
                insertPC.run(receiptNo || `PC-${String(seq).padStart(4, '0')}`, date, 'Advance', desc || 'Advance paid', paid, customer, payMode, '');
                existingPC.add(pcKey);
                report.advance++;
            }
            if (!pid) { report.unmatched.push(`${date} | ${customer} | ${paid} | ${desc}`); continue; }
            const advKey = `${date}|${pid}|${Math.round(paid * 100)}`;
            if (postAdvanceLedger && existingAdv.has(advKey)) { report.skipped_dup++; continue; }
            const info = insertPay.run(pid, date, paid, payMode, receiptNo || '', `Advance: ${desc || customer}`);
            if (postAdvanceLedger) {
                insertLedger.run(pid, date, info.lastInsertRowid, `Advance: ${desc || customer}`, paid);
                existingAdv.add(advKey);
                report.advance_ledger++;
            }
        }
    }

    log(`  💰 Petty cash: ${report.payment} payments, ${report.advance} advances registered` +
        (report.advance_ledger ? `, ${report.advance_ledger} advance postings to ledgers` : '') +
        (report.collection_skipped ? `, ${report.collection_skipped} collection rows skipped (duplicates)` : '') +
        (report.unmatched.length ? `, ⚠️ ${report.unmatched.length} advances without a party match` : ''));
    return report;
}

/**
 * BANK RECON sheet → bank_transactions (with party auto-match + ledger posting
 * via the idempotent importBankRows operation).
 * Header at row index 2, data from 3. Cols: 0 Txn Date, [1 AD], 2 Transaction ID,
 * 3 Counterparty, 4 Description, [5 Party ID], 6 Debit, 7 Credit, [8 Amount],
 * 9 Payment Mode, 10 Bank Account, 11 Transaction Type.
 */
function importBankReconSheet(db, data, { log }) {
    const bank = require('./operations/bank');
    const rows = [];
    let undated = 0;
    for (let i = 3; i < data.length; i++) {
        const r = data[i];
        if (!r) continue;
        const date = toBSDate(r[0]);
        const counterparty = toStr(r[3]);
        const desc = toStr(r[4]);
        if (!date) { if (counterparty || desc) undated++; continue; }
        rows.push({
            date,
            reference_no: toStr(r[2]),
            counterparty_name: counterparty,
            description: desc,
            debit: toNum(r[6]),
            credit: toNum(r[7]),
            payment_mode: toStr(r[9]) || 'QR/Bank',
            bank_account: toStr(r[10]) || 'Sushil QR',
            txn_type: toStr(r[11])
        });
    }
    const report = bank.importBankRows(db, rows);
    if (undated) report.undated = undated;
    log(`  🏦 Bank: ${report.inserted} transactions imported` +
        (report.auto_posted ? `, ${report.auto_posted} auto-posted to ledgers` : '') +
        (report.already_in_ledger ? `, ${report.already_in_ledger} already reflected` : '') +
        (report.review_queue ? `, ⚠️ ${report.review_queue} need review` : '') +
        (report.skipped_dup ? `, ${report.skipped_dup} duplicates skipped` : ''));
    return report;
}

/**
 * Cash_Demon sheet → denomination_counts (physical cash counts, with the
 * app's own daily cash-in as expected value; every difference is kept, not hidden).
 * Header at row index 2, data from 3. Cols: 0 Date, [1 AD], 2-10 = 1000/500/100/50/20/10/5/2/1,
 * 11 IC (unvalued coinage → note_other), 12 Amount, 13 Collections, 14 Short/(Over),
 * 15 Deposited, [16 blank], 17 Remarks (who counted).
 */
function importCashDemonSheet(db, data, { log }) {
    const { getDailyCashCollection } = require('./operations/cash');
    const existing = new Set(db.prepare('SELECT date FROM denomination_counts').all().map(r => r.date));
    const insert = db.prepare(`
        INSERT INTO denomination_counts
            (date, note_1000, note_500, note_100, note_50, note_20, note_10, note_5,
             note_other, note_other_value, coin_5, coin_2, coin_1, total_cash,
             expected_cash, difference, remarks, counted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const report = { imported: 0, skipped_dup: 0, skipped_empty: 0, discrepancies: 0, undated: 0 };

    for (let i = 3; i < data.length; i++) {
        const r = data[i];
        if (!r) continue;
        const date = toBSDate(r[0]);
        if (!date) { if (r.some(x => toStr(x) !== '')) report.undated++; continue; }

        const n1000 = parseInt(r[2]) || 0, n500 = parseInt(r[3]) || 0, n100 = parseInt(r[4]) || 0,
            n50 = parseInt(r[5]) || 0, n20 = parseInt(r[6]) || 0, n10 = parseInt(r[7]) || 0,
            n5 = parseInt(r[8]) || 0, n2 = parseInt(r[9]) || 0, n1 = parseInt(r[10]) || 0,
            ic = parseInt(r[11]) || 0;
        const total = n1000 * 1000 + n500 * 500 + n100 * 100 + n50 * 50 + n20 * 20 + n10 * 10 + n5 * 5 + n2 * 2 + n1 * 1;
        const countedBy = toStr(r[17]);

        // The sheet pre-fills one row per day to the end of the fiscal year. A day
        // whose cash was never counted has no denominations at all — importing it
        // would create a phantom day-close record showing a huge short/(over)
        // (its 'Collections (auto)' cell still holds a formula result).
        if (!(n1000 || n500 || n100 || n50 || n20 || n10 || n5 || n2 || n1 || ic)) {
            report.skipped_empty = (report.skipped_empty || 0) + 1;
            continue;
        }
        if (existing.has(date)) { report.skipped_dup++; continue; }

        // App's own calculated daily cash-in for this date
        let expected = 0;
        try {
            const cash = getDailyCashCollection(db, { from_date: date, to_date: date });
            const day = (cash.days || []).find(d => d.date === date);
            expected = day ? (day.total_cash_in || 0) : 0;
        } catch (e) { /* cash data may be empty */ }

        const difference = Math.round((total - expected) * 100) / 100;
        const sheetShort = toNum(r[14]);
        const remarks = sheetShort !== 0 ? `Excel short/(over): ${sheetShort}` : '';

        insert.run(date, n1000, n500, n100, n50, n20, n10, n5, ic, 0, 0, n2, n1,
            total, expected, difference, remarks, countedBy);
        existing.add(date);
        report.imported++;
        if (difference !== 0) report.discrepancies++;
    }
    log(`  🧾 Cash denominations: ${report.imported} daily counts imported, `
        + `${report.skipped_empty} empty template rows skipped` +
        (report.discrepancies ? `, ${report.discrepancies} with short/(over) flagged for review` : ''));
    return report;
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
/**
 * Seed business settings from the workbook's Settings sheet — fill-blank only.
 * A fresh install starts with an empty settings table; the company details
 * (name, PAN, contact, email) should come across with the business data so the
 * app is usable immediately. Anything already set in the app is never touched,
 * and [bracketed] placeholder values in the sheet are skipped.
 */
function importSettingsFromWorkbook(db, workbook, log) {
    const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'settings');
    if (!sheetName) return;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '' });
    const get = (label) => {
        for (const r of rows) {
            if (String(r[0] ?? '').trim().startsWith(label)) {
                const v = String(r[1] ?? '').trim();
                return /^\[.*\]$/.test(v) ? '' : v; // skip [placeholder] cells
            }
        }
        return '';
    };
    const pan = get('PAN / VAT No:');
    const map = {
        business_name: get('Business Name:'),
        business_address: [get('Address Line 1:'), get('Address Line 2:')].filter(Boolean).join(', '),
        business_phone: get('Phone:'),
        business_email: get('Email:'),
        business_pan: pan,
        business_pan_vat: pan,
    };
    const setStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    const lookup = db.prepare('SELECT value FROM settings WHERE key = ?');
    // The schema pre-seeds a generic placeholder name; treat it as "not set"
    // so the real company name from the workbook can take its place.
    const GENERIC_DEFAULTS = new Set(['Prarambha Account & Stock Management']);
    let seeded = 0;
    db.transaction(() => {
        for (const [key, value] of Object.entries(map)) {
            if (!value) continue;
            const existing = lookup.get(key);
            const cur = existing ? String(existing.value ?? '').trim() : '';
            if (cur !== '' && !GENERIC_DEFAULTS.has(cur)) continue;
            setStmt.run(key, value);
            seeded++;
        }
    })();
    if (seeded) log(`  ⚙️  Seeded ${seeded} company setting(s) from the Settings sheet (filled blanks only).`);
}

// ------------------------------------------------
// SALARY ADVANCE sheet -> persistent salary_records + employees master.
// SALARY PAYMENT rows become salary records (deduped by voucher no);
// advance rows are skipped here — they are already posted through the
// PETTY CASH advance import (verified in the live ledger).
// ------------------------------------------------
function ensureEmployeesTable(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT DEFAULT '',
        name TEXT NOT NULL,
        position TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        monthly_salary REAL DEFAULT 0.0,
        active INTEGER DEFAULT 1,
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);
}

const REQUIRED_EMPLOYEES = [
    ['EMP-001', 'Dipak Nepal', 'Plant Operator'],
    ['EMP-002', 'Sawaswati Rayamajhi', 'Staff'],
    ['EMP-003', 'Nar Bahadur Rana', 'Driver'],
];

function ensureRequiredEmployees(db) {
    ensureEmployeesTable(db);
    const ins = db.prepare(`INSERT INTO employees (code, name, position, notes) VALUES (?, ?, ?, 'Seeded from Excel employee records')`);
    for (const [code, name, position] of REQUIRED_EMPLOYEES) {
        const hit = db.prepare('SELECT id FROM employees WHERE LOWER(name) = LOWER(?)').get(name);
        if (!hit) ins.run(code, name, position);
    }
}

function importSalaryAdvanceSheet(db, data, { log }) {
    ensureRequiredEmployees(db);
    // Cols: 0 Date, 1 AD, 2 Voucher, 3 EmpID, 4 Name, 5 Dept, 6 Description,
    //       7 Advance, 8 SALARY PAYMENT, 9 Balance, 10 Mode, 11 Approved, 12 Remarks
    const findEmp = (rawName, empId, dept) => {
        let name = String(rawName || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const emp = db.prepare('SELECT id FROM employees WHERE LOWER(name) = LOWER(?)').get(name);
        if (emp) return emp.id;
        const ins = db.prepare(`INSERT INTO employees (code, name, position, notes) VALUES (?, ?, ?, 'Imported from Salary Advance sheet')`);
        const code = String(empId || '').trim() || ('EMP-' + String(Date.now()).slice(-6));
        ins.run(code, name || ('Employee ' + code), String(dept || '').trim());
        return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    };
    const existing = new Set(
        db.prepare("SELECT voucher_no FROM salary_records WHERE voucher_no IS NOT NULL AND voucher_no != ''").all().map(r => r.voucher_no)
    );
    const insert = db.prepare(`
        INSERT INTO salary_records (employee_id, employee_name, position, month, basic_salary, net_salary, payment_date, payment_mode, remarks, voucher_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const monthOf = (bsDate) => String(bsDate || '').substring(0, 7);
    const report = { imported: 0, skipped_dup: 0, undated: 0 };

    for (let i = 3; i < data.length; i++) {
        const r = data[i];
        if (!r) continue;
        const date = toBSDate(r[0]);
        const voucher = toStr(r[2]);
        const salaryPaid = toNum(r[8]);
        if (!date || !voucher) { if (r.some(x => toStr(x) !== '')) report.undated++; continue; }
        if (salaryPaid <= 0) continue;      // advance row → already imported via PETTY CASH
        if (existing.has(voucher)) { report.skipped_dup++; continue; }

        const empName = toStr(r[4]);
        const empId = findEmp(empName, r[3], r[5]);
        const empRow = db.prepare('SELECT name, position FROM employees WHERE id = ?').get(empId);
        insert.run(
            empId, empRow ? empRow.name : empName, empRow ? empRow.position : '',
            monthOf(date), salaryPaid, salaryPaid, date,
            (toStr(r[10]) || 'CASH').toLowerCase(), toStr(r[12]) || voucher, voucher
        );
        existing.add(voucher);
        report.imported++;
    }
    log(`  💰 Salary: ${report.imported} salary payment(s) imported as persistent salary_records` +
        (report.skipped_dup ? `, ${report.skipped_dup} duplicates skipped` : ''));
    return report;
}

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

    // Seed company settings (name, PAN, contact…) from the Settings sheet —
    // fill-blank only, so values already set in the app always win.
    importSettingsFromWorkbook(db, workbook, log);

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

    // Fresh mode: derive mixing/production batches from the imported data,
    // rebuild the stock ledger, then derive documented shortfall batches for
    // anything still negative and rebuild once more with them included.
    if (mode === 'fresh') {
        results.production = deriveProductionBatches(db, log);
        results.stockMovements = rebuildStockLedger(db, log);
        const short = deriveShortfallBatches(db, log);
        results.shortfallBatches = short.created;
        if (short.created > 0) {
            results.stockMovements = rebuildStockLedger(db, log);
        }
    }

    // 7. Petty cash register (payments + advances with ledger postings)
    const pettySheetName = workbook.SheetNames.includes('PETTY CASH') ? 'PETTY CASH' : null;
    if (pettySheetName) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[pettySheetName], { header: 1, defval: '' });
        if (data.length > 3) {
            results.pettyCash = importPettyCashSheet(db, data, { mode, log });
        }
    }

    // 8. Bank transactions (QR/bank statement rows with auto-match)
    const bankSheetName = workbook.SheetNames.includes('BANK RECON') ? 'BANK RECON' : null;
    if (bankSheetName) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[bankSheetName], { header: 1, defval: '' });
        if (data.length > 4) {
            results.bank = importBankReconSheet(db, data, { mode, log });
        }
    }

    // 9. Physical cash denomination counts
    const demonSheetName = workbook.SheetNames.includes('Cash_Demon') ? 'Cash_Demon' : null;
    if (demonSheetName) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[demonSheetName], { header: 1, defval: '' });
        if (data.length > 4) {
            results.cashDemon = importCashDemonSheet(db, data, { mode, log });
        }
    }

    // 10. Salary Advance sheet → persistent salary records (+ employees master)
    const salarySheetName = workbook.SheetNames.includes('Salary Advance') ? 'Salary Advance' : null;
    if (salarySheetName) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[salarySheetName], { header: 1, defval: '' });
        if (data.length > 4) {
            results.salary = importSalaryAdvanceSheet(db, data, { mode, log });
        }
    }

    // Summary
    log('\n  ═══════════════════════════════════════════════════════');
    log('  📊 IMPORT SUMMARY');
    log('');
    const tables = ['parties', 'products', 'sales', 'sales_items', 'purchases',
        'purchase_items', 'payments', 'ledger_entries', 'stock_movements',
        'petty_cash', 'bank_transactions', 'denomination_counts'];
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
    rebuildStockLedger,
    deriveShortfallBatches,
    backfillMilkCollectionsFromPurchases,
    deriveProductionBatches,
    ensureRequiredEmployees,
    importSalaryAdvanceSheet,
    adToBS,
    toBSDate,
    TRANSACTIONAL_TABLES
};