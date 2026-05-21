// DLNA/UPnP Device Discovery and Media Casting Service
// Uses the desktop host bridge (Electron or Wails) for native network
// scanning when available — vedi services/hostBridge.ts (Fase 7.2).

import { platformService } from './platformService';
import { host } from './hostBridge';

// Type for Electron API
interface NetworkInterface {
  ip: string;
  netmask: string;
  base: string;
  network: string;
  interface: string;
  maxHosts: number;
  cidr: number;
}

interface ElectronAPI {
  discoverDevices: () => Promise<DiscoveredDevice[]>;
  getLocalIPs: () => Promise<NetworkInterface[]>;
  onDeviceFound: (callback: (device: DiscoveredDevice) => void) => () => void;
  castToDevice: (options: {
    ip: string;
    port: number;
    mediaUrl: string;
    title: string;
    contentType?: string;
    protocol?: string;
  }) => Promise<{ success: boolean; error?: string; status?: string }>;
  scanIp: (ipOrSubnet: string) => Promise<DiscoveredDevice[]>;
  probeDeviceServices: (ip: string) => Promise<CastService[]>;
  updatePlaybackStatus?: (status: unknown) => void;
  onNetworkPlaybackStatus?: (callback: (status: { deviceId: string; channelName: string }) => void) => () => void;
  onRemoteControlCommand?: (callback: (command: unknown) => void) => () => void;
  onRequestStatusBroadcast?: (callback: () => void) => () => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export interface CastService {
  protocol: 'castv2' | 'dial' | 'dlna' | 'airplay' | 'miracast';
  port: number;
  priority: number; // Lower = higher priority
  available: boolean;
}

export interface DiscoveredDevice {
  id: string;
  name: string;
  type: 'chromecast' | 'dlna' | 'smarttv' | 'androidtv' | 'firetv' | 'unknown';
  ip: string;
  port: number; // Primary port
  services: CastService[]; // All available casting services
  location?: string;
  manufacturer?: string;
  model?: string;
}

export interface DeviceDiscoveryState {
  isSearching: boolean;
  devices: DiscoveredDevice[];
  error: string | null;
  progress: {
    phase: string;
    scannedHosts: number;
    totalHosts: number;
  };
  lastUpdatedAt: number | null;
}

type DeviceCallback = (state: DeviceDiscoveryState) => void;

const DISCOVERY_TIMEOUT_MS = 20000;
const DEVICE_CACHE_TTL_MS = 2 * 60 * 1000;
const SUBNET_CONCURRENCY = 16;
const PROBE_TIMEOUT_MS = 900;
const MANUAL_DEVICE_ID = 'manual';

interface CachedDiscovery {
  timestamp: number;
  devices: DiscoveredDevice[];
}

class DeviceDiscoveryService {
  private devices: Map<string, DiscoveredDevice> = new Map();
  private callbacks: Set<DeviceCallback> = new Set();
  private isSearching = false;
  private searchTimeout: number | null = null;
  private error: string | null = null;
  private electronUnsubscribe: (() => void) | null = null;
  private abortController: AbortController | null = null;
  private cache: CachedDiscovery | null = null;
  private progress = { phase: 'Inattivo', scannedHosts: 0, totalHosts: 0 };
  private discoveryRunId = 0;

  /**
   * Check if a desktop bridge (Electron or Wails) is available.
   * Mantiene il nome `isElectron` per minimizzare diff sui call site; copre
   * entrambi i runtime desktop dopo la Fase 7.2.
   */
  private get isElectron(): boolean {
    return platformService.isDesktop && !!host;
  }

  /**
   * Subscribe to device discovery updates
   */
  subscribe(callback: DeviceCallback): () => void {
    this.callbacks.add(callback);
    callback(this.getState());
    return () => this.callbacks.delete(callback);
  }

  /**
   * Get current state
   */
  getState(): DeviceDiscoveryState {
    return {
      isSearching: this.isSearching,
      devices: Array.from(this.devices.values()),
      error: this.error,
      progress: this.progress,
      lastUpdatedAt: this.cache?.timestamp || null,
    };
  }

  private notify() {
    const state = this.getState();
    this.callbacks.forEach(cb => cb(state));
  }

  private ensureNotAborted() {
    if (this.abortController?.signal.aborted) {
      throw new DOMException('Discovery aborted', 'AbortError');
    }
  }

  private updateProgress(phase: string, scannedDelta = 0, totalHosts?: number) {
    this.progress = {
      phase,
      scannedHosts: this.progress.scannedHosts + scannedDelta,
      totalHosts: totalHosts ?? this.progress.totalHosts,
    };
    this.notify();
  }

  private getDeviceKey(device: DiscoveredDevice): string {
    if (device.id === MANUAL_DEVICE_ID) return MANUAL_DEVICE_ID;
    const protocols = (device.services || []).map(service => service.protocol).sort().join('+') || 'unknown';
    return `${device.ip}:${protocols}`;
  }

  private addOrMergeDevice(device: DiscoveredDevice) {
    if (device.id === MANUAL_DEVICE_ID) {
      this.devices.set(MANUAL_DEVICE_ID, device);
      return;
    }

    const key = this.getDeviceKey(device);
    const existingEntry = Array.from(this.devices.entries()).find(([, existing]) => this.getDeviceKey(existing) === key || (existing.ip === device.ip && existing.type === device.type));

    if (!existingEntry) {
      this.devices.set(device.id, device);
      return;
    }

    const [existingId, existing] = existingEntry;
    const servicesByKey = new Map<string, CastService>();
    [...(existing.services || []), ...(device.services || [])].forEach(service => {
      servicesByKey.set(`${service.protocol}:${service.port}`, service);
    });

    this.devices.set(existingId, {
      ...existing,
      ...device,
      id: existing.id,
      name: existing.name.includes('(') && !device.name.includes('(') ? device.name : existing.name,
      services: Array.from(servicesByKey.values()).sort((a, b) => a.priority - b.priority),
    });
  }

  private async fetchWithTimeout(url: string, timeoutMs = PROBE_TIMEOUT_MS, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    const parentSignal = this.abortController?.signal;
    const onAbort = () => controller.abort();
    parentSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      window.clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Start searching for devices
   */
  async startDiscovery(forceRefresh = false): Promise<void> {
    if (this.isSearching) {
      this.stopDiscovery();
      return;
    }

    if (!forceRefresh && this.cache && Date.now() - this.cache.timestamp < DEVICE_CACHE_TTL_MS) {
      this.devices.clear();
      this.cache.devices.forEach(device => this.addOrMergeDevice(device));
      this.addManualEntryOption();
      this.progress = { phase: 'Risultati da cache recente', scannedHosts: this.progress.totalHosts, totalHosts: this.progress.totalHosts };
      this.error = null;
      this.notify();
      return;
    }

    this.isSearching = true;
    this.error = null;
    this.devices.clear();
    this.progress = { phase: 'Avvio ricerca dispositivi', scannedHosts: 0, totalHosts: 0 };
    this.abortController = new AbortController();
    const runId = ++this.discoveryRunId;
    this.notify();

    this.searchTimeout = window.setTimeout(() => {
      this.stopDiscovery();
    }, DISCOVERY_TIMEOUT_MS);

    console.log('[Discovery] Starting device discovery...');
    console.log('[Discovery] Electron API available:', this.isElectron);

    try {
      if (this.isElectron) {
        // Use Electron native discovery
        await this.discoverViaElectron();
      } else {
        // Fallback to browser-based discovery
        await this.discoverViaBrowser();
      }

      // Always add manual entry option
      this.addManualEntryOption();
      this.cache = {
        timestamp: Date.now(),
        devices: Array.from(this.devices.values()).filter(device => device.id !== MANUAL_DEVICE_ID),
      };

    } catch (err) {
      if (runId === this.discoveryRunId && !this.abortController?.signal.aborted) {
        console.error('[Discovery] Error:', err);
        this.error = 'Errore durante la ricerca dispositivi';
      }
    } finally {
      if (runId === this.discoveryRunId) {
        this.isSearching = false;
        if (this.searchTimeout) {
          window.clearTimeout(this.searchTimeout);
          this.searchTimeout = null;
        }
        if (this.electronUnsubscribe) {
          this.electronUnsubscribe();
          this.electronUnsubscribe = null;
        }
        this.abortController = null;
        this.progress = {
          ...this.progress,
          phase: this.error ? 'Ricerca terminata con errori' : 'Ricerca completata',
        };
        this.notify();
      }
    }
  }

  /**
   * Use Electron IPC for native network discovery
   */
  private async discoverViaElectron(): Promise<void> {
    if (!host) return;

    // Subscribe to incremental updates
    this.electronUnsubscribe = host!.onDeviceFound((device: DiscoveredDevice) => {
      this.addOrMergeDevice(device);
      this.notify();
      console.log('[Discovery] Found via Electron:', device.name);
    });

    // Start discovery
    try {
      const devices = (await host!.discoverDevices()) as DiscoveredDevice[];

      for (const device of devices) {
        this.addOrMergeDevice(device);
      }

      this.notify();
    } catch (err) {
      console.error('[Discovery] Electron discovery error:', err);
      // Fallback to browser method
      await this.discoverViaBrowser();
    }
  }

  /**
   * Browser-based discovery (fallback)
   */
  private async discoverViaBrowser(): Promise<void> {
    const scannedBases = new Set<string>();

    // First, try to get real network interfaces from Electron
    if (this.isElectron && host) {
      try {
        const localIPs = await host!.getLocalIPs();
        console.log('[Discovery] Got network interfaces from Electron:', localIPs);

        for (const netInfo of localIPs) {
          if (!scannedBases.has(netInfo.base)) {
            scannedBases.add(netInfo.base);
            console.log(`[Discovery] Scanning interface subnet: ${netInfo.base}.x`);
            await this.scanNetworkRange(netInfo.base);
          }
        }
      } catch (err) {
        console.log('[Discovery] Could not get network interfaces from Electron:', err);
      }
    }

    // If no interfaces found via Electron, try WebRTC
    if (scannedBases.size === 0) {
      const localIP = await this.detectLocalIP();

      if (localIP) {
        const base = localIP.split('.').slice(0, 3).join('.');
        console.log(`[Discovery] Detected local IP via WebRTC: ${localIP}, scanning ${base}.x`);
        scannedBases.add(base);
        await this.scanNetworkRange(base);

        // For 10.x.x.x networks, also scan nearby subnets
        if (localIP.startsWith('10.')) {
          const parts = localIP.split('.');
          for (let i = -1; i <= 1; i++) {
            const thirdOctet = parseInt(parts[2]) + i;
            if (thirdOctet >= 0 && thirdOctet <= 255) {
              const nearbyBase = `${parts[0]}.${parts[1]}.${thirdOctet}`;
              if (!scannedBases.has(nearbyBase)) {
                scannedBases.add(nearbyBase);
                await this.scanNetworkRange(nearbyBase);
              }
            }
          }
        }
      }
    }

    // Only add fallback ranges if we couldn't detect any interfaces
    if (scannedBases.size === 0) {
      console.log('[Discovery] No network interfaces detected, using fallback ranges');
      const fallbackBases = ['192.168.1', '192.168.0'];
      for (const base of fallbackBases) {
        scannedBases.add(base);
        await this.scanNetworkRange(base);
      }
    }

    console.log('[Discovery] Scanned subnets:', Array.from(scannedBases));
  }

  /**
   * Detect local IP using WebRTC
   */
  private async detectLocalIP(): Promise<string | null> {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pc.createDataChannel('');

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      return await new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => {
          pc.close();
          resolve(null);
        }, 3000);

        pc.onicecandidate = (e) => {
          if (!e.candidate) return;

          const match = e.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
          if (match && !match[0].startsWith('127.')) {
            clearTimeout(timeout);
            pc.close();
            resolve(match[0]);
          }
        };
      });
    } catch (err) {
      console.log('[Discovery] WebRTC IP detection failed:', err);
      return null;
    }
  }

  /**
   * Scan a network range using WebSocket probing
   */
  private async scanNetworkRange(base: string): Promise<void> {
    const ips = Array.from({ length: 254 }, (_, index) => `${base}.${index + 1}`);
    this.updateProgress(`Scansione subnet ${base}.0/24`, 0, this.progress.totalHosts + ips.length);

    let cursor = 0;
    const workers = Array.from({ length: SUBNET_CONCURRENCY }, async () => {
      while (cursor < ips.length && !this.abortController?.signal.aborted) {
        const ip = ips[cursor++];
        await this.probeLikelyDevice(ip);
        this.updateProgress(`Scansione ${base}.0/24`, 1);
      }
    });

    await Promise.allSettled(workers);
  }

  /**
   * Probe device using HTTP endpoints. WebSocket errors are intentionally ignored
   * because a failed websocket handshake is not evidence of a cast-capable device.
   */
  private async probeLikelyDevice(ip: string): Promise<void> {
    this.ensureNotAborted();

    const probes = [
      { path: 'http://{ip}:8008/setup/eureka_info', port: 8008, type: 'chromecast' as const, protocol: 'castv2' as const, priority: 1, name: 'Chromecast' },
      { path: 'http://{ip}:8008/apps/YouTube', port: 8008, type: 'chromecast' as const, protocol: 'dial' as const, priority: 3, name: 'DIAL Receiver' },
      { path: 'http://{ip}:9080/', port: 9080, type: 'dlna' as const, protocol: 'dlna' as const, priority: 4, name: 'DLNA Renderer' },
      { path: 'http://{ip}:8080/', port: 8080, type: 'dlna' as const, protocol: 'dlna' as const, priority: 5, name: 'Media Renderer' },
      { path: 'http://{ip}:7000/', port: 7000, type: 'smarttv' as const, protocol: 'airplay' as const, priority: 7, name: 'AirPlay Receiver' },
    ];

    for (const probe of probes) {
      if (this.abortController?.signal.aborted) return;
      try {
        const url = probe.path.replace('{ip}', ip);
        let response: Response | null = null;
        try {
          response = await this.fetchWithTimeout(url, PROBE_TIMEOUT_MS, { method: 'GET', mode: 'cors' });
        } catch {
          response = await this.fetchWithTimeout(url, PROBE_TIMEOUT_MS, { method: 'GET', mode: 'no-cors' });
        }
        let name = `${probe.name} (${ip})`;
        let manufacturer: string | undefined;
        let model: string | undefined;

        if (probe.port === 8008 && response.ok && response.type !== 'opaque') {
          const info = await response.json().catch(() => null);
          name = info?.name || info?.device_info?.name || name;
          manufacturer = info?.manufacturer;
          model = info?.model_name || info?.model;
        }

        this.addOrMergeDevice({
          id: `${ip}:${probe.protocol}:${probe.port}`,
          name,
          type: probe.type,
          ip,
          port: probe.port,
          manufacturer,
          model,
          services: [{ protocol: probe.protocol, port: probe.port, priority: probe.priority, available: true }],
        });
        this.notify();
        return;
      } catch {
        // Expected for most IP/port combinations.
      }
    }
  }

  /**
   * Stop searching
   */
  stopDiscovery() {
    this.isSearching = false;
    this.discoveryRunId += 1;
    this.abortController?.abort();

    if (this.searchTimeout) {
      window.clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    if (this.electronUnsubscribe) {
      this.electronUnsubscribe();
      this.electronUnsubscribe = null;
    }

    this.notify();
    console.log('[Discovery] Discovery stopped. Found', this.devices.size, 'devices');
  }

  /**
   * Add manual entry option
   */
  private addManualEntryOption() {
    this.devices.set('manual', {
      id: 'manual',
      name: '➕ Inserisci IP manualmente...',
      type: 'unknown',
      ip: '',
      port: 0,
      services: [],
    });
    this.notify();
  }

  /**
   * Add device manually
   */
  async addManualDevice(ip: string, name?: string, port: number = 8008): Promise<DiscoveredDevice> {
    // If Electron is available, try to scan the IP first
    if (this.isElectron && host) {
      try {
        console.log('[Discovery] Scanning manual IP via Electron:', ip);
        const devices = await host!.scanIp(ip);

        if (devices && devices.length > 0) {
          // Use the first found device
          const foundDevice = devices[0];
          this.addOrMergeDevice(foundDevice);
          this.notify();
          console.log('[Discovery] Manual device found:', foundDevice.name);
          return foundDevice;
        }
      } catch (err) {
        console.log('[Discovery] Manual scan failed:', err);
      }
    }

    // Fallback: add device without verification
    const services = await this.probeDeviceServices(ip).catch(() => []);
    const device: DiscoveredDevice = {
      id: `manual-${ip}`,
      name: name || `Dispositivo (${ip})`,
      type: services.some(service => service.protocol === 'castv2') ? 'chromecast' : services.some(service => service.protocol === 'dlna') ? 'dlna' : 'unknown',
      ip,
      port: services[0]?.port || port,
      services,
    };
    this.addOrMergeDevice(device);
    this.notify();
    return device;
  }

  /**
   * Send media to device using the best available protocol
   */
  async sendToDevice(device: DiscoveredDevice, mediaUrl: string, title: string): Promise<boolean> {
    console.log('[Discovery] Sending to device:', device.name, mediaUrl);

    // Get device info and available services
    const deviceInfo = await this.getDeviceInfo(device);
    console.log('[Discovery] Device info:', deviceInfo);

    // Probe for all available services if not already done
    if (!device.services || device.services.length === 0) {
      device.services = await this.probeDeviceServices(device.ip);
      this.devices.set(device.id, device);
      this.notify();
    }

    // Sort services by priority (lower = better)
    const availableServices = (device.services || [])
      .filter(s => s.available)
      .sort((a, b) => a.priority - b.priority);

    console.log('[Discovery] Available services:', availableServices.map(s => `${s.protocol}:${s.port}`));

    // Try each protocol in order of priority
    for (const service of availableServices) {
      console.log(`[Discovery] Trying ${service.protocol} on port ${service.port}...`);

      let success = false;

      switch (service.protocol) {
        case 'castv2':
          success = await this.sendViaCastV2(device, service.port, mediaUrl, title);
          break;
        case 'dial':
          success = await this.sendViaDIAL(device, mediaUrl, service.port);
          break;
        case 'dlna':
          success = await this.sendViaDLNA(device, mediaUrl, title, service.port);
          break;
        case 'airplay':
          success = await this.sendViaAirPlay(device, mediaUrl, title, service.port);
          break;
      }

      if (success) {
        console.log(`[Discovery] Successfully cast via ${service.protocol}`);
        return true;
      }
    }

    // Fallback: Try Cast V2 on port 8008 if Electron is available
    if (this.isElectron && host) {
      console.log('[Discovery] Fallback: trying Electron Cast V2');
      try {
        const result = await host!.castToDevice({
          ip: device.ip,
          port: 8008,
          mediaUrl,
          title,
          protocol: 'castv2',
        });

        if (result.success) {
          console.log('[Discovery] Cast V2 fallback success');
          return true;
        }
      } catch (err) {
        console.log('[Discovery] Cast V2 fallback failed:', err);
      }
    }

    // Last resort: open helper page
    console.log('[Discovery] All protocols failed, opening helper page');
    return this.sendViaCastDefault(device, mediaUrl, title);
  }

  /**
   * Probe all available casting services on a device
   */
  private async probeDeviceServices(ip: string): Promise<CastService[]> {
    // If Electron is available, use native probing
    if (this.isElectron && host?.probeDeviceServices) {
      try {
        return await host!.probeDeviceServices(ip);
      } catch (err) {
        console.log('[Discovery] Electron probe failed:', err);
      }
    }

    // Fallback: browser-based probing
    const services: CastService[] = [];

    const portConfigs = [
      { port: 8008, protocol: 'castv2' as const, priority: 1 },
      { port: 8009, protocol: 'castv2' as const, priority: 1 },
      { port: 8443, protocol: 'castv2' as const, priority: 2 },
      { port: 8008, protocol: 'dial' as const, priority: 3 },
      { port: 9080, protocol: 'dlna' as const, priority: 4 },
      { port: 8080, protocol: 'dlna' as const, priority: 5 },
      { port: 1900, protocol: 'dlna' as const, priority: 6 },
      { port: 7000, protocol: 'airplay' as const, priority: 7 },
    ];

    // Check each port
    for (const config of portConfigs) {
      const available = await this.checkPortAvailable(ip, config.port);
      services.push({
        protocol: config.protocol,
        port: config.port,
        priority: config.priority,
        available,
      });
    }

    return services.filter(s => s.available);
  }

  /**
   * Check if a port is available using fetch
   */
  private async checkPortAvailable(ip: string, port: number): Promise<boolean> {
    try {
      await this.fetchWithTimeout(`http://${ip}:${port}/`, PROBE_TIMEOUT_MS, {
        method: 'HEAD',
        mode: 'no-cors',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Send via Cast V2 protocol (native Electron)
   */
  private async sendViaCastV2(device: DiscoveredDevice, port: number, mediaUrl: string, title: string): Promise<boolean> {
    if (!this.isElectron || !host) {
      return false;
    }

    try {
      const result = await host!.castToDevice({
        ip: device.ip,
        port,
        mediaUrl,
        title,
        protocol: 'castv2',
      });
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Send via AirPlay protocol
   */
  private async sendViaAirPlay(device: DiscoveredDevice, mediaUrl: string, _title: string, port: number = 7000): Promise<boolean> {
    try {
      // AirPlay uses a simple HTTP POST to /play
      await fetch(`http://${device.ip}:${port}/play`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/parameters',
          'X-Apple-Session-ID': crypto.randomUUID(),
        },
        body: `Content-Location: ${mediaUrl}\nStart-Position: 0`,
        mode: 'no-cors',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get device information from eureka_info endpoint
   */
  private async getDeviceInfo(device: DiscoveredDevice): Promise<any> {
    try {
      const response = await fetch(`http://${device.ip}:8008/setup/eureka_info`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (response.ok) {
        const info = await response.json();
        // Update device name if available
        if (info.name && device.name.includes('(')) {
          device.name = info.name;
          this.devices.set(device.id, device);
          this.notify();
        }
        return info;
      }
    } catch (err) {
      console.log('[Discovery] Could not get device info:', err);
    }
    return null;
  }

  /**
   * Send via Cast Default Media Receiver
   * Uses a web-based approach that opens a cast-enabled page
   */
  private async sendViaCastDefault(device: DiscoveredDevice, mediaUrl: string, title: string): Promise<boolean> {
    // Create a simple HTML page that will cast the video
    const castHtml = `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Casting: ${title}</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1a1a1a; 
      color: white; 
      display: flex; 
      flex-direction: column;
      align-items: center; 
      justify-content: center; 
      height: 100vh; 
      margin: 0;
      text-align: center;
    }
    h2 { margin-bottom: 10px; }
    p { color: #888; margin: 5px 0; }
    .url { 
      background: #333; 
      padding: 15px; 
      border-radius: 8px; 
      word-break: break-all; 
      max-width: 80%; 
      margin: 20px 0;
      font-family: monospace;
      font-size: 12px;
    }
    button {
      background: #e50914;
      color: white;
      border: none;
      padding: 15px 30px;
      border-radius: 8px;
      font-size: 16px;
      cursor: pointer;
      margin: 10px;
    }
    button:hover { background: #f40d12; }
    .instructions {
      background: #2a2a2a;
      padding: 20px;
      border-radius: 8px;
      margin-top: 30px;
      max-width: 500px;
    }
    .instructions ol { text-align: left; }
    video { max-width: 80%; max-height: 300px; margin: 20px 0; }
  </style>
</head>
<body>
  <h2>📺 ${title}</h2>
  <p>Dispositivo: ${device.name} (${device.ip})</p>
  
  <video id="video" controls autoplay>
    <source src="${mediaUrl}" type="video/mp4">
    <source src="${mediaUrl}" type="application/x-mpegURL">
  </video>
  
  <div class="url">
    <strong>URL Stream:</strong><br>
    ${mediaUrl}
  </div>
  
  <div style="display: flex; gap: 10px;">
    <button onclick="copyUrl()">📋 Copia URL</button>
    <button onclick="window.close()">❌ Chiudi</button>
  </div>
  
  <div class="instructions">
    <h3>Come trasmettere su TV:</h3>
    <ol>
      <li>Apri l'app <strong>VLC</strong> o <strong>Kodi</strong> sulla tua TV</li>
      <li>Seleziona "Apri stream di rete" o "URL"</li>
      <li>Incolla l'URL copiato</li>
      <li>Avvia la riproduzione</li>
    </ol>
    <p style="color: #888; font-size: 12px; margin-top: 15px;">
      Oppure usa un'app IPTV sulla TV e aggiungi questo URL come sorgente.
    </p>
  </div>
  
  <script>
    function copyUrl() {
      navigator.clipboard.writeText('${mediaUrl}').then(() => {
        alert('URL copiato negli appunti!');
      });
    }
    
    // Auto-copy on load
    navigator.clipboard.writeText('${mediaUrl}').catch(() => {});
  </script>
</body>
</html>`;

    // Create blob and open
    const blob = new Blob([castHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'width=700,height=800');

    // Also copy URL to clipboard
    try {
      await navigator.clipboard.writeText(mediaUrl);
    } catch {}

    // Clean up blob URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    return win !== null;
  }

  /**
   * Send via DIAL protocol
   */
  private async sendViaDIAL(device: DiscoveredDevice, mediaUrl: string, port?: number): Promise<boolean> {
    const targetPort = port || device.port || 8008;
    const apps = ['ChromeCast', 'YouTube', 'Netflix', 'MediaPlayer'];

    for (const app of apps) {
      try {
        await fetch(`http://${device.ip}:${targetPort}/apps/${app}`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: mediaUrl,
          mode: 'no-cors',
        });
        return true;
      } catch {}
    }
    return false;
  }

  /**
   * Send via DLNA/UPnP
   */
  private async sendViaDLNA(device: DiscoveredDevice, mediaUrl: string, _title: string, port?: number): Promise<boolean> {
    const setURIBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURI>${mediaUrl}</CurrentURI>
      <CurrentURIMetaData></CurrentURIMetaData>
    </u:SetAVTransportURI>
  </s:Body>
</s:Envelope>`;

    const paths = ['/AVTransport/control', '/upnp/control/AVTransport1'];
    const ports = port ? [port] : [device.port, 9080, 8080];

    for (const port of ports) {
      for (const path of paths) {
        try {
          await fetch(`http://${device.ip}:${port}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset="utf-8"',
              'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
            },
            body: setURIBody,
            mode: 'no-cors',
          });

          // Send Play
          const playBody = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>
    </u:Play>
  </s:Body>
</s:Envelope>`;

          await fetch(`http://${device.ip}:${port}${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'text/xml; charset="utf-8"',
              'SOAPAction': '"urn:schemas-upnp-org:service:AVTransport:1#Play"',
            },
            body: playBody,
            mode: 'no-cors',
          });

          return true;
        } catch {}
      }
    }
    return false;
  }

}

// Singleton
export const deviceDiscovery = new DeviceDiscoveryService();
export default deviceDiscovery;
