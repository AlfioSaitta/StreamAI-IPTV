/**
 * Host bridge — unico punto d'ingresso per chiamare il backend desktop.
 *
 * Da rev. 7 del plan (Fase 7.3, 2026-05-22): Electron è stato rimosso.
 * Il bridge è ora una semplice ri-esportazione di `wailsBridge`,
 * disponibile su runtime Wails v3 e `null` su web/mobile (Capacitor).
 * I call site devono fare guard runtime via `if (host) { ... }` o
 * usare `requireHost()` quando assumono un bridge presente.
 *
 * Vedi `docs/plan-go-wails-migration.md` §3.1 e §14 (inventario rimozione
 * Electron) per il razionale.
 *
 * NOTE — tipizzazione transitoria: la shape di `wailsBridge` (`HostAPI`)
 * è ancora un sottoinsieme stretto dell'API che servirà al frontend
 * (mancano alcuni metodi come `castToDevice`, payload tipizzati, ecc.).
 * Per evitare di forzare grossi refactor immediati dei call site, `host`
 * espone una vista *loose* (`any`). La tipizzazione stretta arriverà
 * insieme al completamento di `wailsBridge` (Fase 6/7-bis).
 */
import platformService from './platformService';
import wailsBridge, { type HostAPI } from './wailsBridge';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostLike = any | null;

/**
 * Risolve il bridge host al volo. NON cachiamo `null` perché
 * `platformService.isWails` può diventare `true` dopo l'iniezione tardiva
 * di `window._wails` da parte di `@wailsio/runtime` (race del bundler).
 * Cachiamo solo quando il bridge è effettivamente disponibile.
 */
let cached: NonNullable<HostLike> | undefined;
function resolveHost(): HostLike {
  if (cached !== undefined) return cached;
  if (platformService.isWails) {
    cached = wailsBridge as HostLike;
    return cached;
  }
  return null;
}
/**
 * Accessor lazy: ritorna `null` su web/mobile.
 * NB: ogni accesso richiama `resolveHost()` — non cachiamo il valore in
 * un'export costante per evitare di "congelare" il `null` iniziale.
 */
export const host: HostLike = new Proxy(
  {},
  {
    get(_target, prop) {
      const h = resolveHost();
      if (!h) return undefined;
      return (h as any)[prop];
    },
    has(_target, prop) {
      const h = resolveHost();
      return h ? prop in (h as any) : false;
    },
  },
) as HostLike;
/**
 * Variante strict: lancia se non siamo su Wails desktop.
 */
export function requireHost(): NonNullable<HostLike> {
  const h = resolveHost();
  if (!h) {
    throw new Error(
      '[hostBridge] No desktop bridge available (running in web/mobile? expected Wails v3)',
    );
  }
  return h;
}
export type { HostAPI };
export default host;
