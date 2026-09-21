# 🤖 StreamAI IPTV - Agent Instructions

Questo file serve come guida e contesto per gli agenti AI che collaborano allo sviluppo di questo progetto. Contiene l'architettura, le convenzioni e le regole critiche da seguire.

## 📋 Panoramica Progetto
**StreamAI IPTV** è un client IPTV avanzato che integra l'Intelligenza Artificiale (Google Gemini) per offrire raccomandazioni contestuali. È un'applicazione desktop (Linux, Windows, macOS) e mobile (Android).

## 🛠 Tech Stack
- **Framework:** React 19, TypeScript, Vite
- **Desktop Runtime:** **Wails v3 (Go)**. Il runtime desktop è esclusivamente basato su Go con un frontend webview nativo. **Electron è stato completamente rimosso dal progetto.**
- **Mobile Runtime:** Capacitor 7 (Android)
- **Styling:** Tailwind CSS
- **Video Player:** 
  - *Desktop:* **libmpv** (via `useNativeMpvEngine.ts` con rendering WebGL2). Video.js e altri player web sono stati rimossi.
  - *Android:* Capacitor Video Player (player nativo basato su **AndroidX Media3 1.10.1** — `androidx.media3:media3-exoplayer:1.10.1`, pin 2026-05-15; plugin vendorato in `android/plugins/capacitor-video-player/` — vedi MED-1 nei *Punti Critici* #3-#4)
- **AI:** Google Gemini API (@google/genai)
- **Networking (Backend Go):** 
  - *Discovery:* Scansione attiva subnet /24 (HTTP, WebSocket).
  - *Advertising:* mDNS (Bonjour), SSDP, DIAL.
- **Icons:** Lucide React

## 📂 Struttura Directory Chiave

Layout post-migrazione a Wails v3:

```
StreamAI-IPTV/
├── frontend/                 # ★ TUTTO il codice React/TS
│   ├── index.html            # entry HTML (vite root)
│   ├── index.tsx / index.css
│   ├── App.tsx / types.ts / metadata.json / vite-env.d.ts
│   ├── tailwind.config.js / postcss.config.js
│   ├── components/  services/  hooks/  contexts/  tests/  public/
│   ├── dist/                 # output `vite build` (consumato da go:embed)
│   └── bindings/             # generati da `wails3 generate bindings` (gitignored)
├── cmd/streamai/             # ★ entry point Wails v3 (Go)
│   └── main.go
├── internal/                 # ★ tutti i Wails Service Go
│   ├── pkg/wailsevents/
│   └── services/{discovery,advertising,cast,remote,netstatus,proxy,player}/
├── assets.go                 # //go:embed all:frontend/dist
├── go.mod / go.sum / .golangci.yml / Taskfile.yml
├── android/                  # Capacitor 7 (Android target, fuori scope Wails)
├── package.json              # toolchain condiviso (Vite/Vitest/Capacitor)
├── scripts/  build/  docs/  release/
└── .version  README.md  AGENTS.md
```

- `frontend/` — sorgenti UI:
  - `components/`: Componenti UI.
    - `VideoPlayerNew.tsx`: Player unificato. Gestisce MPV (Desktop) e bridge verso player nativo Android.
    - `ChannelList.tsx`: Lista canali virtualizzata (react-window).
    - `AIRecommender.tsx`: Interfaccia utente per l'assistente AI.
    - `CastDevicePicker.tsx`: UI per la selezione dei dispositivi di casting.
    - `OnboardingWizard.tsx`: Wizard di configurazione profilo.
    - `player/StreamDiagnostics.tsx`: Pannello diagnostica stream.
  - `services/`: Logica di business (Singleton pattern).
    - `platformService.ts`: Astrazione per gestire differenze tra Wails, Web e Capacitor.
    - `geminiService.ts`: Logica di interazione con Google Gemini.
    - `xtream.ts`: Client API per server IPTV Xtream Codes.
    - `hostBridge.ts`: Esporta i binding del backend Go per l'uso nel frontend.
    - `proxyFetch.ts`: Helper per effettuare richieste HTTP tramite il proxy Go, evitando problemi di CORS/mixed-content nel webview.
    - `profileService.ts`: CRUD profili.
    - `parser.ts` / worker pipeline: parsing M3U asincrono.
- `cmd/streamai/main.go` + `internal/` — backend Wails v3 in Go.
- `android/` — Progetto nativo Android (Gradle).
- `scripts/` — Script di automazione (es. sync versione, guard `check-wails-v3.mjs` / `check-media3-migration.mjs`).

## 💎 Caratteristiche Essenziali (Non-Negotiable)
Queste funzionalità definiscono l'identità di StreamAI e devono essere preservate in ogni iterazione:

### 1. Picture-in-Picture (PiP)
- **Requisito:** L'utente deve poter guardare uno stream mentre naviga.
- **Implementazione:**
  - *Desktop:* **seconda finestra Wails** gestita da `internal/services/pip` (always-on-top, frameless), che carica lo stesso bundle con `?pip=1` e scarica i frame da `/player/frame`. **Non** usa `document.pictureInPictureElement`: il video è un `<canvas>`, non un `<video>`, e Document PiP non esiste su WebKitGTK/WKWebView. Design completo in `docs/pip-design.md`.
  - *Android:* Supporto nativo tramite `capacitor-video-player`.
  - *Controlli nella finestra PiP:* timeline (solo per contenuti cercabili: non live, con durata nota e server che supporta il range), salto ±10s, play/pausa, mute con volume, tutto schermo, chiusura. Tracce, sottotitoli, EPG e cast restano nella finestra principale. Cambiando canale nella finestra principale il PiP viene aggiornato (`pip.Service.Update`: titolo e tipo di canale, **senza** rubare il focus) — altrimenti mostrerebbe il canale di apertura e disegnerebbe la timeline per il tipo sbagliato.
- **Shortcut:** Tasto `P` per aprire/chiudere il PiP (Play/Pausa resta su `Spazio` e `Invio`).

### 2. Casting & Device Discovery
- **Requisito:** Trasmissione fluida verso Chromecast e dispositivi DLNA/UPnP.
- **Implementazione:**
  - *Discovery & Advertising:* Gestiti interamente dal backend Go (`internal/services/discovery` e `advertising`).

### 3. Scorciatoie da Tastiera & Remote Control
- **Requisito:** L'app deve essere controllabile al 100% senza mouse/touch.
- **Mappatura Standard:** `Spazio`, `Invio` (Play/Pausa), `P` (Picture-in-Picture), Frecce (Seek/Volume), `M` (Mute), `F` (Fullscreen), `C` (Cast), `L` (Lista), `S` (Sottotitoli), `T` (Timer), `G` (Mini-EPG), `Esc` (Indietro).
  - Nella finestra PiP valgono `Spazio`/`Invio` (Play/Pausa), `M` (mute), `F` (tutto schermo), `←`/`→` (salto ±10s, solo contenuti cercabili) ed `Esc`, che esce dal tutto schermo se attivo e altrimenti chiude il PiP. Gli altri controlli restano nella finestra principale.

### 4. Interfaccia Unificata (Uniform UI)
- **Filosofia:** "Write Once, Run Everywhere". L'aspetto visivo deve essere coerente su Linux, Windows, macOS e Android.
- **Regole:** Usa Tailwind CSS, OSD per ogni azione, timeline interattiva, classe `tv-focus` per navigazione.

## 📏 Convenzioni di Codice (Coding Standards)

### 1. TypeScript & React
- **Strict Typing:** Usa sempre interfacce definite in `types.ts`. Evita `any`.
- **Performance:** Usa `React.memo`, `useCallback`, e `react-window` per liste lunghe.
- **Hooks:** Preferisci Custom Hooks per logica riutilizzabile.

### 2. Gestione Piattaforma (Cross-Platform)
- **Mai** chiamare API specifiche (es. `CapacitorPlugins`) direttamente nei componenti UI.
- Usa sempre `platformService` per verificare l'ambiente (`isWails`, `isDesktop`, `isNative`, `isWeb`).
- **Bridge Host (Wails):** Per invocare le API del backend Go, importa `host` da `services/hostBridge.ts`. Questo oggetto espone direttamente i binding generati da Wails.
  ```ts
  import { host } from './services/hostBridge';
  
  // Esempio: host.discovery.DiscoverDevices() è una chiamata diretta al metodo Go.
  const devices = await host.discovery.DiscoverDevices();
  ```
- **Android:** Gestisci sempre il tasto fisico "Back" in `App.tsx` usando `App.addListener('backButton', ...)`.

### 3. Styling (Tailwind + Design System v1)
- Tema scuro di default (`#141414`), testo `gray-100/300`.
- Usa classi `tv-focus` (scale-105 + ring) e `tv-focus-dense` (solo ring).
- Responsive: Mobile-first (`md:`, `lg:`).
- **Design System v1 (UI-1):** Seguire le regole obbligatorie per colori, bordi, superfici, stati e icone definite in `index.css` e `tailwind.config.js`. Usare i componenti da `components/shared`.

### 4. Integrazione AI
- Le richieste a Gemini devono includere contesto e usare caching.
- Le risposte devono essere in JSON strutturato.

## ⚠️ Punti Critici e "Gotchas"
1.  **Sincronizzazione Backend-Frontend (Binding):** Dopo aver aggiunto o modificato un servizio Go in `internal/services/` e averlo registrato in `cmd/streamai/main.go`, è **obbligatorio** rigenerare i binding TypeScript. In caso contrario, il frontend non vedrà il nuovo servizio, causando errori `TypeError: undefined is not an object` a runtime.
    - **Comando da eseguire:** `npm run wails:bindings` (cioè `wails3 generate bindings -ts -d frontend/bindings ./...`)
    - **Sintomo:** L'app compila ma una chiamata a un servizio (es. `host.nuovoservizio.Metodo()`) fallisce con un `TypeError`.
    - ⚠️ **Non usare la forma nuda** `wails3 generate bindings`: senza `-ts -d frontend/bindings ./...` il comportamento dipende dal binario trovato nel PATH e su alcune build **svuota** la cartella (verificato: 35 file → 1). Con i binding svuotati la build Vite fallisce oppure — peggio — produce un bundle in cui `host.<servizio>` è `undefined`. Anche `scripts/build-wails.sh` usa ora la forma esplicita.
2.  **Componente `PerformanceProfiler.tsx`:** Questo componente di sviluppo ha un problema di dipendenza con `react-window` che può bloccare la build di Vite. Se la build fallisce con un errore relativo a `FixedSizeList`, disabilitare temporaneamente il componente in `App.tsx` e `PerformanceProfiler.tsx` per sbloccare lo sviluppo.
3.  **Player Android:** Su Android, usare sempre il player nativo (`capacitor-video-player` basato su **AndroidX Media3 1.10.1**) tramite `nativeVideoPlayer.ts` quando `platformService.isNative` è true.
4.  **Plugin Android vendorato (MED-1):** Il plugin `capacitor-video-player` è vendorato in `android/plugins/capacitor-video-player/`. Le patch e gli aggiornamenti di Media3 vanno fatti **lì**, non sostituendo il plugin con quello a monte. Il pin `media3Version` in `android/variables.gradle` (1.10.1 dal 2026-05-15) si aggiorna **solo a patch della stessa minor**: una minor nuova cambia API sotto il plugin vendorato, e va prima ri-testata lì.
5.  **Mixed Content:** L'app deve poter riprodurre stream HTTP.
    - Su **Wails**, questo è gestito dal **proxy HTTP locale in Go** (`internal/services/proxy/`) che agisce come middleware dell'asset server. Il frontend usa l'helper `proxyFetch` per tutte le richieste a risorse non sicure.
    - Su **Android**, è gestito da `usesCleartextTraffic="true"` in `AndroidManifest.xml`.
6.  **Ordine gruppi Live:** Non riordinare alfabeticamente le categorie `live` in `xtream.ts → processContent()`. L'ordinamento alfabetico va applicato solo a `movie`/`series`.
7.  **AI hint dismiss:** Preservare la doppia logica di stato per la chiusura del banner AI (`aiHintSessionDismissed` e `ProfilePreferences.hideAiUnavailableHint`).
8.  **Profilo M3U:** Il parsing di playlist M3U via `parseM3UAsync` (con offload a Web Worker per file >256 kB) è uno step obbligatorio all'attivazione del profilo.
9.  **Versione applicazione:** La fonte di verità è `/.version`. Usa `npm run version:sync` per propagarla.
10. **Rilevamento runtime Wails:** La presenza di `window._wails.environment` è il marcatore affidabile che l'app sta girando in un contesto Wails nativo, non la semplice esistenza di `window._wails`.
11. **Proxy IPTV Middleware:** Il proxy Go non è un server TCP separato, ma un middleware dell'AssetServer di Wails. Il frontend costruisce URL relativi (`/iptv-proxy?u=...`) che vengono intercettati dal backend. Questo è fondamentale per evitare problemi di CORS e mixed-content nei webview.
    - **Cache immagini su disco:** il proxy memorizza le risposte `image/*` in `os.UserCacheDir()/streamai/images` (`internal/services/proxy/imagecache.go`). La chiave è l'**URL upstream**, quindi la cache è **condivisa fra profili e sessioni**: due profili che chiedono la stessa copertina la scaricano una volta sola, anche a giorni di distanza, e sopravvive alla cancellazione dei dati del webview (dove sta la cache immagini del frontend, che resta il primo livello). TTL 30 giorni, tetto 512 MiB con sfoltimento LRU, voci oltre 8 MiB non memorizzate, e una **manutenzione periodica** (`runJanitor`, ogni 30 minuti) che rimuove le voci scadute e riapplica il tetto anche senza nuove scritture: senza, una sessione lunga non sfoltirebbe mai nulla. L'accesso aggiorna la data del file (per l'LRU) solo se è più vecchia di 5 minuti, per non fare una scrittura su disco a ogni richiesta.
    - **Ogni immagine passa di lì:** le copertine del catalogo via `CachedImage` → `DownloadManager` → `proxyFetch`; tutte le altre (`<img src=...>` di locandine, sfondi, loghi EPG, coda) via `proxyImageURL()` di `services/proxyFetch.ts`. **Un `<img>` nuovo va instradato con quell'helper**: solo gli URL http/https vengono riscritti, perché il proxy risponde 400 su qualunque altro schema (`data:`, `blob:`, percorsi relativi).
    - **Cosa non entra in cache:** stream video (sarebbe una copia illimitata su disco) e risposte dell'API Xtream (portano dati dell'account). Il filtro è sul `Content-Type` della risposta, non sull'URL: un indirizzo può sembrare un'immagine e non esserlo.
    - **Se un'immagine sembra non aggiornarsi** è il TTL, non un bug: l'header `X-StreamAI-Cache: hit|stored|skipped` dice da dove arriva la risposta. Il client può forzare un refresh con `Cache-Control: no-cache` (salta la lettura ma riempie la cache) o `no-store` (non la tocca affatto). Le **HEAD** sono una sonda di presenza: se l'immagine è in cache rispondono `200` con gli header e senza corpo, se non c'è rispondono `204` + `X-StreamAI-Cache: miss` **senza andare upstream** — servono a chiedere "ce l'hai?" senza spendere la banda che si vuole risparmiare.
    - **Durante la riproduzione di un canale live** i download sono in pausa (`DownloadManager.pause()`), perché contendere banda allo stream causa rebuffering. Le immagini che risultano **già in cache** però vengono mostrate lo stesso (`requestCachedImage`: cache del webview, poi sonda HEAD al proxy): non costano banda, e lasciare il posto vuoto significherebbe rinunciare a qualcosa di già pagato.
12. **Finestre frameless su Linux:** `WebviewWindowOptions.Frameless` **non basta** su Wayland. Wails lo implementa con `gtk_window_set_decorated(FALSE)`: GTK3 ubbidisce, ma il compositor — non trovando una superficie di decorazione lato client — disegna le proprie, quindi la finestra resta decorata. Per una finestra davvero pulita serve il workaround in `internal/pkg/gtkframe` (titlebar vuota lato client), chiamato dopo la creazione: è idempotente e no-op fuori da GTK3. Verifica: `go test -tags 'gtk3 gtkframetest' ./internal/pkg/gtkframe/`. Dettagli in `docs/pip-design.md` §3-bis.
    - **Trascinare:** solo le aree con `--wails-draggable: drag` (custom property: si eredita, quindi marcare la radice rende trascinabile tutto il riquadro; `no-drag` protegge pulsanti e maniglie).
    - **Ridimensionare:** il runtime JS gestisce i bordi **solo su Windows** (`drag.js`: `!IsWindows()` esce subito). Su Linux le maniglie le disegna la vista e il resize parte da `pip.Service.StartResize` → `Window.HandleMessage("wails:resize:<edge>")`, che riusa le coordinate già catturate dal gestore nativo.
    - **"Sempre sopra" non esiste su Wayland:** nessun protocollo consente a un client di chiedere di restare sopra le altre finestre, quindi `AlwaysOnTop` è un no-op lì (funziona su X11/Windows/macOS). Workaround: regola di finestra del compositor (`scripts/kwin-pip-above.sh`), oppure `GDK_BACKEND=x11`. Per questo il titolo **di sistema** del PiP è **costante** e senza nome del canale (`osTitle`): la regola cerca quella stringa esatta, e un titolo variabile la obbligherebbe a un confronto per sottostringa — cioè a indovinare un valore numerico di `kwinrulesrc` che, se sbagliato, rende la regola inerte **in silenzio**. Guard: `TestOSTitle_MatchesWindowRuleScript`. Dettagli in `docs/pip-design.md` §4-quater.
13. **Contesto WebGL del canvas:** **non** chiamare `WEBGL_lose_context.loseContext()` nel cleanup di `useMpvCanvasRenderer`. Quel cleanup gira a ogni ri-esecuzione dell'effect (non solo allo smontaggio: `enabled` e `targetFPS` sono fra le dipendenze) e per specifica un canvas conserva il proprio contesto: dopo `loseContext()` il contesto resta morto e tutte le chiamate GL vengono ignorate in silenzio. È successo davvero: aprendo il PiP `enabled` andava a false, il contesto veniva perso, e alla chiusura del PiP il video non riprendeva più nella finestra principale. Le risorse GPU si liberano con i `delete*` espliciti (già presenti) e al massimo alla distruzione definitiva del canvas. Guard: `frontend/tests/hooks/useMpvCanvasRenderer.test.tsx`.
14. **Transport di render del player:** il frame arriva al canvas via **render software** di libmpv (`MPV_RENDER_API_TYPE_SW`, RGBA) + middleware HTTP `/player/frame` — *non* via zero-copy/DMA-BUF. Il costo è ~4 ms per frame (3.3 ms @540p, 4.5 ms @1080p, sorgente 1080p) e dipende dalla conversione colori in **ingresso**, non dalla risoluzione di uscita: **ottimizzare i filtri di scaling non serve** (provato, esito nullo — `docs/stage-b-assessment.md` §4-bis). Il loop di rendering è **su richiesta**: `X-Frame-New: 0` significa "nessun frame nuovo, salta upload e trasferimento". La politica sta in `internal/services/player/gating.go` (`shouldReuseFrame`) ed è testata: **non** attivare il riuso fuori da quelle condizioni, altrimenti si serve un frame vecchio (video bloccato). E **non** togliere `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME = 0` dal render SW: senza, la call blocca ~26 ms per frame in attesa del tempo di presentazione, parkando goroutine e connessioni HTTP e facendo credere al loop adattivo del frontend di essere sotto carico (31 ms → 4 ms misurati). Guard: `render_cost_test.go`.

15. **Catalogo persistente su disco (avvio cache-first):** la pipeline Xtream costa 30-50 s (sei fetch in parallelo, ~10 MB il solo blocco VOD, su un pannello che sotto carico tronca le risposte lente). Il backend salva quindi l'ultimo catalogo **completo** in `os.UserCacheDir()/streamai/catalog/<hash(server|utente)>.json` (`internal/services/playlist/cache.go`) e il frontend lo carica **prima** della rete: l'app si apre con i contenuti già a schermo e l'aggiornamento arriva dopo, in background.
    - **Chi decide quando aggiornare:** le impostazioni del profilo (`contentAutoRefreshEnabled` + `contentAutoRefreshIntervalMinutes`). Il timestamp della copia diventa `contentLastRefreshAt`, così l'effetto di auto-refresh la considera un aggiornamento appena fatto invece di ripartire subito. Con l'auto-refresh **disattivato** (default attuale) un avvio non aggiorna nulla: resta il refresh manuale dalla UI.
    - **Non salvare cataloghi degradati:** se un blocco è fallito (`FailedBlocks` non vuoto) il file su disco non viene toccato — altrimenti al prossimo avvio si vedrebbe il catalogo mutilato e senza il segnale del fallimento.
    - **`catalogCacheSchemaVersion` va incrementata** quando cambia la forma di `FullPlaylist`: un file vecchio si decodifica *senza errore* ma con campi a zero (canali senza nome), cioè un catalogo rotto che sembra valido.
    - Il file elenca i contenuti dell'utente: directory 0700, file 0600, scrittura atomica (tmp + rename), e `LoadCachedCatalog` non fallisce mai per un file assente o corrotto (ritorna `null`: si va di rete).
    - Guard: `go test ./internal/services/playlist/` (round-trip, catalogo degradato non salvato, schema diverso, file corrotto, isolamento per profilo).

## 🚀 Comandi Utili
- `npm run check`: **Il gate.** Guardie di coerenza → binding Wails → typecheck → test → build frontend → `go vet`/`go build`. È ciò che esegue la CI: se passa in locale, passa in CI.
  - L'ordine non è arbitrario: i binding servono a `vite build` (importati da `wailsBridge.ts`) e `frontend/dist` serve a `go build` (è embeddato da `assets.go`), quindi la build del frontend deve precedere `check:go`. Invertirli fa fallire il comando su un clone pulito con `pattern all:frontend/dist: no matching files found`.
  - Richiede il CLI `wails3` nel PATH (come `npm run dev`).
- `npm run dev`: Avvia l'ambiente di sviluppo Wails (Go + React con hot-reload).
- `npm run wails:build`: Compila l'applicazione per produzione.
- `npm run wails:bindings`: Rigenera i binding TypeScript dal backend Go.
- `npm run android:run`: Build, Sync e Run su dispositivo Android.
- `npm run dist:linux`: Builda i pacchetti per **tutte** le distro supportate (`.deb`, `.rpm`, `.pkg.tar.zst`, archivio portatile) con le dipendenze corrette per ciascuna. Tabella in `build/depends/distros.json`; `npm run dist:linux:host` per la sola distro corrente, `--verify` per ispezionare i metadata.
- `npm run version:sync`: Sincronizza il numero di versione da `/.version` agli altri file di progetto (`package.json`, `android/app/build.gradle`, `build/config.yml`).

## 📦 Pipeline Linux Release (CI)
Il workflow [`.github/workflows/linux-release.yml`](.github/workflows/linux-release.yml) si attiva su tag `v*` e `workflow_dispatch`. Esegue la build dei pacchetti per 6 distro, li firma con GPG (per formato: embedded per deb/rpm, `.sig` binario per pacman), verifica le firme, genera l'attestazione SLSA e li pubblica su GitHub Releases e sul repository statico di GitHub Pages.

Il gate su push/PR è [`.github/workflows/ci.yml`](.github/workflows/ci.yml): esegue `npm run check` più i test Go con i tag reali e con `-race`.

⚠️ **La build gira su `ubuntu-22.04`, non `ubuntu-latest`.** Il binario è lo stesso per tutte le distro, quindi la glibc del runner è il requisito minimo di *tutte*: compilare su 24.04 (glibc 2.39) renderebbe i pacchetti inutilizzabili su Debian 12 (2.36) e Ubuntu 22.04 (2.35). Non cambiare il pin senza aver verificato `objdump -T build/bin/streamai | grep -o 'GLIBC_[0-9.]*' | sort -Vu | tail -1`.