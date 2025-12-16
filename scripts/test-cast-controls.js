#!/usr/bin/env node

/**
 * Test Cast Controls
 * Testa i controlli di riproduzione su un dispositivo Cast
 */

const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const IP = process.argv[2] || '10.227.112.101';
const VIDEO_URL = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

console.log(`\n=== Cast Controls Test ===`);
console.log(`Device: ${IP}`);
console.log(`Video: Big Buck Bunny\n`);

const client = new Client();
let player = null;

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function test() {
  // Connect
  console.log('1. Connecting...');
  await new Promise((resolve, reject) => {
    client.on('error', reject);
    client.connect(IP, resolve);
  });
  console.log('   ✅ Connected\n');

  // Launch
  console.log('2. Launching DefaultMediaReceiver...');
  player = await new Promise((resolve, reject) => {
    client.launch(DefaultMediaReceiver, (err, p) => {
      if (err) reject(err);
      else resolve(p);
    });
  });
  console.log('   ✅ Launched\n');

  // Status listener
  player.on('status', (status) => {
    console.log(`   [Status] ${status.playerState} @ ${Math.round(status.currentTime || 0)}s`);
  });

  // Load media
  console.log('3. Loading media...');
  const media = {
    contentId: VIDEO_URL,
    contentType: 'video/mp4',
    streamType: 'BUFFERED',
    metadata: { title: 'Test Video' }
  };
  
  await new Promise((resolve, reject) => {
    player.load(media, { autoplay: true }, (err, status) => {
      if (err) reject(err);
      else {
        console.log(`   ✅ Media loaded, state: ${status.playerState}\n`);
        resolve(status);
      }
    });
  });

  await wait(3000);

  // Test PAUSE
  console.log('4. Testing PAUSE...');
  await new Promise((resolve, reject) => {
    player.pause((err, status) => {
      if (err) {
        console.log(`   ❌ Pause error: ${err.message}`);
        reject(err);
      } else {
        console.log(`   ✅ Paused, state: ${status?.playerState}\n`);
        resolve(status);
      }
    });
  });

  await wait(2000);

  // Test PLAY
  console.log('5. Testing PLAY...');
  await new Promise((resolve, reject) => {
    player.play((err, status) => {
      if (err) {
        console.log(`   ❌ Play error: ${err.message}`);
        reject(err);
      } else {
        console.log(`   ✅ Playing, state: ${status?.playerState}\n`);
        resolve(status);
      }
    });
  });

  await wait(2000);

  // Test SEEK
  console.log('6. Testing SEEK to 30s...');
  await new Promise((resolve, reject) => {
    player.seek(30, (err, status) => {
      if (err) {
        console.log(`   ❌ Seek error: ${err.message}`);
        reject(err);
      } else {
        console.log(`   ✅ Seeked, current time: ${status?.currentTime}s\n`);
        resolve(status);
      }
    });
  });

  await wait(2000);

  // Test Volume
  console.log('7. Testing VOLUME to 50%...');
  await new Promise((resolve, reject) => {
    client.setVolume({ level: 0.5 }, (err, volume) => {
      if (err) {
        console.log(`   ❌ Volume error: ${err.message}`);
        reject(err);
      } else {
        console.log(`   ✅ Volume set to: ${Math.round(volume.level * 100)}%\n`);
        resolve(volume);
      }
    });
  });

  await wait(2000);

  // Test Get Status
  console.log('8. Testing GET STATUS...');
  await new Promise((resolve, reject) => {
    player.getStatus((err, status) => {
      if (err) {
        console.log(`   ❌ getStatus error: ${err.message}`);
        reject(err);
      } else {
        console.log(`   ✅ Status:`);
        console.log(`      - playerState: ${status.playerState}`);
        console.log(`      - currentTime: ${status.currentTime}s`);
        console.log(`      - duration: ${status.media?.duration}s\n`);
        resolve(status);
      }
    });
  });

  // Stop and close
  console.log('9. Stopping and closing...');
  await new Promise((resolve) => {
    player.stop(() => {
      client.close();
      resolve();
    });
  });
  console.log('   ✅ Done!\n');

  console.log('=== All tests passed! ===\n');
  process.exit(0);
}

test().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  client.close();
  process.exit(1);
});

