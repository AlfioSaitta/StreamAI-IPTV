/**
 * SPIKE-1 PoC TS — riceve frame RGBA8 dall'harness Go
 * (`spike-mpv-render -ws-addr :7799`) via HTTP polling su `/snapshot`,
 * li carica come texture 2D GL_RGBA8 e li disegna su un fullscreen quad.
 *
 * Misura lato browser:
 *   - GPU draw time via EXT_disjoint_timer_query_webgl2
 *   - CPU upload time (Date.now diff su gl.texSubImage2D)
 *   - FPS effettivo lato client
 *
 * NB: questo file è volutamente *fuori* dal bundle Vite principale.
 * Per servirlo: `npx vite serve frontend/spike/mpv-webgl2/`
 *               oppure semplicemente `python3 -m http.server` dalla dir.
 * Il TS è transpilato on-the-fly dal browser via `<script type="module">`
 * (richiede TS via tsc separato, oppure rinomina `main.ts` → `main.js`).
 */

interface FrameHeader {
  width: number;
  height: number;
  seq: number;
}

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const srcInput = document.getElementById('src') as HTMLInputElement;
const fpsInput = document.getElementById('fps') as HTMLInputElement;
const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;

const gl = canvas.getContext('webgl2', {
  alpha: false,
  antialias: false,
  preserveDrawingBuffer: false,
  desynchronized: true,
}) as WebGL2RenderingContext | null;

if (!gl) {
  statsEl.textContent = 'WebGL2 not supported in this browser.';
  statsEl.classList.add('badge-fail');
  throw new Error('webgl2 missing');
}

// ---- shader setup -------------------------------------------------------

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// Per SPIKE-1 il frame è già RGB convertito da libmpv: passthrough.
// Quando passeremo a NV12/P010 sostituiremo questo shader con la matrix
// BT.709/2020 → sRGB (vedi commento più in basso).
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
out vec4 outColor;
void main() {
  outColor = texture(u_frame, v_uv);
}`;

function compile(type: number, src: string): WebGLShader {
  const sh = gl!.createShader(type)!;
  gl!.shaderSource(sh, src);
  gl!.compileShader(sh);
  if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl!.getShaderInfoLog(sh));
  }
  return sh;
}

const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
  throw new Error('link: ' + gl.getProgramInfoLog(prog));
}

// Fullscreen quad.
const vao = gl.createVertexArray()!;
gl.bindVertexArray(vao);
const vbo = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  // pos      uv
  -1, -1,    0, 0,
   1, -1,    1, 0,
  -1,  1,    0, 1,
   1,  1,    1, 1,
]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'a_pos');
const aUv = gl.getAttribLocation(prog, 'a_uv');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
gl.enableVertexAttribArray(aUv);
gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

// Texture frame.
const tex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

const uFrame = gl.getUniformLocation(prog, 'u_frame');

// Timer query (EXT_disjoint_timer_query_webgl2). Opzionale.
const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

// ---- main loop ----------------------------------------------------------

let running = false;
let texW = 0, texH = 0;
let lastSeq = -1;
const stats = {
  frames: 0,
  uploadsMs: [] as number[],
  drawsMs: [] as number[],
  fpsWindowStart: performance.now(),
  fpsWindowFrames: 0,
  fps: 0,
};

async function fetchFrame(url: string): Promise<{ header: FrameHeader; bytes: Uint8Array } | null> {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const header: FrameHeader = {
    width: parseInt(r.headers.get('X-Frame-Width') ?? '0', 10),
    height: parseInt(r.headers.get('X-Frame-Height') ?? '0', 10),
    seq: parseInt(r.headers.get('X-Frame-Seq') ?? '-1', 10),
  };
  const buf = await r.arrayBuffer();
  return { header, bytes: new Uint8Array(buf) };
}

function uploadFrame(w: number, h: number, bytes: Uint8Array): number {
  const t0 = performance.now();
  gl!.bindTexture(gl!.TEXTURE_2D, tex);
  if (w !== texW || h !== texH) {
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, w, h, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, bytes);
    texW = w; texH = h;
    canvas.width = w; canvas.height = h;
  } else {
    gl!.texSubImage2D(gl!.TEXTURE_2D, 0, 0, 0, w, h, gl!.RGBA, gl!.UNSIGNED_BYTE, bytes);
  }
  return performance.now() - t0;
}

function draw(): number {
  const t0 = performance.now();
  gl!.viewport(0, 0, canvas.width, canvas.height);
  gl!.clearColor(0, 0, 0, 1);
  gl!.clear(gl!.COLOR_BUFFER_BIT);
  gl!.useProgram(prog);
  gl!.activeTexture(gl!.TEXTURE0);
  gl!.bindTexture(gl!.TEXTURE_2D, tex);
  gl!.uniform1i(uFrame, 0);
  gl!.bindVertexArray(vao);
  gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  // forza il flush per misurare il tempo CPU-dispatch
  gl!.finish();
  return performance.now() - t0;
}

function updateStats(uploadMs: number, drawMs: number) {
  stats.frames++;
  stats.fpsWindowFrames++;
  stats.uploadsMs.push(uploadMs);
  stats.drawsMs.push(drawMs);
  if (stats.uploadsMs.length > 600) stats.uploadsMs.shift();
  if (stats.drawsMs.length > 600) stats.drawsMs.shift();

  const now = performance.now();
  const dt = now - stats.fpsWindowStart;
  if (dt >= 1000) {
    stats.fps = (stats.fpsWindowFrames * 1000) / dt;
    stats.fpsWindowStart = now;
    stats.fpsWindowFrames = 0;
  }

  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const p95 = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.95)];
  };
  statsEl.textContent = `${texW}×${texH} | FPS ${stats.fps.toFixed(1)} | upload avg ${avg(stats.uploadsMs).toFixed(2)}ms p95 ${p95(stats.uploadsMs).toFixed(2)}ms | draw avg ${avg(stats.drawsMs).toFixed(2)}ms | frames ${stats.frames}`;
}

async function loop() {
  const src = srcInput.value.trim();
  const targetFps = Math.max(1, parseInt(fpsInput.value, 10) || 30);
  const minDt = 1000 / targetFps;

  while (running) {
    const t0 = performance.now();
    try {
      const frame = await fetchFrame(src);
      if (frame && frame.header.seq !== lastSeq && frame.bytes.length === frame.header.width * frame.header.height * 4) {
        lastSeq = frame.header.seq;
        const upMs = uploadFrame(frame.header.width, frame.header.height, frame.bytes);
        const drMs = draw();
        updateStats(upMs, drMs);
      }
    } catch (e) {
      statsEl.textContent = 'fetch err: ' + (e as Error).message;
      statsEl.className = 'badge-fail';
    }
    const dt = performance.now() - t0;
    if (dt < minDt) await new Promise(r => setTimeout(r, minDt - dt));
  }
}

toggleBtn.addEventListener('click', () => {
  running = !running;
  toggleBtn.textContent = running ? 'Stop' : 'Start';
  statsEl.classList.remove('badge-fail');
  if (running) loop();
});

// Convenience: log capabilities to console for the spike report.
console.info('GL_VENDOR  =', gl.getParameter(gl.VENDOR));
console.info('GL_RENDERER=', gl.getParameter(gl.RENDERER));
console.info('GL_VERSION =', gl.getParameter(gl.VERSION));
console.info('Timer ext  =', timerExt ? 'EXT_disjoint_timer_query_webgl2' : 'none (KPI lato browser non disponibile)');

// ----------------------------------------------------------------------
// TODO (post-SPIKE-1):
//
// 1. Sostituire la fetch HTTP `/snapshot` con un vero WebSocket binary
//    feed quando l'harness Go avrà l'handshake RFC 6455. Latenza
//    attesa: <2 ms per frame (vs ~5–15 ms con polling fetch).
//
// 2. Aggiungere shader BT.709 → sRGB con due texture (Y plane GL_R8 +
//    UV plane GL_RG8) quando avremo l'estrazione NV12 da libmpv via
//    DRM-PRIME (SPIKE-5). Shader di riferimento:
//
//      vec3 yuv = vec3(
//        texture(u_y,  v_uv).r,
//        texture(u_uv, v_uv).rg - vec2(0.5)
//      );
//      const mat3 bt709 = mat3(
//        1.0,  1.0,    1.0,
//        0.0, -0.18732, 1.8556,
//        1.5748, -0.46812, 0.0
//      );
//      outColor = vec4(bt709 * yuv, 1.0);
//
//    Per BT.2020 (HDR PQ) la matrix è diversa e va combinata con
//    OETF inversa + Hable / Reinhard tone-mapping su display SDR.
//
// 3. Integrare EXT_disjoint_timer_query_webgl2 per misurare il tempo
//    GPU draw (non solo CPU dispatch); aggiungere queryObject pool.
// ----------------------------------------------------------------------

