# SIDEBAR DATA FLOW & EXCEL WORKSHEET MAPPING

**Audited:** 2026-11-05 · **App version:** 1.4.53 · **Workbook:** `Dairy_Accounts_Professional 76.xlsx`
**Method:** every row below was read from the source (`renderer/index.html`, `renderer/js/app.js`, `renderer/js/*.js`, `shared/operations/*.js`, `shared/excel-import.js`, `shared/excel-sync.js`, `shared/xlsx-parts.js`) or from the workbook itself (SheetJS, read-only). Nothing here is assumed from a template.

---

## 0. The headline

| Question | Answer | Evidence |
|---|---|---|
| Does the app have an Excel write-back today? | **It did not** — only a whole-workbook *export* (`shared/export-daily-account.js`, `book_new()` → `writeFile`) and a Monthly Report sheet insert | `export-daily-account.js:38`, `export-monthly-report.js:insertMonthlyReportSheet` |
| Did that export write `Party_Ledger`? | **Yes** — it builds a `Party_Ledger` sheet from `ledger_entries` | `export-daily-account.js:353` |
| Does the app write back into the operator's real workbook? | **Not before this release.** Now it does, per module, into its own sheet (`shared/excel-sync.js`) | new module + 63-check suite |
| Is Excel the operational source of truth? | **No.** SQLite is. Excel is import source + archive/cross-check. This is preserved deliberately (§11 of your directive allows it) | `shared/db.js`, `server.js`, `main.js` |
| Is `Party_Ledger` a transaction path anywhere? | **No.** The workbook builds it from formulas; the app imported a copy once; no module writes it | `EXCEL_DATA_MODEL_AUDIT.md` §3 |
| Is the sync automatic on save? | **No.** It is explicit (Settings → Write Back to Excel, CLI, or API). §6 explains why, and what automatic would require | `shared/excel-sync.js` |

---

## 1. Complete sidebar inventory (41 pages, from `renderer/index.html` + `pageModules`)

| Sidebar Module | Database Table | Excel Worksheet | Reads From | Writes To | Party Ledger Dependency | Status |
|---|---|---|---|---|---|---|
| Dashboard | *(none — aggregates)* | none (report) | `sales`, `purchases`, `payments`, `stock_movements` | — | none | Verified (report only) |
| Sales | `sales`, `sales_items` | `Sales_Entry` | `sales`, `sales_items`, `parties`, `products` | `sales`, `sales_items`, `stock_movements`, **`ledger_entries`** | **writes a ledger row** (BUG-016) | Verified; sync added |
| Invoice Generation | `sales`, `sales_items` | `Sales_Entry` (indirect) | `sales`, `parties`, `products`, `settings` | `sales` (creates invoice) | via sales | Verified |
| Purchases | `purchases`, `purchase_items` | `Purchase_Entry` | `purchases`, `purchase_items`, `parties` | `purchases`, `purchase_items`, `stock_movements`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Milk Collection | `milk_collections` | `Purchase_Entry` *(milk lines)* | `milk_collections`, `parties`, `milk_rate_chart` | `milk_collections`, `stock_movements`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Bulk Entry | `sales`, `milk_collections` | `Sales_Entry`, `Purchase_Entry` | same as Sales/Milk | same as Sales/Milk | indirect | Verified |
| Payment Collection (`cash-collection`) | `payments` (`type='receipt'`) | `Collection` | `payments`, `parties`, `sales` | `payments`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Payment Register (`payment-collection`) | `payments` (`type='payment'`) | `Payment` | `payments`, `parties`, `purchases` | `payments`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Petty Cash | `petty_cash` | `PETTY CASH` | `petty_cash` | `petty_cash`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Expenses | `other_expenses` | `Expenses` (+ `Collection` for rent income) | `other_expenses` | `other_expenses`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Advances | `payments` (`transaction_type` advance/loan) | `Advance` | `payments`, `parties` | `payments`, **`ledger_entries`**, `petty_cash` (duplicate) | **writes a ledger row** | Verified; sync added |
| Bank Transactions | `bank_transactions` | `BANK RECON` | `bank_transactions` | **`bank_transactions` only** | **none — enforced** | Verified (32-check restart suite); sync added |
| Salary | `salary_records`, `employees` | `Salary` | `salary_records`, `employees` | `salary_records`, **`ledger_entries`** | **writes a ledger row** | Verified; sync added |
| Stock | `stock_movements`, `products` | none (derived) | `stock_movements`, `products` | `stock_movements` | none | Verified (report only) |
| Stock Statement | *(computed)* | none | `stock_movements`, `products` | — | none | Verified (report only) |
| Parties | `parties` | `Party_Master` | `parties` | `parties` (+ optional ledger opening) | opening balance only | Verified; **not** auto-synced (master data, see §5) |
| Routes | `routes` | none | `routes` | `routes` | none | Verified (no sheet) |
| Milk Rate Charts | `milk_rate_chart` | none | `milk_rate_chart` | `milk_rate_chart` | none | Verified (no sheet) |
| Employees | `employees` | `Salary` (names) | `employees` | `employees` | none | Verified |
| Farmer Payments | *(composed)* | `Payment` + `Purchase_Entry` | `purchases`, `payments`, `parties` | via those modules | indirect | Verified (report) |
| Statements (party ledger view) | *(none — derived)* | `Party_Ledger` (workbook side) | `ledger_entries` **today**; `party_ledger.js` available | — | **reads only** | Verified; switch pending (BUG-016) |
| Receivable / Payable | *(computed)* | `Receivable_Payable` (workbook formula) | `ledger_entries` | — | reads only | Verified |
| Company Ledger | *(computed)* | `Daybook` (workbook formula) | all registers + `ledger_entries` | — | reads only | Verified |
| Daybook | *(computed)* | `Daybook` | `sales`, `purchases`, `payments`, `petty_cash` | — | reads only | Verified |
| Profit & Loss | *(computed)* | `Profit_Loss` | registers via `monthly_report.js` | — | none | Verified |
| Monthly Report | *(computed)* | `Monthly Report` | `monthly_report.js` | inserts/refreshes its own sheet | none | Verified (121 checks) |
| Management Reports | *(computed)* | none | registers | — | none | Verified |
| Cash | `payments`, `petty_cash`, `cash_deposits` | `CASH FLOW` | `payments`, `petty_cash` | `payments` | via payments | Verified |
| Cash Denominations (`cash`) | `denomination_counts` | `Cash_Demon` | `denomination_counts` | `denomination_counts` | none | Verified (no sync: see §5) |
| Cash Deposit | `cash_deposits` | none | `cash_deposits` | `cash_deposits` | none | Verified (no sheet) |
| Partner Capital | `partner_capital` | none | `partner_capital`, `parties` | `partner_capital`, `ledger_entries` | writes | Verified (no sheet) |
| PDC Cheques | `pdc_cheques`, `pdc_allocations` | none | `pdc_cheques`, `payments` | `pdc_cheques` | none | Verified (no sheet) |
| Vehicle Expenses | `vehicle_expenses` | none | `vehicle_expenses` | `vehicle_expenses` | none | Verified (no sheet) |
| Production | `production_batches`, `production_inputs`, `production_outputs` | none | those tables | those tables, `stock_movements` | none | Verified (no sheet) |
| Dairy Costing | *(computed)* | none | production + stock | — | none | Verified (report) |
| Production Setup | `production_settings`, `yield_standards` | none | settings tables | settings tables | none | Verified (no sheet) |
| Reports | *(computed)* | multiple | all registers | — | none | Verified |
| Audit Log | `audit_log` | none | `audit_log` | `audit_log` | none | Verified |
| Data Integrity | *(read-only diagnostics)* | none | every table | — | none | Verified |
| DB Tables | *(introspection)* | none | `sqlite_master` | — | none | Verified |
| User Manual | *(static)* | none | — | — | none | Verified |
| Settings | `settings`, `users` | `Settings` | `settings` | `settings` | none | Verified |

**Note on "Party Ledger":** the app has no sidebar tab with that name. The equivalent screens are **Statements** (one party) and **Company Ledger** (all parties), both read-only reports. The `Party_Ledger` *worksheet* belongs to the workbook and is formula-derived.

---

## 2. The 10 register modules and where they now write

| Module id | Sidebar | Worksheet | Match key | Rows the app would write (live dry run) |
|---|---|---|---|---|
| `sales` | Sales | `Sales_Entry` | `SALE-<id>#<line>` | 3,096 |
| `milk` | Milk Collection | `Purchase_Entry` | `MILK-<id>` | 1,690 |
| `purchases` | Purchases | `Purchase_Entry` | `PUR-<id>#<line>` | 1,031 |
| `collection` | Payment Collection | `Collection` | `COL-<id>`, `COL-RENT-<id>` | 1,717 |
| `payments` | Payment Register | `Payment` | `PAY-<id>` | 53 |
| `advances` | Advances | `Advance` | `ADV-<id>` | 78 |
| `petty_cash` | Petty Cash | `PETTY CASH` | `PC-<id>` | 222 |
| `expenses` | Expenses | `Expenses` | `EXP-<id>` | 0 (register is empty) |
| `bank` | Bank Transactions | `BANK RECON` | `BANK-<id>` | 136 |
| `salary` | Salary | `Salary` | `SAL-<id>` | 12 |

Measured by `node scripts/excel-sync.js` (dry run, read-only) against the live book.

---

## 3. Synchronization direction, per module (measured)

| Module | Excel → App | App → Excel | Mechanism |
|---|---|---|---|
| Sales | ✅ upsert import by invoice no | ✅ **new** (explicit sync) | `importSales`, `syncModule('sales')` |
| Milk | ✅ import | ✅ **new** | `importMilk`-equivalent, `syncModule('milk')` |
| Purchases | ✅ import | ✅ **new** | `importPurchases`, `syncModule('purchases')` |
| Collection | ✅ import (5 row types) | ✅ **new** | `importCollections`, `syncModule('collection')` |
| Payment | ✅ import | ✅ **new** | `importPaymentSheet`, `syncModule('payments')` |
| Petty Cash | ✅ import | ✅ **new** | `importPettyCashSheet`, `syncModule('petty_cash')` |
| Expenses | ✅ import (currently into `petty_cash` — BUG-020) | ✅ **new** | `syncModule('expenses')` |
| Advance | ✅ import (duplicates — BUG-021) | ✅ **new** | `syncModule('advances')` |
| Bank | ✅ import | ✅ **new**, and nothing else is ever written | `importBankSheet`, `syncModule('bank')` |
| Salary | ✅ import (12 of 24 rows) | ✅ **new** | `importSalary`, `syncModule('salary')` |
| Party Ledger | ✅ imported once (legacy) | ❌ **never** — by design | — |
| Stock | ❌ not imported (derived) | ❌ no sheet | `stock_movements` is the register |

**Direction summary:** Excel→App is an **import** (manual, file picker). App→Excel is a **write-back** (explicit sync). There is **no live two-way binding**, and this release does not claim one.

---

## 4. Party Ledger dependency analysis (every writer and reader)

### 4.1 Writers of `ledger_entries` (11)

`shared/operations/sales.js`, `purchases.js`, `milk.js`, `payments.js`, `cash.js`, `farmer.js`, `partners.js`, `parties.js`, `pdc.js`, `accounting.js`, `shared/excel-import.js`.

### 4.2 Readers

`party_account.js`, `statements.js`, `reports.js`, `dashboard.js`, `management_reports.js`, `company_ledger.js`.

### 4.3 Does editing a "Party Ledger record" change another module?

There is no Party Ledger editor. The app's Statements screen is read-only; the workbook's ledger is formulas. **Answer: no.** A ledger row can be deleted in the DB and no sale/purchase changes — which is itself the defect (the ledger is a parallel copy, not a view).

### 4.4 What the live book actually contains

| `reference_type` | rows | Orphans (no module row) |
|---|---|---|
| `sale` | 2,838 | 2,815 |
| `payment_received` | 1,833 | 277 |
| `purchase` | 1,460 | 1,460 |
| `adjustment` | 66 | 3 |

Zero `payment_made`, zero `advance`, zero `milk_collection` rows. Purchase ledger total 4,795,338.69 vs registers 5,029,121.75 → **Δ 233,783.06**.

### 4.5 The workbook's own ledger is a formula view

`Party_Ledger` has 3,192 formula cells; rows 3–4,406 `=Sales_Entry!…`, 4,409–6,472 `=Purchase_Entry!…`, 6,474–8,486 `=Collection!…`, 8,488–8,591 `=Payment!…`, 8,593–8,725 `=Expenses!…`, 8,727–8,831 `='PETTY CASH'!…`, 8,833–8,916 `=Advance!…`. No transaction is ever typed there.

### 4.6 The block-height trap (critical for write-back)

The blocks are **fixed heights**, sized to the row counts at the time the workbook was built:

| Block | Covers sheet rows | Capacity | Rows after syncing the app's data | Rows the ledger would miss |
|---|---|---|---|---|
| Sales | 3 – 4,404 | 4,402 | 6,046 | **~1,644** |
| Purchases + Milk | 3 – 2,062 | 2,060 | 4,727 | **~2,667** |
| Collection | 3 – 2,011 | 2,009 | 3,403 | **~1,394** |
| Payment | 3 – 102 | 100 | 158 | **~58** |
| Expenses | 3 – 131 | 129 | 131 | 0 |
| Petty Cash | 3 – 103 | 101 | 376 | **~275** |
| Advance | 3 – 82 | 80 | 246 | **~166** |

**Consequence:** writing app rows into the right worksheets is necessary but **not sufficient** for the workbook's `Party_Ledger` to show them. Two honest options:

1. **Extend the blocks** (copy the formula row down) as part of a workbook maintenance step, or
2. **Use the app's derived statement** as the party ledger (recommended — `shared/operations/party_ledger.js`), and treat the workbook's ledger as historical.

Doing neither would create a workbook that looks complete while silently omitting ~5,500 new rows from every party statement. That is why this release reports it rather than papering over it.

---

## 5. Where the mapping is incomplete (reported, not invented)

| Sidebar module | Missing worksheet | Proposal (not created) |
|---|---|---|
| Stock / Stock Statement | workbook derives `Stock_Master` from `Purchase_Entry`/`Sales_Entry`; no register sheet | keep derived; `stock_movements` is the register |
| Production | none in the workbook | `Production_Batches` + `Production_Inputs`/`Outputs` sheets exist only in the app's export |
| Partner Capital | none | sheet from `partner_capital` |
| Vehicle Expenses | none | sheet from `vehicle_expenses` |
| PDC Cheques | none | sheet from `pdc_cheques` |
| Cash Deposit | none (cash movements live in `CASH FLOW`) | sheet from `cash_deposits` |
| Routes / Milk Rate Charts / Employees | none | master data; write to `Settings` or a new master sheet |
| Parties | `Party_Master` exists | **not synced** — it is master data, and writing it risks overwriting the operator's opening-balance column (BUG-019 still open) |
| Denominations | `Cash_Demon` exists | **not synced** — its `N` column is a live `SUMIFS` over `Collection`; writing values would break it |

I did **not** create new worksheets: `shared/excel-sync.js` only writes to a sheet that already exists, and returns a clear error when the sheet is missing instead of diverting the data into `Party_Ledger` or another register.

---

## 6. What "automatic" would require (why this is explicit sync)

An automatic post-save write-back needs, per module: a hook in every create/update/delete path (11 modules × 3 operations), a lock check for Excel being open, a retry/queue when the file is unavailable, and a decision on what to do when the workbook is on a synced drive. None of that exists today, and adding it silently would make a save fail whenever Excel is open.

So the implemented contract is:

1. The database is written first and always (unchanged behaviour).
2. The worksheet is updated by an explicit sync — Settings → **Write Back to Excel**, `node scripts/excel-sync.js --apply`, or `POST /api/excel/sync`.
3. A sync is **idempotent**: rows are matched by `App Ref`, so running it twice appends nothing.
4. A workbook open in Excel is **refused** (`~$` lock file), never half-written.

---

## 7. Duplicate prevention and record identity

| Risk | Control |
|---|---|
| Appending the same sale twice | `App Ref` column (`SALE-142#1`) matched before insert |
| Updating the wrong row | match is on the reference, never on row number, name, date or amount |
| Overwriting operator history | rows without an `App Ref` are never modified |
| Multi-line sale/purchase mismatches | one ref per line (`#1`, `#2`), so a line edit patches that line |
| Deleted record vanishing from the archive | reported as **orphaned**; the row is kept |
| Writing into the wrong sheet | each module declares exactly one sheet; a missing sheet is an error |
| Writing `Party_Ledger` | no module lists it; a test asserts no module's sheet matches `/party.?ledger/` |

---

## 8. Status summary

| Status | Modules |
|---|---|
| **Verified working** | 41 sidebar pages route and render; 10 register modules sync into their own sheet (63 checks); bank isolation (32 checks) |
| **Fixed and tested** | per-module Excel write-back; `Party_Ledger` never written; lock handling; deletion reporting; rent → `Collection!Type=Rent` |
| **Fixed, not fully tested** | REST route `/api/excel/sync` and Electron IPC `excel:sync` — the engine is tested, the transport was smoke-checked only |
| **Not implemented** | automatic sync on save; sheets for Production/Vehicle/PDC/Partner Capital/Cash Deposit; `Party_Master` and `Cash_Demon` write-back; extending `Party_Ledger` blocks |
| **Blocked / needs a decision** | `ledger_entries` retirement; opening balances; `Expenses` import destination; advance duplication |
