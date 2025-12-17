/**
 * Stream Info Service
 * Analizza e rileva informazioni sui codec e le caratteristiche dello stream video
 */

export interface StreamCodecInfo {
  // Video
  videoCodec: string | null;
  videoCodecId: string | null;
  videoProfile: string | null;
  videoLevel: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  bitrate: number | null;

  // Audio
  audioCodec: string | null;
  audioCodecId: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;

  // Container
  container: string | null;
  protocol: string | null;

  // Stato
  isHEVC: boolean;
  isH264: boolean;
  isAV1: boolean;
  isVP9: boolean;
  isSupported: boolean;
  supportDetails: string;

  // Raw data
  rawInfo: Record<string, any>;
}

/**
 * Mappa dei codec ID comuni
 */
const CODEC_MAP: Record<string, string> = {
  // H.264/AVC
  'avc1': 'H.264/AVC',
  'avc2': 'H.264/AVC',
  'avc3': 'H.264/AVC',
  'avc4': 'H.264/AVC',
  'h264': 'H.264/AVC',

  // H.265/HEVC
  'hev1': 'H.265/HEVC',
  'hvc1': 'H.265/HEVC',
  'hevc': 'H.265/HEVC',
  'h265': 'H.265/HEVC',

  // AV1
  'av01': 'AV1',
  'av1': 'AV1',

  // VP9
  'vp09': 'VP9',
  'vp9': 'VP9',

  // VP8
  'vp08': 'VP8',
  'vp8': 'VP8',

  // Audio
  'mp4a': 'AAC',
  'aac': 'AAC',
  'mp3': 'MP3',
  'opus': 'Opus',
  'vorbis': 'Vorbis',
  'ac-3': 'AC-3/Dolby Digital',
  'ec-3': 'E-AC-3/Dolby Digital Plus',
  'flac': 'FLAC',
};

/**
 * Rileva il codec dal codec string (es. "avc1.42E01E")
 */
function parseCodecString(codecString: string): { id: string; name: string; profile?: string; level?: string } {
  const parts = codecString.split('.');
  const id = parts[0].toLowerCase();
  const name = CODEC_MAP[id] || id.toUpperCase();

  let profile: string | undefined;
  let level: string | undefined;

  // Parse H.264 profile/level (es. avc1.42E01E)
  if (id.startsWith('avc') && parts.length > 1) {
    const hex = parts[1];
    if (hex.length >= 6) {
      const profileIdc = parseInt(hex.substring(0, 2), 16);
      const levelIdc = parseInt(hex.substring(4, 6), 16);

      // Profile mapping
      const profiles: Record<number, string> = {
        66: 'Baseline',
        77: 'Main',
        88: 'Extended',
        100: 'High',
        110: 'High 10',
        122: 'High 4:2:2',
        244: 'High 4:4:4',
      };
      profile = profiles[profileIdc] || `Profile ${profileIdc}`;
      level = (levelIdc / 10).toFixed(1);
    }
  }

  // Parse HEVC profile/level (es. hev1.1.6.L93.B0)
  if ((id === 'hev1' || id === 'hvc1') && parts.length >= 4) {
    const profileSpace = parts[1];
    const tierFlag = parts[2];
    const levelStr = parts[3];

    profile = `Main${profileSpace === '2' ? ' 10' : ''}`;
    if (levelStr.startsWith('L')) {
      level = (parseInt(levelStr.substring(1)) / 30).toFixed(1);
    }
  }

  return { id, name, profile, level };
}

/**
 * Verifica il supporto del browser per un codec
 */
function checkCodecSupport(mimeType: string): { supported: boolean; probably: boolean } {
  const video = document.createElement('video');
  const result = video.canPlayType(mimeType);
  return {
    supported: result !== '',
    probably: result === 'probably',
  };
}

class StreamInfoService {
  private currentInfo: StreamCodecInfo | null = null;
  private logCallbacks: ((message: string, level: 'info' | 'warn' | 'error') => void)[] = [];

  /**
   * Registra un callback per i log
   */
  onLog(callback: (message: string, level: 'info' | 'warn' | 'error') => void): void {
    this.logCallbacks.push(callback);
  }

  /**
   * Rimuove un callback per i log
   */
  offLog(callback: (message: string, level: 'info' | 'warn' | 'error') => void): void {
    const index = this.logCallbacks.indexOf(callback);
    if (index > -1) {
      this.logCallbacks.splice(index, 1);
    }
  }

  private log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = '[StreamInfo]';
    const fullMessage = `${prefix} ${message}`;

    switch (level) {
      case 'error':
        console.error(fullMessage);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      default:
        console.log(fullMessage);
    }

    this.logCallbacks.forEach(cb => cb(message, level));
  }

  /**
   * Analizza le informazioni del video element
   */
  analyzeVideoElement(video: HTMLVideoElement): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      rawInfo: {},
    };

    // Informazioni base
    if (video.videoWidth && video.videoHeight) {
      this.log(`Risoluzione: ${video.videoWidth}x${video.videoHeight}`);
      info.rawInfo!.resolution = `${video.videoWidth}x${video.videoHeight}`;
    }

    // Durata
    if (video.duration && isFinite(video.duration)) {
      info.rawInfo!.duration = video.duration;
      this.log(`Durata: ${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}`);
    }

    // Prova a ottenere informazioni dal MediaSource (se disponibile)
    if ('getVideoPlaybackQuality' in video) {
      const quality = (video as any).getVideoPlaybackQuality();
      if (quality) {
        info.rawInfo!.droppedFrames = quality.droppedVideoFrames;
        info.rawInfo!.totalFrames = quality.totalVideoFrames;
        info.rawInfo!.corruptedFrames = quality.corruptedVideoFrames;

        if (quality.totalVideoFrames > 0) {
          const dropRate = (quality.droppedVideoFrames / quality.totalVideoFrames * 100).toFixed(2);
          this.log(`Frame: ${quality.totalVideoFrames} totali, ${quality.droppedVideoFrames} persi (${dropRate}%)`);
        }
      }
    }

    return info;
  }

  /**
   * Analizza le informazioni da HLS.js
   */
  analyzeHls(hls: any): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      rawInfo: {},
    };

    try {
      // Livello corrente
      const currentLevel = hls.currentLevel;
      const levels = hls.levels;

      if (levels && levels[currentLevel]) {
        const level = levels[currentLevel];

        // Risoluzione
        if (level.width && level.height) {
          info.width = level.width;
          info.height = level.height;
          this.log(`HLS Livello ${currentLevel}: ${level.width}x${level.height}`);
        }

        // Bitrate
        if (level.bitrate) {
          info.bitrate = level.bitrate;
          this.log(`Bitrate: ${(level.bitrate / 1000000).toFixed(2)} Mbps`);
        }

        // Codec
        if (level.videoCodec) {
          const parsed = parseCodecString(level.videoCodec);
          info.videoCodec = parsed.name;
          info.videoCodecId = level.videoCodec;
          info.videoProfile = parsed.profile || null;
          info.videoLevel = parsed.level || null;

          info.isHEVC = parsed.id.startsWith('hev') || parsed.id.startsWith('hvc');
          info.isH264 = parsed.id.startsWith('avc');
          info.isAV1 = parsed.id.startsWith('av0') || parsed.id === 'av1';
          info.isVP9 = parsed.id.startsWith('vp9') || parsed.id.startsWith('vp09');

          let codecStr = `Video Codec: ${parsed.name}`;
          if (parsed.profile) codecStr += ` (${parsed.profile}`;
          if (parsed.level) codecStr += ` L${parsed.level}`;
          if (parsed.profile) codecStr += ')';
          this.log(codecStr);

          // Verifica supporto
          const mimeType = `video/mp4; codecs="${level.videoCodec}"`;
          const support = checkCodecSupport(mimeType);
          info.isSupported = support.supported;
          info.supportDetails = support.probably ? 'Supportato (probably)' : support.supported ? 'Supportato (maybe)' : 'Non supportato';

          if (info.isHEVC) {
            this.log(`⚠️ HEVC/H.265 rilevato - Supporto: ${info.supportDetails}`, support.supported ? 'info' : 'warn');
          }
        }

        if (level.audioCodec) {
          const parsed = parseCodecString(level.audioCodec);
          info.audioCodec = parsed.name;
          info.audioCodecId = level.audioCodec;
          this.log(`Audio Codec: ${parsed.name}`);
        }

        // Frame rate
        if (level.frameRate) {
          info.frameRate = level.frameRate;
          this.log(`Frame Rate: ${level.frameRate} fps`);
        }

        info.rawInfo!.hlsLevel = level;
      }

      // Numero di livelli disponibili
      if (levels && levels.length > 0) {
        this.log(`Livelli HLS disponibili: ${levels.length}`);
        levels.forEach((l: any, i: number) => {
          const res = l.width && l.height ? `${l.width}x${l.height}` : 'N/A';
          const br = l.bitrate ? `${(l.bitrate / 1000000).toFixed(2)} Mbps` : 'N/A';
          this.log(`  [${i}] ${res} @ ${br}${i === currentLevel ? ' ← corrente' : ''}`);
        });
      }

      info.protocol = 'HLS';
      info.container = 'MPEG-TS/fMP4';

    } catch (error) {
      this.log(`Errore analisi HLS: ${error}`, 'error');
    }

    return info;
  }

  /**
   * Analizza le informazioni da mpegts.js
   */
  analyzeMpegts(player: any): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      rawInfo: {},
    };

    try {
      const mediaInfo = player.mediaInfo;

      if (mediaInfo) {
        // Video
        if (mediaInfo.videoCodec) {
          info.videoCodecId = mediaInfo.videoCodec;
          const parsed = parseCodecString(mediaInfo.videoCodec);
          info.videoCodec = parsed.name;

          info.isHEVC = mediaInfo.videoCodec.toLowerCase().includes('hevc') ||
                        mediaInfo.videoCodec.toLowerCase().includes('h265') ||
                        mediaInfo.videoCodec.toLowerCase().includes('hev');
          info.isH264 = mediaInfo.videoCodec.toLowerCase().includes('avc') ||
                        mediaInfo.videoCodec.toLowerCase().includes('h264');

          this.log(`MPEG-TS Video Codec: ${parsed.name} (${mediaInfo.videoCodec})`);

          if (info.isHEVC) {
            this.log(`⚠️ HEVC/H.265 rilevato in stream MPEG-TS`, 'warn');
          }
        }

        if (mediaInfo.width && mediaInfo.height) {
          info.width = mediaInfo.width;
          info.height = mediaInfo.height;
          this.log(`MPEG-TS Risoluzione: ${mediaInfo.width}x${mediaInfo.height}`);
        }

        if (mediaInfo.fps) {
          info.frameRate = mediaInfo.fps;
          this.log(`MPEG-TS Frame Rate: ${mediaInfo.fps} fps`);
        }

        // Audio
        if (mediaInfo.audioCodec) {
          info.audioCodecId = mediaInfo.audioCodec;
          const parsed = parseCodecString(mediaInfo.audioCodec);
          info.audioCodec = parsed.name;
          this.log(`MPEG-TS Audio Codec: ${parsed.name}`);
        }

        if (mediaInfo.audioChannelCount) {
          info.audioChannels = mediaInfo.audioChannelCount;
          this.log(`MPEG-TS Canali Audio: ${mediaInfo.audioChannelCount}`);
        }

        if (mediaInfo.audioSampleRate) {
          info.audioSampleRate = mediaInfo.audioSampleRate;
          this.log(`MPEG-TS Sample Rate: ${mediaInfo.audioSampleRate} Hz`);
        }

        info.rawInfo!.mpegtsMediaInfo = mediaInfo;
      }

      // Statistiche
      const stats = player.statisticsInfo;
      if (stats) {
        if (stats.speed !== undefined) {
          this.log(`Velocità download: ${(stats.speed / 1024).toFixed(2)} KB/s`);
        }
        if (stats.decodedFrames !== undefined) {
          this.log(`Frame decodificati: ${stats.decodedFrames}`);
        }
        if (stats.droppedFrames !== undefined) {
          this.log(`Frame persi: ${stats.droppedFrames}`);
        }
        info.rawInfo!.mpegtsStats = stats;
      }

      info.protocol = 'MPEG-TS';
      info.container = 'MPEG-TS';

    } catch (error) {
      this.log(`Errore analisi MPEG-TS: ${error}`, 'error');
    }

    return info;
  }

  /**
   * Analizza un URL di stream
   */
  analyzeUrl(url: string): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      rawInfo: { url },
    };

    const lowerUrl = url.toLowerCase();

    // Rileva protocollo
    if (lowerUrl.includes('.m3u8')) {
      info.protocol = 'HLS';
      info.container = 'HLS (m3u8)';
      this.log('Protocollo: HLS (m3u8)');
    } else if (lowerUrl.includes('.mpd')) {
      info.protocol = 'DASH';
      info.container = 'DASH (mpd)';
      this.log('Protocollo: DASH (mpd)');
    } else if (lowerUrl.match(/\.(ts|mpeg|mpg)(\?|$)/)) {
      info.protocol = 'MPEG-TS';
      info.container = 'MPEG-TS';
      this.log('Protocollo: MPEG-TS diretto');
    } else if (lowerUrl.match(/\.(mp4|m4v)(\?|$)/)) {
      info.protocol = 'Progressive';
      info.container = 'MP4';
      this.log('Protocollo: MP4 progressivo');
    } else if (lowerUrl.match(/\.(mkv|webm)(\?|$)/)) {
      info.protocol = 'Progressive';
      info.container = lowerUrl.includes('.mkv') ? 'MKV' : 'WebM';
      this.log(`Protocollo: ${info.container} progressivo`);
    }

    return info;
  }

  /**
   * Raccoglie tutte le informazioni disponibili
   */
  collectInfo(
    video: HTMLVideoElement | null,
    hls: any | null,
    mpegts: any | null,
    url: string
  ): StreamCodecInfo {
    this.log('=== Inizio analisi stream ===');

    let info: StreamCodecInfo = {
      videoCodec: null,
      videoCodecId: null,
      videoProfile: null,
      videoLevel: null,
      width: null,
      height: null,
      frameRate: null,
      bitrate: null,
      audioCodec: null,
      audioCodecId: null,
      audioChannels: null,
      audioSampleRate: null,
      container: null,
      protocol: null,
      isHEVC: false,
      isH264: false,
      isAV1: false,
      isVP9: false,
      isSupported: true,
      supportDetails: 'Sconosciuto',
      rawInfo: {},
    };

    // Analizza URL
    const urlInfo = this.analyzeUrl(url);
    info = { ...info, ...urlInfo, rawInfo: { ...info.rawInfo, ...urlInfo.rawInfo } };

    // Analizza video element
    if (video) {
      const videoInfo = this.analyzeVideoElement(video);
      info = { ...info, ...videoInfo, rawInfo: { ...info.rawInfo, ...videoInfo.rawInfo } };
    }

    // Analizza HLS
    if (hls) {
      const hlsInfo = this.analyzeHls(hls);
      info = { ...info, ...hlsInfo, rawInfo: { ...info.rawInfo, ...hlsInfo.rawInfo } };
    }

    // Analizza MPEG-TS
    if (mpegts) {
      const mpegtsInfo = this.analyzeMpegts(mpegts);
      info = { ...info, ...mpegtsInfo, rawInfo: { ...info.rawInfo, ...mpegtsInfo.rawInfo } };
    }

    // Riepilogo finale
    this.log('=== Riepilogo ===');
    this.log(`Video: ${info.videoCodec || 'N/A'} ${info.width}x${info.height || 'N/A'}`);
    this.log(`Audio: ${info.audioCodec || 'N/A'}`);
    this.log(`Container: ${info.container || 'N/A'}`);
    this.log(`Supporto: ${info.supportDetails}`);

    if (info.isHEVC && !info.isSupported) {
      this.log('⚠️ ATTENZIONE: Contenuto HEVC/H.265 non supportato dal browser!', 'warn');
    }

    this.currentInfo = info;
    return info;
  }

  /**
   * Ottiene le informazioni correnti
   */
  getCurrentInfo(): StreamCodecInfo | null {
    return this.currentInfo;
  }

  /**
   * Formatta le informazioni per la visualizzazione
   */
  formatInfoForDisplay(info: StreamCodecInfo): string[] {
    const lines: string[] = [];

    lines.push('═══ INFO STREAM ═══');
    lines.push('');

    // Video
    lines.push('📹 VIDEO');
    if (info.videoCodec) {
      let codecLine = `   Codec: ${info.videoCodec}`;
      if (info.videoProfile) codecLine += ` (${info.videoProfile}`;
      if (info.videoLevel) codecLine += ` L${info.videoLevel}`;
      if (info.videoProfile) codecLine += ')';
      lines.push(codecLine);
    }
    if (info.width && info.height) {
      lines.push(`   Risoluzione: ${info.width}×${info.height}`);
    }
    if (info.frameRate) {
      lines.push(`   Frame Rate: ${info.frameRate} fps`);
    }
    if (info.bitrate) {
      lines.push(`   Bitrate: ${(info.bitrate / 1000000).toFixed(2)} Mbps`);
    }

    lines.push('');

    // Audio
    lines.push('🔊 AUDIO');
    if (info.audioCodec) {
      lines.push(`   Codec: ${info.audioCodec}`);
    }
    if (info.audioChannels) {
      lines.push(`   Canali: ${info.audioChannels}`);
    }
    if (info.audioSampleRate) {
      lines.push(`   Sample Rate: ${info.audioSampleRate} Hz`);
    }

    lines.push('');

    // Container/Protocollo
    lines.push('📦 CONTAINER');
    if (info.container) {
      lines.push(`   Formato: ${info.container}`);
    }
    if (info.protocol) {
      lines.push(`   Protocollo: ${info.protocol}`);
    }

    lines.push('');

    // Supporto
    lines.push('✅ SUPPORTO');
    lines.push(`   ${info.supportDetails}`);

    if (info.isHEVC) {
      lines.push('');
      lines.push('⚠️ HEVC/H.265 rilevato');
      if (!info.isSupported) {
        lines.push('   Il browser potrebbe non supportare');
        lines.push('   questo codec. Usa VLC o MX Player.');
      }
    }

    return lines;
  }

  /**
   * Resetta le informazioni
   */
  reset(): void {
    this.currentInfo = null;
  }
}

export const streamInfoService = new StreamInfoService();

