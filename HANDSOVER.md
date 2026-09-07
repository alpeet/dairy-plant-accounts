# Prarambha Account & Stock Management — Handover Guide

This guide is for the customer's team after handover. It covers how to install and run the
app (desktop + web + cloud), the mandatory password change, how to refresh data from the
Dairy Account Pro Excel file, and the one rebuild gotcha that bites after building.

---

## 1. Two ways to run the app

### A. Desktop app (Electron, Windows & macOS)

**Windows** — build and install:

```bash
npm install
npm run dist:win        # produces an installer in dist/
```

**macOS** — build the DMG (do this on a Mac):

```bash
npm install
npm run dist:mac        # produces DMGs in dist/ (x64 + arm64)
```

Install the DMG/installer and launch normally.

- The desktop app stores its database in Electron's userData folder:
  - Windows: `%APPDATA%/Prarambha Account & Stock Management/data/dairy-plant.db`
  - macOS: `~/Library/Application Support/Prarambha Account & Stock Management/data/dairy-plant.db`
- On **first launch** the app automatically imports the bundled
  `Dairy_Accounts_Professional.xlsx` into a fresh database (correct BS dates). No manual
  import needed.
- > ⚠️ The current DMGs are **unsigned**. If macOS shows "unidentified developer",
  right-click the app → **Open** → **Open**. For a polished commercial release, sign the
  app with an Apple Developer certificate (≈ $99/year) before shipping.

### B. Web mode (browser / local network)

```bash
npm install
npm start                # or: npm run start:web
```

Then open **http://localhost:3000** (default port; change with the `PORT` env var).

- Data lives in `./data/dairy-plant.db` (project folder).
- To share with a few machines on the office LAN, run with
  `HOST=0.0.0.0` (default) and open `http://<your-machine-ip>:3000` on other PCs.

### C. Cloud (Render) — optional

The repo includes `render.yaml` (Blueprint). Deploying on Render gives the customer a
public URL. Key points:

- Set `AUTH_PASSWORD` in **Render Dashboard → Environment** (never the default).
- Attach a **persistent disk** and point `DB_DIR` to its mount path so the database
  survives restarts.
- The first deploy imports the bundled Excel automatically. To refresh data later, use the
  in-app **Settings → "Update Data from Excel"** page.

---

## 2. ⚠️ Mandatory: change the admin password

**Default login is `admin` / `admin123`.** The app **forces** a password change before
anything else is usable: as soon as anyone logs in while the default password is still in
effect, a blocking screen appears and the rest of the app stays locked (server-enforced)
until the password is changed. Once a new password is set, `admin123` stops working entirely.

**Web mode / Render:** the cleanest setup is to set a strong password up front via the
environment variable:

```bash
AUTH_PASSWORD=your-strong-password npm start
```

On Render: Dashboard → Environment → add/update `AUTH_PASSWORD`.

If you deploy with the default (or forget to set `AUTH_PASSWORD`), there is no risk: the
first login with `admin` / `admin123` will force a password change on screen before the
app can be used.

**Desktop app:** the admin password is set at first run (no default credential exists on
the desktop app), so no forced change is needed there. If a packaged build was made with
the default, the same forced-change screen applies.

---

## 3. Refreshing data from the Dairy Account Pro Excel

The customer keeps maintaining `Dairy_Accounts_Professional.xlsx` in Dairy Account Pro.
Whenever they want the app to reflect the latest Excel data:

1. Get the updated file (`Dairy_Accounts_Professional.xlsx`).
2. In the app, go to **Settings → Data Management → "📥 Update Data from Excel (Dairy Account Pro)"**.
3. Choose one of the two buttons:

| Button | What it does | When to use |
|---|---|---|
| **➕ Add / Update New Records** (recommended) | Adds new invoices/bills/payments and updates existing ones by invoice number. Nothing is deleted, no duplicates. | Routine weekly/monthly sync — safe to run any time. |
| **♻️ Replace ALL Data (Fresh)** | Clears transactional data and re-imports everything from the workbook, rebuilding the stock ledger. A safety backup is created first. | When the workbook itself was rewritten or you want a guaranteed 1:1 mirror. |

- **Desktop app:** click the button and pick the Excel file.
- **Web app:** same page, upload the file (also available at `POST /api/excel/import`).

CLI equivalents (advanced):

```bash
node import-excel-upsert.js    # add/update new records
node import-fresh.js           # replace all data (fresh)
```

Both print a summary of what was imported and create a safety backup first.

---

## 4. The better-sqlite3 rebuild gotcha (important)

The app uses the native module `better-sqlite3`, which is compiled for a specific Node or
Electron version. **Building the desktop DMG recompiles it for Electron**, which breaks web
mode (`npm start`), and vice-versa. If the app crashes on startup with a
`better-sqlite3 ... was compiled against a different Node.js version` error, run:

```bash
# After building a DMG/installer → to run web mode again:
npm rebuild better-sqlite3

# After switching back to desktop/Electron development:
npm run rebuild
```

Then start the app again. This only matters on developer machines that switch between
Electron packaging and web mode — an end-user install of the DMG is unaffected.

---

## 5. Backups & data safety

- **Automatic:** hourly backups (WAL-safe) stored next to the database in `data/backups/`
  (desktop: inside the userData `data/` folder). Old backups are pruned automatically.
- **Manual:** **Settings → Backup** — create, download, restore, and delete backups from
  the UI.
- **External:** copy the database file to a safe location, or export everything to Excel
  with `node data-exchange.js export`.
- Keep the last known-good Excel file and a recent DB backup in two different places.

---

## 6. Known notes & limitations

- **Email (SMTP):** Statements can be emailed via **Settings → Email (SMTP)**, but the
  customer must enter their SMTP host/port/user/password (e.g., Gmail App Password) first.
- **Milk Collection / Farmer Payments:** these modules work, but the current Excel contains
  **no milk-collection data**, so those screens start empty until the customer enters data.
- **Verification tools:** `npm run verify` (20 checks) is safe. `scripts/full-test-suite.js`
  writes test records to the database — **only run it on a copy** of the DB, never on live data.

---

## Quick reference

| Task | Command / action |
|---|---|
| Run web app | `npm start` → http://localhost:3000 |
| Run desktop (dev) | `npm run start:electron` |
| Build Windows installer | `npm run dist:win` |
| Build macOS DMG | `npm run dist:mac` |
| Change web password | `AUTH_PASSWORD=<strong> npm start` |
| Sync latest Excel (add/update) | Settings → Update Data from Excel → ➕ Add / Update |
| Sync latest Excel (fresh) | Settings → Update Data from Excel → ♻️ Replace ALL |
| Web mode broken after DMG build | `npm rebuild better-sqlite3` |
| Desktop broken after web mode | `npm run rebuild` |
| Verify install | `npm run verify` |