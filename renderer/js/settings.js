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

        <div class="card" style="max-width:700px;margin-top:20px">
            <div class="card-header">
                <h2>🗃️ Database Tables</h2>
                <button class="btn btn-secondary btn-sm" onclick="loadTableInfo()">🔄 Refresh</button>
            </div>
            <div id="tableInfoContainer">
                <p style="color:var(--text-light);font-size:13px;padding:12px">Loading table information...</p>
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
                    <strong>Database:</strong> SQLite (local, offline) — 27 tables in 8 functional groups<br>
                    <strong>PDF:</strong> Electron built-in printToPDF
                </p>
            </div>
        </div>
    `;

    // Show database path
    showDbPath();
    // Load users list
    loadUsersList();
    // Load database table info
    loadTableInfo();
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
                                <button class="btn btn-success btn-sm" onclick="restoreBackupFile('${escapeHtml(b.filename)}')" style="font-size:11px;padding:3px 10px">🔄 Restore</button>
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

async function restoreBackupFile(filename) {
    const confirmed = await confirmAction(
        `⚠️ Restore database from backup?`,
        `This will REPLACE your current database with the backup: "${filename}".\n\nA safety backup of your current data will be created automatically before the restore.\n\nThe app will need to reload after restore.`,
        'Yes, Restore',
        'Cancel'
    );
    if (!confirmed) return;

    showToast('⏳ Restoring backup... This may take a moment.', 'info');

    const result = await window.api.restoreBackup(filename);
    if (result.success) {
        showToast(`✅ Database restored from: ${filename}. Reloading app...`, 'success');
        // Reload the app to reconnect with the restored database
        setTimeout(() => {
            window.location.reload();
        }, 2000);
    } else {
        showToast(`Restore failed: ${result.error}`, 'error');
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

// ============================================================
// Database Table Info
// ============================================================

// Store table data for filtering
let _tableInfoData = null;

async function loadTableInfo() {
    const container = document.getElementById('tableInfoContainer');
    if (!container) return;

    container.innerHTML = '<p style="color:var(--text-light);font-size:13px;padding:12px">Loading...</p>';

    const result = await window.api.getTableInfo();
    if (!result.success) {
        container.innerHTML = `<p style="color:var(--danger);font-size:13px">Error: ${escapeHtml(result.error)}</p>`;
        return;
    }

    const data = result.data;
    if (!data || !data.groups) {
        container.innerHTML = '<p style="color:var(--text-light);font-size:13px">No table information available.</p>';
        return;
    }

    _tableInfoData = data;

    // Summary bar
    const dbSizeStr = data.summary.db_size > 0
        ? (data.summary.db_size < 1024 * 1024
            ? (data.summary.db_size / 1024).toFixed(1) + ' KB'
            : (data.summary.db_size / (1024 * 1024)).toFixed(2) + ' MB')
        : 'Unknown';

    // Search bar + summary bar
    let html = `
        <div style="margin-bottom:12px">
            <div style="position:relative">
                <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;opacity:0.5">🔍</span>
                <input type="text" id="tableSearchInput" class="form-control" 
                    placeholder="Search tables by name, category, or description..." 
                    style="padding-left:36px;font-size:13px"
                    onkeyup="filterTableInfo()"
                    autocomplete="off">
                <span id="tableSearchClear" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:16px;cursor:pointer;display:none;opacity:0.5" onclick="clearTableSearch()">✕</span>
            </div>
        </div>
        <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
            <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--primary)">${data.summary.total_tables}</div>
                <div style="font-size:11px;color:var(--text-light)">Total Tables</div>
            </div>
            <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--accent)">${data.summary.total_rows.toLocaleString('en-IN')}</div>
                <div style="font-size:11px;color:var(--text-light)">Total Records</div>
            </div>
            <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--info)">${data.groups.length}</div>
                <div style="font-size:11px;color:var(--text-light)">Functional Groups</div>
            </div>
            <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                <div style="font-size:24px;font-weight:700;color:var(--warning)">${dbSizeStr}</div>
                <div style="font-size:11px;color:var(--text-light)">Database Size</div>
            </div>
        </div>
        <div id="tableGroupsContainer">
    `;

    // Grouped tables
    data.groups.forEach(group => {
        html += renderTableGroup(group, '');
    });

    html += `</div><div id="tableNoResults" style="display:none;text-align:center;padding:40px;color:var(--text-light)">
        <div style="font-size:36px;margin-bottom:8px">🔍</div>
        <p style="font-size:14px">No tables match your search.</p>
        <button class="btn btn-secondary btn-sm" onclick="clearTableSearch()">Clear Search</button>
    </div>`;

    container.innerHTML = html;
}

function renderTableGroup(group, searchTerm) {
    const q = searchTerm.toLowerCase().trim();
    const categoryMatch = !q || group.category.toLowerCase().includes(q) || group.description.toLowerCase().includes(q);
    
    // Filter tables within the group
    const matchingTables = q ? group.tables.filter(t => t.name.toLowerCase().includes(q)) : group.tables;
    const groupHasMatch = categoryMatch || matchingTables.length > 0;
    
    if (q && !groupHasMatch) {
        return ''; // Hide entire group
    }

    const displayTables = q ? matchingTables : group.tables;
    const displayCount = displayTables.length;
    const displayRows = displayTables.reduce((s, t) => s + t.row_count, 0);

    return `
        <div class="table-group" style="margin-bottom:12px;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
            <div style="padding:10px 14px;background:var(--bg);display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="toggleTableGroup(this)">
                <div>
                    <strong style="font-size:14px">${group.category}</strong>
                    <span style="font-size:11px;color:var(--text-light);margin-left:8px">${group.description}</span>
                    ${!categoryMatch && q ? `<span style="font-size:11px;color:var(--warning);margin-left:6px">(${displayCount} table match)</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                    <span style="font-size:11px;color:var(--text-light)">${displayCount} of ${group.table_count} tables · ${displayRows.toLocaleString('en-IN')} records</span>
                    <span style="font-size:12px;transition:transform 0.2s" class="group-toggle-icon">▼</span>
                </div>
            </div>
            <div class="table-group-body" style="border-top:1px solid var(--border)">
                <table style="width:100%;font-size:12px;border-collapse:collapse">
                    <thead>
                        <tr style="background:var(--bg)">
                            <th style="padding:6px 14px;text-align:left;font-weight:600">Table Name</th>
                            <th style="padding:6px 14px;text-align:right;font-weight:600">Records</th>
                            <th style="padding:6px 14px;text-align:center;font-weight:600">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${displayTables.map(t => `
                            <tr style="border-top:1px solid var(--border)">
                                <td style="padding:6px 14px;font-family:monospace;font-size:12px">
                                    ${highlightMatch(t.name, q)}
                                </td>
                                <td style="padding:6px 14px;text-align:right;font-weight:${t.row_count > 0 ? '600' : '400'};color:${t.row_count > 0 ? 'var(--accent)' : 'var(--text-light)'}">
                                    ${t.row_count.toLocaleString('en-IN')}
                                </td>
                                <td style="padding:6px 14px;text-align:center">
                                    ${t.exists
                                        ? '<span style="color:var(--accent);font-size:11px">● Active</span>'
                                        : '<span style="color:var(--danger);font-size:11px">● Missing</span>'
                                    }
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function highlightMatch(text, query) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return text;
    const before = text.substring(0, idx);
    const match = text.substring(idx, idx + query.length);
    const after = text.substring(idx + query.length);
    return `${escapeHtml(before)}<span style="background:#ffd700;color:#333;padding:1px 2px;border-radius:2px;font-weight:700">${escapeHtml(match)}</span>${escapeHtml(after)}`;
}

function filterTableInfo() {
    const input = document.getElementById('tableSearchInput');
    const container = document.getElementById('tableGroupsContainer');
    const noResults = document.getElementById('tableNoResults');
    const clearBtn = document.getElementById('tableSearchClear');
    if (!input || !container || !_tableInfoData) return;

    const query = input.value;
    
    // Show/hide clear button
    if (clearBtn) {
        clearBtn.style.display = query ? 'block' : 'none';
    }

    // Render filtered groups
    let visibleCount = 0;
    let html = '';
    _tableInfoData.groups.forEach(group => {
        const rendered = renderTableGroup(group, query);
        if (rendered) {
            html += rendered;
            visibleCount++;
        }
    });

    container.innerHTML = html;
    
    if (noResults) {
        noResults.style.display = visibleCount === 0 && query ? 'block' : 'none';
    }
}

function clearTableSearch() {
    const input = document.getElementById('tableSearchInput');
    if (input) {
        input.value = '';
        filterTableInfo();
        input.focus();
    }
}

function toggleTableGroup(headerEl) {
    const body = headerEl.nextElementSibling;
    const icon = headerEl.querySelector('.group-toggle-icon');
    if (body && icon) {
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? '' : 'none';
        icon.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
    }
}

// ============================================================
// Dedicated DB Tables Page (sidebar-accessible)
// ============================================================

async function renderDBTables() {
    const container = document.getElementById('page-db-tables');
    document.getElementById('topActions').innerHTML = '';

    // Show loading state
    container.innerHTML = `<div style="max-width:800px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="margin:0">🗃️ Database Tables</h2>
            <div class="btn-group">
                <button class="btn btn-secondary btn-sm" onclick="renderDBTables()">🔄 Refresh</button>
            </div>
        </div>
        <div style="text-align:center;padding:40px;color:var(--text-light)">
            <span style="font-size:32px">🗃️</span>
            <p>Loading database tables...</p>
        </div>
    </div>`;

    // Fetch data
    const result = await window.api.getTableInfo();
    if (!result.success) {
        container.innerHTML = `<p style="color:var(--danger);font-size:13px;padding:20px">Error: ${escapeHtml(result.error)}</p>`;
        return;
    }

    const data = result.data;
    if (!data || !data.groups) {
        container.innerHTML = '<p style="color:var(--text-light);font-size:13px;padding:20px">No table information available.</p>';
        return;
    }

    _tableInfoData = data;

    // Build summary bar
    const dbSizeStr = data.summary.db_size > 0
        ? (data.summary.db_size < 1024 * 1024
            ? (data.summary.db_size / 1024).toFixed(1) + ' KB'
            : (data.summary.db_size / (1024 * 1024)).toFixed(2) + ' MB')
        : 'Unknown';

    // Build all groups HTML
    let groupsHtml = '';
    data.groups.forEach(group => {
        groupsHtml += renderTableGroup(group, '');
    });

    // Full render (uses same renderTableGroup/toggleTableGroup as Settings, 
    // but unique IDs for search/filter elements to avoid DOM conflicts)
    container.innerHTML = `
        <div style="max-width:800px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                <h2 style="margin:0">🗃️ Database Tables</h2>
                <div class="btn-group">
                    <button class="btn btn-secondary btn-sm" onclick="renderDBTables()">🔄 Refresh</button>
                </div>
            </div>
            <div style="margin-bottom:12px">
                <div style="position:relative">
                    <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;opacity:0.5">🔍</span>
                    <input type="text" id="dbtSearchInput" class="form-control" 
                        placeholder="Search tables by name, category, or description..." 
                        style="padding-left:36px;font-size:13px"
                        onkeyup="filterDBTables()"
                        autocomplete="off">
                    <span id="dbtClearBtn" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:16px;cursor:pointer;display:none;opacity:0.5" onclick="clearDBTables()">✕</span>
                </div>
            </div>
            <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:24px;font-weight:700;color:var(--primary)">${data.summary.total_tables}</div>
                    <div style="font-size:11px;color:var(--text-light)">Total Tables</div>
                </div>
                <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:24px;font-weight:700;color:var(--accent)">${data.summary.total_rows.toLocaleString('en-IN')}</div>
                    <div style="font-size:11px;color:var(--text-light)">Total Records</div>
                </div>
                <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:24px;font-weight:700;color:var(--info)">${data.groups.length}</div>
                    <div style="font-size:11px;color:var(--text-light)">Functional Groups</div>
                </div>
                <div style="flex:1;min-width:100px;padding:10px 14px;background:var(--bg);border-radius:var(--radius-sm);text-align:center">
                    <div style="font-size:24px;font-weight:700;color:var(--warning)">${dbSizeStr}</div>
                    <div style="font-size:11px;color:var(--text-light)">Database Size</div>
                </div>
            </div>
            <div id="dbtGroupsContainer">${groupsHtml}</div>
            <div id="dbtNoResults" style="display:none;text-align:center;padding:40px;color:var(--text-light)">
                <div style="font-size:36px;margin-bottom:8px">🔍</div>
                <p style="font-size:14px">No tables match your search.</p>
                <button class="btn btn-secondary btn-sm" onclick="clearDBTables()">Clear Search</button>
            </div>
        </div>
    `;
}

function filterDBTables() {
    const input = document.getElementById('dbtSearchInput');
    const container = document.getElementById('dbtGroupsContainer');
    const noResults = document.getElementById('dbtNoResults');
    const clearBtn = document.getElementById('dbtClearBtn');
    if (!input || !container || !_tableInfoData) return;

    const query = input.value;
    if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

    let visibleCount = 0;
    let html = '';
    _tableInfoData.groups.forEach(group => {
        const rendered = renderTableGroup(group, query);
        if (rendered) { html += rendered; visibleCount++; }
    });

    container.innerHTML = html;
    if (noResults) noResults.style.display = visibleCount === 0 && query ? 'block' : 'none';
}

function clearDBTables() {
    const input = document.getElementById('dbtSearchInput');
    if (input) { input.value = ''; filterDBTables(); input.focus(); }
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
window.restoreBackupFile = restoreBackupFile;
window.loadTableInfo = loadTableInfo;
window.toggleTableGroup = toggleTableGroup;
window.renderDBTables = renderDBTables;
window.filterDBTables = filterDBTables;
window.clearDBTables = clearDBTables;
