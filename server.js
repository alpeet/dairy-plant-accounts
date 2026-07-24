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
    validateBulkPayment, validateSettings,
    validateDenomination, validatePettyCash, validateSalary,
    validateVehicleExpense, validateOtherExpense,
    validateRoute, validateRateChart, validateProductionBatch, validatePartnerCapital
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

// ── #4 Login brute-force throttle (in-memory, per username) ──
const loginThrottle = new Map();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes
function recordLoginAttempt(username, success) {
    const key = (username || '').toLowerCase();
    if (!key) return;
    if (success) { loginThrottle.delete(key); return; }
    const now = Date.now();
    const rec = loginThrottle.get(key) || { count: 0, first: now };
    rec.count += 1;
    loginThrottle.set(key, rec);
}
function isLoginThrottled(username) {
    const key = (username || '').toLowerCase();
    const rec = loginThrottle.get(key);
    if (!rec) return false;
    if (Date.now() - rec.first > LOGIN_THROTTLE_MS) { loginThrottle.delete(key); return false; }
    return rec.count >= MAX_LOGIN_ATTEMPTS;
}

// ── Admin token helper (works for both env-default and DB users) ──
function isAdminToken(token) {
    const td = tokenStore.get(token);
    if (!td) return false;
    if (td.role === 'admin') return true;
    if (td.username === AUTH_USERNAME) return true; // env-default admin
    return false;
}

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

// ── Date normalization: normalize / to - in all date fields ──
const DATE_FIELDS = ['date', 'from_date', 'to_date', 'payment_date', 'effective_from'];
app.use((req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        for (const field of DATE_FIELDS) {
            if (typeof req.body[field] === 'string') {
                req.body[field] = req.body[field].replace(/\//g, '-');
            }
        }
    }
    next();
});

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
const dbPath = path.join(dbDir, 'dairy-plant.db');

// ⚠️  Check if running on Render without persistent disk
const isRender = process.env.RENDER === 'true';
if (isRender && !process.env.DB_DIR) {
    console.warn('  ⚠️  WARNING: Running on Render without persistent disk configured!');
    console.warn('     Data will be LOST on every restart.');
    console.warn('     Set DB_DIR env var to the persistent disk mount path.');
}

// Check if the database already exists (data persistence indicator)
const dbExists = fs.existsSync(dbPath);

let db;
try {
    db = initDatabase(dbDir);
    console.log('  📁 Database:');
    console.log(`     Directory: ${dbDir}`);
    console.log(`     File:      ${dbPath}`);
    console.log(`     Status:    ${dbExists ? '🟢 Existing (data will persist)' : '🆕 New (created fresh)'}`);
    if (dbExists) {
        // Count registered users to confirm persistence
        try {
            const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
            console.log(`     Users:     ${userCount.count} registered`);
        } catch (e) { /* ignore */ }
    }
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
// Auto-Import Excel Data on First Run
// ──────────────────────────────────────────────────────────────
try {
    // Check if the database has business data
    const partyCount = db.prepare("SELECT COUNT(*) as c FROM parties").get().c;
    if (partyCount === 0) {
        const excelPath = path.join(__dirname, 'Dairy_Accounts_Professional.xlsx');
        if (fs.existsSync(excelPath)) {
            console.log('  📂 Database has no business data. Running Excel import...');
            try {
                // Run the import script programmatically
                const { main: importExcel } = require('./import-excel');
                importExcel();
            } catch (importErr) {
                console.error('  ❌ Excel import failed:', importErr.message);
                console.error('     The server will start with an empty database.');
            }
        } else {
            console.log('  ℹ️  No Excel file found at:', excelPath);
            console.log('     Place Dairy_Accounts_Professional.xlsx in the project root and restart to import data.');
        }
    } else {
        console.log(`  ✅ Database has ${partyCount} parties — skipping import.`);
    }
} catch (checkErr) {
    console.log('  ℹ️  Could not check database state:', checkErr.message);
}

// ──────────────────────────────────────────────────────────────
// Authentication Routes (no auth required)
// ──────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};

    // #4 Brute-force protection: block the username after repeated failures
    if (isLoginThrottled(username)) {
        return res.status(429).json({ success: false, error: 'Too many failed login attempts. Please try again later.' });
    }

    // 1. Check env var fallback (backward compatibility)
    if (username === AUTH_USERNAME && password === AUTH_PASSWORD) {
        const token = crypto.randomBytes(32).toString('hex');
        tokenStore.set(token, { createdAt: Date.now(), role: 'admin', username: AUTH_USERNAME });
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
        const mustChangePassword = AUTH_PASSWORD === 'admin123';
        recordLoginAttempt(username, true);
        return res.json({ success: true, data: { message: 'Login successful', mustChangePassword } });
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
        const mustChangePassword = verifyPassword('admin123', user.password_hash);
        recordLoginAttempt(username, true);
        return res.json({ success: true, data: { message: 'Login successful', mustChangePassword } });
    }

    recordLoginAttempt(username, false);
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

// POST /api/auth/db-status — Check if database is fresh/empty (data may have been lost)
app.post('/api/auth/db-status', (req, res) => {
    try {
        // Count total users
        const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users").get();
        // Count non-admin users (operator, accountant, staff, agent roles)
        const nonAdminUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin'").get();
        // Count admin users
        const adminUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
        // Count business records (parties, products, sales, purchases, milk_collections)
        const parties = db.prepare("SELECT COUNT(*) as count FROM parties").get();
        const products = db.prepare("SELECT COUNT(*) as count FROM products").get();
        const sales = db.prepare("SELECT COUNT(*) as count FROM sales").get();
        const purchases = db.prepare("SELECT COUNT(*) as count FROM purchases").get();
        const milkCollections = db.prepare("SELECT COUNT(*) as count FROM milk_collections").get();

        const totalBusinessRecords = parties.count + products.count + sales.count + purchases.count + milkCollections.count;

        // Determine DB state
        let state = 'established';
        let message = '';
        let severity = 'info';

        if (totalUsers.count === 0) {
            state = 'empty';
            message = 'The database appears to be empty. No users or data found. This is a fresh installation.';
            severity = 'warning';
        } else if (nonAdminUsers.count === 0 && totalBusinessRecords === 0) {
            state = 'fresh';
            message = '⚠️ This appears to be a fresh database. Only the default admin user exists with no business data. If you expected to see your existing data, it may have been lost due to a server restart without persistent storage.';
            severity = 'danger';
        } else if (nonAdminUsers.count === 0 && totalBusinessRecords > 0) {
            state = 'minimal';
            message = 'This database has business records but only the default admin user. You may want to create additional user accounts.';
            severity = 'info';
        } else {
            message = 'Database is established with ' + totalUsers.count + ' user(s) and ' + totalBusinessRecords + ' business record(s).';
        }

        // Count available backups
        let backupCount = 0;
        try {
            const backups = ops.listBackups(path.join(dbDir, 'dairy-plant.db'));
            backupCount = backups.length;
        } catch (e) { /* ignore */ }

        res.json({
            success: true,
            data: {
                state: state,
                message: message,
                severity: severity,
                stats: {
                    totalUsers: totalUsers.count,
                    adminUsers: adminUsers.count,
                    nonAdminUsers: nonAdminUsers.count,
                    parties: parties.count,
                    products: products.count,
                    sales: sales.count,
                    purchases: purchases.count,
                    milkCollections: milkCollections.count,
                    totalBusinessRecords: totalBusinessRecords
                },
                backupsAvailable: backupCount
            }
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/me — Get current user info (id, username, role)
app.post('/api/auth/me', (req, res) => {
    const token = extractToken(req);
    const tokenData = tokenStore.get(token);
    if (!tokenData) {
        return res.json({ success: false, error: 'Not authenticated' });
    }
    // Get full user info from DB
    const userId = tokenData.userId;
    if (userId) {
        const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(userId);
        if (user) {
            return res.json({ success: true, data: { id: user.id, username: user.username, role: user.role } });
        }
    }
    // Fallback for env-var based auth (no userId in token)
    return res.json({ success: true, data: { id: null, username: tokenData.username || 'admin', role: 'admin' } });
});

// ──────────────────────────────────────────────────────────────
// User Management Routes (auth required, admin-only for writes)
// ──────────────────────────────────────────────────────────────

// POST /api/auth/users/list — List all users (admin only)
app.post('/api/auth/users/list', requireRole('admin'), (req, res) => {
    try {
        const users = db.prepare("SELECT id, username, role, is_active, created_at FROM users ORDER BY id").all();
        return res.json({ success: true, data: users });
    } catch (err) {
        return res.json({ success: false, error: err.message });
    }
});

// POST /api/auth/users/create — Create a new user (admin only)
app.post('/api/auth/users/create', requireRole('admin'), (req, res) => {
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
app.post('/api/auth/users/delete', requireRole('admin'), (req, res) => {
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
app.post('/api/auth/users/change-password', requireRole('operator'), (req, res) => {
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
    // #2 Only an authenticated admin may create accounts
    if (!isAdminToken(extractToken(req))) {
        return res.status(403).json({ success: false, error: 'Admin login required to create accounts' });
    }
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
    // #1 Only an authenticated admin may reset a password
    if (!isAdminToken(extractToken(req))) {
        return res.status(403).json({ success: false, error: 'Admin login required to reset passwords' });
    }
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
    // Set req.user with user info from token for audit logging
    const tokenData = tokenStore.get(token);
    if (tokenData && tokenData.userId) {
        const user = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(tokenData.userId);
        if (user) {
            req.user = user;
        }
    }
    // Fallback: no userId in token (env-var auth) — use generic admin
    if (!req.user) {
        req.user = { id: null, username: tokenData?.username || 'admin', role: 'admin' };
    }
    next();
}

/**
 * Role-based authorization middleware.
 * Returns 403 if the authenticated user's role is below the minimum required level.
 * Role hierarchy: agent (1) < staff (2) < operator (3) < accountant (4) < admin (5)
 */
function requireRole(minRole) {
    const hierarchy = { agent: 1, staff: 2, operator: 3, accountant: 4, admin: 5 };
    return (req, res, next) => {
        const userLevel = hierarchy[req.user?.role] || 0;
        const requiredLevel = hierarchy[minRole];
        if (!requiredLevel || userLevel < requiredLevel) {
            return res.status(403).json({ 
                success: false, 
                error: `Access denied. Requires '${minRole}' role or higher. Your role: '${req.user?.role || 'none'}'` 
            });
        }
        next();
    };
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

app.post('/api/parties/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteParty(db, req.body.id, req.user?.id)));
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

app.post('/api/products/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteProduct(db, req.body.id, req.user?.id)));
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

app.post('/api/stock/adjust', requireRole('operator'), (req, res) => {
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

app.post('/api/sales/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteSale(db, req.body.id, req.user?.id)));
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

app.post('/api/purchases/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deletePurchase(db, req.body.id, req.user?.id)));
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

app.post('/api/milk/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteMilkCollection(db, req.body.id, req.user?.id)));
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

app.post('/api/farmer/bulk-pay', requireRole('operator'), (req, res) => {
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
// Financial Reports — Profit/Loss, Stock Statement
// ──────────────────────────────────────────────────────────────
app.post('/api/reports/profit-loss', (req, res) => {
    res.json(safeRun(() => ops.getProfitLoss(db, req.body || {})));
});

app.post('/api/reports/stock-statement', (req, res) => {
    res.json(safeRun(() => ops.getStockStatement(db, req.body || {})));
});

app.post('/api/reports/enhanced-daybook', (req, res) => {
    res.json(safeRun(() => ops.getEnhancedDaybook(db, req.body || {})));
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
// Settings (admin only — business configuration)
// ──────────────────────────────────────────────────────────────
app.post('/api/settings/get', requireRole('admin'), (req, res) => {
    res.json(safeRun(() => ops.getSettings(db)));
});

// ──────────────────────────────────────────────────────────────
// Customer / Supplier Statements
// ──────────────────────────────────────────────────────────────
app.post('/api/statements/party', (req, res) => {
    res.json(safeRun(() => ops.getPartyStatement(db, req.body || {})));
});

app.post('/api/statements/parties-with-balance', (req, res) => {
    res.json(safeRun(() => ops.listPartiesWithBalance(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Daily Cash Collection
// ──────────────────────────────────────────────────────────────
app.post('/api/cash/daily-collection', (req, res) => {
    res.json(safeRun(() => ops.getDailyCashCollection(db, req.body || {})));
});

app.post('/api/cash/collection-save', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.saveCashCollection(db, req.body || {})));
});

app.post('/api/cash/collection-delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteCashCollection(db, req.body.id)));
});

// ──────────────────────────────────────────────────────────────
// Cash Deposits
// ──────────────────────────────────────────────────────────────
app.post('/api/cash-deposits/list', (req, res) => {
    res.json(safeRun(() => ops.listCashDeposits(db, req.body || {})));
});

app.post('/api/cash-deposits/get', (req, res) => {
    res.json(safeRun(() => ops.getCashDeposit(db, req.body.id)));
});

app.post('/api/cash-deposits/save', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.saveCashDeposit(db, req.body)));
});

app.post('/api/cash-deposits/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteCashDeposit(db, req.body.id)));
});

app.post('/api/cash-deposits/summary', (req, res) => {
    res.json(safeRun(() => ops.getCashDepositSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Denomination Count
// ──────────────────────────────────────────────────────────────
app.post('/api/denominations/list', (req, res) => {
    res.json(safeRun(() => ops.listDenominations(db, req.body || {})));
});

app.post('/api/denominations/get', (req, res) => {
    res.json(safeRun(() => ops.getDenomination(db, req.body.id)));
});

app.post('/api/denominations/get-by-date', (req, res) => {
    res.json(safeRun(() => ops.getDenominationByDate(db, req.body.date)));
});

app.post('/api/denominations/save', (req, res) => {
    const validationError = validateDenomination(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveDenomination(db, req.body)));
});

app.post('/api/denominations/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteDenomination(db, req.body.id, req.user?.id)));
});

// ──────────────────────────────────────────────────────────────
// Petty Cash
// ──────────────────────────────────────────────────────────────
app.post('/api/petty-cash/list', (req, res) => {
    res.json(safeRun(() => ops.listPettyCash(db, req.body || {})));
});

app.post('/api/petty-cash/get', (req, res) => {
    res.json(safeRun(() => ops.getPettyCash(db, req.body.id)));
});

app.post('/api/petty-cash/save', (req, res) => {
    const validationError = validatePettyCash(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.savePettyCash(db, req.body)));
});

app.post('/api/petty-cash/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deletePettyCash(db, req.body.id, req.user?.id)));
});

app.post('/api/petty-cash/summary', (req, res) => {
    res.json(safeRun(() => ops.getPettyCashSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Salary Records
// ──────────────────────────────────────────────────────────────
app.post('/api/salary/list', (req, res) => {
    res.json(safeRun(() => ops.listSalaryRecords(db, req.body || {})));
});

app.post('/api/salary/get', (req, res) => {
    res.json(safeRun(() => ops.getSalaryRecord(db, req.body.id)));
});

app.post('/api/salary/save', (req, res) => {
    const validationError = validateSalary(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveSalaryRecord(db, req.body)));
});

app.post('/api/salary/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteSalaryRecord(db, req.body.id, req.user?.id)));
});

app.post('/api/salary/summary', (req, res) => {
    res.json(safeRun(() => ops.getSalarySummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Vehicle Expenses
// ──────────────────────────────────────────────────────────────
app.post('/api/vehicle-expenses/list', (req, res) => {
    res.json(safeRun(() => ops.listVehicleExpenses(db, req.body || {})));
});

app.post('/api/vehicle-expenses/get', (req, res) => {
    res.json(safeRun(() => ops.getVehicleExpense(db, req.body.id)));
});

app.post('/api/vehicle-expenses/save', (req, res) => {
    const validationError = validateVehicleExpense(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveVehicleExpense(db, req.body)));
});

app.post('/api/vehicle-expenses/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteVehicleExpense(db, req.body.id, req.user?.id)));
});

app.post('/api/vehicle-expenses/summary', (req, res) => {
    res.json(safeRun(() => ops.getVehicleExpensesSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Other Expenses
// ──────────────────────────────────────────────────────────────
app.post('/api/other-expenses/list', (req, res) => {
    res.json(safeRun(() => ops.listOtherExpenses(db, req.body || {})));
});

app.post('/api/other-expenses/get', (req, res) => {
    res.json(safeRun(() => ops.getOtherExpense(db, req.body.id)));
});

app.post('/api/other-expenses/save', (req, res) => {
    const validationError = validateOtherExpense(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveOtherExpense(db, req.body)));
});

app.post('/api/other-expenses/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteOtherExpense(db, req.body.id, req.user?.id)));
});

app.post('/api/other-expenses/categories', (req, res) => {
    res.json(safeRun(() => ops.getExpenseCategories(db)));
});

app.post('/api/other-expenses/summary', (req, res) => {
    res.json(safeRun(() => ops.getExpensesSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Routes / Collection Centers
// ──────────────────────────────────────────────────────────────
app.post('/api/routes/list', (req, res) => {
    res.json(safeRun(() => ops.listRoutes(db, req.body || {})));
});

app.post('/api/routes/get', (req, res) => {
    res.json(safeRun(() => ops.getRoute(db, req.body.id)));
});

app.post('/api/routes/save', (req, res) => {
    const validationError = validateRoute(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveRoute(db, req.body)));
});

app.post('/api/routes/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteRoute(db, req.body.id, req.user?.id)));
});

app.post('/api/routes/summary', (req, res) => {
    res.json(safeRun(() => ops.getRouteSummary(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Milk Rate Charts
// ──────────────────────────────────────────────────────────────
app.post('/api/rates/list', (req, res) => {
    res.json(safeRun(() => ops.listRateCharts(db)));
});

app.post('/api/rates/get', (req, res) => {
    res.json(safeRun(() => ops.getRateChart(db, req.body.id)));
});

app.post('/api/rates/save', (req, res) => {
    const validationError = validateRateChart(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveRateChart(db, req.body)));
});

app.post('/api/rates/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteRateChart(db, req.body.id, req.user?.id)));
});

app.post('/api/rates/effective', (req, res) => {
    res.json(safeRun(() => ops.getEffectiveRate(db, req.body.date)));
});

app.post('/api/rates/calculate', (req, res) => {
    res.json(safeRun(() => {
        const { fat, snf, rateChart } = req.body || {};
        const rate = ops.calculateMilkRate(fat, snf, rateChart);
        return { rate };
    }));
});

// ──────────────────────────────────────────────────────────────
// Production / Batch Processing
// ──────────────────────────────────────────────────────────────
app.post('/api/production/list', (req, res) => {
    res.json(safeRun(() => ops.listProductionBatches(db, req.body || {})));
});

app.post('/api/production/get', (req, res) => {
    res.json(safeRun(() => ops.getProductionBatch(db, req.body.id)));
});

app.post('/api/production/save', (req, res) => {
    const validationError = validateProductionBatch(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveProductionBatch(db, req.body)));
});

app.post('/api/production/delete', requireRole('operator'), (req, res) => {
    res.json(safeRun(() => ops.deleteProductionBatch(db, req.body.id, req.user?.id)));
});

app.post('/api/production/process-types', (req, res) => {
    res.json(safeRun(() => ops.getProcessTypes(db)));
});

// ──────────────────────────────────────────────────────────────
// Partner Capital (accountant+ only — sensitive financial data)
// ──────────────────────────────────────────────────────────────
app.post('/api/partners/capital-list', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.listPartnerCapital(db, req.body || {})));
});

app.post('/api/partners/capital-get', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.getPartnerCapital(db, req.body.id)));
});

app.post('/api/partners/capital-save', requireRole('accountant'), (req, res) => {
    const validationError = validatePartnerCapital(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.savePartnerCapital(db, req.body)));
});

app.post('/api/partners/capital-delete', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.deletePartnerCapital(db, req.body.id, req.user?.id)));
});

app.post('/api/partners/statement', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.getPartnerStatement(db, req.body || {})));
});

app.post('/api/partners/with-balance', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.listPartnersWithBalance(db)));
});

// ──────────────────────────────────────────────────────────────
// Database Table Info (any authenticated user)
// ──────────────────────────────────────────────────────────────
app.post('/api/db/table-info', (req, res) => {
    res.json(safeRun(() => ops.getTableInfo(db)));
});

// ──────────────────────────────────────────────────────────────
// Audit Logs (accountant+ only — sensitive audit trail)
// ──────────────────────────────────────────────────────────────
app.post('/api/audit/logs', requireRole('accountant'), (req, res) => {
    res.json(safeRun(() => ops.getAuditLogs(db, req.body || {})));
});

// ──────────────────────────────────────────────────────────────
// Today Summary (for dashboard)
// ──────────────────────────────────────────────────────────────
app.post('/api/reports/farmer-statement', (req, res) => {
    res.json(safeRun(() => ops.getFarmerStatement(db, req.body || {})));
});

app.post('/api/reports/today-summary', (req, res) => {
    res.json(safeRun(() => ops.getTodaySummary(db)));
});

app.post('/api/reports/sales-register', (req, res) => {
    res.json(safeRun(() => ops.getSalesRegister(db, req.body || {})));
});

app.post('/api/reports/purchase-register', (req, res) => {
    res.json(safeRun(() => ops.getPurchaseRegister(db, req.body || {})));
});

app.post('/api/settings/save', requireRole('admin'), (req, res) => {
    const validationError = validateSettings(req.body);
    if (validationError) return res.json({ success: false, error: validationError });
    res.json(safeRun(() => ops.saveSettings(db, req.body)));
});

// ──────────────────────────────────────────────────────────────
// Backup (admin only — database export)
// ──────────────────────────────────────────────────────────────
app.post('/api/backup', requireRole('admin'), (req, res) => {
    res.json(safeRun(() => ops.backupDatabase(path.join(dbDir, 'dairy-plant.db'))));
});

// POST /api/backup/list — List all available backups (admin only)
app.post('/api/backup/list', requireRole('admin'), (req, res) => {
    try {
        const backups = ops.listBackups(path.join(dbDir, 'dairy-plant.db'));
        res.json({ success: true, data: backups });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/backup/download — Download a specific backup file (admin only)
app.post('/api/backup/download', requireRole('admin'), (req, res) => {
    try {
        const { filename } = req.body || {};
        if (!filename) {
            return res.json({ success: false, error: 'Backup filename is required' });
        }
        const backups = ops.listBackups(path.join(dbDir, 'dairy-plant.db'));
        const target = backups.find(b => b.filename === filename);
        if (!target) {
            return res.json({ success: false, error: 'Backup not found' });
        }
        // Send the file as a download
        res.download(target.path, filename, (err) => {
            if (err) {
                console.error('Download error:', err.message);
                if (!res.headersSent) {
                    res.json({ success: false, error: 'Download failed: ' + err.message });
                }
            }
        });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/backup/delete — Delete a specific backup (admin only)
app.post('/api/backup/delete', requireRole('admin'), (req, res) => {
    try {
        const { filename } = req.body || {};
        if (!filename) {
            return res.json({ success: false, error: 'Backup filename is required' });
        }
        ops.deleteBackup(path.join(dbDir, 'dairy-plant.db'), filename);
        res.json({ success: true, data: { message: `Deleted backup: ${filename}` } });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// POST /api/backup/restore — Restore database from a backup (admin only)
app.post('/api/backup/restore', requireRole('admin'), (req, res) => {
    try {
        const { filename } = req.body || {};
        if (!filename) {
            return res.json({ success: false, error: 'Backup filename is required' });
        }
        const result = ops.restoreDatabase(
            path.join(dbDir, 'dairy-plant.db'),
            filename,
            () => {
                // Close the current database connection before restore
                try {
                    if (db && typeof db.close === 'function') {
                        db.close();
                        console.log('  → Database connection closed for restore');
                    }
                } catch (e) {
                    console.error('  ⚠️ Error closing database:', e.message);
                }
            }
        );

        // Re-initialize the database after restore
        try {
            db = initDatabase(dbDir);
            console.log('  ✅ Database re-initialized after restore');
        } catch (err) {
            console.error('  ❌ Failed to re-initialize database after restore:', err.message);
            return res.json({ success: false, error: 'Backup restored but failed to re-initialize: ' + err.message });
        }

        res.json({ success: true, data: result });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
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
// Auto-Backup Configuration
// ──────────────────────────────────────────────────────────────
const AUTO_BACKUP_INTERVAL_MS = parseInt(process.env.AUTO_BACKUP_INTERVAL, 10) || 60 * 60 * 1000; // default: 1 hour

let autoBackupTimer = null;

/**
 * Start the periodic auto-backup timer.
 * Creates a timestamped backup of the database at regular intervals.
 */
function startAutoBackup() {
    if (autoBackupTimer) {
        clearInterval(autoBackupTimer);
    }

    if (AUTO_BACKUP_INTERVAL_MS <= 0) {
        console.log('  ⏰ Auto-backup is disabled (AUTO_BACKUP_INTERVAL=0)');
        return;
    }

    const intervalMinutes = Math.round(AUTO_BACKUP_INTERVAL_MS / 60000);
    console.log(`  ⏰ Auto-backup every ${intervalMinutes} minute${intervalMinutes > 1 ? 's' : ''}`);

    autoBackupTimer = setInterval(() => {
        try {
            const result = ops.backupDatabase(path.join(dbDir, 'dairy-plant.db'));
            console.log(`  💾 Auto-backup created: ${result.filename} (${ops.formatFileSize(result.size)})`);
        } catch (err) {
            console.error('  ❌ Auto-backup failed:', err.message);
        }
    }, AUTO_BACKUP_INTERVAL_MS);

    // Allow the timer to not block process exit
    if (autoBackupTimer && autoBackupTimer.unref) {
        autoBackupTimer.unref();
    }
}

// ──────────────────────────────────────────────────────────────
// Graceful Shutdown Handler
// ──────────────────────────────────────────────────────────────
let isShuttingDown = false;

/**
 * Perform a graceful shutdown:
 *   1. Create a final backup of the database
 *   2. Close the database connection
 *   3. Exit the process
 */
function gracefulShutdown(signal, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n  🛑 Received ${signal}. Shutting down gracefully...`);

    // Step 1: Stop accepting new requests
    // (The server will stop listening, but existing requests finish)

    // Step 2: Create a final backup before exiting
    try {
        const result = ops.backupDatabase(path.join(dbDir, 'dairy-plant.db'));
        console.log(`  💾 Shutdown backup saved: ${result.filename} (${ops.formatFileSize(result.size)})`);
    } catch (err) {
        console.error('  ❌ Shutdown backup failed:', err.message);
    }

    // Step 3: Close the database
    try {
        if (db && typeof db.close === 'function') {
            db.close();
            console.log('  ✅ Database connection closed');
        }
    } catch (err) {
        console.error('  ❌ Error closing database:', err.message);
    }

    // Step 4: Exit
    console.log('  👋 Goodbye!\n');
    process.exit(exitCode);
}

// Listen for termination signals
// Render sends SIGTERM when stopping/restarting the service
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Prevent uncaught exceptions from silently exiting
process.on('uncaughtException', (err) => {
    console.error('  ❌ Uncaught exception:', err.message);
    console.error(err.stack);
    gracefulShutdown('uncaughtException', 1);
});

process.on('unhandledRejection', (reason) => {
    console.error('  ❌ Unhandled rejection:', reason);
});

// ──────────────────────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
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

    // Start the auto-backup timer
    startAutoBackup();

    // List existing backups on startup
    try {
        const existingBackups = ops.listBackups(path.join(dbDir, 'dairy-plant.db'));
        if (existingBackups.length > 0) {
            console.log(`  💾 ${existingBackups.length} backup(s) available in: ${ops.getBackupDir(path.join(dbDir, 'dairy-plant.db'))}`);
            console.log(`     Latest: ${existingBackups[0].filename} (${ops.formatFileSize(existingBackups[0].size)})`);
        }
    } catch (e) { /* ignore */ }
});

// Set a shorter server timeout for Render's health checks
server.timeout = 120000; // 2 minutes
