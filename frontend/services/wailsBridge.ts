/**
 * Wails v3 bridge — adapter che espone la stessa shape di `window.electronAPI`
 * ai componenti React/hook esistenti, ma instrada le chiamate ai Service Go
 * Wails v3 (`internal/services/*`) tramite i binding TS generati in
 * `frontend/bindings/`.
 *
 * Stato (plan rev. 6, Fase 7.1): foundation only — il bridge wrap-pa i Service
 * già implementati lato backend (discovery, cast, netstatus, remote,
 * advertising, proxy, powersave, mediakeys). Il player nativo libmpv è ancora
 * un stub (gated da SPIKE-1/2/4 della Fase 6) ed è quindi assente da qui.
 *
 * Convenzione di consumo: i componenti UI NON importano direttamente questo
 * bridge — usano `services/hostBridge.ts` che switcha su `platformService.isWails`.
 *
 * Vedi `docs/plan-go-wails-migration.md` §3.1 per la mappa Electron → Wails.
 */

import { Events as WailsEvents, Window } from '@wailsio/runtime';

// Binding TS generati da `wails3 generate bindings -ts -d frontend/bindings ./...`
// (script: `npm run wails:bindings`). Sono in `.gitignore`: rigenerare dopo
// ogni modifica alle firme dei Service Go.
import * as Discovery from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/discovery/service';
import * as Cast from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/cast/service';
import * as NetStatus from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/netstatus/service';
import * as Player from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player/service';
import * as Proxy from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/proxy/service';
import * as Migration from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/migration/service';
import * as Notifications from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/notifications/service';
// NB: il generatore nomina questo file `playlistservice` (dal tipo Go
// `PlaylistService`), non `service` come gli altri package.
import * as Playlist from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/playlist/playlistservice';
import { XtreamCredentials as GoXtreamCredentials } from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/playlist/models';
// Picture-in-Picture: finestra dedicata gestita dal backend (vedi
// internal/services/pip). Non usa le API PiP del webview, che richiedono un
// <video> che il player basato su canvas non ha.
import * as Pip from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/pip/service';
import { OpenOptions as PipOpenOptions } from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/pip/models';

/**
 * Sottoinsieme dell'API `window.electronAPI` esposta a `services/hostBridge.ts`.
 * Tipata in modo lasco per backward-compat con i call site esistenti
 * (alcune funzioni accettano oggetti opaco-typed dalla parte Electron).
 */
export interface HostAPI {
  readonly isWails: true;

  // Discovery (1:1 con Electron `electronAPI.{discoverDevices,getLocalIPs,scanIp,probeDeviceServices}`)
  discoverDevices: () => Promise<unknown[]>;
  getLocalIPs: () => Promise<unknown[]>;
  scanIp: (target: string) => Promise<unknown[]>;
  probeDeviceServices: (ip: string) => Promise<string[]>;
  onDeviceFound: (cb: (device: unknown) => void) => () => void;

  // Cast (1:1 con `castConnect/castLoad/castControl/castDisconnect`)
  // NB: l'API Electron accetta un singolo `options`; la riproduciamo qui per
  // minimizzare il churn lato UI. La validazione dei campi è delegata al Go.
  castConnect: (options: { host: string; port?: number }) => Promise<void>;
  castLoad: (options: unknown) => Promise<void>;
  castControl: (options: unknown) => Promise<void>;
  castDisconnect: () => Promise<void>;
  onCastStatus: (cb: (status: unknown) => void) => () => void;

  // Status broadcast (UDP multicast :1901 + WS :1902)
  updatePlaybackStatus: (status: unknown) => void;
  onNetworkPlaybackStatus: (cb: (status: unknown) => void) => () => void;
  onRemoteControlCommand: (cb: (command: unknown) => void) => () => void;
  onRequestStatusBroadcast: (cb: () => void) => () => void;

  // GPU / HW accel — wrapper sopra `player.Service.HwAccelInfo()`. Per
  // mantenere la shape allineata con `window.electronAPI.getGpuStatus()`
  // (vedi `services/hwAccelService.ts`).
  getGpuStatus: () => Promise<unknown>;

  // Proxy HTTP locale (header rewrite + CORS bypass + TLS skip opzionale).
  // Necessario su WebKitGTK perché la webview blocca le `fetch()` cross-origin
  // verso server IPTV `http://` senza header CORS (Xtream player_api.php,
  // HLS/MPEG-TS, ecc.). Vedi `internal/services/proxy/`.
  buildProxyUrl: (
    streamUrl: string,
    userAgent?: string,
    headers?: Record<string, string>,
  ) => Promise<string>;
  proxyPort: () => Promise<number>;

  // Playlist Xtream — pipeline lato Go. `ProcessXtreamPlaylist` avvia il
  // lavoro in una goroutine e ritorna SUBITO (vedi
  // internal/services/playlist/service.go): l'esito non è il valore di
  // ritorno, ma gli eventi `playlist:success` / `playlist:error`.
  playlist: {
    ProcessXtreamPlaylist: (creds: unknown) => Promise<void>;
    /**
     * Copia locale del catalogo, salvata su disco dal backend
     * (`internal/services/playlist/cache.go`).
     *
     * Ritorna `null` quando non c'è nulla di utilizzabile — primo avvio, cache
     * cancellata, formato vecchio, file corrotto: per il chiamante sono tutti lo
     * stesso caso, e significa "vai di rete".
     */
    LoadCachedCatalog: (creds: unknown) => Promise<{ playlist: unknown; savedAt: number } | null>;
  };

  // Migration (Fase 7-bis.8: Electron v1 -> Wails v2)
  HasLegacyData: () => Promise<boolean>;
  GetLegacyData: () => Promise<string>;
  GetLegacyPath: () => Promise<string>;
  ImportSnapshot: (jsonData: string) => Promise<boolean>;

  // Notifications (Fase 7-bis.9)
  sendNotification: (title: string, message: string) => void;

  // Window control (Wails v3)
  toggleFullscreen: () => Promise<void>;
  isFullscreen: () => Promise<boolean>;

  // Picture-in-Picture — finestra Wails dedicata. `open()` è idempotente:
  // se la finestra esiste già la riporta in primo piano e aggiorna i dati del
  // canale.
  pip: {
    open: (opts?: PipOptions) => Promise<boolean>;
    /**
     * Aggiorna titolo e tipo di canale di una finestra PiP già aperta, **senza**
     * portarla in primo piano: si usa quando l'utente cambia canale nella
     * finestra principale mentre il PiP è aperto. No-op se il PiP è chiuso.
     */
    update: (opts?: PipOptions) => Promise<void>;
    close: () => Promise<void>;
    state: () => Promise<PipWindowState>;
    /**
     * Avvia il ridimensionamento dal bordo indicato ("n-resize",
     * "se-resize", …). Da usare solo dove `state().edgeResize` è true: altrove
     * ci pensa il runtime di Wails.
     */
    startResize: (edge: string) => Promise<void>;
    /** Tutto schermo per la finestra PiP (non per quella principale). */
    toggleFullscreen: () => Promise<boolean>;
  };
  /**
   * Notifica apertura, aggiornamento e chiusura della finestra PiP. Serve a
   * entrambe le finestre: la principale per fermare/riprendere il proprio loop
   * di render, quella PiP per conoscere titolo, tipo di canale e stato del
   * fullscreen.
   */
  onPipStateChange: (cb: (state: PipWindowState) => void) => () => void;
}

/** Dati del canale che la vista PiP deve conoscere per disegnare i controlli. */
export interface PipOptions {
  title?: string;
  /** Canale live: nessuna timeline (durata ignota e non cercabile). */
  isLive?: boolean;
  /** Il server non supporta il seek: timeline presente ma non trascinabile. */
  seekDisabled?: boolean;
}

/** Stato osservabile della finestra PiP. */
export interface PipWindowState {
  open: boolean;
  title?: string;
  edgeResize?: boolean;
  isLive?: boolean;
  seekDisabled?: boolean;
  fullscreen?: boolean;
}

/**
 * Helper: sottoscrive un evento Wails e ritorna l'unsubscribe (shape stessa
 * di Electron `ipcRenderer.removeListener`). Il runtime Wails v3 alpha.79
 * espone `Events.On(name, handler)` che ritorna già una funzione di cleanup.
 */
function onEvent<T>(name: string, cb: (payload: T) => void): () => void {
  // Events.On firma: `(name, handler) => unsubscribe`. Il payload arriva
  // come `WailsEvent { name, sender, data }`. Estraiamo `data` per allinearci
  // alla shape Electron (callback chiamata col solo payload).
  const off = WailsEvents.On(name, (event: unknown) => {
    const data = (event as { data?: T } | null | undefined)?.data;
    cb(data as T);
  });
  return typeof off === 'function' ? off : () => undefined;
}

/**
 * Costruisce l'`OpenOptions` che il backend Go si aspetta.
 *
 * I booleani si passano esplicitamente: i campi non valorizzati arriverebbero
 * `undefined` e per `isLive` valgono "mostra la timeline" — cioè esattamente il
 * comportamento sbagliato per un canale live.
 */
const toPipOptions = (opts?: PipOptions): PipOpenOptions =>
  new PipOpenOptions({
    title: opts?.title ?? '',
    isLive: opts?.isLive ?? false,
    seekDisabled: opts?.seekDisabled ?? false,
  });

export const wailsBridge: HostAPI = {
  isWails: true,

  // --- Discovery ---
  discoverDevices: () => Discovery.DiscoverDevices() as unknown as Promise<unknown[]>,
  getLocalIPs: () => Discovery.GetLocalIPs() as unknown as Promise<unknown[]>,
  scanIp: (target) => Discovery.ScanIP(target) as unknown as Promise<unknown[]>,
  probeDeviceServices: (ip) => Discovery.ProbeDeviceServices(ip) as unknown as Promise<string[]>,
  onDeviceFound: (cb) => onEvent('device-found', cb),

  // --- Cast ---
  castConnect: async ({ host, port }) => {
    await Cast.Connect(host, port ?? 8009);
  },
  castLoad: async (options) => {
    // Lato Go il payload è `cast.LoadRequest`; lo passiamo as-is sperando in
    // shape compatibile con la chiamata Electron (URL, contentType, …).
    await Cast.Load(options as any);
  },
  castControl: async (options) => {
    await Cast.Control(options as any);
  },
  castDisconnect: () => Cast.Disconnect() as unknown as Promise<void>,
  onCastStatus: (cb) => onEvent('cast-status', cb),

  // --- Status broadcast / remote control ---
  updatePlaybackStatus: (status) => {
    // L'API Electron è fire-and-forget; manteniamo la stessa semantica e
    // logghiamo i fallimenti senza propagarli (le UI non aspettano l'ack).
    NetStatus.UpdatePlaybackStatus(status as any).catch((err) => {
      console.warn('[wailsBridge] updatePlaybackStatus failed:', err);
    });
  },
  onNetworkPlaybackStatus: (cb) => onEvent('network-playback-status', cb),
  onRemoteControlCommand: (cb) => onEvent('remote-control-command', cb),
  onRequestStatusBroadcast: (cb) => onEvent('request-status-broadcast', () => cb()),

  // --- GPU / HW accel ---
  // Adatta `player.HwAccelInfo` (shape Go) alla shape `GpuStatus` di
  // `hwAccelService.ts`. Su Wails la fonte è libmpv (`hwdec-current`,
  // `mpv-version`, ecc.), non Chromium feature flags.
  getGpuStatus: async () => {
    try {
      const info = (await Player.HwAccelInfo()) as {
        built: boolean;
        accelerated: boolean;
        hwdecCurrent: string;
        mpvVersion: string;
        libmpvApiVersion: number;
        videoCodec: string;
        videoCodecId: string;
        error?: string;
      };
      return {
        ok: true,
        accelerated: info.accelerated,
        videoDecode: info.accelerated
          ? `enabled (${info.hwdecCurrent})`
          : info.built
            ? info.hwdecCurrent || 'software'
            : 'disabled (mpv backend not built)',
        featureStatus: {
          mpv_version: info.mpvVersion || 'unknown',
          libmpv_api_version: String(info.libmpvApiVersion || 0),
          hwdec_current: info.hwdecCurrent || 'idle',
          video_codec: info.videoCodec || '',
          video_format: info.videoCodecId || '',
        },
        gpuInfo: null,
        platform: 'wails',
        disabledByUser: !info.built,
        switches: { useGl: null, useAngle: null, ozonePlatform: null, enabledFeatures: null },
        error: info.error,
      };
    } catch (err) {
      return {
        ok: false,
        accelerated: false,
        videoDecode: 'unknown',
        featureStatus: {},
        gpuInfo: null,
        platform: 'wails',
        disabledByUser: false,
        switches: { useGl: null, useAngle: null, ozonePlatform: null, enabledFeatures: null },
        error: String((err as Error)?.message || err),
      };
    }
  },

  // --- Proxy IPTV ---
  buildProxyUrl: (streamUrl, userAgent, headers) =>
    Proxy.BuildProxyURL(streamUrl, userAgent ?? '', headers ?? {}) as unknown as Promise<string>,
  proxyPort: () => Proxy.Port() as unknown as Promise<number>,

  // --- Playlist Xtream ---
  playlist: {
    ProcessXtreamPlaylist: (creds) => {
      // Il tipo frontend usa `url`, il binding Go `serverUrl`: senza questa
      // mappatura il backend riceveva `serverUrl: ""` e la pipeline falliva
      // pur essendo la chiamata formalmente valida.
      const c = creds as { url: string; username: string; password: string };
      return Playlist.ProcessXtreamPlaylist(
        new GoXtreamCredentials({ serverUrl: c.url, username: c.username, password: c.password }),
      ) as unknown as Promise<void>;
    },
    LoadCachedCatalog: (creds) => {
      // Stessa mappatura `url` → `serverUrl` di ProcessXtreamPlaylist: senza,
      // il backend cercherebbe la cache di un profilo con server vuoto.
      const c = creds as { url: string; username: string; password: string };
      return Playlist.LoadCachedCatalog(
        new GoXtreamCredentials({ serverUrl: c.url, username: c.username, password: c.password }),
      ) as unknown as Promise<{ playlist: unknown; savedAt: number } | null>;
    },
  },

  // --- Migration ---
  HasLegacyData: () => Migration.HasLegacyData() as unknown as Promise<boolean>,
  GetLegacyData: () => Migration.GetLegacyData() as unknown as Promise<string>,
  GetLegacyPath: () => Migration.GetLegacyPath() as unknown as Promise<string>,
  ImportSnapshot: (jsonData) => Migration.ImportSnapshot(jsonData) as unknown as Promise<boolean>,

  // --- Notifications ---
  sendNotification: (title, message) => {
    Notifications.Send(title, message).catch((err) => {
      console.warn('[wailsBridge] sendNotification failed:', err);
    });
  },

  // --- Window control ---
  toggleFullscreen: () => Window.ToggleFullscreen(),
  isFullscreen: () => Window.IsFullscreen(),

  // --- Picture-in-Picture ---
  pip: {
    open: (opts) => Pip.Open(toPipOptions(opts)) as unknown as Promise<boolean>,
    update: (opts) => Pip.Update(toPipOptions(opts)) as unknown as Promise<void>,
    close: () => Pip.Close() as unknown as Promise<void>,
    state: () => Pip.State() as unknown as Promise<PipWindowState>,
    startResize: (edge) => Pip.StartResize(edge) as unknown as Promise<void>,
    toggleFullscreen: () => Pip.ToggleFullscreen() as unknown as Promise<boolean>,
  },
  onPipStateChange: (cb) => {
    // Tre eventi distinti (apertura, cambio canale, chiusura senza payload): li
    // normalizziamo in un solo callback con uno stato uniforme, così i consumer
    // non devono sapere quanti e quali eventi esistono.
    //
    // `pip:opened` e `pip:updated` portano lo stato completo (`WindowState` lato
    // Go): la vista PiP ci ricava titolo, tipo di canale e fullscreen.
    const offOpen = onEvent<PipWindowState>('pip:opened', (data) =>
      cb({ ...(data ?? {}), open: true }),
    );
    const offUpdated = onEvent<PipWindowState>('pip:updated', (data) =>
      cb({ ...(data ?? {}), open: true }),
    );
    const offClosed = onEvent<null>('pip:closed', () => cb({ open: false }));
    return () => {
      offOpen();
      offUpdated();
      offClosed();
    };
  },
};

export default wailsBridge;

