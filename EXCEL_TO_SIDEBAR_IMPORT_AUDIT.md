# EXCEL → SIDEBAR IMPORT AUDIT

**Workbook:** `Dairy_Accounts_Professional 76.xlsx` (30 worksheets) · **App:** 1.4.54
**Method:** workbook read with SheetJS (read-only); every import claim traced to a function in `shared/excel-import.js`. The import was then executed against a copy of the workbook and an empty database, and the results below are from that run.

---

## 1. The defect this audit found

`runExcelImport` had **two sources for the same transactions**:

```js
// before
const genLedger = mode === 'upsert';          // fresh: modules post NO ledger rows
if (mode === 'fresh') {                        // ...because the ledger sheet is imported instead
    results.ledger = importPartyLedger(db, ledgerSheet.data, …);
}
```

A *fresh* import read `Party_Ledger` — the consolidated, formula-driven copy — into `ledger_entries`, while every individual register was imported with ledger posting switched **off**. The app's party statements were therefore built from the workbook's copy, not from its own modules. Every row of that copy carries an Excel reference (`OPN-1001`, `BILL-5001`, `S 5963`), which is why the ledger could not be traced back to a `sales` / `purchases` row.

**Corrected:** `genLedger` is now `true` in both modes and `Party_Ledger` is never imported. It is reported as skipped, with a reason, in the import result.

---

## 2. All 30 worksheets, classified

| # | Worksheet | Role (verified) | Imported? | Destination |
|---|---|---|---|---|
| 1 | `Dashboard` | report — `SUM`/`COUNTIF` over registers | **no** | — |
| 2 | `Profit_Loss` | report — `SUMIFS` over registers + `Party_Ledger!H` for rent | **no** | — |
| 3 | `Receivable_Payable` | report — 441 `SUMIFS(Party_Ledger!…)` | **no** | — |
| 4 | `Party_Statement` | report — `INDEX/MATCH` into `Party_Ledger` | **no** | — |
| 5 | `Party_Ledger` | **consolidated copy** — 3,192 formulas linking the 7 registers | **no (was yes)** | — |
| 6 | `Sales_Entry` | register | **yes** | `sales`, `sales_items` → Sales |
| 7 | `Purchase_Entry` | register (milk + products) | **yes** | `milk_collections` → Milk Collection, `purchases`, `purchase_items` → Purchases |
| 8 | `Collection` | register (5 row types) | **yes** | `payments` (receipt / advance), `other_expenses` (rent) → Collection |
| 9 | `Cash_Demon` | physical cash count | **yes** | `denomination_counts` → Cash |
| 10 | `CASH FLOW` | cash narrative, no app module | **no** | — (reported) |
| 11 | `PETTY CASH` | register | **yes** | `petty_cash` → Petty Cash |
| 12 | `Payment` | register | **yes** | `payments` (payment) → Payment Register |
| 13 | `Expenses` | register | **yes**, but into `petty_cash` | Expenses module reads `other_expenses` → BUG-020 |
| 14 | `Advance` | register (in and out) | **yes** | `payments` (advance) + `petty_cash` → Advances |
| 15 | `BANK RECON` | register | **yes** | `bank_transactions` → Bank |
| 16 | `Party_Master` | master (parties, opening balance column all 0) | **yes** | `parties` → Parties |
| 17 | `Daybook` | report — daily narrative | **no** | — |
| 18 | `Stock_Master` | master + derived stock (`F = C + D − E`) | **yes** (opening/rate only) | `products` → Stock |
| 19 | `Stock_Statement` | report | **no** | — |
| 20 | `Printable_Invoice` | hidden print template | **no** | — |
| 21 | `Salary` | register (header on row 3) | **yes** | `salary_records`, `employees` → Salary |
| 22 | `Settings` | configuration values | **yes** (fill-blank only) | `settings` |
| 23 | `README` | hidden legend | **no** | — |
| 24 | `Error Log` | hidden QA log | **no** | — |
| 25 | `Reconciliation Report` | hidden report | **no** | — |
| 26 | `Import Log` | hidden log | **no** | — |
| 27 | `Change Log` | hidden log | **no** | — |
| 28 | `Printable Party Statement` | hidden print template | **no** | — |
| 29 | `Verified Transaction Ledger` | hidden staging table (Source Sheet / Verification / Duplicate / Posting status) | **no** | — |
| 30 | `BS_AD_Lookup` | hidden BS↔AD table | **no** (used for conversion only) | — |

**13 imported, 17 excluded.** Every excluded sheet is a report, template, log or lookup — not a transaction source.

---

## 3. Source → destination mapping (verified field by field)

| Worksheet | Module | Function | Destination tables | Identity used for duplicate detection |
|---|---|---|---|---|
| `Sales_Entry` | Sales | `importSales` | `sales`, `sales_items`, `stock_movements`, `ledger_entries` | invoice no (+ date, party) |
| `Purchase_Entry` | Milk Collection | `importPurchases` → `importMilkCollectionsSheet` | `milk_collections`, `stock_movements` | collection no / bill no |
| `Purchase_Entry` | Purchases | `importPurchases` | `purchases`, `purchase_items`, `stock_movements`, `ledger_entries` | bill no |
| `Collection` (Type=Collection) | Collection | `importCollections` | `payments` (`type='receipt'`), `ledger_entries` | party + date + amount + type, counted (allows genuine repeats) |
| `Collection` (Type=Rent) | Collection → income | `importCollections` | `other_expenses` (`category='Income'`) | party + date + amount |
| `Collection` (Type=Advance / ADVANCE RETURNED) | Advances | `importCollections` | `payments` (`transaction_type`) | party + date + amount + type |
| `Collection` (Type=Petty Cash) | — | `importCollections` | skipped (mirror of `PETTY CASH`) | — |
| `Payment` | Payment Register | `importPettyCashSheet` + `postPaymentRegisterRows` | `payments` (`type='payment'`), `ledger_entries` (`payment_made`) | party + date + amount, counted |
| `Expenses` | Expenses | `importPettyCashSheet` | `petty_cash` *(see BUG-020)* | date + amount + payee + head + description |
| `Advance` | Advances | `importPettyCashSheet` | `petty_cash`, `payments` (advance), `ledger_entries` | date + party + debit |
| `PETTY CASH` | Petty Cash | `importPettyCashSheet` | `petty_cash`, `ledger_entries` (advances) | date + amount + payee + head + description |
| `BANK RECON` | Bank | `importBankReconSheet` | `bank_transactions` **only** | reference no / date / amount |
| `Salary` | Salary | `importSalaryAdvanceSheet` | `salary_records`, `employees` | employee + month |
| `Party_Master` | Parties | `importParties` | `parties` | party name |
| `Stock_Master` | Stock | `importProducts` | `products` | product name |
| `Settings` | Settings | `importSettingsFromWorkbook` | `settings` | key (fill-blank only) |
| `Cash_Demon` | Cash | `importCashDemonSheet` | `denomination_counts` | date |

---

## 4. `Party_Ledger` — formula and relationship analysis

3,192 formula cells; the `Date` column is a formula in every populated row; there is not one typed transaction. Seven contiguous blocks:

| Rows | Source | Type |
|---|---|---|
| 3 – 4,406 | `=Sales_Entry!A3…` | sale |
| 4,409 – 6,472 | `=Purchase_Entry!A3…` | purchase |
| 6,474 – 8,486 | `=Collection!A3…` | collection |
| 8,488 – 8,591 | `=Payment!A3…` | payment |
| 8,593 – 8,725 | `=Expenses!A3…` | office expense |
| 8,727 – 8,831 | `='PETTY CASH'!A3…` | petty cash |
| 8,833 – 8,916 | `=Advance!A3…` | advance |

Per-row classification asked for in the brief:

| Row kind | Where it comes from | Action |
|---|---|---|
| Formula-generated reference | every row above | none — derived |
| Copied transaction | every row above | **must not be re-imported** (each original is read from its own sheet) |
| Manually entered transaction | none in the seven blocks | — |
| Opening balance | **not in `Party_Ledger`**: `Party_Master!E` is 0 for every party; opening documents are `OPN-…` invoice rows inside `Sales_Entry` | imported from `Sales_Entry`, typed as receivables |
| Adjustment | `adjustment` rows carry no resolvable reference | left in the legacy table; not imported |
| Derived reporting record | the whole sheet | reporting only |

**Consequence:** excluding the sheet loses nothing. Openings survive because they are sales rows with `OPN-` invoice numbers, which the monthly report already classifies as receivables rather than revenue.

Two anomalies in the sheet, for the record: `Party_Ledger!H8937 = 'BANK RECON'!H538` (a bank value inside the `SUBTOTAL` range) and 20 dead `1899-12-30` rows. Neither was ever importable data.

---

## 5. Import routes that were wrong

| # | Route | Status |
|---|---|---|
| 1 | Fresh import read `Party_Ledger` into `ledger_entries` **and** switched off ledger posting for sales / purchases / collections | **Fixed** — `genLedger = true` in both modes; sheet skipped |
| 2 | File header documented `Party_Ledger → ledger_entries` as a supported source | **Fixed** — header now states it is never imported |
| 3 | `importPettyCashSheet` suppressed advance ledger posting in fresh mode *because* the ledger sheet would post it — so advances would have vanished from statements once the sheet was skipped | **Fixed** — posting enabled in both modes, still de-duplicated by `date|party|debit` |
| 4 | `Expenses` sheet imports into `petty_cash`; the Expenses module reads `other_expenses` (empty) | **Open** — BUG-020 (changing it would move P&L figures; needs a decision) |
| 5 | `Payment` sheet rows also create a `petty_cash` row, so one payment appears in two registers | **Open** — reported, not changed (existing behaviour) |
| 6 | `Advance` sheet rows create a `petty_cash` row **and** an advance payment | **Open** — BUG-021 |
| 7 | `export-daily-account.js` writes a `Party_Ledger` sheet from `ledger_entries` | **Open** — export only, not an import route |
| 8 | `CASH FLOW` has no application module | **Reported** — deliberately not imported |

---

## 6. Duplicate risks and how they are handled

| Risk | Control |
|---|---|
| Re-importing the same workbook | count-based keys per module (party/date/amount, invoice no, bill no, employee+month) so repeats are `unchanged`, not new rows |
| Two identical genuine rows (e.g. two ₹1,00,000 transfers to the same party on the same day) | keys are **counted**, not boolean, so the second real row is preserved and a third import does not add a third |
| Ledger row duplicated per module | each module posts exactly one row per document; verified 1 sale ↔ 1 sale ledger row |
| Same advance in `PETTY CASH` and `Advance` | `existingAdv` set on `date|party|debit` blocks the second posting |
| Bank appearing in a party statement | bank has no ledger path; verified 0 bank-typed ledger rows |
| Party name as identity | never used alone — every key includes a document reference or a composite |

---

## 7. Code changes

`shared/excel-import.js`

1. `const genLedger = true;` for both modes, with the reason in a comment.
2. The `Party_Ledger` import block replaced by an explicit skip that returns `{skipped:true, sheet, reason}` and logs it.
3. `postAdvanceLedger` is now `true` in fresh mode too (it was conditional on the ledger sheet being the advance source).
4. File header corrected.

`scripts/audit/test-excel-import-routing.js` — new, 48 checks, runs a full import against a copy of the real workbook.

---

## 8. Test results (executed, not asserted)

Fresh import of a copy of `Dairy_Accounts_Professional 76.xlsx` into an empty database:

| Module | Rows | Total | Matches its worksheet |
|---|---|---|---|
| Sales (`Sales_Entry`) | 2,545 | 5,964,075.29 | ✅ Net Amount (J) |
| Milk Collection (`Purchase_Entry`) | 1,690 | — | ✅ |
| Purchases (`Purchase_Entry`) | 1,009 | 5,355,139.53 | ✅ Net Amount (P) |
| Collection receipts (`Collection`) | 1,712 | 5,134,577.00 | ✅ Collected (H), incl. 55,000 of `ADVANCE RETURNED` |
| Payment Register (`Payment`) | 53 | — | ✅ |
| Bank (`BANK RECON`) | 136 | — | ✅ |
| Salary (`Salary`) | 12 | — | ✅ |
| Petty Cash (`PETTY CASH`) | 222 | — | ✅ |

- `Party_Ledger` reported skipped, **0 rows** read from it.
- Every sale ledger row resolves to a real `Sales_Entry` invoice; every purchase ledger row to a real `Purchase_Entry` bill.
- Opening documents (`OPN-…`) arrive from `Sales_Entry`, one ledger row each.
- No report/log/template sheet appears in the import result (11 checked).
- Bank: 0 ledger links, 0 bank-typed ledger rows.
- Second import (upsert): **0 new rows** in sales, purchases, receipts, payments, bank, salary, petty cash or the ledger.
- **48 passed, 0 failed.**

**Not tested:** an edited workbook re-imported end-to-end (the edit path is covered by the existing upsert tests), and a fresh import against the live database — deliberately not run, since fresh mode clears transactional data.
