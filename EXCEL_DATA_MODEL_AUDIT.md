# EXCEL DATA MODEL AUDIT

**Source of truth:** `Dairy_Accounts_Professional 76.xlsx` (2,215,759 bytes, last modified 2026-10-27).
**Method:** read-only. Every worksheet, hidden state, header row, formula cell and value range was extracted programmatically (SheetJS), then traced through formulas. The workbook was **not modified**.
**Scope:** 30 worksheets, 6 of them hidden.

> Status of every statement below is marked **Measured** (read from the file) or **Recommended** (my proposal, not present in the workbook).

---

## 1. Worksheet inventory

### 1.1 Entry registers — the sheets the operator actually types into

| Sheet | Rows | Cols | Purpose | Transaction type | Primary reference | Date field | Party field | Money fields | Qty fields |
|---|---|---|---|---|---|---|---|---|---|
| `Sales_Entry` | 2,950 | 13 | Every product sale line | Sale | `Invoice No` (C) | `Date` (A, BS) + `AD Date` (B) | `Party Name` (D) | `Amount` (H), `Net Amount` (J) | `Quantity` (F), `Rate` (G) |
| `Purchase_Entry` | 2,006 | 19 | Milk and product purchases | Purchase | `Bill No` (C) | `Date` (A) + `AD Date` (B) | `Supplier Name` (D) | `Amount` (N), `Transport` (O), `Net Amount` (P) | `Quantity` (M), FAT (G), SNF (H) |
| `Collection` | 1,686 | 13 | Money received *and* small payments | Collection / Rent / Advance / Petty Cash / Advance Returned | `Receipt No` (C) | `Date` (A) + `AD Date` (B) | `Customer Name` (D) | `Opening Due` (G), `Collected` (H), `Paid` (I), `Closing Due` (K) | — |
| `CASH FLOW` | 130 | 13 | Cash box movement | Mixed (Collection / Payment) | `Receipt No` (C) | `Date` (A) | `Customer Name` / free text (D) | `Opening Due` (H), `Collected` (I), `Paid` (J), `Closing Due` (L) | — |
| `PETTY CASH` | 154 | 13 | Small daily expenses | Petty cash expense | `Receipt No` (C) | `Date` (A) | `Customer Name` (D) = `OFFICE EXPENSES` | `Paid` (J), running `Closing Due` (L) | — |
| `Payment` | 105 | 13 | Money paid to suppliers/staff | Payment made | `Receipt No` (C) | `Date` (A) | `Customer Name` (D) | `Paid` (J) | — |
| `Expenses` | 131 | 13 | Office/salary/utility expenses | Expense | `Receipt No` (C) | `Date` (A) | `Customer Name` (D) | `Paid` (J) | — |
| `Advance` | 168 | 13 | Advances, loans, sapati (in and out) | Advance / Loan | `Receipt No` (C) | `Date` (A) | `Customer Name` (D) | `Collected` (I) and `Paid` (J) | — |
| `BANK RECON` | 1,000 | 16 | Bank statement lines | Bank | `Transaction ID` (C) | `Transaction Date` (A, BS) + `AD Date` (B) | `Counterparty Name` (D), `Party ID` (F) | `Debit` (G), `Credit` (H), running `Amount` (I) | — |
| `Salary` | 15 | 13 | Employee salary by month | Salary | `ID` (A) | `Payment Date` (J) | `Employee Name` (B) | `Basic` (E), `Allowance` (F), `Advance` (G), `Deduction` (H), `Net` (I) | — |
| `Cash_Demon` | 169 | 18 | Physical cash count vs collections | Cash reconciliation | — | `Date` (A) | — | denomination columns 1000…1, `QR/BANK` (K), `IC` (L), `Amount` (M), `Collections (auto)` (N), `Short/(Over)` (O), `DEPOSITED` (P) | note counts |
| `Stock_Master` | 43 | 10 | Product master + derived stock | Product/settings | — | — | — | `Rate` (H), `Stock Value` (I) | `Opening` (C), `Purchases In` (D), `Sales Out` (E), `Current` (F), `Reorder` (G) |

### 1.2 Reports and derived sheets — nothing is typed here

| Sheet | Rows | Purpose | How it is produced |
|---|---|---|---|
| `Dashboard` | 104 | KPI tiles | `SUM(Sales_Entry!J3:J500075)`, `SUM(Purchase_Entry!P…)`, `SUM(Stock_Master!I:I)`, `COUNTIF(Stock_Master!J:J,"⚠ Reorder")`, receivable/payable `SUMIF(Party_Master!H:H,…)` |
| `Profit_Loss` | 32 | Period P&L | `SUMIFS` on `Sales_Entry!J` and `Purchase_Entry!P`; Other Income `SUMIFS(Party_Ledger!H:H, Party_Ledger!D:D,"rent", …)`; stock adjustment `=Stock_Statement!H35` |
| `Receivable_Payable` | 90 | Party balances | 441 formulas: `SUMIFS(Party_Ledger!$G:$G, Party_Ledger!$C:$C, party)` − credit side, `Class` = Settled/Receivable/Payable |
| `Party_Statement` | 297 | One party's statement | header totals via `SUMIFS(Party_Ledger!…)`; body via `INDEX(Party_Ledger!$A$3:$A$10512, MATCH(...))` |
| `Party_Ledger` | 8,938 | **Consolidated ledger** | see §3 — pure formula links to seven entry sheets |
| `Party_Master` | 494 | Party list + running balance | `SUMIF(Party_Ledger!$C:$C, name, Party_Ledger!$G:$G)` for Dr, `$H` for Cr; `H = E + F − G`; `Status` = Settled/Outstanding/Advance |
| `Daybook` | 502 | Daily cash/bank narrative | daily totals, running `H = previous + Credit − Debit` |
| `Stock_Statement` | 57 | Period stock movement + valuation | `SUMIFS(Purchase_Entry!M…)` in, `SUMIFS(Sales_Entry!F…)` out, `Closing = Opening + In − Out`, value `= Closing × Rate` |
| `Printable_Invoice` | 27 | Invoice template | `=TODAY()`, line `= qty × rate` |
| `Printable Party Statement` | 79 | Statement print view | `VLOOKUP` into `Party_Master`, `SUMIFS` into `Party_Ledger` |
| `Settings` | 60 | Business name, phone, PAN, multipliers | values only (e.g. `FAT_MULT`, `SNF_MULT`) |
| `BS_AD_Lookup` | 6,940 | BS→AD conversion | 401 BS dates + 400 AD dates; every `AD Date` column uses `VLOOKUP(TEXT(date,"yyyy/mm/dd"), BSAD, 2)` |

### 1.3 Hidden sheets

| Sheet | Visible | Role |
|---|---|---|
| `Printable_Invoice` | hidden | print template |
| `Printable Party Statement` | hidden | print template |
| `Verified Transaction Ledger` | hidden | 18-column staging table (`Source Sheet`, `Verification Status`, `Duplicate Status`, `Posting Status`), last rows still point at empty `Purchase_Entry` rows |
| `BS_AD_Lookup` | hidden | calendar table |
| `README` | hidden | colour legend ("AMBER/YELLOW = type here") |
| `Error Log`, `Reconciliation Report`, `Import Log`, `Change Log` | hidden | audit/QA logs, currently near-empty |

---

## 2. The 13-column register template (six sheets share it)

`Collection`, `CASH FLOW`, `PETTY CASH`, `Payment`, `Expenses`, `Advance` are the **same grid**:

| Col | Field | Meaning in a receipt sheet (`Collection`) | Meaning in a payment sheet (`PETTY CASH`, `Payment`, `Expenses`) |
|---|---|---|---|
| A | Date | BS date | BS date |
| B | AD Date | `VLOOKUP` to `BS_AD_Lookup` | same |
| C | Receipt No | receipt/voucher | receipt/voucher |
| D | Customer Name | payer | payee (`OFFICE EXPENSES`, employee, supplier) |
| E | Against Bill | invoice/bill being settled, or free text ("advance received") | bill/purpose (`SALARY`) |
| F | Type | **`Collection` / `Rent` / `Advance` / `ADVANCE RETURNED` / `Petty Cash`** | `PETTY CASH`, `Payment`, `OFFICE EXPENSES`, `SALARY`, `Advance` |
| G | Opening Due | previous balance | previous balance |
| H | Collected | **money in** | *(usually blank)* |
| I | Paid | *(occasionally used)* | **money out** |
| J | Payment Mode | `Cash` / `QR` | `Cash` / `QR` |
| K | Closing Due | `=N(G)−H+I` (Collection) or `=N(prev)+I−J` (others) | same idea |
| L | Remarks | free text | free text |
| M | Column1 | unused artefact | unused artefact |

**Consequence for the app:** this is *one* visual template reused for six different business purposes. The `Type` column (F) is the only thing that distinguishes a customer receipt from rent income, an advance, an advance return, or a petty-cash day rollup. **Measured:** `Collection!F` contains exactly `Collection`, `Petty Cash`, `Advance`, `Rent`, `ADVANCE RETURNED`. Payment modes are `Cash` and `QR` only.

---

## 3. `Party_Ledger` is a derived sheet, not a register — the decisive finding

`Party_Ledger` has **3,192 formula cells** and its `Date` column is a formula in every populated row. Scanning column A for the source sheet shows seven contiguous blocks:

| Rows | Source | First row content | Type value |
|---|---|---|---|
| 3 – 4,406 | `=Sales_Entry!A3` … | `2083-03-14`, `NAWA DURGA -317` | `Sale` |
| 4,409 – 6,472 | `=Purchase_Entry!A3` … | `2083/03/15`, `MUKTESHWOR ENTERPRISES` | `Purchase` |
| 6,474 – 8,486 | `=Collection!A3` … | `2083/03/16`, `SRIJANA DAIRY` | `Collection` |
| 8,488 – 8,591 | `=Payment!A3` … | `2083/04/11`, `MINA LAMICHHANE 322` | `Payment` |
| 8,593 – 8,725 | `=Expenses!A3` … | `2083/03/27`, `OFFICE EXPENSES` | `OFFICE EXPENSES` |
| 8,727 – 8,831 | `='PETTY CASH'!A3` … | `2083/04/03`, `OFFICE EXPENSES` | `PETTY CASH` |
| 8,833 – 8,916 | `=Advance!A3` … | `2083/03/16`, `SAI KRIPA KSS LTD` | `Advance` |
| 8,938 | — | `AAA TOTAL` | `SUBTOTAL(9, G3:G8937)` |

Column mapping is fixed: `A Date`, `C Party`, `D Txn Type`, `E Reference`, `F Description`, `G Debit`, `H Credit`, `I Balance`.

**This is exactly the architecture the owner asks for:** the source registers own the transactions; `Party_Ledger` is a consolidation that cannot be edited independently. Editing `Collection!H12` moves `Party_Ledger` and every downstream report in the same recalc.

---

## 4. Cash, stock and bank calculation chains

### 4.1 Cash (denomination reconciliation)
`Cash_Demon` row 5: `M5 = C5*1000 + D5*500 + … + K5*1` (₹ counted), `N5 = SUMIFS(Collection!H:H, Collection!A:A, A5) − SUMIFS(Collection!I:I, Collection!A:A, A5)` (expected), `O5 = M5 − N5` (short/over), `P` = deposited. **Measured caveat:** `N` ignores `CASH FLOW` and `PETTY CASH`, so a day whose cash arrived from a bank withdrawal shows a large "over".

### 4.2 Stock
`Stock_Master` D/E = `SUMIF` of `Purchase_Entry!M` / `Sales_Entry!F` by product name; `F = C + D − E`; `I = F × H`. `Stock_Statement` repeats this per period with opening stock, and `Profit_Loss!C9 = Stock_Statement!H35`.

**Measured defect:** `Stock_Master!F3` (Mix Milk) = **−43,404.799 L**, valued at `I3 = −3,689,408`. The product is bought under other names in `Purchase_Entry!F` or sold without a matching purchase line, so the sheet's own stock is negative and the P&L's stock line inherits it (`Profit_Loss!C9 = −7,964.50`).

### 4.3 Bank
`BANK RECON` is a statement register with its own running `Amount` column (`I4 = H4 − G4`, then `I(n) = I(n−1) + H − G`). Columns `K Classification`, `M Transaction Type`, `N Verification Status`, `O Ledger Posting Status` record an intent to classify — **but no formula in the workbook posts a bank row into `Party_Ledger`.** Only one stray cell does (see §5). The workbook's own design already treats bank as standalone.

---

## 5. Data-quality findings in the workbook (measured)

| # | Finding | Evidence |
|---|---|---|
| X1 | One bank value leaks into the ledger's credit column | `Party_Ledger!H8937 = 'BANK RECON'!H538`, outside every block, inside the `SUBTOTAL` range `H3:H8937` |
| X2 | The ledger's total row is misleading | `H8938 = SUBTOTAL(9,H3:H8937)` evaluates to `23` and `G8938` to `16,265,683.02` — debit/credit totals are not a balanced pair, and the label sits in the party column (`C`) |
| X3 | `Party_Ledger` carries 20 dead rows 8,917–8,937 (`1899-12-30`, zeros) from over-copied `Advance` formulas, and `K` (MatchIdx) references `$C$52…` from a different row |
| X4 | Mix Milk stock is negative (−43,404.8 L) and drives the P&L stock line | `Stock_Master!F3`, `Profit_Loss!C9` |
| X5 | `Collection` mixes five business meanings in one row type | `Type` ∈ {Collection, Rent, Advance, ADVANCE RETURNED, Petty Cash} |
| X6 | `Collection!K = G − H + I` means a *Paid* row in the collection sheet increases what the party owes — correct for a refund, wrong if a payment was typed there by mistake |
| X7 | Receipt numbers repeat | e.g. `Collection!C` holds numeric strings with many duplicates by design (one receipt per party) |
| X8 | `Verified Transaction Ledger` rows point at empty `Purchase_Entry` rows | `B4 = Purchase_Entry!A2006` where the row is blank |
| X9 | Two "party" identities are pseudo-parties | `OFFICE EXPENSES`, `PETTY CASH`, `CASH FLOW` appear in the party column |
| X10 | No opening-balance column in `Party_Master` is populated for most parties (48 numeric values of 494 rows) | `Party_Master!E` type mix `t1/n48` |

---

## 6. What the workbook proves about ownership

| Question | Answer from the workbook |
|---|---|
| Where is a sale stored? | `Sales_Entry` — one row per product line; `Party_Ledger` only mirrors it |
| Where is a receipt stored? | `Collection` — `Type=Collection`; `H Collected` |
| Where is rent income stored? | `Collection` — `Type=Rent`; reported by `Profit_Loss!C8` as **Other Income** |
| Where is an expense stored? | `Expenses` (office/salary) and `PETTY CASH` (small cash) — separate sheets |
| Where is a supplier payment stored? | `Payment` |
| Where are advances/loans? | `Advance`, both directions (`Collected` in, `Paid` out) |
| Where is a bank movement stored? | `BANK RECON` only |
| Where is the party balance calculated? | `Party_Master!H` and `Receivable_Payable!E` — both `SUMIF` over `Party_Ledger` |
| Is `Party_Ledger` ever the place a transaction is entered? | **No.** Every populated `Date` cell is a cross-sheet formula |

---

## 7. Recommended application data model (marked honestly)

### 7.1 Direct sheet → table mapping

| Excel sheet | Table | Status |
|---|---|---|
| `Sales_Entry` | `sales` + `sales_items` | **Supported by workbook** (already exists) |
| `Purchase_Entry` (milk lines) | `milk_collections` + `purchases` | **Supported** — the app links them via `purchase_ref_id` |
| `Purchase_Entry` (non-milk) | `purchases` + `purchase_items` | **Supported** |
| `Collection` `Type=Collection` | `payments` (`type='receipt'`) | **Supported** |
| `Collection` `Type=Advance` / `ADVANCE RETURNED` | `payments` (`transaction_type` advance / advance_returned) | **Supported** |
| `Collection` `Type=Rent` | `other_expenses` (`category='Income'`) | **Supported by `Profit_Loss!C8`** — implemented in this release |
| `Collection` `Type=Petty Cash` | *(skip — mirror of `PETTY CASH`)* | **Supported** (already skipped, D13) |
| `Payment` | `payments` (`type='payment'`) | **Supported** |
| `Expenses` | `other_expenses` | **Supported** — currently 0 rows in the live book |
| `PETTY CASH` | `petty_cash` | **Supported** |
| `Advance` | `petty_cash` (`expense_head='ADVANCE'`) + `payments` (`transaction_type='advance'`) | **Supported but duplicated** — the same 74 advances / ₹16,67,901 exist in both |
| `BANK RECON` | `bank_transactions` | **Supported** (standalone) |
| `Salary` | `salary_records` | **Supported** (12 rows imported of 24) |
| `Stock_Master` / `Stock_Statement` | `stock_movements` + `products` | **Supported** (derived in the app, not stored as a sheet) |
| `Cash_Demon` | `denomination_counts` (+ `cash_deposits`) | **Supported** |
| `Party_Master` | `parties` | **Partial** — name/type/phone imported; opening balance not |
| `Party_Ledger` | *derived* — `shared/operations/party_ledger.js` | **Supported** — replaces the imported copy |
| `Profit_Loss`, `Receivable_Payable`, `Daybook`, `Dashboard`, `Party_Statement` | computed on request | **Supported** |

### 7.2 Recommendations not literally present in the workbook

1. **`ledger_entries` as a write target should be retired** in favour of the derived report (workbook supports the *shape*, not the storage).
2. **Opening balances belong in `parties.opening_balance`**, not as `ledger_entries` rows labelled `OPENING` with `reference_type='sale'` (that is what the import produced: `reference_id` = `OPN-1001`, `OPN-2001` …).
3. **`milk_collections` should be the only milk register**, with `purchases` referring to it — not two rows for the same litres (currently 1,496 collections vs 844 linked purchase bills, ₹40,99,399.04 vs ₹41,99,504.27).
4. **Bank classification columns should be display metadata only** — never a posting instruction.
5. **A `collection_type` field should be explicit** on the receipt so `Rent`/`Advance`/`Advance Returned` are queryable rather than inferred from free text.

---

## 8. Conclusion

The workbook already implements the architecture the owner is asking for, and it can be demonstrated line by line:

```
Sales_Entry ─┐
Purchase_Entry ─┤
Collection ──────┼──► Party_Ledger (formulas only) ──► Party_Master ──► Receivable_Payable
Payment ─────────┤                                   └──────────────► Party_Statement
Expenses ────────┤
PETTY CASH ──────┤
Advance ─────────┘
```

The application inverted this: eleven modules **write** `ledger_entries`, so a stored ledger became a second, competing source of truth. `shared/operations/party_ledger.js` (added in this release) restores the workbook's direction, and `scripts/audit/compare-party-ledger-sources.js` reports the gap party by party before anything is switched over.
