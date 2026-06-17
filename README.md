# 📺 StreamAI IPTV Player

[![CI](https://github.com/AlfioSaitta/StreamAI-IPTV/actions/workflows/ci.yml/badge.svg)](https://github.com/AlfioSaitta/StreamAI-IPTV/actions/workflows/ci.yml)

**StreamAI** è un player IPTV di nuova generazione sviluppato con **React 19**, **TypeScript**, **Tailwind CSS** e un runtime desktop **Wails v3** (Go). Si distingue per l'integrazione con **Google Gemini AI**, che offre raccomandazioni intelligenti sui contenuti, e per un ecosistema di networking avanzato per il casting e il controllo remoto, interamente gestito dal backend in Go.

> 🚀 **Desktop Runtime: Wails v3.** Il backend desktop è un'applicazione nativa in Go (Wails v3) con Service specializzati per discovery, advertising, cast, remote/WebSocket, netstatus, proxy e un player nativo basato su **libmpv**. **Electron è stato rimosso completamente** in favore di questa nuova architettura più leggera e performante.

---

## ✨ Funzionalità Principali

### 🎬 Riproduzione Avanzata
- **Live TV, Movies (VOD), Series**: Streaming con zapping veloce, seeking fluido e salvataggio automatico del progresso.
- **Player Nativo ad Alte Prestazioni**:
  - **Desktop**: Supporto per tutti i codec (incluso **HEVC/H.265**) con decodifica hardware tramite **libmpv**, renderizzato in un `<canvas>` WebGL2.
  - **Android**: Utilizzo del player di sistema basato su **AndroidX Media3 1.10.1** (ExoPlayer) per massime prestazioni.
- **OSD (On-Screen Display)**: Feedback visivo immediato per ogni azione.
- **Diagnostica Stream**: Pannello "Info stream" con dettagli su errori, codec, protocollo e qualità.
- **Fallback Engine**: Selezione automatica del motore di riproduzione più adatto in base a piattaforma e formato.

### 📡 Networking & Casting (Backend Go)
- **Casting Universale**: Trasmissione su Chromecast, dispositivi DLNA/UPnP e AirPlay.
- **Device Discovery**: Scansione della rete locale per dispositivi di casting.
- **Advertising Service**: L'app si annuncia sulla rete tramite mDNS (Bonjour), SSDP e DIAL, rendendosi visibile come target.
- **Controllo Remoto**: Server WebSocket per il controllo remoto dell'applicazione.

### 🤖 AI Assistant
- **Ricerca e Raccomandazioni**: Interazione in linguaggio naturale con Gemini per trovare contenuti e ricevere suggerimenti personalizzati.
- **Caching Intelligente**: Risposte AI salvate localmente per ridurre latenza e costi API.

### 👤 Profili Utente
- **Onboarding Guidato**: Wizard a 3 step per una configurazione semplice e veloce.
- **Multi-profilo**: Supporto per più utenti con cronologia e preferenze separate.
- **Gestione Catalogo**: Aggiornamento manuale o automatico del catalogo contenuti.

### 🔧 Ottimizzazioni Tecniche
- **Virtualizzazione Liste**: Rendering efficiente per playlist con migliaia di canali (`react-window`).
- **Web Worker Pipeline**: Parsing di file M3U di grandi dimensioni in background per non bloccare l'interfaccia.
- **Proxy Integrato**: Un proxy HTTP in Go gestisce le richieste a stream non sicuri (HTTP), evitando problemi di mixed-content e CORS nei webview.

---

## 🚀 Requisiti

- **Node.js**: v18+ (per build e sviluppo frontend)
- **Go**: 1.25+ (per la build del runtime Wails v3)
- **libmpv**: Installata sul sistema (per la riproduzione video desktop su Linux)
- **Sistema Operativo**: Linux (Ubuntu, Debian, Fedora, Arch, openSUSE), Windows (con WebView2), macOS
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
# Avvia con Wails v3 (hot reload per Go e React)
npm run dev
```

### Build Produzione
```bash
# Genera i pacchetti Linux (.deb, .rpm, .pkg.tar.zst)
npm run dist:linux

# Solo build binario locale
npm run wails:build
```

Gli artefatti finiscono in `dist/packages/`. La versione proviene dal file `.version` ed è propagata automaticamente agli altri file di progetto tramite `npm run version:sync`.

### Release automatiche (GitHub Actions)
Un push di tag `v*` attiva il workflow che costruisce, firma (GPG) e pubblica i pacchetti per Linux su GitHub Releases e sul repository statico di GitHub Pages.

---

## 📱 Build Android

StreamAI supporta la build per dispositivi Android tramite **Capacitor**.

### Requisiti Android
- **JDK 17+**
- **Android Studio** (consigliato)
- **Android SDK**: API level 22+

### Comandi Build Android

```bash
# Sincronizza i file web con il progetto Android
npm run android:sync

# Apri il progetto in Android Studio
npm run android:open

# Build e avvia su dispositivo/emulatore connesso
npm run android:run
```

### Firma Android Release
Configura le variabili d'ambiente `STREAMAI_ANDROID_KEYSTORE_*` e lancia `npm run android:build:release`.

---

## ⌨️ Scorciatoie da Tastiera

L'applicazione è completamente controllabile via tastiera per un'esperienza "Lean-back".

| Tasto | Azione |
|-------|--------|
| `Spazio` / `Invio` / `P` | Play/Pausa |
| `←` / `→` | Seeking -/+ 10 secondi |
| `↑` / `↓` | Volume +/- 10% |
| `M` | Mute/Unmute |
| `F` | Fullscreen Toggle |
| `C` | Menu Casting |
| `L` | Mostra/Nascondi Playlist |
| `Esc` | Indietro / Chiudi menu |

---

## 🔐 Configurazione API

Le chiavi API non devono essere inserite nel codice. Copia `.env.example` in `.env` e inserisci le tue chiavi:

```bash
VITE_GEMINI_API_KEY="tua-chiave-gemini"
VITE_TMDB_API_KEY="tua-chiave-tmdb"
```

---

## 📁 Struttura Progetto

Il repository è organizzato con un frontend React in `frontend/` e un backend Go in `cmd/` + `internal/`.

```
streamai-iptv/
├── frontend/                       # React 19 + Vite + Tailwind (UI)
│   ├── App.tsx / index.tsx / types.ts
│   ├── components/                 # Componenti React
│   ├── services/                   # Logica business (chiamate API, ecc.)
│   ├── hooks/ contexts/ public/ tests/
│   └── dist/                       # Output `vite build` (embeddato in Go)
├── cmd/streamai/main.go            # Entry point Wails v3
├── internal/                       # Wails Services in Go
│   └── services/
│       ├── discovery/              # Scansione rete
│       ├── advertising/            # mDNS + SSDP + DIAL
│       ├── cast/                   # Client Chromecast
│       ├── remote/                 # Server WebSocket
│       ├── proxy/                  # Proxy per stream IPTV
│       └── player/                 # Bridge verso libmpv
├── assets.go                       # //go:embed all:frontend/dist
├── go.mod / go.sum / Taskfile.yml
├── android/                        # Progetto Android (Capacitor)
│   └── plugins/capacitor-video-player/  # Plugin Media3 vendorato
├── scripts/                        # Script di automazione
├── docs/                           # Documentazione di progetto
└── package.json / vite.config.ts
```

---

## 📝 Licenza

MIT License - Vedi file LICENSE per dettagli.