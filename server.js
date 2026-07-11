/**
 * Godhuli Dairy Plant — Web Server
 * =================================
 * Serves the application as a web application with:
 *   - Authentication (login/logout)
 *   - User registration & management
 *   - All business API endpoints
 *   - Print/PDF export support
 *   - Database initialization
 *
 * The desktop Electron app (main.js) is NOT affected by this file.
 *
 * Start:
 *   npm start          # starts on http://localhost:3000
 *   PORT=8080 npm start  # custom port
 *
 * Default login: admin / admin123
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── Load environment variables from .env if present ──
try { require('dotenv').config(); } catch (e) { /* dotenv is optional */ }

// ── Shared database module ──
const { initDatabase, safeRun } = require('./shared/db');

// ── Shared modules ──
const ops = require('./shared/operations');

const {
    validateParty, validateProduct, validateSale, validatePurchase,
    validateMilkCollection, validatePayment, validateStockAdjust,
    validateBulkPayment, validateSettings
} = require('./shared/validate');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ──────────────────────────────────────────────────────────────
// Authentication Configuration
// ──────────────────────────────────────────────────────────────
const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || 'admin123';

// In-memory token store (for single-user / small deployment)
// Tokens expire after 24 hours of inactivity
const tokenStore = new Map();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Cookie parsing middleware ──
// Parse cookies manually (no external dependency needed)
app.use((req, res, next) => {
    const cookieHeader = req.headers.cookie || '';
    req.cookies = {};
    cookieHeader.split(';').forEach(pair => {
        const i = pair.indexOf('=');
        if (i > 0) {
            const key = pair.substring(0, i).trim();
            const val = pair.substring(i + 1).trim();
            req.cookies[key] = decodeURIComponent(val);
        }
    });
    next();
});

// ── Middleware ──
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Disable caching ──
app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});

// ──────────────────────────────────────────────────────────────
// Database Initialization
// ──────────────────────────────────────────────────────────────
const dbDir = process.env.DB_DIR || path.join(__dirname, 'data');
let db;
try {
    db = initDatabase(dbDir);
    console.log('Database directory:', dbDir);
} catch (err) {
    console.error('FATAL: Could not initialize database:', err.message);
    process.exit(1);
}

// ──────────────────────────────────────────────────────────────
// Password Hashing (Node built-in crypto, no external deps)
// ──────────────────────────────────────────────────────────────

/**
 * Hash a password using scrypt with a random salt.
 * Returns "salt:hash" format string for storage.
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return salt + ':' + hash;
}

/**
 * Verify a password against a stored "salt:hash" string.
 */
function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === verifyHash;
}

/**
 * Ensure the default admin user exists in the database on startup.
 */
function ensureAdminUser() {
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(AUTH_USERNAME);
    if (!existing) {
        const hashed = hashPassword(AUTH_PASSWORD);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(AUTH_USERNAME, hashed);
        console.log(`  → Created default user '${AUTH_USERNAME}' in database`);
    }
}

ensureAdminUser();

// ──────────────────────────────────────────────────────────────
// Authentication Routes (no auth required)
// ──────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};

    // 1. Check env var fallback (backward compatibility)
    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        tokenStore.set(token, { createdAt: Date.now() });
        res.cookie('auth_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: TOKEN_TTL_MS,
            path: '/',
        });
        // Update password hash in DB if it doesn't match (env var changed)
        const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
            const hashed = hashPassword(password);
            if (user) {
                db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(hashed, user.id);
            } else {
                db.prepare("INSERT OR IGNORE INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hashed);
            }
        }
        return res.json({ success: true, data: { message: 'Login successful' } });
    }

    // 2. Check database users
    const user = db.prepare("SELECT id, password_hash, role, is_active FROM users WHERE username = ?").get(username);
    if (user && user.is_active && verifyPassword(password, user.password_hash)) {
        const token = crypto.randomBytes(32).toString('hex');
        tokenStore.set(token, { createdAt: Date.now(), userId: user.id, role: user.role });
        res.cookie('auth_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: TOKEN_TTL_MS,
            path: '/',
        });
        return res.json({ success: true, data: { message: 'Login successful' } });
    }

    return res.json({ success: false, error: 'Invalid username or password' });
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
    const token = extractToken(req);
    if (token) tokenStore.delete(token);
    res.clearCookie('auth_token', { path: '/' });
    res.json({ success: true, data: { message: 'Logged out' } });
});

// POST /api/auth/verify
app.post('/api/auth/verify', (req, res) => {
    const token = extractToken(req);
    const valid = isValidToken(token);
    res.json({ success: valid, data: valid ? { valid: true } : null, error: valid ? undefined : 'Invalid or expired token' });
});

// ──────────────────────────────────────────────────────────────
// User Management Routes (auth required, admin-only for writes)
// ──────────────────────────────────────────────────────────────

// POST /api/auth/users/list — List all users
app.post('/api/auth/users/list', (req, res) => {
    try {
        const users = db.prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY id").all();
        return res.json({ success: true, data: users });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/users/create — Create a new user (admin only)
app.post('/api/auth/users/create', (req, res) => {
    const token = extractToken(req);
    const tokenData = tokenStore.get(token);
    const isAdmin = tokenData && tokenData.role === 'admin';

    // Allow if env var admin or DB admin
    if (!isAdmin) {
        return res.json({ success: false, error: 'Only admin can create users' });
    }

    const { username, password, role } = req.body || {};
    if (!username || !password) {
        return res.json({ success: false, error: 'Username and password are required' });
    }
    if (username.length < 3) {
        return res.json({ success: false, error: 'Username must be at least 3 characters' });
    }
    if (password.length < 4) {
        return res.json({ success: false, error: 'Password must be at least 4 characters' });
    }

    const userRole = (role === 'admin' || role === 'operator') ? role : 'operator';

    try {
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (existing) {
            return res.json({ success: false, error: 'Username already exists' });
        }
        const hashed = hashPassword(password);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)").run(username, hashed, userRole);
        return res.json({ success: true, data: { message: `User '${username}' created successfully` } });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/users/delete — Delete a user (admin only)
app.post('/api/auth/users/delete', (req, res) => {
    const token = extractToken(req);
    const tokenData = tokenStore.get(token);
    const isAdmin = tokenData && tokenData.role === 'admin';

    if (!isAdmin) {
        return res.json({ success: false, error: 'Only admin can delete users' });
    }

    const { id } = req.body || {};
    if (!id) {
        return res.json({ success: false, error: 'User ID is required' });
    }

    try {
        // Don't allow deleting yourself
        const currentUser = db.prepare("SELECT id FROM users WHERE username = ?").get(AUTH_USERNAME);
        if (id == (currentUser ? currentUser.id : 1)) {
            return res.json({ success: false, error: 'Cannot delete the primary admin user' });
        }
        db.prepare("DELETE FROM users WHERE id = ?").run(id);
        return res.json({ success: true, data: { message: 'User deleted' } });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/users/change-password — Change own password
app.post('/api/auth/users/change-password', (req, res) => {
    const token = extractToken(req);
    const tokenData = tokenStore.get(token);
    if (!tokenData) {
        return res.json({ success: false, error: 'Authentication required' });
    }

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
        return res.json({ success: false, error: 'Current and new password are required' });
    }
    if (newPassword.length < 4) {
        return res.json({ success: false, error: 'New password must be at least 4 characters' });
    }

    // Get the user from DB
    const storedUser = db.prepare("SELECT id, password_hash FROM users WHERE username = ?").get(AUTH_USERNAME);
    const userId = storedUser ? storedUser.id : 1;

    // Verify current password
    const user = db.prepare("SELECT id, password_hash FROM users WHERE id = ?").get(userId);
    if (user && !verifyPassword(currentPassword, user.password_hash)) {
        return res.json({ success: false, error: 'Current password is incorrect' });
    }

    try {
        const hashed = hashPassword(newPassword);
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(hashed, userId);
        return res.json({ success: true, data: { message: 'Password changed successfully' } });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// Public Registration & Password Reset (no auth required)
// ──────────────────────────────────────────────────────────────

// POST /api/auth/register — Create a new user account (open registration)
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.json({ success: false, error: 'Username and password are required' });
    }
    if (username.length < 3) {
        return res.json({ success: false, error: 'Username must be at least 3 characters' });
    }
    if (password.length < 4) {
        return res.json({ success: false, error: 'Password must be at least 4 characters' });
    }

    try {
        const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
        if (existing) {
            return res.json({ success: false, error: 'Username already exists. Please choose another.' });
        }

        const hashed = hashPassword(password);
        db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'operator')").run(username, hashed);

        // Auto-login after registration
        const token = crypto.randomBytes(32).toString('hex');
        tokenStore.set(token, { createdAt: Date.now(), role: 'operator' });
        res.cookie('auth_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            maxAge: TOKEN_TTL_MS,
            path: '/',
        });

        return res.json({ success: true, data: { message: `Account '${username}' created successfully!` } });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/reset-password — Forgot password: reset any user's password
app.post('/api/auth/reset-password', (req, res) => {
    const { username, newPassword } = req.body || {};

    if (!username || !newPassword) {
        return res.json({ success: false, error: 'Username and new password are required' });
    }
    if (newPassword.length < 4) {
        return res.json({ success: false, error: 'New password must be at least 4 characters' });
    }

    try {
        const user = db.prepare("SELECT id, username FROM users WHERE username = ?").get(username);
        if (!user) {
            return res.json({ success: false, error: 'Username not found. Please check and try again.' });
        }

        const hashed = hashPassword(newPassword);
        db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(hashed, user.id);

        return res.json({ success: true, data: { message: `Password for '${username}' has been reset successfully! You can now login with your new password.` } });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// ──────────────────────────────────────────────────────────────
// Auth Middleware
// ──────────────────────────────────────────────────────────────

function extractToken(req) {
    const auth = req.headers['authorization'] || '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1];
    if (req.cookies && req.cookies.auth_token) {
        return req.cookies.auth_token;
    }
    return null;
}

function isValidToken(token) {
    if (!token || !tokenStore.has(token)) return false;
    const entry = tokenStore.get(token);
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
        tokenStore.delete(token);
        return false;
    }
    entry.createdAt = Date.now();
    return true;
}

function requireAuth(req, res, next) {
    if (!req.path.startsWith('/api/')) {
        return next();
    }
    if (req.path.startsWith('/api/auth/')) {
        return next();
    }
    if (req.path === '/api/health') {
        return next();
    }
    const token = extractToken(req);
    if (!isValidToken(token)) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
}

function webAuthRedirect(req, res, next) {
    if (req.path === '/login' || req.path.startsWith('/api/') || req.path.startsWith('/assets/')) {
        return next();
    }
    if (req.path.endsWith('.css') || req.path.endsWith('.js') || req.path.endsWith('.png') || req.path.endsWith('.ico')) {
        return next();
    }
    if (!isValidToken(extractToken(req))) {
        return res.redirect('/login');
    }
    next();
}

app.use(requireAuth);
app.use(webAuthRedirect);

// ──────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
});

// ──────────────────────────────────────────────────────────────
// Dashboard
// ──────────────────────────────────────────────────────────────
app.post('/api/dashboard', (req, res) => {
    res.json(safeRun(() => ops.getDashboard(db)));
});

// ──────────────────────────────────────────────────────────────
// Parties
// ──────────────────────────────────────────────────────────────
app.post('/api/parties/list', (req, res) => {
    res.json(safeRun(() => ops.listParties(db, req.body || {})));
});

app.post('/api/parties/get', (req, res) => {
    res.json(safeRun(() => ops.getParty(db, req.body.id)));
});

app.post('/api/parties/save', (req, res) => {
    const validationError = validateParty(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveParty(db, req.body)));
});

app.post('/api/parties/delete', (req, res) => {
    res.json(safeRun(() => ops.deleteParty(db, req.body.id)));
});

app.post('/api/parties/ledger', (req, res) => {
    res.json(safeRun(() => ops.getPartyLedger(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Products
// ──────────────────────────────────────────────────────────────
app.post('/api/products/list', (req, res) => {
    res.json(safeRun(() => ops.listProducts(db, req.body || {})));
});

app.post('/api/products/get', (req, res) => {
    res.json(safeRun(() => ops.getProduct(db, req.body.id)));
});

app.post('/api/products/save', (req, res) => {
    const validationError = validateProduct(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveProduct(db, req.body)));
});

app.post('/api/products/delete', (req, res) => {
    res.json(safeRun(() => ops.deleteProduct(db, req.body.id)));
});

// ──────────────────────────────────────────────────────────────
// Stock
// ──────────────────────────────────────────────────────────────
app.post('/api/stock/current', (req, res) => {
    res.json(safeRun(() => ops.getCurrentStock(db, req.body || {})));
});

app.post('/api/stock/movements', (req, res) => {
    res.json(safeRun(() => ops.getStockMovements(db, req.body || {})));
});

app.post('/api/stock/adjust', (req, res) => {
    const validationError = validateStockAdjust(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.adjustStock(db, req.body)));
});

// ──────────────────────────────────────────────────────────────
// Sales
// ──────────────────────────────────────────────────────────────
app.post('/api/sales/list', (req, res) => {
    res.json(safeRun(() => ops.listSales(db, req.body || {})));
});

app.post('/api/sales/get', (req, res) => {
    res.json(safeRun(() => ops.getSale(db, req.body.id)));
});

app.post('/api/sales/save', (req, res) => {
    const validationError = validateSale(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveSale(db, req.body)));
});

app.post('/api/sales/delete', (req, res) => {
    res.json(safeRun(() => ops.deleteSale(db, req.body.id)));
});

// ──────────────────────────────────────────────────────────────
// Purchases
// ──────────────────────────────────────────────────────────────
app.post('/api/purchases/list', (req, res) => {
    res.json(safeRun(() => ops.listPurchases(db, req.body || {})));
});

app.post('/api/purchases/get', (req, res) => {
    res.json(safeRun(() => ops.getPurchase(db, req.body.id)));
});

app.post('/api/purchases/save', (req, res) => {
    const validationError = validatePurchase(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.savePurchase(db, req.body)));
});

app.post('/api/purchases/delete', (req, res) => {
    res.json(safeRun(() => ops.deletePurchase(db, req.body.id)));
});

// ──────────────────────────────────────────────────────────────
// Milk Collections
// ──────────────────────────────────────────────────────────────
app.post('/api/milk/list', (req, res) => {
    res.json(safeRun(() => ops.listMilkCollections(db, req.body || {})));
});

app.post('/api/milk/get', (req, res) => {
    res.json(safeRun(() => ops.getMilkCollection(db, req.body.id)));
});

app.post('/api/milk/save', (req, res) => {
    const validationError = validateMilkCollection(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveMilkCollection(db, req.body)));
});

app.post('/api/milk/delete', (req, res) => {
    res.json(safeRun(() => ops.deleteMilkCollection(db, req.body.id)));
});

app.post('/api/milk/summary', (req, res) => {
    res.json(safeRun(() => ops.getMilkSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Farmer Bulk Payment
// ──────────────────────────────────────────────────────────────
app.post('/api/farmer/outstanding', (req, res) => {
    res.json(safeRun(() => ops.getFarmerOutstanding(db)));
});

app.post('/api/farmer/bulk-pay', (req, res) => {
    const validationError = validateBulkPayment(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.bulkPayFarmers(db, req.body)));
});

// ──────────────────────────────────────────────────────────────
// Reports
// ──────────────────────────────────────────────────────────────
app.post('/api/reports/sales', (req, res) => {
    res.json(safeRun(() => ops.getSalesReport(db, req.body || {})));
});

app.post('/api/reports/purchases', (req, res) => {
    res.json(safeRun(() => ops.getPurchasesReport(db, req.body || {})));
});

app.post('/api/reports/daybook', (req, res) => {
    res.json(safeRun(() => ops.getDaybook(db, req.body || {})));
});

app.post('/api/reports/receivables', (req, res) => {
    res.json(safeRun(() => ops.getReceivables(db)));
});

app.post('/api/reports/payables', (req, res) => {
    res.json(safeRun(() => ops.getPayables(db)));
});

// ──────────────────────────────────────────────────────────────
// Payments
// ──────────────────────────────────────────────────────────────
app.post('/api/payments/save', (req, res) => {
    const validationError = validatePayment(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.savePayment(db, req.body)));
});

app.post('/api/payments/list', (req, res) => {
    res.json(safeRun(() => ops.listPayments(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Settings
// ──────────────────────────────────────────────────────────────
app.post('/api/settings/get', (req, res) => {
    res.json(safeRun(() => ops.getSettings(db)));
});

app.post('/api/settings/save', (req, res) => {
    const validationError = validateSettings(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveSettings(db, req.body)));
});

// ──────────────────────────────────────────────────────────────
// Backup
// ──────────────────────────────────────────────────────────────
app.post('/api/backup', (req, res) => {
    res.json(safeRun(() => ops.backupDatabase(path.join(dbDir, 'dairy-plant.db'))));
});

app.post('/api/db-path', (req, res) => {
    res.json({ success: true, data: path.join(dbDir, 'dairy-plant.db') });
});

// ──────────────────────────────────────────────────────────────
// PDF Export (web version - returns HTML for print-to-PDF)
// ──────────────────────────────────────────────────────────────
app.post('/api/print-pdf', (req, res) => {
    const { html } = req.body || {};
    if (!html) return res.json({ success: false, error: 'No HTML content provided' });
    res.json({ success: true, data: { html } });
});

// ──────────────────────────────────────────────────────────────
// Serve Static Files
// ──────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'renderer', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'renderer'), { index: false }));

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'renderer', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');
    html = html.replace('</head>', '<script src="js/auth.js?v=1"></script>\n</head>');
    res.send(html);
});

// ──────────────────────────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (req.path.startsWith('/api/')) {
        res.status(500).json({ success: false, error: err.message || 'Internal server error' });
    } else {
        res.status(500).sendFile(path.join(__dirname, 'renderer', 'index.html'));
    }
});

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, error: 'API endpoint not found' });
    } else {
        res.redirect('/');
    }
});

// ──────────────────────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────────────────────
app.listen(PORT, HOST, () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('  🐄  Godhuli Dairy Plant — Web Server');
    console.log('  ───────────────────────────────────────');
    console.log(`  URL:       ${url}`);
    console.log(`  Login:     ${url}/login`);
    console.log(`  Database:  ${path.join(dbDir, 'dairy-plant.db')}`);
    console.log(`  Auth:      ${AUTH_USERNAME} / ${AUTH_PASSWORD === 'admin123' ? 'admin123 (DEFAULT — CHANGE IN .env)' : 'configured'}`);
    console.log('  ───────────────────────────────────────');
    console.log('');
});
