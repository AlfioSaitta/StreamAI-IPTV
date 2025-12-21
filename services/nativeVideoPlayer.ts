/**
 * Native Video Player Service
 * Su Android/iOS: usa capacitor-video-player (ExoPlayer/AVPlayer) interno all'app
 * Su altre piattaforme: fallback al player web
 */

import { platformService } from './platformService';
import { Capacitor } from '@capacitor/core';

// Definizione interfaccia per il plugin (nel caso manchino i tipi)
export interface CapacitorVideoPlayerPlugin {
  initPlayer(options: { mode: string; url: string; playerId: string; componentTag: string; [key: string]: any }): Promise<{ result: boolean }>;
  isPlaying(options: { playerId: string }): Promise<{ value: boolean }>;
  play(options: { playerId: string }): Promise<{ result: boolean }>;
  pause(options: { playerId: string }): Promise<{ result: boolean }>;
  stop(options: { playerId: string }): Promise<{ result: boolean }>;
  getDuration(options: { playerId: string }): Promise<{ value: number }>;
  getCurrentTime(options: { playerId: string }): Promise<{ value: number }>;
  setCurrentTime(options: { playerId: string; seektime: number }): Promise<{ result: boolean }>;
  setVolume(options: { playerId: string; volume: number }): Promise<{ result: boolean }>;
  setMuted(options: { playerId: string; muted: boolean }): Promise<{ result: boolean }>;
  stopAllPlayers(): Promise<{ result: boolean }>;
  addListener(eventName: string, listenerFunc: (data: any) => void): Promise<{ remove: () => void }>;
}

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
  private plugin: any = null;
  private isNativeAvailable = false;
  private listeners: Map<string, ((data: any) => void)[]> = new Map();
  private playerId = 'fullscreen-player';
  private eventHandlers: any[] = [];

  async init(): Promise<boolean> {
    if (!platformService.isNative) {
      console.log('[NativePlayer] Not available on this platform');
      return false;
    }

    try {
      // Import dinamico del plugin
      const { CapacitorVideoPlayer } = await import('capacitor-video-player');
      this.plugin = CapacitorVideoPlayer;
      this.isNativeAvailable = true;
      console.log('[NativePlayer] CapacitorVideoPlayer plugin loaded');
      return true;
    } catch (e) {
      console.error('[NativePlayer] Failed to load capacitor-video-player:', e);
      return false;
    }
  }

  get isAvailable(): boolean {
    return this.isNativeAvailable;
  }

  /**
   * Avvia la riproduzione con il player nativo interno
   */
  async play(options: NativePlayerOptions): Promise<boolean> {
    if (!this.isNativeAvailable || !this.plugin) {
      // Prova a inizializzare se non fatto
      const initialized = await this.init();
      if (!initialized) return false;
    }

    try {
      console.log('[NativePlayer] Starting internal native player:', options.url);

      // Rimuovi listener precedenti
      await this.cleanupListeners();

      // Configura listener
      await this.setupListeners();

      // Avvia il player in modalità fullscreen
      const res = await this.plugin.initPlayer({
        mode: 'fullscreen',
        url: options.url,
        playerId: this.playerId,
        componentTag: 'div',
        title: options.title || '',
        subtitle: options.subtitle || '',
        poster: options.poster || '',
        autoPlay: options.autoplay !== false,
        headers: options.headers,
        chromecast: true, // Abilita supporto cast nativo se disponibile
        pipEnabled: true, // Abilita PiP nativo
      });

      if (res && res.result) {
        this.emit('play', { url: options.url });
        return true;
      }
      return false;

    } catch (error) {
      console.error('[NativePlayer] Error starting player:', error);
      this.emit('error', { error: String(error) });
      return false;
    }
  }

  private async setupListeners() {
    if (!this.plugin) return;

    const add = async (event: string, handler: (data: any) => void) => {
      const handle = await this.plugin.addListener(event, handler);
      this.eventHandlers.push(handle);
    };

    // Eventi del player
    await add('jeepCapVideoPlayerPlay', (data: any) => this.emit('play', data));
    await add('jeepCapVideoPlayerPause', (data: any) => this.emit('pause', data));
    await add('jeepCapVideoPlayerEnded', (data: any) => this.emit('ended', data));
    await add('jeepCapVideoPlayerExit', (data: any) => this.emit('exit', data)); // Utente chiude il player
    await add('jeepCapVideoPlayerReady', (data: any) => this.emit('ready', data));
    await add('jeepCapVideoPlayerCurrentTime', (data: any) => this.emit('timeupdate', data));
  }

  private async cleanupListeners() {
    for (const handler of this.eventHandlers) {
      if (handler.remove) handler.remove();
    }
    this.eventHandlers = [];
  }

  async pause(): Promise<void> {
    if (this.plugin) await this.plugin.pause({ playerId: this.playerId });
  }

  async resume(): Promise<void> {
    if (this.plugin) await this.plugin.play({ playerId: this.playerId });
  }

  async stop(): Promise<void> {
    if (this.plugin) {
      await this.plugin.stop({ playerId: this.playerId });
      // Su Android stop() potrebbe non chiudere il player fullscreen, usiamo stopAllPlayers per sicurezza
      if (platformService.isAndroid) {
        await this.plugin.stopAllPlayers();
      }
    }
  }

  async seekTo(seconds: number): Promise<void> {
    if (this.plugin) await this.plugin.setCurrentTime({ playerId: this.playerId, seektime: seconds });
  }

  async getCurrentTime(): Promise<number> {
    if (this.plugin) {
      const res = await this.plugin.getCurrentTime({ playerId: this.playerId });
      return res.value;
    }
    return 0;
  }

  async getDuration(): Promise<number> {
    if (this.plugin) {
      const res = await this.plugin.getDuration({ playerId: this.playerId });
      return res.value;
    }
    return 0;
  }

  async setVolume(volume: number): Promise<void> {
    if (this.plugin) await this.plugin.setVolume({ playerId: this.playerId, volume });
  }

  async setMuted(muted: boolean): Promise<void> {
    if (this.plugin) await this.plugin.setMuted({ playerId: this.playerId, muted });
  }

  // Event emitter
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
    await this.cleanupListeners();
    if (this.plugin) {
      await this.plugin.stopAllPlayers();
    }
    this.listeners.clear();
  }
}

export const nativeVideoPlayer = new NativeVideoPlayerService();
