// Full TV Guide view — D.1 Fase 2 IMPROVEMENT_PLAN_V2.
// Grid: rows = live channels (with tvgId), columns = time. Horizontal scroll
// covers `HOURS_WINDOW` hours starting from `now - 1h` so the user can also
// glance at what just aired. Rows are virtualized (only visible rows render
// their programme blocks) to handle thousands of channels smoothly.
//
// Interactions:
//   - Click a channel name → play it.
//   - Click a programme → open action menu (Watch now / Set reminder).
//   - Auto-scroll to "now" on mount and on jump-to-now click.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BellRing,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { Category, Channel, EpgProgramme, XtreamCredentials } from '../types';
import { useEpg } from '../hooks/useEpg';
import { EpgService } from '../services/epg';
import { EpgReminderService } from '../services/epg/reminderService';

interface GuideViewProps {
  liveCategories: Category[];
  xtreamCreds: XtreamCredentials | null;
  onPlayChannel: (channel: Channel) => void;
  onBack: () => void;
}

// Layout constants.
const PIXELS_PER_HOUR = 220;
const PIXELS_PER_MS = PIXELS_PER_HOUR / (60 * 60 * 1000);
const ROW_HEIGHT = 68;
const CHANNEL_COL_WIDTH = 200;
const HEADER_HEIGHT = 48;
const HOURS_WINDOW = 24; // total guide width: 24h
const HOURS_BEFORE_NOW = 1; // start 1h before now so recent past is visible

const snapToHour = (ts: number, mode: 'floor' | 'ceil'): number => {
  const d = new Date(ts);
  d.setMinutes(0, 0, 0);
  if (mode === 'ceil' && d.getTime() < ts) d.setHours(d.getHours() + 1);
  return d.getTime();
};

const formatHourLabel = (ts: number): string =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const formatDayLabel = (ts: number): string => {
  const d = new Date(ts);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return 'Oggi';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });
};

interface ProgrammeMenuState {
  channel: Channel;
  programme: EpgProgramme;
  /** Anchor position (page coords) — used to place the popover. */
  x: number;
  y: number;
}

const GuideView: React.FC<GuideViewProps> = ({
  liveCategories,
  xtreamCreds,
  onPlayChannel,
  onBack,
}) => {
  const { isLoading, error, isLoaded, refresh } = useEpg(xtreamCreds, { enabled: true });

  // Channels eligible for the guide: live channels that have a tvgId (else we
  // can't match EPG). Fallback: if no tvgIds at all, still show channels so
  // the user understands the limitation.
  const allLiveChannels = useMemo<Channel[]>(
    () => liveCategories.flatMap(c => c.channels).filter(c => c.type !== 'series'),
    [liveCategories],
  );
  const hasAnyTvgId = useMemo(() => allLiveChannels.some(c => c.tvgId), [allLiveChannels]);
  const baseChannels = useMemo(
    () => (hasAnyTvgId ? allLiveChannels.filter(c => c.tvgId) : allLiveChannels),
    [allLiveChannels, hasAnyTvgId],
  );

  // Category filter.
  const categoryOptions = useMemo<string[]>(() => {
    const names = new Set<string>();
    for (const cat of liveCategories) {
      if (cat.channels.some(c => baseChannels.includes(c))) names.add(cat.name);
    }
    return Array.from(names);
  }, [liveCategories, baseChannels]);
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const [search, setSearch] = useState('');

  const channels = useMemo(() => {
    let list = baseChannels;
    if (activeCategory !== 'all') {
      const cat = liveCategories.find(c => c.name === activeCategory);
      const allowed = new Set(cat?.channels.map(c => c.id) ?? []);
      list = list.filter(c => allowed.has(c.id));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(c =>
        (c.cleanNameLower || c.nameLower || c.name.toLowerCase()).includes(q),
      );
    }
    return list;
  }, [baseChannels, activeCategory, liveCategories, search]);

  // Time window: [windowStart, windowEnd]. windowStart = snap(now - 1h, floor).
  const [windowStart, setWindowStart] = useState<number>(() =>
    snapToHour(Date.now() - HOURS_BEFORE_NOW * 60 * 60 * 1000, 'floor'),
  );
  const windowEnd = windowStart + HOURS_WINDOW * 60 * 60 * 1000;
  const totalWidth = HOURS_WINDOW * PIXELS_PER_HOUR;

  // Hour ticks for the header.
  const hourTicks = useMemo<number[]>(() => {
    const ticks: number[] = [];
    for (let i = 0; i <= HOURS_WINDOW; i++) {
      ticks.push(windowStart + i * 60 * 60 * 1000);
    }
    return ticks;
  }, [windowStart]);

  // Live "now" tick — refresh every 30s so the red line stays current.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const nowOffsetPx = Math.max(0, Math.min(totalWidth, (now - windowStart) * PIXELS_PER_MS));
  const nowInsideWindow = now >= windowStart && now <= windowEnd;

  // Scroll containers: bodyRef scrolls vertically (rows) AND horizontally
  // (timeline). headerRef mirrors only horizontal scroll. channelColRef
  // mirrors only vertical scroll.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const channelColRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      setViewportHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleBodyScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setScrollTop(el.scrollTop);
    if (headerRef.current) headerRef.current.scrollLeft = el.scrollLeft;
    if (channelColRef.current) channelColRef.current.scrollTop = el.scrollTop;
  }, []);

  // Auto-scroll to "now" on first mount once layout is ready.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    const el = bodyRef.current;
    if (!el || el.clientWidth === 0) return;
    didInitialScrollRef.current = true;
    const target = Math.max(0, (Date.now() - windowStart) * PIXELS_PER_MS - el.clientWidth / 3);
    el.scrollLeft = target;
    if (headerRef.current) headerRef.current.scrollLeft = target;
  }, [windowStart]);

  const jumpToNow = () => {
    const el = bodyRef.current;
    if (!el) return;
    if (!nowInsideWindow) {
      setWindowStart(snapToHour(Date.now() - HOURS_BEFORE_NOW * 60 * 60 * 1000, 'floor'));
      return;
    }
    const target = Math.max(0, (Date.now() - windowStart) * PIXELS_PER_MS - el.clientWidth / 3);
    el.scrollTo({ left: target, behavior: 'smooth' });
  };

  // Day stepping: move window by ±24h.
  const stepDay = (dir: 1 | -1) => {
    setWindowStart(prev => snapToHour(prev + dir * 24 * 60 * 60 * 1000, 'floor'));
    didInitialScrollRef.current = true; // don't re-snap to "now"
  };

  // ---- Virtualization (rows only) ---------------------------------------
  const OVERSCAN = 4;
  const totalRows = channels.length;
  const totalHeight = totalRows * ROW_HEIGHT;
  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastVisible = Math.min(
    totalRows,
    Math.ceil((scrollTop + (viewportHeight || 600)) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleChannels = channels.slice(firstVisible, lastVisible);
  const offsetY = firstVisible * ROW_HEIGHT;

  // ---- Programme menu ---------------------------------------------------
  const [menu, setMenu] = useState<ProgrammeMenuState | null>(null);
  const [reminderTick, setReminderTick] = useState(0); // bump to re-evaluate has()
  useEffect(() => {
    EpgReminderService.ensureScheduler();
    const off = EpgReminderService.onFired(() => setReminderTick(t => t + 1));
    return () => off();
  }, []);

  // Close menu on outside click / Esc.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-guide-menu]')) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleProgrammeClick = (
    channel: Channel,
    programme: EpgProgramme,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setMenu({
      channel,
      programme,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleToggleReminder = (channel: Channel, programme: EpgProgramme) => {
    EpgReminderService.toggle({ id: channel.id, name: channel.name, tvgId: channel.tvgId }, programme);
    setReminderTick(t => t + 1);
    setMenu(null);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-[#0a0a0a] flex flex-col text-gray-100">
      {/* === Top toolbar =================================================== */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-black/60 backdrop-blur-md">
        <button
          onClick={onBack}
          aria-label="Torna indietro"
          className="tv-focus touch-target p-2 rounded-full hover:bg-white/10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Calendar className="w-5 h-5 text-red-400 flex-shrink-0" />
        <h1 className="text-lg font-bold truncate">Guida TV</h1>

        <div className="flex items-center gap-1 ml-2 text-xs">
          <button
            onClick={() => stepDay(-1)}
            aria-label="Giorno precedente"
            className="tv-focus touch-target p-2 rounded-full hover:bg-white/10"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="tabular-nums text-gray-300 px-2 min-w-[110px] text-center">
            {formatDayLabel(windowStart + 12 * 60 * 60 * 1000)}
          </span>
          <button
            onClick={() => stepDay(1)}
            aria-label="Giorno successivo"
            className="tv-focus touch-target p-2 rounded-full hover:bg-white/10"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <button
          onClick={jumpToNow}
          className="tv-focus touch-target text-xs font-bold px-3 py-1.5 rounded-full bg-red-600 hover:bg-red-500"
        >
          ORA
        </button>

        <div className="flex-1" />

        <div className="hidden md:flex items-center gap-2 bg-white/5 rounded-full px-3 py-1.5">
          <Search className="w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Cerca canale…"
            aria-label="Cerca canale nella guida"
            className="bg-transparent text-sm outline-none placeholder-gray-500 w-44"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Cancella ricerca"
              className="tv-focus touch-target text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={refresh}
          disabled={isLoading}
          aria-label="Aggiorna EPG"
          title="Aggiorna EPG"
          className="tv-focus touch-target p-2 rounded-full hover:bg-white/10 text-gray-300 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* === Category chips ================================================ */}
      {categoryOptions.length > 0 && (
        <div className="flex gap-2 px-4 py-2 overflow-x-auto border-b border-white/5 bg-black/30 scrollbar-hide">
          <button
            onClick={() => setActiveCategory('all')}
            className={`tv-focus flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full ${
              activeCategory === 'all'
                ? 'bg-white text-black'
                : 'bg-white/5 text-gray-300 hover:bg-white/10'
            }`}
          >
            Tutti
          </button>
          {categoryOptions.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`tv-focus flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full ${
                activeCategory === cat
                  ? 'bg-white text-black'
                  : 'bg-white/5 text-gray-300 hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* === States ======================================================== */}
      {error && !isLoaded && (
        <div className="px-4 py-3 bg-red-950/30 border-b border-red-500/30 text-sm text-red-200">
          Impossibile caricare l'EPG: {error}
        </div>
      )}
      {!hasAnyTvgId && allLiveChannels.length > 0 && (
        <div className="px-4 py-2 bg-amber-950/30 border-b border-amber-500/20 text-xs text-amber-200">
          Nessun canale ha un identificatore EPG (tvg-id). La guida è vuota.
          Controlla che la playlist M3U includa <code>tvg-id</code> o che Xtream
          esponga <code>epg_channel_id</code>.
        </div>
      )}

      {/* === Grid ========================================================== */}
      <div className="flex-1 flex min-h-0">
        {/* Channel column (sticky left) */}
        <div className="flex-shrink-0 border-r border-white/5 bg-[#0d0d0d] flex flex-col" style={{ width: CHANNEL_COL_WIDTH }}>
          <div
            className="flex items-center px-3 text-[10px] uppercase tracking-widest text-gray-500 border-b border-white/5 bg-black/60"
            style={{ height: HEADER_HEIGHT }}
          >
            Canali · {channels.length}
          </div>
          <div
            ref={channelColRef}
            className="flex-1 overflow-hidden"
            style={{ contain: 'strict' as React.CSSProperties['contain'] }}
          >
            <div style={{ height: totalHeight, position: 'relative' }}>
              <div style={{ transform: `translateY(${offsetY}px)` }}>
                {visibleChannels.map(channel => (
                  <button
                    key={channel.id}
                    onClick={() => onPlayChannel(channel)}
                    title={`Guarda ${channel.name}`}
                    className="tv-focus w-full flex items-center gap-2 px-3 text-left hover:bg-white/5 border-b border-white/5"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {channel.logo ? (
                      <img
                        src={channel.logo}
                        alt=""
                        className="w-10 h-10 rounded object-contain bg-black/40 flex-shrink-0"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded bg-white/5 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">{channel.name}</div>
                      {channel.group && (
                        <div className="text-[10px] text-gray-500 truncate">{channel.group}</div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Timeline + body */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Sticky timeline header */}
          <div
            ref={headerRef}
            className="overflow-hidden bg-black/60 border-b border-white/5"
            style={{ height: HEADER_HEIGHT }}
          >
            <div className="relative" style={{ width: totalWidth, height: HEADER_HEIGHT }}>
              {hourTicks.map((ts, i) => (
                <div
                  key={ts}
                  className="absolute top-0 bottom-0 flex flex-col justify-center border-l border-white/5 text-[11px] text-gray-300 tabular-nums pl-2"
                  style={{
                    left: (ts - windowStart) * PIXELS_PER_MS,
                    width: PIXELS_PER_HOUR,
                  }}
                >
                  <span>{formatHourLabel(ts)}</span>
                  {i === 0 || new Date(ts).getHours() === 0 ? (
                    <span className="text-[9px] text-gray-500 uppercase">
                      {formatDayLabel(ts)}
                    </span>
                  ) : null}
                </div>
              ))}
              {nowInsideWindow && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500 z-10"
                  style={{ left: nowOffsetPx }}
                >
                  <div className="absolute -top-px left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-bold rounded-b">
                    ORA
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Scrollable body (both axes) */}
          <div
            ref={bodyRef}
            onScroll={handleBodyScroll}
            className="flex-1 overflow-auto relative"
          >
            <div
              style={{
                width: totalWidth,
                height: totalHeight,
                position: 'relative',
              }}
            >
              {/* Vertical "now" line */}
              {nowInsideWindow && (
                <div
                  className="absolute top-0 bottom-0 w-px bg-red-500/80 pointer-events-none z-[5]"
                  style={{ left: nowOffsetPx }}
                />
              )}

              {/* Rows */}
              <div style={{ transform: `translateY(${offsetY}px)` }}>
                {visibleChannels.map((channel, idx) => (
                  <GuideRow
                    key={channel.id}
                    channel={channel}
                    rowIndex={firstVisible + idx}
                    windowStart={windowStart}
                    windowEnd={windowEnd}
                    onProgrammeClick={handleProgrammeClick}
                    reminderTick={reminderTick}
                  />
                ))}
              </div>

              {channels.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                  Nessun canale corrisponde ai filtri attivi.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* === Programme menu popover ======================================= */}
      {menu && (
        <ProgrammeMenu
          state={menu}
          isReminderSet={EpgReminderService.has(menu.channel.id, menu.programme.start)}
          onClose={() => setMenu(null)}
          onWatch={() => {
            onPlayChannel(menu.channel);
            setMenu(null);
          }}
          onToggleReminder={() => handleToggleReminder(menu.channel, menu.programme)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Single row: pulls the channel's programmes from EpgService and renders the
// blocks that overlap the visible time window.
// ---------------------------------------------------------------------------
interface GuideRowProps {
  channel: Channel;
  rowIndex: number;
  windowStart: number;
  windowEnd: number;
  onProgrammeClick: (channel: Channel, programme: EpgProgramme, e: React.MouseEvent) => void;
  reminderTick: number;
}

const GuideRow: React.FC<GuideRowProps> = React.memo(
  ({ channel, rowIndex, windowStart, windowEnd, onProgrammeClick, reminderTick }) => {
    // Pull from EpgService directly (no per-row hook to avoid 100s of subs).
    // We re-evaluate via `reminderTick` (cheap) + windowStart change.
    const programmes = useMemo<EpgProgramme[]>(() => {
      if (!channel.tvgId) return [];
      const list = EpgService.getProgrammesForChannel(channel.tvgId);
      return list.filter(p => p.stop > windowStart && p.start < windowEnd);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [channel.tvgId, windowStart, windowEnd, reminderTick]);

    return (
      <div
        className={`relative border-b border-white/5 ${
          rowIndex % 2 === 0 ? 'bg-white/[0.015]' : ''
        }`}
        style={{ height: ROW_HEIGHT }}
      >
        {programmes.map((p, i) => {
          const left = Math.max(0, (p.start - windowStart) * PIXELS_PER_MS);
          const right = Math.min(
            (windowEnd - windowStart) * PIXELS_PER_MS,
            (p.stop - windowStart) * PIXELS_PER_MS,
          );
          const width = Math.max(8, right - left);
          const isLive = Date.now() >= p.start && Date.now() < p.stop;
          const hasReminder = EpgReminderService.has(channel.id, p.start);
          return (
            <button
              key={`${p.start}-${i}`}
              onClick={e => onProgrammeClick(channel, p, e)}
              className={`tv-focus absolute top-1 bottom-1 rounded-md px-2 py-1 text-left overflow-hidden transition-colors ${
                isLive
                  ? 'bg-red-600/30 border border-red-500/60 hover:bg-red-600/40'
                  : 'bg-white/5 border border-white/5 hover:bg-white/10'
              }`}
              style={{ left, width }}
              title={`${p.title}\n${new Date(p.start).toLocaleTimeString()} – ${new Date(
                p.stop,
              ).toLocaleTimeString()}`}
            >
              <div className="flex items-center gap-1">
                {hasReminder && <BellRing className="w-3 h-3 text-amber-400 flex-shrink-0" />}
                <span className="text-xs font-medium truncate">{p.title}</span>
              </div>
              <div className="text-[10px] text-gray-400 tabular-nums">
                {new Date(p.start).toLocaleTimeString(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </div>
            </button>
          );
        })}
      </div>
    );
  },
);
GuideRow.displayName = 'GuideRow';

// ---------------------------------------------------------------------------
// Action menu popover (Watch now / Set reminder).
// ---------------------------------------------------------------------------
interface ProgrammeMenuProps {
  state: ProgrammeMenuState;
  isReminderSet: boolean;
  onClose: () => void;
  onWatch: () => void;
  onToggleReminder: () => void;
}

const ProgrammeMenu: React.FC<ProgrammeMenuProps> = ({
  state,
  isReminderSet,
  onClose,
  onWatch,
  onToggleReminder,
}) => {
  const { channel, programme, x, y } = state;
  const now = Date.now();
  const isLive = now >= programme.start && now < programme.stop;
  const isPast = programme.stop <= now;
  const canRemind = !isPast && !isLive;

  // Clamp menu inside viewport.
  const MENU_W = 320;
  const MENU_H = 240;
  const left = Math.min(x, window.innerWidth - MENU_W - 16);
  const top = Math.min(y, window.innerHeight - MENU_H - 16);

  return (
    <div
      data-guide-menu
      role="dialog"
      aria-label={`Azioni programma: ${programme.title}`}
      className="fixed z-[120] w-80 bg-[#1a1a1a] border border-white/10 rounded-2xl shadow-2xl p-4 animate-in fade-in zoom-in-95 duration-150"
      style={{ left, top }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-gray-500">
            {channel.name}
          </div>
          <h3 className="text-base font-semibold leading-snug">{programme.title}</h3>
          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
            {new Date(programme.start).toLocaleString(undefined, {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            –{' '}
            {new Date(programme.stop).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Chiudi"
          className="tv-focus touch-target p-1.5 rounded-full hover:bg-white/10 text-gray-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {programme.description && (
        <p className="text-xs text-gray-300 line-clamp-4 mb-3">{programme.description}</p>
      )}

      <div className="flex flex-col gap-2">
        <button
          onClick={onWatch}
          className="tv-focus w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 rounded-lg px-3 py-2 text-sm font-bold"
        >
          <Play className="w-4 h-4" /> {isLive ? 'Guarda ora' : 'Vai al canale'}
        </button>
        <button
          onClick={onToggleReminder}
          disabled={!canRemind && !isReminderSet}
          className={`tv-focus w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            isReminderSet
              ? 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
              : 'bg-white/5 hover:bg-white/10 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          {isReminderSet ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
          {isReminderSet
            ? 'Rimuovi promemoria'
            : canRemind
            ? 'Imposta promemoria'
            : isPast
            ? 'Programma terminato'
            : 'Già in onda'}
        </button>
      </div>
    </div>
  );
};

export default GuideView;


