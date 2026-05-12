
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
  nameLower?: string;
  cleanNameLower?: string;
  groupLower?: string;
  genreLower?: string;
  haystack?: string;
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

/**
 * Snapshot of the Xtream `user_info` block returned by `player_api.php`.
 * All numeric fields arrive as strings from the API.
 */
export interface XtreamAccountInfo {
  username?: string;
  /** Account status string, e.g. "Active" / "Banned" / "Expired". */
  status?: string;
  /** `auth === 1` means the credentials are valid. */
  auth?: number;
  /** UNIX seconds (string) when the account expires; `null` for unlimited. */
  expDate?: string | null;
  isTrial?: string;
  /** Currently active connections (concurrent streams). */
  activeConnections?: number;
  /** Maximum allowed concurrent connections. */
  maxConnections?: number;
  createdAt?: string;
  /** Allowed output formats (m3u8, ts, rtmp, ...). */
  allowedOutputFormats?: string[];
  /** Local timestamp of the last successful health check. */
  fetchedAt: number;
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
  aiCaching: boolean; // Enable/Disable Gemini Response Caching
  debugOverlay: boolean; // Show network speed and debug info in player
  theme?: 'dark' | 'oled';
  geminiApiKey?: string; // Custom API Key provided by user
  contentAutoRefreshEnabled?: boolean; // Refresh Xtream catalog in background
  contentAutoRefreshIntervalMinutes?: number; // Background refresh interval in minutes
  contentLastRefreshAt?: number; // Last successful forced catalog refresh timestamp
  contentLastRefreshError?: string; // Last background/manual refresh error, if any
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
