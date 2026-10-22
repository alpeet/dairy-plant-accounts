/**
 * Prarambha Account & Stock Management — XLSX part-level surgery
 * =============================================================
 * Adding a worksheet to an existing .xlsx WITHOUT rewriting it.
 *
 * SheetJS (community) does not preserve styles/number formats when it writes a
 * workbook back out. Doing `XLSX.readFile()` → `writeFile()` on the operator's
 * `Dairy_Accounts_Professional.xlsx` silently turned every date-formatted cell
 * (the `AD Date` columns, `BS_AD_Lookup`) into a raw serial number — a visible
 * loss of the workbook's formatting, caught by
 * scripts/audit/test-bs-calendar.js.
 *
 * So this module edits the OOXML package itself, using only Node's built-in
 * zlib: every part that is not strictly required to change is copied byte for
 * byte, and only these parts are touched:
 *
 *   [Content_Types].xml            (only when a new sheet part is created)
 *   xl/workbook.xml                (add <sheet …> when the sheet is new)
 *   xl/_rels/workbook.xml.rels     (add the sheet relationship when new)
 *   xl/styles.xml                  (append cell formats for our numbers)
 *   xl/worksheets/<sheet>.xml      (the new / refreshed sheet itself)
 *
 * An existing "Monthly Report" sheet is refreshed in place, keeping its tab
 * position; everything else — formulas, formats, merges, charts, pivot caches —
 * is preserved exactly as the operator had it.
 */

const fs = require('fs');
const zlib = require('zlib');

// ──────────────────────────────────────────────────────────────
// CRC32 (zip integrity)
// ──────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ──────────────────────────────────────────────────────────────
// Minimal zip reader / writer (store + deflate, no zip64)
// ──────────────────────────────────────────────────────────────

/** Read every entry of a zip buffer → { order:[names], entries:Map(name → {data, method}) } */
function readZip(buffer) {
    // End of central directory: scan back for signature 0x06054b50.
    let eocd = -1;
    for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i--) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');

    const count = buffer.readUInt16LE(eocd + 10);
    let offset = buffer.readUInt32LE(eocd + 16);
    const entries = new Map();
    const order = [];

    for (let i = 0; i < count; i++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Corrupt zip central directory');
        const method = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const nameLen = buffer.readUInt16LE(offset + 28);
        const extraLen = buffer.readUInt16LE(offset + 30);
        const commentLen = buffer.readUInt16LE(offset + 32);
        const localOffset = buffer.readUInt32LE(offset + 42);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen);

        // Local header tells us where the data really starts.
        if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Corrupt zip local header for ${name}`);
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const raw = buffer.subarray(dataStart, dataStart + compressedSize);
        let data;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = zlib.inflateRawSync(raw);
        else throw new Error(`Unsupported zip compression method ${method} for ${name}`);

        entries.set(name, { data, method: 0, text: () => data.toString('utf8') });
        order.push(name);
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return { order, entries };
}

/** Write a zip buffer from name → Buffer. Deflates; no zip64 (files are small). */
function writeZip(order, entries) {
    const localParts = [];
    const central = [];
    let offset = 0;

    for (const name of order) {
        const entry = entries.get(name);
        const data = Buffer.isBuffer(entry) ? entry : entry.data;
        const nameBuf = Buffer.from(name, 'utf8');
        const crc = crc32(data);
        const compressed = zlib.deflateRawSync(data, { level: 9 });

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);            // version needed
        local.writeUInt16LE(0x0800, 6);        // UTF-8 names
        local.writeUInt16LE(8, 8);             // deflate
        local.writeUInt16LE(0, 10);            // mod time
        local.writeUInt16LE(0, 12);            // mod date
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, nameBuf, compressed);

        const dir = Buffer.alloc(46);
        dir.writeUInt32LE(0x02014b50, 0);
        dir.writeUInt16LE(20, 4);              // version made by
        dir.writeUInt16LE(20, 6);              // version needed
        dir.writeUInt16LE(0x0800, 8);
        dir.writeUInt16LE(8, 10);
        dir.writeUInt16LE(0, 12);
        dir.writeUInt16LE(0, 14);
        dir.writeUInt32LE(crc, 16);
        dir.writeUInt32LE(compressed.length, 20);
        dir.writeUInt32LE(data.length, 24);
        dir.writeUInt16LE(nameBuf.length, 28);
        dir.writeUInt16LE(0, 30);
        dir.writeUInt16LE(0, 32);
        dir.writeUInt16LE(0, 34);
        dir.writeUInt16LE(0, 36);
        dir.writeUInt32LE(0, 38);
        dir.writeUInt32LE(offset, 42);
        central.push(dir, nameBuf);

        offset += local.length + nameBuf.length + compressed.length;
    }

    const centralBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(order.length, 8);
    eocd.writeUInt16LE(order.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralBuf, eocd]);
}

// ──────────────────────────────────────────────────────────────
// Sheet XML
// ──────────────────────────────────────────────────────────────

function colName(index) {
    let n = index + 1, s = '';
    while (n > 0) {
        const r = (n - 1) % 26;
        s = String.fromCharCode(65 + r) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
}

function esc(text) {
    return String(text)
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Build a worksheet part.
 * @param {Array<Array>} aoa      rows; strings become inline strings, numbers values
 * @param {object} opts           { columnWidths:[], freezeRow:number, autoFilter:string,
 *                                  isMoney/isDecimal/isInteger(row,col)→bool }
 * @param {object} styles         { money, decimal, integer } style indices (or null)
 */
function buildSheetXml(aoa, opts = {}, styles = {}) {
    const rowsXml = [];
    for (let r = 0; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const cells = [];
        for (let c = 0; c < row.length; c++) {
            const value = row[c];
            if (value === null || value === undefined || value === '') continue;
            const ref = `${colName(c)}${r + 1}`;
            let s = '';
            if (typeof value === 'number' && isFinite(value)) {
                const styleIdx = (opts.isMoney && opts.isMoney(r, c)) ? styles.money
                    : ((opts.isDecimal && opts.isDecimal(r, c)) ? styles.decimal
                        : ((opts.isInteger && opts.isInteger(r, c)) ? styles.integer : null));
                if (styleIdx != null) s = ` s="${styleIdx}"`;
                cells.push(`<c r="${ref}"${s}><v>${value}</v></c>`);
            } else {
                cells.push(`<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`);
            }
        }
        if (cells.length) rowsXml.push(`<row r="${r + 1}">${cells.join('')}</row>`);
    }

    const cols = (opts.columnWidths || []).length
        ? `<cols>${opts.columnWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
        : '';
    const freeze = opts.freezeRow
        ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${opts.freezeRow}" topLeftCell="A${opts.freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${opts.freezeRow + 1}" sqref="A${opts.freezeRow + 1}"/></sheetView></sheetViews>`
        : '';
    const filter = opts.autoFilter ? `<autoFilter ref="${opts.autoFilter}"/>` : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
        + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
        + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + freeze
        + `<sheetFormatPr defaultRowHeight="15"/>`
        + cols
        + `<sheetData>${rowsXml.join('')}</sheetData>`
        + filter
        + `</worksheet>`;
}

// ──────────────────────────────────────────────────────────────
// Style helpers
// ──────────────────────────────────────────────────────────────

/**
 * Append cell formats to styles.xml; returns {money, decimal, integer} indices
 * (and the patched xml only when something was actually appended).
 *
 * Idempotent: if our exact <xf> already exists it is REUSED, so refreshing the
 * report sheet over and over never grows styles.xml (found by the test suite —
 * a first version appended the three formats on every refresh).
 */
function ensureNumberStyles(stylesXml) {
    const none = { money: null, decimal: null, integer: null };
    if (!stylesXml) return none;
    const openTag = stylesXml.match(/<cellXfs\b[^>]*>/);
    const closeIdx = stylesXml.indexOf('</cellXfs>');
    if (!openTag || closeIdx < 0 || openTag.index == null) return none;
    const countMatch = openTag[0].match(/count="(\d+)"/);
    const count = countMatch ? parseInt(countMatch[1], 10) : 0;
    const innerStart = openTag.index + openTag[0].length;
    const inner = stylesXml.slice(innerStart, closeIdx);

    // Built-in formats: 4 = #,##0.00, 2 = 0.00, 1 = 0.
    const xf = (numFmtId) => `<xf numFmtId="${numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`;
    const targets = { money: xf(4), decimal: xf(2), integer: xf(1) };

    const idx = none;
    let appended = '';
    let added = 0;
    for (const key of ['money', 'decimal', 'integer']) {
        const at = inner.indexOf(targets[key]);
        if (at >= 0) {
            idx[key] = (inner.slice(0, at).match(/<xf\b/g) || []).length;
        } else {
            idx[key] = count + added;
            appended += targets[key];
            added++;
        }
    }
    if (!added) return idx;                      // already present — no change

    const newOpen = openTag[0].replace(/count="\d+"/, `count="${count + added}"`);
    const xml = stylesXml.slice(0, openTag.index) + newOpen + inner
        + appended + stylesXml.slice(closeIdx);
    return Object.assign(idx, { xml });
}

/**
 * Where does a named worksheet live in the package?
 * @returns {string|null} e.g. 'xl/worksheets/sheet27.xml'
 */
function locateSheetPart(zip, sheetName) {
    const entry = zip.entries.get('xl/workbook.xml');
    if (!entry) return null;
    const wbXml = entry.data.toString('utf8');
    const relsEntry = zip.entries.get('xl/_rels/workbook.xml.rels');
    const relsXml = relsEntry ? relsEntry.data.toString('utf8') : '';
    const wanted = sheetName.replace(/\s+$/, '').toLowerCase();
    for (const tag of wbXml.match(/<sheet\b[^>]*\/>/g) || []) {
        const name = (tag.match(/name="([^"]*)"/) || [])[1] || '';
        if (name.replace(/\s+$/, '').toLowerCase() !== wanted) continue;
        const rid = (tag.match(/r:id="([^"]*)"/) || [])[1] || '';
        const rel = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*/>`));
        const target = rel ? (rel[0].match(/Target="([^"]*)"/) || [])[1] : '';
        if (!target) return null;
        return (target.startsWith('/')
            ? target.slice(1)
            : `xl/${target.replace(/^\.?\//, '')}`).replace('xl/xl/', 'xl/');
    }
    return null;
}

// ──────────────────────────────────────────────────────────────
// Sheet insertion
// ──────────────────────────────────────────────────────────────

const SHEET_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet';
const SHEET_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml';

/**
 * Add or replace a worksheet inside an existing .xlsx, leaving every other part
 * byte-identical.
 *
 * @param {string} workbookPath  file to modify in place
 * @param {string} sheetName     requested name (trailing spaces preserved)
 * @param {object} built         { aoa, columnWidths, freezeRow, autoFilter, isMoney, isDecimal }
 * @returns {{sheetName:string, part:string, created:boolean, sheets:string[]}}
 */
function appendOrReplaceSheet(workbookPath, sheetName, built = {}) {
    const zip = readZip(fs.readFileSync(workbookPath));
    const get = (name) => {
        const entry = zip.entries.get(name);
        return entry ? entry.data.toString('utf8') : null;
    };
    const set = (name, text) => {
        if (!zip.entries.has(name)) zip.order.push(name);
        zip.entries.set(name, { data: Buffer.from(text, 'utf8'), method: 0 });
    };

    const wbXml = get('xl/workbook.xml');
    if (!wbXml) throw new Error('xl/workbook.xml not found — not an .xlsx workbook?');
    const relsXml = get('xl/_rels/workbook.xml.rels') || '';
    const typesXml = get('[Content_Types].xml') || '';

    // Existing sheets, in workbook order.
    const sheetTags = [...wbXml.matchAll(/<sheet\b[^>]*\/>/g)].map(m => m[0]);
    const sheets = sheetTags.map(t => ({
        tag: t,
        name: (t.match(/name="([^"]*)"/) || [])[1] || '',
        rid: (t.match(/r:id="([^"]*)"/) || [])[1] || '',
        sheetId: parseInt((t.match(/sheetId="(\d+)"/) || [])[1] || '0', 10)
    }));

    const wanted = sheetName.replace(/\s+$/, '').toLowerCase();
    const existing = sheets.find(s => s.name.replace(/\s+$/, '').toLowerCase() === wanted);

    let part;
    let created = false;

    if (existing) {
        part = locateSheetPart(zip, existing.name);
        if (!part || !zip.entries.has(part)) {
            throw new Error(`Cannot resolve the worksheet part for sheet "${existing.name}"`);
        }
    } else {
        const used = [...zip.entries.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
        const maxN = used.reduce((m, n) => Math.max(m, parseInt(n.match(/sheet(\d+)\.xml$/)[1], 10)), 0);
        part = `xl/worksheets/sheet${maxN + 1}.xml`;
        created = true;
    }

    // ── styles ──
    const stylesXml = get('xl/styles.xml');
    const styles = stylesXml ? ensureNumberStyles(stylesXml) : { money: null, decimal: null, integer: null };
    if (styles.xml) set('xl/styles.xml', styles.xml);

    // ── the sheet itself ──
    const sheetXml = buildSheetXml(built.aoa || [], {
        columnWidths: built.columnWidths,
        freezeRow: built.freezeRow,
        autoFilter: built.autoFilter,
        isMoney: built.isMoney,
        isDecimal: built.isDecimal,
        isInteger: built.isInteger
    }, styles);
    set(part, sheetXml);

    if (created) {
        // Relationship
        const maxRid = Math.max(0, ...[...relsXml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1], 10)));
        const rid = `rId${maxRid + 1}`;
        const maxSheetId = sheets.reduce((m, s) => Math.max(m, s.sheetId), 0);
        const tag = `<sheet name="${esc(sheetName)}" sheetId="${maxSheetId + 1}" r:id="${rid}"/>`;

        const newRels = relsXml.includes('</Relationships>')
            ? relsXml.replace('</Relationships>', `<Relationship Id="${rid}" Type="${SHEET_REL_TYPE}" Target="${part.replace(/^xl\//, '')}"/></Relationships>`)
            : relsXml;
        set('xl/_rels/workbook.xml.rels', newRels);

        const newWb = wbXml.includes('</sheets>')
            ? wbXml.replace('</sheets>', tag + '</sheets>')
            : wbXml;
        set('xl/workbook.xml', newWb);

        if (typesXml && !typesXml.includes(`/${part}`)) {
            set('[Content_Types].xml', typesXml.replace('</Types>',
                `<Override PartName="/${part}" ContentType="${SHEET_CONTENT_TYPE}"/></Types>`));
        }
    }

    // Write to a sibling temp file and swap it in, so a crash mid-write can
    // never leave a half-written workbook behind.
    const tmpPath = `${workbookPath}.tmp-xlsx-parts`;
    fs.writeFileSync(tmpPath, writeZip(zip.order, zip.entries));
    fs.renameSync(tmpPath, workbookPath);

    return {
        sheetName: existing ? existing.name : sheetName,
        part,
        created,
        sheets: created ? [...sheets.map(s => s.name), sheetName] : sheets.map(s => s.name)
    };
}

module.exports = {
    crc32, readZip, writeZip, buildSheetXml, ensureNumberStyles, locateSheetPart, appendOrReplaceSheet
};
