/**
 * Utility functions for Godhuli Dairy Plant
 */

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, type = 'success', duration = 4000) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
        <span class="toast-msg">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);
}

// ============================================================
// Currency Formatting
// ============================================================
function formatCurrency(amount) {
    const num = parseFloat(amount) || 0;
    try {
        return 'रु ' + num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
        return 'रु ' + num.toFixed(2);
    }
}

function formatNumber(num) {
    const n = parseFloat(num || 0);
    try {
        return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch (e) {
        return n.toFixed(2);
    }
}

// ============================================================
// Safe Date Parsing (cross-browser)
// Firefox treats YYYY-MM-DD as UTC, Chrome as local time.
// This function ensures consistent parsing across browsers.
// ============================================================
function parseDateSafe(dateStr) {
    if (!dateStr) return null;
    // If it's a YYYY-MM-DD format, parse parts manually to avoid timezone issues
    const parts = dateStr.split('-');
    if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // 0-indexed
        const day = parseInt(parts[2], 10);
        if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            return new Date(year, month, day);
        }
    }
    // Fallback for other formats
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

// ============================================================
// Date Helpers
// ============================================================
function today() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = parseDateSafe(dateStr);
    if (!d) return dateStr;
    try {
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (e) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
    }
}

function getMonthName(dateStr) {
    // dateStr is YYYY-MM from DB, append '-01' then parse safely
    const d = parseDateSafe(dateStr + '-01');
    if (!d) return dateStr;
    try {
        return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    } catch (e) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(-2)}`;
    }
}

// ============================================================
// Modal Helpers
// ============================================================
function showModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('show');
    // Prevent body scrolling when modal is open
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    document.body.style.overflow = '';
}

// Close modal on overlay click
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });
    }
});

// ============================================================
// Confirm Dialog
// ============================================================
function confirmAction(message, detail = '', okLabel = 'Yes, Delete', cancelLabel = 'Cancel') {
    return new Promise((resolve) => {
        showModal(`
            <div class="confirm-dialog">
                <div class="modal-header">
                    <h2>Confirm</h2>
                    <button class="close-btn" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="confirm-msg">${message}</div>
                    ${detail ? `<div class="confirm-detail">${detail}</div>` : ''}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal(); resolvePromise(false)">${cancelLabel}</button>
                    <button class="btn btn-danger" onclick="closeModal(); resolvePromise(true)">${okLabel}</button>
                </div>
            </div>
        `);
        window._confirmResolve = resolve;
    });
}

function resolvePromise(value) {
    if (window._confirmResolve) {
        window._confirmResolve(value);
        window._confirmResolve = null;
    }
}

// ============================================================
// Escape HTML for safe insertion into HTML attributes and content
// ============================================================
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ============================================================
// Form Helpers
// ============================================================
function getFormData(formId) {
    const form = document.getElementById(formId);
    if (!form) return {};
    const data = {};
    const elements = form.querySelectorAll('[name]');
    elements.forEach(el => {
        data[el.name] = el.value;
    });
    return data;
}

function setFormData(formId, data) {
    const form = document.getElementById(formId);
    if (!form) return;
    Object.keys(data).forEach(key => {
        const el = form.querySelector(`[name="${key}"]`);
        if (el) el.value = data[key] || '';
    });
}

// ============================================================
// Status Badge HTML
// ============================================================
function statusBadge(status) {
    const map = {
        'paid': '<span class="badge badge-paid">Paid</span>',
        'unpaid': '<span class="badge badge-unpaid">Unpaid</span>',
        'partial': '<span class="badge badge-partial">Partial</span>',
        'cash': '<span class="badge badge-info">Cash</span>',
        'credit': '<span class="badge badge-warning">Credit</span>',
        'bank': '<span class="badge badge-info">Bank</span>',
        'upi': '<span class="badge badge-info">UPI</span>'
    };
    return map[status] || escapeHtml(status);
}

// ============================================================
// Shared Print CSS - single source of truth for all print/PDF output
// ============================================================
const PRINT_CSS = `
    @page { margin: 15mm 12mm 20mm 12mm; size: A4; @bottom-right { content: "Page " counter(page); font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 7.5pt; color: #888; } }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #222; line-height: 1.55; margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { text-align: center; margin-bottom: 18px; border-bottom: 3px double #1a5276; padding-bottom: 12px; }
    .header h1 { font-size: 22pt; margin: 0; color: #1a5276; font-weight: 700; letter-spacing: 0.5px; }
    .header h2 { font-size: 13pt; margin: 6px 0 2px; color: #333; font-weight: 600; }
    .header p { font-size: 8.5pt; color: #666; margin: 2px 0; }
    .header .business-detail { font-size: 8pt; color: #888; margin-top: 4px; }
    .stats-bar { display: flex; gap: 16px; margin: 10px 0 14px; padding: 8px 12px; background: #f0f4f8; border: 1px solid #d0d8e0; border-radius: 4px; font-size: 9pt; }
    .stats-bar .stat-item { flex: 1; text-align: center; }
    .stats-bar .stat-item .stat-label { font-size: 7.5pt; text-transform: uppercase; color: #666; letter-spacing: 0.3px; }
    .stats-bar .stat-item .stat-value { font-size: 10pt; font-weight: 700; color: #1a5276; font-family: 'Consolas','Courier New',monospace; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; page-break-inside: auto; font-size: 9pt; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { padding: 5px 8px; text-align: left; border: 1px solid #bbb; vertical-align: middle; }
    th { background: #1a5276 !important; color: white !important; font-weight: 600; text-transform: uppercase; letter-spacing: 0.4px; font-size: 7.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    td { font-size: 8.5pt; }
    tbody tr:nth-child(even) { background: #f5f7fa; }
    tfoot td { background: #e8edf2 !important; font-weight: 600; border-top: 2px solid #bbb; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .text-right { text-align: right; font-family: 'Consolas','Courier New',monospace; }
    .text-center { text-align: center; }
    .summary { margin: 14px 0; padding: 10px 14px; background: #f5f5f5; border: 1px solid #ccc; border-radius: 3px; font-size: 9pt; }
    .summary-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 9pt; }
    .summary-row.total { font-weight: 700; font-size: 10pt; border-top: 2px solid #999; padding-top: 6px; margin-top: 4px; }
    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; margin: 10px 0; padding: 10px 12px; background: #fafafa; border: 1px solid #ddd; border-radius: 3px; }
    .detail-grid .detail-item { display: flex; gap: 6px; font-size: 9pt; }
    .detail-grid .detail-item .detail-label { color: #666; min-width: 90px; }
    .detail-grid .detail-item .detail-value { font-weight: 600; color: #333; }
    .value-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 10px 0; }
    .value-card { padding: 10px 12px; background: #f5f7fa; border: 1px solid #d0d8e0; border-radius: 3px; text-align: center; }
    .value-card .value-label { font-size: 7.5pt; text-transform: uppercase; color: #666; letter-spacing: 0.3px; }
    .value-card .value-number { font-size: 14pt; font-weight: 700; color: #1a5276; font-family: 'Consolas','Courier New',monospace; margin-top: 4px; }
    .value-card .value-sub { font-size: 7.5pt; color: #888; margin-top: 2px; }
    .status-paid { color: #155724; font-weight: 600; }
    .status-unpaid { color: #721c24; font-weight: 700; }
    .status-partial { color: #856404; font-weight: 600; }
    .footer { margin-top: 40px; padding-top: 10px; display: flex; justify-content: space-between; font-size: 7.5pt; color: #888; border-top: 1px solid #ccc; }
    .footer .signature { border-top: 1px solid #222; padding-top: 4px; min-width: 160px; text-align: center; font-size: 8.5pt; color: #333; }
    .notes-section { margin-top: 12px; padding: 8px 10px; border-left: 3px solid #1a5276; font-size: 8.5pt; color: #555; background: #fafafa; }
    .section-title { font-size: 11pt; font-weight: 700; color: #1a5276; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
    .section-title:first-of-type { margin-top: 0; }
    .page-break { page-break-before: always; }
    .no-break { page-break-inside: avoid; }
    table.compact th, table.compact td { padding: 3px 6px; font-size: 7.5pt; }
`;

// Make it accessible via window for other modules (e.g. api.js printToPDF)
window.PRINT_CSS = PRINT_CSS;

// ============================================================
// Print helper - opens print dialog for a given HTML template
// ============================================================
function getPaperSize() {
    try {
        if (typeof _settingsCache !== 'undefined' && _settingsCache && _settingsCache.paper_size) {
            return _settingsCache.paper_size;
        }
    } catch(e) {}
    return 'A4';
}

async function printHTML(html) {
    let paperSize = getPaperSize();
    // Try to get fresh settings if cache is empty
    if (paperSize === 'A4' && typeof getSettingsCached === 'function') {
        try {
            const settings = await getSettingsCached();
            if (settings && settings.paper_size) paperSize = settings.paper_size;
        } catch(e) {}
    }

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
        showToast('Please allow pop-ups for printing', 'error');
        return;
    }
    printWindow.document.write('<html><head><title>Print</title>');
    printWindow.document.write('<style>');
    printWindow.document.write(PRINT_CSS);
    printWindow.document.write(`@page { size: ${paperSize}; }`);
    printWindow.document.write('</style></head><body>');
    printWindow.document.write(html);
    printWindow.document.write('</body></html>');
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 500);
}

// ============================================================
// Generate Invoice Number
// ============================================================
function generateInvoiceNo() {
    const prefix = 'INV';
    const date = new Date();
    const y = date.getFullYear().toString().slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `${prefix}-${y}${m}${d}-${rand}`;
}

function generateBillNo() {
    const prefix = 'BILL';
    const date = new Date();
    const y = date.getFullYear().toString().slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return `${prefix}-${y}${m}${d}-${rand}`;
}

// ============================================================
// Local date string (YYYY-MM-DD) from a Date object, avoids toISOString UTC issues
// ============================================================
function toLocalDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ============================================================
// Date presets for reports
// ============================================================
function getDatePreset(preset) {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();

    switch (preset) {
        case 'today':
            return { from: toLocalDateString(today), to: toLocalDateString(today) };
        case 'this_week': {
            const start = new Date(today);
            start.setDate(today.getDate() - today.getDay());
            return { from: toLocalDateString(start), to: toLocalDateString(today) };
        }
        case 'this_month':
            return { from: `${y}-${String(m + 1).padStart(2, '0')}-01`, to: toLocalDateString(today) };
        case 'last_month': {
            const firstDay = new Date(y, m - 1, 1);
            const lastDay = new Date(y, m, 0);
            return { from: toLocalDateString(firstDay), to: toLocalDateString(lastDay) };
        }
        case 'this_year':
            return { from: `${y}-01-01`, to: toLocalDateString(today) };
        case 'last_30':
            const s = new Date(today);
            s.setDate(s.getDate() - 30);
            return { from: toLocalDateString(s), to: toLocalDateString(today) };
        default:
            return { from: '', to: toLocalDateString(today) };
    }
}
