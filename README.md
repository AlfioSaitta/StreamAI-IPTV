# 📺 StreamAI IPTV Player

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 18**, **TypeScript**, **Electron** e **Tailwind CSS**. 
Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui contenuti basate sulle preferenze dell'utente, e per un ecosistema di networking avanzato per il casting e il controllo remoto.

---

## ✨ Funzionalità Principali

### 🎬 Riproduzione Avanzata
- **Live TV**: Streaming live con zapping veloce e buffering ottimizzato.
- **Movies (VOD)**: Film on-demand con seeking fluido, timeline interattiva e anteprima al passaggio del mouse.
- **Series**: Episodi con navigazione tra stagioni e puntate, e salvataggio automatico del progresso.
- **Codec HEVC/H.265**: Supporto nativo per video 4K con codec proprietari (via BranchBit).
- **Player Nativo (Android)**: Utilizzo del player di sistema (ExoPlayer) per massime prestazioni su mobile.
- **OSD (On-Screen Display)**: Feedback visivo immediato per volume, seeking, play/pausa e stato buffer.

### 📡 Networking & Casting
- **Casting Universale**: Trasmissione su Chromecast, dispositivi DLNA/UPnP e AirPlay.
- **Device Discovery**: Scansione profonda della rete locale (/24 subnet) per trovare tutti i dispositivi compatibili.
- **Advertising Service**: L'app si annuncia sulla rete tramite mDNS (Bonjour), SSDP e DIAL, rendendosi visibile come target di casting per altre app.
- **Controllo Remoto**: Architettura pronta per il controllo remoto tramite WebSocket e API REST locali.

### 🤖 AI Assistant
- **Ricerca intelligente**: Chiedi all'AI cosa vuoi guardare con linguaggio naturale.
- **Raccomandazioni personalizzate**: Basate sulla cronologia di visione e preferenze.
- **Suggerimenti contestuali**: Diversi per Live, Movies e Series.
- **Caching Intelligente**: Risposte AI salvate localmente per ridurre latenza e costi API.

### 👤 Profili Utente
- **Multi-profilo**: Supporto per più utenti con preferenze separate.
- **Cronologia separata**: Ogni profilo mantiene la propria cronologia di visione.
- **Progresso salvato**: Riprendi esattamente da dove avevi interrotto.

### 🔧 Ottimizzazioni Tecniche
- **Virtualizzazione Liste**: Rendering efficiente per playlist con migliaia di canali (react-window).
- **Memoization**: Riduzione drastica dei re-render inutili per fluidità UI.
- **Buffering differenziato**: Configurazioni separate per Live/VOD/Series.
- **Cache immagini**: Download intelligente delle copertine per risparmio banda.
- **Avvio rapido**: Streaming ottimizzato per partenza immediata.
- **Network Monitor**: Visualizzazione velocità di rete e stato buffer in tempo reale (Debug Overlay).

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
- ✅ Player nativo (ExoPlayer tramite `capacitor-video-player`) per prestazioni superiori
- ✅ Picture-in-Picture
- ✅ Fullscreen
- ✅ Supporto HTTP cleartext per stream IPTV
- ✅ Deep link `streamai://`
- ❌ Casting (solo su Electron per ora)
- ❌ Download locale (solo su Electron)

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

## 📝 Licenza

MIT License - Vedi file LICENSE per dettagli.
