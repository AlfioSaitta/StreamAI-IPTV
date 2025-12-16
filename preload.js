const { contextBridge, ipcRenderer } = require('electron');

// Expose device discovery and cast API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Device discovery
  discoverDevices: () => ipcRenderer.invoke('discover-devices'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  scanIp: (ipOrSubnet) => ipcRenderer.invoke('scan-ip', ipOrSubnet),
  probeDeviceServices: (ip) => ipcRenderer.invoke('probe-device-services', ip),

  // Cast session management
  castConnect: (options) => ipcRenderer.invoke('cast-connect', options),
  castLoad: (options) => ipcRenderer.invoke('cast-load', options),
  castControl: (options) => ipcRenderer.invoke('cast-control', options),
  castStatus: () => ipcRenderer.invoke('cast-status'),
  castDisconnect: () => ipcRenderer.invoke('cast-disconnect'),

  // Legacy cast (backward compatibility)
  castToDevice: (options) => ipcRenderer.invoke('cast-to-device', options),

  // Cast status updates listener
  onCastStatus: (callback) => {
    ipcRenderer.on('cast-status', (event, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('cast-status');
  },

  // Listen for incremental device updates
  onDeviceFound: (callback) => {
    ipcRenderer.on('device-found', (event, device) => callback(device));
    return () => ipcRenderer.removeAllListeners('device-found');
  },
  
  // Check if we're in Electron
  isElectron: true,
});

