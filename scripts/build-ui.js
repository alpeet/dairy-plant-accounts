/**
 * Builds renderer/js/ui.bundle.js — a single, committed IIFE bundle of the
 * React shell + dashboard (React, Motion, lucide-react included).
 *
 * The app itself stays bundler-free at runtime: no dev server, no module
 * loader, no CDN. Electron and the web server simply load the built file.
 * Run with: npm run build:ui
 */

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild.build({
    entryPoints: [path.join(root, 'renderer/ui/src/index.jsx')],
    outfile: path.join(root, 'renderer/js/ui.bundle.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    loader: { '.js': 'jsx' },
    logLevel: 'info'
}).then(() => {
    console.log('ui.bundle.js written');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
