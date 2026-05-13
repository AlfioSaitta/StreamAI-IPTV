
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
  /** EPG channel identifier (from M3U `tvg-id` or Xtream `epg_channel_id`). */
  tvgId?: string;
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
 * A single EPG programme entry (parsed from XMLTV).
 * Times are epoch milliseconds (UTC) so the UI can do plain arithmetic
 * regardless of provider timezone.
 */
export interface EpgProgramme {
  /** Channel id matching `Channel.tvgId` (XMLTV `<programme channel=...>`). */
  channelId: string;
  /** Start time, epoch ms UTC. */
  start: number;
  /** End time, epoch ms UTC. */
  stop: number;
  /** Programme title (already entity-decoded). */
  title: string;
  /** Optional long description. */
  description?: string;
  /** Optional category/genre. */
  category?: string;
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
  /**
   * Progress fraction (0..1) at which a title is considered fully watched
   * and dropped from the "Continue Watching" row. Bounded to [0.7, 0.99]
   * in the UI; default 0.95.
   */
  continueWatchingCompletedThreshold?: number;
  /**
   * Show a 10s "Up Next" countdown overlay during the last seconds of an
   * episode (Series only) and auto-play the next episode unless dismissed.
   * Default `true`.
   */
  autoNextEpisodeEnabled?: boolean;
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
