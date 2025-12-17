import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.streamai.iptv',
  appName: 'StreamAI IPTV',
  webDir: 'dist',
  android: {
    allowMixedContent: true, // Permetti contenuti HTTP e HTTPS misti
    captureInput: true,
    webContentsDebuggingEnabled: true, // Per debug, rimuovere in produzione
  },
  server: {
    androidScheme: 'https',
    cleartext: true, // Permetti traffico HTTP per streaming
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
