/**
 * Milk Standardization Calculator — Tools view
 * ============================================================
 * Richmond's formula in both directions, plus lactometer (LR) ↔ CLR.
 */
(function () {
    'use strict';

    var U = window.MilkUI;
    var Calc = window.MilkCalc;

    function forward() {
        var fat = U.num(U.$('toolFat').value, NaN);
        var clr = U.num(U.$('toolClr').value, NaN);
        var out = U.$('toolSnfOut');

        if (!Number.isFinite(clr)) clr = NaN;
        if (!Number.isFinite(fat) || !Number.isFinite(clr)) {
            out.textContent = '—';
            return;
        }
        var snf = Calc.snfFromClr(clr, fat);
        out.textContent = U.fmt(snf, 2) + ' % SNF';
        out.title = 'SNF = (CLR ÷ 4) + (0.2 × Fat) + 0.14 = (' + U.fmt(clr, 1) + ' ÷ 4) + (0.2 × ' +
            U.fmt(fat, 2) + ') + 0.14';
    }

    function reverse() {
        var fat = U.num(U.$('toolFat2').value, NaN);
        var snf = U.num(U.$('toolSnfIn').value, NaN);

        if (!Number.isFinite(fat) || !Number.isFinite(snf)) {
            U.$('toolClrOut').textContent = '—';
            U.$('toolLactoOut').textContent = '—';
            return;
        }
        var clr = Calc.clrFromSnf(snf, fat);
        U.$('toolClrOut').textContent = U.fmt(clr, 1);
        U.$('toolLactoOut').textContent = Calc.lactometerFromClr(clr).toFixed(3) + '  @ 27 °C';
    }

    function init() {
        U.$('toolFat').addEventListener('input', forward);
        U.$('toolClr').addEventListener('input', forward);
        U.$('toolLacto').addEventListener('input', function () {
            var reading = U.num(U.$('toolLacto').value, NaN);
            if (Number.isFinite(reading)) {
                U.$('toolClr').value = Calc.round(Calc.clrFromLactometer(reading), 2);
            }
            forward();
        });
        U.$('toolFat2').addEventListener('input', reverse);
        U.$('toolSnfIn').addEventListener('input', reverse);
    }

    window.MilkTools = { init: init };
})();
