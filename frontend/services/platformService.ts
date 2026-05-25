/**
 * Platform Detection Service.
 *
 * Da rev. 7 del plan (2026-05-22): Electron è stato rimosso. I runtime
 * supportati sono:
 *  - **Wails v3** (desktop, Go backend + WebKitGTK/WebView2/WKWebView)
 *  - **Capacitor** (Android, iOS in roadmap)
 *  - **Web** (build di sviluppo / debug nel browser)
 *
 * `isElectron` è stato rimosso (rev. 7.4, 2026-05-23): usa `isDesktop` /
 * `isWails` nei call site.
 */
import { Capacitor } from '@capacitor/core';
export type Platform = 'wails' | 'android' | 'ios' | 'web';

/**
 * Sniff del runtime Wails v3. Il pacchetto `@wailsio/runtime` inizializza
 * `window._wails = {}` come side-effect del semplice import, anche fuori
 * dall'app Wails (es. test in jsdom). Il marker affidabile è
 * `window._wails.environment` (oggetto con `OS`/`Arch`/`Debug`) che viene
 * popolato dal **backend Go** all'avvio dell'app e mai dal codice JS lato
 * browser. In più alcune build legacy/Android espongono `window.wails`.
 */
function detectWailsRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return Boolean(w._wails?.environment) || Boolean(w.wails);
}

class PlatformService {
  private _platform: Platform = 'web';
  private _isInitialized = false;
  constructor() {
    this.init();
  }
  init(): void {
    if (this._isInitialized) return;
    if (detectWailsRuntime()) {
      this._platform = 'wails';
    } else if (Capacitor.isNativePlatform()) {
      const capPlatform = Capacitor.getPlatform();
      if (capPlatform === 'android') this._platform = 'android';
      else if (capPlatform === 'ios') this._platform = 'ios';
    } else {
      this._platform = 'web';
    }
    this._isInitialized = true;
    console.log(
      `[PlatformService] Initialized: ${this._platform} (Native: ${Capacitor.isNativePlatform()})`,
    );
  }
  /**
   * Re-sniff del runtime: utile se il modulo è stato valutato prima
   * dell'injection di `window._wails` (race del bundler).
   */
  private resolvePlatform(): Platform {
    if (this._platform === 'web' && detectWailsRuntime()) {
      this._platform = 'wails';
    }
    return this._platform;
  }
  get platform(): Platform {
    return this.resolvePlatform();
  }
  get isWails(): boolean {
    return this.resolvePlatform() === 'wails';
  }
  get isDesktop(): boolean {
    return this.resolvePlatform() === 'wails';
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
    return this.resolvePlatform() === 'web';
  }
  get isMobile(): boolean {
    return this._platform === 'android' || this._platform === 'ios';
  }
  get capabilities() {
    return {
      casting: this.isDesktop || this.isWeb,
      pip:
        this.isDesktop ||
        (this.isWeb &&
          typeof document !== 'undefined' &&
          document.pictureInPictureEnabled),
      download: this.isDesktop,
      fullscreen: true,
      storage: true,
      nativePlayer: this.isNative,
      haptics: this.isNative,
    };
  }
}
export const platformService = new PlatformService();
export default platformService;
