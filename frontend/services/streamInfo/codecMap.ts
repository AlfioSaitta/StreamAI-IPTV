// Codec ID → human readable name maps + per-codec profile lookup tables.
// Pure data. Extracted from services/streamInfoService.ts during refactor B.2.

export const CODEC_MAP: Record<string, string> = {
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

  // Dolby Vision
  'dvh1': 'Dolby Vision (HEVC)',
  'dvhe': 'Dolby Vision (HEVC)',
  'dva1': 'Dolby Vision (AVC)',
  'dvav': 'Dolby Vision (AVC)',

  // AV1
  'av01': 'AV1',
  'av1': 'AV1',

  // VP9 / VP8
  'vp09': 'VP9',
  'vp9': 'VP9',
  'vp08': 'VP8',
  'vp8': 'VP8',

  // MPEG-2 / MPEG-4 Part 2
  'mp2v': 'MPEG-2 Video',
  'mpeg2': 'MPEG-2 Video',
  'mp4v': 'MPEG-4 Part 2',

  // Audio
  'mp4a': 'AAC',
  'aac': 'AAC',
  'mp3': 'MP3',
  'opus': 'Opus',
  'vorbis': 'Vorbis',
  'ac-3': 'AC-3 (Dolby Digital)',
  'ac3': 'AC-3 (Dolby Digital)',
  'ec-3': 'E-AC-3 (Dolby Digital Plus)',
  'ec3': 'E-AC-3 (Dolby Digital Plus)',
  'dtsc': 'DTS',
  'dtsh': 'DTS-HD',
  'dtse': 'DTS Express',
  'dtsl': 'DTS-HD Lossless',
  'mlpa': 'Dolby TrueHD',
  'flac': 'FLAC',
  'alac': 'ALAC (Apple Lossless)',
  'pcm': 'PCM',
  'lpcm': 'LPCM',
};

export const H264_PROFILES: Record<number, string> = {
  66: 'Baseline',
  77: 'Main',
  88: 'Extended',
  100: 'High',
  110: 'High 10',
  122: 'High 4:2:2',
  244: 'High 4:4:4 Predictive',
  44: 'CAVLC 4:4:4 Intra',
  83: 'Scalable Baseline',
  86: 'Scalable High',
  118: 'Multiview High',
  128: 'Stereo High',
  138: 'MFC High',
  139: 'MFC Depth High',
  134: 'Enhanced Multiview Depth High',
};

export const HEVC_PROFILES: Record<number, string> = {
  1: 'Main',
  2: 'Main 10',
  3: 'Main Still Picture',
  4: 'Range Extensions',
  5: 'High Throughput',
  6: 'Multiview Main',
  7: 'Scalable Main',
  8: 'Scalable Main 10',
  9: '3D Main',
  10: 'Screen-Extended Main',
  11: 'Screen-Extended Main 10',
  12: 'Screen-Extended Main 4:4:4',
  13: 'Screen-Extended Main 4:4:4 10',
};

export const AV1_PROFILES: Record<number, string> = {
  0: 'Main',
  1: 'High',
  2: 'Professional',
};

