/**
 * Platform Detection Service
 * Rileva la piattaforma corrente (Electron, Wails v3 desktop, Android/iOS via
 * Capacitor, Web). Durante la migrazione Electron → Wails v3 (plan rev. 6,
 * Fase 7) coesistono due runtime desktop: `isElectron` rileva il legacy
 * preload bridge, `isWails` rileva il runtime Wails v3 (variabile globale
 * `wails` iniettata da Wails alpha.93). `isDesktop = isElectron || isWails`
 * è il check generico "non-mobile + non-puro-web".
 */

import { Capacitor } from '@capacitor/core';

export type Platform = 'electron' | 'wails' | 'android' | 'ios' | 'web';

class PlatformService {
  private _platform: Platform = 'web';
  private _isInitialized = false;

  constructor() {
    this.init();
  }

  init(): void {
    if (this._isInitialized) return;

    // 1. Controllo Electron (priorità alta — legacy bridge `electronAPI`)
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron) {
      this._platform = 'electron';
    }
    // 2. Controllo Wails v3 (runtime alpha.93 espone `window.wails`)
    else if (typeof window !== 'undefined' && Boolean((window as any).wails)) {
      this._platform = 'wails';
    }
    // 3. Controllo Capacitor Nativo (Android/iOS)
    else if (Capacitor.isNativePlatform()) {
      const capPlatform = Capacitor.getPlatform();
      if (capPlatform === 'android') {
        this._platform = 'android';
      } else if (capPlatform === 'ios') {
        this._platform = 'ios';
      }
    }
    // 4. Fallback Web
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

  /**
   * Runtime Wails v3 (Go backend + system webview). Vedi
   * docs/plan-go-wails-migration.md §3.3 per la mappa Electron → Wails.
   */
  get isWails(): boolean {
    return this._platform === 'wails';
  }

  /**
   * Comprende Electron + Wails — utile per feature "desktop-only" indipendenti
   * dal runtime sottostante (es. cast, mDNS discovery, system tray).
   */
  get isDesktop(): boolean {
    return this._platform === 'electron' || this._platform === 'wails';
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
      // Casting: Electron+Wails (backend nativo), Web (Chrome Cast SDK)
      casting: this.isDesktop || this.isWeb,

      // Picture-in-Picture: Desktop (Electron/Wails) + Android nativo +
      // Web con feature detection (Document PiP è ancora opzionale su WebKit)
      pip: this.isDesktop || (this.isWeb && typeof document !== 'undefined' && document.pictureInPictureEnabled),

      // Download locale: solo runtime con accesso filesystem
      download: this.isDesktop,

      // Fullscreen: sempre supportato
      fullscreen: true,

      // Storage persistente
      storage: true,

      // Player Nativo (ExoPlayer/AVPlayer) vs HTML5 Video
      // NB: su Wails il player nativo (libmpv) è in arrivo in Fase 6 — per ora
      // il frontend usa Video.js anche su Wails, come su Electron.
      nativePlayer: this.isNative,

      // Haptic Feedback
      haptics: this.isNative,
    };
  }
}

export const platformService = new PlatformService();
export default platformService;
