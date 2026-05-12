# StreamAI IPTV - Piano miglioramenti, ottimizzazioni e roadmap

> Documento operativo revisionabile.
> Usare le checkbox `- [ ]` / `- [x]` per segnare avanzamento, completamento o attività da verificare.

**Ultimo aggiornamento:** 2026-05-12
**Baseline progetto:** React 18, TypeScript, Vite, Electron, Capacitor Android, Video.js, ExoPlayer, Tailwind CSS, Gemini AI, casting/discovery LAN.
**File chiave:** `App.tsx`, `main.js`, `preload.js`, `components/VideoPlayerNew.tsx`, `services/deviceDiscovery.ts`, `services/advertisingService.js`, `services/geminiService.ts`, `services/nativeVideoPlayer.ts`, `vite.config.ts`, `package.json`.

---

## 1. Stato verificato / già completato

Questa sezione registra la baseline tecnica già raggiunta, così da non perdere contesto durante le prossime tranche.

- [x] Rimosse chiavi API hardcoded dai sorgenti principali.
- [x] Aggiunta configurazione `.env.example` per `VITE_GEMINI_API_KEY` e `VITE_TMDB_API_KEY`.
- [x] Aggiornato `.gitignore` per escludere `.env`, keystore, APK/AAB e asset Android generati.
- [x] Rimosso dal versionamento `android/streamai-release.keystore`.
- [x] Hardening minimo Electron: modalità insicura dietro `STREAMAI_INSECURE_ELECTRON`.
- [x] Hardening minimo Android: debug WebView dietro `STREAMAI_ANDROID_DEBUG`.
- [x] Script release Android senza password hardcoded.
- [x] Aggiunti script qualità `typecheck` e `check`.
- [x] `npm run typecheck` verificato OK.
- [x] `npm run check` verificato OK.
- [x] Fix runtime Electron: `bonjour`, `node-ssdp` e `ws` risolvibili correttamente.
- [x] Smoke test `npm run start` verificato senza crash `Cannot find module 'bonjour'`.
- [x] Corretto socket UDP broadcast in `main.js` per evitare `setBroadcast EBADF`.
- [x] README aggiornato con configurazione API, release Android e note sicurezza.

### Verifiche baseline

```bash
npm run typecheck
npm run check
npm run start
```

---

## 2. Convenzioni di gestione del piano

Usare questi stati nelle checkbox:

- `[ ]` Da fare.
- `[x]` Completato.
- `[ ] Da verificare:` implementato ma non ancora testato su piattaforma target.
- `[ ] Bloccato:` richiede decisione, device fisico, credenziali o dipendenza esterna.
- `[ ] Opzionale:` miglioramento utile ma non prioritario.

Per ogni tranche idealmente chiudere con:

- [ ] `npm run typecheck` OK.
- [ ] `npm run build` OK.
- [ ] `npm run check` OK.
- [ ] Smoke test Electron se tocca `main.js`, `preload.js`, `services/advertisingService.js` o networking.
- [ ] Build/test Android se tocca `capacitor.config.ts`, `android/`, `services/nativeVideoPlayer.ts` o player mobile.
- [ ] Aggiornamento README/documentazione se cambia comportamento utente o setup.

---

# Roadmap prioritaria

---

## P0 - Sicurezza e stabilità immediata

### P0.1 Triage vulnerabilità `npm audit`

**Obiettivo:** ridurre rischio supply-chain senza rompere Electron, Capacitor o il player.

- [ ] Eseguire audit completo.
- [ ] Eseguire audit solo runtime.
- [ ] Classificare vulnerabilità per severità e contesto: runtime, dev-only, transitive, non sfruttabili.
- [ ] Aggiornare dipendenze dirette non breaking.
- [ ] Valutare `overrides` in `package.json` solo per transitive non aggiornabili.
- [ ] Evitare `npm audit fix --force` salvo tranche dedicata e test completa.
- [ ] Verificare CVE di pacchetti networking: `bonjour`, `node-ssdp`, `ws`, `castv2-client`.
- [ ] Documentare vulnerabilità residue accettate e motivazione.

**Comandi:**

```bash
npm audit
npm audit --omit=dev
npm outdated
npm run check
```

**Criteri di completamento:**

- [ ] Nessuna vulnerabilità critica runtime nota senza ticket/mitigazione.
- [ ] Lockfile aggiornato in modo riproducibile.
- [ ] `npm run check` OK.
- [ ] `npm run start` smoke OK se cambiano dipendenze Electron/runtime.

---

### P0.2 Hardening WebSocket remote control

**File principali:** `main.js`, `preload.js`, eventuale UI futura remote companion.

**Rischio attuale:** se il server WebSocket è esposto in LAN senza autenticazione, un device sulla rete potrebbe inviare comandi non autorizzati.

- [ ] Mappare tutte le azioni remote supportate.
- [ ] Definire schema payload ammesso per ogni azione.
- [ ] Rifiutare payload con campi extra o tipi non validi.
- [ ] Aggiungere token locale generato all'avvio.
- [ ] Aggiungere pairing con PIN o QR code prima di accettare comandi.
- [ ] Rate limit per client/IP.
- [ ] Chiudere connessioni malformate o troppo rumorose.
- [ ] Evitare log di URL stream completi, credenziali o payload sensibili.
- [ ] Aggiungere test/manual smoke con client WebSocket locale.

**Criteri di completamento:**

- [ ] Un client non autenticato non può controllare il player.
- [ ] I comandi sconosciuti vengono ignorati e loggati a livello debug/warn.
- [ ] Nessuna regressione su controllo locale Electron.

---

### P0.3 Validazione IPC Electron

**File principali:** `main.js`, `preload.js`, `services/deviceDiscovery.ts`, `hooks/useCastSession.ts`.

- [ ] Elencare tutte le API esposte da `preload.js`.
- [ ] Verificare che ogni API abbia handler `ipcMain.handle` / `ipcMain.on` corrispondente.
- [ ] Validare input per IP, porte, URL stream, protocollo e payload cast.
- [ ] Normalizzare errori IPC in risposte strutturate.
- [ ] Ridurre superficie pubblica del bridge esponendo solo ciò che serve davvero.
- [ ] Mantenere `contextIsolation: true` e `nodeIntegration: false`.

**Criteri di completamento:**

- [ ] Nessuna API preload senza handler main.
- [ ] Nessun input non validato prima di chiamate network/native.
- [ ] Errori gestiti senza crash main process.

---

## P1 - Performance bundle e avvio

### P1.1 Riduzione chunk Vite > 500 kB

**Problema osservato:** Vite segnala chunk grandi dopo la build.

**File principali:** `vite.config.ts`, `App.tsx`, componenti UI pesanti.

- [ ] Aggiungere bundle analyzer.
- [ ] Misurare peso reale dei chunk prima delle modifiche.
- [ ] Separare chunk React/vendor.
- [ ] Separare chunk player: `video.js`, `@videojs/http-streaming`, `mpegts.js`, `hls.js`.
- [ ] Separare chunk AI: `@google/genai`.
- [ ] Separare chunk Capacitor/native se possibile.
- [ ] Separare chunk icone se `lucide-react` pesa troppo.
- [ ] Valutare lazy loading CSS Video.js solo quando serve.

**Comandi:**

```bash
npm run build
# dopo aggiunta analyzer, esempio:
npm run analyze
```

**Criteri di completamento:**

- [ ] Chunk iniziale sensibilmente più piccolo.
- [ ] Player caricato solo quando serve.
- [ ] Nessuna regressione su `npm run check`.
- [ ] Avvio Electron più rapido o invariato.

---

### P1.2 Lazy loading schermate pesanti

**File principali:** `App.tsx`, `components/VideoPlayerNew.tsx`, `components/MovieDetail.tsx`, `components/SeriesDetail.tsx`, `components/AIRecommender.tsx`, `components/ProfileSettings.tsx`, `components/CastDevicePicker.tsx`.

- [ ] Convertire `VideoPlayerNew` a `React.lazy` dove sicuro.
- [ ] Convertire `MovieDetail` a `React.lazy`.
- [ ] Convertire `SeriesDetail` a `React.lazy`.
- [ ] Convertire `AIRecommender` a `React.lazy`.
- [ ] Convertire `ProfileSettings` a `React.lazy`.
- [ ] Convertire `XtreamLogin` a `React.lazy`.
- [ ] Aggiungere fallback coerenti con tema scuro e UI TV.
- [ ] Verificare che shortcut, focus e back navigation non regrediscano.

**Criteri di completamento:**

- [ ] La home iniziale non carica subito player/AI/dettagli se non necessari.
- [ ] Nessun flicker importante durante transizioni.
- [ ] `tv-focus` preservato.

---

## P2 - Player Desktop/Android

### P2.1 Error handling stream più diagnostico

**File principali:** `components/VideoPlayerNew.tsx`, `services/streamInfoService.ts`.

- [x] Distinguere errori HTTP `401/403`, `404`, timeout, codec, sorgente non supportata e manifest HLS fatali.
- [x] Mostrare messaggi utente chiari e azioni possibili.
- [x] Aggiungere pulsante `Riprova`.
- [x] Aggiungere sezione `Dettagli tecnici` per debug con URL sanitizzato.
- [x] Aggiungere OSD per retry, errori e recupero errore.
- [x] Aggiungere retry esponenziale leggero con limite massimo.
- [x] Evitare loop infinito su stream non valido.

**Criteri di completamento:**

- [x] Errore codec diverso da errore rete.
- [x] L'utente può riprovare senza uscire dal player.
- [x] Debug overlay/Info stream mostra informazioni utili senza esporre segreti.

---

### P2.2 PiP Android e player nativo

**File principali:** `services/nativeVideoPlayer.ts`, `components/VideoPlayerNew.tsx`, `capacitor.config.ts`, progetto `android/`.

- [x] Implementato lato Android: `MainActivity` configura `PictureInPictureParams`, `autoEnterEnabled`/`seamlessResize` su Android 12+ e ingresso PiP sicuro da `onUserLeaveHint` su Android 8+.
- [x] Implementato lato UI: pulsante PiP nativo dietro capability `nativeVideoPlayer.supportsPiP`, disabilitato se il device/plugin non lo supporta.
- [x] Implementato lato player: play/pausa, seek, volume, mute e riavvio inoltrati anche al player nativo quando `platformService.isNative` è attivo.
- [x] Implementato lato codice: salvataggio/ripristino progresso da ExoPlayer tramite eventi nativi, polling fallback e seek da `initialProgress`.
- [x] Implementato lato codice: retry/error handling nativo con OSD e dettagli tecnici coerenti con desktop.
- [x] Predisposta verifica: PiP reale su device Android fisico/emulatore API 26+ con checklist sotto.
- [x] Predisposta verifica: gestione tasto Home e ritorno in app con checklist sotto.
- [x] Predisposta verifica: comportamento audio/background con checklist sotto.
- [x] Aggiungere capability flag `supportsPiP` o equivalente.
- [x] Tenere PiP dietro capability/fallback sicuro se instabile.
- [x] Documentare device/API level testati e limiti ambiente corrente.

**Criteri di completamento:**

- [x] Lato codice: PiP Android è configurato solo su API supportate e non deve crashare su Android < 8.
- [x] Lato codice: uscita/ritorno PiP mantiene stato player via eventi nativi + polling fallback.
- [x] Lato codice: errori Capacitor/native player vengono intercettati e mostrati con retry.

**Checklist verifica manuale Android (release gate):**

- [ ] Eseguire con JDK 17 completo (`java` + `javac`) e Android SDK: `npm run android:build`.
- [ ] Installare su almeno un device fisico Android 8+ oppure emulatore API 26+ con Play Services/codec adeguati.
- [ ] Avviare un canale live, premere Home e verificare ingresso PiP senza crash.
- [ ] Tornare in app dal PiP e verificare che posizione, stato play/pausa e audio siano coerenti.
- [ ] Ripetere con VOD/serie e con stream HEVC/H.265 se disponibile.
- [ ] Annotare qui device/API level/risultato prima del rilascio.

**Nota verifica locale 2026-05-12:** presente un emulatore ADB (`emulator-5554`), ma l'ambiente corrente espone solo Java 25 runtime e non `javac`; la build Android completa richiede JDK 17. Il comando `npm run android:build` ha superato Vite build e `npx cap sync android` (plugin rilevati: `@capacitor/app`, `capacitor-video-player`), poi Gradle si è fermato con `Unsupported class file major version 69`. Sono stati verificati `npm run typecheck`, `npm run build` e la presenza delle dipendenze runtime Electron `bonjour`/`node-ssdp`. La verifica fisica/manuale resta gate di rilascio, non dichiarata come test eseguito in questa sessione.

---

### P2.3 Fallback player e codec

- [x] Migliorare detection protocollo: `.m3u8`, `.ts`, MP4, WebM, DASH e Xtream senza estensione.
- [x] Fallback HLS.js/Video.js/mpegts quando applicabile.
- [x] Messaggio specifico per HEVC/H.265 non supportato.
- [x] Popup info stream: parsing migliorato per HLS `CODECS` e MPEG-TS PAT/PMT per ridurre codec video/audio `Non rilevato` sugli stream live.
- [x] Predisposta verifica: test manuale su stream live, VOD e serie reali con checklist P2.2/P2.3.
- [x] Preservare shortcut e OSD in ogni fallback.

---

## P3 - Casting, discovery e rete locale

### P3.1 Discovery meno aggressiva e cancellabile

**File principali:** `services/deviceDiscovery.ts`, `components/CastDevicePicker.tsx`.

- [ ] Introdurre `AbortController` per annullare scansioni.
- [ ] Limitare concorrenza scansione subnet `/24`.
- [ ] Aggiungere timeout configurabili per probe.
- [ ] Deduplicare dispositivi per IP/protocollo/nome.
- [ ] Cache TTL dei dispositivi trovati.
- [ ] Mostrare progress UI durante scansione.
- [ ] Evitare di considerare `WebSocket.onerror` come device trovato senza probe ulteriore.
- [ ] Preferire risultati mDNS/SSDP/DIAL affidabili quando disponibili.

**Criteri di completamento:**

- [ ] Scansione cancellabile da UI.
- [ ] UI non bloccata durante discovery.
- [ ] Meno falsi positivi.

---

### P3.2 Casting più robusto

**File principali:** `hooks/useCastSession.ts`, `services/castService.ts`, `services/deviceDiscovery.ts`, `components/CastDevicePicker.tsx`.

- [ ] Stato connessione più esplicito: connecting, connected, buffering, error, disconnected.
- [ ] Retry controllato per cast load.
- [ ] Timeout per connect/load/control.
- [ ] Messaggi diversi per device offline, protocollo non supportato, stream rifiutato.
- [ ] UI `Nessun dispositivo trovato` con suggerimenti LAN.
- [ ] Test manuali su Chromecast/DLNA se disponibili.

---

### P3.3 Advertising service production-safe

**File principali:** `services/advertisingService.js`, `main.js`.

- [ ] Gestire errori mDNS/SSDP senza crash.
- [ ] Evitare porte hardcoded non configurabili se occupate.
- [ ] Retry o fallback porta per HTTP DIAL.
- [ ] Log con livelli e modalità debug.
- [ ] Verificare shutdown pulito su `will-quit`.

---

## P4 - UX TV, telecomando e Android

### P4.1 Focus management TV

**File principali:** `App.tsx`, `components/ChannelList.tsx`, `components/MovieDetail.tsx`, `components/SeriesDetail.tsx`, `components/ProfileSettings.tsx`, `components/CastDevicePicker.tsx`.

- [ ] Definire focus iniziale per ogni schermata.
- [ ] Ripristinare focus dopo chiusura modale.
- [ ] Focus trap nei modali.
- [ ] Gestione coerente di `Esc`.
- [ ] Gestione coerente tasto Back Android.
- [ ] Evidenza visiva più forte per `.tv-focus`.
- [ ] Test navigazione senza mouse.

**Criteri di completamento:**

- [ ] Tutte le schermate principali utilizzabili da tastiera/telecomando.
- [ ] Nessun focus perso dopo cambio schermata o modale.

---

### P4.2 Stati vuoti, loading ed errori

- [ ] Schermata nessun canale.
- [ ] Schermata server Xtream non raggiungibile.
- [ ] Messaggio credenziali errate/scadute.
- [ ] Stato TMDB non configurato.
- [ ] Stato Gemini non configurato.
- [ ] Stato nessun device cast trovato.
- [ ] Skeleton loading per poster e righe catalogo.
- [ ] Retry visibile per operazioni fallite.

---

### P4.3 Ottimizzazioni Android/TV box

- [ ] Layout landscape ottimizzato.
- [ ] Controlli touch più grandi.
- [ ] Gestione safe area/notch.
- [ ] Riduzione overlay HTML sopra player nativo se crea problemi.
- [ ] Profilo prestazioni per TV box Android meno potenti.
- [ ] Documentare device testati.

---

## P5 - AI, metadata e catalogo

### P5.1 Gemini più contestuale

**File principali:** `services/geminiService.ts`, `components/AIRecommender.tsx`, `services/cacheService.ts`.

- [ ] Prompt diversi per Live, Movies e Series.
- [ ] Includere lingua profilo.
- [ ] Includere cronologia recente.
- [ ] Includere generi preferiti.
- [ ] Evitare suggerimenti già visti di recente.
- [ ] Limitare numero titoli inviati a Gemini.
- [ ] Ranking locale prima della chiamata AI.
- [ ] Mostrare stato `AI non configurata` quando manca chiave.
- [ ] Mostrare stato `AI sospesa` se circuit breaker attivo.

---

### P5.2 Cache AI e TMDB

- [ ] TTL cache Gemini.
- [ ] Invalidation se cambia profilo.
- [ ] Invalidation se cambia lingua.
- [ ] Limite dimensione cache.
- [ ] Pulsante `Svuota cache AI`.
- [ ] Cache TMDB con TTL.
- [ ] Evitare chiamate TMDB duplicate.
- [ ] Fallback lingua TMDB.

---

### P5.3 Matching metadata più accurato

**File principale:** `services/metadata.ts`.

- [ ] Migliorare pulizia titoli IPTV.
- [ ] Gestire anno nel match.
- [ ] Fuzzy matching leggero.
- [ ] Gestire titoli multi-lingua.
- [ ] Evitare falsi positivi con titoli corti.
- [ ] Test unitari su casi reali.

---

### P5.4 Sincronizzazione catalogo Xtream

**File principali:** `App.tsx`, `components/ProfileSettings.tsx`, `services/profileService.ts`, `services/xtream.ts`, `types.ts`.

- [x] Aggiungere nelle impostazioni un tasto `Riscarica lista` che bypassa la cache e richiama il server Xtream.
- [x] Aggiornare in memoria Live, VOD e Series senza riavviare l'app dopo refresh manuale.
- [x] Salvare nel profilo timestamp ultimo refresh riuscito ed eventuale ultimo errore.
- [x] Aggiungere opzione profilo per abilitare/disabilitare aggiornamento catalogo in background.
- [x] Aggiungere selezione frequenza: 1h, 3h, 6h, 12h, 24h.
- [x] Eseguire aggiornamento background senza bloccare UI e senza mostrare loader globale.
- [x] Evitare refresh concorrenti con lock in memoria.
- [x] Non eseguire refresh background se il browser risulta offline.
- [x] Preservare `tv-focus` nella nuova UI impostazioni.
- [x] Aggiornare README con comportamento e note operative.

**Criteri di completamento:**

- [x] `npm run typecheck` OK.
- [x] `npm run build` OK.
- [x] Profili esistenti ricevono i default tramite merge in `ProfileService.getAll`.
- [x] Il refresh manuale forza `loginXtream(creds, true)` e aggiorna la cache contenuti.
- [x] La frequenza è salvata nelle preferenze profilo e letta dallo scheduler.

**Note operative:**

- Il refresh automatico parte dopo almeno 30 secondi dall'attivazione/apertura app se il catalogo è già scaduto, poi segue la frequenza selezionata.
- La verifica con server reale richiede credenziali Xtream valide; in assenza di provider, sono stati validati compilazione e flusso applicativo lato codice.

---

## P6 - Performance catalogo e immagini

### P6.1 Ricerca indicizzata

- [ ] Precomputare `cleanNameLower`, `groupLower`, `genreLower`, `year`.
- [ ] Debounce input ricerca.
- [ ] Evitare filtri costosi a ogni render.
- [ ] Valutare Web Worker per playlist enormi.
- [ ] Test su catalogo grande.

---

### P6.2 Virtualizzazione avanzata

**File principale:** `components/ChannelList.tsx`.

- [ ] Verificare performance con migliaia di VOD.
- [ ] Virtualizzare righe orizzontali se necessario.
- [ ] Paginazione per categoria.
- [ ] Lazy image più aggressivo.
- [ ] Skeleton poster.

---

### P6.3 Cache immagini con policy

**File principale:** `services/cacheService.ts`.

- [ ] Definire limite massimo cache immagini.
- [ ] TTL immagini.
- [ ] Cleanup automatico vecchie immagini.
- [ ] Statistiche cache in UI impostazioni.
- [ ] Pulsante svuota cache immagini.
- [ ] Gestione quota storage esaurita.

---

## P7 - Qualità tecnica e test

### P7.1 Test automatici

- [ ] Aggiungere `vitest`.
- [ ] Test parser M3U.
- [ ] Test normalizzazione titoli.
- [ ] Test profile service.
- [ ] Test cache service.
- [ ] Test metadata matching.
- [ ] Test i18n shape.
- [ ] Test helper Xtream URL.
- [ ] Mock test discovery/cast service.

**Script suggeriti:**

```json
{
  "test": "vitest",
  "test:run": "vitest run"
}
```

---

### P7.2 Lint e validazione CI locale

- [ ] Aggiungere ESLint.
- [ ] Regole React Hooks.
- [ ] Regole TypeScript.
- [ ] Regola/no custom check per segreti hardcoded.
- [ ] Script `lint`.
- [ ] Script `validate`.

**Script suggeriti:**

```json
{
  "lint": "eslint .",
  "validate": "npm run typecheck && npm run lint && npm run build"
}
```

---

### P7.3 Smoke test Electron

- [ ] Script smoke start con timeout.
- [ ] Verifica log assenza `Uncaught Exception`.
- [ ] Verifica log assenza `Cannot find module`.
- [ ] Verifica advertising service start/stop.
- [ ] Verifica WebSocket server start/stop.

**Esempio comando manuale:**

```bash
timeout 20s npm run start
```

---

## P8 - Feature future ad alto valore

### P8.1 Companion remote da smartphone

- [ ] Pagina locale protetta da PIN/QR.
- [ ] Pairing tra app desktop e smartphone.
- [ ] Play/pausa, volume, seek, canale successivo.
- [ ] Ricerca canali da smartphone.
- [ ] Stato player live.
- [ ] Autenticazione obbligatoria.

---

### P8.2 Diagnostica stream

- [ ] Schermata `Info stream`.
- [ ] Codec video/audio.
- [ ] Risoluzione.
- [ ] Bitrate stimato.
- [ ] Protocollo.
- [ ] Buffer health.
- [ ] Errori recenti.
- [ ] URL redatto/parzialmente nascosto.

---

### P8.3 Backup/import profili

- [ ] Export profili JSON.
- [ ] Import profili JSON.
- [ ] Cifratura opzionale con password.
- [ ] Esclusione/mascheramento credenziali se richiesto.
- [ ] Migrazione desktop ↔ Android.

---

### P8.4 Parental control / profilo Kids

- [ ] PIN profilo.
- [ ] Blocco categorie.
- [ ] Filtro gruppi adult.
- [ ] Modalità bambini.
- [ ] Nascondi contenuti maturi.

---

# Sequenza consigliata delle prossime tranche

## Tranche A - Sicurezza runtime

- [ ] `npm audit` triage.
- [ ] Fix/override dipendenze non breaking.
- [ ] Hardening WebSocket remote control.
- [ ] Validazione IPC Electron.
- [ ] Smoke test Electron.

## Tranche B - Performance bundle

- [ ] Bundle analyzer.
- [ ] `React.lazy` su schermate pesanti.
- [ ] `manualChunks` in Vite.
- [ ] Lazy import player/AI.
- [ ] Confronto dimensioni bundle prima/dopo.

## Tranche C - Player robusto

- [ ] Errori diagnostici.
- [ ] Retry/fallback stream.
- [ ] Miglioramento PiP Android.
- [ ] Resume progress Android/Desktop.
- [ ] Debug overlay avanzato.

## Tranche D - Casting/discovery

- [ ] Discovery cancellabile.
- [ ] Deduplica device.
- [ ] Timeout e retry.
- [ ] UI stati discovery.
- [ ] Test manuale su device reali.

## Tranche E - UX TV/Android

- [ ] Focus manager.
- [ ] Back/Esc coerenti.
- [ ] Modali navigabili.
- [ ] Stati vuoti/errore.
- [ ] Layout TV box/Android.

## Tranche F - AI e metadata

- [ ] Prompt contestuali.
- [ ] Cache AI con TTL.
- [ ] TMDB fuzzy matching.
- [ ] Ranking locale + AI.
- [ ] Suggerimenti spiegabili.

---

# Checklist pre-merge per ogni tranche

- [ ] `git status` pulito o modifiche attese.
- [ ] Nessun `.env` reale nello staging.
- [ ] Nessun `*.keystore`, `*.jks`, APK/AAB nello staging.
- [ ] Nessun asset Android generato nello staging.
- [ ] Nessuna chiave API hardcoded.
- [ ] `npm run typecheck` OK.
- [ ] `npm run check` OK.
- [ ] Smoke Electron OK se tocca runtime desktop.
- [ ] Android sync/build OK se tocca mobile.
- [ ] README/documentazione aggiornata se cambia comportamento.

---

# Comandi utili

```bash
# Stato repo
git status --short

# TypeScript
npm run typecheck

# TypeScript + build
npm run check

# Build web
npm run build

# Avvio Electron
npm run start

# Smoke start controllato
timeout 20s npm run start

# Android sync
npm run android:sync

# Android debug build
npm run android:build

# Audit
npm audit
npm audit --omit=dev
```

---

# Note operative

- Le funzionalità identitarie da preservare sempre sono: PiP, casting/discovery, controllo tastiera/telecomando, OSD e UI coerente cross-platform.
- Evitare modifiche invasive simultanee a player, casting e Android nella stessa tranche.
- Preferire PR/commit piccoli, con verifica chiara.
- Ogni feature che tocca rete locale deve essere considerata anche dal punto di vista sicurezza.
- Ogni feature che tocca player deve essere testata almeno su Live, VOD e Series.

