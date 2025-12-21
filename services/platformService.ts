/**
 * Platform Detection Service
 * Rileva la piattaforma corrente (Electron, Android/Capacitor, iOS/Capacitor, Web)
 */

import { Capacitor } from '@capacitor/core';

export type Platform = 'electron' | 'android' | 'ios' | 'web';

class PlatformService {
  private _platform: Platform = 'web';
  private _isInitialized = false;

  constructor() {
    this.init();
  }

  init(): void {
    if (this._isInitialized) return;

    // 1. Controllo Electron (priorità alta)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      this._platform = 'electron';
    }
    // 2. Controllo Capacitor Nativo (Android/iOS)
    else if (Capacitor.isNativePlatform()) {
      const capPlatform = Capacitor.getPlatform();
      if (capPlatform === 'android') {
        this._platform = 'android';
      } else if (capPlatform === 'ios') {
        this._platform = 'ios';
      }
    }
    // 3. Fallback Web
    else {
      this._platform = 'web';
    }

    this._isInitialized = true;
    console.log(`[PlatformService] Initialized: ${this._platform} (Native: ${Capacitor.isNativePlatform()})`);
  }

  get platform(): Platform {
    return this._platform;
  }

  get isElectron(): boolean {
    return this._platform === 'electron';
  }

  get isAndroid(): boolean {
    return this._platform === 'android';
  }

  get isIOS(): boolean {
    return this._platform === 'ios';
  }

  get isNative(): boolean {
    return this._platform === 'android' || this._platform === 'ios';
  }

  get isWeb(): boolean {
    return this._platform === 'web';
  }

  get isMobile(): boolean {
    return this._platform === 'android' || this._platform === 'ios';
  }

  /**
   * Funzionalità disponibili per piattaforma
   * Utile per abilitare/disabilitare feature nella UI
   */
  get capabilities() {
    return {
      // Casting: Electron (nativo Node), Mobile (Plugin futuro), Web (Chrome Cast SDK)
      casting: this.isElectron || this.isWeb, 
      
      // Picture-in-Picture: Supportato su Desktop e Android recenti
      pip: this.isElectron || (this.isWeb && document.pictureInPictureEnabled),
      
      // Download locale: Solo Electron per ora (filesystem access)
      download: this.isElectron,
      
      // Fullscreen: Sempre true
      fullscreen: true,
      
      // Storage persistente
      storage: true,
      
      // Player Nativo (ExoPlayer/AVPlayer) vs HTML5 Video
      nativePlayer: this.isNative,
      
      // Haptic Feedback
      haptics: this.isNative,
    };
  }
}

export const platformService = new PlatformService();
export default platformService;
