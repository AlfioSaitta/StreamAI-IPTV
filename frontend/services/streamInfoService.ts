/**
 * Stream Info Service - Enhanced Version
 * Analisi avanzata dei codec e caratteristiche dello stream video.
 * Utilizza Media Capabilities API, WebCodecs API e analisi approfondita.
 *
 * Refactor B.2 (2026-05-12): la logica di parsing pura (codec maps, codec string
 * parser, HLS manifest, MPEG-TS PAT/PMT, analisi byte) è stata spostata sotto
 * `services/streamInfo/`. Questo file mantiene la classe orchestratrice e
 * re-esporta i simboli pubblici per backward compatibility.
 */
import {
  analyzeHlsManifestText,
  analyzeVideoBytes,
  checkCodecSupport,
  checkMediaCapabilities,
  parseCodecString,
  resolveHlsReference,
  type StreamCodecInfo,
} from './streamInfo';
import { proxyFetch } from './proxyFetch.ts';
export { analyzeVideoBytes } from './streamInfo';
export type { StreamCodecInfo } from './streamInfo';
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
   * Analizza le informazioni del video element - VERSIONE AVANZATA
   */
  analyzeVideoElement(video: HTMLVideoElement): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      width: video.videoWidth || null,
      height: video.videoHeight || null,
      rawInfo: {},
      detectionMethod: 'video-element',
      confidence: 'low',
    };


    // Informazioni base
    if (video.videoWidth && video.videoHeight) {
      this.log(`Risoluzione: ${video.videoWidth}x${video.videoHeight}`);
      info.rawInfo!.resolution = `${video.videoWidth}x${video.videoHeight}`;

      // Rileva aspect ratio
      const aspectRatio = video.videoWidth / video.videoHeight;
      let arName = 'Custom';
      if (Math.abs(aspectRatio - 16/9) < 0.01) arName = '16:9';
      else if (Math.abs(aspectRatio - 4/3) < 0.01) arName = '4:3';
      else if (Math.abs(aspectRatio - 21/9) < 0.02) arName = '21:9 (Ultrawide)';
      else if (Math.abs(aspectRatio - 2.35) < 0.05) arName = '2.35:1 (Cinemascope)';
      else if (Math.abs(aspectRatio - 1.85) < 0.02) arName = '1.85:1';
      info.rawInfo!.aspectRatio = arName;
      this.log(`Aspect Ratio: ${arName} (${aspectRatio.toFixed(3)})`);
    }

    // Durata
    if (video.duration && isFinite(video.duration)) {
      info.rawInfo!.duration = video.duration;
      this.log(`Durata: ${Math.floor(video.duration / 60)}:${Math.floor(video.duration % 60).toString().padStart(2, '0')}`);
    }

    // ============================================
    // PLAYBACK QUALITY - Frame drops e performance
    // ============================================
    if ('getVideoPlaybackQuality' in video) {
      const quality = (video as any).getVideoPlaybackQuality();
      if (quality) {
        info.droppedFrames = quality.droppedVideoFrames || 0;
        info.totalFrames = quality.totalVideoFrames || 0;
        info.corruptedFrames = quality.corruptedVideoFrames || 0;
        info.decodedFrames = quality.totalVideoFrames || 0;

        if (quality.totalVideoFrames > 0) {
          info.frameDropRate = (quality.droppedVideoFrames / quality.totalVideoFrames * 100);
          const dropRate = info.frameDropRate.toFixed(2);
          this.log(`Frame: ${quality.totalVideoFrames} totali, ${quality.droppedVideoFrames} persi (${dropRate}%)`);

          // Stima frame rate dal tempo
          if (video.currentTime > 0 && quality.totalVideoFrames > 0) {
            const estimatedFps = quality.totalVideoFrames / video.currentTime;
            if (estimatedFps > 10 && estimatedFps < 120) {
              info.frameRate = Math.round(estimatedFps * 100) / 100;
              this.log(`Frame Rate (stimato): ${info.frameRate.toFixed(2)} fps`);
            }
          }
        }

        info.rawInfo!.playbackQuality = {
          totalVideoFrames: quality.totalVideoFrames,
          droppedVideoFrames: quality.droppedVideoFrames,
          corruptedVideoFrames: quality.corruptedVideoFrames,
        };
      }
    }

    // ============================================
    // MEDIA SOURCE BUFFERS - Codec info diretta
    // ============================================
    const mediaSource = (video as any).mediaSource ||
                        (video as any).mozMediaSourceObject ||
                        (video as any).webkitMediaSourceObject;

    if (mediaSource && mediaSource.sourceBuffers) {
      this.log('Analisi MediaSource SourceBuffers...');
      for (let i = 0; i < mediaSource.sourceBuffers.length; i++) {
        const sb = mediaSource.sourceBuffers[i];
        if (sb.mimeType) {
          this.log(`SourceBuffer[${i}]: ${sb.mimeType}`);

          // Estrai codec dal mimeType
          const codecMatch = sb.mimeType.match(/codecs="([^"]+)"/);
          if (codecMatch) {
            const codecs = codecMatch[1].split(',').map((c: string) => c.trim());

            for (const codecStr of codecs) {
              const parsed = parseCodecString(codecStr);

              if (sb.mimeType.includes('video')) {
                info.videoCodec = parsed.name;
                info.videoCodecId = codecStr;
                info.videoProfile = parsed.profile || null;
                info.videoLevel = parsed.level || null;
                info.videoBitDepth = parsed.bitDepth || null;
                info.videoColorSpace = parsed.colorSpace || null;
                info.videoHDR = parsed.isHDR || false;
                info.mimeType = sb.mimeType;

                info.isH264 = parsed.id.startsWith('avc');
                info.isHEVC = parsed.id.startsWith('hev') || parsed.id.startsWith('hvc');
                info.isAV1 = parsed.id.startsWith('av0') || parsed.id === 'av1';
                info.isVP9 = parsed.id.startsWith('vp9') || parsed.id.startsWith('vp09');
                info.isVP8 = parsed.id.startsWith('vp8') || parsed.id.startsWith('vp08');
                info.isDolbyVision = parsed.id.startsWith('dvh') || parsed.id.startsWith('dva');
                info.isHDR10 = parsed.isHDR && !info.isDolbyVision || false;

                info.detectionMethod = 'mediasource-buffer';
                info.confidence = 'high';

                this.log(`Video Codec (SourceBuffer): ${parsed.name} - ${codecStr}`, 'info');
                if (parsed.profile) this.log(`  Profilo: ${parsed.profile}`);
                if (parsed.level) this.log(`  Livello: ${parsed.level}`);
                if (parsed.bitDepth) this.log(`  Bit Depth: ${parsed.bitDepth}-bit`);
                if (parsed.isHDR) this.log(`  HDR: Sì (${parsed.colorSpace || 'tipo sconosciuto'})`);
              }

              if (sb.mimeType.includes('audio')) {
                info.audioCodec = parsed.name;
                info.audioCodecId = codecStr;
                info.detectionMethod = 'mediasource-buffer';
                info.confidence = 'high';
                this.log(`Audio Codec (SourceBuffer): ${parsed.name} - ${codecStr}`);
                if (parsed.profile) this.log(`  Profilo Audio: ${parsed.profile}`);
              }
            }
          }
        }
      }
    }
    // ============================================

    // Metodo 1: VideoTrack API (Chrome, Edge)
    if ('videoTracks' in video && (video as any).videoTracks?.length > 0) {
      const videoTrack = (video as any).videoTracks[0];
      if (videoTrack) {
        this.log(`VideoTrack trovato: ${videoTrack.label || 'senza nome'}`);
        info.rawInfo!.videoTrack = {
          id: videoTrack.id,
          kind: videoTrack.kind,
          label: videoTrack.label,
          language: videoTrack.language,
        };

        // Alcuni browser espongono il codec nella proprietà label o configuration
        if (videoTrack.configuration?.codec) {
          const codecStr = videoTrack.configuration.codec;
          const parsed = parseCodecString(codecStr);
          info.videoCodec = parsed.name;
          info.videoCodecId = codecStr;
          info.videoProfile = parsed.profile || null;
          info.videoLevel = parsed.level || null;
          info.isH264 = parsed.id.startsWith('avc');
          info.isHEVC = parsed.id.startsWith('hev') || parsed.id.startsWith('hvc');
          info.isAV1 = parsed.id.startsWith('av0') || parsed.id === 'av1';
          info.isVP9 = parsed.id.startsWith('vp9') || parsed.id.startsWith('vp09');
          this.log(`Video Codec (VideoTrack): ${parsed.name}`);
        }

        // Prova a estrarre codec dal label del track
        if (!info.videoCodec && videoTrack.label) {
          const label = videoTrack.label.toLowerCase();
          if (label.includes('hevc') || label.includes('h.265') || label.includes('h265') || label.includes('x265')) {
            info.videoCodec = 'H.265/HEVC';
            info.isHEVC = true;
            this.log('Video Codec (da label): H.265/HEVC');
          } else if (label.includes('h.264') || label.includes('h264') || label.includes('x264') || label.includes('avc')) {
            info.videoCodec = 'H.264/AVC';
            info.isH264 = true;
            this.log('Video Codec (da label): H.264/AVC');
          } else if (label.includes('av1')) {
            info.videoCodec = 'AV1';
            info.isAV1 = true;
            this.log('Video Codec (da label): AV1');
          } else if (label.includes('vp9')) {
            info.videoCodec = 'VP9';
            info.isVP9 = true;
            this.log('Video Codec (da label): VP9');
          }
        }
      }
    }

    // Metodo 2: AudioTrack API
    if ('audioTracks' in video && (video as any).audioTracks?.length > 0) {
      const audioTrack = (video as any).audioTracks[0];
      if (audioTrack) {
        const trackLabel = audioTrack.label || '';
        this.log(`AudioTrack trovato: ${trackLabel || 'senza nome'}`);
        info.rawInfo!.audioTrack = {
          id: audioTrack.id,
          kind: audioTrack.kind,
          label: trackLabel,
          language: audioTrack.language,
        };

        if (audioTrack.configuration?.codec) {
          const codecStr = audioTrack.configuration.codec;
          const parsed = parseCodecString(codecStr);
          info.audioCodec = parsed.name;
          info.audioCodecId = codecStr;
          this.log(`Audio Codec (AudioTrack config): ${parsed.name}`);
        }

        // Estrai informazioni dal label dell'audio track
        // Formato tipico: "[ITA] Nome Film (2.0, 192 kbps)" o "Stereo (AAC, 48000 Hz)"
        if (trackLabel) {
          const labelLower = trackLabel.toLowerCase();

          // Rileva codec audio dal label
          if (!info.audioCodec) {
            if (labelLower.includes('aac')) {
              info.audioCodec = 'AAC';
              this.log('Audio Codec (da label): AAC');
            } else if (labelLower.includes('ac3') || labelLower.includes('ac-3') || labelLower.includes('dolby digital')) {
              info.audioCodec = 'AC-3/Dolby Digital';
              this.log('Audio Codec (da label): AC-3/Dolby Digital');
            } else if (labelLower.includes('eac3') || labelLower.includes('e-ac-3') || labelLower.includes('dolby digital plus')) {
              info.audioCodec = 'E-AC-3/Dolby Digital Plus';
              this.log('Audio Codec (da label): E-AC-3');
            } else if (labelLower.includes('dts')) {
              info.audioCodec = 'DTS';
              this.log('Audio Codec (da label): DTS');
            } else if (labelLower.includes('truehd')) {
              info.audioCodec = 'Dolby TrueHD';
              this.log('Audio Codec (da label): Dolby TrueHD');
            } else if (labelLower.includes('flac')) {
              info.audioCodec = 'FLAC';
              this.log('Audio Codec (da label): FLAC');
            } else if (labelLower.includes('opus')) {
              info.audioCodec = 'Opus';
              this.log('Audio Codec (da label): Opus');
            } else if (labelLower.includes('mp3')) {
              info.audioCodec = 'MP3';
              this.log('Audio Codec (da label): MP3');
            } else if (labelLower.includes('vorbis')) {
              info.audioCodec = 'Vorbis';
              this.log('Audio Codec (da label): Vorbis');
            } else if (labelLower.includes('pcm') || labelLower.includes('lpcm')) {
              info.audioCodec = 'PCM';
              this.log('Audio Codec (da label): PCM');
            }
          }

          // Rileva canali audio dal label (es. "2.0", "5.1", "7.1", "Stereo", "Mono")
          const channelMatch = trackLabel.match(/(\d+\.\d+)|stereo|mono|surround/i);
          if (channelMatch) {
            const channelStr = channelMatch[0].toLowerCase();
            if (channelStr === 'mono') {
              info.audioChannels = 1;
            } else if (channelStr === 'stereo' || channelStr === '2.0') {
              info.audioChannels = 2;
            } else if (channelStr === '5.1') {
              info.audioChannels = 6;
            } else if (channelStr === '7.1') {
              info.audioChannels = 8;
            } else if (channelStr.includes('.')) {
              // Parse formato X.Y (es. 2.0, 5.1, 7.1)
              const parts = channelStr.split('.');
              info.audioChannels = parseInt(parts[0]) + parseInt(parts[1]);
            }
            if (info.audioChannels) {
              this.log(`Canali Audio (da label): ${info.audioChannels} (${channelStr})`);
            }
          }

          // Rileva bitrate dal label (es. "192 kbps", "320kbps")
          const bitrateMatch = trackLabel.match(/(\d+)\s*kbps/i);
          if (bitrateMatch) {
            const audioBitrate = parseInt(bitrateMatch[1]);
            info.rawInfo!.audioBitrate = audioBitrate;
            this.log(`Audio Bitrate (da label): ${audioBitrate} kbps`);

            // Se non abbiamo il codec, non facciamo stime dal bitrate
            // Il bitrate da solo non permette di determinare il codec con certezza
          }

          // Rileva sample rate dal label (es. "48000 Hz", "44100Hz")
          const sampleRateMatch = trackLabel.match(/(\d{4,6})\s*hz/i);
          if (sampleRateMatch) {
            info.audioSampleRate = parseInt(sampleRateMatch[1]);
            this.log(`Sample Rate (da label): ${info.audioSampleRate} Hz`);
          }

          // Rileva lingua dal label (es. "[ITA]", "[ENG]", "Italian", "English")
          const langMatch = trackLabel.match(/\[([A-Z]{2,3})]|italian|italiano|english|inglese|french|francese|german|tedesco|spanish|spagnolo/i);
          if (langMatch) {
            info.rawInfo!.audioLanguage = langMatch[1] || langMatch[0];
            this.log(`Lingua Audio (da label): ${info.rawInfo!.audioLanguage}`);
          }
        }

            // Se non abbiamo ancora il codec audio, non facciamo stime approssimative
        // Lasciamo il valore null per indicare che non è stato possibile rilevarlo
      }
    }

    // Metodo 3: Analisi dal src URL (per hint sul codec)
    const src = video.currentSrc || video.src;
    if (src && !info.videoCodec) {
      const srcLower = src.toLowerCase();

      // Rileva codec da parametri URL comuni
      if (srcLower.includes('hevc') || srcLower.includes('h265') || srcLower.includes('x265')) {
        info.videoCodec = 'H.265/HEVC';
        info.isHEVC = true;
        this.log('Video Codec (da URL): H.265/HEVC');
      } else if (srcLower.includes('h264') || srcLower.includes('x264') || srcLower.includes('avc')) {
        info.videoCodec = 'H.264/AVC';
        info.isH264 = true;
        this.log('Video Codec (da URL): H.264/AVC');
      } else if (srcLower.includes('av1')) {
        info.videoCodec = 'AV1';
        info.isAV1 = true;
        this.log('Video Codec (da URL): AV1');
      } else if (srcLower.includes('vp9')) {
        info.videoCodec = 'VP9';
        info.isVP9 = true;
        this.log('Video Codec (da URL): VP9');
      }

      // Audio da URL
      if (srcLower.includes('aac')) {
        info.audioCodec = 'AAC';
        this.log('Audio Codec (da URL): AAC');
      } else if (srcLower.includes('ac3') || srcLower.includes('ac-3')) {
        info.audioCodec = 'AC-3/Dolby Digital';
        this.log('Audio Codec (da URL): AC-3');
      } else if (srcLower.includes('eac3') || srcLower.includes('ec-3')) {
        info.audioCodec = 'E-AC-3/Dolby Digital Plus';
        this.log('Audio Codec (da URL): E-AC-3');
      } else if (srcLower.includes('opus')) {
        info.audioCodec = 'Opus';
        this.log('Audio Codec (da URL): Opus');
      }
    }

    // Non facciamo stime basate sul container o sulla risoluzione
    // Queste informazioni non permettono di determinare il codec con certezza

    // Metodo 5: Verifica supporto codec per determinare cosa sta usando il browser
    if (!info.videoCodec && video.videoWidth && video.videoHeight) {
      this.log('Tentativo rilevamento codec tramite test supporto...');

      // Test codec comuni in ordine di probabilità
      const testCodecs = [
        { codec: 'avc1.42E01E', name: 'H.264/AVC', mime: 'video/mp4; codecs="avc1.42E01E"' },
        { codec: 'avc1.640028', name: 'H.264/AVC High', mime: 'video/mp4; codecs="avc1.640028"' },
        { codec: 'hev1.1.6.L93.B0', name: 'H.265/HEVC', mime: 'video/mp4; codecs="hev1.1.6.L93.B0"' },
        { codec: 'hvc1.1.6.L93.B0', name: 'H.265/HEVC', mime: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
        { codec: 'vp9', name: 'VP9', mime: 'video/webm; codecs="vp9"' },
        { codec: 'av01.0.05M.08', name: 'AV1', mime: 'video/mp4; codecs="av01.0.05M.08"' },
      ];

      for (const test of testCodecs) {
        const support = checkCodecSupport(test.mime);
        if (support.probably) {
          info.rawInfo!.supportedCodecs = info.rawInfo!.supportedCodecs || [];
          info.rawInfo!.supportedCodecs.push(test.name);
        }
      }

      if (info.rawInfo!.supportedCodecs?.length > 0) {
        this.log(`Codec supportati dal browser: ${info.rawInfo!.supportedCodecs.join(', ')}`);
      }
    }

    // Se abbiamo rilevato un codec, verifica il supporto
    if (info.videoCodecId) {
      const mimeType = `video/mp4; codecs="${info.videoCodecId}"`;
      const support = checkCodecSupport(mimeType);
      info.isSupported = support.supported;
      info.supportDetails = support.probably ? 'Supportato (probably)' : support.supported ? 'Supportato (maybe)' : 'Non supportato';
    } else if (info.videoCodec) {
      // Se il video sta funzionando, il codec è supportato
      if (video.readyState >= 2 && !video.error) {
        info.isSupported = true;
        info.supportDetails = 'In riproduzione (supportato)';
      }
    }

    return info;
  }

  /**
   * Analizza le informazioni da HLS.js - VERSIONE AVANZATA
   */
  analyzeHls(hls: any): Partial<StreamCodecInfo> {
    const info: Partial<StreamCodecInfo> = {
      rawInfo: {},
      detectionMethod: 'hls.js',
      confidence: 'medium',
    };

    try {
      // Livello corrente
      let currentLevel = hls.currentLevel;
      const levels = hls.levels;

      // Se currentLevel è -1, prova a usare il primo livello disponibile o loadLevel
      if (currentLevel < 0 && hls.loadLevel >= 0) {
        currentLevel = hls.loadLevel;
        this.log(`HLS currentLevel non disponibile, uso loadLevel: ${currentLevel}`);
      }
      if (currentLevel < 0 && levels && levels.length > 0) {
        currentLevel = 0;
        this.log(`HLS usando primo livello disponibile: ${currentLevel}`);
      }

      if (levels && currentLevel >= 0 && levels[currentLevel]) {
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

        // Codec video - prova più fonti
        let videoCodecStr = level.videoCodec;

        // Se non c'è nel level, prova nel level.attrs
        if (!videoCodecStr && level.attrs?.CODECS) {
          const codecs = level.attrs.CODECS.split(',');
          // Il primo codec è solitamente video
          videoCodecStr = codecs.find((c: string) =>
            c.startsWith('avc') || c.startsWith('hev') || c.startsWith('hvc') ||
            c.startsWith('vp9') || c.startsWith('av01')
          );
          if (videoCodecStr) {
            this.log(`Codec trovato in CODECS attr: ${videoCodecStr}`);
          }
        }

        // Prova anche da hls.media (video element) sourcebuffers
        if (!videoCodecStr && hls.media) {
          const mediaSource = (hls.media as any).mediaSource || (hls.media as HTMLVideoElement & { mozMediaSourceObject?: MediaSource }).mozMediaSourceObject;
          if (mediaSource && mediaSource.sourceBuffers) {
            for (let i = 0; i < mediaSource.sourceBuffers.length; i++) {
              const sb = mediaSource.sourceBuffers[i];
              if (sb.mimeType && sb.mimeType.includes('video')) {
                const match = sb.mimeType.match(/codecs="([^"]+)"/);
                if (match) {
                  videoCodecStr = match[1].split(',')[0];
                  this.log(`Codec trovato in SourceBuffer: ${videoCodecStr}`);
                  break;
                }
              }
            }
          }
        }

        if (videoCodecStr) {
          const parsed = parseCodecString(videoCodecStr);
          info.videoCodec = parsed.name;
          info.videoCodecId = videoCodecStr;
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
          const mimeType = `video/mp4; codecs="${videoCodecStr}"`;
          const support = checkCodecSupport(mimeType);
          info.isSupported = support.supported;
          info.supportDetails = support.probably ? 'Supportato (probably)' : support.supported ? 'Supportato (maybe)' : 'Non supportato';

          if (info.isHEVC) {
            this.log(`⚠️ HEVC/H.265 rilevato - Supporto: ${info.supportDetails}`, support.supported ? 'info' : 'warn');
          }
        } else {
          this.log('Video codec non disponibile nel manifest HLS', 'warn');
        }

        // Codec audio - prova più fonti
        let audioCodecStr = level.audioCodec;

        if (!audioCodecStr && level.attrs?.CODECS) {
          const codecs = level.attrs.CODECS.split(',');
          audioCodecStr = codecs.find((c: string) =>
            c.startsWith('mp4a') || c.startsWith('ac-3') || c.startsWith('ec-3') ||
            c.startsWith('opus') || c.startsWith('flac')
          );
        }

        if (audioCodecStr) {
          const parsed = parseCodecString(audioCodecStr);
          info.audioCodec = parsed.name;
          info.audioCodecId = audioCodecStr;
          this.log(`Audio Codec: ${parsed.name}`);
        }

        // Frame rate
        if (level.frameRate) {
          info.frameRate = level.frameRate;
          this.log(`Frame Rate: ${level.frameRate} fps`);
        }

        info.rawInfo!.hlsLevel = level;
      } else {
        this.log(`HLS: nessun livello disponibile (currentLevel: ${currentLevel}, levels: ${levels?.length || 0})`, 'warn');
      }

      // Numero di livelli disponibili
      if (levels && levels.length > 0) {
        this.log(`Livelli HLS disponibili: ${levels.length}`);
        levels.forEach((l: any, i: number) => {
          const res = l.width && l.height ? `${l.width}x${l.height}` : 'N/A';
          const br = l.bitrate ? `${(l.bitrate / 1000000).toFixed(2)} Mbps` : 'N/A';
          const codec = l.videoCodec || l.attrs?.CODECS || 'N/A';
          this.log(`  [${i}] ${res} @ ${br} - ${codec}${i === hls.currentLevel ? ' ← corrente' : ''}`);
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
   * Analizza direttamente lo stream URL scaricando i primi byte
   * Questo metodo tenta di rilevare il codec dai dati binari dello stream
   */
  async analyzeStreamDirectly(url: string): Promise<Partial<StreamCodecInfo>> {
    let info: Partial<StreamCodecInfo> = {
      rawInfo: {},
      detectionMethod: 'stream-analysis',
      confidence: 'low',
    };

    try {
      this.log(`Tentativo analisi diretta stream: ${url.substring(0, 80)}...`);

      // Fetch solo i primi 64KB per analisi header
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await proxyFetch(url, {
        method: 'GET',
        headers: {
          'Range': 'bytes=0-65535'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 206) {
        this.log(`Fetch fallito con status: ${response.status}`, 'warn');
        return info;
      }

      // Analizza Content-Type header
      const contentType = response.headers.get('Content-Type');
      if (contentType) {
        this.log(`Content-Type: ${contentType}`);
        info.rawInfo!.contentType = contentType;

        // Estrai codec se presente nel Content-Type
        const codecMatch = contentType.match(/codecs="([^"]+)"/);
        if (codecMatch) {
          const codecs = codecMatch[1].split(',').map(c => c.trim());
          for (const codecStr of codecs) {
            const parsed = parseCodecString(codecStr);
            if (contentType.includes('video') && !info.videoCodec) {
              info.videoCodec = parsed.name;
              info.videoCodecId = codecStr;
              info.videoProfile = parsed.profile || null;
              info.videoLevel = parsed.level || null;
              info.videoBitDepth = parsed.bitDepth || null;
              info.isH264 = parsed.id.startsWith('avc');
              info.isHEVC = parsed.id.startsWith('hev') || parsed.id.startsWith('hvc');
              info.isAV1 = parsed.id.startsWith('av0') || parsed.id === 'av1';
              info.isVP9 = parsed.id.startsWith('vp9') || parsed.id.startsWith('vp09');
              info.confidence = 'high';
              this.log(`✓ Video Codec (da Content-Type): ${parsed.name}`);
            }
            if (contentType.includes('audio') && !info.audioCodec) {
              info.audioCodec = parsed.name;
              info.audioCodecId = codecStr;
              info.confidence = 'high';
              this.log(`✓ Audio Codec (da Content-Type): ${parsed.name}`);
            }
          }
        }
      }

      // Leggi i primi byte per analisi binaria
      const data = new Uint8Array(await response.arrayBuffer());
      this.log(`Letti ${data.length} bytes per analisi`);

      const textHeader = new TextDecoder('utf-8', { fatal: false }).decode(data.slice(0, Math.min(data.length, 8192)));
      if (textHeader.includes('#EXTM3U')) {
        const manifestInfo = analyzeHlsManifestText(textHeader);
        info = { ...info, ...manifestInfo, rawInfo: { ...info.rawInfo, ...manifestInfo.rawInfo } };

        const firstReference = resolveHlsReference(url, textHeader);
        if (firstReference && !info.videoCodec) {
          this.log(`HLS: tentativo analisi primo riferimento media: ${firstReference.substring(0, 80)}...`);
          try {
            const nestedController = new AbortController();
            const nestedTimeoutId = setTimeout(() => nestedController.abort(), 8000);
            const nestedResponse = await proxyFetch(firstReference, { headers: { 'Range': 'bytes=0-65535' }, signal: nestedController.signal });
            clearTimeout(nestedTimeoutId);

            if (nestedResponse.ok || nestedResponse.status === 206) {
              const nestedData = new Uint8Array(await nestedResponse.arrayBuffer());
              const nestedText = new TextDecoder('utf-8', { fatal: false }).decode(nestedData.slice(0, Math.min(nestedData.length, 8192)));

              if (nestedText.includes('#EXTM3U')) {
                const nestedManifestInfo = analyzeHlsManifestText(nestedText);
                info = { ...info, ...nestedManifestInfo, rawInfo: { ...info.rawInfo, ...nestedManifestInfo.rawInfo } };
              } else {
                const nestedCodecInfo = analyzeVideoBytes(nestedData);
                if (nestedCodecInfo) {
                  info.videoCodec = info.videoCodec || nestedCodecInfo.codec || null;
                  info.videoCodecId = info.videoCodecId || nestedCodecInfo.codecId || null;
                  info.audioCodec = info.audioCodec || nestedCodecInfo.audioCodec || null;
                  info.audioCodecId = info.audioCodecId || nestedCodecInfo.audioCodecId || null;
                  if (nestedCodecInfo.codec || nestedCodecInfo.audioCodec) info.confidence = 'medium';
                }
              }
            }
          } catch (nestedError) {
            this.log(`Analisi riferimento HLS fallita: ${nestedError}`, 'warn');
          }
        }
      }

      // Analizza i byte per rilevare codec
      const codecFromBytes = analyzeVideoBytes(data);
      if (codecFromBytes && !info.videoCodec) {
        info.videoCodec = codecFromBytes.codec;
        info.videoCodecId = codecFromBytes.codecId || null;
        info.videoProfile = codecFromBytes.profile || null;
        info.videoLevel = codecFromBytes.level || null;
        info.videoBitDepth = codecFromBytes.bitDepth || null;

        if (codecFromBytes.codec?.includes('H.264')) {
          info.isH264 = true;
        } else if (codecFromBytes.codec?.includes('H.265') || codecFromBytes.codec?.includes('HEVC')) {
          info.isHEVC = true;
        } else if (codecFromBytes.codec?.includes('AV1')) {
          info.isAV1 = true;
        } else if (codecFromBytes.codec?.includes('VP9')) {
          info.isVP9 = true;
        }

        info.confidence = 'medium';
        this.log(`✓ Video Codec (da analisi binaria): ${codecFromBytes.codec}`);
        if (codecFromBytes.profile) this.log(`  Profilo: ${codecFromBytes.profile}`);
        if (codecFromBytes.level) this.log(`  Livello: ${codecFromBytes.level}`);
      }

      if (codecFromBytes?.audioCodec && !info.audioCodec) {
        info.audioCodec = codecFromBytes.audioCodec;
        info.audioCodecId = codecFromBytes.audioCodecId || null;
        this.log(`✓ Audio Codec (da analisi binaria): ${codecFromBytes.audioCodec}`);
      }

      // Rileva container dai magic bytes
      if (data.length >= 4) {
        // MP4/MOV: ftyp box
        if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
          info.container = 'MP4/MOV';
          this.log('Container rilevato: MP4/MOV (ftyp)');

          // Leggi il brand
          const brand = String.fromCharCode(data[8], data[9], data[10], data[11]);
          info.rawInfo!.ftypBrand = brand;
          this.log(`  Brand: ${brand}`);
        }
        // WebM/MKV: EBML header
        else if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
          info.container = 'Matroska/WebM';
          this.log('Container rilevato: Matroska/WebM (EBML)');
        }
        // MPEG-TS: sync byte
        else if (data[0] === 0x47 || (data.length >= 188 && data[188] === 0x47)) {
          info.container = 'MPEG-TS';
          info.protocol = 'MPEG-TS';
          this.log('Container rilevato: MPEG-TS (sync byte 0x47)');
        }
        // FLV
        else if (data[0] === 0x46 && data[1] === 0x4C && data[2] === 0x56) {
          info.container = 'FLV';
          this.log('Container rilevato: FLV');
        }
      }

    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.log('Analisi stream timeout', 'warn');
      } else {
        this.log(`Errore analisi stream: ${error.message}`, 'warn');
      }
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
   * Raccoglie tutte le informazioni disponibili - VERSIONE AVANZATA
   */
  collectInfo(
    video: HTMLVideoElement | null,
    hls: any | null,
    mpegts: any | null,
    url: string
  ): StreamCodecInfo {
    this.log('=== Inizio analisi stream avanzata ===');

    let info: StreamCodecInfo = {
      // Video
      videoCodec: null,
      videoCodecId: null,
      videoProfile: null,
      videoLevel: null,
      videoBitDepth: null,
      videoColorSpace: null,
      videoHDR: false,
      width: null,
      height: null,
      frameRate: null,
      bitrate: null,
      videoBitrate: null,

      // Audio
      audioCodec: null,
      audioCodecId: null,
      audioChannels: null,
      audioSampleRate: null,
      audioBitrate: null,
      audioLanguage: null,

      // Container
      container: null,
      protocol: null,
      mimeType: null,

      // Stato codec
      isHEVC: false,
      isH264: false,
      isAV1: false,
      isVP9: false,
      isVP8: false,
      isDolbyVision: false,
      isHDR10: false,
      isHLG: false,
      isSupported: true,
      hardwareAccelerated: false,
      powerEfficient: false,
      supportDetails: 'Sconosciuto',

      // Qualità playback
      droppedFrames: 0,
      totalFrames: 0,
      decodedFrames: 0,
      corruptedFrames: 0,
      frameDropRate: 0,

      // Network
      downloadSpeed: null,
      latency: null,

      // Meta
      rawInfo: {},
      detectionMethod: 'unknown',
      confidence: 'low',
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

    // Verifica Media Capabilities API per info hardware
    this.checkMediaCapabilitiesAsync(info);

    // Riepilogo finale
    this.log('=== Riepilogo Dettagliato ===');
    this.log(`Video: ${info.videoCodec || 'N/A'} ${info.width || '?'}x${info.height || '?'}`);
    if (info.videoProfile) this.log(`  Profilo: ${info.videoProfile}${info.videoLevel ? ` L${info.videoLevel}` : ''}`);
    if (info.videoBitDepth) this.log(`  Bit Depth: ${info.videoBitDepth}-bit`);
    if (info.videoHDR) this.log(`  HDR: Sì (${info.videoColorSpace || 'tipo sconosciuto'})`);
    if (info.frameRate) this.log(`  Frame Rate: ${info.frameRate} fps`);
    if (info.bitrate) this.log(`  Bitrate: ${(info.bitrate / 1000000).toFixed(2)} Mbps`);

    this.log(`Audio: ${info.audioCodec || 'N/A'}`);
    if (info.audioChannels) this.log(`  Canali: ${info.audioChannels}`);
    if (info.audioSampleRate) this.log(`  Sample Rate: ${info.audioSampleRate} Hz`);

    this.log(`Container: ${info.container || 'N/A'} | Protocollo: ${info.protocol || 'N/A'}`);
    this.log(`Metodo rilevamento: ${info.detectionMethod} (confidence: ${info.confidence})`);
    this.log(`Supporto: ${info.supportDetails}`);

    if (info.isHEVC && !info.isSupported) {
      this.log('⚠️ ATTENZIONE: Contenuto HEVC/H.265 non supportato dal browser!', 'warn');
    }
    if (info.isDolbyVision) {
      this.log('🎬 Dolby Vision rilevato - supporto limitato nei browser', 'warn');
    }
    if (info.videoHDR) {
      this.log('🌈 Contenuto HDR rilevato', 'info');
    }

    this.currentInfo = info;
    return info;
  }

  /**
   * Raccoglie tutte le informazioni disponibili - VERSIONE ASINCRONA
   * Include analisi diretta dello stream per rilevamento codec più affidabile
   */
  async collectInfoAsync(
    video: HTMLVideoElement | null,
    hls: any | null,
    mpegts: any | null,
    url: string
  ): Promise<StreamCodecInfo> {
    this.log('=== Inizio analisi stream avanzata (async) ===');

    // Prima raccoglie info sincrone
    let info = this.collectInfo(video, hls, mpegts, url);

    // Se non abbiamo rilevato il video codec, prova l'analisi diretta.
    // Per HLS leggiamo manifest/segmento iniziale; evitiamo invece file progressivi
    // perché il fetch parallelo può interferire con provider che limitano le connessioni.
    const lowerUrl = url.toLowerCase();
    const isProgressiveFile = lowerUrl.match(/\.(mkv|mp4|m4v|avi|webm|mov|flv)(\?|$)/);

    if (!info.videoCodec && url && !isProgressiveFile) {
      this.log('Codec non rilevato, tentativo analisi diretta stream...');
      try {
        const directInfo = await this.analyzeStreamDirectly(url);


        // Merge solo i campi non ancora popolati
        if (directInfo.videoCodec && !info.videoCodec) {
          info.videoCodec = directInfo.videoCodec;
          info.videoCodecId = directInfo.videoCodecId || null;
          info.videoProfile = directInfo.videoProfile || null;
          info.videoLevel = directInfo.videoLevel || null;
          info.videoBitDepth = directInfo.videoBitDepth || null;
          info.isH264 = directInfo.isH264 || false;
          info.isHEVC = directInfo.isHEVC || false;
          info.isAV1 = directInfo.isAV1 || false;
          info.isVP9 = directInfo.isVP9 || false;
          info.detectionMethod = directInfo.detectionMethod || info.detectionMethod;
          info.confidence = directInfo.confidence || info.confidence;
        }

        if (directInfo.audioCodec && !info.audioCodec) {
          info.audioCodec = directInfo.audioCodec;
          info.audioCodecId = directInfo.audioCodecId || null;
        }

        if (directInfo.container && !info.container) {
          info.container = directInfo.container;
        }

        info.rawInfo = { ...info.rawInfo, ...directInfo.rawInfo };
      } catch (error) {
        this.log(`Analisi diretta fallita: ${error}`, 'warn');
      }
    }

    // Verifica Media Capabilities
    await this.checkMediaCapabilitiesAsync(info);

    this.currentInfo = info;
    return info;
  }

  /**
   * Verifica async delle Media Capabilities
   */
  private async checkMediaCapabilitiesAsync(info: StreamCodecInfo): Promise<void> {
    if (!info.videoCodecId || !('mediaCapabilities' in navigator)) {
      return;
    }

    try {
      const result = await checkMediaCapabilities({
        videoCodec: info.videoCodecId,
        width: info.width || 1920,
        height: info.height || 1080,
        bitrate: info.bitrate || 5000000,
        framerate: info.frameRate || 30,
        audioCodec: info.audioCodecId || undefined,
        audioChannels: info.audioChannels || 2,
        audioSamplerate: info.audioSampleRate || 48000,
      });

      info.hardwareAccelerated = result.hardwareAccelerated;
      info.powerEfficient = result.powerEfficient;

      if (result.hardwareAccelerated) {
        this.log('✅ Decodifica hardware accelerata disponibile', 'info');
      } else if (result.supported) {
        this.log('⚠️ Decodifica solo software', 'warn');
      }

      if (result.smooth) {
        info.supportDetails = 'Supportato (smooth playback)';
      }
    } catch (error) {
      this.log(`Media Capabilities check failed: ${error}`, 'warn');
    }
  }

  /**
   * Ottiene le informazioni correnti
   */
  getCurrentInfo(): StreamCodecInfo | null {
    return this.currentInfo;
  }

  /**
   * Formatta le informazioni per la visualizzazione - VERSIONE ESTESA
   */
  formatInfoForDisplay(info: StreamCodecInfo): string[] {
    const lines: string[] = [];

    lines.push('═══ INFO STREAM DETTAGLIATE ═══');
    lines.push('');

    // Video
    lines.push('📹 VIDEO');
    if (info.videoCodec) {
      let codecLine = `   Codec: ${info.videoCodec}`;
      if (info.videoProfile) codecLine += ` (${info.videoProfile}`;
      if (info.videoLevel) codecLine += ` L${info.videoLevel}`;
      if (info.videoProfile) codecLine += ')';
      lines.push(codecLine);
    } else {
      lines.push('   Codec: Non rilevato');
    }
    if (info.videoCodecId) {
      lines.push(`   Codec ID: ${info.videoCodecId}`);
    }
    if (info.width && info.height) {
      // Aggiungi label risoluzione
      let resLabel = '';
      if (info.height >= 2160) resLabel = ' (4K UHD)';
      else if (info.height >= 1440) resLabel = ' (2K QHD)';
      else if (info.height >= 1080) resLabel = ' (Full HD)';
      else if (info.height >= 720) resLabel = ' (HD)';
      else if (info.height >= 480) resLabel = ' (SD)';
      lines.push(`   Risoluzione: ${info.width}×${info.height}${resLabel}`);
    }
    if (info.videoBitDepth) {
      lines.push(`   Bit Depth: ${info.videoBitDepth}-bit`);
    }
    if (info.videoHDR) {
      let hdrType = info.isDolbyVision ? 'Dolby Vision' :
                    info.isHDR10 ? 'HDR10' :
                    info.isHLG ? 'HLG' :
                    info.videoColorSpace || 'HDR';
      lines.push(`   HDR: ✓ ${hdrType}`);
    }
    if (info.frameRate) {
      lines.push(`   Frame Rate: ${info.frameRate.toFixed(2)} fps`);
    }
    if (info.bitrate || info.videoBitrate) {
      const br = info.videoBitrate || info.bitrate;
      lines.push(`   Bitrate: ${(br! / 1000000).toFixed(2)} Mbps`);
    }

    lines.push('');

    // Audio
    lines.push('🔊 AUDIO');
    if (info.audioCodec) {
      lines.push(`   Codec: ${info.audioCodec}`);
    } else {
      lines.push('   Codec: Non rilevato');
    }
    if (info.audioCodecId) {
      lines.push(`   Codec ID: ${info.audioCodecId}`);
    }
    if (info.audioChannels) {
      // Converti numero canali in formato leggibile
      let channelLabel: string;
      switch (info.audioChannels) {
        case 1: channelLabel = 'Mono'; break;
        case 2: channelLabel = 'Stereo (2.0)'; break;
        case 6: channelLabel = 'Surround 5.1'; break;
        case 8: channelLabel = 'Surround 7.1'; break;
        default: channelLabel = `${info.audioChannels} canali`;
      }
      lines.push(`   Canali: ${channelLabel}`);
    }
    if (info.audioSampleRate) {
      lines.push(`   Sample Rate: ${(info.audioSampleRate / 1000).toFixed(1)} kHz`);
    }
    if (info.audioBitrate) {
      lines.push(`   Bitrate: ${info.audioBitrate} kbps`);
    }
    if (info.audioLanguage) {
      lines.push(`   Lingua: ${info.audioLanguage}`);
    }

    lines.push('');

    // Container/Protocollo
    lines.push('📦 CONTAINER & PROTOCOLLO');
    if (info.container) {
      lines.push(`   Formato: ${info.container}`);
    }
    if (info.protocol) {
      lines.push(`   Protocollo: ${info.protocol}`);
    }
    if (info.mimeType) {
      lines.push(`   MIME Type: ${info.mimeType}`);
    }

    lines.push('');

    // Qualità Playback
    if (info.totalFrames > 0 || info.droppedFrames > 0) {
      lines.push('📊 QUALITÀ PLAYBACK');
      if (info.totalFrames > 0) {
        lines.push(`   Frame Totali: ${info.totalFrames.toLocaleString()}`);
      }
      if (info.decodedFrames > 0) {
        lines.push(`   Frame Decodificati: ${info.decodedFrames.toLocaleString()}`);
      }
      if (info.droppedFrames > 0) {
        const dropIcon = info.frameDropRate > 1 ? '⚠️' : '✓';
        lines.push(`   Frame Persi: ${info.droppedFrames} (${info.frameDropRate.toFixed(2)}%) ${dropIcon}`);
      }
      if (info.corruptedFrames > 0) {
        lines.push(`   Frame Corrotti: ${info.corruptedFrames} ⚠️`);
      }
      lines.push('');
    }

    // Supporto e Decodifica
    lines.push('✅ SUPPORTO & DECODIFICA');
    lines.push(`   Stato: ${info.supportDetails}`);
    if (info.hardwareAccelerated) {
      lines.push('   Decodifica HW: ✓ Attiva');
    } else if (info.isSupported) {
      lines.push('   Decodifica HW: ✗ Software');
    }
    if (info.powerEfficient) {
      lines.push('   Efficienza: ✓ Power Efficient');
    }
    lines.push(`   Metodo Rilevamento: ${info.detectionMethod}`);
    const confidenceLabel = info.confidence === 'high' ? 'ALTA' :
                           info.confidence === 'medium' ? 'MEDIA' :
                           info.confidence === 'low' ? 'BASSA' : 'NON RILEVATO';
    lines.push(`   Affidabilità: ${confidenceLabel}`);

    // Avvisi speciali
    const warnings: string[] = [];
    if (info.isHEVC && !info.isSupported) {
      warnings.push('⚠️ HEVC/H.265 non supportato dal browser');
    }
    if (info.isDolbyVision) {
      warnings.push('🎬 Dolby Vision - supporto browser limitato');
    }
    if (info.videoHDR && !info.isDolbyVision) {
      warnings.push('🌈 Contenuto HDR - richiede display compatibile');
    }
    if (info.frameDropRate > 5) {
      warnings.push('⚠️ Alto tasso di frame drop - possibili problemi');
    }
    if (info.videoBitDepth && info.videoBitDepth > 8 && !info.hardwareAccelerated) {
      warnings.push('⚠️ Video 10-bit senza accelerazione HW');
    }

    if (warnings.length > 0) {
      lines.push('');
      lines.push('⚠️ AVVISI');
      warnings.forEach(w => lines.push(`   ${w}`));
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

