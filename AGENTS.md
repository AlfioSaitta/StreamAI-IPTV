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
  - *Android:* Capacitor Video Player (player nativo basato su **AndroidX Media3 1.10.1** — `androidx.media3:media3-exoplayer:1.10.1`, pin 2026-05-15; plugin vendorato in `android/plugins/capacitor-video-player/`, vedi MED-1 in `docs/IMPROVEMENT_PLAN.md` §4-bis)
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
  - *Desktop:* API `document.pictureInPictureElement` (resa possibile dal rendering in `<canvas>`).
  - *Android:* Supporto nativo tramite `capacitor-video-player`.
- **Shortcut:** Tasto `P`.

### 2. Casting & Device Discovery
- **Requisito:** Trasmissione fluida verso Chromecast e dispositivi DLNA/UPnP.
- **Implementazione:**
  - *Discovery & Advertising:* Gestiti interamente dal backend Go (`internal/services/discovery` e `advertising`).

### 3. Scorciatoie da Tastiera & Remote Control
- **Requisito:** L'app deve essere controllabile al 100% senza mouse/touch.
- **Mappatura Standard:** `Spazio`, `Invio`, `P` (Play/Pausa), Frecce (Seek/Volume), `M` (Mute), `F` (Fullscreen), `C` (Cast), `L` (Lista), `S` (Sottotitoli), `T` (Timer), `G` (Mini-EPG), `Esc` (Indietro).

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
    - **Comando da eseguire:** `wails generate bindings` o `npm run wails:bindings`
    - **Sintomo:** L'app compila ma una chiamata a un servizio (es. `host.nuovoservizio.Metodo()`) fallisce con un `TypeError`.
2.  **Componente `PerformanceProfiler.tsx`:** Questo componente di sviluppo ha un problema di dipendenza con `react-window` che può bloccare la build di Vite. Se la build fallisce con un errore relativo a `FixedSizeList`, disabilitare temporaneamente il componente in `App.tsx` e `PerformanceProfiler.tsx` per sbloccare lo sviluppo.
3.  **Player Android:** Su Android, usare sempre il player nativo (`capacitor-video-player` basato su **AndroidX Media3 1.10.1**) tramite `nativeVideoPlayer.ts` quando `platformService.isNative` è true.
4.  **Plugin Android vendorato (MED-1):** Il plugin `capacitor-video-player` è vendorato in `android/plugins/capacitor-video-player/`. Le patch e gli aggiornamenti di Media3 vanno fatti lì.
5.  **Mixed Content:** L'app deve poter riprodurre stream HTTP.
    - Su **Wails**, questo è gestito dal **proxy HTTP locale in Go** (`internal/services/proxy/`) che agisce come middleware dell'asset server. Il frontend usa l'helper `proxyFetch` per tutte le richieste a risorse non sicure.
    - Su **Android**, è gestito da `usesCleartextTraffic="true"` in `AndroidManifest.xml`.
6.  **Ordine gruppi Live:** Non riordinare alfabeticamente le categorie `live` in `xtream.ts → processContent()`. L'ordinamento alfabetico va applicato solo a `movie`/`series`.
7.  **AI hint dismiss:** Preservare la doppia logica di stato per la chiusura del banner AI (`aiHintSessionDismissed` e `ProfilePreferences.hideAiUnavailableHint`).
8.  **Profilo M3U:** Il parsing di playlist M3U via `parseM3UAsync` (con offload a Web Worker per file >256 kB) è uno step obbligatorio all'attivazione del profilo.
9.  **Versione applicazione:** La fonte di verità è `/.version`. Usa `npm run version:sync` per propagarla.
10. **Rilevamento runtime Wails:** La presenza di `window._wails.environment` è il marcatore affidabile che l'app sta girando in un contesto Wails nativo, non la semplice esistenza di `window._wails`.
11. **Proxy IPTV Middleware:** Il proxy Go non è un server TCP separato, ma un middleware dell'AssetServer di Wails. Il frontend costruisce URL relativi (`/iptv-proxy?u=...`) che vengono intercettati dal backend. Questo è fondamentale per evitare problemi di CORS e mixed-content nei webview.

## 🚀 Comandi Utili
- `npm run dev`: Avvia l'ambiente di sviluppo Wails (Go + React con hot-reload).
- `npm run wails:build`: Compila l'applicazione per produzione.
- `npm run wails:bindings`: Rigenera i binding TypeScript dal backend Go.
- `npm run android:run`: Build, Sync e Run su dispositivo Android.
- `npm run dist:linux`: Builda i pacchetti Linux per la distro host.
- `npm run version:sync`: Sincronizza il numero di versione da `/.version` agli altri file di progetto.

## 📦 Pipeline Linux Release (CI)
Il workflow [`.github/workflows/linux-release.yml`](.github/workflows/linux-release.yml) si attiva su tag `v*` e `workflow_dispatch`. Esegue la build dei pacchetti per 6 distro, li firma con GPG, esegue verifiche e li pubblica su GitHub Releases e sul repository statico di GitHub Pages. Il processo è automatizzato e non richiede più interazione con `git push` per il deploy della Pages.