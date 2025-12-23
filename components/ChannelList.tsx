
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FixedSizeList as List } from 'react-window';
import { Category, Channel, StreamType, WatchHistoryItem } from '../types.ts';
import { Search, Play, Info, ChevronRight, LogOut, Clock, RefreshCw, BookmarkPlus, BookmarkCheck, Settings, X } from 'lucide-react';
import CachedImage from './CachedImage.tsx';
import { useLanguage } from '../contexts/LanguageContext.tsx';

interface ChannelListProps {
  categories: Category[];
  liveCategories?: Category[];
  vodCategories?: Category[];
  seriesCategories?: Category[];
  onSelectChannel: (channel: Channel) => void;
  currentChannelId?: string | null;
  isOpen: boolean; 
  setIsOpen: (val: boolean) => void;
  activeTab: StreamType;
  setActiveTab: (tab: StreamType) => void;
  profileName: string;
  profileColor: string;
  onLogout: () => void;
  onOpenServer: () => void;
  onOpenSettings: () => void;
  history: WatchHistoryItem[];
  watchlistIds: string[];
  onToggleWatchlist: (channelId: string) => void;
  allChannels: Channel[];
  onShowDetails: (channel: Channel) => void;
}

// --- CHANNEL ITEM COMPONENT ---
const ChannelItem = React.memo(({ 
    channel, 
    onSelect, 
    isPoster, 
    progress, 
    isInWatchlist, 
    onToggleWatchlist, 
    onShowDetails 
}: { 
    channel: Channel, 
    onSelect: (c: Channel) => void, 
    isPoster: boolean, 
    progress?: number, 
    isInWatchlist?: boolean, 
    onToggleWatchlist?: (c: Channel) => void, 
    onShowDetails?: (c: Channel) => void 
}) => {
    return (
        <button 
            id={`channel-${channel.id}`}
            onClick={() => {
                if (channel.type === 'movie' && onShowDetails) {
                    onShowDetails(channel);
                } else {
                    onSelect(channel);
                }
            }}
            className={`
                tv-focus flex-none relative rounded-md overflow-hidden bg-[#202020] shadow-lg transition-transform duration-300 group/card outline-none
                ${isPoster ? 'w-[150px] md:w-[180px] aspect-[2/3]' : 'w-[240px] md:w-[300px] aspect-[16/9]'}
            `}
            tabIndex={0}
        >
            {onToggleWatchlist && (
                <div
                    onClick={(e) => { e.stopPropagation(); onToggleWatchlist(channel); }}
                    className="absolute top-2 right-2 z-20 bg-black/60 text-white rounded-full p-2 hover:bg-black/80 border border-white/10 shadow-lg cursor-pointer"
                    role="button"
                    aria-label={isInWatchlist ? 'Rimuovi dalla lista' : 'Aggiungi alla lista'}
                >
                    {isInWatchlist ? (
                        <BookmarkCheck className="w-4 h-4" />
                    ) : (
                        <BookmarkPlus className="w-4 h-4" />
                    )}
                </div>
            )}

            {onShowDetails && channel.type === 'movie' && (
                <div
                    onClick={(e) => { e.stopPropagation(); onShowDetails(channel); }}
                    className="absolute bottom-2 left-2 z-20 bg-black/70 text-white rounded-full p-2 hover:bg-black/90 border border-white/10 shadow-lg cursor-pointer"
                    role="button"
                    aria-label="Altre info"
                >
                    <Info className="w-4 h-4" />
                </div>
            )}

            {channel.logo ? (
                <CachedImage 
                    src={channel.logo} 
                    alt={channel.name} 
                    className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-110" 
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 font-bold p-2 text-center text-sm">
                    {channel.name}
                </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-0 group-hover/card:opacity-100 group-focus/card:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3 text-left">
                <h4 className="text-white font-bold text-sm drop-shadow-md line-clamp-2 leading-snug">{channel.cleanName || channel.name}</h4>
            </div>

            {progress ? (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/50">
                    <div 
                        className="h-full bg-red-600" 
                        style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
                    />
                </div>
            ) : null}
        </button>
    );
}, (prev, next) => (
    prev.channel.id === next.channel.id && 
    prev.progress === next.progress && 
    prev.isInWatchlist === next.isInWatchlist
));

// Memoized Content Row
const ContentRow = React.memo(({ title, channels, onSelect, isPoster, progressMap, watchlistSet, onToggleWatchlist, onShowDetails }: { title: string, channels: Channel[], onSelect: (c: Channel) => void, isPoster: boolean, progressMap?: Record<string, { progress: number, duration?: number }>, watchlistSet?: Set<string>, onToggleWatchlist?: (c: Channel) => void, onShowDetails?: (c: Channel) => void }) => {
    const rowRef = useRef<HTMLDivElement>(null);

    if (channels.length === 0) return null;

    return (
        <div className="space-y-3 group/row py-2">
            <h2 className="text-xl font-semibold text-gray-200 group-hover/row:text-white transition-colors pl-1 flex items-center gap-2">
                {title} <ChevronRight className="w-4 h-4 opacity-0 group-hover/row:opacity-100 transition-opacity text-gray-400" />
            </h2>
            
            <div className="relative">
                <div 
                    ref={rowRef}
                    className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth px-1 py-4"
                >
                    {channels.map((channel) => (
                        <ChannelItem 
                            key={channel.id}
                            channel={channel}
                            onSelect={onSelect}
                            isPoster={isPoster}
                            progress={progressMap?.[channel.id]?.progress}
                            isInWatchlist={watchlistSet?.has(channel.id)}
                            onToggleWatchlist={onToggleWatchlist}
                            onShowDetails={onShowDetails}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
});

const ChannelList: React.FC<ChannelListProps> = ({ 
  categories, 
  liveCategories = [],
  vodCategories = [],
  seriesCategories = [],
  onSelectChannel,
  currentChannelId,
  activeTab,
  setActiveTab,
  profileName,
  profileColor,
  onLogout,
  onOpenServer,
  onOpenSettings,
  history,
  watchlistIds,
  onToggleWatchlist,
  allChannels,
  onShowDetails
}) => {
  const { t } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [scrolled, setScrolled] = useState(false);
  const [featuredItem, setFeaturedItem] = useState<Channel | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Debounce search term per performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Performance: Lazy Loading Rows
  const [visibleRows, setVisibleRows] = useState(5);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const progressMap = useMemo(() => {
      return history.reduce<Record<string, { progress: number, duration?: number }>>((acc, item) => {
          if (item.progress && item.progress > 0) {
              acc[item.channelId] = { progress: item.progress, duration: item.duration };
          }
          return acc;
      }, {});
  }, [history]);

  const continueWatching = useMemo(() => {
      // Per la Home usa tutti i canali, altrimenti usa solo quelli della categoria corrente
      const channelsToUse = activeTab === 'home' ? allChannels : categories.flatMap(c => c.channels);
      const seen = new Set<string>();

      return history
          .filter(h => h.progress && h.progress > 0 && h.progress < 0.95)
          // Filtra per tipo se non siamo nella Home
          .filter(h => {
              if (activeTab === 'home') return true;
              // Filtra in base al tipo di tab attivo
              return h.type === activeTab;
          })
          .map(h => {
              const channel = channelsToUse.find(c => c.id === h.channelId);
              if (channel) {
                  return { channel, timestamp: h.timestamp, progress: h.progress };
              }
              return null;
          })
          .filter((item): item is { channel: Channel; timestamp: number; progress: number } => !!item)
          .filter(item => {
              if (seen.has(item.channel.id)) return false;
              seen.add(item.channel.id);
              return true;
          })
          .sort((a, b) => b.timestamp - a.timestamp)
          .map(item => item.channel);
  }, [categories, history, activeTab, allChannels]);

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  const watchlistChannels = useMemo(() => {
      const seen = new Set<string>();
      return watchlistIds
        .map(id => allChannels.find(c => c.id === id))
        .filter((c): c is Channel => !!c)
        .filter(channel => {
            if (seen.has(channel.id)) return false;
            seen.add(channel.id);
            return true;
        });
  }, [watchlistIds, allChannels]);

  // Home page categories - mix di contenuti ottimizzato
  const homeCategories = useMemo(() => {
      if (activeTab !== 'home') return [];

      const homeCats: Category[] = [];

      // Raccogli tutti i canali
      const allLive = liveCategories.flatMap(c => c.channels);
      const allMovies = vodCategories.flatMap(c => c.channels);
      const allSeries = seriesCategories.flatMap(c => c.channels);

      // 1. Film in primo piano (con rating alto se disponibile)
      if (allMovies.length > 0) {
          const topMovies = [...allMovies]
            .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
            .slice(0, 20);
          homeCats.push({ name: '🎬 ' + t.movies + ' - Top Rated', channels: topMovies });
      }

      // 2. Serie TV in evidenza
      if (allSeries.length > 0) {
          const topSeries = [...allSeries]
            .sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
            .slice(0, 20);
          homeCats.push({ name: '📺 ' + t.series + ' - Top Rated', channels: topSeries });
      }

      // 3. Canali Live - In diretta
      if (allLive.length > 0) {
          homeCats.push({ name: '📡 ' + t.live + ' - ' + t.popular, channels: allLive.slice(0, 20) });
      }

      // 4. Film recenti (ultimi aggiunti)
      if (allMovies.length > 0) {
          homeCats.push({ name: '🆕 ' + t.movies + ' - Novità', channels: allMovies.slice(0, 20) });
      }

      // 5. Serie recenti
      if (allSeries.length > 0) {
          homeCats.push({ name: '🆕 ' + t.series + ' - Novità', channels: allSeries.slice(0, 20) });
      }

      // 6. Aggiungi categorie specifiche di film (max 4)
      vodCategories.slice(0, 4).forEach(cat => {
          if (cat.channels.length >= 5) {
              homeCats.push({ name: '🎬 ' + cat.name, channels: cat.channels.slice(0, 15) });
          }
      });

      // 7. Aggiungi categorie specifiche di serie (max 4)
      seriesCategories.slice(0, 4).forEach(cat => {
          if (cat.channels.length >= 5) {
              homeCats.push({ name: '📺 ' + cat.name, channels: cat.channels.slice(0, 15) });
          }
      });

      // 8. Categorie Live (max 2)
      liveCategories.slice(0, 2).forEach(cat => {
          if (cat.channels.length >= 5) {
              homeCats.push({ name: '📡 ' + cat.name, channels: cat.channels.slice(0, 15) });
          }
      });

      return homeCats;
  }, [activeTab, liveCategories, vodCategories, seriesCategories, t]);


  // Clock Update
  useEffect(() => {
      const timer = setInterval(() => setCurrentTime(new Date()), 60000);
      return () => clearInterval(timer);
  }, []);

  // Navbar Scroll
  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Featured Item - Seleziona contenuto di qualità per l'Hero
  useEffect(() => {
    // Per la Home, usa contenuti da tutte le categorie
    const sourceChannels = activeTab === 'home'
      ? [...vodCategories.flatMap(c => c.channels), ...seriesCategories.flatMap(c => c.channels)]
      : categories.flatMap(c => c.channels);

    if (sourceChannels.length > 0) {
      // Filtra per contenuti con immagine e preferibilmente con descrizione/rating
      const qualityItems = sourceChannels.filter(c =>
        c.logo && (c.description || c.rating)
      );

      // Ordina per rating (decrescente) e prendi i migliori
      const topItems = qualityItems.length > 0
        ? [...qualityItems].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0)).slice(0, 10)
        : sourceChannels.filter(c => c.logo).slice(0, 10);

      if (topItems.length > 0) {
        // Seleziona random tra i top 10
        const random = topItems[Math.floor(Math.random() * topItems.length)];
        setFeaturedItem(random);
      } else if (sourceChannels[0]) {
        setFeaturedItem(sourceChannels[0]);
      }
    }
  }, [categories, activeTab, vodCategories, seriesCategories]);

  // Focus Restoration
  useEffect(() => {
    if (currentChannelId) {
        setTimeout(() => {
            const el = document.getElementById(`channel-${currentChannelId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
                el.focus();
            }
        }, 300);
    }
  }, [currentChannelId, activeTab, categories]);

  // Infinite Scroll Observer
  useEffect(() => {
      const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
              setVisibleRows(prev => Math.min(prev + 5, filteredCategories.length));
          }
      }, { rootMargin: '400px' });

      if (loadMoreRef.current) observer.observe(loadMoreRef.current);
      return () => observer.disconnect();
  }, [categories, searchTerm]);

  // Spatial Navigation logic (Existing)
  useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
          const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
          if (!navKeys.includes(e.key)) return;

          e.preventDefault();

          const current = document.activeElement as HTMLElement;
          if (!current || !current.classList.contains('tv-focus')) return;

          const allFocusable = Array.from(document.querySelectorAll<HTMLElement>('.tv-focus'));
          const currentRect = current.getBoundingClientRect();
          let bestCandidate: HTMLElement | null = null;
          let minDistance = Infinity;

          allFocusable.forEach(candidate => {
              if (candidate === current) return;
              const candRect = candidate.getBoundingClientRect();
              
              let isDirectionCorrect = false;
              let distance = Infinity;
              const curX = currentRect.left + currentRect.width / 2;
              const curY = currentRect.top + currentRect.height / 2;
              const candX = candRect.left + candRect.width / 2;

              switch (e.key) {
                  case 'ArrowRight':
                      isDirectionCorrect = candRect.left >= currentRect.left;
                      if (Math.abs(curY - (candRect.top + candRect.height / 2)) < 50 && candRect.left > currentRect.right - 10) {
                          distance = candRect.left - currentRect.right;
                      } else { isDirectionCorrect = false; }
                      break;
                  case 'ArrowLeft':
                      if (Math.abs(curY - (candRect.top + candRect.height / 2)) < 50 && candRect.right < currentRect.left + 10) {
                          isDirectionCorrect = true;
                          distance = currentRect.left - candRect.right;
                      }
                      break;
                  case 'ArrowDown':
                      if (candRect.top > currentRect.bottom - 10) {
                          isDirectionCorrect = true;
                          const dx = Math.abs(curX - candX);
                          const dy = candRect.top - currentRect.bottom;
                          distance = Math.sqrt(dx * dx * 2 + dy * dy); 
                      }
                      break;
                  case 'ArrowUp':
                      if (candRect.bottom < currentRect.top + 10) {
                          isDirectionCorrect = true;
                          const dx = Math.abs(curX - candX);
                          const dy = currentRect.top - candRect.bottom;
                          distance = Math.sqrt(dx * dx * 2 + dy * dy);
                      }
                      break;
              }

              if (isDirectionCorrect && distance < minDistance) {
                  minDistance = distance;
                  bestCandidate = candidate;
              }
          });

          if (bestCandidate) {
              (bestCandidate as HTMLElement).focus();
              (bestCandidate as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Usa homeCategories per la Home, altrimenti le categorie normali
  const activeCategories = useMemo(() => {
      return activeTab === 'home' ? homeCategories : categories;
  }, [activeTab, homeCategories, categories]);

  const filteredCategories = useMemo(() => {
    if (!debouncedSearchTerm) return activeCategories;

    // Ottimizza la ricerca: cerca solo se il termine ha almeno 2 caratteri
    if (debouncedSearchTerm.length < 2) return activeCategories;

    const lowerSearch = debouncedSearchTerm.toLowerCase();

    // Determina quali canali cercare in base alla tab attiva
    let channelsToSearch: Channel[];
    switch (activeTab) {
      case 'movie':
        channelsToSearch = vodCategories.flatMap(c => c.channels);
        break;
      case 'series':
        channelsToSearch = seriesCategories.flatMap(c => c.channels);
        break;
      case 'live':
        channelsToSearch = liveCategories.flatMap(c => c.channels);
        break;
      case 'home':
      default:
        channelsToSearch = allChannels;
        break;
    }

    // Cerca nei canali appropriati
    const searchChannels = channelsToSearch.filter(ch =>
        ch.name.toLowerCase().includes(lowerSearch) ||
        (ch.cleanName && ch.cleanName.toLowerCase().includes(lowerSearch))
    );

    if (searchChannels.length > 0) {
        // Limita i risultati per performance
        return [{ name: t.search + ` (${searchChannels.length})`, channels: searchChannels.slice(0, 100) }];
    }
    return [];
  }, [activeCategories, debouncedSearchTerm, allChannels, activeTab, vodCategories, seriesCategories, liveCategories, t]);

  const displayedCategories = filteredCategories.slice(0, visibleRows);

  const reloadPage = () => window.location.reload();

  return (
    <div className="min-h-screen bg-[#141414] font-sans pb-20">
      
      {/* --- NAVBAR --- */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-500 px-4 md:px-12 py-3 flex items-center justify-between ${scrolled ? 'bg-[#141414] shadow-xl' : 'bg-gradient-to-b from-black/90 via-black/50 to-transparent'}`}>
         <div className="flex items-center gap-8">
             <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-red-500 tracking-tighter cursor-pointer drop-shadow-sm" onClick={() => {window.scrollTo({top:0, behavior:'smooth'})}}>STREAMAI</h1>
             
             <div className="hidden md:flex gap-4 text-sm font-medium text-gray-300">
                 {(['home', 'live', 'movie', 'series'] as StreamType[]).map(tab => (
                     <button
                        key={tab}
                        onClick={() => { setActiveTab(tab); window.scrollTo({top:0, behavior:'smooth'}); setVisibleRows(5); }}
                        className={`tv-focus px-4 py-2 rounded-md transition-all outline-none focus:ring-2 focus:ring-white ${activeTab === tab ? 'bg-white/10 text-white font-bold' : 'hover:text-white hover:bg-white/5'}`}
                        tabIndex={0}
                     >
                         {tab === 'home' ? t.home : tab === 'live' ? t.live : tab === 'movie' ? t.movies : t.series}
                     </button>
                 ))}
             </div>
         </div>

         <div className="flex items-center gap-6 text-white">
             {/* Clock */}
             <div className="hidden lg:flex items-center gap-2 text-gray-300 font-mono text-sm bg-black/30 px-3 py-1 rounded-full border border-white/5">
                 <Clock className="w-3 h-3" />
                 <span>{currentTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
             </div>

             <div className={`flex items-center gap-2 bg-black/50 border border-white/30 rounded-full px-4 py-2 transition-all duration-300 ${searchTerm ? 'w-72 bg-black/90 ring-2 ring-red-500/50 border-red-500/50' : 'w-48 hover:w-56 hover:bg-black/70'}`}>
                 <Search className="w-5 h-5 text-gray-400 flex-shrink-0" />
                 <input
                    type="text" 
                    placeholder={t.search + '...'}
                    className="tv-focus bg-transparent text-sm text-white placeholder-gray-400 outline-none w-full"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    tabIndex={0}
                 />
                 {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                 )}
             </div>
             
             <button onClick={onOpenServer} className="hidden md:block tv-focus text-xs font-bold border border-white/30 px-3 py-1.5 rounded hover:bg-white/10 tracking-wide uppercase outline-none focus:ring-2 focus:ring-white" tabIndex={0}>SERVER</button>
             
             <div className="group relative flex items-center gap-2 cursor-pointer z-50">
                 <button className="tv-focus rounded-lg focus:ring-2 focus:ring-white outline-none" tabIndex={0}>
                     <div className="w-9 h-9 rounded-lg bg-cover shadow-lg" style={{ backgroundColor: profileColor }}></div>
                 </button>
                 
                 <div className="absolute top-full right-0 mt-3 w-56 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible focus-within:opacity-100 focus-within:visible transition-all transform origin-top-right">
                    <div className="px-4 py-3 border-b border-white/5 text-xs text-gray-400">
                        {t.activeProfile}: <br/>
                        <span className="text-white font-bold text-sm">{profileName}</span>
                    </div>
                    
                    <button onClick={reloadPage} className="tv-focus w-full text-left px-4 py-3 text-sm hover:bg-white/5 flex items-center gap-3 text-blue-400 font-medium outline-none focus:bg-white/10" tabIndex={0}>
                        <RefreshCw className="w-4 h-4" /> {t.refreshCache}
                    </button>

                    <button onClick={onOpenSettings} className="tv-focus w-full text-left px-4 py-3 text-sm hover:bg-white/5 flex items-center gap-3 text-gray-300 font-medium outline-none focus:bg-white/10" tabIndex={0}>
                        <Settings className="w-4 h-4" /> {t.settings}
                    </button>

                    <button onClick={onLogout} className="tv-focus w-full text-left px-4 py-3 text-sm hover:bg-white/5 flex items-center gap-3 text-red-400 font-medium outline-none focus:bg-white/10" tabIndex={0}>
                        <LogOut className="w-4 h-4" /> {t.logout}
                    </button>
                 </div>
             </div>
         </div>
      </nav>

      {/* --- HERO SECTION --- */}
      {!searchTerm && featuredItem ? (
          <div className="relative h-[85vh] w-full group">
              <div className="absolute inset-0">
                  <CachedImage 
                    src={featuredItem.logo || ''} 
                    alt="Hero" 
                    className="w-full h-full object-cover object-top transition-transform duration-[10s] group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/50 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-transparent" />
              </div>

              <div className="absolute bottom-[20%] left-4 md:left-12 max-w-2xl z-10 animate-slide-up">
                  {featuredItem.rating && (
                      <div className="flex items-center gap-3 mb-4">
                           <span className="bg-green-600/90 text-white px-2 py-0.5 rounded text-xs font-bold shadow-md">Match {Number(featuredItem.rating) * 10}%</span>
                           <span className="text-gray-300 text-sm font-medium">{featuredItem.year}</span>
                           <span className="border border-gray-500/50 px-1.5 text-[10px] text-gray-400 rounded">HD</span>
                      </div>
                  )}
                  <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 text-shadow-lg leading-none tracking-tight">
                      {featuredItem.cleanName || featuredItem.name}
                  </h1>
                  <p className="text-lg text-gray-300 mb-8 line-clamp-3 text-shadow max-w-xl font-light leading-relaxed">
                      {featuredItem.description || "Contenuto in evidenza scelti per te."}
                  </p>
                  
                  <div className="flex items-center gap-4">
                      <button 
                        onClick={() => onSelectChannel(featuredItem)}
                        className="tv-focus flex items-center gap-3 bg-white text-black px-8 py-3.5 rounded font-bold text-xl hover:bg-gray-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.2)] outline-none focus:ring-4 focus:ring-red-600"
                        tabIndex={0}
                      >
                          <Play className="w-6 h-6 fill-black" /> Riproduci
                      </button>
                      <button 
                        className="tv-focus flex items-center gap-3 bg-gray-600/60 text-white px-8 py-3.5 rounded font-bold text-xl hover:bg-gray-600/80 backdrop-blur border border-white/10 transition-colors outline-none focus:ring-4 focus:ring-white" 
                        tabIndex={0}
                        onClick={() => {
                            if (featuredItem.type === 'movie') {
                                onShowDetails(featuredItem);
                            } else {
                                onSelectChannel(featuredItem);
                            }
                        }}
                      >
                          <Info className="w-6 h-6" /> Altre Info
                      </button>
                  </div>
              </div>
          </div>
      ) : !searchTerm ? (
          /* Hero Skeleton */
          <div className="relative h-[85vh] w-full bg-[#1a1a1a] flex items-end p-12">
               <div className="w-full max-w-2xl space-y-4">
                   <div className="h-4 w-24 rounded skeleton mb-4"></div>
                   <div className="h-16 w-3/4 rounded-lg skeleton"></div>
                   <div className="h-4 w-1/2 rounded skeleton"></div>
                   <div className="h-4 w-1/3 rounded skeleton"></div>
                   <div className="flex gap-4 mt-8">
                       <div className="h-14 w-40 rounded skeleton"></div>
                       <div className="h-14 w-40 rounded skeleton"></div>
                   </div>
               </div>
          </div>
      ) : null}

      {/* --- CONTENT ROWS (VIRTUALIZED) --- */}
      <div className={`relative z-20 px-4 md:px-12 space-y-10 ${!searchTerm && featuredItem ? '-mt-32' : 'mt-28'}`}>
          {!searchTerm && watchlistChannels.length > 0 && (
              <ContentRow 
                  title={t.myList}
                  channels={watchlistChannels}
                  onSelect={onSelectChannel}
                  isPoster={activeTab === 'movie' || (activeTab === 'home' && watchlistChannels.some(ch => ch.type === 'movie'))}
                  progressMap={progressMap}
                  watchlistSet={watchlistSet}
                  onToggleWatchlist={(c) => onToggleWatchlist(c.id)}
                  onShowDetails={onShowDetails}
              />
          )}

          {!searchTerm && continueWatching.length > 0 && (
              <ContentRow 
                  title={t.continueWatching}
                  channels={continueWatching}
                  onSelect={onSelectChannel}
                  isPoster={activeTab === 'movie' || (activeTab === 'home' && continueWatching.some(ch => ch.type === 'movie'))}
                  progressMap={progressMap}
                  watchlistSet={watchlistSet}
                  onToggleWatchlist={(c) => onToggleWatchlist(c.id)}
                  onShowDetails={onShowDetails}
              />
          )}

          {displayedCategories.length > 0 ? (
              displayedCategories.map((cat) => {
                  // Verifica se la categoria contiene film (per usare poster style)
                  const hasMovies = cat.channels.some(ch => ch.type === 'movie');
                  return (
                      <ContentRow
                        key={cat.name}
                        title={cat.name}
                        channels={cat.channels}
                        onSelect={onSelectChannel}
                        isPoster={activeTab === 'movie' || (activeTab === 'home' && hasMovies)}
                        progressMap={progressMap}
                        watchlistSet={watchlistSet}
                        onToggleWatchlist={(c) => onToggleWatchlist(c.id)}
                        onShowDetails={onShowDetails}
                      />
                  );
              })
          ) : (
              // Loading State Skeletons
              Array.from({length: 4}).map((_, i) => (
                   <div key={i} className="space-y-3">
                       <div className="h-6 w-48 rounded skeleton"></div>
                       <div className="flex gap-4 overflow-hidden">
                           {Array.from({length: 6}).map((_, j) => (
                               <div key={j} className={`shrink-0 rounded-md skeleton ${activeTab === 'movie' ? 'w-[150px] aspect-[2/3]' : 'w-[300px] aspect-[16/9]'}`}></div>
                           ))}
                       </div>
                   </div>
              ))
          )}

          {/* Load More Trigger */}
          <div ref={loadMoreRef} className="h-20 w-full" />

          {filteredCategories.length === 0 && debouncedSearchTerm && (
              <div className="text-center py-20 text-gray-500 text-xl">
                  {t.noResults} "{debouncedSearchTerm}"
              </div>
          )}
      </div>

    </div>
  );
};

export default ChannelList;
