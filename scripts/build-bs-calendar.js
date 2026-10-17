#!/usr/bin/env node
/**
 * build-bs-calendar.js — regenerate the browser's BS calendar data file.
 *
 *   node scripts/build-bs-calendar.js
 *
 * The authoritative table lives in shared/bs-calendar.js (Node, used by the
 * server, the Excel importer and the audit tests). The renderer cannot require()
 * it, so this script writes renderer/js/bs-calendar-data.js from it. Never edit
 * the generated file by hand: the two tables drifting apart is exactly the bug
 * this removes (2083 Jestha/Ashwin lengths disagreed and Ashwin 31 — today —
 * was not selectable).
 *
 * Exit 0 = written, 1 = failure.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { BS_CALENDAR_DATA, BS_MONTHS_NP, BS_MONTHS_EN, BS_MIN_YEAR, BS_MAX_YEAR } =
    require(path.join(ROOT, 'shared', 'bs-calendar'));

const years = Object.keys(BS_CALENDAR_DATA).map(Number).sort((a, b) => a - b);
const body = years.map(y => `    ${y}: [${BS_CALENDAR_DATA[y].join(', ')}],`).join('\n');

const out = `/**
 * GENERATED FILE — do not edit. Browser copy of shared/bs-calendar.js.
 * Regenerate with: node scripts/build-bs-calendar.js
 *
 * The picker and the server must agree on every month length; keeping this
 * generated from the Node module is what stops the two tables drifting apart
 * again (they disagreed on 2083 and the picker refused today, 2083-06-31).
 */
window.BS_CALENDAR_DATA = {
${body}
};
window.BS_MONTHS_NP = ${JSON.stringify(BS_MONTHS_NP)};
window.BS_MONTHS_EN = ${JSON.stringify(BS_MONTHS_EN)};
window.BS_MIN_YEAR = ${BS_MIN_YEAR};
window.BS_MAX_YEAR = ${BS_MAX_YEAR};
`;

fs.writeFileSync(path.join(ROOT, 'renderer', 'js', 'bs-calendar-data.js'), out);
console.log(`Wrote renderer/js/bs-calendar-data.js (${years[0]}–${years[years.length - 1]}, ${years.length} years).`);
