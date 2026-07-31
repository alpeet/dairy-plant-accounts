#!/usr/bin/env node
/**
 * Prarambha Account & Stock Management — Import Payments from CSV
 * ================================================
 * Reads excelfiles/payments_sample.csv and imports all receipt records
 * into the payments table with corresponding ledger entries.
 *
 * Handles:
 *   - Party NAME resolution → party_id lookup
 *   - Fuzzy matching for close name variations
 *   - BS date normalization (/ → -)
 *   - Comma-separated amounts
 *
 * Usage:
 *   node import-payments-csv.js
 */

const fs = require('fs');
const path = require('path');
const { openDatabase } = require('./shared/db');
const { savePayment } = require('./shared/operations/payments');

// ── Config ──
const CSV_PATH = path.join(__dirname, 'excelfiles /payments_sample.csv');
const DB_PATH = path.join(__dirname, 'data', 'dairy-plant.db');

// ── Normalization ──

function normalize(str) {
    return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Escape a regex special characters.
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Calculate simple similarity ratio (0-1) between two strings.
 */
function similarity(a, b) {
    const longer = a.length >= b.length ? a : b;
    const shorter = a.length < b.length ? a : b;
    if (longer.length === 0) return 1.0;
    
    // Count matching consecutive characters
    let matches = 0;
    for (let i = 0; i < shorter.length; i++) {
        if (longer.includes(shorter[i])) {
            matches++;
        }
    }
    return matches / longer.length;
}

/**
 * Parse CSV line into array of values, handling quoted fields.
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
 * Parse amount, removing commas and other non-numeric chars (except . and -).
 */
function parseAmount(val) {
    if (!val) return 0;
    const cleaned = val.replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
}

/**
 * Find best matching party ID from a normalized name.
 * Uses exact match first, then tries partial/fuzzy match.
 */
function findPartyId(parties, name) {
    const normalized = normalize(name);
    
    // 1. Exact match on normalized name
    for (const p of parties) {
        if (normalize(p.name) === normalized) {
            return p.id;
        }
    }
    
    // 2. Check if CSV name contains DB name or vice versa
    for (const p of parties) {
        const pNorm = normalize(p.name);
        if (normalized.includes(pNorm) || pNorm.includes(normalized)) {
            return p.id;
        }
    }
    
    // 3. Fuzzy match: check if most words match
    const nameWords = new Set(normalized.split(/\s+/));
    for (const p of parties) {
        const pWords = normalize(p.name).split(/\s+/);
        const pWordSet = new Set(pWords);
        let matchCount = 0;
        for (const w of nameWords) {
            if (w.length > 1 && pWordSet.has(w)) matchCount++;
        }
        const commonWords = matchCount;
        const totalWords = Math.max(nameWords.size, pWordSet.size);
        if (commonWords >= 2 && commonWords / totalWords >= 0.5) {
            return p.id;
        }
    }
    
    // 4. Similarity-based fuzzy match (for typos like "ORGANI" vs "ORGANIC")
    let bestScore = 0;
    let bestId = null;
    for (const p of parties) {
        const pNorm = normalize(p.name);
        const combined = normalized + ' ' + pNorm;
        const score = similarity(normalized, pNorm);
        if (score > bestScore && score >= 0.6) {
            bestScore = score;
            bestId = p.id;
        }
    }
    
    return bestId;
}

// ── Main ──

async function main() {
    console.log('');
    console.log('  🐄  Prarambha Account & Stock Management — Import Payments from CSV');
    console.log('  ════════════════════════════════════════════════════');
    console.log('');

    // Check CSV file
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`  ❌ CSV file not found: ${CSV_PATH}`);
        process.exit(1);
    }

    // Check database
    if (!fs.existsSync(DB_PATH)) {
        console.error(`  ❌ Database not found: ${DB_PATH}`);
        console.error('     Run the app first to initialize the database.');
        process.exit(1);
    }

    // Open database
    console.log(`  🗄️  Opening database: ${DB_PATH}`);
    const db = openDatabase(DB_PATH);

    // Load all parties
    const parties = db.prepare('SELECT id, name FROM parties').all();
    console.log(`  👥 ${parties.length} parties found in database`);

    // Read CSV
    console.log(`  📂 Reading CSV: ${CSV_PATH}`);
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');

    // Parse CSV lines
    const lines = csvContent.split('\n')
        .map(l => l.replace(/\r$/, '').trim())
        .filter(l => l && !l.startsWith('>')); // Skip instruction lines

    if (lines.length < 2) {
        console.error('  ❌ CSV file has no data rows (need header + at least 1 data row)');
        db.close();
        process.exit(1);
    }

    // Parse header
    const header = parseCSVLine(lines[0]);
    console.log(`  📋 Headers: ${header.join(', ')}`);

    // Find column indices
    const colMap = {};
    header.forEach((h, i) => {
        const key = h.replace(/\s*\*$/, '').trim().toLowerCase();
        colMap[key] = i;
    });

    const idIdx = colMap['id'];
    const partyNameIdx = colMap['party id'];
    const dateIdx = colMap['date'];
    const typeIdx = colMap['type'];
    const amountIdx = colMap['amount'];
    const modeIdx = colMap['mode'];
    const refTypeIdx = colMap['reference type'];
    const refIdIdx = colMap['reference id'];
    const notesIdx = colMap['notes'];

    console.log(`  🔍 Party Name column index: ${partyNameIdx}`);
    console.log(`  🔍 Date column index: ${dateIdx}`);
    console.log('');

    // Process each data row
    let imported = 0;
    let skipped = 0;
    let noParty = 0;
    const skippedParties = new Set();

    const dataRows = lines.slice(1);
    console.log(`  📊 Processing ${dataRows.length} payment records...`);
    console.log('');

    // Group by batch for better performance - use a transaction
    const trx = db.transaction(() => {
        for (let i = 0; i < dataRows.length; i++) {
            const row = parseCSVLine(dataRows[i]);
            if (row.length === 0 || (row.length === 1 && row[0] === '')) continue;

            const partyName = row[partyNameIdx] ? row[partyNameIdx].trim() : '';
            if (!partyName) {
                skipped++;
                continue;
            }

            // Find party ID
            const partyId = findPartyId(parties, partyName);

            if (!partyId) {
                skipped++;
                noParty++;
                skippedParties.add(partyName);
                continue;
            }

            // Normalize date: replace / with -
            const rawDate = row[dateIdx] ? row[dateIdx].trim() : '';
            const date = rawDate.replace(/\//g, '-');

            // Parse type
            const type = row[typeIdx] ? row[typeIdx].trim().toLowerCase() : 'receipt';
            const validType = type === 'payment' ? 'payment' : 'receipt';

            // Parse amount
            const amount = parseAmount(row[amountIdx]);
            if (amount <= 0) {
                skipped++;
                continue;
            }

            // Parse mode
            const mode = row[modeIdx] ? row[modeIdx].trim().toLowerCase() : 'cash';
            const validModes = ['cash', 'bank', 'upi', 'cheque'];
            const validMode = validModes.includes(mode) ? mode : 'cash';

            // Reference info
            const refType = row[refTypeIdx] ? row[refTypeIdx].trim() : '';
            const refId = row[refIdIdx] ? parseInt(row[refIdIdx].trim(), 10) || null : null;
            const notes = row[notesIdx] ? row[notesIdx].trim() : '';

            try {
                // Use the existing savePayment function which also creates ledger entries
                savePayment(db, {
                    party_id: partyId,
                    date: date,
                    type: validType,
                    amount: amount,
                    mode: validMode,
                    reference_type: refType,
                    reference_id: refId,
                    notes: notes || `Imported from CSV - ${refType ? 'Ref: ' + refType + (refId ? ' #' + refId : '') : ''}`,
                });
                imported++;
            } catch (err) {
                console.error(`  ❌ Error importing row ${i + 2}: ${err.message}`);
                skipped++;
            }

            // Progress indicator
            if ((i + 1) % 25 === 0) {
                process.stdout.write(`  → ${i + 1}/${dataRows.length} records processed...\r`);
            }
        }
    });

    try {
        trx();
    } catch (err) {
        console.error(`\n  ❌ Transaction failed: ${err.message}`);
        db.close();
        process.exit(1);
    }

    // ── Results ──
    console.log('');
    console.log('  ═══════════════════════════════════════════════');
    console.log('  📊 IMPORT SUMMARY');
    console.log('');

    if (imported > 0) {
        // Verify counts
        const paymentCount = db.prepare('SELECT COUNT(*) as c FROM payments').get().c;
        const ledgerCount = db.prepare('SELECT COUNT(*) as c FROM ledger_entries').get().c;
        console.log(`  ✅ ${imported} payment records imported successfully!`);
        console.log(`  📊 Total payments in DB now: ${paymentCount}`);
        console.log(`  📊 Total ledger entries in DB now: ${ledgerCount}`);
    }

    if (noParty > 0) {
        console.log(`  ⚠️  ${noParty} records skipped (party not found in database)`);
        console.log('  Skipped parties:');
        for (const name of [...skippedParties]) {
            console.log(`     - ${name}`);
        }
    }

    if (skipped - noParty > 0) {
        console.log(`  ⚠️  ${skipped - noParty} records skipped for other reasons`);
    }

    // Show date range of imported data
    try {
        const minDate = db.prepare('SELECT MIN(date) as d FROM payments').get().d;
        const maxDate = db.prepare('SELECT MAX(date) as d FROM payments').get().d;
        console.log(`  📅 Date range in payments: ${minDate} to ${maxDate}`);
    } catch (e) { /* ignore */ }

    db.close();

    if (imported > 0) {
        console.log('');
        console.log('  ✅ Import complete! Refresh the app to see the new payment records.');
    }
    console.log('');
}

main().catch(err => {
    console.error('  ❌ Fatal error:', err.message);
    process.exit(1);
});
