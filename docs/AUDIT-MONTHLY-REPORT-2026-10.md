# Audit & repair — BS dates, Monthly Report, advance rent, actual P&L

**Date:** 2026-10-17 · **App version:** 1.4.36 · **Books:** Prarambha Dairy Suppliers
**Data audited:** the live app database (`~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db`)
and the operator's workbook `Dairy_Accounts_Professional.xlsx`. BS **2083-03-15 → 2083-06-30** (AD 2026-06-29 → 2026-10-16).

Everything below was produced from the real books, on a copy of the database. No figure was typed by hand.

---

## 1. Root cause of the Nepali date problem

The application carried **two independent copies** of the Bikram Sambat month table —
`renderer/js/nepali-date.js` (the date picker) and `shared/excel-import.js` (the importer/server) —
and **both were wrong for 2083**:

| BS 2083 month | App said | Real calendar | Consequence |
|---|---:|---:|---|
| Jestha (02) | 32 | **31** | Jestha 32 offered although it does not exist |
| Ashwin (06) | 30 | **31** | **today (2083-06-31) could not be selected**; month-end reports cut a day short |
| Kartik (07) | 29 | **30** | every date after Ashwin shifted by a day |
| Mangsir (08) | 30 | **29** | same |
| Poush (09) | 29 | **30** | same |

Because `adToBS()` walked that wrong table, **AD→BS conversions drifted by one day after Jestha**, so
Excel-imported dates landed on the wrong BS day, "today" was computed as 2083-07-01 instead of
2083-06-31, and no amount of re-picking a date could reach Ashwin 31.

**How it was fixed (no hardcoded month, no one-off exception):**

- New single source **`shared/bs-calendar.js`** — real month lengths for **BS 2000–2090** (data from
  `nepali-date-converter` 3.4.0, cross-checked against the workbook's own `BS_AD_Lookup` sheet, whose
  2083 row lengths match exactly), plus `isSupportedYear`, `getBSDaysInMonth`, `bsMonthRange`,
  `addBSDays`, `shiftBSMonth`, `monthsBetween`, `validateBSRange`.
- `shared/excel-import.js` now **delegates** to it (`bsToAD`, `adToBS`, `getBSDaysInMonth`, `todayBSDate`)
  instead of keeping its own table.
- The browser cannot `require()`, so **`renderer/js/bs-calendar-data.js` is generated** from the Node
  table by `scripts/build-bs-calendar.js`; `scripts/audit/test-bs-calendar.js` fails if the two disagree.
- `renderer/js/nepali-date.js` rewritten: real day counts, **‹ › previous/next month** and
  **« » previous/next year** navigation, day clamp **to the real month end** (never reset to day 1),
  `validateRange`/`alignRange` for start/end validation, and picker/value re-sync via `setBSDateValue`.
- Supported range narrowed from a guess (2050–2100) to the years we can actually verify (**2000–2090**);
  anything outside is rejected instead of approximated.

**Verified in the running app** (live DOM read-back of the picker's own day lists):

```
2083-01 → 31 days   2083-03 → 32 days   2083-04 → 31 days
2083-05 → 31 days   2083-06 → 31 days   2083-07 → 30 days   2083-08 → 29 days
```
Shrawan 31, Bhadra 31, Ashwin 31 (today) and Ashadh 32 are all selectable; Jestha 32, Kartik 31 and
Mangsir 30 are rejected. Month-end selection, inclusive end dates and BS↔AD agreement are covered by
**79 automatic checks** (§7).

## 2. What was added

| Piece | Where |
|---|---|
| BS calendar (single source) | `shared/bs-calendar.js`, browser copy `renderer/js/bs-calendar-data.js`, generator `scripts/build-bs-calendar.js` |
| Monthly Report engine | `shared/operations/monthly_report.js` (activity + income/expense heads + per-month closing + reconciliation) |
| Prepaid expense engine | `shared/operations/prepaid_rent.js` (+ `prepaid_expenses` table, migration 34) |
| Excel sheet builder | `shared/export-monthly-report.js` (`buildMonthlyReportSheet`, `exportMonthlyReportExcel`, `insertMonthlyReportSheet`) |
| App screen | `renderer/js/monthly_report.js`, nav "Reports & Statements → Monthly Report" |
| Wiring | `main.js` (IPC), `server.js` (API + download), `preload.js`, `renderer/js/api.js`, `shared/operations/index.js` |
| Workbook edit | `scripts/audit/add-monthly-report-sheet.js` |
| Tests | `scripts/audit/test-bs-calendar.js` (79), `scripts/audit/test-monthly-report.js` (121) |

## 3. Income and expense — what the registers actually say

**Income heads** (sales invoice lines, opening-balance documents excluded):

| Head | Amount (Rs) | Lines |
|---|---:|---:|
| Milk Sales (Mix + Cow) | 3,762,436.79 | 2,243 |
| Paneer Sales | 78,400.00 | 35 |
| Cream Sales | 106,250.00 | 10 |
| Nauni / Butter Sales | 182,750.00 | 77 |
| Ghee Sales | 230,250.00 | 80 |
| **Sales revenue** | **4,364,376.82** | |
| Other income (rent/electricity recovered) | 4,290.00 | 2 |
| **Total income** | **4,368,666.82** | |

**Expense heads** (operating, each voucher recognised once):

Salaries and Wages 229,000 · Electricity 105,835 · Water 3,921 · Boiler Fuel/Firewood 23,820 ·
Transportation and Collection 12,700 · Packaging 13,139 · Repairs and Maintenance 22,655 ·
Cleaning Supplies 6,080 · Office Expenses 950 · Telephone and Internet 910 · Bank Charges 52 ·
Other Operating Expenses 113,914 → **total 532,976**.

**Cost of goods sold:** milk procurement 3,461,973.83 (1,240 collections, counted **once** — the milk
portion of every linked purchase bill is excluded from purchases) + non-milk purchases 891,934.79 =
**4,353,908.62**.

## 4. Actual Profit & Loss, BS 2083-03-15 → 2083-06-30 (latest verified document: 2083-06-30)

| | Rs |
|---|---:|
| Sales revenue (invoices, excl. opening balances) | 4,364,376.82 |
| Other income | 4,290.00 |
| **Total income** | **4,368,666.82** |
| Milk procurement cost | 3,461,973.83 |
| Other purchases | 891,934.79 |
| **Cost of goods sold** | **4,353,908.62** |
| **Gross profit** | **10,468.20** |
| Operating expenses (12 heads) | 532,976.00 |
| **Net profit / (loss)** | **−518,217.80** |

Month by month (each month's closing balance is the next month's opening balance):

| Month | Sales | COGS | Net | Closing cash | Closing bank |
|---|---:|---:|---:|---:|---:|
| Ashadh 2083 (from 03-15) | 717,538.15 | 1,356,364.03 | −665,645.88 | 455,300 | 21,659 |
| Shrawan 2083 | 1,223,477.25 | 1,007,636.94 | 99,823.31 | 426,695 | −362,859.5 |
| Bhadra 2083 | 1,267,009.89 | 1,092,290.96 | −73,790.07 | 257,787 | 463,049 |
| Ashwin 2083 | 1,156,351.53 | 897,616.69 | 121,394.84 | 766,477 | −974,518.5 |

Closing balances **are not** added to any month's income, and no month re-earns another month's
revenue (checked automatically).

## 5. Six months' advance rent — the real transaction

Found in the operator's own records (`PETTY CASH` row 183 and the party ledger):

| | |
|---|---|
| Party | **SAI KRIPA KSS LTD** |
| Date | **2083-06-30** (AD 2026-10-16) |
| Amount | **Rs 910,000.00**, cash |
| Description | “PAID TO SAIKRIPA FOR 6 MONTH ADVANCE RENT” |
| Recorded as | “Advance” in the petty-cash register and the party ledger (i.e. **never expensed**) |

**Treatment now:** Prepaid Rent (asset) Rs 910,000 on the payment date; **Rs 151,666.67 recognised as
Rent Expense in each of the six rental months from 2083-07 (Kartik)**, the last month absorbing the
rounding residual so the six months add up to exactly 910,000 and the asset runs to zero. The payment
month (Ashwin 2083) recognises **no** rent expense. Pro-rata recognition for partial periods.
The record is idempotent (`name + date + amount`), so re-running the script can never create a second
payment, and only **one** row exists in the live database.

## 6. Errors found and corrected

| # | Error | Effect | Correction |
|---|---|---|---|
| E1 | Wrong BS month lengths in two modules | today/Ashwin 31 unselectable, imports one day off | single shared calendar (§1) |
| E2 | **Opening-balance invoices (`OPN-…`) counted as sales revenue** — 24 documents, Rs 531,985 | income overstated by the whole opening book | excluded from revenue; shown as separate reconciling line |
| E3 | Six months' rent sitting as an “Advance” (or, if entered as rent, all in one month) | wrong P&L in the payment month | prepaid engine + monthly recognition (§5) |
| E4 | Closing inventory unvaluable: **negative stock** for Cow Milk −279.5, Ghee −117.5, NAUNI −193.5, PANEER −89 | COGS/closing stock cannot be trusted per product | reported as a data gap; negative quantities are never netted into the valuation |
| E5 | **Ledger cash (766,477) vs the operator's physical count (25,035 on 2083-06-28) = 741,442** | closing cash overstated | flagged on every report; cash payments to suppliers/farmers exist only in the ledger/workbook, not as cash documents |
| E6 | No opening cash/bank balance at books start | cumulative cash/bank start from zero | stated as a gap; movements are correct, absolute balances are not verified |
| E7 | No lot/FIFO costs recorded (`stock_lots` empty, no cutover date) | true FIFO COGS unavailable | COGS stated on the existing purchase/milk basis, with the basis labelled |

Money is never double counted: milk is counted once (collection register, linked purchase milk
excluded), supplier cash payments are not expensed twice, receipts are not income, and advances,
loans, deposits, transfers and capital stay on the balance sheet.

## 7. Tests and their actual results

| Check | Result |
|---|---|
| `node scripts/audit/test-bs-calendar.js` | **79 passed, 0 failed** — 2083/2082 lengths, every month end of 2000–2090, invalid rejections, BS↔AD round-trip of all 1,4xx days of 2082–2085, month/year navigation, workbook `BS_AD_Lookup` agreement, browser-table equality |
| `node scripts/audit/test-monthly-report.js` | **121 passed, 0 failed** — Bhadra/Shrawan/Ashwin month ends, inclusive last day, income heads = sales register, milk once, purchases not twice, advances/loans never in P&L, month continuity, six-month rent recognition, Excel sheet = engine, workbook edit preserves all 26 sheets |
| `test-accounting-logic` | 97 ✅ · `test-handover-reset` 40 ✅ · `test-stock-statement` 74 ✅ · `test-daily-stock-statement` 78 ✅ · `test-milk-reconciliation` 51 ✅ · `test-money-precision` 24 ✅ |
| `test-erp-acceptance` 62 ✅ · `test-trust-pack` 26 ✅ · `test-phase26-reconcile` 62 ✅ · `test-payment-types` 43 ✅ · `test-production-costing` 45 ✅ · `test-milk-costing` 50 ✅ · `test-employees` 30 ✅ · `test-products` 44 ✅ · `test-supplier-pricing` 63 ✅ · `test-bank-idempotency` 41 ✅ · `test-company-ledger` 35 ✅ · `test-pdc` 136 ✅ · `test-bulk-entry` 40 ✅ · `test-excel-roundtrip` 28 ✅ | all ✅ |
| `test-management-reports` | 58 ✅ (2 expectations updated: the previous week is now 2083-06-25…31 because Ashwin really has 31 days) |
| `test-advance-register` | 27 ✅ (3 expectations updated: 2083-06-25 → 2083-07-01 is 7 days, so the advance ages into the 7+ bucket) |
| `scripts/verify-modules.js` | 39 passed, **2 failed** — the documented `farmer-statement` / `party-statement` id-argument smoke cases (not masked) |
| `scripts/audit/test-pdf.js` | **not runnable under `node`** — it is an Electron script (`app.whenReady`), needs the Electron runtime |
| `integrity-doctor` | read-only diagnostics, run separately |

Live UI check: the app was started on a copy of the live database (port 3135), the Monthly Report page
rendered the real figures, the BS picker exposed the real month ends, a reversed range was rejected
with “Start date must be on or before the end date”, and the Reconciliation tab listed all 13 checks
with only the cash-count difference flagged.

## 8. Workbook

`Dairy_Accounts_Professional.xlsx` was **not** replaced. A new worksheet **`Monthly Report `**
(the trailing space is the requested name; SheetJS/Excel keep it in the workbook XML —
`name="Monthly Report "`) was added with Sections A–E (summary, income heads, expense heads,
monthly closing, reconciliation) + notes and data gaps, built by the same engine as the screen.
All **26 pre-existing sheets are preserved with their data**, and a timestamped backup
`Dairy_Accounts_Professional.xlsx.bak-monthly-report-<ts>` is written before every edit.
Because the workbook cannot recalculate itself from the database, the sheet is refreshed by
`node scripts/audit/add-monthly-report-sheet.js --apply` (or Settings → Export workbook), which is the
documented refresh path; the app database stays the single source of truth.

## 9. Missing / unresolved data (stated, never hidden)

1. **Cash payments to suppliers/farmers** are not recorded as cash documents → ledger cash ≠ physical
   cash by Rs 741,442 (at 2083-06-28).
2. **Negative closing quantities** for Cow Milk, Ghee, NAUNI, PANEER (and two junk products) → no
   reliable per-product closing stock or FIFO COGS until opening stock/purchases are entered.
3. **Opening cash/bank at books start** is not recorded → absolute cash/bank balances start from zero.
4. **Books end 2083-06-30**; today is 2083-06-31. The 06-29…06-31 activity (including the rent
   payment itself, which was entered in Excel) is not in the app database.
5. **No lot/FIFO costs** (stock_lots empty, no `lot_cutover_date`) → COGS is on the purchase/milk
   basis, labelled as such.
6. Production/wastage quantities are in mixed units in a few rows (e.g. `REPLACE`, `ELECTRICITY`
   products with −65/−1 kg) — product master data, not accounting logic.
