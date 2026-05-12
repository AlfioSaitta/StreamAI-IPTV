// Barrel exports for the streamInfo modular helpers (refactor B.2).
export type { StreamCodecInfo } from './types';
export { CODEC_MAP, H264_PROFILES, HEVC_PROFILES, AV1_PROFILES } from './codecMap';
export {
  type ParsedCodec,
  parseCodecString,
  checkCodecSupport,
  parseCodecList,
  checkMediaCapabilities,
} from './codecParser';
export { analyzeHlsManifestText, resolveHlsReference } from './hlsParser';
export {
  type MpegTsStreamMapping,
  type MpegTsProgramMapResult,
  isLikelyMpegTs,
  mapMpegTsStreamType,
  analyzeMpegTsProgramMap,
} from './mpegtsProbe';
export { type VideoByteAnalysis, analyzeVideoBytes } from './videoBytesAnalyzer';

