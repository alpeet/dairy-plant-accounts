# DEVELOPMENT HANDOVER — Prarambha Account & Stock Management

Session: 2026-11-02 · Baseline verified at **v1.4.51**
Companion documents: [BUG_REGISTER.md](BUG_REGISTER.md) (per-defect evidence),
[GAP-REPORT.md](GAP-REPORT.md) (older, wider spec gap analysis),
[HANDSOVER.md](HANDSOVER.md) (operator/installation guide),
[.freebuff/run.md](.freebuff/run.md) (release + environment policy).

---

## 1. What this session inspected

| Area | How |
|---|---|
| Repo + history | `GAP-REPORT.md`, `HANDSOVER.md`, `docs/AUDIT-*.md`, git log (59 commits) |
| Accounting engine | `shared/operations/accounting.js`, `financial_reports.js`, `management_reports.js`, `company_ledger.js`, `report_drilldown.js` |
| Bank module | `shared/operations/bank.js`, `payments.js`, `farmer.js`, `cash_deposit.js`, `pdc.js`, `shared/db.js`, `renderer/js/bank.js` |
| Monthly report / stock | `shared/operations/monthly_report.js`, `renderer/js/monthly_report.js`, `shared/export-monthly-report.js` |
| Statements | `shared/operations/statements.js`, `renderer/js/statements.js`, `renderer/js/party.js` |
| Live data | read-only copies of `data/dairy-plant.db` and the desktop book in `~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db` |
| Test suite | the whole `scripts/audit/` manifest, executed end-to-end |

## 2. Verified state (executed, not asserted)

```
node scripts/audit/run-all-tests.js   →   35/35 test files passed, exit 0
```

Highlights: accounting 111, monthly report 114, drill-down 703, statements 49,
daily stock 78, stock statement 74, today's stock 21, handover reset 40,
Excel round-trip 28, workbook-76 import 26, money precision 24, ERP acceptance 63,
company ledger 35, management reports 58, bank standalone 11, bank idempotency 41.

`test-pdf.js` and `test-statement-pdf.js` are **excluded** — they call
`app.whenReady()` and only run inside Electron. They have not been run this session.

## 3. Defects fixed and independently verified this session

1. **Bank credit vanished from the bank balance** (65,000 gap in Kartik 2083) —
   `getCashBankPosition` now sums the statement's own credits/debits instead of
   classification buckets.
2. **Closing stock value ≠ its own valuation lines** — a zero-quantity product kept
   a residual cost; it no longer does.
3. **Bank rows counted as operating expenses** — excluded everywhere, disclosed as
   `bank_expenses_excluded` + data-gap note.
4. **Bank register posted to party ledgers / payments created bank rows** — all
   write-side cross-posting removed; legacy APIs are no-ops that refuse to link.
   Historical rows untouched.
5. **Product lines printed with no quantity/rate (NAUNI 56/66)** — each ledger row
   of a bill now carries its own invoice line; 66/66 enriched on the live book.
6. **Statements carry no Item/Unit columns** — audited for screen and print/PDF;
   quantity and rate retained.
7. **Bank isolation proven across a restart** — `test-bank-isolation-restart.js`
   (32 checks) replays the owner's acceptance table: add / edit / delete / import
   touch only `bank_transactions`; a petty-cash expense, a payment collection and
   a party payment create no bank row and carry no `bank_txn_id`; after close +
   `initDatabase()` + `ensureBankTable()` every bank row is unchanged, a deleted
   row stays deleted, no startup backfill writes another register and nothing is
   re-linked. A source invariant fails the suite if any runtime module other than
   `shared/operations/bank.js` writes `bank_transactions`.
8. **`cash_collections` added to `database/schema.sql`** — it used to be created
   on demand by `cash.js`, so fresh installs diverged from migrated books.

Full detail, root causes and the exact tests: `BUG_REGISTER.md`.

## 4. Data issues left open (owner action, not code)

- Negative closing stock for 5–7 products (Cow Milk, NAUNI, PANEER, Cream, REPLACE …)
  → stock cannot be valued, so COGS and net profit stay **provisional**.
- One product's stock has no defensible unit cost (Mix Milk) → not valued, flagged.
- Ledger cash vs physical count disagree by ≈508,815 (counted 58,730 on 2083-07-10)
  → supplier/farmer payments exist only in the ledger, with no cash document.
- Opening cash and bank balances are not recorded, so cumulative balances are
  movements from zero.
- **Stale bank links from the pre-fix auto-posting** (measured 2026-11-02): repo
  book 120 bank rows with 92 `party_id` / 115 `ledger_posted=1` / 13
  `ledger_entry_id`; live book 136 with 85 / 118 / 6. The code no longer writes
  these, but the old rows remain. Only the rows that stored a `ledger_entry_id`
  provably created their own ledger entry (13 and 6 respectively) and inflate a
  party balance; the rest are stale flags. Cleanup is a targeted, backed-up data
  task — see §6.

## 4a. Backup status for this session (2026-11-02)

No business data was deleted or rewritten. Two consistent snapshots were taken
with SQLite's backup API (safe under a live WAL) and each was reopened and
verified — `integrity_check: ok`, row counts identical to its source:

| Book | Backup file | Verified counts |
|---|---|---|
| repo `data/dairy-plant.db` | `backup/pre-audit-repo-data-2026-11-02T04-27-37-452Z.db` | bank 120 · payments 1636 · ledger 5628 · parties 92 · sales 2185 · petty cash 241 |
| live `~/Library/Application Support/prarambha-account-stock/data/dairy-plant.db` | `backup/pre-audit-live-app-2026-11-02T04-27-37-452Z.db` | bank 136 · payments 1697 · ledger 6197 · parties 98 · sales 2333 · petty cash 212 |

**Why the live book was not reset.** The installed app (`/Applications/Prarambha
Account & Stock Management.app`, PIDs 2071–2074) was running with an active
`-wal`/`-shm` while this audit ran. Wiping that file underneath a live connection
is how a reset appears to "undo itself" on the next launch, and the open data
problems (negative stock, missing opening balances, stale links) are *entry* gaps
that a wipe would erase the evidence for rather than fix. The Fresh Start path
itself is proven — `test-handover-reset.js` 40/40, including "startup migrations
do NOT re-seed after a Fresh Start". To reset deliberately: quit the app, confirm
the backup above, then use Settings → Fresh Start (admin password + typing RESET)
or `shared/operations/data_cleanup.js`.

## 5. Architecture as it now stands

- `shared/operations/*` is the single source of business logic; `main.js` (IPC) and
  `server.js` (HTTP) are thin adapters, `renderer/js/api.js` is the only client door.
- `shared/bs-calendar.js` is the only BS calendar; `renderer/js/bs-calendar-data.js`
  is generated by `node scripts/build-bs-calendar.js` — never hand-edit it.
- `shared/operations/accounting.js` owns money: `round2`, `CURRENCY_TOLERANCE`,
  classification, cash/bank position, expense summary, reconciliation.
- **Bank Transactions is a leaf module**: it reads and writes only
  `bank_transactions`. Nothing may post from it into another module, and no other
  module may create a bank row automatically. Enforced by `test-bank-standalone.js`.
- Statements are presentation-only: `attachEntryItemDetails()` attaches display
  detail and never changes an amount, balance or total.
- The Monthly Report screen, its print/PDF and `shared/export-monthly-report.js` all
  read one engine (`shared/operations/monthly_report.js`), so they cannot drift.
- **Bank restart invariant**: `shared/operations/bank.js` is the only module allowed
  to write `bank_transactions`, `main.js`'s `importBundledExcelData()` is a
  deliberate no-op (nothing business-related ships in the installer), and a restart
  must never re-create or re-link a bank row. All three are enforced by
  `test-bank-isolation-restart.js`, so a future "helpful" startup backfill or import
  hook breaks the suite instead of the books.

## 6. Next highest-priority actions

1. **Fix the open data first** (negative stock, missing opening stock/balances) —
   until then every profit figure is provisional, and the report says so.
2. **`audit_log` is effectively empty** (1 row for 92 parties): wire
   `logAudit()` into every mutation and prove it with a test.
3. **Role enforcement**: 234 route registrations vs 103 `requireRole(` calls — audit
   the remaining routes and close the gap; reuse the same matrix in the nav.
4. **PDF/print verification in Electron**: page numbers, per-page subtotals,
   embedded Devanagari; run `test-pdf.js` / `test-statement-pdf.js` under Electron.
5. **`cash_collections`**: referenced by `shared/operations/cash.js`, absent from
   `schema.sql` — fresh installs diverge from production.
6. **Clear the stale bank links** (BUG-013): for the 13 + 6 rows that stored a
   `ledger_entry_id`, decide per row whether the ledger entry it created should be
   reversed or kept, then clear `party_id`/`ledger_posted`/`ledger_entry_id`. Do it
   only on a verified backup, and only for rows where the link is provably a
   duplicate. The other ~110 flagged rows need the flag cleared, not an entry
   removed.
7. Then the older GAP-REPORT phases (double-entry core, permission matrix,
   document numbering, AD display) in that order.

## 7. Working rules that must not be broken

- Dates in the database are BS strings (`2083-03-32` is valid) — compare/slice,
  never `strftime`/`Date`.
- Never point an automated test at `data/dairy-plant.db`; copy to `/tmp` first.
- After any packaged build, `better-sqlite3` is rebuilt for Electron/Windows. Run
  `npm install` or `node_modules/.bin/prebuild-install` before using plain `node`
  again, or you get `ERR_DLOPEN_FAILED` / "slice is not valid mach-o file".
  `npm rebuild` alone can leave the wrong binary in place — verify with a real
  `openDatabase()` call, not just `require()`.
- Every edit/release follows the standing policy: verify → bump version → release
  notes → commit+push → DMG + Windows installers → restore the native module →
  publish the GitHub release with all three assets.
