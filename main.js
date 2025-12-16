const { app, BrowserWindow, session } = require('electron');
const path = require('path');

// Rileva il sistema operativo
const isLinux = process.platform === 'linux';
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY;

// ============================================
// CONFIGURAZIONE STORAGE - Illimitato
// ============================================

// Disabilita la quota di storage (permette cache illimitata)
app.commandLine.appendSwitch('unlimited-storage');

// ============================================
// CONFIGURAZIONE SSL/TLS - Ignora errori certificati
// ============================================

// Ignora TUTTI gli errori di certificato SSL
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-ssl-errors', 'true');
app.commandLine.appendSwitch('ignore-urlfetcher-cert-requests');
app.commandLine.appendSwitch('allow-insecure-localhost');

// Permetti contenuti misti (HTTP su HTTPS)
app.commandLine.appendSwitch('allow-running-insecure-content');

// Disabilita verifiche di sicurezza della rete
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Disabilita HSTS e altre protezioni che forzano HTTPS
app.commandLine.appendSwitch('disable-features', 'BlockInsecurePrivateNetworkRequests,IsolateOrigins,site-per-process');

// Usa configurazione TLS più permissiva
app.commandLine.appendSwitch('ssl-version-min', 'tls1');
app.commandLine.appendSwitch('cipher-suite-blacklist', '');

// Disabilita certificate transparency
app.commandLine.appendSwitch('disable-background-networking');

// Riduci il logging degli errori SSL (non li elimina ma li rende meno verbosi)
app.commandLine.appendSwitch('log-level', '3'); // 0=INFO, 1=WARNING, 2=LOG_ERROR, 3=FATAL only

// ============================================
// CONFIGURAZIONE PER LINUX/WAYLAND
// ============================================

if (isLinux) {
  // Forza X11 via XWayland - più stabile di Wayland nativo
  app.commandLine.appendSwitch('ozone-platform', 'x11');

  // Disabilita solo il compositing GPU, non la GPU intera
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');

  // Abilita accelerazione video hardware
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');

  // IMPORTANTE: Abilita codec proprietari (HEVC/H.265)
  // Questo è il flag chiave per abilitare i codec proprietari in Chromium
  app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,VaapiIgnoreDriverChecks,UseChromeOSDirectVideoDecoder');

  // Abilita FFmpeg per decodifica software come fallback
  app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');

  // Forza l'uso di FFmpeg per codec non supportati nativamente
  // Questo permette la decodifica software HEVC se l'hardware non lo supporta
  app.commandLine.appendSwitch('enable-ffmpeg-video-decoding');

  // Permetti codec proprietari
  app.commandLine.appendSwitch('enable-proprietary-codecs');
}

// Features per supporto codec - configurazione per Windows/Mac
const baseFeatures = [
  'PlatformHEVCDecoderSupport',  // Supporto HEVC del sistema
];

// Features per Windows
const windowsFeatures = [
  'MediaFoundationAsyncH264Encoding',
  'MediaFoundationVideoCapture',
  'MediaFoundationH264Encoding',
  'MediaFoundationClearPlayback',
];

// Applica features solo per Windows/Mac (Linux configurato sopra)
if (!isLinux) {
  let enabledFeatures = [...baseFeatures];
  if (process.platform === 'win32') {
    enabledFeatures = [...enabledFeatures, ...windowsFeatures];
  }
  app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
}

// Variabile per tracciare tentativi di restart
let gpuRestartAttempts = 0;
const MAX_GPU_RESTARTS = 2;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#141414',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      experimentalFeatures: true,
      // Permetti contenuti non sicuri
      allowRunningInsecureContent: true,
    },
    autoHideMenuBar: true
  });

  // ============================================
  // GESTIONE ERRORI SSL/CERTIFICATI
  // ============================================

  // Ignora tutti gli errori di certificato per la sessione
  win.webContents.session.setCertificateVerifyProc((request, callback) => {
    // Accetta tutti i certificati senza verifica
    callback(0);
  });

  // Gestione errori di certificato a livello di webContents
  win.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
  });

  // Intercetta richieste fallite e permetti retry senza SSL
  win.webContents.session.webRequest.onErrorOccurred((details) => {
    // Log solo per debug, non bloccare
    if (details.error.includes('SSL') || details.error.includes('CERT')) {
      console.debug(`[SSL] Errore ignorato per: ${details.url.substring(0, 50)}...`);
    }
  });

  // Modifica headers per permettere contenuti misti e IPTV
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    delete details.requestHeaders['Upgrade-Insecure-Requests'];
    // Headers per compatibilità con server IPTV
    details.requestHeaders['Cache-Control'] = 'no-cache';
    details.requestHeaders['Pragma'] = 'no-cache';
    // User-Agent consistente per tutte le richieste IPTV
    if (details.url.includes('.m3u8') || details.url.includes('.ts') || details.url.includes('/live/') ||
        details.url.includes('/movie/') || details.url.includes('/series/') || details.url.includes('player_api.php') ||
        details.url.includes(':8080') || details.url.includes(':8000') || details.url.includes(':25461')) {
      details.requestHeaders['User-Agent'] = 'StreamAI IPTV';
      details.requestHeaders['Accept'] = '*/*';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Modifica response headers per permettere contenuti da qualsiasi origine
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    // Rimuovi header che potrebbero bloccare contenuti
    delete responseHeaders['Content-Security-Policy'];
    delete responseHeaders['content-security-policy'];
    delete responseHeaders['X-Frame-Options'];
    delete responseHeaders['x-frame-options'];
    // Permetti CORS
    responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    callback({ responseHeaders });
  });

  // Gestione errori renderer
  win.webContents.on('crashed', (event, killed) => {
    console.error('[Main] Renderer crashed:', killed ? 'killed' : 'crashed');
    gpuRestartAttempts++;
    if (gpuRestartAttempts <= MAX_GPU_RESTARTS) {
      win.reload();
    }
  });

  // Gestione errori render process
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[Main] Render process gone:', details.reason);
    if (details.reason !== 'clean-exit' && gpuRestartAttempts <= MAX_GPU_RESTARTS) {
      gpuRestartAttempts++;
      win.reload();
    }
  });

  // Load the built application
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));

  // Decommentare per debug:
  // win.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

