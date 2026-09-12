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
