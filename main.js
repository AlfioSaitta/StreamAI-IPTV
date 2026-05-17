const { app, BrowserWindow, ipcMain } = require('electron');
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

const CAST_CONNECT_TIMEOUT_MS = 8000;
const CAST_LOAD_TIMEOUT_MS = 12000;
const TCP_PROBE_TIMEOUT_MS = 700;
let castClient = null;
let castPlayer = null;
let castStatus = {
  connected: false,
  playerState: 'IDLE',
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  mediaTitle: ''
};

function isValidIPv4(ip = '') {
  return /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timeoutId));
}

function sendCastStatus(extra = {}) {
  castStatus = { ...castStatus, ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('cast-status', castStatus);
  }
  return castStatus;
}

function probeTcp(ip, port, timeoutMs = TCP_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    if (!isValidIPv4(ip)) return resolve(false);
    const socket = new net.Socket();
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, ip);
  });
}

function classifyDevice(ip, services) {
  if (services.some(service => service.protocol === 'castv2')) return 'chromecast';
  if (services.some(service => service.protocol === 'airplay')) return 'smarttv';
  if (services.some(service => service.protocol === 'dlna')) return 'dlna';
  return 'unknown';
}

async function probeDeviceServices(ip) {
  if (!isValidIPv4(ip)) return [];
  const configs = [
    { port: 8009, protocol: 'castv2', priority: 1 },
    { port: 8008, protocol: 'dial', priority: 3 },
    { port: 9080, protocol: 'dlna', priority: 4 },
    { port: 8080, protocol: 'dlna', priority: 5 },
    { port: 7000, protocol: 'airplay', priority: 7 }
  ];
  const results = await Promise.all(configs.map(async config => ({
    ...config,
    available: await probeTcp(ip, config.port)
  })));
  return results.filter(service => service.available);
}

async function buildDeviceFromIp(ip, fallbackName) {
  const services = await probeDeviceServices(ip);
  if (services.length === 0) return null;
  const type = classifyDevice(ip, services);
  const primary = services[0];
  return {
    id: `${ip}:${services.map(service => `${service.protocol}-${service.port}`).join('-')}`,
    name: fallbackName || `${type === 'chromecast' ? 'Chromecast' : type === 'dlna' ? 'DLNA Renderer' : 'Dispositivo'} (${ip})`,
    type,
    ip,
    port: primary.port,
    services
  };
}

async function discoverSsdpDevices(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const devices = new Map();
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const finish = () => {
      try { socket.close(); } catch {}
      resolve(Array.from(devices.values()));
    };
    const timer = setTimeout(finish, timeoutMs);

    socket.on('message', async (msg) => {
      const text = msg.toString();
      const location = text.match(/^location:\s*(.+)$/im)?.[1]?.trim();
      const server = text.match(/^server:\s*(.+)$/im)?.[1]?.trim();
      if (!location) return;
      try {
        const parsed = new URL(location);
        const ip = parsed.hostname;
        if (!isValidIPv4(ip) || devices.has(ip)) return;
        const device = await buildDeviceFromIp(ip, server || `UPnP Device (${ip})`);
        if (device) {
          device.location = location;
          devices.set(ip, device);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('device-found', device);
        }
      } catch {}
    });
    socket.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    socket.bind(() => {
      const query = Buffer.from([
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'MAN: "ssdp:discover"',
        'MX: 2',
        'ST: ssdp:all',
        '',
        ''
      ].join('\r\n'));
      socket.setMulticastTTL(2);
      socket.send(query, 0, query.length, 1900, '239.255.255.250');
    });
  });
}

async function scanSubnet(base, maxHosts = 254, concurrency = 24) {
  const devices = [];
  let cursor = 1;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor <= maxHosts) {
      const ip = `${base}.${cursor++}`;
      const device = await buildDeviceFromIp(ip);
      if (device) {
        devices.push(device);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('device-found', device);
      }
    }
  });
  await Promise.allSettled(workers);
  return devices;
}

function getCastContentType(mediaUrl = '') {
  const lower = mediaUrl.toLowerCase();
  if (lower.includes('.m3u8')) return 'application/x-mpegURL';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.ts') || lower.includes('/live/')) return 'video/mp2t';
  return 'video/mp4';
}

async function closeCastClient() {
  if (castClient) {
    try { castClient.close(); } catch {}
  }
  castClient = null;
  castPlayer = null;
  sendCastStatus({ connected: false, playerState: 'IDLE' });
}

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

  mainWindow.loadFile(path.join(__dirname, 'dist/renderer/index.html'));
  
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
  if (networkListenerSocket) return;
  const listenerSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  networkListenerSocket = listenerSocket;

  listenerSocket.on('error', (err) => {
    console.error(`[NetworkStatus] Errore socket listener: ${err.stack}`);
    listenerSocket.close();
    networkListenerSocket = null;
  });

  listenerSocket.on('message', (msg) => {
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
let broadcastSocketReady = false;
let networkListenerSocket = null;

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
  broadcastSocketReady = false;
  broadcastSocket.bind(0, () => {
    try {
      broadcastSocket.setBroadcast(true);
      broadcastSocketReady = true;
    } catch (err) {
      console.error(`[NetworkStatus] Impossibile abilitare broadcast UDP: ${err.message}`);
    }
  });
  broadcastSocket.on('error', (err) => {
    console.error(`[NetworkStatus] Errore socket broadcast: ${err.message}`);
    try { broadcastSocket.close(); } catch {}
    broadcastSocket = null;
    broadcastSocketReady = false;
  });
  
  return broadcastSocket;
}

ipcMain.on('playback-status-update', (event, status) => {
  lastStatus = status;
  const socket = getBroadcastSocket();
  if (!socket || !broadcastSocketReady) return;

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
      socket.send(message, 0, message.length, UDP_STATUS_PORT, broadcastAddr, () => {
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
    clientTracking: true
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
// IPC DISCOVERY E CAST NATIVO
// ============================================

ipcMain.handle('get-local-ips', async () => {
  return getLocalInterfaces().map(iface => {
    const parts = iface.address.split('.');
    const base = parts.slice(0, 3).join('.');
    return {
      ip: iface.address,
      netmask: '255.255.255.0',
      base,
      network: `${base}.0`,
      interface: iface.name,
      maxHosts: 254,
      cidr: 24
    };
  });
});

ipcMain.handle('probe-device-services', async (_, ip) => {
  if (!isValidIPv4(ip)) return [];
  return probeDeviceServices(ip);
});

ipcMain.handle('scan-ip', async (_, ipOrSubnet) => {
  if (typeof ipOrSubnet !== 'string') return [];
  if (isValidIPv4(ipOrSubnet)) {
    const device = await buildDeviceFromIp(ipOrSubnet);
    return device ? [device] : [];
  }
  const base = ipOrSubnet.replace(/\.\d+$/, '').replace(/\.$/, '');
  if (!/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){2}$/.test(base)) return [];
  return scanSubnet(base, 254, 16);
});

ipcMain.handle('discover-devices', async () => {
  const byIp = new Map();
  const ssdpDevices = await discoverSsdpDevices();
  ssdpDevices.forEach(device => byIp.set(device.ip, device));

  const interfaces = getLocalInterfaces();
  for (const iface of interfaces.slice(0, 3)) {
    const base = iface.address.split('.').slice(0, 3).join('.');
    const devices = await scanSubnet(base, 254, 18);
    devices.forEach(device => {
      const existing = byIp.get(device.ip);
      byIp.set(device.ip, existing ? { ...device, ...existing, services: [...existing.services, ...device.services] } : device);
    });
  }

  return Array.from(byIp.values());
});

ipcMain.handle('cast-connect', async (_, options = {}) => {
  const ip = options.ip;
  if (!isValidIPv4(ip)) return { success: false, error: 'IP dispositivo non valido' };

  await closeCastClient();
  const port = Number(options.port) === 8008 ? 8009 : Number(options.port || 8009);
  const client = new Client();

  try {
    await withTimeout(new Promise((resolve, reject) => {
      client.connect(ip, () => resolve(true));
      client.once('error', reject);
    }), CAST_CONNECT_TIMEOUT_MS, `Timeout connessione Chromecast ${ip}:${port}`);

    castClient = client;
    castClient.on('error', (error) => {
      console.warn('[Cast] Client error:', error.message);
      closeCastClient();
    });
    sendCastStatus({ connected: true, playerState: 'IDLE', deviceIp: ip });
    return { success: true, status: castStatus };
  } catch (error) {
    try { client.close(); } catch {}
    return { success: false, error: error.message || 'Connessione cast fallita' };
  }
});

ipcMain.handle('cast-load', async (_, options = {}) => {
  if (!castClient) return { success: false, error: 'Nessuna sessione cast attiva' };
  const mediaUrl = options.mediaUrl;
  const title = options.title || 'StreamAI';
  if (typeof mediaUrl !== 'string' || !/^https?:\/\//i.test(mediaUrl)) {
    return { success: false, error: 'URL media non valido o non raggiungibile dal dispositivo' };
  }

  try {
    sendCastStatus({ playerState: 'BUFFERING', mediaTitle: title });
    castPlayer = await withTimeout(new Promise((resolve, reject) => {
      castClient.launch(DefaultMediaReceiver, (err, launchedPlayer) => err ? reject(err) : resolve(launchedPlayer));
    }), CAST_LOAD_TIMEOUT_MS, 'Timeout avvio receiver cast');
    const media = {
      contentId: mediaUrl,
      contentType: getCastContentType(mediaUrl),
      streamType: 'LIVE',
      metadata: { type: 0, metadataType: 0, title }
    };
    await withTimeout(new Promise((resolve, reject) => {
      castPlayer.load(media, { autoplay: true }, (err, status) => err ? reject(err) : resolve(status));
    }), CAST_LOAD_TIMEOUT_MS, 'Timeout caricamento stream sul dispositivo');

    sendCastStatus({ connected: true, playerState: 'PLAYING', mediaTitle: title });
    return { success: true, status: castStatus };
  } catch (error) {
    sendCastStatus({ playerState: 'IDLE', error: error.message });
    return { success: false, error: error.message || 'Caricamento cast fallito', status: castStatus };
  }
});

ipcMain.handle('cast-control', async (_, { action, value } = {}) => {
  if (action === 'status') return { success: true, status: castStatus };
  if (!castPlayer) return { success: false, error: 'Player cast non attivo', status: castStatus };

  try {
    if (action === 'play') castPlayer.play(() => {});
    else if (action === 'pause') castPlayer.pause(() => {});
    else if (action === 'stop') castPlayer.stop(() => {});
    else if (action === 'seek' && typeof value === 'number') castPlayer.seek(value, () => {});
    else if (action === 'volume' && typeof value === 'number' && castClient) castClient.setVolume({ level: Math.max(0, Math.min(1, value)) }, () => {});
    else if (action === 'mute' && typeof value === 'boolean' && castClient) castClient.setVolume({ muted: value }, () => {});
    else return { success: false, error: `Comando cast non supportato: ${action}`, status: castStatus };
    return { success: true, status: castStatus };
  } catch (error) {
    return { success: false, error: error.message, status: castStatus };
  }
});

ipcMain.handle('cast-disconnect', async () => {
  await closeCastClient();
  return { success: true, status: castStatus };
});

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

  if (broadcastSocket) {
    try { broadcastSocket.close(); } catch {}
    broadcastSocket = null;
    broadcastSocketReady = false;
  }

  if (networkListenerSocket) {
    try { networkListenerSocket.close(); } catch {}
    networkListenerSocket = null;
  }

  try { closeCastClient(); } catch {}
});

