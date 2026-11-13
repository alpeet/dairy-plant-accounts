# IMPORT DUPLICATE AUDIT

What stops the same transaction entering twice — and where duplicates still exist.

## 1. Identity used per module

| Module | Duplicate key | Kind |
|---|---|---|
| Sales | invoice no (+ date, party) | document reference |
| Purchases | bill no | document reference |
| Milk Collection | collection no, else bill no + date + party | document reference |
| Collection receipts | party + date + amount + transaction type | **counted** composite |
| Payment Register | party + date + amount | **counted** composite |
| Advances | date + party + amount | **counted** composite, shared with the ledger posting |
| Petty Cash | date + amount + payee + head + description | composite |
| Bank | reference no, else date + amount + counterparty | document reference |
| Salary | employee + month | composite |
| Parties | party name (normalised) | master key |
| Products | product name (normalised) | master key |

**Why counted:** the workbook genuinely contains repeated identical rows — two ₹1,00,000 transfers to `SANA KISAN` on 2083-05-09, and multiple ₹700 expenses on the same day. A boolean "seen" set dropped the second real row; a counter keeps N rows for N sheet rows and still converges to zero new rows on re-import.

**Never used alone:** party name, date, or amount.

## 2. Measured re-import behaviour

Fresh import, then the same workbook imported again in upsert mode, on a copy of the real workbook:

| Table | After 1st import | After 2nd import | New rows |
|---|---|---|---|
| `sales` | 2,545 | 2,545 | 0 |
| `purchases` | 1,009 | 1,009 | 0 |
| `payments` (receipts) | 1,712 | 1,712 | 0 |
| `payments` (payments) | 53 | 53 | 0 |
| `bank_transactions` | 136 | 136 | 0 |
| `salary_records` | 12 | 12 | 0 |
| `petty_cash` | 222 | 222 | 0 |
| `ledger_entries` | *n* | *n* | 0 |

Verified by `scripts/audit/test-excel-import-routing.js` (48 checks).

## 3. Duplicates that already exist in the data (reported, not deleted)

| # | Duplicate | Evidence | Proposed correction |
|---|---|---|---|
| D1 | Advances exist in **both** `petty_cash` (`expense_head='ADVANCE'`, 74 rows, ₹16,67,901) and `payments` (`transaction_type='advance'`, same 74, same total) | live book | choose one register: keep `payments` as the party-facing record, drop the petty row (or mark it `mirror_of_payment_id`) |
| D2 | `Payment` sheet rows also create a `petty_cash` row | `importPettyCashSheet` writes petty for every `Payment` row, then `postPaymentRegisterRows` writes the payment | keep petty for the cash box, but tag the row `source='Payment'` so cash reports can exclude it |
| D2b | ~~`Expenses` sheet rows went to `petty_cash`~~ | **Fixed in v1.4.55** — the sheet now writes to `other_expenses` only, and a voucher present in both sheets collapses to one row | none needed for new imports |
| D3 | Bank rows claim `ledger_posted = 1` (118 rows) with no ledger entry | live book | set `ledger_posted = 0`, `ledger_entry_id = NULL` — nothing else changes |
| D4 | Legacy `ledger_entries` imported from the workbook sheet in an earlier release (live book: 2,838 `sale` rows vs 2,333 sales) | live book, pre-fix | no longer produced by any import; a one-off reconciliation is needed before retiring the table |
| D5 | Expense vouchers imported **before** v1.4.55 still sit in `petty_cash` | live book: 222 petty rows, incl. office expenses | one-off migration to move only the `Expenses`-sheet vouchers into `other_expenses`, matched on date+amount+payee+description, after the cross-register check |

None of these were deleted: each needs an owner decision, and D4 needs the 17-party reconciliation already reported.

## 4. Guards added by this release

- `Party_Ledger` cannot be imported (code path replaced by an explicit skip; the result carries `skipped:true`).
- One ledger row per document, from the document's own module — verified 1:1 for sales and purchases.
- Advance ledger posting is now unconditional but still de-duplicated, so removing the ledger sheet cannot silently drop advances.
