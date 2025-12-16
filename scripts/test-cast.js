#!/usr/bin/env node

const Client = require('castv2-client').Client;
const DefaultMediaReceiver = require('castv2-client').DefaultMediaReceiver;

const DEVICE_IP = process.argv[2] || '10.227.112.101';
const VIDEO_URL = process.argv[3] || 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

console.log(`\n=== Cast Test ===`);
console.log(`Device: ${DEVICE_IP}`);
console.log(`Video: ${VIDEO_URL}\n`);

const client = new Client();

client.on('error', (err) => {
  console.error('Client error:', err.message);
  client.close();
  process.exit(1);
});

console.log('Connecting...');

client.connect(DEVICE_IP, () => {
  console.log('Connected to device!');

  client.launch(DefaultMediaReceiver, (err, player) => {
    if (err) {
      console.error('Launch error:', err.message);
      client.close();
      process.exit(1);
    }

    console.log('DefaultMediaReceiver launched!');

    player.on('status', (status) => {
      console.log('Player status:', status.playerState);
    });

    const media = {
      contentId: VIDEO_URL,
      contentType: 'video/mp4',
      streamType: 'BUFFERED',
      metadata: {
        type: 0,
        metadataType: 0,
        title: 'Test Video from StreamAI'
      }
    };

    console.log('Loading media...');

    player.load(media, { autoplay: true }, (err, status) => {
      if (err) {
        console.error('Load error:', err.message);
        client.close();
        process.exit(1);
      }

      console.log('Media loaded successfully!');
      console.log('Status:', status.playerState);

      // Keep running for a bit to see status updates
      setTimeout(() => {
        console.log('\nTest complete! Closing...');
        client.close();
        process.exit(0);
      }, 5000);
    });
  });
});

