import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import ChannelList from './components/ChannelList.tsx';
import VideoPlayer from './components/VideoPlayerNew.tsx';
import AIRecommender from './components/AIRecommender.tsx';
import XtreamLogin from './components/XtreamLogin.tsx';
import SeriesDetail from './components/SeriesDetail.tsx';
import MovieDetail from './components/MovieDetail.tsx';
import ProfileSelection from './components/ProfileSelection.tsx';
import ProfileSettings from './components/ProfileSettings.tsx';
import CodecWarning from './components/CodecWarning.tsx';
import EmptyState from './components/shared/EmptyState.tsx';
import ShortcutsCheatsheet from './components/ShortcutsCheatsheet.tsx';
import { LanguageProvider } from './contexts/LanguageContext.tsx';
import { loginXtream } from './services/xtream.ts';
import { ProfileService, DEFAULT_PREFERENCES } from './services/profileService.ts';
import { CacheService } from './services/cacheService.ts';
import { i18n } from './services/i18n.ts';
import { Category, Channel, XtreamCredentials, StreamType, Profile } from './types.ts';
import { Server, Wifi, Sparkles } from 'lucide-react';
import { platformService } from './services/platformService.ts';
import { hasAiApiKey, isAiAvailable, isAiTemporarilySuspended } from './services/geminiService.ts';

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
    if (platformService.isElectron && window.electronAPI?.onNetworkPlaybackStatus) {
      const unsubscribe = window.electronAPI.onNetworkPlaybackStatus((status: { deviceId: string; channelName: string }) => {
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

const AiUnavailableHint = ({ hasKey, isSuspended, onOpenSettings }: { hasKey: boolean; isSuspended: boolean; onOpenSettings: () => void }) => {
  const message = isSuspended
    ? 'AI sospesa temporaneamente dopo errori o quota esaurita. Riproverà automaticamente più tardi.'
    : 'Gemini non configurato. Aggiungi una chiave API nelle impostazioni profilo per abilitare i consigli AI.';

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-sm rounded-2xl border border-white/10 bg-gray-900/95 p-4 text-gray-300 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-purple-500/20 p-2">
          <Sparkles className="w-5 h-5 text-purple-300" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-white">{isSuspended ? 'AI temporaneamente non disponibile' : 'AI non configurata'}</p>
          <p className="mt-1 text-sm text-gray-400">{message}</p>
          {!hasKey && (
            <button onClick={onOpenSettings} className="tv-focus mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-500">
              Apri impostazioni
            </button>
          )}
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
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [contentRefreshStatus, setContentRefreshStatus] = useState<ContentRefreshStatus>({ state: 'idle' });
  const contentRefreshInFlightRef = useRef(false);

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
    activeProfile
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
      activeProfile
    };
  }, [currentChannel, selectedSeries, selectedMovie, showSettings, showXtreamModal, activeTab, activeProfile]);

  useEffect(() => {
    if (activeProfile?.preferences?.theme === 'oled') {
      document.body.classList.add('theme-oled');
    } else {
      document.body.classList.remove('theme-oled');
    }
  }, [activeProfile]);

  // Global "?" / "Shift+/" → open keyboard shortcuts cheatsheet.
  // Ignored while typing in inputs/textareas and while the cheatsheet is already open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowCheatsheet(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Gestione Tasto Back (Android Hardware Button)
  useEffect(() => {
    if (!platformService.isNative) return;

    const handleBackButton = async () => {
      const state = stateRef.current;

      // 1. Chiudi Player Video
      if (state.currentChannel) {
        setCurrentChannel(null);
        return;
      }

      // 2. Chiudi Modali/Dettagli
      if (state.selectedMovie) {
        setSelectedMovie(null);
        return;
      }
      if (state.selectedSeries) {
        setSelectedSeries(null);
        return;
      }
      if (state.showSettings) {
        setShowSettings(false);
        return;
      }
      if (state.showXtreamModal && state.activeProfile?.xtreamCreds) {
        // Chiudi modale login solo se abbiamo già credenziali (annulla modifica)
        setShowXtreamModal(false);
        return;
      }

      // 3. Navigazione Tab
      if (state.activeTab !== 'home') {
        setActiveTab('home');
        return;
      }

      // 4. Logout Profilo (se siamo nella home) o Uscita App
      // Se siamo nella root (Home), chiediamo conferma o usciamo
      // Per ora usciamo dall'app come comportamento standard Android
      CapacitorApp.exitApp();
    };

    const listener = CapacitorApp.addListener('backButton', handleBackButton);

    return () => {
      listener.then(l => l.remove());
    };
  }, []);

  // Gestione coerente di Esc per tastiera e telecomandi desktop/TV.
  useEffect(() => {
      const handleEscape = (event: KeyboardEvent) => {
          if (event.key !== 'Escape') return;

          const state = stateRef.current;

          if (state.currentChannel) return; // Il player gestisce Esc/Back autonomamente.

          if (state.selectedMovie) {
              event.preventDefault();
              setSelectedMovie(null);
              return;
          }
          if (state.selectedSeries) {
              event.preventDefault();
              setSelectedSeries(null);
              return;
          }
          if (state.showSettings) {
              event.preventDefault();
              setShowSettings(false);
              return;
          }
          if (state.showXtreamModal && state.activeProfile?.xtreamCreds) {
              event.preventDefault();
              setShowXtreamModal(false);
              return;
          }
          if (state.activeTab !== 'home') {
              event.preventDefault();
              setActiveTab('home');
          }
      };

      window.addEventListener('keydown', handleEscape);
      return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  // Initialize Cache Persistence
  useEffect(() => {
    CacheService.init();
    platformService.init();

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
            
            if (activeProfile.xtreamCreds) {
                // Try to load from cache immediately, then state updates
                handleXtreamLogin(activeProfile.xtreamCreds, false); 
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

  const handleXtreamLogin = async (creds: XtreamCredentials, saveToProfile = true) => {
    setIsLoading(true);
    try {
        // This will check cache first!
        const content = await loginXtream(creds);
        setLiveCategories(content.live);
        setVodCategories(content.vod);
        setSeriesCategories(content.series);
        setXtreamCreds(creds);
        
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
          // Only build queue if starting playback
          const allChannels = getCurrentCategories().flatMap(cat => cat.channels);
          setPlayQueue(allChannels);
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
               type: 'series'
           });
           setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
      }

      setPlayQueue(playlist);
      setCurrentChannel(episodeChannel);
      setSelectedSeries(null);
  };

  const handleVideoProgress = (progress: number, duration: number) => {
      if (activeProfile && currentChannel) {
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

  // 1. If no profile selected, show selection screen
  if (!activeProfile) {
      return <ProfileSelection onSelectProfile={setActiveProfile} />;
  }

  // Content rendering logic
  const renderContent = () => {
    // Get translations for current profile language
    const lang = activeProfile?.preferences?.language || DEFAULT_PREFERENCES.language;
    i18n.setLanguage(lang);
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
            <ProfileSettings
                profile={activeProfile}
                onBack={() => setShowSettings(false)}
                onProfileUpdate={(updatedProfile) => setActiveProfile(updatedProfile)}
                onRefreshContent={() => refreshContentFromServer({ background: false })}
                isContentRefreshing={contentRefreshStatus.state === 'refreshing'}
                contentRefreshMessage={contentRefreshStatus.message}
            />
        );
    }

    if (currentChannel) {
        return (
            <div className="fixed inset-0 z-[100] bg-black">
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
                    onBack={() => {
                        // Refresh history when closing player to update UI
                        setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
                        setCurrentChannel(null);
                    }}
                />
            </div>
        );
    }

    if (selectedSeries && xtreamCreds) {
        return (
            <SeriesDetail 
                series={selectedSeries} 
                creds={xtreamCreds} 
                onPlayEpisode={handleEpisodePlay}
                onBack={() => setSelectedSeries(null)}
                history={activeProfile.history}
                watchlistIds={activeProfile.watchlist}
                onToggleWatchlist={handleToggleWatchlist}
            />
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
            history={activeProfile.history}
            watchlistIds={activeProfile.watchlist}
            onToggleWatchlist={handleToggleWatchlist}
            allChannels={allChannels}
            onShowDetails={handleShowDetails}
        />
    );
  };

  return (
    <LanguageProvider profileLanguage={activeProfile?.preferences?.language || DEFAULT_PREFERENCES.language}>
      <div className="min-h-screen w-screen bg-[var(--bg-primary)] overflow-x-hidden relative font-sans text-gray-100 flex flex-col">
        {renderContent()}

        {selectedMovie && (
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
        )}

        {!currentChannel && !selectedSeries && (liveCategories.length > 0 || vodCategories.length > 0) && isAiAvailable(activeProfile.preferences?.geminiApiKey) && (
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
        )}

        {!currentChannel && !selectedSeries && (liveCategories.length > 0 || vodCategories.length > 0) && !isAiAvailable(activeProfile.preferences?.geminiApiKey) && (
            <AiUnavailableHint
              hasKey={hasAiApiKey(activeProfile.preferences?.geminiApiKey)}
              isSuspended={isAiTemporarilySuspended()}
              onOpenSettings={() => setShowSettings(true)}
            />
        )}

        {showXtreamModal && (
          <XtreamLogin
              onLogin={(creds) => handleXtreamLogin(creds, true)}
              onClose={() => setShowXtreamModal(false)}
          />
        )}

        {/* Avviso codec HEVC - mostrato solo se necessario */}
        {activeProfile && !currentChannel && <CodecWarning />}

        {/* Banner per lo stato di riproduzione in rete */}
        <NetworkStatusBanner />

        {/* Cheatsheet scorciatoie da tastiera (apertura: ?, Shift+/) */}
        <ShortcutsCheatsheet isOpen={showCheatsheet} onClose={() => setShowCheatsheet(false)} />
      </div>
    </LanguageProvider>
  );
}

export default App;
