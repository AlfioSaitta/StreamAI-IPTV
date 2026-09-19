// @vitest-environment jsdom
/**
 * Il bridge mappa `url` (tipo del frontend) → `serverUrl` (binding Go).
 *
 * La stessa mappatura serve anche a `LoadCachedCatalog`, e lì sbagliarla non
 * produce una richiesta fallita ma qualcosa di peggio: il backend cerca il file
 * su disco in base a **server+utente**, quindi un `serverUrl` vuoto significa
 * "nessuna cache trovata" — cioè l'avvio resta lento esattamente come prima,
 * senza alcun errore che lo spieghi. La mappatura è già stata causa di un bug
 * (`ProcessXtreamPlaylist` riceveva `serverUrl: ""`), quindi vale un test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadCachedCatalog, processXtreamPlaylist } = vi.hoisted(() => ({
  loadCachedCatalog: vi.fn(
    async (
      _opts: { serverUrl: string; username: string; password: string },
    ): Promise<{ playlist: unknown; savedAt: number } | null> => ({
      playlist: { live: [], vod: [] },
      savedAt: 1_700_000_000_000,
    }),
  ),
  processXtreamPlaylist: vi.fn(async () => undefined),
}));

vi.mock(
  '../../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/playlist/playlistservice',
  () => ({ LoadCachedCatalog: loadCachedCatalog, ProcessXtreamPlaylist: processXtreamPlaylist }),
);

// `host` è un Proxy che ritorna `undefined` fuori dal runtime desktop: senza
// dichiarare Wails, il test non proverebbe la mappatura ma solo il caso "bridge
// assente" (che è già coperto dal ramo web/mobile dell'app).
vi.mock('../../services/platformService', () => ({
  default: { isWails: true, isDesktop: true, isNative: false, isWeb: false, isAndroid: false },
}));

import { host } from '../../services/hostBridge';

const CREDS = { url: 'http://provider.test:8080', username: 'utente', password: 'segreta' };

describe('host.playlist.LoadCachedCatalog', () => {
  beforeEach(() => {
    loadCachedCatalog.mockClear();
  });

  it('mappa url → serverUrl e ritorna catalogo e timestamp', async () => {
    const res = await host.playlist.LoadCachedCatalog(CREDS);

    expect(res).toEqual({ playlist: { live: [], vod: [] }, savedAt: 1_700_000_000_000 });
    expect(loadCachedCatalog).toHaveBeenCalledTimes(1);
    // La forma che il backend si aspetta: `serverUrl`, non `url`.
    expect(loadCachedCatalog.mock.calls[0][0]).toMatchObject({
      serverUrl: 'http://provider.test:8080',
      username: 'utente',
      password: 'segreta',
    });
  });

  it('propaga il null del backend (nessuna copia locale) senza inventare un catalogo', async () => {
    loadCachedCatalog.mockResolvedValueOnce(null);
    await expect(host.playlist.LoadCachedCatalog(CREDS)).resolves.toBeNull();
  });
});
