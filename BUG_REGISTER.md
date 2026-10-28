# BUG REGISTER — Prarambha Account & Stock Management

Statuses: **Verified** (fix proven by an executed test), **Fixed-Unverified**
(code changed, no executed proof), **Open**, **Blocked**.
Last updated: 2026-10-28, at v1.4.50.

Evidence commands are relative to the repo root. Every closure below names the
suite that proves it; a bug is never closed because code was edited.

---

## A. Accounting integrity

### BUG-001 — Bank statement row silently vanished from the bank balance
| | |
|---|---|
| Module | Cash & Bank position → Monthly Report (Closing Bank Balance) |
| Expected | Every credit on the bank statement increases the bank balance; every debit reduces it. |
| Actual | A credit whose narration read like an expense was classified `expense` and then counted in **neither** `customer_receipts` nor `cash_to_bank_transfer`, so 65,000 of real money disappeared from the balance while the drill-down still listed the row. |
| Reproduction | `node scripts/audit/test-report-drilldown.js` on the desktop database before this fix: `closing_bank @ 2083-07 — diff 65000`. |
| Root cause | `getCashBankPosition()` summed the *classification buckets* instead of the statement's own credit/debit totals. |
| Impact | Understated bank balance; report and its detail disagreed (traceability broken). |
| Files | `shared/operations/accounting.js` |
| Fix | Bank-in = all credits of non-transfer rows (+ cash deposits + bank-mode receipts not on the statement); bank-out = all debits of non-transfer rows (+ out-transfers + bank-mode payments). Classes now only label a row. |
| Test | `test-report-drilldown.js` — 703 checks, **0 failed** (was 2 failing) |
| Status | **Verified** |

### BUG-002 — Closing stock value could not be traced to its own valuation lines
| | |
|---|---|
| Module | Monthly Report → stock valuation / drill-down |
| Expected | Closing Stock Value = sum of the valuation lines shown for it. |
| Actual | 64,308.50 reported vs 38,000.00 in the lines (Ashadh 2083). |
| Root cause | A product whose quantity had fallen to zero kept a residual cost (valued receipts minus costed issues), and that residual was added to `inventory_value` while the zero-quantity line was not emitted. |
| Impact | Overstated closing stock → COGS and net profit wrong; drill-down flagged 4 months. |
| Files | `shared/operations/monthly_report.js` |
| Fix | A product with no quantity on hand now carries no stock value. |
| Test | `test-report-drilldown.js` (inventory lines reconcile), `test-monthly-report.js` 114/114 |
| Status | **Verified** |

### BUG-003 — Bank rows were counted as operating expenses (double count)
| | |
|---|---|
| Module | Expenses / P&L / Monthly Report / Company Ledger |
| Expected | The expense lives in its own register; a bank statement row is money movement, not a second expense. |
| Actual | Bank rows classified `expense` were added to `total_operating_expenses` (e.g. +700 on a fresh book), so an expense recorded in Petty Cash and paid by bank counted twice. |
| Files | `shared/operations/accounting.js`, `financial_reports.js`, `management_reports.js`, `company_ledger.js`, `report_drilldown.js` |
| Fix | Bank rows are excluded from every expense total and every expense drill-down. They are disclosed as `bank_expenses_excluded` and in the data-gap notes so a genuinely missing expense can be entered. The reconciliation check `expenses_total` now sums exactly the expense sources. |
| Test | `test-accounting-logic.js` 111/111 (`T6c`, `T6d`, `B4`), `test-company-ledger.js` 35/35, `test-management-reports.js` 58/58 |
| Status | **Verified** |

### BUG-004 — Entering a bank transaction posted into the party ledger
| | |
|---|---|
| Module | Bank Transactions → Party Ledger / Payments |
| Expected | The bank register is standalone: no ledger entry, no customer receipt, no supplier payment, no petty-cash/ex­pense row. |
| Actual | `saveBankTransaction()` auto-matched a counterparty by name and posted `ledger_entries`; `importBankRows()` did the same; bulk farmer payouts created bank rows; the Payment register created bank rows. The same money appeared in the bank tab **and** in the party ledger/expenses — the duplication reported by the owner. |
| Root cause | Automatic posting on write (`postBankToLedger`), plus a reverse link from payments into `bank_transactions`. |
| Files | `shared/operations/bank.js`, `payments.js`, `farmer.js`, `cash_deposit.js`, `pdc.js`, `shared/db.js` |
| Fix | All write-side cross-posting removed; legacy APIs (`postBankToLedger`, `setBankMatch` with a party/`post`) are no-ops that refuse to link. Historical links already in the database were left untouched (nothing deleted or rewritten). |
| Test | `test-bank-standalone.js` 11/11 (create/edit/import/delete each leave `petty_cash`, `other_expenses`, `payments`, `ledger_entries`, `cash_deposits`, `milk_collections`, `sales`, `purchases` unchanged), `test-accounting-logic.js` `T12`, `test-payment-bank-link.js` 32/32, `test-erp-acceptance.js` 63/63 |
| Status | **Verified** |

---

## B. Party statements / ledgers

### BUG-005 — Product lines printed with no quantity or rate (e.g. NAUNI)
| | |
|---|---|
| Module | Statements & Ledgers |
| Expected | A row that is a product line of its bill shows that line's quantity, unit and rate. |
| Actual | 56 of 66 NAUNI rows in the live book were blank. |
| Reproduction | Open any customer statement containing NAUNI (e.g. party 29, BILL-6474: `NAUNI 2,400` showed no 3 kg @ 800). |
| Root cause | The workbook importer posts **one ledger row per product** on a bill. The statement treated every bill with several ledger rows as a *split invoice* (same goods in instalments) and blanked every row except one "host". |
| Impact | Statements did not show what was sold — the owner's main complaint about "particulars". |
| Files | `shared/operations/statements.js` |
| Fix | Each row is matched to its own invoice line — by product name first, then by the row's exact amount, using only unambiguous evidence. A row that matches nothing stays blank (never borrows another line's goods). Bills that really are amount-only parts keep the single-host behaviour. |
| Test | `test-statement-items.js` 49/49, including a regression section that fails if any product-named row lacks quantity/rate; live check: **66/66 NAUNI rows enriched** |
| Status | **Verified** |

### BUG-006 — Item/Product and Unit columns removed from statements
| | |
|---|---|
| Requirement | Keep date, voucher, particulars, quantity, rate, debit, credit, running balance, payment status; remove only Item/Product and Unit. |
| Files | `renderer/js/statements.js`, `renderer/js/party.js` |
| Verification | `test-statement-items.js` section 9 audits the header rows of the screen and print/PDF tables: quantity & rate present, no Item/Unit column, no item/unit in the party-ledger modal. |
| Status | **Verified** |

---

## C. Stock control

### BUG-007 — Daily stock formula not carried across dates/month-ends
| | |
|---|---|
| Expected | Today's closing = yesterday's closing + today's purchases/collections − today's sales; tomorrow opens at today's closing; no reset at month end; cow/buffalo/mix reconciled without double counting. |
| Fix | One combined replay of the total (and per-product chains for drill-down), previous day's closing as the next opening, adjustments kept separate, shortfalls flagged. |
| Test | `test-daily-stock-statement.js` 78/78, `test-stock-statement.js` 74/74, `test-todays-stock.js` 21/21 |
| Status | **Verified** |

### BUG-008 — Five products carry negative closing stock (data)
| | |
|---|---|
| Module | Stock register / Monthly Report |
| Evidence | `Cow Milk −250.5 L, NAUNI −1, PANEER −5, Cream −9.1, REPLACE −65` (7 products negative on the desktop book at audit time) |
| Impact | Stock cannot be valued; COGS stays provisional; net profit is not verified actual profit. |
| Next action | Enter the missing opening stock / opening purchases for those products. The report already flags them. |
| Status | **Open (data)** |

### BUG-009 — Some stock has no defensible unit cost (data)
| | |
|---|---|
| Evidence | `Stock value is incomplete for 1 product(s) (Mix Milk 522.23 Liter): source movements or production batches lack defensible unit costs.` |
| Impact | Those litres are shown but not valued; closing stock and COGS stay flagged. |
| Status | **Open (data)** |

---

## D. Cash reconciliation (data)

### BUG-010 — Ledger cash does not agree with the operator's physical count
| | |
|---|---|
| Evidence | Ledger cash `−450,085.43` vs counted `58,730` on `2083-07-10` (difference `−508,815.43`) at the time of the reported run. |
| Meaning | Supplier/farmer payments recorded only in the party ledger (or only in the workbook) have no cash document, so ledger cash is overstated. |
| Status | **Open (data)** — reported in the Monthly Report data gaps. |

### BUG-011 — Opening cash and bank balances are not recorded
| | |
|---|---|
| Impact | Every cumulative cash/bank figure is a movement from zero, not a verified balance. |
| Status | **Open (data)** — stated in the report notes. |

---

## E. Carried forward from the earlier gap report — NOT re-verified in this session

These were reported by `GAP-REPORT.md` (earlier audit) and are listed so they are
not lost. They were **not** re-tested here; treat the status as *reported, unverified*.

| ID | Finding | Status |
|---|---|---|
| CAR-01 | No double-entry engine → no Trial Balance / Balance Sheet / Cash Flow; P&L is a table-sum. | Open (reported) |
| CAR-02 | Role enforcement missing on many routes. Measured today: **234 route registrations, 103 with `requireRole(`** — so at least 131 routes have no role check. | Open (measured count only) |
| CAR-03 | `audit_log` effectively empty in the working book (measured today: **1 row** for 92 parties). Audit trail exists but is not written by most modules. | Open (measured) |
| CAR-04 | `confirmAction()` can leave its promise unresolved on cancel/overlay (`utils.js`). | Open (reported) |
| CAR-05 | Invoice numbering not sequential/gap-free. | Open (reported) |
| CAR-06 | No AD date display alongside BS; BS table ends 2090. | Open (reported) |
| CAR-07 | PDF export has no page numbers / per-page subtotals / embedded Devanagari; `test-pdf.js` and `test-statement-pdf.js` need the Electron runtime and cannot run under plain `node`. | Blocked (verification) |
| CAR-08 | `cash_collections` table is referenced by `shared/operations/cash.js` but does not exist in `schema.sql` (confirmed: `no such table: cash_collections` on a fresh database). | Open |

---

## How to reproduce the verification

```bash
node scripts/audit/run-all-tests.js        # the whole suite, one summary table
node scripts/audit/test-bank-standalone.js # bank register creates nothing elsewhere
node scripts/audit/test-statement-items.js # statement columns + per-product qty/rate
node scripts/audit/test-report-drilldown.js# every report figure traces to its rows
node scripts/audit/test-monthly-report.js  # COGS, stock valuation, reconciliation
```
