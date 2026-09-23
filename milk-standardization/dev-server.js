/**
 * Milk Standardization Calculator — optional browser host
 * ============================================================
 * The desktop app is the product; this zero-dependency Node server runs the
 * exact same renderer in a browser (handy for quick checks and for shop-floor
 * laptops where nothing may be installed).
 *
 *   node dev-server.js            → http://127.0.0.1:4180
 *   node dev-server.js --port 4200
 *
 * Data lives in ./data/milk-standardization-data.json next to this file.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const storeLib = require('./shared/store');

const ROOT = __dirname;
const RENDERER_DIR = path.join(ROOT, 'renderer');
const SHARED_DIR = path.join(ROOT, 'shared');
const DATA_FILE = path.join(ROOT, 'data', 'milk-standardization-data.json');

const ARGS = process.argv.slice(2);
function argValue(flag, fallback) {
    const index = ARGS.indexOf(flag);
    if (index !== -1 && ARGS[index + 1]) return ARGS[index + 1];
    return fallback;
}

const START_PORT = Number(argValue('--port', process.env.PORT || 4180));
const HOST = argValue('--host', '127.0.0.1');

const store = storeLib.createStore(storeLib.fileAdapter(DATA_FILE));

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8'
};

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function sendText(res, status, text, contentType) {
    res.writeHead(status, {
        'Content-Type': contentType || 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(text),
        'Cache-Control': 'no-store'
    });
    res.end(text);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 25 * 1024 * 1024) {
                reject(new Error('Payload too large'));
                req.destroy();
                return;
            }
            raw += chunk;
        });
        req.on('end', () => {
            if (!raw) return resolve({});
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                reject(new Error('Invalid JSON body'));
            }
        });
        req.on('error', reject);
    });
}

function serveStatic(res, pathname) {
    let relative = decodeURIComponent(pathname);
    if (relative === '/' || relative === '') relative = '/index.html';

    // /shared/* is served from the shared folder so index.html can use ../shared/x.js
    let baseDir = RENDERER_DIR;
    if (relative.startsWith('/shared/')) {
        baseDir = SHARED_DIR;
        relative = relative.slice('/shared'.length);
    }

    const filePath = path.normalize(path.join(baseDir, relative));
    if (!filePath.startsWith(baseDir)) {
        sendText(res, 403, 'Forbidden');
        return;
    }
    fs.readFile(filePath, (err, data) => {
        if (err) {
            sendText(res, 404, 'Not found: ' + pathname);
            return;
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
            'Content-Length': data.length,
            'Cache-Control': 'no-store'
        });
        res.end(data);
    });
}

async function handleApi(req, res, pathname, query) {
    const method = req.method.toUpperCase();

    if (pathname === '/api/info') {
        sendJson(res, 200, {
            isDesktop: false,
            name: 'Milk Standardization Calculator',
            version: '1.0.0 (browser host)',
            platform: process.platform,
            node: process.versions.node,
            dataDir: path.dirname(DATA_FILE),
            dataFile: DATA_FILE
        });
        return true;
    }

    if (pathname === '/api/settings' && method === 'GET') {
        sendJson(res, 200, store.getSettings());
        return true;
    }
    if (pathname === '/api/settings' && (method === 'POST' || method === 'PUT')) {
        sendJson(res, 200, store.saveSettings(await readBody(req)));
        return true;
    }
    if (pathname === '/api/settings/reset' && method === 'POST') {
        sendJson(res, 200, store.resetSettings());
        return true;
    }

    if (pathname === '/api/history' && method === 'GET') {
        sendJson(res, 200, store.listHistory());
        return true;
    }
    if (pathname === '/api/history' && method === 'POST') {
        sendJson(res, 200, store.addHistory(await readBody(req)));
        return true;
    }
    if (pathname === '/api/history' && method === 'DELETE') {
        sendJson(res, 200, { removed: store.clearHistory() });
        return true;
    }
    const itemMatch = pathname.match(/^\/api\/history\/([^/]+)$/);
    if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1]);
        if (method === 'GET') {
            const found = store.getHistory(id);
            if (!found) return sendJson(res, 404, { error: 'Not found' }), true;
            sendJson(res, 200, found);
            return true;
        }
        if (method === 'PATCH' || method === 'PUT') {
            const updated = store.updateHistory(id, await readBody(req));
            sendJson(res, updated ? 200 : 404, updated || { error: 'Not found' });
            return true;
        }
        if (method === 'DELETE') {
            sendJson(res, 200, { removed: store.deleteHistory(id) });
            return true;
        }
    }

    if (pathname === '/api/state' && method === 'GET') {
        sendJson(res, 200, store.exportState());
        return true;
    }
    if (pathname === '/api/state' && method === 'POST') {
        const body = await readBody(req);
        sendJson(res, 200, store.importState(body.state || body, body.options || {}));
        return true;
    }
    if (query.has('download')) {
        const state = store.exportState();
        const stamp = new Date().toISOString().slice(0, 10);
        res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': 'attachment; filename="milk-standardization-backup-' + stamp + '.json"'
        });
        res.end(JSON.stringify(state, null, 2));
        return true;
    }

    return false;
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    try {
        if (pathname.startsWith('/api/')) {
            const handled = await handleApi(req, res, pathname, parsed.query);
            if (!handled) sendJson(res, 404, { error: 'Unknown endpoint: ' + pathname });
            return;
        }
        serveStatic(res, pathname);
    } catch (err) {
        sendJson(res, 500, { error: String(err && err.message ? err.message : err) });
    }
});

function listen(port, attemptsLeft) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
            listen(port + 1, attemptsLeft - 1);
        } else {
            console.error('Could not start the server:', err.message);
            process.exit(1);
        }
    });
    server.listen(port, HOST, () => {
        const link = 'http://' + HOST + ':' + port;
        console.log('Milk Standardization Calculator (browser host)');
        console.log('  → ' + link);
        console.log('  data file: ' + DATA_FILE);
        console.log('  press Ctrl+C to stop');
    });
}

listen(START_PORT, 10);
