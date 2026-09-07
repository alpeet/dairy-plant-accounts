/**
 * Prarambha Account & Stock Management — Email Operations
 * ==========================================
 * Sends emails (e.g. party statements) via SMTP using nodemailer.
 * SMTP credentials are stored in the settings table (configured in Settings).
 * Used by both Electron (main.js) and Web (server.js).
 *
 * nodemailer is required lazily so the app still boots if it is not installed.
 */

let nodemailer = null;
function getNodemailer() {
    if (!nodemailer) {
        try {
            nodemailer = require('nodemailer');
        } catch (e) {
            return null;
        }
    }
    return nodemailer;
}

/**
 * Read SMTP settings from the database.
 */
function getSmtpSettings(db) {
    const rows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%'").all();
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;
    return settings;
}

/**
 * Basic email address validation.
 */
function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Send an email.
 *
 * @param {object} db   - SQLite database instance
 * @param {object} opts - { to, subject, html, text, cc, bcc, attachments }
 * @returns {{ success: boolean, data?: object, error?: string }}
 */
function sendEmail(db, opts = {}) {
    const smtp = getSmtpSettings(db);
    const nodemailerLib = getNodemailer();
    if (!nodemailerLib) {
        return { success: false, error: 'nodemailer is not installed. Run "npm install nodemailer" and restart.' };
    }

    const to = String(opts.to || '').trim();
    if (!to) return { success: false, error: 'Recipient email address is required' };
    if (!isValidEmail(to)) return { success: false, error: `Invalid recipient email address: ${to}` };

    const host = String(smtp.smtp_host || '').trim();
    if (!host) {
        return { success: false, error: 'SMTP server not configured. Add your SMTP settings in Settings → Email (SMTP).' };
    }

    const port = parseInt(smtp.smtp_port, 10) || 587;
    const secure = String(smtp.smtp_secure) === '1';
    const user = String(smtp.smtp_user || '').trim();
    const pass = String(smtp.smtp_pass || '').trim();

    const fromEmail = String(smtp.smtp_from || user || '').trim();
    if (!fromEmail) {
        return { success: false, error: 'Sender email (SMTP From) not configured in Settings → Email (SMTP).' };
    }
    const fromName = String(smtp.smtp_from_name || '').trim();
    const from = fromName ? `"${fromName.replace(/"/g, '')}" <${fromEmail}>` : fromEmail;

    const transporter = nodemailerLib.createTransport({
        host,
        port,
        secure,
        auth: user ? { user, pass } : undefined,
        tls: { rejectUnauthorized: false }
    });

    const mailOptions = {
        from,
        to,
        subject: String(opts.subject || ''),
        html: opts.html || '',
        text: opts.text || '',
    };
    if (opts.cc) mailOptions.cc = String(opts.cc).trim();
    if (opts.bcc) mailOptions.bcc = String(opts.bcc).trim();
    if (Array.isArray(opts.attachments) && opts.attachments.length > 0) {
        mailOptions.attachments = opts.attachments;
    }

    // Wrap nodemailer's promise API (older versions use callbacks)
    return new Promise((resolve) => {
        const done = (err, info) => {
            if (err) {
                console.error('Email send error:', err.message);
                resolve({ success: false, error: `Email could not be sent: ${err.message}` });
            } else {
                resolve({ success: true, data: { messageId: info.messageId || null, accepted: info.accepted || [] } });
            }
        };
        try {
            transporter.sendMail(mailOptions, done);
        } catch (err) {
            done(err);
        }
    });
}

module.exports = { sendEmail, getSmtpSettings, isValidEmail };