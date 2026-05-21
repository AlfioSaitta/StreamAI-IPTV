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

import { Events as WailsEvents } from '@wailsio/runtime';

// Binding TS generati da `wails3 generate bindings -ts -d frontend/bindings ./...`
// (script: `npm run wails:bindings`). Sono in `.gitignore`: rigenerare dopo
// ogni modifica alle firme dei Service Go.
import * as Discovery from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/discovery/service';
import * as Cast from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/cast/service';
import * as NetStatus from '../bindings/github.com/AlfioSaitta/StreamAI-IPTV/internal/services/netstatus/service';

/**
 * Sottoinsieme dell'API `window.electronAPI` esposta a `services/hostBridge.ts`.
 * Tipata in modo lasco per backward-compat con i call site esistenti
 * (alcune funzioni accettano oggetti opaco-typed dalla parte Electron).
 */
export interface HostAPI {
  readonly isElectron: false;
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

export const wailsBridge: HostAPI = {
  isElectron: false,
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
};

export default wailsBridge;

