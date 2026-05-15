
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
  /** Epoch ms quando lo stream è stato aggiunto al provider (Xtream `added`).
   *  Usato dal filtro "Nuovi" della ricerca globale (C.3). */
  addedAt?: number;
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

/**
 * Server Xtream salvato dentro un profilo. Estende le credenziali con un
 * id stabile e un nome amichevole, così l'utente può gestirne più di uno
 * per profilo (es. "Provider primario", "Backup"). Introdotto 2026-05-14.
 */
export interface XtreamServer extends XtreamCredentials {
  /** UUID stabile. */
  id: string;
  /** Nome scelto dall'utente (fallback all'host dell'url). */
  name: string;
  /** Timestamp di creazione. */
  createdAt?: number;
}

export interface XtreamContent {
  live: Category[];
  vod: Category[];
  series: Category[];
  /**
   * BUG-1 (§2.3 piano consolidato): stato di salute per blocco catalogo.
   * - `ok`     → la fetch ha prodotto contenuti validi (almeno 1 stream).
   * - `empty`  → server ha risposto OK ma con 0 stream (es. categoria VOD
   *              disabilitata sull'abbonamento). Non è un errore tecnico
   *              ma va segnalato all'utente.
   * - `error`  → fetch fallita (network/parse/formato non valido).
   * - `stale`  → blocco riusato dal precedente cache hit perché la nuova
   *              fetch è regredita (es. 0 VOD mentre prima ne avevamo 800).
   */
  health: {
    live: XtreamBlockHealth;
    vod: XtreamBlockHealth;
    series: XtreamBlockHealth;
    /** Timestamp dell'ultima fetch riuscita (per il blocco più recente). */
    fetchedAt: number;
  };
}

export interface XtreamBlockHealth {
  status: 'ok' | 'empty' | 'error' | 'stale';
  /** Motivo umanamente leggibile (es. "Provider error: ...", "Network timeout"). */
  reason?: string;
  /** Numero di stream "grezzi" ricevuti (prima dell'aggregazione in categorie). */
  itemCount?: number;
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
  /**
   * Per gli episodi di una serie TV, ID del "wrapper" serie corrispondente
   * (formato `series-{series_id}`) presente in `seriesCategories`. Permette
   * a "Continua a guardare" di tornare alla pagina della serie invece di
   * cercare lo stream del singolo episodio (che non è indicizzato nelle
   * liste `seriesCategories`).
   */
  parentSeriesId?: string;
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
   * Mostra la riga "Continua a guardare" per i Film. Default `false`:
   * molti utenti vedono i film una volta sola e non vogliono che restino
   * "in sospeso" se interrompono per qualche minuto.
   */
  continueWatchingMoviesEnabled?: boolean;
  /**
   * Mostra la riga "Continua a guardare" per le Serie TV. Default `true`:
   * il caso d'uso tipico (riprendere un episodio interrotto) ne giustifica
   * l'abilitazione automatica.
   */
  continueWatchingSeriesEnabled?: boolean;
  /**
   * Quando `true`, la notifica "AI non configurata" non viene più mostrata
   * (l'utente l'ha esplicitamente silenziata con la checkbox "Non mostrare
   * più"). Resettato a `false` solo dalla schermata Impostazioni.
   */
  hideAiUnavailableHint?: boolean;
  /**
   * Quando `true`, l'utente ha già visto (o esplicitamente dismissato) la
   * scheda scorciatoie al primo avvio profilo (C.1). L'overlay rimane
   * sempre richiamabile manualmente con `?` / `Shift+/`. Resettabile dalla
   * schermata Impostazioni per rivederla al prossimo avvio.
   */
  hasSeenShortcutsCheatsheet?: boolean;
  /**
   * Show a 10s "Up Next" countdown overlay during the last seconds of an
   * episode (Series only) and auto-play the next episode unless dismissed.
   * Default `true`.
   */
  autoNextEpisodeEnabled?: boolean;
  /**
   * C.6 (2026-05-15) — Accessibilità: scala del font dell'applicazione.
   * Mappata a `html { font-size: 14|16|18|20 px }`; tutte le size Tailwind
   * sono in `rem`, quindi l'intera UI scala in proporzione. Default `'md'`
   * (16 px). Persiste per profilo, applicata da `App.tsx` all'attivazione.
   */
  fontScale?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface Profile {
  id: string;
  name: string;
  color: string; // Hex color for avatar
  /**
   * ID dell'avatar dal catalogo `services/avatars.ts`. Opzionale per
   * retro-compatibilità con i profili creati prima del 2026-05-13: in
   * quel caso il render fa fallback a `DEFAULT_AVATAR_ID`.
   */
  avatar?: string;
  /**
   * Credenziali del server attivo. Mantenute per retro-compatibilità con
   * le installazioni single-server pre-2026-05-14. Quando l'utente apre
   * il gestore server e ne ha già almeno uno in `servers`, questo campo
   * specchia sempre le credenziali del server attivo.
   */
  xtreamCreds: XtreamCredentials | null;
  /**
   * Elenco dei server Xtream associati al profilo (multi-server, 2026-05-14).
   * Vuoto/undefined per profili nuovi senza connessione configurata.
   */
  servers?: XtreamServer[];
  /** ID del server attivo (deve esistere in `servers`). */
  activeServerId?: string;
  /**
   * URL di una playlist M3U remota (alternativa a Xtream Codes, C.2).
   * Quando presente e `xtreamCreds` è null, `App.tsx` scarica e fa parse
   * della playlist via `parseM3UAsync` (worker se >256kB) per popolare la
   * sezione Live. Le sezioni Movies/Series restano vuote in modalità M3U
   * pura (le playlist M3U classiche non distinguono i tipi).
   */
  playlistUrl?: string;
  history: WatchHistoryItem[];
  watchlist: string[];
  preferences?: ProfilePreferences;
}
