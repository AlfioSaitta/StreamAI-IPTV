const os = require('os');

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        const base = parts[0] + '.' + parts[1] + '.' + parts[2];
        
        const netmaskParts = iface.netmask.split('.').map(Number);
        const ipParts = iface.address.split('.').map(Number);
        const networkParts = ipParts.map((octet, i) => octet & netmaskParts[i]);
        
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
          netmask: iface.netmask,
          base: base,
          network: networkParts.join('.'),
          cidr: 32 - hostBits,
          maxHosts: maxHosts,
        });
      }
    }
  }
  return ips;
}

const interfaces = getLocalIPs();
console.log('Network interfaces found:', interfaces.length);
interfaces.forEach(i => {
  console.log('  -', i.interface + ':', i.ip + '/' + i.cidr, '(' + i.base + '.x, max', i.maxHosts, 'hosts)');
});

