/**
 * Godhuli Dairy Plant — User Manual
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
                        <h1 style="font-size:22px;font-weight:700;margin:0">Godhuli Dairy Plant — User Manual</h1>
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

            <!-- Footer -->
            <div style="text-align:center;padding:20px;color:var(--text-light);font-size:12px">
                Godhuli Dairy Plant v${appVersion} &middot; User Manual &middot; Generated from the app
            </div>
        </div>
    `;
}

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
