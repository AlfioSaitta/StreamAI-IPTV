/**
 * usePlayerErrorRing — ring buffer degli ultimi 10 errori di playback.
 *
 * Estratto da `VideoPlayerNew.tsx` come parte di REF-1.a (hotspot split,
 * IMPROVEMENT_TODO §REF-1.a). Centralizza la logica del ring buffer in
 * un hook riusabile, condiviso tra:
 *
 *   - `VideoPlayerNew.tsx` → consumatore principale (UI controllo player)
 *   - `components/player/StreamDiagnostics.tsx` → pannello diagnostica
 *     legge `recentErrors` per la tabella "Errori recenti"
 *   - eventuali futuri pannelli di debug
 *
 * Capacità (`MAX_PLAYER_ERROR_RING_SIZE`): 10 entry. Politica di
 * inserimento: prepend (nuovo errore in cima) + slice. Dedup basato su
 * **identità di oggetto** (`PlaybackErrorState` ricreato a ogni
 * mutazione del classifier in `VideoPlayerNew.tsx`): non aggiungiamo se
 * il ref ricevuto è lo stesso del precedente.
 *
 * NB: la dedup per identità è coerente con la legacy implementation; se
 * `scheduleRetry()` rilancia lo stesso oggetto error (non clonato) il
 * ring buffer non duplica. Quando il classifier produce un nuovo
 * `PlaybackErrorState` (es. transizione `network` → `decoder`) viene
 * inserita una nuova entry.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PlaybackErrorState } from '../components/player/playerTypes';
import type { RecentPlaybackError } from '../components/player/StreamDiagnostics';

export type { RecentPlaybackError };

export const MAX_PLAYER_ERROR_RING_SIZE = 10;

export interface UsePlayerErrorRingResult {
  /**
   * Snapshot ordinato (newest first) degli ultimi errori. Stabile per
   * render — solo updates su mutazione di `playbackError`.
   */
  recentErrors: RecentPlaybackError[];
  /**
   * Reset del ring buffer. Chiamato dal consumer su cambio canale /
   * cleanup player. Idempotente (no-op se già vuoto).
   */
  clear: () => void;
}

/**
 * Hook ring buffer errori.
 *
 * @param playbackError stato corrente dell'errore (null = no error).
 *        Transizioni `null → !null` o cambio identità (nuovo oggetto)
 *        triggerano l'append.
 */
export function usePlayerErrorRing(
  playbackError: PlaybackErrorState | null,
): UsePlayerErrorRingResult {
  const [recentErrors, setRecentErrors] = useState<RecentPlaybackError[]>([]);

  // Dedup per identità di oggetto: usato per non duplicare lo stesso
  // PlaybackErrorState passato in più render. Ricondizionato a null
  // quando `playbackError` torna null (errore "risolto").
  const lastErrorRef = useRef<PlaybackErrorState | null>(null);

  useEffect(() => {
    if (playbackError && playbackError !== lastErrorRef.current) {
      lastErrorRef.current = playbackError;
      setRecentErrors((prev) =>
        [
          {
            ts: Date.now(),
            title: playbackError.title,
            message: playbackError.message,
            category: playbackError.category,
          },
          ...prev,
        ].slice(0, MAX_PLAYER_ERROR_RING_SIZE),
      );
    }
    if (!playbackError) {
      lastErrorRef.current = null;
    }
  }, [playbackError]);

  const clear = useCallback(() => {
    lastErrorRef.current = null;
    setRecentErrors([]);
  }, []);

  return { recentErrors, clear };
}

export default usePlayerErrorRing;

