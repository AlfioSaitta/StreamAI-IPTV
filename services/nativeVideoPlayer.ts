/**
 * Native Video Player Service
 * Su Android: apre il video con un player esterno (VLC, MX Player, ecc.) che supporta HEVC
 * Su altre piattaforme: fallback al player web
 */

import { platformService } from './platformService';

export interface NativePlayerOptions {
  url: string;
  title?: string;
  subtitle?: string;
  poster?: string;
  autoplay?: boolean;
  loop?: boolean;
  fullscreen?: boolean;
  headers?: Record<string, string>;
}

class NativeVideoPlayerService {
  private isNativeAvailable = false;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();

  async init(): Promise<boolean> {
    // Il player nativo (intent esterno) è disponibile solo su Android
    if (!platformService.isAndroid) {
      console.log('[NativePlayer] Not available on this platform');
      return false;
    }

    this.isNativeAvailable = true;
    console.log('[NativePlayer] External player intent available on Android');
    return true;
  }

  get isAvailable(): boolean {
    return this.isNativeAvailable;
  }

  /**
   * Apre il video con un player esterno su Android
   */
  async play(options: NativePlayerOptions): Promise<boolean> {
    if (!platformService.isAndroid) {
      console.warn('[NativePlayer] Not on Android, cannot use external player');
      return false;
    }

    try {
      console.log('[NativePlayer] Opening with external player:', options.url);

      // Usa Capacitor App per aprire l'URL con un'app esterna
      // L'utente può scegliere VLC, MX Player o altri player che supportano HEVC
      const { App } = await import('@capacitor/app');

      // Prova ad aprire con intent video
      // Android mostrerà un chooser con le app video disponibili
      const videoUrl = options.url;

      // Crea un intent URL per video
      // Formato: intent://URL#Intent;type=video/*;end
      const intentUrl = `intent://${videoUrl.replace(/^https?:\/\//, '')}#Intent;type=video/*;S.title=${encodeURIComponent(options.title || 'Video')};end`;

      try {
        await App.openUrl({ url: intentUrl });
        this.emit('play', { url: options.url });
        return true;
      } catch {
        // Fallback: apri direttamente l'URL (alcuni player lo gestiscono)
        await App.openUrl({ url: videoUrl });
        this.emit('play', { url: options.url });
        return true;
      }
    } catch (error) {
      console.error('[NativePlayer] Error opening external player:', error);
      this.emit('error', { error: String(error) });
      return false;
    }
  }

  /**
   * Non applicabile per player esterni
   */
  async pause(): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async resume(): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async stop(): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async seekTo(_seconds: number): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async getCurrentTime(): Promise<number> {
    return 0;
  }

  async getDuration(): Promise<number> {
    return 0;
  }

  async setVolume(_volume: number): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async setMuted(_muted: boolean): Promise<void> {
    // Non possiamo controllare player esterni
  }

  async isPlaying(): Promise<boolean> {
    return false;
  }

  // Event emitter semplice
  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) {
        eventListeners.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      eventListeners.forEach(callback => callback(data));
    }
  }

  async destroy(): Promise<void> {
    this.listeners.clear();
  }
}

export const nativeVideoPlayer = new NativeVideoPlayerService();
