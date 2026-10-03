# Prarambha Dairy ERP — Phase 1 System Audit

Audit date: 2026-10-03 · Branch `master` · Base: v1.4.19 (scientific milk-to-product costing already shipped)
Scope: the 10 upgrade priorities (supplier pricing → company ledger → expense control → board reporting → nav/UI).
Rule applied: **reuse what works, extend what is partial, add only what is genuinely missing.**

---

## Audit Findings

| # | Area | Existing | Working? | Problem | Required Change |
|---|---|---|---|---|---|
| 1 | **Supplier-specific milk pricing** | `milk_rate_chart` (global, dated, `formula`/`fixed`) + `getEffectiveRate(db,date)` + `calculateMilkRate(fat,snf,chart)` (`shared/operations/rates.js`). Every collection snapshots `rate_type/fat_multiplier/snf_multiplier/fixed_rate/calculated_rate`. | ✅ for one global chart; ❌ for suppliers | No supplier dimension: every farmer gets the same chart. No effective-to, no per-supplier fixed rate, no active flag. Rate override has **no reason capture** (`GAP-REPORT` §2 also flags this). Backend `saveMilkCollection` stores whatever rate the client sends — it never resolves the rate itself. | **Extend the existing chart, do not add a second rate system**: add `party_id`, `effective_to`, `milk_type`, `is_active` to `milk_rate_chart`; `getEffectiveRate(db, date, {party_id, milk_type})` prefers the supplier row then falls back to the global row; one `resolveMilkRate()` entry point used by single entry, bulk entry and import; `rate_override_reason` on `milk_collections` + audit. |
| 2 | **Daily/weekly/monthly company ledger** | Daybook (`getDaybook`, `getEnhancedDaybook`), party statements, P&L and P&L-by-month. | ❌ missing | There is **no company-wide ledger** — the Daybook is a document register, not a classified financial ledger with Debit/Credit/Balance/Category, and nothing groups daily/weekly/monthly. | New `getCompanyLedger()` that **consumes the existing authoritative summaries** (P&L components, `getMilkCostSummary`, `getExpenseSummary`, `getLoanAdvanceBalances`, cash/bank position) — never re-sums documents on its own. |
| 3 | **Income & expense classification** | `ACCOUNT` map, `TRANSACTION_TYPES`, `classifyTransaction`, `getPaymentPostingRule`, `getExpenseSummary` (counts each expense once, typed payments included, advances/loans excluded), P&L `balance_sheet_movements` kept out of every total. | ✅ | Correct but **category-grain is fragmented**: `other_expenses.category`, `petty_cash.expense_head`, `salary`, `vehicle_expenses`, bank rows and typed payments are five different vocabularies, so "where did we spend money" cannot be answered. | Add **one** `normalizeExpenseCategory()` mapping every source to the management categories (Milk procurement, Salary, Electricity, Fuel, Rent, Packaging, Transport, …). Expense analysis and Board report both read it. No accounting change. |
| 4 | **Advance receivable & recovery** | `payments.transaction_type` (`advance`/`loan_given`/`loan_received`/`loan_repayment`/`advance_adjustment`), `getPaymentPostingRule`, `getLoanAdvanceBalances(as_of)` (three tag totals), ledger tags `[Advance Receivable]` etc. P&L already excludes them. | ✅ totals only | No **recovery register**: cannot see one advance, what was returned, what was adjusted against an approved expense, what is outstanding, or how old it is (7/30/60/90+). Dashboard has no advance alert. | New `getAdvanceRecoveryRegister()` + ageing buckets in `accounting.js`, reading the **existing** tagged ledger rows and `advance_adjustment` payments. No new table, no new posting rule. |
| 5 | **Board-level P&L / expense control** | `getProfitLoss` (accrual, milk counted once, lot COGS alongside), `getProfitLossByMonth`. | ✅ | No Board report: no current-vs-previous period comparison, no % of sales, no factual control indicators (expense +18%, electricity Rs/L, etc.), no weekly/monthly management report. | New report layer (`management_reports.js`) that calls `getProfitLoss`/`getExpenseSummary`/`getMilkCostSummary` for **both** periods and derives change/% — no independent re-summation. |
| 6 | **Stock/production/cost integration** | Lot engine (milk_lots/stock_lots/lot_consumptions), NRV, FIFO FG consumption, daily closing, `getInventoryValuation` (lot cost), P&L `lot_cogs`. | ⚠️ two valuations | `getStockStatement` values stock at `products.rate` (master **selling** price) × the last movement's `balance_after` — different quantity basis *and* different price basis from the lot engine. Stock value ≠ accounting inventory value by construction. | Add lot-cost column + reconciliation line to the stock statement (keep the legacy figure visible, as P&L does with `lot_cogs`); switch quantity to SUM(inward−outward) like the dashboard fix. |
| 7 | **Navigation/sidebar** | 5 groups: Overview · Core Transactions · Cash & Finance · Reports & Statements · Administration. | ⚠️ | Production, Dairy Costing, Production Setup, Stock and Parties all sit in "Core Transactions"; Rate Charts/Routes/Farmer Payments are filed under *Reports* though they are master data; no Accounts group; no Master Data group. | Regroup: Overview · Operations · Production · Inventory · Accounts · Reports · Master Data · Administration (keeping every existing page, only re-filed). |
| 8 | **UI/UX** | `renderer/style.css` design, cards/tables/modals, `printHTML`. | ⚠️ | Dashboard is table-heavy and not KPI-led; tables lack a consistent total row/search/sort/precision convention; no shared design tokens. | `ui-ux-pro-max` skill is **installed locally** (`~/.claude/skills/ui-ux-pro-max`) — use its dashboard/admin-panel + table guidelines to define tokens, then apply to dashboard, new pages and shared tables. |
| 9 | **Preserve working functionality** | 8 test suites green at v1.4.19 (accounting 96, PDC 136, costing 45, bulk 40, milk-costing 50, handover 40, roundtrip 28, trust 26, payment-types 43, prod-settings 29). | ✅ | Regression risk from schema changes. | Additive migration only; run the whole battery after every phase. |
| 10 | **Duplicate/conflicting calculations** | Mostly single-sourced. | ⚠️ 3 findings | (a) `dashboard.getDashboard` computes today's profit with its **own** simplified formula instead of `getProfitLoss`; (b) `getStockStatement` vs `getInventoryValuation` (see #6); (c) `expenses.getExpensesSummary` (other+petty only) vs `accounting.getExpenseSummary` (full) — similar names, different scope. | Route the dashboard through `getProfitLoss`; expose the stock-valuation difference explicitly; keep both expense functions but have all management reporting use `accounting.getExpenseSummary` only. |

### Resolution status (Phase 28)

All 10 findings addressed — details and evidence in [`PHASE-28-AUDIT.md`](PHASE-28-AUDIT.md):

| # | Finding | Status |
|---|---|---|
| 1 | Supplier-specific milk pricing | ✅ Migration 26 + `resolveMilkRate` — 63/63 tests |
| 2 | Company ledger | ✅ `company_ledger.js` + API + page — 35/35 tests |
| 3 | Expense classification | ✅ `normalizeExpenseCategory` (read-time, no data rewrite) — 58/58 tests |
| 4 | Advance recovery register | ✅ `getAdvanceRecoveryRegister` + `advance_returned` + page + dashboard alert — 27/27 tests |
| 5 | Board report / expense control | ✅ `management_reports.js` + page — 58/58 tests |
| 6 | Stock dual valuation | ✅ lot-cost columns + diff line, SUM-replay quantity — 62/62 reconciliation |
| 7 | Sidebar regroup | ✅ 8 groups, all 37 pages filed once |
| 8 | UI/UX | ✅ ui-ux-pro-max "Data-Dense Dashboard" pass, verified in browser |
| 9 | Preserve functionality | ✅ 15 suites, 778/778 green; verify-modules 39/2 baseline unchanged |
| 10 | Duplicate calculations | ✅ dashboard → `getProfitLoss`; linked-milk queries → `accounting.getLinkedMilkByBill/Month`; lot value → `productLotValue` |

### Reused as-is (no change needed)

- **Raw-milk cost layers** — every collection already creates its own `milk_lots` row with its actual supplier cost, so supplier-specific pricing automatically becomes separate cost lots (Phase 5 of the spec is already satisfied once #1 lands).
- **Cost chain** Raw Milk → Cream → Nauni → Ghee with NRV, FIFO FG, yield control, wastage, daily closing, traceability — shipped in v1.4.16–v1.4.19.
- **Payment/advance/loan accounting rules** — advances and loans never reach P&L (v1.4.18); `ledger_entries` account tags are the balance source.
- **Expense recognition** — each expense counted once; bank rows deduped by reference then date+amount.
- **Excel round-trip** — ADD/UPDATE/UNCHANGED semantics with 28 parity tests.

### Explicitly not done

- No new `supplier_rates`, `company_ledger`, `advance_register` or `expense_categories` tables — every new report is a **read model** over existing tables.
- No historical backfill: pre-cutover records keep their original values (spec §23).
