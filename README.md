# 📺 StreamAI IPTV Player

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 19**, **TypeScript**, **Electron** e **Tailwind CSS**. 
Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui contenuti basate sulle preferenze dell'utente, e per un ecosistema di networking avanzato per il casting e il controllo remoto.

---

## ✨ Funzionalità Principali

### 🎬 Riproduzione Avanzata
- **Live TV**: Streaming live con zapping veloce e buffering ottimizzato.
- **Movies (VOD)**: Film on-demand con seeking fluido, timeline interattiva e anteprima al passaggio del mouse.
- **Series**: Episodi con navigazione tra stagioni e puntate, e salvataggio automatico del progresso.
- **Codec HEVC/H.265**: Supporto nativo per video 4K con codec proprietari (via BranchBit).
- **Player Nativo (Android)**: Utilizzo del player di sistema basato su **AndroidX Media3 1.10.1** (ExoPlayer di nuova generazione) per massime prestazioni su mobile.
- **OSD (On-Screen Display)**: Feedback visivo immediato per volume, seeking, play/pausa e stato buffer.
- **Diagnostica stream**: classificazione errori HTTP/codec/timeout, retry controllato e pannello “Info stream” con URL sanitizzato, protocollo, engine, codec video/audio e dati qualità quando disponibili.
- **Fallback multi-engine**: HLS.js, MPEG-TS (`mpegts.js`), Video.js e player nativo Android vengono scelti in base a protocollo, estensione e URL Xtream-like.

### 📡 Networking & Casting
- **Casting Universale**: Trasmissione su Chromecast, dispositivi DLNA/UPnP e AirPlay.
- **Device Discovery**: Scansione rete locale cancellabile, con concorrenza limitata, progress UI, cache TTL, deduplica IP/protocollo e minori falsi positivi.
- **Advertising Service**: L'app si annuncia sulla rete tramite mDNS (Bonjour), SSDP e DIAL con porta configurabile/fallback, rendendosi visibile come target di casting per altre app.
- **Controllo Remoto**: Architettura pronta per il controllo remoto tramite WebSocket e API REST locali.

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

- **Node.js**: v18+ (per build e sviluppo)
- **npm**: v9+
- **Sistema Operativo**: Linux (testato), Windows, macOS

---

## 🛠 Installazione

```bash
# Clona il repository
git clone <repository-url>
cd streamai-iptv

# Installa le dipendenze (include patch automatica per codec HEVC)
npm install

# Configura le variabili locali opzionali
cp .env.example .env
```

Il comando `npm install` esegue automaticamente lo script `patch-ffmpeg.js` che:
- Scarica la distribuzione Electron con codec HEVC da BranchBit.
- Applica la patch solo se necessario (non riscarica se già installata).

---

## ▶️ Avvio

### Modalità Sviluppo
```bash
# Avvia con Electron (hot reload)
npm run dev

# Oppure con build prima
npm start
```

### Build Produzione
```bash
# Solo build Vite
npm run build

# Type-check TypeScript
npm run typecheck

# Type-check + build
npm run check

# Build + pacchetto Linux (.tar.gz)
npm run dist:linux
```

L'archivio sarà disponibile in `dist/streamai-iptv-X.X.X.tar.gz`

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

```
streamai-iptv/
├── components/          # Componenti React
│   ├── VideoPlayerNew.tsx # Player principale (Video.js + Nativo + OSD)
│   ├── AIRecommender.tsx # Assistente AI
│   ├── ChannelList.tsx  # Lista canali virtualizzata
│   ├── CastDevicePicker.tsx # Menu selezione dispositivi Cast
│   └── ...
├── services/            # Servizi (Business Logic)
│   ├── geminiService.ts # Integrazione Gemini AI
│   ├── deviceDiscovery.ts # Scansione rete (mDNS, SSDP, ARP)
│   ├── advertisingService.js # (Electron Main) Annuncio servizi rete
│   ├── platformService.ts # Astrazione piattaforma
│   └── ...
├── scripts/             # Script di build
│   ├── patch-ffmpeg.js  # Patch codec HEVC
│   └── android-build-release.sh # Build release Android
├── main.js              # Entry point Electron
├── App.tsx              # Componente principale
└── package.json
```

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
