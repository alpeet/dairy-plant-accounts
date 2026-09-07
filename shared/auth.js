/**
 * Prarambha Account & Stock Management — Shared Authentication Module
 * ==================================================
 * Single source of truth for password hashing and user management.
 * Used by both the Electron desktop app (main.js) and the web server (server.js).
 *
 * Security notes:
 *   - Passwords are hashed with Node's built-in scrypt (salted, 64-byte key).
 *   - Passwords are NEVER stored or logged in plain text.
 *   - The default admin/admin123 credential only exists for web deployments
 *     (controlled via AUTH_USERNAME / AUTH_PASSWORD env vars). The desktop app
 *     uses a first-run setup screen instead, so no default credential exists.
 */

const crypto = require('crypto');

const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';
const MIN_PASSWORD_LENGTH = 4;

// ============================================================
// Password hashing (scrypt with random salt)
// ============================================================

/**
 * Hash a password using scrypt with a random salt.
 * Returns "salt:hash" format string for storage.
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return salt + ':' + hash;
}

/**
 * Verify a password against a stored "salt:hash" string.
 * @param {string} password
 * @param {string} stored
 * @returns {boolean}
 */
function verifyPassword(password, stored) {
    if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    try {
        const verifyHash = crypto.scryptSync(String(password), salt, 64).toString('hex');
        // Constant-time comparison to avoid timing side-channels
        const a = Buffer.from(hash, 'hex');
        const b = Buffer.from(verifyHash, 'hex');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (e) {
        return false;
    }
}

/**
 * Check whether a stored hash still matches the legacy default password
 * (used by the web version to force a password change on first login).
 * @param {string} stored
 * @returns {boolean}
 */
function isDefaultPassword(stored) {
    if (!stored) return false;
    try {
        return verifyPassword(DEFAULT_PASSWORD, stored);
    } catch (e) {
        return false;
    }
}

// ============================================================
// User queries
// ============================================================

/** Count registered users. */
function countUsers(db) {
    return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
}

/** Get a single user by username (password hash included). */
function getUserByUsername(db, username) {
    return db.prepare(
        'SELECT id, username, password_hash, role, is_active FROM users WHERE username = ?'
    ).get(username);
}

/** List all users (password hashes excluded). */
function listUsers(db) {
    return db.prepare(
        'SELECT id, username, role, is_active, created_at FROM users ORDER BY id'
    ).all();
}

/** Get a single user by id without the password hash. */
function getUserById(db, id) {
    return db.prepare('SELECT id, username, role, is_active FROM users WHERE id = ?').get(id);
}

// ============================================================
// User mutations (all return { success, data|error })
// ============================================================

/**
 * Create a new user.
 * @returns {{success:boolean, data?:object, error?:string}}
 */
function createUser(db, { username, password, role } = {}) {
    if (!username || !password) {
        return { success: false, error: 'Username and password are required' };
    }
    if (String(username).length < 3) {
        return { success: false, error: 'Username must be at least 3 characters' };
    }
    if (String(password).length < MIN_PASSWORD_LENGTH) {
        return { success: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }

    const VALID_ROLES = ['admin', 'operator', 'accountant', 'staff', 'agent'];
    const userRole = VALID_ROLES.includes(role) ? role : 'operator';

    try {
        const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existing) {
            return { success: false, error: 'Username already exists' };
        }
        const hashed = hashPassword(password);
        const info = db.prepare(
            'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
        ).run(username, hashed, userRole);
        return {
            success: true,
            data: { id: info.lastInsertRowid, username, role: userRole }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Delete a user. The currently logged-in user cannot delete themselves.
 * @returns {{success:boolean, data?:object, error?:string}}
 */
function deleteUser(db, id, actingUserId) {
    if (!id) return { success: false, error: 'User ID is required' };
    try {
        const target = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
        if (!target) return { success: false, error: 'User not found' };
        if (String(id) === String(actingUserId)) {
            return { success: false, error: 'Cannot delete the currently logged-in user' };
        }
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return { success: true, data: { message: 'User deleted' } };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Change a user's password after verifying their current password.
 * @returns {{success:boolean, data?:object, error?:string}}
 */
function changePassword(db, userId, currentPassword, newPassword) {
    if (!currentPassword || !newPassword) {
        return { success: false, error: 'Current and new password are required' };
    }
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
        return { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    try {
        const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(userId);
        if (!user) return { success: false, error: 'User not found' };
        if (!verifyPassword(currentPassword, user.password_hash)) {
            return { success: false, error: 'Current password is incorrect' };
        }
        const hashed = hashPassword(newPassword);
        db.prepare(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
        ).run(hashed, userId);
        return { success: true, data: { message: 'Password changed successfully' } };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Reset a user's password without checking the current one
 * (admin-only operation, used by the web "forgot password" flow).
 * @returns {{success:boolean, data?:object, error?:string}}
 */
function resetPassword(db, username, newPassword) {
    if (!username || !newPassword) {
        return { success: false, error: 'Username and new password are required' };
    }
    if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
        return { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    try {
        const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
        if (!user) {
            return { success: false, error: 'Username not found. Please check and try again.' };
        }
        const hashed = hashPassword(newPassword);
        db.prepare(
            "UPDATE users SET password_hash = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
        ).run(hashed, user.id);
        return {
            success: true,
            data: { message: `Password for '${username}' has been reset successfully!` }
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    DEFAULT_USERNAME,
    DEFAULT_PASSWORD,
    MIN_PASSWORD_LENGTH,
    hashPassword,
    verifyPassword,
    isDefaultPassword,
    countUsers,
    getUserByUsername,
    getUserById,
    listUsers,
    createUser,
    deleteUser,
    changePassword,
    resetPassword
};
