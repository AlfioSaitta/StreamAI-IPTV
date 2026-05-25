import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import ChannelList from './components/ChannelList.tsx';
import ProfileSelection from './components/ProfileSelection.tsx';
import CodecWarning from './components/CodecWarning.tsx';
import EmptyState from './components/shared/EmptyState.tsx';
import ShortcutsCheatsheet from './components/ShortcutsCheatsheet.tsx';
import CommandPalette from './components/CommandPalette.tsx';

// E.1 — Heavy components are code-split via React.lazy so the initial chunk
// stays lean. video.js + hls.js + mpegts.js (~600 kB minified) live entirely
// inside VideoPlayer's async chunk and only download when the user starts
// playback. Same idea for the optional AI assistant and detail screens.
const VideoPlayer = lazy(() => import('./components/VideoPlayerNew.tsx'));
const AIRecommender = lazy(() => import('./components/AIRecommender.tsx'));
const XtreamLogin = lazy(() => import('./components/XtreamLogin.tsx'));
const ServerManager = lazy(() => import('./components/ServerManager.tsx'));
// XtreamLogin resta importato lazy come fallback per workflow legacy/tests:
// l'attuale UI passa sempre da ServerManager.
void XtreamLogin;
const SeriesDetail = lazy(() => import('./components/SeriesDetail.tsx'));
const MovieDetail = lazy(() => import('./components/MovieDetail.tsx'));
const ProfileSettings = lazy(() => import('./components/ProfileSettings.tsx'));
const GuideView = lazy(() => import('./components/GuideView.tsx'));

// UI-1.5 — Galleria DS dev-only. Si attiva con `?ds-preview` in URL, oppure
// impostando `window.__SHOW_DS_PREVIEW = true` da DevTools. Non viene caricata
// nel chunk principale.
const DesignSystemPreview = lazy(() => import('./components/DesignSystemPreview.tsx'));
const NativeMpvSmokeTest = lazy(() => import('./components/NativeMpvSmokeTest.tsx'));

const shouldShowDsPreview = (): boolean => {
  if (typeof window === 'undefined') return false;
  if ((window as unknown as { __SHOW_DS_PREVIEW?: boolean }).__SHOW_DS_PREVIEW) return true;
  try {
    return new URLSearchParams(window.location.search).has('ds-preview');
  } catch {
    return false;
  }
};

// Fase 6.1 Stage A — Smoke test del player nativo libmpv. Attivabile con
// `?nativeMpv=1` in URL (es. devtools → location.search += '&nativeMpv=1').
// È un harness isolato che bypassa il player principale per verificare
// la pipeline `RenderFrame` → `/player/frame` → canvas 2D senza rischio
// di rompere `VideoPlayerNew.tsx`. Vedi `components/NativeMpvSmokeTest.tsx`.
const shouldShowNativeMpvSmoke = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).has('nativeMpv');
  } catch {
    return false;
  }
};

const PlayerLoadingFallback = () => (
  <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="w-12 h-12 border-4 border-red-600/20 border-t-red-600 rounded-full animate-spin" />
      <p className="text-gray-400 text-sm">Caricamento player…</p>
    </div>
  </div>
);

const RouteLoadingFallback = () => (
  <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
    <div className="w-10 h-10 border-4 border-red-600/20 border-t-red-600 rounded-full animate-spin" />
  </div>
);
import { LanguageProvider } from './contexts/LanguageContext.tsx';
import { loginXtream } from './services/xtream.ts';
import { ProfileService, DEFAULT_PREFERENCES } from './services/profileService.ts';
import { CacheService } from './services/cacheService.ts';
import { i18n } from './services/i18n.ts';
import { Category, Channel, XtreamCredentials, StreamType, Profile, XtreamContent, ProfilePreferences } from './types.ts';
import { Server, Wifi, Sparkles, X } from 'lucide-react';
import { platformService } from './services/platformService.ts';
import { host } from './services/hostBridge.ts';
import { MigrationService } from './services/migrationService.ts';
import { hasAiApiKey, isAiAvailable, isAiTemporarilySuspended } from './services/geminiService.ts';
import { EpgReminderService, type ReminderFiredEvent } from './services/epg/reminderService.ts';
import { useBackStack } from './hooks/useBackStack.ts';
import { useTrayBridge } from './hooks/useTrayBridge.ts';

const MIN_CONTENT_REFRESH_INTERVAL_MINUTES = 60;

interface ContentRefreshStatus {
  state: 'idle' | 'refreshing' | 'success' | 'error';
  message?: string;
  updatedAt?: number;
}

// Componente per visualizzare lo stato di riproduzione in rete
const NetworkStatusBanner = () => {
  const [networkStatus, setNetworkStatus] = useState<{ deviceId: string; channelName: string } | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    // Fase 7.2: usa il bridge host (Electron o Wails). I componenti UI non
    // devono più toccare `window.electronAPI` direttamente.
    if (platformService.isDesktop && host?.onNetworkPlaybackStatus) {
      const unsubscribe = host.onNetworkPlaybackStatus((status: { deviceId: string; channelName: string }) => {
        setNetworkStatus(status);
        
        // Nascondi il banner dopo 10 secondi
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = window.setTimeout(() => {
          setNetworkStatus(null);
        }, 10000);
      });

      return () => {
        unsubscribe();
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, []);

  if (!networkStatus) return null;

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800/90 backdrop-blur-md text-white p-4 rounded-xl shadow-2xl flex items-center gap-4 z-[200] animate-fade-in">
      <Wifi className="w-6 h-6 text-blue-400" />
      <div>
        <p className="text-sm text-gray-300">In riproduzione su <span className="font-bold text-white">{networkStatus.deviceId}</span></p>
        <p className="font-semibold truncate max-w-xs">{networkStatus.channelName}</p>
      </div>
    </div>
  );
};

const AiUnavailableHint = ({
  hasKey,
  isSuspended,
  onOpenSettings,
  onDismiss,
  onDontShowAgain,
}: {
  hasKey: boolean;
  isSuspended: boolean;
  onOpenSettings: () => void;
  onDismiss: () => void;
  onDontShowAgain: () => void;
}) => {
  const message = isSuspended
    ? 'AI sospesa temporaneamente dopo errori o quota esaurita. Riproverà automaticamente più tardi.'
    : 'Gemini non configurato. Aggiungi una chiave API nelle impostazioni profilo per abilitare i consigli AI.';

  // FIX 2026-05-15: auto-dismiss dopo 8s + checkbox "Non mostrare più".
  // L'hint resta sempre dismissibile manualmente. La preferenza
  // `hideAiUnavailableHint` lo silenzia permanentemente per il profilo.
  const [dontShow, setDontShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => {
      if (dontShow) onDontShowAgain();
      else onDismiss();
    }, 8000);
    return () => clearTimeout(id);
    // `dontShow` letto al fire del timer: deps minime per evitare reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    if (dontShow) onDontShowAgain();
    else onDismiss();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-40 w-[calc(100vw-2rem)] max-w-sm rounded-modal border border-DEFAULT bg-surface-1/95 p-4 text-content-secondary shadow-elev-3 backdrop-blur-xl animate-fade-in"
      style={{
        bottom: 'max(1.5rem, calc(var(--safe-bottom) + 0.5rem))',
        right: 'max(1rem, calc(var(--safe-right) + 0.5rem))',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-brand-accent/20 p-2 shrink-0">
          <Sparkles className="w-icon-md h-icon-md text-brand-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-content-primary">
              {isSuspended ? 'AI temporaneamente non disponibile' : 'AI non configurata'}
            </p>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Chiudi notifica"
              className="tv-focus-dense -mr-1 -mt-1 p-1 rounded-control text-content-muted hover:text-content-primary hover:bg-surface-2"
            >
              <X className="w-icon-sm h-icon-sm" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-1 text-sm text-content-muted">{message}</p>
          {!hasKey && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="tv-focus mt-3 rounded-control bg-brand-accent hover:bg-brand-accent-hover px-4 py-2 text-sm font-semibold text-white"
            >
              Apri impostazioni
            </button>
          )}
          <label className="mt-3 flex items-center gap-2 text-xs text-content-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="w-4 h-4 rounded border-DEFAULT bg-surface-2 text-brand-accent focus:ring-brand-accent/40"
            />
            <span>Non mostrare più</span>
          </label>
        </div>
      </div>
    </div>
  );
};


function App() {

  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const lastProfileIdRef = useRef<string | null>(null);

  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [vodCategories, setVodCategories] = useState<Category[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  
  const [activeTab, setActiveTab] = useState<StreamType>('home');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [playQueue, setPlayQueue] = useState<Channel[]>([]);
  
  // State for Series Handling
  const [selectedSeries, setSelectedSeries] = useState<Channel | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<Channel | null>(null);
  const [xtreamCreds, setXtreamCreds] = useState<XtreamCredentials | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [showXtreamModal, setShowXtreamModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // FIX 2026-05-15: dismiss della notifica "AI non configurata" per la
  // sessione corrente (in-memory) o permanentemente via preferenza profilo.
  const [aiHintSessionDismissed, setAiHintSessionDismissed] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  // C.1 (2026-05-15): l'apertura automatica al primo avvio profilo mostra la
  // checkbox "Non mostrare più". L'apertura manuale via `?` / `Shift+/` no.
  const [cheatsheetOnboarding, setCheatsheetOnboarding] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [contentRefreshStatus, setContentRefreshStatus] = useState<ContentRefreshStatus>({ state: 'idle' });
  const contentRefreshInFlightRef = useRef(false);
  // BUG-1 §2.3 Step 4: health per blocco (live/vod/series) propagato dal
  // login Xtream a `ChannelList` per mostrare EmptyState dedicato sui blocchi
  // in errore (es. "Catalogo film non disponibile" + CTA Riscarica).
  const [catalogHealth, setCatalogHealth] = useState<XtreamContent['health'] | null>(null);
  const [isMigrating, setIsMigrating] = useState(platformService.isWails);
  // Ref per chiamare refreshContentFromServer da handleXtreamLogin senza TDZ.
  const refreshContentFromServerRef = useRef<((options?: { background?: boolean }) => Promise<unknown>) | null>(null);

  // Latest reminder that fired — shown as an in-app toast.
  const [reminderToast, setReminderToast] = useState<ReminderFiredEvent['reminder'] | null>(null);

  // Focus Restoration State
  const [lastFocusedChannelId, setLastFocusedChannelId] = useState<string | null>(null);

  // Refs per gestire il tasto Back su Android senza problemi di closure
  const stateRef = useRef({
    currentChannel,
    selectedSeries,
    selectedMovie,
    showSettings,
    showXtreamModal,
    activeTab,
    activeProfile,
    showGuide,
  });

  // Aggiorna i ref quando lo stato cambia
  useEffect(() => {
    stateRef.current = {
      currentChannel,
      selectedSeries,
      selectedMovie,
      showSettings,
      showXtreamModal,
      activeTab,
      activeProfile,
      showGuide,
    };
  }, [currentChannel, selectedSeries, selectedMovie, showSettings, showXtreamModal, activeTab, activeProfile, showGuide]);

  useEffect(() => {
    if (activeProfile?.preferences?.theme === 'oled') {
      document.body.classList.add('theme-oled');
    } else {
      document.body.classList.remove('theme-oled');
    }
  }, [activeProfile]);

  // C.6 (2026-05-15) — Accessibilità: applica la scala del font del profilo
  // attivo a `<html>`. Tutte le dimensioni Tailwind sono in `rem`, quindi
  // l'intera UI si adatta in proporzione (testi, padding, icone wrapper).
  // Reset a 16 px quando non c'è un profilo attivo o la preferenza manca.
  useEffect(() => {
    const FONT_SCALE_PX: Record<NonNullable<ProfilePreferences['fontScale']>, string> = {
      sm: '14px',
      md: '16px',
      lg: '18px',
      xl: '20px',
    };
    const scale = activeProfile?.preferences?.fontScale ?? 'md';
    document.documentElement.style.fontSize = FONT_SCALE_PX[scale];
    return () => {
      // Cleanup difensivo: se l'app smonta, ripristina il default browser.
      document.documentElement.style.fontSize = '';
    };
  }, [activeProfile]);

  // Global "?" / "Shift+/" → open keyboard shortcuts cheatsheet.
  // Global "G" → open full TV Guide (when on Live tab and no overlay open).
  // Global "Ctrl/Cmd+K" → open command palette (global search).
  // Ignored while typing in inputs/textareas and while the cheatsheet is already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isTyping = !!(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
      // Ctrl/Cmd+K works even while typing (it's the universal palette shortcut).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        const s = stateRef.current;
        // Don't hijack when the video player is on top — it has its own focus handling.
        if (s.currentChannel) return;
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        return;
      }
      if (isTyping) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        // Apertura manuale: niente checkbox "Non mostrare più".
        setCheatsheetOnboarding(false);
        setShowCheatsheet(prev => !prev);
        return;
      }
      // 'F' / 'f' → toggle window fullscreen (Fase 7.2)
      if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (platformService.isWails && host?.toggleFullscreen) {
          e.preventDefault();
          host.toggleFullscreen().catch(console.error);
          return;
        }
      }

      // 'G' / 'g' (no modifiers) → toggle Guide TV. Only when no player/modal
      // is on top — VideoPlayer captures its own 'G' for the mini-EPG overlay.
      if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const s = stateRef.current;
        if (s.currentChannel || s.selectedMovie || s.selectedSeries || s.showSettings || s.showXtreamModal) return;
        e.preventDefault();
        setShowGuide(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Routing dichiarativo (B.4) ─────────────────────────────────────
  // Single declarative back-stack: replaces the two ad-hoc handlers
  // (Android hardware Back + keyboard Esc) and centralises the order in
  // which layers are closed. The player has `skipEsc: true` because it
  // owns its own Esc handling (PiP exit, OSD dismiss, …) — for Esc it
  // only blocks the chain; for Android Back it closes normally.
  useBackStack(
    [
      { id: 'player', isOpen: !!currentChannel, onClose: () => setCurrentChannel(null), skipEsc: true },
      { id: 'commandPalette', isOpen: showCommandPalette, onClose: () => setShowCommandPalette(false) },
      { id: 'cheatsheet', isOpen: showCheatsheet, onClose: () => setShowCheatsheet(false) },
      { id: 'movieDetail', isOpen: !!selectedMovie, onClose: () => setSelectedMovie(null) },
      { id: 'seriesDetail', isOpen: !!selectedSeries, onClose: () => setSelectedSeries(null) },
      { id: 'guide', isOpen: showGuide, onClose: () => setShowGuide(false) },
      { id: 'settings', isOpen: showSettings, onClose: () => setShowSettings(false) },
      {
        id: 'xtreamModal',
        // Only treat as "closable" if credentials already exist, mirroring
        // the previous heuristic (a fresh first-time setup cannot be cancelled).
        isOpen: showXtreamModal && !!activeProfile?.xtreamCreds,
        onClose: () => setShowXtreamModal(false),
      },
      { id: 'tab', isOpen: activeTab !== 'home', onClose: () => setActiveTab('home') },
    ],
    {
      // On Android, when no layer absorbed the Back action, exit the app
      // (preserves the previous behaviour). On desktop Esc just no-ops.
      onEmpty: () => {
        if (platformService.isNative) {
          CapacitorApp.exitApp();
        }
      },
    },
  );

  // System tray bridge (Wails v3, plan §6.5.3): listener degli eventi
  // emessi dal menu tray (`tray:play-pause`, `tray:pip-toggle`).
  // - `onPlayPause` (default): toggle automatico via PlayerService.State()
  //   gestito dentro l'hook stesso.
  // - `onPipToggle`: emette il keyboard shortcut `P` sul player corrente,
  //   replicando il path già rodato di `VideoPlayerNew.tsx` (che intercetta
  //   `KeyboardEvent.key === 'p'` nella sua keymap interna). Questo evita
  //   di tirar fuori `videoRef` da App.tsx — il refactor pulito sarà
  //   parte di REF-1.a (estrazione hooks PiP/shortcuts da VideoPlayerNew).
  //   Su web/Capacitor l'hook è no-op (early-return su isWails).
  useTrayBridge({
    onPipToggle: () => {
      const ev = new KeyboardEvent('keydown', {
        key: 'p',
        code: 'KeyP',
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ev);
    },
  });

  // Initialize Cache Persistence and Migration
  useEffect(() => {
    const init = async () => {
      await CacheService.init();
      platformService.init();
      
      // Fase 7-bis.8: Check migration from Electron v1
      if (platformService.isWails) {
        try {
          await MigrationService.checkAndMigrate();
        } finally {
          setIsMigrating(false);
        }
      }
      
      EpgReminderService.ensureScheduler();
    };

    init();

    // In-app toast on reminder fire.
    const offFired = EpgReminderService.onFired(({ reminder }) => {
      setReminderToast(reminder);
      window.setTimeout(() => setReminderToast(curr => (curr?.id === reminder.id ? null : curr)), 15000);
    });

    // OS notification click → jump to that channel.
    const onNotifClick = (e: Event) => {
      const ev = e as CustomEvent<ReminderFiredEvent>;
      const r = ev.detail?.reminder;
      if (!r) return;
      const ch = [...liveCategories, ...vodCategories, ...seriesCategories]
        .flatMap(c => c.channels)
        .find(c => c.id === r.channelId);
      if (ch) {
        setCurrentChannel(ch);
        setReminderToast(null);
      }
    };
    window.addEventListener('epg-reminder-clicked', onNotifClick);
    return () => {
      offFired();
      window.removeEventListener('epg-reminder-clicked', onNotifClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latency placeholder useEffect was here before — kept platform classes init below.
  useEffect(() => {
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const isLowPowerTvDevice = platformService.isNative || (typeof deviceMemory === 'number' && deviceMemory <= 4);
    document.body.classList.toggle('platform-native', platformService.isNative);
    document.body.classList.toggle('platform-android', platformService.isAndroid);
    document.body.classList.toggle('tv-low-power', isLowPowerTvDevice);

    return () => {
      document.body.classList.remove('platform-native', 'platform-android', 'tv-low-power');
    };
  }, []);


  // When profile changes, load their data
  useEffect(() => {
    if (activeProfile?.id) {
        if (activeProfile.id !== lastProfileIdRef.current) {
            lastProfileIdRef.current = activeProfile.id;
            // Reset il dismiss della notifica AI quando si cambia profilo:
            // l'hint può riapparire per il nuovo profilo (con la sua
            // preferenza `hideAiUnavailableHint` come gate permanente).
            setAiHintSessionDismissed(false);

            // C.1 (2026-05-15): al primo avvio profilo apri la cheatsheet
            // come onboarding (con checkbox "Non mostrare più"). Una volta
            // chiusa, `hasSeenShortcutsCheatsheet` viene impostato a true e
            // questo blocco non scatta più finché l'utente non la resetta
            // dalle impostazioni. Skip se è già aperta o se altri modali
            // identitari sono pending (login Xtream con creds mancanti).
            if (!activeProfile.preferences?.hasSeenShortcutsCheatsheet && !showCheatsheet) {
              // Piccolo delay per evitare di sovrapporsi al mount iniziale
              // del catalogo (UX percepita: prima vede l'app, poi l'hint).
              const t = window.setTimeout(() => {
                setCheatsheetOnboarding(true);
                setShowCheatsheet(true);
              }, 600);
              // Cleanup gestito dal cambio profilo successivo (id ref).
              void t;
            }

            if (activeProfile.xtreamCreds) {
                // Try to load from cache immediately, then state updates
                handleXtreamLogin(activeProfile.xtreamCreds, false); 
            } else if (activeProfile.playlistUrl) {
                // C.2: profilo con playlist M3U remota (alternativa a Xtream).
                // Le playlist M3U classiche non distinguono Live/VOD/Series:
                // tutto viene popolato in `liveCategories`.
                void handleM3UProfile(activeProfile.playlistUrl);
            } else {
                setLiveCategories([]);
                setVodCategories([]);
                setSeriesCategories([]);
                setXtreamCreds(null);
                setShowXtreamModal(true);
            }
        }
    } else {
        lastProfileIdRef.current = null;
    }
  }, [activeProfile]);

  // C.2: carica una playlist M3U remota e popola `liveCategories`. Niente
  // cache health (le M3U non hanno il concept multi-blocco); errori
  // mostrati come EmptyState dal flusso standard "zero contenuti".
  const handleM3UProfile = async (url: string) => {
      setIsLoading(true);
      try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);
          if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
          const text = await res.text();
          const { parseM3UAsync } = await import('./services/workers/index.ts');
          const categories = await parseM3UAsync(text);
          setLiveCategories(categories);
          setVodCategories([]);
          setSeriesCategories([]);
          setCatalogHealth(null);
          setXtreamCreds(null);
          setActiveTab('home');
      } catch (err) {
          console.error('[App] M3U playlist load failed:', err);
          setLiveCategories([]);
          setVodCategories([]);
          setSeriesCategories([]);
      } finally {
          setIsLoading(false);
      }
  };

  const handleXtreamLogin = async (creds: XtreamCredentials, saveToProfile = true) => {
    setIsLoading(true);
    try {
        // This will check cache first!
        const content = await loginXtream(creds);
        setLiveCategories(content.live);
        setVodCategories(content.vod);
        setSeriesCategories(content.series);
        setCatalogHealth(content.health ?? null);
        setXtreamCreds(creds);

        // BUG-1 §2.3 Step 4 + hotfix 2026-05-14: se la cache è legacy
        // (`fetchedAt === 0`, sintetizzata da loginXtream) oppure VOD/Series
        // sono in errore/stale, fai partire un refresh forzato in background
        // (non bloccante). L'utente entra subito nell'app con la cache, e i
        // dati si aggiornano dietro le quinte.
        if (content.health) {
          const isLegacyCache = content.health.fetchedAt === 0;
          const blocksNeedRefresh =
            content.health.vod.status    === 'error' ||
            content.health.series.status === 'error' ||
            content.health.vod.status    === 'stale' ||
            content.health.series.status === 'stale';
          if (isLegacyCache || blocksNeedRefresh) {
            console.warn('[App] Catalog needs background refresh', { isLegacyCache, health: content.health });
            setTimeout(() => {
                refreshContentFromServerRef.current?.({ background: true }).catch(() => { /* swallow */ });
            }, isLegacyCache ? 1_500 : 5_000);
          }
        }

        if (saveToProfile && activeProfile) {
            const updatedProfile = ProfileService.updateCredentials(activeProfile.id, creds);
            setActiveProfile(updatedProfile);
        }
        
        setActiveTab('home');
        setCurrentChannel(null);
        setSelectedSeries(null);
        setPlayQueue([]);
    } finally {
        setIsLoading(false);
    }
  };

  const refreshContentFromServer = useCallback(async (options: { background?: boolean } = {}) => {
      if (!activeProfile?.id || !activeProfile.xtreamCreds) {
          const message = 'Configura prima un server Xtream per questo profilo.';
          setContentRefreshStatus({ state: 'error', message, updatedAt: Date.now() });
          throw new Error(message);
      }

      if (contentRefreshInFlightRef.current) {
          if (!options.background) {
              const message = 'Aggiornamento catalogo già in corso.';
              setContentRefreshStatus({ state: 'refreshing', message, updatedAt: Date.now() });
              throw new Error(message);
          }
          return;
      }

      contentRefreshInFlightRef.current = true;
      if (!options.background) {
          setContentRefreshStatus({ state: 'refreshing', message: 'Riscaricamento lista contenuti in corso...', updatedAt: Date.now() });
      }

      try {
          const content = await loginXtream(activeProfile.xtreamCreds, true);
          setLiveCategories(content.live);
          setVodCategories(content.vod);
          setSeriesCategories(content.series);
          setCatalogHealth(content.health ?? null);
          setXtreamCreds(activeProfile.xtreamCreds);

          const refreshedAt = Date.now();
          const updatedProfile = ProfileService.updatePreferences(activeProfile.id, {
              contentLastRefreshAt: refreshedAt,
              contentLastRefreshError: undefined
          });
          if (updatedProfile) {
              setActiveProfile(updatedProfile);
          }

          setContentRefreshStatus({
              state: 'success',
              message: options.background ? 'Catalogo aggiornato automaticamente in background.' : 'Lista contenuti aggiornata dal server.',
              updatedAt: refreshedAt
          });
          return { lastRefreshAt: refreshedAt };
      } catch (error) {
          const message = error instanceof Error ? error.message : 'Errore sconosciuto durante aggiornamento catalogo.';
          const updatedProfile = ProfileService.updatePreferences(activeProfile.id, {
              contentLastRefreshError: message
          });
          if (updatedProfile) {
              setActiveProfile(updatedProfile);
          }
          setContentRefreshStatus({ state: 'error', message, updatedAt: Date.now() });
          if (!options.background) {
              throw error;
          }
      } finally {
          contentRefreshInFlightRef.current = false;
      }
  }, [activeProfile]);

  // Aggiorna il ref ogni volta che la callback cambia (BUG-1 §2.3 Step 4).
  useEffect(() => {
    refreshContentFromServerRef.current = refreshContentFromServer;
  }, [refreshContentFromServer]);

  useEffect(() => {
      if (!activeProfile?.id || !activeProfile.xtreamCreds) return;

      const preferences = {
          ...DEFAULT_PREFERENCES,
          ...(activeProfile.preferences || {})
      };
      if (!preferences.contentAutoRefreshEnabled) return;

      const intervalMinutes = Math.max(
          MIN_CONTENT_REFRESH_INTERVAL_MINUTES,
          Number(preferences.contentAutoRefreshIntervalMinutes || DEFAULT_PREFERENCES.contentAutoRefreshIntervalMinutes || 360)
      );
      const intervalMs = intervalMinutes * 60 * 1000;
      const lastRefreshAt = Number(preferences.contentLastRefreshAt || 0);
      let intervalId: number | null = null;

      const runIfDue = () => {
          if (!navigator.onLine) {
              console.info('[ContentRefresh] Skip: offline');
              return;
          }

          const latestProfile = ProfileService.getAll().find(p => p.id === activeProfile.id);
          const latestLastRefreshAt = Number(latestProfile?.preferences?.contentLastRefreshAt || lastRefreshAt || 0);
          if (Date.now() - latestLastRefreshAt >= intervalMs) {
              refreshContentFromServer({ background: true }).catch(error => {
                  console.warn('[ContentRefresh] Background refresh failed:', error);
              });
          }
      };

      const elapsed = lastRefreshAt ? Date.now() - lastRefreshAt : intervalMs;
      const initialDelay = Math.max(30_000, intervalMs - elapsed);
      const timeoutId = window.setTimeout(() => {
          runIfDue();
          intervalId = window.setInterval(runIfDue, intervalMs);
      }, initialDelay);

      return () => {
          window.clearTimeout(timeoutId);
          if (intervalId !== null) window.clearInterval(intervalId);
      };
  }, [activeProfile?.id, activeProfile?.xtreamCreds, activeProfile?.preferences?.contentAutoRefreshEnabled, activeProfile?.preferences?.contentAutoRefreshIntervalMinutes, activeProfile?.preferences?.contentLastRefreshAt, refreshContentFromServer]);

  const getCurrentCategories = () => {
      switch (activeTab) {
          case 'home': return []; // La Home gestisce le categorie internamente
          case 'live': return liveCategories;
          case 'movie': return vodCategories;
          case 'series': return seriesCategories;
          default: return liveCategories;
      }
  };

  const handleChannelSelect = (channel: Channel) => {
      // Save the ID to restore focus later
      setLastFocusedChannelId(channel.id);
      setSelectedMovie(null);

      // Record History for AI
      if (activeProfile && (channel.type === 'movie' || channel.type === 'series' || channel.type === 'live')) {
           ProfileService.addToHistory(activeProfile.id, {
               channelId: channel.id,
               name: channel.cleanName || channel.name,
               type: channel.type as StreamType
           });
           // Use functional update to ensure we have fresh state if needed, though activeProfile is dependency
           setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
      }

      if (channel.type === 'series') {
          if (xtreamCreds && channel.seriesId) {
              setSelectedSeries(channel);
              setCurrentChannel(null);
              setPlayQueue([]);
          } else {
              setCurrentChannel(channel);
          }
      } else {
          setCurrentChannel(channel);
          setSelectedSeries(null);
          
          // Fase 7.2: se siamo nella tab 'home' o se la coda è vuota, 
          // popoliamo la coda con l'intera lista globale di quel tipo 
          // per permettere il cambio canale (prev/next).
          let queue = getCurrentCategories().flatMap(cat => cat.channels);
          if (queue.length <= 1) {
            if (channel.type === 'live') {
              queue = liveCategories.flatMap(c => c.channels);
            } else if (channel.type === 'movie') {
              queue = vodCategories.flatMap(c => c.channels);
            }
          }
          setPlayQueue(queue);
      }
  };

  const handleShowDetails = (channel: Channel) => {
      setLastFocusedChannelId(channel.id);

      if (channel.type === 'series') {
          if (xtreamCreds && channel.seriesId) {
              setSelectedSeries(channel);
              setSelectedMovie(null);
              setCurrentChannel(null);
          } else {
              handleChannelSelect(channel);
          }
          return;
      }

      if (channel.type === 'movie') {
          if (selectedMovie && selectedMovie.id === channel.id) {
              setSelectedMovie(null);
              setTimeout(() => setSelectedMovie(channel), 0);
          } else {
              setSelectedMovie(channel);
          }
          setCurrentChannel(null);
          setSelectedSeries(null);
          return;
      }

      handleChannelSelect(channel);
  };

  const handleEpisodePlay = (episodeChannel: Channel, playlist: Channel[] = []) => {
      if (activeProfile) {
          ProfileService.addToHistory(activeProfile.id, {
               channelId: episodeChannel.id,
               name: `${selectedSeries?.name || ''} - ${episodeChannel.name}`,
               type: 'series',
               // `selectedSeries.id` ha il formato `series-{series_id}` ed è
               // l'ID che esiste nelle liste `seriesCategories` indicizzate da
               // ChannelList; serve a "Continua a guardare" per riassociare
               // l'episodio alla sua serie e mostrarla nella riga.
               parentSeriesId: selectedSeries?.id,
           });
           setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
      }

      setPlayQueue(playlist);
      setCurrentChannel(episodeChannel);
      setSelectedSeries(null);
  };

  const handleVideoProgress = (currentTime: number, duration: number) => {
      if (activeProfile && currentChannel) {
          // Calcoliamo la percentuale (0..1) per il "riprendi visione" cross-platform.
          const progress = duration > 0 ? currentTime / duration : 0;
          ProfileService.updateProgress(activeProfile.id, currentChannel.id, progress, duration);
      }
  };

  const handleToggleWatchlist = (channelId: string) => {
      if (!activeProfile) return;
      const updated = ProfileService.toggleWatchlist(activeProfile.id, channelId);
      if (updated) {
          setActiveProfile(updated);
      }
  };

  const allChannels = useMemo(() => {
      return [
          ...liveCategories.flatMap(c => c.channels),
          ...vodCategories.flatMap(c => c.channels),
          ...seriesCategories.flatMap(c => c.channels)
      ];
  }, [liveCategories, vodCategories, seriesCategories]);

  // Ottieni il progresso salvato per il canale corrente
  const getInitialProgress = (): number => {
      if (!activeProfile || !currentChannel) return 0;
      const historyItem = activeProfile.history.find(h => h.channelId === currentChannel.id);
      return historyItem?.progress || 0;
  };

  // Reset del progresso quando l'utente clicca "Riparti dall'inizio"
  const handleResetProgress = () => {
      if (activeProfile && currentChannel) {
          ProfileService.updateProgress(activeProfile.id, currentChannel.id, 0, 0);
      }
  };

  const playNext = () => {
      if (!currentChannel || playQueue.length === 0) return;
      const idx = playQueue.findIndex(c => c.id === currentChannel.id);
      if (idx > -1 && idx < playQueue.length - 1) {
          setCurrentChannel(playQueue[idx + 1]);
      }
  };

  const playPrev = () => {
      if (!currentChannel || playQueue.length === 0) return;
      const idx = playQueue.findIndex(c => c.id === currentChannel.id);
      if (idx > 0) {
          setCurrentChannel(playQueue[idx - 1]);
      }
  };

  const handlePlayRecommended = (name: string) => {
      const allCurrent = getCurrentCategories().flatMap(c => c.channels);
      let found = allCurrent.find(c => c.name === name);
      if (!found) found = allCurrent.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!found) found = allCurrent.find(c => c.name.toLowerCase().includes(name.toLowerCase()));
      
      if (found) handleChannelSelect(found);
  };

  const handlePlayMovie = (channel: Channel, options?: { resetProgress?: boolean }) => {
      if (activeProfile && options?.resetProgress) {
          const updated = ProfileService.updateProgress(activeProfile.id, channel.id, 0, 0);
          if (updated) {
              setActiveProfile(updated);
          }
      }

      handleChannelSelect(channel);
      setSelectedMovie(null);
  };

  const handleLogoutProfile = () => {
      setActiveProfile(null);
      setXtreamCreds(null);
      setLiveCategories([]);
      setVodCategories([]);
      setSeriesCategories([]);
      setCurrentChannel(null);
      setSelectedSeries(null);
      lastProfileIdRef.current = null;
  };

  // 0. If migrating data, show loading screen
  if (isMigrating) {
      return (
          <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)] h-screen">
              <div className="w-16 h-16 border-4 border-brand-accent/20 border-t-brand-accent rounded-full animate-spin mb-4"></div>
              <p className="text-xl text-gray-400 font-medium">Migrazione dati in corso…</p>
          </div>
      );
  }

  // 1. If no profile selected, show selection screen
  if (!activeProfile) {
      return <ProfileSelection onSelectProfile={setActiveProfile} />;
  }

  // Content rendering logic
  const renderContent = () => {
    // Get translations for current profile language. Lazy loader is fired
    // asynchronously (B.3); `i18n.t()` returns the currently-cached dict
    // (Italian fallback while a non-default locale is in flight).
    const lang = activeProfile?.preferences?.language || DEFAULT_PREFERENCES.language;
    void i18n.setLanguage(lang);
    const t = i18n.t();

    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[var(--bg-primary)]">
                <div className="w-16 h-16 border-4 border-red-600/20 border-t-red-600 rounded-full animate-spin mb-4"></div>
                <p className="text-xl text-gray-400 font-medium animate-pulse">{t.loadingLibrary}</p>
            </div>
        );
    }

    if (showSettings) {
        return (
            <Suspense fallback={<RouteLoadingFallback />}>
                <ProfileSettings
                    profile={activeProfile}
                    onBack={() => setShowSettings(false)}
                    onProfileUpdate={(updatedProfile) => setActiveProfile(updatedProfile)}
                    onRefreshContent={() => refreshContentFromServer({ background: false })}
                    isContentRefreshing={contentRefreshStatus.state === 'refreshing'}
                    contentRefreshMessage={contentRefreshStatus.message}
                    catalogHealth={catalogHealth}
                />
            </Suspense>
        );
    }

    if (currentChannel) {
        return (
            <div className="fixed inset-0 z-[100] bg-black">
                <Suspense fallback={<PlayerLoadingFallback />}>
                    <VideoPlayer
                        channel={currentChannel}
                        playlist={playQueue}
                        onChannelSelect={setCurrentChannel}
                        onNext={playQueue.length > 0 ? playNext : undefined}
                        onPrev={playQueue.length > 0 ? playPrev : undefined}
                        onProgress={handleVideoProgress}
                        initialProgress={getInitialProgress()}
                        onResetProgress={handleResetProgress}
                        debugOverlay={activeProfile.preferences?.debugOverlay}
                        xtreamCreds={xtreamCreds}
                        autoNextEpisodeEnabled={activeProfile.preferences?.autoNextEpisodeEnabled ?? DEFAULT_PREFERENCES.autoNextEpisodeEnabled}
                        onBack={() => {
                            // Refresh history when closing player to update UI
                            setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
                            setCurrentChannel(null);
                        }}
                    />
                </Suspense>
            </div>
        );
    }

    if (selectedSeries && xtreamCreds) {
        return (
            <Suspense fallback={<RouteLoadingFallback />}>
                <SeriesDetail
                    series={selectedSeries}
                    creds={xtreamCreds}
                    onPlayEpisode={handleEpisodePlay}
                    onBack={() => setSelectedSeries(null)}
                    history={activeProfile.history}
                    watchlistIds={activeProfile.watchlist}
                    onToggleWatchlist={handleToggleWatchlist}
                />
            </Suspense>
        );
    }

    if (liveCategories.length === 0 && vodCategories.length === 0 && seriesCategories.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)] safe-area-screen">
                <EmptyState
                    icon={Server}
                    title={t.welcome}
                    description={`${t.welcomeDesc} Se hai già configurato un provider ma il catalogo resta vuoto, verifica che il server sia raggiungibile e che le credenziali siano ancora valide.`}
                    actions={[{ label: t.connectServer, onClick: () => setShowXtreamModal(true) }]}
                />
            </div>
        );
    }

    if (showGuide) {
        return (
            <Suspense fallback={<RouteLoadingFallback />}>
                <GuideView
                    liveCategories={liveCategories}
                    xtreamCreds={xtreamCreds}
                    onPlayChannel={(ch) => {
                        setShowGuide(false);
                        handleChannelSelect(ch);
                    }}
                    onBack={() => setShowGuide(false)}
                />
            </Suspense>
        );
    }

    return (
        <ChannelList 
            categories={getCurrentCategories()}
            liveCategories={liveCategories}
            vodCategories={vodCategories}
            seriesCategories={seriesCategories}
            onSelectChannel={handleChannelSelect}
            currentChannelId={lastFocusedChannelId}
            isOpen={true}
            setIsOpen={() => {}}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            profileName={activeProfile.name}
            profileColor={activeProfile.color}
            onLogout={handleLogoutProfile}
            onOpenServer={() => setShowXtreamModal(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenGuide={() => setShowGuide(true)}
            history={activeProfile.history}
            watchlistIds={activeProfile.watchlist}
            onToggleWatchlist={handleToggleWatchlist}
            allChannels={allChannels}
            onShowDetails={handleShowDetails}
            continueWatchingCompletedThreshold={
              activeProfile.preferences?.continueWatchingCompletedThreshold
              ?? DEFAULT_PREFERENCES.continueWatchingCompletedThreshold
            }
            continueWatchingMoviesEnabled={
              activeProfile.preferences?.continueWatchingMoviesEnabled
              ?? DEFAULT_PREFERENCES.continueWatchingMoviesEnabled
            }
            continueWatchingSeriesEnabled={
              activeProfile.preferences?.continueWatchingSeriesEnabled
              ?? DEFAULT_PREFERENCES.continueWatchingSeriesEnabled
            }
            // BUG-1 §2.3 Step 4: passa health + handler refresh per
            // mostrare EmptyState con CTA quando un blocco è in errore.
            catalogHealth={catalogHealth}
            onRefreshCatalog={() => refreshContentFromServer().catch(() => { /* errore già nello status */ })}
            contentRefreshStatus={contentRefreshStatus}
        />
    );
  };

  return (
    <LanguageProvider profileLanguage={activeProfile?.preferences?.language || DEFAULT_PREFERENCES.language}>
      <div className="min-h-screen w-screen bg-[var(--bg-primary)] overflow-x-hidden relative font-sans text-gray-100 flex flex-col">
        {renderContent()}

        {selectedMovie && (
          <Suspense fallback={null}>
            <MovieDetail
                key={selectedMovie.id}
                movie={selectedMovie}
                onClose={() => setSelectedMovie(null)}
                onPlay={(ch, opts) => handlePlayMovie(ch, opts)}
                watchlistIds={activeProfile.watchlist}
                onToggleWatchlist={handleToggleWatchlist}
                allChannels={allChannels}
                onShowDetails={handleShowDetails}
                history={activeProfile.history}
                geminiApiKey={activeProfile.preferences?.geminiApiKey}
            />
          </Suspense>
        )}

        {!currentChannel && !selectedSeries && (liveCategories.length > 0 || vodCategories.length > 0) && isAiAvailable(activeProfile.preferences?.geminiApiKey) && (
            <Suspense fallback={null}>
              <AIRecommender
                channels={getCurrentCategories().flatMap(c => c.channels)}
                onPlayChannel={handlePlayRecommended}
                activeTab={activeTab}
                history={activeProfile.history}
                aiCaching={activeProfile.preferences?.aiCaching}
                geminiApiKey={activeProfile.preferences?.geminiApiKey}
                profileId={activeProfile.id}
                profileLanguage={activeProfile.preferences?.language || DEFAULT_PREFERENCES.language}
              />
            </Suspense>
        )}

        {!currentChannel && !selectedSeries && (liveCategories.length > 0 || vodCategories.length > 0) && !isAiAvailable(activeProfile.preferences?.geminiApiKey) && !aiHintSessionDismissed && !activeProfile.preferences?.hideAiUnavailableHint && (
            <AiUnavailableHint
              hasKey={hasAiApiKey(activeProfile.preferences?.geminiApiKey)}
              isSuspended={isAiTemporarilySuspended()}
              onOpenSettings={() => setShowSettings(true)}
              onDismiss={() => setAiHintSessionDismissed(true)}
              onDontShowAgain={() => {
                  setAiHintSessionDismissed(true);
                  const updated = ProfileService.updatePreferences(activeProfile.id, { hideAiUnavailableHint: true });
                  if (updated) setActiveProfile(updated);
              }}
            />
        )}

        {showXtreamModal && activeProfile && (
          <Suspense fallback={null}>
            <ServerManager
              profile={activeProfile}
              open={showXtreamModal}
              onClose={() => setShowXtreamModal(false)}
              onConnect={(creds) => handleXtreamLogin(creds, true)}
              onProfileChange={(p) => setActiveProfile(p)}
            />
          </Suspense>
        )}

        {/* Avviso codec HEVC - mostrato solo se necessario */}
        {activeProfile && !currentChannel && <CodecWarning />}

        {/* Banner per lo stato di riproduzione in rete */}
        <NetworkStatusBanner />

        {/* Toast promemoria EPG */}
        {reminderToast && (
          <div
            className="fixed z-[210] w-[calc(100vw-2rem)] max-w-xs sm:w-80 rounded-2xl border border-amber-500/30 bg-amber-950/90 backdrop-blur-xl shadow-2xl p-4 animate-in fade-in slide-in-from-top-2"
            style={{
              top: 'max(1.5rem, calc(var(--safe-top) + 0.5rem))',
              right: 'max(1.5rem, calc(var(--safe-right) + 0.5rem))',
            }}
          >
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-amber-500/20 p-2 flex-shrink-0">
                <Sparkles className="w-5 h-5 text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold tracking-widest uppercase text-amber-300">Promemoria EPG</div>
                <div className="text-sm font-semibold text-white truncate">{reminderToast.title}</div>
                <div className="text-xs text-amber-200/80 truncate">
                  {reminderToast.channelName} · {new Date(reminderToast.start).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={() => {
                      const ch = allChannels.find(c => c.id === reminderToast.channelId);
                      if (ch) {
                        setCurrentChannel(ch);
                        setReminderToast(null);
                      }
                    }}
                    className="tv-focus text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black px-3 py-1.5 rounded-full"
                  >
                    Guarda
                  </button>
                  <button
                    onClick={() => setReminderToast(null)}
                    className="tv-focus text-xs font-semibold text-amber-200 hover:text-white px-2 py-1.5"
                  >
                    Ignora
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cheatsheet scorciatoie da tastiera (apertura: ?, Shift+/, oppure
            automatica al primo avvio profilo — vedi C.1). */}
        <ShortcutsCheatsheet
          isOpen={showCheatsheet}
          onClose={() => {
            setShowCheatsheet(false);
            // L'apertura come onboarding va comunque registrata come "vista":
            // se l'utente la chiude senza spuntare "Non mostrare più", non
            // la riaprire al prossimo avvio (è già stata mostrata una volta).
            if (cheatsheetOnboarding && activeProfile && !activeProfile.preferences?.hasSeenShortcutsCheatsheet) {
              const updated = ProfileService.updatePreferences(activeProfile.id, { hasSeenShortcutsCheatsheet: true });
              if (updated) setActiveProfile(updated);
            }
            setCheatsheetOnboarding(false);
          }}
          showDontShowAgain={cheatsheetOnboarding}
          onDontShowAgain={() => {
            // L'utente ha esplicitamente spuntato "Non mostrare più":
            // identico al flag implicito, ma documenta l'intent dell'utente.
            if (activeProfile) {
              const updated = ProfileService.updatePreferences(activeProfile.id, { hasSeenShortcutsCheatsheet: true });
              if (updated) setActiveProfile(updated);
            }
          }}
        />

        {/* Palette di ricerca globale (apertura: Ctrl/Cmd+K) */}
        <CommandPalette
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          channels={allChannels}
          profileId={activeProfile?.id}
          onSelect={(channel) => handleShowDetails(channel)}
        />
      </div>
    </LanguageProvider>
  );
}

// UI-1.5 — Wrapper che decide se renderizzare l'app reale oppure la galleria
// del Design System (utile per smoke test visivo). La scelta è valutata una
// sola volta al mount per evitare problemi con le regole degli hook.
function Root() {
  if (shouldShowDsPreview()) {
    return (
      <Suspense fallback={<PlayerLoadingFallback />}>
        <DesignSystemPreview />
      </Suspense>
    );
  }
  if (shouldShowNativeMpvSmoke()) {
    return (
      <Suspense fallback={<PlayerLoadingFallback />}>
        <NativeMpvSmokeTest />
      </Suspense>
    );
  }
  return <App />;
}

export default Root;
