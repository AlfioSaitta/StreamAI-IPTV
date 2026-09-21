// @vitest-environment jsdom
/**
 * Ricerca semantica (AI) in ChannelList: i tre percorsi che lasciavano l'area
 * contenuti completamente bianca, senza spinner né messaggio.
 *
 *  1. RICHIESTA IN VOLO — `filteredCategories` restituiva una pseudo-categoria
 *     `{ channels: [] }`, ma `ContentRow` esce con `return null` quando la lista
 *     è vuota: nessuna riga, nessuno spinner, nessun EmptyState (il ramo
 *     alternativo non scattava perché `displayedCategories.length > 0`).
 *  2. ERRORE — l'effect non aveva `try/catch`: la rejection (che arriva dalla
 *     fase di arricchimento TMDB, fuori dal try/catch del servizio) lasciava
 *     `aiSearchLoading` a `true` per sempre → schermo bianco permanente.
 *  3. ZERO RISULTATI — `getSemanticSearchResults` ritorna `[]` sia senza
 *     corrispondenze sia quando il servizio è sospeso; `[]` è truthy, quindi
 *     usciva la riga "Risultati AI (0)" con `channels: []` → di nuovo nulla.
 *
 * In più si fissa la protezione dalla race: una risposta lenta non deve
 * sovrascrivere quella di una query più recente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Category, Channel } from '../../types.ts';

const h = vi.hoisted(() => ({
  /** Quando impostata, sostituisce il comportamento di default. */
  impl: null as null | ((query: string) => Promise<string[]>),
  /** Query ricevute, in ordine. */
  queries: [] as string[],
}));

vi.mock('../../services/geminiService.ts', () => ({
  // Il toggle "Ricerca Semantica" è renderizzato solo se l'AI è disponibile.
  isAiAvailable: () => true,
  getSemanticSearchResults: (_channels: unknown, query: string) => {
    h.queries.push(query);
    if (h.impl) return h.impl(query);
    // Default: richiesta che non si conclude mai → stato "in corso".
    return new Promise<string[]>(() => {});
  },
}));

// Le immagini passano da DownloadManager/proxyFetch: in jsdom non servono e
// genererebbero richieste di rete e timer di sottofondo.
vi.mock('../../components/CachedImage.tsx', () => ({
  default: ({ alt, className }: { alt?: string; className?: string }) => (
    <div className={className} data-testid="cached-image" data-alt={alt} />
  ),
}));

vi.mock('../../services/downloadManager.ts', () => ({
  DownloadManager: {
    preloadVisible: vi.fn(),
    preloadLater: vi.fn(),
    requestImage: vi.fn(async () => null),
    requestCachedImage: vi.fn(async () => null),
    isPaused: () => false,
    isDownloadBlockedWhilePlaying: () => false,
  },
}));

vi.mock('../../hooks/useTvFocus.ts', () => ({
  useInitialTvFocus: () => undefined,
  useTvSpatialNavigation: () => undefined,
  isElementVisible: () => true,
}));

vi.mock('../../contexts/LanguageContext.tsx', () => ({
  useLanguage: () => ({
    language: 'it',
    t: {
      search: 'Cerca',
      home: 'Home',
      live: 'Live',
      movies: 'Film',
      series: 'Serie',
      myList: 'La mia lista',
      continueWatching: 'Continua a guardare',
    },
  }),
}));

import ChannelList from '../../components/ChannelList.tsx';

const channel = (id: string, name: string): Channel => ({
  id,
  name,
  // `Channel.url` è il campo richiesto (non `streamUrl`).
  url: `http://provider.test/${id}.ts`,
  type: 'live',
  group: 'News',
});

const CATEGORIES: Category[] = [
  { name: 'News', channels: [channel('c1', 'Canale Uno'), channel('c2', 'Canale Due'), channel('c3', 'Canale Tre')] },
];

const renderList = () => {
  const props = {
    categories: CATEGORIES,
    liveCategories: CATEGORIES,
    vodCategories: [],
    seriesCategories: [],
    onSelectChannel: vi.fn(),
    currentChannelId: null,
    isOpen: true,
    setIsOpen: vi.fn(),
    activeTab: 'live' as const,
    setActiveTab: vi.fn(),
    profileName: 'Alfio',
    profileColor: '#8b5cf6',
    onLogout: vi.fn(),
    onOpenServer: vi.fn(),
    onOpenSettings: vi.fn(),
    history: [],
    watchlistIds: [],
    onToggleWatchlist: vi.fn(),
    allChannels: CATEGORIES.flatMap(c => c.channels),
    onShowDetails: vi.fn(),
    geminiApiKey: 'test-key',
  };
  const view = render(<ChannelList {...props} />);
  return view;
};

/** Attiva la ricerca semantica (toggle "Ricerca Semantica"). */
const enableAiSearch = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Ricerca Semantica' }));
};

/** Digita un termine e attende che superi il debounce di 300 ms. */
const typeQuery = async (term: string) => {
  const input = screen.getByRole('textbox', { name: 'Cerca' });
  fireEvent.change(input, { target: { value: term } });
  await waitFor(() => expect(h.queries).toContain(term), { timeout: 3000 });
};

const searchWithAi = async (term: string) => {
  enableAiSearch();
  await typeQuery(term);
};

beforeEach(() => {
  h.impl = null;
  h.queries = [];
  // jsdom non implementa `IntersectionObserver`: il componente ne crea uno per
  // il "carica altri". Basta che esista e non osservi nulla — qui interessa il
  // primo render.
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  // `ContentRow` riazzera lo scorrimento orizzontale quando cambiano i canali
  // (`rowRef.current?.scrollTo`): in jsdom `Element.scrollTo` non esiste e il
  // TypeError farebbe fallire l'intero render.
  Element.prototype.scrollTo = () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ChannelList — ricerca AI: stati dell’area contenuti', () => {
  it('mostra un indicatore mentre la richiesta è in volo (prima: area bianca)', async () => {
    renderList();
    await searchWithAi('film di fantascienza');

    expect(screen.getByText('Ricerca AI in corso…')).toBeTruthy();
  });

  it('su errore mostra un messaggio con "Riprova" e non resta bloccata in caricamento', async () => {
    // L'errore è voluto: il componente lo logga, ma in output farebbe sembrare
    // rosso un test che passa.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.impl = async () => {
      throw new Error('TMDB enrichment failed');
    };
    renderList();
    await searchWithAi('film di fantascienza');

    await waitFor(() => expect(screen.getByText('Ricerca AI non disponibile')).toBeTruthy());
    // Il caricamento deve essere finito: se fosse rimasto `true`, il ramo
    // dell'errore non verrebbe mai raggiunto.
    expect(screen.queryByText('Ricerca AI in corso…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Riprova' })).toBeTruthy();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('con zero risultati mostra l’EmptyState di ricerca (prima: riga "Risultati AI (0)" vuota)', async () => {
    h.impl = async () => [];
    renderList();
    await searchWithAi('qualcosa che non esiste');

    await waitFor(() => expect(screen.getByText('Nessun risultato trovato')).toBeTruthy());
    expect(screen.queryByText(/Risultati AI \(0\)/)).toBeNull();
  });

  it('una risposta lenta non sovrascrive quella di una query più recente', async () => {
    const pending = new Map<string, (value: string[]) => void>();
    h.impl = query => new Promise<string[]>(resolve => { pending.set(query, resolve); });

    renderList();
    enableAiSearch();
    await typeQuery('aaa');
    await typeQuery('bbb');

    // La query vecchia risponde per ultima, con più risultati: se vincesse,
    // il titolo della riga sarebbe "Risultati AI (3)".
    pending.get('aaa')?.(['Canale Uno', 'Canale Due', 'Canale Tre']);
    pending.get('bbb')?.(['Canale Due']);

    await waitFor(() => expect(screen.getByText('Risultati AI (1)')).toBeTruthy());
    expect(screen.queryByText('Risultati AI (3)')).toBeNull();
  });
});
