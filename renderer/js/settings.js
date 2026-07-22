/**
 * Settings Module
 * Business settings, user management, database backup/export
 */

async function renderSettings() {
    const container = document.getElementById('page-settings');
    
    document.getElementById('topActions').innerHTML = '';

    const result = await window.api.getSettings();
    if (!result.success) {
        container.innerHTML = '<div class="error">Failed to load settings</div>';
        return;
    }

    const settings = result.data;

    const userManagementCard = hasUserManagement() ? `
        <div class="card" style="max-width:600px;margin-top:20px">
            <div class="card-header">
                <h2>User Management</h2>
            </div>
            <div class="settings-section">
                <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" onclick="showCreateUserModal()">➕ New User</button>
                    <button class="btn btn-secondary btn-sm" onclick="showChangePasswordModal()">🔑 Change Password</button>
                    <button class="btn btn-secondary btn-sm" onclick="loadUsersList()">🔄 Refresh</button>
                </div>
                <div id="usersListContainer">
                    <p style="color:var(--text-light);font-size:13px">Loading users...</p>
                </div>
            </div>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="card" style="max-width:600px">
            <div class="card-header">
                <h2>Business Settings</h2>
            </div>
            <div class="settings-section">
                <form id="settingsForm">
                    <div class="form-group">
                        <label>Business Name</label>
                        <input type="text" class="form-control" name="business_name" value="${escapeHtml(settings.business_name || 'Godhuli Dairy Plant')}">
                    </div>
                    <div class="form-group">
                        <label>Address</label>
                        <textarea class="form-control" name="business_address">${escapeHtml(settings.business_address || '')}</textarea>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>Phone</label>
                            <input type="text" class="form-control" name="business_phone" value="${escapeHtml(settings.business_phone || '')}">
                        </div>
                        <div class="form-group">
                            <label>Email</label>
                            <input type="text" class="form-control" name="business_email" value="${escapeHtml(settings.business_email || '')}">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>PAN / VAT</label>
                            <input type="text" class="form-control" name="business_pan" value="${escapeHtml(settings.business_pan || '')}">
                        </div>
                        <div class="form-group">
                            <label>Currency Symbol</label>
                            <input type="text" class="form-control" name="currency_symbol" value="${escapeHtml(settings.currency_symbol || 'रु')}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" name="allow_negative_stock" value="1" ${settings.allow_negative_stock === '1' ? 'checked' : ''}> 
                            Allow Negative Stock (Not recommended)
                        </label>
                    </div>
                    <div class="form-group">
                        <label>Paper Size (for Print / PDF)</label>
                        <select class="form-control" name="paper_size">
                            <option value="A4" ${(settings.paper_size || 'A4') === 'A4' ? 'selected' : ''}>A4 (210 × 297 mm)</option>
                            <option value="Legal" ${settings.paper_size === 'Legal' ? 'selected' : ''}>Legal (216 × 356 mm)</option>
                            <option value="Letter" ${settings.paper_size === 'Letter' ? 'selected' : ''}>Letter (216 × 279 mm)</option>
                        </select>
                    </div>
                </form>
                <div class="btn-group" style="margin-top:16px">
                    <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
                </div>
            </div>
        </div>

        ${userManagementCard}

        <div class="card" style="max-width:600px;margin-top:20px">
            <div class="card-header">
                <h2>Data Management</h2>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div style="padding:16px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:32px;margin-bottom:8px">💾</div>
                    <h3 style="font-size:14px;margin-bottom:8px">Manual Backup</h3>
                    <p style="font-size:12px;color:var(--text-light);margin-bottom:12px">Create a backup right now</p>
                    <button class="btn btn-primary btn-sm" onclick="backupDatabase()">Create Backup Now</button>
                </div>
                <div style="padding:16px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:32px;margin-bottom:8px">📁</div>
                    <h3 style="font-size:14px;margin-bottom:8px">Database Location</h3>
                    <p style="font-size:12px;color:var(--text-light);margin-bottom:12px" id="dbPath">Loading...</p>
                    <button class="btn btn-secondary btn-sm" onclick="showDbPath()">Show Path</button>
                </div>
            </div>

            <!-- Auto-backup status -->
            <div id="autoBackupStatus" style="margin-top:16px;padding:12px 16px;background:var(--bg);border-radius:var(--radius-sm);font-size:13px">
                <div style="display:flex;align-items:center;gap:8px">
                    <span id="autoBackupIcon" style="font-size:18px">⏰</span>
                    <span>Auto-backup is active (every 60 minutes)</span>
                </div>
                <p style="color:var(--text-light);font-size:12px;margin-top:4px" id="autoBackupHint">
                    A backup is created automatically every hour. Backups are kept on the persistent disk and survive restarts.
                </p>
            </div>

            <!-- Backup history -->
            <div id="backupHistory" style="margin-top:16px">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                    <h3 style="font-size:14px;margin:0">Backup History</h3>
                    <button class="btn btn-secondary btn-sm" onclick="loadBackupHistory()" style="font-size:11px">🔄 Refresh</button>
                </div>
                <div id="backupList" style="min-height:60px">
                    <p style="color:var(--text-light);font-size:13px">Loading backups...</p>
                </div>
            </div>
        </div>

        <div class="card" style="max-width:600px;margin-top:20px">
            <div class="card-header">
                <h2>About</h2>
            </div>
            <div style="font-size:13px;color:var(--text-light);line-height:1.8">
                <p><strong>Godhuli Dairy Plant</strong> v1.0.0</p>
                <p>A desktop application for dairy plant accounting and stock management.</p>
                <p>Built with Electron + SQLite.</p>
                <p style="margin-top:12px;font-size:12px">
                    <strong>Stack:</strong> Electron 22, better-sqlite3, vanilla JS<br>
                    <strong>Database:</strong> SQLite (local, offline)<br>
                    <strong>PDF:</strong> Electron built-in printToPDF
                </p>
            </div>
        </div>
    `;

    // Show database path
    showDbPath();
    // Load users list
    loadUsersList();
}

// ============================================================
// User Management Functions
// ============================================================

// Check if user management features are available (web-only, not in Electron)
function hasUserManagement() {
    return typeof window.api !== 'undefined' && typeof window.api.listUsers === 'function';
}

async function loadUsersList() {
    const container = document.getElementById('usersListContainer');
    if (!container) return;

    // In Electron mode, user management is not available (web-only feature)
    if (!hasUserManagement()) {
        container.innerHTML = `<p style="color:var(--text-light);font-size:13px">User management is available in the web version only.</p>`;
        return;
    }

    const result = await window.api.listUsers();
    if (!result.success) {
        container.innerHTML = `<p style="color:var(--danger);font-size:13px">Error: ${escapeHtml(result.error)}</p>`;
        return;
    }

    const users = result.data || [];
    if (users.length === 0) {
        container.innerHTML = '<p style="color:var(--text-light);font-size:13px">No users found.</p>';
        return;
    }

    container.innerHTML = `
        <table class="data-table" style="width:100%;font-size:13px">
            <thead>
                <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th style="width:80px">Action</th>
                </tr>
            </thead>
            <tbody>
                ${users.map(u => `
                    <tr>
                        <td><strong>${escapeHtml(u.username)}</strong></td>
                        <td><span class="badge ${u.role === 'admin' ? 'badge-danger' : 'badge-info'}">${escapeHtml(u.role)}</span></td>
                        <td>${u.is_active ? '<span style="color:var(--accent)">● Active</span>' : '<span style="color:var(--danger)">● Inactive</span>'}</td>
                        <td style="color:var(--text-light);font-size:12px">${u.created_at ? formatDate(u.created_at) : '-'}</td>
                        <td>
                            ${u.username !== 'admin' ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')" style="font-size:11px;padding:2px 8px">Delete</button>` : '<span style="color:var(--text-light);font-size:11px">—</span>'}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function showCreateUserModal() {
    if (!hasUserManagement()) {
        showToast('User management is only available in the web version', 'error');
        return;
    }
    showModal(`
        <div class="modal-header">
            <h2>Create New User</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="min-width:380px">
            <form id="createUserForm" onsubmit="createUser(event)">
                <div class="form-group">
                    <label>Username</label>
                    <input type="text" class="form-control" name="username" placeholder="Choose a username" required minlength="3" autocomplete="off">
                </div>
                <div class="form-group">
                    <label>Password</label>
                    <input type="password" class="form-control" name="password" placeholder="Choose a password" required minlength="4" autocomplete="new-password">
                </div>
                <div class="form-group">
                    <label>Role</label>
                    <select class="form-control" name="role">
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                    </select>
                </div>
                <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Create User</button>
                </div>
            </form>
            <div id="createUserError" style="display:none;margin-top:12px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:13px"></div>
        </div>
    `);
}

async function createUser(event) {
    event.preventDefault();
    const form = document.getElementById('createUserForm');
    const formData = new FormData(form);
    const data = {
        username: formData.get('username').trim(),
        password: formData.get('password'),
        role: formData.get('role')
    };

    const errorEl = document.getElementById('createUserError');
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Creating...';
    errorEl.style.display = 'none';

    const result = await window.api.createUser(data);
    btn.disabled = false;
    btn.textContent = 'Create User';

    if (result.success) {
        showToast(`User '${escapeHtml(data.username)}' created successfully!`);
        closeModal();
        loadUsersList();
    } else {
        errorEl.textContent = result.error || 'Failed to create user';
        errorEl.style.display = 'block';
    }
}

async function deleteUser(id, username) {
    if (!hasUserManagement()) {
        showToast('User management is only available in the web version', 'error');
        return;
    }
    const confirmed = await confirmAction(
        `Delete user "${username}"?`,
        'This action cannot be undone. The user will no longer be able to log in.',
        'Yes, Delete',
        'Cancel'
    );
    if (!confirmed) return;

    const result = await window.api.deleteUser(id);
    if (result.success) {
        showToast(`User '${username}' deleted`);
        loadUsersList();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

function showChangePasswordModal() {
    if (!hasUserManagement()) {
        showToast('User management is only available in the web version', 'error');
        return;
    }
    showModal(`
        <div class="modal-header">
            <h2>Change Password</h2>
            <button class="close-btn" onclick="closeModal()">&times;</button>
        </div>
        <div class="modal-body" style="min-width:380px">
            <form id="changePasswordForm" onsubmit="changePassword(event)">
                <div class="form-group">
                    <label>Current Password</label>
                    <input type="password" class="form-control" name="currentPassword" placeholder="Enter current password" required autocomplete="current-password">
                </div>
                <div class="form-group">
                    <label>New Password</label>
                    <input type="password" class="form-control" name="newPassword" placeholder="Enter new password" required minlength="4" autocomplete="new-password">
                </div>
                <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn btn-primary">Change Password</button>
                </div>
            </form>
            <div id="changePasswordError" style="display:none;margin-top:12px;padding:8px 12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:13px"></div>
        </div>
    `);
}

async function changePassword(event) {
    event.preventDefault();
    const form = document.getElementById('changePasswordForm');
    const formData = new FormData(form);
    const data = {
        currentPassword: formData.get('currentPassword'),
        newPassword: formData.get('newPassword')
    };

    const errorEl = document.getElementById('changePasswordError');
    const btn = form.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = 'Changing...';
    errorEl.style.display = 'none';

    const result = await window.api.changePassword(data);
    btn.disabled = false;
    btn.textContent = 'Change Password';

    if (result.success) {
        showToast('Password changed successfully!');
        closeModal();
    } else {
        errorEl.textContent = result.error || 'Failed to change password';
        errorEl.style.display = 'block';
    }
}

// ============================================================
// Business Settings Functions
// ============================================================

async function saveSettings() {
    const form = document.getElementById('settingsForm');
    if (!form) return;

    const formData = new FormData(form);
    const settings = {};
    for (const [key, value] of formData.entries()) {
        settings[key] = value;
    }
    if (!settings.allow_negative_stock) settings.allow_negative_stock = '0';

    const result = await window.api.saveSettings(settings);
    if (result.success) {
        showToast('Settings saved successfully!');
        clearSettingsCache();
    } else {
        showToast(`Error saving settings: ${result.error}`, 'error');
    }
}

// ============================================================
// Data Management Functions
// ============================================================

async function backupDatabase() {
    const confirmed = await confirmAction(
        'Create a database backup?',
        'A copy of your entire database will be saved to the backup folder.',
        'Yes, Backup',
        'Cancel'
    );

    if (!confirmed) return;

    const result = await window.api.backupDatabase();
    if (result.success) {
        showToast(`Backup created at: ${result.data.path}`);
    } else {
        showToast(`Backup failed: ${result.error}`, 'error');
    }
}

async function showDbPath() {
    const el = document.getElementById('dbPath');
    if (!el) return;
    const result = await window.api.getDatabasePath();
    if (result && result.success && result.data) {
        el.textContent = result.data;
    } else if (result && result.data) {
        el.textContent = result.data;
    } else if (typeof result === 'string') {
        el.textContent = result;
    } else {
        el.textContent = 'Path unavailable';
    }
}

// ============================================================
// Backup History Functions
// ============================================================

function formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatBackupDate(isoStr) {
    if (!isoStr) return 'Unknown';
    try {
        const d = new Date(isoStr);
        return d.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch (e) {
        return isoStr;
    }
}

async function loadBackupHistory() {
    const container = document.getElementById('backupList');
    if (!container) return;

    container.innerHTML = '<p style="color:var(--text-light);font-size:13px">Loading backups...</p>';

    const result = await window.api.listBackups();
    if (!result.success) {
        container.innerHTML = `<p style="color:var(--danger);font-size:13px">Error: ${escapeHtml(result.error)}</p>`;
        return;
    }

    const backups = result.data || [];

    if (backups.length === 0) {
        container.innerHTML = `
            <div style="padding:24px;text-align:center;background:var(--bg);border-radius:var(--radius-sm)">
                <div style="font-size:36px;margin-bottom:8px">📂</div>
                <p style="color:var(--text-light);font-size:13px">No backups yet.</p>
                <p style="color:var(--text-light);font-size:12px">Click "Create Backup Now" above to create your first backup.</p>
            </div>
        `;
        return;
    }

    // Determine the latest backup date for display
    const latestBackup = backups[0];
    const autoBackupHint = document.getElementById('autoBackupHint');
    if (autoBackupHint) {
        autoBackupHint.textContent = `Latest backup: ${formatBackupDate(latestBackup.createdAt)} (${formatFileSize(latestBackup.size)}). Backups are stored on the persistent disk.`;
    }

    container.innerHTML = `
        <div style="background:var(--bg);border-radius:var(--radius-sm);overflow:hidden">
            <table class="data-table" style="width:100%;font-size:12px">
                <thead>
                    <tr>
                        <th style="padding:8px 10px">#</th>
                        <th style="padding:8px 10px">Date & Time</th>
                        <th style="padding:8px 10px">Size</th>
                        <th style="padding:8px 10px;text-align:right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${backups.map((b, i) => `
                        <tr>
                            <td style="padding:8px 10px;color:var(--text-light)">${i + 1}</td>
                            <td style="padding:8px 10px">
                                <strong>${formatBackupDate(b.createdAt)}</strong>
                            </td>
                            <td style="padding:8px 10px;color:var(--text-light)">${formatFileSize(b.size)}</td>
                            <td style="padding:8px 10px;text-align:right">
                                <button class="btn btn-primary btn-sm" onclick="downloadBackup('${escapeHtml(b.filename)}')" style="font-size:11px;padding:3px 10px">⬇ Download</button>
                                <button class="btn btn-danger btn-sm" onclick="deleteBackupFile('${escapeHtml(b.filename)}')" style="font-size:11px;padding:3px 10px">🗑 Delete</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div style="padding:8px 10px;font-size:11px;color:var(--text-light);border-top:1px solid var(--border)">
                Showing ${backups.length} backup${backups.length > 1 ? 's' : ''} — oldest backups are automatically cleaned up
            </div>
        </div>
    `;
}

async function downloadBackup(filename) {
    try {
        const resp = await fetch('/api/backup/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: resp.statusText }));
            showToast(`Download failed: ${err.error || resp.statusText}`, 'error');
            return;
        }
        // Check if the response is JSON (error) or a file blob
        const contentType = resp.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const err = await resp.json();
            if (!err.success) {
                showToast(`Download failed: ${err.error}`, 'error');
                return;
            }
        }
        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`⬇ Downloading: ${filename}`, 'info');
    } catch (err) {
        showToast(`Download failed: ${err.message}`, 'error');
    }
}

async function deleteBackupFile(filename) {
    const confirmed = await confirmAction(
        `Delete backup "${filename}"?`,
        'This will permanently delete this backup file.',
        'Yes, Delete',
        'Cancel'
    );
    if (!confirmed) return;

    const result = await window.api.deleteBackup(filename);
    if (result.success) {
        showToast(`Backup deleted: ${filename}`);
        loadBackupHistory();
    } else {
        showToast(`Error: ${result.error}`, 'error');
    }
}

async function backupDatabase() {
    const confirmed = await confirmAction(
        'Create a database backup?',
        'A copy of your entire database will be saved to the backup folder.',
        'Yes, Backup',
        'Cancel'
    );

    if (!confirmed) return;

    const result = await window.api.backupDatabase();
    if (result.success) {
        const data = result.data || {};
        showToast(`✅ Backup created: ${data.filename || 'success'}`);
        // Refresh the backup history list
        loadBackupHistory();
    } else {
        showToast(`Backup failed: ${result.error}`, 'error');
    }
}

// Globals
window.saveSettings = saveSettings;
window.backupDatabase = backupDatabase;
window.showDbPath = showDbPath;
window.loadUsersList = loadUsersList;
window.showCreateUserModal = showCreateUserModal;
window.createUser = createUser;
window.deleteUser = deleteUser;
window.showChangePasswordModal = showChangePasswordModal;
window.changePassword = changePassword;
window.loadBackupHistory = loadBackupHistory;
window.downloadBackup = downloadBackup;
window.deleteBackupFile = deleteBackupFile;
