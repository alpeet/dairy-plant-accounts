/**
 * Milk Standardization Calculator — Batch history view
 * ============================================================
 * Every saved calculation with date/time, batch reference, compliance status,
 * on-screen report preview, printing, PDF and CSV export.
 */
(function () {
    'use strict';

    var U = window.MilkUI;
    var Report = window.MilkReport;

    var records = [];
    var settings = window.MilkDefaults.defaults();
    var filtered = [];

    // ============================================================
    // Filtering
    // ============================================================
    function applyFilters() {
        var term = U.$('histSearch').value.trim().toLowerCase();
        var milkType = U.$('histMilkType').value;
        var mode = U.$('histMode').value;
        var resultFilter = U.$('histResult').value;

        filtered = records.filter(function (record) {
            if (milkType && record.milkType !== milkType) return false;
            if (mode && record.modeId !== mode) return false;
            if (resultFilter) {
                var enforced = record.calc && record.calc.compliance ? record.calc.compliance.enforced !== false : true;
                var pass = record.calc && record.calc.compliance ? !!record.calc.compliance.pass : true;
                if (!enforced && resultFilter === 'fail') return false;
                if (resultFilter === 'pass' && !pass) return false;
                if (resultFilter === 'fail' && pass) return false;
            }
            if (term) {
                var haystack = [
                    record.batchRef, record.supplier, record.operator, record.notes,
                    record.milkTypeLabel, record.modeLabel, record.summary
                ].join(' ').toLowerCase();
                if (haystack.indexOf(term) === -1) return false;
            }
            return true;
        });
    }

    // ============================================================
    // Rendering
    // ============================================================
    function renderStats() {
        var d = settings.decimals;
        var compliant = 0;
        var failing = 0;
        var totalMilk = 0;
        var smpTotal = 0;
        var snfSum = 0;
        var snfCount = 0;

        filtered.forEach(function (record) {
            var calc = record.calc || {};
            var comp = calc.compliance || {};
            if (comp.enforced === false) {
                // not evaluated
            } else if (comp.pass) compliant++;
            else failing++;

            if (calc.inputs && Number.isFinite(calc.inputs.quantity)) totalMilk += calc.inputs.quantity;
            if (calc.snf && calc.snf.needsReconstitution) smpTotal += calc.snf.smpMass;
            var snfValue = calc.snf ? (calc.snf.needsReconstitution ? calc.snf.postSmpSnf : calc.snf.afterMain) : NaN;
            if (Number.isFinite(snfValue)) { snfSum += snfValue; snfCount++; }
        });

        var unit = filtered.length && filtered[0].calc ? (filtered[0].calc.unit || 'L') : 'L';

        var cards = [
            ['Batches shown', String(filtered.length) + (filtered.length !== records.length ? ' of ' + records.length : '')],
            ['Compliant', String(compliant)],
            ['Below minimum', String(failing)],
            ['Milk standardized', U.fmtGrouped(totalMilk, d) + ' ' + unit],
            ['SMP used', U.fmtGrouped(smpTotal, d) + ' ' + unit],
            ['Average final SNF', snfCount ? U.fmt(snfSum / snfCount, d) + ' %' : '—']
        ];

        U.$('histStats').innerHTML = cards.map(function (card) {
            return '<div class="stat"><div class="k">' + U.esc(card[0]) + '</div><div class="v">' + U.esc(card[1]) + '</div></div>';
        }).join('');
    }

    function statusCell(record) {
        var comp = (record.calc && record.calc.compliance) || {};
        if (comp.enforced === false) return '<span class="badge badge-neutral">Not checked</span>';
        return comp.pass
            ? '<span class="badge badge-pass">Pass</span>'
            : '<span class="badge badge-fail">Fail</span>';
    }

    function renderTable() {
        var d = settings.decimals;
        var body = U.$('histBody');
        U.$('histEmpty').classList.toggle('hidden', filtered.length > 0);

        body.innerHTML = filtered.map(function (record) {
            var calc = record.calc || {};
            var inp = calc.inputs || {};
            var main = calc.main || {};
            var snf = calc.snf || {};
            var unit = calc.unit || record.unit || 'L';
            var finalFat = snf.needsReconstitution ? snf.postSmpFat : main.finalFat;
            var finalSnf = snf.needsReconstitution ? snf.postSmpSnf : snf.afterMain;

            return '<tr data-id="' + U.esc(record.id) + '">' +
                '<td class="muted">' + U.esc(U.fmtDateTime(record.createdAt)) + '</td>' +
                '<td>' + (record.batchRef ? '<b>' + U.esc(record.batchRef) + '</b>' : '<span class="muted">—</span>') +
                (record.supplier ? '<br><span class="muted">' + U.esc(record.supplier) + '</span>' : '') + '</td>' +
                '<td>' + U.esc(record.milkTypeLabel || record.milkType || '—') + '</td>' +
                '<td>' + U.esc(record.modeLabel || (calc.mode ? calc.mode.short : '—')) + '</td>' +
                '<td class="num">' + U.fmt(inp.quantity, d) + ' ' + U.esc(unit) +
                '<br><span class="muted">' + U.fmt(inp.fatInitial, d) + '% fat · ' + U.fmt(inp.snfInitial, d) + '% SNF</span></td>' +
                '<td class="num">' + (main.removal ? '−' : '+') + U.fmt(main.streamQty, d) + ' ' + U.esc(unit) +
                '<br><span class="muted">' + U.esc((main.streamNoun || 'stream')) +
                (Number.isFinite(main.streamFat) ? ' ' + U.fmt(main.streamFat, d) + '%' : '') + '</span></td>' +
                '<td class="num">' + U.fmt(snf.needsReconstitution ? snf.postSmpQty : main.finalQty, d) + ' ' + U.esc(unit) +
                (snf.needsReconstitution ? '<br><span class="muted">+ ' + U.fmt(snf.smpMass, d) + ' SMP</span>' : '') + '</td>' +
                '<td class="num">' + U.fmt(finalFat, d) + '<br><span class="muted">' + U.fmt(finalSnf, d) + '% SNF</span></td>' +
                '<td>' + statusCell(record) + '</td>' +
                '<td class="actions-col"><div class="row-actions">' +
                '<button class="btn btn-sm" data-act="report">Report</button>' +
                '<button class="btn btn-sm" data-act="print">Print</button>' +
                '<button class="btn btn-sm" data-act="pdf">PDF</button>' +
                '<button class="btn btn-sm btn-danger-ghost" data-act="delete">Delete</button>' +
                '</div></td>' +
                '</tr>';
        }).join('');
    }

    function render() {
        applyFilters();
        renderStats();
        renderTable();
    }

    // ============================================================
    // Report preview modal
    // ============================================================
    var previewRecord = null;

    function viewReport(record) {
        previewRecord = record;
        U.$('reportModalTitle').textContent = 'Standardization Report — ' +
            (record.batchRef || U.fmtDateTime(record.createdAt));
        U.$('reportBody').innerHTML = '<style>' + Report.CSS + '</style>' +
            '<div class="report-sheet">' + Report.buildFragment(record, settings) + '</div>';
        U.$('reportModal').classList.remove('hidden');
    }

    function closeReport() {
        U.$('reportModal').classList.add('hidden');
        U.$('reportBody').innerHTML = '';
        previewRecord = null;
    }

    function printRecord(record) {
        if (window.MilkApi.canWritePdf) {
            return window.MilkApi.printHtml({ html: Report.standaloneHtml(record, settings) });
        }
        return window.MilkApi.printHtml({ fragment: Report.buildFragment(record, settings), css: Report.CSS });
    }

    function pdfRecord(record) {
        return window.MilkApi.savePdf({
            html: Report.standaloneHtml(record, settings),
            fragment: Report.buildFragment(record, settings),
            css: Report.CSS,
            defaultName: Report.filename(record, 'pdf')
        });
    }

    // ============================================================
    // Data actions
    // ============================================================
    function exportCsv() {
        if (!filtered.length) {
            U.toast('Nothing to export yet.', 'warn');
            return;
        }
        var csv = U.toCsv(Report.csvRows(filtered, settings));
        window.MilkApi.saveTextFile({
            defaultName: 'milk-standardization-history-' + U.fmtDate(new Date().toISOString()) + '.csv',
            content: csv,
            mime: 'text/csv;charset=utf-8',
            filters: [{ name: 'CSV file', extensions: ['csv'] }]
        }).then(function (res) {
            if (res && res.ok) U.toast('CSV exported' + (res.path ? ': ' + res.path : '.'));
            else if (res && res.error) U.toast('Export failed: ' + res.error, 'error');
        });
    }

    function backup() {
        window.MilkApi.backup().then(function (res) {
            if (res && res.ok) U.toast('Backup written' + (res.path ? ': ' + res.path : '.'));
            else if (res && res.error) U.toast('Backup failed: ' + res.error, 'error');
        });
    }

    function restore() {
        U.confirm('Restore from backup?',
            'Your current settings and batch history will be replaced by the contents of the backup file.', 'Restore').then(function (ok) {
            if (!ok) return;
            return window.MilkApi.restore({}).then(function (res) {
                if (!res || !res.ok) {
                    if (res && res.error) U.toast(res.error, 'error');
                    return;
                }
                U.toast('Backup restored.');
                if (window.MilkApp) window.MilkApp.reloadAll();
            });
        });
    }

    function clearHistory() {
        if (!records.length) {
            U.toast('History is already empty.', 'warn');
            return;
        }
        U.confirm('Clear all history?',
            'This removes all ' + records.length + ' saved batches from this device. A timestamped backup of the data file is kept next to it.', 'Clear history')
            .then(function (ok) {
                if (!ok) return;
                return Promise.resolve(window.MilkApi.clearHistory()).then(function () {
                    U.toast('Batch history cleared.');
                    refresh();
                });
            });
    }

    function deleteRecord(record) {
        U.confirm('Delete this batch?',
            (record.batchRef ? 'Batch "' + record.batchRef + '"' : 'This batch') + ' from ' +
            U.fmtDateTime(record.createdAt) + ' will be removed.', 'Delete').then(function (ok) {
            if (!ok) return;
            return Promise.resolve(window.MilkApi.deleteHistory(record.id)).then(function () {
                U.toast('Batch deleted.');
                refresh();
            });
        });
    }

    // ============================================================
    // Events & lifecycle
    // ============================================================
    function onTableClick(event) {
        var button = event.target.closest('button[data-act]');
        if (!button) return;
        var id = button.closest('tr').dataset.id;
        var record = records.find(function (r) { return r.id === id; });
        if (!record) return;

        var act = button.dataset.act;
        if (act === 'report') viewReport(record);
        else if (act === 'print') printRecord(record).then(function (res) {
            if (res && res.error) U.toast('Printing failed: ' + res.error, 'error');
        });
        else if (act === 'pdf') pdfRecord(record).then(function (res) {
            if (res && res.ok && res.path && !res.printed) U.toast('PDF saved: ' + res.path);
            else if (res && res.ok && res.hint) U.toast(res.hint);
            else if (res && res.error) U.toast('Export failed: ' + res.error, 'error');
        });
        else if (act === 'delete') deleteRecord(record);
    }

    function refresh() {
        return Promise.resolve(window.MilkApi.listHistory()).then(function (list) {
            records = Array.isArray(list) ? list : [];
            render();
            return records;
        }).catch(function (err) {
            U.toast('Could not load history: ' + (err && err.message ? err.message : err), 'error');
            return [];
        });
    }

    function init(initialSettings) {
        settings = initialSettings;
        ['histSearch', 'histMilkType', 'histMode', 'histResult'].forEach(function (id) {
            var el = U.$(id);
            if (!el) return;
            el.addEventListener('input', U.debounce(render, 120));
            el.addEventListener('change', render);
        });

        U.$('histBody').addEventListener('click', onTableClick);
        U.$('btnExportCsv').addEventListener('click', exportCsv);
        U.$('btnBackup').addEventListener('click', backup);
        U.$('btnRestore').addEventListener('click', restore);
        U.$('btnClearHistory').addEventListener('click', clearHistory);

        U.$('reportClose').addEventListener('click', closeReport);
        U.$('reportPrint').addEventListener('click', function () {
            if (previewRecord) printRecord(previewRecord);
        });
        U.$('reportPdf').addEventListener('click', function () {
            if (previewRecord) pdfRecord(previewRecord).then(function (res) {
                if (res && res.ok && res.path && !res.printed) U.toast('PDF saved: ' + res.path);
                else if (res && res.ok && res.hint) U.toast(res.hint);
            });
        });
        U.$('reportModal').addEventListener('click', function (event) {
            if (event.target === U.$('reportModal')) closeReport();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !U.$('reportModal').classList.contains('hidden')) closeReport();
        });

        return refresh();
    }

    function setSettings(next) {
        settings = next;
        render();
    }

    window.MilkHistory = {
        init: init,
        refresh: refresh,
        render: render,
        setSettings: setSettings,
        count: function () { return records.length; }
    };
})();
