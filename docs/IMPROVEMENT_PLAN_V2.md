# StreamAI IPTV — Piano migliorie V2 (usabilità, feature, performance)

> **Documento complementare** a `docs/IMPROVEMENT_PLAN.md`. Quel piano copre già P0→P8
> (sicurezza, bundle, player, casting, UX TV, AI, cache, qualità, feature future).
> Questo V2 raccoglie nuove proposte emerse da un'analisi statica del codice attuale
> (14.104 LOC, focus su file > 700 righe) e dalla revisione delle feature di mercato.
>
> **Ultimo aggiornamento:** 2026-05-12
> **Baseline reale (da package.json):** React **18.2** (non 19 come da copilot-instructions),
> Vite 5, Electron 37, Capacitor 7, Video.js 8.23, hls.js 1.5, mpegts.js 1.7, `@google/genai` 1.34.

---

## Indice

- [A. Analisi sintetica dello stato](#a-analisi-sintetica-dello-stato)
- [B. Debt tecnico ad alto impatto](#b-debt-tecnico-ad-alto-impatto)
- [C. Usabilità (UX) — gap residui](#c-usabilità-ux--gap-residui)
- [D. Nuove feature ad alto valore utente](#d-nuove-feature-ad-alto-valore-utente)
- [E. Performance avanzata](#e-performance-avanzata)
- [F. Affidabilità e osservabilità](#f-affidabilità-e-osservabilità)
- [G. Qualità del codice e DX](#g-qualità-del-codice-e-dx)
- [H. Roadmap consigliata (12 settimane)](#h-roadmap-consigliata-12-settimane)
- [I. Metriche di successo](#i-metriche-di-successo)

---

## A. Analisi sintetica dello stato

### Punti di forza già acquisiti

- Architettura cross-platform pulita con `platformService` astratto.
- Custom hooks (`useCastSession`, `useTvFocus`, `useMediaImages`).
- Catalog index memoizzato + virtualizzazione `react-window`.
- AI con caching e circuit breaker.
- Discovery LAN con `AbortController`, concorrenza limitata, TTL cache.
- Player nativo Android (ExoPlayer) con PiP, progress sync, OSD.

### Hotspot di complessità (file > 700 righe)

| File                                | Righe  | Rischio                                     |
| ----------------------------------- | ------ | ------------------------------------------- |
| `services/streamInfoService.ts`     | 2.018  | God-object: parsing HLS/TS/codec/bitrate    |
| `services/i18n.ts`                  | 1.559  | Stringhe inline, niente lazy locale         |
| `components/VideoPlayerNew.tsx`     | 1.542  | Mix Video.js + native + OSD + shortcut + UI |
| `services/deviceDiscovery.ts`       | 956    | Scansione subnet + SSDP + probe TCP         |
| `services/castService.ts`           | 766    | Chromecast + DLNA + AirPlay in unica classe |
| `App.tsx`                           | 749    | Stato globale, routing manuale, refresh BG  |
| `components/ChannelList.tsx`        | 739    | Virtualizzazione + ricerca + filtri         |
| `components/ProfileSettings.tsx`    | 651    | Tab unica con molte sezioni                 |

**Implicazione:** ogni nuova feature aumenta linearmente la fatica di test e regressione.
Refactoring mirato di **VideoPlayerNew** e **streamInfoService** sblocca tutte le tranche
successive (player robusto, multi-audio, EPG, recording).

---

## B. Debt tecnico ad alto impatto

### B.1 Refactor `VideoPlayerNew.tsx` (1542 → ~600 + moduli)

**Obiettivo:** ridurre superficie del componente e renderlo testabile.

- [x] Estrarre `hooks/usePlayerShortcuts.ts` (mapping tastiera P2.3 standard).
- [x] Estrarre `hooks/usePlayerOsd.ts` (toast volume/seek/play).
- [x] Estrarre `hooks/useInteractiveTimeline.ts` (ghost bar, tooltip, scrubbing state).
- [x] Estrarre `hooks/usePlayerMediaSession.ts` (Media Session API metadata + actions + position).
- [x] Estrarre `hooks/useRemoteControl.ts` (IPC Electron remote command bridge).
- [x] Estrarre `components/player/playerTypes.ts` + `playerUtils.ts` (types, formatTime, sanitizeStreamUrl, detectStreamSource, classifyPlaybackError).
- [x] Estrarre `hooks/usePlayerEngine.ts` con strategia (split in due hook gated per piattaforma):
  - [x] `hooks/useWebPlayerEngine.ts` (Video.js + hls.js + mpegts.js)
  - [x] `hooks/useNativePlayerEngine.ts` (Capacitor Video Player / ExoPlayer)
  - Interfaccia: hook prendono `channel + detectedSource + refs + setters + showOsd + scheduleRetry` e gestiscono load/cleanup; no-op sulla piattaforma sbagliata.
- [x] Lasciare in `VideoPlayerNew.tsx` solo composizione UI/OSD + reset state (un piccolo `useEffect` di reset rimane nel componente).

**Beneficio:** ogni engine isolato → fix codec/PiP/recording molto più sicuri.

**Stato 2026-05-12 (completato):** estratti tutti gli hook, le utility pure e
i due engine (`useNativePlayerEngine` 182 righe, `useWebPlayerEngine` 336 righe).
`VideoPlayerNew.tsx` da **1542 → 973 righe (-37% cumulato, -21% in questa tranche)**.
Comportamento invariato: `npm run typecheck`, `npm run test:run` (46/46) e
`npm run build` (Vite 5) tutti verdi. Step opzionale futuro: introdurre una vera
interfaccia `PlayerEngineHandle { play/pause/seek/setVolume/destroy/events }` come
classe Strategy, eliminando il branching `isUsingNativePlayer` nei callback UI.

### B.2 Decomposizione `streamInfoService.ts` (2018 righe)

- [x] Cartella `services/streamInfo/` con:
  - [x] `types.ts` — `StreamCodecInfo` re-exported per backward compat.
  - [x] `codecMap.ts` — `CODEC_MAP`, `H264_PROFILES`, `HEVC_PROFILES`, `AV1_PROFILES`.
  - [x] `codecParser.ts` — `parseCodecString`, `parseCodecList`, `checkCodecSupport`, `checkMediaCapabilities`.
  - [x] `hlsParser.ts` — `analyzeHlsManifestText`, `resolveHlsReference`.
  - [x] `mpegtsProbe.ts` — `isLikelyMpegTs`, `mapMpegTsStreamType`, `analyzeMpegTsProgramMap`.
  - [x] `videoBytesAnalyzer.ts` — `analyzeVideoBytes` (NAL/OBU/VP9 sniff).
  - [x] `index.ts` come facade/barrel.
- [x] Spostare regex/heuristics in funzioni dedicate con named export.
- [ ] Test unitari `vitest` su sample manifest reali (mock fixture) — pianificato G.1.

**Stato 2026-05-12:** `services/streamInfoService.ts` da **2018 → 1313 righe (−35%)**.
Nessuna API pubblica rotta (`streamInfoService`, `StreamCodecInfo`, `analyzeVideoBytes`
re-esportati). `npm run typecheck`, `npm run build`, test metadata/catalog index e smoke
Electron passati senza errori.

### B.3 i18n lazy + struttura per chiavi

- [ ] Sostituire mega-oggetto con file per-lingua in `locales/{it,en,es}.json`.
- [ ] Caricamento `import('./locales/...')` dinamico → riduce chunk iniziale di ~80–150 kB.
- [ ] Tooling controllo chiavi mancanti per lingua (`scripts/check-i18n.mjs`).

### B.4 Routing dichiarativo

- [ ] Stato corrente in `App.tsx` (`activeTab`, `selectedSeries`, `selectedMovie`,
      `showSettings`, `showXtreamModal`, `currentChannel`) è gestito a mano con
      4 livelli di back-stack: rischio bug Back/Esc.
- [ ] Introdurre micro-router (es. `wouter` 2 kB, oppure stato `View[]` con reducer).
- [ ] Permette deep-link per il companion remote (P8.1).

### B.5 Upgrade React 18 → 19

Le copilot-instructions citano React 19 ma `package.json` ha 18.2.
React 19 abilita:

- [ ] `use()` hook per data fetching → semplifica `useMediaMetadata`/`useMediaImages`.
- [ ] `useTransition` automatico su input → ricerca canali ancora più reattiva.
- [ ] Form `actions` per ProfileSettings/XtreamLogin.
- [ ] Verifica compatibilità: `react-window` 2.x, `video.js` 8.23 OK; `@google/genai` OK.

---

## C. Usabilità (UX) — gap residui

### C.1 Discoverability scorciatoie

- [ ] Overlay `?` o `Shift+/` con cheatsheet completa raggruppata
      (Player / Navigazione / Cast / Profilo).
- [ ] Mostrare cheatsheet al primo avvio profilo, poi `Non mostrare più`.
- [ ] Tooltip su pulsanti player con scorciatoia (`F` = Fullscreen).

### C.2 Onboarding profilo

- [ ] Wizard 3 step al primo avvio: nome+avatar → fonte M3U/Xtream → preferenze (lingua, AI).
- [ ] Test di connettività Xtream in tempo reale con feedback visivo.
- [ ] Import lista da URL pubblico (M3U remoto) come alternativa a Xtream Codes.

### C.3 Ricerca globale

- [ ] Cmd/Ctrl+K palette globale: cerca su Live + Movie + Series in un click.
- [ ] Cronologia ricerche recenti per profilo.
- [ ] Highlight match nei risultati.
- [ ] Filtri rapidi: solo HD, solo nuovi, genere.

### C.4 Continua a guardare migliorato

- [ ] Carosello dedicato in Home con progress bar visibile sul poster.
- [ ] Soglia "completato" configurabile (default 95%) → rimuove da carosello.
- [ ] Episodio successivo auto-play in Series con countdown 10s e tasto skip.
- [ ] Sincronizza progress tra Desktop e Android (vedi D.6 cloud sync opzionale).

### C.5 Gesture touch Android

- [ ] Swipe verticale sinistra = luminosità, destra = volume (overlay OSD).
- [ ] Doppio tap left/right = -10s / +10s con animazione ripple.
- [ ] Pinch fullscreen ↔ aspect ratio toggle.

### C.6 Accessibilità

- [ ] Audit `aria-label` su tutti i pulsanti icon-only (`lucide-react` senza label).
- [ ] Focus ring contrastato e largo per low-vision (`outline 3px` + offset).
- [ ] Modalità "Riduci animazioni" rispettando `prefers-reduced-motion`.
- [ ] Modalità daltonici: palette alternativa per badge (HD/Live/Premium).
- [ ] Font size selezionabile (Small/Medium/Large/Extra) in ProfileSettings.

### C.7 Lingua per profilo, davvero

- [ ] Estendere `i18n` per lazy-load locale del profilo attivo (vedi B.3).
- [ ] Cambio lingua a caldo senza reload.
- [ ] Locale data/ora corretto (`Intl.DateTimeFormat`).

---

## D. Nuove feature ad alto valore utente

### D.1 EPG (Electronic Program Guide)

**Stato attuale:** assente. Xtream Codes espone `get.php?action=get_short_epg` e
file XMLTV via `xmltv.php`.

- [ ] Servizio `services/epg.ts`:
  - Fetch XMLTV gzip, parse SAX streaming (evitare memoria spike su file 50 MB).
  - Indice `Map<channelTvgId, ProgrammeList>` con purge programmi > 24h passati.
  - Cache su `cacheService` con TTL 6h, refresh background.
- [ ] UI Mini-EPG nel player (overlay `i` o `Up` su Live):
  - Programma corrente + barra avanzamento.
  - Prossimi 3 programmi.
- [ ] Vista Guide TV completa:
  - Grid canali × ore con scroll virtualizzato verticale e orizzontale.
  - Selezione "ora" sticky in alto.
- [ ] Promemoria programma: notifica nativa Electron/Android 2 minuti prima.

### D.2 Timeshift / Catch-up TV

Molti provider Xtream supportano `timeshift/<user>/<pass>/<duration>/<start>/<id>.ts`.

- [ ] Detect supporto: `user_info.allowed_output_formats` + flag profilo.
- [ ] UI: tasti `←/→` su Live retrocedono fino a N ore se supportato dal provider.
- [ ] Indicatore "Live edge" e jump-to-live (`Home` key).
- [ ] Buffer locale ring (es. 30 min) per micro-rewind anche senza timeshift server-side.

### D.3 Registrazione stream (Desktop)

- [ ] Pulsante `R` sul player Live/VOD: avvia dump segmento via Electron
      (Node `https.get` → file `.ts`/`.mp4`).
- [ ] Job manager con stato (avvio, durata, dimensione, completato, errore).
- [ ] Pianificazione registrazioni da EPG (al click su programma futuro).
- [ ] Cartella configurabile in ProfileSettings.
- [ ] Solo Electron, non disponibile in Web/Android (capacity flag).

### D.4 Multi-audio e sottotitoli

- [ ] Esporre tracce audio HLS (`AudioTrackList` di Video.js).
- [ ] Selettore lingua audio in OSD (`A`).
- [ ] Sottotitoli:
  - WebVTT da HLS embed.
  - Sideload SRT/VTT da disco (drag-drop o file picker).
  - Ricerca automatica da OpenSubtitles (via API key opzionale).
- [ ] Stile personalizzabile: font, dimensione, sfondo, posizione.

### D.5 Audio-only mode + sleep timer + alarm

- [ ] Modalità "Solo audio" per radio IPTV e podcast (riduce CPU/banda).
- [ ] Sleep timer (15/30/60/90 min, fine programma EPG) con fade-out.
- [ ] Sveglia: avvia canale X a ora Y (Electron usa `node-schedule`).

### D.6 Sync cloud opzionale (BYOC)

- [ ] Provider plug-in: WebDAV / Nextcloud / Dropbox / iCloud Drive.
- [ ] Sincronizza: profili (senza credenziali in chiaro), history, watchlist, EPG reminders.
- [ ] Cifratura AES-GCM con passphrase utente (zero-knowledge).
- [ ] Risoluzione conflitti per timestamp.

### D.7 Watchlist potenziata

- [ ] Cartelle/tag personalizzati ("Da vedere stasera", "Per i bambini").
- [ ] Smart-list AI: "Cosa vedere se ho 45 minuti", "Film simili a X".
- [ ] Watchlist condivisibile tra profili dello stesso device (opt-in).

### D.8 Parental control rafforzato (estensione P8.4)

- [ ] PIN 4-6 cifre con throttling tentativi.
- [ ] Blocco per **rating** (G/PG/PG-13/R/NC-17), non solo categorie.
- [ ] Whitelist canali kid-friendly.
- [ ] Limite orario di visione (es. nessuno stream tra 21:00-07:00 per profilo Kids).
- [ ] Report settimanale di visione per profilo (locale, privacy first).

### D.9 Statistiche di visione

- [ ] Dashboard locale: ore viste/settimana, top generi, top canali.
- [ ] Heatmap orari di visione.
- [ ] Export CSV per chi vuole portarsele altrove.

### D.10 Tema OLED + temi custom

- `preferences.theme` esiste ma non viene usato.

- [ ] Tema OLED true black (#000) con accenti viola.
- [ ] Tema chiaro (per uso diurno desktop).
- [ ] Tema auto per orario.
- [ ] Color accent custom (picker hex).

### D.11 Integrazioni esterne opzionali

- [ ] Trakt.tv scrobbling (movie/series) con OAuth.
- [ ] Discord Rich Presence (Electron) — desktop only.
- [ ] Last.fm scrobbling per canali radio.
- [ ] MQTT publish stato player → home automation.

### D.12 Modalità multistream (PiP avanzato desktop)

- [ ] Mosaic 2×2 / 1+3 di canali live (es. multi-sport).
- [ ] Click su tile = porta in primo piano e ruba l'audio.
- [ ] Solo Electron, dietro feature flag (richiede ~4× banda).

---

## E. Performance avanzata

### E.1 Bundle e cold start

- [ ] Confermare/applicare `manualChunks` (vedi P1.1 esistente) con split misurato:
  - `react-vendor`, `videojs-vendor`, `mpegts-hls`, `genai`, `lucide`, `i18n-it/en/es`.
- [ ] Pre-render route iniziale (Home) come HTML statico in `dist/index.html` per
      Time-To-First-Paint Electron < 250 ms.
- [ ] `import.meta.glob` lazy per categorie metadati ed engine player.
- [ ] Verifica trade-off: `lucide-react` import puntuale vs `lucide-react/icons/*`
      (gain stimato 20–40 kB minificato).

### E.2 Rendering React

- [ ] Audit `React.memo` mancanti:
  - `ChannelList` row component (verificare prop stability).
  - Card poster in carosello Home.
- [ ] `useDeferredValue` su input ricerca (no flicker su 10k canali).
- [ ] Sostituire `JSON.parse(JSON.stringify(...))` con `structuredClone` (più veloce e tipato).
- [ ] Profile session con `useSyncExternalStore` per `ProfileService` → evita re-render globale.

### E.3 Web Worker pipeline

- [ ] Worker `playlistWorker.ts` per parse M3U > 5 MB e build `catalogIndex`.
- [ ] Worker `epgWorker.ts` per parse XMLTV streaming.
- [ ] Worker `metadataWorker.ts` per fuzzy matching TMDB in batch.

### E.4 Networking

- [ ] Request coalescing in `xtream.ts`: stesse query parallele riusano la stessa Promise.
- [ ] Backoff esponenziale unificato (jitter) per Xtream/TMDB/Gemini.
- [ ] HTTP keep-alive in Electron main (`https.Agent({ keepAlive: true })`)
      per probing discovery e TMDB.
- [ ] Prefetch poster appena un canale entra in viewport (gestito da `useMediaImages`,
      verificarne il debounce).

### E.5 Cache e storage

- [ ] Spostare `cacheService` su IndexedDB (Dexie wrapper opzionale, 2 kB).
- [ ] Image cache via Cache API (`caches.open('streamai-images')`) con strategia
      stale-while-revalidate, già supportata in service worker.
- [ ] Service worker per asset statici (Vite PWA plugin) → avvio offline web.
- [ ] Compressione preset cache TMDB con `CompressionStream('gzip')` (riduce ~70%).

### E.6 GPU acceleration / smoothness

- [ ] `transform: translateZ(0)` controllato su poster e timeline (no abuse di will-change).
- [ ] Animazioni con `@property` CSS per evitare re-layout.
- [ ] `content-visibility: auto` su sezioni catalogo non visibili.

### E.7 Player

- [ ] Riusare l'istanza Video.js tra canali (oggi viene ricreata) → meno GC.
- [ ] Pre-buffer del canale successivo nella lista (1–2 segmenti HLS) opzionale.
- [ ] Reset hls.js con `config.maxBufferLength` adattivo in base a banda misurata.

### E.8 Android specifico

- [ ] `android:hardwareAccelerated="true"` confermato e `largeHeap` per ExoPlayer su 4K.
- [ ] AGP/Gradle JVM args ottimizzati nel `gradle.properties` (già 4G heap).
- [ ] R8 full mode + proguard rules rivisti per `lucide-react`/Capacitor.
- [ ] Splash screen rapido (Capacitor 7 supporta `SplashScreen` config) — < 600 ms.

---

## F. Affidabilità e osservabilità

### F.1 Telemetria locale opt-in

- [ ] Ring buffer eventi (mem only) consultabile da `ProfileSettings → Diagnostica`.
- [ ] Export `diagnostics-bundle.json`: log, versioni, capability, ultimi errori
      (sanitizzato — niente URL stream completi).
- [ ] Mai uscire dalla LAN senza consenso esplicito utente.

### F.2 Crash reporting Electron

- [ ] `electron.crashReporter` configurato per dump locale (no upload).
- [ ] Pulsante "Apri cartella crash" in About.

### F.3 Health-check periodico provider Xtream

- [ ] Job background ogni 30 min: `player_api.php?action=get_account_info`.
- [ ] Badge profilo: scadenza account, banda usata, connessioni attive.
- [ ] Alert 7 giorni prima della scadenza.

### F.4 Test su rete reale

- [ ] Suite Playwright (Electron headless) per smoke navigazione UI.
- [ ] Mock server Xtream locale (`scripts/mock-xtream.mjs`) per CI.

---

## G. Qualità del codice e DX

### G.1 Test automatici (riprendere P7.1)

- [x] `vitest` + `jsdom` installati (`vitest@3.2.4`, `jsdom@25.0.1`, save-exact).
- [x] Config `vitest.config.ts` con env `node` di default + opt-in `jsdom` per-file.
- [x] Script `test`, `test:run` aggiunti; `check` esteso a `typecheck && test:run && build`.
- [x] Coverage target iniziale su moduli puri estratti in B.1/B.2:
  - [x] `tests/streamInfo/codecParser.test.ts` — 13 test (H.264/HEVC/AV1/VP9/AAC/Dolby Vision).
  - [x] `tests/streamInfo/hlsParser.test.ts` — 5 test (manifest master/media, resolve URI).
  - [x] `tests/streamInfo/mpegtsProbe.test.ts` — 13 test (sync byte, stream_type, PAT+PMT minimal sample).
  - [x] `tests/player/playerUtils.test.ts` — 15 test (`formatTime`, `sanitizeStreamUrl`, `detectStreamSource` con mock `hls.js`/`mpegts.js`).
- [ ] `@testing-library/react` + snapshot UI critici (`ChannelList`, `ProfileSelection`).
- [ ] Test parser M3U, ProfileService, CacheService, i18n shape, Xtream URL helper.
- [ ] Mock test discovery/cast service.
- [ ] Coverage minimo 50% su `services/`.

**Stato 2026-05-12:** 46 test verdi (4 file), runtime test ~1 s. `npm run check`
ora include typecheck + test + build. Esempi:

```bash
npm test           # watch mode
npm run test:run   # single run
npm run check      # typecheck + test:run + build
```

### G.2 ESLint + Prettier + Husky

- [ ] Config flat ESLint 9 + plugin React/Hooks/TypeScript.
- [ ] `eslint-plugin-jsx-a11y` per A11y (collegato a C.6).
- [ ] Prettier con `tailwindcss/prettier-plugin` per ordering classi.
- [ ] Husky + lint-staged: blocca push con errori.

### G.3 Allineamento documentale

- [ ] Aggiornare `copilot-instructions.md`: React **18** non 19 (oppure aggiornare deps).
- [ ] Allineare AGENTS.md con i nuovi moduli `services/streamInfo/`.
- [ ] Generare API doc dei service singleton con TypeDoc.

### G.4 CI GitHub Actions

- [ ] Workflow `ci.yml`: typecheck + lint + test + build Vite + smoke Electron 10s.
- [ ] Workflow `android.yml`: build APK debug su PR (artefatto scaricabile).
- [ ] Workflow release: tag → build Linux tar.gz + Android APK firmato (secret-based).

### G.5 Dependency hygiene

- [ ] Sostituire `bonjour` (non aggiornato dal 2018) con `bonjour-service` (TS, manutenuto).
- [ ] Valutare `node-ssdp` → fork attivo (`@achingbrain/ssdp` o `@homebridge/ssdp`).
- [ ] `castv2-client` → valutare `chromecast-api` o implementazione TLS via `tls.connect`.
- [ ] Audit periodico `npm audit` (già in P0.1).

---

## H. Roadmap consigliata (12 settimane)

Ogni tranche = 1–2 settimane. Le tranche sono ordinate per ROI e per minimizzare
conflitti con il piano esistente.

### Settimane 1–2 — Foundation refactor

- B.1 split `VideoPlayerNew` (engine pluggable).
- B.2 split `streamInfoService`.
- G.1 `vitest` + primi test su engine e streamInfo.

### Settimane 3–4 — UX win rapidi

- C.1 cheatsheet shortcut.
- C.2 onboarding wizard.
- C.3 Cmd+K palette globale.
- C.4 continua a guardare + auto-next.
- D.10 tema OLED + theme switcher.

### Settimane 5–6 — EPG + Timeshift

- D.1 EPG (servizio + mini-EPG nel player + Guide TV).
- D.2 Timeshift base con detection capability.
- E.3 worker per XMLTV.

### Settimane 7–8 — Multi-audio/sub + Registrazione

- D.4 audio tracks, subtitles WebVTT, sideload SRT.
- D.3 recording Electron + scheduling da EPG.
- C.5 gesture Android.

### Settimane 9–10 — Performance e bundle

- E.1 manualChunks + i18n lazy (B.3).
- E.2 audit memo + `useDeferredValue`.
- E.5 IndexedDB + Cache API immagini.
- B.5 valutazione upgrade React 19.

### Settimane 11–12 — Reliability + nuove integrazioni

- F.1/F.2 diagnostica + crash reporter.
- F.3 health-check Xtream + alert scadenza.
- D.8 parental control esteso.
- D.11 una integrazione esterna (Trakt o Discord RPC) come dimostrazione.
- G.4 CI GitHub Actions completa.

---

## I. Metriche di successo

| Metrica                                | Baseline (stimata) | Target  |
| -------------------------------------- | ------------------ | ------- |
| Chunk JS iniziale gzip                 | > 500 kB           | < 250 kB|
| Time-To-First-Paint Electron           | n/a                | < 800 ms|
| Time-To-Interactive con 10k canali     | n/a                | < 2 s   |
| Memoria a regime (Electron, 1 live)    | n/a                | < 350 MB|
| FPS scroll catalogo (ChannelList)      | n/a                | ≥ 55    |
| Tempo cold start APK Android           | n/a                | < 2.5 s |
| Copertura test `services/`             | 0%                 | ≥ 50%   |
| Errori non gestiti per sessione (1h)   | n/a                | 0       |
| Accessibility score (Lighthouse web)   | n/a                | ≥ 90    |

Le baseline `n/a` vanno misurate in tranche 0 con uno script
`scripts/bench-startup.mjs` (Lighthouse CLI per la versione web; Electron
DevTools Performance per desktop; `adb shell am start -W` per Android).

---

## J. Note di sicurezza/privacy trasversali

- Tutte le feature D.* non devono esfiltrare dati senza opt-in esplicito.
- Le credenziali Xtream restano sempre cifrate at-rest (vedi P8.3 esistente).
- Telemetria sempre **locale** salvo bug report manuale.
- Parental control e statistiche di visione **non escono mai** dal device.

---

## K. Quick wins (≤ 1 giorno ciascuno)

Lista isolata per chi vuole un primo PR rapido:

- [ ] Aggiungere `Shift+/` cheatsheet (C.1).
- [ ] Tema OLED (D.10) — solo CSS variable swap.
- [ ] `useDeferredValue` su ricerca canali (E.2).
- [ ] `structuredClone` al posto di JSON deep clone (E.2).
- [ ] `aria-label` su tutti i bottoni icon-only (C.6).
- [ ] Tooltip su pulsanti player con scorciatoia (C.1).
- [ ] Health-check basic Xtream con badge scadenza in ProfileSettings (F.3).
- [ ] Allineare copilot-instructions a React 18 reale (G.3).
- [ ] Sostituire `bonjour` → `bonjour-service` (G.5).
- [ ] `content-visibility: auto` sui carousel non visibili (E.6).

---

_Per la roadmap "ufficiale" P0–P8 e gli item già completati continuare a
riferirsi a `docs/IMPROVEMENT_PLAN.md`. Questo V2 estende, non sostituisce._

