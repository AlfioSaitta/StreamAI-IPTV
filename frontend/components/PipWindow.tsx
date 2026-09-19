/**
 * PipWindow — vista montata nella finestra Picture-in-Picture.
 *
 * Non è una finestra del browser: è una **seconda finestra Wails** creata dal
 * backend (`internal/services/pip`) che carica lo stesso bundle con `?pip=1`.
 * Il routing avviene in `index.tsx`, prima di montare l'app completa: questa
 * vista non deve tirare su profili, playlist o Sentry.
 *
 * Perché non le API PiP del webview: `requestPictureInPicture()` opera solo su
 * `<video>` e il Document PiP è una feature Chromium (assente su WebKitGTK e
 * WKWebView). Il video qui è un `<canvas>` WebGL2 — vedi il commento di
 * package in `internal/services/pip`.
 *
 * CONTROLLI. La finestra è piccola ma non deve essere una scatola nera: ha
 * timeline (solo per contenuti cercabili), salto ±10s, play/pausa, mute con
 * volume, tutto schermo e chiusura. Il resto — tracce, sottotitoli, EPG, cast —
 * resta nella finestra principale, che conserva il controllo completo.
 *
 * Chi disegna: questa finestra. La finestra principale, quando il PiP è
 * aperto, ferma il proprio loop (evento `pip:opened` → `enabled: false`): due
 * loop a piena cadenza raddoppierebbero il costo di conversione dei frame per
 * mostrare la stessa cosa.
 *
 * Il frame richiesto al backend è dimensionato sul canvas (≈480×270), quindi
 * il costo di render qui è circa un quarto di quello di un canvas 720p.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FastForward,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Rewind,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { host, type PipWindowState } from '../services/hostBridge';
import { useMpvCanvasRenderer } from '../hooks/useMpvCanvasRenderer';
import { useNativeMpvEngine } from '../hooks/useNativeMpvEngine';
import { useInteractiveTimeline } from '../hooks/useInteractiveTimeline';
import { formatTime } from './player/playerUtils';

/** Tempo di inattività del mouse prima che i controlli scompaiano. */
const CHROME_HIDE_DELAY_MS = 2500;

/** Passo dei salti con le frecce e con i pulsanti. */
const SKIP_SECONDS = 10;

/**
 * Maniglie di ridimensionamento sui bordi.
 *
 * Servono solo dove il runtime di Wails NON le gestisce (`state().edgeResize`,
 * cioè Linux): lì `drag.js` esce subito con `!IsWindows()` e il resize dai bordi
 * non partirebbe mai. Il backend GTK3 è invece pronto, quindi ogni maniglia
 * chiede il resize via `host.pip.startResize(edge)`.
 *
 * Sono invisibili ma con il cursore giusto, come le cornici di una finestra
 * normale. Gli angoli vengono dopo i lati nel DOM, così vincono dove si
 * sovrappongono.
 */
const RESIZE_HANDLES: Array<{ edge: string; className: string }> = [
  { edge: 'n-resize', className: 'top-0 left-2 right-2 h-1.5 cursor-ns-resize' },
  { edge: 's-resize', className: 'bottom-0 left-2 right-2 h-1.5 cursor-ns-resize' },
  { edge: 'w-resize', className: 'left-0 top-2 bottom-2 w-1.5 cursor-ew-resize' },
  { edge: 'e-resize', className: 'right-0 top-2 bottom-2 w-1.5 cursor-ew-resize' },
  { edge: 'nw-resize', className: 'top-0 left-0 w-3 h-3 cursor-nwse-resize' },
  { edge: 'ne-resize', className: 'top-0 right-0 w-3 h-3 cursor-nesw-resize' },
  { edge: 'sw-resize', className: 'bottom-0 left-0 w-3 h-3 cursor-nesw-resize' },
  { edge: 'se-resize', className: 'bottom-0 right-0 w-3 h-3 cursor-nwse-resize' },
];

const PipWindow: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [title, setTitle] = useState('StreamAI');
  const [edgeResize, setEdgeResize] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [seekDisabled, setSeekDisabled] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const hideTimerRef = useRef<number | null>(null);
  // Serve a riallineare lo stato della finestra solo quando i controlli
  // ricompaiono (vedi revealChrome), non a ogni movimento del mouse.
  const chromeWasVisibleRef = useRef(true);

  // Engine: stato + comandi. `useNativeMpvEngine` è già event-driven
  // (`player-state`) con un poll di sicurezza, quindi qui non serve altro.
  const engine = useNativeMpvEngine({ poll: true });
  const isPlaying = Boolean(engine.state?.playing);
  const isMuted = Boolean(engine.state?.muted);
  const position = Number(engine.state?.position ?? 0);
  const duration = Number(engine.state?.duration ?? 0);
  const volume = Number(engine.state?.volume ?? 1);

  // La timeline ha senso solo dove il seek esiste: un live non ha durata nota
  // (e non è cercabile), e su alcuni server il seek è disabilitato dal probe.
  const showTimeline = !isLive && duration > 0;
  const canSeek = showTimeline && !seekDisabled;

  const applyState = useCallback((st: PipWindowState | null | undefined) => {
    if (!st?.open) return;
    if (st.title) setTitle(st.title);
    setEdgeResize(Boolean(st.edgeResize));
    setIsLive(Boolean(st.isLive));
    setSeekDisabled(Boolean(st.seekDisabled));
    setFullscreen(Boolean(st.fullscreen));
  }, []);

  const syncState = useCallback(async () => {
    try {
      applyState(await host?.pip?.state?.());
    } catch (err) {
      console.warn('[PiP] lettura stato fallita:', err);
    }
  }, [applyState]);

  // Titolo, tipo di canale e fullscreen arrivano dal backend: al mount (un
  // reload di questa webview non azzera lo stato della finestra) e a ogni
  // evento, perché il canale può cambiare mentre il PiP è aperto.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const st = await host?.pip?.state?.();
        if (!cancelled) applyState(st);
      } catch (err) {
        console.warn('[PiP] lettura stato fallita:', err);
      }
    })();
    const off = host?.onPipStateChange?.((state: PipWindowState) => {
      if (state?.open) applyState(state);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [applyState]);

  // Loop di render. `paused` rallenta (non ferma) quando il player non sta
  // riproducendo: in pausa mpv restituisce lo stesso frame, e a 0.5 fps il
  // canvas resta aggiornato dopo un seek senza bruciare CPU.
  useMpvCanvasRenderer(canvasRef, true, { targetFPS: 30, paused: !isPlaying });

  const close = useCallback(() => {
    void host?.pip?.close?.();
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      void engine.pause();
    } else {
      void engine.play();
    }
  }, [engine, isPlaying]);

  const toggleMute = useCallback(() => {
    void engine.setMuted(!isMuted);
  }, [engine, isMuted]);

  const setVolume = useCallback(
    (v: number) => {
      void engine.setVolume(v);
      // Trascinare il volume a zero equivale a silenziare, e viceversa: senza
      // questo il pulsante del mute resterebbe incoerente col cursore.
      if (v > 0 && isMuted) void engine.setMuted(false);
    },
    [engine, isMuted],
  );

  const skip = useCallback(
    (delta: number) => {
      if (!canSeek) return;
      const target = Math.max(0, Math.min(duration, position + delta));
      void engine.seek(target);
    },
    [canSeek, duration, engine, position],
  );

  const toggleFullscreen = useCallback(async () => {
    try {
      const now = await host?.pip?.toggleFullscreen?.();
      setFullscreen(Boolean(now));
    } catch (err) {
      console.warn('[PiP] fullscreen non disponibile:', err);
    }
  }, []);

  // Timeline: pointer-based, emette UN seek al rilascio (non uno per pixel) —
  // stesso hook della finestra principale, per non avere due comportamenti
  // diversi di trascinamento fra le due finestre.
  const onSeek = useCallback(
    (time: number) => {
      if (!canSeek) return;
      void engine.seek(time);
    },
    [canSeek, engine],
  );
  const { timelineRef, isScrubbing, scrubTime, onPointerDown, onMouseMove, onMouseLeave } =
    useInteractiveTimeline({ duration, onSeek });
  // Durante il trascinamento il cursore segue il dito (UI ottimistica): la
  // posizione reale non cambia finché il seek non è completato dal server.
  const displayTime = isScrubbing && scrubTime !== null ? scrubTime : position;

  // Scorciatoie della finestra PiP: solo quelle che hanno senso qui. Il resto
  // resta nella finestra principale, che conserva il controllo completo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault();
          togglePlay();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          void toggleFullscreen();
          break;
        case 'ArrowLeft':
          if (!canSeek) return;
          e.preventDefault();
          skip(-SKIP_SECONDS);
          break;
        case 'ArrowRight':
          if (!canSeek) return;
          e.preventDefault();
          skip(SKIP_SECONDS);
          break;
        case 'Escape':
          e.preventDefault();
          // In fullscreen Esc esce dal fullscreen invece di chiudere: è ciò che
          // fa qualunque player, e altrimenti per tornare alla finestra
          // principale servirebbe il mouse.
          if (fullscreen) {
            void toggleFullscreen();
          } else {
            close();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, toggleMute, toggleFullscreen, skip, canSeek, fullscreen, close]);

  // I controlli si nascondono quando il mouse è fermo: in PiP lo spazio è
  // poco e l'overlay non deve coprire il video.
  const revealChrome = useCallback(() => {
    if (!chromeWasVisibleRef.current) {
      // I controlli sono appena ricomparsi: è l'unico momento in cui l'icona
      // del fullscreen si vede, quindi è il momento giusto per riallinearla con
      // lo stato reale (il compositor può essere uscito dal fullscreen da solo,
      // e una richiesta di toggle non è applicata in modo sincrono).
      void syncState();
    }
    chromeWasVisibleRef.current = true;
    setChromeVisible(true);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      chromeWasVisibleRef.current = false;
      setChromeVisible(false);
    }, CHROME_HIDE_DELAY_MS);
  }, [syncState]);

  useEffect(() => {
    revealChrome();
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [revealChrome]);

  const chromeClass = `transition-opacity duration-200 ${chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`;

  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-black"
      onMouseMove={revealChrome}
      // TRASCINAMENTO DELLA FINESTRA — su tutto il riquadro, non solo sulla
      // barra del titolo.
      //
      // `--wails-draggable` è una custom property CSS e quindi si **eredita**:
      // il runtime di Wails legge `getComputedStyle(elemento sotto il mouse)` e
      // avvia `gtk_window_begin_move_drag` se trova `drag`. Marcando la radice,
      // ogni punto del video (e delle due barre) diventa trascinabile; i
      // controlli lo disattivano con `no-drag` sul proprio sottoalbero.
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full object-contain"
        // Il canvas è l'unico contenuto: sotto non c'è nulla su cui cliccare.
        // Un click senza spostamento resta un click (il drag parte solo al
        // primo movimento), quindi non serve disattivare il trascinamento qui.
        style={{ display: 'block' }}
      />

      {/* Barra del titolo. Nessun `--wails-draggable` esplicito: eredita `drag`
          dalla radice. */}
      <div
        className={`absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-2 bg-gradient-to-b from-black/80 to-transparent pl-2 pr-4 ${chromeClass}`}
      >
        <span className="truncate text-xs font-medium text-gray-200" title={title}>
          {title}
        </span>
        {isLive && (
          <span className="shrink-0 rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Live
          </span>
        )}
      </div>

      {/* Controlli. Timeline (solo dove il seek ha senso) sopra, pulsanti sotto:
          nella finestra alta 270 px due righe restano leggibili e lasciano
          comunque spazio al video. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-6 ${chromeClass}`}
      >
        {showTimeline && (
          <div className="mb-1.5 flex items-center gap-2">
            <span className="w-9 shrink-0 text-right text-[10px] tabular-nums text-gray-300">
              {formatTime(displayTime)}
            </span>
            <div
              ref={timelineRef}
              data-pip-timeline
              className={`relative h-1.5 flex-1 rounded-full bg-white/20 ${
                canSeek ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
              }`}
              // Senza `no-drag` il trascinamento del cursore farebbe partire lo
              // spostamento della finestra (la radice è `drag`).
              style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
              onPointerDown={canSeek ? onPointerDown : undefined}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-brand-primary"
                style={{ width: `${duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0}%` }}
              />
              <div
                className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-primary shadow"
                style={{ left: `${duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0}%` }}
              />
            </div>
            <span className="w-11 shrink-0 text-[10px] tabular-nums text-gray-300">
              {formatTime(duration)}
            </span>
          </div>
        )}

        <div className="flex items-center justify-center gap-2">
          {showTimeline && (
            <button
              type="button"
              onClick={() => skip(-SKIP_SECONDS)}
              disabled={!canSeek}
              aria-label="Indietro 10 secondi"
              title={seekDisabled ? 'Seek non supportato dal server' : 'Indietro 10s (←)'}
              className={`rounded-full p-1.5 text-white transition-colors ${
                canSeek ? 'hover:bg-white/15' : 'cursor-not-allowed opacity-40'
              }`}
              style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
            >
              <Rewind className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pausa' : 'Riproduci'}
            title={isPlaying ? 'Pausa (Spazio)' : 'Riproduci (Spazio)'}
            className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          {showTimeline && (
            <button
              type="button"
              onClick={() => skip(SKIP_SECONDS)}
              disabled={!canSeek}
              aria-label="Avanti 10 secondi"
              title={seekDisabled ? 'Seek non supportato dal server' : 'Avanti 10s (→)'}
              className={`rounded-full p-1.5 text-white transition-colors ${
                canSeek ? 'hover:bg-white/15' : 'cursor-not-allowed opacity-40'
              }`}
              style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
            >
              <FastForward className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Attiva audio' : 'Disattiva audio'}
            title={isMuted ? 'Attiva audio (M)' : 'Disattiva audio (M)'}
            className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="Volume"
            title="Volume"
            className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-white/25 accent-brand-primary"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          />

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? 'Esci da tutto schermo' : 'Tutto schermo'}
            title={fullscreen ? 'Esci da tutto schermo (F)' : 'Tutto schermo (F)'}
            className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={close}
            aria-label="Chiudi Picture-in-Picture"
            title="Chiudi (Esc)"
            className="rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Maniglie di ridimensionamento — ULTIME nel DOM, quindi sopra a tutto.
          Prima erano prima delle due barre, che le coprivano: la barra del
          titolo (28 px in alto) rendeva irraggiungibili il bordo nord e i due
          angoli superiori, i controlli in basso il bordo sud e gli angoli
          inferiori, incluso il più usato (in basso a destra). Restavano solo i
          due lati, 6 px ciascuno.

          Invisibili, ma con `no-drag` (così il mousedown non avvia lo
          spostamento) e con il cursore del bordo. */}
      {edgeResize &&
        RESIZE_HANDLES.map((h) => (
          <div
            key={h.edge}
            data-resize-edge={h.edge}
            className={`absolute z-20 ${h.className}`}
            style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              void host?.pip?.startResize?.(h.edge);
            }}
          />
        ))}
    </div>
  );
};

export default PipWindow;
