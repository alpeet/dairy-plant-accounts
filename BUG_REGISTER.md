# BUG REGISTER — Prarambha Account & Stock Management

Statuses: **Verified** (fix proven by an executed test), **Fixed-Unverified**
(code changed, no executed proof), **Open**, **Blocked**.
Last updated: 2026-11-02, at v1.4.51.

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

### BUG-012 — Bank isolation was never proven across a restart
| | |
|---|---|
| Module | Bank Transactions → application startup |
| Expected (owner's acceptance table) | Add / edit / delete / import a bank row → only the bank module changes. A petty-cash expense, a payment collection and a party payment → no bank row. A restart → bank records stay correct, a deleted row stays deleted. |
| Actual | Every case held, but nothing executed proved it after a restart, so "deleted records return on restart" could neither be confirmed nor ruled out. |
| Root cause of the *risk* | Startup runs schema + 34 migrations + backfills + `ensureBankTable()` healing. `main.js`/`server.js` call `importBundledExcelData()`, which today is an intentional no-op — the one place a resurrection could have hidden. |
| Files | none changed (behaviour already correct); new proof added |
| Test | `test-bank-isolation-restart.js` — **32 checks, 0 failed**: only the bank table changes on add/edit/delete/import; re-import inserts nothing; petty cash, collection and party payment create no bank row and no `bank_txn_id`; after close + `initDatabase()` + `ensureBankTable()` every bank row is byte-identical, the deleted row stays deleted, no startup backfill writes another register, nothing is re-linked, and statement totals equal the bank rows' own sums. A source-level invariant also fails the suite if any runtime module other than `shared/operations/bank.js` writes `bank_transactions`. |
| Status | **Verified** |

### BUG-013 — Existing books still carry links created by the old auto-posting
| | |
|---|---|
| Module | Bank Transactions ↔ Party Ledger / Payments (historical data) |
| Expected | A bank row claims no party and no ledger entry. |
| Actual (measured 2026-11-02, read-only) | repo book: 120 bank rows — **92 with `party_id`**, **115 with `ledger_posted=1`**, **13 with a real `ledger_entry_id`**; 60 payments carry `bank_txn_id`. live desktop book: 136 rows — 85 / 118 / 6; 0 payments linked. |
| Meaning | The code no longer creates these, but the rows written before the fix remain. The 13 + 6 rows with a stored `ledger_entry_id` are the ones that provably created their own ledger entry — those party balances are inflated by the bank row they duplicate. Rows merely flagged `ledger_posted=1` were matched to an entry that already existed, so they are a stale *flag*, not an extra entry. |
| Impact | Party statements/receivables can be overstated for the affected parties until the stale links are cleared. |
| Status | **Open (data)** — needs a targeted, backed-up cleanup (see handover §6). Not deleted automatically: identifying a bank-created ledger entry for certain is only possible where `ledger_entry_id` is stored. |

### BUG-014 — The bank importer still printed "auto-posted to ledgers"
| | |
|---|---|
| Module | Excel import → BANK RECON summary log |
| Expected | A standalone register reports inserts, skips and classification only. |
| Actual | `importBankReconSheet()` read `report.auto_posted`, `already_in_ledger` and `review_queue` — fields the standalone importer no longer returns — so the level of the wording still implied cross-module posting. |
| Fix | The summary now states the register is standalone and reports transfers / expense-like rows / duplicates / undated rows instead. |
| Verification | Code inspection only — log text, no behaviour; the importer itself is covered by `test-bank-isolation-restart.js` §1 and `test-bank-idempotency.js` 41/41. |
| Status | **Fixed-Unverified** |

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
| CAR-08 | `cash_collections` was created at query time by `shared/operations/cash.js` but was absent from `schema.sql`, so a fresh install ran a different schema from a migrated one. | **Verified** — table added to `database/schema.sql`; a fresh `initDatabase()` now reports `cash_collections: YES` and `integrity_check: ok`. |

---

## How to reproduce the verification

```bash
node scripts/audit/run-all-tests.js        # the whole suite, one summary table
node scripts/audit/test-bank-standalone.js # bank register creates nothing elsewhere
node scripts/audit/test-bank-isolation-restart.js # ...and still doesn't after a restart
node scripts/audit/test-statement-items.js # statement columns + per-product qty/rate
node scripts/audit/test-report-drilldown.js# every report figure traces to its rows
node scripts/audit/test-monthly-report.js  # COGS, stock valuation, reconciliation
```
---

## Audit 2026-11-05 — Excel data-model review, Party Ledger ownership, Collection income

Measured against `Dairy_Accounts_Professional 76.xlsx` and the live book
(`~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db`, 98 parties).
Full detail: `EXCEL_DATA_MODEL_AUDIT.md`, `DATABASE_REPAIR_PLAN.md`.

| ID | Bug | Root cause | Status |
|---|---|---|---|
| BUG-015 | A Collection-sheet row typed **Rent** was booked as a customer receipt: it credited a tenant's account (showing as outstanding) and never reached the P&L | `importCollections()` branched on `Payment` / `Advance` / `ADVANCE RETURNED` / `Petty Cash` only; `Rent` fell through to `payType='receipt'`. The workbook's own `Profit_Loss!C8` reads `SUMIFS(Party_Ledger!H:H, Party_Ledger!D:D,"rent")` as Other Income | **Fixed, verified** — rent now writes `other_expenses(category='Income')`, idempotently; 12 checks in `test-party-ledger-derived.js` |
| BUG-016 | Party Ledger is a second source of truth that disagrees with the modules | 11 modules write `ledger_entries`, *and* the workbook's `Party_Ledger` sheet was imported into it. Imported rows carry string references (`OPN-1001`, `BILL-5001`), so **2,815/2,838** sale rows and **1,460/1,460** purchase rows have no matching module row; purchase totals differ by **Δ 233,783.06** | **Open — designed** — `party_ledger.js` derives the ledger from the modules instead; switch blocked on owner sign-off (Phase B) |
| BUG-017 | Supplier payments and advances never reach any party statement | `payments` has 53 payments (₹30,51,461.63) and 74 advances (₹16,67,901) but `ledger_entries` has **0** `payment_made` and **0** `advance` rows → payables overstated | **Open — surfaced** by the derived engine; needs Phase B posting decision |
| BUG-018 | Bank rows claim `ledger_posted = 1` with no ledger entry | Pre-fix auto-posting wrote the flag before/without posting; `ledger_entry_id` values resolve to nothing (0 of 6) | **Open — display only**; bank behaviour is isolated (32/32 restart checks). Must not be trusted by any report |
| BUG-019 | `parties.opening_balance` is 0 for all 98 parties, yet the workbook has 48 opening balances | Openings were imported as `ledger_entries` rows described `OPENING` with `reference_type='sale'`/`'purchase'` | **Open** — inflates "sales" in statements; move to `parties.opening_balance` (Phase B) |
| BUG-020 | The workbook's `Expenses` sheet is not in the Expenses register | `REGISTER_SHEET_NAMES = ['Payment','Expenses','Advance']` all import through `importPettyCashSheet`, so `other_expenses` is **empty** and `petty_cash` holds 212 rows / ₹50,63,138 including salary, diesel and supplier transfers | **Open** — P&L heads become indistinguishable |
| BUG-021 | 74 advances exist twice (petty cash + payments, identical amounts) | Two importers both claimed the advance rows | **Open** — no double count in P&L (advances are balance sheet), but a duplicate register |
| BUG-022 | Milk exists twice: 1,496 collections, all linked to 844 purchase bills | `Purchase_Entry` milk lines create `purchases` *and* `milk_collections` | **Mitigated, verified** — the derived ledger counts linked milk once (asserted); long-term one register should own the litres |
| BUG-023 | Workbook: one bank value leaks into the ledger's credit column inside the total range | `Party_Ledger!H8937 = 'BANK RECON'!H538`, outside every block, within `SUBTOTAL(9,H3:H8937)` | **Workbook issue** — do not import that row as a party entry |
| BUG-024 | Workbook: Mix Milk stock is −43,404.799 L and drives the P&L stock line | `Stock_Master!F3 = C + D − E` with purchases recorded under other product names | **Open (data entry)** — matches the app's negative closing stock; the app reports it rather than hiding it |
| BUG-025 | Workbook: `Party_Ledger` carries 20 dead `1899-12-30` rows and a `K` column referencing `$C$52` | Over-copied `Advance` formulas | **Workbook issue** — the importer must skip zero/epoch rows (it does: blank date → skipped) |
---

## Audit 2026-11-05 (v1.4.53) — per-module Excel write-back

| ID | Bug | Root cause | Status |
|---|---|---|---|
| BUG-026 | The app had **no per-module Excel write-back**: records entered in the app never reached their worksheet | The only writers were a whole-new-workbook export (`export-daily-account.js`) and a Monthly Report sheet insert (`xlsx-parts.js`). The real workbook was import-only | **Fixed** — `shared/excel-sync.js`, 10 modules, 63 checks |
| BUG-027 | The full export builds a `Party_Ledger` sheet from `ledger_entries`, propagating the parallel ledger | `export-daily-account.js:353` copies stored ledger rows into a new workbook | **Open** — export path; switch it to `party_ledger.js` when the ledger migration is approved |
| BUG-028 | The workbook's `Party_Ledger` formula blocks are fixed-height and would omit most new rows even with correct write-back | Blocks sized to the row counts at build time: Sales to 4,404, Purchase to 2,062, Collection to 2,011, Payment to 102, Expenses to 131, Petty to 103, Advance to 82 | **Open — reported** with measured numbers (`SIDEBAR_EXCEL_DATA_FLOW_MAPPING.md` §4.6). Extend the blocks or use the derived statement |
| BUG-029 | `bank_transactions.accounting_class` (and `txn_uid`) exist on a migrated book but **not** on a freshly initialised database | The columns were added by an ad-hoc migration, not by the base schema | **Open** — found by `test-excel-sync.js`; the sync reads the column defensively (`|| ''`) so it does not crash |
| BUG-030 | A workbook open in Excel could be overwritten by a sync, and Excel would then overwrite the sync on its next save | No `~$` lock check existed | **Fixed, tested** — sync refuses and writes nothing |
| BUG-031 | The register sheets do not share one layout: `Collection` has `Type` in F and `Collected` in H, while `Payment`/`Expenses`/`Advance`/`PETTY CASH` have `Description` in F, `Type` in G, `Collected` in I and `Paid` in J; `BANK RECON` and `Salary` put their header on row 3, and `Salary` has a totals banner above it | The workbook reuses a 13-column template with two variants; `Salary` was rebuilt with a banner | **Fixed** — field maps declared per sheet and columns resolved by header text, with measured layouts recorded in `EXCEL_COLUMN_MAPPING.md` |
