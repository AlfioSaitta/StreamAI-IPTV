const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const { WebSocketServer } = require('ws'); // Importa WebSocketServer

// Rileva il sistema operativo
const isLinux = process.platform === 'linux';
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY;

// ============================================
// CONFIGURAZIONE DI RETE PER STATUS SHARING E REMOTE CONTROL
// ============================================
const MULTICAST_ADDR = '239.255.255.251'; // Indirizzo multicast privato
const UDP_STATUS_PORT = 1901; // Porta per la condivisione dello stato UDP
const WS_CONTROL_PORT = 1902; // Porta per il server WebSocket
const deviceId = os.hostname(); // ID univoco per questo dispositivo

let wss; // Server WebSocket
let wsClients = new Set(); // Client WebSocket connessi

// ============================================
// CONFIGURAZIONE AVVIO APP
// ============================================
// ... (tutte le altre configurazioni di app.commandLine rimangono invariate)
app.commandLine.appendSwitch('unlimited-storage');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-ssl-errors', 'true');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-web-security');
// ... (e così via per tutte le altre flags)

// ============================================
// GESTIONE FEATURES (ENABLE/DISABLE)
// ============================================
const enabledFeatures = [
  'MediaRouter', 'GlobalMediaControls', 'CastMediaRouteProvider',
  'PlatformHEVCDecoderSupport', 'ProprietaryCodecs'
];
const disabledFeatures = [
  'BlockInsecurePrivateNetworkRequests', 'IsolateOrigins', 'site-per-process',
  'HardwareMediaKeyHandling'
];
if (isLinux) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  enabledFeatures.push('VaapiVideoDecoder', 'VaapiVideoDecodeLinuxGL', 'VaapiIgnoreDriverChecks', 'UseChromeOSDirectVideoDecoder');
  app.commandLine.appendSwitch('enable-ffmpeg-video-decoding');
  app.commandLine.appendSwitch('enable-proprietary-codecs');
}
if (process.platform === 'win32') {
  enabledFeatures.push('MediaFoundationAsyncH264Encoding', 'MediaFoundationVideoCapture', 'MediaFoundationH264Encoding', 'MediaFoundationClearPlayback');
}
app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

// ============================================
// GESTIONE FINESTRA E IPC
// ============================================
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    backgroundColor: '#141414',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js'),
      allowRunningInsecureContent: true,
    },
    autoHideMenuBar: true
  });

  // ... (tutta la configurazione della finestra e webRequest rimane invariata)

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  
  // Avvia il listener per lo stato di rete
  setupNetworkStatusListener();
  // Avvia il server WebSocket
  setupWebSocketServer();
}

// ============================================
// LOGICA DI CONDIVISIONE STATO SULLA RETE (UDP)
// ============================================

function setupNetworkStatusListener() {
  const listenerSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  listenerSocket.on('error', (err) => {
    console.error(`[NetworkStatus] Errore socket listener: ${err.stack}`);
    listenerSocket.close();
  });

  listenerSocket.on('message', (msg, rinfo) => {
    try {
      const status = JSON.parse(msg.toString());
      // Ignora i messaggi inviati da questo stesso dispositivo
      if (status.deviceId === deviceId) {
        return;
      }
      // Inoltra lo stato ricevuto alla UI
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('network-playback-status', status);
      }
    } catch (e) {
      console.warn('[NetworkStatus] Ricevuto messaggio malformato:', e.message);
    }
  });

  listenerSocket.bind(UDP_STATUS_PORT, () => {
    try {
      listenerSocket.addMembership(MULTICAST_ADDR);
      console.log(`[NetworkStatus] In ascolto per stati di riproduzione su ${MULTICAST_ADDR}:${UDP_STATUS_PORT}`);
    } catch (e) {
      console.error('[NetworkStatus] Impossibile unirsi al gruppo multicast:', e.message);
    }
  });
}

// Gestore IPC per ricevere lo stato dalla UI e trasmetterlo
ipcMain.on('playback-status-update', (event, status) => {
  const broadcastSocket = dgram.createSocket({ type: 'udp4' });
  
  // Ottieni l'IP locale per includerlo nel broadcast UDP
  const interfaces = os.networkInterfaces();
  let localIp = '127.0.0.1';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
    if (localIp !== '127.0.0.1') break;
  }

  const payload = JSON.stringify({ 
    ...status, 
    deviceId, 
    ip: localIp, 
    wsPort: WS_CONTROL_PORT 
  });
  const message = Buffer.from(payload);

  broadcastSocket.send(message, 0, message.length, UDP_STATUS_PORT, MULTICAST_ADDR, () => {
    broadcastSocket.close();
  });

  // Inoltra lo stato anche ai client WebSocket connessi
  wsClients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: 'status', payload: status }));
    }
  });
});

// ============================================
// LOGICA SERVER WEBSOCKET PER REMOTE CONTROL
// ============================================

function setupWebSocketServer() {
  wss = new WebSocketServer({ port: WS_CONTROL_PORT });

  wss.on('listening', () => {
    console.log(`[WebSocketServer] Server in ascolto sulla porta ${WS_CONTROL_PORT}`);
  });

  wss.on('connection', (ws) => {
    console.log('[WebSocketServer] Nuovo client connesso');
    wsClients.add(ws);

    ws.on('message', (message) => {
      try {
        const command = JSON.parse(message.toString());
        console.log('[WebSocketServer] Comando ricevuto:', command);

        // Inoltra il comando al processo di rendering (UI)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote-control-command', command);
        }
      } catch (e) {
        console.warn('[WebSocketServer] Messaggio WebSocket malformato:', e.message);
      }
    });

    ws.on('close', () => {
      console.log('[WebSocketServer] Client disconnesso');
      wsClients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[WebSocketServer] Errore WebSocket:', error);
    });
  });

  wss.on('error', (error) => {
    console.error('[WebSocketServer] Errore del server WebSocket:', error);
  });
}

// Chiudi il server WebSocket quando l'app si chiude
app.on('will-quit', () => {
  if (wss) {
    console.log('[WebSocketServer] Chiusura server WebSocket');
    wss.close();
  }
});


// ... (tutto il resto del codice di main.js, inclusi Cast, Discovery, etc. rimane invariato)
// Assicurati che le funzioni come `createWindow`, `app.whenReady`, etc. siano presenti.
// Di seguito un riassunto per chiarezza, ma il codice completo non viene ripetuto.

// ... (codice per Network Discovery, Cast Session Manager, etc.)

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

// ... (tutti gli altri ipcMain.handle)
// Esempio:
// ipcMain.handle('discover-devices', async (event) => { /* ... */ });
// ipcMain.handle('cast-connect', async (event, { ip }) => { /* ... */ });
// ... e così via per gli altri.
