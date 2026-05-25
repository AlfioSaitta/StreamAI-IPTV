# StreamAI IPTV — TODO operativa

> **File companion di [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md).**
> Contiene **solo i task aperti** estratti dal piano canonico, organizzati
> per priorità di esecuzione. Generato 2026-05-18 da
> `docs/IMPROVEMENT_PLAN.md` rev. 2026-05-18 (versione `/.version` 1.0.0).
>
> 📌 Convenzione: `[ ]` = aperto. Quando chiudi un task qui, **chiudilo
> anche** nella sezione corrispondente del piano (riferimento `x.y`).
> Stime: `g` = giorno-uomo. P0 = urgente bloccante  P1 = alta priorità 
> P2 = pianificato  P3 = nice-to-have.

---

## 🆕 Sessione 2026-05-25 — MPV Backend Fixes, Data Migration & OS Integration

- [x] **WAILS-BUILD-FIX** — Errore build Vite `react-window` (FixedSizeList non esportato). **Fix landed 2026-05-25:** aggiornato `VideoPlayerNew.tsx` all'API di `react-window` v2.2.3 (usando `List` invece di `FixedSizeList`).
- [x] **MPV-OS-INTEGRATION** — Integrazione sistema OS (Fase 7-bis). **Landed 2026-05-25:**
  1. Creato hook `usePlayerSystemIntegration.ts` per Wails.
  2. Implementato Power Save Blocker (prevent display sleep) in player.
  3. Implementato Media Keys (MPRIS/D-Bus) bidirezionale (metadati + controlli hardware).
  4. Disabilitato `navigator.mediaSession` su Wails per evitare conflitti.
- [x] **MPV-CREATE-1** — Errore `mpv_create returned nil` su Linux con locale `it-IT`.
  Root cause: libmpv fallisce il parsing delle opzioni se la locale numerica
  usa la virgola. **Fix landed 2026-05-25:** forzato `LC_NUMERIC=C` via
  CGO in `internal/services/player/mpv_cgo.go` e `spike-mpv-render`.
- [x] **MPV-VERSION-1** — Check versione API errato. Faceva comparazione
  diretta con `107` invece di `(1 << 16) | 107`. Fixato in `mpv_cgo.go`.
- [x] **MPV-DIAG-1** — Migliorata diagnostica errore backend. Ora include
  `errno` e versione API formattata (es. `2.5`) nel messaggio d'errore.
- [x] **MPV-HWDEC-1** — Accelerazione HW non attiva o non rilevata.
  Root cause: `hwdec=auto-safe` troppo conservativo e diagnostica basata
  su tag `<video>` (assente con MPV). **Fix landed 2026-05-25:**
  1. Passato a `hwdec=auto` e aggiunto `hwdec-codecs=all` in Go.
  2. Esposto `HwAccelInfo` da MPV al frontend via Wails binding.
  3. Integrati dati MPV in `StreamDiagnostics.tsx`, eliminando i falsi negativi.
- [x] **MPV-CLEANUP-1** — Audio persiste in sottofondo dopo chiusura player.
  Root cause: `VideoPlayerNew` non fermava l'engine MPV all'unmount.
  **Fix landed 2026-05-25:** aggiunto `stopMpv()` nel cleanup di unmount.
  Rifattorizzate callback per stabilità (destructuring stable functions).
- [x] **MPV-AUTOPLAY-1** — Autoriproduzione film/VOD non funzionante su Wails.
  Root cause: `VideoPlayerNew` caricava il file ma non chiamava `playMpv()`.
  **Fix landed 2026-05-25:** aggiunto `playMpv()` esplicito dopo il caricamento.
- [x] **PLAYER-RESUME-1** — Ripresa visione (seek iniziale) mancante/errata per MPV.
  Root cause: `initialProgress` (percentuale) non veniva applicato a MPV.
  **Fix landed 2026-05-25:** implementato seek automatico in `VideoPlayerNew` al caricamento dei metadati MPV.
- [x] **PLAYER-PROGRESS-1** — Incoerenza globale dati progresso (secondi vs percentuale).
  Root cause: `App.tsx` salvava secondi invece di 0..1, causando seek errati o mancanti.
  **Fix landed 2026-05-25:** centralizzato il calcolo della percentuale (0..1) in `App.tsx → handleVideoProgress`.
- [x] **NET-NOTIF-1** — Notifica "In riproduzione su..." persistente.
  Root cause: gli eventi `network-playback-status` UDP (frequenti) resettavano continuamente il timeout di 10s.
  **Fix landed 2026-05-25:** implementato auto-dismiss a 8s con cooldown di 60s per lo stesso contenuto e dispositivo. Aggiunta chiusura immediata se `isPlaying: false`.

- [x] **WAILS-FULLSCREEN-1** — Supporto fullscreen globale (tasto F). **Landed 2026-05-25:** implementata integrazione con le API native di Wails per gestire il fullscreen della finestra reale.
- [x] **WAILS-SHUTDOWN-2** — Watchdog shutdown e fix deadlock D-Bus. **Landed 2026-05-25:** implementato timeout su `conn.Close()` e watchdog globale di 5s in `main.go`.
- [x] **WAILS-BUNDLE-1** — Ottimizzazione bundle frontend. **Landed 2026-05-25:** implementato code-splitting per Video.js/Hls.js/Mpegts.js, riducendo il chunk iniziale del 80%.
- [x] **WAILS-LINUX-PKG** — Packaging nativo Linux via nfpm. **Landed 2026-05-25:** creato `nfpm.yaml` e script `build-linux-wails.sh` per pacchetti .deb, .rpm, .pkg.tar.zst.

## 🆕 Sessione 2026-05-23/24 — Xtream + EPG dopo drop Electron

- [x] **WAILS-PROXY-1** — Xtream non si connette su Wails (CORS/mixed-content
  WebKitGTK). Sintomi: `Network error: Load failed` o catalogo vuoto.
  Root cause: `frontend/services/xtream.ts` faceva `fetch()` diretto al
  server IPTV; WebKitGTK blocca cross-origin da `wails://` a `http://`.
  **Fix landed 2026-05-24:** proxy IPTV esposto come middleware
  dell'asset server Wails sul path same-origin `/iptv-proxy`
  (`internal/services/proxy/service.go → AssetMiddleware`, wiring in
  `cmd/streamai/main.go` via `AssetOptions.Middleware`). Frontend
  costruisce URL `/iptv-proxy?u=<base64url>&ua=...` client-side senza
  IPC per chiamata. Vedi AGENTS.md punto 12.

- [x] **WAILS-DETECT-1** — `platformService.isWails` ritornava sempre
  `false` perché controllava `window.wails` mentre il runtime v3
  inietta `window._wails`. Inoltre il pacchetto `@wailsio/runtime`
  setta `window._wails = {}` come side-effect dell'import: usare
  `window._wails.environment` come marker. Fix in
  `frontend/services/platformService.ts → detectWailsRuntime()` (lazy
  re-eval). Vedi AGENTS.md punto 11.

- [x] **ELECTRON-PURGE-1** — Rimossi tutti i call site `isElectron`/
  `electronAPI` dal frontend (rev. 7.4, 2026-05-23). Rinominati:
  `isElectron → isDesktopBridge`, `electronUnsubscribe → desktopUnsubscribe`,
  `discoverViaElectron → discoverViaDesktop`, interfaccia `ElectronAPI`
  → `DesktopHostAPI`. `hostBridge.host` è ora un `Proxy` lazy
  (re-resolve ogni accesso) — NON usare `if (host)` truthy check.

- [x] **EPG-PROXY-1 (P1)** — EPG non si carica dopo il fix Xtream.
  Sospetto: `frontend/services/epg/*` (in particolare `epg/index.ts:153`,
  `const res = await fetch(url, ...)`) bypassa il proxy `/iptv-proxy`
  e cade nello stesso CORS/mixed-content. **Fix landed 2026-05-25:**
  1. Estratto helper condiviso `frontend/services/proxyFetch.ts` con
     `proxyFetch(url, init?)`.
  2. Sostituite le `fetch()` dirette IPTV in `epg/index.ts`,
     `streamInfoService.ts` e `vodProbe.ts`.
  3. Verifica end-to-end: EPG caricato correttamente su Wails.

- [x] **MIGRATION-IDB-1 (P0)** — Data migration v1→v2 IndexedDB (Fase 7-bis.8).
  1. Creare `internal/pkg/migrate` in Go. ✅
  2. Implementare discovery dei path Electron/Chromium. ✅
  3. Estrarre dati da LevelDB (profili, history). ✅
  4. Inject nel nuovo IndexedDB via Frontend bridge. ✅
- [x] **NOTIF-NATIVE-1 (P1)** — Notifiche desktop native cross-platform (Fase 7-bis.9).
  1. Implementare backend D-Bus (Linux). ✅
  2. Implementare fallback PowerShell (Windows) e osascript (macOS). ✅
  3. Integrare in `reminderService.ts` per promemoria EPG. ✅
- [x] **CACHE-W-1 (P1)** — Cache picons/cover vuota su Wails.
  Root cause: URL HTTP bloccati da Mixed-Content su WebKitGTK.
  **Fix landed 2026-05-25:** centralizzato download via `proxyFetch`.
- [x] **CACHE-W-2 (P1)** — Scarsa efficienza cache durante scroll veloce.
  Root cause: troppe richieste pendenti contemporanee.
  **Fix landed 2026-05-25:** implementato `AbortController` in `CachedImage` e `DownloadManager`.
- [x] **PERF-CAT-1 (P1)** — UI freeze su playlist massime.
  Root cause: parsing M3U sincrono su main thread.
  **Fix landed 2026-05-25:** introdotto `CatalogWorker` (Web Worker).
- [x] **SHUTDOWN-FREEZE-1 (P1)** — Freeze dell'app alla chiusura su Wails.
  Root cause: `conn.Close()` di `godbus` si blocca se ci sono segnali pendenti (MPRIS).
  **Fix landed 2026-05-25:** implementato timeout di 500ms per la chiusura della
  connessione D-Bus in `mediakeys_linux.go` e aggiunto un watchdog globale di
  5 secondi in `main.go` per forzare l'uscita in caso di deadlock estremi.

---

## 📋 Indice

- [🔥 Sprint 0 — Urgenze P0 (2-3 giorni)](#-sprint-0--urgenze-p0-2-3-giorni)
- [🎯 Sprint 1 — Sicurezza & CI (P0/P1)](#-sprint-1--sicurezza--ci-p0p1)
- [🎬 MED-1 — Smoke matrix Android (gate fisico)](#-med-1--smoke-matrix-android-gate-fisico)
- [♻️ REF-1 — Re-split hotspot post-feature creep](#%EF%B8%8F-ref-1--re-split-hotspot-post-feature-creep)
- [🚀 P1-P4 residui (player, casting, UX)](#-p1-p4-residui-player-casting-ux)
- [🧪 P7 — Qualità, lint, test, CI](#-p7--qualità-lint-test-ci)
- [✨ P8 — Feature future ad alto valore](#-p8--feature-future-ad-alto-valore)
- [💎 C — UX gap residui](#-c--ux-gap-residui)
- [🆕 D — Nuove feature ad alto valore](#-d--nuove-feature-ad-alto-valore)
- [⚡ E — Performance avanzata](#-e--performance-avanzata)
- [📊 F — Affidabilità e osservabilità](#-f--affidabilità-e-osservabilità)
- [🔧 G — DX, lint, dependency hygiene](#-g--dx-lint-dependency-hygiene)
- [⚡ K — Quick wins (≤ 1 g)](#-k--quick-wins--1-g)
- [📦 PKG-1 — Residui pipeline Linux](#-pkg-1--residui-pipeline-linux)

---

## 🔥 Sprint 0 — Urgenze P0 (2-3 giorni)

### TEST-1 — Fix suite Vitest rotta (P0, ½ g) — `§2-bis` ✅ chiuso 2026-05-20

- [x] Aggiungere a `package.json → devDependencies`:
      `"@testing-library/dom": "^10.4.0"` +
      `"@testing-library/jest-dom": "^6.6.3"`.
- [x] `npm install --legacy-peer-deps`.
- [x] `npm run test:run` → **209/209 verde** (target era 207).
- [x] `npm run check` → verde (typecheck + test + media3 + wails + go + build).
- [x] Aggiunto `scripts/check-deps.mjs` (regola
      `@testing-library/react` → `@testing-library/dom` + `jest-dom`),
      cablato in `npm run check` come primo step (`check:deps`).
- [x] `npm explain @testing-library/dom` → `10.4.1` resolved.
- [x] §1 e §13 IMPROVEMENT_PLAN aggiornati (stato, sequenza, criteri di accettazione).

### BUG-1 — Smoke residuo Films (P0, ½ g) — `§2.4`

- [ ] Smoke manuale: stessa cache di un profilo "Films vuoto" → dopo
      l'aggiornamento, al prossimo avvio Films popolato senza intervento.

### URG-1 — Smoke seek VOD reali (P1, 1 g) — `§3.3`

- [ ] Smoke su 3 provider Xtream reali: mp4 faststart, mp4
      non-faststart, MKV. Target: click → `seeked` < 1.5 s (95p).
- [ ] Re-mount automatico engine alternativo (es. MIME `video/mp2t`
      → forza `mpegts.js`). `§3.2 Livello 3`.

### URG-1 Livello 4 — Range proxy Electron (P2 opzionale, 2-3 g) — `§3.2`

- [ ] Proxy interno `loopback:port/proxy?u=<url>` in `main.js`.
- [ ] Fake-Range streaming + scarto byte pre-offset, dietro feature
      flag `experimental.rangeProxy`.
- [ ] Solo Electron (Android usa ExoPlayer/Media3 nativo).

---

## 🎯 Sprint 1 — Sicurezza & CI (P0/P1)

### P0.1 — Triage `npm audit` (P0, 1 g)

- [ ] `npm audit` completo + `npm audit --omit=dev`.
- [ ] Classificare per severità: runtime / dev-only / transitive /
      non sfruttabili.
- [ ] Aggiornare dipendenze dirette non breaking.
- [ ] `overrides` solo per transitive non aggiornabili.
- [ ] **Evitare** `npm audit fix --force` salvo tranche dedicata + test.
- [ ] Verificare CVE su pacchetti networking: `bonjour`, `node-ssdp`,
      `ws`, `castv2-client`.
- [ ] Documentare vulnerabilità residue accettate.

### P0.2 — Hardening WebSocket remote control (P0, 1 g)

- [ ] Mappare tutte le azioni remote supportate + schema payload ammesso.
- [ ] Token locale generato all'avvio + pairing PIN/QR.
- [ ] Rate limit per client/IP, chiusura connessioni malformate.
- [ ] Zero log di URL stream completi o credenziali.

### P0.3 — Validazione IPC Electron (P0, 1 g)

- [ ] Censire tutte le API esposte da `preload.js` + handler `ipcMain`.
- [ ] Validare input (IP, porte, URL stream, payload cast).
- [ ] Normalizzare errori IPC in risposte strutturate.
- [ ] Mantenere `contextIsolation: true`, `nodeIntegration: false`.

### G.4 — CI GitHub Actions su PR (P0 dopo TEST-1, 0.5 g) — `§G.4` ✅ chiuso 2026-05-22

- [x] Creato `.github/workflows/ci.yml` su `push` + `pull_request`:
      `npm ci && npm run check:deps && npm run typecheck && npm run test:run &&
      npm run check:media3 && npm run check:wails && npm run check:go &&
      npm run build` su Ubuntu 24.04 + Node 20 LTS + Go 1.25 +
      libwebkit2gtk-4.1-dev + libmpv-dev + libayatana-appindicator3-dev.
      Aggiunto step finale `go test -tags 'gtk3' ./internal/...` per la
      suite Go (gli e2e DBus skippano in assenza di gdbus/session bus,
      lo stub backend libmpv è il default delle suite player).
      Concurrency group cancel-in-progress per evitare run duplicati.
- [x] Pubblicato badge CI nel README (`[![CI](.../ci.yml/badge.svg)]`).
- [ ] `android.yml`: build APK debug su PR (artefatto) — dipende da
      JDK 17 completo + emulatore Android (gate MED-1 §4-bis).

---

## 🎬 MED-1 — Smoke matrix Android (gate fisico)

> Codice migrato a AndroidX Media3 1.10.1 ✅. Resta solo la verifica
> fisica su device API 26+ con JDK 17 completo. `§4-bis.6 Step 7`.

### Step 0-bis — Snapshot baseline (0.3 g)

- [ ] Catturare su device API 26+: tempi cold-start fullscreen
      (HLS live + VOD MP4), `player.getVideoFormat().codecs` per HLS
      H.264+AAC / HEVC+E-AC-3 / MP4 / MPEG-TS, throughput
      `onBandwidthEstimate`, 1 screenshot per FIT/FILL/ZOOM, snapshot
      lock-screen controls.
- [ ] Salvare in `docs/assets/med1-baseline/` (gitignored se PII).

### Step 1 + 6 — Gradle build verde

- [ ] `./gradlew :capacitor-video-player:assembleDebug --warning-mode=all`.
- [ ] `./gradlew :capacitor-video-player:dependencies | grep exoplayer`
      → zero match.
- [ ] `./gradlew :app:assembleDebug` + `:app:assembleRelease` verdi.
- [ ] APK release size delta ±2 MB rispetto baseline (`apkanalyzer`).

### Step 7 — Smoke matrix completa (0.7 g, **gate di rilascio**)

**Codec video:** H.264 BL/Main/High · HEVC Main10 HDR10 · VP9 · AV1
(API 31+ + fallback graceful < 31) · MPEG-2 · MPEG-4 Part 2.

- [ ] H.264 (HLS live + MP4 VOD): play / pausa / seek / resize 3 modi.
- [ ] HEVC Main10 4K HDR10 (decoder HW + `setEnableDecoderFallback`).
- [ ] VP9 (WebM): play + seek.
- [ ] AV1: play API 31+; errore esplicito API < 31, no crash.
- [ ] MPEG-2 (DVB-T over IP): play.
- [ ] MPEG-4 Part 2 (file legacy 3GP/AVI): play.

**Codec audio:** AAC LC/HE/HEv2/ELD · MP3 · AC-3/E-AC-3 passthrough ·
AC-4 Atmos · Opus/Vorbis · FLAC.

- [ ] AAC-LC stereo (volume, mute).
- [ ] HE-AAC / HE-AACv2.
- [ ] MP3 (radio streams).
- [ ] AC-3 / E-AC-3 5.1 passthrough HDMI.
- [ ] AC-4 Atmos passthrough (device-dependent, fallback graceful).
- [ ] Opus / Vorbis (WebM).
- [ ] FLAC.

**Container & protocolli:** MP4/M4V/MOV · MKV · WebM · OGG · 3GP/FLV ·
MPEG-TS · HLS Live + VOD · DASH · SmoothStreaming.

- [ ] HLS Live `.m3u8`: TTFF < 3 s, no rebuffering ricorrente.
- [ ] HLS VOD: seek puntuale, EXT-X-MAP fMP4, multi-audio.
- [ ] DASH `.mpd`: manifest live + VOD, multi-bitrate.
- [ ] SmoothStreaming `.ism` (se disponibile).
- [ ] MP4 progressivo: seek + retry 5xx.
- [ ] MPEG-TS over HTTP (`.ts` o Xtream extensionless): play < 3 s,
      HW MediaCodec H.264 visibile in logcat.
- [ ] WebM (VP9 + Opus).
- [ ] MKV (H.264+AAC; H.265+AC-3 se OEM).
- [ ] 3GP / FLV / OGV: no crash.

**Sottotitoli:**

- [ ] Sideload `.vtt` / `.srt` / `.ssa`-`.ass` / `.ttml`-`.dfxp`-`.xml`:
      caricamento, toggle, styling, reset al cambio canale.
- [ ] WebVTT embed in HLS (`#EXT-X-MEDIA TYPE=SUBTITLES`) selezione
      lingua via `setPreferredTextLanguage`.
- [ ] CEA-608/708 embed MPEG-TS o HLS fMP4: visibili e toggle-abili.

**Feature trasversali:**

- [ ] PiP: ingresso Home + `pipBtn`, ripristino, aspect ratio,
      no doppio enter, no crash uscita.
- [ ] MediaSession lock screen + Bluetooth media keys + Android Auto base.
- [ ] Chromecast (fallback Media3): `MediaRouteButton` → device list →
      `castPlayer.setMediaItem` → ripristino su session ended.
- [ ] Resize ciclico FIT→FILL→ZOOM.
- [ ] HTTP headers custom (User-Agent + Authorization in logcat OkHttp).
- [ ] Speed/Rate 0.5/1/1.5/2.
- [ ] Retry: simulare 5xx → `scheduleRetry` + `MAX_PLAYBACK_RETRIES`
      rispettato.

**Performance:**

- [ ] Cold-start fullscreen < 1.5 s su API 30, no jank 60 fps
      su Mi Box / Fire TV Stick 4K.
- [ ] RAM < 350 MB su 1 live HLS HEVC 1080p.
- [ ] Battery drain (1 h Wi-Fi): variazione baseline ≤ +5%.
- [ ] No regressioni rotazione (`sensorLandscape` lock).

### Criteri di accettazione MED-1 — `§4-bis.7`

- [ ] Tutte le celle codec/container/protocollo verdi.
- [ ] Tutte le celle sottotitoli verdi.
- [ ] Tutte le feature trasversali verdi.
- [ ] Performance: nessuna metrica peggiore di -5% rispetto baseline.

---

## ♻️ REF-1 — Re-split hotspot post-feature creep

> Vedi `§4-quater`. 4 sotto-tranche, ~4.2 g totali.

### REF-1.a — `VideoPlayerNew.tsx` 1.599 → ≤ 1.000 (P1, 1.5 g)

- [ ] Estrarre `components/player/ErrorReport.tsx` (overlay + `buildErrorReport()` +
      `copyErrorReport()` con clipboard fallback).
- [ ] Estrarre `components/player/PlayerSubtitleSideloader.tsx`
      (file picker + parse SRT/VTT + track injection).
- [ ] Hook `hooks/usePlayerErrorRing.ts` (ring buffer ultimi 10 errori,
      condiviso con `StreamDiagnostics`).
- [ ] Hook `hooks/usePlayerRetryPolicy.ts` (classify + exponential backoff,
      oggi duplicato lato JS).
- [ ] Smoke shortcut: P/Space, ←/→, ↑/↓, M, F, C, L, S, T, G, Esc tutti
      funzionanti post-split.

### REF-1.b — `App.tsx` 1.151 → ≤ 800 (P2, 1.0 g)

- [ ] Estrarre `components/AiUnavailableHint.tsx` (dual-layer
      `sessionDismissed` + `hideAiUnavailableHint`).
- [ ] Estrarre `hooks/useFontScale.ts` (mapping `sm|md|lg|xl` →
      `<html>{font-size}`).
- [ ] Estrarre `hooks/useXtreamRefreshOrchestrator.ts` (lock + offline
      guard + timestamp).
- [ ] Estrarre `hooks/useM3uPlaylistLoader.ts` (worker dispatch + parse +
      storage, vedi gotcha §8 copilot-instructions).

### REF-1.c — `ProfileSettings.tsx` 938 → ≤ 600 (P2, 1.0 g)

- [ ] Architettura `components/profileSettings/`:
      `TabAppearance.tsx`, `TabPlayback.tsx`, `TabCatalog.tsx`,
      `TabAdvanced.tsx`.
- [ ] Bottom-nav o pill-tabs (DS-v1 `Chip` row).

### REF-1.d — `ChannelList.tsx` 966 → ≤ 750 (P2, 0.7 g)

- [ ] Estrarre `components/channelList/ContinueWatchingRail.tsx`
      (carosello + filtri per-tipo + progress overlay).
- [ ] Estrarre `components/channelList/CatalogToolbar.tsx`
      (search + chip tipo + filtri HD/Nuovi/Genere).
- [ ] Mantenere virtualizzazione + grid logic nel principale.

### Accettazione REF-1 — `§4-quater.3`

- [ ] 4 file tornano sotto target; tabella hotspot §1 aggiornata.
- [ ] Test suite (post TEST-1) verde + ≥6 nuovi test sui sotto-componenti.
- [ ] Nessuna regressione shortcut player / accessibility / focus.
- [ ] Bundle iniziale invariato (< 250 kB gzip; oggi 146).

---

## 🚀 P1-P4 residui (player, casting, UX)

### P1.1 — Bundle iniziale (rifiniture) — `§5 P1.1`

- [ ] Pre-render Home come HTML statico in `dist/index.html` per
      TTFP Electron < 250 ms.
- [ ] `import.meta.glob` lazy per categorie metadata ed engine player.
- [ ] Verifica trade-off `lucide-react` import puntuale.

### P2.2 — Verifica fisica PiP Android (gate rilascio) — `§5 P2.2`

- [ ] Device fisico/emulatore API 26+, JDK 17 completo, build APK,
      Home/PiP/return-to-app, audio background, codec HEVC.

### P3.2 — Casting test reali — `§5 P3.2`

- [ ] Test manuali su Chromecast e DLNA fisici.

### P4.1 — Focus management TV — `§5 P4.1`

- [ ] Test telecomando / TV box reale.

### P4.3 — Matrice device Android/TV box — `§5 P4.3`

- [ ] Compilare matrice (modello, API, tipo telecomando) e validare
      modalità landscape immersiva su ciascuna.

---

## 🧪 P7 — Qualità, lint, test, CI

### P7.1 — Test automatici (dopo TEST-1) — `§5 P7.1`

- [ ] Snapshot UI critici (`ChannelList`, `ProfileSelection`) via
      `@testing-library/react`.
- [ ] Test unit: parser M3U, ProfileService, CacheService, i18n shape,
      Xtream URL helper.
- [ ] Mock test discovery / cast service.
- [ ] Coverage minimo **50% su `services/`**.

### P7.2 — Lint e validazione CI — `§5 P7.2`

- [ ] ESLint 9 flat + React/Hooks/TypeScript + `jsx-a11y`.
- [ ] Prettier + `tailwindcss/prettier-plugin`.
- [ ] Custom check segreti hardcoded (greppare API keys nei `.tsx`).
- [ ] Script `lint`, `validate` (= `typecheck && lint && test:run && build`).
- [ ] Husky + lint-staged → blocca push con errori.

### P7.3 — Smoke Electron in CI — `§5 P7.3`

- [ ] Script automatizzato `timeout 20s npm run start` integrato in `ci.yml`.

---

## ✨ P8 — Feature future ad alto valore

### P8.1 — Companion remote da smartphone

- [ ] Pagina locale PIN/QR, pairing, controlli play/pausa/volume/seek/
      canale, ricerca, auth obbligatoria. Vedi anche P0.2.

### P8.3 — Backup/import profili

- [ ] Export/import JSON, cifratura opzionale, mascheramento credenziali,
      migrazione Desktop ↔ Android.

### P8.4 — Parental control / profilo Kids

- [ ] PIN profilo, blocco categorie, filtro adult, modalità bambini.
      Vedi anche D.8.

---

## 💎 C — UX gap residui

### C.4 — Sync progress Desktop ↔ Android

- [ ] Tracciamento per device (dipende da D.6 BYOC).

### C.5 — Gesture touch Android

- [ ] Swipe verticale sx = luminosità, dx = volume (overlay OSD).
- [ ] Doppio tap left/right = -10 s / +10 s con ripple.
- [ ] Pinch fullscreen ↔ aspect ratio toggle.

### C.7 — Lingua per profilo, davvero

- [ ] Cambio lingua a caldo senza reload (B.3 ha già lazy load).
- [ ] Locale data/ora con `Intl.DateTimeFormat`.

---

## 🆕 D — Nuove feature ad alto valore

### D.1 — EPG: registrazione da menu programma (richiede D.3)

- [ ] Pianificazione registrazione dal popup programma EPG.

### D.2 — Timeshift / Catch-up TV

- [ ] Detect `user_info.allowed_output_formats`.
- [ ] `←/→` su Live retrocedono fino a N ore se supportato.
- [ ] Indicatore "Live edge" + jump-to-live (`Home`).
- [ ] Buffer locale ring (30 min) per micro-rewind.

### D.3 — Registrazione stream (Desktop)

- [ ] Tasto `R` su Live/VOD: dump segmento via Node `https.get` →
      `.ts`/`.mp4`.
- [ ] Job manager + pianificazione da EPG.
- [ ] Cartella configurabile + capability flag (solo Electron).

### D.4 — Multi-audio e sottotitoli (parità completa)

- [ ] Esporre `AudioTrackList` Video.js (`A` per menu lingua).
- [ ] WebVTT da HLS embed (`Hls.Events.SUBTITLE_TRACKS_UPDATED`).
- [ ] OpenSubtitles API key opzionale.
- [ ] Stile personalizzabile + persistenza per profilo/episodio.

### D.5 — Audio-only + Alarm

- [ ] Modalità "Solo audio" (radio IPTV / podcast).
- [ ] Sveglia (avvia canale X a ora Y, Electron + `node-schedule`).

### D.6 — Sync cloud opzionale (BYOC)

- [ ] Provider plug-in: WebDAV / Nextcloud / Dropbox / iCloud Drive.
- [ ] Sync profili (no credenziali), history, watchlist, EPG reminders.
- [ ] Cifratura AES-GCM con passphrase utente (zero-knowledge).
- [ ] Risoluzione conflitti per timestamp.

### D.7 — Watchlist potenziata

- [ ] Cartelle/tag custom ("Stasera", "Per i bambini").
- [ ] Smart-list AI ("Cosa vedere se ho 45 min").
- [ ] Watchlist condivisibile tra profili dello stesso device (opt-in).

### D.8 — Parental control rafforzato (estende P8.4)

- [ ] PIN 4-6 cifre con throttling tentativi.
- [ ] Blocco per **rating** (G/PG/PG-13/R/NC-17).
- [ ] Whitelist canali kid-friendly.
- [ ] Limite orario visione (es. no stream 21:00-07:00 per Kids).
- [ ] Report settimanale di visione locale (privacy first).

### D.9 — Statistiche di visione

- [ ] Dashboard locale: ore/settimana, top generi, top canali, heatmap.
- [ ] Export CSV.

### D.10 — Tema OLED + temi custom (estendere)

- [ ] Tema chiaro per uso diurno desktop.
- [ ] Tema auto per orario.
- [ ] Color accent custom (picker hex).

### D.11 — Integrazioni esterne opzionali

- [ ] Trakt.tv scrobbling (OAuth).
- [ ] Discord Rich Presence (Electron only).
- [ ] Last.fm scrobbling per radio.
- [ ] MQTT publish stato player → home automation.

### D.12 — Modalità multistream (PiP avanzato desktop)

- [ ] Mosaic 2×2 / 1+3 (multi-sport).
- [ ] Click su tile = primo piano + audio.
- [ ] Feature flag, Electron only (richiede ~4× banda).

---

## ⚡ E — Performance avanzata

### E.1 — Cold start fini

- [ ] Pre-render Home statica per TTFP Electron < 250 ms.
- [ ] `import.meta.glob` lazy per metadata categories ed engine player.

### E.2 — Rendering React

- [ ] Audit `React.memo` mancanti (ChannelList row, card poster Home).
- [ ] `ProfileService` con `useSyncExternalStore` per evitare re-render
      globali.

### E.4 — Networking

- [ ] Request coalescing in `xtream.ts` (BUG-1 ha già coalescing parziale).
- [ ] Backoff esponenziale unificato (jitter) per Xtream/TMDB/Gemini.
- [ ] HTTP keep-alive in Electron main
      (`https.Agent({ keepAlive: true })`).
- [ ] Prefetch poster appena canale entra in viewport.

### E.5 — Cache & storage

- [ ] Service worker (Vite PWA) per asset statici → avvio offline web.

### E.6 — GPU / smoothness

- [ ] `transform: translateZ(0)` controllato (no abuse `will-change`).
- [ ] Animazioni con `@property` CSS.
- [ ] `content-visibility: auto` su sezioni catalogo non visibili (anche K).

### E.7 — Player

- [ ] Riuso istanza Video.js tra canali (oggi viene ricreata) → meno GC.
- [ ] Pre-buffer canale successivo (1-2 segmenti HLS) opzionale.
- [ ] `hls.js` `maxBufferLength` adattivo in base a banda misurata.

### E.8 — Android specifico

- [ ] `android:hardwareAccelerated` + `largeHeap` verificati per
      Media3 4K HDR.
- [ ] R8 full mode + proguard rules rivisti.
- [ ] SplashScreen Capacitor 7 < 600 ms.

---

## 📊 F — Affidabilità e osservabilità

### F.1 — Telemetria locale opt-in

- [ ] Ring buffer eventi (mem only) consultabile da Settings →
      Diagnostica.
- [ ] Export `diagnostics-bundle.json` sanitizzato.
- [ ] Mai uscire dalla LAN senza consenso esplicito.

### F.2 — Crash reporting Electron

- [ ] `electron.crashReporter` con dump locale (no upload).
- [ ] Pulsante "Apri cartella crash" in About.

### F.4 — Test su rete reale

- [ ] Suite Playwright (Electron headless) per smoke UI.
- [ ] Mock server Xtream locale (`scripts/mock-xtream.mjs`) per CI.

---

## 🔧 G — DX, lint, dependency hygiene

### G.2 — ESLint + Prettier + Husky

- [ ] ESLint 9 flat + React/Hooks/TypeScript + `jsx-a11y`.
- [ ] Prettier con `tailwindcss/prettier-plugin`.
- [ ] Husky + lint-staged → blocca push con errori.

### G.3 — Allineamento documentale

- [ ] Allineare AGENTS.md con i nuovi moduli `services/streamInfo/`.
- [ ] Generare API doc dei service singleton con TypeDoc.

### G.5 — Dependency hygiene

- [ ] `bonjour` → `bonjour-service` (TS, manutenuto). Quick win.
- [ ] `node-ssdp` → fork attivo (`@achingbrain/ssdp` o
      `@homebridge/ssdp`).
- [ ] `castv2-client` → valutare `chromecast-api` o `tls.connect` custom.
- [ ] Audit periodico (vedi P0.1).

---

## ⚡ K — Quick wins (≤ 1 g)

- [ ] Sostituire `bonjour` → `bonjour-service` (G.5).
- [ ] `content-visibility: auto` sui carousel non visibili (E.6).

---

## 📦 PKG-1 — Residui pipeline Linux

> Pipeline completata e in produzione (`§4-ter`). Solo opzionali:

- [ ] **AppImage / tar.xz** in CI (oggi solo locale via
      `npm run dist:linux:appimage` / `:tar`). Riabilitare se serve
      canale portable.
- [ ] **Notarization Windows + `.dmg` macOS** — fuori scope corrente
      (solo Linux). Se aperto, allineare struttura `build/depends/`.
- [ ] **`ci.yml` su PR** — già listato in Sprint 1 (P0 dopo TEST-1).

---

## 📈 Metriche di successo da misurare — `§14`

- [ ] Time-To-First-Paint Electron < 800 ms.
- [ ] Time-To-Interactive con 10k canali < 2 s.
- [ ] Memoria a regime (Electron, 1 live) < 350 MB.
- [ ] FPS scroll catalogo (ChannelList) ≥ 55.
- [ ] Tempo cold start APK Android < 2.5 s.
- [ ] Copertura test `services/` ≥ 50%.
- [ ] Errori non gestiti per sessione (1 h) = 0.
- [ ] Accessibility score (Lighthouse web) ≥ 90.
- [ ] Films section popolata su 5/5 provider reali testati.

Baseline da raccogliere con `scripts/bench-startup.mjs`
(Lighthouse CLI · Electron DevTools Performance · `adb shell am start -W`).

---

## 🧭 Sequenza consigliata (12 settimane) — `§13`

1. **Sprint 0 (3 g):** TEST-1 → BUG-1 smoke → URG-1 smoke su 3 provider.
2. **Sprint 1 (3 g):** P0.1 audit + P0.2 WS + P0.3 IPC + G.4 `ci.yml`.
3. **Sprint 2 (5 g):** REF-1.a + REF-1.b (riportano i due hotspot
   principali sotto soglia).
4. **Settimane 3-4:** D.10 theme switcher esteso · K quick wins.
5. **Settimane 5-6:** D.2 Timeshift · estensione D.1 registrazione.
6. **Settimane 7-8:** D.3 Recording + scheduling EPG · D.4 audio
   tracks + WebVTT HLS + OpenSubtitles · C.5 gesture Android.
7. **Settimane 9-10:** E.1/E.2/E.5/E.7/E.8 performance · **MED-1
   smoke matrix fisica** (richiede device API 26+).
8. **Settimane 11-12:** F.1/F.2 telemetria + crash reporter ·
   D.8 parental esteso · D.11 una integrazione esterna · P7.2
   ESLint/Prettier/Husky completo.
