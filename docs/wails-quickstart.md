# StreamAI Wails v3 — quick start

> **Stato (2026-05-22):** backend Go completo (9 Service, 54 metodi
> binding TS, libmpv 2.5.0 wiring + HwAccelInfo, single-instance,
> MPRIS2, system tray, crash recovery). Frontend identico a quello
> Electron via compat layer `services/hostBridge.ts`. Player nativo
> con `mpv_render_context_create` → canvas WebGL2 (Fase 6.1)
> **non ancora attivo**: la riproduzione passa ancora per il tag
> `<video>` HTML5 dentro webkit2gtk. Vedi
> [`docs/plan-go-wails-migration.md`](plan-go-wails-migration.md) §3.3.

## Prerequisiti runtime (Linux)

| Pacchetto                                  | Note                                                       |
| ------------------------------------------ | ---------------------------------------------------------- |
| `libwebkit2gtk-4_1-0` (≥ 2.42)             | WebView2 GTK; su distro recenti anche `webkitgtk-6.0`      |
| `libmpv2` (≥ 0.34)                         | Backend player (`-tags mpv`)                               |
| `libva2` + driver (`libva-intel-driver` / `mesa-libgallium` / `nvidia-libXNVCtrl`) | HW decode VA-API/NVDEC |
| `gstreamer-vaapi`                          | HW decode video tag dentro WebView                          |
| `libayatana-appindicator3-1`               | System tray (opzionale)                                    |

Build-time (vedi sotto): `go ≥ 1.22`, `mpv-devel`, `webkit2gtk-4_1-devel`,
`gobject-introspection-devel`, `pkg-config`, `gcc`, `nodejs ≥ 18`.

## Comandi

```bash
# Dev mode (hot reload Vite + Go)
npm run wails:dev

# Build release del binario nativo (≈19 MB, statico tranne libmpv/webkit)
npm run wails:build       # → build/bin/streamai
npm run wails:build:debug # → build/bin/streamai-debug

# Build + esegui
npm run wails:run

# Rigenera i binding TS dai Service Go (dopo aver toccato firme Go)
npm run wails:bindings

# Validazione pre-PR
npm run check             # include check:go (vet + build con tag 'gtk3 mpv')
```

Tutti gli script accettano override via env:

```bash
TAGS="gtk3"          # disabilita libmpv (stub backend)
TAGS=""              # webkitgtk-6.0 (Ubuntu 24.04+, Fedora 40+, Arch)
STREAMAI_DEBUG=1     # forza DevTools anche in build production
STREAMAI_DISABLE_HW=1 # disabilita HW video decode (workaround driver)
```

## Verificare l'accelerazione HW

Il binario Wails apre libmpv con `hwdec=auto-safe` di default. Per
verificare quale driver HW è in uso a runtime:

1. Avvia il binario: `./build/bin/streamai`
2. Apri uno stream qualsiasi.
3. Pannello diagnostica → card **"Host GPU & HW decode"** mostra:
   - `videoDecode = enabled (vaapi|nvdec|videotoolbox|d3d11va|drm)`
   - `hwdec_current` = decoder libmpv attivo
   - `mpv_version` + `libmpv_api_version`

Backend (`internal/services/player/Service.HwAccelInfo()`) legge le
property libmpv `hwdec-current`, `mpv-version`, `video-codec`. Il
frontend lo consuma via `services/hwAccelService.ts → host.getGpuStatus()`
con la stessa shape della controparte Electron.

## Performance già verificata (smoke)

Run #2 SPIKE-1 (NVIDIA RTX 3050 Ti, driver 580.159.03):

| Configurazione  | fps  | p95   | drop  | result |
| --------------- | ---- | ----- | ----- | ------ |
| 1080p60 NVDEC   | 60.1 | 16.95 | 0/481 | warn¹  |
| 4K60   NVDEC    | 58.7 | 18.19 | 15/470| fail²  |

¹ warn = il KPI include il vsync wait (16.6 ms a 60 Hz). Visualmente
fluido senza drop. Refactor `glFenceSync` previsto, vedi
[`docs/spike1-results-2026-05-22.md`](spike1-results-2026-05-22.md).

² fail = readback RGBA8 satura il PCIe a 4K (~2 GB/s sostenuti). Fase
6.1 introdurrà transport T2 (DMA-BUF zero-copy) per sbloccare 4K.

Cold-start binario (sul dev host openSUSE TW): **140 ms** vs ~2-3 s di
Electron (target piano: −60 % RAM, cold-start ≤ Electron ✓).

## Differenze chiave dalla versione Electron

| Aspetto                  | Electron                       | Wails v3                                   |
| ------------------------ | ------------------------------ | ------------------------------------------ |
| Runtime                  | Node.js + Chromium             | Go + webkit2gtk-4.1 / WebView2 / WKWebView |
| Bundle size              | ~150 MB (ASAR + electron-core) | ~19 MB binario statico                     |
| Cold start (Linux)       | 2-3 s                          | ~140 ms                                    |
| HW decode                | Chromium switches              | libmpv `hwdec=auto-safe`                   |
| IPC backend ↔ frontend   | `ipcMain` / `electronAPI`      | Wails bindings TS auto-generati            |
| Single-instance          | `app.requestSingleInstanceLock`| flock + Unix socket                        |
| HEVC                     | patch FFmpeg custom (BranchBit)| webkit + gstreamer-vaapi                   |
| Tray                     | `electron.Tray`                | libayatana-appindicator                    |

## Roadmap residua

- **Fase 6.1**: `vo=libmpv` + `mpv_render_context_create` + canvas WebGL2
  (gated SPIKE-1 ✅ smoke, SPIKE-3 zero-copy ⏳, SPIKE-4 AV-sync ⏳).
- **Fase 8**: packaging Linux .deb/.rpm/.pkg.tar.zst per la versione
  Wails parallelo a quella Electron (target piano: convivenza durante
  la transizione, deprecazione Electron solo dopo che la Wails è
  production-grade).
- **Fase 9 / 9-bis**: build Windows + macOS notarized.

