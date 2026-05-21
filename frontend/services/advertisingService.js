/**
 * Advertising Service (Electron Main Process)
 * 
 * This service advertises StreamAI IPTV on the local network using common discovery protocols,
 * allowing other devices and apps to find and cast to it.
 * 
 * Protocols supported:
 * 1. mDNS (Bonjour): Used by Apple devices (AirPlay). We'll advertise as a generic AirPlay receiver.
 * 2. SSDP/DIAL: Used by Chromecast, Smart TVs, and apps like YouTube/Netflix.
 * 
 * This file is intended to be run ONLY in the Electron main process.
 */

const { ipcMain, app } = require('electron');
const http = require('http');
const os = require('os');

let bonjour = null;
let SsdpServer = null;
try { bonjour = require('bonjour'); } catch (error) { console.warn('[Advertise] bonjour non disponibile:', error.message); }
try { ({ Server: SsdpServer } = require('node-ssdp')); } catch (error) { console.warn('[Advertise] node-ssdp non disponibile:', error.message); }

const DEFAULT_PORT = Number(process.env.STREAMAI_ADVERTISING_PORT || 8090);
const MAX_PORT_ATTEMPTS = 5;
const APP_NAME = 'StreamAI IPTV';

class AdvertisingService {
  constructor() {
    this.bonjourInstance = null;
    this.ssdpServer = null;
    this.httpServer = null;
    this.isRunning = false;
    this.playbackState = {};
    this.port = DEFAULT_PORT;

    ipcMain.on('update-playback-status', (_, state) => {
      this.playbackState = state;
      // We could potentially update the advertising status here, but it's often not necessary.
    });
  }

  getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const alias of iface) {
          if (alias.family === 'IPv4' && !alias.internal) {
            return alias.address;
          }
        }
      }
    }
    return '127.0.0.1';
  }

  async start() {
    if (this.isRunning) {
      console.log('[Advertise] Service is already running.');
      return;
    }

    try {
      await this.startHttpServer();
      this.startMdns();
      this.startSsdp();
      this.isRunning = true;
      console.log(`[Advertise] Service started successfully on port ${this.port}.`);
    } catch (error) {
      console.error('[Advertise] Failed to start advertising service:', error);
      this.stop();
    }
  }

  stop() {
    console.log('[Advertise] Stopping service...');
    if (this.bonjourInstance) {
      try {
        this.bonjourInstance.unpublishAll(() => {
          try { this.bonjourInstance?.destroy(); } catch {}
          this.bonjourInstance = null;
          console.log('[Advertise] mDNS service stopped.');
        });
      } catch (error) {
        console.warn('[Advertise] mDNS stop failed:', error.message);
        try { this.bonjourInstance.destroy(); } catch {}
        this.bonjourInstance = null;
      }
    }

    if (this.ssdpServer) {
      try { this.ssdpServer.stop(); } catch (error) { console.warn('[Advertise] SSDP stop failed:', error.message); }
      this.ssdpServer = null;
      console.log('[Advertise] SSDP service stopped.');
    }

    if (this.httpServer) {
      try { this.httpServer.close(); } catch (error) { console.warn('[Advertise] HTTP stop failed:', error.message); }
      this.httpServer = null;
      console.log('[Advertise] HTTP server stopped.');
    }

    this.isRunning = false;
  }

  startMdns() {
    if (!bonjour) {
      console.warn('[Advertise] mDNS disabilitato: dipendenza bonjour assente.');
      return;
    }
    this.bonjourInstance = bonjour();
    this.bonjourInstance.on?.('error', error => console.warn('[Advertise] mDNS error:', error.message));

    // Advertise as an AirPlay device
    this.bonjourInstance.publish({
      name: APP_NAME,
      type: 'airplay',
      port: this.port,
      txt: {
        deviceid: 'AA:BB:CC:DD:EE:FF', // Fake MAC address
        features: '0x5A7FFFF7,0x1E', // Features supported by many AirPlay receivers
        model: 'StreamAI',
        srcvers: '220.68',
        pk: 'b2e9a39a2362cf65a24a2b161359a1f3765bfa7917a835e93f5383015f65f1e6' // Fake public key
      }
    });

    console.log(`[Advertise] mDNS (AirPlay) service published as "${APP_NAME}"`);
  }

  startSsdp() {
    if (!SsdpServer) {
      console.warn('[Advertise] SSDP/DIAL disabilitato: dipendenza node-ssdp assente.');
      return;
    }
    const ip = this.getLocalIpAddress();
    const usn = `uuid:${app.getName()}-${app.getVersion()}`;
    
    this.ssdpServer = new SsdpServer({
      location: `http://${ip}:${this.port}/dial.xml`,
      udn: usn,
      ssdpSig: `${os.platform()}/${os.release()} UPnP/1.1 ${app.getName()}/${app.getVersion()}`,
      suppressRootDeviceAdvertisements: false,
    });

    // DIAL service
    this.ssdpServer.addUSN('urn:dial-multiscreen-org:service:dial:1');
    this.ssdpServer.on?.('error', error => console.warn('[Advertise] SSDP error:', error.message));

    try {
      this.ssdpServer.start();
      console.log(`[Advertise] SSDP/DIAL service started. Location: http://${ip}:${this.port}/dial.xml`);
    } catch (error) {
      console.warn('[Advertise] SSDP start failed:', error.message);
      this.ssdpServer = null;
    }
  }

  startHttpServer() {
    const ip = this.getLocalIpAddress();

    const createServer = () => http.createServer((req, res) => {
      if (req.url === '/dial.xml') {
        this.handleDialXml(req, res);
      } else if (req.url === '/apps/' || req.url === `/apps/${APP_NAME}` || req.url === `/apps/${encodeURIComponent(APP_NAME)}`) {
        this.handleDialApp(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    return new Promise((resolve, reject) => {
      let attempts = 0;
      const tryListen = () => {
        const port = DEFAULT_PORT + attempts;
        const server = createServer();
        server.once('error', (error) => {
          if (error.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS - 1) {
            attempts += 1;
            tryListen();
            return;
          }
          reject(error);
        });
        server.listen(port, ip, () => {
          this.port = port;
          this.httpServer = server;
          console.log(`[Advertise] HTTP server listening on http://${ip}:${port}`);
          resolve();
        });
      };
      tryListen();
    });
  }

  handleDialXml(req, res) {
    const dialXml = `
      <?xml version="1.0"?>
      <root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:r="urn:restful-tv-org:schemas:upnp-dd">
        <specVersion>
          <major>1</major>
          <minor>0</minor>
        </specVersion>
        <device>
          <deviceType>urn:schemas-upnp-org:device:dial:1</deviceType>
          <friendlyName>${APP_NAME}</friendlyName>
          <manufacturer>StreamAI</manufacturer>
          <modelName>StreamAI Desktop Player</modelName>
          <UDN>uuid:${app.getName()}-${app.getVersion()}</UDN>
          <serviceList>
            <service>
              <serviceType>urn:schemas-upnp-org:service:dial:1</serviceType>
              <serviceId>urn:upnp-org:serviceId:dial</serviceId>
              <controlURL>/ssdp/notfound</controlURL>
              <eventSubURL>/ssdp/notfound</eventSubURL>
              <SCPDURL>/ssdp/notfound</SCPDURL>
            </service>
          </serviceList>
          <application-URL>http://${this.getLocalIpAddress()}:${this.port}/apps/</application-URL>
        </device>
      </root>
    `.trim();

    res.writeHead(200, {
      'Content-Type': 'application/xml',
      'Application-URL': `http://${this.getLocalIpAddress()}:${this.port}/apps/`,
    });
    res.end(dialXml);
  }

  handleDialApp(req, res) {
    if (req.method === 'POST') {
      // This is where a casting request would be handled.
      // The body of the POST request contains the media URL.
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        console.log('[Advertise] Received DIAL launch request:', body);
        // Here, we would parse the body (which is often just the URL)
        // and send it to the renderer process to start playback.
        // For now, we just log it.
        
        // Example: ipcMain.emit('play-media', { url: body });

        res.writeHead(201, { 'Content-Type': 'text/plain' });
        res.end('Created');
      });
    } else if (req.method === 'GET') {
      // Return the status of the app
      const state = this.playbackState.isPlaying ? 'running' : 'stopped';
      const appXml = `
        <?xml version="1.0" encoding="UTF-8"?>
        <service xmlns="urn:dial-multiscreen-org:schemas:dial">
          <name>${APP_NAME}</name>
          <options allowStop="true"/>
          <state>${state}</state>
        </service>
      `.trim();
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      res.end(appXml);
    } else {
      res.writeHead(404);
      res.end();
    }
  }
}

module.exports = {
  advertisingService: new AdvertisingService()
};
