# 📺 StreamAI IPTV Player

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 19**, **TypeScript**, **Electron** e **Tailwind CSS**. 
Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui contenuti basate sulle preferenze dell'utente.

---

## ✨ Funzionalità Principali

### 🎬 Riproduzione
- **Live TV**: Streaming live con zapping veloce e buffering ottimizzato
- **Movies (VOD)**: Film on-demand con seeking fluido e qualità adattiva
- **Series**: Episodi con navigazione tra stagioni e puntate
- **Codec HEVC/H.265**: Supporto nativo per video 4K con codec proprietari (via BranchBit)
- **Player Nativo (Android)**: Utilizzo del player di sistema per massime prestazioni su mobile

### 🎮 Controlli Player
- **Picture-in-Picture (PiP)**: Guarda i contenuti in una finestra flottante (`P`)
- **Fullscreen**: Schermo intero (`F`)
- **Seeking**: Avanti/indietro 10 secondi con frecce (`←` `→`)
- **Volume**: Controllo volume con frecce (`↑` `↓`) e mute (`M`)
- **Riprendi da dove eri rimasto**: Salvataggio automatico della posizione per VOD/Series
- **Riparti dall'inizio**: Pulsante per ricominciare la riproduzione
- **Casting**: Supporto per la trasmissione su dispositivi compatibili (Chromecast, DLNA)

### 🤖 AI Assistant
- **Ricerca intelligente**: Chiedi all'AI cosa vuoi guardare
- **Raccomandazioni personalizzate**: Basate sulla cronologia di visione
- **Suggerimenti contestuali**: Diversi per Live, Movies e Series
- **Caching Intelligente**: Risposte AI salvate localmente per ridurre latenza e costi

### 👤 Profili Utente
- **Multi-profilo**: Supporto per più utenti
- **Cronologia separata**: Ogni profilo ha la sua cronologia
- **Progresso salvato**: Riprendi da dove avevi interrotto

### 🔧 Ottimizzazioni Tecniche
- **Virtualizzazione Liste**: Rendering efficiente per playlist con migliaia di canali
- **Memoization**: Riduzione drastica dei re-render inutili
- **Buffering differenziato**: Configurazioni separate per Live/VOD/Series
- **Cache immagini**: Download intelligente delle copertine
- **Avvio rapido**: Streaming ottimizzato per partenza immediata
- **Network Monitor**: Visualizzazione velocità di rete e stato buffer in tempo reale

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
```

Il comando `npm install` esegue automaticamente lo script `patch-ffmpeg.js` che:
- Scarica la distribuzione Electron con codec HEVC da BranchBit
- Applica la patch solo se necessario (non riscarica se già installata)

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
- **Release**: `android/app/build/outputs/apk/release/app-release-unsigned.apk`

### Funzionalità Android
- ✅ Streaming Live/VOD/Series
- ✅ Player video HTML5 con HLS.js
- ✅ Player Nativo (ExoPlayer) per prestazioni superiori
- ✅ Picture-in-Picture
- ✅ Fullscreen
- ✅ Supporto HTTP cleartext per stream IPTV
- ✅ Deep link `streamai://`
- ❌ Casting (solo su Electron)
- ❌ Download locale (solo su Electron)

---

## ⌨️ Scorciatoie da Tastiera

| Tasto | Azione |
|-------|--------|
| `Spazio` / `Enter` | Play/Pausa |
| `←` | -10s (VOD) / Canale precedente (Live) |
| `→` | +10s (VOD) / Canale successivo (Live) |
| `↑` | Volume + / Lista episodi (Series) |
| `↓` | Volume - |
| `M` | Mute/Unmute |
| `F` | Fullscreen |
| `P` | Picture-in-Picture |
| `Esc` | Chiudi lista/menu |

---

## 🔐 Configurazione API Gemini

Per le raccomandazioni AI, configura la chiave API in uno dei seguenti modi:

1. **Variabile d'ambiente** (consigliato):
   ```bash
   export VITE_GEMINI_API_KEY="tua-chiave-api"
   ```

2. **Direttamente nel codice** (solo sviluppo):
   Modifica `services/geminiService.ts`

---

## 📁 Struttura Progetto

```
streamai-iptv/
├── components/          # Componenti React
│   ├── VideoPlayerNew.tsx # Player principale (Video.js + Nativo)
│   ├── AIRecommender.tsx # Assistente AI
│   ├── ChannelList.tsx  # Lista canali virtualizzata
│   ├── SeriesDetail.tsx # Dettaglio serie
│   └── ...
├── services/            # Servizi
│   ├── geminiService.ts # Integrazione Gemini AI
│   ├── profileService.ts # Gestione profili
│   ├── xtream.ts        # API Xtream Codes
│   ├── nativeVideoPlayer.ts # Bridge per player nativo
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
