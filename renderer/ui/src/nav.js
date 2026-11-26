/**
 * Sidebar module map — a 1:1 copy of the navigation that already lives in
 * renderer/index.html (same pages, same labels, same data-min-role gates).
 * Nothing is added, renamed or removed; the React sidebar renders exactly the
 * modules the app already ships.
 */

export const NAV_GROUPS = [
    {
        id: 'overview',
        label: 'Overview',
        items: [
            { page: 'dashboard', label: 'Dashboard', icon: 'LayoutDashboard', role: 'staff' }
        ]
    },
    {
        id: 'daily-entry',
        label: 'Daily Entry',
        items: [
            { page: 'sales', label: 'Sales', icon: 'Receipt', role: 'staff' },
            { page: 'invoice-generator', label: 'Invoice Generation', icon: 'FileText', role: 'staff' },
            { page: 'purchases', label: 'Purchases', icon: 'PackageSearch', role: 'staff' },
            { page: 'milk', label: 'Milk Collection', icon: 'Milk', role: 'agent' },
            { page: 'bulk-entry', label: 'Bulk Entry', icon: 'Zap', role: 'agent' },
            { page: 'cash-collection', label: 'Payment Collection', icon: 'HandCoins', role: 'operator' },
            { page: 'payment-collection', label: 'Payment Register', icon: 'CreditCard', role: 'operator' }
        ]
    },
    {
        id: 'production',
        label: 'Milk Processing',
        items: [
            { page: 'production', label: 'Production', icon: 'Factory', role: 'staff' },
            { page: 'dairy-costing', label: 'Dairy Costing', icon: 'Calculator', role: 'staff' },
            { page: 'production-setup', label: 'Production Setup', icon: 'Settings2', role: 'staff' }
        ]
    },
    {
        id: 'stock',
        label: 'Stock & Products',
        items: [
            { page: 'stock', label: 'Stock', icon: 'Boxes', role: 'staff' },
            { page: 'stock-statement', label: 'Stock Statement', icon: 'ClipboardList', role: 'staff' }
        ]
    },
    {
        id: 'masters',
        label: 'Parties & Masters',
        items: [
            { page: 'parties', label: 'Parties', icon: 'Users', role: 'staff' },
            { page: 'routes', label: 'Routes', icon: 'Route', role: 'operator' },
            { page: 'rate-charts', label: 'Milk Rate Charts', icon: 'LineChart', role: 'operator' },
            { page: 'employees', label: 'Employees', icon: 'UserCog', role: 'operator' }
        ]
    },
    {
        id: 'expenses-payroll',
        label: 'Expenses & Payroll',
        items: [
            { page: 'expenses', label: 'Other Expenses', icon: 'ReceiptText', role: 'operator' },
            { page: 'petty-cash', label: 'Petty Cash', icon: 'Wallet', role: 'operator' },
            { page: 'salary', label: 'Salary', icon: 'Banknote', role: 'operator' },
            { page: 'vehicle', label: 'Vehicle Expenses', icon: 'Truck', role: 'operator' }
        ]
    },
    {
        id: 'cash-bank',
        label: 'Cash & Bank',
        items: [
            { page: 'cash', label: 'Cash & Denomination', icon: 'Coins', role: 'operator' },
            { page: 'cash-deposit', label: 'Cash Deposit', icon: 'Landmark', role: 'operator' },
            { page: 'bank', label: 'Bank Transactions', icon: 'Building2', role: 'operator' },
            { page: 'pdc', label: 'Cheque Register (PDC)', icon: 'ScrollText', role: 'operator' }
        ]
    },
    {
        id: 'ledgers',
        label: 'Ledgers & Balances',
        items: [
            { page: 'company-ledger', label: 'Company Ledger', icon: 'BookOpen', role: 'operator' },
            { page: 'daybook', label: 'Daybook', icon: 'CalendarDays', role: 'operator' },
            { page: 'receivable-payable', label: 'Receivable / Payable', icon: 'Scale', role: 'operator' },
            { page: 'farmer-payments', label: 'Farmer Payments', icon: 'Sprout', role: 'operator' },
            { page: 'advances', label: 'Advances', icon: 'Hourglass', role: 'operator' },
            { page: 'partner-capital', label: 'Partner Capital', icon: 'Handshake', role: 'accountant' }
        ]
    },
    {
        id: 'reports',
        label: 'Reports & Statements',
        items: [
            { page: 'reports', label: 'Reports', icon: 'BarChart3', role: 'staff' },
            { page: 'statements', label: 'Statements', icon: 'FileSpreadsheet', role: 'operator' },
            { page: 'profit-loss', label: 'Profit & Loss', icon: 'TrendingUp', role: 'operator' },
            { page: 'management-reports', label: 'Board & Management', icon: 'Presentation', role: 'operator' },
            { page: 'monthly-report', label: 'Monthly Report', icon: 'CalendarRange', role: 'operator' }
        ]
    },
    {
        id: 'admin',
        label: 'Administration',
        items: [
            { page: 'settings', label: 'Settings', icon: 'Settings', role: 'admin' },
            { page: 'db-tables', label: 'DB Tables', icon: 'Database', role: 'staff' },
            { page: 'integrity', label: 'Data Integrity', icon: 'Stethoscope', role: 'accountant' },
            { page: 'audit-log', label: 'Audit Log', icon: 'History', role: 'accountant' }
        ]
    },
    {
        id: 'help',
        label: 'Help',
        items: [
            { page: 'user-manual', label: 'User Manual & Glossary', icon: 'LifeBuoy', role: 'staff' }
        ]
    }
];

export const ROLE_HIERARCHY = {
    agent: 0,
    staff: 1,
    operator: 2,
    accountant: 3,
    admin: 4
};
