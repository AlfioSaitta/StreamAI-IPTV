const os = require('os');
const net = require('net');
const http = require('http');

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        const base = parts[0] + '.' + parts[1] + '.' + parts[2];
        
        const netmaskParts = iface.netmask.split('.').map(Number);
        let hostBits = 0;
        for (const part of netmaskParts) {
          for (let i = 0; i < 8; i++) {
            if (((part >> i) & 1) === 0) hostBits++;
          }
        }
        
        const maxHosts = Math.min(Math.pow(2, hostBits) - 2, 254);
        
        ips.push({
          interface: name,
          ip: iface.address,
          base: base,
          cidr: 32 - hostBits,
          maxHosts: maxHosts,
        });
      }
    }
  }
  return ips;
}

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

async function getDeviceName(ip) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:8008/setup/eureka_info`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info.name || `Device (${ip})`);
        } catch {
          resolve(`Device (${ip})`);
        }
      });
    });
    req.on('error', () => resolve(`Device (${ip})`));
    req.on('timeout', () => { req.destroy(); resolve(`Device (${ip})`); });
  });
}

async function scanNetwork() {
  const interfaces = getLocalIPs();
  console.log('\n=== Network Scanner ===');
  console.log('Interfaces found:', interfaces.length);
  
  for (const iface of interfaces) {
    console.log(`\nScanning ${iface.base}.x (${iface.interface}, /${iface.cidr})...`);
    
    const devices = [];
    const port = 8008; // Chromecast port
    
    // Scan in batches
    const batchSize = 30;
    const maxIP = Math.min(iface.maxHosts, 254);
    
    for (let start = 1; start <= maxIP; start += batchSize) {
      const batch = [];
      for (let i = start; i < Math.min(start + batchSize, maxIP + 1); i++) {
        const ip = `${iface.base}.${i}`;
        if (ip !== iface.ip) {
          batch.push(checkPort(ip, port, 500));
        }
      }
      
      const results = await Promise.all(batch);
      for (const result of results) {
        if (result.open) {
          const name = await getDeviceName(result.ip);
          devices.push({ ip: result.ip, name });
          console.log(`  Found: ${name} (${result.ip}:${port})`);
        }
      }
    }
    
    console.log(`\nScan complete. Found ${devices.length} Cast device(s) on ${iface.base}.x`);
  }
}

scanNetwork().catch(console.error);

