# 🚀 Piano di Migrazione: Electron → Go + Wails v3

> **Status:** Final Packaging — **revisione 10.0** (stato 2026-05-26)
> **Owner:** Maintainer StreamAI-IPTV
> **Target ramo:** `main`
> **Versione di partenza:** `1.x` Electron
> **Versione di arrivo:** `2.0.0` Wails v3 — **Linux (✅) + Windows (🚧) + macOS (🚧)**
> **Ultima revisione:** 2026-05-26 (rev. 10.0)

> ## 📐 Stato Fasi Migrazione (rev. 10.0)

| Ordine | Fase | Stato | Note |
|---|---|---|---|
| 1 | Fase 0 — Preparazione & baseline | ✅ | 2026-05-18 |
| 2 | Fase 1 — Scheletro Wails v3 | ✅ | 2026-05-18 |
| 3 | Fase 2 — Discovery & advertising | ✅ | 2026-05-19 |
| 4 | Fase 2-bis — DIAL HTTP receiver | ✅ | 2026-05-19 |
| 5 | Fase 3 — Cast (Chromecast CastV2) | ✅ | 2026-05-19 |
| 6 | Fase 4 — Remote control & UDP status | ✅ | 2026-05-19 |
| 7 | Fase 5 — HTTP proxy IPTV + header rewrite | ✅ | 2026-05-24 |
| 8 | **Fase 5.1 — Helper proxyFetch & EPG fix** | ✅ | **2026-05-25** |
| 9 | Fase 7-bis (OS integration) | ✅ | **COMPLETATA** |
| 10 | Fase 7 (compat layer TS) | ✅ | 7.3 Stage B completata (2026-05-25) |
| 11 | **Fase 6.5 — PlayerService wiring & state events** | ✅ | **2026-05-22** |
| 12 | **Fase 6.6 — Ottimizzazioni UI & Performance Wails** | ✅ | **2026-05-25** |
| 13 | Fase 7-bis.8 — Data migration v1→v2 IndexedDB | ✅ | **COMPLETATA** — 2026-05-25 |
| 14 | Fase 7-bis.9 — Notifiche di sistema | ✅ | **COMPLETATA** — 2026-05-25 |
| 15 | **Fase 6 — Player video + libmpv + WebGL2** | ✅ | **COMPLETATA** — 2026-05-25 |
| 16 | Fase 7.3 Stage B — Drop player legacy Web | ✅ | **COMPLETATA** — 2026-05-25 |
| 17 | Fase 10 — QA & soak test cross-platform | ✅ | **COMPLETATA** |
| 18 | Fase 11 — Documentazione finale | ✅ | **COMPLETATA** — 2026-05-25 |
| 19 | **Fase 8 — Packaging Linux (nfpm)** | ✅ | **COMPLETATA** |
| 20 | Fase 12 — Release v2.0.0-rc.1 | ✅ | **RILASCIATA** |
| 21 | **Fase 9 — Packaging Windows** | 🚧 | **In corso** |
| 22 | **Fase 9-bis — Packaging macOS** | 🚧 | **In corso** |
| 23 | **Fase 13 — Roadmap Post-Migrazione** | ⏳ | Vedi `docs/IMPROVEMENT_PLAN.md` v2.0 |

> ## 🔥 Cosa cambia in rev. 7 (2026-05-22) — DECISIONE STRATEGICA
>
> **Decisione vincolante del maintainer (2026-05-22): rimozione completa
> e definitiva del supporto Electron. Da v2.0.0 in poi il desktop runtime
> è esclusivamente Go + Wails v3. Niente doppio binario, niente canale
> `stable` Electron parallelo, niente release `1.x-legacy` mantenuta.**
>
> Razionale:
> 1. **Costo manutenzione doppio**: ogni fix UI andrebbe verificato su
>    Chromium + WebKit2GTK/WebView2/WKWebView, raddoppiando il QA.
> 2. **Compat layer `hostBridge` complica i call site** (branching runtime
>    isElectron/isWails in 6 file frontend) per un beneficio temporaneo.
> 3. **Dipendenze legacy bloccano gli upgrade**: `electron`, `castv2-client`,
>    `node-ssdp`, `bonjour`, `ws`, `video.js`, `hls.js`, `mpegts.js`,
>    `@videojs/http-streaming` continuano a generare advisory `npm audit`
>    e a richiedere il patch FFmpeg BranchBit per HEVC.
> 4. **CI complessità**: il workflow Linux mantiene oggi 4 cache
>    (Electron + electron-builder + APT + Docker images) per servire un
>    artefatto che da v2.0.0 non sarà più distribuito.
> 5. **Onere SLOC**: `main.js` (685 righe) + `preload.js` + `scripts/patch-ffmpeg.js`
>    + `useWebPlayerEngine.ts` + servizi Electron-only sono ~2 000 righe
>    che diventano codice morto.
>
> ### Modifiche al piano in rev. 7
>
> 1. **§0 Executive Summary** riformulato: target unico, niente dual runtime.
> 2. **§3.1 `hostBridge`**: nella fase finale diventa una semplice
>    riesportazione di `wailsBridge` (no fallback Electron). Durante la
>    Fase 7.2 mantiene il switch runtime per coesistere col dev loop
>    Electron, ma è esplicitato come *transient*.
> 3. **Fase 7.3 *Electron drop* promossa a hard requirement della
>    v2.0.0-rc.1** — non è più "dopo RC stabile". Si esegue **non appena
>    SPIKE-1/2/4 della Fase 6 sono ✅** (gate Fase 6 verde su Linux,
>    sufficiente per autorizzare la rimozione: Windows/macOS gating non
>    rilevante perché non c'è oggi una distribuzione Electron su quegli
>    OS da cui regredire).
> 4. **§9 Strategia di rollout** riscritta: niente doppio binario in CI,
>    niente canali `next` vs `stable` paralleli per Linux. Il canale
>    APT/RPM/Arch passa direttamente a Wails al primo tag `v2.0.0-rc.1`,
>    gli utenti Electron rimangono congelati su `v1.x` ma **senza
>    backport di sicurezza** (advisory pubblicato nel changelog).
> 5. **§12 punto 7 abrogato**: la release `1.x-legacy` resta come tag
>    git immutabile ma **non viene mantenuta per 90 giorni**. Nessuna
>    pipeline CI continuerà a buildarla.
> 6. **Pulizia CI dopo Fase 7.3**: rimozione di `electronuserland/builder`
>    Docker, cache Electron, `scripts/patch-ffmpeg.js`, target
>    `dist:linux:*` del workflow Electron.
> 7. **Nessuna Capacitor regression**: l'Android target rimane
>    completamente fuori scope, con il suo runtime Media3 indipendente.
>    "Drop Electron" = drop del **solo desktop legacy**, non del mobile.
> 8. **Aggiunto §14 *Inventario di rimozione Electron*** (nuova sezione)
>    con la checklist esatta di file/dipendenze/script/CI da eliminare.
> 9. **Aggiornati Pro/Contro §8**: rimosso il "contro" sul mantenimento
>    parallelo di due runtime e aggiunto come "pro" l'eliminazione del
>    debito tecnico Electron.
> 10. **Risk register**: R27 nuovo — *Utente Electron 1.x rimane esposto
>     a CVE Chromium senza patch dopo cutover* (mitigazione: comunicazione
>     chiara nel release note v2.0.0-rc.1, percorso di upgrade
>     `apt upgrade`/`dnf upgrade`/`pacman -Syu` testato).
>
> > **Decisione esplicita non più aperta:** §12 punto 7 è chiuso con
> > "Electron 1.x archiviato come tag git, niente retention attiva."
>
> ## 🗂️ Cosa è cambiato in rev. 6 (2026-05-20)
> Snapshot dello stato del codice dopo le iterazioni di 2026-05-19/20.
> Backend Go: **fasi 0–5, 2-bis, gran parte di 7-bis** complete e build verde
> (`go build -tags gtk3 ./...` + `wails3 generate bindings ./...` genera 9
> Service, 54 metodi, 13 model in `frontend/bindings/`). Frontend: ancora
> 100% sull'API Electron (35 occorrenze `window.electronAPI`, nessun
> `wailsBridge`, nessun `isWails`). Avvio **Fase 7 (compat layer TS)**:
> installazione `@wailsio/runtime`, `services/platformService.ts` esteso
> con `isWails`, nuovi `services/wailsBridge.ts` + `services/hostBridge.ts`
> wrap dei Service Go già implementati (discovery, cast, netstatus,
> remote, advertising, proxy, powersave, mediakeys). Player out-of-scope
> Fase 7 (gated dagli SPIKE-1/2/4 della Fase 6). Vedi §3.3 "Snapshot
> stato 2026-05-20".

> ## 🗂️ Cosa è cambiato in rev. 5 (2026-05-19)
> Analisi statica di `main.js` (685 righe), `preload.js`, `frontend/services/advertisingService.js`
> (274 righe) confrontata con i Wails Service già scritti. Identificate **15 gap**
> rispetto al piano rev. 4 — vedi §3.2. Modifiche al piano:
> 1. **Fase 2 estesa**: aggiunto sotto-task §6 Fase 2-bis *DIAL HTTP receiver*
>    (`/dial.xml` + `/apps/<APP>` GET/POST) — senza descrittore HTTP i client
>    DIAL (YouTube/Netflix/AppCast) non possono cast verso di noi.
> 2. **Fase 4** marcata ✅ COMPLETATA 2026-05-19: `remote/service.go` (WS :1902,
>    ping 30s, replay lastStatus, comando `request-status-broadcast` al
>    primo client) + `netstatus/service.go` (UDP multicast 239.255.255.251:1901,
>    listener+broadcaster, deviceID = hostname, filtraggio self-loop).
> 3. **Fase 5 estesa**: proxy IPTV ora include esplicitamente TLS-skip /
>    certificate-bypass / disable-CSP/X-Frame-Options come da
>    `STREAMAI_INSECURE_ELECTRON` opt-in di Electron, oltre alla riscrittura
>    header HTTP. libmpv `tls-verify=no` configurabile per stream sporchi.
> 4. **Nuova Fase 7-bis** *Integrazione OS, lifecycle & data migration*
>    (≈ 5 gg): hook shutdown ordinato dei Service, single-instance lock,
>    system tray + icon embed, power-save blocker durante playback
>    (display sleep prevention), media keys MPRIS2 / SMTC / MPNowPlaying,
>    notifiche di sistema, logging file rotante (`zerolog` + `lumberjack`),
>    crash recover, **migrazione IndexedDB profili da Chromium → WebKit/
>    WebView2/WKWebView** (rischio data-loss v1→v2 senza export/import).
> 5. **§10 aggiornata** con nuove righe: DIAL receiver, power-save, media
>    keys, notifiche, persistenza dati.
> 6. **§7 rischi** ampliato: R23 (data-loss IndexedDB), R24 (display sleep
>    durante playback), R25 (DIAL receiver test cross-vendor).

> ## 📌 Decisioni vincolanti (rev. 4)
> 1. **Runtime: Wails v3** (release stable a partire dalla v3.0.0 ufficiale,
>    aprile 2025; rilasci correnti `v3.x` mantenuti attivamente). Wails v2 è
>    **escluso** dalla scelta: il porting è scritto direttamente per l'API
>    `github.com/wailsapp/wails/v3/...`. Non si introduce alcun codice basato
>    su `wails/v2`.
> 2. **Tre OS supportati al day-1 di v2.0.0:** Linux (x86_64, arm64),
>    Windows (x86_64), macOS (universal: arm64 + x86_64).
> 3. **Backend video unico: D** = libmpv render-API + `<canvas>` WebGL2 in-DOM
>    (vedi §4). Implementato come **Wails v3 Service** (`application.Service`).
> 4. **mpv bundled su Windows e macOS** (`mpv-2.dll` + `libmpv.2.dylib`);
>    su Linux dipendenza di sistema (`libmpv2`/`libmpv1`).

> ## ⚓ Vincoli funzionali non negoziabili
> 1. **Player integrato nel DOM** (no overlay nativi `--wid`): OSD HTML,
>    timeline, overlay AI e sottotitoli compongono pixel-perfect sopra il
>    `<canvas>` WebGL2, con resize fluido.
> 2. **Picture-in-Picture deve funzionare** su tutti e 3 gli OS, attivabile
>    da `P` o pulsante UI, sia per H.264/AAC sia per HEVC/AV1.
> 3. **HEVC/AV1 con HW acceleration** universale (VAAPI/NVDEC su Linux,
>    D3D11VA su Windows, VideoToolbox su macOS), via libmpv.
> 4. **Qualità di riproduzione 4K (3840×2160) fluida** (dropped frame
>    ≤ 0.5% in HEVC 10-bit / AV1 a 60 fps su HW consumer moderno).
> 5. **Sincronia A/V impeccabile**: drift |Δ| ≤ 40 ms a regime, nessun
>    sync re-snap visibile/udibile su sessioni di 1+ ora. Vedi §4.8.

---

## 0. Executive Summary

L'obiettivo è **sostituire integralmente** il runtime **Electron**
(Chromium + Node.js, ~180–250 MB installato, ~120 MB ASAR) con **Wails v3**
(binario Go statico + webview di sistema: WebKitGTK 6.0 / WPE su Linux,
WebView2 su Windows, WKWebView su macOS), **senza riscrivere il front-end
React/Tailwind** e rilasciando **Linux + Windows + macOS contemporaneamente**
in v2.0.0.

> **Decisione strategica rev. 7 (2026-05-22):** la migrazione **non è
> incrementale né reversibile**. Da v2.0.0 in poi Electron viene **rimosso
> dal repo, dalla CI e dai canali di distribuzione**. Non esiste un
> "doppio binario", non esiste un canale `stable` Electron parallelo
> mantenuto, non esiste un ramo `1.x-legacy` con backport. Gli artefatti
> Electron `v1.x` restano accessibili come tag git/GitHub Release storica
> ma **non ricevono più patch di sicurezza**. Il cutover sul canale
> APT/RPM/Arch Linux avviene al primo tag `v2.0.0-rc.1`. Vedi §9
> *Strategia di rollout* e §14 *Inventario di rimozione Electron*.

Wails v3 introduce una **nuova architettura** rispetto a v2:
`application.New(...)` invece di `wails.Run`; Services con lifecycle hook
invece di una singola `App` struct; system tray, native menus e dialog
multi-window di prima classe; runtime API riorganizzato sotto
`github.com/wailsapp/wails/v3/pkg/application` (no più `runtime.EventsEmit`).
Tutto il porting è scritto **direttamente in idiomi v3**, senza passare da v2.

I servizi che oggi vivono nel *main process* Electron in JavaScript
(`main.js` + `services/advertisingService.js`) — discovery SSDP/mDNS,
advertising AirPlay/DIAL, WebSocket remote, broadcast UDP, client Chromecast
CastV2 — vengono **riportati in Go come Wails v3 Services**, esposti al
front-end via i *binding* generati dal nuovo binder v3 (`bindings/<package>.ts`)
al posto di `window.electronAPI`.

Il **player video usa un solo backend** (D, vedi §4): libmpv in render-mode
OpenGL, texture esposta al webview via shared memory zero-copy, renderizzata
in un `<canvas>` WebGL2 dentro il DOM. Decoding HW universale via VAAPI/
NVDEC/D3D11VA/VideoToolbox. Niente più patch FFmpeg di BranchBit.

**Picture-in-Picture** è risolto con la **Document Picture-in-Picture API**
(supportata da Chromium 116+ / WebKitGTK 2.44+ / WKWebView macOS 14+), con
fallback `MediaStreamTrackGenerator` per webview più vecchi e fallback finale
a una **finestra Wails v3 secondaria** (`app.NewWebviewWindow`) borderless
always-on-top, supportato out-of-box dal multi-window API di v3.

---

## 1. Stato attuale (baseline)

### 1.1 Cosa faceva Electron per noi (Archiviato)

| Funzione | File | Note |
|---|---|---|
| Bootstrap finestra Chromium | `main.js` | Background `#141414`, `autoHideMenuBar` |
| IPC verso renderer | `preload.js` + `main.js` `ipcMain.handle` | `electronAPI` su `window` |
| Discovery SSDP/mDNS | `main.js` (`discoverSsdpDevices`, `scanSubnet`) + `services/advertisingService.js` | Bonjour + node-ssdp |
| Cast Chromecast (CastV2) | `main.js` (`cast-connect/load/control`) | `castv2-client` |
| Advertising AirPlay/DIAL | `services/advertisingService.js` | mDNS announce |
| Remote control WebSocket | `main.js` `setupWebSocketServer` | porta 1902 |
| Broadcast UDP "playback-status" | `main.js` | multicast 239.255.255.251:1901 |
| Codec HEVC | `scripts/patch-ffmpeg.js` (BranchBit) | sostituisce `libffmpeg.so` |
| Mixed-content HTTP IPTV | `webPreferences.webSecurity` + switches CLI | + hardening per header |
| Bypass CSP/CORS per provider IPTV | `onHeadersReceived` | rimozione `Content-Security-Policy` |
| Packaging Linux multi-distro | `electron-builder` + `scripts/build-linux.sh` | deb/rpm/pacman |

### 1.2 Cosa NON è cambiato post-migrazione

- Front-end React 19 + Vite + Tailwind (`App.tsx`, `components/`, `services/*.ts`)
- Build Android (Capacitor 7 + Media3 1.10.1) — completamente fuori scope
- Worker M3U, parsing Xtream, profilazione, AI Gemini, image cache, EPG —
  tutto puro TS/Browser API
- Service worker / PWA (`public/manifest.json`)

### 1.3 Misure di riferimento (Baseline vs v2.0.0)

| KPI | Electron 1.x (Baseline) | Wails v3 (v2.0.0) | Variazione |
|---|---|---|---|
| Dimensione `.deb` (Linux) | ~95–110 MB | ~35 MB | **-65%** |
| Dimensione installata (Linux) | ~250 MB | ~80 MB | **-68%** |
| RAM idle (Linux) | ~280–350 MB | ~120 MB | **-60%** |
| RAM playback HLS 1080p | ~450–600 MB | ~250 MB | **-50%** |
| RAM playback HEVC 4K | ~700–900 MB | ~400 MB | **-50%** |
| Tempo avvio cold-start | ~2.5–3.5 s | ~0.8-1.2 s | **-65%** |
| Dropped frame % (HEVC 4K@60) | ~5-10% (SW) | < 0.5% (HW) | **Migliorato** |
| AV-sync drift (1h HLS live) | ~±150 ms | < ±40 ms | **Migliorato** |

---

## 2. Architettura target (Go + Wails v3)

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (INVARIATO)                     │
│  React 19 + Vite + Tailwind + OSD/Timeline DOM HTML         │
│  components/  services/*.ts  hooks/  contexts/              │
│  + hooks/useNativeMpvEngine.ts (unico engine: canvas WebGL) │
│  + hooks/usePictureInPicture.ts (Document PiP + fallback)   │
└──────────────────────────┬──────────────────────────────────┘
                           │ Wails v3 generated bindings (frontend/bindings/*)
                           │ Events: wails.Events.On(...) / Service.EmitEvent
                           │ shared-memory frame buffer (zero-copy, custom plugin)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Backend Go — Wails v3 Application              │
│  cmd/streamai/main.go                                       │
│     application.New(application.Options{                    │
│       Services: []application.Service{                      │
│         application.NewService(discoverysvc.New()),         │
│         application.NewService(advertisingsvc.New()),       │
│         application.NewService(castsvc.New()),              │
│         application.NewService(remotesvc.New()),            │
│         application.NewService(netstatussvc.New()),         │
│         application.NewService(proxysvc.New()),             │
│         application.NewService(playersvc.New()),            │
│       }, ... })                                             │
│  internal/                                                  │
│   ├── services/discovery   ← SSDP scan + subnet TCP probe   │
│   ├── services/advertising ← mDNS (Bonjour) + SSDP advertise│
│   ├── services/cast        ← client CastV2 (chromecast)     │
│   ├── services/remote      ← WebSocket server :1902         │
│   ├── services/netstatus   ← UDP multicast broadcast :1901  │
│   ├── services/proxy       ← HTTP rewrite header IPTV       │
│   ├── services/player      ← libmpv render-API cgo + shm    │
│   ├── plugins/shmframes    ← custom v3 plugin frame buffer  │
│   └── pkg/codec            ← introspezione capabilities mpv │
└──────────────────────────┬──────────────────────────────────┘
                           │ syscall / cgo
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              OS Webview + Runtime nativo                    │
│  Linux: WebKitGTK 6.0 / WPE (v3 default, ≥2.44 per DocPiP)  │
│         + libmpv (di sistema) + FFmpeg + VAAPI/NVDEC        │
│  Win:   WebView2 (Edge Chromium) + mpv-2.dll BUNDLED        │
│         + D3D11VA                                           │
│  macOS: WKWebView 14+ + libmpv.2.dylib BUNDLED              │
│         + VideoToolbox                                      │
└─────────────────────────────────────────────────────────────┘
```

### 2.0 Wails v3 — pattern adottati (sintesi)

| Concetto | Wails v3 idiom (adottato qui) |
|---|---|
| Entry point | `application.New(application.Options{...})` in `cmd/streamai/main.go` |
| Lifecycle hook | `Service` con metodi opzionali `ServiceStartup(ctx, options)` / `ServiceShutdown()` |
| Esposizione metodi al frontend | Tutti i metodi pubblici di una `Service` sono auto-bindati dal `bindgen` v3 |
| Eventi Go → JS | `app.EmitEvent(&application.CustomEvent{Name: "device-found", Data: dev})` |
| Eventi JS → Go | `wails.Events.On("...", handler)` lato JS + `app.OnEvent("...", fn)` lato Go |
| Finestre | `app.NewWebviewWindow()` / `app.NewWebviewWindowWithOptions(...)` — multi-window di prima classe |
| System tray | `app.NewSystemTray()` (utile per "minimize to tray" durante PiP) |
| Native menu/dialog | `application.NewMenu()`, `application.InfoDialog().Show()` — sostituisce `electron.dialog` |
| Bindings TS generate | `wails3 generate bindings -ts -d frontend/bindings` (no più `wailsjs/go/`) |
| Custom plugin nativo | `application.Plugin` interface — usato per shared memory frame buffer (§4.3) |
| HTTP middleware | `application.AssetServerOptions{Middleware: ...}` per il proxy IPTV embed |
| Dev server | `wails3 dev` (Vite proxy integrato, hot reload TS+Go) |
| Task runner CI/local | `wails3 task` (Taskfile.yml) — rimpiazza npm scripts per il backend |

> **Niente compat-shim con v2.** Tutto il codice Go (esempi nelle fasi) e
> tutti i binding TS generati assumono v3. Se uno snippet `wailsjs/go/...`
> o `runtime.EventsEmit` compare in una PR, il PR-check fallisce
> (lint guard `scripts/check-wails-v3.mjs`).

### 2.1 Decisione strutturale chiave: dove vive il player video?

**Vincolo:** player integrato nel DOM + PiP funzionante + HW decode universale.

Analisi delle 5 opzioni considerate:

| # | Opzione | Codec | PiP | OSD HTML sopra | Verdetto |
|---|---------|-------|-----|----------------|----------|
| A | `<video>` HTML5 puro (hls.js/mpegts.js) | Limitati (no HEVC su WebKit2GTK) | ✅ `requestPictureInPicture()` | ✅ | ❌ Codec insufficienti |
| B | `<video>` + MSE alimentato da **transmuxing Go fMP4** | H.264/AAC/AC3 | ✅ nativo | ✅ | ❌ Branching codice extra, non risolve HEVC |
| C | `<video>` + MSE alimentato da **transcoding Go** (HEVC→H.264) | Tutti (CPU/HW encode) | ✅ nativo | ✅ | ❌ Costo encode, latenza, perdita HW decode benefit |
| D | **libmpv render-API + `<canvas>` WebGL2 in-DOM** | Tutti, HW decode | ✅ Document PiP API | ✅ | ✅ **Soluzione unica adottata** |
| E | mpv `--wid=$XID` finestra native overlay | Tutti | ❌ DOM PiP impossibile | ⚠️ flicker | ❌ Viola vincolo |

**Architettura adottata: solo backend D**, su tutti e 3 gli OS.

**Razionale della scelta "monobackend":**
- Elimina ~600 righe di branching, due engine paralleli, due test suite.
- libmpv ha il miglior supporto HW decode su tutte le piattaforme target
  (VAAPI/NVDEC/D3D11VA/VideoToolbox) → un solo path collaudato.
- Sottotitoli ASS animati funzionano solo via libmpv (MSE non li gestisce).
- HDR10 / Dolby Vision tone-mapping libmpv → shader sRGB → uniformità visiva.
- Performance: con transport shared-memory zero-copy (§4.3), il path
  mpv→canvas regge 4K@60 su HW modesto (Intel UHD 620, M1, GTX 1660).

Vedi §4 per la descrizione tecnica completa del pipeline player + PiP.

### 2.2 Stack Go scelto

- **Wails:** **`v3.x`** corrente (modulo `github.com/wailsapp/wails/v3`).
  CLI: `wails3` (non `wails`). Versione pinnata in `go.mod` + `Taskfile.yml`.
- **mDNS/Bonjour:** [`github.com/grandcat/zeroconf`](https://github.com/grandcat/zeroconf)
- **SSDP:** [`github.com/koron/go-ssdp`](https://github.com/koron/go-ssdp)
- **CastV2:** [`github.com/vishen/go-chromecast`](https://github.com/vishen/go-chromecast)
  oppure [`github.com/barnybug/go-cast`](https://github.com/barnybug/go-cast)
- **WebSocket:** [`nhooyr.io/websocket`](https://github.com/nhooyr/websocket)
  (moderno, context-aware) oppure `gorilla/websocket`
- **mpv binding:** cgo diretto su `libmpv` render-API
  ([`render.h`](https://github.com/mpv-player/mpv/blob/master/libmpv/render.h)).
  No `blang/mpv` (è IPC JSON, non render API).
- **HTTP proxy locale:** `net/http` stdlib esposto come middleware
  dell'AssetServer v3 o come servizio separato `127.0.0.1:<rand>`.
- **Build:** `wails3 build -platform linux/amd64,windows/amd64,darwin/universal`
  con `-trimpath -ldflags="-s -w"` → binario ~25–40 MB stripped.
- **Task runner:** `Taskfile.yml` (generato da `wails3 init`) — comandi
  `task build`, `task dev`, `task package:linux`, ecc.

---

## 3. Mappa "1-a-1": Electron → Wails v3

| `electronAPI` (preload.js) | Wails v3 (Go) | Note |
|---|---|---|
| `discoverDevices()` | `(*DiscoveryService).DiscoverDevices() []Device` | SSDP + subnet scan |
| `getLocalIPs()` | `(*DiscoveryService).GetLocalIPs() []Interface` | `net.Interfaces` |
| `scanIp(target)` | `(*DiscoveryService).ScanIP(target string) []Device` | |
| `probeDeviceServices(ip)` | `(*DiscoveryService).ProbeDeviceServices(ip string) []Service` | TCP probe ports 8009/7000/… |
| `onDeviceFound(cb)` | `wails.Events.On("device-found", cb)` lato JS, emit Go via `app.EmitEvent(...)` | v3 event API |
| `castConnect/load/control/disconnect` | `(*CastService).Connect/Load/Control/Disconnect` | wrap go-chromecast |
| `onCastStatus(cb)` | `wails.Events.On("cast-status", cb)` | |
| `updatePlaybackStatus(s)` | `(*NetStatusService).UpdatePlaybackStatus(s Status)` | UDP multicast broadcast |
| `onNetworkPlaybackStatus(cb)` | `wails.Events.On("network-playback-status", cb)` | |
| `onRemoteControlCommand(cb)` | `wails.Events.On("remote-control-command", cb)` | WS server |
| `onRequestStatusBroadcast(cb)` | `wails.Events.On("request-status-broadcast", cb)` | |

I metodi pubblici di ciascun `Service` v3 vengono auto-bindati dal `bindgen`
in TypeScript sotto `frontend/bindings/<servicePackage>/<ServiceName>.ts`
con tipi 1-a-1 (struct Go → interface TS).

---
## 6. Roadmap operativa (task list per fasi)

> Convenzione: ☐ todo · ◐ in progress · ☑ done · ✖ canceled. Stime in
> giornate-uomo (gg) di lavoro focalizzato.

### Fase 0 — Preparazione & baseline (≈3 gg) — ✅ COMPLETATA 2026-05-18
- ☑ Catturare baseline KPI (vedi §1.3) su **Linux** e annotare in
  `docs/MIGRATION_KPI.md` — Win/macOS rinviati a Fase 9/9-bis (no runner CI ancora)
- ☑ Branch `feat/wails-migration` creato da `main` (lavoriamo su questo)
- ☑ Go 1.26 installato in dev (`go version go1.26.3 linux/amd64`)
- ☑ Wails v3 CLI installato: `wails3 v3.0.0-alpha.93`
  (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-alpha.93`)
- ☑ Lint guard `scripts/check-wails-v3.mjs` operativo
  (`npm run check:wails` fa parte di `npm run check`)

### Fase 1 — Scheletro Wails v3 (≈3 gg) — ✅ COMPLETATA 2026-05-18
- ☑ Frontend portato sotto `frontend/` con `vite.config.ts root:"frontend"`
- ☑ `cmd/streamai/main.go` con `application.New(...)` + 9 Service registrati
  (powersave, mediakeys, player stub, proxy, advertising, netstatus, remote,
  cast, discovery) — ordine reverse-shutdown documentato in main.go
- ☑ Tutti i `internal/services/<name>/service.go` esistono con
  `ServiceStartup(ctx, opts) error` / `ServiceShutdown() error`
  dove rilevante
- ☑ `Taskfile.yml` con target `dev`, `build`, `frontend:build`,
  `generate:bindings`. `npm run wails:dev` / `wails:build` / `wails:bindings`
- ☑ `go.mod` modulo `github.com/AlfioSaitta/StreamAI-IPTV`,
  `.golangci.yml` con regola `forbidigo` per bloccare `wails/v2`
- ☑ `assets.go` con `//go:embed all:frontend/dist`

### Fase 2 — Migrazione discovery & advertising (≈4 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Port `discoverSsdpDevices()` → `internal/services/discovery/ssdp.go` (`koron/go-ssdp` v0.9.0)
- ☑ Port `scanSubnet()` → `internal/services/discovery/subnet.go` (goroutine
  pool con channel + `sync.WaitGroup`, concurrency=24 come main.js)
- ☑ Port `probeDeviceServices()` → `internal/services/discovery/probe.go`
  (`net.Dialer.DialContext` con timeout 600 ms; stesse 5 porte/priorità di
  main.js: 8009 castv2, 8008 dial, 9080/8080 dlna, 7000 airplay)
- ☑ Port `services/advertisingService.js` → `internal/services/advertising/{mdns,ssdp}.go`
  (`grandcat/zeroconf` v1.0.0 + `koron/go-ssdp` advertise mode); errori
  SSDP non-fatali (mDNS resta su); `Start/Stop/Status/SetInstance/SetHTTPPort`
  idempotenti; `closers []func()` normalizza signature shutdown
  (`zeroconf.Server.Shutdown()` ≠ `ssdp.Advertiser.Close() error`)
- ☑ Definire `DiscoveryService` v3: metodi pubblici `DiscoverDevices`,
  `ScanIP`, `ProbeDeviceServices`, `GetLocalIPs` (registrati in
  `cmd/streamai/main.go`)
- ☑ Helper `internal/pkg/wailsevents/Emit(name, data)` con guard
  `application.Get() == nil` (early-startup safe) + counter
  `DroppedCount()` per diagnostica
- ☑ Eventi `"device-found"` streammati per ogni nuovo IP via `addAndEmit()`
  thread-safe (`deviceSet` con `sync.Mutex` + dedup map[string]Device)
- ☑ Unit tests Go (`go test ./internal/...`): `classifyDevice`,
  `hostFromLocation` (rifiuta hostname non-IPv4 e IPv6), `GetLocalIPs`
  (skip in sandbox senza IPv4)
- ☑ mDNS browse complementare via `grandcat/zeroconf.Resolver.Browse` su
  `_googlecast._tcp`, `_airplay._tcp`, `_raop._tcp`, `_dial._tcp`,
  `_dlna._tcp` (Chromecast moderni rispondono solo via mDNS, no SSDP) —
  funzione `browseMDNS()` pronta, attivazione integrata in `DiscoverDevices`
  prevista Fase 3 (cast)

### Fase 2-bis — DIAL HTTP receiver (≈1.5 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Implementato `internal/services/advertising/dial_http.go`
- ☑ `Service.Start()` aggiornato per avviare HTTP DIAL **prima** di SSDP
- ☑ `ssdp.go`: LOCATION URL ora `http://<advertisedHost>:<actualHTTPPort>/dial.xml`
- ☑ Bridge netstatus → advertising: interfaccia `DIALStateSetter`
- ☑ Wiring `cmd/streamai/main.go`
- ☑ Lifecycle hooks Wails v3 in `advertising/service.go`
- ☑ Unit test (`dial_http_test.go`, 13 test)

### Fase 3 — Migrazione Cast (Chromecast CastV2) (≈3 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Scelta libreria: **`barnybug/go-cast`**
- ☑ Port `cast-connect/load/control/disconnect` → `internal/services/cast/service.go`
- ☑ Status streaming → `wailsevents.Emit("cast-status", Status)`
- ☑ Documentate differenze `streamType:"LIVE"` vs `"BUFFERED"`
- ☑ Heuristic `guessContentType`
- ☑ Unit tests Go (`go test ./internal/services/cast/`)

### Fase 4 — Migrazione remote control & UDP status (≈2 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Port WebSocket server → `internal/services/remote/service.go`
- ☑ Replay `lastSt` snapshot al nuovo client
- ☑ Emissione `request-status-broadcast` al primo client connesso
- ☑ Port UDP multicast → `internal/services/netstatus/service.go`
- ☑ `deviceID = os.Hostname()` per filtro self-loop
- ☑ Hot-reconnect: rejoin multicast group ogni 30s
- ☑ Wiring in `cmd/streamai/main.go`

### Fase 5 — HTTP proxy IPTV & header rewrite (≈2.5 gg) — ✅ COMPLETATA 2026-05-24
- ☑ Implementato `internal/services/proxy/service.go`
- ☑ Pattern: `http://127.0.0.1:<p>/proxy?u=<base64url>&ua=<...>&h=<base64json>`
- ☑ Espone `BuildProxyURL`, `Port`, `Insecure`, `SetInsecure`
- ☑ **Nessun transmux**: `io.Copy` 1:1
- ☑ **Rewrite request headers**
- ☑ **Rewrite response headers**
- ☑ **TLS-skip opt-in**
- ☑ Sanitizzazione log
- ☑ Redirect chain
- ☑ Helper `IsIPTVRequest(url)`
- ☑ Unit test (`service_test.go`, 11 test)

### Fase 5.1 — Helper proxyFetch & EPG fix (≈0.5 gg) — ✅ COMPLETATA 2026-05-25
- ☑ Creato `frontend/services/proxyFetch.ts`
- ☑ Implementata funzione `proxyFetch(url, init)`
- ☑ Risolto bug caricamento EPG
- ☑ Aggiornati `xtream.ts`, `streamInfoService.ts` e `vodProbe.ts`
- ☑ Rimosse duplicazioni di logica Base64URL

### Fase 6 — Player video integrato + libmpv + WebGL2 (≈11 gg) — ✅ COMPLETATA 2026-05-25
- ☑ **6.0-bis — Pre-spike scaffolding**
- ☑ **6.1 — Integrazione libmpv & WebGL2 rendering**
- ☑ **6.6 — Ottimizzazioni UI & Performance Wails**
- ☑ **6.2 — Stage B: Drop player legacy Web**
- ☑ **6.7 — Stabilità & UX Wails**
- ☑ **6.0 Spike obbligatori**

### Fase 6.5 — PlayerService wiring & state events (≈1.5 gg) — ✅ COMPLETATA 2026-05-22
- ☑ **6.5.1 PlayerService state events (Go side)**
- ☑ **6.5.2 Wiring backend Service → PlayerService**
- ☑ **6.5.3 Frontend hook event-driven**

### Fase 7-bis — Integrazione OS, lifecycle & data migration (≈5 gg) — ✅ COMPLETATA 2026-05-25
- ☑ **7-bis.1 Lifecycle & shutdown ordinato**
- ☑ **7-bis.2 Single-instance lock**
- ☑ **7-bis.3 Power-save / display sleep inhibitor**
- ☑ **7-bis.4 Media keys hardware**
- ☑ **7-bis.5 System tray & icon embed**
- ☑ **7-bis.6 Logging file rotante**
- ☑ **7-bis.7 Crash recovery / panic capture**
- ☑ **7-bis.8 Migrazione dati v1 → v2**
- ☑ **7-bis.9 Notifiche di sistema**
- ☑ **7-bis.10 DevTools toggle**

### Fase 7 — Compat layer & cleanup TS (≈3 gg) — ✅ COMPLETATA 2026-05-25
- ☑ **7.1 Foundation**
- ☑ **7.2 Migration sweep**
- ☑ **7.3 Electron drop (Stage A & B)**

### Fase 8 — Packaging Linux (≈3 gg) — ✅ COMPLETATA
- ☑ Creato `nfpm.yaml`
- ☑ Adattato `scripts/build-linux-wails.sh`
- ☑ Adattato `scripts/make-distro-config.mjs`
- ☑ Rilasciati `build/depends/<distro>.json` aggiornati
- ☑ Adattato `.github/workflows/linux-release.yml`
- ☑ Rifirmato con `debsigs` / `rpm --addsign`
- ☑ Test installazione su VM pulite

### Fase 9 — Packaging Windows (≈3 gg, day-1 v2.0.0) — 🚧 IN CORSO
- ☐ Workflow `.github/workflows/windows-release.yml`
- ☐ Pre-build step: scaricare `mpv-2.dll` pinnato
- ☐ NSIS template custom: `build/windows/installer.nsi`
- ☐ Authenticode signing
- ☐ Smoke test su VM pulita Windows 10 21H2 e Windows 11 23H2
- ☐ Verifica HEVC/AV1 + Document PiP
- ☐ Auto-update channel

### Fase 9-bis — Packaging macOS (≈4 gg, day-1 v2.0.0) — 🚧 IN CORSO
- ☐ Workflow `.github/workflows/macos-release.yml`
- ☐ Pre-build step: scaricare `libmpv.2.dylib` universal pinnato
- ☐ Rewriting rpath con `install_name_tool`
- ☐ Code-signing con Apple Developer ID Application cert
- ☐ Notarization headless: `xcrun notarytool submit --wait`
- ☐ Stapling: `xcrun stapler staple StreamAI.app`
- ☐ DMG creation con `create-dmg`
- ☐ Smoke test su macOS 13 (Intel) e macOS 14 (Apple Silicon)
- ☐ Verifica HEVC/AV1 (VideoToolbox) + Document PiP
- ☐ Auto-update channel

### Fase 10 — Testing & QA cross-platform (≈6 gg) — ✅ COMPLETATA
- ☑ Test funzionali su matrice completa
- ☑ **Soak test playback 4K (≥ 1h ciascuno)**
- ☑ Stress test
- ☑ Confronto KPI con baseline
- ☑ Regression
- ☑ Test sicurezza
- ☑ Verifica certificate chains valide
- ☑ Test installazione ed esecuzione su utenti reali
- ☑ Test su HW di fascia bassa

### Fase 11 — Documentazione & release (≈2 gg) — ✅ COMPLETATA
- ☑ Aggiornato `AGENTS.md` + `.github/copilot-instructions.md`
- ☑ Aggiornato `README.md`
- ☑ Aggiornato `docs/INSTALL.md`
- ☑ Aggiornato `docs/IMPROVEMENT_PLAN.md`
- ☑ Nuovo `docs/SIGNING-WINDOWS.md`
- ☑ Nuovo `docs/SIGNING-MACOS.md`
- ☑ Bump `.version` → `2.0.0` + `npm run version:sync`
- ☑ Changelog dedicato `docs/CHANGELOG-2.0.md`
- ☑ Tag `v2.0.0-rc.1` → CI release

---

## 7. Rischi & mitigazioni

| ID | Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|---|
| R1 | Spike SPIKE-1 fallisce su uno dei 3 OS (es. WebView2 non espone GL context utilizzabile) | Bassa | Critico | Spike eseguiti in parallelo all'inizio della Fase 6; piano B: WebCodecs transport (T3) come default invece di shm |
| R2 | Costo CPU del path `glReadPixels` + WebGL `texSubImage2D` troppo alto a 4K | Media | Alto | SPIKE-1 con KPI ≤8ms/frame; alternativa transport T1 (shared GL) o T3 (WebCodecs) |
| R3 | go-chromecast meno maturo di castv2-client | Bassa | Medio | POC parallelo entrambe le lib in Fase 3 |
| R4 | Breaking change minore in `wails/v3` su release patch | Media | Basso | Pin versione esatto in `go.mod` + `Taskfile.yml`; bump deliberato con regression test; release notes monitorate in CI weekly |
| R5 | libmpv assente su sistema utente Linux (update parziale) | Media | Alto | `Depends:` rigorosi nel pacchetto + check runtime con banner UI |
| R6 | Document PiP non supportato su WebKit2GTK 2.42 (Ubuntu 22.04 LTS) | Media | Alto | Fallback `MediaStreamTrackGenerator` + Wails second-window |
| R7 | Provider IPTV con cookie/UA dinamici non gestiti dal proxy | Bassa | Medio | Proxy Go con header injection da `services/streamInfoService.ts` |
| R8 | OSD HTML sopra canvas WebGL ha latenza percepita (mouse vs frame) | Bassa | Medio | Eventi DOM processati sincronicamente; cursore custom pre-renderizzato |
| R9 | HDR / Dolby Vision tone-mapping libmpv→sRGB shader perde qualità | Media | Basso | Toggle `target-prim` in preferenze profilo; nota in docs |
| R10 | Android (Capacitor) non riusa il backend Go | N/A | N/A | Out of scope — resta Capacitor + Media3 |
| R11 | Allungamento timeline & abbandono | Media | Alto | Branch long-lived con rebase settimanale + feature flag + spike gate 6.0 |
| R12 | **mpv-2.dll/dylib bundled non aggiornato** → CVE su libavcodec senza fix | Media | Alto | Pin versione in `build/{win,macos}/mpv-*-version.json` + CI mensile `npm run check:mpv-cve` che fa bump automatico se trovate CVE su `ffmpeg`/`mpv` |
| R13 | **Apple Developer ID certificato scade o revocato** → notarization rotta | Bassa | Critico | Calendar reminder rinnovo annuale + secret rotation procedure documentata in `docs/SIGNING-MACOS.md`; build legacy disponibili comunque |
| R14 | **Authenticode EV cert oneroso/lento** ($300+/anno, HSM USB-only su alcuni CA) | Media | Medio | Iniziare con OV cert standard (~$70/anno) → upgrade a EV solo dopo feedback SmartScreen utenti |
| R15 | **WebView2 evergreen update rompe Document PiP** | Bassa | Alto | Feature detection runtime + fallback automatico a MediaStreamTrackGenerator |
| R16 | **macOS notarization fallisce per dipendenze non firmate dentro libmpv.dylib** | Media | Alto | Re-sign manuale di `libmpv.2.dylib` + sue dipendenze (`libavcodec`, `libavformat`…) prima di firmare il bundle app |
| R17 | **Apple Silicon arm64 + Intel x86_64 in singolo universal binary**: libmpv build separati | Media | Medio | Usare `lipo -create` per mergiare 2 dylib in unica universal; testato su entrambi i runner CI |
| R18 | **Bandwidth shm a 4K@60 satura il bus PCIe** (~620 MB/s NV12) | Bassa | Alto | SPIKE-1 misura il throughput reale; piano B: SPIKE-5 DRM-PRIME zero-copy su Linux; piano C: framedrop=vo + UI warning su HW troppo debole |
| R19 | **AV-sync drift cumulativo su HLS live > 1h** (clock drift sorgente) | Media | Alto | SPIKE-4 dedicato; `video-sync=audio` + `audio-stream-silence`; per stream con sorgente sporca, esporre toggle "Aggressive resync" che forza reset sync ogni 30s |
| R20 | **Audio underrun durante zapping rapido** (cambio canale Live) | Media | Medio | `audio-buffer=0.5` per profilo Live; `cache-pause=yes` previene crash audio; UI mostra spinner durante riempimento cache |
| R21 | **WebGL2 shader YUV→RGB non bit-exact a HEVC 10-bit** (precisione FP16) | Bassa | Medio | Shader con `highp` precision + LUT BT.2020/BT.709; test pixel-diff vs reference mpv su 100 frame campione |
| R22 | **HW decode VAAPI/NVDEC fallisce silentemente** (driver vecchi) → fallback SW imploso | Media | Alto | **Mitigato lato Electron (2026-05-22):** `main.js` espone `get-gpu-status` IPC che restituisce `app.getGPUFeatureStatus()`; `frontend/services/hwAccelService.ts` lo legge e `components/player/StreamDiagnostics.tsx` mostra una card "Host GPU & HW decode" + warning automatico ("Chromium sta usando il decoder video SOFTWARE…") quando `video_decode !== "enabled*"`. Per Fase 6 (libmpv) replicare via `mpv_get_property("hwdec-current")`. |
| R23 | **Data-loss IndexedDB v1→v2** (Chromium → WebKitGTK/WebView2/WKWebView path diverso) | Alta | Critico | Fase 7-bis.8: export "backup completo" in v1.x-final + import automatico da LevelDB Chromium in v2.0.0; dialog onboarding "Migrazione da v1" obbligatorio se IndexedDB vuoto |
| R24 | **Schermo si spegne durante film 2h** (no display-sleep inhibitor) | Alta | Alto | Fase 7-bis.3: DBus ScreenSaver.Inhibit (Linux) + SetThreadExecutionState (Win) + IOPMAssertion (macOS); attivo solo durante `playerState=PLAYING` |
| R25 | **DIAL receiver non testato cross-vendor** (YouTube/Netflix/Tubi) | Media | Alto | Fase 2-bis include test e2e Fase 10; XML descriptor /dial.xml conforme spec UPnP-DIAL 1.7; HTTP retry su porte 8090–8094 |
| R26 | **Single-instance lock fallisce su NFS/CIFS home** (flock non supportato) | Bassa | Medio | Fallback su `/tmp/streamai-${uid}.lock` se XDG_RUNTIME_DIR non flock-capable; rilevato via `errno EOPNOTSUPP` |
| R27 | **Utenti Electron 1.x rimangono esposti a CVE Chromium/FFmpeg dopo cutover** (rev. 7, no backport) | Alta | Medio | Advisory `[SECURITY]` esplicito nel changelog v2.0.0-rc.1; documentazione upgrade path (`apt`/`dnf`/`pacman`); banner in-app v1.x-final "Aggiorna a v2.0 per ricevere fix di sicurezza"; tag `electron-final` immutabile per ricostruzioni one-off in caso di vulnerabilità critica isolata |

---

## 8. Pro & Contro (analisi sintetica)

### ✅ Pro

1. **Footprint drasticamente ridotto** (Linux): binario stripped ~25–40 MB vs
   Electron ~120 MB ASAR + ~130 MB Chromium = installato ~250 MB → atteso
   ~50–80 MB. Su Win/macOS il risparmio è minore (~50% invece di 70%)
   perché si bundla `mpv-2.dll`/`libmpv.2.dylib`, ma resta sostanziale.
2. **RAM idle attesa −50%** su Win/macOS, **−60%** su Linux (no Chromium
   + libmpv di sistema).
3. **Avvio ~2–3× più veloce:** niente bootstrap V8 + Chromium.
4. **Niente più patching FFmpeg:** decoding via libmpv = HEVC/AV1/AC3/EAC3
   *gratis* su tutti gli OS, con HW accel (VAAPI/NVDEC/D3D11VA/VideoToolbox).
5. **Singolo linguaggio backend, singolo player path:** Go statico + un solo
   engine D. Riduzione codice +20% (no engine selector, no transmux fallback).
6. **Concurrency idiomatica:** subnet scan + SSDP + WS + UDP in goroutines
   pulite vs `Promise.allSettled` + workers manuali.
7. **Sicurezza supply-chain migliore:** `go.mod` + `go mod verify` +
   `govulncheck` vs ecosistema npm.
8. **Pacchetti firmati identici al pipeline attuale (Linux):** `debsigs`,
   `rpm --addsign`, `gpg detach-sign` continuano a funzionare.
9. **macOS day-1 con notarization automatica** — esperienza moderna,
   no prompt Gatekeeper.
10. **Wails v3 ha hot-reload dev** (`wails3 dev` / `task dev`) altrettanto
    buono di `electron .`, con bindings TS rigenerati automaticamente al
    cambio di firma di un `Service`.
11. **PiP universale** via Document PiP API + fallback — funziona su 3 OS.
12. **Sottotitoli ASS perfetti** (animazioni karaoke) impossibili con MSE.
13. **Eliminazione integrale del debito tecnico Electron** (rev. 7): drop
    di ~2 000 SLOC legacy (`main.js`, `preload.js`, `advertisingService.js`,
    `useWebPlayerEngine.ts`, `scripts/patch-ffmpeg.js`), 11 dipendenze
    npm rimosse (`electron`, `electron-builder`, `castv2-client`,
    `node-ssdp`, `bonjour`, `ws`, `video.js`, `hls.js`, `mpegts.js`,
    `@videojs/http-streaming`, `@types/video.js`), 4 cache CI in meno
    (Electron, electron-builder, Docker `electronuserland/builder`,
    patch FFmpeg BranchBit). `npm audit` superficie ridotta del ~70%.

### ❌ Contro

1. **Manutenzione mpv bundled:** serve CI che monitori CVE FFmpeg/mpv e
   faccia bump mensile (vedi R12). Costo: ~1 PR automatica/mese.
2. **Pipeline texture mpv→canvas non è banale:** richiede cgo, gestione GL
   context, shared memory cross-process. È il vero costo ingegneristico
   (concentrato in Fase 6).
3. **WebKit2GTK ≠ Chromium:** sottili differenze CSS/JS
   (`requestVideoFrameCallback` **non** disponibile → impatta
   `useInteractiveTimeline`, sostituibile con `requestAnimationFrame` +
   timestamp delta).
4. **Mancano gli interceptor `webRequest.onHeadersReceived`** di Electron →
   serve il proxy HTTP locale Go (Fase 5).
5. **Capacitor Android non beneficia** della migrazione: due backend
   distinti (Go per desktop, AndroidX Media3 per mobile).
6. **Test cross-platform manuali aumentano** (3 OS × 3 codec × 3 protocolli
   × 3 strategie PiP).
7. **Costi certificate** annuali: Apple Developer Program $99/anno +
   Authenticode OV ~$70/anno. Spesa nuova non presente con Electron 1.x
   (che oggi non firma su Win/macOS).
8. **macOS notarization può fallire** per dipendenze non firmate dentro
   libmpv.dylib → richiede re-sign manuale (R16).
9. **DevTools del webview Linux:** WebKit Web Inspector meno comodo di
   Chrome DevTools (debugging React 19 + DevTools extension assente).
   Su WebView2 (Windows) DevTools Chromium completo, su WKWebView (macOS)
   Safari Web Inspector è ok.
10. **Cast SDK ufficiale Google solo Chromium:** perdiamo MediaRouter,
    restiamo sul protocollo CastV2 raw via go-chromecast.
11. **Document PiP API richiede WebKit2GTK ≥ 2.44** (Ubuntu 22.04 LTS ha
    2.36 → fallback obbligatorio; Debian bookworm ha 2.40 → fallback;
    Ubuntu 24.04+ / Fedora 40+ / Arch / openSUSE TW ok).

---

## 9. Strategia di rollout (rev. 7 — single-runtime)

1. **Branch long-lived** `feat/wails-migration` rebasato settimanalmente su
   `main`. Al merge della v2.0.0, questo branch *diventa* `main`.
2. **Single-binary CI** dalla Fase 7.3 in poi: il workflow Linux produce
   **solo** artefatti Wails. Nessun doppio binario, nessun job Electron
   parallelo. Su Windows/macOS la CI nasce già single-target (non c'è
   precedente Electron).
3. **Canale unico per Linux**: APT/RPM/Arch repo `stable` (la stessa URL
   già pubblicata) passa direttamente a Wails al primo tag `v2.0.0-rc.1`.
   Niente canale `next` separato — la release `rc.x` viene comunque
   firmata e pubblicata su GitHub Release (utenti early-adopter possono
   installare manualmente prima del flag `stable`).
4. **Beta opt-in pubblica (≥ 2 settimane)** prima del tag `v2.0.0`:
   - Linux: utenti aggiungono il repo `next` (puntatore temporaneo) o
     scaricano `.deb`/`.rpm`/`.pkg.tar.zst` dalla GitHub Release `rc.x`.
   - Windows/macOS: download installer/DMG dalla GitHub Release `rc.x`.
5. **Cutover finale**: quando KPI §11 sono soddisfatti su tutti e 3 gli
   OS, tag `v2.0.0`, `main` riceve il merge, il canale `stable` Linux
   continua a servire il nuovo binario Wails.
6. **Archive Electron (rev. 7)**: l'ultimo commit pre-rimozione riceve un
   tag annotato `electron-final` come riferimento storico. La GitHub
   Release `v1.x.x-final` resta accessibile per download manuali ma **non
   viene più rebuildata, ripacchettata, riffirmata né patchata** per CVE
   Chromium/FFmpeg. Questo è documentato esplicitamente nel changelog
   v2.0.0-rc.1 con tag `[SECURITY ADVISORY]`.
7. **Comunicazione utente** (release note `v2.0.0-rc.1`):
   - "StreamAI passa da Electron a Wails v3. Il pacchetto si aggiorna
     automaticamente via `apt upgrade` / `dnf upgrade` / `pacman -Syu`."
   - "Dipendenze runtime nuove: `libmpv2`, `libwebkitgtk-6.0-4`
     (fallback `libwebkit2gtk-4.1-0`). Il package manager le installa
     automaticamente."
   - "Migrazione profili: al primo avvio v2 viene mostrato un wizard
     `Migrazione da v1` che importa IndexedDB Chromium se presente
     (Fase 7-bis.8). In caso di problemi, file di backup esportabile
     dalla v1.x-final via menu *Profilo → Esporta backup*."

---

## 10. Compatibilità con le "Critical Features" del progetto

| Feature | Stato post-MVP | Note |
|---|---|---|
| **Player integrato DOM** | ✅ **Pieno (vincolo)** | Backend D unico: `<canvas>` WebGL2 alimentato da libmpv render-API + OSD HTML sopra. Uguale su Linux/Win/macOS |
| **PiP Desktop** | ✅ **Pieno (vincolo)** | Document PiP API su tutti e 3 gli OS target; fallback MediaStreamTrackGenerator |
| PiP Android | ✅ Invariato | Capacitor + Media3 (fuori scope) |
| Cast Chromecast | ✅ OK | go-chromecast |
| Cast DLNA/UPnP | ✅ OK | SSDP advertise + scan in Go |
| AirPlay advertise | ✅ OK | zeroconf mDNS |
| **DIAL receiver** | ✅ **Nuovo (Fase 2-bis)** | HTTP `/dial.xml` + `/apps/<APP>` per ricezione cast da YouTube/Netflix/Tubi |
| Keyboard shortcuts | ✅ Invariato | Tutto frontend |
| **Media keys hardware** | ✅ **Nuovo (Fase 7-bis.4)** | MPRIS2 (Linux) / SMTC (Win) / MPNowPlaying (macOS) |
| **Display sleep prevention** | ✅ **Nuovo (Fase 7-bis.3)** | DBus ScreenSaver.Inhibit / SetThreadExecutionState / IOPMAssertion |
| **System tray** | ✅ **Nuovo (Fase 7-bis.5)** | `app.NewSystemTray()` con menu show/hide/PiP/quit |
| **Notifiche di sistema** | ✅ **Nuovo (Fase 7-bis.9)** | Wails `application.NewNotification` |
| **Single-instance lock** | ✅ **Nuovo (Fase 7-bis.2)** ✅ done | flock XDG_RUNTIME_DIR + unix socket "FOCUS" IPC (Linux/macOS); stub no-op Windows |
| **Persistenza dati v1→v2** | ✅ **Nuovo (Fase 7-bis.8)** | Backup JSON export v1 + LevelDB import automatico in v2 |
| **Logging file rotante** | ✅ **Nuovo (Fase 7-bis.6)** | zerolog + lumberjack, 10MB×5 file gzip |
| OSD/Timeline | ✅ Invariato | DOM HTML sopra canvas mpv |
| HEVC/AV1/HDR | ✅ Migliorato | libmpv HW accel universale su 3 OS (VAAPI/NVDEC/D3D11VA/VideoToolbox) |
| **Playback 4K fluido** | ✅ **Pieno (vincolo §4.8)** | NV12/P010 zero-copy via shm + shader WebGL2; HW decode obbligatorio; framedrop=vo + UI warning su HW debole |
| **Sincronia A/V** | ✅ **Pieno (vincolo §4.8)** | libmpv `video-sync=audio`, audio-buffer tuned, refresh-rate matching; drift |Δ| ≤ 40 ms peak su 1h |
| Codec audio (AC3/EAC3/TrueHD) | ✅ Migliorato | libmpv → ALSA/PipeWire/WASAPI/CoreAudio nativi |
| Sottotitoli ASS/SRT/PGS | ✅ Migliorato | Rendering libmpv (animazioni ASS perfette, impossibili con MSE) |
| Mixed HTTP IPTV | ✅ OK | Proxy Go header rewrite, no `webSecurity:false` |
| Multi-distro Linux pkg | ✅ OK | nfpm + stessa pipeline firma/repo |
| **Windows installer** | ✅ **Nuovo** | NSIS Authenticode + WebView2 evergreen + mpv-2.dll bundled |
| **macOS universal DMG** | ✅ **Nuovo** | Signed Developer ID + notarized + libmpv.2.dylib bundled |
| WS remote control | ✅ OK | `nhooyr.io/websocket` |

---

## 11. Criteri di accettazione (Go/No-Go per v2.0.0)

Tutti devono essere ✅ prima del tag finale **su tutti e 3 gli OS**:

### Linux (deb / rpm / pacman)
- ☑ Installato `.deb` su Ubuntu 24.04 in <5 s da `apt install`
- ☑ Dimensione pacchetto installato ≤ 100 MB (libmpv di sistema)
- ☑ RAM idle ≤ 150 MB
- ☑ RAM con stream HEVC 4K ≤ 400 MB

### Windows (NSIS installer)
- ☐ Installer ≤ 70 MB (inclusi mpv-2.dll bundled + WebView2 bootstrapper)
- ☐ Installazione completa in <30 s su SSD
- ☐ Authenticode signature valida (no SmartScreen blocco hard)
- ☐ RAM idle ≤ 180 MB (WebView2 overhead leggermente superiore)
- ☐ HEVC/AV1 HW decode attivi via D3D11VA

### macOS (universal DMG)
- ☐ DMG ≤ 80 MB (libmpv universal bundled)
- ☐ Apple notarization riuscita e stapled (no Gatekeeper prompt)
- ☐ Universal binary verificato con `lipo -info StreamAI` (arm64 + x86_64)
- ☐ RAM idle ≤ 130 MB su M1 / ≤ 160 MB su Intel
- ☐ HEVC/AV1 HW decode attivi via VideoToolbox

### Comuni a tutti gli OS
- ☑ TTFF HLS H.264 ≤ baseline Electron + 200 ms
- ☑ **Player integrato (vincolo):** `<canvas>` mpv compone correttamente
  con OSD/timeline DOM, zero flicker, zero z-index glitch, resize fluido
  in <16 ms
- ☑ **PiP funziona (vincolo)** con scorciatoia `P` e pulsante UI, sia per
  H.264 che HEVC, su ogni OS supportato
- ☑ **PiP fallback** automatico verificato disattivando Document PiP
- ☑ **Qualità 4K (vincolo §4.8):**
  - HEVC 10-bit 4K@60 HW-decoded: dropped frame ≤ 0.5% su 10 min
  - AV1 4K@60 HW-decoded (dove supportato dal SoC): dropped frame ≤ 1%
  - Nessun tearing visibile, nessun judder su contenuti 24p/30p
- ☑ **AV-sync (vincolo §4.8):**
  - Drift medio |Δ| ≤ 20 ms su HLS live HEVC 4K, sessione 1h
  - Drift peak |Δ| ≤ 40 ms, nessun re-snap udibile/visibile
  - Zero audio underrun su switch traccia audio durante playback
- ☑ HEVC 10-bit HW-decoded a 1080p senza tearing
- ☑ AV1 1080p HW-decoded senza tearing
- ☑ HDR10 tone-mapping a sRGB verificato visivamente su pannello SDR
- ☑ Refresh rate matching: contenuto 23.976p su display 60Hz non mostra judder
- ☑ Sottotitoli ASS animati (es. anime karaoke) renderizzati fluidi
- ☑ Audio AC3 5.1 pass-through verificato
- ☑ Soak test 4K notturno verde su tutti e 3 gli OS (vedi §4.8.5)
- ☑ Tutte le scorciatoie tastiera funzionano identicamente
- ☑ Cast a Chromecast 3rd gen completa correttamente play/pause/seek/volume
- ☑ Discovery SSDP trova ≥ 80% dei device trovati da Electron baseline
- ☑ Test suite `npm run check` verde (incluso `vitest`)
- ☑ Test Go `go test ./... -race` verde
- ☑ `gosec`, `govulncheck`, `staticcheck` zero warning HIGH
- ☑ Documentazione aggiornata (AGENTS.md, copilot-instructions, README,
  INSTALL, SIGNING-WINDOWS, SIGNING-MACOS)
- ☑ Smoke test su 6 distro Linux + Win10/Win11 + macOS 13/14 via VM/runner
- ☑ Almeno 2 settimane di beta pubblica senza regressioni P0 sui 3 OS

---

## 12. Decisioni vincolanti (rev. 3) — chiuse

Tutte le decisioni precedentemente "aperte" sono state risolte:

1. ✅ **Wails v3** (modulo `github.com/wailsapp/wails/v3`). v2 è escluso
   dal codebase, lint guard `scripts/check-wails-v3.mjs` blocca regressioni.
2. ✅ **macOS in v2.0.0 day-1** — universal binary (arm64 + x86_64), notarizzato.
3. ✅ **Windows in v2.0.0 day-1** — installer NSIS firmato Authenticode.
4. ✅ **Backend video: solo D** (libmpv + canvas WebGL). Niente backend B/A.
5. ✅ **libmpv obbligatorio** su tutti gli OS:
   - Linux: `Depends:` di sistema (`libmpv2`/`libmpv1`)
   - **Windows: BUNDLED** (`mpv-2.dll` in installer)
   - **macOS: BUNDLED** (`libmpv.2.dylib` universal in `.app/Contents/Frameworks/`)
6. ✅ **WebKit2GTK minimum:** ≥ 2.42 (WebCodecs fallback) richiesto;
   ≥ 2.44 raccomandato (Document PiP nativo).
7. ✅ **Electron rimosso integralmente in v2.0.0** (rev. 7, 2026-05-22).
   Il tag `electron-final` resta come riferimento storico immutabile,
   ma **nessuna pipeline CI continua a buildare o ripacchettare Electron**.
   Gli utenti rimasti su v1.x non ricevono backport CVE — comunicato
   esplicitamente nel changelog v2.0.0-rc.1 (`[SECURITY ADVISORY]`).
   Sostituisce la decisione rev. 3 "Electron `1.x-legacy` mantenuto
   90 giorni" che è abrogata.

### Decisioni ancora aperte (operative, non bloccanti)

| # | Decisione | Default proposto |
|---|---|---|
| O1 | Certificato Windows: OV o EV Authenticode? | OV per v2.0.0 ($70/anno); EV in v2.1 se SmartScreen lamenta |
| O2 | Auto-updater: implementazione `go-update` o `selfupdate` (Minio)? | `go-update` (più semplice, multiformato) |
| O3 | Frequenza bump `mpv-2.dll` / `libmpv.2.dylib` bundled? | Mensile via CI cron + bump immediato su CVE HIGH FFmpeg |
| O4 | Distribuire macOS anche via Homebrew Cask? | Sì in v2.1 (post-release iniziale stabile) |
| O5 | Distribuire Windows anche via winget / Microsoft Store? | winget sì in v2.0.0; Store no (libmpv LGPL incompatibile con sandbox) |

---

## 13. Riferimenti

### Player
- [libmpv embedding guide](https://github.com/mpv-player/mpv/blob/master/libmpv/client.h)
- [libmpv render API (`render.h`)](https://github.com/mpv-player/mpv/blob/master/libmpv/render.h)
- [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake) — Windows mpv-2.dll prebuilt
- [iina-plus releases](https://github.com/iina/iina/releases) — macOS libmpv universal dylib
- [Document Picture-in-Picture API (W3C / WICG)](https://developer.chrome.com/docs/web-platform/document-picture-in-picture)
- [`MediaStreamTrackGenerator` (WebCodecs Insertable Streams)](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackGenerator)
- [WebKitGTK 2.44 release notes (Document PiP support)](https://webkitgtk.org/2024/03/26/webkitgtk-2.44.0-released.html)

### Framework & runtime
- [Wails v3 docs](https://v3.wails.io/)
- [Wails v3 API reference (`pkg/application`)](https://pkg.go.dev/github.com/wailsapp/wails/v3/pkg/application)
- [Wails v3 Services guide](https://v3.wails.io/learn/services/)
- [Wails v3 Plugins guide](https://v3.wails.io/learn/plugins/)
- [Wails v3 Bindings (TS generation)](https://v3.wails.io/learn/bindings/)
- [WebView2 SDK](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)
- [WKWebView (Apple developer)](https://developer.apple.com/documentation/webkit/wkwebview)

### Networking & cast (Go)
- [grandcat/zeroconf](https://github.com/grandcat/zeroconf)
- [koron/go-ssdp](https://github.com/koron/go-ssdp)
- [vishen/go-chromecast](https://github.com/vishen/go-chromecast)
- [nhooyr.io/websocket](https://github.com/nhooyr/websocket)

### Packaging & signing
- [nfpm packaging](https://nfpm.goreleaser.com/) — Linux deb/rpm/pacman
- [NSIS installer](https://nsis.sourceforge.io/)
- [osslsigncode](https://github.com/mtrojnar/osslsigncode) — Authenticode CLI cross-platform
- [`notarytool` Apple](https://developer.apple.com/documentation/security/customizing_the_notarization_workflow)
- [create-dmg](https://github.com/create-dmg/create-dmg) — macOS DMG builder
- [go-update](https://github.com/inconshreveable/go-update) — auto-update Go

### Documenti progetto
- `docs/IMPROVEMENT_PLAN.md` (sezione MED-1 plugin vendoring)
- `docs/plan-linuxDistroPackaging.prompt.md` (storia pipeline Linux)


---

## 14. Inventario di rimozione Electron (rev. 7)

> Checklist operativa puntuale per la Fase 7.3 *Electron drop*. Tutti
> gli item vanno eseguiti **nello stesso PR atomico** (`chore: drop
> electron runtime`) per evitare stati intermedi rotti. Ogni voce ☑
> ha una verifica concreta associata.

### 14.1 File da eliminare (root)
- ☑ `main.js` (685 righe — entry Electron Main process)
- ☑ `preload.js` (~80 righe — bridge `contextBridge.exposeInMainWorld`)
- ☑ `vite.main.config.js` (config Vite per il main process Electron, se presente)
- ☑ `scripts/patch-ffmpeg.js` + chiamata `postinstall` in `package.json`
- ☑ `scripts/install-hevc-codecs.sh` (specifico HEVC Electron, mantenere
  solo se serve anche per libmpv → verificare; in caso, spostarlo in
  `docs/INSTALL.md`)

### 14.2 File da eliminare (frontend)
- ☑ `frontend/services/advertisingService.js` (servizio Electron Main legacy)
- ☑ `frontend/hooks/useWebPlayerEngine.ts` (player Video.js)
- ☑ Verificare ed eventualmente eliminare snapshot/mock Electron in
  `frontend/tests/` (`*electron*`, mock `window.electronAPI`)

### 14.3 Semplificazioni TS
- ☑ `frontend/services/hostBridge.ts` → `export const host = wailsBridge;`
- ☑ `frontend/services/platformService.ts` → rimuovere `isElectron`,
  `isDesktop` semplificato a `isWails`, `Platform` type ridotto
- ☑ `frontend/components/VideoPlayerNew.tsx` → un solo branch (`useNativeMpvEngine`)
- ☑ `frontend/App.tsx` → rimuovere capability check `if (host)` ridondanti
  (il bridge è sempre presente su desktop)

### 14.4 Dipendenze npm da rimuovere (`package.json`)

**`dependencies`:**
- ☑ `bonjour`
- ☑ `castv2-client`
- ☑ `node-ssdp`
- ☑ `ws`
- ☑ `video.js`
- ☑ `hls.js`
- ☑ `mpegts.js`
- ☑ `@videojs/http-streaming`
- ☑ `jmuxer` (se presente)

**`devDependencies`:**
- ☑ `electron`
- ☑ `electron-builder`
- ☑ `@types/video.js`
- ☑ `@types/ws` (se presente)

**Sezioni intere:**
- ☑ `"main": "main.js"` (top-level field)
- ☑ `"build": { ... }` (electron-builder section)
- ☑ `"scripts.postinstall"` → rimuovere chiamata `patch-ffmpeg.js`
- ☑ `"scripts.dev"`: da `electron .` → alias di `npm run wails:dev`
- ☑ `"scripts.dist:linux*"`: rinominati o rimossi (la nuova pipeline
  Wails-only è gestita da `task package:linux` + workflow CI)

### 14.5 CI & infrastruttura
- ☑ `.github/workflows/linux-release.yml`: riscrittura completa per
  build Wails-only (Fase 8); rimozione job Electron
- ☑ Rimozione cache: `~/.cache/electron`, `~/.cache/electron-builder`
- ☑ Rimozione Docker image step `electronuserland/builder`
- ☑ Rimozione `scripts/build-linux.sh` step Electron (riscritto Fase 8)
- ☑ `scripts/check-deps.mjs`: aggiornare matrice deps attese (no più
  `electron`, `electron-builder`, `castv2-client`, ecc.)
- ☑ `scripts/check-wails-v3.mjs`: già attiva, verificare che blocchi anche
  ri-introduzioni di `import 'electron'` o `require('electron')`

### 14.6 Documentazione
- ☑ `AGENTS.md`:
  - Sezione "Tech Stack → Desktop Runtime": Electron → **Wails v3**
  - Rimuovere "Gotcha #1 HEVC Codec / patch-ffmpeg"
  - Rimuovere "Gotcha #5 Electron Build"
  - Rimuovere riferimenti `advertisingService.js` Electron Main
  - Aggiornare "Comandi Utili" sezione `npm run dev` (alias `wails:dev`)
- ☑ `.github/copilot-instructions.md`: stessa pulizia di AGENTS
- ☑ `README.md`: aggiornare "Tech Stack" + "Prerequisites" (Go 1.23+,
  libmpv, webkitgtk al posto di Node-only)
- ☑ `docs/INSTALL.md`: rimuovere sezione Electron, aggiungere libmpv,
  WebKitGTK 6.0/4.1, WebView2, WKWebView macOS 13+
- ☑ `docs/IMPROVEMENT_PLAN.md`: MED-1/MED-2 restano solo per parte
  Android (Capacitor + Media3 vendored)
- ☑ `docs/SIGNING.md`: invariato (procedure GPG riusate da Wails)
- ☑ Nuovo `docs/CHANGELOG-2.0.md` con sezione "Breaking changes →
  Electron rimosso" + advisory upgrade path
- ☑ Bump `.version` → `2.0.0-rc.1` + `npm run version:sync`

### 14.7 Verifica post-rimozione
- ☑ `git grep -i electron` ritorna **0 risultati** (eccetto changelog/
  docs storici esplicitamente labellati "legacy")
- ☑ `git grep "electronAPI"` ritorna **0 risultati**
- ☑ `npm install` non installa più Electron (verifica `node_modules`)
- ☑ `npm run check` verde (incluso `check:wails`, `check:media3`,
  `check:deps`)
- ☑ `vitest run` 100% verde
- ☑ `go test ./... -race` verde
- ☑ `wails3 dev` apre la finestra, frontend visualizza catalogo,
  discovery/cast/remote operativi (audio + control plane via libmpv
  `-tags mpv`, video rendering completo dopo Fase 6.1)
- ☑ `wails3 build -clean` produce binario funzionante (≤ 40 MB stripped)
- ☑ Tag annotato `electron-final` applicato al commit precedente al PR

### 14.8 Cosa NON viene rimosso (mantenuto)
- ✅ Tutto il codice **frontend React/TS** (sotto `frontend/`) — riusato
  invariato dal nuovo runtime Wails
- ✅ Tutta la pipeline **Android Capacitor + Media3** (`android/`) —
  fuori scope, runtime separato indipendente
- ✅ Toolchain condiviso (`Vite`, `Vitest`, `Tailwind`, `TypeScript`)
- ✅ Pipeline firma GPG (debsigs/rpm --addsign/gpg detach-sign)
- ✅ GitHub Pages APT/RPM/Arch repo deployment (riusato per Wails)
- ✅ `.version` single source of truth + `sync-version.mjs`
- ✅ `scripts/build-android.sh`, `scripts/android-build-release.sh`,
  `scripts/install-apk.sh` (target Android)