// @vitest-environment jsdom
/**
 * Il misuratore di scorrimento si monta con `?perf=1` **accanto all'app**: se
 * lancia un'eccezione, non si rompe una pagina di sviluppo, si rompe l'app.
 * Qui si fissa che sopravviva a un ambiente che non ha tutto ciò che usa in un
 * browser vero — jsdom non ha `document.getAnimations`, non calcola il layout e
 * non emette fotogrammi se non glieli si chiede — e che la corsa di misura
 * arrivi in fondo senza errori.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

import ScrollPerfOverlay from '../../components/dev/ScrollPerfOverlay.tsx';

describe('ScrollPerfOverlay', () => {
  beforeEach(() => {
    // jsdom non fa girare i fotogrammi da solo: senza questo la corsa di misura
    // resterebbe appesa al primo `requestAnimationFrame`.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('si disegna e legge le statistiche senza esplodere', async () => {
    const { getByText } = render(<ScrollPerfOverlay />);

    expect(getByText(/Scorrimento/)).toBeTruthy();
    // Il pannello si aggiorna a intervalli: si attende il primo giro.
    await waitFor(() => expect(getByText(/card \/ righe/)).toBeTruthy());
    expect(getByText(/content-visibility:/)).toBeTruthy();
  });

  it('la corsa di misura si conclude e riporta un esito', async () => {
    const { getByText } = render(<ScrollPerfOverlay />);

    fireEvent.click(getByText(/Misura 6000 px/));

    await waitFor(() => expect(getByText(/ultima corsa/)).toBeTruthy());
    // In jsdom non passa abbastanza tempo perché finisca in fretta: si aspetta
    // l'esito vero e proprio, che è ciò che conta.
    await waitFor(
      () => expect(getByText(/p95/)).toBeTruthy(),
      { timeout: 10000 },
    );
    expect(window.scrollTo).toHaveBeenCalled();
  }, 15000);
});
