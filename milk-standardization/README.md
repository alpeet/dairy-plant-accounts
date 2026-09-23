# Milk Standardization Calculator

**Offline desktop app for milk fat / SNF standardization** — the mass-balance methods used
industry-wide for cream separation, cream addition, skim milk addition, water dilution and
SMP reconstitution.

Runs as a native **Windows / macOS desktop app** (Electron) and also serves the identical
UI in a browser for quick checks. No login, no accounts, no internet, no external database.

> **The headline case:** 480 L of raw milk at 5.5% fat → how much cream to separate to reach
> **3.5% fat**? This app answers **26.30 L of cream** (at 40% fat), leaving 453.70 L of
> standardized milk, and reports the resulting **8.98% SNF** against your configured minimum.

---

## What it does

| Module | Details |
|---|---|
| **1 · Cream separation** | `Wc = W × (F1 − F2) ÷ (Fc − F2)` — fat reduction |
| **2 · Cream addition** | `Wc = W × (F2 − F1) ÷ (Fc − F2)` — fat increase (reverse case) |
| **3 · Skim milk addition** | `Ws = W × (F1 − F2) ÷ (F2 − Fs)` — fat reduction, volume rises |
| **4 · Water dilution** | `Ww = W × (F1 − F2) ÷ F2` — fat falls **and SNF falls with it** |
| **5 · SNF tracking** | `SNF = (W×SNF1 ± Wx×SNFx) ÷ (W ± Wx)` after every operation |
| **5b · SMP reconstitution** | `SMP = Wt × (SNF_target − SNF_current) ÷ (SMP_SNF − SNF_target)` |
| **6 · CLR / lactometer** | Richmond's formula `SNF% = (CLR ÷ 4) + (0.2 × Fat%) + 0.14`, forward **and** reverse |

Plus: instant recalculation, pass/fail against **your** configured minimums, printable
standardization report per batch, batch history, CSV export and JSON backup/restore.

### Built-in safety rails

* Impossible inputs produce a **plain-language error**, never a crash or a silent wrong number
  (e.g. cream fat ≤ target fat in separation, target fat above raw fat in a reduction mode,
  target SNF richer than the SMP content).
* Rejects calculations that would consume the entire batch.
* **Water addition always shows a danger-level warning** naming the exact SNF it destroys —
  dilution for fat adjustment is normally not permitted, so it is never hidden.
* Flags any result that lands below the configured minimum, and flags a *target* that is
  already below the minimum before you start.
* The mass-balance **working is shown** (formula, substitution, result) for every batch, so a
  result can be audited line by line.

---

## Running it

### Desktop (development)

```bash
cd milk-standardization
npm install          # Electron + electron-builder (dev only; app has zero runtime deps)
npm start            # or: npm run start:electron
```

### Browser host (optional)

Useful for a shop-floor laptop where nothing may be installed:

```bash
npm run web          # → http://127.0.0.1:4180   (auto-picks the next free port)
```

Opening `renderer/index.html` directly in a browser also works — it falls back to
localStorage instead of the JSON file.

### Building installers

```bash
npm run pack         # unpacked directory, for testing
npm run dist:win     # Windows: NSIS installer + portable exe
npm run dist:mac     # macOS: DMG (arm64 and x64)
```

Artifacts land in `dist/`:

| File | What it is |
|---|---|
| `Milk-Standardization-Portable-1.0.0.exe` | **Portable Windows exe** — copy it anywhere (even a USB stick) and run. Keeps its data in the per-user app data folder. |
| `Milk-Standardization-Setup-1.0.0-x64.exe` | Windows NSIS installer, choose-your-folder, desktop + start-menu shortcuts |
| `Milk-Standardization-1.0.0-arm64.dmg` | **macOS Apple Silicon** (M1–M4) |
| `Milk-Standardization-1.0.0-x64.dmg` | **macOS Intel** |

Each build also leaves staging folders (`mac/`, `mac-arm64/`, `win-unpacked/`) and
`.blockmap` update metadata under `dist/`. Those are intermediates, not deliverables — the four
files above are all you keep.

**Signing.** The builds above are unsigned, so build them with auto-discovery switched off
(without a certificate electron-builder otherwise tries to reach Apple's timestamp server and fails):

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:win     # cross-builds fine from macOS
```

Unsigned macOS apps need one right-click → **Open** → **Open** on first launch.
Windows SmartScreen will show a "more info → run anyway" prompt until the exe is signed.

Windows cross-builds from macOS need NSIS + Wine, which electron-builder caches in
`~/Library/Caches/electron-builder` after the first online run — afterwards the build works offline.

`electron` and `electron-builder` are **pinned to exact versions** in `devDependencies`:
electron-builder cannot infer an Electron version from a loose range when `node_modules` has not
been installed locally (see electron-builder issue #3984).

No application icon is bundled yet, so installers use the default Electron icon. Add
`assets/icon.icns` / `assets/icon.ico` and an `"icon"` entry under `build.mac` / `build.win`
to brand them.

---

## Verification

```bash
npm run check        # syntax check every module
npm test             # 24 engine + store tests (node --test)
```

The engine tests cover the spec example, all four modes, SNF mass balance, SMP reconstitution,
Richmond's formula round-trips, every validation rule, warning isolation per mode, and the
store's history limit / backup round-trip.

There is also an end-to-end desktop self-test that boots the real Electron shell, exercises the
preload bridge, IPC, history read/write/delete, settings round-trip and the PDF pipeline:

```bash
npm start -- --smoke                       # 10 checks
npm start -- --smoke --smoke-pdf=out.pdf   # + writes a real A4 PDF and checks it
```

The same self-test can be run against a **packaged build**, which is how the shipped installers
were verified — mount the DMG and run the binary inside it:

```bash
hdiutil attach dist/Milk-Standardization-1.0.0-arm64.dmg -nobrowse
"/Volumes/Milk Standardization Calculator 1.0.0/Milk Standardization Calculator.app/Contents/MacOS/Milk Standardization Calculator" --smoke
hdiutil detach "/Volumes/Milk Standardization Calculator 1.0.0"
```

---

## Data, backup and records

Everything lives in one JSON file, written atomically (temp file + rename):

| Mode | Location |
|---|---|
| Desktop | `%APPDATA%/Milk Standardization Calculator/…` · `~/Library/Application Support/Milk Standardization Calculator/…` |
| Browser host | `milk-standardization/data/milk-standardization-data.json` |
| `file://` | browser localStorage |

* **Backup JSON** writes a timestamped copy you can keep anywhere (Settings → Data, or History toolbar).
* **Restore** reads a backup back in; the previous state is preserved as `backup-<timestamp>.json`
  next to the data file before any destructive write.
* **Clear history** deletes records only, not settings, and takes a safety backup first.
* **Export CSV** produces one row per batch with every input, result and compliance verdict —
  ready for an audit folder or a spreadsheet.

### Printable report

Per batch: plant identity, batch/supplier/operator, all inputs, the result table, a compliance
check against your minimums, the full mass-balance working, warnings, remarks and three
signature lines. Print it, or export it as a real PDF (Electron `printToPDF`) — both are offline.

---

## Configure your own minimums

Minimum fat and SNF limits differ by country, state and milk class, so **nothing is hard-coded**.
Settings → *Regulatory minimums* holds a fat and SNF minimum per milk type (cow / buffalo / mixed),
and the whole check can be switched off. The values shipped with the app are **placeholders to be
replaced**, and every report carries a footer saying so.

Set any minimum to `0` to disable that check for that milk type.

---

## Assumptions worth knowing

1. **One unit throughout.** Formulas are ratios, so enter litres and read cream in litres, or
   enter kilograms and read cream in kilograms. Percentages are by mass, as they are on a milk
   analyser. (Real plants often weigh; if you work in kg, everything stays consistent.)
2. **The separator must deliver the cream fat you specify.** The removed cream is assumed to
   leave at `Fc%` fat; if the separator is set differently, the remaining milk will not land
   on target.
3. **Cream ≈ 2% SNF, skim ≈ 9% SNF, SMP ≈ 96% SNF / 1% fat** are editable starting values, not
   measured constants. Change them in Settings or per calculation.
4. **SMP reconstitution is shown as its own step** with its own mass and resulting volume.
   Because powder carries ~1% fat, adding it moves the fat slightly — the app says by how much
   and suggests re-checking fat afterwards.
5. **Richmond's formula is an estimate.** It needs CLR corrected to 27 °C; a direct SNF meter or
   lab result is always preferable, which is why direct entry is the default.
6. **Water addition is modelled, not endorsed.** The app calculates it and warns loudly.

---

## Project structure

```
milk-standardization/
├── main.js                  Electron main process — window, menu, IPC, PDF/print, dialogs
├── preload.js               contextBridge surface exposed as window.api
├── dev-server.js            zero-dependency browser host + REST API
├── shared/
│   ├── calc.js              calculation engine (mass balance, SNF, SMP, Richmond)
│   ├── defaults.js          editable default settings and milk types
│   └── store.js             settings + history store, with swappable persistence adapters
├── renderer/
│   ├── index.html           four views: Standardize · Batch History · Tools · Settings
│   ├── css/style.css        application theme
│   ├── css/print.css        print-only swap rules
│   └── js/
│       ├── api.js           dual-mode client (IPC / HTTP / localStorage)
│       ├── ui.js            formatting, toasts, modal, CSV helpers
│       ├── calculator.js    the Standardize view + form logic
│       ├── history.js       batch history, filters, report preview, CSV/backup
│       ├── tools.js         CLR / lactometer tool
│       ├── settings.js      plant identity, defaults, minimums, data
│       ├── report.js        standardization report + CSV rows
│       └── app.js           bootstrap, tabs, application menu
└── tests/calc.test.js       engine + store test suite
```

The engine (`shared/calc.js`) is pure and dependency-free, so it can be reused from scripts,
Excel tooling or a future mobile shell.

---

## Offline guarantee

No network calls anywhere in the app, no telemetry, no accounts. The only external processes are
local: the Electron window, and — if you choose it — the browser host on `127.0.0.1`.

## License

MIT
