# EXCEL IMPORT MAPPING

One worksheet per module. `Party_Ledger` is never an import source.

## Imported (13)

| Worksheet | Import function | Destination | Sidebar module |
|---|---|---|---|
| `Sales_Entry` | `importSales` | `sales`, `sales_items` | Sales |
| `Purchase_Entry` (milk) | `importPurchases` → `importMilkCollectionsSheet` | `milk_collections` | Milk Collection |
| `Purchase_Entry` (products) | `importPurchases` | `purchases`, `purchase_items` | Purchases |
| `Collection` | `importCollections` | `payments` (receipt / advance / advance return), `other_expenses` (rent income) | Payment Collection |
| `Payment` | `importPettyCashSheet` + `postPaymentRegisterRows` | `payments` (`type='payment'`) | Payment Register |
| `PETTY CASH` | `importPettyCashSheet` | `petty_cash` | Petty Cash |
| `Expenses` | `importPettyCashSheet` | `petty_cash` → *should be `other_expenses`* (BUG-020) | Expenses |
| `Advance` | `importPettyCashSheet` | `payments` (advance), `petty_cash` | Advances |
| `BANK RECON` | `importBankReconSheet` | `bank_transactions` only | Bank Transactions |
| `Salary` | `importSalaryAdvanceSheet` | `salary_records`, `employees` | Salary |
| `Party_Master` | `importParties` | `parties` | Parties |
| `Stock_Master` | `importProducts` | `products` (opening stock, rate) | Stock |
| `Settings` | `importSettingsFromWorkbook` | `settings` (fill-blank only) | Settings |
| `Cash_Demon` | `importCashDemonSheet` | `denomination_counts` | Cash |

## Excluded (17)

| Worksheet | Why |
|---|---|
| `Party_Ledger` | consolidated formula copy of the 7 registers — importing it duplicates every transaction |
| `Party_Statement`, `Printable Party Statement` | reports / print templates over `Party_Ledger` |
| `Verified Transaction Ledger` | hidden staging table (verification / duplicate / posting status) |
| `Daybook`, `Dashboard`, `Profit_Loss`, `Receivable_Payable`, `Stock_Statement`, `Reconciliation Report` | computed reports |
| `Import Log`, `Change Log`, `Error Log` | logs |
| `README`, `BS_AD_Lookup`, `Printable_Invoice` | legend / lookup / template |
| `CASH FLOW` | no application module owns it; cash is derived from `payments` + `petty_cash` |
| `Stock_Master` derived columns | `F` (current stock) and `I` (value) are formulas; only opening stock and rate are imported |

## Result of a fresh import of the real workbook (copy)

| Module | Rows | Total |
|---|---|---|
| Sales | 2,545 | 5,964,075.29 |
| Milk Collection | 1,690 | — |
| Purchases | 1,009 | 5,355,139.53 |
| Collection receipts | 1,712 | 5,134,577.00 |
| Payment Register | 53 | — |
| Bank | 136 | — |
| Salary | 12 | — |
| Petty Cash | 222 | — |
| Ledger rows from `Party_Ledger` | **0** | — |
