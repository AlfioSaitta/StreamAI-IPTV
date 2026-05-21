// Cast Service for StreamAI-IPTV
// Supports: Chromecast, Android TV, Smart TV, Fire TV, AirPlay, and external players

// Type declarations for Google Cast SDK (loaded at runtime)
declare const cast: any;
declare const chrome: any;

declare global {
  interface Window {
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

export type CastMethod = 'chromecast' | 'airplay' | 'external' | 'share' | 'clipboard';

export interface CastDevice {
  id: string;
  name: string;
  type: CastMethod;
  isConnected: boolean;
}

export interface CastState {
  isAvailable: boolean;
  isConnected: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  deviceName: string | null;
  activeMethod: CastMethod | null;
  availableMethods: CastMethod[];
}

export interface CastMediaInfo {
  url: string;
  title: string;
  poster?: string;
  type?: 'video/mp4' | 'application/x-mpegURL' | 'video/webm';
  startTime?: number;
}

type CastStateCallback = (state: CastState) => void;

class CastServiceClass {
  private initialized = false;
  private chromecastAvailable = false;
  private airplayAvailable = false;
  private castSession: any = null;
  private player: any = null;
  private playerController: any = null;
  private stateCallbacks: Set<CastStateCallback> = new Set();
  private currentMediaInfo: CastMediaInfo | null = null;

  private state: CastState = {
    isAvailable: false,
    isConnected: false,
    isPaused: true,
    currentTime: 0,
    duration: 0,
    deviceName: null,
    activeMethod: null,
    availableMethods: [],
  };

  constructor() {
    this.detectAvailableMethods();
    this.loadCastSDK();
  }

  private detectAvailableMethods() {
    const methods: CastMethod[] = [];

    // External player è sempre disponibile (apre in nuova tab/app)
    methods.push('external');

    // Share API (per condividere il link)
    if ('share' in navigator) {
      methods.push('share');
    }

    // Clipboard (fallback per copiare URL)
    if (navigator.clipboard) {
      methods.push('clipboard');
    }

    // AirPlay detection (Safari/WebKit)
    if ((window as any).WebKitPlaybackTargetAvailabilityEvent ||
        (document as any).createElement('video').webkitShowPlaybackTargetPicker) {
      this.airplayAvailable = true;
      methods.push('airplay');
    }

    this.updateState({
      availableMethods: methods,
      isAvailable: methods.length > 0
    });
  }

  private loadCastSDK() {
    // Check if we're in a browser that supports Cast (Chrome/Chromium/Edge)
    const isChromeBased = /Chrome|Chromium|Edg/.test(navigator.userAgent) && !/OPR/.test(navigator.userAgent);

    if (!isChromeBased) {
      console.log('[Cast] Browser does not support Google Cast');
      return;
    }

    // Check if already loaded
    if (window.cast && window.chrome?.cast) {
      console.log('[Cast] SDK already loaded');
      this.initializeChromecast();
      return;
    }

    // Set up callback BEFORE loading the script
    window.__onGCastApiAvailable = (isAvailable: boolean) => {
      console.log('[Cast] onGCastApiAvailable:', isAvailable);
      if (isAvailable) {
        // Small delay to ensure everything is ready
        setTimeout(() => this.initializeChromecast(), 100);
      } else {
        console.log('[Cast] Cast API not available');
      }
    };

    // Load the Cast SDK
    const script = document.createElement('script');
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
    script.async = true;
    script.onerror = (e) => {
      console.error('[Cast] Failed to load Cast SDK:', e);
    };
    script.onload = () => {
      console.log('[Cast] Cast SDK script loaded');
      // If callback wasn't called, try to initialize anyway after a delay
      setTimeout(() => {
        if (!this.initialized && window.cast && window.chrome?.cast) {
          console.log('[Cast] Initializing via onload fallback');
          this.initializeChromecast();
        }
      }, 1000);
    };
    document.head.appendChild(script);

    // Longer timeout for slow networks
    setTimeout(() => {
      if (!this.chromecastAvailable) {
        console.log('[Cast] Chromecast SDK timeout after 10s');
      }
    }, 10000);
  }

  private initializeChromecast() {
    if (this.initialized) {
      console.log('[Cast] Already initialized');
      return;
    }

    // Check if Cast framework is available
    if (typeof cast === 'undefined' || !cast.framework) {
      console.error('[Cast] Cast framework not available');
      return;
    }

    if (typeof chrome === 'undefined' || !chrome.cast) {
      console.error('[Cast] Chrome Cast API not available');
      return;
    }

    try {
      console.log('[Cast] Initializing Chromecast...');
      const context = cast.framework.CastContext.getInstance();

      // Use DEFAULT_MEDIA_RECEIVER_APP_ID for generic media playback
      context.setOptions({
        receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        resumeSavedSession: true,
        language: 'it-IT',
      });

      // Create remote player and controller
      this.player = new cast.framework.RemotePlayer();
      this.playerController = new cast.framework.RemotePlayerController(this.player);

      // Listen for cast state changes
      context.addEventListener(
        cast.framework.CastContextEventType.CAST_STATE_CHANGED,
        (event: any) => this.handleCastStateChanged(event)
      );

      // Listen for session state changes
      context.addEventListener(
        cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        (event: any) => this.handleSessionStateChanged(event)
      );

      // Listen for remote player changes
      this.playerController.addEventListener(
        cast.framework.RemotePlayerEventType.ANY_CHANGE,
        (event: any) => this.handlePlayerChange(event)
      );

      this.initialized = true;
      this.chromecastAvailable = true;

      // Aggiungi chromecast ai metodi disponibili
      const methods = [...this.state.availableMethods];
      if (!methods.includes('chromecast')) {
        methods.unshift('chromecast'); // Chromecast come prima opzione
      }

      this.updateState({
        isAvailable: true,
        availableMethods: methods
      });

      console.log('[Cast] Chromecast initialized successfully');
    } catch (error) {
      console.warn('[Cast] Failed to initialize Chromecast:', error);
    }
  }

  private handleCastStateChanged(event: any) {
    const state = event.castState;
    const isConnected = state === cast.framework.CastState.CONNECTED;
    this.updateState({ isConnected });
  }

  private handleSessionStateChanged(event: any) {
    const sessionState = event.sessionState;

    if (sessionState === cast.framework.SessionState.SESSION_STARTED ||
        sessionState === cast.framework.SessionState.SESSION_RESUMED) {
      this.castSession = cast.framework.CastContext.getInstance().getCurrentSession();
      const deviceName = this.castSession?.getCastDevice()?.friendlyName || 'Chromecast';
      this.updateState({
        isConnected: true,
        deviceName,
        activeMethod: 'chromecast'
      });

      // If we have pending media, cast it
      if (this.currentMediaInfo) {
        this.loadMediaToChromecast(this.currentMediaInfo);
      }
    } else if (sessionState === cast.framework.SessionState.SESSION_ENDED) {
      this.castSession = null;
      this.updateState({
        isConnected: false,
        deviceName: null,
        activeMethod: null,
        currentTime: 0,
        duration: 0,
        isPaused: true
      });
    }
  }

  private handlePlayerChange(_event: any) {
    if (!this.player) return;

    this.updateState({
      isPaused: this.player.isPaused,
      currentTime: this.player.currentTime,
      duration: this.player.duration,
    });
  }

  private updateState(partial: Partial<CastState>) {
    this.state = { ...this.state, ...partial };
    this.notifyStateChange();
  }

  private notifyStateChange() {
    this.stateCallbacks.forEach(cb => cb(this.state));
  }

  private async loadMediaToChromecast(media: CastMediaInfo): Promise<boolean> {
    if (!this.castSession) return false;

    try {
      // Determina il tipo di media
      let contentType = media.type || 'video/mp4';
      if (media.url.includes('.m3u8')) {
        contentType = 'application/x-mpegURL';
      } else if (media.url.includes('.webm')) {
        contentType = 'video/webm';
      }

      const mediaInfo = new chrome.cast.media.MediaInfo(media.url, contentType);
      mediaInfo.metadata = new chrome.cast.media.GenericMediaMetadata();
      mediaInfo.metadata.title = media.title;

      if (media.poster) {
        mediaInfo.metadata.images = [{ url: media.poster }];
      }

      // HLS support per Chromecast
      if (contentType === 'application/x-mpegURL') {
        mediaInfo.hlsSegmentFormat = chrome.cast.media.HlsSegmentFormat.TS;
        mediaInfo.hlsVideoSegmentFormat = chrome.cast.media.HlsVideoSegmentFormat.MPEG2_TS;
      }

      const request = new chrome.cast.media.LoadRequest(mediaInfo);
      request.currentTime = media.startTime || 0;
      request.autoplay = true;

      await this.castSession.loadMedia(request);
      console.log('[Cast] Media loaded to Chromecast successfully');
      return true;
    } catch (error) {
      console.error('[Cast] Failed to load media to Chromecast:', error);
      return false;
    }
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Subscribe to cast state changes
   */
  subscribe(callback: CastStateCallback): () => void {
    this.stateCallbacks.add(callback);
    callback(this.state);
    return () => this.stateCallbacks.delete(callback);
  }

  /**
   * Get current cast state
   */
  getState(): CastState {
    return this.state;
  }

  /**
   * Check if any casting method is available
   */
  isAvailable(): boolean {
    return this.state.isAvailable;
  }

  /**
   * Check if currently casting
   */
  isCasting(): boolean {
    return this.state.isConnected;
  }

  /**
   * Get available casting methods
   */
  getAvailableMethods(): CastMethod[] {
    return this.state.availableMethods;
  }

  /**
   * Check if Chromecast is specifically available
   */
  isChromecastAvailable(): boolean {
    return this.chromecastAvailable;
  }

  /**
   * Get debug info about Cast state
   */
  getDebugInfo(): object {
    let castState = 'unknown';
    let sessionState = 'unknown';

    if (this.chromecastAvailable && typeof cast !== 'undefined') {
      try {
        const context = cast.framework.CastContext.getInstance();
        castState = context.getCastState();
        const session = context.getCurrentSession();
        sessionState = session ? 'active' : 'none';
      } catch (e) {
        castState = 'error';
      }
    }

    return {
      initialized: this.initialized,
      chromecastAvailable: this.chromecastAvailable,
      airplayAvailable: this.airplayAvailable,
      castState,
      sessionState,
      availableMethods: this.state.availableMethods,
      isConnected: this.state.isConnected,
      deviceName: this.state.deviceName,
    };
  }

  /**
   * Cast media using specified method
   */
  async castMedia(media: CastMediaInfo, method?: CastMethod): Promise<boolean> {
    this.currentMediaInfo = media;

    // Auto-select best method if not specified
    const selectedMethod = method || this.state.availableMethods[0];

    switch (selectedMethod) {
      case 'chromecast':
        return this.castToChromecast(media);
      case 'airplay':
        return this.castToAirPlay(media);
      case 'external':
        return this.openInExternalPlayer(media);
      case 'share':
        return this.shareMedia(media);
      case 'clipboard':
        return this.copyToClipboard(media);
      default:
        return this.openInExternalPlayer(media);
    }
  }

  /**
   * Cast to Chromecast
   */
  async castToChromecast(media: CastMediaInfo): Promise<boolean> {
    if (!this.chromecastAvailable) {
      console.warn('[Cast] Chromecast not available');
      return this.openInExternalPlayer(media);
    }

    this.currentMediaInfo = media;

    if (!this.castSession) {
      return this.requestChromecastSession();
    }

    return this.loadMediaToChromecast(media);
  }

  /**
   * Request Chromecast session (shows device picker)
   */
  async requestChromecastSession(): Promise<boolean> {
    if (!this.chromecastAvailable) {
      console.warn('[Cast] Chromecast not available');
      return false;
    }

    try {
      console.log('[Cast] Requesting Chromecast session...');
      const context = cast.framework.CastContext.getInstance();

      // Log current cast state
      const castState = context.getCastState();
      console.log('[Cast] Current cast state:', castState);

      // Request session - this will show the device picker
      const session = await context.requestSession();
      console.log('[Cast] Session requested, result:', session);
      return true;
    } catch (error: any) {
      // User cancelled or no devices found
      if (error?.code === 'cancel') {
        console.log('[Cast] User cancelled device selection');
      } else if (error?.code === 'no_devices_found') {
        console.log('[Cast] No Cast devices found on network');
      } else {
        console.warn('[Cast] Failed to request Chromecast session:', error);
      }
      return false;
    }
  }

  /**
   * Cast to AirPlay (Safari/iOS)
   */
  async castToAirPlay(media: CastMediaInfo): Promise<boolean> {
    if (!this.airplayAvailable) {
      return this.openInExternalPlayer(media);
    }

    try {
      // Crea un video element temporaneo per AirPlay
      const video = document.createElement('video');
      video.src = media.url;
      video.style.display = 'none';
      document.body.appendChild(video);

      if ((video as any).webkitShowPlaybackTargetPicker) {
        (video as any).webkitShowPlaybackTargetPicker();
        this.updateState({
          isConnected: true,
          activeMethod: 'airplay',
          deviceName: 'AirPlay'
        });
        return true;
      }

      document.body.removeChild(video);
      return false;
    } catch (error) {
      console.warn('[Cast] AirPlay error:', error);
      return false;
    }
  }

  /**
   * Open in external player (VLC, MX Player, etc.)
   * Creates a downloadable .m3u file that can be opened on any device
   */
  async openInExternalPlayer(media: CastMediaInfo): Promise<boolean> {
    try {
      const encodedTitle = encodeURIComponent(media.title);

      // Detect if we're in Electron
      const isElectron = typeof window !== 'undefined' &&
        (window as any).process?.type === 'renderer' ||
        navigator.userAgent.toLowerCase().includes('electron');

      // Prova a rilevare il dispositivo/piattaforma
      const userAgent = navigator.userAgent.toLowerCase();
      const isAndroid = userAgent.includes('android');
      const isIOS = /ipad|iphone|ipod/.test(userAgent);

      // Per Electron o Desktop: crea file m3u scaricabile
      if (isElectron || (!isAndroid && !isIOS)) {
        // Crea contenuto M3U
        const m3uContent = `#EXTM3U
#EXTINF:-1 tvg-name="${media.title}",${media.title}
${media.url}`;

        // Crea blob e download
        const blob = new Blob([m3uContent], { type: 'audio/x-mpegurl' });
        const downloadUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = `${media.title.replace(/[^a-z0-9]/gi, '_')}.m3u`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Cleanup dopo un po'
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000);

        // Prova anche ad aprire con protocollo vlc://
        setTimeout(() => {
          try {
            window.location.href = `vlc://${media.url}`;
          } catch (e) {
            // Ignora se non funziona
          }
        }, 500);

        this.updateState({
          activeMethod: 'external',
          deviceName: 'File M3U scaricato'
        });

        return true;
      }

      // Per Android
      if (isAndroid) {
        // Intent per Android
        const intentUrl = `intent:${media.url}#Intent;type=video/*;S.title=${encodedTitle};end`;
        window.location.href = intentUrl;

        setTimeout(() => {
          window.location.href = `vlc://${media.url}`;
        }, 1000);
      }
      // Per iOS
      else if (isIOS) {
        const vlcUrl = `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(media.url)}`;
        window.location.href = vlcUrl;

        setTimeout(() => {
          window.location.href = `infuse://x-callback-url/play?url=${encodeURIComponent(media.url)}`;
        }, 500);
      }

      this.updateState({
        activeMethod: 'external',
        deviceName: 'External Player'
      });

      return true;
    } catch (error) {
      console.error('[Cast] Failed to open external player:', error);

      // Fallback: copia negli appunti
      try {
        await navigator.clipboard.writeText(media.url);
        this.updateState({
          activeMethod: 'clipboard',
          deviceName: 'URL copiato'
        });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Share media URL using Web Share API
   */
  async shareMedia(media: CastMediaInfo): Promise<boolean> {
    if (!navigator.share) {
      return this.copyToClipboard(media);
    }

    try {
      await navigator.share({
        title: media.title,
        text: `Guarda "${media.title}" su StreamAI`,
        url: media.url
      });

      this.updateState({
        activeMethod: 'share',
        deviceName: 'Shared'
      });

      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('[Cast] Share failed:', error);
      }
      return false;
    }
  }

  /**
   * Copy media URL to clipboard
   */
  async copyToClipboard(media: CastMediaInfo): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(media.url);

      this.updateState({
        activeMethod: 'clipboard',
        deviceName: 'Clipboard'
      });

      return true;
    } catch (error) {
      console.error('[Cast] Clipboard copy failed:', error);

      // Fallback per browser più vecchi
      const textarea = document.createElement('textarea');
      textarea.value = media.url;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
      } catch {
        document.body.removeChild(textarea);
        return false;
      }
    }
  }

  /**
   * End current cast session
   */
  endSession() {
    if (this.castSession) {
      try {
        this.castSession.endSession(true);
      } catch (error) {
        console.warn('[Cast] Error ending session:', error);
      }
    }

    this.castSession = null;
    this.currentMediaInfo = null;
    this.updateState({
      isConnected: false,
      deviceName: null,
      activeMethod: null,
      currentTime: 0,
      duration: 0,
      isPaused: true
    });
  }

  /**
   * Play/pause toggle (for Chromecast)
   */
  togglePlayPause() {
    if (!this.playerController) return;
    this.playerController.playOrPause();
  }

  /**
   * Play (for Chromecast)
   */
  play() {
    if (!this.playerController || !this.player?.isPaused) return;
    this.playerController.playOrPause();
  }

  /**
   * Pause (for Chromecast)
   */
  pause() {
    if (!this.playerController || this.player?.isPaused) return;
    this.playerController.playOrPause();
  }

  /**
   * Seek to time (for Chromecast)
   */
  seek(time: number) {
    if (!this.player || !this.playerController) return;
    this.player.currentTime = time;
    this.playerController.seek();
  }

  /**
   * Set volume (0-1) (for Chromecast)
   */
  setVolume(volume: number) {
    if (!this.player || !this.playerController) return;
    this.player.volumeLevel = Math.max(0, Math.min(1, volume));
    this.playerController.setVolumeLevel();
  }

  /**
   * Mute/unmute (for Chromecast)
   */
  toggleMute() {
    if (!this.playerController) return;
    this.playerController.muteOrUnmute();
  }

  /**
   * Stop casting current media
   */
  stop() {
    if (!this.playerController) return;
    this.playerController.stop();
    this.currentMediaInfo = null;
  }

  /**
   * Get stream URL for external use
   */
  getStreamUrl(): string | null {
    return this.currentMediaInfo?.url || null;
  }
}

// Singleton instance
export const CastService = new CastServiceClass();

export default CastService;

