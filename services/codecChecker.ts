/**
 * Servizio per verificare la disponibilità dei codec video
 * Controlla HEVC/H.265, AV1, VP9 e altri codec
 */

export interface CodecSupport {
  hevc: boolean;
  h264: boolean;
  av1: boolean;
  vp9: boolean;
  vp8: boolean;
  aac: boolean;
  opus: boolean;
}

export interface CodecCheckResult {
  supported: CodecSupport;
  hardwareAcceleration: boolean;
  recommendations: string[];
}

// Lista dei MIME types per ogni codec
const CODEC_TESTS = {
  // HEVC/H.265 - vari profili
  hevc: [
    'video/mp4; codecs="hev1.1.6.L93.B0"',
    'video/mp4; codecs="hvc1.1.6.L93.B0"',
    'video/mp4; codecs="hev1.1.6.L120.90"',
    'video/mp4; codecs="hvc1.1.6.L120.90"',
    'video/mp4; codecs="hev1"',
    'video/mp4; codecs="hvc1"',
  ],
  // H.264/AVC
  h264: [
    'video/mp4; codecs="avc1.42E01E"',
    'video/mp4; codecs="avc1.4D401E"',
    'video/mp4; codecs="avc1.64001E"',
    'video/mp4; codecs="avc1.640028"',
  ],
  // AV1
  av1: [
    'video/mp4; codecs="av01.0.00M.08"',
    'video/webm; codecs="av01.0.00M.08"',
  ],
  // VP9
  vp9: [
    'video/webm; codecs="vp9"',
    'video/webm; codecs="vp09.00.10.08"',
  ],
  // VP8
  vp8: [
    'video/webm; codecs="vp8"',
  ],
  // AAC Audio
  aac: [
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/aac',
  ],
  // Opus Audio
  opus: [
    'audio/webm; codecs="opus"',
    'audio/ogg; codecs="opus"',
  ],
};

/**
 * Verifica se un codec è supportato
 */
const checkCodec = (mimeTypes: string[]): boolean => {
  const video = document.createElement('video');
  return mimeTypes.some(mime => {
    const result = video.canPlayType(mime);
    return result === 'probably' || result === 'maybe';
  });
};

/**
 * Verifica se l'accelerazione hardware è disponibile
 */
const checkHardwareAcceleration = async (): Promise<boolean> => {
  try {
    // Usa WebGL per verificare se c'è una GPU disponibile
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return false;

    const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      // Se c'è un renderer GPU (non software), probabilmente c'è accelerazione hardware
      return !renderer.toLowerCase().includes('swiftshader') &&
             !renderer.toLowerCase().includes('llvmpipe') &&
             !renderer.toLowerCase().includes('software');
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Genera raccomandazioni basate sul supporto codec
 */
const generateRecommendations = (support: CodecSupport, isLinux: boolean, isWindows: boolean, isMac: boolean): string[] => {
  const recommendations: string[] = [];

  if (!support.hevc) {
    if (isLinux) {
      recommendations.push(
        'Per abilitare HEVC su Linux, installa i codec GStreamer:',
        '• Ubuntu/Debian: sudo apt install gstreamer1.0-libav gstreamer1.0-plugins-bad ubuntu-restricted-extras',
        '• Fedora: sudo dnf install gstreamer1-libav gstreamer1-plugins-bad-freeworld',
        '• Arch: sudo pacman -S gst-libav gst-plugins-bad'
      );
    } else if (isWindows) {
      recommendations.push(
        'Per abilitare HEVC su Windows:',
        '• Installa "HEVC Video Extensions" dal Microsoft Store',
        '• Oppure cerca "HEVC Video Extensions from Device Manufacturer" (gratuito)'
      );
    } else if (isMac) {
      recommendations.push(
        'HEVC dovrebbe essere supportato nativamente su macOS.',
        'Assicurati di avere macOS 10.13 o superiore.'
      );
    }
  }

  if (!support.av1) {
    recommendations.push(
      'AV1 non è supportato. Per contenuti AV1, aggiorna il browser/Electron.'
    );
  }

  return recommendations;
};

/**
 * Rileva il sistema operativo
 */
const detectOS = (): { isLinux: boolean; isWindows: boolean; isMac: boolean } => {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  return {
    isLinux: platform.includes('linux') || userAgent.includes('linux'),
    isWindows: platform.includes('win') || userAgent.includes('windows'),
    isMac: platform.includes('mac') || userAgent.includes('macintosh'),
  };
};

/**
 * Esegue il controllo completo dei codec
 */
export const checkCodecSupport = async (): Promise<CodecCheckResult> => {
  const supported: CodecSupport = {
    hevc: checkCodec(CODEC_TESTS.hevc),
    h264: checkCodec(CODEC_TESTS.h264),
    av1: checkCodec(CODEC_TESTS.av1),
    vp9: checkCodec(CODEC_TESTS.vp9),
    vp8: checkCodec(CODEC_TESTS.vp8),
    aac: checkCodec(CODEC_TESTS.aac),
    opus: checkCodec(CODEC_TESTS.opus),
  };

  const hardwareAcceleration = await checkHardwareAcceleration();
  const { isLinux, isWindows, isMac } = detectOS();
  const recommendations = generateRecommendations(supported, isLinux, isWindows, isMac);

  // Log per debug
  console.log('[CodecChecker] Supporto codec:', supported);
  console.log('[CodecChecker] Accelerazione HW:', hardwareAcceleration);
  if (recommendations.length > 0) {
    console.log('[CodecChecker] Raccomandazioni:', recommendations);
  }

  return {
    supported,
    hardwareAcceleration,
    recommendations,
  };
};

/**
 * Verifica rapida solo per HEVC
 */
export const isHEVCSupported = (): boolean => {
  return checkCodec(CODEC_TESTS.hevc);
};

/**
 * Ottiene una stringa leggibile del supporto codec
 */
export const getCodecSupportSummary = (result: CodecCheckResult): string => {
  const { supported } = result;
  const parts: string[] = [];

  parts.push(`H.264: ${supported.h264 ? '✓' : '✗'}`);
  parts.push(`HEVC: ${supported.hevc ? '✓' : '✗'}`);
  parts.push(`AV1: ${supported.av1 ? '✓' : '✗'}`);
  parts.push(`VP9: ${supported.vp9 ? '✓' : '✗'}`);
  parts.push(`HW Accel: ${result.hardwareAcceleration ? '✓' : '✗'}`);

  return parts.join(' | ');
};

