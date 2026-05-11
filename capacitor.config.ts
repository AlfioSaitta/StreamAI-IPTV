import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.streamai.iptv',
  appName: 'StreamAI IPTV',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.STREAMAI_ANDROID_DEBUG === 'true',
  },
  ios: {
    contentInset: 'always',
    allowsLinkPreview: false,
    scrollEnabled: true,
    limitsNavigationsToAppBoundDomains: false,
    handleApplicationNotifications: true,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'streamai', // Custom scheme per iOS per evitare problemi CORS/Mixed Content
    cleartext: true,
    allowNavigation: ['*'], // Permetti navigazione su qualsiasi dominio (necessario per stream esterni)
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: "#141414",
      showSpinner: true,
      androidSpinnerStyle: "large",
      iosSpinnerStyle: "small",
      spinnerColor: "#e50914",
    },
  },
};

export default config;
