const { contextBridge, ipcRenderer } = require('electron');

// Expose device discovery API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Device discovery
  discoverDevices: () => ipcRenderer.invoke('discover-devices'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  scanIp: (ipOrSubnet) => ipcRenderer.invoke('scan-ip', ipOrSubnet),
  probeDeviceServices: (ip) => ipcRenderer.invoke('probe-device-services', ip),

  // Cast to device
  castToDevice: (options) => ipcRenderer.invoke('cast-to-device', options),

  // Listen for incremental device updates
  onDeviceFound: (callback) => {
    ipcRenderer.on('device-found', (event, device) => callback(device));
    return () => ipcRenderer.removeAllListeners('device-found');
  },
  
  // Check if we're in Electron
  isElectron: true,
});

