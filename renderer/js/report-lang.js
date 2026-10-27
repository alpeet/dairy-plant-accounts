/**
 * Report language — one preference for the whole application.
 *
 * English / नेपाली / English + नेपाली.
 *
 * Everything that shows a report reads the language from here:
 *   rl('Total', 'जम्मा')                        → inline label
 *   getReportLang()                              → 'en' | 'np' | 'both'
 *   onReportLangChange(fn, key)                  → re-render a screen on change
 *
 * Every print and PDF export goes through printHTML() or api.printToPDF(),
 * both of which are wrapped below, so the chosen language applies to the
 * printed document too — not only to the screen. Table headings, report
 * titles and value-card labels are translated; transaction data (party names,
 * references, descriptions) is never touched.
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'reportLang';
    const VALID = ['en', 'np', 'both'];

    // Older builds stored 'ne' / 'nepali'. Accept them instead of silently
    // falling back to English — that fallback is what made the selector look
    // like it did nothing.
    function normalise(v) {
        const s = String(v || '').trim().toLowerCase();
        if (s === 'np' || s === 'ne' || s === 'nepali' || s === 'नेपाली') return 'np';
        if (s === 'both' || s === 'bi' || s === 'bilingual') return 'both';
        if (s === 'en' || s === 'english') return 'en';
        return null;
    }

    let current = 'en';
    try {
        current = normalise(localStorage.getItem(STORAGE_KEY)) || 'en';
    } catch (e) { /* storage unavailable */ }

    const subscribers = new Map();

    function getReportLang() { return current; }

    /**
     * Pick the label for the current language.
     * `en` / `np` are the two texts; with 'both' they are joined.
     */
    function rl(en, np) {
        if (current === 'np') return np == null ? en : np;
        if (current === 'both') {
            if (np == null || np === en) return en;
            if (en == null) return np;
            return en + ' / ' + np;
        }
        return en == null ? np : en;
    }

    /**
     * Keyed term table used by the report screens: rlt('total_income').
     * Keeps one spelling of each label instead of repeating the pair at every
     * call site, so a Nepali label can be corrected in one place.
     */
    const TERMS = {
        amount: ['Amount', 'रकम'], amount_rs: ['Amount (Rs)', 'रकम (रु)'],
        period: ['Period', 'अवधि'], date: ['Date', 'मिति'], from: ['From', 'देखि'],
        to: ['To', 'सम्म'], month: ['Month', 'महिना'], language: ['Language', 'भाषा'],
        total: ['Total', 'जम्मा'], balance: ['Balance', 'बाँकी'],
        opening_balance: ['Opening Balance', 'सुरुको मौज्दात'],
        closing_balance: ['Closing Balance', 'अन्तिम मौज्दात'],
        debit: ['Debit', 'डेबिट'], credit: ['Credit', 'क्रेडिट'],
        particulars: ['Particulars', 'विवरण'], reference: ['Reference', 'सन्दर्भ'],
        vouchers: ['Vouchers', 'भौचर'], lines: ['Lines', 'संख्या'],
        summary: ['Summary', 'सारांश'], reconciliation: ['Reconciliation', 'हिसाब मिलान'],
        sales: ['Sales', 'बिक्री'], purchases: ['Purchases', 'खरिद'],
        income: ['Income', 'आम्दानी'], expense: ['Expense', 'खर्च'],
        other_income: ['Other Income', 'अन्य आम्दानी'],
        total_income: ['Total Income', 'कुल आम्दानी'],
        total_expenses: ['Total Expenses', 'कुल खर्च'],
        operating_expenses: ['Operating Expenses', 'सञ्चालन खर्च'],
        office_expenses: ['Office Expenses', 'कार्यालय खर्च'],
        vehicle_expenses: ['Vehicle Expenses', 'सवारी खर्च'],
        salary: ['Salary', 'तलब'], petty_cash: ['Petty Cash', 'सानो नगद'],
        cogs: ['Cost of Goods Sold', 'बिक्री भएका सामानको लागत'],
        gross_profit: ['Gross Profit', 'कुल नाफा'],
        net_profit: ['Net Profit', 'खुद नाफा'], net_loss: ['Net Loss', 'खुद नोक्सान'],
        percent_of_sales: ['% of Sales', 'बिक्रीको %'],
        income_heads: ['Income Heads', 'आम्दानी शीर्षक'],
        expense_heads: ['Expense Heads', 'खर्च शीर्षक'],
        monthly_closing: ['Month-wise Closing', 'महिनागत अन्तिम मौज्दात'],
        item: ['Item', 'वस्तु'], items: ['Items', 'वस्तुहरू'],
        quantity: ['Quantity', 'परिमाण'], unit: ['Unit', 'एकाइ'],
        rate: ['Rate', 'दर'], status: ['Status', 'स्थिति'],
        payment_status: ['Payment Status', 'भुक्तानी स्थिति'],
        party: ['Party', 'पार्टी'], customer: ['Customer', 'ग्राहक'],
        supplier: ['Supplier', 'आपूर्तिकर्ता'], phone: ['Phone', 'फोन'],
        outstanding: ['Outstanding', 'बाँकी रकम'], advance: ['Advance', 'अग्रिम'],
        prepaid_rent: ['Prepaid Rent', 'अग्रिम भुक्तानी घरभाडा'],
        transaction_type: ['Transaction Type', 'कारोबारको प्रकार'],
        print: ['Print', 'प्रिन्ट'], pdf: ['PDF', 'पी.डी.एफ.'],
        generate: ['Generate', 'बनाउनुहोस्'], export: ['Export', 'निकासा'],
        search: ['Search', 'खोज्नुहोस्'], all: ['All', 'सबै']
    };

    /** Label for a known report term, in the current language. */
    function rlt(key, fallback) {
        const pair = TERMS[key];
        if (!pair) return fallback || String(key || '').replace(/_/g, ' ');
        return rl(pair[0], pair[1]);
    }

    function syncSelectors() {
        const selects = document.querySelectorAll(
            '#reportLangGlobal, .report-lang-select, .report-lang-picker select'
        );
        selects.forEach(function (s) {
            if (s.value !== current) s.value = current;
        });
        document.querySelectorAll('.report-lang-btn').forEach(function (b) {
            b.classList.toggle('btn-primary', b.dataset.lang === current);
            b.classList.toggle('btn-secondary', b.dataset.lang !== current);
        });
    }

    function notify() {
        subscribers.forEach(function (fn) {
            try { fn(current); } catch (e) { console.error('report language subscriber failed', e); }
        });
        // Screens that did not register their own subscriber still need to be
        // redrawn with the new labels.
        if (typeof window.rerenderActivePage === 'function') {
            try { window.rerenderActivePage(); } catch (e) { console.error('re-render failed', e); }
        }
        syncSelectors();
    }

    function setReportLang(v) {
        const next = normalise(v) || 'en';
        try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* ignore */ }
        if (next === current) { syncSelectors(); return current; }
        current = next;
        notify();
        return current;
    }

    /**
     * Register a re-render callback. Keyed so a screen that is rendered many
     * times does not pile up handlers.
     */
    function onReportLangChange(fn, key) {
        if (typeof fn !== 'function') return;
        subscribers.set(key || ('sub-' + subscribers.size), fn);
        syncSelectors();
    }

    function offReportLangChange(key) { subscribers.delete(key); }

    // ── Translation of printed documents ────────────────────────────────
    // Only headings/labels are translated. Values inside <td> stay exactly as
    // stored, so a party name or a reference number is never altered.

    const LABELS = {
        // Core
        'Date': 'मिति', 'Date/Time': 'मिति / समय', 'From': 'देखि', 'To': 'सम्म',
        'Particulars': 'विवरण', 'Particular': 'विवरण', 'Description': 'विवरण',
        'Details': 'विवरण', 'Notes': 'टिप्पणी', 'Remark': 'कैफियत', 'Reason': 'कारण',
        // Money
        'Amount': 'रकम', 'Amount (Rs)': 'रकम (रु)', 'Amount (रु)': 'रकम (रु)',
        'Total': 'जम्मा', 'Subtotal': 'उप-जम्मा', 'Net': 'खुद', 'Balance': 'बाँकी',
        'Opening': 'सुरुको', 'Closing': 'अन्तिम', 'Difference': 'फरक',
        'Debit': 'डेबिट', 'Credit': 'क्रेडिट', 'Value': 'मूल्य',
        'Paid': 'तिरिएको', 'Due': 'बाँकी', 'Outstanding': 'बाँकी रकम',
        'Advance': 'अग्रिम', 'Remaining': 'बाँकी', 'Charges': 'शुल्क',
        'Discount': 'छुट', 'Tax': 'कर', 'VAT': 'भ्याट',
        'Cash': 'नगद', 'Bank': 'बैंक', 'Cheque': 'चेक', 'Cheque No': 'चेक नं',
        'Mode': 'भुक्तानी माध्यम', 'Payment Mode': 'भुक्तानी माध्यम',
        'Receipts': 'प्राप्ति', 'Payments': 'भुक्तानी',
        'Other IN': 'अन्य आम्दानी', 'Other OUT': 'अन्य खर्च',
        'Cash In': 'नगद आम्दानी', 'Cash Out': 'नगद खर्च',
        'Cash Sales': 'नगद बिक्री', 'Credit Sales': 'उधारो बिक्री',
        // Parties
        'Party': 'पार्टी', 'Parties': 'पार्टीहरू', 'Name': 'नाम',
        'Customer': 'ग्राहक', 'Supplier': 'आपूर्तिकर्ता', 'Farmer': 'किसान',
        'Partner': 'साझेदार', 'Counterparty': 'सम्बन्धित पार्टी',
        'Phone': 'फोन', 'Address': 'ठेगाना', 'Area': 'क्षेत्र', 'Route': 'रुट',
        'Paid To': 'भुक्तानी पाउने', 'Against': 'सन्दर्भ',
        // Documents
        'Head': 'शीर्षक', 'Expense Head': 'खर्च शीर्षक', 'Income Head': 'आम्दानी शीर्षक',
        'Received From': 'प्राप्त गर्ने', 'Entered By': 'प्रविष्ट गर्ने',
        'Voucher No.': 'भौचर नं', 'Amount Paid': 'तिरिएको रकम',
        'Opening Balance': 'सुरुको मौज्दात', 'Closing Balance': 'अन्तिम मौज्दात',
        'Ref': 'सन्दर्भ', 'Ref No': 'सन्दर्भ नं', 'Reference': 'सन्दर्भ',
        'Reference No': 'सन्दर्भ नं', 'Invoice': 'बिल', 'Invoice No': 'बिल नं',
        'Bill': 'बिल', 'Bill No': 'बिल नं', 'Voucher': 'भौचर',
        'Voucher No': 'भौचर नं', 'Receipt No': 'रसिद नं',
        'Collection #': 'संकलन नं', 'Collections': 'संकलन',
        'Batch': 'ब्याच', 'Code': 'कोड', 'Record': 'अभिलेख',
        // Items
        'Product': 'उत्पादन', 'Product Name': 'उत्पादनको नाम',
        'Item': 'वस्तु', 'Items': 'वस्तुहरू', 'Category': 'श्रेणी',
        'Type': 'प्रकार', 'Unit': 'एकाइ', 'Qty': 'परिमाण',
        'Qty (L)': 'परिमाण (लि.)', 'Quantity': 'परिमाण',
        'Rate': 'दर', 'Unit Cost': 'प्रति एकाइ लागत', 'Cost': 'लागत',
        'Liters': 'लिटर', 'Litres': 'लिटर', 'Kg': 'के.जी.',
        'Stock': 'मौज्दात', 'Inventory': 'मौज्दात',
        'Opening Stock': 'सुरुको मौज्दात', 'Closing Stock': 'अन्तिम मौज्दात',
        'Wastage': 'क्षति', 'Shortfall': 'घाटा',
        'Produced': 'उत्पादित', 'Process': 'प्रक्रिया',
        'Input': 'आगत', 'Output': 'निकास', 'Movement': 'चल्ती',
        'Returned': 'फिर्ता', 'Adjusted': 'समायोजित',
        // Operations
        'Shift': 'सिफ्ट', 'Status': 'स्थिति', 'Due Status': 'बाँकी स्थिति',
        'Action': 'कार्य', 'Actions': 'कार्यहरू', 'By': 'गर्ने',
        'User': 'प्रयोगकर्ता', 'Table': 'तालिका', 'Source': 'स्रोत',
        'Expected': 'अपेक्षित', 'Actual': 'वास्तविक', 'Check': 'जाँच',
        'Current': 'हालको', 'Previous': 'अघिल्लो', 'Change': 'परिवर्तन',
        'Position': 'स्थान', 'Vehicle': 'सवारी', 'Number': 'नम्बर',
        'Sales': 'बिक्री', 'Purchases': 'खरिद', 'Expense': 'खर्च',
        'Expenses': 'खर्चहरू', 'Income': 'आम्दानी', 'Salary': 'तलब',
        'Employee': 'कर्मचारी', 'Employees': 'कर्मचारीहरू',
        'Month': 'महिना', 'Year': 'वर्ष', 'Period': 'अवधि',
        'Days': 'दिन', 'Day': 'दिन', 'Week': 'हप्ता',
        'Printed': 'प्रिन्ट मिति', 'Generated': 'तयार गरिएको',
        'Printed On': 'प्रिन्ट मिति', 'Generated On': 'तयार गरिएको मिति',
        'Page': 'पृष्ठ', 'Prepared By': 'तयार गर्ने',
        'Checked By': 'जाँच गर्ने', 'Approved By': 'स्वीकृत गर्ने',
        'Authorized Signature': 'अधिकृत हस्ताक्षर',
        'Signature': 'हस्ताक्षर',
        'Counted By': 'गणना गर्ने', 'Counted by (Signature)': 'गणना गर्ने (हस्ताक्षर)',
        'Denomination': 'नोटको गणना', 'Denominations': 'नोटको गणना',
        'Expected Cash': 'अपेक्षित नगद', 'Counted Cash': 'गणना गरिएको नगद',
        'Other': 'अन्य', 'All': 'सबै', 'None': 'कुनै छैन',
        'Yes': 'हो', 'No': 'होइन', 'OK': 'ठीक', 'Flag': 'चेतावनी',
        'Account': 'खाता', 'Accounts': 'खाताहरू',
        'Debit (Rs)': 'डेबिट (रु)', 'Credit (Rs)': 'क्रेडिट (रु)',
        'Balance (Rs)': 'बाँकी (रु)', 'Rate (Rs)': 'दर (रु)',
        'Fat': 'फ्याट', 'SNF': 'एस.एन.एफ.', 'Protein': 'प्रोटिन',
        'Quality': 'गुणस्तर', 'Test': 'जाँच'
    };

    const TITLES = {
        'Monthly Report': 'मासिक प्रतिवेदन',
        'Profit & Loss Statement': 'नाफा–नोक्सान विवरण',
        'Profit and Loss Statement': 'नाफा–नोक्सान विवरण',
        'Balance Sheet': 'वासलात',
        'Trial Balance': 'परीक्षण सन्तुलन',
        'Party Statement': 'पार्टी विवरण',
        'Customer Statement': 'ग्राहक विवरण',
        'Supplier Statement': 'आपूर्तिकर्ता विवरण',
        'Customer Ledger': 'ग्राहक खाता',
        'Supplier Ledger': 'आपूर्तिकर्ता खाता',
        'Farmer Statement': 'किसान विवरण',
        'General Ledger': 'मुख्य खाता',
        'Company Ledger': 'कम्पनी खाता',
        'Day Book': 'दैनिकी',
        'Daybook': 'दैनिकी',
        'Sales Report': 'बिक्री प्रतिवेदन',
        'Purchase Report': 'खरिद प्रतिवेदन',
        'Purchases Report': 'खरिद प्रतिवेदन',
        'Sales Register': 'बिक्री रजिस्टर',
        'Purchase Register': 'खरिद रजिस्टर',
        'Sales List': 'बिक्री सूची',
        'Purchase List': 'खरिद सूची',
        'Sales Invoice': 'बिक्री बिल',
        'Purchase Bill': 'खरिद बिल',
        'Milk Collection Report': 'दूध संकलन प्रतिवेदन',
        'Milk Collection': 'दूध संकलन',
        'Milk Summary': 'दूध सारांश',
        'Daily Cash Collection Report': 'दैनिक नगद संकलन प्रतिवेदन',
        'Cash Collection Report': 'नगद संकलन प्रतिवेदन',
        'Cash Deposit Report': 'नगद जम्मा प्रतिवेदन',
        'Bank Transactions': 'बैंक कारोबार',
        'Bank Statement': 'बैंक विवरण',
        'Expense Report': 'खर्च प्रतिवेदन',
        'Expenses Report': 'खर्च प्रतिवेदन',
        'Salary Report': 'तलब प्रतिवेदन',
        'Salary Slip': 'तलब पर्ची',
        'Payroll Report': 'तलब प्रतिवेदन',
        'Stock Report': 'मौज्दात प्रतिवेदन',
        'Stock Statement': 'मौज्दात विवरण',
        'Stock List': 'मौज्दात सूची',
        'Stock Summary': 'मौज्दात सारांश',
        'Production Report': 'उत्पादन प्रतिवेदन',
        'Production List': 'उत्पादन सूची',
        'Dairy Costing': 'डेरी लागत',
        'Receivable / Payable': 'उठाउन बाँकी / तिर्न बाँकी',
        'Outstanding Report': 'बाँकी रकम प्रतिवेदन',
        'Advance Report': 'अग्रिम प्रतिवेदन',
        'Advances Report': 'अग्रिम प्रतिवेदन',
        'Loan Report': 'ऋण प्रतिवेदन',
        'Party List': 'पार्टी सूची',
        'Parties List': 'पार्टी सूची',
        'Vehicle Report': 'सवारी प्रतिवेदन',
        'Vehicle Expense Report': 'सवारी खर्च प्रतिवेदन',
        'Route Summary': 'रुट सारांश',
        'Route List': 'रुट सूची',
        'Rate Chart': 'दर तालिका',
        'Rate Charts': 'दर तालिका',
        'Petty Cash Report': 'सानो नगद प्रतिवेदन',
        'Denomination Count Sheet': 'नोट गणना पाना',
        'Payment Collection Report': 'भुक्तानी संकलन प्रतिवेदन',
        'Payment Register': 'भुक्तानी रजिस्टर',
        'Collection Register': 'संकलन रजिस्टर',
        'Partner Statement': 'साझेदार विवरण',
        'Partner Capital Report': 'साझेदार पुँजी प्रतिवेदन',
        'Audit Log': 'अडिट लग',
        'User Manual': 'प्रयोगकर्ता निर्देशिका',
        'Monthly Report Drill-down': 'मासिक प्रतिवेदन विवरण'
    };

    function lookup(map, text) {
        if (map[text]) return map[text];
        const low = text.toLowerCase();
        for (const k in map) {
            if (k.toLowerCase() === low) return map[k];
        }
        return null;
    }

    function translated(text, map) {
        const plain = String(text).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (!plain) return null;
        if (plain.indexOf(' / ') !== -1) return null;          // already bilingual
        if (/[\u0900-\u097F]/.test(plain)) return null;        // already Nepali
        const np = lookup(map, plain);
        if (!np) return null;
        if (current === 'np') return np;
        if (current === 'both') return plain + ' / ' + np;
        return null;
    }

    const TAG_RULES = [
        { re: /(<th\b[^>]*>)([\s\S]*?)(<\/th>)/gi, map: LABELS },
        { re: /(<h1\b[^>]*>)([\s\S]*?)(<\/h1>)/gi, map: TITLES },
        { re: /(<h2\b[^>]*>)([\s\S]*?)(<\/h2>)/gi, map: TITLES },
        { re: /(<h3\b[^>]*>)([\s\S]*?)(<\/h3>)/gi, map: TITLES },
        { re: /(<title>)([\s\S]*?)(<\/title>)/gi, map: TITLES },
        { re: /(class="value-label"[^>]*>)([\s\S]*?)(<)/gi, map: LABELS },
        { re: /(class="stat-label"[^>]*>)([\s\S]*?)(<)/gi, map: LABELS },
        { re: /(class="section-title"[^>]*>)([\s\S]*?)(<)/gi, map: TITLES },
        { re: /(class="detail-label"[^>]*>)([\s\S]*?)(<)/gi, map: LABELS },
        { re: /(class="value-card"[^>]*>[\s\S]{0,80}?class="value-label"[^>]*>)([\s\S]*?)(<)/gi, map: LABELS }
    ];

    /**
     * Translate the labels of an already-built print/PDF document.
     * Idempotent and safe: it only rewrites heading elements, never table data.
     */
    function localizeReportHtml(html) {
        if (!html || typeof html !== 'string') return html;
        if (current === 'en') return html;
        let out = html;
        for (const rule of TAG_RULES) {
            out = out.replace(rule.re, function (m, open, inner, close) {
                const t = translated(inner, rule.map);
                return t ? open + t + close : m;
            });
        }
        // Mark the document language so the browser picks a Devanagari-capable
        // font and screen readers/PDF text extraction stay correct.
        out = out.replace(/<html\b([^>]*)>/i, function (m, attrs) {
            const cleaned = attrs.replace(/\slang="[^"]*"/i, '');
            return '<html' + cleaned + ' lang="' + (current === 'both' ? 'en' : 'ne') + '">';
        });
        return out;
    }

    // ── In-screen picker ────────────────────────────────────────────────

    /** HTML for a three-way language selector usable inside any toolbar. */
    function reportLangSelector(id, label) {
        const sid = id || ('rl-' + Math.random().toString(36).slice(2, 8));
        return '<span class="report-lang-picker" title="Report language / प्रतिवेदनको भाषा">' +
            (label ? '<label class="report-lang-label">' + label + '</label>' : '') +
            '<span class="report-lang-icon">🌐</span>' +
            '<select id="' + sid + '" class="form-control report-lang-select" onchange="setReportLang(this.value)">' +
            '<option value="en"' + (current === 'en' ? ' selected' : '') + '>English</option>' +
            '<option value="np"' + (current === 'np' ? ' selected' : '') + '>नेपाली</option>' +
            '<option value="both"' + (current === 'both' ? ' selected' : '') + '>English + नेपाली</option>' +
            '</select></span>';
    }

    /** Three buttons instead of a dropdown — used on the Monthly Report. */
    function reportLangButtons() {
        const btn = (v, label) =>
            '<button type="button" class="btn btn-sm report-lang-btn ' +
            (current === v ? 'btn-primary' : 'btn-secondary') +
            '" data-lang="' + v + '" onclick="setReportLang(\'' + v + '\')">' + label + '</button>';
        return '<span class="report-lang-picker">' +
            btn('en', 'English') + btn('np', 'नेपाली') + btn('both', 'दुवै') + '</span>';
    }

    // ── Hook the two print/PDF choke points ─────────────────────────────
    // printHTML() (used by every Print button) and api.printToPDF() (used by
    // every PDF button) are the only paths that produce a document, so
    // wrapping them once localises the whole application.

    function wrapPrintHtml() {
        if (typeof window.printHTML !== 'function' || window.printHTML.__langWrapped) return;
        const original = window.printHTML;
        const wrapped = function (html) {
            return original.call(this, localizeReportHtml(html));
        };
        wrapped.__langWrapped = true;
        window.printHTML = wrapped;
    }

    function wrapPrintToPdf() {
        const api = window.api;
        if (!api || typeof api.printToPDF !== 'function' || api.printToPDF.__langWrapped) return;
        const original = api.printToPDF.bind(api);
        const wrapped = function (opts) {
            const o = Object.assign({}, opts || {});
            o.html = localizeReportHtml(o.html);
            return original(o);
        };
        wrapped.__langWrapped = true;
        api.printToPDF = wrapped;
    }

    function installHooks() {
        wrapPrintHtml();
        wrapPrintToPdf();
    }

    // ── Public surface ─────────────────────────────────────────────────
    window.getReportLang = getReportLang;
    window.setReportLang = setReportLang;
    window.rl = rl;
    window.rlt = rlt;
    window.onReportLangChange = onReportLangChange;
    window.offReportLangChange = offReportLangChange;
    window.localizeReportHtml = localizeReportHtml;
    window.reportLangSelector = reportLangSelector;
    window.reportLangButtons = reportLangButtons;
    window.syncReportLangSelectors = syncSelectors;

    /**
     * Used inside the report modules' HTML templates, so it returns an HTML
     * string (a DOM node would print as "[object HTMLElement]").
     */
    window.reportLangPicker = function (label) {
        return reportLangSelector(null, label);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', installHooks);
    } else {
        installHooks();
    }
    // The API object may arrive slightly later (web client) — retry once.
    setTimeout(installHooks, 0);
    setTimeout(installHooks, 400);
})();
