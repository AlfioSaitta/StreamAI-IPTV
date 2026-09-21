// @vitest-environment jsdom
/**
 * Instradamento delle immagini remote dal proxy locale.
 *
 * Serve a una cosa sola ma decisiva: far passare **ogni** immagine dalla cache
 * su disco del proxy Go (condivisa fra profili, e che sopravvive alla
 * cancellazione dei dati del webview). Le immagini del catalogo ci passavano già
 * via `DownloadManager`; locandine e sfondi delle pagine di dettaglio, loghi
 * dell'EPG e miniature della coda no, e restavano fuori dalla cache.
 *
 * Il caso che rompe le immagini, e che qui è fissato: il proxy accetta **solo**
 * http/https e risponde 400 su tutto il resto. Un `data:`, un `blob:`, un
 * percorso relativo o una stringa vuota devono restare intatti.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ isWails: true }));

vi.mock('../../services/platformService', () => ({
  default: {
    get isWails() {
      return h.isWails;
    },
    isDesktop: true,
    isNative: false,
    isWeb: false,
    isAndroid: false,
  },
}));

const { proxyImageURL, toBase64Url } = await import('../../services/proxyFetch.ts');

/** Inverso di `toBase64Url`: base64url → byte → UTF-8. */
const decodedUpstream = (src: string): string => {
  const u = new URLSearchParams(src.split('?')[1]).get('u') ?? '';
  const b64 = u.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

describe('proxyImageURL', () => {
  beforeEach(() => {
    h.isWails = true;
  });

  afterEach(() => vi.restoreAllMocks());

  it('instrada le immagini remote passando dal proxy', () => {
    const src = proxyImageURL('https://image.tmdb.org/t/p/w600/locandina.jpg');

    expect(src.startsWith('/iptv-proxy?')).toBe(true);
    expect(decodedUpstream(src)).toBe('https://image.tmdb.org/t/p/w600/locandina.jpg');
  });

  it('instrada anche gli http (loghi dei pannelli)', () => {
    const src = proxyImageURL('http://panel.example:8080/picon/rai1.png');

    expect(src.startsWith('/iptv-proxy?')).toBe(true);
    expect(decodedUpstream(src)).toBe('http://panel.example:8080/picon/rai1.png');
  });

  // Un URL non http riceverebbe 400 dal proxy: sarebbe un'immagine rotta, non
  // un'immagine più veloce.
  it.each([
    [''],
    ['data:image/png;base64,iVBORw0KGgo='],
    ['blob:http://localhost/abc-123'],
    ['/assets/local.png'],
    ['immagine.jpg'],
  ])('lascia intatto %j', (url) => {
    expect(proxyImageURL(url)).toBe(url);
  });

  it('accetta anche null e undefined senza produrre un src rotto', () => {
    expect(proxyImageURL(null)).toBe('');
    expect(proxyImageURL(undefined)).toBe('');
  });

  it('fuori dal runtime desktop lascia gli URL come sono', () => {
    h.isWails = false;
    expect(proxyImageURL('https://image.tmdb.org/t/p/w600/x.jpg')).toBe(
      'https://image.tmdb.org/t/p/w600/x.jpg',
    );
  });

  it('l’encoding regge i caratteri non ASCII nei percorsi', () => {
    const originale = 'https://cdn.example/copertine/perché-è-così.jpg';
    expect(decodedUpstream(proxyImageURL(originale))).toBe(originale);
    expect(toBase64Url('à')).not.toContain('=');
  });
});
