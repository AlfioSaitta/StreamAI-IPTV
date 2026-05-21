/**
 * Host bridge — unico punto d'ingresso che astrae il backend desktop
 * sottostante. Switcha a runtime tra il bridge Electron (legacy
 * `window.electronAPI`) e il bridge Wails v3 (`services/wailsBridge.ts`).
 *
 * I componenti UI e i custom hook DEVONO importare `host` da qui invece di
 * leggere `window.electronAPI` direttamente — questo permette di migrare
 * incrementalmente i call site (plan rev. 6, Fase 7.2) senza branch
 * platform-specific sparsi.
 *
 * Comportamento:
 *   - `platformService.isWails` ⇒ usa `wailsBridge`
 *   - `platformService.isElectron` ⇒ usa `window.electronAPI`
 *   - altri runtime (web, mobile) ⇒ `host` è `null` e i chiamanti DEVONO
 *     fare guardia (esistono già check `isElectron`/`isWeb` nei componenti
 *     interessati).
 *
 * Vedi `docs/plan-go-wails-migration.md` §3.1 e §3.3.
 */

import platformService from './platformService';
import wailsBridge from './wailsBridge';

/**
 * Tipo loose intenzionale durante la Fase 7.2: il branch Electron espone
 * più metodi (es. `castToDevice`) di quanto `wailsBridge` modelli oggi.
 * I call site mantengono i loro guard runtime (`if (host)`) — la tipizzazione
 * stretta arriverà in Fase 7.3 quando Electron sarà rimosso.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostLike = any | null;

let cached: HostLike | undefined;

function resolveHost(): HostLike {
  if (cached !== undefined) return cached;

  if (platformService.isWails) {
    cached = wailsBridge;
    return cached;
  }
  if (platformService.isElectron && typeof window !== 'undefined') {
    cached = (window as unknown as { electronAPI?: unknown }).electronAPI ?? null;
    return cached;
  }
  cached = null;
  return cached;
}

/**
 * Accessor pigro: cristallizzato alla prima call.
 * `null` su web/mobile — i call site devono fare guardia.
 */
export const host: HostLike = resolveHost();

/**
 * Variante strict: lancia se nessun bridge desktop è disponibile.
 * Preferibile post-Fase 7.2 nei chiamanti che oggi assumono Electron sempre presente.
 */
export function requireHost(): NonNullable<HostLike> {
  const h = resolveHost();
  if (!h) {
    throw new Error(
      '[hostBridge] No desktop bridge available (running in web/mobile? expected Electron or Wails)',
    );
  }
  return h;
}

export default host;

