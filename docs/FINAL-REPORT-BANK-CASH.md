# Final Report — Bank · Duplicates · Date Range · Cash Deposit · Salary · Update

Date: 2026-10-03 · Branch `master` · Version **1.4.20** · Companion to [AUDIT-BANK-CASH-SALARY.md](AUDIT-BANK-CASH-SALARY.md)
Rule applied throughout: reuse what works, fix what is broken, add only what the audit proved missing. **No duplicate engines, no silent deletions, no hardcoded employees, no UI-only accounting fixes.**

---

## 1. Audit findings

Full pre-coding table (Existing / Working / Location / Problem / Action for all 8 requested areas): [AUDIT-BANK-CASH-SALARY.md](AUDIT-BANK-CASH-SALARY.md) — produced **before** any code change, as required.

## 2. Existing feature locations (nothing duplicated)

| Feature | Where it lives | Access |
|---|---|---|
| Bank transactions (entry/list/statement/posting) | `shared/operations/bank.js`, routes `/api/bank/*` + `db:bank:*` | Sidebar **Operations → Bank Transactions** |
| Bank review queue (near/unmatched) | `getBankReviewQueue` in `shared/operations/bank.js` | Bank Transactions → **🔍 Needs Review** |
| Bank row classification (auto) | `accounting.classifyBankRow` (single classifier) | automatic on import/save; now also healed for legacy rows |
| Cash/Bank authoritative position | `accounting.getCashBankPosition` | dashboard + reports (single source) |
| Cash Deposit register | `shared/operations/cash_deposit.js`, table `cash_deposits` | Sidebar **Operations → Cash Deposit** |
| Date presets (BS-aware, one implementation) | `getDatePreset()` in `renderer/js/utils.js` | filter bars on all report/list pages |
| Salary records | `shared/operations/salary.js`, table `salary_records` | Sidebar **Operations → Salary**; employees under **Master Data → Employees** |
| Excel import (incl. Salary Advance sheet) | `shared/excel-import.js` | **Settings → Update Data from Excel** |
| Stock Summary Ledger (already existed) | `dairy_costing.getStockLedger` | **Production → Dairy Costing → Stock Ledger** tab |
| Top menu / Help | `main.js → buildAppMenu()` | application menu bar |
| Version display | `renderer/js/version-label.js` + Help → About | login screen + About dialog |
| Audit trail | `logAudit` (`shared/operations/audit.js`) | **Administration → Audit Log** |

**Already exists — accessed from the locations above. No parallel modules were created.**

## 3. Bugs identified

1. **Salary — only one employee recorded (root cause reproduced):** the workbook's `Salary Advance` sheet layout changed to the generic column layout, but `importSalaryAdvanceSheet` still parsed the **old** 13-column layout → column shift collapsed all rows into one garbage "duplicate group" (1 imported, 8 skipped); `mode:'fresh'` then wiped the correct manual records on every update. `REQUIRED_EMPLOYEES` also hardcoded 3 employee names.
2. **Bank re-import duplication:** `importBankRows` deduped by `reference_no` only — rows with an **empty reference were never deduped**, so every re-import inserted them again. No stable transaction identifier existed anywhere.
3. **Double-submit:** bank/deposit/salary Save buttons had no in-flight guard; a second click inserted a second row.
4. **`generateDepositNo` used `COUNT(*)+1`** — after any deletion the next deposit reused an existing `deposit_no`.
5. **Date-range defaults used UTC AD dates** (`toISOString()`) in a BS-dated system: `getDaybook`, `getProfitLoss`, `getEnhancedDaybook`, `getDailyCashCollection`, `getCashDepositSummary`, partner/statement/route/milk/rate/stock defaults all fell back to `2026-…` bounds → `date <= '2026-10-03'` excluded **every** BS row → empty results; also the wrong calendar day before 05:45 Nepal time.
6. **Legacy `accounting_class = ''` rows vanished:** hidden from the review queue by a text filter, never classified, never posted, never surfaced anywhere.
7. **Cash Deposit page showed only the register** — statement-side deposits (e.g. "CASH DEPOSIT BY KESHAB") were invisible, and there was no expected-vs-actual cash reconciliation.
8. **No update mechanism** — users had no way to learn a new version exists.

## 4. Changes made

**Salary (`shared/excel-import.js`, `shared/db.js`)**
- Layout detection for the Salary Advance sheet; rows parsed into real columns (month + employee + amounts + payment_date) with **per-month+employee upsert** dedupe (voucher only when non-empty).
- Removed the hardcoded `ensureRequiredEmployees` seeding (employee master comes from data only).
- Verified empirically on a scratch DB: 3 employees all recorded; re-import → 0 added / 4 unchanged (idempotent).

**Bank idempotency (`shared/operations/bank.js`)**
- New `txn_uid` column: `ref:<reference>` when a reference exists, otherwise `imp:<sha1 content-key>#<occurrence>` (date+direction+amount+counterparty+description+account+mode — never amount+date alone). UNIQUE index `idx_bank_txn_uid`. Legacy rows backfilled once by `_migrateTxnUid`.
- `importBankRows`: skips any row whose uid already exists; within one file, occurrence ranks keep legitimate identical twins while a re-import of the same file inserts **zero** rows.
- `saveBankTransaction`: reference conflict → rejected with `duplicate_of`; identical payload within 10 s → returns the existing row (`duplicate: true`); uid kept stable across edits.
- Implemented in `ensureBankTable`'s column-migration block (the codebase's existing lazy-migration pattern, same as `accounting_class`; runs on every DB open path).

**Classification (`shared/operations/bank.js` + wiring)**
- `_healAccountingClass` — classify-on-read: legacy `''` rows get their class derived once from their wording and persisted (non-party rows get the standard posted-in-place/auto treatment). They now leave the phantom state and become visible.
- New `setBankAccountingClass(db, id, cls, userId)` — manual override, audited, re-opens party matching when switching away from a non-party class. Wired through `index.js`, `main.js` (`db:bank:class`), `preload.js`, `server.js` (`POST /api/bank/classify`), `renderer/js/api.js`.

**Cash Deposit (`shared/operations/cash_deposit.js`, `shared/operations/accounting.js`, `renderer/js/cash_deposit.js`)**
- `generateDepositNo` now uses MAX(sequence), not COUNT.
- 10-second identical-payload guard on create (`duplicate_skipped`).
- `getCashBankPosition` additionally returns `unmatched_transfer_rows` (same single-source mirror-dedup rule used for counting) and `getCashDepositSummary` surfaces them as `bank_transfers` + a full `reconciliation` block (opening 0 + receipts − payments − deposits = expected vs latest denomination count = actual, with difference).
- Page renders both: **💵 Cash Reconciliation** panel and **🏦 Bank Statement Deposits — not in register** table with **➕ To Register** prefill (never counted as income).

**Date defaults (one shared helper, ~15 call sites)**
- New `todayBSDate()` in `shared/excel-import.js` (local time → BS). Replaced every UTC/AD fallback in `reports`, `financial_reports` (P&L now defaults to BS fiscal-year-to-date), `partners`, `cash`, `cash_deposit`, `statements` (both statement bounds), `routes`, `rates`, `stock`, `milk`, `dashboard`, `management_reports`, `company_ledger`, `accounting` (advance-register cutoff). UI presets (`getDatePreset`) were already correct and untouched.

**Renderer**
- Bank page: new **Class** column + badges, **🏷 Classification** modal (5 options) → audited save; BS `today()` default for new-row date (was ISO/UTC); double-submit guards on bank/deposit/salary saves; `?v=` cache bumps.
- Cash Deposit page: reconciliation + statement-deposit sections as above.

**Update check (`main.js`)**
- Help → **Check for Updates…** compares `app.getVersion()` against the GitHub latest release (`api.github.com …/releases/latest`), shows Up-to-date / Update-available dialogs and opens the release page. Notify-only; never downloads or installs.

**Read-only reporting**
- `scripts/audit/detect-duplicates.js` — opens the DB with `readonly: true`, groups candidate duplicates per financial table (content keys per table), prints id/date/amount/account/reference/source/created_at per group, `--json` supported. **Deletes nothing.**

## 5. New features added (only where the audit proved missing)

1. Stable transaction identifiers + DB-enforced idempotency for bank rows (`txn_uid` + UNIQUE index).
2. Cash reconciliation panel (expected vs actual, from the authoritative ledger).
3. Statement-deposit surfacing with one-click "To Register".
4. Manual, audited bank-row classification (UI + API).
5. Classify-on-read healing of legacy unclassified rows.
6. Help → Check for Updates.
7. Read-only duplicate-detection report script.
8. Targeted test suite `scripts/audit/test-bank-idempotency.js`.

## 6. Database / migration changes

- `ALTER TABLE bank_transactions ADD COLUMN txn_uid TEXT DEFAULT NULL` + `CREATE UNIQUE INDEX idx_bank_txn_uid` + one-time backfill (`ref:` / `imp:` keys). **No new tables. No engine duplicated.**
- Everything else was logic/UI only. No rows were deleted anywhere; the duplicate report is read-only by construction (SQLite opened `readonly: true`).

## 7. Tests performed (this round)

**New:** `test-bank-idempotency` — **41/41** (uid migration + unique-index rejection, import ×2 idempotency incl. identical twins, ref conflict, double-submit, deposit-no after delete, `todayBSDate` + daybook/P&L/balance/summary defaults, heal, manual classify + audit row, statement surfacing, reconciliation math).
**Regression (only suites covering touched modules):** supplier-pricing 63/0 · company-ledger 35/0 · management-reports 58/0 · advance-register 27/0 · accounting-logic 96/0 · phase26-reconcile 62/0 · payment-types 43/0 · `verify-modules` 39/2 (pre-existing baseline, unchanged).
**E2E:** server boots clean; `POST /api/bank/classify` registered (401 auth-gated, not 404); browser pass — login, Cash Deposit page renders reconciliation with real numbers (Expected रु 1,33,747 vs Actual रु 22,105, difference flagged) and 2 statement-only deposits surfaced; Bank page Class column/badges live; classify modal → save → badge flips to 🧾 Expense → restored; no JS console errors (favicon 404 only).
**Duplicate scan (dev DB):** 35 candidate groups / 84 rows — `bank_transactions` 0, `cash_deposits` 0, `payments` 0, `salary_records` 0; `sales` 3 groups (different invoice numbers, same day/total — likely legitimate) and `ledger_entries` 32 groups (legacy Excel-import rows, identical `created_at`, `reference_id=0`). **Reported, not deleted.**

## 8. Remaining issues / limitations

- `payments` has no server-side idempotency key yet (bank + deposits are covered; payments still relies on import dedupe + UI guards). Candidate duplicates would be caught by the report script.
- The 84 legacy candidate rows need a human pass with `detect-duplicates.js --json` before any cleanup — none were removed.
- Update check exists only in the desktop menu (a web deployment has no menu bar) and is notify-only.
- `verify-modules` keeps its pre-existing 2 arg-validation failures (baseline before this round; unrelated).
- Not released yet — changes are uncommitted on `master`.

## 9. Navigation paths

- **Bank transactions:** Operations → Bank Transactions (Class column per row; 🏷 opens classification; ✏️/🗑 edit/delete). Review queue: same page → 🔍 Needs Review.
- **Cash deposit + reconciliation:** Operations → Cash Deposit — 💵 Cash Reconciliation panel (top), 🏦 Bank Statement Deposits — not in register (➕ To Register prefills the form), register table below.
- **Date filtering:** any list/report filter bar → From/To + Today / This Month buttons (BS presets).
- **Salary:** Operations → Salary (add/edit/duplicate-guarded save); employees: Master Data → Employees; bulk history: Settings → Update Data from Excel → Salary Advance sheet.
- **Duplicates report:** `NODE_PATH="$PWD/node_modules" node scripts/audit/detect-duplicates.js [dbPath] [--json]`.
- **Updates/version:** menu bar → Help → Check for Updates…; version also in Help → About and on the login screen.
- **Audit trail:** Administration → Audit Log (bank classification changes appear as `bank_transactions` updates with user + before/after).
- **Stock Summary Ledger:** Production → Dairy Costing → Stock Ledger (already existed).

## 10. Software version / update information

- Installed/committed version: **1.4.20** (`package.json`; matches the GitHub release and the login screen label).
- This round's changes are **on disk, uncommitted** — ready for a `1.4.21` bump + commit + release if you want them shipped.
- New update discovery: **Help → Check for Updates…** compares against `github.com/alpeet/dairy-plant-accounts/releases/latest` and opens the release page when a newer tag exists (current latest = `v1.4.20`).
