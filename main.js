const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const dgram = require('dgram');
const os = require('os');
const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

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
// CONFIGURAZIONE GOOGLE CAST
// ============================================

// Abilita le API Cast di Chrome
app.commandLine.appendSwitch('load-media-router-component-extension', '1');
app.commandLine.appendSwitch('enable-media-router');

// Abilita discovery mDNS per trovare dispositivi Chromecast
app.commandLine.appendSwitch('enable-local-file-accesses');

// Abilita flags per Cast
app.commandLine.appendSwitch('enable-features', 'MediaRouter,GlobalMediaControls,CastMediaRouteProvider');

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

// ============================================
// NETWORK DEVICE DISCOVERY
// ============================================

/**
 * Get local IP addresses with subnet info
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Only IPv4, non-internal interfaces
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        const base = `${parts[0]}.${parts[1]}.${parts[2]}`;

        // Calculate network range based on netmask
        const netmaskParts = iface.netmask.split('.').map(Number);
        const ipParts = iface.address.split('.').map(Number);

        // Calculate network address
        const networkParts = ipParts.map((octet, i) => octet & netmaskParts[i]);

        // Calculate number of hosts (simplified)
        let hostBits = 0;
        for (const part of netmaskParts) {
          for (let i = 0; i < 8; i++) {
            if (((part >> i) & 1) === 0) hostBits++;
          }
        }

        // Max IPs to scan (limit to reasonable number)
        const maxHosts = Math.min(Math.pow(2, hostBits) - 2, 254);

        ips.push({
          ip: iface.address,
          netmask: iface.netmask,
          base: base,
          network: networkParts.join('.'),
          interface: name,
          maxHosts: maxHosts,
          cidr: 32 - hostBits,
        });

        console.log(`[Discovery] Found interface ${name}: ${iface.address}/${32 - hostBits} (${base}.x, max ${maxHosts} hosts)`);
      }
    }
  }

  return ips;
}

/**
 * Check if a port is open on an IP
 */
function checkPort(ip, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      resolved = true;
      socket.destroy();
      resolve({ ip, port, open: true });
    });

    socket.on('timeout', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ ip, port, open: false });
      }
    });

    socket.on('error', () => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ ip, port, open: false });
      }
    });

    socket.connect(port, ip);
  });
}

/**
 * Scan network for devices
 */
async function scanNetwork(event, options = {}) {
  const { ports = [8008, 8443, 9080, 8080, 7000, 3000, 55000, 8060, 8001, 5556] } = options;

  const localIPs = getLocalIPs();
  const devices = [];
  const scanned = new Set();

  console.log('[Discovery] Local network interfaces:', localIPs.length);

  // Device type mapping
  const portTypes = {
    8008: { type: 'chromecast', name: 'Chromecast/Google Cast' },
    8443: { type: 'chromecast', name: 'Chromecast (HTTPS)' },
    9080: { type: 'dlna', name: 'DLNA Media Renderer' },
    8080: { type: 'dlna', name: 'Media Server' },
    7000: { type: 'smarttv', name: 'Samsung Smart TV' },
    3000: { type: 'smarttv', name: 'LG Smart TV' },
    55000: { type: 'androidtv', name: 'Android TV' },
    8060: { type: 'androidtv', name: 'Roku/Android TV' },
    8001: { type: 'smarttv', name: 'Samsung TV (Tizen)' },
    5556: { type: 'firetv', name: 'Fire TV' },
  };

  // Scan each network interface's subnet
  for (const netInfo of localIPs) {
    const { base, ip: localIP, maxHosts, cidr } = netInfo;

    // Determine scan range based on network size
    const maxIP = Math.min(maxHosts, 254);

    console.log(`[Discovery] Scanning ${base}.x (/${cidr}) - up to ${maxIP} hosts...`);

    // Scan IPs in batches
    const batchSize = 20;

    for (let startIP = 1; startIP <= maxIP; startIP += batchSize) {
      const batch = [];

      for (let i = startIP; i < Math.min(startIP + batchSize, maxIP + 1); i++) {
        const targetIP = `${base}.${i}`;

        // Skip our own IPs
        const isOwnIP = localIPs.some(l => l.ip === targetIP);
        if (isOwnIP) continue;

        for (const port of ports) {
          const key = `${targetIP}:${port}`;
          if (scanned.has(key)) continue;
          scanned.add(key);

          batch.push(checkPort(targetIP, port, 800));
        }
      }

      const results = await Promise.all(batch);

      for (const result of results) {
        if (result.open) {
          // Skip if we already found this IP (prefer port 8008)
          const existingDevice = devices.find(d => d.ip === result.ip);
          if (existingDevice) {
            // Only replace if this is port 8008 and existing is not
            if (result.port !== 8008 || existingDevice.port === 8008) {
              continue;
            }
            // Remove the existing device to replace it
            const idx = devices.indexOf(existingDevice);
            if (idx > -1) devices.splice(idx, 1);
          }

          const portInfo = portTypes[result.port] || { type: 'unknown', name: 'Dispositivo' };
          const device = {
            id: `${result.ip}:${result.port}`,
            ip: result.ip,
            port: result.port,
            type: portInfo.type,
            name: `${portInfo.name} (${result.ip})`,
          };

          devices.push(device);
          console.log(`[Discovery] Found: ${device.name}`);

          // Send incremental updates (only for new IPs)
          if (event && event.sender && !event.sender.isDestroyed()) {
            event.sender.send('device-found', device);
          }
        }
      }
    }
  }

  return devices;
}

/**
 * Send SSDP discovery request
 */
function ssdpDiscover(event) {
  return new Promise((resolve) => {
    const devices = [];
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const SSDP_ADDR = '239.255.255.250';
    const SSDP_PORT = 1900;
    const SEARCH_MSG = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      `HOST: ${SSDP_ADDR}:${SSDP_PORT}\r\n` +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      'ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n' +
      '\r\n'
    );

    socket.on('message', (msg, rinfo) => {
      const response = msg.toString();
      console.log('[SSDP] Response from:', rinfo.address);

      // Parse device info from response
      const locationMatch = response.match(/LOCATION:\s*(.+)/i);
      const serverMatch = response.match(/SERVER:\s*(.+)/i);

      const device = {
        id: `ssdp-${rinfo.address}`,
        ip: rinfo.address,
        port: 0,
        type: 'dlna',
        name: serverMatch ? serverMatch[1].trim() : `DLNA Device (${rinfo.address})`,
        location: locationMatch ? locationMatch[1].trim() : null,
      };

      // Extract port from location URL
      if (device.location) {
        const portMatch = device.location.match(/:(\d+)/);
        if (portMatch) {
          device.port = parseInt(portMatch[1], 10);
          device.id = `${rinfo.address}:${device.port}`;
        }
      }

      devices.push(device);

      if (event && event.sender && !event.sender.isDestroyed()) {
        event.sender.send('device-found', device);
      }
    });

    socket.on('error', (err) => {
      console.log('[SSDP] Error:', err.message);
    });

    socket.bind(() => {
      socket.setBroadcast(true);
      socket.setMulticastTTL(4);

      // Send discovery message multiple times
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          socket.send(SEARCH_MSG, SSDP_PORT, SSDP_ADDR);
        }, i * 500);
      }
    });

    // Close after timeout
    setTimeout(() => {
      socket.close();
      resolve(devices);
    }, 5000);
  });
}

// IPC handlers for device discovery
ipcMain.handle('discover-devices', async (event) => {
  console.log('[IPC] Starting device discovery...');

  try {
    // Run both discovery methods in parallel
    const [portScanDevices, ssdpDevices] = await Promise.all([
      scanNetwork(event),
      ssdpDiscover(event),
    ]);

    // Merge and deduplicate by IP (prefer port 8008 for Chromecast)
    const devicesByIP = new Map();

    // First add port scan devices (these have more accurate port info)
    for (const device of portScanDevices) {
      const existing = devicesByIP.get(device.ip);
      if (!existing || device.port === 8008) {
        devicesByIP.set(device.ip, device);
      }
    }

    // Then add SSDP devices only if IP not already found
    for (const device of ssdpDevices) {
      if (!devicesByIP.has(device.ip)) {
        devicesByIP.set(device.ip, device);
      }
    }

    // Get real device names and probe services for Chromecast devices
    const allDevices = [];
    for (const device of devicesByIP.values()) {
      // Initialize services array
      device.services = [];

      // Try to get the real name for Chromecast/Cast devices
      if (device.port === 8008 || device.type === 'chromecast') {
        try {
          const realName = await getDeviceName(device.ip);
          if (realName && !realName.includes('(')) {
            device.name = realName;
          }

          // Add Cast V2 as primary service
          device.services.push({
            protocol: 'castv2',
            port: 8008,
            priority: 1,
            available: true,
          });
        } catch {}
      }

      // Add services based on detected ports
      if (device.port === 9080 || device.type === 'dlna') {
        device.services.push({
          protocol: 'dlna',
          port: device.port || 9080,
          priority: 4,
          available: true,
        });
      }

      allDevices.push(device);
    }

    console.log('[IPC] Discovery complete. Found', allDevices.length, 'unique devices');
    return allDevices;
  } catch (err) {
    console.error('[IPC] Discovery error:', err);
    return [];
  }
});

/**
 * Get device name from eureka_info endpoint
 */
async function getDeviceName(ip) {
  const http = require('http');
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:8008/setup/eureka_info`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info.name || null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Scan a specific IP or subnet for Cast devices
ipcMain.handle('scan-ip', async (event, ipOrSubnet) => {
  console.log('[IPC] Scanning specific IP/subnet:', ipOrSubnet);

  const devices = [];
  const ports = [8008, 8443, 9080];

  // Check if it's a full IP or just a subnet
  const parts = ipOrSubnet.split('.');

  if (parts.length === 4) {
    // Full IP - scan just this IP
    for (const port of ports) {
      const result = await checkPort(ipOrSubnet, port, 2000);
      if (result.open) {
        // Try to get device name
        let deviceName = `Dispositivo (${ipOrSubnet})`;
        try {
          const http = require('http');
          const infoUrl = `http://${ipOrSubnet}:8008/setup/eureka_info`;
          const info = await new Promise((resolve) => {
            const req = http.get(infoUrl, { timeout: 3000 }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch { resolve(null); }
              });
            });
            req.on('error', () => resolve(null));
            req.on('timeout', () => { req.destroy(); resolve(null); });
          });
          if (info && info.name) {
            deviceName = info.name;
          }
        } catch {}

        devices.push({
          id: `${ipOrSubnet}:${port}`,
          ip: ipOrSubnet,
          port,
          type: port === 8008 ? 'chromecast' : 'unknown',
          name: deviceName,
        });
      }
    }
  } else if (parts.length === 3) {
    // Subnet - scan range
    for (let i = 1; i <= 150; i++) {
      const ip = `${ipOrSubnet}.${i}`;
      const result = await checkPort(ip, 8008, 500);
      if (result.open) {
        devices.push({
          id: `${ip}:8008`,
          ip,
          port: 8008,
          type: 'chromecast',
          name: `Chromecast (${ip})`,
        });

        if (event && event.sender && !event.sender.isDestroyed()) {
          event.sender.send('device-found', devices[devices.length - 1]);
        }
      }
    }
  }

  return devices;
});

// Probe all available casting services on a device
ipcMain.handle('probe-device-services', async (event, ip) => {
  console.log('[IPC] Probing services on:', ip);

  const serviceConfigs = [
    { port: 8008, protocol: 'castv2', priority: 1, testPath: '/setup/eureka_info' },
    { port: 8009, protocol: 'castv2', priority: 1, testPath: null }, // TLS port
    { port: 8443, protocol: 'castv2', priority: 2, testPath: null }, // HTTPS
    { port: 9080, protocol: 'dlna', priority: 4, testPath: '/description.xml' },
    { port: 8080, protocol: 'dlna', priority: 5, testPath: '/' },
    { port: 7000, protocol: 'airplay', priority: 7, testPath: '/info' },
    { port: 5353, protocol: 'mdns', priority: 10, testPath: null },
  ];

  const services = [];

  for (const config of serviceConfigs) {
    const result = await checkPort(ip, config.port, 1500);

    if (result.open) {
      // Additional validation for specific protocols
      let validated = true;

      if (config.testPath) {
        try {
          const http = require('http');
          validated = await new Promise((resolve) => {
            const req = http.get(`http://${ip}:${config.port}${config.testPath}`, { timeout: 2000 }, (res) => {
              resolve(res.statusCode < 500);
            });
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
          });
        } catch {
          validated = false;
        }
      }

      if (validated) {
        services.push({
          protocol: config.protocol,
          port: config.port,
          priority: config.priority,
          available: true,
        });
      }
    }
  }

  // Sort by priority
  services.sort((a, b) => a.priority - b.priority);

  console.log('[IPC] Found services:', services.map(s => `${s.protocol}:${s.port}`));
  return services;
});

ipcMain.handle('get-local-ips', () => {
  return getLocalIPs();
});

// Cast media to a Chromecast device using Cast V2 protocol
ipcMain.handle('cast-to-device', async (event, { ip, port, mediaUrl, title, contentType }) => {
  console.log('[Cast] Casting to device:', ip, mediaUrl);

  return new Promise((resolve) => {
    const client = new Client();
    let timeout;

    const cleanup = () => {
      clearTimeout(timeout);
      try { client.close(); } catch {}
    };

    timeout = setTimeout(() => {
      console.log('[Cast] Connection timeout');
      cleanup();
      resolve({ success: false, error: 'Connection timeout' });
    }, 15000);

    client.on('error', (err) => {
      console.log('[Cast] Client error:', err.message);
      cleanup();
      resolve({ success: false, error: err.message });
    });

    client.connect(ip, () => {
      console.log('[Cast] Connected to device');

      client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          console.log('[Cast] Launch error:', err.message);
          cleanup();
          resolve({ success: false, error: err.message });
          return;
        }

        console.log('[Cast] Launched DefaultMediaReceiver');

        // Determine content type
        let mimeType = contentType || 'video/mp4';
        if (mediaUrl.includes('.m3u8')) {
          mimeType = 'application/x-mpegURL';
        } else if (mediaUrl.includes('.ts')) {
          mimeType = 'video/mp2t';
        }

        const media = {
          contentId: mediaUrl,
          contentType: mimeType,
          streamType: 'BUFFERED',
          metadata: {
            type: 0,
            metadataType: 0,
            title: title || 'Video'
          }
        };

        player.on('status', (status) => {
          console.log('[Cast] Player status:', status.playerState);
          if (status.playerState === 'PLAYING') {
            console.log('[Cast] Playback started!');
          }
        });

        player.load(media, { autoplay: true }, (err, status) => {
          if (err) {
            console.log('[Cast] Load error:', err.message);
            cleanup();
            resolve({ success: false, error: err.message });
            return;
          }

          console.log('[Cast] Media loaded, status:', status.playerState);
          clearTimeout(timeout);

          // Keep connection alive but resolve success
          resolve({ success: true, status: status.playerState });

          // Close after playback starts (optional: keep alive for controls)
          setTimeout(() => {
            try { client.close(); } catch {}
          }, 5000);
        });
      });
    });
  });
});

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
      preload: path.join(__dirname, 'preload.js'),
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

