# 🚀 Piano di Migrazione: Electron → Go + Wails v3

> **Status:** Approvato per esecuzione — **revisione 4** (Wails v3 esclusivo)  
> **Owner:** Maintainer StreamAI-IPTV  
> **Target ramo:** `feat/wails-migration` (long-lived)  
> **Versione di partenza:** `1.x` Electron  
> **Versione di arrivo:** `2.0.0` Wails v3 — **Linux + Windows + macOS day-1**  
> **Ultima revisione:** 2026-05-18

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

---

## 0. Executive Summary

L'obiettivo è sostituire il runtime **Electron** (Chromium + Node.js,
~180–250 MB installato, ~120 MB ASAR) con **Wails v3** (binario Go statico +
webview di sistema: WebKitGTK 6.0 / WPE su Linux, WebView2 su Windows,
WKWebView su macOS), **senza riscrivere il front-end React/Tailwind** e
rilasciando **Linux + Windows + macOS contemporaneamente** in v2.0.0.

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
- Tempo di avvio cold-start (oggi: ~2.5–3.5 s)
- Tempo TTFF stream HLS (oggi: ~1.2–1.8 s)
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
export const host = platformService.isWails
  ? wailsAPI
  : (window as any).electronAPI;
```

→ tutti i `window.electronAPI` esistenti vengono sostituiti con `host`
(regex one-shot, ~20 occorrenze).


---

## 4. Player video integrato + Picture-in-Picture (architettura dettagliata)

Sezione critica: il punto di maggior costo ingegneristico della migrazione.
Implementiamo **un solo backend** (D), uguale su tutti gli OS.

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
(§5) resta per riscrittura header HTTP, ma **non fa transmuxing**: passa
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

### Fase 0 — Preparazione & baseline (≈3 gg)
- ☐ Catturare baseline KPI (vedi §1.3) su **Linux + Windows + macOS** e
  annotare in `docs/MIGRATION_KPI.md` (un foglio per OS)
- ☐ Creare branch `feat/wails-migration` da `main`
- ☐ Install Go 1.23+ in CI matrix (matrix-add accanto a Node)
- ☐ Install Wails v3 CLI:
  `go install github.com/wailsapp/wails/v3/cmd/wails3@latest` (versione
  pinnata in `Taskfile.yml` + `go.mod`)
- ☐ Setup CI runner matrix: `ubuntu-24.04`, `windows-2022`, `macos-14`
  (Apple Silicon) — verificare disponibilità minuti per workflow paralleli
- ☐ Verificare libmpv + webkitgtk-6.0 (o webkit2gtk-4.1 come fallback)
  disponibili sulle 6 distro Linux target — `wails3` su Linux usa
  preferibilmente WebKitGTK 6.0 dove disponibile
- ☐ Pin versioni mpv pre-built: `mpv-2.dll` (Windows shinchiro build) +
  `libmpv.2.dylib` (macOS universal, iina o Homebrew lipo)
- ☐ Setup keychain CI: Apple Developer ID cert + Authenticode EV cert
  (issue separato, blocking per fase 8/9)
- ☐ Aggiungere `scripts/check-wails-v3.mjs` lint guard che fa fail PR-check
  se compaiono import `wails/v2`, `wailsjs/go/`, `runtime.EventsEmit`,
  `runtime.EventsOn`, `wails.Run` nel codebase (post-Fase 1)

### Fase 1 — Scheletro Wails v3 (≈3 gg)
- ☐ `wails3 init -n streamai-iptv -t react-ts` in cartella `wails/` temporanea
- ☐ Mergiare struttura: portare `frontend/` Wails v3 alla root, riusando
  `App.tsx`, `components/`, `services/*.ts`. `vite.config.ts` aggiornato
  con alias `frontend/bindings/*` e dev-server config compatibile con
  `wails3 dev`.
- ☐ Creare `cmd/streamai/main.go` con:
  ```go
  app := application.New(application.Options{
    Name: "StreamAI", Description: "IPTV Player",
    Services: []application.Service{ /* …vedi §2 schema… */ },
    Assets:   application.AssetOptions{Handler: assets.Handler()},
  })
  // window principale, system tray, menu nativi
  app.Run()
  ```
- ☐ Creare struttura `internal/services/<name>/service.go` con `Service{}`
  struct + (opz.) `ServiceStartup(ctx, options) error` / `ServiceShutdown()
  error` per discovery, advertising, cast, remote, netstatus, proxy, player
- ☐ Configurare `Taskfile.yml` (target `dev`, `build`, `package:linux`,
  `package:windows`, `package:darwin`)
- ☐ Verificare build cold: `wails3 dev` mostra l'app React come oggi
- ☐ Aggiungere `go.mod` + `.golangci.yml` (linter, regola `forbidigo` per
  bloccare import `wails/v2` permanentemente)

### Fase 2 — Migrazione discovery & advertising (≈4 gg)
- ☐ Port `discoverSsdpDevices()` → `internal/services/discovery/ssdp.go` (`koron/go-ssdp`)
- ☐ Port `scanSubnet()` → `internal/services/discovery/subnet.go` (goroutine pool con
  semaforo, sostituisce concurrency manuale)
- ☐ Port `probeDeviceServices()` → `internal/services/discovery/probe.go` (`net.DialTimeout`)
- ☐ Port `services/advertisingService.js` → `internal/services/advertising/{mdns,ssdp}.go`
  (`grandcat/zeroconf` + `koron/go-ssdp` advertise mode)
- ☐ Definire `DiscoveryService` v3: metodi pubblici `DiscoverDevices`,
  `ScanIP`, `ProbeDeviceServices`, `GetLocalIPs` (auto-bindati)
- ☐ Emit eventi via `app.EmitEvent(&application.CustomEvent{Name:
  "device-found", Data: dev})` per streaming results
- ☐ Generare bindings: `wails3 generate bindings -ts -d frontend/bindings`
  → `frontend/bindings/streamai/services/discovery/DiscoveryService.ts`
- ☐ Unit tests Go: mock multicast con `net.PacketConn` fake (testify)

### Fase 3 — Migrazione Cast (Chromecast CastV2) (≈3 gg)
- ☐ Scegliere libreria (`vishen/go-chromecast` vs `barnybug/go-cast`) — POC
- ☐ Port `cast-connect/load/control/disconnect` in `internal/services/cast/`
- ☐ Status streaming → `app.EmitEvent("cast-status", …)` con tick 1s tramite
  `time.Ticker` in goroutine avviata da `ServiceStartup`
- ☐ Test end-to-end manuale: Chromecast 3rd gen + Google TV + AndroidTV box
- ☐ Documentare differenze `streamType: 'LIVE'` vs `'BUFFERED'` per VOD

### Fase 4 — Migrazione remote control & UDP status (≈2 gg)
- ☐ Port WebSocket server → `internal/services/remote/server.go`
  (`nhooyr.io/websocket`) avviato in `ServiceStartup`
- ☐ Port UDP multicast broadcast → `internal/services/netstatus/broadcast.go`
- ☐ Hot-reconnect su cambio interfaccia (`net.Interfaces` polling)
- ☐ Verificare interop con `useRemoteControl.ts` esistente (no cambi UI):
  i comandi remoti vengono ri-emessi al frontend via `app.EmitEvent(
  "remote-control-command", cmd)`

### Fase 5 — HTTP proxy IPTV & header rewrite (≈2 gg)
- ☐ Implementare `internal/services/proxy/server.go` su porta locale random
  (`127.0.0.1:0` con `net.Listen` random port) come `Service` standalone
- ☐ Pattern: `http://127.0.0.1:<p>/proxy?u=<base64url>&ua=<...>` → riscrive
  `User-Agent`, strippa `CSP`/`X-Frame-Options`, abilita CORS `*`
- ☐ Espone `(*ProxyService).BuildProxyURL(stream Stream) string`
- ☐ **Nessun transmux**: libmpv accetta direttamente HLS/DASH/MPEG-TS/MP4,
  il proxy serve solo per riscrivere header HTTP problematici dei provider IPTV
- ☐ In alternativa, considerare l'integrazione come **middleware
  dell'AssetServer v3** (`application.AssetServerOptions.Middleware`) per
  evitare il listener separato — decisione architetturale al momento
  dell'implementazione
- ☐ Sostituisce in `App.tsx` la dipendenza dai webRequest interceptor di
  Electron (Wails non li espone nativamente)

### Fase 6 — Player video integrato + PiP (≈9 gg) ⚠️ rischio alto, gating

Questa fase è il **gate critico** della migrazione. Si parte con tre spike
*tecnici di fattibilità* su tutti e 3 gli OS: se uno fallisce, si rivede
la roadmap prima di continuare con il porting delle altre feature.

#### 6.0 Spike obbligatori (preflight, 3 gg) — Linux + Windows + macOS
- ☐ **SPIKE-1: libmpv render-API → texture GL → canvas WebGL2**
  - PoC Go: aprire `mpv_render_context` MPV_RENDER_API_TYPE_OPENGL,
    renderizzare HEVC 1080p su FBO, `glReadPixels`, dump 100 frame su disco.
  - PoC TS: caricare frame raw RGBA in `<canvas>` via WebGL2 a 60 fps.
  - **KPI:** ≤ 8 ms/frame full pipeline su Intel UHD 620 / M1 / Ryzen 5500.
  - **Verifica su:** Linux (libmpv di sistema), Windows (mpv-2.dll bundled),
    macOS (libmpv.2.dylib bundled).
  - **Esito atteso:** ✅ go / ✋ rivedere transport.
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
    custom Wails binding `(*App) AcquireFrameBuffer() []byte`.
  - PoC Windows: `CreateFileMapping` + `MapViewOfFile` (no POSIX shm).
  - **KPI:** ≥ 1 GB/s sostenuto, ≤ 0.5 ms latenza per frame 1080p, su
    tutti e 3 gli OS.
  - **Esito atteso:** ✅ go / ✋ scendere a transport T3 (WebCodecs).

> **Gate:** se SPIKE-1 o SPIKE-2 falliscono su uno qualsiasi dei 3 OS,
> la migrazione **non procede a v2.0.0** per quella piattaforma.
> Re-pianificazione obbligatoria prima di proseguire.

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

### Fase 7 — Compat layer & cleanup TS (≈3 gg)
- ☐ Creare `services/wailsBridge.ts` (vedi §3.1)
- ☐ Estendere `platformService.ts` con `isWails`
- ☐ Sostituire 100% delle occorrenze `window.electronAPI` con `host` (grep+sed)
- ☐ Eliminare `preload.js`, `main.js`, dipendenze `electron*`, `castv2-client`,
  `node-ssdp`, `bonjour`, `ws` da `package.json` `dependencies`
- ☐ Rimuovere `useWebPlayerEngine.ts`, `video.js`, `hls.js`, `mpegts.js`,
  `@videojs/http-streaming`, `jmuxer` da `package.json` (backend D è l'unico
  player path; questi pacchetti restano solo su `1.x-legacy`)
- ☐ `scripts/patch-ffmpeg.js`: deprecare (rimuovere `postinstall`)
- ☐ Aggiornare `services/platformService.ts` test (`tests/`)

### Fase 8 — Packaging Linux (≈3 gg)
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

### Fase 9 — Packaging Windows (≈3 gg, day-1 v2.0.0)
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

### Fase 9-bis — Packaging macOS (≈4 gg, day-1 v2.0.0)
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

### Fase 10 — Testing & QA cross-platform (≈5 gg)
- ☐ Test funzionali su matrice completa:
  - **Linux:** 6 distro × 3 codec × 3 protocolli
  - **Windows:** Win10 21H2, Win11 23H2 × 3 codec × 3 protocolli
  - **macOS:** macOS 13 Ventura, macOS 14 Sonoma, macOS 15 (se disponibile) × 3 codec
  - 4 dispositivi cast (Chromecast, Android TV, Samsung Tizen, LG webOS)
  - PiP testato su tutte e 3 le piattaforme con primary + fallback path
- ☐ Stress test: 1000 canali M3U, 50 scan device, scrolling continuo,
  20 cambi canale rapidi (zapping)
- ☐ Confronto KPI con baseline §1.3 per ogni OS — target: −60% RAM,
  −70% installato (Linux), −50% installato (Win/macOS con mpv bundled)
- ☐ Regression: scorciatoie tastiera, OSD, timeline tooltip, sleep timer,
  remote control WS, casting
- ☐ Test sicurezza: `gosec`, `staticcheck`, `govulncheck`
- ☐ Verifica certificate chains valide (Authenticode + Apple notarization)
- ☐ Test installazione ed esecuzione su utenti reali (≥ 5 per OS)

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

**Totale stimato: ~47 gg-uomo** (≈ 9–10 settimane full-time, 4–5 mesi
part-time). Distribuzione: Fase 0–7 ~31 gg (Linux-first dev), Fase 8 ~3 gg
(packaging Linux), Fase 9 ~3 gg (Windows), Fase 9-bis ~4 gg (macOS),
Fase 10 ~5 gg (QA tri-platform), Fase 11 ~2 gg.

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

## 9. Strategia di rollout

1. **Branch long-lived** `feat/wails-migration` rebasato settimanalmente su `main`.
2. **Doppio binario in CI** per le prime 6 settimane: il workflow produce
   *sia* artefatti Electron `1.x` (Linux only) *sia* Wails `2.0.0-rc.x`
   (Linux + Windows + macOS). Canali distribuzione separati:
   - Linux: APT/RPM repo `stable` (Electron) vs `next` (Wails)
   - Windows: nessuno → solo `next` (Electron non era distribuito su Win)
   - macOS: nessuno → solo `next` (Electron non era distribuito su macOS)
3. **Beta opt-in pubblica** (2 settimane minimo) via canale `next`:
   - GitHub Pages per Linux (esistente)
   - GitHub Releases per Windows/macOS installers
4. **Cutover:** quando KPI §11 sono soddisfatti su tutti e 3 gli OS,
   `main` riceve il merge, tag `v2.0.0`. Il canale `stable` Linux passa a
   Wails. I canali Windows/macOS diventano `stable`.
5. **Drop Electron** dal repo: rimozione `main.js`, `preload.js`,
   `scripts/patch-ffmpeg.js`, dipendenze npm `electron*` → commit
   `chore: drop electron runtime`. `1.x-legacy` resta come tag git +
   release GitHub per 90 giorni.

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
| Keyboard shortcuts | ✅ Invariato | Tutto frontend |
| OSD/Timeline | ✅ Invariato | DOM HTML sopra canvas mpv |
| HEVC/AV1/HDR | ✅ Migliorato | libmpv HW accel universale su 3 OS (VAAPI/NVDEC/D3D11VA/VideoToolbox) |
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
- ☐ HEVC 10-bit HW-decoded senza tearing
- ☐ AV1 1080p HW-decoded senza tearing
- ☐ HDR10 tone-mapping a sRGB verificato visivamente su pannello SDR
- ☐ Sottotitoli ASS animati (es. anime karaoke) renderizzati fluidi
- ☐ Audio AC3 5.1 pass-through verificato
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
7. ✅ **Electron `1.x-legacy` mantenuto 90 giorni** dopo release v2.0.0.

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

