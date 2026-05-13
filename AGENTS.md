# 🤖 StreamAI IPTV - Agent Instructions

Questo file serve come guida e contesto per gli agenti AI che collaborano allo sviluppo di questo progetto. Contiene l'architettura, le convenzioni e le regole critiche da seguire.

## 📋 Panoramica Progetto
**StreamAI IPTV** è un client IPTV avanzato che integra l'Intelligenza Artificiale (Google Gemini) per offrire raccomandazioni contestuali. È un'applicazione ibrida cross-platform.

## 🛠 Tech Stack
- **Framework:** React 18, TypeScript, Vite
- **Desktop Runtime:** Electron (con supporto HEVC custom)
- **Mobile Runtime:** Capacitor 7 (Android)
- **Styling:** Tailwind CSS
- **Video Player:** 
  - *Web/Desktop:* Video.js (con OSD custom e Timeline interattiva)
  - *Android:* Capacitor Video Player (ExoPlayer nativo)
- **AI:** Google Gemini API (@google/genai)
- **Networking:** 
  - *Discovery:* Scansione attiva subnet /24 (HTTP, WebSocket)
  - *Advertising:* mDNS (Bonjour), SSDP, DIAL (via `advertisingService.js`)
- **Icons:** Lucide React

## 📂 Struttura Directory Chiave
- `/components`: Componenti UI.
  - `VideoPlayerNew.tsx`: Player unificato. Gestisce Video.js, OSD, Timeline, scorciatoie tastiera e bridge verso player nativo Android.
  - `ChannelList.tsx`: Lista canali virtualizzata (react-window) per alte prestazioni.
  - `AIRecommender.tsx`: Interfaccia utente per l'assistente AI.
  - `CastDevicePicker.tsx`: UI per la selezione dei dispositivi di casting.
- `/services`: Logica di business (Singleton pattern).
  - `platformService.ts`: Astrazione per gestire differenze tra Electron, Web e Capacitor.
  - `geminiService.ts`: Logica di interazione con Google Gemini.
  - `xtream.ts`: Client API per server IPTV Xtream Codes.
  - `deviceDiscovery.ts`: Logica di scansione rete per trovare dispositivi Cast/DLNA.
  - `advertisingService.js`: (Electron Main Process) Servizio per annunciare l'app via mDNS/SSDP. **Deve essere incluso nella build.**
- `/android`: Progetto nativo Android (Gradle).
- `/scripts`: Script di automazione (es. patching FFmpeg per Electron).

## 💎 Caratteristiche Essenziali (Non-Negotiable)
Queste funzionalità definiscono l'identità di StreamAI e devono essere preservate in ogni iterazione:

### 1. Picture-in-Picture (PiP)
- **Requisito:** L'utente deve poter guardare uno stream mentre naviga nella lista canali o usa altre app.
- **Implementazione:**
  - *Desktop:* API `document.pictureInPictureElement`.
  - *Android:* Supporto nativo tramite `capacitor-video-player`.
- **Shortcut:** Tasto `P`.

### 2. Casting & Device Discovery
- **Requisito:** Trasmissione fluida verso Chromecast e dispositivi DLNA/UPnP.
- **Implementazione:**
  - *Discovery:* Scansione completa della sottorete (/24) in `deviceDiscovery.ts`.
  - *Advertising:* L'app si annuncia come ricevitore AirPlay/DIAL tramite `advertisingService.js` (solo Electron).
- **Vincolo:** Il discovery dei dispositivi deve avvenire in background senza bloccare la UI.

### 3. Scorciatoie da Tastiera & Remote Control
- **Requisito:** L'app deve essere controllabile al 100% senza mouse/touch (Telecomando TV/Tastiera).
- **Mappatura Standard:**
  - `Spazio` / `Invio` / `P`: Play/Pausa
  - `Freccia Sinistra/Destra`: Avanza avanti/indietro (Seeking +/- 10s)
  - `Freccia Su/Giù`: Alza/Abbassa volume (+/- 10%)
  - `M`: Mute/Unmute
  - `F`: Fullscreen Toggle
  - `C`: Cast (apre menu dispositivi)
  - `L`: Lista canali (LIVE) o Lista episodi (SERIE TV)
  - `S`: Sottotitoli (toggle visibilità o apre menu caricamento file)
  - `T`: Menu sleep timer
  - `G`: Mini-EPG (solo Live)
  - `Esc`: Indietro/Chiudi menu

### 4. Interfaccia Unificata (Uniform UI)
- **Filosofia:** "Write Once, Run Everywhere". L'aspetto visivo deve essere coerente su Linux, Windows e Android.
- **Regole:**
  - Usa Tailwind CSS per il responsive design.
  - **OSD (On-Screen Display):** Feedback visivo obbligatorio per ogni azione utente (Volume, Seek, Play/Pausa).
  - **Timeline:** Deve mostrare tooltip al passaggio del mouse e anteprima della posizione (ghost bar).
  - Mantieni sempre la classe `tv-focus` per la navigazione spaziale.

## 📏 Convenzioni di Codice (Coding Standards)

### 1. TypeScript & React
- **Strict Typing:** Usa sempre interfacce definite in `types.ts`. Evita `any` se non strettamente necessario.
- **Performance:**
  - Usa `React.memo` per componenti di lista.
  - Usa `useCallback` per funzioni passate come props.
  - Usa `react-window` per liste che superano i 50 elementi.
- **Hooks:** Preferisci Custom Hooks per logica riutilizzabile (es. `useCastSession`).

### 2. Gestione Piattaforma (Cross-Platform)
- **Mai** chiamare API specifiche (es. `window.electronAPI` o `CapacitorPlugins`) direttamente nei componenti UI.
- Usa sempre `platformService` per verificare l'ambiente (`isElectron`, `isNative`, `isWeb`).
- **Android:** Gestisci sempre il tasto fisico "Back" in `App.tsx` usando `App.addListener('backButton', ...)`.
- **Electron Main Process:** I file eseguiti nel main process (es. `advertisingService.js`) devono essere in JavaScript CommonJS (`require`), non TypeScript, poiché non vengono transpilati da Vite.

### 3. Styling (Tailwind)
- Tema scuro di default: Background `#141414`, Testo `gray-100/gray-300`.
- Usa classi `tv-focus` per elementi che devono essere navigabili via tastiera/telecomando.
- Responsive: Mobile-first, con override `md:` e `lg:` per Desktop.

### 4. Integrazione AI
- Le richieste a Gemini devono includere il contesto (orario, cronologia, tipo di stream).
- Le risposte devono essere in formato JSON strutturato per essere renderizzate dalla UI.
- Implementare sempre caching delle risposte per risparmiare token e ridurre latenza.

## ⚠️ Punti Critici e "Gotchas"
1.  **Codec HEVC:** Su Electron, usiamo una build custom di FFmpeg scaricata via `scripts/patch-ffmpeg.js`. Non modificare questo script senza cautela.
2.  **Player Android:** Su Android, il tag `<video>` HTML5 ha performance scarse per IPTV. Usare sempre il player nativo tramite `nativeVideoPlayer.ts` quando `platformService.isNative` è true.
3.  **Mixed Content:** L'app deve poter riprodurre stream HTTP (non sicuri) anche se l'app è servita in contesto sicuro. Questo è configurato in `electron/main.js` e `android/app/src/main/AndroidManifest.xml` (usesCleartextTraffic).
4.  **Electron Build:** Assicurarsi che la cartella `services` sia inclusa in `package.json` -> `build.files` affinché `advertisingService.js` sia disponibile nella build di produzione (ASAR).

## 🚀 Comandi Utili
- `npm run dev`: Avvio sviluppo Electron.
- `npm run android:run`: Build, Sync e Run su dispositivo Android.
- `npm run dist:linux`: Build pacchetto Linux.
