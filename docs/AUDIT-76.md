# Audit — `Dairy_Accounts_Professional 76.xlsx` vs Dairy Account Pro

**Date:** 2026-10-24 · **App version audited:** 1.4.41 → shipped as 1.4.42
**Workbook:** `Dairy_Accounts_Professional 76.xlsx` (2.0 MB, 30 sheets, 21 visible)
**Live database:** `~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db`
**Backups taken before any change**

| When | What | Path |
| --- | --- | --- |
| before the live import | full SQLite backup of the app database | `~/Library/Application Support/prarambha-account-stock/data/backups/pre-v76-import-2026-10-24T04-35-49-117Z.db` |
| before the rehearsal import | copy of the repo database | `data/backups/pre-v76-import-2026-10-24T10-14-26.db` |

Nothing was deleted. Every change below is an insert or an in-place correction of a
record that had been imported wrongly.

---

## 1. Workbook → software mapping

| Sheet | Rows read | Software module | Table(s) | Status |
| --- | --- | --- | --- | --- |
| `Party_Master` | 74 | Party Master | `parties` | ✅ imports, 1 new party (`DDC`) |
| `Stock_Master` | 9 products | Product Master | `products` | ✅ unchanged (8 already present) |
| `Sales_Entry` | 2 938 | Sales | `sales`, `sales_items`, `ledger_entries` | ✅ |
| `Purchase_Entry` | 1 635 | Purchases | `purchases`, `purchase_items` | ✅ |
| `Collection` | 1 609 | Payment Collection (money in) | `payments` (type `receipt`) | ✅ |
| `Payment` | 102 | **Payment Register** (money out) | `payments` (type `payment`) + `petty_cash` | ✅ register; ⚠️ see §4.3 |
| `Expenses` | 128 | Petty cash / Expenses | `petty_cash` | ✅ |
| `Advance` | 165 | Advance register | `petty_cash` + `payments` (advance) | ✅ |
| `PETTY CASH` | 151 | Petty cash | `petty_cash` | ✅ |
| `Salary Advance` | 12 | Payroll | `salary_records`, `employees` | 🔧 **fixed** — 4 rows were being dropped |
| `BANK RECON` | 121 | Bank Transactions | `bank_transactions` | 🔧 **fixed** — 30 rows were being dropped |
| `Cash_Demon` | 116 counted days | Cash Denomination | `denomination_counts` | ✅ (19 empty template rows correctly skipped) |
| `Profit_Loss`, `Receivable_Payable`, `Party_Statement`, `Party_Ledger`, `CASH FLOW`, `Daybook`, `Stock_Statement`, `Dashboard`, `Reconciliation Report` | — | **reports — never imported as transactions** | — | ✅ by design |
| `Error Log`, `Import Log`, `Change Log`, `Verified Transaction Ledger`, `Printable_*`, `README`, `Settings`, `BS_AD_Lookup` | — | reference / settings | `settings` (fill-blank only) | ✅ |

`Partner_Capital`, `Vehicle Expenses`, cash-deposit register and `other_expenses` are
empty in both the workbook and the app — nothing to reconcile.

---

## 2. Defects found and fixed

### 2.1 BANK RECON: every row after 2083 Ashoj 12 was silently dropped

**Symptom (reported):** bank transactions after 2083-06-12 “not updated”, and
`QR-087 / MODERN AGRO / 91,712` looking duplicated.

**Actual cause:** the `Transaction ID` column is broken in this workbook copy — from
sheet row 94 to the last row **all 31 rows carry the same reference `QR-089`**
(`QR-088` appears on row 93, then the counter stops incrementing).

`importBankRows` used the reference as the row identity (`txn_uid = ref:<no>`) and
skipped any row whose reference already existed. So the **first** `QR-089` row
(MODERN AGRO, 91,712, 2083-06-12) was imported and the other **30 rows were
discarded** — including QR-088…QR-089 for Ashoj 13–31, cash deposits of 108,655 /
174,100 / 141,905 / 120,500 / 109,095 and every customer receipt in that period.

**The “duplicate QR-087” was real, but it was not one duplicate — it was 15 of
them.** Before the fix, the importer had already inserted the same MODERN AGRO
payment once per import run: bank rows **#84–#97**, reference **empty**, uid
`imp:<hash>#0…#13`, created **2026-09-29 → 2026-10-03** (one per run), plus a
mislabelled copy **#98** (`QR-087`, 2026-10-05). The correct row is **#100**
(`QR-089`, the reference the workbook uses). 15 × 91,712 = **Rs 1,375,680** of
phantom bank outflow. They are documented and removed — see §5.0.

**Fix (`shared/operations/bank.js`)** — a reference is no longer treated as a unique
key:

* a reference that appears **once** in the file still owns `ref:<no>`, so files
  imported before this change stay idempotent;
* a **reused** reference gets a content identity (`imp:<hash>#<occurrence>`), so
  every genuinely distinct row imports exactly once;
* before inserting, the row is compared with what the database already holds on
  **date + direction + amount + counterparty + description** (bank account and
  payment mode excluded — v76 moved 30 rows from “Sushil QR” to “PRARAMBHA”),
  which is what stopped the re-import from duplicating the already-stored
  `QR-089` row.

**Result on the live database:** `bank_transactions` 100 → 134 (+34), last
transaction date 2083-06-31. A second import adds **0** rows.

### 2.2 Salary Advance: 4 of 12 records dropped, 2 stored under the wrong month

**Symptom (reported):** salary rows exist in Excel but do not appear in the app,
repeatedly.

**Cause:** the importer preferred the payroll month written in the **Remarks**
column over the `Month` column. In v76 the remarks are copy-pasted down a block
(“2083 SHRAWAN SALARY” sits on Bhadra and Ashoj rows) while the `Month` column and
the payment date agree with each other on every row. Two records were saved under
the wrong month and four collided with them as “duplicates inside the sheet” and
were skipped:

| Employee | Sheet month | Sheet pay date | Was stored as |
| --- | --- | --- | --- |
| SARASWATI RAYMAJHI | 2083-05 | 2083-05-31 | *missing* |
| DIPAK NEPAL | 2083-05 | 2083-05-31 | *missing* |
| SARASWATI RAYMAJHI | 2083-06 | 2083-06-31 | *missing* |
| DIPAK NEPAL | 2083-06 | 2083-06-31 | *missing* |
| Nar Bahadur Rana | 2083-05 | 2083-05-31 | 2083-05, wrong pay date |
| OM BOMDEL | 2083-06 | 2083-06-31 | **2083-05** |

**Fix (`shared/excel-import.js`)** — month precedence is now
`Month column → payment date → remarks`. A record is matched on
`(employee, month)` and, failing that, on `(employee, payment date)`, so a row saved
earlier under a wrong month is **corrected in place** instead of being duplicated.

**Result:** `salary_records` 7 → 12, i.e. 3 employees × 4 months, Rs 47,000 per
month (Rs 23,500 in Ashadh), matching the sheet to the rupee.

### 2.3 Payment was creating and linking Bank Transactions

**Symptom:** the operator's rule — the Payment register must stay standalone — was
violated. `savePayment` created a `bank_transactions` row whenever a bank/UPI/cheque
mode came with a `bank_reference`, and matched existing rows **by reference number
only**. With 31 rows sharing `QR-089`, that could attach a payment to a completely
unrelated transaction.

**Fix (`shared/operations/payments.js`)** — `savePayment` no longer creates or links
a bank row under any circumstances. `bank_account` / `bank_reference` are still
stored on the payment as descriptive fields. `linkPaymentToBank` remains exported
for an explicit, user-initiated reconciliation only. The invoice-side back-stamp
performed by the bank import (`postBankToLedger`) is unchanged: it is an
import-side reconciliation that prevents the same money being posted twice.

### 2.4 Payment Register screen had no manual entry

**Symptom (reported):** “manual Payment Register option is missing”.

The register (`Payment Register` tab) was read-only: filters, Print and PDF, no way
to add, edit or delete. The entry form existed but only on the Payment Collection
screen.

**Fix (`renderer/js/cash.js`, `renderer/js/financial_reports.js`)** — the register
now has:

* **➕ Record Payment** (opens the existing entry form, pre-set to a money-out
  expense — no second payment module was created);
* **✏️ / 🗑** on every row (the existing edit/delete modals, now re-rendering the
  **register** instead of jumping to the Collection screen);
* the transaction type is shown per row, and the register row itself is unchanged
  accounting-wise (date, mode, type, notes can be edited; amount cannot).

### 2.5 Total Operating Expenses: three separate double counts

The Monthly Report and the Profit & Loss screen share one expense engine
(`accounting.getExpenseSummary` / `monthly_report.getExpenseHeads`), so these fixes
apply to both.

| Leak | Evidence | Treatment |
| --- | --- | --- |
| **Supplier settlements** booked as expenses | The Payment sheet / SushiQR rows land in `petty_cash` with the supplier as payee (“ONLINE TRANSFERRED TO MODERN AGRO”, 100 000). The purchase is already in COGS. | Excluded when the row is a `Payment`-register row **or** the same money is already in the Payment register (same date + party + amount). Reported as `supplier_settlements_excluded`. |
| **Payroll counted twice** | 11 petty rows “SARASWATI SALARY SRAWAN-2083” / “DIPAK SALAY BHADRA-2083” … total exactly Rs 142 500, plus “OM BOMDEL ASHOJ-2083” 22 000 — all also in `salary_records`. | Excluded when a `salary_records` row exists with the same payment date + amount and the row reads like payroll (employee name, “salary”/“salay”). Reported as `salary_duplicates_excluded`. |
| **Bank vouchers counted twice** | Same voucher entered in BANK RECON *and* the petty register: “TIRE PURCHASE” 9 200, “HYDROLIC JUGE” 2 200, “CARBON PAPER” 475, electricity 71 825 …, Rs 37 589.80. | The statement copy is skipped when a register row with the same date + amount and payee `OFFICE EXPENSES` exists. |

### 2.6 COGS included the opening-balance purchase documents

`Sales_Entry` rows with invoice `OPN-…` (19 invoices, Rs 531 985) are already kept
out of revenue as brought-forward receivables. The **purchase-side mirror** —
4 `OPN-` bills for exactly Rs 531 985 on 2083-03-15 — was *not* excluded, so the
month the books open showed Rs 531 985 of “purchases” that were never traded.

**Fix (`shared/operations/monthly_report.js`, `getCogs`)** — `OPN-` purchase bills
are excluded from COGS and reported separately as
`opening_purchase_documents`; the reconciliation check
“Purchase register vs purchases used in COGS” now names that bucket, so the full
register is still accounted for to the rupee.

### 2.7 Bank reconciliation checks were incomplete (false 3-million gap)

The “Bank payments vs expense/transfer side” check compared the statement side only
against `payments + expenses_paid + transfers_out`, omitting bank-mode payment
**documents that have no statement row yet** (Rs 3 090 237.63 on the live data), and
“Bank receipts vs movements” compared a figure with itself.

**Fix** — `getCashBankPosition` now exposes `receipts_documents` and
`payments_documents`, and both checks include them. The reconciliation now shows one
single difference: the operator's physical cash count.

---

## 3. Audit that found nothing to change

| Area | Evidence |
| --- | --- |
| Sales / purchases / collections import | sales 2 176 rows, purchases 815, collections 1 609 — all present, re-import adds 0 |
| Payment stays out of the bank register | `test-payment-bank-link.js` 31 checks |
| Collection / Cash Denomination ↔ bank | already supported: `cash_deposits.bank_txn_id`, `➕ To Register` in the Cash Deposit screen (copies a statement row, stores the link, shows 🔗, audit-logged), and statement rows classified `cash_to_bank_transfer` so a deposit reduces cash and raises bank **once** |
| Stock statement | `test-stock-statement.js` 74 checks — closing = opening + purchases + milk − sales, one engine only |
| BS calendar / BS dates | `test-bs-calendar.js` 79 checks |
| Party statements | receivables/payables vs party ledger check: difference 0 |
| Navigation | already grouped Overview / Operations / Production / Inventory / Master Data / Accounts / Reports / Administration — no reorganisation needed; no module was missing or duplicated |
| Prepaid rent (advance rent is an asset) | `test-monthly-report.js`, six-month recognition passes |

---

## 4. Import reconciliation (live database)

Backup: `.../data/backups/pre-v76-import-2026-10-24T04-35-49-117Z.db`.

| Table | Before | After | Note |
| --- | --- | --- | --- |
| `bank_transactions` | 100 | **120** | 34 restored + 1 missing deposit, then 15 duplicates removed (§5.0) |
| `salary_records` | 7 | **12** | 5 added, 2 corrected |
| `parties` | 99 | 99 | `DDC` + `RAMCHANDRA GAUTAM` already created by the earlier import; both net to zero |
| `sales` / `purchases` / `payments` / `petty_cash` / `denomination_counts` | 2176 / 815 / 1580 / 170 / 116 | unchanged | already in sync |
| second import run | — | **0 changes in every table** | idempotent |

Bank control totals after the import:

|  | Workbook | Database |
| --- | --- | --- |
| Debit | Rs 3 691 762.43 | Rs 3 691 762.43 |
| Credit | Rs 3 915 645.00 | Rs 3 915 635.00 |

119 of the 121 sheet rows compare by date + direction + amount + counterparty.
5 rows differ only because they were edited in the workbook **after** they had been
imported (see §5); the importer keeps the stored row, so no duplicate was created
and the credit side is Rs 10.00 short (one amount was raised from 4 500 to 4 510).
The remaining sheet row has no amount at all (`QR-003 BANK DEBOSIT`, both sides
blank) and is not a transaction.

---

## 5.0 Duplicate removal — evidence and audit trail

Executed on the live database with the backup in §4 verified first.

| | |
| --- | --- |
| Deleted | `bank_transactions` ids **84–98** (15 rows) |
| Kept | id **100**, `QR-089`, MODERN AGRO -315, 2083-06-12, debit 91,712 |
| Value removed | **Rs 1,375,680.00** |
| Why these are duplicates | identical date, party, description and amount; no reference number; `created_at` one per import run (2026-09-29 … 2026-10-03); the workbook holds exactly **one** such row |
| Why id 98 (`QR-087`) also went | in this workbook `QR-087` is the BASUDEV 91,682.50 payment, not this one |
| Ledger impact | **none** — no `ledger_entries` row references any of the 16 ids, and no `payments` row links to them |
| Evidence file | `data/backups/bank-duplicates-2083-06-12-MODERN-AGRO-*.json` (full row JSON, in the app's `data/backups` and in this repo) |
| Audit trail | one `audit_log` row per deletion (`action='delete'`, `old_values` = the full row, `new_values` = reason + evidence file) |
| Rollback | restore the backup named above, or re-insert from the evidence JSON |

Also corrected, with an `audit_log` update row: bank row **#83** was stored as
`QR-086` (BASUDEV DAIRY 316, 91,682.50, 2083-06-08, “PAYMENT FOR MILK SUPPLY
2083/05/23”). In this workbook that transaction is **`QR-087`** and `QR-086` is the
Rs 102,815 cash deposit of the same day. Relabelling #83 let the import bring in the
missing **Rs 102,815 deposit** (the one row by which the credit side was short).

## 5. Records that need your decision (not changed)

These five bank rows exist in both places with **different values**. The importer
keeps the stored row (no duplicate was created) but does not overwrite history.
Tell me which value is right and I will correct it with an audit trail.

| Ref | Stored in app | Workbook v76 | What changed |
| --- | --- | --- | --- |
| `QR-012` | 2083-04-08, LILADHAR GAUTAM electricity 12 010 | 2083-03-31, same | date moved 8 days earlier |
| `QR-044` | 2083-05-06, water 2 278 | 2083-04-31, same | date moved |
| `QR-056` | 2083-05-20, OFFICE EXPENSES 10 000 | 2083-05-20, **INVESTMENT** 10 000 | counterparty → capital, not expense |
| `QR-078` | 2083-06-02, BALKRISHNA GYAWALI 4 500 | 4 510 | amount +10 |
| `QR-082` | 2083-06-05, electricity 71 825 | 2083-05-31, same | date moved |

Other items that need a human decision:

1. **`INVESTMENT` rows in the bank statement** (CCTV 16 800, iron pipe and tin
   35 045, Thapa Grill 10 000) are capital expenditure sitting in operating
   expenses. They are small enough not to change the conclusion, but they are not
   “operating” costs.
2. **`MUKTESHWOR ENTERPRISES — DISSEL` Rs 60 089 and Rs 143 036** are a purchase of
   diesel (a cost of sales item), currently classified as an operating expense.
3. **The `Transaction ID` column in BANK RECON is broken** (31 rows all `QR-089`).
   I strongly recommend renumbering it in the workbook — the importer no longer
   depends on it, but you cannot reference a bank row by it any more.
4. **Salary Advance sheet header** still says “Records: 24” while the sheet holds 12
   — cosmetic, not imported.
5. **`Cash_Demon` DEPOSITED column** (Rs 6 630 980 in the totals row) is not
   imported on purpose: those deposits are already in the bank statement as
   `CASH DEPOSIT BY KESHAB`, so importing them again would double the cash-to-bank
   movement. Use **Cash Deposit → ➕ To Register** when you want a deposit tracked
   in the register with a link to its bank row.

---

## 6. Actual Profit & Loss (verified)

Engine: `shared/operations/monthly_report.js` (the same engine as the Monthly Report
screen and the workbook export). Every figure below was independently recomputed
with plain SQL against the same database — see the “independent” column in the
checks file.

| Month | Sales revenue | COGS (milk + purchases) | Gross profit | Operating expenses | **Net profit** |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ashadh 2083 (Mar) | 665 411.15 | 709 934.78 | −44 523.63 | 52 510.00 | **−95 353.63** |
| Shrawan 2083 (Apr) | 1 240 492.25 | 992 421.94 | 248 070.31 | 225 251.00 | **+25 834.31** |
| Bhadra 2083 (May) | 1 323 204.89 | 1 074 023.96 | 249 180.93 | 187 848.00 | **+64 402.93** |
| Ashwin 2083 (Jun) | 1 320 861.53 | 1 078 193.42 | 242 668.11 | 268 675.80 | **−20 787.69** |
| Kartik 2083 (1–7) | 180 150.00 | 109 842.94 | 70 307.06 | 35 388.89 | **+34 918.17** |

Ashwin 2083 expense heads: salaries and wages 72 000 · electricity 73 025 ·
repairs and maintenance 55 070 · boiler fuel 10 900 · water 2 486.80 ·
packaging 475 · other operating 79 719.

Reconciling lines that are **not** in the P&L (and why):

| Item | Amount (Ashwin 2083) | Why not P&L |
| --- | ---: | --- |
| Supplier settlements in the cash register | 1 102 924.50 | the purchase is already in COGS |
| Payroll rows duplicated in the cash register | 47 000.00 | recognised once from `salary_records` |
| Opening-balance documents (`OPN-…`) | 531 985.00 (Ashadh) | brought forward, not traded |
| Customer receipts / collections | — | settle receivables, never income |
| Advances, loans, partner capital | — | balance sheet only |

**Costing basis (stated, not guessed):** COGS = milk procurement (Milk Collection is
the source; a linked purchase bill's milk portion is removed) + non-milk purchases,
i.e. an **acquisition-cost basis**. The app carries no lot costs yet, so closing
inventory (Rs 209 341.20 at master rates) is *not* deducted from COGS. With a
multi-million litre stock position this is the largest remaining approximation in
gross profit; it is a policy decision, not an arithmetic error.

---

## 7. Tests actually run

| Test | Result |
| --- | --- |
| `node scripts/audit/run-all-tests.js` | **30/30 files pass** (baseline before this work: 26/30, with `test-handover-reset`, `test-employees`, `test-milk-supplier-identity` failing because the workbook had been renamed, and `test-monthly-report` failing 2 checks) |
| `test-workbook-import-76.js` (new) | 18/18 — reused reference imports once, re-import adds nothing, salary month precedence, stale month corrected not duplicated, payments never touch the bank register |
| `test-payment-bank-link.js` (rewritten to the new rule) | 31/31 |
| `test-monthly-report.js` | 110/111 — the one failure is the operator's physical cash count (§8) |
| `test-accounting-logic.js` | 97/97 |
| `test-stock-statement.js` | 74/74 |
| live import, run twice | first run +34 bank / +5 salary / 2 corrected; second run 0 changes |
| `integrity-doctor.js` | no new class of problem; one check improved (8 → 0 “stock moved against a document that no longer exists”) |

---

## 8. Open items (cannot be closed without more data)

1. **Cash on hand vs the physical count.** The ledger's cash position is
   −Rs 3 490 023 while the operator counted Rs 33 250 on 2083-07-02 — a gap of
   Rs 3 523 273. Cash paid to suppliers/farmers that was only written to the party
   ledger (or only in the workbook) has no cash document in the app, and the opening
   cash/bank balances at the start of the books were never recorded. Until those
   documents exist, the cash figure is a movement, not a verified balance. Nothing
   was invented to close it.
2. **Opening cash and bank balances** are not in the database; every cumulative
   cash/bank figure starts from zero.
3. **Per-head expense classification** is imperfect where the workbook misspells a
   head (“DISSEL”, “OM BOMDEL ASHOJ-2083”): those land in “Other Operating
   Expenses”. The **total** is correct; only the split is coarse.
4. **`integrity-doctor`** still reports pre-existing, systemic findings on this
   database (documents without a ledger entry, duplicate postings, purchase line
   totals, milk rate chart mismatches). They scale with the number of documents and
   predate this audit; they were **not** introduced by the import and were not
   silently "fixed" here.

---

## 9. Files changed

| File | Change |
| --- | --- |
| `shared/operations/bank.js` | reference-reuse identity + content dedupe in `importBankRows` |
| `shared/excel-import.js` | payroll month precedence, payment-date matching, `normalizePayrollMonth` |
| `shared/operations/payments.js` | `savePayment` never creates/links a bank row |
| `shared/operations/accounting.js` | `PETTY_SETTLEMENT_SQL`, `PETTY_SALARY_DUP_SQL`, `PETTY_DUPLICATE_SQL`, register/bank voucher dedupe, `receipts_documents` / `payments_documents` |
| `shared/operations/monthly_report.js` | expense exclusions + reporting, `OPN-` purchase exclusion, corrected bank reconciliation checks |
| `shared/workbook-path.js` | finds the operator's numbered workbook (`… 76.xlsx`) when the plain name is absent |
| `renderer/js/cash.js` | Payment Register: manual entry, edit, delete, type column |
| `renderer/js/financial_reports.js` | entry form accepts a default type, refresh returns to the calling screen |
| `renderer/index.html` | script cache-bust versions |
| `scripts/audit/test-workbook-import-76.js` | new regression test |
| `scripts/audit/test-payment-bank-link.js` | rewritten for the standalone-payment rule |
| `scripts/audit/test-monthly-report.js` | purchase identity includes opening documents |
| `scripts/audit/run-all-tests.js` | new test registered in the suite |

**Database:** no schema change. The writes are the imports described in §4, the two
in-place salary corrections (§2.2), the reference correction on bank row #83 and the
15 duplicate removals documented in §5.0 — each with its own `audit_log` row and a
restorable evidence file. No other row was deleted or overwritten.
