# DATABASE REPAIR PLAN

**Prepared:** 2026-11-05 · **Database inspected:** live book, `~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db` (98 parties) · **Workbook reference:** `Dairy_Accounts_Professional 76.xlsx`
**Mode of this document:** plan + what was actually implemented in v1.4.52. Nothing destructive has been run.

---

## 1. Current architecture (measured)

```
Electron main.js  ─┐                     ┌─ shared/operations/*  (one module per register)
Express server.js ─┴─ shared/db.js ──────┤
                                         └─ ledger_entries  ◄── written by 11 modules
```

* **38 tables.** Registers: `sales`, `sales_items`, `purchases`, `purchase_items`, `milk_collections`, `payments`, `petty_cash`, `other_expenses`, `bank_transactions`, `salary_records`, `stock_movements`, `denomination_counts`, `cash_deposits`, `production_*`, `pdc_cheques`, `partner_capital`, `prepaid_expenses`.
* **`ledger_entries` is written by 11 modules**: `sales.js`, `purchases.js`, `milk.js`, `payments.js`, `cash.js`, `farmer.js`, `partners.js`, `parties.js`, `pdc.js`, `accounting.js`, plus `excel-import.js`.
* Every balance view reads that table: `party_account.js`, `statements.js`, `reports.js`, `party_account` consumers in `dashboard.js`, `management_reports.js`.

### 1.1 Live data volumes

| Table | Rows |
|---|---|
| `ledger_entries` | 6,197 |
| `sales` / `sales_items` | 2,333 / 2,814 |
| `purchases` / `purchase_items` | 903 / 80 |
| `milk_collections` | 1,496 (all linked to a purchase bill) |
| `payments` | 1,697 |
| `petty_cash` | 212 |
| `other_expenses` | **0** |
| `bank_transactions` | 136 |
| `stock_movements` | 4,759 |
| `parties` | 98 |

---

## 2. Identified problems (with evidence)

### P1 — The Party Ledger is a second source of truth, and it disagrees with the modules

`ledger_entries` composition:

| `reference_type` | rows | Dr | Cr |
|---|---|---|---|
| `sale` | 2,838 | 5,498,589.79 | 0 |
| `payment_received` | 1,833 | 4,742,283.63 | 5,000,405.00 |
| `purchase` | 1,460 | 0 | 4,795,338.69 |
| `adjustment` | 66 | 832,969.80 | 1,423,695.00 |

* `reference_id` is **not** a module id: `sale` rows carry `OPN-1001`, `OPN-1002`…; `purchase` rows carry `BILL-5001`, `S 5963`…; only `payment_received` carries integers (receipt numbers `3701`, `3702`…).
* **2,815 of 2,838** `sale` ledger rows and **1,460 of 1,460** `purchase` rows have no matching row in `sales`/`purchases`. They came from the workbook's `Party_Ledger` sheet, not from the registers.
* `purchase` ledger total **4,795,338.69** vs `purchases.grand_total` **5,029,121.75** → **Δ 233,783.06** unexplained.
* `sale` ledger total happens to equal `sales.grand_total` (5,498,589.79), because opening-balance rows (`OPN-…`, described `OPENING`) were typed as `reference_type='sale'` — so "sales" in the ledger is *sales + opening balances*, which is not sales.

### P2 — Whole transaction families never reach the party statement

| Family | Module rows | Ledger rows |
|---|---|---|
| Payments made to suppliers | 53 (₹30,51,461.63) | **0 `payment_made`** |
| Advances paid | 74 (₹16,67,901.00) | **0 `advance`** |
| Milk collections | 1,496 | **0 `milk_collection`** |
| Bank receipts/payments | 136 | 6 `ledger_entry_id`s, **none resolvable** |

So a supplier's statement shows bills but not what was paid: payables are overstated by ~₹30.5 lakh plus ~₹16.7 lakh of advances. This is the single most damaging accounting consequence of the ledger being an imported artefact.

### P3 — Opening balances are stored in the wrong place

`parties.opening_balance` is **0 for all 98 parties**, while `Party_Master!E` in the workbook holds 48 numeric opening balances. They were imported as `ledger_entries` rows with descriptions `OPENING`, which is why `reference_type='sale'` and `'purchase'` are inflated and why "sales" in a statement can include an opening balance line.

### P4 — Bank carries false posting flags

* 136 rows, 85 with `party_id`, 118 with `ledger_posted = 1`.
* **0** rows whose `ledger_entry_id` resolves to a real `ledger_entries` row.
* 0 payments linked. No trigger exists (0 triggers in the whole database); no background job touches the bank.

⇒ Bank is *behaviourally* isolated (verified by 32 restart checks), but the stored flags claim a posting that never happened. Any UI or report trusting `ledger_posted` will be wrong, and the stale `party_id`s (21 parties) are pre-fix residue.

### P5 — Money typed twice

* 74 advances exist both in `petty_cash` (`expense_head='ADVANCE'`, ₹16,67,901) and in `payments` (`transaction_type='advance'`, same 74, ₹16,67,901).
* Milk: 1,496 `milk_collections` all carry `purchase_ref_id` → the same litres also exist as 844 purchase bills (₹40,99,399.04 vs ₹41,99,504.27). The P&L excludes the linked milk, which is correct — but two registers for one delivery invites drift.

### P6 — The `Expenses` sheet never became expenses

`other_expenses` is **empty**; the 131-row `Expenses` sheet was imported into `petty_cash` (212 rows, ₹50,63,138 — far too large for a petty box, because it also carries salary, diesel and supplier transfers). Office expenses and petty cash are therefore indistinguishable in reports, and `P&L` operating expenses cannot be attributed by head.

### P7 — Party ledger rows are imported, then appended to by the app

Every new sale/purchase posts a *new* ledger row while the imported history keeps its own rows. The two conventions coexist (integer ids vs `OPN-…` strings), which is exactly why `reference_id` cannot be resolved and why per-party differences appear.

---

## 3. Target architecture

```
   ┌──────────────────────┐        ┌────────────────────────────┐
   │  Module registers    │        │  Derived reporting layer   │
   │  (own their rows)    │        │  (read-only, no storage)   │
   ├──────────────────────┤        ├────────────────────────────┤
   │ sales / sales_items  │──┐     │ party_ledger.js            │
   │ purchases            │──┤     │  getDerivedPartyLedger()   │──► Party statement
   │ milk_collections     │──┤     │  getDerivedPartyBalances() │──► Receivable/Payable
   │ payments             │──┼────►│  reconcileWithStored…()    │──► Migration evidence
   │ petty_cash           │──┤     └────────────────────────────┘
   │ other_expenses       │──┘
   │ bank_transactions    │──────► bank reports only (never in the ledger)
   │ salary_records       │──────► payroll reports
   │ stock_movements      │──────► stock + COGS
   └──────────────────────┘
```

### 3.1 Module ownership

| Module | Owns | Table(s) | Posts anywhere? |
|---|---|---|---|
| Sales | sale + lines | `sales`, `sales_items` | no |
| Milk Collection | procurement | `milk_collections` | no |
| Purchases | non-milk bills | `purchases`, `purchase_items` | no |
| Collection | receipts / rent / advances-in | `payments` (`type='receipt'`), `other_expenses` (`category='Income'` for rent) | no |
| Payment Register | payments made | `payments` (`type='payment'`) | no |
| Petty Cash | small cash out | `petty_cash` | no |
| Expenses | operating expenses | `other_expenses` | no |
| Bank | statement lines | `bank_transactions` | **no — enforced** |
| Salary | payroll | `salary_records` | no |
| Stock | movements/adjustments | `stock_movements` | no |
| Production | batches/inputs/outputs | `production_*` | no |
| Party Ledger | **nothing** | — | derived only |

### 3.2 Party Ledger rules (implemented in `shared/operations/party_ledger.js`)

1. A statement line is read from the register that owns the transaction and carries `source_table` + `source_id`.
2. No function in the module writes a row — asserted by test.
3. Milk already on a purchase bill is not counted again (`purchase_ref_id` guard).
4. BS dates are compared as strings.
5. `opening_bf` = stored opening + everything before the period, so a mid-period statement still reconciles.

---

## 4. Collection and income treatment

**Owner's rule:** money received through Collection is classified as income; sales revenue must not be counted twice.

**Workbook evidence:** `Collection!F` types are `Collection`, `Rent`, `Advance`, `ADVANCE RETURNED`, `Petty Cash`. `Profit_Loss!C8` reads Other Income as `SUMIFS(Party_Ledger!H:H, Party_Ledger!D:D,"rent", …)` — rent is income; a plain `Collection` row settles a sale.

**Therefore the app now applies one rule per type:**

| Collection `Type` | Stored as | Reporting |
|---|---|---|
| `Collection` | `payments` receipt (party credit) | **Collection receipts** — shown as money in, *not* added to revenue (the sale is already revenue). This is what prevents double counting. |
| `Rent` | `other_expenses`, `category='Income'` | **Other income** in P&L, Monthly Report, Company Ledger |
| `Advance` | `payments`, `transaction_type='advance'` | balance sheet (advance receivable), never P&L |
| `ADVANCE RETURNED` | `payments`, `transaction_type='advance_returned'` | balance sheet |
| `Petty Cash` | skipped (mirror of the `PETTY CASH` sheet) | already in the petty register |

Live numbers that make the double-count risk concrete: sales revenue **5,498,589.79**, receipts **4,742,283.63**. Adding receipts to income would have overstated revenue by 86 %.

**Fixed in v1.4.52:** before this release, `Type=Rent` fell through to a customer receipt — it credited the tenant's account (creating the "outstanding" the owner reported) *and* never reached the P&L. It now books to the income register, idempotently.

---

## 5. Bank isolation status

| Check | Result |
|---|---|
| Triggers on `bank_transactions` | none (0 triggers in the database) |
| Foreign keys pointing at bank | none |
| Modules writing `bank_transactions` | only `shared/operations/bank.js` (asserted by test) |
| Payment → bank link | `linkPaymentToBank()` returns null; `savePayment` sets `bank_txn_id = null`; 0 linked rows |
| Bank → ledger posting | `postBankToLedger()`/`setBankMatch()` are no-ops |
| Background jobs / startup | none touch bank; `importBundledExcelData()` is a no-op |
| Restart persistence | `test-bank-isolation-restart.js` — 32/32 |
| Remaining defect | stale `ledger_posted=1` flags (118) and stale `party_id` (85) from pre-fix data — **display-only, must be cleaned, never trusted** |

---

## 6. Migration strategy

**Phase A — evidence (done).** Derived engine + `scripts/audit/compare-party-ledger-sources.js` produce per-party differences. No writes.

**Phase B — clean the imported ledger (needs owner sign-off).**
1. Move `OPENING` rows into `parties.opening_balance`; delete them from `ledger_entries`.
2. Post missing `payment_made` / `advance` rows **or** switch statements to the derived engine (step C) and drop the table entirely.
3. Clear `bank_transactions.party_id`, `ledger_posted`, `ledger_entry_id` (set to NULL) — keep the statement rows.
4. Delete the 66 `adjustment` rows only after review: they total 8,32,969.80 Dr / 14,23,695 Cr and carry no resolvable reference.

**Phase C — switch the readers.** Point `statements.js`, `party_account.js`, `reports.js` at `party_ledger.js`. Keep a `party_ledger_source` setting (`stored` | `derived`) for one release so the operator can compare before committing.

**Phase D — retire `ledger_entries`.** Keep the table (read-only, renamed `ledger_entries_legacy`) rather than dropping it; nothing may write it.

**Phase E — normalise registers.** Expenses → `other_expenses`; advances → one register only; milk → `milk_collections` with `purchases` referencing it; salary → all 24 rows.

### 6.1 Rollback

Every phase is reversible: the DB is copied with SQLite's backup API before any write (`backup/pre-migration-<ts>.db`), the legacy table is retained, and the `party_ledger_source` setting restores the previous behaviour without code changes.

### 6.2 Backup / reset requirements

* Copy with `db.backup()` (WAL-safe), then **reopen the copy and run `PRAGMA integrity_check` + row counts** — a copy that cannot be opened is not a backup.
* Preserve `users`, `settings`, `products`, `parties`, `routes`, `employees`.
* A reset must survive restart: startup migrations must not re-seed (already proven by `test-handover-reset.js`, 40/40).
* The Excel workbook is never written by any of this.

---

## 7. What was implemented in this release (v1.4.52)

| Change | File | Verification |
|---|---|---|
| Derived Party Ledger engine (`getDerivedPartyLedger`, `getDerivedPartyBalances`, `reconcileWithStoredLedger`) | `shared/operations/party_ledger.js` (new) | `test-party-ledger-derived.js` |
| Rent classified as other income, never a party receipt; idempotent | `shared/excel-import.js` | same suite |
| Reconciliation CLI for the owner's decision | `scripts/audit/compare-party-ledger-sources.js` (new) | run manually, read-only |
| Regression suite registered | `scripts/audit/run-all-tests.js` | full run |

**Not yet switched:** `statements.js` / `party_account.js` still read `ledger_entries`. Flipping them changes every party balance in the live book, so it waits for Phase B sign-off.

---

## 8. Decisions required from the owner

1. **Opening balances** — should the 48 workbook opening balances be moved into `parties.opening_balance` (and removed from the ledger), or kept as ledger lines?
2. **Supplier payments made** — the live book has 53 payments (₹30,51,461.63) and 74 advances (₹16,67,901) that no party statement currently reflects. Confirm they should appear as debits against the supplier/farmer accounts.
3. **Ledger source switch** — after Phase B, should statements read the derived engine (recommended, matches the workbook) or keep the stored ledger?

---

## 9. Test plan for the migration

| Test | Proves |
|---|---|
| `test-party-ledger-derived.js` | derivation, single counting of milk, running balance, date cut, no writes, rent income, idempotent import |
| `test-bank-isolation-restart.js` | bank untouched by every other module, across a real restart |
| `test-accounting-logic.js` | six acceptance cases + same rules on a migrated copy |
| `test-monthly-report.js` | month ends, income heads, Excel sheet vs engine |
| `test-report-drilldown.js` | every report figure traceable to rows |
| `compare-party-ledger-sources.js` | per-party difference between stored and derived before switching |
