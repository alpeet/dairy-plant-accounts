# TRANSACTION FLOW ARCHITECTURE

Where every record originates, where it is stored, and how it reaches a statement. Verified from source, not from intent.

---

## 1. The flow, in one diagram

```
              ┌─────────────────── ELECTRON / BROWSER ───────────────────┐
              │  renderer/js/<module>.js  →  window.api.*  |  fetch()   │
              └───────────────┬───────────────────────────┬─────────────┘
                              │ IPC (main.js)             │ REST (server.js)
                              ▼                           ▼
              ┌───────────────────────────────────────────────────────┐
              │  shared/operations/<module>.js   (validation + rules)  │
              └───────────────┬───────────────────────────────────────┘
                              │ one transaction per save
                              ▼
              ┌───────────────────────────────────────────────────────┐
              │  SQLite (better-sqlite3) — the operational record      │
              │  sales, sales_items, purchases, purchase_items,        │
              │  milk_collections, payments, petty_cash,               │
              │  other_expenses, bank_transactions, salary_records,    │
              │  stock_movements, …                                    │
              └───────┬───────────────────────────────┬───────────────┘
                      │                               │
        ┌─────────────▼─────────────┐   ┌─────────────▼──────────────────┐
        │ REPORTS (read-only)       │   │ EXCEL WRITE-BACK (explicit)    │
        │ monthly_report.js         │   │ shared/excel-sync.js           │
        │ party_ledger.js (derived) │   │  → one worksheet per module    │
        │ statements, P&L, daybook  │   │  → App Ref upsert, .bak first  │
        └───────────────────────────┘   └─────────────┬──────────────────┘
                                                      │ part-level surgery
                                                      ▼
                                        ┌──────────────────────────────┐
                                        │ Dairy_Accounts_Professional   │
                                        │  Sales_Entry  Purchase_Entry  │
                                        │  Collection   Payment         │
                                        │  Expenses     PETTY CASH      │
                                        │  Advance      BANK RECON      │
                                        │  Salary                       │
                                        │  Party_Ledger = formulas only │
                                        └──────────────────────────────┘
```

## 2. Two directions, never confused

| Direction | Trigger | Code | Overwrites? |
|---|---|---|---|
| **Excel → App** | Settings → *Update Data from Excel* (or `/api/excel/import`) | `shared/excel-import.js` (`runExcelImport`, modes `upsert` / `fresh`) | adds + updates by invoice/bill no; `fresh` clears transactional data first |
| **App → Excel** | Settings → *Write Back to Excel*, `scripts/excel-sync.js --apply`, `POST /api/excel/sync` | `shared/excel-sync.js` | patches rows matched by `App Ref`; appends the rest; never deletes |
| **Report → Excel** | Monthly Report export / *Export* buttons | `export-monthly-report.js`, `export-stock-statement.js`, `export-daily-account.js` | writes a sheet or a separate workbook |

There is **no** background timer, watcher or file-system listener. Nothing writes the workbook while the user is typing.

## 3. Per-module origin → storage → report

| Event | Originates in | Stored in | Appears in reports via | Appears in workbook via |
|---|---|---|---|---|
| Product sale | Sales / Bulk Entry / Invoice Generation | `sales` + `sales_items` (+ `stock_movements`) | `monthly_report.js` (revenue), `party_ledger.js` (debit) | `Sales_Entry` |
| Milk procurement | Milk Collection / Bulk Entry | `milk_collections` (+ optional `purchases` link) | `monthly_report.js` (milk cost), COGS | `Purchase_Entry` |
| Product purchase | Purchases | `purchases` + `purchase_items` | COGS | `Purchase_Entry` |
| Customer receipt | Payment Collection | `payments` (`type='receipt'`) | collection receipts (not revenue) | `Collection` (`Type=Collection`) |
| Rent received | Payment Collection | `other_expenses` (`category='Income'`) | Other Income | `Collection` (`Type=Rent`) — `Profit_Loss!C8` reads it |
| Supplier/staff payment | Payment Register | `payments` (`type='payment'`) | payables, cash flow | `Payment` |
| Advance / loan | Advances | `payments` (`transaction_type` advance/loan) | advances on the balance sheet | `Advance` |
| Petty cash | Petty Cash | `petty_cash` | operating expenses | `PETTY CASH` |
| Office expense | Expenses | `other_expenses` (non-income) | expense heads | `Expenses` |
| Bank statement line | Bank Transactions | `bank_transactions` | bank reports only | `BANK RECON` |
| Salary | Salary | `salary_records` | payroll reports | `Salary` |
| Stock movement | automatic on sale/purchase/production | `stock_movements` | stock statement, COGS | none (derived in the workbook) |
| Party statement | — (no storage) | — | `party_ledger.js` / `ledger_entries` | `Party_Ledger` (formula view) |

## 4. What the Party Ledger is now, and what it was

### 4.1 In the workbook
Seven formula blocks, 3,192 formula cells, zero typed rows. Editing a register changes the ledger on recalc. This is the model.

### 4.2 In the app (measured)
`ledger_entries` became a **second source of truth** because eleven modules wrote it *and* the workbook's ledger sheet was imported into it:

- 2,838 `sale` rows, of which **2,815** resolve to no `sales` row (`reference_id` is `OPN-1001`, not an integer id)
- 1,460 `purchase` rows, **all** orphaned (`BILL-5001`, `S 5963`)
- **0** `payment_made`, **0** `advance`, **0** `milk_collection` rows, while 53 payments (₹30,51,461.63) and 74 advances (₹16,67,901) exist in `payments`
- purchase ledger 4,795,338.69 vs registers 5,029,121.75 → **Δ 233,783.06**
- `parties.opening_balance` is 0 for all 98 parties; the 48 workbook openings live in the ledger as `OPENING` rows typed as `sale`

### 4.3 The replacement
`shared/operations/party_ledger.js` derives the statement from the owning registers (`getDerivedPartyLedger`, `getDerivedPartyBalances`), stamps `source_table` + `source_id`, counts milk once (a collection already on a purchase bill is skipped), and writes nothing. `reconcileWithStoredLedger` measures the gap before any switch: **81 parties match, 17 differ, net ₹5,25,325.94**.

The app's Statements screen still reads `ledger_entries` — switching it changes every party balance, so it waits for the owner's decision (`DATABASE_REPAIR_PLAN.md` §8).

## 5. Double-counting guards

| Risk | Guard |
|---|---|
| Receipts counted as revenue | revenue comes only from `sales`; receipts are reported as a separate line (live: sales 5,498,589.79 vs receipts 4,742,283.63 — adding them would overstate by 86%) |
| Rent counted as a receipt *and* as income | rent never creates a receipt or a party credit; it is `other_expenses.category='Income'` |
| Milk counted twice (collection + purchase bill) | `party_ledger.js` skips a collection with `purchase_ref_id`; `excel-sync` writes milk under `MILK-…` and the purchase bill under `PUR-…` |
| Bank counted in the ledger | bank has no posting path; 0 resolvable `ledger_entry_id`; 118 stale `ledger_posted` flags are display-only (BUG-018) |
| Advances counted in both `petty_cash` and `payments` | reported as BUG-021; the sync writes `payments` to `Advance` and `petty_cash` to `PETTY CASH`, so the workbook shows both — the duplicate must be resolved at the data level, not hidden |

## 6. Matching a DB record to its Excel row

```
App Ref = <PREFIX>-<source id>[#<line>]
  SALE-142#2   second line of sale 142
  MILK-77      milk collection 77
  PUR-19#1     first line of purchase 19
  COL-503      receipt 503
  COL-RENT-12  rent income row 12 (lives in other_expenses)
  PAY-88       payment made 88
  ADV-31       advance 31
  PC-9         petty cash voucher 9
  EXP-4        expense 4
  BANK-55      bank transaction 55
  SAL-3        salary record 3
```

The reference is stored in an `App Ref` column appended after the sheet's last used column, so no existing header, column or formula is displaced. Rows that predate the app have no reference and are never rewritten.

## 7. Failure behaviour (deliberate)

| Situation | Behaviour |
|---|---|
| Workbook open in Excel (`~$` lock) | sync refused with a message; file untouched |
| Worksheet missing from the workbook | module fails with "worksheet not found"; nothing is diverted to another sheet |
| Workbook read-only / permission denied | failure returned; no success message |
| Sync interrupted mid-write | writes to a temp file then renames, so the original is never half-written |
| Row deleted in the app | reported as orphaned; the workbook row is kept (archive) |
| Same sync run twice | second run appends 0 rows |
| Party Ledger requested | impossible: no module declares it, and a test asserts it |

## 8. Where the architecture is still incomplete

1. **`ledger_entries` still exists and 11 modules still write it.** The derived engine is available but Statements has not been switched (owner decision).
2. **Party_Ledger block heights.** Even after a perfect write-back, the workbook's ledger blocks only cover the original row counts — Sales ~1,644 rows, Purchase ~2,667, Collection ~1,394, Payment ~58, Petty ~275, Advance ~166 would be invisible. Either extend the formula blocks or use the app's derived statement.
3. **The full-workbook exporter writes a `Party_Ledger` sheet.** `export-daily-account.js:353` copies `ledger_entries` into a new workbook. It is an export, not a transaction path, but it propagates the stored ledger; it should be switched to `party_ledger.js` output when the owner approves the migration.
4. **No automatic sync on save** (see `SIDEBAR_EXCEL_DATA_FLOW_MAPPING.md` §6).
5. **`Expenses` import still lands in `petty_cash`** (BUG-020), so `other_expenses` is empty and the `Expenses` sheet receives 0 rows until that is fixed.
