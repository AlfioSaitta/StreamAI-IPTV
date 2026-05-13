import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Search, X, Clock, Tv, Film, Library, Sparkles, type LucideIcon } from 'lucide-react';
import type { Channel, StreamType } from '../types.ts';
import { indexChannels, searchIndexedChannels, type IndexedChannel } from '../services/catalogIndex.ts';
import { Chip, IconButton } from './shared';

const RECENT_SEARCHES_KEY_PREFIX = 'streamai.cmdk.recent';
const MAX_RECENT = 6;
const MAX_RESULTS = 40;

type PaletteFilter = 'all' | StreamType;

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** All channels across Live + Movies + Series. */
  channels: Channel[];
  /** Called when the user picks a result. */
  onSelect: (channel: Channel) => void;
  /** Used to namespace recent searches per profile. */
  profileId?: string;
}

const FILTER_CONFIG: Array<{ id: PaletteFilter; label: string; Icon: LucideIcon }> = [
  { id: 'all', label: 'Tutto', Icon: Sparkles },
  { id: 'live', label: 'Live', Icon: Tv },
  { id: 'movie', label: 'Film', Icon: Film },
  { id: 'series', label: 'Serie', Icon: Library },
];

const TYPE_LABEL: Record<StreamType, string> = {
  home: 'Home',
  live: 'Live TV',
  movie: 'Film',
  series: 'Serie',
};

const loadRecent = (profileId?: string): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${RECENT_SEARCHES_KEY_PREFIX}.${profileId || 'default'}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
};

const saveRecent = (profileId: string | undefined, list: string[]) => {
  try {
    window.localStorage.setItem(
      `${RECENT_SEARCHES_KEY_PREFIX}.${profileId || 'default'}`,
      JSON.stringify(list.slice(0, MAX_RECENT))
    );
  } catch {
    /* ignore quota errors */
  }
};

/**
 * Highlight token matches inside a string with <mark>. Case/accent-insensitive
 * matching to mirror catalogIndex normalization, but we render the original
 * casing so user sees real channel names.
 */
const Highlight: React.FC<{ text: string; query: string }> = ({ text, query }) => {
  if (!query) return <>{text}</>;
  const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = Array.from(new Set(normalize(query).split(/\s+/).filter(t => t.length >= 2)));
  if (tokens.length === 0) return <>{text}</>;

  const normalizedText = normalize(text);
  // Build a list of [start,end] ranges to highlight.
  const ranges: Array<[number, number]> = [];
  for (const tok of tokens) {
    let from = 0;
    while (from < normalizedText.length) {
      const idx = normalizedText.indexOf(tok, from);
      if (idx === -1) break;
      ranges.push([idx, idx + tok.length]);
      from = idx + tok.length;
    }
  }
  if (ranges.length === 0) return <>{text}</>;
  ranges.sort((a, b) => a[0] - b[0]);

  // Merge overlapping ranges.
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([s, e], i) => {
    if (cursor < s) out.push(<span key={`p${i}`}>{text.slice(cursor, s)}</span>);
    out.push(
      <mark key={`m${i}`} className="bg-state-warning/30 text-state-warning rounded px-0.5">
        {text.slice(s, e)}
      </mark>
    );
    cursor = e;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
};

const TypeIcon: React.FC<{ type?: StreamType; className?: string }> = ({ type, className = 'w-icon-sm h-icon-sm' }) => {
  if (type === 'live') return <Tv className={className} aria-hidden="true" />;
  if (type === 'movie') return <Film className={className} aria-hidden="true" />;
  if (type === 'series') return <Library className={className} aria-hidden="true" />;
  return <Sparkles className={className} aria-hidden="true" />;
};

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose, channels, onSelect, profileId }) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PaletteFilter>('all');
  const [activeIndex, setActiveIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // React 19 (B.5): switching the category chip re-runs the (potentially
  // expensive) filtered-index memo. Wrapping it in a transition keeps the
  // chip highlight + keyboard focus snappy while the result list catches
  // up in a low-priority render.
  const [isFilterPending, startFilterTransition] = useTransition();
  const changeFilter = useCallback((next: PaletteFilter) => {
    startFilterTransition(() => setFilter(next));
  }, []);

  const deferredQuery = useDeferredValue(query);

  // Reset transient state when (re)opening; also load recent searches.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setFilter('all');
    setActiveIndex(0);
    setRecent(loadRecent(profileId));
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [isOpen, profileId]);

  // Index channels lazily — only when palette is open. Avoid recomputation on each keystroke.
  const indexed: IndexedChannel[] = useMemo(() => {
    if (!isOpen) return [];
    return indexChannels(channels);
  }, [isOpen, channels]);

  const filteredIndex = useMemo(() => {
    if (filter === 'all') return indexed;
    return indexed.filter(c => c.type === filter);
  }, [indexed, filter]);

  const results = useMemo<IndexedChannel[]>(() => {
    if (!isOpen) return [];
    const trimmed = deferredQuery.trim();
    if (trimmed.length < 2) {
      // No query → show first slice (alphabetical-ish based on insertion order).
      return filteredIndex.slice(0, MAX_RESULTS);
    }
    return searchIndexedChannels(filteredIndex, trimmed, MAX_RESULTS);
  }, [isOpen, deferredQuery, filteredIndex]);

  useEffect(() => {
    setActiveIndex(0);
  }, [deferredQuery, filter]);

  // Scroll the active item into view as the user navigates with arrow keys.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    if (node) node.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const commit = useCallback((channel: Channel) => {
    const q = query.trim();
    if (q.length >= 2) {
      const next = [q, ...recent.filter(r => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
      setRecent(next);
      saveRecent(profileId, next);
    }
    onSelect(channel);
    onClose();
  }, [query, recent, profileId, onSelect, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, Math.max(0, results.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(Math.max(0, results.length - 1));
      return;
    }
    if (e.key === 'Enter') {
      const target = results[activeIndex];
      if (target) {
        e.preventDefault();
        commit(target);
      }
      return;
    }
    // Tab cycles filter chips.
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const idx = FILTER_CONFIG.findIndex(f => f.id === filter);
      const next = FILTER_CONFIG[(idx + 1) % FILTER_CONFIG.length];
      changeFilter(next.id);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      const idx = FILTER_CONFIG.findIndex(f => f.id === filter);
      const next = FILTER_CONFIG[(idx - 1 + FILTER_CONFIG.length) % FILTER_CONFIG.length];
      changeFilter(next.id);
    }
  }, [onClose, results, activeIndex, commit, filter, changeFilter]);

  const clearRecent = useCallback(() => {
    setRecent([]);
    saveRecent(profileId, []);
  }, [profileId]);

  if (!isOpen) return null;

  const showRecent = query.trim().length < 2 && recent.length > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cmdk-title"
      className="fixed inset-0 z-[320] flex items-start justify-center bg-surface-overlay-hard backdrop-blur-md p-4 pt-[12vh] animate-fade-in"
      onClick={onClose}
      onKeyDown={onKeyDown}
    >
      <div
        className="relative w-full max-w-2xl max-h-[76vh] flex flex-col rounded-modal border border-DEFAULT bg-surface-1 backdrop-blur-xl shadow-elev-3 overflow-hidden animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-subtle bg-surface-2">
          <Search className="w-icon-md h-icon-md text-content-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Cerca canali, film, serie..."
            aria-label="Ricerca globale"
            id="cmdk-title"
            className="flex-1 bg-transparent outline-none text-base md:text-lg text-content-primary placeholder:text-content-muted"
            autoComplete="off"
            spellCheck={false}
          />
          <IconButton
            icon={X}
            aria-label="Chiudi ricerca"
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-subtle overflow-x-auto no-scrollbar">
          {FILTER_CONFIG.map(({ id, label, Icon }) => (
            <Chip
              key={id}
              selected={filter === id}
              icon={Icon}
              size="sm"
              onClick={() => changeFilter(id)}
            >
              {label}
            </Chip>
          ))}
          <div className="flex-1" />
          <span className="hidden md:inline text-[10px] tracking-widest uppercase text-content-disabled">
            ↑↓ naviga · Enter apri · Esc chiudi
          </span>
        </div>

        {/* Recent searches (only when no query) */}
        {showRecent && (
          <div className="px-5 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-content-disabled flex items-center gap-1.5">
                <Clock className="w-icon-xs h-icon-xs" aria-hidden="true" /> Ricerche recenti
              </h3>
              <button
                type="button"
                onClick={clearRecent}
                className="tv-focus-dense text-[10px] text-content-disabled hover:text-content-secondary uppercase tracking-widest rounded-control px-1.5 py-0.5"
              >
                Pulisci
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map(term => (
                <Chip
                  key={term}
                  size="sm"
                  onClick={() => {
                    setQuery(term);
                    inputRef.current?.focus();
                  }}
                >
                  {term}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-content-muted">
              <Search className="w-icon-xl h-icon-xl mb-3 text-content-disabled" aria-hidden="true" />
              <p className="text-sm">
                {query.trim().length < 2
                  ? 'Inizia a digitare per cercare canali, film o serie.'
                  : 'Nessun risultato trovato.'}
              </p>
            </div>
          ) : (
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Risultati ricerca"
              aria-busy={isFilterPending}
              className={isFilterPending ? 'opacity-70 transition-opacity' : 'transition-opacity'}
            >
              {results.map((channel, idx) => {
                const isActive = idx === activeIndex;
                return (
                  <li key={`${channel.id}-${idx}`} data-idx={idx}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => commit(channel)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-control text-left transition-colors ${
                        isActive ? 'bg-surface-3' : 'hover:bg-surface-2'
                      }`}
                    >
                      <div className="flex-shrink-0 w-10 h-10 rounded-control bg-surface-2 flex items-center justify-center overflow-hidden border border-subtle">
                        {channel.logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={channel.logo}
                            alt=""
                            className="w-full h-full object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <TypeIcon type={channel.type} className="w-icon-sm h-icon-sm text-content-muted" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-content-primary truncate">
                          <Highlight text={channel.cleanName || channel.name} query={deferredQuery} />
                        </div>
                        <div className="text-xs text-content-muted truncate flex items-center gap-2">
                          <span className="inline-flex items-center gap-1">
                            <TypeIcon type={channel.type} className="w-icon-xs h-icon-xs" />
                            {channel.type ? TYPE_LABEL[channel.type] : '—'}
                          </span>
                          {channel.group && (
                            <>
                              <span>·</span>
                              <span className="truncate"><Highlight text={channel.group} query={deferredQuery} /></span>
                            </>
                          )}
                          {channel.year && (
                            <>
                              <span>·</span>
                              <span>{channel.year}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
