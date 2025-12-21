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
app.commandLine.appendSwitch('unlimited-storage');

// ============================================
// CONFIGURAZIONE SSL/TLS - Ignora errori certificati
// ============================================
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('ignore-ssl-errors', 'true');
app.commandLine.appendSwitch('ignore-urlfetcher-cert-requests');
app.commandLine.appendSwitch('allow-insecure-localhost');
app.commandLine.appendSwitch('allow-running-insecure-content');
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ssl-version-min', 'tls1');
app.commandLine.appendSwitch('cipher-suite-blacklist', '');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('log-level', '3');

// ============================================
// CONFIGURAZIONE GOOGLE CAST
// ============================================
app.commandLine.appendSwitch('load-media-router-component-extension', '1');
app.commandLine.appendSwitch('enable-media-router');
app.commandLine.appendSwitch('enable-local-file-accesses');

// ============================================
// GESTIONE FEATURES (ENABLE/DISABLE)
// ============================================

// Lista delle features da ABILITARE
const enabledFeatures = [
  'MediaRouter',
  'GlobalMediaControls',
  'CastMediaRouteProvider',
  'PlatformHEVCDecoderSupport', // Supporto HEVC
  'ProprietaryCodecs'           // Codec proprietari
];

// Lista delle features da DISABILITARE
const disabledFeatures = [
  'BlockInsecurePrivateNetworkRequests',
  'IsolateOrigins',
  'site-per-process',
  'HardwareMediaKeyHandling'
];

// Configurazione specifica per Linux
if (isLinux) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  
  // Codec e VAAPI per Linux
  enabledFeatures.push(
    'VaapiVideoDecoder',
    'VaapiVideoDecodeLinuxGL',
    'VaapiIgnoreDriverChecks',
    'UseChromeOSDirectVideoDecoder'
  );

  // Forza ffmpeg per decodifica software se HW fallisce
  app.commandLine.appendSwitch('enable-ffmpeg-video-decoding');
  app.commandLine.appendSwitch('enable-proprietary-codecs');
}

// Configurazione specifica per Windows
if (process.platform === 'win32') {
  enabledFeatures.push(
    'MediaFoundationAsyncH264Encoding',
    'MediaFoundationVideoCapture',
    'MediaFoundationH264Encoding',
    'MediaFoundationClearPlayback'
  );
}

// Applica le features accumulate
app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));

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

// ============================================
// CAST SESSION MANAGER - Gestione sessione persistente
// ============================================

let activeCastSession = null;

/**
 * Cast Session Manager
 * Mantiene la connessione attiva per permettere i controlli
 */
class CastSession {
  constructor(ip) {
    this.ip = ip;
    this.client = new Client();
    this.player = null;
    this.connected = false;
    this.currentStatus = null;
    this.statusCallbacks = [];
    this.mainWindow = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 15000);

      this.client.on('error', (err) => {
        console.log('[CastSession] Client error:', err.message);
        this.connected = false;
        this.notifyStatus({ connected: false, error: err.message });
      });

      this.client.connect(this.ip, () => {
        clearTimeout(timeout);
        console.log('[CastSession] Connected to:', this.ip);
        this.connected = true;
        resolve();
      });
    });
  }

  async launch() {
    return new Promise((resolve, reject) => {
      this.client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          reject(err);
          return;
        }

        this.player = player;
        console.log('[CastSession] DefaultMediaReceiver launched');

        // Listen for status updates
        player.on('status', (status) => {
          this.currentStatus = status;
          this.notifyStatus(this.getStatus());
        });

        resolve(player);
      });
    });
  }

  async loadMedia(mediaUrl, title, contentType) {
    console.log('[CastSession] loadMedia called, player exists:', !!this.player);

    if (!this.player) {
      console.log('[CastSession] No player, launching...');
      await this.launch();
      console.log('[CastSession] Launch complete, player exists:', !!this.player);
    }

    return new Promise((resolve, reject) => {
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

      console.log('[CastSession] Loading media:', title, 'mimeType:', mimeType);

      this.player.load(media, { autoplay: true }, (err, status) => {
        if (err) {
          console.log('[CastSession] Load error:', err.message);
          reject(err);
          return;
        }
        console.log('[CastSession] Media loaded, status:', status?.playerState);
        this.currentStatus = status;
        resolve(status);
      });
    });
  }

  // Playback controls - con callback per conferma
  play(callback) {
    if (this.player) {
      console.log('[CastSession] Sending PLAY command');
      this.player.play((err, status) => {
        if (err) {
          console.log('[CastSession] Play error:', err.message);
        } else {
          console.log('[CastSession] Play success, status:', status?.playerState);
          if (status) {
            this.currentStatus = status;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, status);
      });
    }
  }

  pause(callback) {
    if (this.player) {
      console.log('[CastSession] Sending PAUSE command');
      this.player.pause((err, status) => {
        if (err) {
          console.log('[CastSession] Pause error:', err.message);
        } else {
          console.log('[CastSession] Pause success, status:', status?.playerState);
          if (status) {
            this.currentStatus = status;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, status);
      });
    }
  }

  stop(callback) {
    if (this.player) {
      console.log('[CastSession] Sending STOP command');
      this.player.stop((err, status) => {
        if (err) {
          console.log('[CastSession] Stop error:', err.message);
        } else {
          console.log('[CastSession] Stop success');
          if (status) {
            this.currentStatus = status;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, status);
      });
    }
  }

  seek(time, callback) {
    if (this.player) {
      console.log('[CastSession] Sending SEEK command to:', time);
      this.player.seek(time, (err, status) => {
        if (err) {
          console.log('[CastSession] Seek error:', err.message);
        } else {
          console.log('[CastSession] Seek success');
          if (status) {
            this.currentStatus = status;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, status);
      });
    }
  }

  setVolume(level, callback) {
    if (this.client && this.connected) {
      const vol = Math.max(0, Math.min(1, level));
      console.log('[CastSession] Setting volume to:', vol);
      this.client.setVolume({ level: vol }, (err, volume) => {
        if (err) {
          console.log('[CastSession] Volume error:', err.message);
        } else {
          console.log('[CastSession] Volume set to:', volume?.level);
          // Update status with new volume
          if (this.currentStatus) {
            this.currentStatus.volume = volume;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, volume);
      });
    }
  }

  setMuted(muted, callback) {
    if (this.client && this.connected) {
      console.log('[CastSession] Setting muted to:', muted);
      this.client.setVolume({ muted }, (err, volume) => {
        if (err) {
          console.log('[CastSession] Mute error:', err.message);
        } else {
          console.log('[CastSession] Muted set to:', volume?.muted);
          if (this.currentStatus) {
            this.currentStatus.volume = volume;
            this.notifyStatus(this.getStatus());
          }
        }
        if (callback) callback(err, volume);
      });
    }
  }

  // Richiedi lo stato attuale dal player
  requestStatus(callback) {
    if (this.player) {
      this.player.getStatus((err, status) => {
        if (err) {
          console.log('[CastSession] getStatus error:', err.message);
        } else if (status) {
          this.currentStatus = status;
          this.notifyStatus(this.getStatus());
        }
        if (callback) callback(err, status);
      });
    }
  }

  getStatus() {
    const status = this.currentStatus || {};
    return {
      connected: this.connected,
      playerState: status.playerState || 'IDLE',
      currentTime: status.currentTime || 0,
      duration: status.media?.duration || 0,
      volume: status.volume?.level || 1,
      muted: status.volume?.muted || false,
      mediaTitle: status.media?.metadata?.title || '',
    };
  }

  notifyStatus(status) {
    // Send status to renderer
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('cast-status', status);
    }
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  close() {
    console.log('[CastSession] Closing session and stopping app on device');
    this.connected = false;

    // Prima ferma il player
    if (this.player) {
      try {
        this.player.stop();
        console.log('[CastSession] Player stopped');
      } catch (e) {
        console.log('[CastSession] Player stop error:', e.message);
      }
    }

    // Poi chiudi l'applicazione Cast sul dispositivo (questo chiude l'app remota)
    if (this.client) {
      try {
        // stop() sull'app per chiuderla completamente sul dispositivo
        this.client.stop(this.player, (err) => {
          if (err) {
            console.log('[CastSession] Client stop app error:', err.message);
          } else {
            console.log('[CastSession] Cast app closed on device');
          }

          // Chiudi la connessione
          try {
            this.client.close();
            console.log('[CastSession] Connection closed');
          } catch (e) {
            console.log('[CastSession] Client close error:', e.message);
          }
        });
      } catch (e) {
        console.log('[CastSession] Error stopping app:', e.message);
        // Fallback: chiudi comunque la connessione
        try { this.client.close(); } catch {}
      }
    }

    this.player = null;
    this.notifyStatus({ connected: false });
  }
}

// IPC Handlers for Cast controls

ipcMain.handle('cast-connect', async (event, { ip }) => {
  console.log('[Cast] cast-connect called for IP:', ip);

  // Close existing session
  if (activeCastSession) {
    console.log('[Cast] Closing existing session');
    activeCastSession.close();
  }

  try {
    activeCastSession = new CastSession(ip);
    activeCastSession.setMainWindow(BrowserWindow.fromWebContents(event.sender));

    console.log('[Cast] Connecting...');
    await activeCastSession.connect();
    console.log('[Cast] Connected, launching player...');
    await activeCastSession.launch();
    console.log('[Cast] Player launched, player exists:', !!activeCastSession.player);

    return { success: true };
  } catch (err) {
    console.error('[Cast] Connect error:', err.message);
    activeCastSession = null;
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cast-load', async (event, { mediaUrl, title, contentType }) => {
  console.log('[Cast] cast-load called:', title);
  console.log('[Cast] activeCastSession exists:', !!activeCastSession);
  console.log('[Cast] activeCastSession.connected:', activeCastSession?.connected);
  console.log('[Cast] activeCastSession.player exists:', !!activeCastSession?.player);

  if (!activeCastSession || !activeCastSession.connected) {
    console.log('[Cast] ERROR: Not connected');
    return { success: false, error: 'Not connected' };
  }

  try {
    const status = await activeCastSession.loadMedia(mediaUrl, title, contentType);
    return { success: true, status: activeCastSession.getStatus() };
  } catch (err) {
    console.error('[Cast] Load error:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('cast-control', async (event, { action, value }) => {
  console.log('[Cast] Control received:', action, value);
  console.log('[Cast] activeCastSession exists:', !!activeCastSession);
  console.log('[Cast] activeCastSession.connected:', activeCastSession?.connected);
  console.log('[Cast] activeCastSession.player exists:', !!activeCastSession?.player);

  if (!activeCastSession) {
    console.log('[Cast] ERROR: No active session');
    return { success: false, error: 'No active session' };
  }

  if (!activeCastSession.player) {
    console.log('[Cast] ERROR: No player available');
    return { success: false, error: 'No player available' };
  }

  if (!activeCastSession.connected) {
    console.log('[Cast] ERROR: Session not connected');
    return { success: false, error: 'Session not connected' };
  }

  return new Promise((resolve) => {
    const callback = (err, result) => {
      console.log('[Cast] Control callback - err:', err?.message, 'result:', result?.playerState || result);
      if (err) {
        resolve({ success: false, error: err.message });
      } else {
        resolve({ success: true, status: activeCastSession.getStatus() });
      }
    };

    try {
      switch (action) {
        case 'play':
          activeCastSession.play(callback);
          break;
        case 'pause':
          activeCastSession.pause(callback);
          break;
        case 'stop':
          activeCastSession.stop(callback);
          break;
        case 'seek':
          activeCastSession.seek(value, callback);
          break;
        case 'volume':
          activeCastSession.setVolume(value, callback);
          break;
        case 'mute':
          activeCastSession.setMuted(value, callback);
          break;
        case 'status':
          activeCastSession.requestStatus(callback);
          break;
        default:
          resolve({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
});

ipcMain.handle('cast-status', async () => {
  if (!activeCastSession) {
    return { connected: false };
  }
  return activeCastSession.getStatus();
});

ipcMain.handle('cast-disconnect', async () => {
  console.log('[Cast] Disconnecting');
  if (activeCastSession) {
    activeCastSession.close();
    activeCastSession = null;
  }
  return { success: true };
});

// Legacy handler for backward compatibility
ipcMain.handle('cast-to-device', async (event, { ip, mediaUrl, title, contentType }) => {
  console.log('[Cast] Legacy cast to device:', ip);

  // Use the new session-based approach
  if (activeCastSession) {
    activeCastSession.close();
  }

  try {
    activeCastSession = new CastSession(ip);
    activeCastSession.setMainWindow(BrowserWindow.fromWebContents(event.sender));
    await activeCastSession.connect();
    await activeCastSession.launch();
    const status = await activeCastSession.loadMedia(mediaUrl, title, contentType);
    return { success: true, status: activeCastSession.getStatus() };
  } catch (err) {
    console.error('[Cast] Error:', err.message);
    if (activeCastSession) {
      activeCastSession.close();
      activeCastSession = null;
    }
    return { success: false, error: err.message };
  }
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

