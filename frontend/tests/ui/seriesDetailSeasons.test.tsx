// @vitest-environment jsdom
/**
 * Dettaglio serie: molte stagioni non devono muovere la vista.
 *
 * Il sintomo riportato: con molte stagioni, scorrendo la striscia verso destra
 * l'intera pagina scorreva con essa e le puntate uscivano dallo schermo.
 *
 * Le cause erano due, entrambe di layout e quindi non verificabili a schermo da
 * un test jsdom — qui si fissano le condizioni che le tenevano in piedi:
 *
 *  1. la radice aveva solo `overflow-y-auto`: quando un asse è `auto` l'altro non
 *     può restare `visible`, quindi la pagina poteva scorrere anche in
 *     orizzontale. Serve `overflow-x-hidden`;
 *  2. la colonna delle puntate è un figlio flex senza `min-w-0`: con
 *     `min-width: auto` non scende sotto la larghezza minima del contenuto,
 *     quindi la striscia non restringeva e allargava la pagina invece di
 *     scorrere.
 *
 * In più: la stagione selezionata va riportata in vista (altrimenti si cambia
 * stagione senza vedere dove si è) e l'intestazione va riallineata quando si
 * cambia stagione da metà di una lista lunga.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  seasons: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => {
      const season = String(i + 1);
      return [
        season,
        [
          {
            id: `ep-${season}-1`,
            episode_num: '1',
            title: `Episodio 1 della stagione ${season}`,
            container_extension: 'mkv',
            info: { plot: 'Trama' },
            season: i + 1,
          },
          {
            id: `ep-${season}-2`,
            episode_num: '2',
            title: `Episodio 2 della stagione ${season}`,
            container_extension: 'mkv',
            info: { plot: 'Trama' },
            season: i + 1,
          },
        ],
      ];
    }),
  ) as Record<string, unknown[]>,
  scrollIntoView: vi.fn(),
}));

vi.mock('../../services/xtream.ts', () => ({
  getSeriesInfo: vi.fn(async () => ({
    info: { name: 'Serie di prova', plot: 'Trama', cover: '' },
    episodes: h.seasons,
  })),
}));

vi.mock('../../services/metadata.ts', () => ({
  MetadataService: {
    isConfigured: () => false,
    cleanTitle: (s: string) => s,
    // Senza chiave API il servizio vero ritorna `null` da entrambe: il
    // componente le chiama comunque, e un mock che si dimentica questi metodi
    // fa fallire la promise in sottofondo (senza far fallire il test, che è
    // peggio: rumore che sembra un bug del componente).
    getDetails: async () => null,
    getDetailsByTitle: async () => null,
  },
}));

vi.mock('../../hooks/useMediaImages.ts', () => ({
  useMediaImages: () => ({ backdrop: '', poster: '' }),
}));

vi.mock('../../hooks/useMediaMetadata.ts', () => ({
  useMediaMetadata: () => ({ rating: null, plot: 'Trama' }),
}));

// Il focus trap gestisce le frecce a livello di documento: qui interessa solo il
// layout, e un listener globale in più confonderebbe i test.
vi.mock('../../hooks/useTvFocus.ts', () => ({
  useFocusTrap: () => undefined,
}));

vi.mock('../../contexts/LanguageContext.tsx', () => ({
  useLanguage: () => ({
    language: 'it',
    t: {
      episodes: 'Episodi',
      back: 'Indietro',
      loading: 'Caricamento',
      addToList: 'Aggiungi',
      removeFromList: 'Rimuovi',
    },
  }),
}));

import SeriesDetail from '../../components/SeriesDetail';

const series = {
  id: 'series-1',
  seriesId: '42',
  name: 'Serie di prova',
  logo: '',
  year: '2024',
} as never;

const renderDetail = () =>
  render(
    <SeriesDetail
      series={series}
      creds={{ url: 'http://provider.test:8080', username: 'u', password: 'p' } as never}
      onPlayEpisode={vi.fn()}
      onBack={vi.fn()}
      history={[]}
      watchlistIds={[]}
      onToggleWatchlist={vi.fn()}
    />,
  );

/** Chips delle stagioni, nell'ordine in cui sono renderizzate. */
const seasonChips = (container: HTMLElement): HTMLElement[] => {
  const strip = container.querySelector<HTMLElement>('[data-seasons-strip]');
  return strip ? Array.from(strip.querySelectorAll<HTMLElement>('button')) : [];
};

/** Chiamate di scrollIntoView ricevute da un elemento specifico. */
const scrollCallsOn = (el: Element): Array<Record<string, unknown>> => {
  const calls: Array<Record<string, unknown>> = [];
  h.scrollIntoView.mock.instances.forEach((instance, i) => {
    if (instance === el) calls.push(h.scrollIntoView.mock.calls[i][0] as Record<string, unknown>);
  });
  return calls;
};

describe('SeriesDetail — stagioni e puntate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom non implementa scrollIntoView: senza stub le chiamate lanciano.
    Element.prototype.scrollIntoView = h.scrollIntoView;
  });

  afterEach(cleanup);

  it('contiene lo scorrimento orizzontale: radice, colonna e striscia', async () => {
    const { container } = renderDetail();
    await waitFor(() => expect(seasonChips(container).length).toBe(12));

    // Radice: la pagina non può scorrere in orizzontale.
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('overflow-x-hidden');
    expect(root.className).toContain('overflow-y-auto');

    // Colonna delle puntate: può restringersi, quindi la striscia scorre invece
    // di allargare la pagina.
    const strip = container.querySelector<HTMLElement>('[data-seasons-strip]')!;
    const rightPanel = strip.closest('.flex-1') as HTMLElement;
    expect(rightPanel.className).toContain('min-w-0');

    // Striscia: contenitore di scorrimento che non propaga il gesto alla pagina.
    expect(strip.className).toContain('overflow-x-auto');
    expect(strip.className).toContain('overscroll-x-contain');
    expect(strip.className).toContain('min-w-0');
  });

  it('riporta in vista la stagione selezionata, centrandola nella striscia', async () => {
    const { container } = renderDetail();
    await waitFor(() => expect(seasonChips(container).length).toBe(12));

    const chips = seasonChips(container);
    // Selezione iniziale: la prima stagione, già in vista.
    expect(scrollCallsOn(chips[0]).some((c) => c.inline === 'center')).toBe(true);

    // Una stagione lontana (la decima): deve essere centrata, non solo "toccata".
    fireEvent.click(chips[9]);

    await waitFor(() => {
      expect(scrollCallsOn(chips[9]).some((c) => c.inline === 'center')).toBe(true);
    });
  });

  it('cambiando stagione la lista puntate si aggiorna e l’intestazione resta in vista', async () => {
    const { container } = renderDetail();
    await waitFor(() => expect(seasonChips(container).length).toBe(12));

    expect(container.textContent).toContain('Episodio 1 della stagione 1');

    const chips = seasonChips(container);
    fireEvent.click(chips[2]); // stagione 3

    await waitFor(() => {
      expect(container.textContent).toContain('Episodio 1 della stagione 3');
    });
    expect(container.textContent).not.toContain('Episodio 1 della stagione 1');

    // L'intestazione (titolo + striscia) viene riallineata: senza, da metà di una
    // lista lunga si resterebbe a metà della nuova con le stagioni fuori schermo.
    // È il genitore diretto della striscia (`.flex-wrap` da solo troverebbe prima
    // la riga dei badge, nel pannello di sinistra).
    const header = container.querySelector<HTMLElement>('[data-seasons-strip]')!.parentElement!;
    expect(scrollCallsOn(header).some((c) => c.block === 'nearest')).toBe(true);
  });
});
