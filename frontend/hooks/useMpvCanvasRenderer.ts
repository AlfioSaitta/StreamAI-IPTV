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
 *   <canvas> WebGL2: texSubImage2D → texture RGBA → drawArrays
 *
 * Stage A path = "RGBA readback / WebGL2 canvas" — semplice, funziona ovunque
 * il backend libmpv sia disponibile. Costo lato backend: ~4 ms/frame a 720p e
 * ~4.5 ms a 1080p da sorgente 1080p (misurato, vedi TestRenderCostPerFrame in
 * internal/services/player/render_cost_test.go); a questo si aggiungono il
 * trasferimento del frame e l'upload della texture.
 *
 * Il loop è "su richiesta": il middleware risponde `X-Frame-New: 0` quando mpv
 * non ha prodotto un frame nuovo (contenuto 24/25p contro un loop a 30 fps) e
 * in quel caso si salta sia il fetch del body sia `texSubImage2D`.
 *
 * NB sul pixel format:
 *   libmpv "rgba" = 4 byte/pixel, ordine R, G, B, A.
 *   La texture WebGL2 li consuma direttamente: nessuna conversione in JS.
 *
 * Backpressure:
 *   Lanciamo UN solo fetch alla volta. Se la render-loop del backend è
 *   più lenta del nostro RAF, il prossimo fetch parte solo dopo che il
 *   precedente si è risolto + è stato disegnato. Questo evita di accodare
 *   richieste HTTP che il middleware servirebbe tutte serializzate sotto lo
 *   stesso `renderMu`.
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
  /**
   * True quando la riproduzione è in pausa/ferma.
   *
   * NON è un gate "on/off" dell'engine: in pausa mpv continua a restituire lo
   * stesso frame, quindi il loop viene solo rallentato a
   * `PAUSED_FRAME_INTERVAL_MS` (~2 fps) invece di essere fermato. Fermarlo del
   * tutto lascerebbe il canvas sull'ultimo frame anche durante un seek da
   * fermo, che l'utente si aspetta di vedere aggiornato.
   */
  paused?: boolean;
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
  /**
   * Richieste risolte SENZA un frame nuovo (mpv non aveva nulla da dare):
   * erano trasferimenti e upload di byte identici ai precedenti.
   */
  skippedCount: number;
}

const FRAME_ENDPOINT = '/player/frame';

/**
 * Intervallo tra frame quando la riproduzione è in pausa. Il frame non cambia,
 * quindi l'unico scopo di questi render residui è aggiornare l'anteprima dopo
 * un seek da fermo.
 */
const PAUSED_FRAME_INTERVAL_MS = 500;

/** Backoff progressivo dopo errori consecutivi (evita di martellare a vuoto). */
const ERROR_BACKOFF_BASE_MS = 250;
const ERROR_BACKOFF_MAX_MS = 5_000;

/**
 * Cadenza minima a cui il loop adattivo può scendere.
 *
 * Sotto questo valore il video diventa visibilmente a scatti: meglio 15 fps
 * stabili che 8 fps irregolari. Se nemmeno 15 fps sono sostenibili, il collo di
 * bottiglia è altrove (decodifica, rete) e insistere non aiuta.
 */
const MIN_ADAPTIVE_FPS = 15;

/**
 * Budget di pixel per frame richiesto al backend (≈ 1280×720).
 *
 * Il costo del render software (conversione colori + readback + upload texture)
 * è proporzionale ai pixel, quindi questo è il vero parametro di costo — non i
 * due lati presi separatamente. Un budget di area permette di mantenere
 * l'aspect ratio reale dello schermo invece di deformare l'immagine.
 */
const MAX_FRAME_PIXELS = 1280 * 720;

export function useMpvCanvasRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  opts: UseMpvCanvasRendererOptions = {},
): UseMpvCanvasRendererResult {
  const { width, height, targetFPS = 60, paused = false } = opts;
  const [frameCount, setFrameCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const [lastFrameMs, setLastFrameMs] = useState(0);
  const [hasRenderedFrame, setHasRenderedFrame] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);

  // Stato non-reattivo: tenere il contatore fuori da React state per
  // evitare re-render a ogni frame (cost ammortizzato: gli state setter
  // sopra batched a fine ciclo via `setFrameCountBatched`).
  const runStateRef = useRef({ cancelled: false, running: false });

  // `paused` è letto dal loop tramite ref, non dalle dipendenze dell'effect:
  // rimetterlo nelle deps ricreerebbe l'intero contesto WebGL (programma,
  // shader, texture, VBO) a ogni play/pausa, cioè esattamente il costo che
  // vogliamo evitare.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // `hasRenderedFrame` non è nelle dipendenze dell'effect del loop, quindi
  // leggerlo dallo stato dentro il loop leggeva sempre il valore iniziale
  // (`false`) e faceva scattare un `setState` a ogni frame.
  const hasRenderedRef = useRef(false);

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
    let lastFrameStart = 0;
    // Dimensioni attualmente allocate nella texture: se non cambiano usiamo
    // `texSubImage2D` invece di riallocare a ogni frame.
    let textureW = 0;
    let textureH = 0;
    // Ultima sequenza di frame disegnata: inviata al backend per non ricevere
    // due volte gli stessi byte (vedi `X-Frame-New` in service.go).
    let lastSeq = '';
    // Quante richieste sono state risolte senza un frame nuovo.
    let localSkippedCount = 0;
    let localFrameCount = 0;
    let localError: Error | null = null;
    let localLastFrameMs = 0;
    // Ultimo errore già propagato a React: ciascun fallimento crea un oggetto
    // `Error` nuovo, quindi confrontare le istanze farebbe scattare un
    // re-render a ogni retry. Confrontiamo il messaggio e azzeriamo lo stato
    // quando i frame riprendono (prima l'errore restava valorizzato per sempre
    // anche dopo il recovery).
    let reportedErrorMsg: string | null = null;

    // Flush periodico dello state React per evitare 60 re-render/sec.
    const flush = window.setInterval(() => {
      if (state.cancelled) return;
      setFrameCount((prev) => (prev !== localFrameCount ? localFrameCount : prev));
      setLastFrameMs((prev) => (prev !== localLastFrameMs ? localLastFrameMs : prev));
      setSkippedCount((prev) => (prev !== localSkippedCount ? localSkippedCount : prev));
      const msg = localError?.message ?? null;
      if (msg !== reportedErrorMsg) {
        reportedErrorMsg = msg;
        setError(localError);
      }
    }, 500);

    let lastW = 0;
    let lastH = 0;
    // Backoff progressivo sugli errori: senza di esso un backend che risponde
    // sempre 503 (es. binario compilato senza `-tags mpv`) veniva interrogato
    // a vuoto per tutta la sessione. Si azzera al primo frame riuscito.
    let errorBackoffMs = ERROR_BACKOFF_BASE_MS;

    // Cadenza ADATTIVA.
    //
    // `targetFPS` è un tetto, non un obiettivo: ogni frame costa una
    // conversione colori in CPU lato mpv, una readback in RAM, una richiesta
    // HTTP e un upload di texture. Su hardware datato il costo per frame supera
    // il budget e insistere sul tetto produce solo ritardo accumulato e CPU
    // calda. Qui la cadenza scende verso `MIN_ADAPTIVE_FPS` quando il frame
    // costa troppo e risale verso il tetto quando c'è margine, con isteresi per
    // evitare oscillazioni.
    let effectiveFps = Math.max(MIN_ADAPTIVE_FPS, targetFPS);

    const renderLoop = async () => {
      if (state.cancelled) return;

      // In pausa mpv restituisce lo STESSO frame: renderizzarlo alla cadenza
      // piena significava rifare la colorspace conversion in CPU, trasferire e
      // ricaricare in GPU un frame identico, per sempre. Rallentiamo a
      // ~2 fps, sufficienti a mantenere viva l'anteprima durante un seek.
      // La cadenza effettiva segue `effectiveFps` (adattiva), non il tetto.
      const adaptiveInterval = 1000 / Math.max(1, effectiveFps);
      const frameInterval = pausedRef.current
        ? Math.max(adaptiveInterval, PAUSED_FRAME_INTERVAL_MS)
        : adaptiveInterval;

      // Recupero dimensioni correnti del canvas nel DOM.
      let w = canvas.clientWidth;
      let h = canvas.clientHeight;
      
      // Fallback: se clientWidth è 0 (es. appena montato o nascosto), proviamo getBoundingClientRect
      if (w === 0 || h === 0) {
        const rect = canvas.getBoundingClientRect();
        w = rect.width;
        h = rect.height;
      }

      // Estremo fallback: se siamo ancora a 0 (layout non pronto), usiamo la
      // dimensione della finestra (verrà comunque ridimensionata dal budget di
      // pixel qui sotto).
      if (w === 0 || h === 0) {
        w = window.innerWidth;
        h = window.innerHeight;
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
        // Il costo del path software scala con i PIXEL del buffer, non con le
        // sue dimensioni lineari. Applichiamo quindi un budget di pixel
        // mantenendo l'ASPECT RATIO del canvas: i due tetti separati (1280 e
        // 720) deformavano tutto ciò che non è 16:9 — mpv letterboxava dentro
        // un buffer 16:9 e il CSS stirava il risultato a schermo intero.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scaledW = Math.max(1, w * dpr);
        const scaledH = Math.max(1, h * dpr);
        const budgetScale = Math.min(1, Math.sqrt(MAX_FRAME_PIXELS / (scaledW * scaledH)));
        frameW = Math.round(scaledW * budgetScale);
        frameH = Math.round(scaledH * budgetScale);
      }
      // Limiti difensivi (e multipli pari, richiesti da alcuni driver/decoder).
      frameW = Math.min(Math.max(64, frameW - (frameW % 2)), 7680);
      frameH = Math.min(Math.max(64, frameH - (frameH % 2)), 4320);

      // Sincronizzazione dimensioni buffer canvas.
      if (canvas.width !== frameW) canvas.width = frameW;
      if (canvas.height !== frameH) canvas.height = frameH;
      gl.viewport(0, 0, frameW, frameH);

      const tStart = performance.now();
      try {
        // Dichiariamo al backend quale sequenza abbiamo già disegnato: se mpv
        // non ha prodotto un frame nuovo, la risposta arriva senza body
        // (`X-Frame-New: 0`) e saltiamo sia il trasferimento dei ~3.7 MB sia
        // l'upload della texture. Erano il caso più frequente, perché il loop
        // chiede frame a cadenza fissa mentre il contenuto è 24/25/30p.
        const res = await fetch(`${FRAME_ENDPOINT}?w=${frameW}&h=${frameH}`, {
          signal: abortController.signal,
          cache: 'no-store',
          headers: lastSeq !== '' ? { 'X-Frame-Seq': lastSeq } : undefined,
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt.trim()}`);
        }

        const seqHeader = res.headers.get('X-Frame-Seq') ?? '';
        if (res.headers.get('X-Frame-New') === '0') {
          // Frame identico al precedente: niente body, niente upload.
          // `localLastFrameMs` NON viene toccato: la cadenza adattiva deve
          // continuare a basarsi sul costo dei frame reali, non su queste
          // risposte vuote.
          localSkippedCount += 1;
          localError = null;
          if (seqHeader) lastSeq = seqHeader;
        } else {
          lastSeq = seqHeader || lastSeq;

          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.length !== frameW * frameH * 4) {
            throw new Error(`frame size mismatch: got ${buf.length} bytes, expected ${frameW * frameH * 4}`);
          }

          // Upload texture a GPU. Backend manda "rgba".
          gl.bindTexture(gl.TEXTURE_2D, texture);
          // `texImage2D` RIALLOCA lo storage della texture a ogni chiamata;
          // `texSubImage2D` scrive in quello esistente. Con dimensioni stabili
          // (il caso normale) la riallocazione è lavoro inutile a ogni frame —
          // fino a ~3.7 MB per frame da riallocare e ricaricare. Riallochiamo solo
          // quando la dimensione del frame cambia davvero.
          if (textureW !== frameW || textureH !== frameH) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, frameW, frameH, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            textureW = frameW;
            textureH = frameH;
          } else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, frameW, frameH, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          }
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          localFrameCount += 1;
          localLastFrameMs = performance.now() - tStart;
          localError = null;
          errorBackoffMs = ERROR_BACKOFF_BASE_MS;
          if (!hasRenderedRef.current) {
            hasRenderedRef.current = true;
            setHasRenderedFrame(true);
          }
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        localError = err instanceof Error ? err : new Error(String(err));
        const backoff = errorBackoffMs;
        errorBackoffMs = Math.min(errorBackoffMs * 2, ERROR_BACKOFF_MAX_MS);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }

      // Adatta la cadenza al costo reale del frame (isteresi: scendo sopra il
      // 125% del budget, risalgo sotto il 50%) per non oscillare a ogni frame.
      if (localError === null && localLastFrameMs > 0) {
        const budget = 1000 / Math.max(1, effectiveFps);
        if (localLastFrameMs > budget * 1.25 && effectiveFps > MIN_ADAPTIVE_FPS) {
          effectiveFps = Math.max(MIN_ADAPTIVE_FPS, Math.round(effectiveFps * 0.8));
        } else if (localLastFrameMs < budget * 0.5 && effectiveFps < targetFPS) {
          effectiveFps = Math.min(targetFPS, Math.round(effectiveFps * 1.25));
        }
      }

      const elapsed = performance.now() - lastFrameStart;
      const wait = Math.max(0, frameInterval - elapsed);
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

      // Rilascio delle risorse WebGL: senza questi `delete*` ogni re-run
      // dell'effect (cambio engine, resize, targetFPS) lasciava orfani lato
      // GPU un programma, i due shader, una texture e un VBO. `getAttachedShaders`
      // evita di dover tenere i riferimenti agli shader creati inline.
      for (const shader of gl.getAttachedShaders(program) ?? []) {
        gl.deleteShader(shader);
      }
      gl.deleteProgram(program);
      gl.deleteTexture(texture);
      gl.deleteBuffer(vbo);

      // ⚠️ NON chiamare `WEBGL_lose_context.loseContext()` qui.
      //
      // Questo cleanup gira OGNI volta che l'effect si ri-esegue, non solo allo
      // smontaggio: `enabled` e `targetFPS` sono fra le dipendenze. Per la
      // specifica WebGL un canvas conserva il proprio contesto, e dopo
      // `loseContext()` quel contesto resta morto (le chiamate GL vengono
      // ignorate in silenzio) finché non si completa `restoreContext()`.
      //
      // Effetto osservato (2026-09-19): aprendo il PiP, `enabled` diventava
      // false → cleanup → contesto perso; chiudendo il PiP l'effect ripartiva
      // ma `getContext('webgl2')` restituiva il contesto morto, quindi il video
      // NON riprendeva nella finestra principale. Il PiP funzionava lo stesso
      // perché è un documento separato, con canvas e contesto propri.
      //
      // Se serve liberare risorse GPU, farlo solo quando il canvas è
      // definitivamente abbandonato — non su un toggle di stato.
      // Guard: frontend/tests/hooks/useMpvCanvasRenderer.test.tsx
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canvasRef, width, height, targetFPS]);

  return { frameCount, error, lastFrameMs, hasRenderedFrame, skippedCount };
}

