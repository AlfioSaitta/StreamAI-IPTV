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
const bonjour = require('bonjour');
const { Server: SsdpServer } = require('node-ssdp');
const http = require('http');
const os = require('os');

const PORT = 8090; // Port for our local HTTP and DIAL server
const APP_NAME = 'StreamAI IPTV';

class AdvertisingService {
  constructor() {
    this.bonjourInstance = null;
    this.ssdpServer = null;
    this.httpServer = null;
    this.isRunning = false;
    this.playbackState = {};

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

  start() {
    if (this.isRunning) {
      console.log('[Advertise] Service is already running.');
      return;
    }

    try {
      this.startHttpServer();
      this.startMdns();
      this.startSsdp();
      this.isRunning = true;
      console.log('[Advertise] Service started successfully.');
    } catch (error) {
      console.error('[Advertise] Failed to start advertising service:', error);
      this.stop();
    }
  }

  stop() {
    if (!this.isRunning) return;

    console.log('[Advertise] Stopping service...');
    if (this.bonjourInstance) {
      this.bonjourInstance.unpublishAll(() => {
        if (this.bonjourInstance) {
          this.bonjourInstance.destroy();
          this.bonjourInstance = null;
        }
        console.log('[Advertise] mDNS service stopped.');
      });
    }

    if (this.ssdpServer) {
      this.ssdpServer.stop();
      this.ssdpServer = null;
      console.log('[Advertise] SSDP service stopped.');
    }

    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
      console.log('[Advertise] HTTP server stopped.');
    }

    this.isRunning = false;
  }

  startMdns() {
    this.bonjourInstance = bonjour();
    
    // Advertise as an AirPlay device
    this.bonjourInstance.publish({
      name: APP_NAME,
      type: 'airplay',
      port: PORT,
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
    const ip = this.getLocalIpAddress();
    const usn = `uuid:${app.getName()}-${app.getVersion()}`;
    
    this.ssdpServer = new SsdpServer({
      location: `http://${ip}:${PORT}/dial.xml`,
      udn: usn,
      ssdpSig: `${os.platform()}/${os.release()} UPnP/1.1 ${app.getName()}/${app.getVersion()}`,
      suppressRootDeviceAdvertisements: false,
    });

    // DIAL service
    this.ssdpServer.addUSN('urn:dial-multiscreen-org:service:dial:1');
    
    this.ssdpServer.start();
    console.log(`[Advertise] SSDP/DIAL service started. Location: http://${ip}:${PORT}/dial.xml`);
  }

  startHttpServer() {
    const ip = this.getLocalIpAddress();

    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/dial.xml') {
        this.handleDialXml(req, res);
      } else if (req.url === `/apps/${APP_NAME}`) {
        this.handleDialApp(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    this.httpServer.listen(PORT, ip, () => {
      console.log(`[Advertise] HTTP server listening on http://${ip}:${PORT}`);
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
          <deviceType>urn:schemas-upnp-org:device:dail:1</deviceType>
          <friendlyName>${APP_NAME}</friendlyName>
          <manufacturer>StreamAI</manufacturer>
          <modelName>StreamAI Desktop Player</modelName>
          <UDN>uuid:${app.getName()}-${app.getVersion()}</UDN>
          <serviceList>
            <service>
              <serviceType>urn:schemas-upnp-org:service:dail:1</serviceType>
              <serviceId>urn:upnp-org:serviceId:dail</serviceId>
              <controlURL>/ssdp/notfound</controlURL>
              <eventSubURL>/ssdp/notfound</eventSubURL>
              <SCPDURL>/ssdp/notfound</SCPDURL>
            </service>
          </serviceList>
          <application-URL>http://${this.getLocalIpAddress()}:${PORT}/apps/</application-URL>
        </device>
      </root>
    `.trim();

    res.writeHead(200, {
      'Content-Type': 'application/xml',
      'Application-URL': `http://${this.getLocalIpAddress()}:${PORT}/apps/`,
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
          ${this.playbackState.isPlaying ? `<link rel="run" href="run"/>` : ''}
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
