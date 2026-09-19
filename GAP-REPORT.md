# Prarambha Account & Stock Management — GAP REPORT vs Handover Specification

Audit date: 2026-09-19 · Branch `master` · Audited by: senior full-stack engineer (pre-handover review)
Status: **steps 1–3 complete (read codebase → gap report → proposed order). No implementation code written, awaiting approval.**

---

## 0. What was audited

| Item | Value |
|---|---|
| Runtime | Electron 33 desktop **and** Express web server, sharing `renderer/` + `shared/operations/` |
| Backend | `server.js` (1821 lines, 169 POST routes), `main.js` (1328 lines IPC), `preload.js` |
| Business logic | `shared/operations/*.js` (29 modules), `shared/validate.js` (536), `shared/db.js` (552) |
| Frontend | `renderer/js/*.js` (31 modules), `renderer/index.html` (30 nav pages) |
| Schema | `database/schema.sql` (621 lines, 26 tables) + 18 ad-hoc migrations in `shared/db.js` |
| Importer | `shared/excel-import.js` (1444), `import-excel.js` (1090), `data-exchange.js`, `shared/data-csv.js` |
| Live DB | `data/dairy-plant.db` |

**Live data snapshot (read-only):** parties 88 (64 customer, 16 supplier, 6 farmer, 2 partner) · products 12 · sales 1405 · sales_items 1734 · purchases 192 · stock_movements 2415 · ledger_entries 3525 · payments 997 · bank_transactions 52 · petty_cash 122 · denomination_counts 79 · routes 4 · rate charts 2 · users 2 · **milk_collections 0 · production_batches 0 · audit_log 0 · other_expenses 0 · salary 0 · vehicle 0 · cash_deposits 0 · partner_capital 0**.

**Critical storage convention discovered:** every business `date` column stores **BS (Bikram Sambat) strings** (e.g. `2083-05-28`) while `created_at`/`updated_at` store **AD** `datetime('now','localtime')`. Reports, filters and defaults depend on this; SQLite date functions are unusable on BS values (`strftime` returns NULL for `2083-03-32`).

---

## 1. BLOCKERS (fix before anything else)

| # | Blocker | Evidence | Impact |
|---|---|---|---|
| B1 | **`package.json` is deleted in the working tree** | `git status` → ` D package.json`; file absent on disk; content still in `HEAD` | `npm install`, `npm start`, `npm run dist:*`, Electron build and the postinstall `better-sqlite3` rebuild all fail. Web server only runs as `node server.js`. |
| B2 | **Working tree has an uncommitted, unreviewed feature WIP** | `git status`: modified `shared/db.js`, `shared/operations/{milk,production,products,sales}.js`, `shared/validate.js`, `renderer/js/{sales,invoice_generator}.js`, `database/schema.sql` | Per-type milk stock + manual invoice items. Must be reviewed/committed (or reverted) before further migrations, or every later schema change will be mixed with it. |
| B3 | **Stock ledger is already inconsistent in production data** | Mix Milk balance **−26,385.5 L**, Ghee −49.5, NAUNI −143.5, PANEER −57.5; only 2 movement types exist (`purchase` 681, `sale` 1734) | Closing stock ≠ physical stock today (DoD item 2 fails). Any valuation/report built on it inherits garbage. |
| B4 | **Schema drift — `cash_collections` exists in the live DB but not in `schema.sql`** | table present in DB; created only at runtime by `shared/operations/cash.js:32,213` | A fresh install/restore of `schema.sql` produces a different schema than production; migrations are not authoritative. |
| B5 | **Migrations are destructive probes with no version table and no rollback** | `shared/db.js` `runMigrations()` does `INSERT … 'migration test'` / `catch` → `DROP TABLE … RENAME`, 18 times, on every startup; no `schema_migrations`, no `PRAGMA user_version`, no down-scripts | A crash mid-probe can leave a junk row or a half-migrated table in customer data. No reversible migrations (spec requirement). |

---

## 2. Gap report by module

Legend: **[DONE]** implemented and usable · **[PARTIAL]** exists but incomplete/limited · **[MISSING]** absent · **[BROKEN]** present and incorrect.

### 1. MASTERS

| Requirement | Status | Where it lives / should live |
|---|---|---|
| Parties: code, name (NP+EN), address, phone, PAN/VAT, opening Dr/Cr, credit limit, credit days, route, bank/eSewa, active flag | **[PARTIAL]** | `parties` (`schema.sql:52`) — has `party_code, name, phone, email, address, pan_vat, type, opening_balance, route_id, partner_type, profit_share_percent, notes, archived`. Missing: Nepali name, `credit_limit`, `credit_days`, bank/eSewa fields, explicit active/inactive (only `archived`). |
| Party types incl. cooperative, dealer, **employee**, **transporter** | **[PARTIAL]** | CHECK constraint allows `customer, supplier, both, farmer, partner` only. |
| **Duplicate party detection + merge tool** (fuzzy, preview, one-click, audit) | **[MISSING]** | No UI/service. Only one-off CLI `scripts/audit/merge-duplicate-parties.js`; `archived` column added by migration 14. **Known existing problem per spec — not fixed.** |
| Items: code, unit, HSN, VAT y/n, purchase rate, sale rate, MRP, reorder, batch-tracked, expiry-tracked | **[PARTIAL]** | `products` (`schema.sql:80`) — has `unit, category, opening_stock, reorder_level, rate, gst_rate, hsn_code, expiry_days, notes`. Missing: item code, separate purchase/sale rate, MRP, batch-tracked & expiry-tracked flags; `gst_rate` is stored but never applied anywhere. |
| Godowns / locations | **[MISSING]** | No table, no `godown_id` on any movement. |
| Routes | **[DONE]** | `routes` table + `shared/operations/routes.js` + `renderer/js/routes_mgmt.js`. |
| Vehicles master | **[PARTIAL]** | No table; vehicle is free text (`routes.assigned_vehicle`, `vehicle_expenses.vehicle_name`). |
| Collection centres | **[PARTIAL]** | `routes.area` only, no separate entity/ledger. |
| Shifts master | **[PARTIAL]** | Hard-coded CHECK `('morning','evening','combined')` in `milk_collections`, `production_batches`. |
| Rate charts: FAT-SNF/CLR matrix, effective-from, **version history**, history recomputed against its own date | **[PARTIAL]** | `milk_rate_chart` + `getEffectiveRate(db,date)` is correctly date-aware (`shared/operations/rates.js:88`), and each `milk_collections` row snapshots `fat_multiplier/snf_multiplier/rate_type` (good). Missing: CLR-based chart, in-place edits overwrite history (only `audit_log` JSON retains the old row), no dedicated version-history table. |
| Price lists per party type / dealer, effective dates | **[MISSING]** | — |
| Chart of accounts + groups/sub-groups | **[MISSING]** | — |

### 2. MILK COLLECTION (PURCHASE)

| Requirement | Status | Where |
|---|---|---|
| Entry screen: date, shift, route, centre, farmer, qty (L/kg + LR conversion), Fat, SNF/CLR, rate auto, override+reason, amount | **[PARTIAL]** | `renderer/js/milk_collection.js`, `shared/operations/milk.js`. Has shift/route/farmer/qty/fat/snf/clr/adulteration/rate_type/override/amount. Missing: collection-centre field, **kg/LR conversion**, override **reason**, no centre entity. |
| Rate auto from chart; override needs reason + permission | **[PARTIAL]** | `getEffectiveRate` + manual fixed-rate path; **no reason capture, no permission gate**. |
| **Fast keyboard-only entry** (code→qty→fat→snf→Enter, no mouse) | **[MISSING]** | Only `milkSearch` keyup (`milk_collection.js:139`). Single-record modal form. |
| Analyser / weighing-scale CSV import | **[MISSING]** | — |
| Bulk/tanker purchase from cooperatives on its own rate basis | **[MISSING]** | `purchases` has no fat/SNF basis. |
| Daily register, shift summary, route summary, centre summary | **[PARTIAL]** | `getMilkSummary` (today, type breakdown, shift breakdown, weekly/monthly, top-5 farmers). No route/centre summary, no printable register. |
| Farmer ledger (collections, advances, deductions, payments, running balance) | **[PARTIAL]** | `parties.getPartyLedger`, `statements.getPartyStatement` (correct running balance). **No deduction concept.** |
| Cycle (10/15-day) payment sheet → approve → post → payout list (cash/bank/eSewa) | **[PARTIAL]** | `farmer.bulkPayFarmers` + `farmer_payment.js`; pays individual collections, no period/cycle, no approval step, no payout-list export. |
| Deductions master: cattle feed, loan EMI, transport, insurance | **[MISSING]** | — |
| Farmer quality report: avg Fat/SNF trend, rejections, CB (sour) rejections | **[MISSING]** | `reports.getFarmerStatement` gives FAT/SNF averages only. |
| **Farmer outstanding / payment screen works for `type='farmer'`** | **[BROKEN]** | `shared/operations/farmer.js:13` filters `p.type IN ('supplier','both')`; the real DB's 6 farmers are all `type='farmer'` → they never appear in the payment screen. |

### 3. PRODUCTION / BATCH

| Requirement | Status | Where |
|---|---|---|
| Batch card: no, date, shift, input raw milk (qty + avg Fat/SNF), standardisation, outputs, packaging consumed, loss %, operator, remarks | **[PARTIAL]** | `production_batches` + `production_inputs` + `production_outputs` + `renderer/js/production.js`. Missing: **avg Fat/SNF**, **standardisation block**, **packaging consumed**, explicit process-loss; `standard_yield_percent` column is never populated. |
| Auto-consume raw milk / auto-receive finished goods | **[DONE]** | `production.js` writes `production_input`/`production_output` stock movements. |
| Yield/recovery report expected vs actual, variance flagged over threshold | **[PARTIAL]** | UI colours <80% red (`production.js:105,378,476`); no report, no configurable threshold, no standard benchmark. |
| Batch traceability (which collections fed a batch; which customers got it — recall) | **[MISSING]** | no lot/batch link between deliveries, batches and sales lines. |
| Expiry/best-before auto-set from manufacture + shelf life | **[MISSING]** | `products.expiry_days` exists but nothing computes or stores a best-before date. |
| Create path works | **[FIXED in uncommitted WIP]** | `production.js` previously did `id = result.lastInsertRowid` on a `const` (crash on every new batch); now `let`. A duplicate `logAudit(...)` call also remains at both ends of `saveProductionBatch`. |

### 4. INVENTORY / STOCK

| Requirement | Status | Where |
|---|---|---|
| Real-time stock by item, **godown, batch, expiry** | **[PARTIAL]** | Item only (`shared/operations/stock.js`). |
| Stock balance correctness | **[BROKEN]** | Balance = `balance_after` of the row with max `id` (`stock.js:20`, `sales.js:71`, `milk.js`, `production.js`) — not ordered by date; any backdated insert silently corrupts every later balance. `getCurrentStock` also returns a second, differently-computed `current_stock` = **inward−outward of the single last movement row**, which is not a balance; the dashboard low-stock query uses that wrong expression (`shared/operations/dashboard.js:112`). |
| Movement types: opening, purchase, production in/out, sale, sales return, purchase return, transfer, damage, free/sample, physical adjustment | **[PARTIAL]** | CHECK allows opening/purchase/sale/adjustment/return_in/return_out/milk_collection/production_input/production_output. Missing transfer, damage/wastage (production wastage is a column, not a movement), free/sample. Live data contains **only** purchase + sale. |
| Valuation FIFO (+ weighted-average setting) | **[MISSING]** | `getStockStatement` values stock as `qty × products.rate` (current master rate) — not FIFO/WA. |
| Crate/container tracking: issued, returned, outstanding per party + ageing | **[MISSING]** | no crate entity or movement. |
| Near-expiry / expired stock report; block sale of expired batches | **[MISSING]** | — |
| Low-stock / reorder alerts | **[PARTIAL]** | dashboard card, computed from the broken expression above. |
| Physical stock count → variance report → approved adjustment | **[PARTIAL]** | `adjustStock` single row with free-text note; no count sheet, no variance, no approval. |

### 5. SALES & DISTRIBUTION

| Requirement | Status | Where |
|---|---|---|
| Route dispatch load sheet (items loaded per vehicle/route/shift) | **[MISSING]** | — |
| Route settlement (sold/returned/damaged/cash/credit) that must balance before close | **[MISSING]** | — |
| Invoice types cash / credit / counter / dealer | **[PARTIAL]** | `sales.payment_mode` enum `cash/credit/bank/upi`; no counter/dealer concept, no route/salesman on sales. Live data: 1405 rows, **100% `credit`** (146 paid / 1259 unpaid). |
| Sales return / credit note; purchase return / debit note | **[MISSING]** | No tables/documents; only a stock-adjustment type dropdown offering Return In/Out (`stock.js:217`). |
| Schemes: qty discount, trade discount, free goods | **[PARTIAL]** | Header-level `discount` + `discount_percent` only; no line-level scheme, no free goods. |
| Daily sales summary by item, route, party, salesman | **[PARTIAL]** | `reports.getSalesReport / getSalesRegister / getTodaySummary`; no route/salesman dimension (not stored on `sales`). |
| **Sequential, gap-free invoice numbering** | **[BROKEN]** | `utils.js:generateInvoiceNo()` = `INV-YYMMDD-<random 000-999>` → duplicates and gaps possible; no unique index, no counter table. Imported data is `BILL-7352 … BILL-7444` with gaps. |
| Manual (no-stock) invoice items | **[DONE – uncommitted WIP]** | migration 18 makes `sales_items.product_id` nullable, `validate.js:isValidSaleItem`, `invoice_generator.js` "✍️ Manual item" option; verified in the running app. |

### 6. RECEIVABLES / PAYABLES

| Requirement | Status | Where |
|---|---|---|
| Party ledger: opening balance, running balance, Dr/Cr | **[DONE]** (with a caveat) | `statements.getPartyStatement` computes a true running balance. Caveat: `ledger_entries.balance` is **not** a running balance — it stores that document's outstanding at write time (`sales.js`, `milk.js`, `farmer.js`), so the column is misleading to any consumer. |
| Payment collection against specific invoices (FIFO or manual), part-payment, on-account | **[PARTIAL]** | `payments.reference_type/reference_id` can point at one document; no allocation table, no partial allocation across invoices, no on-account receipt beyond `type='advance'`. |
| **Ageing report 0–15 / 16–30 / 31–60 / 60+** | **[MISSING]** | `reports.getReceivables/getPayables` + `showOutstandingReport` are flat outstanding lists — **no ageing buckets anywhere** in the code. |
| Credit limit + credit days enforcement with override permission | **[MISSING]** | `credit_limit`/`credit_days` do not exist. |
| Outstanding statement per party, printable/shareable | **[PARTIAL]** | `statements.js` page + print; email via `email.js`/SMTP. |
| Cheque management: received/issued, due date, status, bounce charges | **[MISSING]** | `cheque` exists only as a payment-mode enum value (`validate.js`, `db.js:381`); `excel-import.js:206` maps it to `bank` on import. |

### 7. CASH, BANK & ACCOUNTING CORE

| Requirement | Status | Where |
|---|---|---|
| **Proper DOUBLE-ENTRY engine; every document posts journal entries** | **[MISSING]** | No `chart_of_accounts`, no `journal_entries`/`journal_lines`, no posting engine. `ledger_entries` is a **party sub-ledger only**. Production, expenses, salary, vehicle, petty cash, denominations, cash deposits and bank transactions post to **no ledger at all** → Trial Balance can never balance (DoD item 1 fails by construction). P&L is a hard-coded sum of table totals (`financial_reports.js:31`). |
| Vouchers: receipt, payment, contra, journal, sales, purchase, credit note, debit note | **[PARTIAL]** | receipt/payment = `payments`; sales/purchase write party ledger rows. Contra, journal, CN, DN missing; no voucher-type numbering series. |
| BANK TRANSACTIONS: multiple accounts, deposits, withdrawals, transfers, charges, interest | **[PARTIAL]** | `bank_transactions` + `shared/operations/bank.js` (358) + `renderer/js/bank.js` (357): free-form rows, auto-party matching, review queue, statement, ledger posting. No bank-account master; `cash_deposits` covers deposits only. |
| Bank reconciliation vs statement (manual tick or CSV) | **[PARTIAL]** | `match_status`, `getBankReviewQueue`, `setBankMatch`, `importBankRows`. No formal reconciliation worksheet (opening/closing/unreconciled difference). |
| CASH BOOK with denomination entry (1000…5, coins) counted vs book | **[DONE]** | `denomination_counts` (1000/500/100/50/20/10/5/other/coins + `total_cash`,`expected_cash`,`difference`) + `cash.js`/`cash_deposit.js`; 79 live rows. |
| PETTY CASH: imprest float, top-ups, expense vouchers with category, balance | **[PARTIAL]** | `petty_cash` CRUD + summary + `expense_head`/`approved_by`; **no imprest float / top-up concept**; 122 live rows. |
| EMPLOYEE & PARTY ADVANCES: issue, track, adjust, outstanding report | **[PARTIAL]** | `payments.type='advance'` + ledger `advance`; importer has a one-off `scripts/audit/import-advances.js`. No employee advance module, no adjustment against salary/bills, no outstanding-advance report. |
| Expenses: categories + **cost centres** (plant/transport/admin/sales) | **[PARTIAL]** | `other_expenses.category/expense_head`, `expenses.getExpenseCategories`, separate `vehicle_expenses`. **No cost-centre dimension.** (0 rows live.) |
| Partner/owner capital ledger | **[DONE]** | `partner_capital` + `partners.js` + `renderer/js/partner_capital.js`. |
| Reports: Day Book, Cash Book, Bank Book, Ledger, **Trial Balance**, P&L, **Balance Sheet**, **Cash Flow** | **[PARTIAL]** | Day Book ✔ (`getDaybook`, `getEnhancedDaybook`), Cash Book ✔ (cash.js + denominations), Bank Book ✔ (bank statement), Ledger ✔. **Trial Balance, Balance Sheet and Cash Flow do not exist.** P&L exists as a table-sum accrual estimate (methodology documented in code, but not ledger-driven). |

### 8. NEPAL COMPLIANCE & LOCALISATION

| Requirement | Status | Where |
|---|---|---|
| BS date alongside AD **everywhere**, correct converter, BS picker | **[PARTIAL]** | `renderer/js/nepali-date.js` auto-replaces every `input[type=date]`/`month` with a BS picker; `adToBS` is day-accurate and anchored at 2025-04-14 = 2082-01-01 (verified plausible). Gaps: **no `bsToAD`** (AD-from-BS), calendar table covers **only 2080–2090** then falls back to a fixed month-length array (silent drift outside that window), and **AD is never displayed** — `formatDate()` shows BS only (`utils.js:105`). |
| Nepali fiscal year (Shrawan 1 – Ashadh end) as year boundary; year-end closing + lock + carry-forward | **[MISSING]** | `getDatePreset('this_year')` uses `${BS_year}-01-01` = Baisakh 1, i.e. the calendar year, not the fiscal year. No closing/lock. |
| NPR formatting in lakh/crore | **[PARTIAL]** | `formatCurrency` uses `toLocaleString('en-IN')` → `1,23,456.00` (correct lakh grouping). No Nepali digits. |
| Amount in words, English **and Nepali** | **[PARTIAL]** | `renderer/js/invoice_generator.js` (words helper) + `salary.js`. No Nepali words. |
| VAT 13%: item-level taxable/exempt, VAT purchase book, VAT sales book in IRD format, VAT return | **[MISSING]** | `products.gst_rate` exists and is never used; `tax` is hard-coded `0` in `invoice_generator.js:459`; no VAT books, no return summary. |
| IRD tax invoice / abbreviated invoice: mandatory fields, sequential gap-free numbering, "PRINTED COPY" copy-count marking | **[PARTIAL]** | The Invoice Generator prints a professional "Tax Invoice" with letterhead, party PAN, items, totals, signature (`invoice_generator.js:318,391,609`). Missing: IRD VAT columns/fields, sequential numbering (see §5), copy-count marking. **Hard-coded PAN fallback `'152747352'` is baked into 3 template lines.** |
| Invoice edit/delete after print creates a record, not silent history change | **[PARTIAL]** | `logAudit` on sale update/delete stores old/new JSON. But `audit_log` has **0 rows** in production (all data arrived via import scripts that bypass the ops layer), there is **no IP**, no immutability, and deletes need only `role>=operator`. |
| IRD CBMS real-time billing sync: invoice table + sync queue designed now | **[MISSING]** | No outbox/queue columns on `sales`. |
| TDS on transport / rent / commission | **[MISSING]** | — |
| Bilingual UI (English + Nepali, switchable per user) | **[MISSING]** | `renderer/index.html:2` is `<html lang="en">`; no dictionary/i18n layer; only BS month names are Nepali. |

### 9. USERS, SECURITY & AUDIT

| Requirement | Status | Where |
|---|---|---|
| Roles: Owner/Admin, Accountant, Collection Operator, Production Operator, Store Keeper, Salesman/Route, Read-only | **[PARTIAL]** | `users.role` enum = `admin, operator, accountant, staff, agent`. Role names do not map to the spec's roles. |
| **Permissions per module and per action (view/create/edit/delete/approve/export)** | **[BROKEN]** | `server.js` applies `requireRole()` to only ~25 of 169 routes (mostly `'operator'` on deletes; `'admin'` on user/settings/Excel-import); **everything else is `requireAuth` only**, so any authenticated role can read and most can write. Client-side `data-min-role` + `ROLE_HIERARCHY` (`app.js:87`) is cosmetic navigation hiding, not enforcement. No `approve`/`export` permissions. |
| Field-level locks: rate override, price override, backdated entry, delete voucher | **[MISSING]** | No backdate/lock/override-reason concept anywhere (`grep` for `backdate|lock_date|override_reason` finds nothing). |
| AUDIT TRAIL: who, what, when, old→new, **IP**, immutable, **Admin-only** | **[PARTIAL]** | `audit_log` + `shared/operations/audit.js` called by 15 ops modules. Missing: IP column, immutability (no trigger/revocation), admin-only visibility (nav is `data-min-role="accountant"`), and **`logAudit` is not called at all** in `bank.js`, `cash.js`, `cash_deposit.js`, `farmer.js`, `settings.js`. |
| Entry-date locking; unlocking is logged | **[MISSING]** | — |
| Strong auth: hashed, forced first-login change, session timeout, lockout, optional 2FA | **[PARTIAL]** | scrypt + random salt + `timingSafeEqual` (`shared/auth.js` ✔); `mustChangePassword` when the default is in use ✔; lockout after `MAX_LOGIN_ATTEMPTS=5` with throttle ✔; session TTL + remember-me TTL ✔. Missing: 2FA; `MIN_PASSWORD_LENGTH = 4` is too weak; tokens are in-memory (lost on restart). |
| **No hardcoded credentials, secrets or API keys** | **[BROKEN]** | `server.js:61` `process.env.AUTH_PASSWORD \|\| 'admin123'`; `.env.example:27` ships `AUTH_PASSWORD=admin123` as a value; `shared/auth.js:18` `DEFAULT_PASSWORD='admin123'`; `invoice_generator.js` hard-codes PAN `152747352` three times. |

### 10. REPORTS & EXPORT

| Requirement | Status | Where |
|---|---|---|
| **FIX THE BROKEN PDF EXPORT**: Devanagari embedding, letterhead, page numbers, "Page X of Y", repeating headers, per-page subtotals + carried-forward, correct grand total, tested at 500+ rows | **[BROKEN]** | `utils.js:printHTML()` builds an HTML document in a hidden iframe and calls `window.print()` (web) or renders it into an offscreen `BrowserWindow` + `printToPDF()` (`main.js:1259`). `PRINT_CSS` declares `@page { @bottom-right { content: "Page " counter(page) } }` — **Chromium/Electron ignore `@page` margin boxes, so page numbers never render**; there is no "Page X of Y", no per-page subtotal, no carried-forward line. `thead { display: table-header-group }` ✔ repeats headers. Totals are deliberately moved out of `<tfoot>` into `<tbody>` (`moveTotalsIntoBody`) so they print once — which also means no per-page totals exist. Font stack is `'Segoe UI','Helvetica Neue',Arial` — **no Devanagari font is embedded**, so Nepali text depends on OS fallback and can print as tofu. A harness exists but is unproven: `scripts/audit/test-pdf.js`. |
| Every report: AD **+** BS date range, filters, on-screen, print, PDF, Excel/CSV | **[PARTIAL]** | 30 pages, most have print + PDF buttons (`reports.js`, `financial_reports.js`, `statements.js`). **No per-report Excel/CSV export** — only a global "Export to Daily Account Excel" card (`reports.js:41`) and a separate CSV tool screen. All filters are BS-only. |
| Thermal 58/80 mm and A4/A5 templates; dot-matrix plain text route slips | **[PARTIAL]** | `settings.paper_size` is injected into `@page { size: … }` (`utils.js:342`); options are A4/Legal/Letter. No thermal or dot-matrix templates. |
| Dashboard: today's collection (L, avg Fat/SNF), production, sales, cash in hand, bank balance, receivables, payables, near-expiry, top-10 outstanding | **[PARTIAL]** | `dashboard.js` + `dashboard.js` op: today's sales/purchases, receivables, payables, net receivable, low stock, monthly chart, recent transactions. **Missing: today's collection (L + avg Fat/SNF), today's production, cash in hand, bank balance, near-expiry stock, top-10 outstanding parties.** |
| Comparative reports: MoM, YoY | **[PARTIAL]** | `getProfitLossByMonth` gives BS month-on-month. No year-on-year. |

### 11. DATA MIGRATION

| Requirement | Status | Where |
|---|---|---|
| Template-driven import: downloadable Excel template, validation, **dry-run preview**, row-level error report, all-or-nothing per batch, re-runnable without duplicates | **[PARTIAL]** | `shared/data-csv.js` defines per-table columns + `/api/data-csv/sample` + export/import; `shared/excel-import.js` (1444) is a bespoke importer for the customer workbook with dedupe by invoice/bill no and per-section logs. Missing: downloadable template for the six master/opening datasets, **dry-run preview**, **row-level error report**, **all-or-nothing batch semantics**. |
| Reconciliation report: imported totals vs source workbook, line by line, for sign-off | **[PARTIAL]** | `scripts/audit/verify-vs-excel.js` compares app ledger balances against the workbook's `Receivable_Payable` sheet (ground truth). CLI only, single dataset, no customer sign-off artefact. |

### 12. RELIABILITY & DEPLOYMENT

| Requirement | Status | Where |
|---|---|---|
| Daily automated backup, 30-day retention, **off the app server** | **[PARTIAL]** | `main.js:startAutoBackup()` runs **hourly, desktop-only, only while a user is logged in**. `backup.MAX_BACKUPS = 20` is a **count**, not 30 days. Backups go to `<dbdir>/backups` — the same disk as the database. **Web mode has no scheduler at all.** |
| One-click manual backup + download | **[DONE]** | Settings → Manual Backup; `/api/backup`, `/api/backup/list`, `/api/backup/download`. |
| Documented **and actually tested** restore, proven on a clean environment | **[PARTIAL]** | `ops.restoreDatabase` + safety pre-restore copy + Settings restore button (`settings.js:788,869`). `HANDSOVER.md` §5 covers backups. **No documented drill and no evidence of a restore to a clean environment.** |
| Atomic transactions (failed sale never leaves stock reduced with no invoice) | **[DONE]** | `db.transaction()` wraps save/delete in sales, purchases, milk, production, payments, farmer bulk pay, stock adjust, products, parties, expenses, salary, vehicle, petty cash, denominations, cash, cash_deposit, routes, rates, settings, bank import. |
| Concurrent users: row locking / optimistic concurrency on stock and **voucher numbering** | **[MISSING]** | No version column, no unique index on `sales.invoice_no` / `purchases.bill_no` / `payments`, no counters table, no `busy_timeout` tuning. Numbering is random (invoice) or timestamp-derived (`petty_cash.js:113 'PC-'+Date.now()`). |
| Graceful behaviour on poor internet: draft autosave, clear retry, no silent loss | **[MISSING]** | No draft/queue/retry layer; `api.js` fetch failures surface as toasts only. |
| Health check + error logging + **admin-visible error log** | **[PARTIAL]** | `GET /api/health` exists and is exempt from auth (`server.js:859`) ✔; `uncaughtException`/`unhandledRejection` handlers log to console (`server.js:1782`). No log file/persistence, no error table, no admin error-log screen. |
| Environment-based config; separate staging and production databases | **[PARTIAL]** | `dotenv` with `PORT/HOST/AUTH_USERNAME/AUTH_PASSWORD/DB_DIR/NODE_ENV` and `render.yaml`. No staging/prod separation strategy beyond `DB_DIR`. |

### 13. UX POLISH FOR HANDOVER

| Requirement | Status | Where |
|---|---|---|
| Data-entry screens optimised for speed and keyboard (collection used twice daily) | **[MISSING]** | Collection is a modal form; no keyboard row-entry grid (see §2). |
| Consistent validation, clear non-technical messages | **[PARTIAL]** | `shared/validate.js` covers 19 document types with plain-language messages. But `safeRun` returns raw `err.message` to the client (`server.js`), so SQLite errors reach users verbatim. |
| Confirmation dialogs on destructive actions; undo where feasible | **[PARTIAL]** | `confirmAction()` used broadly. **Bug:** its Cancel/X/overlay paths never call `resolvePromise`, so the promise can hang (`utils.js:186-207`). |
| Works on a low-end office PC and on a phone/tablet | **[PARTIAL]** | `viewport` meta ✔ and `@media (max-width: 900px / 600px)` rules exist (`style.css:1276,1288`). No mobile route/collection screens; no performance budget. |
| Loading and empty states; no raw stack traces ever shown | **[PARTIAL]** | `safeRun` returns `error.message` (no stack) ✔; empty states exist in some tables, loading spinners are inconsistent. |

---

## 3. Definition of Done — current verdict

| # | Check | Verdict today |
|---|---|---|
| 1 | Trial Balance balances to zero | **Cannot pass** — no double-entry ledger, no chart of accounts. |
| 2 | Stock ledger closing = physical stock (3 sample items) | **Fails** — Mix Milk −26,385.5 L; Ghee/NAUNI/PANEER negative. |
| 3 | Farmer ledger = collections − (payments + deductions) | **Partly verifiable** — deductions don't exist; farmer payment screen hides `type='farmer'`. |
| 4 | Ageing report = party ledger closing balance | **Cannot pass** — no ageing report. |
| 5 | Milk reconciliation: collected = processed + loss + closing raw stock | **Cannot pass** — 0 collections, 0 batches, no reconciliation report. |
| 6 | 500-row PDF with correct Nepali text, per-page totals, correct grand total | **Fails** — no page numbers, no per-page subtotals, no Devanagari embedding. |
| 7 | Backup deleted from server, restored successfully, data intact | **Unproven** — restore code exists; drill never documented/tested. |
| 8 | Each role can do exactly what it should, and nothing more | **Fails** — 144 of 169 routes enforce no role at all. |
| 9 | Backdated entry, rate override, voucher delete appear in audit trail | **Fails** — backdate/override concepts absent; `audit_log` empty; no IP. |
| 10 | Full BS/AD consistency across entry, filters, printed reports | **Fails** — AD never displayed; `bsToAD` missing; calendar data ends at 2090. |
| 11 | No console errors, no unhandled rejections, no N+1 on main lists | **Unverified** — never measured; `listSales`/`getFarmerOutstanding` do per-row sub-queries (N+1 pattern). |

---

## 4. Highest-severity defects found (evidence-backed)

1. **No double-entry engine** → Trial Balance / Balance Sheet / Cash Flow impossible, P&L is a table-sum approximation. (`financial_reports.js`)
2. **Role enforcement missing on 144/169 routes** → any user can read/alter anything the UI doesn't hide. (`server.js`)
3. **Stock balances are order-fragile and one query is simply wrong** → negative balances already in production. (`stock.js:20`, `dashboard.js:112`)
4. **Invoice numbering is random** → IRD non-compliance and duplicate invoices. (`utils.js:generateInvoiceNo`)
5. **PDF export cannot print page numbers or reliable Devanagari** → owner's stated priority is not met. (`utils.js:PRINT_CSS`)
6. **Farmer payment screen excludes `type='farmer'`** → the entire farmer payout workflow is invisible in the real database. (`farmer.js:13`)
7. **`package.json` deleted** → the app cannot be installed, started via npm, or built.
8. **Hardcoded credentials/PAN** (`admin123` fallback, `.env.example`, `'152747352'`) → security and correctness defect on customer-facing invoices.
9. **`audit_log` not written for bank/cash/cash_deposit/farmer/settings** and empty in production → no audit trail in practice.
10. **Migrations are unversioned destructive probes** run on every startup against live customer data, with no rollback. (`shared/db.js`)
11. **`cash_collections` missing from `schema.sql`** → fresh install ≠ production schema.
12. **Schema is missing every batch/lot/expiry/godown dimension** → expiry, recall and traceability requirements are structurally impossible today.
13. **`AD` dates absent and BS calendar table ends at 2090** → silent date drift risk after 2090 BS and no BS/AD pairing.
14. **`confirmAction()` can leave a promise unresolved** on cancel/overlay. (`utils.js:186`)

---

## 5. Proposed implementation order (riskiest / most foundational first)

> Rule applied throughout: **no schema change without a numbered, reversible migration and a written backfill plan; every phase ends with its verification checklist shown to you.**

### Phase 0 — Unblock and protect the customer's data (do first, ~half a day)
0.1 Restore `package.json` from `HEAD` (or confirm it was deleted deliberately) so install/build work again.
0.2 Take a verified backup, then **rehearse a restore into a clean environment and record the evidence** (protects everything that follows; also closes DoD #7).
0.3 Review and commit-or-revert the uncommitted milk/manual-item WIP so later migrations start from a clean, known tree.

### Phase 1 — Foundations (everything else depends on these)
1.1 **Migration framework**: `schema_migrations` table, numbered `up`/`down` files, data-backfill step per migration, and removal of the insert-probe pattern. Also adopt `cash_collections` into `schema.sql`.
1.2 **Integrity of money and stock**: rebuild `balance_after` from ordered movements (SUM-based source of truth), fix `getCurrentStock`, fix the dashboard low-stock query, add a document-numbering service (counters table + unique indexes) for sales/purchases/payments/journals.
1.3 **Permission matrix** (module × action, incl. approve/export) enforced server-side on every route, and reused by the nav so UI and server can never disagree.
1.4 **Double-entry core**: `account_groups` + `chart_of_accounts` + `journal_entries`/`journal_lines` + posting engine; backfill opening balances from existing party ledgers; wire sales, purchases, payments, production, expenses, salary, vehicle, petty cash, cash deposits and bank transactions into it. *This is the single largest change and it unblocks Trial Balance, Balance Sheet, Cash Flow and a correct P&L.*

### Phase 2 — Masters
2.1 Party master completion (Nepali name, credit limit/days, active flag, bank/eSewa, employee & transporter types) **plus the duplicate-detection + merge tool** with fuzzy match, preview, transaction re-pointing and an audit record.
2.2 Item master completion (item code, purchase/sale rate, MRP, batch-tracked, expiry-tracked, VAT-applicable) + godowns, vehicles, collection centres, shifts, price lists.
2.3 Rate-chart version history + CLR basis + effective-from management.

### Phase 3 — Milk collection (the customer's core daily process)
3.1 Keyboard-only fast-entry grid.
3.2 Deductions master + 10/15-day cycle payment sheet → approve → post → payout list (cash/bank/eSewa).
3.3 Fix the farmer-outstanding party-type bug; make farmer ledger reconcile with collections − payments − deductions.
3.4 Registers + shift/route/centre summaries + quality report (avg Fat/SNF trend, CB rejections).
3.5 Analyser/scale CSV import; cooperative tanker purchase on its own rate basis.
3.6 Milk reconciliation report (in = processed + loss + closing).

### Phase 4 — Production and inventory depth
4.1 Batch card v2 (avg Fat/SNF, standardisation, packaging consumed, process loss %, configurable standard yield).
4.2 Batch/lot tracking + expiry auto-set + near-expiry/expired reports + block sale of expired batches.
4.3 Traceability backward (which collections fed a batch) and forward (which customers received it) — recall-ready.
4.4 FIFO valuation with weighted-average setting; godown transfers; damage/free-sample movements; physical count sheet → variance → approved adjustment.
4.5 Crate/container tracking with per-party ageing.

### Phase 5 — Sales & distribution
5.1 Route dispatch load sheet; 5.2 route settlement that must balance before closing.
5.3 Sales return/credit note and purchase return/debit note as real documents.
5.4 Line-level schemes, trade/qty discount, free goods; counter/dealer invoice types; route + salesman on sales.
5.5 Payment collection with invoice allocation (FIFO or manual), part-payments, on-account receipts.
5.6 Ageing buckets 0–15/16–30/31–60/60+; credit-limit/days enforcement with override permission; cheque register with due date, status and bounce charges.
5.7 Bank master, transfers/charges/interest, formal reconciliation worksheet.

### Phase 6 — Nepal compliance
6.1 `bsToAD` + BS↔AD display everywhere + calendar data beyond 2090 + BS date range filters on every report.
6.2 Nepali fiscal year (Shrawan 1 – Ashadh end), year-end closing with carry-forward and year lock.
6.3 Amount in words (English + Nepali), Nepali digits, and the EN/NP UI switch.
6.4 VAT 13% item-level + IRD-format VAT purchase/sales books + VAT return summary.
6.5 IRD-compliant tax/abbreviated invoice, sequential gap-free numbering, copy-count marking; post-print edit/delete as materialised audit records.
6.6 CBMS sync-queue design (invoice outbox) and TDS on transport/rent/commission.

### Phase 7 — Reporting, PDF and dashboard (owner's priority)
7.1 **PDF export rebuild**: embedded Devanagari font, letterhead, "Page X of Y", repeating headers, per-page subtotals with carried/brought-forward, correct grand total; proven on a 500+ row statement.
7.2 Excel/CSV export on every report; AD+BS range on every filter.
7.3 Thermal 58/80 mm, A4/A5 and dot-matrix plain-text route-slip templates.
7.4 Dashboard completion (today's collection with avg Fat/SNF, production, cash in hand, bank balance, near-expiry, top-10 outstanding) + MoM and YoY comparatives.

### Phase 8 — Reliability, migration tooling, UX and handover pack
8.1 Backups: scheduler in web mode too, 30-day age-based retention, off-server destination, documented + rehearsed restore.
8.2 Concurrency: transactional numbering with unique indexes, optimistic version columns, WAL/busy-timeout tuning.
8.3 Offline resilience: draft autosave, retry with clear messaging, no silent loss.
8.4 Error log table + admin-visible error log; no raw SQLite errors to users; staging/production DB separation.
8.5 Migration tooling: downloadable templates, dry-run preview with row-level error report, all-or-nothing batches, re-runnable; per-dataset reconciliation report against the source workbook for sign-off.
8.6 UX: keyboard-first entry, confirm-dialog fix, loading/empty states, low-end-PC and mobile tuning.
8.7 Deliverables: schema diagram, migration files, deployment + backup/restore runbook, bilingual user manual with screenshots, UAT checklist.

---

## 6. Verification checklist per module (to be run and shown after each phase)

**Phase 0**: `npm install` succeeds; `npm start` serves; `get /api/health` answers; backup file created; restore into a clean directory reproduces row counts for all 28 tables; app reads the restored DB.
**Phase 1.1**: `schema_migrations` lists every applied migration; each has a working `down`; a fresh DB built from `schema.sql` matches production table-by-table (including `cash_collections`).
**Phase 1.2**: `SUM(inward−outward)` equals the last `balance_after` for all 12 products; inserting a backdated movement leaves every later balance correct; 1000 invoices issued with zero duplicates and no gaps; unique index rejects a duplicate invoice number.
**Phase 1.3**: a matrix test — every role × every route — asserting exactly the allowed actions succeed and the rest return 403.
**Phase 1.4**: Trial Balance nets to **0.00** on the real imported data; journal lines for a sale/purchase/payment/production/expense voucher balance; party sub-ledger closing balances equal the corresponding control accounts.
**Phase 2**: duplicate scan finds the known duplicate parties and merge re-points sales/purchases/payments/milk/ledger/bank rows with an audit row; merged party ledger equals the sum of both.
**Phase 3**: farmer ledger = collections − payments − deductions for 3 farmers; a 15-day payment sheet posts to the ledger and prints/export in cash, bank and eSewa formats; 60 collections entered keyboard-only without a mouse; milk reconciliation closes to zero.
**Phase 4**: batch yield variance flagged above threshold; expiry auto-set from manufacture + shelf life; near-expiry report lists the right items; expired batch cannot be sold; traceability walks batch → collections and batch → customers; FIFO value recomputed and reconciled to the stock statement.
**Phase 5**: load sheet = sold + returned + damaged + closing, settlement refuses to close on imbalance; credit-note and debit-note post correctly; ageing buckets sum to the party ledger closing balance (DoD #4); over-limit invoice blocked then allowed with an override that appears in the audit trail; cheque status transitions recorded.
**Phase 6**: BS↔AD round-trip is lossless across 2080–2095 including 32-day months and Shrawan 1 year boundaries; closed year refuses postings; VAT book totals match item-level VAT; invoice numbering is sequential and gap-free with "PRINTED COPY" on reprints; audit trail shows the post-print edit.
**Phase 7**: 500-row statement PDF opens in Acrobat with correct Nepali, "Page X of Y", per-page subtotals, carried-forward lines and a grand total equal to the on-screen total; every report exports to Excel and CSV.
**Phase 8**: 30 days of backups retained and one deleted-and-restored successfully; off-server copy verified; two concurrent writers cannot duplicate a voucher number; killing the network mid-save loses nothing; admin error log shows the failure; no console errors on a full click-through of all 30 pages.

---

## 7. Data Integrity Doctor (built, 2026-09-19) and what it found

The first safety-net deliverable from Phase 0/1 is in place: a **read-only**
integrity doctor that re-derives stock from `stock_movements`, re-derives every
party balance from that party's documents, and cross-checks every document
against the stock and ledger rows it should have produced.

- Engine: `shared/operations/integrity.js` — 34 checks, every statement a
  `SELECT`/`PRAGMA` (the module refuses anything else; verified by test).
- UI: Administration → 🩺 **Data Integrity** (`renderer/js/integrity.js`),
  endpoint `POST /api/integrity/run` (accountant+), IPC `db:integrity:run`.
- CLI: `node scripts/audit/integrity-doctor.js [dbPath] [--only=…] [--json]`
  (exits 1 when any check fails, suitable for a scheduled job).
- Run on the live DB: **34 checks · 23 pass · 11 fail · 805 findings · ~0.4 s**.

Findings that change the gap report (all need a decision before handover):

| # | Finding | Evidence |
|---|---|---|
| D1 | **Negative closing stock on 4 products** — Mix Milk −26,385.50 L, NAUNI −143.50 kg, PANEER −57.50 kg, Ghee −49.50 kg. | `stock_negative_closing`; matches B3, now quantified |
| D2 | **Opening balance is counted twice** wherever a party has both `parties.opening_balance` and the `opening` ledger row `saveParty` posts — statements and receivables inflate by that amount. | `party_opening_vs_ledger` / `party_ledger_vs_documents`; `getPartyStatement` + `listPartiesWithBalance` both add `opening_balance + Σ(debit−credit)` |
| D3 | **44 parties where the ledger and their documents disagree** (e.g. AAMOSH KIRANA +66,300; BASUDEV DAIRY +4,74,131) — imported opening/adjustment rows with no document behind them. | `party_ledger_vs_documents` |
| D4 | **204 documents with no ledger entry at all** — mostly imported "paid to PETTY CASH" payments; 1,402 of 1,405 sales are only reachable through the importer's number-based references. | `missing_ledger_entry` |
| D5 | **73 genuine double postings** plus **326 reused reference numbers** (`ledger_entries.reference_id` is TEXT in production — the importer wrote `OPN-1001`, the app writes row ids). One column, two conventions. | `duplicate_ledger_posting`, `ledger_reference_collision` |
| D6 | **95 malformed ledger rows** (both debit and credit zero, or both filled). | `ledger_row_shape` |
| D7 | **38 sales and 4 purchase bills whose line amounts do not match the header**; **28 stock-quantity mismatches on those invoices**. | `sale_items_vs_subtotal`, `purchase_total_coherence` |
| D8 | `schema.sql` is missing `cash_collections` (runtime-created) — already listed as B4, now machine-checked. | `schema_drift` |
| D9 | **`audit_log` is empty** while 1,597 documents exist and several show `updated_at ≠ created_at` — no who/what/when history at all. | `audit_trail_coverage` |
| D10 | New security note (found while verifying the screen): deleting a user does **not** invalidate their live session — in-memory tokens keep working and `requireAuth` falls back to a generic **admin** role when the token's user is gone (`server.js` ~748). | observed live; also listed under §9 |

Clean on the live data: SQLite file integrity, foreign keys, stock closing
balances vs movements, running balances, delete/edit reversals, document numbering
and VAT-free header arithmetic.

The same engine returns **all green** on a purpose-built correct data set (sales,
purchases, collection with edit, production batch, partner capital, deletes) — so
its 805 live findings are data problems, not check noise.

---

## 8. Awaiting your approval

No implementation code has been written. On your approval I will start with **Phase 0 (unblock + prove restore) and Phase 1.1 (migration framework)**, in small commits, reporting the Phase 0 and Phase 1.1 verification results before moving on.
