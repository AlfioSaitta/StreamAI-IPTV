#!/usr/bin/env node

const net = require('net');
const http = require('http');

const IP = process.argv[2] || '10.227.112.101';

console.log(`\n=== Service Probe for ${IP} ===\n`);

function checkPort(ip, port, timeout = 1500) {
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

async function testEndpoint(ip, port, path) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:${port}${path}`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ 
          status: res.statusCode, 
          success: res.statusCode < 400,
          data: data.substring(0, 100)
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, success: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, success: false, error: 'timeout' }); });
  });
}

async function probeServices() {
  const services = [
    { port: 8008, protocol: 'Cast V2', priority: 1, testPath: '/setup/eureka_info' },
    { port: 8009, protocol: 'Cast V2 (TLS)', priority: 1, testPath: null },
    { port: 8443, protocol: 'Cast V2 (HTTPS)', priority: 2, testPath: null },
    { port: 9080, protocol: 'DLNA', priority: 4, testPath: '/description.xml' },
    { port: 8080, protocol: 'HTTP/DLNA', priority: 5, testPath: '/' },
    { port: 7000, protocol: 'AirPlay', priority: 7, testPath: '/info' },
    { port: 5353, protocol: 'mDNS', priority: 10, testPath: null },
    { port: 1900, protocol: 'SSDP/UPnP', priority: 6, testPath: null },
  ];

  const results = [];

  for (const svc of services) {
    process.stdout.write(`Checking ${svc.protocol} (port ${svc.port})... `);
    
    const portResult = await checkPort(IP, svc.port);
    
    if (portResult.open) {
      let validated = true;
      let details = '';
      
      if (svc.testPath) {
        const endpointResult = await testEndpoint(IP, svc.port, svc.testPath);
        validated = endpointResult.success;
        details = endpointResult.data || endpointResult.error || '';
      }
      
      if (validated) {
        console.log('✅ AVAILABLE');
        if (details) console.log(`   Response: ${details.substring(0, 80)}...`);
        results.push({
          protocol: svc.protocol,
          port: svc.port,
          priority: svc.priority,
          available: true,
        });
      } else {
        console.log('⚠️  Port open but service not responding');
      }
    } else {
      console.log('❌ Not available');
    }
  }

  console.log('\n=== Summary ===');
  console.log('Available services (sorted by priority):');
  results.sort((a, b) => a.priority - b.priority);
  results.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.protocol} on port ${s.port} (priority: ${s.priority})`);
  });
  
  if (results.length === 0) {
    console.log('  No casting services found on this device.');
  }
}

probeServices().catch(console.error);

