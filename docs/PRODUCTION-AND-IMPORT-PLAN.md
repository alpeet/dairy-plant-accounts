# Production Batching, FIFO Costing & Complete Excel ADD/UPDATE/SYNC — Plan

Status: implemented in v1.4.16 unless marked **DEFERRED**. This document records the
discovery findings, the design that was actually built, the assumptions taken
(recorded, not blocking), and the historical cutover strategy.

## 1. Existing architecture (discovered 2026-09-29, live DB `data/dairy-plant.db`)

| Area | Today |
|---|---|
| Stock | Derived by replaying `stock_movements` (`SUM(inward-outward)` per product). No lots, no cost layers, no expiry. 1,275 historical negative-balance rows exist from workbook-era data. |
| Production | `production_batches/inputs/outputs` exist as plain CRUD (82 derived batches from Excel, all rates 0). Outputs post `production_output` movements at rate 0. No costing. |
| Sales | `saveSale` writes sale + items + stock movements + party ledger + invoice-time receipt. Payment status derived from receipts. No COGS. |
| Purchases | Invoice-value accounting; milk lines are mirrored into `milk_collections` (purchase_ref_id). |
| Milk | `milk_collections` is the source of milk cost (`getMilkCostSummary`): collections + unlinked milk purchase lines, counted once in P&L. Cow/buffalo/mixed tracked with FAT/SNF/rate. |
| P&L | `getProfitLoss`: income = sales + other income; COGS = milk cost + non-milk purchases; operating expenses below. |
| Excel importer | `shared/excel-import.js` (2,074 lines), 10 datasets, `fresh`/`upsert` modes. **Every matched row is blindly rewritten (`updated++`) with no field comparison** — root cause of "Updated 1,718" on an unchanged workbook. No routes/rate-chart/expenses/production sheets. Summary only reports inserted/updated (never "unchanged", never "not present in workbook"). |
| Excel exporter | `shared/export-daily-account.js` (352 lines): 6 sheets only (Party_Master, Stock_Master, Sales_Entry, Purchase_Entry, Collection, Party_Ledger). No production/expense sheets → round-trip impossible. |
| Backup/restore | `shared/operations/backup.js` — Online Backup API, `.dab` + meta sidecar, verified by `ops.verifyBackupFile`. Whole-file backup: new tables are automatically included. |
| Audit | `logAudit(db, table, id, action, old, new, userId)` with CHECK constraint `action IN ('create','update','delete')`. |

## 2. Design principles adopted

1. **One accounting model.** Purchase cost of milk stays expensed at collection
   (unchanged P&L basis). Lot costing adds an *inventory* view: `stock_lots`
   carry real unit cost; sales consume lots FIFO to compute **actual COGS**;
   wastage writes off at lot cost. P&L gains a `lot_cogs` line; the legacy
   purchase-based COGS remains reported alongside so nothing silently changes.
2. **`stock_movements` stays the quantity ledger.** Production/sales/wastage
   post movements exactly as today (same types) so every existing screen keeps
   working; lots are the *cost/traceability* layer keyed to the same documents.
3. **BS dates everywhere** (via `toBSDate`/`adToBS` in the shared importer);
   expiry derives from `products.expiry_days` (no hard-coded shelf life).
4. **Historical data untouched.** Pre-cutover documents get no lots; nothing is
   back-costed. The cutover is explicit.

## 3. New tables (Migration 23, additive + idempotent)

- `milk_lots` — one lot per milk collection (or per collection-day per farmer per type): source collection, milk_type, farmer, date, shift, qty, fat, snf, unit_cost (= collection rate, falling back to amount/qty), total_cost, qty_remaining.
- `production_batches` additions (ALTER): `input_cost`, `processing_cost`, `total_cost`, `cost_allocation` ('nrv'|'volume'|'single'), `status` ('posted'|'reversed'), `yield_note`.
- `stock_lots` — finished-goods lots: batch_id, product_id, produced_date, expires_date, qty, qty_remaining, unit_cost, `estimated_opening_cost` flag for cutover openings.
- `lot_consumptions` — FIFO audit trail: lot_type ('milk'|'stock'), lot_id, reference_type ('production_input'|'sale'|'wastage'|'raw_sale'|'reversal'), reference_id, qty, unit_cost, total_cost.
- `wastage_records` — date, lot_type, lot_id, product_id, qty, unit_cost, total_cost, reason, reference.

Indexes on (product_id, qty_remaining), (batch_id), (reference), (expires_date).

Migration runs at startup from `shared/db.js` (`runMigrations`), same pattern as Migration 22 (PDC). Also mirrored in `database/schema.sql`.

## 4. Production costing flow (`shared/operations/production_costing.js`)

```
saveProductionBatch (new engine):
  1. Resolve inputs → raw milk lots FIFO (per milk type) → lot_consumptions
  2. input_cost  = Σ consumed qty × actual lot unit cost
  3. total_cost  = input_cost + processing_cost (manual or settings
     `production_processing_cost_per_liter` × input liters; never silent zero)
  4. Outputs: NRV = qty × standard price (products.rate; fallback category
     average; fallback volume) → share = total_cost × NRV/ΣNRV
     → unit_cost = share/qty (round2; residual to last output)
     → flag `cost_allocation_approximate` when any fallback used
  5. One stock_lot per output + production_output stock movement (as today)
reverseProductionBatch: restores lot qty_remaining, deletes lots/consumptions,
posts reversing movements, marks batch reversed (never hard-deletes).
```

Direct raw-milk sales and raw wastage consume milk lots FIFO the same way.

## 5. FIFO sales costing

`saveSale` gains a hook: for each item with a product that has lot coverage
(`CUTOVER_DATE` setting, default = migration day), consume finished-goods lots
FIFO → `lot_consumptions` rows + sale COGS stored on the sale
(`lot_cogs` column). Sale update/delete reverses its consumptions first.
Products with no lot coverage (historical items) behave exactly as before.

## 6. Reports

- `getStockLots` / `getExpiringLots` — lot view (oldest first, expiry flags).
- `getDailyReconciliation(from,to)` — finished goods: opening+production−sales−wastage=closing; raw milk: opening+deliveries−consumption−raw wastage=closing; drillable to lots/batches.
- `getBatchMargin(from,to)` — per batch: costs, allocated unit cost, qty sold, revenue, actual COGS, gross margin, remaining stock.
- `getWastageReport(from,to)` — write-offs with reasons.
- P&L (`getProfitLoss`) gains `lot_cogs` + `gross_profit_lot_basis` when lots exist.

## 7. Excel sync rework

**Importer.** Per-dataset result shape `{ added, updated, unchanged, skipped, failed, present }`.
- Field comparison with normalization (trim/case/number 2dp/BS-AD dates/null↔''): a matched row with no *effective* difference is **unchanged** and not written.
- `updated` means the DB row actually changed; immutable fields (id/created_at/created_by) never written.
- Datasets: parties, products, routes, milk_rate_chart, sales, sales_items, purchases, purchase_items, milk_collections, payments, salary_records, vehicle_expenses, other_expenses, petty_cash, cash_deposits, denomination_counts, production_batches, production_inputs, production_outputs, partner_capital, stock_movements (derived — never re-imported in upsert; rebuilt only in fresh mode).
- Matching keys: parties=party_code||name, products=name, routes=name, rate chart=(effective_from,rate_type), sales=invoice_no, purchases=(bill_no,date), milk_collections=collection_no||ref, payments=(party,date,type,amount,ref), salary=(employee,date), expenses=(date,head/party,amount), petty_cash=voucher_no||date+desc, deposits=(date,amount,mode), denominations=date, production batches=batch_no, inputs/outputs=(batch_id,product_id,qty) via parent map, partner_capital=(party,date,type,amount).
- Dependency order as mandated; sheets missing from the workbook are reported `Not present in workbook` in the summary — never silently ignored.
- Wrap-up summary lists **every** dataset with Added/Updated/Unchanged and Skipped/Failed/Warnings counts.
- Native new sheets: `Production_Batches`, `Production_Inputs`, `Production_Outputs`, `Stock_Lots`, `Milk_Lots`, `Expenses_Other`, `Expenses_Vehicle`, `Salary_Records`, `Partner_Capital`, `Stock_Movements` (export-only in round-trip; importer treats movements as derived).

**Exporter.** `exportToDailyAccountExcel` extended with all datasets above, so export→import is a true round-trip.

## 8. Historical cutover

- `settings.lot_cutover_date` = BS date when the first lot-tracked batch is posted (set automatically).
- Documents before cutover: no lots, no COGS change (their cost already sits in P&L via milk/purchases).
- Opening stock lots at cutover: created via the Stock Lots screen ("Create opening lots from current stock"), flagged `estimated_opening_cost=1`, unit cost = products.rate (recorded as an estimate in the lot note).
- Nothing historical is invented: no synthetic batches, no back-dated FIFO.

## 9. Assumptions (recorded, non-blocking)

1. `products.rate` = standard selling price for NRV (it is the price the invoice screen defaults to). No new "standard price" master needed; falls back documented when 0.
2. Processing cost defaults to settings `production_processing_cost_per_liter` (default 0 but the UI warns loudly and requires explicit confirmation of zero).
3. Milk lot unit cost = the collection's actual rate (amount/qty), which is the real farmer payout — no smoothing.
4. `stock_movements` remains derived in upsert imports (never re-inserted); fresh mode rebuilds once, as today.
5. Existing 82 derived batches are pre-cutover history: they keep rate 0 and are excluded from costing (their milk cost is already in P&L at collection value).

## 10. Open questions (all defaulted, none blocking)

- Should raw-milk sales of *buffalo vs cow* price differently per lot? → cost follows the lot; price is the invoice line as today.
- Should wastage hit COGS or operating expenses? → COGS (inventory write-off), shown as its own line so it is never mixed into milk purchases.
- Should exports include derived stock_movements? → yes, as an editable-independent reference sheet; importer reports it `derived` and does not duplicate.

## 11. Test plan

`scripts/audit/test-production-costing.js`: raw-milk FIFO, FG FIFO, cross-lot sale, NRV vs volume allocation, single-output, processing cost, expiry, wastage, negative-stock prevention, reconciliation identity, batch reversal, sale reversal, restart persistence, backup→reset→restore.
`scripts/audit/test-excel-sync.js`: exporter→importer round-trip (edit→import→verify→re-import all-unchanged→zero duplicates), per-dataset add/update/unchanged, party-type edits, parent-child (batch→inputs/outputs), immutable fields, derived movements not duplicated.
Regression: test-accounting-logic, test-trust-pack, test-pdc, test-handover-reset, verify-modules.
