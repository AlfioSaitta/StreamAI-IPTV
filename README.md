# 📺 StreamAI IPTV Player

[![CI](https://github.com/AlfioSaitta/StreamAI-IPTV/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfioSaitta/StreamAI-IPTV/actions/workflows/ci.yml)

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 19**, **TypeScript**, **Tailwind CSS** e un runtime desktop **Wails v3** (Go). Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui contenuti basate sulle preferenze dell'utente, e per un ecosistema di networking avanzato per il casting e il controllo remoto.

> 🚀 **Desktop Runtime: Wails v3.** Il backend desktop è un'applicazione nativa in Go (Wails v3) con Service specializzati per discovery, advertising, cast, remote/WebSocket, netstatus, proxy e un player nativo basato su **libmpv**. Electron è stato rimosso completamente in favore di questa nuova architettura più leggera e performante. Lo stato di avanzamento e i dettagli tecnici sono tracciati in [`docs/plan-go-wails-migration.md`](docs/plan-go-wails-migration.md).

---

## ✨ Funzionalità Principali

### 🎬 Riproduzione Avanzata
- **Live TV**: Streaming live con zapping veloce e buffering ottimizzato.
- **Movies (VOD)**: Film on-demand con seeking fluido, timeline interattiva e anteprima al passaggio del mouse.
- **Series**: Episodi con navigazione tra stagioni e puntate, e salvataggio automatico del progresso.
- **Codec HEVC/H.265**: Supporto nativo per video 4K decodificati via hardware tramite **libmpv** (su Desktop) e **AndroidX Media3** (su Android).
- **Player Nativo (Android)**: Utilizzo del player di sistema basato su **AndroidX Media3 1.10.1** (ExoPlayer di nuova generazione) per massime prestazioni su mobile.
- **OSD (On-Screen Display)**: Feedback visivo immediato per volume, seeking, play/pausa e stato buffer.
- **Diagnostica stream**: classificazione errori HTTP/codec/timeout, retry controllato e pannello “Info stream” con URL sanitizzato, protocollo, engine, codec video/audio e dati qualità quando disponibili.
- **Fallback multi-engine**: libmpv (Desktop), AndroidX Media3 (Android), HLS.js, MPEG-TS (`mpegts.js`) e Video.js (Web/Fallback) vengono scelti automaticamente in base a protocollo, estensione e piattaforma.

### 📡 Networking & Casting
- **Casting Universale**: Trasmissione su Chromecast, dispositivi DLNA/UPnP e AirPlay.
- **Device Discovery**: Scansione rete locale cancellabile, con concorrenza limitata, progress UI, cache TTL, deduplica IP/protocollo e minori falsi positivi.
- **Advertising Service**: L'app si annuncia sulla rete tramite mDNS (Bonjour), SSDP e DIAL con porta configurabile/fallback, rendendosi visibile come target di casting per altre app. Nel runtime Wails v3 è implementato come Service Go (`internal/services/advertising/`) con annunci `_airplay._tcp`, `_raop._tcp`, `_googlecast._tcp`, `_dial._tcp` + UPnP `MediaRenderer:1` / DIAL `device:1`.
- **Controllo Remoto**: WebSocket server (porta dinamica, broadcast UDP del descrittore) e bridge stato playback ↔ AI/UI implementati come Service Go `remote` + `netstatus` (Fase 4 della migrazione Wails).

### 🤖 AI Assistant
- **Ricerca intelligente**: Chiedi all'AI cosa vuoi guardare con linguaggio naturale.
- **Raccomandazioni personalizzate**: Basate sulla cronologia di visione e preferenze.
- **Suggerimenti contestuali**: Diversi per Live, Movies e Series.
- **Caching Intelligente**: Risposte AI salvate localmente per ridurre latenza e costi API.

### 👤 Profili Utente
- **Onboarding guidato**: wizard a 3 step (identità → fonte contenuti → preferenze) con scelta avatar/colore, **test connessione Xtream in tempo reale** e **import M3U remoto** (validazione `#EXTM3U` + conteggio canali).
- **Multi-profilo**: Supporto per più utenti con preferenze separate.
- **Cronologia separata**: Ogni profilo mantiene la propria cronologia di visione.
- **Progresso salvato**: Riprendi esattamente da dove avevi interrotto.
- **Continua a guardare per-tipo**: toggle indipendenti per Film e Serie (default: Serie ON, Film OFF), così l'utente sceglie cosa tenere "in sospeso".
- **AI hint dismissibile**: il banner "AI non configurata" si chiude da solo dopo 8 s, può essere chiuso con `X` o silenziato in modo permanente tramite checkbox "Non mostrare più".
- **Catalogo aggiornabile**: da Impostazioni puoi riscaricare manualmente Live/VOD/Serie dal server Xtream e abilitare l'aggiornamento automatico in background con frequenza configurabile.
- **Ordine gruppi Live preservato**: per la sezione Live i gruppi sono mostrati nello stesso ordine restituito dal server Xtream (l'ordinamento alfabetico resta solo su Film/Serie).

### 🔧 Ottimizzazioni Tecniche
- **Virtualizzazione Liste**: Rendering efficiente per playlist con migliaia di canali (react-window).
- **Memoization**: Riduzione drastica dei re-render inutili per fluidità UI.
- **Web Worker pipeline**: parsing M3U pesanti (>256 kB) e indicizzazione catalogo in background tramite worker, così il main thread resta reattivo durante gli aggiornamenti playlist.
- **Buffering differenziato**: Configurazioni separate per Live/VOD/Series.
- **Cache immagini**: Download intelligente delle copertine per risparmio banda.
- **Avvio rapido**: Streaming ottimizzato per partenza immediata.
- **Network Monitor**: Visualizzazione velocità di rete e stato buffer in tempo reale (Debug Overlay).

### 🕹️ UX TV, telecomando e Android
- **Focus TV centralizzato**: schermate principali, modali, dettagli film/serie, impostazioni, login Xtream e menu cast hanno focus iniziale e navigazione con frecce.
- **Focus trap nei modali**: `Esc` chiude overlay/menu coerentemente e il focus torna all'elemento precedente quando possibile.
- **Stati vuoti/errore espliciti**: catalogo vuoto, nessun risultato, server Xtream non raggiungibile, credenziali errate/scadute, TMDB/Gemini non configurati e nessun device cast trovato hanno messaggi e azioni visibili.
- **Android/TV box**: **modalità landscape immersiva forzata** (lock `sensorLandscape`, status/navigation bar nascoste con swipe-to-reveal transient, contenuto edge-to-edge sotto il notch via `windowLayoutInDisplayCutoutMode=shortEdges`), safe-area/notch, target touch più grandi, shell dedicata per player nativo e profilo low-power che riduce blur/animazioni su device meno potenti.

---

## 🚀 Requisiti

- **Node.js**: v18+ (per build e sviluppo frontend)
- **Go**: 1.25+ (per la build del runtime Wails v3)
- **libmpv**: installata sul sistema (per la riproduzione video desktop)
- **Sistema Operativo**: Linux (Ubuntu, Debian, Fedora, Arch, openSUSE), Windows (WebView2), macOS
- **npm**: v9+

---

## 🛠 Installazione

```bash
# Clona il repository
git clone <repository-url>
cd streamai-iptv

# Installa le dipendenze
npm install

# Configura le variabili locali opzionali
cp .env.example .env
```

### Dipendenze di sistema (Linux)
Assicurati di avere `libmpv` e le librerie di sviluppo GTK/WebKitGTK installate.
Per Ubuntu/Debian:
```bash
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev libmpv-dev
```

---

## ▶️ Avvio

### Modalità Sviluppo (Desktop)
```bash
# Avvia con Wails v3 (hot reload)
npm run dev
```

### Build Produzione
```bash
# Genera i pacchetti Linux (.deb, .rpm, .pkg.tar.zst)
npm run dist:linux

# Solo build binario locale
npm run wails:build
```

Gli artefatti finiscono in `dist/packages/` con l'hash del commit nel nome:
`streamai-iptv_${version}_${commit}_amd64.${ext}`

Esempio: `streamai-iptv_1.0.0_276ee32_amd64.deb`. La versione proviene dal file `.version` (singola fonte di verità) ed è propagata in `package.json` e `android/app/build.gradle` da `npm run version:sync`.

Se `GPG_KEY_ID` è impostato in ambiente, ogni pacchetto viene firmato automaticamente.

### Release automatiche (GitHub Actions)
Un push di tag `v*` attiva il workflow che:
1. Costruisce i pacchetti per Linux (.deb, .rpm, .pkg.tar.zst) usando `nfpm`.
2. Firma i pacchetti con GPG.
3. Crea la GitHub Release e aggiorna il repository statico su GitHub Pages.

Per provisionare i secret GPG sul repository (`GPG_PRIVATE_KEY`,
`GPG_PASSPHRASE`, `GPG_KEY_ID`) usa lo helper:

```bash
npm run gpg:setup    # solo la prima volta: genera la chiave + backup AES-256
npm run gpg:upload   # invia i secret cifrati via `gh` CLI (libsodium)
```

---

## 📱 Build Android

StreamAI supporta la build per dispositivi Android tramite **Capacitor**.

### Requisiti Android
- **JDK 17+**: Java Development Kit (non solo JRE)
- **Android Studio** (opzionale, ma consigliato)
- **Android SDK**: API level 22+ (Android 5.1+)

### Installazione JDK (Linux)
```bash
# Ubuntu/Debian
sudo apt install openjdk-17-jdk

# Fedora/RHEL
sudo dnf install java-17-openjdk-devel

# openSUSE
sudo zypper install java-17-openjdk-devel
```

### Comandi Build Android

```bash
# Sincronizza i file web con il progetto Android
npm run android:sync

# Apri il progetto in Android Studio
npm run android:open

# Build APK Debug (direttamente da terminale)
npm run android:build

# Build APK Release (firmato)
npm run android:build:release

# Build e avvia su dispositivo/emulatore connesso
npm run android:run
```

### Output APK
- **Debug**: `android/app/build/outputs/apk/debug/app-debug.apk`
- **Release firmata**: `android/app/build/outputs/apk/release/StreamAI-IPTV.apk`

### Firma Android Release

Lo script `scripts/android-build-release.sh` non contiene password hardcoded. Configura i segreti tramite variabili ambiente:

```bash
export STREAMAI_ANDROID_KEYSTORE_FILE="/percorso/streamai-release.keystore"
export STREAMAI_ANDROID_KEYSTORE_ALIAS="streamai"
export STREAMAI_ANDROID_KEYSTORE_PASSWORD="password-keystore"
export STREAMAI_ANDROID_KEY_PASSWORD="password-chiave"
npm run android:build:release
```

Se devi generare un nuovo keystore locale, abilitalo esplicitamente:

```bash
export STREAMAI_ANDROID_GENERATE_KEYSTORE=1
npm run android:build:release
```

I file `*.keystore`, `*.jks`, APK/AAB e gli asset Android generati sono esclusi dal versionamento.

### Funzionalità Android
- ✅ Streaming Live/VOD/Series
- ✅ Player nativo basato su **AndroidX Media3 1.10.1** (tramite il plugin `capacitor-video-player` vendorato in `android/plugins/`) per prestazioni superiori
- ✅ Picture-in-Picture su Android 8+ / API 26+ quando supportato dal device
- ✅ Fullscreen
- ✅ Supporto HTTP cleartext per stream IPTV
- ✅ Deep link `streamai://`
- ❌ Casting (solo su Electron per ora)
- ❌ Download locale (solo su Electron)

### Verifica Android consigliata

Per validare le funzionalità P2 del player nativo serve un JDK completo, non solo il runtime Java. Verifica prima che siano disponibili sia `java` sia `javac`:

```bash
java -version
javac -version
```

Poi esegui:

```bash
npm run android:build
npm run android:run
```

Checklist minima su device fisico o emulatore API 26+:

1. Avvia un canale live e verifica partenza, audio e controlli nativi.
2. Premi Home: se il device supporta PiP, il player deve entrare in Picture-in-Picture senza crash.
3. Rientra nell'app dal PiP e verifica che stato play/pausa, audio e progresso siano coerenti.
4. Ripeti con VOD/serie e, se disponibile, con stream HEVC/H.265.
5. Apri “Info stream” e verifica codec video/audio, container, protocollo e supporto decodifica.

Nota: in ambienti senza JDK 17 completo o senza device fisico la build/test Android completa non è rappresentativa; in quel caso usare `npm run typecheck` e `npm run build` come validazione web/Electron e rimandare il collaudo Android a hardware reale.

---

## ⌨️ Scorciatoie da Tastiera

L'applicazione è completamente controllabile via tastiera per un'esperienza "Lean-back" (TV).

| Tasto | Azione |
|-------|--------|
| `Spazio` / `Invio` / `P` | Play/Pausa |
| `←` / `→` | Seeking -/+ 10 secondi |
| `↑` / `↓` | Volume +/- 10% |
| `M` | Mute/Unmute |
| `F` | Fullscreen Toggle |
| `C` | Menu Casting (Dispositivi) |
| `L` | Mostra/Nascondi Playlist (Live/Serie) |
| `Esc` | Indietro / Chiudi menu / Esci da Fullscreen |

### Stato migrazione Wails v3

La rotta da Electron a Wails v3 (Go) è descritta in `docs/plan-go-wails-migration.md` (rev. 6). Per usare la build Wails localmente vedi [`docs/wails-quickstart.md`](docs/wails-quickstart.md). Stato corrente (2026-05-22):

| Fase | Ambito | Stato |
|------|--------|-------|
| 1 | Bootstrap Wails v3 + restructure `frontend/` + go:embed | ✅ |
| 2 | Discovery Service (Go) + sostituzione `deviceDiscovery.ts` | ✅ |
| 2-bis | Advertising mDNS/SSDP + DIAL HTTP receiver + ServiceStartup hooks | ✅ |
| 3 | Cast Service (castv2 Go + DLNA SOAP + AirPlay) | ✅ |
| 4 | Remote WebSocket + UDP broadcast + Netstatus bridge | ✅ |
| 5 | Proxy stream (TLS skip, header rewrite, cleartext) | ✅ |
| 6 | Player nativo libmpv → canvas WebGL2 (HwAccelInfo ✅, SPIKE-1 smoke ✅; render-context + zero-copy ⏳) | ◐ |
| 7 | Compat layer `hostBridge` + 54 metodi Wails binding TS | ✅ |
| 7-bis | Lifecycle (single-instance, tray, MPRIS2, crashguard, powersave) | ✅ |
| 8 | Packaging Wails per-distro + firma GPG | ☐ |
| 9 | Rimozione `main.js` / `preload.js` Electron | ☐ |
| 10 | E2E test casting cross-vendor + collaudo TV box | ☐ |

Binario Wails attuale: ~19 MB, cold-start ~140 ms (vs ~2-3 s Electron). Libmpv 2.5.0 + VA-API/NVDEC verificati funzionanti sul dev host (vedi [`docs/spike1-results-2026-05-22.md`](docs/spike1-results-2026-05-22.md)).

Per i dettagli implementativi e l'inventario completo Electron → Wails (43 voci E1–E43) consulta [`docs/plan-go-wails-migration.md`](docs/plan-go-wails-migration.md).

### Navigazione TV/telecomando

- Le frecce direzionali spostano il focus tra elementi `tv-focus` visibili nella schermata corrente.
- Nei modali, il focus resta intrappolato nel pannello aperto; `Tab` cicla gli elementi e `Esc` chiude il pannello dove consentito.
- I controlli principali del player, del menu cast, delle impostazioni e dei dettagli contenuto hanno target minimi adatti a telecomando/touch.
- Su Android il tasto fisico **Back** chiude player, dettagli, impostazioni o login prima di tornare alla Home/uscire dall'app.

---

## 🔐 Configurazione API e sicurezza

Le chiavi API non devono essere inserite nel codice sorgente. Copia `.env.example` in `.env` e valorizza solo le chiavi che vuoi usare:

```bash
VITE_GEMINI_API_KEY="tua-chiave-gemini"
VITE_TMDB_API_KEY="tua-chiave-tmdb"
```

Variabili opzionali di hardening/debug:

```bash
# Abilita fallback Electron meno restrittivi solo per provider IPTV problematici
STREAMAI_INSECURE_ELECTRON=1

# Abilita debug WebView Android durante lo sviluppo
STREAMAI_ANDROID_DEBUG=true

# Porta base per HTTP DIAL/advertising LAN Electron (fallback automatico se occupata)
STREAMAI_ADVERTISING_PORT=8090
```

---

## 📁 Struttura Progetto

Il repository è organizzato per supportare contemporaneamente il runtime **Electron** (legacy) e il runtime **Wails v3** (in arrivo). Il frontend React vive in `frontend/`, il backend Go in `cmd/` + `internal/`.

```
streamai-iptv/
├── frontend/                       # React 19 + Vite + Tailwind (UI only)
│   ├── App.tsx / index.tsx / index.html / types.ts
│   ├── components/                 # Componenti React (VideoPlayerNew, ChannelList, …)
│   ├── services/                   # Logica business (geminiService, xtream, deviceDiscovery, …)
│   ├── hooks/ contexts/ public/ tests/
│   └── dist/                       # Output `vite build` (embed via assets.go)
├── cmd/streamai/main.go            # Entry point Wails v3 (application.New)
├── internal/                       # Wails Services in Go
│   ├── pkg/wailsevents/
│   └── services/
│       ├── discovery/              # Scansione subnet (sostituisce deviceDiscovery.ts)
│       ├── advertising/            # mDNS + SSDP + DIAL HTTP receiver
│       ├── cast/                   # Chromecast / DLNA / AirPlay launcher
│       ├── remote/                 # WebSocket + UDP broadcast + REST locale
│       ├── netstatus/              # Bridge stato playback ↔ remote/AI
│       ├── proxy/                  # Header rewrite + TLS skip per stream IPTV
│       └── player/                 # Bridge verso player nativo / Video.js
├── assets.go                       # //go:embed all:frontend/dist
├── go.mod / go.sum / Taskfile.yml / .golangci.yml
├── android/                        # Capacitor 7 (Android target)
│   └── plugins/capacitor-video-player/  # Plugin Media3 1.10.1 vendorato
├── main.js / preload.js            # Entry point Electron (legacy, fase 7 della migrazione)
├── scripts/                        # patch-ffmpeg, sync-version, check-wails-v3, …
├── docs/                           # plan-go-wails-migration.md, IMPROVEMENT_PLAN.md, SIGNING.md, INSTALL.md
├── build/depends/                  # JSON dipendenze per-distro (deb/rpm/arch)
├── release/                        # Artefatti electron-builder
└── package.json / vite.config.ts / tsconfig.json / vitest.config.ts
```

> **Nota:** Vite ha `root: 'frontend'` (vedi `vite.config.ts`) e Vitest legge da `frontend/tests/**`. `package.json` + `node_modules/` restano in root così la stessa toolchain serve build Electron, Wails e Capacitor senza duplicazione.

---

## 🐧 Note Linux

### Codec HEVC
Il supporto HEVC viene aggiunto automaticamente tramite la distribuzione BranchBit di Electron.
Se riscontri problemi, puoi installare i codec di sistema:

```bash
# Ubuntu/Debian
sudo apt install ubuntu-restricted-extras gstreamer1.0-libav

# Fedora
sudo dnf install gstreamer1-libav gstreamer1-plugins-bad-freeworld

# Arch
sudo pacman -S gst-libav gst-plugins-bad
```

---

## 🧪 Diagnostica riproduzione stream

Il player mostra un overlay diagnostico quando uno stream fallisce:

- errori credenziali/accesso (`401`, `403`), stream non trovato (`404`), timeout iniziale, codec/decodifica e sorgente non supportata;
- pulsante **Riprova** con limite di retry per evitare loop infiniti;
- sezione **Dettagli tecnici** con URL sanitizzato, protocollo, MIME e motore usato;
- pulsante **Info stream** per raccogliere codec video/audio, risoluzione, bitrate, container, protocollo, qualità playback e stato supporto.

In aggiunta, il pannello **Stream Diagnostics** (`components/player/StreamDiagnostics.tsx`, slide-from-right DS v1) mostra in tempo reale:

- **Buffer health** aggiornato ogni secondo mentre il pannello è aperto (livello di buffer, frame dropped, jitter quando esposto dall'engine);
- **Ring buffer degli ultimi 10 errori** del playback (`playbackError`) con timestamp, tipo e messaggio sanitizzato;
- **URL sorgente sanitizzato** con pulsante copia (credenziali Xtream mascherate);
- **Warning automatici** per profili HEVC/HDR/Dolby Vision e frame drop ricorrenti.

Per stream live MPEG-TS/HLS il rilevamento codec usa più fonti: Video.js/HLS.js, track API browser, manifest HLS `CODECS`, byte iniziali dello stream e parsing PAT/PMT MPEG-TS quando possibile. Alcuni provider bloccano fetch paralleli o CORS: in quei casi il pannello mostra comunque il metodo di rilevamento e l'affidabilità del dato.

---

## 🔄 Aggiornamento catalogo contenuti

Nella pagina **Impostazioni → Catalogo contenuti** sono disponibili:

- **Riscarica lista**: forza il download da server Xtream ignorando la cache locale e aggiorna subito Live, Film e Serie in memoria.
- **Aggiornamento in background**: abilita un controllo periodico del catalogo senza bloccare la UI.
- **Frequenza aggiornamento**: 1 ora, 3 ore, 6 ore, 12 ore o 24 ore.

Lo stato dell'ultimo aggiornamento riuscito e dell'eventuale ultimo errore viene salvato nel profilo. Il refresh automatico non parte se il browser risulta offline e usa un lock interno per evitare aggiornamenti concorrenti.

---

## 🤖 AI e metadata contestuali

L'assistente AI usa il profilo corrente per generare consigli più pertinenti:

- prompt diversi per **Live**, **Film** e **Serie**;
- lingua del profilo nelle risposte;
- cronologia recente e generi preferiti stimati dai contenuti guardati;
- esclusione dei contenuti visti di recente quando il catalogo offre alternative;
- ranking locale prima della chiamata Gemini, così vengono inviati meno titoli e più rilevanti.

La cache AI ha TTL e chiavi separate per profilo, lingua, tipo contenuto e catalogo. In **Impostazioni → AI** è disponibile **Svuota cache AI**, che cancella solo risposte Gemini e arricchimenti AI senza rimuovere immagini o catalogo Xtream.

I metadata TMDB usano cache con TTL, deduplica delle richieste simultanee e fallback lingua verso `en-US`. Il matching titoli IPTV pulisce prefissi/qualità/codec, gestisce l'anno, supporta un fuzzy matching leggero e riduce i falsi positivi sui titoli corti.

Test rapido matching metadata:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/test-metadata-matching.mjs
```

---

## ⚡ Performance catalogo e immagini

Il catalogo è ottimizzato per playlist IPTV grandi:

- indice memoizzato con `nameLower`, `cleanNameLower`, `groupLower`, `genreLower` e `year` precomputati;
- ricerca con debounce, ranking locale e limite risultati per evitare filtri costosi su ogni render;
- righe orizzontali con finestra virtuale e overscan quando superano la soglia;
- paginazione per categoria con **Mostra altri**;
- caricamento immagini con `IntersectionObserver`, preload solo dei poster visibili e skeleton durante il caricamento.

La cache immagini salva metadata di accesso, ha TTL di 30 giorni, limite di 1500 immagini / 512 MB e cleanup automatico quando lo storage è sotto pressione. In **Impostazioni → Cache** sono disponibili statistiche, ottimizzazione manuale e **Svuota immagini** senza cancellare catalogo o risposte AI.

Test rapido indice catalogo grande:

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types scripts/test-catalog-index.mjs
```

---

## 📡 Discovery e casting LAN

Il menu **Trasmetti** usa discovery progressivo e cancellabile:

- risultati SSDP/DIAL quando disponibili;
- probe nativi Electron su porte Chromecast/DIAL/DLNA/AirPlay;
- fallback browser con timeout brevi;
- cache temporanea dei dispositivi trovati per evitare scansioni ripetute;
- pulsante **Annulla** durante la scansione e inserimento IP manuale.

Gli stati di cast distinguono connessione, buffering, errore e disconnessione. In caso di fallimento viene mostrato un messaggio nella UI e l'URL viene copiato negli appunti come fallback pratico per VLC/Kodi/IPTV player.

Se la porta DIAL locale è occupata, Electron prova automaticamente le porte successive a partire da `STREAMAI_ADVERTISING_PORT`.

---

## ✅ Checklist collaudo UX TV/Android

Validazioni consigliate prima del rilascio su hardware reale:

1. Navigare senza mouse in selezione profilo, Home, Live, Film, Serie, dettagli film/serie e impostazioni.
2. Aprire e chiudere con `Esc` login Xtream, dettagli film, dettagli serie, menu cast, Info stream e menu audio.
3. Verificare ripristino focus dopo chiusura player/modali.
4. Su Android/TV box, verificare landscape, safe-area/notch, dimensione target touch e tasto fisico Back.
5. Su device meno potenti, controllare fluidità scroll righe catalogo, apertura modali e overlay player nativo.

Matrice device da compilare durante il collaudo:

| Device | Android/API | Input | Esito | Note |
|--------|-------------|-------|-------|------|
| Da verificare | Da verificare | Telecomando/tastiera | Da verificare | Richiede hardware reale |

---

## 📝 Licenza

MIT License - Vedi file LICENSE per dettagli.
