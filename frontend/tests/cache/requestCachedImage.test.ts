// @vitest-environment jsdom
/**
 * `requestCachedImage`: mostrare le copertine mentre si guarda un canale live
 * senza spendere banda.
 *
 * Durante un live i download delle immagini sono in pausa, perché contendere
 * banda allo stream è una causa diretta di rebuffering. Ma un'immagine **già**
 * scaricata non costa niente: la si mostra. Qui si verifica che la ricerca
 * guardi entrambe le cache locali — quella del webview e quella su disco del
 * proxy, condivisa fra profili — e che quando non trova nulla **non scarichi**.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  local: null as string | null,
  probe: null as { status: number; cache: string } | null,
  probeThrows: false,
  headCalls: 0,
  isWails: true,
}));

vi.mock('../../services/cacheService.ts', () => ({
  CacheService: {
    getImage: vi.fn(async () => h.local),
    saveImage: vi.fn(async () => undefined),
  },
}));

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

vi.mock('../../services/proxyFetch.ts', async () => {
  const actual = await vi.importActual<typeof import('../../services/proxyFetch.ts')>(
    '../../services/proxyFetch.ts',
  );
  return {
    ...actual,
    proxyFetch: vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method !== 'HEAD') {
        throw new Error('requestCachedImage non deve fare richieste di corpo');
      }
      h.headCalls++;
      if (h.probeThrows) throw new Error('offline');
      const p = h.probe ?? { status: 204, cache: 'miss' };
      return {
        ok: p.status === 200,
        status: p.status,
        headers: { get: (name: string) => (name === 'X-StreamAI-Cache' ? p.cache : null) },
      } as unknown as Response;
    }),
  };
});

const { DownloadManager } = await import('../../services/downloadManager.ts');

const URL_IMG = 'https://image.tmdb.org/t/p/w300/copertina.jpg';

describe('DownloadManager.requestCachedImage', () => {
  beforeEach(() => {
    h.local = null;
    h.probe = null;
    h.probeThrows = false;
    h.headCalls = 0;
    h.isWails = true;
    DownloadManager.reset();
  });

  it('usa la cache del webview senza nemmeno interrogare il proxy', async () => {
    h.local = 'blob:copertina';

    await expect(DownloadManager.requestCachedImage(URL_IMG)).resolves.toBe('blob:copertina');
    expect(h.headCalls).toBe(0);
  });

  it('se il webview non ce l’ha, chiede alla cache su disco del proxy', async () => {
    h.probe = { status: 200, cache: 'hit' };

    const src = await DownloadManager.requestCachedImage(URL_IMG);

    // L'URL instradato: l'`<img>` lo chiederà al proxy, che risponderà dal disco.
    expect(src).toContain('/iptv-proxy?');
    const b64 = new URLSearchParams(src!.split('?')[1]).get('u')!;
    const decodificato = new TextDecoder().decode(
      Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
    );
    expect(decodificato).toBe(URL_IMG);
  });

  it('se non è in nessuna delle due cache non scarica nulla', async () => {
    h.probe = { status: 204, cache: 'miss' };

    await expect(DownloadManager.requestCachedImage(URL_IMG)).resolves.toBeNull();
    // La sonda non deve aver prodotto download: nessuno slot occupato.
    expect(DownloadManager.processing.size).toBe(0);
    expect(DownloadManager.queued.size).toBe(0);
  });

  it('senza rete resta un segnaposto, senza errori', async () => {
    h.probeThrows = true;

    await expect(DownloadManager.requestCachedImage(URL_IMG)).resolves.toBeNull();
  });

  it('ignora gli URL che non sono immagini remote', async () => {
    await expect(DownloadManager.requestCachedImage('')).resolves.toBeNull();
    await expect(DownloadManager.requestCachedImage('data:image/png;base64,AAAA')).resolves.toBeNull();
    expect(h.headCalls).toBe(0);
  });

  // Fuori da Wails (web, Android) non esiste né il proxy né la sua cache su
  // disco: la sonda partirebbe verso l'host dell'immagine — cioè sarebbe
  // esattamente la richiesta di rete che questa funzione esiste per evitare.
  it('fuori da Wails non sonda: non c’è una cache su disco da interrogare', async () => {
    h.isWails = false;

    await expect(DownloadManager.requestCachedImage(URL_IMG)).resolves.toBeNull();
    expect(h.headCalls).toBe(0);
  });
});
