const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;
const { WebSocketServer } = require('ws');
const { advertisingService } = require('./services/advertisingService.js'); // Importa il nuovo servizio .js

// Rileva il sistema operativo
const isLinux = process.platform === 'linux';
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland' || process.env.WAYLAND_DISPLAY;
const allowInsecureElectron = ['1', 'true', 'yes'].includes(String(process.env.STREAMAI_INSECURE_ELECTRON || '').toLowerCase());

function isIptvRequest(url = '') {
  return url.includes('.m3u8') || url.includes('.ts') || url.includes('/live/') ||
    url.includes('/movie/') || url.includes('/series/') || url.includes('player_api.php') ||
    url.includes(':8080') || url.includes(':8000') || url.includes(':25461');
}

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
app.commandLine.appendSwitch('unlimited-storage');

// Fallback insicuro solo opt-in per provider IPTV problematici.
if (allowInsecureElectron) {
  console.warn('[Security] STREAMAI_INSECURE_ELECTRON abilitato: SSL/CORS meno restrittivi per provider IPTV problematici.');
  app.commandLine.appendSwitch('ignore-certificate-errors');
  app.commandLine.appendSwitch('ignore-ssl-errors', 'true');
  app.commandLine.appendSwitch('ignore-urlfetcher-cert-requests');
  app.commandLine.appendSwitch('allow-insecure-localhost');
  app.commandLine.appendSwitch('allow-running-insecure-content');
  app.commandLine.appendSwitch('disable-web-security');
  app.commandLine.appendSwitch('disable-site-isolation-trials');
}
app.commandLine.appendSwitch('ssl-version-min', 'tls1');
app.commandLine.appendSwitch('cipher-suite-blacklist', '');

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
      webSecurity: !allowInsecureElectron,
      experimentalFeatures: true,
      preload: path.join(__dirname, 'preload.js'),
      allowRunningInsecureContent: allowInsecureElectron,
    },
    autoHideMenuBar: true
  });

  if (allowInsecureElectron) {
    mainWindow.webContents.session.setCertificateVerifyProc((request, callback) => {
      callback(0);
    });

    mainWindow.webContents.on('certificate-error', (event, url, error, certificate, callback) => {
      event.preventDefault();
      callback(true);
    });
  }

  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (isIptvRequest(details.url) || allowInsecureElectron) {
      delete details.requestHeaders['Upgrade-Insecure-Requests'];
      details.requestHeaders['Cache-Control'] = 'no-cache';
      details.requestHeaders['Pragma'] = 'no-cache';
      details.requestHeaders['User-Agent'] = 'StreamAI IPTV';
      details.requestHeaders['Accept'] = '*/*';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = details.responseHeaders || {};
    if (isIptvRequest(details.url) || allowInsecureElectron) {
      delete responseHeaders['Content-Security-Policy'];
      delete responseHeaders['content-security-policy'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['x-frame-options'];
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
    }
    callback({ responseHeaders });
  });

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  
  // Avvia il listener per lo stato di rete
  setupNetworkStatusListener();
  // Avvia il server WebSocket
  setupWebSocketServer();
  
  // Avvia il nuovo servizio di advertising
  advertisingService.start();
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
      if (status.deviceId === deviceId) {
        return;
      }
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

let lastStatus = null;
let broadcastSocket = null;

function getLocalInterfaces() {
  const interfaces = os.networkInterfaces();
  const validInterfaces = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        validInterfaces.push({ name, address: iface.address });
      }
    }
  }
  return validInterfaces;
}

function getBroadcastSocket() {
  if (broadcastSocket) return broadcastSocket;
  
  broadcastSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  broadcastSocket.on('error', (err) => {
    console.error(`[NetworkStatus] Errore socket broadcast: ${err.message}`);
    broadcastSocket.close();
    broadcastSocket = null;
  });
  
  return broadcastSocket;
}

ipcMain.on('playback-status-update', (event, status) => {
  lastStatus = status;
  const socket = getBroadcastSocket();
  if (!socket) return;

  const validInterfaces = getLocalInterfaces();
  
  validInterfaces.forEach(iface => {
    try {
      const payload = JSON.stringify({ 
        ...status, 
        deviceId, 
        ip: iface.address, 
        wsPort: WS_CONTROL_PORT 
      });
      const message = Buffer.from(payload);

      socket.send(message, 0, message.length, UDP_STATUS_PORT, MULTICAST_ADDR, (err) => {
        if (err) console.error(`[NetworkStatus] Fallimento invio su ${iface.address}: ${err.message}`);
      });

      const broadcastAddr = iface.address.split('.').slice(0, 3).join('.') + '.255';
      socket.setBroadcast(true);
      socket.send(message, 0, message.length, UDP_STATUS_PORT, broadcastAddr, (err) => {
        // Silenzioso se fallisce
      });
    } catch (e) {
      console.error(`[NetworkStatus] Errore durante il broadcast su ${iface.address}:`, e.message);
    }
  });

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
  wss = new WebSocketServer({ 
    port: WS_CONTROL_PORT, 
    host: '0.0.0.0',
    clientTracking: true,
    handleProtocols: (protocols) => protocols[0]
  });

  wss.on('listening', () => {
    const interfaces = getLocalInterfaces();
    console.log(`[WebSocketServer] Server in ascolto sulla porta ${WS_CONTROL_PORT}`);
    interfaces.forEach(iface => {
      console.log(`[WebSocketServer] Disponibile su: ws://${iface.address}:${WS_CONTROL_PORT}`);
    });
  });

  wss.on('connection', (ws) => {
    console.log('[WebSocketServer] Nuovo client connesso');
    wsClients.add(ws);

    if (lastStatus) {
      ws.send(JSON.stringify({ type: 'status', payload: lastStatus }));
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('request-status-broadcast');
    }

    ws.on('message', (message) => {
      try {
        const command = JSON.parse(message.toString());
        console.log('[WebSocketServer] Comando ricevuto:', command);

        if (command.action === 'ping') {
           ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
           return;
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote-control-command', command);
        }
      } catch (e) {
        console.warn('[WebSocketServer] Messaggio WebSocket malformato:', e.message);
      }
    });

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);

    ws.on('close', () => {
      console.log('[WebSocketServer] Client disconnesso');
      clearInterval(pingInterval);
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

// ============================================
// CICLO DI VITA DELL'APPLICAZIONE
// ============================================

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

app.on('will-quit', () => {
  // Arresta il servizio di advertising
  advertisingService.stop();
  
  // Chiudi il server WebSocket
  if (wss) {
    console.log('[WebSocketServer] Chiusura server WebSocket');
    wss.close();
  }
});

// ... (tutti gli altri ipcMain.handle per discovery, cast, etc. rimangono invariati)
// Esempio:
// ipcMain.handle('discover-devices', async (event) => { /* ... */ });
// ipcMain.handle('cast-connect', async (event, { ip }) => { /* ... */ });
// ... e così via per gli altri.
