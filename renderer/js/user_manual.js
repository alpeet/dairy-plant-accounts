/**
 * Prarambha Account & Stock Management — User Manual
 * ===================================
 * A practical guide explaining which menus to use when,
 * how data flows between modules, and daily workflow.
 */

async function renderUserManual() {
    const container = document.getElementById('page-user-manual');
    document.getElementById('topActions').innerHTML = '';

    const appVersion = '1.0.0';

    container.innerHTML = `
        <div class="um-container" style="max-width:900px;margin:0 auto">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:12px;padding:28px 32px;margin-bottom:24px;color:#fff">
                <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
                    <span style="font-size:36px">📖</span>
                    <div>
                        <h1 style="font-size:22px;font-weight:700;margin:0">Prarambha Account &amp; Stock Management — User Manual</h1>
                        <p style="font-size:13px;color:rgba(255,255,255,0.6);margin-top:4px">Version ${appVersion} &middot; Complete Guide to Daily Accounting</p>
                    </div>
                </div>
                <div style="background:rgba(255,255,255,0.1);border-radius:8px;padding:14px 18px;font-size:14px;line-height:1.7;color:rgba(255,255,255,0.85)">
                    <strong>🎯 How to Use This Manual</strong><br>
                    Menus are grouped by how often you need them. <strong style="color:#4fc3f7">Daily menus</strong> need your attention every working day.
                    <strong style="color:#ffb74d">Occasional menus</strong> are used weekly or monthly. 
                    <strong style="color:#81c784">Report menus</strong> are for viewing — just check and review.
                    Follow the <strong>Recommended Daily Workflow</strong> at the bottom to stay on track.
                </div>
            </div>

            <!-- Quick Navigation -->
            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px">
                <a href="#um-daily" style="padding:8px 16px;background:#e3f2fd;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#1565c0;transition:all 0.2s" onmouseover="this.style.background='#bbdefb'" onmouseout="this.style.background='#e3f2fd'">
                    🔥 Daily Use
                </a>
                <a href="#um-occasional" style="padding:8px 16px;background:#fff3e0;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#e65100;transition:all 0.2s" onmouseover="this.style.background='#ffe0b2'" onmouseout="this.style.background='#fff3e0'">
                    📅 Occasional
                </a>
                <a href="#um-reports" style="padding:8px 16px;background:#e8f5e9;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#2e7d32;transition:all 0.2s" onmouseover="this.style.background='#c8e6c9'" onmouseout="this.style.background='#e8f5e9'">
                    📊 Reports & Records
                </a>
                <a href="#um-admin" style="padding:8px 16px;background:#f3e5f5;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#6a1b9a;transition:all 0.2s" onmouseover="this.style.background='#e1bee7'" onmouseout="this.style.background='#f3e5f5'">
                    ⚙️ Administration
                </a>
                <a href="#um-flow" style="padding:8px 16px;background:#fce4ec;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#c62828;transition:all 0.2s" onmouseover="this.style.background='#f8bbd0'" onmouseout="this.style.background='#fce4ec'">
                    🔄 Data Flow
                </a>
                <a href="#um-workflow" style="padding:8px 16px;background:#e0f7fa;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:#00838f;transition:all 0.2s" onmouseover="this.style.background='#b2ebf2'" onmouseout="this.style.background='#e0f7fa'">
                    ✅ Daily Workflow
                </a>
            </div>

            <!-- ==================== DAILY USE ==================== -->
            <div id="um-daily" class="um-section" style="margin-bottom:28px">
                <div class="um-section-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:24px">🔥</span>
                    <h2 style="font-size:18px;font-weight:700;margin:0;color:#1565c0">Must Update Daily</h2>
                    <span style="font-size:12px;background:#e3f2fd;color:#1565c0;padding:3px 10px;border-radius:12px;font-weight:600">Every working day</span>
                </div>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">
                    These menus are the heart of your daily accounting. Enter data here every day the business operates.
                    Data entered here automatically flows into all reports, statements, and ledgers.
                </p>

                ${renderModuleCard('sales', '💰', 'Sales Management', 'daily',
                    'Record all milk/product sales to customers. Create a new sale for every customer purchase. Select the customer, add items, and the system will automatically update stock, customer ledger, and financial reports.',
                    ['Create new sales invoices daily', 'Select correct customer and products', 'Choose payment mode: Cash, Credit, Bank, or UPI', 'Mark as Paid if cash received, or Credit if payment is pending'],
                    ['Sales Register', 'Daybook', 'Customer Statement', 'Receivables Report', 'Stock Statement', 'Profit & Loss']
                )}
                ${renderModuleCard('purchases', '📦', 'Purchase Management', 'daily',
                    'Record all non-milk purchases (packaging materials, consumables, stationery, etc.). Each purchase is linked to a supplier and automatically updates stock, supplier ledger, and payables.',
                    ['Enter purchases on the same day they happen', 'Select correct supplier', 'Items are added to stock automatically', 'Cash purchases update cash book automatically'],
                    ['Purchase Register', 'Daybook', 'Supplier Statement', 'Payables Report', 'Profit & Loss']
                )}
                ${renderModuleCard('milk', '🥛', 'Milk Collection', 'daily',
                    'Record daily milk intake from farmers. This is typically done twice a day (morning & evening shifts). Each collection records quantity, FAT%, SNF%, and calculates the rate automatically based on the active rate chart.',
                    ['Record morning and evening collections separately', 'Verify FAT and SNF readings', 'System auto-calculates rate based on formula', 'Unpaid collections appear in Farmer Payments'],
                    ['Farmer Statement', 'Farmer Payments', 'Milk Summary', 'Profit & Loss']
                )}
                ${renderModuleCard('cash-collection', '💵', 'Payment Collection', 'daily',
                    'Record daily cash and payment inflows/outflows. This is your daily cash position summary. When you select a party, the amounts are automatically posted to their statement, ledger, and the daybook.',
                    ['Record at end of each day for cash reconciliation', 'Select a party to auto-integrate with their statement', 'Choose the correct payment mode (Cash/Cheque/Online/Bank)', 'Use for tracking all daily collections'],
                    ['Party Statement', 'Daybook', 'Cash Collection Report', 'Denomination Count']
                )}
                ${renderModuleCard('cash', '🔢', 'Cash & Denomination', 'daily',
                    'Physically count cash in hand and record the denomination breakdown. The system compares your counted cash against the expected cash (from sales + receipts - payments) and shows any difference (shortage/excess).',
                    ['Count cash at end of each day', 'Enter note and coin counts accurately', 'System calculates total automatically', 'Watch for differences between counted and expected'],
                    ['Denomination Report', 'Cash Collection Report (appears automatically)']
                )}
                ${renderModuleCard('stock', '📋', 'Stock & Inventory', 'daily',
                    'Monitor your inventory levels. Check stock of all products, view movement history, and make adjustments when needed. The low stock alert highlights items that need reordering.',
                    ['Check low stock alerts daily', 'Use "Adjust Stock" for inventory corrections', 'Monitor stock movements to track usage', 'Adjustments are recorded with reason/notes'],
                    ['Stock Statement', 'Product Ledger (click 📋 on any product)']
                )}
            </div>

            <!-- ==================== OCCASIONAL USE ==================== -->
            <div id="um-occasional" class="um-section" style="margin-bottom:28px">
                <div class="um-section-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:24px">📅</span>
                    <h2 style="font-size:18px;font-weight:700;margin:0;color:#e65100">Occasional / Periodic Use</h2>
                    <span style="font-size:12px;background:#fff3e0;color:#e65100;padding:3px 10px;border-radius:12px;font-weight:600">Weekly / Monthly / As needed</span>
                </div>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">
                    These menus are used less frequently — weekly, monthly, or when specific events occur.
                </p>

                ${renderModuleCard('production', '🏭', 'Production / Batch Processing', 'occasional',
                    'Record when raw milk is processed into finished products (curd, ghee, paneer, etc.). Each batch tracks inputs (raw milk), outputs (finished products), and yield percentage.',
                    ['Create batches when processing happens', 'Enter raw milk input quantity', 'Enter finished product output', 'System calculates yield percentage'],
                    ['Stock Movements', 'Product Inventory']
                )}
                ${renderModuleCard('salary', '👷', 'Salary / Payroll', 'occasional',
                    'Manage employee salaries. Record monthly salary payments with details of basic pay, allowances, advances, and deductions. Each salary record can be tracked by month.',
                    ['Record at end of each month', 'Enter employee name and position', 'Net salary = Basic + Allowance - Advance - Deduction', 'Select payment mode and date'],
                    ['Profit & Loss (as expense)', 'Daybook']
                )}
                ${renderModuleCard('vehicle', '🚛', 'Vehicle Expenses', 'occasional',
                    'Track all vehicle-related expenses: fuel, repairs, maintenance, toll/parking, and other costs. Each expense is linked to a vehicle and driver.',
                    ['Enter fuel expenses weekly or as incurred', 'Separate repair and maintenance entries', 'All vehicle expenses flow to P&L automatically'],
                    ['Vehicle Summary', 'Profit & Loss', 'Daybook']
                )}
                ${renderModuleCard('expenses', '📋', 'Other Expenses', 'occasional',
                    'Record all other business expenses not covered by other modules: office supplies, utilities, rent, marketing, etc. Categorize by expense head for better tracking.',
                    ['Enter expenses as they occur', 'Use consistent categories for reporting', 'All expenses flow to P&L automatically'],
                    ['Expense Summary', 'Profit & Loss', 'Daybook']
                )}
                ${renderModuleCard('petty-cash', '💰', 'Petty Cash', 'occasional',
                    'Manage small day-to-day cash expenses. Each petty cash entry has a voucher number, expense head, and is approved by a designated person.',
                    ['Use for small expenses only', 'Each entry needs a voucher number', 'Get approval before recording', 'Reconcile petty cash regularly'],
                    ['Petty Cash Summary', 'Profit & Loss']
                )}
                ${renderModuleCard('farmer-payments', '💵', 'Farmer Payments', 'occasional',
                    'Pay farmers for their milk collections. View outstanding amounts and make bulk payments. Select farmers and the system calculates what is owed.',
                    ['Run after milk collections are completed (daily/weekly)', 'Review outstanding amounts before paying', 'Can pay multiple farmers at once', 'Payments update farmer statements automatically'],
                    ['Farmer Statement', 'Profit & Loss']
                )}
                ${renderModuleCard('cash-deposit', '🏦', 'Cash Deposit', 'occasional',
                    'Record bank deposits made from cash on hand. Track deposits by bank, account number, and deposit mode (cash/cheque/transfer/online).',
                    ['Record when depositing cash to bank', 'Select correct bank and account', 'Deposit mode matches how you deposited', 'Reference number helps reconciliation'],
                    ['Cash Deposit Summary', 'Bank Reconciliation']
                )}
                ${renderModuleCard('pdc', '🏛', 'Cheque Register (PDC)', 'occasional',
                    "Post-dated cheques received from customers and issued to suppliers. A cheque is a promise, not money: while it is Held or Deposited it changes no bank balance, and only clearing it posts the receipt or payment. The register shows what is expected, what is due today, and what has bounced.",
                    ['Record the cheque with its BS cheque date so due-date alerts work', 'Allocate it to one or more invoices, or leave it On Account', 'Deposit → Clear when the bank confirms the money; Bounce if it is returned', 'Held cheques are NOT part of the bank balance or the party balance'],
                    ['Cash / Bank position (only after clearing)', 'Party Statements (PDC lines shown separately)', 'Daybook (memo lines)', 'Receivable / Payable']
                )}
                ${renderModuleCard('rate-charts', '📊', 'Milk Rate Chart', 'occasional',
                    'Manage milk pricing formulas. Set FAT and SNF multipliers that determine milk collection rates. Rates can be formula-based or fixed. Changes take effect from the specified date.',
                    ['Update when milk pricing changes', 'Can use formula or fixed rate', 'New rates apply from effective date', 'Previous rates are preserved for history'],
                    ['Milk Collection (rates auto-calculated)']
                )}
                ${renderModuleCard('partner-capital', '🤝', 'Partner Capital', 'occasional',
                    'Track partner investments and withdrawals. Each partner (party with type=partner) can contribute or withdraw capital. This shows the ownership structure of the business.',
                    ['Record contributions when partners invest', 'Record withdrawals when partners take money', 'Partner statements show running capital balance', 'Only visible to accountant role and above'],
                    ['Partner Statement', 'Partner Capital Summary']
                )}
                ${renderModuleCard('parties', '👥', 'Party Management', 'occasional',
                    'Manage your master list of customers, suppliers, farmers, and partners. Add new parties, update contact details, set opening balances, and categorize by type.',
                    ['Add new customers/suppliers as needed', 'Set correct party type for reports', 'Opening balance affects statements', 'Route assignment helps milk collection organization'],
                    ['Party Statements', 'Receivables/Payables', 'Sales & Purchases']
                )}
                ${renderModuleCard('routes', '🛣️', 'Routes / Collection Centers', 'occasional',
                    'Manage milk collection routes and centers. Assign routes to farmers and track collection areas. Each route can have an assigned vehicle and staff.',
                    ['Set up routes before adding farmers', 'Route names help organize collections', 'Assign vehicles and staff for planning'],
                    ['Milk Collections (linked by route)', 'Farmer Lists']
                )}
            </div>

            <!-- ==================== REPORTS & RECORDS ==================== -->
            <div id="um-reports" class="um-section" style="margin-bottom:28px">
                <div class="um-section-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:24px">📊</span>
                    <h2 style="font-size:18px;font-weight:700;margin:0;color:#2e7d32">Reports & Records (View Only)</h2>
                    <span style="font-size:12px;background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:12px;font-weight:600">Check & Review</span>
                </div>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">
                    These menus are for viewing reports, checking records, and generating summaries. Data here comes automatically from the daily and occasional entries you make. No data entry needed.
                </p>

                ${renderModuleCard('dashboard', '📊', 'Dashboard', 'report',
                    'Your home screen. Shows a quick overview of today\'s sales, purchases, cash position, recent transactions, and monthly trends. Start your day here to see what happened yesterday.',
                    ['Review daily sales and purchase totals', 'Check recent transactions', 'View monthly performance chart'],
                    []
                )}
                ${renderModuleCard('reports', '📈', 'Reports', 'report',
                    'Central reports hub. Generate customized reports for sales, purchases, daybook, receivables, payables, and more with date range filters and export options.',
                    ['Use date filters for specific periods', 'Print reports or export to PDF', 'Receivables shows what customers owe you', 'Payables shows what you owe suppliers'],
                    ['All daily data feeds into these reports']
                )}
                ${renderModuleCard('statements', '📄', 'Customer / Supplier Statements', 'report',
                    'Generate detailed statements for any party (customer, supplier, or farmer). Shows opening balance, all transactions in date range, running balance, and closing balance.',
                    ['Select a party to view their statement', 'Set date range for the statement period', 'Print or export as needed'],
                    ['Sales, Payments, Milk Collections (all feed here)']
                )}
                ${renderModuleCard('profit-loss', '📊', 'Profit & Loss', 'report',
                    'View your business profitability. Shows total income (sales + receipts) vs total expenses (milk collection, purchases, salary, vehicle, expenses, petty cash). Net profit/loss for any period.',
                    ['Select date range and generate', 'Income and expense breakdown shown', 'Green = profit, Red = loss', 'Print for management review'],
                    ['All transaction modules feed into P&L']
                )}
                ${renderModuleCard('receivable-payable', '💰', 'Receivable / Payable', 'report',
                    'See who owes you money (receivables from customers) and who you owe money to (payables to suppliers). Net position shows if you are overall receivable or payable.',
                    ['Check weekly to follow up on dues', 'Outstanding amounts from credit sales', 'Helps with cash flow planning'],
                    ['Sales (credit sales)', 'Purchases (credit purchases)']
                )}
                ${renderModuleCard('daybook', '📅', 'Daybook', 'report',
                    'Complete transaction log. Shows all sales, purchases, payments, expenses, and petty cash entries in one place with debit/credit format. The most comprehensive report.',
                    ['View by day, month, or custom period', 'Shows ALL transactions in one view', 'Debit = money out, Credit = money in', 'Use for audit and reconciliation'],
                    ['Sales, Purchases, Payments, Expenses (all feed here)']
                )}
                ${renderModuleCard('stock-statement', '📋', 'Stock Statement', 'report',
                    'Current inventory valuation. Shows every product with current stock quantity, rate, and total stock value. Filter by category and search for specific products.',
                    ['Check total inventory value', 'Monitor stock levels across all products', 'Export to PDF for records'],
                    ['Stock movements, Sales, Purchases, Production (all feed here)']
                )}
            </div>

            <!-- ==================== ADMINISTRATION ==================== -->
            <div id="um-admin" class="um-section" style="margin-bottom:28px">
                <div class="um-section-header" style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:24px">⚙️</span>
                    <h2 style="font-size:18px;font-weight:700;margin:0;color:#6a1b9a">Administration</h2>
                    <span style="font-size:12px;background:#f3e5f5;color:#6a1b9a;padding:3px 10px;border-radius:12px;font-weight:600">Setup & Management</span>
                </div>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:16px;line-height:1.6">
                    System administration menus. These control how the app works and are typically used by the admin or accountant role.
                </p>

                ${renderModuleCard('settings', '⚙️', 'Settings', 'admin',
                    'Configure your business details: business name, address, tax settings, currency, and backup preferences. Also manage user accounts and database backups.',
                    ['Set business name and contact details', 'Configure tax rate and currency', 'Create and manage user accounts', 'Create database backups regularly'],
                    []
                )}
                ${renderModuleCard('db-tables', '🗃️', 'Database Tables', 'admin',
                    'View all database tables grouped by functional category. Shows table names, record counts, and status. Useful for understanding how data is organized.',
                    ['Browse tables to understand data structure', 'Check record counts for each table', 'Search for specific tables'],
                    []
                )}
                ${renderModuleCard('audit-log', '📝', 'Audit Log', 'admin',
                    'Complete audit trail of all changes made in the system. Shows who created, updated, or deleted records, what changed, and when. Essential for accounting compliance.',
                    ['Review changes when investigating issues', 'Track who made what changes', 'Audit log is read-only (cannot be modified)'],
                    []
                )}
                ${renderModuleCard('user-manual', '📖', 'User Manual', 'admin',
                    'You are here! This manual explains every menu, how to use it, what it feeds into, and what feeds into it. Use it to train new staff and as a daily reference.',
                    ['Read each section as needed', 'Use quick navigation links to jump to sections', 'Follow the daily workflow below', 'Print for offline reference'],
                    []
                )}
            </div>

            <!-- ==================== DATA FLOW ==================== -->
            <div id="um-flow" style="background:var(--bg-white);border-radius:12px;padding:24px 28px;margin-bottom:28px;border:1px solid var(--border)">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:24px">🔄</span>
                    <h2 style="font-size:18px;font-weight:700;margin:0">How Data Flows Through the System</h2>
                </div>
                <p style="font-size:13px;color:var(--text-light);margin-bottom:20px;line-height:1.6">
                    Understanding data flow helps you see how your daily entries connect to reports and statements.
                    This is the complete data pipeline of your accounting system.
                </p>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                    <div style="background:#e3f2fd;border-radius:10px;padding:18px;border-left:4px solid #1565c0">
                        <div style="font-size:14px;font-weight:700;color:#1565c0;margin-bottom:8px">📝 Daily Data Entry →</div>
                        <div style="font-size:13px;line-height:1.8;color:#333">
                            <div>Sales → <span style="color:#1565c0">Stock ↓, Ledger ↑, Daybook ↑, P&L ↑</span></div>
                            <div>Purchases → <span style="color:#1565c0">Stock ↑, Ledger ↑, Daybook ↑, P&L ↑</span></div>
                            <div>Milk Collection → <span style="color:#1565c0">Farmer Statement ↑, P&L (expense) ↑</span></div>
                            <div>Payment Collection → <span style="color:#1565c0">Cash Report ↑, Party Statement ↑, Daybook ↑</span></div>
                            <div>Cash & Denom → <span style="color:#1565c0">Cash Report ↑, Difference Report</span></div>
                        </div>
                    </div>

                    <div style="background:#fff3e0;border-radius:10px;padding:18px;border-left:4px solid #e65100">
                        <div style="font-size:14px;font-weight:700;color:#e65100;margin-bottom:8px">📅 Occasional Entry →</div>
                        <div style="font-size:13px;line-height:1.8;color:#333">
                            <div>Production → <span style="color:#e65100">Stock Movements ↑</span></div>
                            <div>Salary → <span style="color:#e65100">P&L (expense) ↑, Daybook ↑</span></div>
                            <div>Vehicle Exp → <span style="color:#e65100">P&L (expense) ↑, Daybook ↑</span></div>
                            <div>Other Expenses → <span style="color:#e65100">P&L (expense) ↑, Daybook ↑</span></div>
                            <div>Petty Cash → <span style="color:#e65100">P&L (expense) ↑, Daybook ↑</span></div>
                            <div>Farmer Payments → <span style="color:#e65100">Farmer Statement ↓, P&L</span></div>
                        </div>
                    </div>

                    <div style="background:#e8f5e9;border-radius:10px;padding:18px;border-left:4px solid #2e7d32">
                        <div style="font-size:14px;font-weight:700;color:#2e7d32;margin-bottom:8px">📊 Reports (auto-generated from above)</div>
                        <div style="font-size:13px;line-height:1.8;color:#333">
                            <div>Daybook ← All transactions combined</div>
                            <div>Profit & Loss ← Sales + Expenses - Costs</div>
                            <div>Receivable/Payable ← Credit sales/purchases</div>
                            <div>Stock Statement ← All stock movements</div>
                            <div>Party Statement ← Sales + Payments + Milk</div>
                        </div>
                    </div>

                    <div style="background:#f3e5f5;border-radius:10px;padding:18px;border-left:4px solid #6a1b9a">
                        <div style="font-size:14px;font-weight:700;color:#6a1b9a;margin-bottom:8px">⚙️ Administration (infrastructure)</div>
                        <div style="font-size:13px;line-height:1.8;color:#333">
                            <div>Settings ← Configure business details</div>
                            <div>Backup ← Protect your data</div>
                            <div>Audit Log ← Track all changes</div>
                            <div>DB Tables ← View data structure</div>
                            <div>↑ = increases / adds to &nbsp; ↓ = decreases</div>
                        </div>
                    </div>
                </div>

                <div style="margin-top:16px;padding:14px 18px;background:#fef3cd;border-radius:8px;border-left:4px solid #f39c12;font-size:13px;line-height:1.6">
                    <strong>⚠️ Key Rule:</strong> Data flows one way — from entry → to ledgers → to reports. You don't need to enter anything in reports or statements.
                    They update automatically from your daily entries. If a report seems wrong, check your daily entries first.
                </div>
            </div>

            <!-- ==================== DAILY WORKFLOW ==================== -->
            <div id="um-workflow" style="background:linear-gradient(135deg,#e0f7fa,#b2ebf2);border-radius:12px;padding:24px 28px;margin-bottom:28px;border:2px solid #4dd0e1">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
                    <span style="font-size:28px">✅</span>
                    <h2 style="font-size:20px;font-weight:700;margin:0;color:#006064">Recommended Daily Workflow</h2>
                </div>
                <p style="font-size:13px;color:#00838f;margin-bottom:16px;line-height:1.6">
                    Follow this sequence every working day. It ensures all data is captured correctly and reports are always up to date.
                    Estimated time: <strong>30-45 minutes</strong> for a typical day's entries.
                </p>

                <div style="display:grid;gap:12px">
                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">1</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">Morning: Record Milk Collection 🥛</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                Record morning shift milk collections from farmers. Enter quantity, FAT%, and SNF% for each farmer.
                                The rate is calculated automatically. This feeds into farmer payments and P&L.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">2</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">Throughout Day: Record Sales 💰</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                Record each sale as it happens. Select the customer, add products being sold, enter quantities and rates.
                                The system updates stock, customer ledger, and daybook immediately. Choose correct payment mode.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">3</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">As Needed: Record Purchases 📦</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                Record purchases of supplies, packaging, and other items. Select supplier, add items, and the system updates stock and supplier ledger.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">4</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">As Needed: Record Other Expenses 📋</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                Record vehicle expenses, other expenses, and petty cash as they occur. Categorize each expense for better reporting.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">5</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">Evening: Record Cash & Denomination 💵🔢</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                End-of-day procedure: Go to <strong>Payment Collection</strong> and record the day's cash summary (total sales, receipts, payments).
                                Then go to <strong>Cash & Denom</strong> to physically count cash and enter the denomination breakdown.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#1565c0;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">6</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#1565c0">Review: Check Dashboard & Reports 📊</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                End your day by reviewing the Dashboard to see today's totals. Check the Daybook to verify all entries are correct.
                                Review Stock Statement to monitor inventory levels.
                            </div>
                        </div>
                    </div>

                    <div style="background:#fff;border-radius:10px;padding:16px 20px;display:flex;align-items:flex-start;gap:16px">
                        <div style="background:#e65100;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0">7</div>
                        <div>
                            <div style="font-size:14px;font-weight:700;color:#e65100">Weekly/Monthly: Review All Reports 📈</div>
                            <div style="font-size:13px;color:var(--text-light);margin-top:4px;line-height:1.5">
                                Run Profit & Loss for the month. Check Receivables/Payables to follow up on dues.
                                Generate Party Statements for customers/suppliers. Create a database backup in Settings.
                            </div>
                        </div>
                    </div>
                </div>

                <div style="margin-top:16px;padding:14px 18px;background:#fff;border-radius:8px;border-left:4px solid #4dd0e1;font-size:13px;line-height:1.6">
                    <strong>💡 Pro Tip:</strong> At the end of each week, take 10 minutes to review the <strong>Daybook</strong> and <strong>Profit & Loss</strong> reports.
                    This catches errors early and keeps your accounts clean. At month-end, create a database backup from <strong>Settings → Backup</strong>.
                </div>
            </div>

            <!-- ============== WHERE DO I RECORD THIS? ============== -->
            ${umWhereToRecordHtml()}

            <!-- ==================== MODULE GUIDE ==================== -->
            ${umModuleGuideHtml()}

            <!-- ==================== GLOSSARY ==================== -->
            ${umGlossaryHtml()}

            <!-- Footer -->
            <div style="text-align:center;padding:20px;color:var(--text-light);font-size:12px">
                Prarambha Account &amp; Stock Management v${appVersion} &middot; User Manual &middot; Generated from the app
            </div>
        </div>
    `;
}

// ============================================================
// Module guide — every menu, explained without accounting jargon
// ============================================================
// [group, module, icon, what it is for, when to use it, what you type, dairy example, affects]
const UM_MODULE_GUIDE = [
    ['Daily Entry', 'Sales', '💰',
        'Records a sale: milk, paneer, cream, ghee, curd — anything you sell.',
        'Every time a customer takes goods, whether they pay now or later.',
        'Customer, date, product, litres/kg, rate. The amount is calculated. Choose Cash if paid now, Credit if they will pay later.',
        'Krishna Dairy takes 50 L milk at Rs 62 = Rs 3,100 on credit. Stock goes down 50 L, Krishna owes you Rs 3,100.',
        'P&L (income) + Balance Sheet (stock down, receivable up)'],
    ['Daily Entry', 'Purchases', '📦',
        'Records anything you buy: packing pouches, diesel, chemicals, or milk on a bill.',
        'When a supplier gives you a bill, or you buy something for the plant.',
        'Supplier, bill number, date, item, quantity, rate. Payment mode: cash, bank or credit.',
        'Bought 5,000 pouches for Rs 12,000 on credit. Stock up 5,000, supplier payable Rs 12,000 — not an expense yet.',
        'P&L (cost of goods) + Balance Sheet (stock up, payable up)'],
    ['Daily Entry', 'Milk Collection', '🥛',
        'Records milk bought from farmers, with fat/SNF and the rate paid.',
        'Every morning and evening collection, per farmer.',
        'Farmer, shift, litres, fat, SNF, rate (auto or fixed).',
        'Ram Bahadur brings 20 L at fat 4.2. The app calculates the rate — say Rs 58.40/L = Rs 1,168. That is a milk cost and Ram is owed Rs 1,168.',
        'P&L (milk procurement cost) + Balance Sheet (farmer payable)'],
    ['Daily Entry', 'Payment Collection', '💵',
        'Records money received from a customer against their outstanding balance.',
        'When a customer pays cash, by bank, or by cheque.',
        'Customer, amount, date, mode. This is NOT a new sale.',
        'Krishna pays Rs 2,000 of the Rs 3,100 he owed. His balance becomes Rs 1,100. Income does not change — the sale was already counted.',
        'Balance Sheet only (cash up, receivable down)'],
    ['Daily Entry', 'Payment Register', '💳',
        'Records money paid out: to suppliers, farmers, for rent, loans, advances.',
        'Whenever money leaves the business by cash, bank or cheque.',
        'Party, amount, date, mode, and what the payment is for (settlement, expense, advance, loan).',
        'Paid Rs 12,000 to the pouch supplier by bank. The payable becomes zero. It is not a new expense — the purchase already carried it.',
        'Balance Sheet (bank down, payable down); an expense only if it is a new cost'],
    ['Production', 'Production', '🏭',
        'Turns milk into paneer, cream, ghee or curd and records the output.',
        'After each batch of processing.',
        'Input milk and other materials, output product and quantity, wastage.',
        '300 L milk becomes 60 kg paneer. Milk stock falls 300 L, paneer stock rises 60 kg.',
        'Balance Sheet (stock changes); costing feeds the P&L'],
    ['Stock', 'Stock / Stock Statement', '📋',
        'Shows what you have, what came in, what went out, and what it is worth.',
        'Any time you need to check stock; at month end for closing stock.',
        'Opening stock, adjustments, physical counts.',
        'The register says 120 kg paneer but you count 114 kg — record a 6 kg shortage adjustment so stock matches reality.',
        'Balance Sheet (inventory value); shortages reach the P&L'],
    ['Masters', 'Parties', '👥',
        'The directory of customers, suppliers, farmers and partners, each with a ledger.',
        'Before recording the first transaction with someone.',
        'Name, type (customer/supplier/farmer/partner), phone, PAN, opening balance.',
        'Add “Krishna Dairy” as a customer with an opening balance of Rs 5,000 they already owed.',
        'Balance Sheet (receivable/payable)'],
    ['Expenses', 'Other Expenses', '📋',
        'Records running costs that are not stock purchases.',
        'Electricity bill, office supplies, repairs, telephone, bank charges.',
        'Date, category, description, amount, paid to, payment mode.',
        'Paid Rs 8,500 electricity by bank. This is an expense this month — cash/bank falls and profit falls.',
        'P&L (operating expense) + Balance Sheet (cash/bank down)'],
    ['Expenses', 'Petty Cash', '💰',
        'Small day-to-day cash spending from the office drawer.',
        'Tea, local transport, small repairs, stationery.',
        'Date, head, description, amount, paid to.',
        'Rs 250 for a taxi to the bank. Recorded as a petty cash expense, not as an advance.',
        'P&L (operating expense)'],
    ['Expenses', 'Salary', '👷',
        'Monthly payroll: what each staff member earns and is paid.',
        'Once a month, when salaries are paid.',
        'Employee, month, basic salary, allowance, advance recovery, deduction.',
        'Staff paid Rs 15,000 for Shrawan; Rs 2,000 of an earlier advance is recovered, so Rs 13,000 cash is paid.',
        'P&L (salary expense) + Balance Sheet (cash down, advance recovered)'],
    ['Expenses', 'Vehicle Expenses', '🚛',
        'Running costs of the collection vehicle or tempo.',
        'Fuel, repairs, maintenance, toll and parking.',
        'Vehicle, date, expense type, amount.',
        'Rs 4,000 diesel for the collection van. It is a transport cost of this month.',
        'P&L (operating expense)'],
    ['Cash & Bank', 'Cash & Denomination', '🔢',
        'Counts the notes and coins in the drawer and compares them with the ledger.',
        'Every day at closing, or at least weekly.',
        'Number of notes per denomination (500, 100, 50 …). The total is calculated.',
        'Drawer count is Rs 42,300 but the ledger says Rs 43,100 — the Rs 800 gap is shown as a difference to investigate.',
        'Balance Sheet (proves the cash figure)'],
    ['Cash & Bank', 'Cash Deposit', '🏦',
        'Records cash taken from the drawer and put into the bank.',
        'When you deposit the day’s collection at the bank.',
        'Date, deposit slip number, bank, amount.',
        'Deposited Rs 20,000 at Nabil. Cash falls Rs 20,000, bank rises Rs 20,000. It is a transfer, never income.',
        'Balance Sheet only'],
    ['Cash & Bank', 'Bank Transactions', '💳',
        'The bank statement: every deposit and withdrawal, matched to its document.',
        'When the statement arrives, or after each bank transaction.',
        'Date, reference, party, debit/credit, then classify each row.',
        'The statement shows Rs 12,000 paid to the pouch supplier — matched to the payment already recorded, so it is not counted twice.',
        'Balance Sheet (bank balance)'],
    ['Ledgers', 'Company Ledger', '📒',
        'One list of every money movement of the business, classified.',
        'To answer “where did the money go?” without opening five screens.',
        'Nothing — it is read-only. Use the filters.',
        'Filter to one week and see sales in, milk paid, diesel, salary and bank charges side by side.',
        'Read-only view (no change)'],
    ['Ledgers', 'Receivable / Payable', '💰',
        'Who owes you money and whom you owe, with ageing.',
        'Weekly, and before month end.',
        'Nothing — derived from the party ledgers.',
        'Krishna Dairy owes Rs 1,100 for 12 days; the pouch supplier is owed Rs 12,000.',
        'Balance Sheet (working capital)'],
    ['Ledgers', 'Advances', '⏳',
        'Money given ahead of time, to be recovered later.',
        'When you give a farmer or staff an advance.',
        'Party, amount, date, and how it will be recovered.',
        'Rs 10,000 advance to a farmer is taken back from the next milk payments. It is an asset, not an expense.',
        'Balance Sheet only (advance receivable)'],
    ['Reports', 'Profit & Loss', '📊',
        'Did the business make money in a period? Income minus all costs.',
        'Monthly and yearly; before taking any business decision.',
        'Nothing — choose the period.',
        'Bhadra: sales Rs 9,00,000, milk and purchases Rs 7,50,000, expenses Rs 1,00,000 → profit Rs 50,000.',
        'P&L'],
    ['Reports', 'Monthly Report', '🗓',
        'One report for a BS month: income, costs, profit AND the closing cash, bank, stock, receivable and payable.',
        'At every month end. Every figure can be clicked to see the records behind it.',
        'Nothing — choose the month, then click any line to drill down.',
        'Click “Other Purchases — Rs 1,76,877.78” to see each purchase bill, its supplier, its amount and the total match.',
        'P&L + Balance Sheet'],
    ['Reports', 'Statements', '📄',
        'A printable ledger for one customer, supplier or farmer.',
        'When a party asks “how much do I owe?” or at settlement.',
        'Choose the party and the date range.',
        'Print Krishna Dairy’s statement showing the Rs 3,100 sale and the Rs 2,000 payment, balance Rs 1,100.',
        'Read-only (uses the party ledger)'],
    ['Admin', 'Settings', '⚙️',
        'Company profile, users, backup/restore, Excel import, Fresh Start and Data Location.',
        'At setup, when adding a user, before/after a big change.',
        'Business name, address, PAN, currency, paper size; user passwords.',
        'Before handing the app to a new client: create the backup, run Fresh Start, then check Data Location shows the file you expect.',
        'Configuration (does not change the accounts)'],
    ['Admin', 'Data Integrity', '🩺',
        'Read-only health check of the database.',
        'When a total looks wrong, or after an import.',
        'Nothing — run it and read the findings.',
        'It reports duplicate parties, orphan ledger rows and negative stock so you can fix them at the source.',
        'Diagnostics only']
];

// ============================================================
// "Where do I record this?" — the four questions that come up most
// ============================================================
// [question EN, question NP, screen, what you enter, what it does, trap]
const UM_WHERE_TO_RECORD = [
    ['Where do I record other purchases — pouches, chemicals, spare parts, packing material?',
        'अन्य खरिद — पाउच, केमिकल, स्पेयर पार्ट्स, प्याकिङ सामान कहाँ लेख्ने?',
        '📦 Purchases → + New Purchase',
        'Supplier, bill no, date, item, quantity, rate, and whether you paid cash, bank or will pay later (credit).',
        'A supplier bill becomes a supplier payable. Stock goes up by the quantity. It reaches Profit & Loss only as those goods are sold (cost of goods sold) — not on the bill date.',
        'Do not also enter the same bill in the Payment Register as an expense. When you pay the supplier later, use Payment Register — that settles the payable without a second expense.'],

    ['Where do I record diesel bought from a party on credit?',
        'पार्टीबाट उधारोमा किनेको डिजेल कहाँ लेख्ने?',
        '🚛 Vehicle Expenses (or 📦 Purchases if you keep it as stock)',
        'Vehicle, date, expense type = Fuel / Diesel, litres and amount, plus the party name and bill number.',
        'Diesel used in your own van is a Fuel cost of that month, and the party is owed the money until you pay — so it is an expense AND a payable at the same time.',
        'Recording the diesel bill and then paying the same party through Payment Register is correct — the payment only clears the payable. Entering the diesel again as an “Other Expense” is a double cost.'],

    ['Where do I record rent paid?',
        'तिरेको घरभाडा कहाँ लेख्ने?',
        '📋 Other Expenses → category “Rent” for one month, or the Prepaid Rent screen when you pay several months at once',
        'Date, category Rent, head “Shop rent”, amount, paid to, mode, reference number.',
        'One month of rent for one month of use is an operating expense. Rent paid in advance for future months is an ASSET (prepaid rent); one month’s share becomes an expense each month as it is used.',
        'Do not expense six months of rent in the month you paid: that month would show a loss and the next five would show extra profit. Use the prepaid screen so each month carries its own share.'],

    ['Where do I record rent received?',
        'प्राप्त भएको घरभाडा कहाँ लेख्ने?',
        '📋 Other Expenses → category “Income”, head “Rent received”',
        'Date, category Income, head “Rent received”, amount, received from, mode, receipt number.',
        'It is shown as Other Income in the Profit & Loss and the Monthly Report, and the Expenses screen keeps it OUT of the expense total — money coming in is never an expense.',
        'If the tenant paid several months in advance, only the current month is income; the unearned part is an advance received (a liability). Do not treat the whole receipt as this month’s income.'],

    ['Where do I record paying a supplier for a bill already entered?',
        'पहिले नै लेखिएको बिलको भुक्तानी कहाँ लेख्ने?',
        '💳 Payment Register (or Cash → Payment Collection)',
        'Party, amount, date, mode, and mark it as a settlement against the bill.',
        'Money leaves the bank or drawer and the payable falls. Profit does not change — the cost was already recorded with the bill.',
        'Do not enter it again in Other Expenses. Doing that counts the same cost twice.'],

    ['Where do I record cash put into the bank?',
        'बैंकमा जम्मा गरेको नगद कहाँ लेख्ने?',
        '🏦 Cash Deposit',
        'Date, slip number, bank, amount.',
        'Cash falls by that amount and bank rises by the same amount. Total money is unchanged — it is a transfer, not income.',
        'Depositing the day’s collection never creates sales income. The sale was already counted when the sale was recorded.']
];

function umWhereToRecordHtml() {
    const rows = UM_WHERE_TO_RECORD.map(([qEn, qNp, screen, entry, effect, trap]) => `
        <tr>
            <td style="font-weight:600;min-width:230px">${qEn}
                <div style="font-family:'Noto Sans Devanagari','Kalimati','Nirmala UI',sans-serif;font-weight:400;color:var(--text-light);font-size:12px;margin-top:4px">${qNp}</div>
            </td>
            <td style="white-space:nowrap;font-weight:600;color:#1565c0">${screen}</td>
            <td style="font-size:12.5px">${entry}</td>
            <td style="font-size:12.5px">${effect}</td>
            <td style="font-size:12px;color:#8a4b00;background:#fff7ed">${trap}</td>
        </tr>`).join('');
    return `
        <div id="um-where" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:24px 28px;margin-bottom:28px;overflow:auto">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <span style="font-size:24px">❓</span>
                <h2 style="font-size:18px;font-weight:700;margin:0">Where Do I Record This? — यो कहाँ लेख्ने?</h2>
            </div>
            <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin:0 0 14px">
                The six questions asked most often. Each row names the exact screen, what to type, what the entry
                does to Cash / Bank / Stock / Party balance / Profit, and the mistake to avoid.
            </p>
            <table class="data-table" style="font-size:12.5px;min-width:1000px">
                <thead><tr>
                    <th>Question</th><th>Screen to use</th><th>What you enter</th>
                    <th>What it does</th><th>The mistake to avoid</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:16px;padding:14px 18px;background:#eef7ff;border-left:4px solid #1565c0;border-radius:8px;font-size:13px;line-height:1.7">
                <strong>One rule covers all six:</strong> money moving between your own accounts (cash → bank, supplier bill → supplier payment)
                never creates a second income or expense. Only a new sale, a new bill or a new cost does.
                <div style="font-family:'Noto Sans Devanagari','Kalimati','Nirmala UI',sans-serif;margin-top:6px;color:#334">
                    एउटै नियम सबैमा लागू: आफ्नै खाताबीच सारिएको पैसा (नगद → बैंक, बिल → भुक्तानी) ले दोस्रो आम्दानी वा खर्च बन्दैन।
                </div>
            </div>
        </div>`;
}

function umModuleGuideHtml() {
    const rows = UM_MODULE_GUIDE.map(([group, module, icon, purpose, when, entry, example, affects]) => `
        <tr>
            <td style="font-size:11px;color:var(--text-light);white-space:nowrap">${group}</td>
            <td style="font-weight:600;white-space:nowrap">${icon} ${module}</td>
            <td>${purpose}</td>
            <td>${when}</td>
            <td>${entry}</td>
            <td style="font-size:12px;color:#555">${example}</td>
            <td style="font-size:11px;white-space:nowrap">${affects}</td>
        </tr>`).join('');
    return `
        <div id="um-modules" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:24px 28px;margin-bottom:28px;overflow:auto">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <span style="font-size:24px">🧭</span>
                <h2 style="font-size:18px;font-weight:700;margin:0">Every Menu Explained — What It Does and When to Use It</h2>
            </div>
            <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin:0 0 14px">
                Each menu, in plain words: what it is for, when to use it, what you type, a real dairy example,
                and whether it changes the Profit &amp; Loss, the Balance Sheet, or both.
            </p>
            <table class="data-table" style="font-size:12.5px;min-width:900px">
                <thead><tr>
                    <th>Menu group</th><th>Menu</th><th>What it is for</th><th>When to use it</th>
                    <th>What you enter</th><th>Dairy example</th><th>Affects</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:16px;padding:14px 18px;background:#fff7ed;border-left:4px solid #f97316;border-radius:8px;font-size:13px;line-height:1.7">
                <strong>Three rules that prevent most mistakes</strong>
                <ol style="margin:8px 0 0 18px;padding:0">
                    <li><strong>An advance is not an expense.</strong> Money given early is still yours until it is used or recovered.</li>
                    <li><strong>Receiving money is not income.</strong> If the sale was already recorded, the payment only settles the balance.</li>
                    <li><strong>Putting cash into the bank is not income.</strong> The same money moves from the drawer to the bank — nothing is earned.</li>
                </ol>
            </div>
        </div>`;
}

// ============================================================
// Glossary — every accounting word the app uses, EN + नेपाली
// ============================================================
// [English, नेपाली, plain-English meaning, dairy example]
const UM_GLOSSARY = [
    ['Ledger', 'खाता', 'A page per person or item that lists every amount in and out, so the balance is always known.', 'Krishna Dairy’s ledger shows a Rs 3,100 sale, a Rs 2,000 payment, balance Rs 1,100.'],
    ['General Ledger', 'मुख्य खाता', 'The main book that collects every account of the business in one place.', 'The Company Ledger screen is this book: sales, milk, diesel, salary, bank charges.'],
    ['Party Ledger', 'पार्टी खाता', 'The ledger of one customer, supplier or farmer.', 'The farmer Ram Bahadur’s ledger lists each collection and each payment to him.'],
    ['Supplier Ledger', 'आपूर्तिकर्ताको खाता', 'The ledger of one supplier — what you bought and what you paid.', 'The pouch supplier’s ledger: Rs 12,000 bill, Rs 12,000 paid, balance nil.'],
    ['Statement', 'विवरण', 'A printable summary of a party’s ledger for a date range, given to them.', 'Hand Krishna Dairy a statement for Shrawan showing Rs 1,100 outstanding.'],
    ['Trial Balance', 'परीक्षण सन्तुलन', 'A list of all balances to check that total debits equal total credits.', 'Used at year end to prove the books balance before finalising.'],
    ['Profit & Loss', 'नाफा–नोक्सान विवरण', 'Income minus costs for a period. Answers: did we earn or lose?', 'Bhadra: income Rs 9,00,000 − costs Rs 8,50,000 = profit Rs 50,000.'],
    ['Balance Sheet', 'वासलात', 'What the business owns, what it owes, and the owner’s capital — on one date.', 'Cash Rs 42,300 + bank Rs 1,80,000 + stock Rs 1,34,970 + receivables − payables.'],
    ['Income / Revenue', 'आम्दानी', 'Money earned by selling goods or services — not money borrowed or received against a sale.', 'Selling 50 L of milk for Rs 3,100 is income. Collecting an old Rs 3,100 debt is not.'],
    ['Expense', 'खर्च', 'Money used up to run the business, with nothing of equal value kept.', 'Electricity Rs 8,500 is an expense. Buying a Rs 50,000 chiller is not — it is an asset.'],
    ['Asset', 'सम्पत्ति', 'Something the business owns that has value.', 'Cash, bank balance, stock, a chiller, money a customer owes you.'],
    ['Liability', 'दायित्व', 'Something the business owes to others.', 'Unpaid supplier bill, a bank loan, a farmer’s unpaid milk money.'],
    ['Equity / Capital', 'पुँजी', 'The owner’s share: what was invested plus profit kept in the business.', 'A partner puts Rs 5,00,000 into the dairy — that is capital, not income.'],
    ['Receivable', 'उठाउन बाँकी रकम', 'Money customers owe you.', 'Krishna Dairy owes Rs 1,100 after his part payment.'],
    ['Payable', 'तिर्न बाँकी रकम', 'Money you owe suppliers or farmers.', 'The pouch supplier is still owed Rs 12,000.'],
    ['Advance', 'अग्रिम रकम', 'Money paid or received before the goods or work. It is a balance, not an expense or income.', 'Rs 10,000 given to a farmer in advance is recovered from later milk payments.'],
    ['Loan Receivable', 'उठाउन बाँकी ऋण', 'A loan the business gave to someone else, to be collected back.', 'Rs 50,000 lent to a neighbouring dairy — it is an asset, not an expense.'],
    ['Loan Payable', 'तिर्न बाँकी ऋण', 'A loan the business took and must repay.', 'A Rs 5,00,000 bank loan. Repaying the principal is not an expense; only the interest is.'],
    ['Prepaid Expense', 'अग्रिम भुक्तानी गरिएको खर्च', 'A cost paid before it is used. It stays an asset until the period it belongs to.', 'A year’s insurance paid in one go is spread across the twelve months.'],
    ['Prepaid Rent', 'अग्रिम भुक्तानी घरभाडा', 'Rent paid in advance for future months.', 'Rs 9,10,000 paid for six months: one month is an expense each month, the rest stays an asset.'],
    ['Opening Balance', 'सुरुको मौज्दात', 'The balance at the start of the period — the previous closing balance.', 'Cash on 2083-04-01 is whatever the drawer held at the end of 2083-03-30.'],
    ['Closing Balance', 'अन्तिम मौज्दात', 'The balance at the end of the period, after all movements.', 'Closing stock on 2083-07-30 is what remains after the month’s sales and purchases.'],
    ['Cash Balance', 'नगद मौज्दात', 'Money physically in the drawer or box.', 'Counted notes and coins at the end of the day: Rs 42,300.'],
    ['Bank Balance', 'बैंक मौज्दात', 'Money in the bank account according to the books.', 'Deposits minus withdrawals, matched against the bank statement.'],
    ['Inventory / Stock', 'मौज्दात सामान', 'Goods you hold to sell or to use in production.', 'Paneer 120 kg, pouches 5,000, milk 40 L.'],
    ['Cost of Goods Sold', 'बिक्री भएका सामानको लागत', 'What the goods you actually sold cost you to buy or make.', 'Milk bought at Rs 58.40/L and sold at Rs 62/L: the Rs 58.40 is the cost of goods sold.'],
    ['Gross Profit', 'कुल नाफा', 'Sales minus the cost of the goods sold, before running costs.', 'Sales Rs 3,100 − milk cost Rs 2,920 = gross profit Rs 180.'],
    ['Net Profit / Loss', 'खुद नाफा / नोक्सान', 'What is left after every cost, including rent, salary, electricity and diesel.', 'Gross profit Rs 1,50,000 − running costs Rs 1,00,000 = net profit Rs 50,000.'],
    ['Operating Expenses', 'सञ्चालन खर्च', 'The day-to-day costs of running the business, other than the goods you sell.', 'Rent, salary, electricity, diesel, repairs, telephone, bank charges.'],
    ['Reconciliation', 'हिसाब मिलान', 'Comparing two records of the same thing and explaining the difference.', 'The ledger says Rs 43,100 cash, the count says Rs 42,300 — Rs 800 must be explained.'],
    ['Voucher', 'भौचर', 'The numbered slip or document that proves a transaction.', 'Petty cash voucher PC-221 for Rs 250 taxi fare.'],
    ['Debit / Credit', 'डेबिट / क्रेडिट', 'Two sides of every entry. Debit = value coming in or a cost; credit = value going out or money owed. For a customer, debit increases what they owe you; a payment to you is a credit.', 'A Rs 3,100 sale debits the customer (he owes more); his Rs 2,000 payment credits him (he owes less).'],
    ['Cash Denomination', 'नगदको दरअनुसार गणना', 'Counting notes and coins note by note.', '20 × Rs 500 + 15 × Rs 100 + 30 × Rs 10 = Rs 11,800.'],
    ['Depreciation', 'मूल्यह्रास', 'Spreading the cost of a long-lasting asset over the years it is used.', 'A Rs 3,00,000 chiller used for 10 years costs about Rs 30,000 a year.'],
    ['Journal Entry', 'जर्नल प्रविष्टि', 'A manual double entry made when no other screen fits the transaction.', 'Correcting a wrong party on a payment by moving the amount between two ledgers.'],
    ['Stock Adjustment', 'मौज्दात समायोजन', 'Correcting the stock figure after a physical count.', 'Register 120 kg, count 114 kg → 6 kg shortage recorded as an adjustment.'],
    ['Advance Recovery', 'अग्रिम असुली', 'Taking back an advance from a later payment.', 'Rs 2,000 of salary advance recovered from the month’s Rs 15,000 salary.'],
    ['Ageing', 'बाँकी अवधि विश्लेषण', 'Grouping outstanding amounts by how long they have been unpaid.', 'Receivables 0–30 days Rs 40,000, 30–60 days Rs 12,000, 60+ days Rs 4,000.'],
    ['Fiscal Year', 'आर्थिक वर्ष', 'The twelve-month accounting year used for reports and tax.', 'In Nepal the fiscal year runs Shrawan 1 to Ashadh end.'],
    ['Bank Reconciliation', 'बैंक मिलान', 'Matching the bank statement with your own records.', 'The statement shows Rs 12,000 paid; your books show the same payment — matched.'],
    ['Trial of Totals', 'जोड परीक्षण', 'Adding the columns of a report to confirm they agree with the registers.', 'Monthly Report → Reconciliation tab: each check compares the report with its source register.'],
    ['Working Capital', 'कार्यशील पुँजी', 'Money tied up in stock plus what customers owe, minus what you owe.', 'Stock Rs 1,34,970 + receivables Rs 39,64,247 − payables Rs 10,73,807.'],
    ['Cash Flow', 'नगद प्रवाह', 'Money actually moving in and out, regardless of profit.', 'A profitable month can still run out of cash if customers have not paid.'],
    ['Accrual', 'उपार्जन', 'Recording a cost or income in the period it belongs to, not when cash moves.', 'December’s electricity bill paid in January is a December cost.'],
    ['Write-off', 'राइट अफ', 'Accepting that an amount will never be recovered and removing it from the books.', 'A customer who disappeared owing Rs 500 — written off after approval.'],
    ['Contra Entry', 'आपसी लेनदेन', 'Moving money between two of your own accounts — never income or expense.', 'Rs 20,000 cash deposited into the bank is a contra entry.'],
    ['Sub-ledger', 'सहायक खाता', 'A detailed ledger behind one control account.', 'All the individual party ledgers together make up receivables.']
];

function umGlossaryHtml() {
    const rows = UM_GLOSSARY.map(([en, np, meaning, example]) => `
        <tr>
            <td style="font-weight:600;white-space:nowrap">${en}</td>
            <td style="white-space:nowrap;font-family:'Noto Sans Devanagari','Kalimati','Nirmala UI',sans-serif">${np}</td>
            <td>${meaning}</td>
            <td style="font-size:12px;color:#555">${example}</td>
        </tr>`).join('');
    return `
        <div id="um-glossary" style="background:var(--bg-white);border:1px solid var(--border);border-radius:12px;padding:24px 28px;margin-bottom:28px;overflow:auto">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <span style="font-size:24px">📘</span>
                <h2 style="font-size:18px;font-weight:700;margin:0">Accounting Words Explained — शब्दावली (English + नेपाली)</h2>
            </div>
            <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin:0 0 14px">
                Every accounting word used in this software, in simple English and नेपाली, with a dairy example.
                You do not need any accounting training to use these screens — this table is all the vocabulary you need.
            </p>
            <table class="data-table" style="font-size:12.5px;min-width:820px">
                <thead><tr><th>English</th><th>नेपाली</th><th>What it means in plain words</th><th>Dairy example</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// Make globally accessible
window.umGlossaryHtml = umGlossaryHtml;
window.umWhereToRecordHtml = umWhereToRecordHtml;
window.umModuleGuideHtml = umModuleGuideHtml;

// ============================================================
// Helper: Render a module card
// ============================================================
function renderModuleCard(id, icon, name, category, description, tips, feedsInto) {
    const categoryStyles = {
        daily: { bg: '#e3f2fd', border: '#1565c0', label: 'Daily', labelBg: '#1565c0' },
        occasional: { bg: '#fff3e0', border: '#e65100', label: 'Occasional', labelBg: '#e65100' },
        report: { bg: '#e8f5e9', border: '#2e7d32', label: 'Report', labelBg: '#2e7d32' },
        admin: { bg: '#f3e5f5', border: '#6a1b9a', label: 'Admin', labelBg: '#6a1b9a' }
    };
    const style = categoryStyles[category] || categoryStyles.daily;

    const tipsHtml = tips.map(t => `<li style="margin-bottom:4px;font-size:13px;line-height:1.5">✅ ${t}</li>`).join('');
    const feedsHtml = feedsInto.length > 0 
        ? feedsInto.map(f => `<span style="display:inline-block;padding:2px 8px;background:${style.bg};border-radius:4px;font-size:11px;color:${style.border};margin:2px">${f}</span>`).join('')
        : '<span style="font-size:12px;color:var(--text-light)">(configuration / standalone)</span>';

    return `
        <div id="um-module-${id}" style="background:var(--bg-white);border:1px solid var(--border);border-radius:10px;margin-bottom:12px;overflow:hidden;transition:all 0.2s" onmouseover="this.style.boxShadow='0 2px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
            <div style="display:flex;align-items:stretch;min-height:0">
                <div style="background:${style.bg};padding:18px 16px;display:flex;align-items:center;justify-content:center;font-size:28px;min-width:64px;border-right:1px solid var(--border)">
                    ${icon}
                </div>
                <div style="flex:1;padding:14px 18px">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                        <span style="font-size:15px;font-weight:700">${name}</span>
                        <span style="font-size:10px;font-weight:700;background:${style.labelBg};color:#fff;padding:2px 8px;border-radius:4px;text-transform:uppercase">${style.label}</span>
                    </div>
                    <p style="font-size:13px;color:var(--text-light);line-height:1.6;margin:0">${description}</p>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border-top:1px solid var(--border)">
                <div style="padding:12px 16px;background:var(--bg)">
                    <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);margin-bottom:6px;letter-spacing:0.3px">Best Practices</div>
                    <ul style="list-style:none;padding:0;margin:0">${tipsHtml}</ul>
                </div>
                <div style="padding:12px 16px;background:var(--bg)">
                    <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--text-light);margin-bottom:6px;letter-spacing:0.3px">Feeds Into</div>
                    <div style="display:flex;flex-wrap:wrap;gap:4px">${feedsHtml}</div>
                </div>
            </div>
        </div>
    `;
}

// Make globally accessible
window.renderUserManual = renderUserManual;
