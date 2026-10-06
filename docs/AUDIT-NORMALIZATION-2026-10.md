# MASTER NORMALIZATION AUDIT — Accounting + Stock + Bank + Purchase + Milk Collection

Date: 2026-10-05 · Branch: `master` · Precedes all code changes (audit-first rule).
Companion to `docs/AUDIT-FACTORY-STOCK-RECON.md` (v1.4.22 round).

---

## A. EXCEL AUDIT — `Dairy_Accounts_Professional.xlsx`

**A1. Stats (requirement 46A)**

| Metric | Value |
| --- | --- |
| Sheets | **26** (25 data/report sheets + `BS_AD_Lookup` calendar reference) |
| Rows reviewed (all sheets, incl. headers/titles) | **24,337** |
| Columns reviewed | **271** |
| Transaction rows classified (source transactions, excl. derived sheets) | **≈ 11,100** |
| Unclear transactions | **43** in `Party_Ledger` (2 TOTAL rows + 41 bank-transfer rows whose Txn Type cell holds a party name — all resolvable from Description, e.g. "ONLINE TRANSFERRED TO MODERN AGRO"); 1 junk `0` row in `Collection`; all other sheets fully classified |

**A2. Sheet inventory (source vs derived)**

*Source transaction sheets:*
- `Purchase_Entry` — 1,157 lines: **1,112 raw-milk procurement** (Cow 663 / Buffalo 418 / Mix 31, with FAT/SNF, Rate Type FORMULA 719 / FIXED 420) + 45 non-milk (DISSEL, NAUNI, Ghee, Paneer, Cream, SMP, Dana, 4 OPENING). PayMode: 100% Credit; Status PAID 713 / Unpaid 426. Milk amount ≈ Rs 3,126,390.
- `Sales_Entry` — 2,280 lines (Mix Milk 1,906, Cow 143, NAUNI 73, GHEE 68, PANEER 29, CREAM 8, 19 OPENING, 1 `ELECTRICITY` non-product line, 2 REPLACE). Net ≈ Rs 4,471,774. All Credit; 1,667 Unpaid.
- `Collection` — 1,606 customer-payment rows: Collection 1,206 · Petty Cash transfers 71 · **Advance 3 · ADVANCE RETURNED 1 (NAR BAHADUR RANA 33,000)** · junk `0` 1. Collected sum Rs 6,863,520.
- `Party_Ledger` — 9,361 rows / 4,807 with amounts: Sale 2,281 · Collection 1,228 · Purchase 1,157 · **OFFICE EXPENSES 83 · Petty Cash 71 · Advance 63 (all debit, Rs 315,040)** · BANK 17 · Payment 9 · opening/misc.
- `PETTY CASH` — 165 rows: **OFFICE EXPENSES 72 (Rs 223,288) · Advance 60 (Rs 315,040)** · Collection 22 · Payment 9 · junk 1.
- `BANK RECON` — 88 rows: Supplier Payment 31 · Customer Collection 14 · own-account transfers 9+8 · Bank Charge 1 · Water Bill 2 · deposit note 1. Accounts: PRARAMBHA 34 / Sushil QR 23.
- `Cash_Demon` — 167 daily denomination counts.
- `Salary Advance` — 9 salary rows, 3 employees (DIPAK NEPAL 15,000 · SARASWATI RAYMAJHI 10,000 · NAR BAHADUR RANA 11,000/22,000); advances-in-salary 12,500; **data bugs: rows 5/6/8/9 carry month `2083-03` where remarks say SHRAWAN/BHADRA, and Net 11,000 vs Basic 10,000 inconsistencies**.
- `Party_Master` — 493 parties (Customer/Supplier/Employee).

*Derived/report sheets:* `Dashboard`, `Profit_Loss`, `Receivable_Payable`, `Party_Statement`, `Daybook`, `Stock_Master` (9 products), `Stock_Statement`, `Printable_Invoice`, `Settings`, `README`, `Error Log` (21 review items), `Reconciliation Report` (13 checks, all OK), `Import Log`, `Change Log`, `Printable Party Statement`, `Verified Transaction Ledger` (65-row unified audit trail).

**A3. Data-mapping findings (requirement 47)**

1. Excel has **no separate "Milk Purchase" concept** — raw milk lives in `Purchase_Entry` with FAT/SNF columns; the app's importer (`classifyMilkLine`) already splits it into Milk Collection vs Purchase. `purchase_items` in the DB contain **zero milk rows** ✓.
2. Advances exist in **three** Excel places (PETTY CASH 60 · Party_Ledger 63 · Collection 1 returned) totalling Rs 315,040 given + Rs 33,000 returned.
3. Salary exists only in `Salary Advance` (9 rows → 4 unique employee-months after dedup).
4. Office expenses exist in `PETTY CASH` (72) + `Party_Ledger` (83). Electricity appears as an *expense line* ("ELECTRICITY ASHADH-2083" Rs 12,000, "SRAWAN ELECTRICITY BILL" Rs 10,000) — **not** as a product (except one Sales_Entry `ELECTRICITY` line, not imported as product).
5. Precision artifacts present: `82.14999999999999` (milk rate, id 19) and `11788.525` (= 143.5 × 82.15, 3 dp).

---

## TRANSACTION CLASSIFICATION MATRIX (requirement 2 — from actual Excel records)

| Excel record (sheet → row type) | Correct module | Debit | Credit | Stock effect | P&L effect | Bank/Cash | Rec./Pay. | In ERP today |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Purchase_Entry` milk line (Cow/Buffalo/Mix, FAT/SNF) | **Milk Collection** | Raw Milk Inventory | Farmer/Supplier Payable | +Milk L | none | later on payment | payable ↑ | ✅ `milk_collections` (1,112 lines imported) |
| `Purchase_Entry` non-milk line (DISSEL, NAUNI, Ghee, packaging…) | **Purchase** | Inventory/Purchase | Supplier Payable | + if stock item | cost | later on payment | payable ↑ | ✅ `purchases` (45 lines → purchase_items) |
| `Collection` Type=Collection | Receipt | Cash | Receivable | none | none | Cash + | rec. ↓ | ✅ `payments type=receipt` |
| `Collection` Type=Advance | Advance | Advance Receivable | Cash | none | **none** | Cash − | adv. asset ↑ | ✅ typed `transaction_type='advance'` (D1 fixed) |
| `Collection` Type=ADVANCE RETURNED (33,000) | Advance Returned | Cash | Advance Receivable | none | none | Cash + | adv. asset ↓ | ✅ typed `advance_returned` (D1 fixed) |
| `Collection` Type=Petty Cash / customer `PETTY CASH` (71+3 rows) | **Internal cash transfer** (counter → petty box) | none — cash stays cash | none | none | none | Cash ± (same bucket) | none | ✅ skipped by importer + legacy rows voided (defect D13, Migration 29) |
| `PETTY CASH` Type=OFFICE EXPENSES | Expense | Electricity/Rent/etc. Expense | Cash | none | **expense ↑** | Cash − | none | ✅ imported (D14), head = description (D8), advances excluded from P&L (D2) |
| `PETTY CASH` Type=Advance | Advance | Advance Receivable | Cash | none | **none** | Cash − | adv. asset ↑ | ✅ counted once as cash out, tagged in register (D1/D2 fixed) |
| `BANK RECON` Supplier Payment | Payment | Supplier Payable | Bank | none | none | Bank − | payable ↓ | ✅ `bank_transactions` + idempotent ledger match |
| `BANK RECON` Customer Collection | Receipt | Bank | Receivable | none | none | Bank + | rec. ↓ | ✅ |
| `BANK RECON` Bank Deposit (own) / transfer | Cash Deposit / Transfer | Bank | Cash | none | none | internal | none | ✅ `cash_to_bank_transfer`, never income |
| `BANK RECON` Bank Charge / Water Bill | Expense (bank-paid) | Expense | Bank | none | expense ↑ | Bank − | none | ✅ `accounting_class=expense` |
| `Sales_Entry` product line | Sales | Cash/Receivable | Sales | −finished goods | Revenue + COGS | Cash + | rec. ↑ | ✅ `sales` (+ lot COGS) |
| `Salary Advance` row | Salary | Salary Expense | Cash | none | expense ↑ | Cash − | none | ⚠️ only 2 of 4 employee-months imported (defect D6) |
| Opening balances (`OPN-*`) | Opening | party opening | — | — | — | — | opening | ✅ opening import |
| `Party_Ledger` ONLINE TRANSFERRED… (41 rows) | Bank transfer / supplier payment | see BANK RECON | | none | none | bank ± | — | ✅ covered by BANK RECON import (no double) |

---

## B. EXISTING ERP FEATURE AUDIT (requirement 46B)

| Feature | Exists | Working | Location | Action |
| --- | --- | --- | --- | --- |
| Milk Collection | ✅ | ✅ | `operations/milk.js`, `renderer/milk_collection.js`, rate via `rates.js`/`milk_rate_chart` | none (verify only) |
| Milk = raw-milk procurement (no dup Purchase) | ✅ | ✅ | `excel-import.js classifyMilkLine` + `backfillMilkCollectionsFromPurchases`; `purchase_items` milk = 0 | none |
| Purchase | ✅ | ✅ | `operations/purchases.js`, `renderer/purchases.js` | none |
| Farmer Payment (settles payable) | ✅ | ✅ | `farmer.js` + `farmer_payment.js` (bulk settle) | ✅ linked bank txn (D10/M33) |
| Payment types (expense/advance/loan) | ✅ | ✅ | `payments.js`, `accounting.getPaymentPostingRule` | ✅ backfilled (D1/M28) |
| Bank Transaction | ✅ | ✅ | `operations/bank.js` (txn_uid, idempotent post, classify) | ✅ date filter (D3) + payment link (D10) |
| Cash Deposit | ✅ | ✅ | `operations/cash_deposit.js` + `bank_txn_id` link | ✅ date filter (D4) |
| Advance | ✅ | ✅ | `accounting.getAdvanceRecoveryRegister`, `renderer/advances.js` | ✅ backfilled + tagged (D1/M28); P&L exclusion (D2) |
| Production (multi-output, joint cost) | ✅ | ✅ | `production_costing.js` (`PASTEURIZE_AND_SEPARATE`), `production.js` outputs UI | none (verify only) |
| Product Master CRUD | ✅ | ✅ | `operations/products.js`, `renderer/stock.js` | ✅ archive/code/flags (D7/M32), expense-name guard |
| Product rate + history | ✅ | ✅ | `products.rate` + `product_rate_history` (M32); milk chart in `rate_charts.js` | ✅ rate-adjustment history (D9) |
| Employee Master | ✅ | ✅ | `salary.js` ops + Master Data → Employees screen | ✅ screen + merge (D6/M31) |
| Salary | ✅ | ✅ | `salary.js` + `renderer/salary.js` | ✅ employee_id linkage + dedup (D6), 9/9 rows |
| Stock (current) | ✅ | ✅ | `stock.js` / `getStockCurrent` | ✅ Today's Stock panel (N16/N44) |
| Stock Ledger / Statement | ✅ | ✅ | `dairy_costing.getStockLedger` + Stock Statement 3 views + presets (v1.4.22) | none |
| Date Filter (shared) | ✅ utils | ✅ | `renderer/js/utils.js` (`getDatePreset/datePresetBar` + shared page-filter store) | ✅ central fix of consumers (D3/D4/D5) |
| Gross Margin/L | ✅ | ✅ traced | `dairy_costing.getDailySalesRealization`: numerator = milk net sales (gross − discount share − returns @invoice rate); denominator = **net milk litres sold (qty − returns)**; products = category Milk only; COGS = lot consumptions, `lot_costing_active` honesty flag; per-day | none — formula confirmed per req 38 |
| Reconciliation | ✅ | ✅ | `company_ledger.js` 9 checks + suites | keep consistent while fixing D2 |
| Duplicate-transaction logic | ✅ | ✅ | bank `txn_uid` UNIQUE + 10s guard; payments `findPayment`; 41/41 dup tests | none |
| BS/AD conversion | ✅ | ✅ | `nepali-date.js`, `shared/excel-import toBSDate/adToBS/bsToAD`, server DATE_FIELDS | none |
| Reports (P&L, daybook, receivable/payable…) | ✅ | ✅ | `financial_reports.js` | ✅ P&L advances exclusion (D2) |

---

## C. DEFECT LIST — root causes (found, not guessed)

> **Status (2026-10-07, v1.4.23): all defects D1–D14 + N-items implemented and verified.**
> D1 ✅ (M28) · D2 ✅ · D3/D4/D5 ✅ (shared page-filter store) · D6 ✅ (M31, Employees screen, 9/9 salary rows) · D7/D9 ✅ (M32 products + rate history) · D8 ✅ (M30) · D10 ✅ (M33 payment↔bank link) · D11 ✅ (round2 write paths) · D12 ✅ · D13 ✅ (M29) · D14 ✅ · N16/N44 ✅ (Today's Stock panel).

**D1 — Advance tab shows zero records (req 24/25).** The Excel import (`importPettyCashSheet`) inserts `payments` rows with `type='advance'` but **never sets `transaction_type`** (column absent from the INSERT), and in fresh mode skips ledger posting because `Party_Ledger` sheet rows already carry the advances — as **untagged** rows. `getAdvanceRecoveryRegister` only sees ledger rows tagged `[Advance Receivable]` ⇒ 0 lots, despite **60 advance payments (Rs 316,140) + 63 ledger debit rows**. The Rs 33,000 `ADVANCE RETURNED` row was imported as a plain `receipt` (its Type cell never read). Verified: **all 60 payments match an existing untagged ledger debit 1:1 by (party, amount)** — so they can be *linked/tagged* without changing any balance.

**D2 — Advances leak into P&L (req 25/26).** `getExpenseSummary` sums **all** `petty_cash` rows (incl. 60 × Rs 316,140 advance rows) ⇒ P&L expense overstated. Same for `getProfitLossByMonth` (petty groupSum) and `company_ledger.js` (petty rows posted as category *Expense*). Worse, in `getCashBankPosition` the same advances are counted **twice with opposite signs**: as cash **IN** (`type IN ('receipt','advance')`) and as cash **OUT** (`petty_cash` sum). Bank side has the same sign bug (`bankReceiptsDoc` includes `type='advance'` as bank inflow).

**D3 — Bank date filter "Ashoj 1 → Ashoj 19" (req 22, confirmed).** Backend honours `from_date/to_date`. The bug is UI: `refreshBank()` fetches the custom range, then calls `renderBank()`, which **re-reads `getDatePreset('this_month')` and re-fetches**, discarding the query *and* resetting the From/To inputs. Same defect in: cash deposit, cash collection, cash denominations, expenses, vehicle. (`petty_cash` already has the correct pattern via stored `pettyCashFilter`; salary drops the search text after refresh.)

**D4 — Cash Deposit filter:** identical reset via `renderCashDeposit()` (req 23).

**D5 — Date filter is decentralized (req 41):** shared utility exists (`renderer/js/utils.js`) but six screens bypass it with render-time presets. Fix belongs in the shared layer + consumers, not per-screen hacks.

**D6 — Salary/employee duplication (req 27–29).** Backend CRUD exists end-to-end (IPC + API) but **no Employees screen** — records can't be edited/merged from the UI. `salary_records` stores free-text `employee_name` with no `employee_id` linkage; `saveSalaryRecord` never resolves against the master; Excel importer's `findEmp` creates a **new employee whenever the name differs only by case/spelling** (`SARASWATI RAYMAJHI` vs master `Sawaswati Rayamajhi` → new row on every import). No code anywhere appends " 2" — such variants enter through free-text entry; "10000" is a salary amount typed into the name field (no validation). Current DB: 3 employees (Dipak Nepal, Sawaswati Rayamajhi, Nar Bahadur Rana — exact spellings), but only **2 of 4** Excel salary records imported (Dipak & Saraswati rows dropped).

**D7 — Product master gaps (req 10/11/33/45). ✅ FIXED (Migration 32)** — No `active`/archive flag (delete only blocks when stock movements exist — ignores sales/purchases history), no product code field, no type flags (stock/saleable/purchaseable/production), no guard against expense-like product names (electricity/rent/salary…). Products in DB are clean today (no electricity), but nothing prevents it. `other_expenses` register exists with free-text category — no shared category vocabulary in the entry UI (`EXPENSE_CATEGORIES` exists in `management_reports.js` but is unused by the Expenses screen).

**D8 — Petty expense head mis-mapped:** imported office-expense rows carry `expense_head='Payment'`, real detail in `description`, `paid_to='OFFICE EXPENSES'` (columns swapped vs Excel). Cosmetic but breaks head grouping/search.

**D9 — Product rate adjustment (req 12/34). ✅ FIXED (Migration 32)** — `product_rate_history` table (product, prev, new, effective, reason, user, timestamp) + rate-history UI on the Stock page; historical sales keep their own line rate (`sales_items.rate`) and are never rewritten — rate changes affect future transactions only.

**D10 — Payment ↔ bank link (req 6/30). ✅ FIXED (Migration 33)** — `payments.bank_txn_id`/`bank_account`/`bank_reference`; `linkPaymentToBank` lets one user action create ONE payment + ONE linked bank row (`txn_uid='pay:<id>'` — bank import then matches, never duplicates), `postBankToLedger` back-stamps matched payments, bulk farmer pay links the batch bank row.
**Live impact on `data/dairy-plant.db`:** bank `total_in` 2,909,755 → **2,828,645** (removed 11 imported UPI receipts already recorded as payments = **Rs 81,110** double count), bank balance 438,446 → **357,336**; cash unchanged (119,027).

**D11 — Money precision (req 39/40). ✅ FIXED (new writes only)** — 486 `milk_collections.amount` rows > 2 dp, 463 `stock_movements.rate`, 6 `sales`, 1 `purchase_items` (e.g. `11788.525`, rate `82.14999999999999`). Aggregates follow **Σ round2(row)** (v1.4.22) and all remaining write paths (saveSale header/items/rates, savePurchase, adjustStock rate) now round2 on insert.

> **PRECISION POLICY (D11):** (1) every stored money/amount/rate is written at 2-dp via `round2`; (2) aggregates are Σ round2(row) — never round(round(...)) chains; (3) **historical rows are never rewritten** (req 47) — aggregates are rounding-invariant, so legacy 3-dp rows stay as-is and only new writes are normalised; (4) no float equality — `CURRENCY_TOLERANCE` from `shared/operations/accounting.js`.

**D12 — Salary import drop (D6 part):** generic salary importer would produce 4 records (3 employees) but current DB has 2 — the Dedup/upsert ran against a different sheet generation; re-verification required after D6 fixes.

---

## D. PLANNED CHANGES (fix / extend / add — mapped to requirements)

1. **D3/D4/D5 (req 22/23/41)** — add shared page-filter store to `renderer/js/utils.js`; convert bank, cash-deposit, cash (collection+denomination), expenses, vehicle, salary to read stored filters instead of render-time `getDatePreset`. One shared fix, no per-screen date logic.
2. **D1 (req 24/25)** — Migration 28: (a) `transaction_type='advance'` backfill for `type='advance'`; (b) link+tag matching untagged ledger rows (party+amount, greedy, 1:1 — no balance change), post fresh tagged rows only when none exists; (c) reclassify the `ADVANCE RETURNED` receipt → `advance_returned` (matched to its Excel row) and fix the Collection importer to type future rows. Extend importer `insertPay` to write `transaction_type` at source.
3. **D2 (req 25/26)** — exclude `expense_head='Advance'` petty rows from `getExpenseSummary`, `getProfitLossByMonth`, `company_ledger` expense rows (re-tag as Advance/bs), and cash/bank position: advances count **once, as outflow** (`payments type='advance'` removed from inflows, added to outflows; petty advance rows excluded from `pettyCash` sum).
4. **D6 (req 27/29)** — Employees master screen (list/add/edit/deactivate, existing API); `saveSalaryRecord` resolves `employee_id` + canonical name (case/spelling-insensitive), rejects numeric-only names; importer `findEmp` uses the same resolver; duplicate-suspect detection + explicit merge (re-points `salary_records.employee_id`, keeps history + audit log); re-run salary import → **9/9 Excel employee-months** (see F — the sheet's Month column is stale on 5 rows; the remarks state the real month, so trusting the column collapsed 9 into 4 and hid Rs 66,000).
5. **D7/D9 (req 10/11/12/33/34/45)** — products: add `code`, `active` (archive), type flags; archive-not-delete when history exists; block expense-like names with pointer to Expenses; `product_rate_history` table + effective-dated UI (prev→new, reason, user, time); Expenses screen gets shared `EXPENSE_CATEGORIES` datalist (electricity lives here, never in products).
6. **D10 (req 6/7/30/31)** — `payments.bank_txn_id` + optional bank fields on payment save auto-create ONE linked `bank_transactions` row (`txn_uid='pay:<id>'` — bank import then matches, never duplicates); when bank import matches an existing payment's ledger row, stamp `payments.bank_txn_id` back. Farmer Payment form gains Bank account/Reference.
7. **D11 (req 39/40)** — round2 at remaining write paths (sales totals, purchase item amounts, milk rate/amount already, stock adjustment rate); document the precision policy (Σ round2(row) aggregates; no historical rewrite).
8. **D8** — map `expense_head` to Excel Description on import; keep `paid_to` free.
9. **N16/N44 (req 16/17/19/20) ✅ DONE** — "Today's stock" simple panel (Opening + Collection + Production − Sales − Consumption − Wastage = Closing, click-through to Stock Statement detail) reusing `getStockLedger` — presentation only, no second engine. (`renderer/js/stock.js`: preset bar Today/Yesterday/Last 7/This Month/All + custom range, stored page filter `stock_todays`, per-unit subtotals, honest residual "Other ±" bucket, green/red "✓ Identity holds" banner, click-through to Stock Statement detail with same period/product.)
10. **Verify-only:** milk=procurement, production multi-output, gross margin, dup logic, BS/AD, stock statement presets (already correct).

**Out of scope / not done:** rewriting historical amounts, deleting Excel-era ledger rows, any second accounting engine.

---

## E. LATE FINDINGS — D13 / D14 (found during implementation) + data-mapping plan (requirement 47)

### D13 — Collection-sheet "PETTY CASH" rows double-counted cash

**Identify → classify (evidence, not assumption):** all 71 `Collection` rows with Type=`Petty Cash` (Rs 320,100) plus 3 rows Type=`Advance` with customer `PETTY CASH` (Rs 14,000) were classified against the `PETTY CASH` register row-by-row:

| Class | Rows | Amount | Meaning |
| --- | --- | --- | --- |
| Exact match to a register **expense** row (date+amount) | 25 | 45,515 | same spend, recorded twice |
| Exact match to a register/**payment advance** row | 29 | 63,905 | advance already counted via `payments type='advance'` |
| Same-day composite of register rows (e.g. 2083-04-14 19,800 = SMP 18,000 + WOOD 1,800) | 2 | 21,500 | rollup of already-counted spends |
| Same-day match to a register **inflow** ("CASH RECEIVED FROM COLLECTION": 05-05 33,000, 05-06 20,000 …) | 15 | 189,180 | cash handed counter → petty box (internal transfer) |
| Duplicate of register advances (customer `PETTY CASH`, "BY LILA SIR") | 3 | 14,000 | advance already imported |

**Defect:** they were imported as **69 `payments type='payment'`** against auto-created party `PETTY CASH` (id 76, Rs 301,420) + 71 **zero-value** `ledger_entries` placeholders ⇒ every consumer of `payments type='payment'` (`getCashBankPosition`, dashboard `cashOut`, daily payments) overstated cash out by Rs 301,420.

**Map → migration (req 47):**
1. **Identify:** `payments WHERE type='payment' AND party = 'PETTY CASH'` → 69 rows / Rs 301,420; `ledger_entries` for that party → 71 rows, all `debit=0, credit=0, balance=0` (placeholders from an older importer).
2. **Classify:** internal cash movement (counter → petty box) — the same rupee is already counted through the register (`petty_cash` expenses + `payments type='advance'`). Correct ERP module: *none* — cash stays cash.
3. **Preserve original IDs:** rows are import artifacts, not source documents; the Excel row numbers remain the source of truth and are untouched. Non-zero ledger rows (none existed) would be left for manual review by the migration's `debit = 0 AND credit = 0` guard.
4. **Migration 29** (`shared/db.js`, idempotent): voids the 69 payments + 71 placeholders; **the importer now skips those rows** (`importCollections`: 74 rows) so they cannot come back.
5. **Verify before/after on a live-DB copy:**
   - ledger totals **unchanged**: Σdebit 7,346,702.40 / Σcredit 7,191,177.83 (only 0/0 rows removed)
   - `petty_cash` **unchanged**: 132 rows / Rs 542,328 · expense summary **unchanged**: Rs 380,001
   - cash total_out 3,128,383 → 2,826,963 (**−301,420 = exactly the voided total**); cash balance −182,393 → **+119,027**; bank balance unchanged (438,446)
   - advance register unchanged by M29/M30 (M28 populates it: outstanding **531,315**, all checks ok)
   - second run removes nothing (idempotent).

### D14 — fresh import silently dropped the 72 OFFICE EXPENSES rows (Rs 223,288)

**Identify:** `importPettyCashSheet` only handled Type `Payment`/`Advance`, but the register's Type column holds **OFFICE EXPENSES 72 · Advance 60 · Payment 9 · Collection 22**. A fresh import therefore landed 9 + 60 rows and understated petty expenses by **Rs 223,288**.
**Fix (extend, not rebuild):** the expense-voucher branch now accepts `OFFICE EXPENSES` as well; **head = Excel description** (real detail: `DISEL`, `ELECTRICITY ASHADH-2083`, …) with fallback `Payment` for blank descriptions — this also fixes **D8** (meaningless head `Payment`).
**Migration 30** re-heads legacy rows to their description (67 rows re-headed; 5 blank-description rows keep `Payment`) so upsert-mode dedup keys match exactly — verified no duplicates after re-import.
**Also:** `runExcelImport` now re-runs `normalizeAdvances` **after** the import — Migration 28 executes at database init, i.e. *before* fresh-mode data exists, so the Advance Recovery Register read zero right after a fresh import. Step 4 of `normalizeAdvances` now also tags the ledger credit of receipts the importer already types at source (`advance_returned`) — fresh import: register returned 0 → **34,725**, outstanding 566,040 → **531,315**, checks ok.

---

## F. LATE FINDING — D6 EMPLOYEES (implemented)

**What the audit found:** backend CRUD existed but no screen (`showEmployeesMaster()` was called by the Salary button and **undefined** — the button threw); `employees` table had no `updated_at` column while `saveEmployee`'s UPDATE wrote it (**editing an employee has always thrown**); the importer's name match was exact-lower only, so `SARASWATI RAYMAJHI` created a **duplicate** of master `Sawaswati Rayamajhi`; and the Salary Advance sheet's **Month column is stale on 5 of 9 rows** (re-entered for SHRAWAN/BHADRA but still `2083-03`/`2083-04`), which collapsed the sheet to 4 employee-months and silently hid 5 salary payments (**Rs 66,000**) — while the Remarks cell states the real month ("2083 BHADRA SALARY") and the payment dates confirm it.

**Done (fix existing / extend):**
1. **Employees Master screen** — Master Data → Employees: list (code/name/position/phone/monthly salary/linked record count/status), add/edit modal, deactivate/reactivate, duplicate-suspect banner with one-click **Merge** (re-points `salary_records`, deactivates the source — never deletes — audit-logged), orphan salary names surfaced. Wired through IPC (`db:salary:employees-dupes/-merge`), web API (`/api/salary/employees/dupes|merge`), preload and `api.js`.
2. **Migration 31** — `employees.updated_at` added (PRAGMA-probed; the edit path now works; schema.sql + both `ensureEmployeesTable`s aligned).
3. **`resolveEmployee`** — exact → key-normalised → fuzzy (≥ 0.85 similarity) ladder in `shared/operations/salary.js`; used by `saveSalaryRecord` (stores `employee_id` + canonical name) and by **both** importer layouts (`findEmp`).
4. **Validation** — amount-shaped names (`"10000"`, `"10,000.00"`, blank) rejected in ops *and* `validateSalary` (web).
5. **`bsMonthFromRemarks`** — payroll month from remarks (fallback: sheet column); import now yields **9/9 employee-months** (3 employees × ASHADH/SHRAWAN/BHADRA), 3 employees only (no spelling duplicate), idempotent re-import (0 added / 9 unchanged).

**Verified:** `scripts/audit/test-employees.js` **30/30**; UI exercised live in the web preview (page renders 3 employees, edit persists ₹15,000 through the previously-throwing UPDATE, Find Duplicates returns clean, Salary 👥 button navigates instead of throwing).
