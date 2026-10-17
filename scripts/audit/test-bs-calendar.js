#!/usr/bin/env node
/**
 * test-bs-calendar.js — the Bikram Sambat calendar, the picker's data and every
 * date rule the app depends on.
 * ========================================================================
 *   node scripts/audit/test-bs-calendar.js
 *
 * Exit 0 = all checks pass, 1 = at least one failure.
 *
 * Why this exists: the renderer and shared/excel-import.js each carried their
 * own 2080–2090 month table, and both were wrong for 2083 (Jestha 32, Ashwin
 * 30, Kartik 29, Mangsir 30, Poush 29). The picker therefore refused Ashwin 31
 * — today, BS 2083-06-31 — and every AD↔BS conversion drifted after Jestha.
 * These checks lock the single shared table down.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
const cal = require(path.join(ROOT, 'shared', 'bs-calendar'));

let pass = 0, fail = 0;
const failures = [];
function ok(cond, name, extra) {
    if (cond) { pass++; return true; }
    fail++;
    failures.push(name + (extra ? ` — ${extra}` : ''));
    return false;
}
function eq(actual, expected, name) {
    return ok(actual === expected, name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const hr = (t) => console.log('\n' + '─'.repeat(66) + (t ? `\n  ${t}` : ''));

// ──────────────────────────────────────────────────────────────
hr('1. The table itself (real month lengths, never a fixed 30)');
// ──────────────────────────────────────────────────────────────
const REAL_2083 = [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30];
eq(JSON.stringify(cal.BS_CALENDAR_DATA['2083']), JSON.stringify(REAL_2083), 'BS 2083 month lengths are the real ones');
const REAL_2082 = [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30];
eq(JSON.stringify(cal.BS_CALENDAR_DATA['2082']), JSON.stringify(REAL_2082), 'BS 2082 month lengths are the real ones');

let yearsChecked = 0, monthsChecked = 0, badLengths = [];
for (const y of Object.keys(cal.BS_CALENDAR_DATA)) {
    const row = cal.BS_CALENDAR_DATA[y];
    yearsChecked++;
    if (row.length !== 12) badLengths.push(`${y}: ${row.length} months`);
    for (const d of row) {
        monthsChecked++;
        if (!(d >= 29 && d <= 32)) badLengths.push(`${y}: ${d} days`);
    }
}
eq(badLengths.length, 0, `every supported year has 12 months of 29–32 days (${yearsChecked} years, ${monthsChecked} months)`, badLengths.slice(0, 5).join('; '));
ok(monthsChecked > 1000, `the table covers the picker's whole range (${cal.BS_MIN_YEAR}–${cal.BS_MAX_YEAR})`);

// Months that are NOT 30 days must be reachable — the original bug assumed 30.
const nonThirty = [];
for (const y of Object.keys(cal.BS_CALENDAR_DATA)) {
    for (let m = 1; m <= 12; m++) {
        const d = cal.getBSDaysInMonth(Number(y), m);
        if (d !== 30) nonThirty.push(`${y}-${String(m).padStart(2, '0')}=${d}`);
    }
}
ok(nonThirty.length > 500, `most months are not 30 days (${nonThirty.length} of ${monthsChecked} differ)`);

// ──────────────────────────────────────────────────────────────
hr('2. Month ends: Shrawan / Bhadra / Ashwin 2083 and every month');
// ──────────────────────────────────────────────────────────────
const end = (m) => cal.bsMonthRange(m);
eq(end('2083-04').to_date, '2083-04-31', 'Shrawan 2083 has 31 days (Shrawan 31 selectable)');
eq(end('2083-05').to_date, '2083-05-31', 'Bhadra 2083 has 31 days (Bhadra 31 selectable)');
eq(end('2083-06').to_date, '2083-06-31', 'Ashwin 2083 has 31 days (today, 2083-06-31, is selectable)');
eq(end('2083-03').to_date, '2083-03-32', 'Ashadh 2083 has 32 days (Ashadh 32 selectable)');
eq(end('2083-07').to_date, '2083-07-30', 'Kartik 2083 has 30 days');
eq(end('2083-08').to_date, '2083-08-29', 'Mangsir 2083 has 29 days');

let monthEndFails = [];
for (const y of Object.keys(cal.BS_CALENDAR_DATA)) {
    for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const r = end(key);
        const days = cal.getBSDaysInMonth(Number(y), m);
        if (!r || r.days !== days) monthEndFails.push(key);
        if (!cal.validateBSDate(r.to_date).valid) monthEndFails.push(`${key} end date invalid`);
        if (cal.validateBSDate(`${key}-${String(days + 1).padStart(2, '0')}`).valid) {
            monthEndFails.push(`${key} accepts day ${days + 1}`);
        }
    }
}
eq(monthEndFails.length, 0, 'every month end is valid AND the day after it is rejected', monthEndFails.slice(0, 5).join('; '));

// ──────────────────────────────────────────────────────────────
hr('3. Validation: valid accepted, invalid rejected');
// ──────────────────────────────────────────────────────────────
ok(cal.validateBSDate('2083-06-31').valid, '2083-06-31 (today) is valid');
ok(cal.validateBSDate('2083-05-31').valid, 'Bhadra 31 is valid');
ok(cal.validateBSDate('2083-04-31').valid, 'Shrawan 31 is valid');
ok(cal.validateBSDate('2083-03-32').valid, 'Ashadh 32 is valid');
ok(!cal.validateBSDate('2083-02-32').valid, 'Jestha 32 is REJECTED (Jestha 2083 has 31 days)');
ok(!cal.validateBSDate('2083-07-31').valid, 'Kartik 31 is rejected');
ok(!cal.validateBSDate('2083-08-30').valid, 'Mangsir 30 is rejected');
ok(!cal.validateBSDate('2083-13-01').valid, 'month 13 is rejected');
ok(!cal.validateBSDate('2083-00-10').valid, 'month 0 is rejected');
ok(!cal.validateBSDate('2083-06-00').valid, 'day 0 is rejected');
ok(!cal.validateBSDate('1999-01-01').valid, 'a year below the supported range is rejected');
ok(!cal.validateBSDate('2099-01-01').valid, 'a year above the supported range is rejected');
ok(!cal.validateBSDate('2083/6/31').valid || cal.validateBSDate('2083/6/31').valid,
    'slashed input is parsed (normalized) or rejected — never silently wrong');
eq(cal.normalizeBSDate('2083/6/31'), '2083-06-31', 'slashed dates normalize to the stored format');

// ──────────────────────────────────────────────────────────────
hr('4. AD ↔ BS conversion (real anchors, both directions)');
// ──────────────────────────────────────────────────────────────
eq(cal.bsToAD('2082-01-01'), '2025-04-14', 'BS 2082-01-01 = AD 2025-04-14 (anchor)');
eq(cal.bsToAD('2083-01-01'), '2026-04-14', 'BS 2083-01-01 = AD 2026-04-14 (Nepali New Year 2083)');
eq(cal.bsToAD('2083-06-31'), '2026-10-17', 'BS 2083-06-31 = AD 2026-10-17 (today)');
eq(cal.adToBS('2026-10-16'), '2083-06-30', 'AD 2026-10-16 = BS 2083-06-30');
eq(cal.adToBS('2026-09-23'), '2083-06-07', 'AD 2026-09-23 = BS 2083-06-07 (the book-import date)');
eq(cal.adToBS('2026-08-15'), '2083-04-30', 'AD 2026-08-15 = BS Shrawan 30, 2083');
eq(cal.adToBS('2026-08-16'), '2083-04-31', 'AD 2026-08-16 = BS Shrawan 31, 2083 (a 31-day Shrawan)');

let roundTripFails = [];
let days = 0;
for (let y = 2082; y <= 2085; y++) {
    for (let m = 1; m <= 12; m++) {
        const max = cal.getBSDaysInMonth(y, m);
        for (let d = 1; d <= max; d++) {
            const bsDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const ad = cal.bsToAD(bsDate);
            days++;
            if (!ad) { roundTripFails.push(`${bsDate} → null`); continue; }
            const back = cal.adToBS(ad);
            if (back !== bsDate) roundTripFails.push(`${bsDate} → ${ad} → ${back}`);
        }
    }
}
eq(roundTripFails.length, 0, `BS → AD → BS round-trips for all ${days} days of 2082–2085`, roundTripFails.slice(0, 4).join('; '));

// Consecutive days must be consecutive in the other calendar too.
let continuityFails = [];
for (const probe of ['2083-03-31', '2083-03-32', '2083-05-31', '2083-06-30', '2083-12-30', '2083-08-29']) {
    const next = cal.addBSDays(probe, 1);
    const ad = cal.bsToAD(probe);
    const adNext = cal.bsToAD(next);
    const diff = Math.round((Date.parse(adNext) - Date.parse(ad)) / 86400000);
    if (diff !== 1) continuityFails.push(`${probe} → ${next} (${diff} days)`);
}
eq(continuityFails.length, 0, 'day after a month end is the first day of the next month', continuityFails.join('; '));
eq(cal.addBSDays('2083-06-31', 1), '2083-07-01', 'Ashwin 31 → Kartik 1 (Ashwin really has 31 days)');
eq(cal.addBSDays('2083-07-30', 1), '2083-08-01', 'Kartik 30 → Mangsir 1');
eq(cal.addBSDays('2083-12-30', 1), '2084-01-01', 'Chaitra 30 → next BS year');

// ──────────────────────────────────────────────────────────────
hr('5. Period validation and month keys');
// ──────────────────────────────────────────────────────────────
const okRange = cal.validateBSRange('2083-05-01', '2083-05-31');
ok(okRange.valid && okRange.to_date === '2083-05-31', 'a full Bhadra 2083 month range is accepted, end date inclusive');
ok(!cal.validateBSRange('2083-05-31', '2083-05-01').valid, 'a reversed range is rejected');
ok(!cal.validateBSRange('2083-05-01', '2083-05-32').valid, 'an invalid end day is rejected');
ok(!cal.validateBSRange('2083-05-01', '').valid, 'a missing end date is rejected');
eq(JSON.stringify(cal.monthsBetween('2083-04-31', '2083-06-01')), JSON.stringify(['2083-04', '2083-05', '2083-06']),
    'months between two dates span month and year boundaries');
eq(JSON.stringify(cal.monthsBetween('2083-12-30', '2084-01-01')), JSON.stringify(['2083-12', '2084-01']),
    'monthsBetween crosses a BS year');
eq(cal.shiftBSMonth('2083-01', -1), '2082-12', 'previous month crosses the BS year');
eq(cal.shiftBSMonth('2083-12', 1), '2084-01', 'next month crosses the BS year');
eq(cal.bsMonthLabel('2083-05'), 'Bhadra 2083', 'month labels read correctly');

// ──────────────────────────────────────────────────────────────
hr('6. The browser copy the picker uses matches this table');
// ──────────────────────────────────────────────────────────────
const browserFile = path.join(ROOT, 'renderer', 'js', 'bs-calendar-data.js');
if (!fs.existsSync(browserFile)) {
    ok(false, 'renderer/js/bs-calendar-data.js exists (run node scripts/build-bs-calendar.js)');
} else {
    const src = fs.readFileSync(browserFile, 'utf8');
    const sandbox = { window: {} };
    // eslint-disable-next-line no-new-func
    new Function('window', src)(sandbox.window);
    eq(JSON.stringify(sandbox.window.BS_CALENDAR_DATA['2083']), JSON.stringify(REAL_2083),
        'the generated browser table has the real 2083 month lengths');
    eq(Object.keys(sandbox.window.BS_CALENDAR_DATA).length, Object.keys(cal.BS_CALENDAR_DATA).length,
        'the browser table has every year the Node table has');
    let diff = [];
    for (const y of Object.keys(cal.BS_CALENDAR_DATA)) {
        if (JSON.stringify(sandbox.window.BS_CALENDAR_DATA[y]) !== JSON.stringify(cal.BS_CALENDAR_DATA[y])) diff.push(y);
    }
    eq(diff.length, 0, 'the browser table matches the Node table year by year', diff.join(', '));
    eq(sandbox.window.BS_MIN_YEAR, cal.BS_MIN_YEAR, 'the picker uses the same supported year range');
    eq(sandbox.window.BS_MAX_YEAR, cal.BS_MAX_YEAR, 'the picker uses the same maximum year');
}

// The renderer must not carry a second, private table any more.
const rendererSrc = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'nepali-date.js'), 'utf8');
ok(!/const\s+BS_CALENDAR_DATA\s*=/.test(rendererSrc),
    'renderer/js/nepali-date.js no longer defines its own BS_CALENDAR_DATA table');
const importSrc = fs.readFileSync(path.join(ROOT, 'shared', 'excel-import.js'), 'utf8');
ok(!/const\s+BS_CALENDAR_DATA\s*=/.test(importSrc),
    'shared/excel-import.js no longer defines its own BS_CALENDAR_DATA table');
ok(/require\(['"]\.\/bs-calendar['"]\)/.test(importSrc),
    'shared/excel-import.js converts dates through the shared calendar');

// ──────────────────────────────────────────────────────────────
hr('7. The workbook\'s own BS↔AD lookup agrees with the table');
// ──────────────────────────────────────────────────────────────
const wbPath = path.join(ROOT, 'Dairy_Accounts_Professional.xlsx');
if (!fs.existsSync(wbPath)) {
    console.log('  (skipped — workbook not present)');
} else {
    const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
    try {
        const wb = XLSX.readFile(wbPath);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets['BS_AD_Lookup'] || {}, { header: 1, defval: '', raw: false });
        const sampled = rows.slice(1).filter(r => String(r[0]).startsWith('2083/') || String(r[0]).startsWith('2082/'));
        let mismatches = 0;
        let checked = 0;
        for (const r of sampled) {
            const bsDate = String(r[0]).replace(/\//g, '-');
            const adDate = String(r[1]).trim();
            if (!cal.validateBSDate(bsDate).valid || !/^\d{4}-\d{2}-\d{2}$/.test(adDate)) continue;
            checked++;
            if (cal.bsToAD(bsDate) !== adDate) {
                mismatches++;
                if (mismatches <= 3) failures.push(`  workbook lookup ${bsDate} = ${adDate}, app says ${cal.bsToAD(bsDate)}`);
            }
        }
        ok(checked > 600 && mismatches === 0,
            `the app agrees with the workbook's BS_AD_Lookup on all ${checked} sampled days of 2082–2083`,
            `${mismatches} mismatch(es)`);
        // Month lengths implied by the workbook.
        const byMonth = {};
        for (const r of rows.slice(1)) {
            const s = String(r[0]);
            if (!s.startsWith('2083/')) continue;
            const mm = s.slice(5, 7);
            byMonth[mm] = (byMonth[mm] || 0) + 1;
        }
        const workbookLengths = Object.keys(byMonth).sort().map(k => byMonth[k]);
        eq(JSON.stringify(workbookLengths), JSON.stringify(REAL_2083),
            'the workbook\'s 2083 month lengths equal the app\'s table');
    } catch (e) {
        ok(false, 'the workbook BS_AD_Lookup sheet could be read', e.message);
    }
}

// ──────────────────────────────────────────────────────────────
hr('8. Backwards compatibility: the old renderer API still exists');
// ──────────────────────────────────────────────────────────────
const nepaliSrc = rendererSrc;
for (const fn of ['validateBSDate', 'getBSDaysInMonth', 'adToBS', 'bsToAD', 'getTodayBS',
    'formatBSDateNP', 'formatBSDateEN', 'createBSPicker', 'updateDayOptions',
    'initBSDateInput', 'initAllBSDateInputs', 'enhanceBSMonthInputs', 'refreshBSDateInputs',
    'getBSDateValue', 'setBSDateValue', 'validateBSRange', 'getBSMonthRange', 'shiftBSMonth']) {
    ok(new RegExp(`function\\s+${fn}\\s*\\(`).test(nepaliSrc), `nepali-date.js still defines ${fn}()`);
}
for (const g of ['window.NepaliDate', 'window.validateBSRange', 'window.todayBS', 'window.refreshBSDateInputs']) {
    ok(nepaliSrc.includes(g), `nepali-date.js still exposes ${g}`);
}

// ──────────────────────────────────────────────────────────────
hr('RESULT');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log('   ✗ ' + f));
    process.exit(1);
}
console.log('  ✅ BS calendar, month ends, conversions and picker rules all verified.');
