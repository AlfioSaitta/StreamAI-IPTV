/**
 * NativeMpvSmokeTest — pagina di verifica end-to-end della pipeline
 * libmpv → AssetMiddleware HTTP → canvas 2D. Attivabile da URL con
 * `?nativeMpv=1` (vedi Root in App.tsx). Stage A della Fase 6.1.
 *
 * Cosa permette di verificare:
 *   1. Il binario è stato compilato con `-tags 'gtk3 mpv'` (banner verde
 *      "Backend libmpv: PRONTO" / banner rosso "errNotBuilt").
 *   2. La control-plane (Load/Play/Pause/Volume) parla con libmpv.
 *   3. L'endpoint HTTP `/player/frame?w=...&h=...` ritorna byte RGBA
 *      validi e il canvas li disegna.
 *
 * NON è il player di produzione: niente OSD, niente keyboard shortcuts
 * avanzati, niente HDR/sub. È un harness per validare lo Stage A prima
 * di integrare in `VideoPlayerNew.tsx` (Stage B).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNativeMpvEngine } from '../hooks/useNativeMpvEngine';
import { useMpvCanvasRenderer } from '../hooks/useMpvCanvasRenderer';
import { platformService } from '../services/platformService';

const DEFAULT_TEST_URL =
  'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

const NativeMpvSmokeTest = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState(DEFAULT_TEST_URL);
  const [rendering, setRendering] = useState(false);
  const engine = useNativeMpvEngine({ poll: true });
  const { frameCount, error: rendererError, lastFrameMs, hasRenderedFrame } =
    useMpvCanvasRenderer(canvasRef, rendering, { width: 1280, height: 720, targetFPS: 30 });

  const onLoad = useCallback(async () => {
    if (!url.trim()) return;
    await engine.load(url.trim());
    setRendering(true);
  }, [engine, url]);

  const onStop = useCallback(async () => {
    setRendering(false);
    await engine.stop();
  }, [engine]);

  // Esc → torna all'app reale rimuovendo il query param (reload).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const url = new URL(window.location.href);
        url.searchParams.delete('nativeMpv');
        window.location.href = url.toString();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const backendBuilt =
    engine.error?.message?.includes('rebuild with -tags mpv') ?? false;
  const backendOk = !backendBuilt && (engine.state !== null || engine.error === null);
  const state = engine.state;

  return (
    <div className="fixed inset-0 z-[1000] bg-surface-0 text-text-primary flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-4 border-b border-surface-2 bg-surface-1">
        <div>
          <h1 className="text-xl font-bold">
            🎬 Native libmpv player — Smoke test (Fase 6.1 Stage A)
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Pipeline: libmpv → /player/frame → canvas 2D. Premi{' '}
            <kbd className="px-1.5 py-0.5 bg-surface-3 rounded text-xs">Esc</kbd>{' '}
            per tornare all'app.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div
            className={`px-3 py-1 rounded-control text-xs font-semibold ${
              backendBuilt
                ? 'bg-state-error/20 text-state-error'
                : backendOk
                  ? 'bg-state-success/20 text-state-success'
                  : 'bg-state-warning/20 text-state-warning'
            }`}
          >
            {backendBuilt
              ? '❌ Backend stub (rebuild -tags mpv)'
              : backendOk
                ? '✅ Backend libmpv: PRONTO'
                : '⏳ Backend: in attesa…'}
          </div>
          <div className="text-xs text-text-secondary">
            Wails: {platformService.isWails ? '✓' : '✗'} · Desktop:{' '}
            {platformService.isDesktop ? '✓' : '✗'}
          </div>
        </div>
      </header>

      {/* Canvas + controls */}
      <main className="flex-1 flex flex-col lg:flex-row gap-4 p-4 min-h-0">
        {/* Left: canvas */}
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex-1 bg-black rounded-card overflow-hidden relative flex items-center justify-center">
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full"
              style={{
                aspectRatio: '16 / 9',
                width: rendering ? '100%' : '0',
                height: rendering ? '100%' : '0',
              }}
            />
            {!rendering && (
              <div className="text-text-secondary text-center px-8">
                <p className="text-lg mb-2">Inserisci un URL e premi Load</p>
                <p className="text-sm">
                  Stream HTTP/HLS/MPEG-TS supportati da libmpv (H.264, HEVC, AV1, …)
                </p>
              </div>
            )}
            {rendering && !hasRenderedFrame && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-center">
                  <div className="w-12 h-12 border-4 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">
                    In attesa del primo frame da libmpv…
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Status panel */}
          <div className="bg-surface-1 rounded-card p-3 text-xs font-mono space-y-1">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Frame disegnati" value={frameCount} />
              <Stat label="Ultimo ciclo" value={`${lastFrameMs.toFixed(1)} ms`} />
              <Stat
                label="Posizione"
                value={state ? `${state.position.toFixed(1)} s` : '—'}
              />
              <Stat
                label="Durata"
                value={state && state.duration > 0 ? `${state.duration.toFixed(0)} s` : 'LIVE'}
              />
              <Stat label="Pausa" value={state?.paused ? 'sì' : 'no'} />
              <Stat
                label="Volume"
                value={state ? `${Math.round(state.volume * 100)}%` : '—'}
              />
              <Stat label="Muted" value={state?.muted ? 'sì' : 'no'} />
              <Stat
                label="Bitrate"
                value={state?.bitrateKbps ? `${state.bitrateKbps} kbps` : '—'}
              />
            </div>
            {(engine.error || rendererError) && (
              <div className="mt-2 pt-2 border-t border-surface-2 text-state-error">
                <div>
                  <strong>engine error:</strong> {engine.error?.message ?? '—'}
                </div>
                <div>
                  <strong>renderer error:</strong> {rendererError?.message ?? '—'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: controls */}
        <aside className="lg:w-80 flex flex-col gap-3">
          <div>
            <label className="block text-sm font-semibold mb-1">URL stream</label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 bg-surface-2 rounded-control text-sm font-mono"
              placeholder="http://… .m3u8 / .mp4 / .ts"
              disabled={rendering}
            />
            <p className="text-xs text-text-secondary mt-1">
              I link Xtream IPTV vanno passati nudi: libmpv parsa direttamente HLS/TS.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onLoad}
              disabled={rendering || !url.trim()}
              className="flex-1 px-4 py-2 rounded-control bg-brand-primary text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-primary/90"
            >
              ▶ Load &amp; Play
            </button>
            <button
              type="button"
              onClick={onStop}
              disabled={!rendering}
              className="px-4 py-2 rounded-control bg-surface-2 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-3"
            >
              ⏹ Stop
            </button>
          </div>

          {rendering && (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void engine.play()}
                  className="flex-1 px-3 py-2 rounded-control bg-surface-2 text-sm hover:bg-surface-3"
                >
                  Play
                </button>
                <button
                  type="button"
                  onClick={() => void engine.pause()}
                  className="flex-1 px-3 py-2 rounded-control bg-surface-2 text-sm hover:bg-surface-3"
                >
                  Pause
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-1">
                  Volume: {Math.round((state?.volume ?? 0) * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round((state?.volume ?? 0.5) * 100)}
                  onChange={(e) => void engine.setVolume(Number(e.target.value) / 100)}
                  className="w-full"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void engine.setMuted(!state?.muted)}
                  className="flex-1 px-3 py-2 rounded-control bg-surface-2 text-sm hover:bg-surface-3"
                >
                  {state?.muted ? '🔇 Unmute' : '🔊 Mute'}
                </button>
                <button
                  type="button"
                  onClick={() => state && void engine.seek(Math.max(0, state.position - 10))}
                  className="px-3 py-2 rounded-control bg-surface-2 text-sm hover:bg-surface-3"
                >
                  -10s
                </button>
                <button
                  type="button"
                  onClick={() => state && void engine.seek(state.position + 10)}
                  className="px-3 py-2 rounded-control bg-surface-2 text-sm hover:bg-surface-3"
                >
                  +10s
                </button>
              </div>
            </>
          )}

          <div className="mt-auto pt-3 text-xs text-text-secondary">
            <strong>Note Stage A:</strong>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>Path SW (libmpv → RGBA readback in CPU)</li>
              <li>Cap 1080p, 30 fps (target QA)</li>
              <li>Niente HW decode video lato canvas (vedrai HW decode su libmpv)</li>
              <li>Stage B: WebGL2 + NV12/P010 zero-copy</li>
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
};

const Stat = ({ label, value }: { label: string; value: string | number }) => (
  <div>
    <div className="text-text-secondary uppercase text-[10px] tracking-wide">{label}</div>
    <div className="text-text-primary font-bold">{value}</div>
  </div>
);

export default NativeMpvSmokeTest;

