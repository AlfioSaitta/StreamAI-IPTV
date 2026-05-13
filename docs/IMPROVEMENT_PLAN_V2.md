# StreamAI IPTV — Piano migliorie V2 (usabilità, feature, performance)

> **Documento complementare** a `docs/IMPROVEMENT_PLAN.md`. Quel piano copre già P0→P8
> (sicurezza, bundle, player, casting, UX TV, AI, cache, qualità, feature future).
> Questo V2 raccoglie nuove proposte emerse da un'analisi statica del codice attuale
> (14.104 LOC, focus su file > 700 righe) e dalla revisione delle feature di mercato.
>
> **Ultimo aggiornamento:** 2026-05-13
> **Baseline reale (da package.json):** React **19.2** (aggiornato da 18.2 in
> B.5, 2026-05-13), Vite 5, Electron 37, Capacitor 7, Video.js 8.23,
> hls.js 1.5, mpegts.js 1.7, `@google/genai` 1.34.

---

## Indice

- [A. Analisi sintetica dello stato](#a-analisi-sintetica-dello-stato)
- [🚨 URG-1. Seek VOD bloccante (regressione critica)](#-urg-1-seek-vod-bloccante-regressione-critica)
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

## 🚨 URG-1. Seek VOD bloccante (regressione critica)

> **Priorità: P0 — bloccante per UX VOD.** Segnalato 2026-05-13.
> Cliccando o trascinando la progress bar di un film/serie il player resta
> congelato per molti secondi (a volte > 1 min) finché non termina il
> download fino alla posizione richiesta. Comportamento sistematico su
> tutti i provider Xtream testati. Live non impattato (non ha timeline).

### URG-1.1 Cause radice individuate (analisi codice + comportamento osservato)

Il problema **non** è un singolo bug, ma la combinazione di tre fattori. Tutti
e tre sono confermati leggendo `components/VideoPlayerNew.tsx` (timeline alle
righe ~897-953) e `hooks/useWebPlayerEngine.ts` (config Video.js riga ~156-163).

1. **Bug "seek-storm" da `<input type="range">` invisibile sopra la timeline.**
   La barra di progresso ha **due** elementi sovrapposti che reagiscono al click:
   - un `<div>` con `onClick` che chiama `playerRef.current.currentTime(time)`;
   - un `<input type="range">` (riga 944) con `absolute inset-0 z-10` posizionato
     **sopra** il div, con `onChange={handleSeek}`.

   In tutti i browser Chromium/Firefox, l'`<input type="range">`:
   - **al click** sposta il thumb sulla posizione cliccata e emette `change`
     una volta sola → OK;
   - **al drag** (mousedown → mousemove → mouseup) emette `change` **a ogni
     pixel intermedio**.

   `handleSeek` (riga 343-356) chiama `playerRef.current.currentTime(time)` ad
   ogni evento. Quindi un drag di 200 px sulla timeline scatena **fino a 200
   seek consecutivi**, ognuno dei quali apre/aborta una `Range request` HTTP
   verso il server Xtream. Il `<video>` HTML5 mette in coda i seek e finisce
   per riprodurre solo quando l'ultima richiesta riesce a riempire abbastanza
   buffer attorno alla nuova `currentTime`. Su connessioni lente o server
   Xtream con I/O storage saturo, questo si manifesta come "scarica fino al
   punto cliccato".

   Anche un singolo click apparentemente "stabile" innesca l'`onClick` del div
   **+** il `change` dell'input → due seek allo stesso `time` ravvicinati, e
   l'OSD/UI si desincronizza dal tempo reale.

2. **`preload: 'metadata'` + container mp4 con `moov` a fine file.**
   Molti backend Xtream rispondono per i film con un MP4 il cui atom `moov`
   (la tabella di indicizzazione dei frame) è **alla fine del file** invece
   che all'inizio (manca lo step `qt-faststart` lato server). Con
   `preload: 'metadata'` (riga 161 di `useWebPlayerEngine.ts`) il browser
   scarica solo i primi 64-128 kB, abbastanza per leggere l'`ftyp` ma non
   `moov` → quando l'utente fa seek, il browser **deve** prima scaricare la
   coda del file per imparare a mappare i timestamp ai byte offset. Su un
   film da 4 GB significa scaricare centinaia di MB prima che il seek possa
   atterrare. È esattamente il sintomo riportato dall'utente.

3. **Detection del motore non valida il vero `Content-Type` né il supporto
   `Range`.** `playerUtils.ts::detectStreamSource` per Xtream + tipo `movie`
   / `series` senza estensione assume sempre `mp4 / videojs / preload=metadata`.
   In realtà i provider espongono spesso:
   - `.mkv` reali sotto un URL extensionless → MSE non lo legge nativamente
     e il `<video>` cade in fallback seek-as-download;
   - MPEG-TS muxato senza indici (PCR rotti) → impossibile seek random;
   - server che rispondono con `Accept-Ranges: none` o HTTP 200 anziché 206
     → seek = scarico tutto.
   Non è mai stato fatto un **HEAD probe** per scoprire `Accept-Ranges` reale
   né per leggere `Content-Type` effettivo.

### URG-1.2 Conseguenze osservate

- Drag della timeline = freeze del player per N secondi proporzionale a
  (numero di eventi `change` × RTT al server).
- Click singolo = freeze per secondi (download `moov` o re-buffer dall'inizio
  se Range non onorato).
- `setCurrentTime(time)` aggiorna la UI a una posizione che il player non
  raggiungerà mai → thumb "salta indietro" quando finalmente arriva il `seeked`.
- Su Android (player nativo ExoPlayer) il problema **non** si presenta: lo
  conferma che la causa è lato player web, non lato server (ExoPlayer
  ottimizza Range request e indicizzazione MP4).

### URG-1.3 Soluzione proposta (4 livelli, ROI decrescente)

Implementare in **ordine** — i primi due livelli risolvono già il 90% dei
casi senza modifiche a livello di rete.

> **Stato 2026-05-13:** **Livello 1 e Livello 2 implementati**; del Livello 3
> è stata implementata la parte di degrado UX (OSD warning quando il server
> risponde `Accept-Ranges: none`). La detection completa del MIME reale e il
> remount automatico con engine alternativo restano da fare.

#### Livello 1 — Fix immediato del seek-storm (½ giorno, P0) ✅

- [x] **Rimosso** l'`<input type="range">` invisibile dalla timeline (era la
  causa dei burst di seek durante il drag).
- [x] Scrubbing custom nel hook `useInteractiveTimeline`:
  - `pointerdown` arma la sessione e fa `setPointerCapture`;
  - `pointermove` aggiorna **solo** lo stato locale (`scrubTime` + UI
    ottimistica), **senza** chiamare `player.currentTime()`;
  - `pointerup` chiama `onSeek(finalTime)` **una sola volta**;
  - `pointercancel` annulla senza emettere alcun seek.
- [x] Listener `pointermove` / `pointerup` montati su `window` mentre il
  drag è attivo → la barra continua a tracciare il dito anche se esce
  dal div.
- [x] Thumb visibile e ingrandito durante lo scrubbing; tooltip + ghost bar
  continuano a funzionare.
- [x] `VideoPlayerNew.tsx` espone `performSeek(time)` che usa
  `videoEl.fastSeek?.(time)` quando disponibile (atterraggio sul keyframe
  più vicino, niente decodifica intermedia).
- [x] Display-time della timeline derivato come `isScrubbing ? scrubTime :
  currentTime` → la UI segue il dito invece di "saltare indietro" quando
  arriva il `seeked`.
- [x] Accessibilità preservata: il div ha `role="slider"`, `aria-valuemin/
  max/now/text`, `tabIndex={0}`, e gestione tastiera (←/→ ±5s, PageUp/Down
  ±30s, Home/End estremi).
- [x] Test: `tests/player/scrubbing.test.tsx` (5 test) verifica che un
  drag di 20 `pointermove` emetta **esattamente 1** `onSeek` al
  `pointerup`. Click semplice, pointercancel, right-click ignorato e
  clamping sono coperti.

#### Livello 2 — Faststart sintetico lato client per MP4 con `moov` in coda (1 giorno, P0) ✅

- [x] Nuovo modulo `services/streamInfo/vodProbe.ts` con
  `probeVodSource(url, { prefetchTail })`:
  - HEAD con timeout 4 s → legge `Accept-Ranges`, `Content-Type`, `Content-Length`.
  - Fallback automatico a una tiny GET `Range: bytes=0-1023` quando HEAD
    fallisce o ritorna 405 (alcuni server Xtream non implementano HEAD).
  - Se `Accept-Ranges: bytes` e `Content-Length > 2 MB`, una GET
    `Range: bytes=<L-2MB>-` scarica gli ultimi 2 MB. Il `Response.arrayBuffer()`
    viene letto fino in fondo per **garantire che il browser/Electron
    archivi la coda nella HTTP cache** → al primo seek dell'utente il `moov`
    è già locale.
  - Memoization in-memory (`Map<url, VodProbeResult>`) + coalescing delle
    chiamate concorrenti (`Map<url, Promise>`) → costa zero su riapertura.
- [x] In `useWebPlayerEngine.ts`: per VOD progressivi (`engine === 'videojs'`
  && `type ∈ {movie, series}` && `!isLive`) la sorgente parte con
  `preload: 'auto'` invece di `'metadata'`, in parallelo lancia
  `probeVodSource(...)` fire-and-forget. Live e HLS/mpegts conservano il
  comportamento precedente per non sprecare banda.
- [x] Test: `tests/streamInfo/vodProbe.test.ts` (6 test) — Accept-Ranges
  bytes/none, fallback tiny GET, memoization/coalescing, skip prefetch
  senza content-length, doppio fallimento HEAD+GET.

#### Livello 3 — Probe `Accept-Ranges` + content-type sniffing (1 giorno, P1) ✅

- [x] HEAD probe del Livello 2 espone già `rangeSupport` e `contentType` reali.
- [x] Il risultato del probe è ora propagato dal hook al componente via
  callback `onVodProbeResult`. `VideoPlayerNew.tsx` conserva
  `vodProbe: VodProbeResult | null` per pilotare il rendering condizionale.
- [x] Quando `rangeSupport === 'no'` la **timeline è interamente disabilitata**:
  barra opaca con `aria-disabled`, niente `pointerdown` / `mousemove` / focus,
  banner inline `bg-amber-500/15` con icona di warning. I pulsanti skip ±10s
  e Riparti-dall'inizio sono disabilitati visivamente, e gli shortcut
  tastiera ←/→ vengono ignorati (`usePlayerShortcuts` riceve `seekDisabled`).
- [x] OSD differenziato in base al `Content-Type` reale:
  - `Accept-Ranges: none` → "Server senza Range: seek non disponibile".
  - `video/x-matroska` / `mkv` → "MKV non supportato dal player web — prova
    HLS se disponibile".
  - `video/mp2t` su VOD → "MPEG-TS senza indici: il seek può essere lento".
- [ ] **TODO (futuro)**: usare il `Content-Type` reale per ricomputare l'engine
  al volo (es. MIME = `video/mp2t` su URL extensionless → forzare `mpegts.js`
  invece di `videojs`). Richiede smontaggio del player corrente e rebuild
  dell'effect, non banale; gestire come refactor a parte se i casi reali
  lo giustificano.

#### Livello 4 — Proxy Range intelligente in Electron Main (2-3 giorni, P2, opzionale)

- [ ] Per i casi in cui il server Xtream restituisce 200 invece di 206
  (Range non onorato), introdurre in `main.js` un piccolo proxy interno:
  - intercetta richieste a `loopback:port/proxy?u=<url>`;
  - traduce header `Range` del client in TCP read parziale via
    `electron.net.request`;
  - se il server **non** supporta Range, scarica solo il chunk richiesto
    in streaming, scartando i byte prima dell'offset (workaround "fake
    Range").
- [ ] Solo Electron, dietro feature flag `experimental.rangeProxy`.
- [ ] Non disponibile su Android (Capacitor): in quel caso vale già
  ExoPlayer nativo.

### URG-1.4 Verifica e test

- [ ] Aggiungere `tests/player/scrubbing.test.tsx` (React Testing Library)
  che simula `pointerdown` → 20 × `pointermove` → `pointerup` e asserisce
  **una sola** chiamata a `player.currentTime`.
- [ ] Aggiungere fixture e test su `mp4MoovPrefetch`:
  - mock di `fetch` HEAD che ritorna `Accept-Ranges: bytes` → prefetch eseguito.
  - mock che ritorna `Accept-Ranges: none` → prefetch **non** eseguito,
    `supportsRange` settato a false.
- [ ] Smoke manuale: 3 provider Xtream reali, 3 VOD ciascuno (mp4 faststart,
  mp4 non-faststart, MKV). Misurare tempo da click-seek a `seeked` event.
  Target: **< 1.5 s sul 95° percentile**.

### URG-1.5 Roadmap

Inserire in cima alla roadmap esistente (sezione H) come **Sprint 0** prima
dei work pack già pianificati. Stima totale: **2-3 giorni** (Livelli 1-3).
Livello 4 opzionale, post-fix.

| Step | Effort | Owner | Risultato atteso |
| ---- | ------ | ----- | ---------------- |
| L1 — Fix scrubber | 0.5 g | Player | Drag fluido, niente seek-storm |
| L2 — Moov prefetch | 1 g | Player + StreamInfo | Seek MP4 non-faststart < 2 s |
| L3 — HEAD probe | 1 g | StreamInfo | Detection corretta + UX degradata graceful |
| L4 — Range proxy | 2-3 g (opz) | Electron Main | Compatibilità server non standard |

### URG-1.6 Quick win immediato (se serve un patch in 1 h)

Solo come tampone fino al delivery del Livello 1, **non** è la soluzione
definitiva:

```diff
- onChange={handleSeek}
+ onMouseUp={handleSeek}
+ onTouchEnd={handleSeek}
+ onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
```

Questo limita le chiamate a `currentTime()` solo al rilascio del drag.
Risolve il drag-storm ma **non** il problema del `moov` a fine file
(Livello 2 resta necessario).

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

- [x] Sostituito mega-oggetto con file per-lingua in `services/locales/{it,en,es,fr,de,pt,ru,ja,ko,zh,ar}.ts`.
- [x] Caricamento `import('./locales/...')` dinamico via `loadLanguage()`
  con cache in-memory + coalescing. Solo `it` resta nel bundle iniziale.
- [x] Tooling controllo chiavi mancanti per lingua: `scripts/check-i18n.mjs`
  (validatore drift, exit non-zero su differenze).

**Stato 2026-05-13:** ogni lingua ~1.5–1.85 kB gzip in chunk dedicato,
caricato solo se il profilo seleziona quella lingua. Test 95/95 verdi.
Lo script `check-i18n.mjs` rileva subito ~10 lingue con drift di chiavi
pre-esistenti (debito storico non introdotto dalla split): tracciato come
follow-up di traduzioni separato.

### B.4 Routing dichiarativo

- [x] Stato in `App.tsx` (`activeTab`, `selectedSeries`, `selectedMovie`,
  `showSettings`, `showXtreamModal`, `currentChannel`, `showGuide`,
  `showCommandPalette`, `showCheatsheet`) ora gestito dichiarativamente da
  `hooks/useBackStack.ts`: un unico array di layer top-down con `onClose`
  per layer, `skipEsc` per il player (Esc gestito internamente), `onEmpty`
  per uscita app su Android.
- [x] Rimossi i due `useEffect` ad-hoc (`handleEscape` + `handleBackButton`)
  ⇒ una sola sorgente di verità per l'ordine di chiusura.
- [x] API `topId` / `openIds` esposte: pronte per il companion remote
  (deep-link via path = open layer chain).
- [ ] Eventuale upgrade a micro-router URL-based (`wouter`) rimane
  opzionale: con `useBackStack` il guadagno marginale non giustifica
  l'introduzione di una dipendenza nuova.
- [x] Test `tests/hooks/useBackStack.test.tsx` (6) — Esc/AndroidBack
  parity, skipEsc, onEmpty, top/openIds, ignore Esc in inputs.

### B.5 Upgrade React 18 → 19

- [x] `react@19.2.6`, `react-dom@19.2.6`, `@types/react@19`, `@types/react-dom@19`.
- [x] Adeguati i tipi `RefObject<T>` → `RefObject<T | null>` nei punti che
  passano `useRef(null)` ai consumer (`useTvFocus`, `useInteractiveTimeline`).
- [x] `react-window` 2.x e `video.js` 8.23 compatibili (test + build verdi).
- [~] `use()` hook per data fetching → **non applicabile** ai due hook
  citati: `useMediaMetadata` e `useMediaImages` sono pure derivazioni
  `useMemo` (nessun Promise). `use()` resta a disposizione per future
  feature realmente async; tracciato per quando si introdurranno data
  loader basati su Promise (es. TMDB streaming).
- [x] `useTransition` su filtro CommandPalette: il cambio chip
  (Live/Film/Serie) ora gira in transition → chip highlight + focus
  istantanei, lista risultati ri-renderizzata a bassa priorità con
  `aria-busy` + opacità ridotta come hint visivo. ChannelList già usa
  `useDeferredValue` (E.2): gain ulteriore marginale, lasciato così.
- [x] Form `actions` per `XtreamLogin`: migrato a `useActionState` di
  React 19. Submit handler async wrappato in transizione implicita,
  `isPending` automatico, stato di errore + echo dei valori inseriti
  gestito dal reducer del form. Inputs ora dichiarano `name` per
  `FormData`, `autoComplete` aggiunto per UX (password manager).
  `ProfileSettings` non ha submit (persistenza inline per campo) →
  niente da migrare lì.

**Stato 2026-05-13:** baseline aggiornato. `npm run typecheck`, `npm run test:run`
(95/95), `npm run build` tutti verdi. Bundle main passa da ~146 kB gzip a
~151 kB gzip (+5 kB per le concurrent features di React 19, accettabile).

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

- [x] Cmd/Ctrl+K palette globale: cerca su Live + Movie + Series in un click.
  Implementata in `components/CommandPalette.tsx`, montata in `App.tsx`.
  Apertura via `Ctrl+K` / `⌘K` (anche mentre si digita in input). Hijack
  disabilitato quando il player è in primo piano per non interferire con i
  suoi shortcut.
- [x] Cronologia ricerche recenti per profilo (max 6, persistita su
  `localStorage` con namespace `streamai.cmdk.recent.<profileId>`).
- [x] Highlight match nei risultati (`<mark>` su token normalizzati,
  riusa la normalizzazione di `catalogIndex`).
- [x] Filtri rapidi via chip: Tutto / Live / Film / Serie. `Tab` /
  `Shift+Tab` ciclano i filtri. Navigazione risultati con `↑/↓`,
  `Home/End`, `Enter` per aprire, `Esc` per chiudere.
- [ ] Filtri avanzati: solo HD, solo nuovi, per genere (richiede
  metadata aggiuntivi affidabili sui canali).

### C.4 Continua a guardare migliorato

- [x] Carosello dedicato in Home con progress bar visibile sul poster
  (già presente in `ChannelList.tsx` → `ContentRow` "Continua a guardare"
  + barra rossa al fondo del poster in `ChannelItem`).
- [x] Soglia "completato" configurabile (default 95%) → rimuove dal
  carosello. Preferenza profilo `continueWatchingCompletedThreshold`
  (bound `[0.70, 0.99]`), selettore in ProfileSettings → Riproduzione
  (80 / 85 / 90 / 95 / 98%).
- [x] Episodio successivo auto-play in Series con countdown 10s e tasto
  skip. Implementato come `hooks/useAutoNextEpisode.ts` +
  `components/player/AutoNextOverlay.tsx` (anello di countdown, "Riproduci
  ora" con focus iniziale per TV, "Annulla" per disarmare). Si arma solo
  per `channel.type === 'series'` con `playlist.next` disponibile e non
  Live; si riarma se l'utente fa seek-back > 30s dalla fine. Preferenza
  profilo `autoNextEpisodeEnabled` (default `true`).
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

**Stato attuale:** **Fasi 1, 2 e 3 implementate** (servizio + Mini-EPG nel
player + vista Guide TV completa + promemoria).
Xtream Codes espone `get.php?action=get_short_epg` e file XMLTV via `xmltv.php`.

- [x] Servizio `services/epg/`:
  - [x] Parser XMLTV via regex streaming (evita DOMParser su file > 10 MB),
    decode entità e CDATA, parse offset `+HHMM`.
  - [x] Indice `Map<channelTvgId, EpgProgramme[]>` con purge programmi > 24h
    passati e > 14 giorni futuri.
  - [x] Cache `cacheService` con TTL 6h + fallback a dati stale on network error.
  - [x] Accessor pubblico `getProgrammesForChannel(tvgId)` per consumer batch
    (es. vista Guide TV).
- [x] UI Mini-EPG nel player (overlay `G` su Live):
  - [x] Programma corrente + barra avanzamento (refresh ogni 60s).
  - [x] Prossimi 3 programmi con orario + giorno (Oggi/Domani/data).
  - [x] Pulsante Refresh manuale + auto-rebuild ogni 30 min via hook.
- [x] M3U parser estrae `tvg-id`; Xtream live channels mappano
  `epg_channel_id` → `Channel.tvgId`.
- [x] Vista Guide TV completa (Fase 2) — `components/GuideView.tsx`:
  - [x] Grid canali × ore con virtualizzazione verticale (overscan 4 righe)
    e scroll orizzontale per finestra di 24h centrata su "ora".
  - [x] Header timeline sticky con tick orari e indicatore "ORA" rosso
    sincronizzato (refresh 30s).
  - [x] Colonna canali sticky a sinistra, scroll Y mirrorato verso il body.
  - [x] Filtro per categoria (chip orizzontali) + ricerca canale.
  - [x] Salto rapido al "now" + navigazione giorno (±24h) fino al limite
    della finestra EPG indicizzata (14 giorni).
  - [x] Click programma → menu azioni (Guarda ora / Promemoria), click
    canale → riproduzione immediata.
  - [x] Apertura via tasto `G` globale (quando non in player) o pulsante
    `EPG` mostrato nell'header del tab Live.
- [x] Promemoria programma (Fase 3) — `services/epg/reminderService.ts`:
  - [x] Storage in `localStorage` con purge automatica (> 6h post-programma).
  - [x] Scheduler interno (check ogni 30s) che fa fire 2 minuti prima dello
    start, marcando `fired` per evitare doppi trigger.
  - [x] Notifica nativa via `Notification` API (web/Electron) con permission
    request lazy; click sulla notifica → evento `epg-reminder-clicked`
    intercettato da App.tsx per avviare il canale.
  - [x] Toast in-app sempre visibile (anche senza permission OS) con CTA
    "Guarda" / "Ignora".
  - [x] API `add` / `remove` / `toggle` / `has` / `onFired` con id stabile
    `${channelId}|${start}` per dedup.
  - [ ] Pianificazione registrazione direttamente dal menu programma
    (richiede D.3 Recording).

**Test:**
- `tests/epg/xmltvParser.test.ts` — 11 test (date parsing, entity decoding,
  malformed inputs, document order preservation).
- `tests/epg/reminderService.test.ts` — 5 test (add/remove/toggle, persistenza,
  purge stale, fire scheduler con `vi.useFakeTimers`).

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
- [x] Sottotitoli (MVP, 2026-05-13):
  - [x] Sideload SRT/VTT da disco via file picker.
  - [x] Parser SRT→VTT in `services/subtitleService.ts` (tollerante a
    BOM, CRLF, timestamp con virgola/punto, cue malformate ignorate).
  - [x] `<track>` element iniettato nel `<video>` con `mode='showing'` e
    riprovato al caricamento per browser che ignorano `default` post-mount.
  - [x] UI menu sottotitoli (icona `Subtitles`) con: stato "disattivati",
    sottotitolo attivo (toggle ON/OFF), pulsante "Carica file".
  - [x] OSD feedback su caricamento, toggle, rimozione.
  - [x] Shortcut tastiera `S` (toggle visibilità se già caricato, altrimenti
    apre il menu).
  - [x] Reset automatico al cambio canale/episodio + revoke del Blob URL
    all'unmount per evitare memory leak.
  - [x] Test `tests/player/subtitleService.test.ts` (11 test) su parser
    SRT→VTT, normalise VTT, content sniffing.
- [ ] Sottotitoli WebVTT da HLS embed (lettura tracce in
  `Hls.Events.SUBTITLE_TRACKS_UPDATED`).
- [ ] Ricerca automatica da OpenSubtitles (via API key opzionale).
- [ ] Stile personalizzabile: font, dimensione, sfondo, posizione.
- [ ] Persistenza sottotitolo per profilo/episodio (offset incluso).

### D.5 Audio-only mode + sleep timer + alarm

- [ ] Modalità "Solo audio" per radio IPTV e podcast (riduce CPU/banda).
- [x] Sleep timer (15/30/60/90 min, fine programma EPG) con fade-out.
  Implementato come `hooks/useSleepTimer.ts` +
  `components/player/SleepTimerMenu.tsx`. Menu apribile da pulsante
  Moon nel control bar o shortcut `T`. Preset: 15 / 30 / 60 / 90 min +
  "Fine programma" (solo Live con EPG corrente). Fade-out audio
  configurabile (default 5s) prima del pause hard. Badge animato sul
  pulsante mostra il countdown (Xm / Xs) e il pulsante diventa color
  ambra quando attivo. Esc chiude il menu prima delle altre overlay.
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

- `preferences.theme` esiste già ed è applicato (`theme === 'oled'`
  → class `theme-oled` sul `body`, switcher in ProfileSettings).

- [x] Tema OLED true black (#000) con accenti scuri (classe `.theme-oled`
  in `index.css`, opzione "OLED" in ProfileSettings → Aspetto).
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

- [x] Code splitting via `React.lazy` + `Suspense` in `App.tsx`:
  - `VideoPlayerNew` (video.js + hls.js + mpegts.js) → chunk dedicato
    caricato solo all'avvio playback (~468 kB gzip).
  - `ProfileSettings`, `GuideView`, `MovieDetail`, `SeriesDetail`,
    `AIRecommender`, `XtreamLogin` → chunk dedicati per ciascuna route.
  - Strategia: niente `manualChunks` (rompeva l'ordine di valutazione di
    video.js + plugin in Electron). Vite/Rollup gestisce lo split
    automaticamente, mantenendo il sotto-grafo di video.js in un singolo
    chunk asincrono.
- [x] Risultato: **chunk iniziale 580 → ~95 kB gzip** (`index-*.js`)
  + ~51 kB gzip di vendor common (`index-C1TFRE--.js`) = **~146 kB gzip
  totali al primo paint** vs 580 kB gzip precedenti (**−75%**, target
  < 250 kB raggiunto). Build verificata con `npm run build` e
  `npm run test:run` (62/62).
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

- [x] `cacheService` su IndexedDB — già presente da inizio progetto
  (`STORE_API` + `STORE_IMAGES` con LRU, TTL, quota tracking).
- [x] **Image cache via Cache API** (`caches.open('streamai-images-v1')`) —
  modulo `services/imageCacheApi.ts` (2026-05-13). Strategy:
  - Lettura: memoria → Cache API → IDB legacy → null.
  - Scrittura: Cache API (con fallback IDB se quota o non supportato).
  - LRU custom via header `x-streamai-last-access`, TTL = 30 giorni
    via `x-streamai-cached-at`, cleanup aggressivo ai cambi di pressione storage.
  - `clearImages` / `clearAll` / `hasImages` batch / `cleanupOldImages`
    propagano l'azione su entrambi i tier.
  - Diagnostica esposta in `getStats` (`cacheApiEnabled`, `cacheApiImages`,
    `idbImages`, `gzipEnabled`).
- [x] **Compressione preset cache TMDB con `CompressionStream('gzip')`** —
  modulo `services/gzipUtil.ts` (2026-05-13). `saveApiData` comprime
  payload > 4 KB se il risparmio è > 5%; `getApiData` decomprime
  trasparentemente leggendo il flag `_gz: true`. Compatibilità retro
  garantita con i record legacy `{ timestamp, data }`. Test
  `tests/cache/gzipUtil.test.ts` (5 test): round-trip piccolo/grande,
  saving negligibile, errore su payload corrotto.
- [ ] Service worker per asset statici (Vite PWA plugin) → avvio offline web.
- [ ] Spostare `cacheService` su Dexie wrapper (rinviato: l'API attuale
  è abbastanza piccola; eventualmente con il SW).

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

- [x] Job background ogni 30 min: `player_api.php?action=get_account_info`.
- [x] Badge profilo: scadenza account, banda usata, connessioni attive.
- [x] Alert 7 giorni prima della scadenza.

**Stato 2026-05-12:** implementato in `services/xtream.ts::getXtreamAccountInfo`,
`hooks/useXtreamHealthCheck.ts` e `components/XtreamHealthBadge.tsx`. Mostrato
in `ProfileSettings` quando il profilo ha credenziali Xtream. Soglia
"expiring" a 7 giorni, refresh manuale via pulsante o auto ogni 30 min.

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

### Sprint 0 (urgente, ~3 giorni) — Fix seek VOD bloccante

- [x] URG-1.3 Livello 1 — rimosso `<input type="range">` invisibile,
  scrubbing custom via pointer events in `useInteractiveTimeline`,
  `fastSeek()` + displayTime ottimistico (2026-05-13).
- [x] URG-1.3 Livello 2 — `services/streamInfo/vodProbe.ts` (HEAD probe
  + tail prefetch 2 MB) + `preload=auto` per VOD progressivi (2026-05-13).
- [x] URG-1.3 Livello 3 — disabilitazione interattiva della timeline +
  shortcut tastiera + tasti skip quando il server non supporta Range;
  OSD differenziati per MKV / MPEG-TS reali via Content-Type sniffing
  (2026-05-13). Restano TODO il re-mount con engine alternativo.
- [x] Test `tests/player/scrubbing.test.tsx` (5) +
  `tests/streamInfo/vodProbe.test.ts` (6). Suite passa 73/73.
- [ ] Smoke su 3 provider reali (mp4 faststart, mp4 non-faststart, MKV).

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
| Chunk JS iniziale gzip                 | ~580 kB → ~146 kB ✅ | < 250 kB|
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

- [x] Aggiungere `Shift+/` cheatsheet (C.1).
- [x] Tema OLED (D.10) — classe `.theme-oled` in `index.css` applicata
  via `App.tsx` quando `preferences.theme === 'oled'`; switcher già
  presente in ProfileSettings → Aspetto.
- [x] `useDeferredValue` su ricerca canali (E.2) — applicato in `ChannelList.tsx`
  in aggiunta al debounce esistente (300 ms).
- [x] `structuredClone` al posto di JSON deep clone (E.2) — **N/A**: nessuna
  occorrenza di `JSON.parse(JSON.stringify(...))` trovata nel codebase.
- [x] `aria-label` su tutti i bottoni icon-only (C.6) — completato per
  `VideoPlayerNew` (16 pulsanti del player + range input timeline/volume).
- [x] Tooltip su pulsanti player con scorciatoia (C.1) — `title` arricchito
  con lettera scorciatoia (M, F, P, C, L, ←, →, Spazio, Esc).
- [x] Health-check basic Xtream con badge scadenza in ProfileSettings (F.3).
- [x] Allineare copilot-instructions a React 18 reale (G.3) — fixato sia
  `.github/copilot-instructions.md` sia `AGENTS.md`.
- [ ] Sostituire `bonjour` → `bonjour-service` (G.5).
- [ ] `content-visibility: auto` sui carousel non visibili (E.6).

---

_Per la roadmap "ufficiale" P0–P8 e gli item già completati continuare a
riferirsi a `docs/IMPROVEMENT_PLAN.md`. Questo V2 estende, non sostituisce._

