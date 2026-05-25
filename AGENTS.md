# 🤖 StreamAI IPTV - Agent Instructions

Questo file serve come guida e contesto per gli agenti AI che collaborano allo sviluppo di questo progetto. Contiene l'architettura, le convenzioni e le regole critiche da seguire.

## 📋 Panoramica Progetto
**StreamAI IPTV** è un client IPTV avanzato che integra l'Intelligenza Artificiale (Google Gemini) per offrire raccomandazioni contestuali. È un'applicazione ibrida cross-platform.

> **Stato migrazione Electron → Wails v3 (snapshot 2026-05-22, plan rev. 7):**
> **Electron è stato rimosso dal repository** (Fase 7.3 del piano, "Stage A"
> applicato il 2026-05-22). Sono spariti `main.js`, `preload.js`,
> `vite.main.config.js`, `scripts/patch-ffmpeg.js`,
> `frontend/services/advertisingService.js`, le dipendenze npm `electron`,
> `electron-builder`, `castv2-client`, `node-ssdp`, `bonjour`,
> e la sezione `build` electron-builder da `package.json`. `npm run dev`
> ora è alias di `wails3 dev`. Il desktop runtime è **esclusivamente
> Wails v3** (9 Service Go in `internal/services/`, 54 metodi TS in
> `frontend/bindings/`). Il **player nativo libmpv** (Fase 6) è il gate
> residuo per la release v2.0.0 — il frontend usa ancora `useWebPlayerEngine`
> (Video.js + HLS.js + mpegts.js) come player intermedio dentro la webview
> di Wails finché Fase 6.1 non sostituirà con `useNativeMpvEngine`. Vedi
> [`docs/plan-go-wails-migration.md`](docs/plan-go-wails-migration.md) §3.3,
> §7.3 e §14.

## 🛠 Tech Stack
- **Framework:** React 19, TypeScript, Vite
- **Desktop Runtime:** **Wails v3** (Go backend + WebKitGTK 6.0/4.1
  su Linux, WebView2 su Windows, WKWebView su macOS). Electron è stato
  rimosso il 2026-05-22 (plan rev. 7).
- **Mobile Runtime:** Capacitor 7 (Android)
- **Styling:** Tailwind CSS
- **Video Player:** 
  - *Web/Desktop:* Video.js (con OSD custom e Timeline interattiva)
  - *Android:* Capacitor Video Player (player nativo basato su **AndroidX
    Media3 1.10.1** — `androidx.media3:media3-exoplayer:1.10.1`,
    pin 2026-05-15; plugin vendorato in
    `android/plugins/capacitor-video-player/`, vedi MED-1 in
    `docs/IMPROVEMENT_PLAN.md` §4-bis)
- **AI:** Google Gemini API (@google/genai)
- **Networking:** 
  - *Discovery:* Scansione attiva subnet /24 (HTTP, WebSocket)
  - *Advertising:* mDNS (Bonjour), SSDP, DIAL (via `advertisingService.js`)
- **Icons:** Lucide React

## 📂 Struttura Directory Chiave

Layout post-ristrutturazione (Wails v3 migration — vedi
`docs/plan-go-wails-migration.md` 2.1):

```
StreamAI-IPTV/
├── frontend/                 # ★ TUTTO il codice React/TS in una cartella
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
├── main.js / preload.js      # Electron legacy (fase 0 → fase 7 deprecati)
├── package.json              # toolchain condiviso (Vite/Vitest/Electron/Cap)
├── scripts/  build/  docs/  release/
└── .version  README.md  AGENTS.md
```

- `frontend/` — sorgenti UI:
  - `components/`: Componenti UI.
    - `VideoPlayerNew.tsx`: Player unificato. Gestisce Video.js, OSD, Timeline, scorciatoie tastiera e bridge verso player nativo Android.
    - `ChannelList.tsx`: Lista canali virtualizzata (react-window) per alte prestazioni. Carosello "Continua a guardare" filtrato per tipo via `ProfilePreferences.continueWatching{Movies,Series}Enabled`.
    - `AIRecommender.tsx`: Interfaccia utente per l'assistente AI.
    - `CastDevicePicker.tsx`: UI per la selezione dei dispositivi di casting.
    - `OnboardingWizard.tsx`: Wizard 3 step per creazione profilo (identità → fonte Xtream/M3U/skip → preferenze) con test connettività in tempo reale e validazione URL `.m3u`.
    - `player/StreamDiagnostics.tsx`: Pannello diagnostica stream (buffer health live, ring buffer 10 errori, URL sanificato, warning codec/HDR).
  - `services/`: Logica di business (Singleton pattern).
    - `platformService.ts`: Astrazione per gestire differenze tra Electron, Web e Capacitor.
    - `geminiService.ts`: Logica di interazione con Google Gemini.
    - `xtream.ts`: Client API per server IPTV Xtream Codes. `processContent()` preserva l'ordine d'inserimento dei gruppi `live` (alfabetico solo per `movie`/`series`).
    - `deviceDiscovery.ts`: Logica di scansione rete per trovare dispositivi Cast/DLNA (verrà sostituita dal Service Go in `internal/services/discovery/`).
    - `advertisingService.js`: (Electron Main Process — legacy) Servizio che annuncia l'app via mDNS/SSDP. **Deve essere incluso nella build Electron** (`package.json` `build.files` → `frontend/services/**`). Sostituito da `internal/services/advertising/` nel build Wails.
    - `profileService.ts`: CRUD profili. `DEFAULT_PREFERENCES` include `continueWatchingMoviesEnabled` (false), `continueWatchingSeriesEnabled` (true), `hideAiUnavailableHint` (false), `autoNextEpisodeEnabled` (true).
    - `parser.ts` / worker pipeline: parsing M3U asincrono (`parseM3UAsync`); per playlist >256 kB la parsing è delegata a Web Worker, per non bloccare la UI all'attivazione del profilo.
- `cmd/streamai/main.go` + `internal/` — backend Wails v3 in Go.
- `android/` — Progetto nativo Android (Gradle).
- `scripts/` — Script di automazione (es. patching FFmpeg per Electron, sync versione, guard `check-wails-v3.mjs` / `check-media3-migration.mjs`).

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
- Usa sempre `platformService` per verificare l'ambiente (`isElectron`, `isWails`, `isDesktop`, `isNative`, `isWeb`).
- **Bridge host (Fase 7.2):** per invocare API del backend desktop (Electron o Wails)
  importa **`host`** da `services/hostBridge.ts` (cristallizzato a runtime in base a
  `platformService.isWails` / `isElectron`). Pattern canonico:
  ```ts
  import { host } from './services/hostBridge';
  if (host?.discoverDevices) {
    const devices = await host.discoverDevices();
  }
  ```
  La forma `requireHost()` lancia se nessun bridge è disponibile (web/mobile).
- **Android:** Gestisci sempre il tasto fisico "Back" in `App.tsx` usando `App.addListener('backButton', ...)`.
- **Electron Main Process:** I file eseguiti nel main process (es. `advertisingService.js`) devono essere in JavaScript CommonJS (`require`), non TypeScript, poiché non vengono transpilati da Vite.

### 3. Styling (Tailwind + Design System v1)
- Tema scuro di default: Background `#141414`, Testo `gray-100/gray-300`.
- Usa classi `tv-focus` (scale-105 + ring) per elementi navigabili via tastiera/telecomando.
  In liste dense (ChannelList, CommandPalette, EPG rows) preferisci `tv-focus-dense`
  (solo ring, no scale) per evitare overflow.
- Responsive: Mobile-first, con override `md:` e `lg:` per Desktop.

#### Design System v1 (UI-1) — regole d'uso obbligatorie
- **Sorgente di verità:** token CSS in `index.css` (`--surface-*`, `--brand-*`,
  `--state-*`, `--text-*`) ed esposti come utility Tailwind via `tailwind.config.js`.
- **Componenti shared:** importa SEMPRE da `components/shared` (barrel `index.ts`):
  `Button`, `IconButton`, `Input`, `FormField`, `Select`, `Chip`, `Badge`, `Card`,
  `Modal`, `Sheet`, `Spinner`, `Icon`, `EmptyState`, `LoadingState`, `ErrorState`,
  `WatchlistButton`. Non duplicare bottoni/input/spinner ad-hoc.
- **Colore brand:** rosso (`bg-brand-primary`) per le CTA primarie (Play, Resume,
  Connect, Save, Create). Viola (`bg-brand-accent`) **solo** per feature AI/smart.
- **Border-radius:** usa la scala dei tre token DS:
  - `rounded-control` (12 px) → button, input, chip
  - `rounded-card` (16 px) → card poster, panel info
  - `rounded-modal` (24 px) → dialog, sheet
  - `rounded-full` consentito solo per badge/avatar circolari.
- **Surface tier:** `bg-surface-0` (body), `bg-surface-1` (pannelli secondari),
  `bg-surface-2` (pannelli primari / input), `bg-surface-3` (hover / selected).
  Niente hex inline o `bg-white/X` ad-hoc.
- **Stato:** un solo tono per ruolo — `text-state-error|warning|success|info`.
  Non mischiare `red-300/400/500` nello stesso file.
- **Icone:** scala fissa `w-icon-xs|sm|md|lg|xl` (12/16/20/24/32). Usa il wrapper
  `Icon` per garantirla.
- **Smoke test visivo:** apri l'app con `?ds-preview` in URL (o `window.__SHOW_DS_PREVIEW = true`)
  per vedere la galleria `components/DesignSystemPreview.tsx`.
- **Test contract:** i token DS sono protetti dai test in `tests/ui/tokens.test.ts`
  e `tests/ui/shared.test.tsx` — eseguili dopo ogni modifica al sistema.

### 4. Integrazione AI
- Le richieste a Gemini devono includere il contesto (orario, cronologia, tipo di stream).
- Le risposte devono essere in formato JSON strutturato per essere renderizzate dalla UI.
- Implementare sempre caching delle risposte per risparmiare token e ridurre latenza.

## ⚠️ Punti Critici e "Gotchas"
1.  ~~**Codec HEVC** Electron (FFmpeg BranchBit patch).~~ **Rimosso il
    2026-05-22**: lo script `scripts/patch-ffmpeg.js` non esiste più,
    `postinstall` rimosso da `package.json`. Su Wails il decoding HEVC/AV1
    sarà fornito da libmpv (Fase 6). Nel frontwait dentro WebKitGTK 4.1/6.0
    valgono i codec del webview di sistema (H.264/VP8/VP9 OK, HEVC dipende
    dal sistema).
2.  **Player Android:** Su Android, il tag `<video>` HTML5 ha performance scarse per IPTV. Usare sempre il player nativo tramite `nativeVideoPlayer.ts` quando `platformService.isNative` è true. Il player nativo è basato su **AndroidX Media3 1.10.1** (`androidx.media3.exoplayer.ExoPlayer` + `androidx.media3.session.MediaSession` + `androidx.media3.cast.CastPlayer`), con `DefaultRenderersFactory.setEnableDecoderFallback(true)` per fallback codec HEVC/AV1 graceful, `DefaultTrackSelector.setTunnelingEnabled(true)` per HDR/4K, `HlsMediaSource.Factory.setAllowChunklessPreparation(true)` per TTFF ridotto, e buffer IPTV-friendly (min 15s / max 50s / playback 1.5s / rebuffer 5s).
3.  **Plugin Android vendorato (MED-1):** Il plugin `capacitor-video-player` è vendorato in `android/plugins/capacitor-video-player/` per scollegarsi dall'upstream orfano (`@brylsherbert/capacitor-video-player@7.0.32` su ExoPlayer 2.19.0 EOL). `package.json` usa `"capacitor-video-player": "file:android/plugins/capacitor-video-player"`. Patch e bump Media3 vanno fatti lì. Vedi `android/plugins/capacitor-video-player/README.md` per dettagli. Una CI guard `scripts/check-media3-migration.mjs` (invocata da `npm run check`) impedisce regressioni a `com.google.android.exoplayer2.*`.
4.  **Mixed Content:** L'app deve poter riprodurre stream HTTP (non sicuri).
    Su Wails questo è gestito dal **proxy HTTP locale Go**
    (`internal/services/proxy/`) che strippa CSP/X-Frame-Options e riscrive
    gli header IPTV (`STREAMAI_INSECURE_PROXY=1` per TLS-skip opt-in).
    Su Android: `usesCleartextTraffic="true"` in `AndroidManifest.xml`.
5.  ~~**Electron Build:** include `services` in `build.files`.~~ **Non
    applicabile.** La sezione `build` electron-builder è stata rimossa da
    `package.json`. Il packaging desktop è gestito da `wails3 build` (oggi)
    + `nfpm` (Fase 8 in arrivo).
6.  **Ordine gruppi Live:** Non riordinare alfabeticamente le categorie `live` in `xtream.ts → processContent()`. L'utente si aspetta lo stesso ordine del server. L'ordinamento alfabetico va applicato solo a `movie`/`series`.
7.  **AI hint dismiss:** Quando si modifica `AiUnavailableHint` in `App.tsx`, preservare le due dimensioni di stato: `aiHintSessionDismissed` (in-memory, reset al cambio profilo) **e** `ProfilePreferences.hideAiUnavailableHint` (persistente, gestito dalla checkbox "Non mostrare più").
8.  **Profilo M3U:** Se `Profile.playlistUrl` è valorizzato, all'attivazione del profilo `App.tsx` carica e fa parsing della playlist via `parseM3UAsync` (worker se >256 kB) **prima** di mostrare il catalogo. Non bypassare questo step.
9.  **Versione applicazione:** la fonte di verità è il file `/.version` (semver `x.y.z`, una sola riga). `scripts/sync-version.mjs` propaga la versione in `package.json` e `android/app/build.gradle` (`versionName` + `versionCode = maj*10000 + min*100 + pat`). Non modificare a mano `package.json` `"version"`: aggiorna `.version` e lancia `npm run version:sync`. In CI il workflow esporta `COMMIT_SHA=${GITHUB_SHA::7}` e `build-linux.sh` lo passa a `make-distro-config.mjs --commit`, che lo embedda nel nome dell'artefatto: `streamai-iptv_${version}_${commit}_${distro}_${arch}.${ext}`. Localmente (senza commit) il pattern collassa a `streamai-iptv_${version}_${distro}_${arch}.${ext}`. Tutti gli script (`publish-repo.sh`, verify step CI) usano glob underscore-separated (`*_${distro}_*`).
10. **Bridge host (post-drop Electron):** importare `host` da
    `frontend/services/hostBridge.ts` per parlare col backend desktop.
    `host` è un `Proxy` lazy che ri-risolve a ogni accesso: su Wails punta
    a `wailsBridge`, su web/mobile espone `undefined` su ogni proprietà.
    **NON** usare `if (host) { ... }` come guard (un `Proxy` è sempre
    truthy): usa `platformService.isWails` / `isDesktop`, poi
    `host?.someMethod` per la chiamata. `requireHost()` lancia se
    nessun bridge è disponibile.
    Il flag `platformService.isElectron` è stato **rimosso** (rev. 7.4,
    2026-05-23): i call site devono usare `isDesktop` o `isWails`.

11. **Rilevamento runtime Wails (2026-05-23).** Il pacchetto
    `@wailsio/runtime` esegue `window._wails = window._wails || {}`
    come side-effect del solo import — quindi la presenza di
    `window._wails` da sola NON è un marker affidabile (sarebbe `true`
    anche in jsdom/web). Il backend Go popola
    `window._wails.environment` (`OS`/`Arch`/`Debug`) solo dentro l'app
    Wails reale: questo è il marker corretto, vedi
    `frontend/services/platformService.ts → detectWailsRuntime()`. Il
    check è **lazy** (re-valutato a ogni accesso) per gestire la race
    in cui `platformService` viene importato prima del runtime.

12. **Proxy IPTV = middleware dell'asset server Wails, NON listener TCP
    separato (FIX 2026-05-24).** La webview di Wails
    (WebKitGTK/WebView2/WKWebView) blocca le `fetch()` cross-origin dal
    documento (`wails://wails.localhost`) verso un server HTTP
    standalone su `http://127.0.0.1:<port>` per
    mixed-content/CORS — anche con `Access-Control-Allow-Origin: *` in
    risposta (errore tipico WebKit: `Network error: Load failed`).
    Soluzione: `internal/services/proxy/service.go → AssetMiddleware()`
    espone il proxy come middleware del **WebKit AssetServer** sul path
    same-origin `/iptv-proxy`. Wiring in `cmd/streamai/main.go`:
    ```go
    Assets: application.AssetOptions{
        Handler:    application.AssetFileServerFS(rootassets.FS),
        Middleware: application.Middleware(proxySvc.AssetMiddleware()),
    },
    ```
    Il frontend (`frontend/services/xtream.ts → resolveFetchURL`)
    costruisce l'URL client-side: `/iptv-proxy?u=<base64url>&ua=<UA>`
    (`toBase64Url()` JS-side equivalente a `base64.RawURLEncoding` Go,
    nessun IPC per chiamata). Il listener TCP standalone
    `proxy: listening on http://127.0.0.1:<port>/proxy` resta attivo
    come fallback per futuri stream URL libmpv ma il **frontend non
    deve mai puntarci direttamente**. Conferma al boot:
    `AssetServer Info: middleware=true`.

## 🐞 Known issues (rolling list, da aggredire nelle prossime sessioni)

- **EPG non viene caricato (2026-05-24).** Dopo il fix proxy Xtream
  (punto 12) live/VOD/series si caricano correttamente attraverso
  `/iptv-proxy`, ma l'EPG resta vuoto. Sospetto: `frontend/services/epg/*`
  fa `fetch()` diretta verso l'URL XMLTV e cade nello stesso
  CORS/mixed-content di WebKitGTK che aveva Xtream. Da fare:
  estrarre un helper condiviso (es. `frontend/services/proxyFetch.ts`)
  che instrada qualsiasi fetch IPTV/XMLTV attraverso `/iptv-proxy`,
  e usarlo sia da `xtream.ts` (`fetchDirect`) sia da `epg/index.ts`
  (`fetch(url, ...)` riga ~153). Vedi anche le altre `fetch()` ad-hoc
  in `streamInfoService.ts`, `metadata.ts`, `downloadManager.ts`,
  `streamInfo/vodProbe.ts` — non tutte vanno proxate (es. metadata
  TMDB sono già CORS-friendly), ma vale la pena censirle in un
  `IMPROVEMENT_TODO`.

## 🚀 Comandi Utili
- `npm run dev`: Avvio sviluppo Electron.
- `npm run android:run`: Build, Sync e Run su dispositivo Android.
- `npm run dist:linux`: Build pacchetto Linux per la distro host (auto-detect via `/etc/os-release`).
- `npm run dist:linux:{opensuse,fedora,rhel,debian,ubuntu,arch}`: Build per-distro con nomi pacchetto nativi (da `build/depends/<distro>.json`). Gli artefatti seguono il pattern underscore-separated `streamai-iptv_${version}_${distro}_${arch}.${ext}` (locale) o `streamai-iptv_${version}_${commit}_${distro}_${arch}.${ext}` (CI, dove `${commit}` è il SHA breve da `$COMMIT_SHA`/`$GITHUB_SHA`).
- `npm run version:sync` / `version:print` / `version:full`: gestione della versione. La fonte di verità è il file `/.version` (es. `1.0.0`); `sync-version.mjs` la propaga a `package.json` e `android/app/build.gradle` (versionName + versionCode). `--print-full` aggiunge `_<sha7>` se in contesto git/CI.
- `npm run dist:linux:{deb,rpm,pacman,appimage,tar,all}`: Target generici (SONAME-based) e portable.
- `npm run gpg:setup`: Genera la chiave GPG maintainer (vedi `docs/SIGNING.md`).
- `npm run gpg:upload`: Carica `GPG_PRIVATE_KEY` / `GPG_PASSPHRASE` / `GPG_KEY_ID` come Actions secrets via `gh` CLI (libsodium sealed box).
- `npm run repo:publish`: Assembla `public-repo/` per GitHub Pages.

## 📦 Pipeline Linux Release (CI)
Il workflow [`.github/workflows/linux-release.yml`](.github/workflows/linux-release.yml)
si attiva su tag `v*` e `workflow_dispatch`. Esegue:

1. Build dei **6 pacchetti per-distro** (no AppImage / tar.xz / target SONAME generici).
2. Firma GPG (Ed25519 subkey, passphrase pre-cachata in `gpg-agent`):
   - `.deb` → `debsigs --sign=origin` (membro `_gpgorigin`); `dpkg-sig`
     non è più disponibile in Ubuntu 24.04.
   - `.rpm` → `rpm --addsign` con macro `%__gpg_sign_cmd` SHA-256.
   - `.pkg.tar.zst` → `gpg --detach-sign` (`.sig` binario).
   - `SHA256SUMS` + `SHA256SUMS.asc`.
3. Verifica **strict** (`set -euo pipefail`, niente `|| true`):
   - RPM: pubkey importata in **rpmdb dedicato** (`rpm --dbpath` +
     `--initdb` + `--import`); fallisce su `NOKEY`.
   - DEB: blob firmato ricostruito **nell'ordine reale di `ar t`** (non
     canonico) ⇒ `gpg --verify` contro `_gpgorigin` / `_gpgbuilder`.
   - Cross-check: almeno un artefatto per ognuna delle 6 distro attese.
4. SLSA build provenance (`actions/attest-build-provenance@v2`).
5. GitHub Release con i 6 pacchetti + `*.asc` + `*.sig` + `SHA256SUMS{,.asc}`.
6. Job `pages`: tenta di ripristinare la storia in `public-repo/` da
   `actions/cache` (key `pages-history-v1-*`); se la cache è scaduta
   (7 giorni di inattività) fa fallback al **download dei pacchetti
   firmati dai GitHub Release passati** (`gh release download` di
   tutti i `.deb`/`.rpm`/`.pkg.tar.zst`/`.sig`/`.asc` non già presenti
   in `dist/`). I metadati di repo (`reprepro` / `createrepo_c` /
   `repo-add`) vengono ricostruiti da `publish-repo.sh` sull'unione
   pacchetti vecchi + nuovi. Il deploy avviene via API ufficiale
   GitHub Pages (`actions/configure-pages@v5` +
   `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4`,
   environment `github-pages`): zero `git push`, zero limiti di
   pack-size. La cache `pages-history-v1` viene salvata a fine job.
   Il branch `gh-pages` non è più usato (gli HTTP 500 persistenti
   sui push grossi lo rendevano inaffidabile anche come backup).

**Caching workflow (4 layer):** `~/.cache/electron`, `~/.cache/electron-builder`,
APT toolchain (`awalsh128/cache-apt-pkgs-action`), Docker images
`electronuserland/builder` e `archlinux:latest` (`ScribeMD/docker-cache`).
Riduzione cold→warm: ~14 min → ~5 min.

Storia completa delle iterazioni in
[`docs/plan-linuxDistroPackaging.prompt.md`](docs/plan-linuxDistroPackaging.prompt.md)
§ "Esecuzione & evoluzione (post v5)".

