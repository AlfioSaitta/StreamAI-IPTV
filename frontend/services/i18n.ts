// Internationalization (i18n) service for StreamAI-IPTV
//
// B.3 — Lazy locale loading:
// Only the default language ('it') is statically imported and ships with the
// initial bundle. All other languages are loaded on-demand via dynamic
// import() the first time they are activated, then cached in `cache`.
// This keeps the main chunk small (~40 kB raw saved at first paint).

import it from './locales/it';

export type SupportedLanguage = 'it' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'ja' | 'ko' | 'zh' | 'ar';

export interface Translations {
  // Common
  back: string;
  save: string;
  cancel: string;
  delete: string;
  close: string;
  loading: string;
  search: string;
  settings: string;
  logout: string;

  // Profile Selection
  whoIsWatching: string;
  newProfile: string;
  addProfile: string;
  profileName: string;
  create: string;
  deleteProfile: string;

  // Channel List / Navigation
  home: string;
  live: string;
  movies: string;
  series: string;
  continueWatching: string;
  myList: string;
  recommended: string;
  recentlyAdded: string;
  popular: string;
  searchPlaceholder: string;
  noResults: string;
  refreshCache: string;

  // Video Player
  play: string;
  pause: string;
  resume: string;
  restart: string;
  nextEpisode: string;
  previousEpisode: string;
  fullscreen: string;
  exitFullscreen: string;
  mute: string;
  unmute: string;
  cast: string;
  castConnected: string;
  castDisconnected: string;
  casting: string;
  castTo: string;
  chromecast: string;
  chromecastDesc: string;
  airplay: string;
  airplayDesc: string;
  externalPlayer: string;
  externalPlayerDesc: string;
  shareLink: string;
  shareLinkDesc: string;
  copyUrl: string;
  copyUrlDesc: string;
  urlCopied: string;

  // Movie/Series Details
  watchNow: string;
  addToList: string;
  removeFromList: string;
  moreInfo: string;
  castActors: string;
  director: string;
  genre: string;
  year: string;
  rating: string;
  duration: string;
  seasons: string;
  episodes: string;
  similarContent: string;

  // Profile Settings
  profileSettings: string;
  profile: string;
  languageAndSubtitles: string;
  contentLanguage: string;
  contentLanguageDesc: string;
  subtitleLanguage: string;
  subtitleLanguageDesc: string;
  playback: string;
  aiSettings?: string;
  aiCaching?: string;
  aiCachingDesc?: string;
  geminiApiKey?: string;
  geminiApiKeyDesc?: string;
  getApiKeyLink?: string;
  debugOverlay?: string;
  debugOverlayDesc?: string;
  appearance?: string;
  themeInterface?: string;
  themeInterfaceDesc?: string;
  clearCache?: string;
  clearCacheDesc?: string;
  cacheCleared?: string;
  saveChanges: string;

  // Quality Options
  videoQuality?: string;
  videoQualityDesc?: string;
  autoPlay?: string;
  autoPlayDesc?: string;
  skipIntro?: string;
  skipIntroDesc?: string;
  parentalControls?: string;
  matureContent?: string;
  matureContentDesc?: string;
  qualityAuto: string;
  quality4k: string;
  quality1080p: string;
  quality720p: string;
  quality480p: string;

  // Server / Login
  connectServer: string;
  serverUrl: string;
  username: string;
  password: string;
  connect: string;
  welcome: string;
  welcomeDesc: string;

  // AI Recommender
  aiRecommendations: string;
  askAI: string;
  aiPlaceholder: string;

  // Misc
  activeProfile: string;
  loadingLibrary: string;
}

/** Map of dynamic loaders for non-default languages. */
const loaders: Record<Exclude<SupportedLanguage, 'it'>, () => Promise<{ default: Translations }>> = {
  en: () => import('./locales/en'),
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  pt: () => import('./locales/pt'),
  ru: () => import('./locales/ru'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  zh: () => import('./locales/zh'),
  ar: () => import('./locales/ar'),
};

/** Already-resolved dictionaries (in-memory cache). */
const cache = new Map<SupportedLanguage, Translations>();
cache.set('it', it);

/** In-flight promises (request coalescing). */
const inFlight = new Map<SupportedLanguage, Promise<Translations>>();

let currentLanguage: SupportedLanguage = 'it';

/** Typed tuple of supported language codes. */
export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  'it', 'en', 'es', 'fr', 'de', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar',
] as const;

function isSupportedLang(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

/**
 * Load (or return cached) translations for the given language. Falls back
 * to Italian if the language is unknown or the dynamic import fails.
 */
export async function loadLanguage(lang: string): Promise<Translations> {
  if (!isSupportedLang(lang)) return it;
  const cached = cache.get(lang);
  if (cached) return cached;
  const pending = inFlight.get(lang);
  if (pending) return pending;
  if (lang === 'it') return it;
  const loader = loaders[lang as Exclude<SupportedLanguage, 'it'>];
  if (!loader) return it;
  const promise = loader()
    .then((mod) => {
      const dict = mod.default;
      cache.set(lang, dict);
      inFlight.delete(lang);
      return dict;
    })
    .catch((err) => {
      console.warn(`[i18n] failed to load locale '${lang}', falling back to 'it'`, err);
      inFlight.delete(lang);
      return it;
    });
  inFlight.set(lang, promise);
  return promise;
}

export const i18n = {
  /**
   * Set the current language. Triggers lazy load if not yet cached.
   * Returns the resolved dictionary for convenience.
   */
  setLanguage: async (lang: string): Promise<Translations> => {
    if (!isSupportedLang(lang)) {
      currentLanguage = 'en';
    } else {
      currentLanguage = lang;
    }
    return loadLanguage(currentLanguage);
  },

  /** Synchronous variant: changes the current language code and fires preload. */
  setLanguageSync: (lang: string): void => {
    currentLanguage = isSupportedLang(lang) ? lang : 'en';
    void loadLanguage(currentLanguage);
  },

  /** Get the current language code. */
  getLanguage: (): SupportedLanguage => currentLanguage,

  /**
   * Get the translations dictionary for the current language. Falls back
   * to the Italian default while a lazy locale is still loading.
   */
  t: (): Translations => cache.get(currentLanguage) ?? it,

  /** Get a specific translation key for the current language. */
  get: (key: keyof Translations): string => {
    const dict = cache.get(currentLanguage);
    return (dict?.[key] as string | undefined) ?? it[key] ?? String(key);
  },

  /**
   * Get translations for a specific language (cached only). Use
   * `loadLanguage()` if you need to await the dynamic import.
   */
  forLanguage: (lang: string): Translations => {
    if (!isSupportedLang(lang)) return it;
    return cache.get(lang) ?? it;
  },

  isSupported: (lang: string): boolean => isSupportedLang(lang),
  getSupportedLanguages: (): SupportedLanguage[] => [...SUPPORTED_LANGUAGES],
  isLoaded: (lang: string): boolean => isSupportedLang(lang) && cache.has(lang),
  preload: (lang: string): Promise<Translations> => loadLanguage(lang),
};

export default i18n;

