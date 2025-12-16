
import React, { useState, useEffect, useRef, useMemo } from 'react';
import ChannelList from './components/ChannelList.tsx';
import VideoPlayer from './components/VideoPlayer.tsx';
import AIRecommender from './components/AIRecommender.tsx';
import XtreamLogin from './components/XtreamLogin.tsx';
import SeriesDetail from './components/SeriesDetail.tsx';
import MovieDetail from './components/MovieDetail.tsx';
import ProfileSelection from './components/ProfileSelection.tsx';
import ProfileSettings from './components/ProfileSettings.tsx';
import CodecWarning from './components/CodecWarning.tsx';
import { loginXtream } from './services/xtream.ts';
import { ProfileService } from './services/profileService.ts';
import { CacheService } from './services/cacheService.ts';
import { Category, Channel, XtreamCredentials, StreamType, Profile } from './types.ts';
import { Server } from 'lucide-react';

function App() {
  const [activeProfile, setActiveProfile] = useState<Profile | null>(null);
  const lastProfileIdRef = useRef<string | null>(null);

  const [liveCategories, setLiveCategories] = useState<Category[]>([]);
  const [vodCategories, setVodCategories] = useState<Category[]>([]);
  const [seriesCategories, setSeriesCategories] = useState<Category[]>([]);
  
  const [activeTab, setActiveTab] = useState<StreamType>('live');
  const [currentChannel, setCurrentChannel] = useState<Channel | null>(null);
  const [playQueue, setPlayQueue] = useState<Channel[]>([]);
  
  // State for Series Handling
  const [selectedSeries, setSelectedSeries] = useState<Channel | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<Channel | null>(null);
  const [xtreamCreds, setXtreamCreds] = useState<XtreamCredentials | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [showXtreamModal, setShowXtreamModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Focus Restoration State
  const [lastFocusedChannelId, setLastFocusedChannelId] = useState<string | null>(null);


  // Initialize Cache Persistence
  useEffect(() => {
    CacheService.init();
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
        
        setActiveTab('live');
        setCurrentChannel(null);
        setSelectedSeries(null);
        setPlayQueue([]);
    } finally {
        setIsLoading(false);
    }
  };

  const getCurrentCategories = () => {
      switch (activeTab) {
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
          setSelectedMovie(channel);
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
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center bg-[#141414]">
                <div className="w-16 h-16 border-4 border-red-600/20 border-t-red-600 rounded-full animate-spin mb-4"></div>
                <p className="text-xl text-gray-400 font-medium animate-pulse">Caricamento Libreria...</p>
            </div>
        );
    }

    if (showSettings) {
        return (
            <ProfileSettings
                profile={activeProfile}
                onBack={() => setShowSettings(false)}
                onProfileUpdate={(updatedProfile) => setActiveProfile(updatedProfile)}
            />
        );
    }

    if (currentChannel) {
        return (
            <div className="fixed inset-0 z-[100] bg-black">
                 <button 
                    onClick={() => {
                        // Refresh history when closing player to update UI
                        setActiveProfile(prev => prev ? ({...prev, history: ProfileService.getHistory(prev.id)}) : null);
                        setCurrentChannel(null);
                    }}
                    className="absolute top-8 left-8 z-[110] tv-focus bg-black/50 text-white px-6 py-2 rounded-lg backdrop-blur-md border border-white/10 hover:bg-white hover:text-black transition-colors flex items-center gap-2 font-bold"
                 >
                    &larr; Indietro
                 </button>
                 <VideoPlayer 
                    channel={currentChannel} 
                    playlist={playQueue}
                    onChannelSelect={setCurrentChannel}
                    onNext={playQueue.length > 0 ? playNext : undefined}
                    onPrev={playQueue.length > 0 ? playPrev : undefined}
                    onProgress={handleVideoProgress}
                    initialProgress={getInitialProgress()}
                    onResetProgress={handleResetProgress}
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
            <div className="flex-1 flex flex-col items-center justify-center bg-[#141414] text-gray-400">
                <Server className="w-24 h-24 mb-6 opacity-20" />
                <h2 className="text-4xl font-bold text-white mb-4">Benvenuto su StreamAI</h2>
                <p className="text-xl mb-10 max-w-md text-center font-light">Connetti il tuo account per accedere a migliaia di contenuti.</p>
                <button 
                    onClick={() => setShowXtreamModal(true)}
                    className="tv-focus bg-red-600 text-white px-10 py-4 rounded font-bold text-xl shadow-lg hover:bg-red-700 transition-colors"
                >
                    Connetti Server
                </button>
            </div>
        );
    }

    return (
        <ChannelList 
            categories={getCurrentCategories()}
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
    <div className="min-h-screen w-screen bg-[#141414] overflow-x-hidden relative font-sans text-gray-100 flex flex-col">
      {renderContent()}

      {selectedMovie && (
        <MovieDetail 
            movie={selectedMovie} 
            onClose={() => setSelectedMovie(null)} 
            onPlay={(ch, opts) => handlePlayMovie(ch, opts)}
            watchlistIds={activeProfile.watchlist}
            onToggleWatchlist={handleToggleWatchlist}
            allChannels={allChannels}
            onShowDetails={(ch) => setSelectedMovie(ch)}
            history={activeProfile.history}
        />
      )}

      {!currentChannel && !selectedSeries && (liveCategories.length > 0 || vodCategories.length > 0) && (
          <AIRecommender 
            channels={getCurrentCategories().flatMap(c => c.channels)} 
            onPlayChannel={handlePlayRecommended}
            activeTab={activeTab}
            history={activeProfile.history}
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
    </div>
  );
}

export default App;
