/**
 * Platform Detection Service
 * Rileva la piattaforma corrente (Electron, Android/Capacitor, Web)
 */

export type Platform = 'electron' | 'android' | 'ios' | 'web';

class PlatformService {
  private _platform: Platform = 'web';
  private _isInitialized = false;

  async init(): Promise<void> {
    if (this._isInitialized) return;

    // Controlla se siamo in Electron
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      this._platform = 'electron';
    }
    // Controlla se siamo in Capacitor (Android/iOS)
    else if (typeof window !== 'undefined' && (window as any).Capacitor) {
      const Capacitor = (window as any).Capacitor;
      if (Capacitor.isNativePlatform()) {
        const platform = Capacitor.getPlatform();
        if (platform === 'android') {
          this._platform = 'android';
        } else if (platform === 'ios') {
          this._platform = 'ios';
        }
      }
    }
    // Altrimenti siamo in un browser web
    else {
      this._platform = 'web';
    }

    this._isInitialized = true;
    console.log('[Platform] Detected platform:', this._platform);
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
    return this._platform !== 'web';
  }

  get isWeb(): boolean {
    return this._platform === 'web';
  }

  get isMobile(): boolean {
    return this._platform === 'android' || this._platform === 'ios';
  }

  /**
   * Funzionalità disponibili per piattaforma
   */
  get capabilities() {
    return {
      // Casting disponibile solo su Electron (per ora)
      casting: this._platform === 'electron',
      // Picture-in-Picture
      pip: this._platform !== 'web' || document.pictureInPictureEnabled,
      // Download locale
      download: this._platform === 'electron',
      // Fullscreen
      fullscreen: true,
      // Storage persistente
      storage: true,
      // Notifiche
      notifications: this._platform !== 'web',
    };
  }
}

export const platformService = new PlatformService();
export default platformService;

