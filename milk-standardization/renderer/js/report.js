/**
 * Milk Standardization Calculator — Standardization Report & CSV export
 * ============================================================
 * Produces a self-contained A4 report document (used for Electron
 * printToPDF / printing) and an equivalent HTML fragment for the in-browser
 * print flow.
 */
(function () {
    'use strict';

    var U = window.MilkUI;

    var CSS = [
        '@page { size: A4; margin: 12mm; }',
        '* { box-sizing: border-box; }',
        'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;',
        '  color: #1e2c27; font-size: 11px; line-height: 1.45; margin: 0; }',
        '.rpt { max-width: 100%; }',
        '.rpt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;',
        '  border-bottom: 3px solid #0f5132; padding-bottom: 10px; margin-bottom: 14px; }',
        '.rpt-head h1 { font-size: 17px; margin: 0 0 2px; color: #0f5132; letter-spacing: .2px; }',
        '.rpt-head .plant { font-size: 13px; font-weight: 700; }',
        '.rpt-head .meta { font-size: 10.5px; color: #556b63; margin-top: 2px; }',
        '.rpt-title { text-align: right; }',
        '.rpt-title .doc { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; color: #0f5132; }',
        '.rpt-title .stamp { font-size: 10.5px; color: #556b63; margin-top: 3px; }',
        '.badge { display: inline-block; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px;',
        '  text-transform: uppercase; letter-spacing: .06em; }',
        '.badge.pass { background: #e8f3ed; color: #0f5132; border: 1px solid #9dc4ad; }',
        '.badge.fail { background: #fdecec; color: #b02a37; border: 1px solid #eeb1b1; }',
        '.badge.neutral { background: #eef1ef; color: #556b63; border: 1px solid #cfdbd4; }',
        '.action { border: 1px solid #9dc4ad; background: #eef7f1; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px; }',
        '.action .k { font-size: 9.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .09em; color: #556b63; }',
        '.action .v { font-size: 16px; font-weight: 700; color: #0f5132; margin-top: 2px; }',
        '.action .n { font-size: 10.5px; color: #556b63; margin-top: 3px; }',
        '.action.warn { border-color: #e0c48f; background: #fdf7ea; }',
        '.action.warn .v { color: #8a5d0a; }',
        '.cols { display: flex; gap: 14px; margin-bottom: 12px; }',
        '.cols > div { flex: 1 1 0; min-width: 0; }',
        'h2 { font-size: 10.5px; text-transform: uppercase; letter-spacing: .09em; color: #0f5132;',
        '  margin: 0 0 6px; padding-bottom: 3px; border-bottom: 1px solid #dde5e0; }',
        'table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }',
        'th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e8eeea; vertical-align: top; }',
        'th { font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; color: #556b63; background: #f7faf8; }',
        'td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }',
        'table.kv td:first-child { color: #556b63; width: 56%; }',
        'table.kv td:last-child { font-weight: 600; text-align: right; white-space: nowrap; }',
        '.step td.f { font-family: "SF Mono", Consolas, monospace; font-size: 9.5px; color: #556b63; }',
        '.step td.v { font-family: "SF Mono", Consolas, monospace; font-weight: 700; color: #0f5132; text-align: right; white-space: nowrap; }',
        '.flags { margin: 0 0 12px; padding: 0; list-style: none; }',
        '.flags li { border-left: 3px solid #1d6fa5; background: #f2f8fb; padding: 5px 8px; margin-bottom: 5px; border-radius: 3px; }',
        '.flags li.danger { border-color: #b02a37; background: #fdecec; }',
        '.flags li.warning { border-color: #b7791f; background: #fdf7ea; }',
        '.flags b { display: block; }',
        '.notes { border: 1px solid #dde5e0; border-radius: 5px; padding: 7px 9px; min-height: 34px; margin-bottom: 12px; font-size: 10.5px; }',
        '.signs { display: flex; gap: 22px; margin-top: 22px; }',
        '.signs > div { flex: 1 1 0; }',
        '.signs .line { border-top: 1px solid #6b7c76; margin-top: 30px; padding-top: 3px; font-size: 9.5px; color: #556b63; }',
        '.rpt-foot { margin-top: 16px; border-top: 1px solid #dde5e0; padding-top: 6px; font-size: 9px; color: #6b7c76; }',
        '.rpt-foot p { margin: 0 0 2px; }',
        '@media print { tr, td, th { page-break-inside: avoid; } .rpt-head { page-break-after: avoid; } }'
    ].join('\n');

    function statusBadge(pass, enforced) {
        if (!enforced) return '<span class="badge neutral">Not checked</span>';
        return pass ? '<span class="badge pass">Compliant</span>' : '<span class="badge fail">Below minimum</span>';
    }

    function modeLabel(record) {
        return (record.calc && record.calc.mode && record.calc.mode.label) ||
            (record.mode && record.mode.label) || '—';
    }

    function filename(record, ext) {
        var ref = (record.batchRef || '').toString().trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
        var date = U.fmtDate(record.createdAt);
        return 'standardization-' + (ref ? ref + '-' : '') + date + '.' + ext;
    }

    /**
     * Report body as an HTML fragment.
     * @param {object} record  saved history record
     * @param {object} settings app settings
     */
    function buildFragment(record, settings) {
        var s = settings || {};
        var calc = record.calc || {};
        var main = calc.main || {};
        var snf = calc.snf || {};
        var inp = calc.inputs || {};
        var comp = calc.compliance || { checks: [] };
        var unit = calc.unit || record.unit || 'L';
        var d = Number.isFinite(s.decimals) ? s.decimals : 2;
        var warnings = calc.warnings || [];
        var steps = calc.steps || [];
        var checks = comp.checks || [];

        var html = [];

        html.push('<div class="rpt">');

        // ---- Header -------------------------------------------------
        html.push('<div class="rpt-head">');
        html.push('<div>');
        html.push('<div class="plant">' + U.esc(s.plantName || 'Dairy Plant') + '</div>');
        var contact = [];
        if (s.plantAddress) contact.push(U.esc(s.plantAddress));
        if (s.plantPhone) contact.push('Tel: ' + U.esc(s.plantPhone));
        if (s.plantLicense) contact.push('Licence: ' + U.esc(s.plantLicense));
        html.push('<div class="meta">' + (contact.join(' &nbsp;·&nbsp; ') || '&nbsp;') + '</div>');
        html.push('<h1>Standardization Report</h1>');
        html.push('</div>');
        html.push('<div class="rpt-title">');
        html.push('<div class="doc">Milk fat / SNF</div>');
        html.push('<div class="stamp">' + U.esc(U.fmtDateTime(record.createdAt)) + '</div>');
        html.push('<div class="stamp">' + statusBadge(comp.pass, comp.enforced) + '</div>');
        html.push('</div>');
        html.push('</div>');

        // ---- Action banner ------------------------------------------
        var bannerClass = (warnings.some(function (w) { return w.level === 'danger'; }) ? ' action warn' : ' action');
        html.push('<div class="' + bannerClass.trim() + '">');
        html.push('<div class="k">' + U.esc(main.streamLabel || 'Action') + '</div>');
        html.push('<div class="v">' + U.esc(U.fmt(main.streamQty, d) + ' ' + unit) + '</div>');
        html.push('<div class="n">' + U.esc(calc.summary || '') + '</div>');
        html.push('</div>');

        // ---- Batch details ------------------------------------------
        html.push('<div class="cols">');
        html.push('<div>');
        html.push('<h2>Batch details</h2>');
        html.push('<table class="kv"><tbody>');
        html.push(kv('Batch / lot reference', record.batchRef || '—'));
        html.push(kv('Supplier / collection centre', record.supplier || '—'));
        html.push(kv('Milk type', record.milkTypeLabel || record.milkType || '—'));
        html.push(kv('Calculation mode', modeLabel(record)));
        html.push(kv('Operator', record.operator || s.operator || '—'));
        html.push('</tbody></table>');
        html.push('</div>');

        html.push('<div>');
        html.push('<h2>Inputs</h2>');
        html.push('<table class="kv"><tbody>');
        html.push(kv('Raw milk quantity', U.fmt(inp.quantity, d) + ' ' + unit));
        html.push(kv('Initial fat', U.fmt(inp.fatInitial, d) + ' %'));
        html.push(kv('Initial SNF', U.fmt(inp.snfInitial, d) + ' %' +
            (inp.snfSource === 'clr' ? ' (from CLR ' + U.fmt(inp.clr, 1) + ')' : '')));
        html.push(kv('Target fat', U.fmt(inp.fatTarget, d) + ' %'));
        html.push(kv('Target SNF', inp.snfTarget === null || inp.snfTarget === undefined ? '— not set —' : U.fmt(inp.snfTarget, d) + ' %'));
        var modeId = record.modeId || (calc.mode && calc.mode.id) || '';
        if ((modeId === 'cream_separation' || modeId === 'cream_addition') && Number.isFinite(inp.creamFat)) {
            html.push(kv('Cream fat / SNF', U.fmt(inp.creamFat, d) + ' % / ' + U.fmt(inp.creamSnf, d) + ' %'));
        }
        if (modeId === 'skim_addition' && Number.isFinite(inp.skimFat)) {
            html.push(kv('Skim milk fat / SNF', U.fmt(inp.skimFat, d) + ' % / ' + U.fmt(inp.skimSnf, d) + ' %'));
        }
        if (modeId === 'water_addition') {
            html.push(kv('Diluent', 'Water — 0% fat, 0% SNF'));
        }
        if (Number.isFinite(inp.smpSnf)) {
            html.push(kv('SMP SNF content', U.fmt(inp.smpSnf, d) + ' %'));
        }
        html.push('</tbody></table>');
        html.push('</div>');
        html.push('</div>');

        // ---- Results -------------------------------------------------
        html.push('<h2>Result</h2>');
        html.push('<table class="kv"><tbody>');
        html.push(kv(main.removal ? 'Cream removed' : 'Added to the batch',
            U.fmt(main.streamQty, d) + ' ' + unit +
            (Number.isFinite(main.streamFat) ? ' @ ' + U.fmt(main.streamFat, d) + '% fat' : '')));
        html.push(kv('Quantity after fat adjustment', U.fmt(main.finalQty, d) + ' ' + unit));
        html.push(kv('Fat after adjustment', U.fmt(main.finalFat, d) + ' %'));
        html.push(kv('SNF after fat adjustment', U.fmt(main.finalSnf, d) + ' %'));
        if (Number.isFinite(main.yieldPct)) html.push(kv('Yield vs raw milk', U.fmt(main.yieldPct, 1) + ' %'));
        if (snf.needsReconstitution) {
            html.push(kv('SMP required for ' + U.fmt(snf.target, d) + '% SNF', U.fmt(snf.smpMass, d) + ' ' + unit));
            html.push(kv('Final quantity after reconstitution', U.fmt(snf.postSmpQty, d) + ' ' + unit));
            html.push(kv('Final SNF / fat after SMP',
                U.fmt(snf.postSmpSnf, d) + ' % / ' + U.fmt(snf.postSmpFat, d) + ' %'));
        } else if (snf.target !== null && snf.target !== undefined) {
            html.push(kv('SNF vs target', 'No SMP needed — ' + U.fmt(snf.afterMain, d) + '% against ' + U.fmt(snf.target, d) + '% target'));
        }
        html.push('</tbody></table>');

        // ---- Compliance ---------------------------------------------
        html.push('<h2>Compliance check</h2>');
        html.push('<table><thead><tr>');
        html.push('<th>Parameter</th><th class="num">Result</th><th class="num">Configured minimum</th><th>Status</th><th>Basis</th>');
        html.push('</tr></thead><tbody>');
        checks.forEach(function (check) {
            html.push('<tr>');
            html.push('<td>' + U.esc(check.name) + '</td>');
            html.push('<td class="num">' + U.esc(U.fmt(check.value, d)) + ' %</td>');
            html.push('<td class="num">' + (check.min === null || check.min === undefined ? '—' : U.esc(U.fmt(check.min, d)) + ' %') + '</td>');
            html.push('<td>' + statusBadge(check.pass, comp.enforced) + '</td>');
            html.push('<td>' + U.esc(check.note || '') + '</td>');
            html.push('</tr>');
        });
        html.push('</tbody></table>');

        // ---- Mass balance working -----------------------------------
        if (steps.length) {
            html.push('<h2>Mass-balance working</h2>');
            html.push('<table class="step"><thead><tr><th>Step</th><th>Formula &amp; substitution</th><th class="num">Value</th></tr></thead><tbody>');
            steps.forEach(function (step) {
                html.push('<tr>');
                html.push('<td>' + U.esc(step.label) + '</td>');
                html.push('<td class="f">' + U.esc(step.expr) + '<br>' + U.esc(step.subs) + '</td>');
                html.push('<td class="v">' + U.esc(step.value) + '</td>');
                html.push('</tr>');
            });
            html.push('</tbody></table>');
        }

        // ---- Flags / notes -------------------------------------------
        if (warnings.length) {
            html.push('<h2>Warnings</h2>');
            html.push('<ul class="flags">');
            warnings.forEach(function (warn) {
                var cls = warn.level === 'danger' ? 'danger' : (warn.level === 'warning' ? 'warning' : '');
                html.push('<li' + (cls ? ' class="' + cls + '"' : '') + '><b>' + U.esc(warn.title) + '</b>' +
                    U.esc(warn.text) + '</li>');
            });
            html.push('</ul>');
        }

        html.push('<h2>Remarks</h2>');
        html.push('<div class="notes">' + (U.esc(record.notes || '') || '&nbsp;') + '</div>');

        // ---- Signatures ----------------------------------------------
        html.push('<div class="signs">');
        html.push('<div><div class="line">Prepared by (operator)</div></div>');
        html.push('<div><div class="line">Checked by (quality)</div></div>');
        html.push('<div><div class="line">Approved by (plant manager)</div></div>');
        html.push('</div>');

        // ---- Footer ---------------------------------------------------
        html.push('<div class="rpt-foot">');
        if (s.reportNote) html.push('<p>' + U.esc(s.reportNote) + '</p>');
        html.push('<p>Generated by Milk Standardization Calculator v1.0.0 on ' + U.esc(U.fmtDateTime(new Date().toISOString())) + '.</p>');
        html.push('<p>Minimum fat and SNF limits shown are the values configured in this application, not a legal standard. ' +
            'Verify them against the regulation and milk class that apply to your region.</p>');
        html.push('</div>');

        html.push('</div>');
        return html.join('');
    }

    function kv(label, value) {
        return '<tr><td>' + U.esc(label) + '</td><td>' + U.esc(value) + '</td></tr>';
    }

    /** Complete standalone document — used for Electron printing and printToPDF. */
    function standaloneHtml(record, settings, title) {
        return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<title>' + U.esc(title || filename(record, 'pdf')) + '</title>' +
            '<style>' + CSS + '</style></head><body>' +
            buildFragment(record, settings) +
            '</body></html>';
    }

    // ============================================================
    // CSV export
    // ============================================================
    var CSV_HEADER = [
        'Date & time', 'Batch / lot', 'Supplier', 'Milk type', 'Mode', 'Unit',
        'Raw qty', 'Initial fat %', 'Initial SNF %', 'CLR', 'Target fat %', 'Target SNF %',
        'Cream fat %', 'Cream SNF %', 'Skim fat %', 'Skim SNF %', 'SMP SNF %',
        'Action', 'Qty adjusted', 'Qty after fat adjustment', 'Fat % after', 'SNF % after fat adjustment',
        'Yield %', 'SMP qty', 'Final qty after SMP', 'Final fat %', 'Final SNF %',
        'Min fat %', 'Min SNF %', 'Compliance', 'Operator', 'Notes'
    ];

    function csvRows(records, settings) {
        var d = Number.isFinite(settings && settings.decimals) ? settings.decimals : 2;
        var rows = [CSV_HEADER];
        (records || []).forEach(function (record) {
            var calc = record.calc || {};
            var inp = calc.inputs || {};
            var main = calc.main || {};
            var snf = calc.snf || {};
            var comp = calc.compliance || {};
            var finalSnf = snf.needsReconstitution ? snf.postSmpSnf : snf.afterMain;
            var finalFat = snf.needsReconstitution ? snf.postSmpFat : main.finalFat;
            rows.push([
                U.fmtDateTime(record.createdAt),
                record.batchRef || '',
                record.supplier || '',
                record.milkTypeLabel || record.milkType || '',
                modeLabel(record),
                calc.unit || record.unit || 'L',
                num(inp.quantity, d),
                num(inp.fatInitial, d),
                num(inp.snfInitial, d),
                inp.snfSource === 'clr' ? num(inp.clr, 1) : '',
                num(inp.fatTarget, d),
                inp.snfTarget === null || inp.snfTarget === undefined ? '' : num(inp.snfTarget, d),
                num(inp.creamFat, d),
                num(inp.creamSnf, d),
                num(inp.skimFat, d),
                num(inp.skimSnf, d),
                num(inp.smpSnf, d),
                main.actionText || '',
                num(main.streamQty, d),
                num(main.finalQty, d),
                num(main.finalFat, d),
                num(main.finalSnf, d),
                num(main.yieldPct, 1),
                snf.needsReconstitution ? num(snf.smpMass, d) : '',
                num(snf.postSmpQty, d),
                num(finalFat, d),
                num(finalSnf, d),
                num(comp.minFat, d),
                num(comp.minSnf, d),
                comp.enforced === false ? 'Not checked' : (comp.pass ? 'Compliant' : 'Below minimum'),
                record.operator || '',
                record.notes || ''
            ]);
        });
        return rows;
    }

    function num(value, decimals) {
        return Number.isFinite(value) ? U.fmt(value, decimals) : '';
    }

    window.MilkReport = {
        CSS: CSS,
        buildFragment: buildFragment,
        standaloneHtml: standaloneHtml,
        csvRows: csvRows,
        filename: filename,
        modeLabel: modeLabel
    };
})();
