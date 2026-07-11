# Godhuli Dairy Plant

**Accounts & Stock Management System** — Desktop + Web

A professional dairy plant accounting and stock management application that runs as both a **desktop app** (Electron) and a **web app** (Express.js browser-based). Both modes share the same frontend code, database schema, and business logic.

---

## Quick Start

### Web Mode (Recommended for most users)

```bash
# 1. Install dependencies (one-time)
npm install --omit=optional

# 2. Start the web server
npm start

# 3. Open in browser
#    → http://localhost:3000
#    → Login: admin / admin123
```

### Desktop Mode (Electron)

```bash
# 1. Install ALL dependencies (includes Electron)
npm install

# 2. Seed demo data (optional)
npm run seed

# 3. Start the Electron app
npm run start:electron
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   DUAL-PLATFORM SYSTEM                       │
├─────────────────────┬───────────────────────────────────────┤
│   DESKTOP APP       │          WEB APP                      │
│   (Electron)        │       (Express.js)                    │
├─────────────────────┼───────────────────────────────────────┤
│  ┌───────────────┐  │  ┌─────────────────────────────────┐  │
│  │   main.js     │  │  │   server.js                      │  │
│  │  (IPC handlers)│  │  │  (REST API + Auth + Static)     │  │
│  └───────┬───────┘  │  └──────────────┬──────────────────┘  │
│          │          │                 │                      │
│  ┌───────▼───────┐  │  ┌──────────────▼──────────────────┐  │
│  │   preload.js  │  │  │   renderer/js/api.js            │  │
│  │  (IPC bridge) │  │  │  (fetch-based HTTP client)       │  │
│  └───────┬───────┘  │  └──────────────┬──────────────────┘  │
│          │          │                 │                      │
│  ┌───────▼────────────────────────────▼──────────────────┐  │
│  │                 SHARED FRONTEND                        │  │
│  │   renderer/index.html + renderer/js/*.js + style.css   │  │
│  └──────────────────────┬────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────▼────────────────────────────────┐  │
│  │               SHARED DATABASE LAYER                    │  │
│  │   shared/db.js     →    database/schema.sql            │  │
│  │                     →    data/dairy-plant.db (SQLite)   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **Single codebase** | The `renderer/` folder is shared 100% between desktop and web. No code duplication. |
| **Dual-mode API client** | `renderer/js/api.js` works with both Electron IPC and HTTP fetch. Same interface, different transport. |
| **Shared database** | Both modes use the same SQLite schema and can use the same database file. |
| **Auth only for web** | The desktop app remains offline/no-auth. The web version adds authentication via in-memory tokens. |
| **Vanilla JS frontend** | No React/Vue dependency. Keeps the app lightweight, maintainable, and easy to customize. |
| **Print/PDF shared** | Shared `PRINT_CSS` in `utils.js` powers both Electron's `printToPDF()` and the web's `window.print()`. |

---

## Features

### Core Modules

| Module | Desktop | Web | Description |
|---|---|---|---|
| **Dashboard** | ✅ | ✅ | Summary cards, monthly chart, recent transactions, low stock alerts |
| **Sales** | ✅ | ✅ | Create/edit/delete invoices, auto-stock deduction, ledger update, print, PDF |
| **Purchases** | ✅ | ✅ | Create/edit/delete bills, auto-stock addition, ledger update, print, PDF |
| **Stock / Inventory** | ✅ | ✅ | Product master, current stock, stock movements, adjustments, print, PDF |
| **Milk Collection** | ✅ | ✅ | Farmer milk intake tracking with fat/SNF, quality parameters, auto-ledger |
| **Party / Ledger** | ✅ | ✅ | Customer/supplier management, full financial ledger with running balance |
| **Farmer Payments** | ✅ | ✅ | Bulk payment settlement for milk collections, batch processing |
| **Reports** | ✅ | ✅ | Sales, purchases, day book, outstanding receivables/payables, print, PDF |
| **Settings** | ✅ | ✅ | Business info, currency, paper size, database backup |
| **Data Exchange** | ✅ | ✅ | Excel/CSV import/export via `data-exchange.js` |

### Print & PDF Export

Both modes support professional print and PDF export:
- **Desktop:** Uses Electron's built-in `webContents.printToPDF()` for native PDF generation
- **Web:** Uses `window.open()` + `window.print()` with "Save as PDF" option
- **Shared templates:** All print layouts use the same `PRINT_CSS` from `renderer/js/utils.js`
- **Professional design:** Business header, company details, itemized tables, totals, signatures, page numbers

---

## Project Structure

```
dairy-plant-accounts/
│
├── main.js                  # 🔵 DESKTOP: Electron main process (IPC handlers)
├── preload.js               # 🔵 DESKTOP: IPC bridge (contextBridge)
├── server.js                # 🟢 WEB: Express server + auth + REST API
├── package.json             # Project config and scripts
│
├── shared/
│   ├── db.js                # 🟡 SHARED: Database initialization & migrations
│   └── ...                  # (More shared modules can be added here)
│
├── renderer/                # 🟡 SHARED FRONTEND (used by both desktop & web)
│   ├── index.html           # Main application shell
│   ├── login.html           # 🟢 WEB ONLY: Login page
│   ├── css/
│   │   ├── style.css        # Main application theme
│   │   ├── print.css        # Print/PDF stylesheet
│   │   └── login.css        # 🟢 WEB ONLY: Login page styles
│   └── js/
│       ├── app.js           # Router & navigation
│       ├── api.js           # Dual-mode API client (IPC + HTTP)
│       ├── auth.js          # 🟢 WEB ONLY: Auth check on page load
│       ├── login.js         # 🟢 WEB ONLY: Login page logic
│       ├── utils.js         # Utilities: toast, modal, format, PRINT_CSS
│       ├── dashboard.js     # Dashboard module
│       ├── sales.js         # Sales module
│       ├── purchases.js     # Purchases module
│       ├── stock.js         # Stock/Inventory module
│       ├── milk_collection.js # Milk collection module
│       ├── party.js         # Party/Ledger module
│       ├── farmer_payment.js # Farmer payment settlement
│       ├── reports.js       # Reports module
│       └── settings.js      # Settings module
│
├── database/
│   ├── schema.sql           # SQLite schema (single source of truth)
│   ├── seed.js              # Demo data seeder (for web)
│   └── seed-electron.js     # Demo data seeder (for Electron)
│
├── data/                    # Database files
│   └── dairy-plant.db       # SQLite database (auto-created)
│
├── scripts/                 # Testing & utility scripts
│   ├── full-test-suite.js
│   └── test-sale.js
│
├── data-exchange.js         # Excel/CSV import/export tool
├── verify.js                # Portable transfer verification
│
├── start.sh                 # macOS/Linux launcher
├── start.bat                # Windows launcher
├── .env.example             # Environment variables template
│
└── assets/                  # App icons
```

---

## Running the Application

### Web Mode (Primary)

The web mode is the easiest way to use the app. No Electron required.

```bash
# Start with default settings
npm start

# Start with custom port and auth
PORT=8080 AUTH_USERNAME=myuser AUTH_PASSWORD=mypassword npm start

# Start with .env file
cp .env.example .env
# Edit .env with your settings
npm start
```

Open **http://localhost:3000** and log in with your credentials (default: `admin` / `admin123`).

### Desktop Mode (Electron)

For offline use or when a standalone desktop app is preferred.

```bash
# Install with Electron support
npm install

# Seed demo data (run once)
npm run seed

# Start the desktop app
npm run start:electron
```

### Desktop (Portable / USB Mode)

The app can run portably from a USB drive without installation. Copy the entire project folder to a USB drive and run:

**macOS / Linux:**
```bash
./start.sh
```

**Windows:**
```
Double-click start.bat
```

The launcher auto-installs dependencies (one-time), starts the web server, and opens the browser.

---

## Configuration

### Environment Variables (`.env`)

Copy `.env.example` to `.env` and customize:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Web server port |
| `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` = all interfaces, `127.0.0.1` = local only) |
| `AUTH_USERNAME` | `admin` | Web login username |
| `AUTH_PASSWORD` | `admin123` | Web login password |
| `DB_PATH` | `./data` | Database directory |
| `DB_NAME` | `dairy-plant.db` | Database filename |
| `NODE_ENV` | `development` | Environment mode |

### Settings (in-app)

The Settings page allows configuring:
- Business name, address, phone, email, PAN/VAT
- Currency symbol
- Paper size for print/PDF (A4, Legal, Letter)
- Allow/block negative stock
- Database backup

---

## Database

### Engine
- **SQLite** via `better-sqlite3`
- Zero configuration — no database server needed
- Portable — the database file can be copied to another machine

### Location
- **Web mode:** `./data/dairy-plant.db` (in the project folder)
- **Desktop mode:** Electron's `userData` directory:
  - Windows: `%APPDATA%/Godhuli Dairy Plant/dairy-plant.db`
  - macOS: `~/Library/Application Support/Godhuli Dairy Plant/dairy-plant.db`

### Schema

| Table | Records |
|---|---|
| `parties` | Customers, suppliers (with opening balance) |
| `products` | Product master with rate, unit, reorder level |
| `stock_movements` | Complete inventory ledger (all in/out) |
| `sales` | Sales invoice headers |
| `sales_items` | Sales line items |
| `purchases` | Purchase bill headers |
| `purchase_items` | Purchase line items |
| `ledger_entries` | Party-wise financial ledger (running balance) |
| `milk_collections` | Daily milk intake from farmers |
| `payments` | Payment and receipt records |
| `settings` | Application settings (key-value) |

### Seeding Demo Data

```bash
# Web mode
npm run seed:web

# Desktop mode
npm run seed         # Or: electron database/seed-electron.js
```

### Backup

- **In-app:** Settings page has a backup button
- **Manual:** Copy `data/dairy-plant.db` to a safe location
- **Automated:** Run `node data-exchange.js export` to export all data to Excel

---

## Data Exchange (Excel / CSV)

The `data-exchange.js` tool enables two-way data sync between SQLite and Excel/CSV:

```bash
# Export database to Excel (preserves all existing sheets)
node data-exchange.js export

# Import Excel into database (upserts by ID)
node data-exchange.js import

# Export to CSV files
node data-exchange.js export --csv

# Import from CSV files
node data-exchange.js import --csv
```

See the script for detailed table-to-sheet mappings.

---

## Authentication (Web Only)

The web version includes a simple token-based authentication system:

- **Login:** POST `/api/auth/login` with username/password
- **Verify:** POST `/api/auth/verify` with Bearer token
- **Logout:** POST `/api/auth/logout` invalidates the token
- **Default credentials:** `admin` / `admin123` (change via `.env`)
- **Token storage:** In-memory on server, `sessionStorage` on client
- **All API routes** require authentication (except auth endpoints)
- **Static files** redirect unauthenticated users to the login page

**Important:** This is a single-user auth system designed for small business use. For multi-user or internet-facing deployments, add a more robust auth layer.

---

## Development

### Making Changes

The architecture makes it easy to add features:

1. **Add a new module:** Create `renderer/js/new-module.js`, add a nav item in `renderer/index.html`, register in `renderer/js/app.js`
2. **Add API endpoints:** Add routes in `server.js` (or better, extract into `shared/operations/`)
3. **Extend the database:** Update `database/schema.sql` and add migrations in `shared/db.js`
4. **Desktop-only feature:** Add IPC handlers in `main.js` and expose via `preload.js`
5. **Web-only feature:** Add auth-aware logic in `server.js`

### Building for Distribution

```bash
# Electron builds
npm run dist:win      # Windows NSIS installer
npm run dist:mac      # macOS DMG
npm run pack          # Unpacked directory (for testing)
```

### Verification

Run the verification script to check if everything is ready for transfer:

```bash
node verify.js
```

---

## Security Notes

- The web auth system uses in-memory tokens — tokens are lost on server restart
- Credentials are configured via environment variables or `.env` file
- For production deployment:
  - Use `AUTH_USERNAME` and `AUTH_PASSWORD` environment variables
  - Set `HOST=127.0.0.1` if only local access is needed
  - Consider using a reverse proxy (nginx, Caddy) for HTTPS
  - The app is designed for local network use, not internet-facing

---

## Testing Checklist

After changes, verify:

### Desktop (Electron)
- [ ] Electron app starts without errors (`npm run start:electron`)
- [ ] Dashboard loads with correct data
- [ ] Sales create/edit/delete works
- [ ] Purchases create/edit/delete works
- [ ] Stock adjusts and movements show correctly
- [ ] Milk collections save and update stock/ledger
- [ ] Party ledger shows correct balances
- [ ] Reports generate with correct totals
- [ ] Print and PDF export work (Electron printToPDF)
- [ ] Settings save correctly
- [ ] Backup creates a valid copy

### Web
- [ ] Server starts without errors (`npm start`)
- [ ] Login page appears at `/login`
- [ ] Valid credentials log in successfully
- [ ] Invalid credentials show error
- [ ] All modules work after login
- [ ] Page refresh preserves session
- [ ] Logout invalidates session
- [ ] API calls without token return 401
- [ ] Print opens print dialog with correct layout
- [ ] PDF export generates downloadable file
- [ ] Reports match desktop version
- [ ] Ledger calculations match desktop version
- [ ] Stock calculations match desktop version

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop Runtime | **Electron 22** (last version supporting Windows 7) |
| Web Server | **Express.js** (Node.js) |
| Database | **SQLite** via `better-sqlite3` |
| Frontend | **Vanilla JS** (no framework) |
| API Transport | **IPC** (desktop) / **HTTP REST** (web) |
| Auth | **Bearer token** (in-memory, web only) |
| Print/PDF | **Electron printToPDF** / **Browser print** |
| Data Exchange | **SheetJS (xlsx)** for Excel, CSV |
| Styling | **Custom CSS** with professional accounting theme |

---

## License

MIT

---

## Support & Contribution

For issues, feature requests, or questions, please open an issue on the project repository.
