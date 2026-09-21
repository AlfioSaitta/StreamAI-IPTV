// @vitest-environment jsdom
/**
 * Una riga di catalogo non deve svuotarsi quando la larghezza non è misurabile.
 *
 * Le righe fuori schermo sono saltate dal rendering (`content-visibility: auto`):
 * una lettura di layout dentro un sottoalbero saltato può tornare **zero** prima
 * che il browser lo ridisegni. Se quello zero finisse nella finestra virtuale,
 * la riga mostrerebbe una decina di card al posto di quelle che ci stanno —
 * e siccome jsdom riporta sempre `clientWidth` = 0, qui il caso è quello
 * normale, non un caso limite.
 *
 * Il test fissa la conseguenza visibile: con larghezza non misurabile la riga
 * continua a renderizzare la finestra intera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Category, Channel } from '../../types.ts';

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

vi.mock('../../services/geminiService.ts', () => ({
  isAiAvailable: () => false,
  getSemanticSearchResults: vi.fn(async () => null),
}));

vi.mock('../../contexts/LanguageContext.tsx', () => ({
  useLanguage: () => ({
    language: 'it',
    t: new Proxy(
      {},
      {
        // Il componente usa molte chiavi di traduzione: si restituisce la
        // chiave stessa, che è abbastanza per un test di struttura.
        get: (_t, chiave: string) => chiave,
      },
    ),
  }),
}));

import ChannelList from '../../components/ChannelList.tsx';

const canale = (n: number, categoria: string): Channel => ({
  id: `ch-${categoria}-${n}`,
  name: `Canale ${n}`,
  logo: '',
  // `Channel.url` è il campo richiesto dal tipo (non `streamUrl`).
  url: `http://provider.test/${n}.ts`,
  type: 'live',
  group: categoria,
});

// Oltre la soglia di virtualizzazione orizzontale (36): è il caso in cui la
// larghezza sbagliata si vede.
const canali = Array.from({ length: 100 }, (_, i) => canale(i, 'Sport'));
const categorie: Category[] = [{ name: 'Sport', channels: canali } as Category];

const renderLista = () =>
  render(
    <ChannelList
      categories={categorie}
      // Per la tab `live` il componente legge `liveCategories` (default `[]`):
      // senza questo la lista resta vuota e non c'è nessuna riga da misurare.
      liveCategories={categorie}
      onSelectChannel={vi.fn()}
      isOpen
      setIsOpen={vi.fn()}
      activeTab="live"
      setActiveTab={vi.fn()}
      profileName="Profilo"
      profileColor="#fff"
      onLogout={vi.fn()}
      onOpenServer={vi.fn()}
      onOpenSettings={vi.fn()}
      history={[]}
      watchlistIds={[]}
      onToggleWatchlist={vi.fn()}
      allChannels={canali}
      onShowDetails={vi.fn()}
    />,
  );

describe('riga del catalogo con larghezza non misurabile', () => {
  beforeEach(() => {
    // jsdom non calcola il layout: `clientWidth` è 0 come in una riga saltata
    // dal rendering. È il caso che il test vuole coprire, quindi non si stuba.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 0,
    });
    // jsdom non implementa `Element.scrollTo`, che `ContentRow` chiama in un
    // effect per riportare la riga all'inizio quando cambiano i canali: senza
    // lo stub il TypeError abortisce il render e non resta nessuna card.
    Element.prototype.scrollTo = () => undefined;
    // jsdom non ha IntersectionObserver: al componente basta che esista e non
    // osservi nulla — qui interessa il primo render, non la crescita delle righe.
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
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renderizza comunque la finestra intera, non una riga vuota', () => {
    const { container } = renderLista();

    const card = container.querySelectorAll('[id^="channel-"]');
    // Con la finestra intera (1200 px finti / 176 px per card + overscan) sono
    // ~15 card. Con lo zero finito nella finestra sarebbero 8: la soglia sta
    // in mezzo e distingue i due casi.
    expect(card.length).toBeGreaterThanOrEqual(12);
  });
});
