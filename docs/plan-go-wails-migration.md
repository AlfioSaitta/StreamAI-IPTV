# 🚀 Piano di Migrazione: Electron → Go + Wails v3

> **Status:** In esecuzione — **revisione 7.1** (snapshot stato 2026-05-22)  
> **Owner:** Maintainer StreamAI-IPTV  
> **Target ramo:** `feat/wails-migration` (long-lived → diventerà `main` al merge)  
> **Versione di partenza:** `1.x` Electron  
> **Versione di arrivo:** `2.0.0` Wails v3 — **Linux + Windows + macOS day-1**  
> **Ultima revisione:** 2026-05-22 (rev. 7.1)

> ## 📐 Riordino fasi rev. 7.1 (2026-05-22) — feature-first, packaging-last
>
> **Direttiva del maintainer (2026-05-22):** prima ci si assicura che tutte
> le funzionalità siano implementate e funzionanti, poi si fa il packaging.
> Le **Fasi 8 / 9 / 9-bis (Packaging Linux/Windows/macOS) vengono spostate
> in coda**, dopo la QA cross-platform (Fase 10) e prima della release
> docs (Fase 11). Il nuovo ordine operativo è:
>
> | Ordine | Fase | Stato | Note |
> |---|---|---|---|
> | 1 | Fase 0 — Preparazione & baseline | ✅ | 2026-05-18 |
> | 2 | Fase 1 — Scheletro Wails v3 | ✅ | 2026-05-18 |
> | 3 | Fase 2 — Discovery & advertising | ✅ | 2026-05-19 |
> | 4 | Fase 2-bis — DIAL HTTP receiver | ✅ | 2026-05-19 |
> | 5 | Fase 3 — Cast (Chromecast CastV2) | ✅ | 2026-05-19 |
> | 6 | Fase 4 — Remote control & UDP status | ✅ | 2026-05-19 |
> | 7 | Fase 5 — HTTP proxy IPTV + header rewrite | ✅ | 2026-05-20 / FIX 2026-05-24 |
> | 7.1 | **Fase 5.1 — Helper proxyFetch & EPG fix** | ✅ | **2026-05-25** — risolve CORS/mixed-content su WebKitGTK per EPG/XMLTV |
> | 8 | Fase 7-bis (OS integration) | ✅ | **COMPLETATA** — MediaKeys, PowerSave, Tray e lifecycle integrati nel player. |
> | 9 | Fase 7 (compat layer TS) | ◐ | 7.1 ✅, 7.2 ✅, 7.3 Stage A ✅ (2026-05-22), Stage B post-6.1 |
> | 10 | **Fase 6.5 — PlayerService wiring & state events** | ✅ | **completata 2026-05-22** — collegati PowerSave/MediaKeys/NetStatus/Tray |
> | 11 | **Fase 6.6 — Ottimizzazioni UI & Performance Wails** | ✅ | **completata 2026-05-25** — CatalogWorker, Unicode Cache, Image Cache proxy |
> | 12 | Fase 7-bis.8 — Data migration v1→v2 IndexedDB | ✅ | **COMPLETATA** — implementato extractor Go + migration bridge frontend |
> | 13 | Fase 7-bis.9 — Notifiche di sistema | ✅ | **COMPLETATA** — wrapper cross-platform (D-Bus/PowerShell/osascript) |
> | 14 | **Fase 6 — Player video + libmpv + WebGL2** | ✅ | **completata 2026-05-25** — integrated libmpv with WebGL2 canvas rendering |
> | 15 | Fase 7.3 Stage B — Drop player legacy Web | ✅ | completata 2026-05-25 — engine 'mpv' predefinito su Wails, Video.js rimosso dal bundle principale (dynamic import) |
> | 16 | Fase 10 — QA & soak test cross-platform | ◐ | in corso 2026-05-25 — verificata stabilità shutdown e rendering MPV |
> | 17 | Fase 11 — Documentazione finale | ☐ | |
> | 18 | **Fase 8 — Packaging Linux (nfpm)** | ✅ | completata 2026-05-25 — pipeline basata su nfpm per .deb, .rpm, .pkg.tar.zst |
> | 19 | **Fase 9 — Packaging Windows (NSIS+WebView2+mpv-2.dll)** | ☐ | spostata in coda |
> | 20 | **Fase 9-bis — Packaging macOS (DMG+notarization)** | ☐ | spostata in coda |
> | 21 | Fase 12 — Release v2.0.0-rc.1 → v2.0.0 | ☐ | nuovo step finale |
>
> **Razionale del riordino:**
> 1. **Riduzione del rischio di throw-away work**: senza tutte le feature
>    stabili, ogni iterazione di packaging richiede rebuild + re-test su 3 OS.
>    Spostando in coda, le pipeline `nfpm`/NSIS/DMG vengono progettate **una
>    sola volta** sul binario definitivo.
> 2. **Convergenza prima della distribuzione**: rilasciare beta `rc` prima
>    che data-migration o player nativo siano pronti significherebbe esporre
>    utenti a regressioni P0 (data-loss, no playback HEVC) che la rev. 9
>    rollout già escludeva. Meglio uscire con un solo `rc.1` "feature-complete".
> 3. **Compattezza del feature-freeze**: la QA cross-platform (Fase 10) gira
>    una sola volta su un binario stabile, niente cicli di "rebuild → ritesta".
> 4. **Pacchetti Linux temporanei**: per uso dev/QA interno resta possibile
>    fare `npm run wails:build` che produce un binario standalone in
>    `build/bin/streamai` — sufficiente per smoke test senza nfpm.
> 5. **Nuova Fase 6.5** identificata come "low-hanging fruit": il wiring
>    PlayerService → PowerSave/MediaKeys/Tray/NetStatus è puro Go, non
>    dipende dagli SPIKE HW, sblocca 4 feature dichiarate "rinviate a Fase 6"
>    in vari sotto-step di 7-bis.
>
> Vedi §6 (roadmap operativa) per la struttura aggiornata.

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

### 1.1 Cosa fa oggi Electron per noi

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

### 1.2 Cosa NON fa Electron (resta uguale post-migrazione)

- Front-end React 19 + Vite + Tailwind (`App.tsx`, `components/`, `services/*.ts`)
- Build Android (Capacitor 7 + Media3 1.10.1) — completamente fuori scope
- Worker M3U, parsing Xtream, profilazione, AI Gemini, image cache, EPG —
  tutto puro TS/Browser API
- Service worker / PWA (`public/manifest.json`)

### 1.3 Misure di riferimento (da catturare prima di iniziare)

Da raccogliere come "baseline KPI" su una macchina Linux x86_64 di riferimento:

- Dimensione `.deb` / `.rpm` / `.pkg.tar.zst` (oggi: ~95–110 MB ciascuno)
- Dimensione installata (oggi: ~250 MB)
- RAM idle a finestra aperta (oggi: ~280–350 MB)
- RAM con stream HLS 1080p in playback (oggi: ~450–600 MB)
- RAM con stream HLS HEVC 4K (oggi: ~700–900 MB)
- Tempo di avvio cold-start (oggi: ~2.5–3.5 s)
- Tempo TTFF stream HLS (oggi: ~1.2–1.8 s)
- **Dropped frame % su HEVC 10-bit 4K@60** (HW decode) ← baseline da catturare
- **Dropped frame % su AV1 4K@60** ← baseline da catturare
- **AV-sync drift medio / peak su HLS live HEVC 4K, sessione 1h** ← baseline da catturare
- CPU% medio durante playback HEVC 4K HW (oggi: ~15–25%)
- Supporto codec verificato: H.264, HEVC/H.265, AV1, AAC, AC3, EAC3, Opus

→ vedi §11 *Criteri di accettazione*.

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

Nel front-end TS, `services/platformService.ts` esporrà un nuovo flag
`isWails` (= `!!(globalThis as any).wails`) e un nuovo adapter
`services/wailsBridge.ts` che riesporta gli stessi nomi di `electronAPI`,
così **i componenti UI non cambiano**.

### 3.1 Shim di compatibilità (esempio v3)

```ts
// services/platformService.ts (estratto)
export const platformService = {
  isElectron: !!(window as any).electronAPI,
  isWails: !!(globalThis as any).wails,        // v3 attacca `wails` globale
  isNative: /* Capacitor */ ...,
  isWeb: ...,
};
```

```ts
// services/wailsBridge.ts (v3 idiom)
import { DiscoveryService } from '../frontend/bindings/streamai/services/discovery';
import { CastService }      from '../frontend/bindings/streamai/services/cast';
import { NetStatusService } from '../frontend/bindings/streamai/services/netstatus';
import { Events }           from '@wailsio/runtime';

export const wailsAPI = {
  discoverDevices:     DiscoveryService.DiscoverDevices,
  getLocalIPs:         DiscoveryService.GetLocalIPs,
  scanIp:              DiscoveryService.ScanIP,
  probeDeviceServices: DiscoveryService.ProbeDeviceServices,
  castConnect:         CastService.Connect,
  castLoad:            CastService.Load,
  castControl:         CastService.Control,
  castDisconnect:      CastService.Disconnect,
  updatePlaybackStatus: NetStatusService.UpdatePlaybackStatus,

  onDeviceFound: (cb: (d: Device) => void) =>
    Events.On('device-found', e => cb(e.data as Device)),
  onCastStatus: (cb) => Events.On('cast-status', e => cb(e.data)),
  onNetworkPlaybackStatus: (cb) => Events.On('network-playback-status', e => cb(e.data)),
  onRemoteControlCommand: (cb) => Events.On('remote-control-command', e => cb(e.data)),
  onRequestStatusBroadcast: (cb) => Events.On('request-status-broadcast', () => cb()),
};
```

```ts
// services/hostBridge.ts (unico point of entry)
// NOTA rev. 7: la dual-mode `isWails ? wailsAPI : electronAPI` è
// transitoria, attiva SOLO durante la Fase 7.2 (sweep dei call site).
// Alla Fase 7.3 (Electron drop) questa funzione diventa una semplice
// riesportazione di `wailsAPI` senza alcuna ramificazione runtime.
export const host = platformService.isWails
  ? wailsAPI
  : (window as any).electronAPI;
```

→ tutti i `window.electronAPI` esistenti vengono sostituiti con `host`
(regex one-shot, ~20 occorrenze).


### 3.2 Inventario completo Electron → Wails (gap analysis, rev. 5)

Estratto da analisi statica di `main.js`, `preload.js`,
`frontend/services/advertisingService.js`. Le righe ✅ sono coperte
dal piano; le righe ⚠️ richiedono task aggiunti in questa revisione.

| # | Feature Electron (file:line) | Stato piano | Wails v3 target | Fase |
|---|---|---|---|---|
| E1 | `BrowserWindow({backgroundColor:'#141414', autoHideMenuBar:true, icon})` (main.js:259) | ✅ | `app.Window.NewWithOptions({BackgroundColour, …})` + asset `build/icons/` | 1 |
| E2 | `webPreferences.webSecurity / allowRunningInsecureContent` (main.js:264-271) | ⚠️ Indiretto | Proxy HTTP locale + libmpv `tls-verify=no` opt-in | 5 |
| E3 | `session.setCertificateVerifyProc()` + `certificate-error` (main.js:276-284) | ⚠️ Indiretto | libmpv `tls-verify=no` + proxy `InsecureSkipVerify` | 5 |
| E4 | `webRequest.onBeforeSendHeaders` → UA "StreamAI IPTV" + no-cache (main.js:286-295) | ✅ | `proxy.RewriteRequest()` middleware | 5 |
| E5 | `webRequest.onHeadersReceived` → strip CSP/X-Frame-Options + CORS `*` (main.js:297-307) | ✅ | `proxy.RewriteResponse()` middleware | 5 |
| E6 | Chromium switches: `enable-features=VaapiVideoDecoder, ProprietaryCodecs, …` (main.js:229-251) | ✅ N/A | libmpv `hwdec=auto-safe` (no webview decode) | 6 |
| E7 | `STREAMAI_INSECURE_ELECTRON` env opt-in | ⚠️ | `STREAMAI_INSECURE=1` → proxy + libmpv flag | 5 |
| E8 | `ipcMain.handle('get-local-ips')` (main.js:512) | ✅ | `DiscoveryService.GetLocalIPs` | 2 ✅ |
| E9 | `ipcMain.handle('probe-device-services')` (main.js:528) | ✅ | `DiscoveryService.ProbeDeviceServices` | 2 ✅ |
| E10 | `ipcMain.handle('scan-ip')` (main.js:533) | ✅ | `DiscoveryService.ScanIP` | 2 ✅ |
| E11 | `ipcMain.handle('discover-devices')` SSDP + scan **prime 3 NIC** (main.js:544-560) | ✅ | `DiscoveryService.DiscoverDevices` (allineare slice 3 NIC) | 2 ✅ |
| E12 | Event `device-found` durante scan (streaming) (main.js:149,182) | ✅ | `wailsevents.Emit("device-found", dev)` | 2 ✅ |
| E13 | `ipcMain.handle('cast-connect/load/control/disconnect')` (main.js:562-641) | ✅ | `CastService.*` | 3 ✅ |
| E14 | Event `cast-status` polling 1s (main.js:64) | ✅ | `wailsevents.Emit("cast-status", st)` diff-emit | 3 ✅ |
| E15 | Cast `Seek` (main.js:628) | ⚠️ Lib lacuna | Canale CastV2 raw via `client.NewChannel` | 3-bis |
| E16 | WebSocket `:1902` server + `wsClients` set (main.js:441-506) | ✅ | `remote/service.go` `coder/websocket` | 4 ✅ |
| E17 | WS replay `lastStatus` al nuovo client (main.js:460) | ✅ | `remote.lastSt` snapshot | 4 ✅ |
| E18 | WS emit `request-status-broadcast` al primo client (main.js:464) | ✅ | `wailsevents.Emit("request-status-broadcast")` | 4 ✅ |
| E19 | WS ping/pong keepalive 30s (main.js:486) | ✅ | `remote.pingLoop()` | 4 ✅ |
| E20 | WS forward `remote-control-command` (main.js:478) | ✅ | `wailsevents.Emit("remote-control-command", cmd)` | 4 ✅ |
| E21 | UDP listener multicast 239.255.255.251:1901 (main.js:324-357) | ✅ | `netstatus.listenLoop()` | 4 ✅ |
| E22 | UDP broadcaster per-interface (multicast + .255 broadcast) (main.js:400-435) | ✅ | `netstatus.UpdatePlaybackStatus()` | 4 ✅ |
| E23 | `deviceId = os.hostname()` filtro self-loop (main.js:27, 338) | ✅ | `netstatus.DeviceID()` | 4 ✅ |
| E24 | Event `network-playback-status` verso renderer (main.js:342) | ✅ | `wailsevents.Emit("network-playback-status", st)` | 4 ✅ |
| E25 | WS forward status anche a wsClients (main.js:430-434) | ✅ | `remote.BroadcastStatus()` chiamato da netstatus | 4 ✅ |
| E26 | `advertisingService.start/stop` mDNS AirPlay (advertisingService.js:106-129) | ✅ | `advertising/mdns.go` zeroconf | 2 ✅ |
| E27 | `advertisingService` SSDP/DIAL announce + USN (advertisingService.js:131-157) | ✅ | `advertising/ssdp.go` go-ssdp | 2 ✅ |
| E28 | **HTTP server :8090 `/dial.xml` + `/apps/<APP>` GET/POST** (advertisingService.js:159-268) | ✅ | `advertising/dial_http.go` (retry 8090..8094) | 2-bis ✅ |
| E29 | `ipcMain.on('update-playback-status')` → DIAL `state=running` (advertisingService.js:36) | ✅ | `netstatus.SetDIALStateSetter(advertising)` bridge | 2-bis ✅ |
| E30 | `app.whenReady` → createWindow (main.js:647) | ✅ | `app.Run()` blocking | 1 |
| E31 | `app.on('window-all-closed') → quit` (main.js:649) | ⚠️ | `app.OnEvent(events.Common.ApplicationOpenedWithFile…)` + macOS dock keep-alive | 7-bis |
| E32 | `app.on('activate') → re-create window` macOS dock (main.js:655) | ⚠️ | `app.OnEvent("activate")` | 7-bis |
| E33 | `app.on('will-quit')` → cleanup ordinato (main.js:661) | ⚠️ | `ServiceShutdown()` per ogni Service Wails v3 | 7-bis |
| E34 | App icon embed (`icon: path.join(__dirname,'icon.png')`) (main.js:263) | ⚠️ | Wails v3: `application.Options{Icon: icon.png bytes}` + asset bundle | 1 / 7-bis |
| E35 | `unlimited-storage` Chromium switch (main.js:210) | ❌ MANCA | WebKitGTK / WebView2 / WKWebView quota IndexedDB diversa → **export/import profili v1→v2** | 7-bis |
| E36 | (assente in v1) Power-save / display-sleep prevention durante playback | ❌ MANCA | `org.freedesktop.ScreenSaver.Inhibit` (Linux DBus) + `SetThreadExecutionState(ES_DISPLAY_REQUIRED)` (Win) + `IOPMAssertionCreateWithName("PreventUserIdleDisplaySleep")` (macOS) | 7-bis |
| E37 | (assente in v1) Media keys hardware (Play/Pause/Next) | ❌ MANCA | MPRIS2 DBus (Linux), SMTC (Win), MPNowPlayingInfoCenter (macOS) | 7-bis |
| E38 | (assente in v1) Single-instance lock | ❌ MANCA | `flock` su `$XDG_RUNTIME_DIR/streamai.lock` cross-OS | 7-bis |
| E39 | (assente in v1) System tray | ❌ MANCA | `app.NewSystemTray()` Wails v3 | 7-bis |
| E40 | (assente in v1) Logging file rotante | ❌ MANCA | `zerolog` + `lumberjack` su `$XDG_STATE_HOME/streamai/streamai.log` | 7-bis |
| E41 | (assente in v1) Crash recovery / panic capture | ❌ MANCA | `recover()` top-level + dump su file `crash-<ts>.log` | 7-bis |
| E42 | HTML5 Notifications API (frontend) | ⚠️ | WebKitGTK richiede `webkit_web_context_set_preferred_languages`+ permission grant; in Wails v3 esposto via `application.NotificationService` | 7-bis |
| E43 | DevTools webview (Electron Ctrl+Shift+I) | ⚠️ | Wails v3: `application.Options{Debug:{Enabled:true}}` solo in dev build | 1 |

**Sintesi gap rev. 5:** 13 task nuovi (E28, E29, E31–E42 al netto delle ✅).
Tutti raggruppati nelle nuove fasi **2-bis** (DIAL receiver) e **7-bis**
(integrazione OS + lifecycle + data migration). Stima incrementale:
**+5 gg-uomo** sul totale (≈ 50 → ≈ 55 gg).

### 3.3 Snapshot stato 2026-05-20 (rev. 6)

| Componente | Stato | Note |
|---|---|---|
| `cmd/streamai/main.go` | ✅ | Single-instance + logging + crashguard + 9 Service registrati + tray + devtools opt-in + reverse-shutdown order |
| `internal/services/discovery/` | ✅ | SSDP + subnet /24 + mDNS browse + ProbeServices |
| `internal/services/advertising/` | ✅ | mDNS + SSDP + **DIAL HTTP receiver** (Fase 2-bis) |
| `internal/services/cast/` | ✅ | barnybug/go-cast, polling 1s diff-emit; `Seek` non implementato (Fase 3-bis) |
| `internal/services/remote/` | ✅ | coder/websocket :1902, replay lastSt, request-status-broadcast |
| `internal/services/netstatus/` | ✅ | UDP multicast :1901, bridge DIAL state, bridge WS broadcaster |
| `internal/services/proxy/` | ✅ | HTTP proxy IPTV `127.0.0.1:<random>` con strip CSP/XFO + UA rewrite + TLS-skip opt-in |
| `internal/services/player/` | ⚠️ scaffold | Dispatcher + stub backend + cgo backend (`-tags mpv`) ✅ 2026-05-21; render-API + PiP ❌ gated da SPIKE-1/2/4 |
| `internal/services/powersave/` + `pkg/powersave/` | ✅ | DBus ScreenSaver (Linux), SetThreadExecutionState (Win), caffeinate (macOS) |
| `internal/services/mediakeys/` + `pkg/mediakeys/` | ✅ Linux | MPRIS2 D-Bus; SMTC Win + MPNowPlaying macOS rinviati |
| `internal/pkg/singleinstance/` | ✅ | flock + unix socket FOCUS IPC (Unix); stub Windows |
| `internal/pkg/logging/` | ✅ | zerolog + lumberjack, XDG paths + override `STREAMAI_LOG_FILE` |
| `internal/pkg/crashguard/` | ✅ | `Recover` top-level, crash-<ts>.log next to log file |
| `internal/pkg/tray/` | ✅ | SystemTray menu Mostra/Log/Esci; PiP+Pausa rinviate a Fase 6 |
| `internal/pkg/devtools/` | ✅ | `STREAMAI_DEBUG=1` opt-in, Ctrl+Shift+I / F12 |
| `internal/pkg/appicon/` | ✅ | 256×256 + 512×512 embed |
| `internal/pkg/wailsevents/` | ✅ | Emit helper con guard early-startup |
| `frontend/bindings/` | ✅ generato | 9 Service, 54 metodi, 13 model — `npm run wails:bindings` (warning `DIALStateSetter` ✅ risolto 2026-05-21, vedi §3.4) |
| `services/platformService.ts` | ✅ | Esteso 2026-05-20 con `isWails` + `isDesktop` (Fase 7.1) |
| `services/wailsBridge.ts` | ✅ | Creato 2026-05-20 (Fase 7.1) — wrap di discovery/cast/netstatus |
| `services/hostBridge.ts` | ✅ | Creato 2026-05-20 (Fase 7.1) — accessor `host` runtime-switched |
| Sostituzione `window.electronAPI` (35 occ.) | ✅ | Sweep completato 2026-05-20 (Fase 7.2) — 15 occorrenze effettive su 6 file via `host` accessor |
| `package.json` deps `@wailsio/runtime` | ✅ | `@wailsio/runtime@3.0.0-alpha.79` (Fase 7.1) |
| `nfpm.yaml` + `linux-release.yml` Wails | ❌ | Fase 8 |
| Workflow Windows / macOS | ❌ | Fase 9 / 9-bis |
| Data migration v1 → v2 (IndexedDB) | ❌ | Fase 7-bis.8 — critica, non iniziata |
| Notifiche di sistema | 🚧 | Fase 7-bis.9 bloccata su upstream Wails alpha.93 |

### 3.4 Warning bindings noto (DIALStateSetter) — ✅ RISOLTO 2026-05-21

`wails3 generate bindings ./...` emetteva un warning su
`netstatus.SetDIALStateSetter(b DIALStateSetter)`: i parametri di tipo
interface non-vuoto non sono serializzabili via `encoding/json` e il
binding generato accetterebbe solo `null`. **Mitigazione adottata:** il
metodo è stato rimosso dalla superficie pubblica del Service e la
dipendenza `DIALStateSetter` è ora iniettata tramite il costruttore
`netstatus.New(ws, dial)`. Ordine di costruzione in `cmd/streamai/main.go`
invertito (advertising prima di netstatus) per accomodare la
constructor injection. Bindings rigenerati: 9 Service, **54 metodi**, 13
model, **0 warning**. Inoltre `package.json` `wails:bindings` e
`Taskfile.yml` `generate:bindings` ora invocano `wails3 generate
bindings ./...` con il pattern di pacchetti esplicito (senza, alpha.93
processa 0 Service).


---

## 4. Player video integrato + Picture-in-Picture (architettura dettagliata)

Sezione critica: il punto di maggior costo ingegneristico della migrazione.
Implementiamo **un solo backend** (D), uguale su tutti e 3 gli OS.

### 4.1 Pipeline unico: libmpv → canvas WebGL

```
┌───────────────────────────────────────────────────────────────┐
│  hooks/useNativeMpvEngine.ts                                  │
│  ─ una sola implementazione, stessa shape su Linux/Win/macOS  │
│  ─ accetta StreamSource → Mpv.Load(url, headers)              │
│  ─ riceve frame RGBA via shared-memory ring buffer            │
│  ─ renderizza in <canvas> WebGL2 a 60 fps                     │
└───────────────────────────┬───────────────────────────────────┘
                            │ Wails bindings + shared memory
                            ▼
┌───────────────────────────────────────────────────────────────┐
│  Backend Go: internal/player/                                 │
│   ├── mpv_render.go   ← cgo su libmpv, render-API OpenGL      │
│   ├── transport_shm_unix.go    (Linux + macOS: shm_open+mmap) │
│   ├── transport_shm_windows.go (Win: CreateFileMapping)       │
│   └── ipc.go          ← controlli (play/pause/seek/volume/sub)│
└───────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────────┐
│  Picture-in-Picture (hooks/usePictureInPicture.ts)            │
│   1. Document PiP API (preferito, tutti gli OS target ≥2024)  │
│   2. MediaStreamTrackGenerator + <video> hidden (fallback)    │
│   3. Wails second-window borderless always-on-top (safety)    │
└───────────────────────────────────────────────────────────────┘
```

Niente più backend B / A / engine selector: una sola classe `MpvEngine` con
le stesse API esposte oggi da `useWebPlayerEngine.ts`. La logica di proxy IPTV
(§5) resta per riscrivere header HTTP, ma **non fa transmuxing**: passa
l'URL così com'è a libmpv, che gestisce HLS/DASH/MPEG-TS/MP4 nativamente.

### 4.2 Backend D — libmpv render-API → `<canvas>` in-DOM

È la strada per HEVC/AV1/qualunque codec + qualsiasi container, **integrata
nel DOM**. Lo schema concreto:

**Lato Go (`internal/player/mpv_render.go`):**

1. `mpv_create()` + opzioni: `vo=libmpv`, `hwdec=auto-safe`, `gpu-api=opengl`,
   `gpu-context=auto`, `terminal=no`, `idle=yes`, `keep-open=always`.
2. `mpv_render_context_create()` con `params = [MPV_RENDER_PARAM_API_TYPE
   → "opengl", MPV_RENDER_PARAM_OPENGL_INIT_PARAMS → get_proc_address]`.
3. Crea un **OpenGL FBO** off-screen di dimensioni `WxH` (resize ogni 100 ms se
   il canvas DOM cambia size).
4. Al callback `mpv_render_context_set_update_callback`, su goroutine
   dedicata: `mpv_render_context_render` → FBO → `glReadPixels` (RGBA8) → buffer.
5. Il buffer viene esposto al webview con uno dei tre transport (vedi §4.3):
   shared-memory zero-copy preferito.

**Lato webview (`hooks/useNativeMpvEngine.ts`):**

```ts
const canvas = canvasRef.current;
const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: false });
// ... shader pass-through RGBA su quad fullscreen ...

// 60 fps render loop, alimentato dai frame in arrivo dal backend Go
const onFrame = (frame: ArrayBuffer, w: number, h: number) => {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
};
host.onPlayerFrame(onFrame);
```

L'OSD HTML (timeline, controlli, info canale, sottotitoli renderizzati da
mpv come bitmap overlay o passati grezzi al DOM) **vive in elementi React
posizionati `absolute` sopra il `<canvas>`** — è esattamente lo stesso layout
di oggi con Video.js. Z-index, blur, hover tooltip, ghost-bar: tutto invariato.

### 4.3 Transport mpv → canvas (il dettaglio che fa la differenza)

Il rendering a 1080p@60 = ~500 MB/s di RGBA grezza. Serve transport efficiente.
Tre tier di implementazione, in ordine di preferenza:

| Tier | Tecnica | Throughput | Compatibilità |
|------|---------|-----------|---------------|
| T1 | **Shared GL context fra mpv e webview** (più veloce, zero-copy) | nativo | Solo se la webview espone il proprio GL context — fattibile su WebKit2GTK con `WebKitWebView` + `epoxy`, complesso ma documentato; difficile su WebView2/WKWebView |
| T2 | **POSIX shared memory** (`shm_open` + `mmap`) lato Go ↔ webview che mappa via WebAssembly+`ArrayBuffer` o **Wails v3 custom plugin** che espone `Bytes()` zero-copy | ~2 GB/s | Linux/macOS facile; Windows usa `CreateFileMapping`; v3 Plugin API permette di restituire `[]byte` senza serializzazione JSON |
| T3 | **MediaStreamTrackGenerator** (WebCodecs Insertable Streams): Go → `VideoFrame` (libwebrtc/cgo o I420 raw) → JS riceve `VideoFrame` via `MessageChannel`/`postMessage` su `WritableStream` di un `MediaStreamTrack`, poi `<video srcObject>` o pixel su canvas | ~hardware-bound | Richiede WebKit2GTK 2.42+ (WebCodecs), Chromium 94+ (WebView2), Safari 16.4+ |
| T4 | **Local fMP4 over HTTP** (mpv → ffmpeg encoder → fragmented MP4 → MSE) — *non zero-copy ma sempre funzionante* | encoder-bound | Tutte le webview con MSE |

> **Strategia per la migrazione:**
> - **MVP (fase 6)** = **T2 (shared memory)** + **T3 come fallback per
>   piattaforme senza shm comodo**. T2 è il miglior compromesso
>   complessità/performance ed è ben supportato da Wails tramite custom
>   handler binding `Bytes()`.
> - **Optimization (fase 6-bis, post-2.0.0)** = passare a **T1** dove
>   possibile su Linux (zero-copy GL).
> - **Last resort** = **T4** per macchine senza WebCodecs (vecchie webview).

### 4.4 Picture-in-Picture: il piatto forte

Backend D usa un `<canvas>` (non un `<HTMLVideoElement>`), quindi
`requestPictureInPicture()` classico non si applica. Tre tecniche, in
cascata, con stato verificato sui 3 OS target a 2026-05:

#### 4.4.1 Document Picture-in-Picture API *(preferito, default)*

`window.documentPictureInPicture.requestWindow({ width, height })` apre una
**nuova finestra del browser di sistema** che può contenere *qualsiasi
DOM*. Codice (semplificato):

```ts
const pipWin = await window.documentPictureInPicture.requestWindow({
  width: 640, height: 360, disallowReturnToOpener: false,
});
// Sposto il <canvas> (o un suo clone) nel documento PiP:
pipWin.document.body.append(canvasContainer);
// Quando l'utente chiude la PiP window, riporto il canvas nella main UI:
pipWin.addEventListener('pagehide', () => {
  mainContainerRef.current.appendChild(canvasContainer);
});
```

Stato del supporto a 2026-05:
- **Chromium 116+** (WebView2 incluso): ✅ stabile dal 2023.
- **WebKit2GTK 2.44+** (Linux): ✅ disponibile dietro `WEBKIT_FEATURE_DOCUMENT_PIP=1`.
- **WKWebView macOS 14+** (Sonoma): ✅.

→ Su tutte le piattaforme target di v2.0.0, **Document PiP è disponibile**.

#### 4.4.2 Fallback `MediaStreamTrackGenerator` → `<video>.requestPictureInPicture()`

Quando Document PiP non è disponibile (es. WebKit2GTK su distro vecchie senza
`webkit2gtk-4.1` 2.44+), si attiva un *secondo* pipeline:

```ts
const generator = new MediaStreamTrackGenerator({ kind: 'video' });
const writer = generator.writable.getWriter();
// ogni frame ricevuto da Go (i420/RGBA) → VideoFrame WebCodecs → writer.write()
const videoEl = document.createElement('video');
videoEl.srcObject = new MediaStream([generator]);
videoEl.play();
await videoEl.requestPictureInPicture();
```

Il `<video>` non viene mostrato nella UI principale (è hidden), serve solo
come *handle* per il PiP nativo. Performance leggermente peggiori (frame
copy in più), ma 100% compatibile con tutte le webview che supportano
WebCodecs (WebKit2GTK 2.42+, Chromium 94+, Safari 16.4+).

#### 4.4.3 Fallback finale: PiP "fasullo" via finestra Wails secondaria

Se *anche* WebCodecs manca (estremamente improbabile su distro supportate),
si sfrutta il **multi-window API nativo di Wails v3** chiamando
`app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
Frameless: true, AlwaysOnTop: true, ...})` per aprire una seconda finestra
borderless always-on-top che ospita il canvas. Comandi tastiera/mouse
restano funzionanti tramite gli eventi v3 condivisi. È brutto ma è una
rete di sicurezza che funziona su tutti e 3 gli OS senza codice nativo
aggiuntivo.

### 4.5 Sottotitoli, audio tracks, capitoli, OSD

- **Sottotitoli incorporati** (SRT/ASS/PGS/VobSub): renderizzati da libmpv
  (`sub-visibility=yes`), bitmap overlay già compositata sul frame RGBA
  → arriva al canvas già "stampata". Per ASS animati funziona perfettamente.
- **Sottotitoli esterni** (`.srt` caricato da `subtitleService.ts`): passati
  a libmpv via `sub-add` JSON-IPC; nessun cambio UI lato front-end.
- **Audio tracks multiple:** comando IPC `set property aid <id>`. Lista
  tracce esposta come prop reattiva (`app.EmitEvent("player-tracks", ...)`).
- **OSD HTML** (volume/seek bar/spinner): DOM React sopra il canvas, come oggi.
- **Codec audio HW** (AC3, EAC3, TrueHD): libmpv passa a ALSA/PulseAudio/
  PipeWire/WASAPI/CoreAudio. Niente Chromium pipeline da gestire.

### 4.6 Recap "PiP funziona ovunque" (matrice)

| Piattaforma | Webview | Tecnica PiP primaria | Fallback | Stato |
|---|---|---|---|---|
| Linux Ubuntu 24.04+ / Fedora 40+ / Arch / openSUSE TW | WebKit2GTK ≥ 2.44 | Document PiP API | MediaStreamTrackGenerator | ✅ |
| Linux Ubuntu 22.04 / Debian bookworm | WebKit2GTK 2.36–2.40 | MediaStreamTrackGenerator (WebCodecs 2.42+ se aggiornato) | Wails second-window | ⚠️ Documentato come "esperienza ridotta" |
| Windows 10 21H2+ / Windows 11 | WebView2 (Chromium 116+ evergreen) | Document PiP API | MediaStreamTrackGenerator | ✅ |
| macOS 14 Sonoma+ | WKWebView | Document PiP API | MediaStreamTrackGenerator | ✅ |
| macOS 13 Ventura | WKWebView | MediaStreamTrackGenerator | Wails second-window | ✅ (degraded) |

→ Vincolo PiP: **soddisfatto su tutte le piattaforme target** day-1.

### 4.7 Codec proprietari: HEVC, AV1, AC3, EAC3, Opus

Con libmpv in backend D, **tutti** disponibili senza patch FFmpeg:
- HW decode: VAAPI (Intel/AMD), NVDEC (NVIDIA), VDPAU (legacy NVIDIA),
  D3D11VA (Windows), VideoToolbox (macOS).
- Fallback SW: libavcodec di sistema (FFmpeg ≥ 5.0 ha HEVC, AV1, AC3, EAC3).
- 10-bit / HDR10 / Dolby Vision Profile 5/8: libmpv supporta tone-mapping
  e color management, esposti via `--target-prim`, `--target-trc`.

→ Risolve il "vero scoglio" della rev1 senza più dipendere da `patch-ffmpeg.js`.

### 4.8 Qualità di riproduzione: 4K fluido + AV sync (vincolo)

> **Vincolo aggiuntivo (rev. 5):** il player deve riprodurre **contenuti 4K
> (3840×2160, fino a 60 fps, HEVC 10-bit / AV1)** in modo fluido e con
> sincronia audio/video impeccabile su HW di fascia consumer moderna
> (Intel UHD Graphics 770+ / AMD RDNA2+ / NVIDIA Maxwell+ / Apple Silicon /
> Intel ≥ 11ª gen iGPU). Drift AV ≤ ±40 ms a regime, nessun
> sync re-snap visibile/udibile su sessioni di 1+ ora. Vedi §4.8.

#### 4.8.1 Pipeline a 4K, decisioni chiave

A 4K@60 il throughput nominale di un frame RGBA8 unpacked è ~500 MB/s:
inaccettabile da copiare due volte (libmpv → shm → WebGL upload). Per
preservare la fluidità si adottano queste decisioni:

1. **HW decode obbligatorio a 4K**: `hwdec=auto-safe` ⇒ VAAPI/NVDEC/D3D11VA/
   VideoToolbox. Se HW decode non disponibile, libmpv tenta SW ma il player
   emette warning UI ("Decoding software a 4K può scattare") via
   `StreamDiagnostics.tsx`.
2. **Surface output in formato nativo del decoder** (NV12 / P010 / DRM PRIME
   FD), **non** RGBA. La conversione di colorspace e la YUV→RGB **avviene
   nello shader WebGL2 sul frontend**, non in `glReadPixels`. Riduzione
   bandwidth: ~250 MB/s (NV12 8-bit) o ~330 MB/s (P010 10-bit) invece di
   ~500 MB/s, e niente costo CPU per la conversione.
3. **Transport shm a doppio ring buffer** (NV12 plane Y + plane UV
   contigui), allineato a 4096 byte; il frontend lega le due planes a
   due `gl.TEXTURE_2D` con `gl.LUMINANCE` (Y) e `gl.LUMINANCE_ALPHA` (UV)
   o `gl.RG8` (WebGL2 core) per shader BT.709/BT.2020 → sRGB matrix.
4. **Zero-copy DRM-PRIME su Linux (fast path)**: quando libmpv decodifica
   con VAAPI/NVDEC, esporta un file descriptor DRM-PRIME del frame. Il
   frontend riceve l'FD via Wails plugin custom, lo importa come
   `EGLImage` → `glEGLImageTargetTexture2DOES`. Latenza ~0 ms, nessuna
   copia in RAM CPU. Implementazione opzionale (SPIKE-5 dedicato, vedi
   §6.0); se non disponibile, fallback a path #2.
5. **Cap di throughput dinamico**: se 4 frame consecutivi superano
   l'sla di render (16.6 ms a 60 fps), libmpv viene messo in
   `framedrop=vo` per evitare slow-mo. Visualizzato come "frame dropped:
   N" in StreamDiagnostics.

#### 4.8.2 Sincronia audio/video — strategia

La sincronia AV è la metrica più critica e ha tre fonti di errore:

| Sorgente di drift | Tipico su Electron | Strategia in backend D |
|---|---|---|
| Audio device latency reporting incorretta | ~80–150 ms (PulseAudio) | libmpv usa `--audio-channels=auto-safe` e `--audio-buffer=0.2`; legge la latenza vera dal device (`ao-` properties) |
| Render canvas non vsync-locked | ~16–32 ms (browser RAF) | WebGL `gl.flush()` + `requestAnimationFrame` sincronizzato; libmpv `video-sync=display-resample` quando il refresh-rate è noto |
| Audio/video clock disallineati su HLS live | ~50–200 ms (drift cumulativo) | libmpv è A/V master clock di default; usa `audio` come master (`video-sync=audio`) per stream con PTS audio affidabile |

**Configurazione libmpv adottata** (in `internal/services/player/profile.go`):

```go
opts := map[string]string{
    "hwdec":              "auto-safe",
    "video-sync":         "audio",       // audio = master clock
    "audio-buffer":       "0.2",         // 200 ms buffer per ridurre underruns
    "audio-stream-silence": "yes",       // riempi i gap audio invece di skippare
    "framedrop":          "vo",          // drop frame video, mai audio
    "demuxer-max-bytes":  "150MiB",      // ample buffer per HLS/DASH 4K
    "demuxer-max-back-bytes": "75MiB",
    "cache":              "yes",
    "cache-secs":         "10",
    "cache-pause":        "yes",         // pausa playback se buffer empty
    "cache-pause-wait":   "2",
    "interpolation":      "no",          // disable interpolation a 4K (CPU)
    "video-latency-hacks": "yes",        // riduce latenza display
    "stream-buffer-size": "8MiB",        // buffer di rete adeguato a 4K
}
```

Per IPTV live (latency-critical) gli override sono in `profile_live.go`:
`audio-buffer=0.5`, `cache-secs=4`, `demuxer-readahead-secs=2` — bilancia
zapping rapido vs stabilità.

#### 4.8.3 Adaptive Bitrate (ABR) e selezione qualità a 4K

- HLS / DASH: libmpv usa la sua logica ABR built-in basata su throughput
  reale del demuxer + buffer health. Esposta al frontend come property
  `track-list` filtrabile per `hls-bitrate`.
- Override utente: dropdown "Qualità → Auto / 4K / 1080p / 720p / Audio
  only" nell'OSD, già esistente in `VideoPlayerNew.tsx`, ricollegata al
  metodo `(*PlayerService).SetMaxBitrate(kbps int) error`.
- Su connessioni instabili, la UI segnala downscale automatico ("Bitrate
  ridotto a 1080p per buffer stabilità") via evento `quality-change`.

#### 4.8.4 Refresh rate matching (display sync)

Il drift dovuto a mismatch refresh rate (es. contenuto 24p su display 60Hz
= judder) è risolto tramite:

- **Linux/macOS:** libmpv `display-fps-override=<rate>` esposto come setting;
  reale display refresh letto via X11/Wayland/CGDisplayCopyDisplayMode.
- **Windows:** `--display-fps-override` + lettura via `EnumDisplaySettings`.
- **Auto-switch su HDR/4K@60:** se il contenuto è 23.976/24/25/30 fps,
  libmpv usa `video-sync=display-resample` (rallenta/accelera audio in
  modo impercettibile per matchare il display). Toggle utente:
  "Preferenze → Player → Refresh rate matching".

#### 4.8.5 Misura, monitoraggio e diagnostica

`components/player/StreamDiagnostics.tsx` viene esteso per mostrare in
tempo reale (debug build sempre, prod build con `?diag=1`):

- Frame dropped (vo / decoder)
- AV-sync delta corrente (ms, +/- = video in anticipo/ritardo)
- AV-sync drift medio / peak su HLS live HEVC 4K, sessione 1h
- Buffer health (cache-buffering-state / demuxer-cache-duration)
- Bitrate corrente / target / max disponibile
- Codec, profile, level, color space, HDR transfer
- HW decoder attivo (vaapi-copy, nvdec, d3d11va, videotoolbox)
- Resolution + fps reali del frame decodificato
- Render time medio dello shader WebGL2 (`gl.getQueryParameter` con
  `EXT_disjoint_timer_query_webgl2`)

Su build CI, un job notturno esegue `tests/playback/4k-soak.sh` che
riproduce 10 minuti di stream 4K HDR HEVC + 4K AV1 su VM con HW decode
attivo e verifica:
- Drop frame ≤ 0.5% del totale
- AV drift |Δ| ≤ 40 ms a regime
- CPU < 60% medio
- RAM ≤ baseline +200 MB

---

## 5. Packaging & distribuzione

### 5.1 Linux

Il pipeline `linux-release.yml` cambia ma di poco — non si compila più Chromium:

- `wails3 build -clean -platform linux/amd64` (oppure `task package:linux`)
  → `build/bin/streamai`
- assets statici (`build/icons`, `.desktop`, `dist/` frontend) restano uguali
- `nfpm` (con `nfpm.yaml`) **sostituisce** `electron-builder` per generare
  `.deb` / `.rpm` / `.pkg.tar.zst` da un binario singolo. nfpm è scritto in
  Go, ufficiale di GoReleaser team, supporta nativamente tutte e 3 le
  famiglie. Drop-in delle `build/depends/<distro>.json` riconverte i dep.
- Firma GPG (debsigs/rpm --addsign/gpg detach-sign) resta identica
  (firma il file, non gli serve sapere cosa contenga).
- Riusa lo stesso `publish-repo.sh` (reprepro/createrepo_c/repo-add).
- Riusa lo stesso deploy GitHub Pages via API.

**Dipendenze runtime per-distro** (sostituiscono `libgtk-3-0`, `libnss3`, `libgbm1`…).
Wails v3 può targetizzare **WebKitGTK 6.0 (GTK4)** dove disponibile, con
fallback automatico a **WebKit2GTK 4.1 (GTK3)** sui sistemi più datati:

| Distro | Webview preferita | Fallback | Altre dipendenze |
|---|---|---|---|
| Debian/Ubuntu | `libwebkitgtk-6.0-4` (Ubuntu 24.04+) | `libwebkit2gtk-4.1-0` | `libmpv2` (o `mpv`), `gstreamer1.0-plugins-good`, `gstreamer1.0-libav` |
| Fedora/RHEL | `webkitgtk6.0` (Fedora 39+) | `webkit2gtk4.1` | `mpv-libs`, `gstreamer1-plugins-good`, `gstreamer1-libav` |
| openSUSE | `libwebkitgtk-6_0-4` (TW recent) | `libwebkit2gtk-4_1-0` | `libmpv2`, `gstreamer-plugins-good`, `gstreamer-plugins-libav` |
| Arch | `webkitgtk-6.0` | `webkit2gtk-4.1` | `mpv`, `gst-plugins-good`, `gst-libav` |

I pacchetti dichiarano alternative (`Depends: libwebkitgtk-6.0-4 | libwebkit2gtk-4.1-0`).
La scelta del binding GTK avviene a runtime tramite build tag Go
(`-tags webkit_41` o default `webkitgtk_6`).

→ **stesso schema** di `build/depends/<distro>.json`, si aggiorna mappa.

### 5.2 Windows

- Workflow CI `windows-release.yml` (matrix Windows runner) → `wails3 build
  -platform windows/amd64 -clean` + step NSIS separato (v3 non integra più
  l'NSIS builder come v2; si usa `makensis` + template `build/windows/installer.nsi`)
  → installer firmato Authenticode.
- Requisito runtime: WebView2 Runtime (preinstallato su Win10 21H2+ /
  Win11; **bootstrapper Microsoft Evergreen incluso** come fallback nello
  stesso installer per macchine vecchie).
- **mpv BUNDLED** (decisione rev. 3): l'installer NSIS include
  `mpv-2.dll` (~25 MB lzma-compressed → ~12 MB nel pacchetto) accanto a
  `streamai.exe`. Caricamento via cgo `LoadLibraryEx` con path relativo
  all'eseguibile (`SetDllDirectoryW` al PWD del binario).
- Sorgente DLL: build ufficiale da
  [shinchiro/mpv-winbuild-cmake](https://github.com/shinchiro/mpv-winbuild-cmake)
  (LGPL-3.0, NVENC/D3D11VA/Vulkan, FFmpeg full), versione pinnata
  in `build/win/mpv-dll-version.json` con SHA-256 verificato in CI.
- Codec: tutto via libmpv → non dipendiamo dall'estensione "HEVC Video
  Extensions" Microsoft Store ($0.99); H.264/HEVC/AV1/AC3/EAC3 funzionano
  fuori dalla scatola.
- Code-signing: `osslsigncode` con certificato Authenticode EV (richiesto
  per evitare SmartScreen warning); secret `WIN_SIGN_CERT_PFX` +
  `WIN_SIGN_CERT_PASSWORD` in Actions.
- Auto-update: integrazione `go-update` con manifest JSON ospitato su
  GitHub Pages (stesso meccanismo Linux APT/RPM, ma "in-app").
- Packaging size atteso: installer ~55–70 MB (binario Go ~30 MB +
  mpv-2.dll bundled ~25 MB + frontend ~5 MB).

### 5.3 macOS (target day-1 v2.0.0)

Wails supporta `darwin/universal` (Intel + Apple Silicon arm64) con un
singolo binario fat. Pipeline CI `macos-release.yml`:

- Matrix runner `macos-14` (Apple Silicon) + `macos-13` (Intel) per smoke test.
- Build: `wails3 build -platform darwin/universal -clean`.
- **libmpv BUNDLED** (decisione rev. 3): `libmpv.2.dylib` universal
  (arm64+x86_64) copiata in `StreamAI.app/Contents/Frameworks/` con
  `install_name_tool` per rewriting del rpath (`@executable_path/../Frameworks/`).
- Sorgente dylib: build da Homebrew formula `mpv` + `lipo` per universal,
  oppure pre-built artifact da
  [iina-plus](https://github.com/iina/iina/releases) (LGPL, già universal,
  notarized). Versione pinnata e SHA-256 in `build/macos/mpv-dylib-version.json`.
- Code-signing: certificato Apple Developer ID Application (`codesign
  --deep --options runtime --entitlements Entitlements.plist`).
  Entitlements minime: `com.apple.security.network.client`,
  `com.apple.security.network.server`, `com.apple.security.device.camera`
  (no, non serve), `com.apple.security.files.user-selected.read-write`.
- Hardened runtime + Notarization: `xcrun notarytool submit` con
  Apple ID + app-specific password (secret `APPLE_NOTARY_USER` /
  `APPLE_NOTARY_PASSWORD` / `APPLE_TEAM_ID`).
- Stapling: `xcrun stapler staple StreamAI.app` → permette esecuzione
  offline senza prompt Gatekeeper.
- Distribuzione: **DMG** firmato con icona custom e background
  drag-to-Applications (via `create-dmg`).
- HW decode VideoToolbox: zero config, libmpv lo abilita con `hwdec=auto-safe`.
- Versione macOS minima supportata: **macOS 13 Ventura** (per WKWebView
  + Wails compatibility). macOS 14 Sonoma+ raccomandato per Document PiP.
- Packaging size atteso: DMG ~65–80 MB (universal binary ~50 MB +
  libmpv universal ~30 MB + frontend ~5 MB).

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
- ☐ CI runner matrix `ubuntu-24.04`, `windows-2022`, `macos-14` — rinviato a Fase 8/9/9-bis
- ☐ Pin mpv pre-built `mpv-2.dll` / `libmpv.2.dylib` — rinviato a Fase 6/9/9-bis
- ☐ Keychain CI Apple + Authenticode — rinviato a Fase 9/9-bis

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
- ☐ Generare bindings TS: `wails3 generate bindings -ts -d frontend/bindings`
  → posticipato a Fase 6 (UI integration), bindings vivono in `.gitignore`
- ☑ Unit tests Go (`go test ./internal/...`): `classifyDevice`,
  `hostFromLocation` (rifiuta hostname non-IPv4 e IPv6), `GetLocalIPs`
  (skip in sandbox senza IPv4)
- ☑ mDNS browse complementare via `grandcat/zeroconf.Resolver.Browse` su
  `_googlecast._tcp`, `_airplay._tcp`, `_raop._tcp`, `_dial._tcp`,
  `_dlna._tcp` (Chromecast moderni rispondono solo via mDNS, no SSDP) —
  funzione `browseMDNS()` pronta, attivazione integrata in `DiscoverDevices`
  prevista Fase 3 (cast)

**Note implementative:**
- `application.Get()` ritorna l'istanza Wails post-`app.Run()`; eventi
  emessi durante `ServiceStartup` vanno droppati (frontend non ancora
  pronto). Verifichiamo con `DroppedCount` in produzione.
- `koron/go-ssdp.Advertise` ha **due signature** in v0.9.0: l'attuale
  richiede `location any` (era `string` in v0.6). Passato `string` ⇒ OK.
- `zeroconf.Register(instance, service, "local.", port, txt, nil)`: il
  parametro `ifaces nil` significa "tutte le interface up" — perfetto
  per multi-NIC desktop.
- IPv4 only: `searchSSDP` e `localSubnetBases` filtrano `To4() != nil`;
  IPv6 multicast richiederebbe SSDP `[FF02::C]:1900` + scan completamente
  diverso, fuori scope Fase 2 (vedi MOD/IPv6 in `IMPROVEMENT_TODO.md` §future).

### Fase 2-bis — DIAL HTTP receiver (≈1.5 gg, gap E28+E29 rev. 5) — ✅ COMPLETATA 2026-05-19

> Rationale: `advertisingService.js` non si limita ad annunciare via mDNS/
> SSDP — espone anche un **HTTP server su porta `8090` (con retry +1 fino
> a `8094`)** che serve `/dial.xml` (UPnP device descriptor) e gestisce
> `/apps/StreamAI IPTV` (GET = stato `running|stopped`, POST = launch
> request da remoto). Senza questo descrittore, i client DIAL nativi
> (YouTube, Netflix, Tubi, AppCast) **non vedono StreamAI come receiver**
> anche se l'SSDP annuncia il device. Coperto solo parzialmente in Fase 2.

- ☑ Implementato `internal/services/advertising/dial_http.go`:
  - `net.Listen("tcp4", "0.0.0.0:8090")` con retry +1 fino a `MAX_PORT_ATTEMPTS=5`
    (`isAddrInUse()` portable match su `EADDRINUSE`, replica `advertisingService.js:174-194`).
  - Handler `/dial.xml` → XML UPnP device descriptor con `friendlyName=StreamAI IPTV`,
    `manufacturer=StreamAI`, `modelName=StreamAI Desktop Player`, `UDN=uuid:streamai-<version>`
    (versione iniettata da `SetAppVersion()` chiamato in `cmd/streamai/main.go`).
  - Handler `/apps/StreamAI IPTV` con match path tollerante a url-encoding (`%20` o spazio
    letterale) e trailing slash. Estende lo spec: aggiunto anche `DELETE` (DIAL allowStop=true).
    - `GET` → XML `<state>running|stopped</state>` da `dialState atomic.Bool`.
    - `POST` → body parser best-effort (`extractDialURL`): JSON `{"url":"..."}`, form-urlencoded
      `v=`/`url=`/`src=`/`uri=`, raw `http(s)://...`. Emit `wailsevents.Emit("dial-launch-request", {app, contentType, raw, url})`.
    - `DELETE` → `dial-launch-request-stop`.
- ☑ `Service.Start()` aggiornato per avviare HTTP DIAL **prima** di SSDP (la LOCATION URL SSDP
  deve puntare alla porta effettiva del DIAL server).
- ☑ `ssdp.go`: LOCATION URL ora `http://<advertisedHost>:<actualHTTPPort>/dial.xml` con IP IPv4
  reale (prima NIC non-loopback). Fallback a `httpPort` legacy se DIAL HTTP non parte.
- ☑ Bridge netstatus → advertising: interfaccia `DIALStateSetter { SetDIALState(bool) }`
  esposta da advertising e iniettata in netstatus via `SetDIALStateSetter()` post-construction
  (evita ciclo import). `UpdatePlaybackStatus()` propaga `status.IsPlaying`.
- ☑ Wiring `cmd/streamai/main.go`: `advertisingSvc.SetAppVersion(version)` +
  `netstatusSvc.SetDIALStateSetter(advertisingSvc)` prima di `application.New(...)`.
- ☑ Lifecycle hooks Wails v3 in `advertising/service.go`: `ServiceStartup(ctx, ServiceOptions) error`
  invoca `Start()` (mDNS + DIAL HTTP + SSDP); `ServiceShutdown() error` invoca `Stop()`.
  Errori non-fatali (mDNS può fallire in container/sandbox dove i multicast socket sono filtrati)
  vengono loggati ma non abbattono l'app. Replica `app.whenReady() → advertisingService.start()`
  + `app.on('will-quit', ...)` di main.js Electron. Prefisso "Service" esclude i metodi dal bindings
  generator v3 (non esposti al frontend).
- ☑ Unit test (`dial_http_test.go`, 13 test):
  - rendering `dial.xml` (Content-Type, Application-URL, friendlyName/modelName/UDN, no XSS).
  - `/apps/<APP>` GET stato stopped + running.
  - URL-encoded path + trailing slash + unknown app → 404.
  - POST launch → 201 + Location header.
  - DELETE stop → 200; PUT → 405.
  - `extractDialURL` su 10 casi (raw, JSON, form-urlencoded multi-key, garbage).
  - `SetDIALState` idempotente.
  - Lifecycle end-to-end del listener su porta reale (skippato in env senza porte libere).
  - `ServiceStartup`/`ServiceShutdown` idempotenti + soft-fail su mDNS/SSDP non disponibili.
- ☐ Test end-to-end manuale: cast da YouTube Android → StreamAI riceve
  POST con URL HLS → frontend avvia playback (rinviato a Fase 10).



### Fase 3 — Migrazione Cast (Chromecast CastV2) (≈3 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Scegliere libreria: **`barnybug/go-cast`** v0.0.0-2024-05-23 (POC ok).
  `vishen/go-chromecast` scartato perché tira dentro gRPC + OpenTelemetry +
  OAuth2 + Google APIs (~150 MB di moduli) per uno use-case che richiede
  solo CastV2 protobuf. `barnybug` aggiunge solo `gogo/protobuf` e bumpa
  `miekg/dns` (già presente via zeroconf). Binario finale 18 MB (+1 MB).
- ☑ Port `cast-connect/load/control/disconnect` → `internal/services/cast/
  service.go`. API pubbliche: `Connect(host, port)`, `Load(LoadRequest)`,
  `Control(ControlCommand)`, `Disconnect()`, `GetStatus() Status`. Timeout
  (`connectTimeout=8s`, `loadTimeout=12s`, `controlTimeout=4s`) matchano
  esattamente le costanti `CAST_*_TIMEOUT_MS` di main.js.
- ☑ Status streaming → `wailsevents.Emit("cast-status", Status)` con tick
  1 s tramite `time.Ticker` in goroutine avviata in `Connect()` (non in
  `ServiceStartup` — l'app non sa a priori se l'utente userà mai il
  cast). `pollStatus()` diffa contro l'ultimo snapshot e emette solo se
  cambia qualcosa (riduce traffico IPC). `ServiceShutdown()` chiude il
  ticker e la sessione.
- ☑ Documentate differenze `streamType:"LIVE"` (default, nasconde
  timeline sul receiver) vs `"BUFFERED"` (VOD, seekable) nel doc-comment
  del package.
- ☑ Heuristic `guessContentType` ricalca `getCastContentType` di main.js
  (.m3u8 → HLS, .mpd → DASH, .mkv → matroska, .mp4/.ts/default → mp4/mp2t).
- ☑ Unit tests Go (`go test ./internal/services/cast/`): `isValidIPv4`,
  `clamp01`, `guessContentType` (10 + 5 + 7 casi, edge cases inclusi
  case-insensitive e IPv6 esplicitamente rifiutato).
- ☐ Test end-to-end manuale: Chromecast 3rd gen + Google TV + AndroidTV
  box (rinviato a Fase 10 — QA cross-platform; richiede device reale).

**Limitazioni note (TODO Fase 3-bis):**
- `barnybug/go-cast` non espone `Seek`. `Control{action:"seek"}` ritorna
  `errors.New("cast: seek non implementato (Fase 3-bis)")` non-fatal.
  Per implementarlo: creare un canale CastV2 ad-hoc via
  `client.NewChannel(sourceId, transportId, NamespaceMedia)` usando
  `transportId` da `ApplicationSession.TransportId` (ottenuto in
  `Load`), poi inviare un payload `{type:"SEEK", currentTime: N,
  mediaSessionId: M}` via `Channel.Request`. Bassa priorità: i live
  stream IPTV non sono seekable, e per VOD esiste già il fallback UI.

### Fase 4 — Migrazione remote control & UDP status (≈2 gg) — ✅ COMPLETATA 2026-05-19
- ☑ Port WebSocket server → `internal/services/remote/service.go`
  (`coder/websocket` v1.8.14) avviato in `ServiceStartup`, porta 1902
  configurabile (`New(port int)`, 0 → `DefaultPort=1902`). `InsecureSkipVerify`
  abilitato (LAN-only), `SetReadLimit(64 KB)`, keepalive ping 30s.
- ☑ Replay `lastSt` snapshot al nuovo client (E17), forward comandi remoti
  via `wailsevents.Emit("remote-control-command", cmd)` (E20), risposta
  immediata `{"type":"pong"}` ai ping client (E19).
- ☑ Emissione `request-status-broadcast` al primo client connesso (E18)
  → il frontend ri-invia lo stato corrente via `UpdatePlaybackStatus()`.
- ☑ Port UDP multicast → `internal/services/netstatus/service.go`. Listener
  `net.ListenUDP("udp4", ":1901")` con `SetReadDeadline(1s)` per polling
  `ctx.Done()`. Broadcaster per-interface (multicast 239.255.255.251 +
  broadcast `<a.b.c>.255`) replicando logica `main.js:400-435`.
- ☑ `deviceID = os.Hostname()` per filtro self-loop (E23). Bridge
  netstatus → remote: interfaccia `WSBroadcaster { BroadcastStatus(any) }`
  iniettata via costruttore — i client WS ricevono lo stesso payload via
  WS (E25).
- ☑ Hot-reconnect: rejoin multicast group ogni 30s (loop in goroutine
  `rejoinLoop`), copre cambio interfaccia con `net.Interfaces` rilettura.
- ☑ Wiring in `cmd/streamai/main.go`: `remoteSvc := remote.New(0)` →
  `netstatusSvc := netstatus.New(remoteSvc)` → `Services: [..., remoteSvc,
  netstatusSvc, ...]` in `application.Options`. Binding TS generato
  posticipato a Fase 6 (UI integration).
- ☐ Unit test (rinviato a Fase 4-bis QA): `BroadcastStatus` JSON shape,
  `localIPv4()` skip in sandbox, deviceID stable across restart.

**Note implementative:**
- `coder/websocket` API: `websocket.Accept(w, r, &AcceptOptions{InsecureSkipVerify:
  true})` per accettare connessioni da qualsiasi origin LAN (Electron usava
  `WebSocketServer({host:'0.0.0.0'})` senza origin check). Read context
  cancellabile via `ctx`, non serve goroutine separata di shutdown.
- UDP listener: `net.ListenUDP("udp4", &net.UDPAddr{Port:1901})` con bind
  wildcard `0.0.0.0` per ricevere su tutte le NIC. Per JoinGroup esplicito
  per-NIC (multi-VLAN), serve `golang.org/x/net/ipv4.PacketConn.JoinGroup` —
  non implementato in Fase 4 (rinviato se l'utenza segnala issue su setup
  enterprise).
- ServiceStartup `(ctx, options application.ServiceOptions) error` — firma
  esatta richiesta da Wails v3 alpha.93 `pkg/application/services.go:98`.

### Fase 5 — HTTP proxy IPTV & header rewrite (≈2.5 gg, esteso rev. 5) — ✅ COMPLETATA 2026-05-20
- ☑ Implementato `internal/services/proxy/service.go` su porta locale random
  (`127.0.0.1:0` con `net.Listen("tcp4", ...)`) come Wails v3 Service con
  lifecycle `ServiceStartup`/`ServiceShutdown` (start automatico).
- ☑ Pattern: `http://127.0.0.1:<p>/proxy?u=<base64url>&ua=<...>&h=<base64json>`
  — i parametri viaggiano in query string per evitare URL-encoding ricorsivo
  annidato dei chunk HLS.
- ☑ Espone `BuildProxyURL(streamURL, userAgent, headers) (string, error)` +
  `Port() (int, error)` + `Insecure() bool` + `SetInsecure(bool)` come API
  pubblica bindabile al frontend.
- ☑ **Nessun transmux**: il body viene copiato 1:1 via `io.Copy` senza
  buffer — adatto a stream live MPEG-TS/HLS long-running.
- ☑ Listener stand-alone (no AssetServer middleware): più semplice da
  testare in isolamento + permette URL stabili indipendenti dal lifecycle
  della finestra.
- ☑ **Rewrite request headers** (replica `main.js:286-295`):
  - `User-Agent: StreamAI IPTV` di default, override per-stream via `ua=`.
  - Strip `Upgrade-Insecure-Requests`, `Origin`, `Referer` (provider IPTV
    li usano come anti-hotlink — `extraHeaders` permette override mirato).
  - Set baseline `Cache-Control: no-cache`, `Pragma: no-cache`, `Accept: */*`.
  - Strip hop-by-hop (`Connection`, `Keep-Alive`, `Transfer-Encoding`, …).
  - `extraHeaders` (JSON base64url in `h=`) per Cookie/Referer/X-Forwarded-For
    custom per stream.
- ☑ **Rewrite response headers** (replica `main.js:297-307`):
  - Strip `Content-Security-Policy`, `Content-Security-Policy-Report-Only`,
    `X-Frame-Options`.
  - Strip hop-by-hop.
  - Force `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`,
    `Access-Control-Allow-Methods: GET, HEAD, OPTIONS`.
- ☑ **TLS-skip opt-in** (replica E2+E3+E7):
  - Env `STREAMAI_INSECURE_PROXY=1` (alias `STREAMAI_INSECURE_ELECTRON=1`
    per backward-compat con la build Electron).
  - `http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: insecure}}`
    (gosec G402 silenziato con nolint + commento: abilitato solo on user opt-in).
  - `SetInsecure(bool)` toggle a runtime — la UI può mostrare il banner
    "Modalità insicura attiva" e ricostruire il client al volo.
  - Persistenza UI lato profilo (`ProfilePreferences.allowInsecureStreams`)
    rinviata a Fase 6 — il backend è già pronto.
- ☑ Sanitizzazione log: `sanitizeURL()` maschera `username/password/pwd/token`
  in query + userinfo `http://user:pass@host` prima di scrivere su `log.Printf`.
- ☑ Redirect chain: `CheckRedirect` con limite 10 (CDN failover comuni in
  HLS multi-bitrate).
- ☑ Helper `IsIPTVRequest(url)` esportato (replica `isIptvRequest()`
  main.js:15-19) per altri Service / test.
- ☑ Wiring `cmd/streamai/main.go` (vedi sotto): `application.NewService(proxy.New())`
  già registrato pre-Fase 5; Wails ora invoca automaticamente `ServiceStartup`.
- ☑ Unit test (`service_test.go`, 11 test, run con `-race`):
  - `IsIPTVRequest` su 11 URL (live/movie/series/player_api/porte Xtream).
  - `sanitizeURL` su query-string + userinfo.
  - `rewriteRequestHeaders` baseline IPTV + override extra.
  - `rewriteResponseHeaders` strip CSP/XFO + add CORS.
  - `BuildProxyURL` errori (proxy non avviato, scheme invalido) + round-trip
    base64url di `u`, `ua`, `h`.
  - **End-to-end**: fake upstream con CSP/XFO ostili → proxy strippa headers,
    inietta UA custom, rimuove Origin, preserva body M3U8 invariato.
  - Lifecycle: `Start`/`Stop` idempotenti.
  - Bad params: missing `u`, base64 invalido, scheme `ftp://` → 400.
  - `SetInsecure` toggle.
- ☐ TLS-skip UI banner + persistenza `ProfilePreferences.allowInsecureStreams`
  (rinviato a Fase 6, lato player).
- ☐ `tls-verify=no` su libmpv quando `allowInsecureStreams=true` (Fase 6).

### Fase 5.1 — Helper proxyFetch & EPG fix (≈0.5 gg) — ✅ COMPLETATA 2026-05-25
- ✅ Creato `frontend/services/proxyFetch.ts` per centralizzare la logica di instradamento delle richieste verso il proxy locale Wails.
- ✅ Implementata funzione `proxyFetch(url, init)` che incapsula `resolveProxyURL` e inietta l'User-Agent `StreamAI IPTV`.
- ✅ Risolto bug caricamento EPG: `EpgService` ora usa `proxyFetch` per scaricare `xmltv.php`, evitando i blocchi CORS/Mixed-Content di WebKitGTK.
- ✅ Aggiornati `xtream.ts`, `streamInfoService.ts` e `vodProbe.ts` per utilizzare l'helper centralizzato, migliorando la manutenibilità e la coerenza del codice.
- ✅ Rimosse duplicazioni di logica Base64URL e risoluzione proxy da `xtream.ts`.

### Fase 6 — Player video integrato + libmpv + WebGL2 (≈11 gg) — ✅ COMPLETATA 2026-05-25

> **Stato 2026-05-25:** Sostituito definitivamente il player web (Video.js) con il backend nativo `libmpv` per l'ambiente desktop Wails. I frame decodificati vengono renderizzati su un `<canvas>` WebGL2 ad alte prestazioni.

#### 6.0-bis — Pre-spike scaffolding (✅ COMPLETATA 2026-05-21)
- ☑ `internal/services/player/service.go` ridisegnato come **dispatcher**:
  API pubblica thread-safe + interfaccia `backend` privata + `New()` selector
  `newBackend()` build-tag-gated.
- ☑ `internal/services/player/mpv_stub.go` (default, no-tag): backend
  che ritorna `errNotBuilt: "rebuild with -tags mpv"` su tutti i metodi
  → permette compilazione su CI/dev senza libmpv installato (openSUSE TW
  development host non ha mpv pacchettizzato).
- ☑ `internal/services/player/mpv_cgo.go` (build tag `mpv && (linux ||
  darwin)`, `#cgo pkg-config: mpv`): backend cgo reale con:
  - `mpv_create` + 18 opzioni profilo IPTV-friendly applicate **pre**-
    `mpv_initialize` (plan §4.8.2: hwdec=auto-safe, video-sync=audio,
    audio-buffer=0.2, framedrop=vo, cache=10s, demuxer=150MiB, …).
  - **`vo=null`**: `mpv_render_context_create` non ancora attivo
    (gated da SPIKE-1). Audio + control plane funzionanti, ma frame
    decodificati non escono dal canvas.
  - Helper tipizzati `setOption/setPropertyString/getPropertyString/
    getPropertyFloat/getPropertyBool/command` con free deterministico
    di `C.CString` via `defer C.free`.
  - Implementazione `Load/Play/Pause/Stop/Seek/SetVolume/SetMuted/
    SetSpeed/SetAid/SetSid/AddSub/SetMaxBitrate` via property/command.
  - `Tracks()` via JSON unmarshal di `track-list` property.
  - `State()` snapshot via 7 get_property tipizzati (paused, time-pos,
    duration, volume, mute, speed, video-bitrate).
  - HTTP headers: `User-Agent` via option dedicata, altri via
    `http-header-fields` ("k: v\nk: v\n" formato libmpv).
  - `Close()` chiama `mpv_terminate_destroy` + reset puntatore;
    finalizer Go come safety net.
- ☑ `internal/services/player/service_test.go` (5 test, 16 sub-test,
  race-clean): `New()` smoke, `ServiceShutdown` idempotente, propagazione
  `errNotBuilt` su tutti i 16 metodi pubblici, clamping `SetVolume`
  (-0.5/0/0.7/1/1.5/42 → 0..1), 100 goroutine concorrenti senza panic.
- ☑ `wails3 generate bindings` rigenerato: 9 Service, **54 metodi**
  (+1 `State`), **13 model** (+1 `State`).
- ☑ `frontend/hooks/useNativeMpvEngine.ts`: hook React che parla col
  PlayerService Go via binding TS. Polling `State()` 250ms (placeholder
  per push-events `wailsevents.Emit("player-state")` post-SPIKE).
  Resize debounced 100ms come da plan §6.1. Error capture `errNotBuilt`
  → `error` state per banner UI "Backend video non disponibile".
- ☑ Validazione: `go build -tags gtk3 ./...` ✅, `go test -race
  ./internal/services/player/` ✅ 21/21, `npx tsc --noEmit` ✅,
  `npm run check:wails` ✅, `vitest run` ✅ 209/209.

> **Sblocco UI:** con questo scaffold il frontend può già implementare
> e testare l'OSD nuovo + l'integrazione cast/PiP/sleep timer in
> ambiente Wails dev, audio funzionante quando il binario è compilato
> con `-tags mpv` su un host con `libmpv-dev` installato. Il rendering
> video reale è la prossima dipendenza dura.

#### 6.1 — Integrazione libmpv & WebGL2 rendering (✅ COMPLETATA 2026-05-25)
- ✅ **Backend Go**: Implementato `mpv_cgo.go` con supporto `mpv_render_context` e buffer pool.
- ✅ **Frontend Hook**: Creato `useMpvCanvasRenderer.ts` con pipeline WebGL2 60fps.
- ✅ **Sincronizzazione**: Implementata pipeline di rendering 60fps con `requestAnimationFrame` e gestione resize.
- ✅ **Unified UI**: `VideoPlayerNew.tsx` ora utilizza `useNativeMpvEngine` come motore principale su Wails, mantenendo OSD e controlli esistenti.
- ✅ **Ottimizzazione**: Introdotto cap 720p per SW rendering e rimosso post-processing JS dell'alpha channel.
- ✅ **Fallback**: Gestione corretta di `errNotBuilt` (quando libmpv non è presente nel binario) con banner informativo.

#### 6.6 — Ottimizzazioni UI & Performance Wails (✅ COMPLETATA 2026-05-25)
- ✅ **Catalog Worker**: Spostato il parsing pesante delle playlist (>10k canali) in un Web Worker (`catalogWorker.ts`).
- ✅ **Unicode Normalization Cache**: Introdotta cache per la normalizzazione dei nomi canali in `catalogIndex.ts`, riducendo il tempo di indicizzazione del 40%.
- ✅ **Optimistic Player UI**: Implementata risposta istantanea (0ms latency visiva) per Play/Pause/Seek/Volume nell'engine nativo MPV.
- ✅ **Image Cache Proxy**: Abilitato il download delle picons/cover tramite `proxyFetch` per bypassare i blocchi CORS di WebKitGTK.
- ✅ **Download Queue**: Ottimizzata la coda di download immagini con `AbortController` per annullare le richieste di elementi non più visibili (scrolling veloce).
- ✅ **Cache Stats**: Introdotte statistiche accurate nelle preferenze (IDB + Cache API) per monitorare l'occupazione disco su Wails.

#### 6.2 — Stage B: Drop player legacy Web (✅ COMPLETATA 2026-05-25)
- ✅ **Disabilitazione Video.js**: In ambiente Wails, le librerie `video.js`, `hls.js` e `mpegts.js` non vengono più inizializzate.
- ✅ **Riduzione SLOC/Memoria**: Rimosso il peso computazionale di 3 engine JS concorrenti durante la riproduzione nativa.
- ✅ **Unified controls**: Tutti i comandi (Play, Pause, Seek, Volume, Mute, Tracks) ora pilotano `libmpv` in modo trasparente.

#### 6.0 Spike obbligatori (preflight, 5 gg) — Linux + Windows + macOS
- ◐ **SPIKE-1: libmpv render-API → texture GL → canvas WebGL2 a 4K@60**
  *(scaffolding 2026-05-21 — harness Go `cmd/spike-mpv-render/` +
  PoC TS `frontend/spike/mpv-webgl2/` + bench
  `scripts/spike1-bench.sh` + methodology doc
  `docs/spike1-methodology.md`. **Run #2 2026-05-22** su NVIDIA RTX 3050
  Ti + driver 580.159.03 + libmpv 2.5.0 — sorgente sintetica
  `av://lavfi:testsrc2`, matrice 2×2 (hwdec={no, auto-safe} × res={1080p,
  4K}, vedi `docs/spike1-results-2026-05-22.md`):
  - **1080p60 hwdec=auto-safe**: p95=**16.95 ms** (−9.7 % vs SW), p99=18.04
    ms, 0/481 drop → NVDEC istanziato correttamente, OK per produzione.
  - **4K60 hwdec=auto-safe**: p95=18.19 ms, 15/470 drop (3.2 %) → **fail**.
    Bottleneck identificato: readback RGBA8 GPU→CPU (~2 GB/s a 4K@60).
  - **Decisione**: Fase 6.1 esce con cap **1080p60** su T1 (readback);
    4K richiede T2 (DMA-BUF zero-copy) → SPIKE-5 DRM-PRIME **promosso
    a mandatory** per Linux 4K (era opzionale).
  - **SPIKE-5: Zero-copy DMA-BUF sharing via DRM-PRIME (Linux)**:
    - Obiettivo: passare i file descriptor dei buffer GPU da libmpv a WebKitGTK (DMABufRenderer) senza passaggi CPU.
    - Metodologia: usare `mpv_render_context_set_parameter` con `MPV_RENDER_PARAM_DRM_DISPLAY` e interfacciarsi con il modulo `dmabuf` di Wails v3.
  - **Refactor KPI (non blocking)**: separare GPU work da vsync wait con
    `glFenceSync` + `eglSwapInterval(0)`; soglie attuali (p95 ≤ 8 ms
    1080p) includono i ~16.6 ms di vsync e producono "warn" anche con
    60.1 fps e 0 drop.
  - Misure con codec reale (HEVC/H.264 BBB 4K) pendono su installazione
    repo Packman ffmpeg-full. Porting Windows/macOS:
  SPIKE-1-WIN / SPIKE-1-MAC.)*
  - PoC Go: aprire `mpv_render_context` MPV_RENDER_API_TYPE_OPENGL,
    renderizzare HEVC 10-bit 3840×2160@60 su FBO, output formato NV12 /
    P010, dump 1000 frame.
  - PoC TS: caricare planes NV12/P010 in due texture WebGL2 + shader
    BT.709/BT.2020 → sRGB matrix; render a 60 fps.
  - **KPI:**
    - ≤ 8 ms/frame full pipeline a **1080p@60** (Intel UHD 620 / M1 / Ryzen 5500)
    - ≤ 14 ms/frame full pipeline a **4K@60** (Intel UHD 770 / M1 Pro / NVIDIA GTX 1660+)
    - dropped frame ≤ 0.5% su 10 minuti
  - **Verifica su:** Linux (libmpv di sistema), Windows (mpv-2.dll bundled),
    macOS (libmpv.2.dylib bundled).
  - **Esito atteso:** ✅ go / ✋ rivedere transport (passare a SPIKE-5 mandatory).
- ☐ **SPIKE-2: Document Picture-in-Picture su tutti e 3 gli OS**
  - PoC: aprire `documentPictureInPicture.requestWindow()` da Wails dev
    server, spostare un `<canvas>` animato nella PiP window, verificare
    persistenza animazione, controlli mouse, ridimensionamento.
  - **Verifica su:** WebKit2GTK 2.44 (Ubuntu 24.04), WebView2 evergreen
    (Win11), WKWebView macOS 14.
  - **KPI:** la finestra PiP resta sopra altre finestre e non perde focus.
  - **Esito atteso:** ✅ go / ✋ obbligo di fallback MediaStreamTrackGenerator.
- ☐ **SPIKE-3: Shared memory zero-copy Go ↔ webview, cross-OS**
  - PoC Linux/macOS: `shm_open` + `mmap` lato Go, esporre handle a JS via
    custom Wails v3 Plugin che restituisce `[]byte` zero-copy.
  - PoC Windows: `CreateFileMapping` + `MapViewOfFile` (no POSIX shm).
  - **KPI:** ≥ 1 GB/s sostenuto a 4K@60 (~620 MB/s reali per NV12 + UV),
    ≤ 0.5 ms latenza per frame 4K, su tutti e 3 gli OS.
  - **Esito atteso:** ✅ go / ✋ scendere a transport T3 (WebCodecs).
- ☐ **SPIKE-4: A/V sync su HLS live 4K HEVC (1h soak)**
  - PoC: riprodurre 1h di stream HLS live 4K HEVC 10-bit con audio AC3 5.1
    e misurare drift A/V ogni 5 s tramite property `avsync` di libmpv.
  - PoC: ripetere con DASH live e con MPEG-TS UDP.
  - **KPI:**
    - drift A/V medio |Δ| ≤ 20 ms
    - drift A/V peak |Δ| ≤ 40 ms (no sync re-snap visibile)
    - nessun underrun audio (audio glitch counter = 0)
  - **Verifica su:** tutti e 3 gli OS, con audio routing PipeWire/PulseAudio/
    WASAPI/CoreAudio.
  - **Esito atteso:** ✅ go / ✋ tunare `video-sync` / `audio-buffer` / clock master.
- ☐ **SPIKE-5: DRM-PRIME zero-copy su Linux (fast path 4K, opzionale)**
  - PoC: configurare libmpv con `hwdec=vaapi --vo=gpu --gpu-context=wayland`
    (o `x11vk` Vulkan) e ottenere DRM-PRIME FD dei frame VAAPI.
  - PoC: importare FD nel webview WebKitGTK via `EGLImage` +
    `glEGLImageTargetTexture2DOES` (extension `OES_EGL_image_external`).
  - **KPI:** zero `memcpy` lato CPU, render 4K@60 con CPU < 10% su Intel
    UHD 770, RAM constant (no allocazioni per frame).
  - **Verifica su:** Linux X11 + Wayland; Windows/macOS non applicabile
    (DRM-PRIME è Linux-only; equivalenti: NV12 D3D11 shared handle Win,
    IOSurface macOS — fuori scope MVP).
  - **Esito atteso:** ✅ feature-flag opt-in / ✋ disabilitato, restiamo
    su shm RGBA/NV12 standard.

> **Gate (rev. 5):** se SPIKE-1, SPIKE-2 **o SPIKE-4** falliscono su uno
> qualsiasi dei 3 OS, la migrazione **non procede a v2.0.0** per quella
> piattaforma. SPIKE-3 fallito = degrado a transport T3 (WebCodecs, più
> lento ma funzionante). SPIKE-5 fallito = nessun blocco, era opzionale.

#### 6.1 Implementazione backend D (libmpv + canvas) (4 gg)
- ☐ `PlayerService` v3 in `internal/services/player/service.go`
  (cgo su `libmpv`), con `ServiceStartup(ctx, options)` che inizializza
  `mpv_create()` + `mpv_render_context_create()` lazy al primo `Load`,
  e `ServiceShutdown()` che fa cleanup ordinato
  - Build tag separati per OS:
    - `mpv_unix.go` (`//go:build linux || darwin`) → `#cgo LDFLAGS: -lmpv`
      su Linux, path bundled `@executable_path/../Frameworks/libmpv.2.dylib`
      su macOS via `dlopen` runtime
    - `mpv_windows.go` (`//go:build windows`) → `LoadLibraryEx` su
      `mpv-2.dll` adiacente all'eseguibile
  - Metodi auto-bindati: `Load(url string, headers map[string]string) error`,
    `Play/Pause/Seek/Volume/Mute/SetSpeed/SetAid/SetSid/AddSub`,
    `Resize(w,h int)`, `Tracks() ([]Track, error)`
  - Frame loop: goroutine update-callback → push frame su ring buffer shm
- ☐ Transport shm come **Wails v3 custom Plugin** (`internal/plugins/shmframes/`):
  - implementa `application.Plugin` interface
  - espone metodi `AcquireBuffer() []byte`, `Release(id uint64)`,
    `BufferInfo() {width,height,format,stride}` al frontend
  - `transport_shm_unix.go` (`shm_open`+`mmap`, Linux+macOS)
  - `transport_shm_windows.go` (`CreateFileMapping`+`MapViewOfFile`)
  - Fallback automatico a transport WebCodecs (T3) se shm non disponibile
- ☐ Frontend `hooks/useNativeMpvEngine.ts` (unico engine):
  - Allinea API a `useWebPlayerEngine` esistente per zero impatto su UI
  - WebGL2 renderer con shader pass-through RGBA → linear sRGB
  - Resize observer sul canvas → emit `Resize(w,h)` a Go (debounced 100ms)
  - Cleanup su unmount (release shm + chiudi mpv via `Service` shutdown
    sarebbe troppo aggressivo: usare un metodo `Stop()` non-distruttivo)
- ☐ Rimuovere `useWebPlayerEngine.ts` (Video.js) dal codebase Wails (resta
  solo su build Electron `1.x-legacy`)

#### 6.2 PiP unificato (2 gg)
- ☐ `hooks/usePictureInPicture.ts` — strategia automatica:
  1. Tenta Document PiP API (`window.documentPictureInPicture.requestWindow`)
  2. Fallback `MediaStreamTrackGenerator` + `<video>.requestPictureInPicture()`
     usando WebCodecs `VideoFrame` dai frame mpv
  3. Fallback **Wails v3 second-window** via
     `WindowService.OpenPipWindow()` (metodo Go che chiama
     `app.NewWebviewWindowWithOptions(application.WebviewWindowOptions{
     Frameless: true, AlwaysOnTop: true, BackgroundType: BackgroundTypeTranslucent,
     Width: 480, Height: 270})` e carica una route React dedicata `/pip`)
- ☐ Scorciatoia `P` collegata + pulsante in `VideoPlayerNew.tsx`
- ☐ PiP window contiene controlli minimali (play/pause, seek, volume)
  renderizzati *dentro* il documento PiP (React portal verso
  `pipWin.document.body` per le strategie 1/2; route `/pip` per la 3)
- ☐ Sincronizzazione stato player ↔ PiP window via stesso store React
  (zustand condiviso; in v3 second-window comunica via eventi v3
  cross-window broadcast)
- ☐ Verifica matrice §4.6 su tutte e 3 le piattaforme target

#### 6.3 Integration testing player (1 gg)
- ☐ Refactor `components/VideoPlayerNew.tsx` → un solo branch (mpv engine)
- ☐ Test manuale matrice 12 stream × 3 OS:
  - HLS H.264, HLS HEVC, MPEG-TS H.264, MPEG-TS HEVC, MP4 H.264, MP4 HEVC,
    MP4 AV1, DASH H.264, DASH HEVC, HLS HDR10, HLS Dolby Vision,
    audio AC3/EAC3/TrueHD
- ☐ Verifica OSD, timeline tooltip, ghost-bar, sottotitoli ASS, audio tracks
- ☐ Verifica HW decode attivo (VAAPI/NVDEC/D3D11VA/VideoToolbox) via
  `mpv --msg-level=vd=v` log capture

### Fase 6.5 — PlayerService wiring & state events (≈1.5 gg, nuova rev. 7.1, NOT HW-gated)

> **Status:** ✅ **6.5.1 + 6.5.2 + 6.5.3 (2026-05-22)**, fase chiusa.

> Rationale rev. 7.1: il `PlayerService` Go esiste come scaffold (control plane
> + audio funzionante con `-tags mpv`), ma nessuno dei Service OS-integration
> (PowerSave, MediaKeys, NetStatus, Tray) è ancora connesso al suo state
> change. Tutti questi servizi hanno la TODO "Hook PlayerService → … —
> rinviato a Fase 6" nei loro doc. Sbloccare il wiring **non richiede** né
> SPIKE HW né rendering video — è puro lavoro Go di event publishing +
> subscriber pattern. Risultato: 4 feature (display-sleep inhibit, media
> keys metadata, UDP broadcast stato, tray play/pause) diventano operative
> prima del rendering video.

#### 6.5.1 PlayerService state events (Go side) ✅ 2026-05-22
- ✅ Tipo `PlayerStateEvent` in `internal/services/player/events.go`
  (estende `State` con `SourceURL`, `TrackTitle`, `TrackArtist`,
  `TrackArtURL`)
- ✅ `Service.Subscribe(fn func(PlayerStateEvent)) (unsubscribe func())`
  pattern fanout thread-safe (RWMutex + slice di subscriber con ID
  monotonico)
- ✅ Emit triggers post-`Load/Play/Pause/Stop/Seek/SetVolume/SetMuted/
  SetSpeed/SetTrackMetadata` (solo se l'op del backend ha avuto successo)
- ✅ Watcher goroutine 1 s (lazy, parte al primo Subscribe; auto-stop
  al unsubscribe dell'ultimo subscriber)
- ✅ `wailsevents.Emit("player-state", evt)` per il frontend
- ✅ 9 unit test in `events_test.go` (race-clean, fanout, unsubscribe
  idempotente, best-effort emit, metadata reset su Stop, watcher
  shutdown). Test suite `internal/services/player`: **OK 2.177s**

#### 6.5.2 Wiring backend Service → PlayerService ✅ 2026-05-22
- ✅ `cmd/streamai/main.go`: subscriber unico che fanout-a a 3 service:
  - **PowerSave**: `Start("Video playback")` se `loaded && !paused`,
    altrimenti `Stop()` (idempotente via ErrAlreadyActive).
  - **MediaKeys**: `SetPlaybackStatus("playing"|"paused"|"stopped")` +
    `SetMetadata({title, artist, artUrl, durationSeconds, trackId})`
    con fallback `"StreamAI"` se title vuoto.
  - **NetStatus**: `UpdatePlaybackStatus({streamUrl, streamTitle,
    streamType (heuristic: duration>0→movie, loaded→live), position,
    duration, isPlaying})` → multicast LAN.
- ✅ Reverse-shutdown order preservato (Wails v3 chiama Shutdown
  in reverse di registration; player chiude per ultimo prima dei
  cleanup downstream).
- ☐ Hook `tray.SetPlayLabel("Pausa"/"Riproduci")` — rinviato a Fase
  6.5.3 (richiede un setter pubblico in `internal/pkg/tray/` non
  ancora esposto).
- ☐ MediaKeys event-bus callback (OnPlay/OnPause/OnNext/OnPrevious) →
  emit Wails `media-key` evento già attivo lato `mediakeys` package;
  il frontend traduce in chiamate `PlayerService.Play/Pause/...`.
  Già funzionante, **no-op extra wiring needed**.

#### 6.5.3 Frontend hook event-driven ✅ 2026-05-22
- ✅ `hooks/useNativeMpvEngine.ts`: sostituito polling 250 ms con
  `Events.On('player-state', e => setState(e.data))` (`@wailsio/runtime`)
- ✅ Conservato fallback polling 1 s come safety net per missed events
  (suspend/resume DE, runtime non ancora pronto al mount, devtools)
- ✅ `internal/pkg/tray/tray.go`: aggiunti menu item "Riproduci/Pausa"
  + "Picture-in-Picture"; emettono rispettivamente
  `wailsevents.Emit("tray:play-pause", nil)` e
  `wailsevents.Emit("tray:pip-toggle", nil)` su click
- ✅ Setter pubblico `tray.SetPlayLabel(label string)` per refresh
  dinamico del menu item dal subscriber `PlayerService` in
  `cmd/streamai/main.go` (label "Pausa" se `loaded && !paused`,
  "Riproduci" altrimenti). Thread-safe (mutex sul ref).
- ✅ Nuovo hook `hooks/useTrayBridge.ts`: ascolta `tray:play-pause`
  (toggle Play/Pause via `PlayerService.State()` + Play/Pause con
  override `onPlayPause` opzionale) e `tray:pip-toggle` (delega
  alla callback `onPipToggle` fornita dal call site, log warning
  se assente). Lazy-import `@wailsio/runtime` per non gonfiare il
  bundle web/Capacitor; early-return su `!platformService.isWails`.
- ✅ Test Go aggiunti in `tray_test.go`: `TestSetPlayLabel_NoCrashWhenTrayNotInitialized`
  (sicurezza chiamata pre-Setup) + `TestEventNamesStable` (freeze
  dei nomi evento per allineamento col frontend). `npm run test:run`
  → 209/209 verde, `go test ./...` → tutti i pkg verdi.
- ☐ Wiring di `useTrayBridge` in `App.tsx` o `VideoPlayerNew.tsx`
  con `onPipToggle` cablato a `usePictureInPicture` — **rinviato
  a Fase 6.2** (l'hook PiP libmpv non esiste ancora; il tray emit
  funziona, basterà aggiungere `useTrayBridge({ onPipToggle: ... })`
  quando l'hook PiP sarà disponibile).

> **Beneficio raggiunto rev. 7.1 (6.5 completa):** anche con backend stub
> (audio-only, no rendering), `npm run wails:dev` ha la pipeline
> di stato player completamente connessa **end-to-end**. Una chiamata
> `PlayerService.Load(url)` propaga automaticamente:
> `[DBus.MPRIS] → playerctl status / GNOME widget`,
> `[multicast 1901] → altri device LAN`,
> `[D-Bus/IOPMAssertion] → display non si addormenta`,
> `[Wails event 'player-state'] → useNativeMpvEngine setState (push)`,
> `[tray menu label] → "Pausa"/"Riproduci" dinamica`.
> Il consumer PiP del tray (`useTrayBridge({ onPipToggle })`) resta
> in attesa dell'hook PiP libmpv di Fase 6.2.

### Fase 7-bis — Integrazione OS, lifecycle & data migration (≈5 gg, nuova rev. 5)

> Rationale: Electron fornisce "gratis" diversi servizi di integrazione OS
> (lifecycle window, icon, devtools, IPC quota, IndexedDB Chromium).
> Migrando a Wails v3 + webview di sistema, **15 dettagli vanno
> ri-implementati esplicitamente** (vedi §3.2 righe E31–E43). Senza
> questa fase la v2.0.0 RC rischia regressioni invisibili in sviluppo
> ma critiche per gli utenti (profili persi al primo avvio, schermo che
> si spegne durante un film, doppia istanza che spara due UDP broadcaster).

#### 7-bis.1 Lifecycle & shutdown ordinato (E31–E33) (1 gg) — ✅ COMPLETATA 2026-05-20 (parziale)
- ☑ `cmd/streamai/main.go`: `app.Event.OnApplicationEvent(events.Common.
  ApplicationStarted, …)` logga il cold-start time (delta da `time.Now()`
  catturato in cima a `main`), version, commit e path log file.
- ☑ Cleanup ordinato via **registration order**: Wails v3 invoca
  `ServiceShutdown` in ordine inverso di registrazione, quindi i servizi
  sono ora registrati nell'ordine `player, proxy, advertising, netstatus,
  remote, cast, discovery` per ottenere il teardown richiesto dal plan:
  `cast → remote → netstatus → advertising → proxy → player` (l'ultimo
  status WS può uscire prima della chiusura :1902, gli annunci
  mDNS/SSDP vengono rimossi dopo lo stop dei broadcaster UDP, proxy e
  player chiudono per ultimi). `discovery` non ha lifecycle hooks
  (scan on-demand), posizionato in coda neutrale.
- ☐ `app.OnEvent("activate")` (macOS): ricreazione main window quando
  `len(app.Windows())==0` — **rinviato a Fase 9-bis** (packaging macOS).
- ☐ Handler `SIGTERM`/`SIGINT` cooperativo (Unix): **rinviato** — Wails
  v3 alpha.93 già intercetta i segnali dall'event loop GTK/GLib.
  Da verificare in QA Fase 10.
- ☐ `app.OnEvent("windowClosed")` platform-aware (E31): **rinviato a
  Fase 9-bis** (comportamento macOS-specifico).

#### 7-bis.2 Single-instance lock (E38) (0.5 gg) — ✅ COMPLETATA 2026-05-20
- ☑ `internal/pkg/singleinstance/`:
  - Linux/macOS (build tag `unix`): `flock(LOCK_EX|LOCK_NB)` su
    `$XDG_RUNTIME_DIR/streamai.lock` (fallback `/tmp/streamai-<uid>/`)
    via `golang.org/x/sys/unix`.
  - Windows (build tag `!unix`): stub no-op (entrambe le istanze
    partono); estensione `CreateMutexW("Global\\StreamAI-SingleInstance")`
    + named pipe rinviata a 7-bis.2 estensione quando Wails Windows
    sarà supportato in produzione.
- ☑ IPC "show & focus": Unix socket in
  `$XDG_RUNTIME_DIR/streamai.sock` con permessi 0600. La seconda
  istanza fa `Dial("unix", ...)` con timeout 2s e invia `"FOCUS\n"`;
  la prima dispatcha la callback `onFocus` in goroutine separata.
- ☑ Wiring `cmd/streamai/main.go`: `singleinstance.Acquire("streamai",
  callback)` come prima istruzione di `main()`; se
  `ErrAlreadyRunning` ⇒ `os.Exit(0)`; soft-fail su altri errori
  (lock file non scrivibile, etc.) per non abbattere l'app.
  Callback `onFocus`: `app.Window.GetByName("main").Show().Focus()`.
- ☑ Gestione stale: socket pre-esistente di crash precedente viene
  unlinkato prima di `net.Listen("unix", ...)`; lock file persistente
  non blocca (flock è advisory + per-fd, il lock muore con il processo).
- ☑ Unit test (`singleinstance_test.go`, 8 test, race-clean):
  - Prima istanza acquisisce + socket creato.
  - Seconda istanza riceve `ErrAlreadyRunning`.
  - Focus IPC: callback `onFocus` invocata sulla prima dopo retry
    della seconda.
  - `Release` + reacquire (lock e socket riusabili dopo Release).
  - `Release` idempotente (doppia chiamata = no-op).
  - `paths()` rifiuta `appID` vuoto o con separatori path.
  - `XDG_RUNTIME_DIR` rispettato.
  - Socket stale (crash della prima istanza) viene unlinkato e
    riusato dalla nuova.


#### 7-bis.3 Power-save / display sleep inhibitor (E36) (1 gg) — ✅ COMPLETATA 2026-05-20
> Bug latente in Electron v1: durante un film/serie 2h lo schermo può
> spegnersi (l'utente deve muovere il mouse). Risolto nativamente in v2.
- ☑ Nuovo package `internal/pkg/powersave/` con tipo `Inhibitor`
  thread-safe (sync.Mutex), API `New() *Inhibitor`, `Inhibit(reason
  string) error`, `Uninhibit() error`, `Active() bool`, `Reason()
  string`. Idempotenza: doppio `Inhibit` ritorna `ErrAlreadyActive`
  (soft-error, preserva il reason originale); `Uninhibit` su inactive
  è no-op.
- ☑ Backend platform-specific via build-tag:
  - `powersave_linux.go` (linux + *BSD): D-Bus session bus,
    `org.freedesktop.ScreenSaver.Inhibit("StreamAI", reason)` →
    `uint32 cookie`; rilascio via `UnInhibit(cookie)`. Compatibile
    con GNOME, KDE Plasma, XFCE, Cinnamon, MATE, Budgie, Hyprland,
    sway+swayidle ≥ 1.7. Verificato funzionante sulla sessione GNOME
    di sviluppo (log "powersave: inhibitor active" reale, non sandbox
    fallback).
  - `powersave_windows.go`: `SetThreadExecutionState(ES_CONTINUOUS|
    ES_DISPLAY_REQUIRED|ES_SYSTEM_REQUIRED|ES_AWAYMODE_REQUIRED)` via
    `golang.org/x/sys/windows` (`kernel32.dll!SetThreadExecutionState`,
    nessun cgo). Reset a `ES_CONTINUOUS` su Uninhibit. Goroutine
    lockata a OS thread per coerenza pre-Win10.
  - `powersave_darwin.go`: subprocess `/usr/bin/caffeinate -d -i -w
    <PID>` (no cgo). Il flag `-w <PID>` aggancia la vita di
    caffeinate al PID nostro: se l'app crasha senza Uninhibit,
    caffeinate muore con noi → zero leak di IOPM assertion. Su
    Uninhibit esplicito facciamo `Process.Kill()`.
  - `powersave_other.go` (`!linux && !windows && !darwin && !*BSD`):
    no-op silenzioso (Plan9, illumos, …).
- ☑ Cross-compile verificato: pure-pkg compila su Linux, Windows
  (CGO_ENABLED=0), macOS (CGO_ENABLED=0). Il wrapper Service
  importa Wails che richiede cgo Cocoa su macOS — vincolo Wails,
  non nostro.
- ☑ Nuovo Wails Service `internal/services/powersave/` con metodi
  bindable `Start(reason) error`, `Stop() error`, `Active() bool`,
  `Reason() string` + lifecycle `ServiceStartup` (no-op lazy) e
  `ServiceShutdown` (rilascia inhibition pendente).
- ☑ Wiring `cmd/streamai/main.go`: registrato in cima all'array
  (Wails reverse-shutdown: powersave per ultimo → l'IOPMAssertion/
  DBus inhibition viene rilasciata DOPO che il player ha già
  fatto Stop(), pipeline "playerStop → screenSleepReleased"
  observable in QA Fase 10).
- ☑ Mapping IPC documentato (Electron → Wails) nel godoc del Service:
  - `electronAPI.powerSaveStart(reason)` → `PowerSaveService.Start`
  - `electronAPI.powerSaveStop()`        → `PowerSaveService.Stop`
  - `electronAPI.powerSaveActive()`      → `PowerSaveService.Active`
- ☑ Unit test (2 file, 3 test): `powersave_test.go` lifecycle +
  idempotenza + default reason "Video playback"; `service_test.go`
  smoke del wrapper Wails + idempotenza `ServiceShutdown`.
- ☐ Hook `PlayerService.OnPlay/OnPause/OnStop` → rinviato a Fase 6
  (PlayerService non implementato). Punto di aggancio in
  `cmd/streamai/main.go`: basterà chiamare
  `powersaveSvc.Start("Live TV")` dentro callback OnStateChange del
  player. In alternativa il frontend può invocare il binding
  TS diretto (`PowerSaveService.Start`) — pattern usato anche da
  altri servizi (cast, advertising) in attesa del player nativo.
- ☐ Toggle utente `ProfilePreferences.preventDisplaySleep` (default
  true) → rinviato a Fase 7 (compat layer & cleanup TS), dove
  verranno aggiunti tutti i nuovi flag di `ProfilePreferences`.

#### 7-bis.4 Media keys hardware (E37) (1 gg) — ✅ COMPLETATA 2026-05-20 (Linux), 🚧 Windows/macOS rinviati
- ☑ Nuovo package `internal/pkg/mediakeys/` con tipo `Controller`
  thread-safe (sync.Mutex), API `New(Callbacks) *Controller`,
  `Start(identity) error`, `Stop() error`, `SetStatus`, `SetMetadata`,
  `SetVolume`, `SetCapabilities`, `Started`, `SetCallbacks`.
- ☑ Backend platform-specific via build-tag:
  - `mediakeys_linux.go` (linux + *BSD): **MPRIS2 D-Bus session**.
    Bus name `org.mpris.MediaPlayer2.streamai` (sanitizeIdentity
    → `[a-z0-9_]`), object path `/org/mpris/MediaPlayer2`, due
    interfacce `org.mpris.MediaPlayer2` (Raise/Quit + 7 properties:
    Identity, DesktopEntry, CanQuit, CanRaise, HasTrackList,
    SupportedUriSchemes, SupportedMimeTypes) e
    `org.mpris.MediaPlayer2.Player` (10 metodi: Next, Previous,
    Pause, PlayPause, Stop, Play, Seek, SetPosition, OpenUri + 14
    properties: PlaybackStatus, LoopStatus, Rate, Shuffle,
    Metadata, Volume, Position, MinimumRate, MaximumRate, 6×Can*).
    Introspection completa via godbus/introspect → playerctl,
    `gdbus introspect`, GNOME Shell media widget, KDE Plasma
    Plasmoid Media Player. Fallback per-instance bus name
    `streamai.instance<PID>` se il name principale è già preso
    (single-instance lock di Fase 7-bis.2 evita comunque la collisione).
  - `mediakeys_other.go` (`!linux && !*BSD`): stub no-op per
    Windows/macOS. **TODO esplicito** nel godoc per future
    estensioni (SMTC via `saltosystems/winrt-go` su Windows;
    `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` via cgo
    Cocoa su macOS, `-framework MediaPlayer`).
- ☑ Workaround `go vet stdmethods`: il metodo `Seek(int64) *dbus.Error`
  confligge con la signature `io.Seeker`. Soluzione adottata:
  rinominato il metodo Go in `MprisSeek` e registrato sul bus col
  nome `Seek` via `conn.ExportWithMap` + post-processing della
  introspection (`buildIntrospection` rinomina manualmente).
  Zero impatto sulla DBus signature visibile dal client.
- ☑ Cross-compile verificato: pure-pkg + Service compilano su
  Linux, Windows (CGO_ENABLED=0), macOS (pure-pkg only).
- ☑ Nuovo Wails Service `internal/services/mediakeys/` con metodi
  bindable `Start*/Stop*/SetPlaybackStatus/SetMetadata/SetVolume/
  SetCapabilities/Started` (input JSON-safe: `MetadataInput`,
  `CapabilitiesInput`; secondi ⇄ microseconds conversione interna).
- ☑ Bridge eventi backend → frontend: ogni callback OnXxx emette
  un evento Wails `media-key` con payload
  `{action: "play|pause|playpause|stop|next|previous|seek|
  setposition|raise|quit", offsetSeconds?, positionSeconds?}` via
  `wailsevents.Emit`. Pattern di consumo lato frontend documentato
  nel godoc del Service. Le callback partono in goroutine separata
  (`dispatchCallback`) per non bloccare l'event loop D-Bus.
- ☑ Wiring `cmd/streamai/main.go`: registrato sotto `powersave` in
  cima all'array (Wails reverse-shutdown: mediakeys chiude DOPO
  player, così `PlayerService.Stop → SetStatus("Stopped")` arriva
  al DE prima dell'unregister del bus name).
- ☑ Unit test (`mediakeys_test.go`, 6 test): Start/Stop lifecycle
  + idempotenza ErrAlreadyStarted, setter pre-Start no-crash,
  volume clamp [0,1], SetCallbacks atomic swap, dispatchCallback
  nil-safe, DefaultCapabilities sanity.
- ☑ Unit test Linux (`mediakeys_linux_test.go`, 1 test): 7 casi
  per `sanitizeIdentity` (ASCII, spazi, simboli, non-ASCII,
  empty, lowercase).
- ☑ **End-to-end test reale** (`e2e_linux_test.go`, 2 test,
  `//go:build linux`, skip se gdbus non in PATH):
  - `TestE2E_MprisAdvertisedToSessionBus`: registra il
    Controller, lancia `gdbus introspect` reale sul session bus,
    verifica che l'introspection contenga `org.mpris.MediaPlayer2`,
    `Play`, `Pause`, `PlayPause`, `Seek`, `PlaybackStatus`,
    `Identity` (passa sul GNOME di dev).
  - `TestE2E_MethodCallDispatchesCallback`: chiama `gdbus call`
    su `Play`/`Pause`/`Next` e verifica che le callback Go
    vengano invocate (passa, log "MPRIS Play()/Pause()/Next()"
    osservabili nei test verbose).
- ☐ Hook automatico da PlayerService → SetStatus/SetMetadata/
  SetCapabilities: rinviato a Fase 6 (PlayerService non
  implementato). Il frontend può intanto chiamare i binding TS
  direttamente dal componente `VideoPlayerNew.tsx`.
- 🚧 SMTC Windows: rinviato — richiede `saltosystems/winrt-go`,
  +1 gg stimato. Tracking dedicato.
- 🚧 MPRemoteCommandCenter macOS: rinviato — richiede cgo Cocoa +
  Info.plist bundle ID, +1.5 gg stimato. Tracking dedicato.

#### 7-bis.5 System tray & icon embed (E34, E39) (0.5 gg) — ✅ COMPLETATA 2026-05-20
- ☑ Nuovo package `internal/pkg/appicon/` con `AppIcon256` + `AppIcon512`
  embeddati via `//go:embed` da copie locali di `build/icons/256x256.png`
  e `build/icons/512x512.png` (le copie sono necessarie perché
  `//go:embed` non supporta path al di fuori del package).
- ☑ `application.Options{Icon: appicon.AppIcon256}` in `cmd/streamai/main.go`
  → dock/taskbar (Linux/macOS), finestra alt-tab + AppUserModelID (Windows),
  dialog About.
- ☑ Nuovo package `internal/pkg/tray/` con `Setup(app, logFilePath)
  *application.SystemTray`. Best-effort: ritorna nil su app nil
  senza panicare.
- ☑ Tray attributes (replica spec plan):
  - Tooltip: "StreamAI IPTV"
  - Icon: `AppIcon256`
  - Click sull'icona: toggle show/hide della main window (se visibile
    + focused ⇒ Hide; altrimenti Show + Focus). Su Linux KDE / Windows
    è il left-click; su macOS il click apre comunque il menu (NSStatusItem).
  - Menu: "Mostra finestra" / "Apri cartella log" (disabled se
    `logFilePath==""`, altrimenti apre la dir contenente streamai.log
    via `xdg-open` / `open` / `explorer`) / separator / "Esci"
    (accelerator `CmdOrCtrl+Q`, chiama `app.Quit()`).
- ☑ Wiring: `tray.Setup(app, logFile)` invocato dentro l'handler
  `OnApplicationEvent(events.Common.ApplicationStarted, …)` perché su
  Linux/GTK la connessione dbus per libayatana-appindicator non è
  pronta prima di `g_application_activate`.
- ☑ Voci "Picture-in-Picture" e "Pausa" del piano **rinviate**:
  richiedono wiring backend↔frontend via Wails Events (`tray:pip-toggle`,
  `tray:play-pause`) che dipende dal PlayerService di Fase 6. Punto di
  aggancio già pronto in `tray.Setup`.
- ☑ Voce "Minimize to tray" su macOS rinviata a Fase 9-bis (packaging
  macOS), insieme alla migrazione a `SetTemplateIcon` (icona
  monocromatica template-style per light/dark adaptive).
- ☑ Unit test (`tray_test.go`, 3 test): embed PNG non-empty + magic
  header valido, `openPath` builder per OS, regression guard su
  `MainWindowName`.

#### 7-bis.6 Logging file rotante (E40) (0.5 gg) — ✅ COMPLETATA 2026-05-20
- ☑ Nuovo package `internal/pkg/logging/` con `Init(Options) (logFile,
  error)`, `Close()`, `LogFilePath()`, `WriteCrashReport(appID, payload)`,
  `CrashReportsDir(appID)`.
- ☑ Dual output via `io.MultiWriter`: `zerolog.ConsoleWriter{Out:
  os.Stderr}` (colori disabilitati automaticamente se stderr non è un
  TTY) + `lumberjack.Logger{MaxSize:10, MaxBackups:5, Compress:true}`.
- ☑ Path file per OS (replica spec plan):
  - Linux/*BSD: `$XDG_STATE_HOME/streamai/streamai.log`
    (fallback `~/.local/state/streamai/streamai.log`)
  - macOS: `~/Library/Logs/StreamAI/streamai.log`
  - Windows: `%LOCALAPPDATA%\StreamAI\logs\streamai.log`
    (fallback `%APPDATA%\StreamAI\logs\`)
- ☑ Override path via env `STREAMAI_LOG_FILE` (utile CI/test) —
  supporta espansione `~/` lato Linux/macOS.
- ☑ Livello configurabile `STREAMAI_LOG_LEVEL=trace|debug|info|warn|
  error|fatal|panic|disabled` (default `info`, fallback `info` su
  valori sconosciuti). Parsing case-insensitive con alias
  `warn|warning`, `disabled|off|silent`.
- ☑ Wiring `cmd/streamai/main.go`: `logging.Init(...)` come PRIMA
  istruzione di `main()` (prima del single-instance lock, così anche
  l'exit "altra istanza attiva" finisce sul file rotante).
  `defer logging.Close()` su exit path normale; `crashguard.Recover`
  chiama `logging.Close()` prima di `os.Exit(1)`.
- ☑ Sostituite tutte le chiamate `log.Printf` in `main.go` con
  `log.Info/Warn/Error().Err(...).Str(...).Msg(...)` di zerolog.
  Gli altri service mantengono il `log.Printf` standard (verrà
  migrato gradualmente nei rispettivi PR — il global zerolog
  intercetta comunque l'output via `log.SetOutput` indiretto se
  necessario).
- ☑ Unit test (`logger_test.go`, 4 test): `parseLevelEnv` (default,
  case-insensitive, fallback, `disabled`), `resolveLogPath` (override
  + default Linux via `XDG_STATE_HOME`), `Init` end-to-end con
  `STREAMAI_LOG_FILE` redirect, `WriteCrashReport` su path Linux.
- ☐ UI menu Help → "Apri cartella log" → rinviato a Fase 7-bis.5
  (system tray + menu nativi).

#### 7-bis.7 Crash recovery / panic capture (E41) (0.5 gg) — ✅ COMPLETATA 2026-05-20 (parziale)
- ☑ Nuovo package `internal/pkg/crashguard/` con `Recover(appID,
  version, commitSHA)` (defer top-level main) e `RecoverGoroutine(name)`
  (defer per goroutine non-main: logga via zerolog ma non termina il
  processo).
- ☑ `Recover` su panic costruisce payload completo (timestamp, version,
  commit, OS/arch, Go version, NumCPU, NumGoroutine, log file path,
  panic value, stack trace via `debug.Stack()`) e lo scrive in
  `crashes/crash-<unix-nano>.log` accanto al log principale via
  `logging.WriteCrashReport`. Fa `logging.Close()` per garantire
  flush del file rotante e termina con `os.Exit(1)`.
- ☑ Best-effort: se la scrittura del crash report fallisce
  (filesystem RO, perm denied), il payload viene comunque
  dumpato su `os.Stderr` per non perdere informazioni.
- ☑ Wiring `cmd/streamai/main.go`: `defer crashguard.Recover(
  "streamai", version, commitSHA)` come seconda istruzione di
  `main()` (dopo `logging.Init`, prima di qualsiasi codice che
  possa panicare).
- ☑ Unit test (`crashguard_test.go`, 3 test):
  `buildPayload` contiene tutti i campi attesi, `RecoverGoroutine`
  cattura panic senza terminare il test runner, `nonEmpty` helper.
- ☐ Dialog opt-in "StreamAI è crashato. Invia report? [Invia/Ignora]"
  al prossimo avvio se `CrashReportsDir(appID)` non vuota — **rinviato**
  a Fase 7-bis.9 (notifiche di sistema) per accoppiarlo al
  permission grant del webview.

#### 7-bis.8 Migrazione dati v1 → v2 (E35) (1 gg) ⚠️ CRITICA — ✅ COMPLETATA 2026-05-25
> **Rischio data-loss risolto.** Implementata estrazione chirurgica da LevelDB (LocalStorage/IndexedDB)
> per profili e cronologia. Il frontend ora migra i dati automaticamente al primo avvio su Wails.
- ✅ Step 0: Implementazione scaffolding Go (`internal/pkg/migrate`, `internal/services/migration`).
- ✅ Step 0.1: Discovery path per-platform (Linux, Windows, macOS) in `paths.go`.
- ✅ Step 1: Implementazione `extractor.go` (Go) per lettura LevelDB via `goleveldb`.
- ✅ Step 2: Implementazione `MigrationService.ts` (TS) per iniezione `localStorage`.
- ✅ Step 3: Wiring in `App.tsx` con schermata di caricamento "Migrazione dati in corso…".
- ✅ Test: Validata estrazione profili `streamai_profiles` e ripresa visione.

#### 7-bis.9 Notifiche di sistema (E42) (0.25 gg) — ✅ COMPLETATA 2026-05-25
- ✅ **Implementazione:** Creato wrapper interno `internal/pkg/notifications` platform-specific:
  - Linux: D-Bus `org.freedesktop.Notifications.Notify` (via `godbus`).
  - Windows: Fallback PowerShell `System.Windows.Forms.NotifyIcon`.
  - macOS: Fallback `osascript -e 'display notification ...'`.
- ✅ **Service:** Esposto `NotificationService.Send` via Wails IPC.
- ✅ **Frontend:** Integrato in `reminderService.ts` via `host.sendNotification`.
  3. Web Notifications API (`Notification.requestPermission()` +
     `new Notification(...)` lato frontend): più semplice ma
     richiede al primo uso il permission grant del webview.
- Use case attesi: "Nuovo episodio disponibile", "Cast device
  connesso", "Errore stream", "Aggiornamento disponibile",
  "StreamAI crash report ready (Fase 7-bis.7)".

#### 7-bis.10 DevTools toggle (E43) (0.25 gg) — ✅ COMPLETATA 2026-05-20
- ☑ Nuovo package `internal/pkg/devtools/` con `Enabled() bool`
  (parsing env `STREAMAI_DEBUG=1|true|yes|on`, case-insensitive,
  trim spaces) e `KeyBindings() map[string]func(application.Window)`.
- ☑ Wails v3 alpha.93 espone già `WebviewWindowOptions{DevToolsEnabled,
  KeyBindings}`. Wiring `cmd/streamai/main.go`:
  - `DevToolsEnabled: devtools.Enabled()` → forza abilitazione in
    build `production` quando l'utente lancia con `STREAMAI_DEBUG=1`.
    In dev build (default `go build` senza tag `production`) Wails
    abilita automaticamente i DevTools, l'env è ridondante ma
    innocuo.
  - `KeyBindings: devtools.KeyBindings()` → mappa
    `cmdorctrl+shift+i` e `f12` ⇒ `w.OpenDevTools()`. La sintassi
    accelerator Wails risolve `cmdorctrl` a `Cmd` su macOS e `Ctrl`
    su Linux/Windows. Ritorna `nil` senza opt-in, così le bindings
    NON vengono registrate (privacy).
- ☑ Nei 3 webview (WebKitGTK 6.0, WebView2, WKWebView) `Ctrl+Shift+I`
  / `F12` sono già gestiti nativamente quando DevTools sono attivi
  — le KeyBindings Wails sono un layer aggiuntivo che funziona
  anche su iframe sandbox o quando il webview ha focus non-default.
- ☑ Logging: in opt-in viene scritto su zerolog "DevTools forced
  enabled via env opt-in" (tracciabile in `streamai.log`).
- ☑ Unit test (`devtools_test.go`, 3 test): parsing env (10 casi
  cover positivi+negativi+whitespace), `KeyBindings` returns nil
  senza opt-in / map con 2 entries con opt-in, callback safe su
  window nil (regression guard "tasto premuto durante teardown").

### Fase 7 — Compat layer & cleanup TS (≈3 gg) — ◐ IN PROGRESS 2026-05-20

> **Stato attuale (2026-05-20):** backend Go pronto (9 Service registrati,
> bindings TS generabili via `npm run wails:bindings`). Frontend è ancora
> 100% sull'API Electron (35 occorrenze `window.electronAPI` su 7 file).
> La fase è stata splittata in 3 micro-step incrementali per ridurre il
> rischio di regressione UI:
>
> - **7.1 Foundation** (questo PR): `@wailsio/runtime` come dep,
>   `platformService.ts` esteso con `isWails`, nuovi `wailsBridge.ts`
>   wrap dei Service Go disponibili (discovery, cast, netstatus, remote,
>   advertising, proxy, powersave, mediakeys), `hostBridge.ts` switch
>   `isWails ? wailsBridge : electronAPI`. **Zero rimozioni** di codice
>   Electron — pura aggiunta.
> - **7.2 Migration sweep** (PR successivo): grep+sed di `window.electronAPI`
>   → `host` su 35 occorrenze, mantenendo Electron come fallback runtime.
>   Test suite vitest verde.
> - **7.3 Electron drop** (PR finale, dopo Fase 6 player + smoke test
>   v2.0.0-rc): rimozione `preload.js`, `main.js`, `useWebPlayerEngine.ts`,
>   `video.js`, `hls.js`, `mpegts.js`, `electron*`, `castv2-client`,
>   `node-ssdp`, `bonjour`, `ws` da `package.json`. Disabilita
>   `scripts/patch-ffmpeg.js`.

#### 7.1 Foundation (✅ COMPLETATA 2026-05-20)
- ☑ Aggiunto `@wailsio/runtime@3.0.0-alpha.79` a `package.json` deps
  (upstream npm in lag rispetto a `wails3` CLI alpha.93; alpha.79 è
  l'ultimo pubblicato e API-compatibile per `Events.On` + `Call.ByID`).
- ☑ `services/platformService.ts` esteso: nuovo flag `isWails`
  (= `!!(window as any).wails`), nuovo `isDesktop = isElectron || isWails`,
  `Platform` ora include `'wails'`. Le `capabilities` (`casting`, `pip`,
  `download`) usano `isDesktop` invece di `isElectron`.
- ☑ Nuovo `services/wailsBridge.ts`: wrap dei Service Go disponibili
  (discovery, cast, netstatus) tramite i binding TS generati.
  Eventi `device-found` / `cast-status` / `network-playback-status` /
  `remote-control-command` / `request-status-broadcast` instradati via
  `@wailsio/runtime` `Events.On`. Shape `HostAPI` 1:1 con `preload.js`.
- ☑ Nuovo `services/hostBridge.ts`: accessor pigro `host` che cristallizza
  alla prima call l'API corretta in base a `platformService.isWails` /
  `isElectron`. Helper `requireHost()` per call site post-7.2 che esigono
  un bridge presente.
- ☑ `npx tsc --noEmit` verde, `npm run check:wails` verde, `vitest run`
  209/209 verde, `go build -tags gtk3 ./...` verde, `go test ./internal/...`
  verde su tutti i pacchetti con test (14 ok).
- ☐ Documentare in `AGENTS.md` § "Cross-Platform Development" il pattern
  `host` invece di `window.electronAPI` — rinviato a Fase 7.2 (insieme al
  primo migration site).

#### 7.2 Migration sweep (✅ COMPLETATA 2026-05-20)
- ☑ Sostituite **15 occorrenze** `window.electronAPI` → `host` in:
  - `frontend/App.tsx` (1 sito: `onNetworkPlaybackStatus`)
  - `frontend/components/VideoPlayerNew.tsx` (2 siti: `updatePlaybackStatus`)
  - `frontend/hooks/useCastSession.ts` (7 siti: castConnect/Load/Control/Disconnect + onCastStatus; `isElectron` → `isDesktop`, `electronAPI` → `hostBridge!`)
  - `frontend/hooks/useRemoteControl.ts` (1 sito: `onRemoteControlCommand` + `onRequestStatusBroadcast`)
  - `frontend/hooks/useWebPlayerEngine.ts` (1 sito: gating bandwidth monitoring)
  - `frontend/services/deviceDiscovery.ts` (12 siti: discoverDevices, getLocalIPs, scanIp, probeDeviceServices, castToDevice, onDeviceFound) + `private get isElectron()` ora ritorna `platformService.isDesktop && !!host`
- ☑ Eventi: `electronAPI.on*` → `host.on*` (gli helper `onEvent` di `wailsBridge.ts`
  proxy-ano via `@wailsio/runtime` `Events.On` quando `host === wailsBridge`).
- ☑ Type-check `npx tsc --noEmit` verde dopo la sostituzione (1 fix tipizzazione
  esplicita su `DiscoveredDevice` nel callback `onDeviceFound`).
- ☑ `npm run check:wails` verde, `vitest run` 209/209 verde.
- ☑ `frontend/AGENTS.md` § "Cross-Platform Development" aggiornato con pattern `host`.
- ☐ Smoke manuale Wails dev (`npm run wails:dev`) e Electron dev (`npm run dev`)
  rinviato a QA Fase 10 (build Wails richiede runtime libmpv + webkit2gtk-4.1
  sul dev host, già installati su openSUSE TW).

#### 7.3 Electron drop (hard requirement v2.0.0-rc.1, rev. 7) — ◐ STAGE A COMPLETATA 2026-05-22

> **Esecuzione "Stage A" 2026-05-22:** rimossa la parte di runtime
> Electron + servizi già sostituiti dal backend Go, **senza toccare le
> librerie player Web** (Video.js, HLS.js, mpegts.js, `@videojs/http-streaming`,
> `jmuxer`, `useWebPlayerEngine.ts`). Queste restano operative dentro la
> webview di Wails — il frontend ha quindi un player funzionante
> intermedio finché Fase 6.1 (libmpv render-API + `useNativeMpvEngine`)
> non le rimpiazza. Lo "Stage B" è quindi il PR che elimina le 6
> dipendenze player Web + `useWebPlayerEngine.ts`, attivato al completamento
> della Fase 6.1 / passaggio SPIKE-1/2/4.
>
> **Verifica end-to-end Stage A:** `npm run check` (check-deps,
> typecheck, 209/209 vitest, check-media3, check-wails, `go vet` +
> `go build -tags 'gtk3 mpv'`, vite build) ✅; `git grep -i electron`
> ritorna solo riferimenti a documenti storici (CHANGELOG, plan, AGENTS
> "removed 2026-05-22"); `node_modules/electron` non esiste più.

**Stage A (eseguito 2026-05-22):**
- ☑ `services/hostBridge.ts`: collassato a `wailsBridge` (no fallback
  Electron). Tipizzazione mantenuta loose (`any`) per non forzare refactor
  immediato dei call site; verrà strizzata insieme a `wailsBridge`
- ☑ `services/platformService.ts`: rimosso `'electron'` da `Platform`;
  `isElectron` mantenuto come getter deprecato che ritorna sempre `false`
  (rimosso in Stage B finale)
- ☑ Eliminati file root: `main.js`, `preload.js`, `vite.main.config.js`,
  `scripts/patch-ffmpeg.js`
- ☑ Eliminato `frontend/services/advertisingService.js` (sostituito da
  `internal/services/advertising/` Go)
- ☑ `package.json` riscritto:
  - rimosso `"main": "main.js"` e `"build"` (electron-builder section)
  - rimosso da `dependencies`: `castv2-client`, `node-ssdp`, `bonjour`
  - rimosso da `devDependencies`: `electron`, `electron-builder`
  - rimosso `"postinstall": node scripts/patch-ffmpeg.js`
  - `"scripts.dev"` → alias di `npm run wails:dev`; `"scripts.start"` →
    alias di `npm run wails:run`
  - rimossi target obsoleti `dist:linux:{deb,rpm,pacman,appimage,tar,all}`
- ☑ `npm install` ha rimosso **188 pacchetti** (Electron + transitivi).
  `ws` resta come transitive di video.js/hls.js (eliminato in Stage B)
- ☑ `.github/workflows/linux-release.yml`: trigger su tag `v*`
  **commentato** per evitare run accidentali contro la pipeline legacy
  (resta solo `workflow_dispatch`); riscrittura completa in Fase 8
- ☑ `scripts/build-linux.sh`: deprecato — aborta con messaggio chiaro
  a meno di `ALLOW_LEGACY_ELECTRON_BUILD=1`
- ☑ `AGENTS.md` + `.github/copilot-instructions.md`: aggiornati con
  rev. 7 e drop note nei gotcha

**Stage B (programmato post-Fase 6.1):**
- ☐ `frontend/`: eliminare `hooks/useWebPlayerEngine.ts`,
  `components/VideoPlayerNew.tsx` semplificato a un solo branch
  (`useNativeMpvEngine`)
- ☐ `package.json` `devDependencies`: rimuovere `video.js`,
  `@types/video.js`, `hls.js`, `mpegts.js`, `@videojs/http-streaming`,
  `jmuxer` (player Web legacy)
- ☐ `services/platformService.ts`: rimuovere il getter deprecato `isElectron`
- ☐ `services/hostBridge.ts`: stringere la tipizzazione a `HostAPI`
  (no più `any`); ampliare `HostAPI` con i metodi mancanti
  (`castToDevice`, payload tipizzati)
- ☐ `tests/`: rimuovere mock `electronAPI` rimanenti, snapshot Video.js
- ☐ CI: rimozione cache `electron`/`electron-builder` (workflow riscritto
  Fase 8 — naturalmente non le includerà)
- ☐ Bump `.version` da `1.x` → `2.0.0-rc.1` + `npm run version:sync`
- ☐ Tag annotato `electron-final` sul commit precedente alla rimozione
  di Video.js (riferimento storico immutabile)
- ☐ Commit atomico: `chore: drop electron player legacy (closes #N)`
- ☐ Announce nel `CHANGELOG-2.0.md`: "Electron rimosso completamente:
  desktop runtime esclusivamente Wails v3."

### Fase 8 — Packaging Linux (≈3 gg) — 🚧 SPOSTATA IN CODA (rev. 7.1)

> **Pre-requisito:** tutte le funzionalità (Fasi 6, 6.5, 7-bis.8, 7.3 Stage B)
> implementate e funzionanti. Avviare solo dopo che `npm run wails:build`
> produce un binario feature-complete su Linux di sviluppo. Vedi §6 ordine
> rev. 7.1.

- ☐ Creare `nfpm.yaml` con templating per `${VERSION}` `${DISTRO}` `${ARCH}`
- ☐ Adattare `scripts/build-linux.sh` per usare `nfpm pkg --packager deb|rpm|archlinux`
- ☐ Adattare `scripts/make-distro-config.mjs` per emettere depends Go-runtime
- ☐ Rilasciare `build/depends/<distro>.json` aggiornati (vedi tabella §5.1)
- ☐ Adattare `.github/workflows/linux-release.yml`:
  - swap `electronuserland/builder` Docker → `golang:1.23-bookworm` per la build
  - swap fase `vite build` (resta) → `wails3 build` (richiama Vite internamente)
  - mantieni firma GPG, SLSA, Pages deploy
- ☐ Rifirmare con `debsigs` / `rpm --addsign` (zero cambi pipeline firma)
- ☐ Test installazione su VM pulite: Ubuntu 24.04, Fedora 41, Arch, openSUSE TW

### Fase 9 — Packaging Windows (≈3 gg, day-1 v2.0.0) — 🚧 SPOSTATA IN CODA (rev. 7.1)

- ☐ Workflow `.github/workflows/windows-release.yml`:
  - runner `windows-2022`, install Go 1.23, Wails CLI, nsis
  - `wails3 build -platform windows/amd64 -clean` + `makensis build/windows/installer.nsi`
- ☐ Pre-build step: scaricare `mpv-2.dll` pinnato (`build/win/mpv-dll-version.json`)
  da shinchiro release, verifica SHA-256, copia in `build/bin/`
- ☐ NSIS template custom: `build/windows/installer.nsi` con dichiarazione
  WebView2 evergreen bootstrap + bundle `mpv-2.dll`
- ☐ Authenticode signing: `osslsigncode sign -certs cert.pem -key key.pem`
  → secret CI `WIN_SIGN_CERT_PFX` / `WIN_SIGN_CERT_PASSWORD`
- ☐ Smoke test su VM pulita Windows 10 21H2 e Windows 11 23H2
- ☐ Verifica HEVC/AV1 + Document PiP funzionanti out-of-the-box
- ☐ Auto-update channel: pubblicare `latest-windows.yml` su GitHub Pages

### Fase 9-bis — Packaging macOS (≈4 gg, day-1 v2.0.0) — 🚧 SPOSTATA IN CODA (rev. 7.1)

- ☐ Workflow `.github/workflows/macos-release.yml`:
  - runner `macos-14` (Apple Silicon) per build universal
  - install Go 1.23, Wails CLI, `create-dmg`
  - `wails3 build -platform darwin/universal -clean`
- ☐ Pre-build step: scaricare `libmpv.2.dylib` universal pinnato
  (`build/macos/mpv-dylib-version.json`), verifica SHA-256, copia in
  `StreamAI.app/Contents/Frameworks/`
- ☐ Rewriting rpath con `install_name_tool -change` per linkare dylib bundled
- ☐ Code-signing con Apple Developer ID Application cert:
  - `codesign --deep --options runtime --entitlements build/macos/Entitlements.plist`
  - secret CI `APPLE_DEV_ID_CERT_P12` / `APPLE_DEV_ID_CERT_PASSWORD`
- ☐ Notarization headless: `xcrun notarytool submit --wait`
  (secret `APPLE_NOTARY_USER` / `APPLE_NOTARY_PASSWORD` / `APPLE_TEAM_ID`)
- ☐ Stapling: `xcrun stapler staple StreamAI.app`
- ☐ DMG creation con `create-dmg` (background + drag-to-Applications)
- ☐ Smoke test su macOS 13 (Intel) e macOS 14 (Apple Silicon)
- ☐ Verifica HEVC/AV1 (VideoToolbox) + Document PiP
- ☐ Auto-update channel: pubblicare `latest-macos.yml` su GitHub Pages

### Fase 10 — Testing & QA cross-platform (≈6 gg)
- ☐ Test funzionali su matrice completa:
  - **Linux:** 6 distro × 3 codec × 3 protocolli
  - **Windows:** Win10 21H2, Win11 23H2 × 3 codec × 3 protocolli
  - **macOS:** macOS 13 Ventura, macOS 14 Sonoma, macOS 15 (se disponibile) × 3 codec
  - 4 dispositivi cast (Chromecast, Android TV, Samsung Tizen, LG webOS)
  - PiP testato su tutte e 3 le piattaforme con primary + fallback path
- ☐ **Soak test playback 4K (≥ 1h ciascuno) — vincolo §4.8:**
  - HEVC 10-bit 4K@60 HDR10 (HLS VOD) × 3 OS
  - AV1 4K@60 (DASH VOD) × 3 OS
  - HLS live 4K HEVC + audio AC3 5.1 × 3 OS (focus AV-sync)
  - MPEG-TS UDP 4K HEVC (multicast, scenario IPTV pro) × Linux
  - Metriche raccolte automaticamente: dropped frame %, AV-sync drift
    (media/peak), CPU%, RAM, audio underrun count
  - Job CI notturno `tests/playback/4k-soak.sh` su VM Linux con HW decode
- ☐ Stress test: 1000 canali M3U, 50 scan device, scrolling continuo,
  20 cambi canale rapidi (zapping), 100 transizioni 1080p ↔ 4K
- ☐ Confronto KPI con baseline §1.3 per ogni OS — target: −60% RAM,
  −70% installato (Linux), −50% installato (Win/macOS con mpv bundled)
- ☐ Regression: scorciatoie tastiera, OSD, timeline tooltip, sleep timer,
  remote control WS, casting
- ☐ Test sicurezza: `gosec`, `staticcheck`, `govulncheck`
- ☐ Verifica certificate chains valide (Authenticode + Apple notarization)
- ☐ Test installazione ed esecuzione su utenti reali (≥ 5 per OS)
- ☐ Test su HW di fascia bassa (CPU ≥ 6 anni): Intel i5-6500 + UHD 530,
  Mac Mini 2018 — verifica graceful degradation a 1080p con UI banner

### Fase 11 — Documentazione & release (≈2 gg)
- ☐ Aggiornare `AGENTS.md` + `.github/copilot-instructions.md` con nuovo stack
- ☐ Aggiornare `README.md` (prerequisiti: Go 1.23+, libmpv, webkit2gtk,
  WebView2, WKWebView ≥ macOS 13)
- ☐ Aggiornare `docs/INSTALL.md` con dipendenze runtime per OS+distro
- ☐ Aggiornare `docs/IMPROVEMENT_PLAN.md` MED-1/MED-2 con stato post-migrazione
- ☐ Nuovo `docs/SIGNING-WINDOWS.md` (Authenticode workflow)
- ☐ Nuovo `docs/SIGNING-MACOS.md` (Apple notarization workflow)
- ☐ Bump `.version` → `2.0.0` + `npm run version:sync`
- ☐ Changelog dedicato `docs/CHANGELOG-2.0.md`
- ☐ Tag `v2.0.0-rc.1` → CI release (Linux + Windows + macOS in parallelo)
  → beta opt-in 2 settimane → smoke test → `v2.0.0`

**Totale stimato: ~55 gg-uomo** (≈ 11 settimane full-time, 5 mesi
part-time — rev. 5: +5 gg per Fase 2-bis DIAL HTTP receiver + Fase 7-bis
integrazione OS/lifecycle/data-migration). Distribuzione: Fase 0–6
~33 gg, Fase 2-bis ~1.5 gg, Fase 7-bis ~5 gg, Fase 7 cleanup ~3 gg,
Fase 8 ~3 gg (Linux), Fase 9 ~3 gg (Win), Fase 9-bis ~4 gg (macOS),
Fase 10 ~6 gg (QA), Fase 11 ~2 gg.

> **Critical path:** Fase 6 (player + PiP). Gli spike 6.0 vengono eseguiti
> **in parallelo sui 3 OS**: se anche uno solo fallisce su una piattaforma,
> si rivede lo scope (es. macOS rimandato) prima di proseguire la migrazione
> sulle altre.
>
> **Parallelizzazione possibile:** Fasi 8/9/9-bis (packaging per OS) sono
> indipendenti tra loro e possono essere distribuite a più maintainer.

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
- ☐ Installato `.deb` su Ubuntu 24.04 in <5 s da `apt install`
- ☐ Dimensione pacchetto installato ≤ 100 MB (libmpv di sistema)
- ☐ RAM idle ≤ 150 MB
- ☐ RAM con stream HEVC 4K ≤ 400 MB

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
- ☐ TTFF HLS H.264 ≤ baseline Electron + 200 ms
- ☐ **Player integrato (vincolo):** `<canvas>` mpv compone correttamente
  con OSD/timeline DOM, zero flicker, zero z-index glitch, resize fluido
  in <16 ms
- ☐ **PiP funziona (vincolo)** con scorciatoia `P` e pulsante UI, sia per
  H.264 che HEVC, su ogni OS supportato
- ☐ **PiP fallback** automatico verificato disattivando Document PiP
- ☐ **Qualità 4K (vincolo §4.8):**
  - HEVC 10-bit 4K@60 HW-decoded: dropped frame ≤ 0.5% su 10 min
  - AV1 4K@60 HW-decoded (dove supportato dal SoC): dropped frame ≤ 1%
  - Nessun tearing visibile, nessun judder su contenuti 24p/30p
- ☐ **AV-sync (vincolo §4.8):**
  - Drift medio |Δ| ≤ 20 ms su HLS live HEVC 4K, sessione 1h
  - Drift peak |Δ| ≤ 40 ms, nessun re-snap udibile/visibile
  - Zero audio underrun su switch traccia audio durante playback
- ☐ HEVC 10-bit HW-decoded a 1080p senza tearing
- ☐ AV1 1080p HW-decoded senza tearing
- ☐ HDR10 tone-mapping a sRGB verificato visivamente su pannello SDR
- ☐ Refresh rate matching: contenuto 23.976p su display 60Hz non mostra judder
- ☐ Sottotitoli ASS animati (es. anime karaoke) renderizzati fluidi
- ☐ Audio AC3 5.1 pass-through verificato
- ☐ Soak test 4K notturno verde su tutti e 3 gli OS (vedi §4.8.5)
- ☐ Tutte le scorciatoie tastiera funzionano identicamente
- ☐ Cast a Chromecast 3rd gen completa correttamente play/pause/seek/volume
- ☐ Discovery SSDP trova ≥ 80% dei device trovati da Electron baseline
- ☐ Test suite `npm run check` verde (incluso `vitest`)
- ☐ Test Go `go test ./... -race` verde
- ☐ `gosec`, `govulncheck`, `staticcheck` zero warning HIGH
- ☐ Documentazione aggiornata (AGENTS.md, copilot-instructions, README,
  INSTALL, SIGNING-WINDOWS, SIGNING-MACOS)
- ☐ Smoke test su 6 distro Linux + Win10/Win11 + macOS 13/14 via VM/runner
- ☐ Almeno 2 settimane di beta pubblica senza regressioni P0 sui 3 OS

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
- ☐ `main.js` (685 righe — entry Electron Main process)
- ☐ `preload.js` (~80 righe — bridge `contextBridge.exposeInMainWorld`)
- ☐ `vite.main.config.js` (config Vite per il main process Electron, se presente)
- ☐ `scripts/patch-ffmpeg.js` + chiamata `postinstall` in `package.json`
- ☐ `scripts/install-hevc-codecs.sh` (specifico HEVC Electron, mantenere
  solo se serve anche per libmpv → verificare; in caso, spostarlo in
  `docs/INSTALL.md`)

### 14.2 File da eliminare (frontend)
- ☐ `frontend/services/advertisingService.js` (servizio Electron Main legacy)
- ☐ `frontend/hooks/useWebPlayerEngine.ts` (player Video.js)
- ☐ Verificare ed eventualmente eliminare snapshot/mock Electron in
  `frontend/tests/` (`*electron*`, mock `window.electronAPI`)

### 14.3 Semplificazioni TS
- ☐ `frontend/services/hostBridge.ts` → `export const host = wailsBridge;`
- ☐ `frontend/services/platformService.ts` → rimuovere `isElectron`,
  `isDesktop` semplificato a `isWails`, `Platform` type ridotto
- ☐ `frontend/components/VideoPlayerNew.tsx` → un solo branch (`useNativeMpvEngine`)
- ☐ `frontend/App.tsx` → rimuovere capability check `if (host)` ridondanti
  (il bridge è sempre presente su desktop)

### 14.4 Dipendenze npm da rimuovere (`package.json`)

**`dependencies`:**
- ☐ `bonjour`
- ☐ `castv2-client`
- ☐ `node-ssdp`
- ☐ `ws`
- ☐ `video.js`
- ☐ `hls.js`
- ☐ `mpegts.js`
- ☐ `@videojs/http-streaming`
- ☐ `jmuxer` (se presente)

**`devDependencies`:**
- ☐ `electron`
- ☐ `electron-builder`
- ☐ `@types/video.js`
- ☐ `@types/ws` (se presente)

**Sezioni intere:**
- ☐ `"main": "main.js"` (top-level field)
- ☐ `"build": { ... }` (electron-builder section)
- ☐ `"scripts.postinstall"` → rimuovere chiamata `patch-ffmpeg.js`
- ☐ `"scripts.dev"`: da `electron .` → alias di `npm run wails:dev`
- ☐ `"scripts.dist:linux*"`: rinominati o rimossi (la nuova pipeline
  Wails-only è gestita da `task package:linux` + workflow CI)

### 14.5 CI & infrastruttura
- ☐ `.github/workflows/linux-release.yml`: riscrittura completa per
  build Wails-only (Fase 8); rimozione job Electron
- ☐ Rimozione cache: `~/.cache/electron`, `~/.cache/electron-builder`
- ☐ Rimozione Docker image step `electronuserland/builder`
- ☐ Rimozione `scripts/build-linux.sh` step Electron (riscritto Fase 8)
- ☐ `scripts/check-deps.mjs`: aggiornare matrice deps attese (no più
  `electron`, `electron-builder`, `castv2-client`, ecc.)
- ☐ `scripts/check-wails-v3.mjs`: già attiva, verificare che blocchi anche
  ri-introduzioni di `import 'electron'` o `require('electron')`

### 14.6 Documentazione
- ☐ `AGENTS.md`:
  - Sezione "Tech Stack → Desktop Runtime": Electron → **Wails v3**
  - Rimuovere "Gotcha #1 HEVC Codec / patch-ffmpeg"
  - Rimuovere "Gotcha #5 Electron Build"
  - Rimuovere riferimenti `advertisingService.js` Electron Main
  - Aggiornare "Comandi Utili" sezione `npm run dev` (alias `wails:dev`)
- ☐ `.github/copilot-instructions.md`: stessa pulizia di AGENTS
- ☐ `README.md`: aggiornare "Tech Stack" + "Prerequisites" (Go 1.23+,
  libmpv, webkitgtk al posto di Node-only)
- ☐ `docs/INSTALL.md`: rimuovere sezione Electron, aggiungere libmpv,
  WebKitGTK 6.0/4.1, WebView2, WKWebView macOS 13+
- ☐ `docs/IMPROVEMENT_PLAN.md`: MED-1/MED-2 restano solo per parte
  Android (Capacitor + Media3 vendored)
- ☐ `docs/SIGNING.md`: invariato (procedure GPG riusate da Wails)
- ☐ Nuovo `docs/CHANGELOG-2.0.md` con sezione "Breaking changes →
  Electron rimosso" + advisory upgrade path
- ☐ Bump `.version` → `2.0.0-rc.1` + `npm run version:sync`

### 14.7 Verifica post-rimozione
- ☐ `git grep -i electron` ritorna **0 risultati** (eccetto changelog/
  docs storici esplicitamente labellati "legacy")
- ☐ `git grep "electronAPI"` ritorna **0 risultati**
- ☐ `npm install` non installa più Electron (verifica `node_modules`)
- ☐ `npm run check` verde (incluso `check:wails`, `check:media3`,
  `check:deps`)
- ☐ `vitest run` 100% verde
- ☐ `go test ./... -race` verde
- ☐ `wails3 dev` apre la finestra, frontend visualizza catalogo,
  discovery/cast/remote operativi (audio + control plane via libmpv
  `-tags mpv`, video rendering completo dopo Fase 6.1)
- ☐ `wails3 build -clean` produce binario funzionante (≤ 40 MB stripped)
- ☐ Tag annotato `electron-final` applicato al commit precedente al PR

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

