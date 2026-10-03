# Prarambha Dairy ERP — Phase 28 Final Audit Report

Report date: 2026-10-03 · Branch `master` · Base: v1.4.19 → Target release: **v1.4.20**
Companion document: [`SYSTEM-AUDIT.md`](SYSTEM-AUDIT.md) (Phase 1 pre-coding audit — all 10 findings resolved, see status notes there).
Evidence: 15 test suites, **778 checks passed / 0 failed**; `scripts/verify-modules.js` 39/2 (2 pre-existing baseline failures, unchanged).

---

## A. Existing functionality found

Reused unchanged because the audit proved it already works:

| Area | What exists | Verdict |
|---|---|---|
| Raw-milk cost layers | Every collection already writes its own `milk_lots` row carrying its actual supplier cost — supplier-specific pricing becomes separate cost lots automatically once pricing resolution landed (spec Phase 5). | Reused as-is |
| Cost chain | Raw Milk → Cream → Nauni → Ghee with NRV, FIFO finished-goods consumption, yield control, wastage, daily closing, traceability (v1.4.16–v1.4.19). | Reused as-is |
| Payment/advance/loan rules | `getPaymentPostingRule`, ledger account tags; advances and loans never reach P&L. | Reused as-is (extended for `advance_returned`, §E) |
| Expense recognition | `accounting.getExpenseSummary` counts each expense once, includes typed payments, excludes balance-sheet movements; bank rows deduped. | Reused as-is |
| Excel round-trip | ADD/UPDATE/UNCHANGED semantics, 28 parity tests. | Reused as-is |
| P&L engine | `getProfitLoss` accrual basis, milk counted once, lot COGS alongside purchase COGS. | Reused as-is — became the single source other views now consume |
| Daybook / party statements / P&L by month | Working document registers. | Reused as-is (Company Ledger is additive, not a replacement) |
| Audit log | Table + `logAudit` used across rates, milk, payments, expenses, production. | Reused (one gap closed, §B `adjustStock`) |
| Permissions, Excel import/export, cash/bank, loans/sapati, PDC | Working at v1.4.19, regression suites green. | Reused as-is |

## B. Functionality modified

| File(s) | Change | Why |
|---|---|---|
| `shared/operations/rates.js` | `getEffectiveRate(db, date, {party_id, milk_type})`; new `resolveMilkRate()` single entry point; `rateOverrideError()` guard; `round2`; PRAGMA-probed `listRateCharts`; supplier-aware `saveRateChart`. | One authoritative pricing engine (spec Phases 2–4). |
| `shared/operations/milk.js` | `saveMilkCollection` resolves the rate **server-side**, stores `calculated_rate` + `rate_override_reason`, audits overrides; ledger uses effective amount. | Client-supplied rates can no longer bypass the engine. |
| `shared/operations/bulk_entry.js` | Per-row `resolveMilkRate` + override guard. | Bulk entry must obey the same engine. |
| `shared/operations/payments.js` | `advance_returned` variants accepted by `normalizeTransactionType`. | Advance recovery returns (Phase 9). |
| `shared/operations/stock.js` | `adjustStock`: audit log, replay-based current balance, **negative qty now writes `outward_qty`** (was 0 → replay divergence), returns `{success,id,balance_after}`, takes `userId`. | Phase 25 audit trail + a real balance-integrity bug fix. |
| `shared/operations/dashboard.js` | Profit routed through `getProfitLoss` (legacy fallback); `profitSnapshot.milk_cost`; `monthlyMilk` series. | Audit finding #10a — dashboard had its own P&L math. |
| `shared/operations/accounting.js` | Added + exported `getLinkedMilkByBill`, `getLinkedMilkByMonth`, `getAdvanceRecoveryRegister`. | Phase 27 single-source extraction; Phase 9 register. |
| `shared/operations/dairy_costing.js` | Extracted + exported `productLotValue(db, productId)`; `getInventoryValuation` consumes it. | Phase 27 — duplicated lot-value SQL removed. |
| `shared/operations/company_ledger.js`, `management_reports.js`, `financial_reports.js` | All linked-milk queries now call the shared accounting helpers. | Phase 27 — 3 duplicate queries collapsed into 1. |
| `main.js`, `server.js` | `db:stock:adjust` / `/api/stock/adjust` thread `currentUser`/`req.user.id` into `adjustStock`. | Audit-trail user attribution. |
| `renderer/js/dashboard.js` | KPI hero rows from P&L, monthly milk chart, duplicate cards removed. | Phase 10/24 UI. |
| `renderer/css/style.css`, `renderer/index.html` | Design tokens, KPI classes, zebra/tabular-nums, `:focus-visible`, reduced-motion, responsive KPI grid; `css?v=4`, `dashboard.js?v=4`; sidebar regrouped. | Phases 19/20–24. |

## C. New functionality added

- **Supplier-specific pricing** — precedence supplier+milk_type > supplier > plant+milk_type > plant > legacy > settings default; specificity ordering `(party_id IS NOT NULL) DESC, (milk_type<>'') DESC, effective_from DESC, id DESC`; fixed (Rs/L) and fat/SNF formula methods per supplier with effective-from/to windows and active flag (spec Phases 2–4).
- **Company Ledger** — `shared/operations/company_ledger.js`; classified rows (income / expense / balance-sheet), running balance, period subtotals for daily/weekly/monthly/custom granularity, `checks[]` reconciling to P&L / milk cost / expense summary, `all_checks_ok`; API `/api/reports/company-ledger`; page **Reports → Company Ledger** (spec Phase 7).
- **Advance Recovery Register** — `getAdvanceRecoveryRegister(db,{as_of,party_id})` with lots, movements, ageing buckets (current/7/30/60/90+), summary (`advance_given/adjusted/returned/total_outstanding/open_advances`), checks; `advance_returned` posting rule (Cash/Bank DR → Advance Receivable CR, no P&L); page **Accounts → Advances** + dashboard outstanding-advance alert (spec Phases 8–10).
- **Management reporting** — `shared/operations/management_reports.js`: `EXPENSE_CATEGORIES` (14) + `normalizeExpenseCategory`, `getExpenseAnalysis` (rows sum to P&L expenses; current vs previous), `getBoardReport` (revenue breakdown, COGS, gross profit, operating expenses, net, factual indicators %, both periods, checks), `getManagementReport`; page **Reports → Management Reports** (3 tabs) (spec Phases 11–16).
- **Stock statement dual basis** — items enriched with `lot_quantity/lot_value/lot_unit_cost/valuation_basis` + `total_lot_value`, `lot_vs_master_diff`, `lot_valuation_available`; legacy master-rate figure kept visible (spec Phase 17).
- **Daily milk procurement view** — supplier count, litres by milk type, total cost, weighted avg/L, min/max rate, fixed vs fat/SNF split, drawn from the same collection data the pricing engine produced (spec Phase 6; exposed inside Company Ledger / management views rather than a duplicate table).
- **Dashboard KPIs + monthly milk chart** — Today's Sales/COGS/GP/Net from P&L, margin %, avg milk cost/L (P&L basis), milk received, advances, cash position, 6-month milk-litres series (spec Phases 10/24).

## D. Database changes

**Migration 26 only** (`shared/db.js`, mirrored in `database/schema.sql`) — additive and idempotent (PRAGMA-probed):

| Table | Column | Definition |
|---|---|---|
| `milk_rate_chart` | `party_id` | `INTEGER DEFAULT NULL` (NULL = plant-wide row) |
| `milk_rate_chart` | `effective_to` | `TEXT DEFAULT NULL` |
| `milk_rate_chart` | `milk_type` | `TEXT DEFAULT ''` (empty = all types) |
| `milk_rate_chart` | `is_active` | `INTEGER DEFAULT 1` |
| `milk_collections` | `rate_override_reason` | `TEXT DEFAULT ''` |

Plus index `idx_rate_chart_party ON milk_rate_chart(party_id)`.

**No new tables.** No `supplier_rates`, no `company_ledger` table, no `advance_register` table, no `expense_categories` table — every new feature is a read model over existing tables (spec priority 10).

## E. Accounting changes

1. **`advance_returned` posting rule** — Cash/Bank DR → Advance Receivable CR. Symmetric to `advance`; does not touch P&L. Advances still never become expenses; returns reduce the receivable, not income.
2. **Rate override auditability** — a collection whose final rate ≠ calculated rate is rejected without a reason; with a reason it stores `calculated_rate` + final rate + reason and writes an audit-log row (spec Phase 4).
3. **Single-source profit** — dashboard profit now comes from `getProfitLoss` (with legacy fallback for pre-engine days) instead of a private formula; `milk_cost` taken from P&L expenses.
4. **Company Ledger checks** — ledger totals are verified against `getProfitLoss`, `getMilkCostSummary` and `getExpenseSummary`; any drift sets `all_checks_ok = false`.
5. **Expense classification** — `normalizeExpenseCategory` maps five source vocabularies (`other_expenses.category`, `petty_cash.expense_head`, salary, `vehicle_expenses`, typed payments) onto 14 management categories. **Mapping only — no total changes**; P&L figures unchanged.
6. **Linked-milk single source** — `accounting.getLinkedMilkByBill` / `getLinkedMilkByMonth` replace three duplicated queries.

Nothing else in the accounting engine changed: no journal shape changes, no reclassification of historical entries, no change to balance-sheet vs P&L boundaries.

## F. Stock changes

1. **`adjustStock` integrity fix** — current balance now computed as replay `COALESCE(SUM(inward_qty − outward_qty), 0)` falling back to `opening_stock` when no movements exist, matching `getCurrentStock`. Previously it read the last movement's `balance_after`.
2. **Negative adjustments** now write the quantity into `outward_qty` (was written as 0, which would make replay drift from `balance_after` — a real divergence bug found in Phase 25).
3. **`adjustStock` audit log** — user, timestamp, entity, old/new balance (`balance_after`); user id threaded from Electron (`currentUser.id`) and web (`req.user.id`). Anonymous path still works (`null` user).
4. **Stock statement** quantities use SUM(inward−outward) replay and values are shown on **both** bases (legacy master-rate, plus lot FIFO cost) with an explicit difference line — stock value vs accounting inventory value is now visible instead of silently divergent.
5. **Opening stock** always gets an opening movement row, so SUM replay is authoritative (pre-existing rule, verified).

No change to FIFO consumption, NRV, lot creation, or daily closing logic.

## G. Production-cost changes

- **None functionally.** The v1.4.16–v1.4.19 costing engine (yield standards, overheads, lot consumption, `lot_cogs`) is untouched.
- Structural only: duplicated lot-value SQL inside `dairy_costing.js` extracted to `productLotValue(db, productId)` and exported; `getInventoryValuation` and `getStockLedger` both consume it — one authoritative lot valuation (spec Phase 27).
- Production-cost tests: 45/45, production-settings 29/29, milk-costing 50/50.

## H. UI/navigation changes

**Sidebar (Phase 19)** — regrouped into 8 groups, every existing page preserved and filed once, nav ≡ `pageModules`:
Overview · Operations · Production · Inventory · Master Data · Accounts · Reports & Statements · Administration.

**New pages**: Company Ledger, Advances (Advance Recovery Register), Management Reports (Expense Analysis / Board Report / Summary tabs).

**Design system (Phases 20–24)** — `ui-ux-pro-max` skill's "Data-Dense Dashboard" style (#1E40AF primary, Fira fonts, WCAG):
- Semantic tokens `--success/--success-bg/--danger-bg/--warning-bg/--info-bg`; KPI card classes (`kpi-primary/info/success/warning/danger`, `kpi-positive/negative`).
- `:focus-visible` outlines, cursor-pointer affordances, zebra striping, `font-variant-numeric: tabular-nums` on numeric cells, `@media (prefers-reduced-motion)`.
- Responsive KPI grid 4→2→1 columns (1280/900 breakpoints); tables keep horizontal scroll — data density preserved, not sacrificed for mobile.
- Dashboard restructured to KPI hero rows + monthly milk chart; duplicate cards removed.
- Cache-busting bumped: `css?v=4`, `dashboard.js?v=4`.

Verified visually in-browser (admin login, dashboard / company ledger / advances / management reports render; APIs 200; no console errors beyond favicon 404).

## I. Tests completed

Final run, all green:

| Suite | Result |
|---|---|
| `test-supplier-pricing.js` (Phases 2–6) | **63/63** |
| `test-company-ledger.js` (Phase 7) | **35/35** |
| `test-advance-register.js` (Phases 8–10) | **27/27** |
| `test-management-reports.js` (Phases 11–16) | **58/58** |
| `test-phase26-reconcile.js` (Phases 26–27, 4 realistic suppliers end-to-end) | **62/62** |
| `test-accounting-logic.js` | 96/96 |
| `test-payment-types.js` | 43/43 |
| `test-bulk-entry.js` | 40/40 |
| `test-milk-costing.js` | 50/50 |
| `test-production-costing.js` | 45/45 |
| `test-pdc.js` | 136/136 |
| `test-handover-reset.js` | 40/40 |
| `test-excel-roundtrip.js` | 28/28 |
| `test-trust-pack.js` | 26/26 |
| `test-production-settings.js` | 29/29 |
| **Total** | **778 passed / 0 failed** |
| `scripts/verify-modules.js` | 39/2 — the 2 failures are the **pre-existing** argument-validation baseline, present before this work |

`test-pdf.js` requires a running Electron app (`app.whenReady`) — environmental, excluded from the node battery; PDF export code unchanged in this upgrade.

Phase 26 reconciliation highlights (realistic data, Suppliers A–D: fixed 85 buffalo / formula 8–5 / fixed 72 cow / formula 6.5–4.2): collection amounts resolve per supplier, stock conservation holds (57,698 in = 22,825.10 sold + 34,873.95 closing ±2 rounding), P&L shows both purchase COGS (56,798) and lot COGS (22,825.10), company-ledger's 9 checks pass, board report and expense analysis produce identical numbers, supplier payments don't touch P&L.

## J. Remaining issues

1. **`verify-modules.js` 2 failures** — pre-existing argument-validation issues on `daybook`-adjacent modules; present at v1.4.19 baseline, not regressions. Worth a separate cleanup.
2. **`test-pdf.js` not in node battery** — needs Electron; should be exercised once in the packaged app smoke test.
3. **`package-lock.json` version stale** (says 1.4.6; `package.json` is source of truth) — long-standing, cosmetic.
4. **Historical master-rate stock values** remain visible alongside lot values (deliberate — see §L); once the team accepts lot valuation as authoritative, the legacy column could be retired in a future release.
5. **`data/` directory untracked** (DB backups, password-hash backups) — should stay out of git; confirm `.gitignore` coverage before any bulk `git add`.

## K. Data migration performed

- **Migration 26 only**: five additive columns + one index (§D). Runs idempotently at startup; no rows rewritten, no defaults applied to existing data beyond column defaults (`is_active = 1` makes all pre-existing rate rows active; `party_id = NULL` keeps them plant-wide).
- **No backfill of pricing**: historical collections keep their original `calculated_rate`; supplier rows apply from their `effective_from` onward.
- **No backfill of expense categories**: `normalizeExpenseCategory` is computed at read time, so historical expenses classify without being rewritten.
- **No historical stock re-pricing**: opening balances and past movements untouched.
- Rate-chart migration rehearsed via `scripts/audit/rehearse-milk-migration.js`; Excel round-trip re-verified 28/28 after schema change.

## L. Historical records that could not safely be recalculated

1. **Pre-cutover milk purchase costs** — collections entered before supplier pricing launched keep their original rates and amounts. Re-pricing them retroactively would rewrite supplier payables and historical P&L; deliberately **not** done (spec §23).
2. **Historical stock valuations** — before the lot statement existed, stock was valued at master selling price. Those legacy values remain in the statement's master-rate column for continuity; the lot basis is only available where lot records exist. The difference is now **disclosed** (`lot_vs_master_diff`) rather than hidden, but old periods cannot be revalued without inventing lot data that was never captured.
3. **Pre-existing `balance_after` snapshots** on old stock movements — recorded under the old adjustment logic; replay (authoritative from here on) may differ from those snapshots for pre-fix periods. New adjustments follow the corrected replay formula.
4. **Advances made before the register existed** — outstanding balances are correct (they come from tagged ledger rows), but per-advance age is bounded by payment date data on record; advances without recorded dates are bucketed as current rather than guessed into overdue.

---

**Verdict**: All 28 phases implemented and verified. Priorities 1–10 satisfied: one pricing engine, classified company ledger, advance ≠ expense enforced and tracked, board report from shared numbers, stock/production/cost reconciliation demonstrated with realistic data, restructured nav, modernized UI, full legacy battery green, no duplicate tables or parallel accounting logic.
