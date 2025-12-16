
export type StreamType = 'home' | 'live' | 'movie' | 'series';

export interface Channel {
  id: string;
  name: string;
  cleanName?: string; // Sanitized name for AI/TMDB (e.g., "The Matrix" instead of "UK: The Matrix [FHD]")
  logo?: string;
  group?: string;
  url: string;
  type?: StreamType;
  seriesId?: number; // Optional: specific for series linking
  description?: string;
  rating?: string;
  year?: string;
  genre?: string;
  cast?: string;
  director?: string;
  tmdbId?: number; // Store TMDB ID if found
}

export interface Category {
  name: string;
  channels: Channel[];
}

export interface Recommendation {
  channelName: string;
  reason: string;
}

export interface XtreamCredentials {
  url: string;
  username: string;
  password: string;
}

export interface XtreamContent {
  live: Category[];
  vod: Category[];
  series: Category[];
}

export interface WatchHistoryItem {
  channelId: string;
  name: string;
  timestamp: number;
  type: StreamType;
  progress?: number; // 0.0 to 1.0 representing percentage watched
  duration?: number; // Saved duration in seconds
}

export interface ProfilePreferences {
  language: string; // ISO 639-1 code (e.g., 'it', 'en', 'es')
  subtitleLanguage: string; // Preferred subtitle language
  autoPlayNext: boolean; // Auto-play next episode/video
  defaultQuality: 'auto' | '4k' | '1080p' | '720p' | '480p';
  matureContent: boolean; // Allow mature content
  skipIntro: boolean; // Auto-skip intro
}

export interface Profile {
  id: string;
  name: string;
  color: string; // Hex color for avatar
  xtreamCreds: XtreamCredentials | null;
  history: WatchHistoryItem[];
  watchlist: string[];
  preferences?: ProfilePreferences;
}
