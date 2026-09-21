// @vitest-environment jsdom
/**
 * `CachedImage` mentre si guarda un canale live.
 *
 * Durante un live i download sono in pausa: contendere banda allo stream è una
 * causa diretta di rebuffering. Ma un'immagine già scaricata non costa banda, e
 * lasciare il posto vuoto significa solo rinunciare a qualcosa che si è già
 * pagato. Qui si fissa la regola: **in pausa si mostra ciò che è in cache, non
 * si chiede nulla alla rete per ciò che manca**.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  paused: false,
  requestImage: vi.fn(async () => 'blob:scaricata' as string | null),
  requestCachedImage: vi.fn(async () => null as string | null),
}));

vi.mock('../../services/downloadManager.ts', () => ({
  DownloadManager: {
    isPaused: () => h.paused,
    requestImage: (...args: unknown[]) => h.requestImage(...(args as [])),
    requestCachedImage: (...args: unknown[]) => h.requestCachedImage(...(args as [])),
  },
}));

import CachedImage from '../../components/CachedImage.tsx';

const SRC = 'https://image.tmdb.org/t/p/w300/copertina.jpg';

const imgSrc = (container: HTMLElement): string | null =>
  container.querySelector('img')?.getAttribute('src') ?? null;

describe('CachedImage — live in riproduzione', () => {
  beforeEach(() => {
    h.paused = false;
    h.requestImage.mockClear();
    h.requestCachedImage.mockClear();
    h.requestImage.mockResolvedValue('blob:scaricata');
    h.requestCachedImage.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it('mostra un’immagine già in cache, senza scaricare nulla', async () => {
    h.paused = true;
    h.requestCachedImage.mockResolvedValue('blob:in-cache');

    const { container } = render(<CachedImage src={SRC} alt="cover" />);

    await waitFor(() => expect(imgSrc(container)).toBe('blob:in-cache'));
    expect(h.requestImage).not.toHaveBeenCalled();
  });

  it('se non è in cache la scarica e la mostra (finirà nella cache condivisa)', async () => {
    h.paused = true;
    h.requestImage.mockResolvedValue('blob:scaricata-durante-il-live');

    const { container } = render(<CachedImage src={SRC} alt="cover" />);

    // Prima chiede se c'è (cache webview, poi cache su disco del proxy)…
    await waitFor(() => expect(h.requestCachedImage).toHaveBeenCalledWith(SRC));
    // …e se non c'è la scarica comunque, perché è sotto gli occhi dell'utente.
    await waitFor(() => expect(imgSrc(container)).toBe('blob:scaricata-durante-il-live'));
    expect(h.requestImage).toHaveBeenCalledWith(SRC, expect.anything(), expect.anything());
  });

  it('fuori dalla riproduzione scarica normalmente', async () => {
    const { container } = render(<CachedImage src={SRC} alt="cover" />);

    await waitFor(() => expect(imgSrc(container)).toBe('blob:scaricata'));
    expect(h.requestCachedImage).not.toHaveBeenCalled();
    expect(h.requestImage).toHaveBeenCalledWith(SRC, expect.anything(), expect.anything());
  });
});
