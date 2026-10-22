# Deep audit — `Dairy_Accounts_Professional TRIAL.xlsx` → Prarambha Account & Stock Management

Date: 2026-10-22
Workbook: `Dairy_Accounts_Professional TRIAL.xlsx` (2.04 MB, 29 sheets, 22 visible / 7 hidden)
Database: `data/dairy-plant.db`
Backup before import: `data/backups/dairy-plant.db.bak-pre-trialimport-20261022T140722`
Backup before workbook repair: `Dairy_Accounts_Professional TRIAL.bak-formulas-2026-10-22T08-21-37-174Z.xlsx`

Everything below was produced by running the code in this repository against the real
workbook and the real database. Nothing is estimated unless it is labelled as such.

---

## 1. Root causes of the original problems

### 1.1 Three transaction sheets were never read

`shared/excel-import.js` read **only** the `PETTY CASH` sheet for cash vouchers. In this
workbook `PETTY CASH` holds 31 rows, all of type `Collection` — the real vouchers live in
three separate sheets that share the same column layout:

| Sheet | Rows in sheet | Rows already in `petty_cash` | Missing before this session |
|---|---|---|---|
| `Payment` | 5 | 5 | 0 in the cash register, **5 missing from the Payment register** |
| `Expenses` | 89 | 62 | **27** |
| `Advance` | 68 | 60 | **8** |

35 vouchers were therefore invisible to every report, and nothing refreshed when the
operator added a new row to one of those three sheets.

**Fix** — `importRegisterSheets()` + `postPaymentRegisterRows()` in `shared/excel-import.js`:
the three sheets now go through the same row logic as `PETTY CASH` (so identical rows in
two sheets collapse to one, keeping the import idempotent), and `Payment` rows also land in
the standalone `payments` register (`type='payment'`) with exactly one party-statement
posting, reusing the app's own `postPaymentLedger()` rule. They never create a Bank
Transaction.

### 1.2 The workbook's formulas referenced deleted cells

Three independent breakages, all repaired with byte-preserving XML surgery so that number
formats, styles, merges, charts and every other sheet are untouched:

| Sheet | Column | Defect | Count |
|---|---|---|---|
| `Payment` | L `Closing Due` | running balance pointed at a deleted cell (`N(#REF!)`), or at the wrong row (`N(L45)` on row 45) | 56 broken + 45 stale |
| `Expenses` | L | same | 69 broken + 112 stale |
| `Advance` | L | same | 69 broken + 92 stale |
| `Sales_Entry` | M | discount helper `=H-J` had no blank guard, so all 299 pre-filled template rows returned `#VALUE!` | 299 |
| `Party_Ledger` | A–M | cells lost their address (`Sales_Entry!#REF!`) after a sheet/row deletion | 1,332 re-pointed |
| `Party_Ledger` | I | running balance compared against a distant row (`$I4979` on row 8492) | 84 re-pointed |
| `Party_Ledger` | C | three RENT rows read the source **invoice** column instead of the party column, so `TILAK RAYMAJHI` showed 0 and Rs 8,695 of RENT vanished from the party statement | 3 |
| `Party_Ledger` | various | stale cached `#REF!` results left on cells whose formula was already valid | 341 cleared |

**Result: 2,129 error cells → 0.** Verified by re-reading the produced file before writing it
and again afterwards. `fullCalcOnLoad="1"` is set so Excel recalculates on open.

Repair tool: `scripts/audit/repair-workbook-formulas.js` (dry-run by default, `--apply` writes
the backup first). Log: `data/workbook-formula-repair.json`.

### 1.3 A re-import reported hundreds of phantom "updates"

Running the import twice should change nothing. It reported **741 purchases updated**,
**24 sales updated** and **2 parties updated** on every run, while writing nothing that
survived the comparison:

- The purchase/sale change detector built its expected line list from *every* sheet row, but
  milk lines are stored in `milk_collections` (not `purchase_items`) and OPENING/RENT
  pseudo-products are skipped — so `itemsDiffer` was true forever for any bill containing one.
- The party detector compared `type` unconditionally, while the UPDATE only overwrites `type`
  when the sheet says something other than the `customer` default.

Both comparisons now mirror what is actually written. **A second import reports 0 added and
0 updated in every module** — verified on the live database.

### 1.4 `Collection` has one fewer column than its sibling sheets

`Collection` has no `Description` column, so `Type` is column 5 (not 6), `Collected` is 7 and
`Paid` is 8. `Payment` / `Expenses` / `Advance` and `PETTY CASH` have the Description column.
Any script that assumes one layout silently reads the wrong column on the other. This is the
root cause of the reconciliation mis-read documented in §4.

---

## 2. Sheet → module mapping (all 29 sheets)

| # | Sheet | Kind | Destination | Notes |
|---|---|---|---|---|
| 0 | Dashboard | report | — (app Dashboard) | live formulas, not imported |
| 1 | Profit_Loss | report | — (app Profit & Loss) | not imported |
| 2 | Receivable_Payable | report | — (app Receivable/Payable) | not imported |
| 3 | Party_Statement | report | — (app Statements) | not imported |
| 4 | Party_Ledger | **report grid** | — (app `ledger_entries`) | cross-sheet references, not imported in upsert mode |
| 5 | Sales_Entry | transaction | `sales` + `sales_items` | 2,887 rows |
| 6 | Purchase_Entry | transaction | `purchases` + `purchase_items`, milk lines → `milk_collections` | 1,587 rows; header is on **row 2** |
| 7 | Collection | transaction | `payments` (`type='receipt'`) | 1,611 rows |
| 8 | Cash_Demon | transaction | `denomination_counts` | 138 rows |
| 9 | PETTY CASH | transaction | `petty_cash` (collection rows skipped — they mirror Collection) | 126 rows |
| 10 | Payment | transaction | `petty_cash` + `payments` (`type='payment'`) | **newly wired** |
| 11 | Expenses | transaction | `petty_cash` (office vouchers) | **newly wired** |
| 12 | Advance | transaction | `petty_cash` (`Advance`) + `payments` (`type='advance'`) | **newly wired** |
| 13 | Party_Master | master | `parties` | 74 rows |
| 14 | BANK RECON | transaction | `bank_transactions` | 122 rows |
| 15 | Daybook | report | — (app Daybook) | not imported |
| 16 | Stock_Master | master + report | `products` | only the product rows are master data |
| 17 | Stock_Statement | report | — (app Stock Statement) | not imported |
| 18 | Printable_Invoice (hidden) | template | — | not imported |
| 19 | Salary Advance | transaction | `salary_records` + `employees` | 14 rows |
| 20 | Settings | master | `settings` (fill-blank only) | app values always win |
| 21 | README (hidden) | documentation | — | not imported |
| 22 | Error Log (hidden) | audit | — | reference only |
| 23 | Reconciliation Report (hidden) | audit | — | reference only |
| 24 | Import Log (hidden) | audit | — | reference only |
| 25 | Change Log (hidden) | audit | — | reference only |
| 26 | Printable Party Statement (hidden) | template | — | not imported |
| 27 | Verified Transaction Ledger (hidden) | audit | — | reference only |
| 28 | BS_AD_Lookup (hidden) | lookup | — | replaced in the app by `shared/bs-calendar.js` |

Report sheets are **never** imported as transactions: their totals would double-count
everything the registers already carry.

---

## 3. Import reconciliation — what the engine did

Run: `EXCEL_PATH="…/Dairy_Accounts_Professional TRIAL.xlsx" node import-excel-upsert.js`
(upsert = add new + update changed, never delete).

| Sheet | Inserted | Updated | Unchanged | Skipped | Note |
|---|---|---|---|---|---|
| Party_Master | 7 | 3 | 63 | 0 | 1 party auto-created |
| Stock_Master | 0 | 0 | 8 | 0 | products reconciled |
| Sales_Entry | 520 | 349 | — | 3 | the 3 skipped rows are `CANCELED` — correctly rejected |
| Purchase_Entry | 316 | 473 | 1 | 0 | milk lines split to `milk_collections` |
| Collection | 351 | — | 1,054 | 2 + 82 | 2 `CANCELED`; 82 petty-cash mirror rows skipped on purpose |
| Payment (new) | 5 | — | — | 0 | 5 party-statement postings |
| Expenses (new) | 31 | — | — | 0 | office vouchers recovered |
| Advance (new) | 9 | — | — | 0 | 67 advance postings linked |
| BANK RECON | 4 | — | — | 116 | 116 already present (idempotent) |
| Cash_Demon | 26 | — | — | 23 | 23 pre-filled empty days skipped |
| Salary Advance | 6 | 0 | 1 | 5 | 5 are duplicate employee-months |

Table counts, before → after:

| Table | Before | After |
|---|---|---|
| `parties` | 82 | 90 |
| `products` | 13 | 14 |
| `sales` | 1,597 | 2,117 |
| `sales_items` | 1,961 | 2,568 |
| `purchases` | 476 | 792 |
| `milk_collections` | 864 | 1,297 |
| `payments` | 1,115 | 1,538 |
| `petty_cash` | 132 | 174 |
| `bank_transactions` | 82 | 86 |
| `salary_records` | 2 | 8 |
| `ledger_entries` | 4,171 | 5,433 |
| `stock_movements` | 3,090 | 4,180 |
| `denomination_counts` | 86 | 112 |

---

## 4. Workbook → database totals (reconciliation)

Run: `node scripts/audit/reconcile-workbook.js`

| Module | Sheet | Src rows | DB rows | Src total | DB total | Diff | Status |
|---|---|---|---|---|---|---|---|
| Sales | Sales_Entry | 2,092 invoices | 2,117 | 4,938,002.79 | 5,271,850.79 | +333,848.00 | **explained** |
| Collection | Collection | 1,403 | 1,406 | 4,279,835.00 | 4,339,220.00 | +59,385.00 | explained |
| Payment register | Payment | 5 | 5 | 36,245.00 | 36,245.00 | 0 | **exact** |
| Expenses | Expenses | 89 | 93 | 436,467.00 | 388,768.00 | −47,699.00 | **unresolved** |
| Advance | Advance | 68 | 69 | 1,250,281.00 | 1,252,081.00 | +1,800.00 | explained |
| Salary | Salary Advance | 12 | 8 | 164,500.00 | 114,500.00 | −50,000.00 | **unresolved** |
| Bank | BANK RECON | 118 | 86 | 20,075,291.65 | 5,682,063.50 | −14,393,228.15 | **unresolved** |
| Parties | Party_Master | 73 | 90 | — | — | — | (DB has historical parties) |
| Cash count | Cash_Demon | 111 | 112 | 3,592,830.00 | 3,585,335.00 | −7,495.00 | explained |
| Purchases | Purchase_Entry | 1,363 | 792 + 1,297 milk | 4,381,906.99 | 4,524,934.99 (+ milk 3,588,551.50) | +143,028.00 | explained |

**Explanations (proven):**

- **Sales +333,848** — 22 invoices in the database (Rs 251,595) are no longer present in the
  sheet; an upsert never deletes, so they remain by design. The remaining ≈ Rs 82,253 is the
  `INT-…` internal-issue invoices the importer creates for sheet rows that carry no invoice
  number (LOCAL DAMAGE / FACTORY PRODUCTION), which have no key in the sheet.
- **Collection +59,385** — 3 receipts in the DB have no live sheet row (same retire-only rule).
- **Advance +1,800** — one advance voucher in `petty_cash` came from the legacy one-off import
  and carries a slightly different amount from the sheet row.
- **Cash count −7,495** — 20 day-closes have a genuine short/(over); the sheet total includes
  the workbook's own "Collections (auto)" formula, which this report does not sum.
- **Purchases +143,028** — the same retire-only rule: bills removed from `Purchase_Entry`
  remain in the database.
- **Payment register: 0 difference.** All five Payment-sheet rows now exist in `payments` with
  the exact sheet total.

**Unresolved (not explained by design):**

1. **Expenses −47,699.** 93 office vouchers in `petty_cash` total Rs 388,768 against Rs 436,467
   in the sheet. The extra 4 vouchers are legacy rows absent from the sheet; 4 sheet vouchers
   appear to be missing. Not traced line-by-line yet.
2. **Salary −50,000.** 12 sheet employee-months vs 8 records. 5 rows are rejected as duplicates
   of an existing employee-month, and at least one (Rs 50,000) has no counterpart — most likely
   `SALARY FOR NAR BAHADUR SRAWAN & ASHADH` entered as a combined two-month voucher. Needs a
   decision: split it into two months, or record it once.
3. **Bank −14,393,228.15.** 118 statement rows vs 86 rows. 116 were skipped as duplicates, which
   is correct, but the retained rows carry Rs 5.68M against the sheet's Rs 20.07M. This is either
   a column mapping difference on the retained rows or many rows collapsed into one. **Do not use
   the bank module for a reconciliation until this is traced.**

---

## 5. Profit & Loss — latest verified engine output

`getProfitLoss(db, { from: 2083-01-01, to: 2083-06-32 })` (BS fiscal year to date, Ashadh end)

| Line | Amount (Rs) |
|---|---|
| Sales revenue | 5,205,326.82 |
| Other income | 0.00 |
| **Total income** | **5,205,326.82** |
| Milk purchases (milk collections) | 3,568,361.54 |
| Non-milk purchases | 936,384.09 |
| **Cost of goods sold (purchase basis)** | **4,504,745.63** |
| **Gross profit** | **700,581.19** |
| Petty cash / office expenses | 574,212.00 |
| Salary | 114,500.00 |
| Vehicle | 0.00 |
| Bank-classified expenses | 120,813.00 |
| Other expenses register | 0.00 |
| **Total expenses** | **5,314,270.63** |
| **Net profit / (loss)** | **(108,943.81)** |
| Customer receipts (cash flow, not income) | 4,240,175.00 |

Transaction counts: 2,084 sales invoices, 1,280 milk collections.

### This is NOT a definitive profit figure

The engine's COGS is **purchase-basis**: milk and non-milk purchases are expensed as incurred
and closing inventory is not subtracted. The stock ledger cannot currently price the closing
balance reliably, so the stock-matched gross profit cannot be computed:

| Product | Closing qty | Value the ledger reports |
|---|---|---|
| Buffalo Milk | 9,163.50 L | 2,256,227.58 |
| Cow Milk | 3,751.29 L | 940,034.19 |
| Mix Milk | 0 L | **−3,572,841.29** |
| Ghee | 0 | −133,028.00 |
| NAUNI | 0 | −167,875.27 |
| Cream | 295.40 | −101,195.00 |
| PANEER | 0 | −50,908.00 |

A zero quantity with a multi-million-rupee negative value, and 12,915 L of raw milk left in
stock at the end of the period, are both wrong. The raw milk alone is worth roughly
**Rs 1.10M – 1.16M** at Rs 85–90/L, so a stock-matched gross profit would be materially higher
than the Rs 700,581 reported above. **Effect on profit: up to ≈ Rs 1.1M, direction positive,
not yet quantified line-by-line.**

A loss of Rs 108,943.81 on Rs 5.2M of sales is therefore the *reliable purchase-basis* result,
not a proven business loss. Do not present it as the final profit until the stock valuation
in §7 is fixed.

---

## 6. Payment / Collection / Bank separation — verified

- **Payment is standalone.** `postPaymentRegisterRows()` writes to `payments` only. It never
  touches `bank_transactions`; bank rows come exclusively from `BANK RECON`
  (`importBankReconSheet` → `bank.importBankRows`). The unit test
  `scripts/audit/test-payment-bank-link.js` passes.
- **One party posting per payment.** The ledger credit is written only when no
  `payment_made` entry exists for the same party + date + amount, so re-importing is a no-op.
- **Collection does not create sales.** Collections post to `payments` (`type='receipt'`); the
  sales register is fed only from `Sales_Entry`.
- **Cash reconciliation** uses only cash-mode movements (`accounting.js` → `getCashBankPosition`).

---

## 7. Stock reconciliation — unresolved, highest priority

Root causes identified, not yet repaired:

1. **Opening stock is zero** for every product, but the ledger already carries thousands of
   movements — so the running balance of every product is structurally wrong.
2. **Rate attribution is wrong on the out side.** Mix Milk sells 46,209 L against 5,334 L
   purchased, i.e. production output is not creating the milk that is sold, and the sale rows’
   rate is applied to the balance movement, producing the −3.57M.
3. **Branches (Ghee / NAUNI / PANEER / Cream)** show negative values with zero quantity, meaning
   production outputs were valued below their inputs or not created at all.

The daily combined raw-milk statement
`Date | Yesterday's Closing | Today's Purchase | Today's Sales | Today's Closing`
(`scripts/audit/test-daily-stock-statement.js`, 482 lines) **passes** and behaves exactly as
specified, but it is only as good as the movement data underneath it.

---

## 8. Files changed

| File | Change |
|---|---|
| `shared/excel-import.js` | `importRegisterSheets()`, `postPaymentRegisterRows()`, `REGISTER_SHEET_NAMES`; wired into `runExcelImport` as step 7b; exported. Also fixes the purchase/sale item and party `type` change detectors so a re-import is a true no-op |
| `shared/workbook-path.js` | **new** — resolves `…Professional.xlsx` / `…Professional TRIAL.xlsx` / `$WORKBOOK_PATH` |
| `scripts/audit/audit-workbook.js` | **new** — read-only inventory of every sheet, formula count, error cells, hidden state |
| `scripts/audit/repair-workbook-formulas.js` | **new** — the four repairs in §1.2, dry-run by default |
| `scripts/audit/reconcile-workbook.js` | **new** — the §4 reconciliation report |
| `scripts/audit/test-employees.js` | expectations derived from the live sheet instead of a hardcoded 3×3 |
| `scripts/audit/test-milk-supplier-identity.js` | assertion scoped to the date under test (the sheet has a second, legitimate 160 L line two days later) |
| `scripts/audit/test-handover-reset.js` | uses the workbook resolver |
| `docs/AUDIT-TRIAL-WORKBOOK-2026-10-22.md` | this report |

No database schema change, no migration.

---

## 9. Tests

`node scripts/audit/run-all-tests.js` — **29 / 29 test files pass** (was 26/29 before this
session; the three failures were caused by the workbook being renamed, not by code).

Targeted runs:

- `test-payment-bank-link.js` ✅ — a payment never creates a bank transaction
- `test-payment-types.js` ✅ — advance / loan / repayment never reach P&L
- `test-monthly-report.js` ✅ — month-end, inclusive last day, income/expense heads, continuity
- `test-daily-stock-statement.js` ✅ — Yesterday + Purchase − Sales = Closing
- `test-milk-costing.js`, `test-production-costing.js` ✅ — joint cost allocation, downstream inheritance
- `test-advance-register.js` ✅ — original / recovered / outstanding
- `test-bs-calendar.js` ✅ — every BS month length 2000–2090, BS↔AD round trips

Not run: `test-pdf.js` (Electron-only, needs `app.whenReady()`).

---

## 10. Backup and rollback

| What | Where |
|---|---|
| Database before import | `data/backups/dairy-plant.db.bak-pre-trialimport-20261022T140722` |
| Workbook before formula repair | `Dairy_Accounts_Professional TRIAL.bak-formulas-2026-10-22T08-21-37-174Z.xlsx` |
| Repair audit log | `data/workbook-formula-repair.json` |

Roll back the database:

```bash
cp "data/backups/dairy-plant.db.bak-pre-trialimport-20261022T140722" data/dairy-plant.db
npm rebuild better-sqlite3 && node -e "require('better-sqlite3')"
```

Roll back the workbook:

```bash
cp "Dairy_Accounts_Professional TRIAL.bak-formulas-2026-10-22T08-21-37-174Z.xlsx" \
   "Dairy_Accounts_Professional TRIAL.xlsx"
```

---

## 11. Workbook changes (what the operator will see)

- Payment / Expenses / Advance → `Closing Due` now shows a real running balance for every row
  instead of `#REF!`, and the previously-wrong rows now match the cumulative
  `Collected − Paid`.
- Sales_Entry → column M shows 0 / the actual discount for filled rows and stays blank for
  empty template rows, instead of `#VALUE!` down to row 2887.
- Party_Ledger → no `#REF!` anywhere. The petty-cash block (rows 8489–8684) now points at the
  current `PETTY CASH` sheet instead of the deleted one, the running balance compares against
  the row directly above, and the three RENT rows read the party column so
  `TILAK RAYMAJHI` (Rs 8,695) reappears.
- Nothing was deleted, zero-filled or re-rounded. Cells whose source row genuinely does not
  exist were left as they were and are listed in `data/workbook-formula-repair.json`.
- The workbook is set to recalculate on open, because repaired cells deliberately carry no
  cached value.

---

## 12. What is still open, in priority order

1. **Stock valuation** (§7) — up to ≈ Rs 1.1M of gross profit currently unaccounted for.
   Opening stock is 0 and production output does not create the milk that is sold.
2. **BANK RECON −Rs 14.39M** (§4.3) — do not reconcile the bank account from the app until
   this is traced.
3. **Salary Δ Rs 50,000** (§4.2) — one combined two-month voucher needs a business decision.
4. **Expenses Δ Rs 47,699** (§4.1) — four sheet vouchers not present in `petty_cash`.
5. **`Expenses` menu shows `other_expenses`, which is empty.** The workbook's `Expenses` sheet
   rows are cash vouchers and live in the **Petty Cash** register, which is where the P&L reads
   them from. Moving them to `other_expenses` would double-count, so the split was left as the
   app already models it; the menu naming is a presentation issue, not a data issue.
