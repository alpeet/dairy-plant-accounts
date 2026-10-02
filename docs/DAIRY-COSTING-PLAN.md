# Scientific Milk-to-Finished-Product Inventory & Costing — Discovery & Change Map

Status: **§28 discovery (this document)**, then implemented incrementally. This is
the mandated "Current Structure → Required Changes" map produced *before* any
coding. It inspects the existing schema, stock logic, purchases, milk
collections, sales, production, products and accounting, records what already
exists, and lists only the changes actually required — reusing existing tables
wherever possible.

Companion to `docs/PRODUCTION-AND-IMPORT-PLAN.md` (v1.4.16 lot engine).

## 1. What already exists (and is reused as-is)

| Requirement | Existing asset | Verdict |
|---|---|---|
| Raw-milk FIFO cost layers (§5) | `milk_lots` (per collection, cow/buffalo separate, `unit_cost`, `qty_remaining`) | **Reuse** |
| FIFO consumption + audit trail (§17) | `consumeFIFO`, `lot_consumptions` (lot_type, ref_type, ref_id, qty, unit_cost) | **Reuse** |
| Joint-product NRV allocation (§6–7) | `allocateOutputs` (NRV from `products.rate`, volume fallback flagged `approximate`) | **Reuse** |
| Cream as an inventory item (§8) | `stock_lots` (per batch, product, qty, unit_cost, expiry) — cream already flows here as a production output | **Reuse** (needs a *categorised* view) |
| Nauni/butter + ghee costing (§9–10) | `postProductionBatch` costs a batch from inputs + processing | **Extend** — inputs are currently milk-only |
| Batch structure (§12) | `production_batches` (+ `input_cost`, `processing_cost`, `total_cost`, `cost_allocation`, `status`, `yield_note`), `production_inputs/outputs` | **Extend** (cost breakdown fields) |
| Processing cost (§13) | single `processing_cost` + setting `production_processing_cost_per_liter` | **Extend** (named overheads) |
| Yield (§14) | `standard_yield_percent`, `actual_yield_percent` | **Extend** (variance + flags) |
| Fat/SNF data (§15) | `milk_collections.fat_percent/snf_percent/clr_percent`, `milk_lots.fat/snf` | **Extend** (input↔output fat analysis) |
| Quantity ledger (§16) | `stock_movements` (+ `balance_after`) is the quantity source of truth | **Reuse** — add category view |
| Wastage at actual cost (§18) | `wastage_records`, `recordWastage`, `writeOffExpiredStock` | **Reuse** |
| Opening stock at cutover (§23) | `createOpeningStockLots` (flags `estimated_opening_cost`) + `lot_cutover_date` | **Reuse** |
| Accounting rules (§22) | v1.4.18 payment typing, `getMilkCostSummary`, `getProfitLoss.lot_cogs`, balance-sheet movements | **Reuse** |
| Audit trail (§25) | `logAudit` → `audit_log` (old/new JSON, user, ts) — already called by every costing write | **Reuse** |
| Daily stock reconciliation (§18) | `getDailyReconciliation` (finished goods + raw milk) | **Extend** (explicit cream + value) |

So the heavy lifting of v1.4.16 (lots, FIFO, NRV, wastage, opening lots) is
already the skeleton the new spec needs. The spec is largely about **wiring the
multi-stage chain**, **weighted-average reporting**, and **formal close/reports**.

## 2. Gaps the spec exposes (the actual work)

1. **Production inputs are milk-only.** `postProductionBatch` consumes
   `milk_lots` FIFO for every input. It cannot consume a **finished-goods stock
   lot** (cream, nauni, curd…). So `Cream → Nauni → Ghee` cannot be costed today
   — this is the single biggest functional gap (§8–§10, §27).
2. **No processing-cost breakdown.** One scalar `processing_cost`; the spec wants
   labour, fuel/boiler, electricity, packaging, water, CIP, refrigeration as
   separate configurable overheads, with settings defaults and actual-vs-standard
   variance (§13).
3. **Yield is recorded, not controlled.** No expected-vs-actual variance or
   low/high-yield flag (§14).
4. **No weighted-average daily milk-cost report.** `getMilkCostSummary` produces
   a period money total only; the spec needs per-category litres ÷ cost with
   weighted-average rate/L (§1, §3) — *never* an arithmetic mean of rates.
5. **No sales realization/L report** (§4, §20) and no product cost report (§21).
6. **No Milk Cost vs Sales / management dashboard / formal daily close** that tie
   quantity + value together with explicit reconciliation errors (§18–20).
7. **Fat/SNF not used analytically** — no input-fat → output-fat comparison (§15).
8. **Traceability is implicit** — the consumption trail exists but there is no
   single query that walks `Sale → FG lot → batch → stock lot → milk lot →
   farmer` (§17, §27-12).
9. **No stock-ledger-with-category view** (Raw Materials / WIP / Finished Goods)
   combining qty by `stock_movements` and value by lots (§16).

## 3. Required changes (minimal, additive)

### 3.1 Migration 25 (additive; idempotent; runs at startup + mirrored in schema.sql)

- `production_batches` **ALTER ADD**: `labour_cost`, `fuel_cost`,
  `electricity_cost`, `packaging_cost`, `water_cost`, `cip_cost`,
  `refrigeration_cost`, `other_processing_cost`, `expected_output_quantity`,
  `yield_variance_percent`, `yield_flag` (`ok|low|high`), `input_fat_percent`,
  `output_fat_percent`.
- New table **`production_overheads`**: `id, name, basis
  CHECK IN ('per_input_liter','per_batch','percent_of_input_cost'), rate, active,
  notes, created_at` — the configurable processing-overhead lines (§13). Seeded
  with the seven spec categories at rate 0 (user fills them in).
- New table **`yield_standards`**: `id, process_type, output_product_id (NULL=all),
  expected_yield_percent, warn_low_percent, warn_high_percent, notes` — expected
  yield per process for §14. Lookup falls back to the batch value, then 0.

### 3.2 `production_costing.js` (extend, not replace)

- `postProductionBatch` inputs accept **either** `{ milk_type, quantity }`
  (raw-milk FIFO, unchanged) **or** `{ product_id, quantity }` (finished-goods
  stock-lot FIFO). This unlocks every downstream stage with no new engine.
- Processing cost = explicit breakdown fields **+** active `production_overheads`
  applied on their basis **+** existing per-liter setting fallback. A zero total
  still requires explicit `allow_zero_processing_cost` (never a silent zero).
- Yield: expected from `yield_standards` (else batch value), actual = out/in,
  `yield_variance_percent`, `yield_flag`; anomalous batches flagged, never blocked.
- Fat: `input_fat_percent` (qty-weighted from milk lots consumed),
  `output_fat_percent` (caller-supplied or from output lots) for §15.
- `previewBatchCosting` mirrors the same logic so UI preview == posted cost.

### 3.3 New `shared/operations/dairy_costing.js` (reporting/close layer, no new source of truth)

Read-only over existing tables + the lot engine; all maths backend-side and
tested:
- `getDailyMilkCost(db,{date})` — per category (cow/buffalo/mixed + configured):
  litres, amount, **weighted** avg rate/L; combined from `milk_collections` and
  unlinked milk purchase lines (same once-only basis as `getMilkCostSummary`).
- `getMilkFlow(db,{date})` — opening + collections + purchases = processed +
  direct-sold + wastage + closing (qty **and** value), identity always balanced.
- `getDailySalesRealization(db,{date})` — milk qty, gross, discount, net,
  net/L (returns from `return_in` movements).
- `getDailyMilkCostVsSales(db,{from,to,groupBy})` — daily/weekly/monthly/range.
- `getProductCostReport(db,{from,to})` — per product: input cost, processing,
  total, output qty, cost/unit, selling price, margin; drill-down per batch.
- `getStockLedger(db,{product_id,from,to})` — Date | Ref | IN | OUT | Balance |
  Unit cost | Value, with the three inventory categories.
- `getInventoryCategory(product)` — Raw Materials / WIP / Finished Goods.
- `getManagementDashboard(db,{date})` — milk economics, sales, production, cost,
  efficiency (§19).
- `getDailyClosing(db,{date})` — milk + cream + finished-product reconciliations
  with explicit errors; refuses to silently adjust.
- `getSaleTraceability(db,{saleId})` / `getBatchTraceability(db,{batchId})` —
  the full `Sale → FG lot → batch → input lots → milk lot → farmer` walk (§17/27).

### 3.4 Integration (no behaviour change for existing screens)

- `shared/operations/index.js` exports the new module.
- `server.js`: `/api/dairy/*` routes; `main.js` IPC `db:dairy:*`; `preload.js`;
  `renderer/js/api.js`. UI page added behind the existing nav pattern.
- Excel export/import: add the new report sheets; importer stays
  ADD/UPDATE/UNCHANGED. (Excel parity is a follow-on increment — tracked.)

## 4. Negative-stock & single-source-of-truth guarantees

- `stock_movements` remains the **quantity** source of truth; lots remain the
  **cost/traceability** source. Every write already asserts `balance_after >= 0`
  / lot `qty_remaining >= 0`; the new stock ledger reads both, never recomputes
  independently.
- Chain is one-way: `Quantity → Cost (lots) → Stock → Production → COGS → P&L`.
  No report invents a number the engine did not post.

## 5. Historical data (§23) — unchanged stance

Pre-cutover documents keep no lots and no back-costing. The cutover is explicit
(`lot_cutover_date`), opening balances come only from
`createOpeningStockLots(... estimated_opening_cost=1)`. No cream quantity, batch
or cost is fabricated for old data.

## 6. Test plan (§26)

`scripts/audit/test-milk-costing.js` — the 20 mandated cases: multi-rate same-day
weighted average; carry-forward milk; raw FIFO; cream non-zero cost; NRV split;
cream→nauni; nauni→ghee; actual≠expected yield; processing cost inclusion;
FG FIFO; multi-lot sale; wastage at cost; no-negative-stock; daily
reconciliation; COGS from actual lot cost (not today's price); closing value
reconciliation; Excel round-trip equality (importer/exporter layer); historical
opening not reconstructed; full traceability to the farmer/supplier. Plus the
existing regression battery.
