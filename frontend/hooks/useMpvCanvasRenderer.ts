/**
 * useMpvCanvasRenderer — RAF loop che disegna i frame video di libmpv
 * sul `<canvas>` puntato da `canvasRef`.
 *
 * Architettura (Fase 6.1 Stage A→B, plan rev. 7.1 §6.1):
 *
 *   libmpv (mpv_render_context_render, MPV_RENDER_API_TYPE_SW, "rgb0")
 *      │
 *      ▼  []byte (w*h*4 bytes, R G B X)
 *   player.Service.RenderFrame(w,h) ← chiamato dal middleware HTTP
 *      │
 *      ▼  HTTP GET /player/frame?w=W&h=H  (same-origin asset middleware)
 *   webview fetch() → ArrayBuffer
 *      │
 *      ▼  uploadFrame()
 *   <canvas> 2D + ImageData.set(buf) + putImageData
 *
 * Stage A path = "RGBA readback / 2D canvas" — semplice, funziona ovunque
 * il backend libmpv sia disponibile. Costo: ~17 ms/frame a 1080p sul dev
 * host (cf. SPIKE-1 results 2026-05-22). Stage B userà OpenGL render-API
 * + WebGL2 shader BT.709 → sRGB per i 4K@60.
 *
 * NB sul pixel format:
 *   libmpv "rgb0" = 4 byte/pixel, ordine R, G, B, X (X = padding).
 *   Canvas ImageData = RGBA con A interpretato come alpha pre-moltiplicata.
 *   Setting brutale: alpha byte = 0xff. Costa una scan in JS sul buffer
 *   ricevuto — accettabile fino a 1080p (~250k iter per frame). A 4K
 *   passeremo a WebGL `gl.texImage2D(GL_RGB, GL_UNSIGNED_BYTE)` + shader.
 *
 * Backpressure:
 *   Lanciamo UN solo fetch alla volta. Se la render-loop del backend è
 *   più lenta del nostro RAF (es. decoder hwdec=no a 1080p ~30 ms),
 *   il prossimo fetch parte solo dopo che il precedente si è risolto +
 *   è stato disegnato. Questo evita di accodare richieste HTTP che il
 *   middleware servirebbe tutte serializzate sotto lo stesso `s.mu`.
 *
 * AbortController:
 *   La cleanup del useEffect aborta il fetch in volo per evitare race
 *   condition al cambio canvas size / unmount del componente padre.
 *
 * @param canvasRef ref al `<canvas>` di destinazione (deve esistere al
 *                  primo run dell'effect, altrimenti il loop è no-op).
 * @param enabled   se false il loop non parte (utile per gating su
 *                  `platformService.isWails && featureFlag`).
 * @param opts.width / opts.height
 *                  dimensione del frame richiesto al backend. Se 0/undef
 *                  il loop usa le dimensioni del canvas (DPR-aware).
 *                  Tipicamente 1280×720 o 1920×1080.
 * @param opts.targetFPS
 *                  cap sul throughput (default 30). Backend libmpv genera
 *                  frame al ritmo del decoder, ma il readback RGBA è
 *                  bottleneck → 30 fps con minimo drift visivo, accettabile
 *                  per Stage A smoke test.
 */
import { useEffect, useRef, useState } from 'react';

export interface UseMpvCanvasRendererOptions {
  width?: number;
  height?: number;
  targetFPS?: number;
  /** Callback chiamata quando le dimensioni del canvas cambiano. */
  onResize?: (w: number, h: number) => void;
}

export interface UseMpvCanvasRendererResult {
  /** Numero di frame disegnati dall'avvio del loop. */
  frameCount: number;
  /** Ultimo errore di rete o decoding (null se tutto ok). */
  error: Error | null;
  /** Wall-clock ms dell'ultimo ciclo fetch→draw (utile per diagnostica). */
  lastFrameMs: number;
  /** True se almeno un frame è stato disegnato (utile per UI placeholder). */
  hasRenderedFrame: boolean;
}

const FRAME_ENDPOINT = '/player/frame';

export function useMpvCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  opts: UseMpvCanvasRendererOptions = {},
): UseMpvCanvasRendererResult {
  const { width, height, targetFPS = 60 } = opts;
  const [frameCount, setFrameCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [lastFrameMs, setLastFrameMs] = useState(0);
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);

  // Stato non-reattivo: tenere il contatore fuori da React state per
  // evitare re-render a ogni frame (cost ammortizzato: gli state setter
  // sopra batched a fine ciclo via `setFrameCountBatched`).
  const runStateRef = useRef({ cancelled: false, running: false });

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
      desynchronized: true,
    });

    if (!gl) {
      setError(new Error('useMpvCanvasRenderer: webgl2 context unavailable'));
      return;
    }

    // --- WebGL2 Setup ---
    const compileShader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, `
      attribute vec2 a_pos;
      varying vec2 v_tex;
      void main() {
        gl_Position = vec4(a_pos, 0.0, 1.0);
        v_tex = (a_pos + 1.0) / 2.0;
        v_tex.y = 1.0 - v_tex.y;
      }
    `));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, `
      precision lowp float;
      uniform sampler2D u_tex;
      varying vec2 v_tex;
      void main() {
        gl_FragColor = texture2D(u_tex, v_tex);
      }
    `));
    gl.linkProgram(program);
    gl.useProgram(program);

    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a_pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(a_pos);
    gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const state = runStateRef.current;
    state.cancelled = false;
    state.running = true;
    const abortController = new AbortController();
    const minFrameInterval = 1000 / Math.max(1, targetFPS);
    let lastFrameStart = 0;
    let localFrameCount = 0;
    let localError: Error | null = null;
    let localLastFrameMs = 0;

    // Flush periodico dello state React per evitare 60 re-render/sec.
    const flush = window.setInterval(() => {
      if (state.cancelled) return;
      setFrameCount((prev) => (prev !== localFrameCount ? localFrameCount : prev));
      setLastFrameMs((prev) => (prev !== localLastFrameMs ? localLastFrameMs : prev));
      if (localError) setError(localError);
    }, 500);

    let lastW = 0;
    let lastH = 0;

    const renderLoop = async () => {
      if (state.cancelled) return;

      // Recupero dimensioni correnti del canvas nel DOM.
      let w = canvas.clientWidth;
      let h = canvas.clientHeight;
      
      // Fallback: se clientWidth è 0 (es. appena montato o nascosto), proviamo getBoundingClientRect
      if (w === 0 || h === 0) {
        const rect = canvas.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      }

      // Estremo fallback: se siamo ancora a 0 (layout non pronto), usiamo window size
      // cappata a 720p per non sovraccaricare il backend SW se siamo in fullscreen 4K.
      if (w === 0 || h === 0) {
        w = Math.min(window.innerWidth, 1280);
        h = Math.min(window.innerHeight, 720);
      }

      // Notifica il cambio di dimensioni al chiamante (debounced internamente nel backend/hook).
      if (w !== lastW || h !== lastH) {
        lastW = w;
        lastH = h;
        if (opts.onResize) opts.onResize(w, h);
      }

      let frameW = width;
      let frameH = height;
      if (!frameW || !frameH) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        // Stage A (SW render) cap a 720p per garantire 60fps fluidi.
        frameW = Math.min(Math.max(64, Math.round(w * dpr)), 1280);
        frameH = Math.min(Math.max(64, Math.round(h * dpr)), 720);
      }
      frameW = Math.min(frameW, 7680);
      frameH = Math.min(frameH, 4320);

      // Sincronizzazione dimensioni buffer canvas.
      if (canvas.width !== frameW) canvas.width = frameW;
      if (canvas.height !== frameH) canvas.height = frameH;
      gl.viewport(0, 0, frameW, frameH);

      const tStart = performance.now();
      try {
        const res = await fetch(`${FRAME_ENDPOINT}?w=${frameW}&h=${frameH}`, {
          signal: abortController.signal,
          cache: 'no-store',
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt.trim()}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length !== frameW * frameH * 4) {
          throw new Error(`frame size mismatch: got ${buf.length} bytes, expected ${frameW * frameH * 4}`);
        }

        // Upload texture a GPU. Backend manda "rgba".
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frameW, frameH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        localFrameCount += 1;
        localLastFrameMs = performance.now() - tStart;
        localError = null;
        if (!hasRenderedFrame) setHasRenderedFrame(true);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        localError = err instanceof Error ? err : new Error(String(err));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const elapsed = performance.now() - lastFrameStart;
      const wait = Math.max(0, minFrameInterval - elapsed);
      lastFrameStart = performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));

      if (!state.cancelled) requestAnimationFrame(() => void renderLoop());
    };

    // Avvio loop di rendering con un piccolo ritardo per permettere al DOM
    // di stabilizzarsi, specialmente in modalità fullscreen dove i calcoli
    // delle dimensioni iniziali potrebbero fallire (restituendo 0).
    const startDelay = window.setTimeout(() => {
      void renderLoop();
    }, 100);

    return () => {
      state.cancelled = true;
      state.running = false;
      window.clearTimeout(startDelay);
      abortController.abort();
      window.clearInterval(flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canvasRef, width, height, targetFPS]);

  return { frameCount, error, lastFrameMs, hasRenderedFrame };
}

