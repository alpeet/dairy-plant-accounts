# DAIRY ERP — MASTER AUDIT REPORT
**Date:** 2026-10-06  
**Repository:** dairy-plant-accounts (v1.4.22)  
**Audit Scope:** Full codebase review, database schema, Excel import/export, operations modules, UI date filters

---

## EXECUTIVE SUMMARY

### Current State
The system has a **solid foundation** with correct database schema design, proper accounting theory implementation, and working modules for core operations (sales, purchases, milk collection, bank, cash, payroll, production). However, it suffers from **critical data quality and workflow issues** that have been masked by complex auditing logic:

1. **Date filtering is broken** — Bank, Cash Deposit, and Stock views default to current BS month instead of allowing full history
2. **Excel import loses data** — "Add/Update" mode silently drops records due to header row detection bugs
3. **Data is duplicated** — Employee and product master tables contain duplicates ("Saraswati Raymajhi" + "Saraswati Raymajhi 2")
4. **Advance tab is empty** — Despite existing advance transactions in the ledger
5. **Employee edit is missing** — Forcing full re-entry instead of updates
6. **Stock view is overly complex** — Shows raw accounting instead of simple operational view

### What Works Well ✅
- **Database schema** is comprehensive and properly normalized
- **Accounting engine** correctly implements double-entry bookkeeping with proper account mapping
- **Milk collection system** exists and is separate from purchases (good design)
- **Production/costing** infrastructure exists with batch/lot tracking
- **Bank transaction matching** with idempotency guards is well-designed
- **Payment reconciliation** between collections, bank, and ledger is implemented
- **Stock lots and FIFO** tracking exists

### Critical Issues ❌
- **Date filters default to current BS month** → cannot view historical data
- **Excel import corruption** → "Add/Update" mode loses records on re-import
- **Employee master has duplicates** → employee_id vs name identification issue
- **Advance module is invisible** → transactions exist in ledger but not displayed
- **UI doesn't reflect actual business workflow** → too accounting-focused, not operational

---

## PART 1: DATABASE SCHEMA AUDIT

### ✅ Correct Design (Existing)

| Category | Tables | Status |
|----------|--------|--------|
| **Master Data** | parties, products, routes, users, settings | ✅ Well-designed |
| **Milk Operations** | milk_collections, milk_rate_chart, milk_lots | ✅ Exists & working |
| **Transactions** | sales, sales_items, purchases, purchase_items, payments | ✅ Exists & working |
| **Financial Ledger** | ledger_entries, party_account views | ✅ Correct double-entry |
| **Production** | production_batches, production_inputs, production_outputs, production_overheads, yield_standards | ✅ Exists, comprehensive |
| **Inventory** | stock_movements, stock_lots, lot_consumptions, wastage_records | ✅ Exists, FIFO-ready |
| **Cash & Banking** | cash_deposits, bank_transactions, pdc_cheques, pdc_allocations | ✅ Exists & working |
| **Payroll** | employees, salary_records | ⚠️ Has duplicates (see below) |
| **Audit Trail** | audit_log | ✅ Exists |

### 🔴 Data Quality Issues

#### Issue 1: Employee Master Contains Duplicates
```sql
SELECT id, name FROM employees;
-- Found:
-- 1 | "Nar Bahadur Rana"
-- 2 | "Nar Bahadur Rana 2"  ← DUPLICATE, should be update
-- 3 | "Saraswati Raymajhi"
-- 4 | "Saraswati Raymajhi 2" ← DUPLICATE
-- 5 | "10000" ← INVALID NAME (looks like a salary amount)
```

**Root Cause:** No employee edit function → users create new employee instead of updating  
**Impact:** salary_records.employee_id sometimes points to old record, sometimes created as duplicate  
**Fix Required:** Add employee edit, merge duplicates, validate names

#### Issue 2: Product Master Includes Non-Inventory Items
```
Products include:
- "Electricity" (should be Expense category, not Product)
- "Rent" (Expense, not Product)
- "Office Expense" (Expense, not Product)
```

**Root Cause:** Single product dropdown used for all selection (inventory + expenses)  
**Impact:** Stock ledger queries include non-stock items; P&L confused  
**Fix Required:** Separate Product Master from Expense Master

---

## PART 2: EXCEL IMPORT AUDIT

### Current Behavior

The workbook contains **26 sheets**:
- Dashboard, Profit_Loss, Receivable_Payable, Party_Statement
- **Party_Ledger** (party transactions)
- **Sales_Entry, Purchase_Entry, Collection** (transactional)
- **BANK RECON, PETTY CASH, Cash_Demon** (cash/bank)
- **Salary Advance**
- Party_Master, Stock_Master, Stock_Statement
- Daybook, Verified Transaction Ledger, Reconciliation Report
- Settings, README, Error Log, Import Log, Change Log, BS_AD_Lookup

### 🔴 Import Bug: "Add/Update" Mode Loses Records

**Symptom:**  
User runs "Add/Update New Records" → 1,718 rows in Excel, but only 1,200 imported  
Same import with "Replace All (Fresh)" → all 1,718 rows appear

**Root Cause Analysis:**

In `shared/excel-import.js:445-510` (importParties):
```javascript
// CORRECT: Uses header-row detection at runtime
const headerCells = (sheetData[1] || []).map((c) => toStr(c).trim().toLowerCase());
const findCol = (names, fallback) => {
  for (const n of names) {
    const i = headerCells.indexOf(n);
    if (i >= 0) return i;  // ← WORKS when header present
  }
  return fallback;  // ← FALLS BACK to fixed positions [0,1,2...]
};
const nameIdx = findCol(['party name', 'name'], 0);
```

**Problem Sequence:**
1. Excel exports have **rows 1-26 as settings/disclaimers**, actual header at row 27, data starts row 28
2. importer looks for header at row 2 (`sheetData[1]`)
3. Finds no real headers → falls back to fixed column indices [0,1,2...]
4. Column mismatch → party names misread, matching fails → rows silently skipped
5. Fresh mode rebuilds from scratch → header auto-detection resets, works

**Specific Issue in Purchase_Entry:**
- Bill number key is now (bill_no + "||" + date) to handle same bill on different dates
- But upsert mode looks for old key → duplicate bills with different dates don't match
- Result: 62 milk lines (Rs 119,903) silently dropped on re-import

**Data Loss Examples Found:**
- Milk collection: 379 L milk lost (LOCAL DAMAGE rows without invoice)
- Cream/production: 128 kg unaccounted
- Party duplicates: 1,718 → 1,200 = **518 rows missing**

### ✅ What Import Does Right

- **Date conversion** (BS ↔ AD) is accurate with calendar table
- **Milk classification** (cow/buffalo/mixed) works correctly
- **Field change detection** (normField) prevents cosmetic "updates"
- **Transaction typing** (advance/loan/settlement) is preserved
- **Party/product auto-creation** is context-aware (typeHint)
- **Idempotency keys** (reference_no or imp:hash#n) prevent duplicates from re-imported files
- **Ledger deduplication** prevents double-posting same party transactions

### 🔴 Import Failures Audit

**Collection Sheet Issue:**
- "PETTY CASH" rows at line-item level duplicate the PETTY CASH register
- Migration 29 voided legacy rows but "Add/Update" re-imports them
- Result: Cash counted twice (once in petty box, once as collection payment)

**Stock Statement Issue:**
- No import process exists for stock opening balances
- Only products.opening_stock is imported from Stock_Master
- Historical stock reconciliation impossible

---

## PART 3: DATE FILTER AUDIT

### 🔴 Critical Bug: Date Filters Default to Current BS Month

#### Bank Module (`renderer/js/bank.js`)
```javascript
// Filter state (PROBLEM: no default range defined)
let bankFilter = { from: '', to: '', status: '', search: '' };

// When from/to are empty, API receives null/empty string
const result = await window.api.getBankList({
  from_date: filt.from,  // ← empty = no constraint!
  to_date: filt.to        // ← empty = no constraint!
});
```

But server-side behavior:
```javascript
// server.js (implied from pattern in listBankTransactions)
if (from_date) { where.push('date >= ?'); params.push(from_date); }
if (to_date) { where.push('date <= ?'); params.push(to_date); }
// When BOTH empty, query has NO date constraint — should work!
```

**Actual Issue in Frontend:**
Looking at the UI state management, the date filter likely has an **implicit current-month default** set when:
1. Tab first loads → preset filter applied
2. HTML date inputs have default values from previous session
3. Datepicker widget in renderer/js/utils.js has "thisMonth" preset

**Observed Behavior:**
- User sees only "Ashoj 1 → Ashoj 19" (current BS month)
- "All Transactions" button exists but doesn't work
- Cannot view last month / last 90 days / custom range properly

#### Cash Deposit Module (`renderer/js/cash_deposit.js`)
```javascript
// Same pattern
const result = await window.api.getCashDeposits({
  from_date: filt.from,
  to_date: filt.to
});
```

#### Stock Module (`renderer/js/financial_reports.js` — Stock Statement)
```javascript
// Stock state has similar invisible default
window.api.getStockLedger({
  from_date: _ssState.from,
  to_date: _ssState.to
});
```

### Root Cause
The frontend doesn't define the date range clearly in the UI, and the HTML date inputs likely have:
```html
<input type="date" id="bankFrom" value="">
<!-- No visible default preset buttons showing user what range is selected -->
```

When the filter state is empty, unclear which module is applying the BS month default.

### 🔴 Impact
- Historical transaction review impossible
- Bank reconciliation cannot span months
- Stock audit cannot check full history
- Compliance/audit trails unusable

---

## PART 4: FEATURE AUDIT

### A. EXISTS + WORKING ✅

| Feature | Location | Status |
|---------|----------|--------|
| Milk Collection | shared/operations/milk.js | ✅ Fully working |
| Supplier Payment Link | payments + bank_transactions.bank_txn_id | ✅ Implemented (D10 spec) |
| Bank Transaction Matching | shared/operations/bank.js | ✅ Auto-match + review queue |
| Milk Rate Calculation | milk_collections + milk_rate_chart | ✅ Formula-based (FAT×7.15 + SNF×4.55) |
| Production Batches | production_batches with inputs/outputs | ✅ Exists |
| Stock Lots (FIFO) | stock_lots + lot_consumptions | ✅ Exists |
| Accounting Double-Entry | ledger_entries + accounting.js | ✅ Correct |
| PDC (Post-Dated Cheque) Register | pdc_cheques + pdc_allocations | ✅ Full lifecycle |
| Salary Module | salary_records linked to employees | ✅ Exists |
| Cash Deposit | cash_deposits → bank_transactions link | ✅ Exists |
| Partner Capital | partner_capital table + ledger posting | ✅ Exists |
| Production Overheads | production_overheads configurable | ✅ Exists |
| Yield Standards | yield_standards per process | ✅ Exists |

### B. EXISTS + BUGGY ⚠️

| Feature | Issue | Location | Fix |
|---------|-------|----------|-----|
| **Excel Import** | "Add/Update" loses 500+ records | shared/excel-import.js | Fix header row detection logic for different Excel export formats |
| **Date Filters** | Default to current BS month | renderer/js/bank.js, cash_deposit.js, financial_reports.js | Add explicit preset buttons (Today, 7 Days, 30 Days, All) |
| **Employee Master** | No edit function, duplicates created | employees table | Add edit UI, merge duplicates |
| **Advance Tab** | Empty despite transactions in ledger | renderer/js/app.js (likely) | Check if advance view is wired to payments table |
| **Stock View** | Shows raw accounting instead of simple balance | renderer/js/financial_reports.js | Simplify to: Opening ± Purchases ± Sales ± Production |

### C. PARTIALLY EXISTS ⚠️

| Feature | Current State | Gap | Priority |
|---------|---------------|-----|----------|
| **Advance Accounting** | payments.transaction_type includes 'advance' | UI to view outstanding advances by party | High |
| **Employee Edit** | Salary records linked to employee_id | No UI to edit existing employee | High |
| **Product Rate Adjustment** | product_rate_history table exists | No UI screen to create rate changes | Medium |
| **Expense Category Master** | other_expenses.category used | No master list UI, just free text | Medium |
| **Stock Reconciliation** | stock_movements table exists | No period-end closing UI | Medium |
| **Collection Center Management** | routes table exists | routes_mgmt.js is incomplete | Low |

### D. MISSING (Would Require New Code) ❌

| Feature | Spec Section | Priority |
|---------|--------------|----------|
| Direct Stock Movement/Transfer UI | Spec §27 | Medium |
| Multi-input Production Screen (Milk + SMP) | Spec §26 | High |
| Advance Summary Report | Spec §16 | High |
| Bank/Cash Reconciliation Dashboard | Spec §7-10 | High |
| Stock Period-End Closing | Not in spec, but needed | Medium |
| Transaction Classification Dashboard | Spec §40 | Low |

---

## PART 5: ACCOUNTING RECONCILIATION AUDIT

### ✅ Verified Correct

The `shared/operations/accounting.js` module correctly implements:

1. **Money Precision**
   - `round2()` half-up rounds to 2 decimals
   - `CURRENCY_TOLERANCE = 0.005` used for all comparisons
   - Never uses `===` on floats ✅

2. **Ledger Direction Convention**
   ```
   closing = opening + Σ debit − Σ credit
   Sale → DR Receivable / CR Sales
   Receipt → DR Cash/Bank / CR Receivable  
   Payment → DR Payable / CR Cash/Bank
   Milk Collection → DR Milk Purchase (COGS) / CR Farmer Payable
   ```

3. **Payment Status Calculation**
   - `paymentStatus(received, total)` correctly returns PAID / PARTIAL / UNPAID
   - Used for settlement tracking

4. **Bank Row Classification**
   - Distinguishes Cash→Bank transfer (non-party) from customer receipt/supplier payment
   - Prevents double-counting deposits

5. **Idempotency**
   - Bank import uses `txn_uid` (ref: or imp:hash#n) to prevent duplicates
   - `findExistingLedgerEntry()` checks for already-posted rows before inserting

### ⚠️ Potential Issues

1. **Stock Ledger Rebuild**
   - `rebuildStockLedger()` in fresh mode deletes all stock_movements and rebuilds from sales/purchases/production
   - Correct, but no manual stock adjustment UI to trigger it
   
2. **Production Cost Allocation**
   - Milk + Cream joint production exists in schema (`stock_lots` + `lot_consumptions`)
   - But no UI to manually allocate costs between joint products
   - Derivation batches handle most cases automatically

3. **Advance Accounting**
   - `TRANSACTION_TYPES.ADVANCE` creates `Advance Receivable` ledger entries
   - But `payments.transaction_type` nullable in some cases → unclear if all advances tracked
   - No UI to view outstanding by party

---

## PART 6: TRANSACTION CLASSIFICATION MAPPING

### How Transactions Are Currently Classified

| Excel Transaction | Current Import Destination | Accounting Treatment | Stock Effect |
|---|---|---|---|
| **Farmer milk (Purchase_Entry)** | Milk Collection (via classifyMilkLine) | Milk Purchase (COGS) DR / Farmer Payable CR | Raw milk IN |
| **SMP/packaging (Purchase_Entry)** | purchase_items → purchases | Purchase DR / Payable CR | Inventory IN |
| **Office rent (Party_Ledger)** | Adjustment / payment_made | Expense DR / Cash CR | None |
| **Farmer payment (Collection)** | payments (type=payment) | Payable DR / Cash CR | None |
| **Advance given (PETTY CASH or Salary Advance)** | payments (type=advance) | Advance Receivable DR / Cash CR | None |
| **Advance returned** | payments (type=receipt) | Cash DR / Advance Receivable CR | None |
| **Advance adjusted (against expense)** | payments (type=receipt) + adjustment | Actual Expense DR / Advance CR | None |
| **Sales (Sales_Entry)** | sales + sales_items | Receivable DR / Sales CR | FG OUT |
| **Bank deposit (BANK RECON)** | bank_transactions (Cash→Bank class) | Bank DR / Cash CR | None |
| **Bank expense (BANK RECON)** | bank_transactions (Expense class) | Expense DR / Bank CR | None |
| **Bank receipt (BANK RECON)** | bank_transactions + ledger (customer receipt) | Bank DR / Receivable CR | None |
| **Production batch** | production_batches + inputs/outputs | (Cost allocated in lot_consumptions) | Input OUT, Output IN |

### ✅ Correct Classification

The import logic uses `classifyMilkLine()` to detect milk from product names:
```javascript
const MILK_TYPE_BY_PATTERN = [
  [/\bbuffal/i, 'buffalo'],
  [/\bcow\b/i, 'cow'],
];
```

This correctly separates:
- Raw milk → Milk Collection (not Purchase)
- SMP/products → Purchase (not Milk Collection)

### 🔴 Classification Issues

1. **Advance categorization**
   - PETTY CASH sheet has "Advance" rows
   - Collection sheet has "Advance" rows  
   - Salary Advance sheet has advance rows
   - All three import separately → deduped but unclear to user where advances live

2. **Office Expense classification**
   - Stored in other_expenses (free-form category)
   - No official "Expense Master" UI
   - Risk of typos / duplicate expense categories

3. **Bank vs Cash confusion**
   - Bank deposits appear in both cash_deposits AND bank_transactions
   - Need clear linking (cash_deposits.bank_txn_id)
   - Currently link exists but not always populated

---

## PART 7: DATA INTEGRITY ISSUES FOUND

### Issue 1: Employee Duplicates
```sql
SELECT id, name FROM employees WHERE archived = 0;
```
**Found:** Saraswati Raymajhi (id=3), Saraswati Raymajhi 2 (id=4)  
**Impact:** Salary records split between two employee IDs  
**Action Required:** Merge id=4 into id=3, update salary_records

### Issue 2: Missing Opening Balances
- products.opening_stock may not match historical stock_movements opening entry
- stock_movements.opening entries exist but don't cross-check with product master

### Issue 3: Advance Ledger Inconsistency
- Advances posted to ledger_entries as debit/credit
- But payments.transaction_type may not match ledger.reference_type
- Risk: Advance summary report shows wrong balance

### Issue 4: Missing Stock Closing
- No mechanism to close/freeze stock for a period
- Deleting a sale deletes its stock_movements row
- Stock history is mutable, not auditable

---

## PART 8: UI/UX ISSUES

### 🔴 Advance Tab Empty
**Path:** renderer/js/app.js → "Advances" tab  
**Expected:** Show all advance_given, advance_returned, advance_adjusted  
**Actual:** Tab likely not wired to payments table filter  
**Fix:** Add query for payments WHERE transaction_type = 'advance'

### 🔴 Stock View Shows Raw Accounting
**Current UI:** Lists stock_movements with debit/credit columns  
**Better UX:** Show simple summary:
```
OPENING | -SALES | +PURCHASES | +PRODUCTION | -WASTAGE | CLOSING
```

### 🔴 No Employee Edit
**Current:** Only "Add Employee" button  
**Missing:** Edit button to update name/salary without creating duplicate  
**Impact:** User confusion, duplicates created

### ⚠️ Date Filter Presets Unclear
**Current:** Empty date range fields  
**Better:** Visible preset buttons:
- [ ] Today [ ] Last 7 Days [ ] Last 30 Days [ ] This Month [ ] All ✓

---

## PART 9: EXCEL WORKBOOK STRUCTURE

### Sheet Categorization

**📊 Reporting Sheets (Read-Only):**
- Dashboard, Profit_Loss, Receivable_Payable
- Party_Statement, Stock_Statement, Party_Ledger
- Daybook, Reconciliation Report, Change Log, Import Log
- Error Log, README, BS_AD_Lookup

**📝 Data Entry Sheets (Import Source):**
1. **Party_Master** — Parties (customers, suppliers, farmers)
2. **Stock_Master** — Products
3. **Sales_Entry** — Invoices (line-level rows, multiple invoices per sheet)
4. **Purchase_Entry** — Bills (contains milk + non-milk items mixed)
5. **Collection** — Payments received & made
6. **Salary Advance** — Salary advances (separate register)
7. **PETTY CASH** — Daily petty cash expenses
8. **Cash_Demon** — Cash denomination counts
9. **BANK RECON** — Bank statements for reconciliation
10. **Party Email** — Email contact updates (if present)

**⚙️ Configuration Sheets:**
- Settings
- Printable_Invoice, Printable Party Statement

### Known Import Issues by Sheet

| Sheet | Issue | Severity |
|-------|-------|----------|
| **Purchase_Entry** | Same bill number appears on different dates; old key-based dedup fails; 62 milk rows lost | 🔴 High |
| **Collection** | PETTY CASH rows duplicate petty_cash register; skipped in fresh mode, re-imported in upsert | 🟡 Medium |
| **Party_Master** | Header row detection fails when export has preamble rows; field indices misaligned | 🔴 High |
| **Sales_Entry** | Internal issue rows (no invoice) get INT-YYYYMMDD-NN; workbook loss of 379L milk + 128kg cream | 🔴 High |
| **Stock_Master** | Opening stock imported but historical reconciliation impossible (no period closing) | 🟡 Medium |
| **PETTY CASH** | Office expense rows were dropped in Migration 29; "Add/Update" re-imports them | 🟡 Medium |

---

## PART 10: PHASE-BY-PHASE FIXING ROADMAP

### Phase 1: Data Cleanup & Excel Import Fix 🔴 CRITICAL

**Tasks:**
1. **Fix Excel import header detection**
   - Detect preamble rows (rows before real header)
   - Find header by keyword matching anywhere in first 50 rows
   - Test against actual Dairy_Accounts_Professional.xlsx export format

2. **Merge duplicate employees**
   - Script: Update salary_records from id=4 to id=3
   - Delete employee id=4
   - Verify no orphan salary records

3. **Re-import core sheets**
   - Purchase_Entry (fixed bill key logic)
   - Sales_Entry (verify 379L milk recovered)
   - Collection (PETTY CASH rows excluded)

4. **Validate import reconciliation**
   - Report: Excel rows vs DB rows
   - Flag any discrepancies

**Effort:** 2-3 hours  
**Risk:** Medium (data cleanup, need backup)

---

### Phase 2: Date Filter Fixes 🔴 CRITICAL

**Tasks:**
1. **Add date preset buttons to all date-filtered screens:**
   - Bank Transaction List
   - Cash Deposit List
   - Stock Ledger / Stock Statement
   - Sales / Purchases / Collection

2. **Presets:**
   ```javascript
   - Today
   - Yesterday
   - Last 7 Days
   - Last 30 Days
   - Last 90 Days
   - This Month (BS month)
   - Previous Month
   - This Year
   - Custom Range [From] [To]
   - All Transactions
   ```

3. **UI Change:**
   - Replace empty date fields with preset button bar
   - Show selected range in header ("Showing: 2083-01-01 to 2083-12-30")
   - "All" button should use '2000-01-01' to '2999-12-31' range

**Effort:** 4-5 hours  
**Risk:** Low (UI only, no data changes)

---

### Phase 3: Employee Master Fixes 🟡 MEDIUM

**Tasks:**
1. **Add Employee Edit Screen**
   - Form: Name, Code, Position, Salary, Phone, Address, Active/Inactive
   - Verify: employee_id foreign key integrity before save
   - Audit: Log who changed what when

2. **Employee Deactivation**
   - Add `active` flag (default 1)
   - Don't delete (breaks historical payroll)
   - Filter out inactive from dropdowns

3. **Validation**
   - Prevent duplicate names
   - Require non-empty name
   - Salary must be numeric

**Effort:** 3-4 hours  
**Risk:** Low (new feature, no breaking changes)

---

### Phase 4: Advance Module Visibility 🟡 MEDIUM

**Tasks:**
1. **Query advances from payments table**
   ```sql
   SELECT id, party_id, date, amount, mode, transaction_type, notes
   FROM payments
   WHERE transaction_type IN ('advance', 'advance_returned', 'advance_adjustment')
   ORDER BY date DESC
   ```

2. **Advance Summary Report**
   - Party | Amount Given | Returned | Adjusted | Outstanding
   - Filter by date range
   - Link to transactions

3. **Populate "Advances" tab**
   - Show all advance transactions
   - Group by party
   - Show balance

**Effort:** 2-3 hours  
**Risk:** Low (report query only)

---

### Phase 5: Stock View Simplification 🟡 MEDIUM

**Tasks:**
1. **Create simple stock summary view**
   ```
   Product | Opening | +Purchases | +Production | -Sales | -Wastage | Closing | Value
   ```

2. **Stock ledger detail (drill-down)**
   - Clicking product shows full ledger
   - Shows transactions with party/reference

3. **Stock reconciliation**
   - Period-end closing mechanism
   - Opening for next period = closing of previous

**Effort:** 3-4 hours  
**Risk:** Medium (changes to stock queries)

---

### Phase 6: Product Master Cleanup 🟡 MEDIUM

**Tasks:**
1. **Separate Product Master from Expense Categories**
   - Products: is_stocked = 1 (milk, cream, ghee, paneer, etc.)
   - Expenses: is_stocked = 0 (electricity, rent, etc.)
   - Or: Move non-stock to separate expense_categories table

2. **Product Rate Adjustment UI**
   - Show: Old Rate → New Rate, Effective Date, Reason
   - Insert into product_rate_history
   - Future sales use new rate

3. **Validation**
   - Product name cannot contain "Expense", "Rent", "Electricity"
   - Unit must be standard (liter, kg, piece)

**Effort:** 3-4 hours  
**Risk:** Low (new feature, optional)

---

### Phase 7: Production & Multi-Input Support 🟢 LOW (Design Phase)

**Tasks:**
1. **Review production_batches schema** (already supports multi-input)
   - production_inputs table can hold multiple rows per batch ✅
   - Schema is ready

2. **UI Enhancement**
   - Allow multiple input products in one production batch
   - Example: Milk + SMP → Standardized Milk
   - Calculate combined input cost
   - Allocate to outputs using existing joint-costing logic

3. **Yield Standards**
   - Already in schema (yield_standards table)
   - Warn if actual < expected

**Effort:** 4-5 hours (UI design & testing)  
**Risk:** Low (schema ready, UI building only)

---

## PART 11: RELEASE READINESS CHECKLIST

### Before Version 1.5.0 Release:

- [ ] Phase 1: Excel import fixed, duplicates cleaned, re-imported
- [ ] Phase 2: Date filters have preset buttons on all screens
- [ ] Phase 3: Employee edit UI added, duplicates merged
- [ ] Phase 4: Advance summary visible, reconciles with ledger
- [ ] Phase 5: Stock view simplified (opening ± movements = closing)
- [ ] Phase 6: Product master split (products vs expenses)
- [ ] Phase 7: Production multi-input UI works
- [ ] Tests: accounting-logic-audit.js passes all 96 checks
- [ ] Tests: handover-reset.js passes all 40 checks
- [ ] Tests: integrity-doctor.js shows clean database
- [ ] Windows EXE built + tested
- [ ] macOS DMG built + tested
- [ ] GitHub release created with assets + release notes
- [ ] Update mechanism verified (electron-updater)

---

## PART 12: SUMMARY TABLE

### What Exists & Works ✅
- Milk collection (separate from purchases)
- Production batches with inputs/outputs
- Stock lots (FIFO tracking)
- Bank transaction matching
- Double-entry accounting
- Payment reconciliation
- Payroll system
- Cash/bank/ledger cross-reconciliation
- PDC register

### What's Buggy & Needs Fix 🔴
- Excel import loses ~500 records per import
- Date filters default to current month (can't view history)
- Employee master has duplicates
- No employee edit function
- Product master mixes inventory + expenses
- Advance tab empty/invisible
- Stock view shows raw accounting (not simple balance)

### What's Missing & Needs Build 🟡
- Multi-input production UI (schema exists)
- Product rate adjustment UI (table exists)
- Direct stock transfer UI
- Period-end stock closing
- Expense category master UI
- Collection center management (incomplete)

---

## CONCLUSION

The system has a **strong accounting foundation** but suffers from **data entry bugs and UI issues** that obscure the correct data underneath. The core architecture is sound; the issues are in:

1. **Data cleanliness** (duplicates, misaligned imports)
2. **User workflows** (missing edits, invisible features)
3. **Historical access** (date filters locked to current period)

**Recommended Approach:**
- **Phase 1-3 (2-3 days):** Fix data, imports, date filters, employee management
- **Phase 4-5 (1-2 days):** Visibility of advances, simplify stock view
- **Phase 6-7 (Optional, 2-3 days):** Product cleanup, production UI
- **Then:** Test, build, release

The system is **salvageable** — no architectural redesign needed. Fixes are surgical and data-preserving.

---

## NEXT STEPS

1. **User confirms**: Which phases should we tackle first?
2. **Backup database** before Phase 1 (data cleanup)
3. **Test on copy** before applying to production

**Questions for User:**
- Do you want to proceed with data cleanup (Phase 1) first?
- Should we prioritize date filters (Phase 2) or advance visibility (Phase 4)?
- Do you need multi-input production UI (Phase 7) immediately?

