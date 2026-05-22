/**
 * hwAccelService — query runtime dello stato dell'accelerazione hardware.
 *
 * Combina due fonti:
 *  1. `app.getGPUFeatureStatus()` esposta via Electron IPC
 *     (`window.electronAPI.getGpuStatus`) — fonte autoritativa: dice se
 *     Chromium ha effettivamente abilitato la HW video decode su questa
 *     macchina (VA-API / Media Foundation / VideoToolbox).
 *  2. `navigator.mediaCapabilities.decodingInfo()` per-codec — già usato
 *     da `streamInfoService.ts` per popolare `info.hardwareAccelerated`.
 *
 * Serve a mitigare R22 (silent SW fallback su driver vecchi) mostrando
 * un warning nella diagnostica quando il decoder hardware non è attivo.
 */

import { platformService } from './platformService';

export interface GpuStatus {
  ok: boolean;
  /** True se Chromium ha attivato la HW video decode. */
  accelerated: boolean;
  /** Stringa raw: `enabled`, `enabled_force`, `disabled`, `disabled_software`, … */
  videoDecode: string;
  /** Mappa completa `app.getGPUFeatureStatus()`. */
  featureStatus: Record<string, string>;
  /** Output di `app.getGPUInfo('basic')` (vendor + renderer). */
  gpuInfo: unknown;
  platform: string;
  disabledByUser: boolean;
  switches: {
    useGl: string | null;
    useAngle: string | null;
    ozonePlatform: string | null;
    enabledFeatures: string | null;
  };
  error?: string;
}

const FALLBACK: GpuStatus = {
  ok: false,
  accelerated: false,
  videoDecode: 'unknown',
  featureStatus: {},
  gpuInfo: null,
  platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
  disabledByUser: false,
  switches: { useGl: null, useAngle: null, ozonePlatform: null, enabledFeatures: null },
};

let cached: GpuStatus | null = null;
let inflight: Promise<GpuStatus> | null = null;

/**
 * Risolve lo stato HW del processo host. Cache di sessione (lo stato
 * GPU di Chromium non cambia a runtime senza restart).
 */
export async function getHwAccelStatus(force = false): Promise<GpuStatus> {
  if (!force && cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      if (platformService.isElectron) {
        const api = (window as unknown as {
          electronAPI?: { getGpuStatus?: () => Promise<GpuStatus> };
        }).electronAPI;
        if (api?.getGpuStatus) {
          const status = await api.getGpuStatus();
          cached = status ?? FALLBACK;
          return cached;
        }
      }
      // Non-Electron (web, Wails pre-Fase 6): nessun modo di leggere
      // `getGPUFeatureStatus`; lasciamo il fallback. `streamInfoService`
      // continuerà comunque a popolare `hardwareAccelerated` per-codec
      // via MediaCapabilities.
      cached = { ...FALLBACK, ok: true };
      return cached;
    } catch (error) {
      cached = { ...FALLBACK, error: String((error as Error)?.message || error) };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * True se il decoder video HW è attivo lato host.
 * Usato per il warning runtime quando un codec dichiarato
 * `hardwareAccelerated` da MediaCapabilities in realtà gira in SW.
 */
export function isVideoDecodeHardwareAccelerated(): boolean {
  return cached?.accelerated === true;
}

/** Reset cache (utile nei test). */
export function __resetHwAccelCacheForTests(): void {
  cached = null;
  inflight = null;
}

