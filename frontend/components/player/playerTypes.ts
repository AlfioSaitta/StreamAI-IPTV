// Type definitions shared between the VideoPlayer component and its hooks/utils.
// Extracted from components/VideoPlayerNew.tsx during refactor B.1.

import type { ReactNode } from 'react';

export type PlayerEngine = 'videojs' | 'hlsjs' | 'mpegts' | 'native' | 'mpv';
export type StreamProtocol = 'hls' | 'mpegts' | 'dash' | 'mp4' | 'webm' | 'mkv' | 'unknown';

export interface StreamSourceInfo {
  protocol: StreamProtocol;
  mimeType: string;
  engine: PlayerEngine;
  isXtreamLike: boolean;
  isExtensionless: boolean;
  isLive: boolean;
  label: string;
}

export interface PlaybackErrorState {
  title: string;
  message: string;
  category: 'network' | 'decode' | 'unsupported' | 'timeout' | 'native' | 'unknown';
  canRetry: boolean;
  retryCount: number;
  technicalDetails: string[];
}

export interface OsdState {
  icon: ReactNode;
  text?: string;
  visible: boolean;
}

export const MAX_PLAYBACK_RETRIES = 2;

