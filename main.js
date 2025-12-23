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
const MDNS_PORT = 5353;
const MDNS_ADDR = '224.0.0.251';
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
  // Avvia l'annuncio mDNS
  setupMDNSAdvertisement();
  // Avvia il responder per la discovery HTTP
  setupDiscoveryResponder();
}

// ============================================
// LOGICA DI ANNUNCIO MDNS (BONJOUR) MANUALE
// ============================================
function setupMDNSAdvertisement() {
  const interfaces = getLocalInterfaces();
  
  // SSDP Listener per rispondere alle query M-SEARCH
  const ssdpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  ssdpSocket.on('message', (msg, rinfo) => {
    const message = msg.toString();
    if (message.includes('M-SEARCH')) {
      console.log(`[SSDP] Ricevuta query M-SEARCH da ${rinfo.address}:${rinfo.port}`);
      
      // Estrai il Search Target (ST) se presente
      const stMatch = message.match(/ST:\s*(.+)/i);
      const st = stMatch ? stMatch[1].trim() : 'ssdp:all';

      interfaces.forEach(iface => {
        const response = [
          'HTTP/1.1 200 OK',
          'CACHE-CONTROL: max-age=1800',
          `DATE: ${new Date().toUTCString()}`,
          'EXT:',
          `LOCATION: http://${iface.address}:1903/device.xml`,
          'SERVER: Electron/StreamAI UPnP/1.1',
          `ST: ${st === 'ssdp:all' ? 'urn:schemas-upnp-org:device:StreamAIRemote:1' : st}`,
          `USN: uuid:${deviceId}::${st === 'ssdp:all' ? 'urn:schemas-upnp-org:device:StreamAIRemote:1' : st}`,
          `X-WS-PORT: ${WS_CONTROL_PORT}`,
          'BOOTID.UPNP.ORG: 1',
          'CONFIGID.UPNP.ORG: 1',
          ''
        ].join('\r\n');
        const buffer = Buffer.from(response);
        ssdpSocket.send(buffer, 0, buffer.length, rinfo.port, rinfo.address);
      });
    }
  });

  ssdpSocket.bind(1900, '0.0.0.0', () => {
    try {
      ssdpSocket.addMembership('239.255.255.250');
      console.log('[SSDP] In ascolto su porta 1900 (Multicast 239.255.255.250)');
    } catch (e) {
      console.error('[SSDP] Errore bind 1900 o membership multicast:', e.message);
    }
  });

  // mDNS Listener (Porta 5353)
  const mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  mdnsSocket.on('message', (msg, rinfo) => {
    // Risposta minimale mDNS per segnalare la presenza del servizio
    // Se riceviamo una query (qualsiasi cosa su 5353), rispondiamo con un annuncio
    console.log(`[mDNS] Ricevuta query da ${rinfo.address}:${rinfo.port}`);
    
    // Invia una risposta mDNS più strutturata per essere rilevati da Google Cast/Android
    interfaces.forEach(iface => {
      const response = Buffer.from([
        0x00, 0x00, // ID
        0x84, 0x00, // Flags: Standard response, No error, Authoritative
        0x00, 0x00, // Questions
        0x00, 0x01, // Answer RRs
        0x00, 0x00, // Authority RRs
        0x00, 0x00, // Additional RRs
        // Answer: _googlecast._tcp.local
        0x0b, 0x5f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x63, 0x61, 0x73, 0x74,
        0x04, 0x5f, 0x74, 0x63, 0x70,
        0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c,
        0x00,
        0x00, 0x0c, // Type: PTR
        0x00, 0x01, // Class: IN
        0x00, 0x00, 0x11, 0x94, // TTL: 4500
        0x00, 0x02, // Data length
        0x00, 0x00 // Data (pointer or name)
      ]);
      mdnsSocket.send(response, 0, response.length, MDNS_PORT, MDNS_ADDR);
    });

    advertise();
  });
  
  mdnsSocket.bind(5353, '0.0.0.0', () => {
    try {
      mdnsSocket.addMembership('224.0.0.251');
      console.log('[mDNS] In ascolto su porta 5353 (Multicast 224.0.0.251)');
    } catch (e) {
      console.error('[mDNS] Errore membership multicast:', e.message);
    }
  });

  const advertise = () => {
    interfaces.forEach(iface => {
      broadcastSSDP(iface.address);
      // Annuncio DIAL (Discovery and Launch) - molto usato da YouTube/PrimeVideo
      broadcastDIAL(iface.address);
      // Annuncio Chromecast (mDNS)
      broadcastGoogleCast(iface.address);
    });
  };

  setInterval(advertise, 10000);
  advertise();
}

function broadcastGoogleCast(ip) {
  // Annuncio mDNS per simulare un ricevitore Google Cast (molto efficace su Android)
  const mdnsSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const name = `StreamAI-${deviceId.replace(/[^a-zA-Z0-9]/g, '')}`;
  
  // Questo è un pacchetto mDNS semplificato che annuncia il servizio _googlecast._tcp.local
  // In un ambiente reale useremmo una libreria, qui proviamo con un broadcast UDP sulla 5353
  // Molti smartphone Android scansionano costantemente per questi servizi
  const response = Buffer.from([
    0x00, 0x00, 0x84, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x0b, 0x5f, 0x67, 0x6f, 0x6f, 0x67, 0x6c, 0x65, 0x63, 0x61, 0x73, 0x74,
    0x04, 0x5f, 0x74, 0x63, 0x70, 0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c, 0x00,
    0x00, 0x0c, 0x00, 0x01, 0x00, 0x00, 0x11, 0x94, 0x00, 0x02, 0x00, 0x00
  ]);

  mdnsSocket.send(response, 0, response.length, MDNS_PORT, MDNS_ADDR, () => {
    mdnsSocket.close();
  });
}

function broadcastDIAL(ip) {
  const SSDP_ADDR = '239.255.255.250';
  const SSDP_PORT = 1900;
  const socket = dgram.createSocket('udp4');

  const msg = [
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'NT: urn:dial-multiscreen-org:service:dial:1',
    'NTS: ssap:alive',
    `USN: uuid:${deviceId}::urn:dial-multiscreen-org:service:dial:1`,
    `LOCATION: http://${ip}:1903/device.xml`,
    'CACHE-CONTROL: max-age=1800',
    'CONFIGID.UPNP.ORG: 1',
    'SERVER: Electron/StreamAI UPnP/1.1',
    ''
  ].join('\r\n');

  const buffer = Buffer.from(msg);
  socket.send(buffer, 0, buffer.length, SSDP_PORT, SSDP_ADDR, () => {
    socket.close();
  });
}

function broadcastSSDP(ip) {
  const SSDP_ADDR = '239.255.255.250';
  const SSDP_PORT = 1900;
  const socket = dgram.createSocket('udp4');

  const msg = [
    'NOTIFY * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'NT: urn:schemas-upnp-org:device:StreamAIRemote:1',
    'NTS: ssap:alive',
    `USN: uuid:${deviceId}::urn:schemas-upnp-org:device:StreamAIRemote:1`,
    `LOCATION: http://${ip}:1903/device.xml`,
    'CACHE-CONTROL: max-age=1800',
    `SERVER: Electron/${process.versions.electron} UPnP/1.1 StreamAI/1.0`,
    `X-WS-PORT: ${WS_CONTROL_PORT}`,
    `X-DEVICE-ID: ${deviceId}`,
    `X-CURRENT-CHANNEL: ${lastStatus?.channelName || ''}`,
    `X-IS-PLAYING: ${lastStatus?.isPlaying || false}`,
    ''
  ].join('\r\n');

  const buffer = Buffer.from(msg);
  socket.send(buffer, 0, buffer.length, SSDP_PORT, SSDP_ADDR, () => {
    socket.close();
  });
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
      
      // La discovery bidirezionale aggressiva è stata rimossa per migliorare le performance
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

// Funzione per ottenere tutte le interfacce di rete IPv4 valide
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

// Inizializza il socket di broadcast
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

// Gestore IPC per ricevere lo stato dalla UI e trasmetterlo
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

      // Importante: per il multicast affidabile, a volte è meglio impostare l'interfaccia
      // o inviare broadcast diretto se il multicast fallisce/è bloccato
      socket.send(message, 0, message.length, UDP_STATUS_PORT, MULTICAST_ADDR, (err) => {
        if (err) console.error(`[NetworkStatus] Fallimento invio su ${iface.address}: ${err.message}`);
      });

      // Invio anche come broadcast limitato per maggiore compatibilità
      const broadcastAddr = iface.address.split('.').slice(0, 3).join('.') + '.255';
      socket.setBroadcast(true);
      socket.send(message, 0, message.length, UDP_STATUS_PORT, broadcastAddr, (err) => {
        // Silenzioso se fallisce il broadcast diretto, è un fallback
      });
    } catch (e) {
      console.error(`[NetworkStatus] Errore durante il broadcast su ${iface.address}:`, e.message);
    }
  });

  // Inoltra lo stato anche ai client WebSocket connessi
  wsClients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: 'status', payload: status }));
    }
  });

  // Rinforzo annuncio SSDP ad ogni cambio stato
  const interfaces = getLocalInterfaces();
  interfaces.forEach(iface => broadcastSSDP(iface.address));
});

// Aggiungi un handler per le richieste HTTP minimali (se lo smartphone cerca il device.xml)
// Questo può servire per la discovery SSDP completa
function setupDiscoveryResponder() {
  const http = require('http');
  const server = http.createServer((req, res) => {
    if (req.url === '/device.xml') {
      res.writeHead(200, { 
        'Content-Type': 'text/xml', 
        'Application-URL': `http://${req.headers.host}/apps/`,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:r="urn:restful-tv-org:schemas:upnp-dd">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:StreamAIRemote:1</deviceType>
    <friendlyName>StreamAI (${os.hostname()})</friendlyName>
    <manufacturer>StreamAI</manufacturer>
    <manufacturerURL>https://github.com/alfio-e/StreamAI-IPTV</manufacturerURL>
    <modelDescription>StreamAI Remote Playback</modelDescription>
    <modelName>StreamAI Player</modelName>
    <modelNumber>1.0</modelNumber>
    <UDN>uuid:${deviceId}</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:RemoteControl:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:RemoteControl</serviceId>
        <controlURL>/control</controlURL>
        <eventSubURL>/event</eventSubURL>
        <SCPDURL>/remote.xml</SCPDURL>
      </service>
      <service>
        <serviceType>urn:dial-multiscreen-org:service:dial:1</serviceType>
        <serviceId>urn:dial-multiscreen-org:serviceId:dial</serviceId>
        <controlURL>/dial</controlURL>
        <eventSubURL></eventSubURL>
        <SCPDURL></SCPDURL>
      </service>
    </serviceList>
  </device>
</root>`);
    } else if (req.url.startsWith('/apps/StreamAI')) {
      // Endpoint DIAL per ottenere informazioni sull'app (necessario per molti client)
      res.writeHead(200, { 
        'Content-Type': 'text/xml',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(`<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial" dialect="1.0">
  <name>StreamAI</name>
  <options allowStop="true"/>
  <state>running</state>
  <link rel="run" href="run"/>
</service>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  
  // Usiamo una porta differente per l'XML o la stessa del WS se usiamo un server integrato
  // Ma per ora bindiamo sulla 1903
  server.listen(1903, '0.0.0.0', () => {
     console.log('[Discovery] XML Device description disponibile sulla porta 1903');
  });
}

// Chiamiamo setupDiscoveryResponder in createWindow

// ============================================
// LOGICA SERVER WEBSOCKET PER REMOTE CONTROL
// ============================================

function setupWebSocketServer() {
  // Configurazione con controllo origine rilassato per compatibilità mobile
  wss = new WebSocketServer({ 
    port: WS_CONTROL_PORT, 
    host: '0.0.0.0',
    clientTracking: true,
    handleProtocols: (protocols) => {
      return protocols[0];
    }
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

    // Invia l'ultimo stato noto al nuovo client
    if (lastStatus) {
      ws.send(JSON.stringify({ type: 'status', payload: lastStatus }));
    }

    // Richiedi un aggiornamento fresco alla UI per sincronizzare il nuovo client
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('request-status-broadcast');
    }

    ws.on('message', (message) => {
      try {
        const command = JSON.parse(message.toString());
        console.log('[WebSocketServer] Comando ricevuto:', command);

        // Pong per il heartbeat (se l'app lo richiede)
        if (command.action === 'ping') {
           ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
           return;
        }

        // Inoltra il comando al processo di rendering (UI)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('remote-control-command', command);
        }
      } catch (e) {
        console.warn('[WebSocketServer] Messaggio WebSocket malformato:', e.message);
      }
    });

    // Heartbeat interval per mantenere attiva la connessione
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
