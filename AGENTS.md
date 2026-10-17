# Working rules for this repository (Prarambha Account & Stock Management)

## STANDING RELEASE POLICY — do not finish an edit task without it

The user's standing instruction (first set 2026-09-14, reaffirmed 2026-09-28):

> "every time when i ask you to make edit or correction on this project you have
> to make .dmg, .exe and update to github at final"

So a task that changes the app is **not finished** until all of this has happened:

1. **Verify** the change (node test harnesses / `node --check` / integrity doctor).
2. **Bump the version** in `package.json` (`"version"` — the only place the number
   lives) and add `.freebuff/release-notes-<version>.md`.
3. **Commit + push** to `origin/master`.
   - Use the Homebrew git: `/opt/homebrew/bin/git` (`/usr/bin/git` is the broken
     Xcode shim and silently fails).
   - Stage files explicitly — never `git add -A`. `Dairy_Accounts_Professional.xlsx`
     and `data/**` are usually modified by hand/other processes: leave them alone.
   - Heredocs break in this shell — write the message to a file and use `git commit -F`.
4. **Build both installers** (electron-builder needs Rosetta 2 for the Windows x64
   helper; if it fails with "bad CPU type", reinstall it):
   ```bash
   CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --arm64
   npx electron-builder --win
   ```
   Note: `--win` is config-driven (nsis + portable + zip for x64). Do not pass
   `--win nsis portable` — that wrongly targets arm64.
   Artifacts, in `dist/`:
   - `Prarambha Account & Stock Management-<v>-arm64.dmg`
   - `Prarambha Account & Stock Management-Setup-<v>-x64.exe`
   - `Prarambha-Accounts-Portable-<v>.exe`
5. **MANDATORY post-build step**: `npm rebuild better-sqlite3`, then confirm with
   `node -e "require('better-sqlite3')"`. Building recompiles better-sqlite3 for
   Electron's ABI and otherwise breaks `node server.js`
   (`ERR_DLOPEN_FAILED`, NODE_MODULE_VERSION mismatch).
6. **Publish the GitHub release** with the three assets:
   ```bash
   gh release create v<version> --title "v<version>" \
     --notes-file .freebuff/release-notes-<version>.md \
     "dist/<dmg>" "dist/<Setup-exe>" "dist/<Portable-exe>"
   ```
   Keep previously published releases in place — the user wants old versions left
   available (do not delete or retag older releases).

`.freebuff/run.md` holds the same policy plus environment-specific notes (preview
server recipe, native-module ABI trap, Excel→app sync, Data Integrity Doctor).

## Editing conventions

- The app is plain Node/Express + Electron; no bundler. Same `shared/operations/*`
  modules back both the desktop app (`main.js`) and the web server (`server.js`), so
  a logic fix belongs in `shared/operations/` and must be exported from
  `shared/operations/index.js`, then wired into `main.js` (IPC), `server.js` (API),
  `preload.js` and `renderer/js/api.js`.
- **BS calendar: one source only.** Month lengths live in `shared/bs-calendar.js`
  (BS 2000–2090). The browser copy `renderer/js/bs-calendar-data.js` is GENERATED
  by `node scripts/build-bs-calendar.js` — never hand-edit it, never add a second
  table anywhere. Two tables drifting apart is what made Ashwin 31, 2083 (today)
  unselectable and shifted every AD→BS conversion by a day.
- A payment covering future periods (advance rent) is a **prepaid asset**, not an
  expense: record it through `shared/operations/prepaid_rent.js` and let the monthly
  recognition derive the expense. Never expense the whole amount in the payment month,
  and never enter the same payment twice.
- Money: `shared/operations/accounting.js` is the single source of truth — use its
  `round2` / `CURRENCY_TOLERANCE` / `paymentStatus` and its transaction→account
  mapping instead of ad-hoc arithmetic or float comparisons.
- Dates in this database are **Bikram Sambat strings** (`2083-03-32` is valid), so
  `strftime`/JS `Date` parsing must not be used on them — compare/slice strings.
- Never point an automated test at `data/dairy-plant.db`; copy it to `/tmp` first.

## Testing

- `node scripts/audit/test-accounting-logic.js` — 96 checks: the six accounting
  acceptance cases on a fresh database plus the same rules over a copy of the
  migrated database.
- `node scripts/audit/test-handover-reset.js` — 40 checks, Fresh Start / Handover Reset.
- `node scripts/audit/test-bs-calendar.js` — 79 checks: every BS month length
  (2000–2090), every month end, invalid-date rejection, BS↔AD round-trips,
  month/year navigation, agreement with the workbook's `BS_AD_Lookup` sheet and
  equality of the generated browser table with the Node table.
- `node scripts/audit/test-monthly-report.js` — 121 checks on a /tmp copy of the
  live database: month ends, inclusive last day, income/expense heads vs the
  registers, milk counted once, advances/loans never in P&L, month-to-month
  balance continuity, the six-month rent recognition, the Excel sheet matching the
  engine, and the workbook edit preserving every existing sheet.
- `node scripts/verify-modules.js` — smoke test of the operation modules
  (2 known failures: `farmer-statement` / `party-statement` need an id argument).
- `node scripts/audit/integrity-doctor.js <db>` — read-only data diagnostics.
- `node scripts/audit/test-pdf.js` — Electron-only (`app.whenReady`), cannot run
  under plain `node`; run it through the Electron runtime instead.

## Monthly Report refresh (app DB → workbook)

- The app's Monthly Report screen and `shared/export-monthly-report.js` share one
  engine (`shared/operations/monthly_report.js`), so screen and workbook cannot drift.
- After new transactions, refresh the customer's workbook sheet with
  `node scripts/audit/add-monthly-report-sheet.js --apply` (dry run without `--apply`).
  It writes a timestamped `.bak-monthly-report-*` copy first and never touches other
  sheets. The live DB is found automatically; override with `DB_PATH` / `WORKBOOK_PATH`.
- Do not open the workbook in Excel while the script runs — Excel would overwrite the
  new sheet on its next save.
