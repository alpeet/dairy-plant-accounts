# EXCEL COLUMN MAPPING

**Every column below was read from `Dairy_Accounts_Professional 76.xlsx`** (SheetJS, read-only), then matched to the application field that feeds it. Where the workbook has no matching field, the cell is left blank — never filled with an invented value.

Legend: **→** app writes this on sync · **·** left untouched · **ƒ** a formula in the workbook that the app does not overwrite

---

## 1. `Sales_Entry` (header row 2, 13 columns + App Ref)

| Col | Header (measured) | App field | Notes |
|---|---|---|---|
| A | `Date` | `sales.date` (BS string) | one row per `sales_items` line |
| B | `AD Date` | computed from `sales.date` via `bsToAD` | ƒ existing rows keep their `VLOOKUP` formula; new rows get the resolved AD date |
| C | `Invoice No` | `sales.invoice_no` | |
| D | `Party Name` | `parties.name` | |
| E | `Product` | `sales_items.product_name` | |
| F | `Quantity` | `sales_items.quantity` | numeric |
| G | `Rate` | `sales_items.rate` | numeric |
| H | `Amount` | `sales_items.amount` | numeric |
| I | `Discount %` | `sales.discount_percent` | numeric |
| J | `Net Amount` | `sales.grand_total` | numeric |
| K | `Payment Mode` | `sales.payment_mode` | cash / credit / bank / upi |
| L | `Status` | `sales.status` | paid / unpaid / partial |
| M | `Remarks` | `sales.notes` | |
| **N** | **`App Ref`** *(added by this release)* | `SALE-<id>#<line>` | stable key, new column only |

## 2. `Purchase_Entry` (header row 2, 19 columns + App Ref)

| Col | Header | App field | Notes |
|---|---|---|---|
| A | `Date` | `milk_collections.date` / `purchases.date` | |
| B | `AD Date` | computed | ƒ |
| C | `Bill No` | `milk_collections.collection_no` / `purchases.bill_no` | |
| D | `Supplier Name` | `parties.name` | |
| E | `Shift` | `milk_collections.shift` | blank for product purchases |
| F | `Product` | `milk_type` / `purchase_items.product_name` | |
| G | `FAT %` | `milk_collections.fat_percent` | |
| H | `SNF %` | `milk_collections.snf_percent` | |
| I | `Extra/Unit` | `milk_collections.extra_per_unit` | |
| J | `Rate Type` | `milk_collections.rate_type` (`formula`/`fixed`) | `FIXED` for product purchases |
| K | `Fixed Rate` | `milk_collections.fixed_rate` | |
| L | `Rate/Unit` | `milk_collections.rate` / `purchase_items.rate` | |
| M | `Quantity` | `quantity_liters` / `quantity` | numeric |
| N | `Amount` | `milk_collections.amount` / `purchase_items.amount` | numeric |
| O | `Transport` | `purchases.transport_charges` | 0 for milk |
| P | `Net Amount` | `milk_collections.amount` / `purchases.grand_total` | |
| Q | `Payment Mode` | `payment_mode` | |
| R | `Status` | `status` | |
| S | `Remarks` | `notes` | |
| **T** | **`App Ref`** | `MILK-<id>` or `PUR-<id>#<line>` | |

## 3. `Collection` (header row 2, 13 columns + App Ref)

Measured header: `Date, AD Date, Receipt No, Customer Name, Against Bill, Type, Opening Due, Collected, Paid, Payment Mode, Closing Due, REMARKS, Column1`

| Col | Header | App field | Notes |
|---|---|---|---|
| A | `Date` | `payments.date` / `other_expenses.date` | |
| B | `AD Date` | computed | ƒ |
| C | `Receipt No` | `payments.reference_id` / `other_expenses.reference_no` | |
| D | `Customer Name` | `parties.name`; tenant for rent | |
| E | `Against Bill` | `payments.reference_id` | |
| F | `Type` | `Collection` · `Rent` · `Advance` · `ADVANCE RETURNED` | **rent rows keep `Rent`** because `Profit_Loss!C8` sums them |
| G | `Opening Due` | *(blank)* | ƒ running figure in existing rows |
| H | `Collected` | `payments.amount` (receipt), rent amount | money in |
| I | `Paid` | 0 | |
| J | `Payment Mode` | `payments.mode` | cash / QR |
| K | `Closing Due` | *(blank on new rows)* | ƒ `=G−H+I` on existing rows |
| L | `REMARKS` | `notes` / `remarks` | |
| M | `Column1` | *(untouched artefact)* | never written |
| **N** | **`App Ref`** | `COL-<id>` / `COL-RENT-<id>` | |

## 4. `Payment`, `Expenses`, `Advance`, `PETTY CASH` (header row 2, 13 columns + App Ref)

These four share a **different** layout from `Collection` — measured, and the difference matters:

`Date, AD Date, Receipt No, Customer Name, Against Bill, **Description**, **Type**, Opening Due, **Collected**, **Paid**, Payment Mode, Closing Due, REMARKS`

| Col | Header | Payment | Expenses | Advance | Petty Cash |
|---|---|---|---|---|---|
| A | `Date` | `payments.date` | `other_expenses.date` | `payments.date` | `petty_cash.date` |
| B | `AD Date` | computed | computed | computed | computed |
| C | `Receipt No` | `reference_id` | `reference_no` | `reference_id` | `voucher_no` |
| D | `Customer Name` | party | `paid_to` | party | `paid_to` |
| E | `Against Bill` | `reference_type` | `expense_head` | `reference_type` | `expense_head` |
| F | `Description` | `notes` | `description` | `notes` | `description` |
| G | `Type` | `Payment` | `category` | `transaction_type` | `PETTY CASH` |
| H | `Opening Due` | blank | blank | blank | blank |
| I | `Collected` | blank | blank | only `loan_received` | blank |
| J | `Paid` | `amount` | `amount` | `amount` (unless loan received) | `amount` |
| K | `Payment Mode` | `mode` | `payment_mode` | `mode` | `payment_mode` |
| L | `Closing Due` | blank on new rows | ƒ | ƒ | ƒ |
| M | `REMARKS` | `notes` | `remarks` | `notes` | `remarks` |
| **N** | **`App Ref`** | `PAY-<id>` | `EXP-<id>` | `ADV-<id>` | `PC-<id>` |

## 5. `BANK RECON` (header row **3**, 16 columns + App Ref)

`Transaction Date, AD Date, Transaction ID, Counterparty Name, Description, Party ID, Debit, Credit, Amount, Payment Mode, Classification, Bank Account, Transaction Type, Verification Status, Ledger Posting Status, Remarks`

| Col | Header | App field | Notes |
|---|---|---|---|
| A | `Transaction Date` | `bank_transactions.date` | |
| B | `AD Date` | computed | |
| C | `Transaction ID` | `reference_no` or `txn_uid` | |
| D | `Counterparty Name` | `counterparty_name` | |
| E | `Description` | `description` | |
| F | `Party ID` | *(blank)* | deliberately not written: the app's `bank.party_id` is stale (BUG-018) |
| G | `Debit` | `debit` | money out |
| H | `Credit` | `credit` | money in |
| I | `Amount` | `amount` | |
| J | `Payment Mode` | `payment_mode` | |
| K | `Classification` | `accounting_class` | blank on a fresh schema (column absent) |
| L | `Bank Account` | `bank_account` | |
| M | `Transaction Type` | `txn_type` | |
| N | `Verification Status` | *(blank)* | operator-owned |
| O | `Ledger Posting Status` | `NOT POSTED (standalone)` | states the truth; bank never posts |
| P | `Remarks` | `remarks` | |
| **Q** | **`App Ref`** | `BANK-<id>` | |

**No other worksheet is written for a bank transaction.** A test scans every sheet for the `BANK-<id>` ref and asserts it appears in exactly one.

## 6. `Salary` (header row **3** — rows 1–2 are a title and a totals banner)

`ID, Employee Name *, Position, Month *, Basic Salary, Allowance, Advance, Deduction, Net Salary, Payment Date, Payment Mode, Remarks`

| Col | Header | App field |
|---|---|---|
| A | `ID` | `salary_records.employee_id` |
| B | `Employee Name *` | `employee_name` |
| C | `Position` | `position` |
| D | `Month *` | `month` (`2083-04`) |
| E | `Basic Salary` | `basic_salary` |
| F | `Allowance` | `allowance` |
| G | `Advance` | `advance` |
| H | `Deduction` | `deduction` |
| I | `Net Salary` | `net_salary` |
| J | `Payment Date` | `payment_date` (existing rows hold BS serials, e.g. `66931`; the app writes a BS `YYYY-MM-DD` string) |
| K | `Payment Mode` | `payment_mode` |
| L | `Remarks` | `remarks` |
| **M** | **`App Ref`** | `SAL-<id>` |

## 7. Worksheets the sync deliberately does not write

| Sheet | Reason |
|---|---|
| `Party_Ledger` | formula-derived; writing it would create the duplicate source of truth the audit forbids |
| `Profit_Loss`, `Dashboard`, `Receivable_Payable`, `Party_Statement`, `Daybook`, `Stock_Statement`, `Stock_Master`, `Printable_Invoice`, `Printable Party Statement` | derived by formulas; writing values would destroy the live links |
| `Party_Master` | master data; `opening_balance` is still unresolved (BUG-019) |
| `Cash_Demon` | column N is a live `SUMIFS` over `Collection`; overwriting it would break the cash reconciliation |
| `CASH FLOW` | no app module owns it; the app's cash view is computed from `payments` + `petty_cash` |
| `BS_AD_Lookup`, `Settings`, `README`, `Error Log`, audit sheets | reference/QA data |
| `Verified Transaction Ledger` | hidden staging table, not an app register |

## 8. Formatting rules applied to new rows

| Rule | How |
|---|---|
| Existing headers untouched | only cells inside `<sheetData>` are edited; header cells are only read |
| Existing formulas untouched | a patch replaces the specific `<c>` elements for mapped columns; every other cell's XML, including `<f>`, is copied |
| Number formats | a new cell copies the `s=` (style) of the same column in the row above, so money/date formatting matches |
| Dates stay text | BS dates are written as strings (`2083-04-10`), never as JS `Date` objects |
| Empty stays empty | a blank app value writes nothing rather than `0` or `""` |
| Other parts of the file | copied byte for byte (styles, merges, tables, charts, other sheets) |
| Safety | `.bak-excel-sync-<timestamp>` before every apply; atomic rename of a temp file |
