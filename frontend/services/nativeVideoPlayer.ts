import { platformService } from './platformService';

// Interfaccia per il plugin capacitor-video-player
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
  pipEnabled?: boolean;
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
      return false;
    }

    try {
      // Importiamo il plugin. Questo DEVE essere installato nel progetto.
      // npm install capacitor-video-player
      const { CapacitorVideoPlayer } = await import('capacitor-video-player');
      this.plugin = CapacitorVideoPlayer;
      this.isNativeAvailable = true;
      console.log('[NativePlayer] Plugin ExoPlayer caricato correttamente');
      return true;
    } catch (e) {
      console.error('[NativePlayer] ERRORE CRITICO: Plugin capacitor-video-player non trovato.', e);
      return false;
    }
  }

  get isAvailable(): boolean {
    return this.isNativeAvailable;
  }

  get supportsPiP(): boolean {
    if (!platformService.isAndroid || !this.plugin) return false;

    const androidVersion = this.getAndroidMajorVersion();
    // Android Picture-in-Picture è disponibile da Android 8.0 (API 26).
    // Se lo user agent non espone la versione, lasciamo che sia il plugin nativo
    // a rifiutare la richiesta invece di nascondere una funzione potenzialmente valida.
    return androidVersion === null || androidVersion >= 8;
  }

  private getAndroidMajorVersion(): number | null {
    if (typeof navigator === 'undefined') return null;
    const match = navigator.userAgent.match(/Android\s+(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  /**
   * Avvia la riproduzione usando ExoPlayer INTERNO.
   * Supporta nativamente H.265/HEVC su dispositivi Android compatibili.
   */
  async play(options: NativePlayerOptions): Promise<boolean> {
    // Assicuriamoci che il plugin sia inizializzato
    if (!this.plugin) {
      const success = await this.init();
      if (!success) {
        console.error('[NativePlayer] Impossibile avviare: plugin mancante');
        return false;
      }
    }

    try {
      console.log('[NativePlayer] Avvio ExoPlayer interno per:', options.url);

      // Pulisci eventuali sessioni precedenti
      await this.cleanupListeners();
      await this.setupListeners();

      // Configurazione per ExoPlayer
      // mode: 'fullscreen' apre il player nativo sopra la WebView
      // Chromecast resta disabilitato per stabilità finché non viene configurato lato Gradle.
      const res = await this.plugin.initPlayer({
        mode: 'fullscreen',
        url: options.url,
        playerId: this.playerId,
        componentTag: 'div',
        title: options.title || '',
        subtitle: options.subtitle || '',
        poster: options.poster || '',
        autoPlay: true,
        headers: options.headers,
        // Opzioni specifiche Android/ExoPlayer
        chromecast: false, // Disabilitato per stabilità (richiede setup gradle extra)
        pipEnabled: Boolean(options.pipEnabled && this.supportsPiP),
        controls: true,   // Usa i controlli nativi di ExoPlayer
      });

      if (res && res.result) {
        this.emit('play', { url: options.url });
        return true;
      }
      
      return false;

    } catch (error) {
      console.error('[NativePlayer] Errore avvio ExoPlayer:', error);
      this.emit('error', { error: String(error) });
      return false;
    }
  }

  private async setupListeners() {
    if (!this.plugin) return;

    const add = async (event: string, handler: (data: any) => void) => {
      try {
        const handle = await this.plugin.addListener(event, handler);
        this.eventHandlers.push(handle);
      } catch (e) {
        console.warn(`[NativePlayer] Failed to add listener for ${event}`, e);
      }
    };

    // Mappatura eventi nativi -> eventi interni
    await add('jeepCapVideoPlayerPlay', (data: any) => this.emit('play', data));
    await add('jeepCapVideoPlayerPause', (data: any) => this.emit('pause', data));
    await add('jeepCapVideoPlayerEnded', (data: any) => this.emit('ended', data));
    await add('jeepCapVideoPlayerExit', (data: any) => this.emit('exit', data)); // Quando l'utente chiude il player con la X o Back
    await add('jeepCapVideoPlayerReady', (data: any) => this.emit('ready', data));
    await add('jeepCapVideoPlayerCurrentTime', (data: any) => this.emit('timeupdate', data));
  }

  private async cleanupListeners() {
    for (const handler of this.eventHandlers) {
      if (handler.remove) {
        try {
          await handler.remove();
        } catch (e) {
          console.warn('[NativePlayer] Error removing listener', e);
        }
      }
    }
    this.eventHandlers = [];
  }

  // Metodi di controllo (proxano al plugin nativo)
  async pause(): Promise<void> { if (this.plugin) await this.plugin.pause({ playerId: this.playerId }); }
  async resume(): Promise<void> { if (this.plugin) await this.plugin.play({ playerId: this.playerId }); }

  async isPlaying(): Promise<boolean> {
    if (!this.plugin) return false;
    try {
      const result = await this.plugin.isPlaying({ playerId: this.playerId });
      return Boolean(result?.value);
    } catch {
      return false;
    }
  }
  
  async stop(): Promise<void> { 
    if (this.plugin) {
      try {
        await this.plugin.stopAllPlayers(); 
      } catch (e) {
        console.warn('[NativePlayer] Error stopping players', e);
      }
    }
  }

  async seekTo(seconds: number): Promise<void> { if (this.plugin) await this.plugin.setCurrentTime({ playerId: this.playerId, seektime: seconds }); }
  async setVolume(volume: number): Promise<void> { if (this.plugin) await this.plugin.setVolume({ playerId: this.playerId, volume }); }
  async setMuted(muted: boolean): Promise<void> { if (this.plugin) await this.plugin.setMuted({ playerId: this.playerId, muted }); }

  async getCurrentTime(): Promise<number> {
    if (!this.plugin) return 0;
    try {
      const result = await this.plugin.getCurrentTime({ playerId: this.playerId });
      return Number(result?.value || 0);
    } catch {
      return 0;
    }
  }

  async getDuration(): Promise<number> {
    if (!this.plugin) return 0;
    try {
      const result = await this.plugin.getDuration({ playerId: this.playerId });
      return Number(result?.value || 0);
    } catch {
      return 0;
    }
  }

  async enterPictureInPicture(): Promise<boolean> {
    if (!this.plugin) {
      const initialized = await this.init();
      if (!initialized) return false;
    }

    if (!this.supportsPiP) return false;

    const candidates = ['enterPictureInPicture', 'enterPip', 'pip', 'requestPictureInPicture'];
    for (const method of candidates) {
      if (typeof this.plugin[method] === 'function') {
        try {
          const result = await this.plugin[method]({ playerId: this.playerId });
          return result?.result !== false;
        } catch (e) {
          console.warn(`[NativePlayer] PiP method ${method} failed`, e);
          return false;
        }
      }
    }

    // Alcune versioni del plugin gestiscono il PiP solo tramite pipEnabled all'inizializzazione.
    console.info('[NativePlayer] PiP diretto non esposto dal plugin; usa pipEnabled/initPlayer se supportato dal device.');
    return false;
  }

  // Event Emitter
  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.indexOf(callback);
      if (index > -1) eventListeners.splice(index, 1);
    }
  }

  private emit(event: string, data: any): void {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) eventListeners.forEach(callback => callback(data));
  }
}

export const nativeVideoPlayer = new NativeVideoPlayerService();
