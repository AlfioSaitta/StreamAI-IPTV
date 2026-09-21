// @vitest-environment jsdom
/**
 * Una copertina che manca deve finire nella cache su disco del proxy.
 *
 * Il `DownloadManager` non restituisce sempre una copia da mostrare: quando il
 * download fallisce — o quando rifiuta per non rubare banda allo stream — torna
 * l'URL **originale**. Per un `<img>` quell'URL significa "carica dalla rete", e
 * caricare dalla rete senza passare dal proxy è la strada che non tocca mai la
 * cache su disco: l'immagine resta fuori dalla cache condivisa fra profili e,
 * su un webview che blocca il mixed content, non si vede affatto — pur essendo
 * il proxy la strada che funzionerebbe.
 *
 * Qui si fissa la regola: si ripiega sempre sul proxy. L'unica eccezione è il
 * prefetch rifiutato mentre si guarda un live, che deve restare un segnaposto
 * invece di scaricare comunque la banda dello stream.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  paused: false,
  requestImage: vi.fn(async () => null as string | null),
  requestCachedImage: vi.fn(async () => null as string | null),
}));

vi.mock('../../services/downloadManager.ts', () => ({
  DownloadManager: {
    isPaused: () => h.paused,
    isDownloadBlockedWhilePlaying: (priority: number) => h.paused && priority < 1,
    requestImage: (...args: unknown[]) => h.requestImage(...(args as [])),
    requestCachedImage: (...args: unknown[]) => h.requestCachedImage(...(args as [])),
  },
}));

// Il proxy esiste solo in Wails, ed è lì che c'è la cache su disco.
vi.mock('../../services/platformService', () => ({
  default: { isWails: true, isDesktop: true, isNative: false, isWeb: false, isAndroid: false },
}));

import CachedImage from '../../components/CachedImage.tsx';

const SRC = 'https://image.tmdb.org/t/p/w300/copertina.jpg';

const imgSrc = (container: HTMLElement): string | null =>
  container.querySelector('img')?.getAttribute('src') ?? null;

/** Decodifica l'URL upstream da un URL del proxy locale. */
const upstreamOf = (proxied: string): string | null => {
  const b64 = new URLSearchParams(proxied.split('?')[1] ?? '').get('u');
  if (!b64) return null;
  const binario = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)));
};

describe('CachedImage — ripiego sul proxy', () => {
  beforeEach(() => {
    h.paused = false;
    h.requestImage.mockClear();
    h.requestCachedImage.mockClear();
    h.requestImage.mockResolvedValue(null);
    h.requestCachedImage.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it('se il download fallisce passa dal proxy, non dall’host remoto', async () => {
    // Il manager fallisce e torna l'URL originale: è il caso in cui l'immagine
    // finirebbe fuori dalla cache su disco, o addirittura non si vedrebbe.
    h.requestImage.mockResolvedValue(SRC);

    const { container } = render(<CachedImage src={SRC} alt="cover" />);

    await waitFor(() => expect(imgSrc(container)).toContain('/iptv-proxy?'));
    expect(upstreamOf(imgSrc(container)!)).toBe(SRC);
  });

  // Una copia locale può non essere più valida (object URL revocato quando la
  // voce scade). Il ripiego non deve saltare direttamente all'host remoto: prima
  // il proxy — che è la strada che funziona sui webview e che riempie la cache su
  // disco — e solo dopo l'originale, una volta sola ciascuno.
  it('una copia non più valida ripiega su proxy, poi su originale, poi errore', async () => {
    h.requestImage.mockResolvedValue('blob:revocata');

    const { container } = render(<CachedImage src={SRC} alt="cover" />);
    await waitFor(() => expect(imgSrc(container)).toBe('blob:revocata'));

    const img = () => container.querySelector('img')!;

    fireEvent.error(img());
    await waitFor(() => expect(imgSrc(container)).toContain('/iptv-proxy?'));
    expect(upstreamOf(imgSrc(container)!)).toBe(SRC);

    fireEvent.error(img());
    await waitFor(() => expect(imgSrc(container)).toBe(SRC));

    // Terzo errore: non resta niente da provare, e nessun rimbalzo fra i due URL.
    fireEvent.error(img());
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
  });

  it('se il download riesce mostra la copia, senza passare dal proxy', async () => {
    h.requestImage.mockResolvedValue('blob:copertina');

    const { container } = render(<CachedImage src={SRC} alt="cover" />);

    await waitFor(() => expect(imgSrc(container)).toBe('blob:copertina'));
  });

  // La banda dello stream non si tocca per un'immagine che nessuno sta
  // guardando: il rifiuto del prefetch deve restare un segnaposto, non un
  // `<img>` che scarica comunque passando dal proxy.
  it('un prefetch rifiutato durante un live resta un segnaposto', async () => {
    h.paused = true;
    h.requestImage.mockResolvedValue(SRC);

    const { container } = render(<CachedImage src={SRC} alt="cover" priority={0} />);

    await waitFor(() => expect(h.requestImage).toHaveBeenCalled());
    expect(imgSrc(container)).toBeNull();
  });
});
