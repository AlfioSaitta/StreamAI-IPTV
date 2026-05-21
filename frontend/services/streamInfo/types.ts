// StreamCodecInfo shared type. Extracted from services/streamInfoService.ts during refactor B.2.
// Re-exported from the main service for backward compatibility.

export interface StreamCodecInfo {
  // Video
  videoCodec: string | null;
  videoCodecId: string | null;
  videoProfile: string | null;
  videoLevel: string | null;
  videoBitDepth: number | null;
  videoColorSpace: string | null;
  videoHDR: boolean;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  bitrate: number | null;
  videoBitrate: number | null;

  // Audio
  audioCodec: string | null;
  audioCodecId: string | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  audioBitrate: number | null;
  audioLanguage: string | null;

  // Container
  container: string | null;
  protocol: string | null;
  mimeType: string | null;

  // Stato
  isHEVC: boolean;
  isH264: boolean;
  isAV1: boolean;
  isVP9: boolean;
  isVP8: boolean;
  isDolbyVision: boolean;
  isHDR10: boolean;
  isHLG: boolean;
  isSupported: boolean;
  hardwareAccelerated: boolean;
  powerEfficient: boolean;
  supportDetails: string;

  // Qualità playback
  droppedFrames: number;
  totalFrames: number;
  decodedFrames: number;
  corruptedFrames: number;
  frameDropRate: number;

  // Network stats
  downloadSpeed: number | null;
  latency: number | null;

  // Raw data
  rawInfo: Record<string, any>;
  detectionMethod: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

