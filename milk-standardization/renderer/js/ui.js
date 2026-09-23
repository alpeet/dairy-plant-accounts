/**
 * Milk Standardization Calculator — UI helpers
 * ============================================================ */
(function () {
    'use strict';

    function $(id) { return document.getElementById(id); }

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function num(value, fallback) {
        var n = typeof value === 'number' ? value : parseFloat(String(value === null || value === undefined ? '' : value).replace(/,/g, '').trim());
        return Number.isFinite(n) ? n : (fallback === undefined ? NaN : fallback);
    }

    function round(value, decimals) {
        var d = Number.isFinite(decimals) ? decimals : 2;
        var f = Math.pow(10, d);
        return Math.round((value + Number.EPSILON) * f) / f;
    }

    /** Fixed-decimal number, or an em dash when the value is unusable. */
    function fmt(value, decimals) {
        if (!Number.isFinite(value)) return '—';
        var d = Number.isFinite(decimals) ? decimals : 2;
        return round(value, d).toFixed(d);
    }

    /** Grouped number for large quantities (1,240.50). */
    function fmtGrouped(value, decimals) {
        if (!Number.isFinite(value)) return '—';
        var d = Number.isFinite(decimals) ? decimals : 2;
        return round(value, d).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    function fmtDateTime(iso) {
        var date = iso ? new Date(iso) : new Date();
        if (isNaN(date.getTime())) return String(iso || '');
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var h = date.getHours();
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return date.getDate() + ' ' + months[date.getMonth()] + ' ' + date.getFullYear() + ', ' +
            String(h).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0') + ' ' + ampm;
    }

    function fmtDate(iso) {
        var date = iso ? new Date(iso) : new Date();
        if (isNaN(date.getTime())) return String(iso || '');
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function debounce(fn, wait) {
        var timer = null;
        return function () {
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(null, args); }, wait === undefined ? 120 : wait);
        };
    }

    // ------------------------------------------------------------
    // Toasts
    // ------------------------------------------------------------
    function toast(message, type) {
        var host = $('toasts');
        if (!host) return;
        var el = document.createElement('div');
        el.className = 'toast' + (type ? ' ' + type : '');
        el.textContent = message;
        host.appendChild(el);
        setTimeout(function () {
            el.style.transition = 'opacity .25s, transform .25s';
            el.style.opacity = '0';
            el.style.transform = 'translateX(16px)';
            setTimeout(function () { el.remove(); }, 260);
        }, type === 'error' ? 6000 : 3600);
    }

    // ------------------------------------------------------------
    // Confirmation modal
    // ------------------------------------------------------------
    var modalResolver = null;

    function confirmDialog(title, text, okLabel) {
        return new Promise(function (resolve) {
            modalResolver = resolve;
            $('modalTitle').textContent = title;
            $('modalText').textContent = text;
            $('modalOk').textContent = okLabel || 'Confirm';
            $('modal').classList.remove('hidden');
        });
    }

    function closeModal(result) {
        $('modal').classList.add('hidden');
        if (modalResolver) {
            var resolve = modalResolver;
            modalResolver = null;
            resolve(result);
        }
    }

    function initModal() {
        $('modalOk').addEventListener('click', function () { closeModal(true); });
        $('modalCancel').addEventListener('click', function () { closeModal(false); });
        $('modal').addEventListener('click', function (event) {
            if (event.target === $('modal')) closeModal(false);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !$('modal').classList.contains('hidden')) closeModal(false);
        });
    }

    // ------------------------------------------------------------
    // CSV
    // ------------------------------------------------------------
    function csvCell(value) {
        var text = value === null || value === undefined ? '' : String(value);
        if (/[",\n\r]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
        return text;
    }

    function toCsv(rows) {
        return rows.map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
    }

    window.MilkUI = {
        $: $,
        esc: esc,
        num: num,
        round: round,
        fmt: fmt,
        fmtGrouped: fmtGrouped,
        fmtDateTime: fmtDateTime,
        fmtDate: fmtDate,
        debounce: debounce,
        toast: toast,
        confirm: confirmDialog,
        initModal: initModal,
        toCsv: toCsv,
        csvCell: csvCell
    };
})();
