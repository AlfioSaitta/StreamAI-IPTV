const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  
  // Funzioni esistenti
  discoverDevices: () => ipcRenderer.invoke('discover-devices'),
  getLocalIPs: () => ipcRenderer.invoke('get-local-ips'),
  scanIp: (ipOrSubnet) => ipcRenderer.invoke('scan-ip', ipOrSubnet),
  probeDeviceServices: (ip) => ipcRenderer.invoke('probe-device-services', ip),
  
  // Funzioni di Cast
  castConnect: (options) => ipcRenderer.invoke('cast-connect', options),
  castLoad: (options) => ipcRenderer.invoke('cast-load', options),
  castControl: (options) => ipcRenderer.invoke('cast-control', options),
  castDisconnect: () => ipcRenderer.invoke('cast-disconnect'),
  onCastStatus: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('cast-status', handler);
    return () => ipcRenderer.removeListener('cast-status', handler);
  },

  // Condivisione stato di riproduzione e Remote Control
  updatePlaybackStatus: (status) => ipcRenderer.send('playback-status-update', status),
  onNetworkPlaybackStatus: (callback) => {
    const handler = (event, status) => callback(status);
    ipcRenderer.on('network-playback-status', handler);
    return () => ipcRenderer.removeListener('network-playback-status', handler);
  },
  onRemoteControlCommand: (callback) => {
    const handler = (event, command) => callback(command);
    ipcRenderer.on('remote-control-command', handler);
    return () => ipcRenderer.removeListener('remote-control-command', handler);
  }
});
