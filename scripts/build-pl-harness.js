/**
 * Builds pl-harness.html — the real financial_reports.js inlined with stub
 * API responses, so the Profit & Loss page can be exercised in a browser preview
 * without a running server.
 */
const fs = require('fs');

const apiStub = `
window.api = {
  getProfitLoss: async (opts) => {
    // Two canned datasets so we can prove the custom-date bug is fixed:
    // 'this month' (default) vs a different range requested via applyProfitLoss.
    const thisMonth = {
      from_date: '2083-05-01', to_date: '2083-05-32',
      income: { total_sales: 1028098.935, total_receipts: 1004580, total_other_income: 0, total_income: 1028098.935 },
      expenses: { milk_collection: { total: 0, count: 0 }, purchases: { total: 0, count: 0 },
        other_expenses: { total: 0, count: 0 }, petty_cash: { total: 0, count: 0 },
        salary: { total: 0, count: 0 }, vehicle_expenses: { total: 0, count: 0 },
        cash_payments: { total: 0, count: 0 }, total_expenses: 0 },
      cogs: 0, operating_expenses: 0, gross_profit: 1028098.935, net_profit: 1028098.935,
      sales_count: 464, milk_collection_count: 0
    };
    const lastMonth = {
      from_date: '2083-04-01', to_date: '2083-04-32',
      income: { total_sales: 1219802.245, total_receipts: 1072160, total_other_income: 0, total_income: 1219802.245 },
      expenses: { milk_collection: { total: 0, count: 0 }, purchases: { total: 1672896.55, count: 72 },
        other_expenses: { total: 0, count: 0 }, petty_cash: { total: 0, count: 0 },
        salary: { total: 0, count: 0 }, vehicle_expenses: { total: 0, count: 0 },
        cash_payments: { total: 0, count: 0 }, total_expenses: 1672896.55 },
      cogs: 1672896.55, operating_expenses: 0, gross_profit: -453094.31, net_profit: -453094.31,
      sales_count: 551, milk_collection_count: 0
    };
    window.__lastQuery = opts;
    if (opts.from_date === '2083-05-01') return { success: true, data: thisMonth };
    return { success: true, data: lastMonth };
  },
  getProfitLossByMonth: async (opts) => {
    window.__lastMonthlyQuery = opts;
    const allMonths = [
        { ym: '2083-03', label: '2083-03 (Ashadh)', sales: 1173723, sales_count: 339, other_income: 0, total_income: 1173723, cogs: 1246319, gross_profit: -72596, operating_expenses: 28415, total_expenses: 1274734, net_profit: -101010, receipts: 475140, receipts_count: 206 },
        { ym: '2083-04', label: '2083-04 (Shrawan)', sales: 1219802, sales_count: 551, other_income: 0, total_income: 1219802, cogs: 1672897, gross_profit: -453094, operating_expenses: 97345, total_expenses: 1770242, net_profit: -550439, receipts: 1072160, receipts_count: 369 },
        { ym: '2083-05', label: '2083-05 (Bhadra)', sales: 1028099, sales_count: 464, other_income: 0, total_income: 1028099, cogs: 0, gross_profit: 1028099, operating_expenses: 350185, total_expenses: 350185, net_profit: 677914, receipts: 1004580, receipts_count: 309 }
    ];
    const months = allMonths.filter(m => m.ym >= String(opts.from_date || '').slice(0, 7) && m.ym <= String(opts.to_date || '').slice(0, 7));
    const sum = (k) => Math.round(months.reduce((s, m) => s + m[k], 0) * 100) / 100;
    return { success: true, data: {
      from_date: opts.from_date, to_date: opts.to_date,
      months,
      totals: {
        sales: sum('sales'), sales_count: months.reduce((s, m) => s + m.sales_count, 0),
        other_income: sum('other_income'), total_income: sum('total_income'),
        cogs: sum('cogs'), gross_profit: sum('gross_profit'),
        operating_expenses: sum('operating_expenses'), total_expenses: sum('total_expenses'),
        net_profit: sum('net_profit'), receipts: sum('receipts'),
        receipts_count: months.reduce((s, m) => s + m.receipts_count, 0)
      }
    } };
  },
  getReceivables: async () => ({ success: true, data: [] }),
  getPayables: async () => ({ success: true, data: [] }),
  getDayBook: async () => ({ success: true, data: { entries: [], from_date: '', to_date: '' } }),
  getDailyCashCollection: async () => ({ success: true, data: {} }),
  getPayments: async () => ({ success: true, data: [] })
};
`;

const stubs = `
function getDatePreset(p) {
  return { from: '2083-05-01', to: '2083-05-32' };
}
function formatCurrency(n) {
  const num = Number(n || 0);
  return 'Rs ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(s) { return String(s == null ? '' : s); }
function showToast(msg, type) { window.__toasts = window.__toasts || []; window.__toasts.push({ msg, type }); }
async function getSettingsCached() { return { business_name: 'Test Dairy' }; }
function printHTML(html) { window.__printHTML = html; }
`;

const fr = fs.readFileSync('renderer/js/financial_reports.js', 'utf8');

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>P&L Harness</title></head>
<body>
  <div id="page-profit-loss"></div>
  <div id="topActions"></div>
  <script>${apiStub}\n${stubs}\n${fr}\n
  window.__ready = 'ok';\n</script>
</body></html>`;

fs.writeFileSync('pl-harness.html', html);
console.log('Harness written to pl-harness.html (' + Math.round(html.length / 1024) + ' KB)');
