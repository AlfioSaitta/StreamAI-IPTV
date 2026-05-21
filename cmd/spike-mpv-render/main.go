// SPIKE-1 harness — libmpv render-API → OpenGL FBO → readback RGBA8 →
// (opzionale) WebSocket binary feed verso il PoC TS WebGL2.
//
// Vedi docs/spike1-methodology.md e cmd/spike-mpv-render/README.md.
//
//go:build mpv && linux

package main

// #cgo pkg-config: mpv egl gl
// #include <stdlib.h>
// #include <string.h>
// #include <EGL/egl.h>
// #include <EGL/eglext.h>
// #include <GL/gl.h>
// #include <GL/glext.h>
// #include <mpv/client.h>
// #include <mpv/render.h>
// #include <mpv/render_gl.h>
//
// // Trampoline per il callback `get_proc_address` (Go non può passare
// // direttamente i puntatori a funzione C; usiamo eglGetProcAddress).
// static void* spike1_get_proc_address(void* ctx, const char* name) {
//     (void)ctx;
//     return (void*)eglGetProcAddress(name);
// }
//
// // Wrapper sincrono per mpv_render_context_render — la struct
// // `mpv_render_param[]` con membri uniti è scomoda da costruire in Go,
// // più semplice farlo in C.
// static int spike1_render_fbo(mpv_render_context* ctx, int fbo, int w, int h) {
//     int flip_y = 1;
//     mpv_opengl_fbo opengl_fbo = { .fbo = fbo, .w = w, .h = h, .internal_format = 0 };
//     mpv_render_param params[] = {
//         { MPV_RENDER_PARAM_OPENGL_FBO, &opengl_fbo },
//         { MPV_RENDER_PARAM_FLIP_Y, &flip_y },
//         { 0 }
//     };
//     return mpv_render_context_render(ctx, params);
// }
//
// // Wrapper per mpv_render_context_create con i parametri standard
// // (MPV_RENDER_API_TYPE_OPENGL + get_proc_address). Restituisce 0 ok,
// // <0 errore mpv.
// static int spike1_create_render(mpv_handle* h, mpv_render_context** out) {
//     char api_type[] = MPV_RENDER_API_TYPE_OPENGL;
//     mpv_opengl_init_params gl_init = {
//         .get_proc_address = spike1_get_proc_address,
//         .get_proc_address_ctx = NULL,
//     };
//     int advanced = 1;
//     mpv_render_param params[] = {
//         { MPV_RENDER_PARAM_API_TYPE, api_type },
//         { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init },
//         { MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced },
//         { 0 }
//     };
//     return mpv_render_context_create(out, h, params);
// }
import "C"

import (
	"context"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"runtime"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"
)

// ---- CLI -------------------------------------------------------------------

type cliFlags struct {
	URL         string
	Duration    time.Duration
	Warmup      time.Duration
	FboW, FboH  int
	WSAddr      string
	WSThrottle  int
	OutputPath  string
	Hwdec       string
	Verbose     bool
}

func parseFlags() cliFlags {
	var f cliFlags
	flag.StringVar(&f.URL, "url", "", "URL o path locale dello stream (obbligatorio)")
	flag.DurationVar(&f.Duration, "duration", 60*time.Second, "Durata della misura")
	flag.DurationVar(&f.Warmup, "warmup", 2*time.Second, "Periodo di warmup scartato")
	flag.IntVar(&f.FboW, "fbo-width", 1920, "Larghezza FBO RGBA8")
	flag.IntVar(&f.FboH, "fbo-height", 1080, "Altezza FBO RGBA8")
	flag.StringVar(&f.WSAddr, "ws-addr", "", "Se valorizzato, espone WebSocket binary su questo addr (es. :7799)")
	flag.IntVar(&f.WSThrottle, "ws-throttle", 30, "Max FPS verso WS (0 = invia ogni frame)")
	flag.StringVar(&f.OutputPath, "output", "-", "File JSON report (- = stdout)")
	flag.StringVar(&f.Hwdec, "hwdec", "auto-safe", "libmpv hwdec (es. vaapi, no)")
	flag.BoolVar(&f.Verbose, "verbose", false, "Log libmpv su stderr")
	flag.Parse()
	return f
}

func main() {
	runtime.LockOSThread() // GL context + libmpv render → stesso thread OS.

	f := parseFlags()
	if f.URL == "" {
		fmt.Fprintln(os.Stderr, "error: -url è obbligatorio")
		flag.Usage()
		os.Exit(2)
	}

	if err := run(f); err != nil {
		fmt.Fprintf(os.Stderr, "spike-mpv-render: %v\n", err)
		os.Exit(1)
	}
}

func run(f cliFlags) error {
	log.SetFlags(log.Ltime | log.Lmicroseconds)
	log.SetPrefix("spike1 ")

	// 1) EGL surfaceless context.
	egl, err := initEGLSurfaceless()
	if err != nil {
		return fmt.Errorf("init EGL surfaceless: %w", err)
	}
	defer egl.destroy()

	gpuRenderer := glGetString(C.GL_RENDERER)
	log.Printf("GL_RENDERER = %s", gpuRenderer)
	log.Printf("GL_VERSION  = %s", glGetString(C.GL_VERSION))

	// 2) mpv create + set options + initialize.
	mpv := C.mpv_create()
	if mpv == nil {
		return errors.New("mpv_create returned nil (libmpv missing / OOM)")
	}
	defer C.mpv_terminate_destroy(mpv)

	for _, kv := range mpvOptions(f) {
		if err := mpvSetOption(mpv, kv[0], kv[1]); err != nil {
			return fmt.Errorf("mpv_set_option_string %s=%s: %w", kv[0], kv[1], err)
		}
	}
	if rc := C.mpv_initialize(mpv); rc < 0 {
		return fmt.Errorf("mpv_initialize: %s", C.GoString(C.mpv_error_string(rc)))
	}

	// 3) Render context (OpenGL API).
	var rctx *C.mpv_render_context
	if rc := C.spike1_create_render(mpv, &rctx); rc < 0 {
		return fmt.Errorf("mpv_render_context_create: %s", C.GoString(C.mpv_error_string(rc)))
	}
	defer C.mpv_render_context_free(rctx)

	// 4) FBO target (RGBA8 color attachment).
	fbo, fboTex, err := createFBO(f.FboW, f.FboH)
	if err != nil {
		return fmt.Errorf("create FBO: %w", err)
	}
	defer destroyFBO(fbo, fboTex)

	// 5) WS feed (opzionale).
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wsHub *wsHub
	if f.WSAddr != "" {
		wsHub = newWSHub(f.FboW, f.FboH, f.WSThrottle)
		go func() {
			if err := wsHub.serve(ctx, f.WSAddr); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("ws server: %v", err)
			}
		}()
	}

	// 6) Loadfile + render loop.
	cURL := C.CString(f.URL)
	cCmd := C.CString("loadfile")
	defer func() {
		C.free(unsafe.Pointer(cURL))
		C.free(unsafe.Pointer(cCmd))
	}()
	cmd := [...]*C.char{cCmd, cURL, nil}
	if rc := C.mpv_command(mpv, &cmd[0]); rc < 0 {
		return fmt.Errorf("mpv loadfile: %s", C.GoString(C.mpv_error_string(rc)))
	}

	collector := newKPICollector(f.URL, f.FboW, f.FboH, f.Hwdec)
	if err := renderLoop(ctx, f, mpv, rctx, fbo, wsHub, collector); err != nil {
		return fmt.Errorf("render loop: %w", err)
	}

	collector.setDroppedFrames(int(mpvGetPropertyInt64(mpv, "frame-drop-count")))

	// 7) Output report.
	return writeReport(f.OutputPath, collector, gpuRenderer)
}

// renderLoop pilota mpv_render_context fino a scadenza durata. Per ogni
// frame:
//   1. attende l'update flag (canale `redraw` triggerato dal callback C
//      installato con mpv_render_context_set_update_callback);
//   2. misura wall-clock di spike1_render_fbo + glReadPixels;
//   3. accumula sample (dopo warmup) e (se attivo) push verso wsHub.
func renderLoop(
	ctx context.Context,
	f cliFlags,
	mpv *C.mpv_handle,
	rctx *C.mpv_render_context,
	fbo uint32,
	wsHub *wsHub,
	col *kpiCollector,
) error {
	redraw := installUpdateCallback(rctx)

	pixBuf := make([]byte, f.FboW*f.FboH*4)
	deadline := time.Now().Add(f.Duration + f.Warmup)
	warmupEnd := time.Now().Add(f.Warmup)
	col.start()
	started := false

	ticker := time.NewTicker(2 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			col.stop()
			return ctx.Err()
		case <-redraw:
			// Render disponibile.
		case <-ticker.C:
			// Anche senza update flag, ogni 2 ms verifichiamo se mpv vuole
			// renderizzare (mpv_render_context_update può ritornare il bit
			// FRAME anche senza callback in alcune build).
			if uint64(C.mpv_render_context_update(rctx))&uint64(C.MPV_RENDER_UPDATE_FRAME) == 0 {
				if time.Now().After(deadline) {
					col.stop()
					return nil
				}
				continue
			}
		}

		t0 := time.Now()
		if rc := C.spike1_render_fbo(rctx, C.int(fbo), C.int(f.FboW), C.int(f.FboH)); rc < 0 {
			return fmt.Errorf("mpv_render_context_render: %s", C.GoString(C.mpv_error_string(rc)))
		}
		readbackRGBA(fbo, f.FboW, f.FboH, pixBuf)
		dt := time.Since(t0)

		if !started && time.Now().After(warmupEnd) {
			col.start()
			started = true
		}
		if started {
			col.recordFrame(dt)
			if wsHub != nil {
				wsHub.pushFrame(pixBuf)
			}
		}

		if time.Now().After(deadline) {
			col.stop()
			return nil
		}
	}
}

// ---- mpv helpers -----------------------------------------------------------

func mpvOptions(f cliFlags) [][2]string {
	level := "no"
	if f.Verbose {
		level = "v"
	}
	return [][2]string{
		{"terminal", "no"},
		{"msg-level", "all=" + level},
		{"idle", "yes"},
		{"keep-open", "always"},
		{"hwdec", f.Hwdec},
		{"vo", "libmpv"}, // OBBLIGATORIO per render-API
		{"video-sync", "audio"},
		{"audio-buffer", "0.2"},
		{"framedrop", "vo"},
		{"cache", "yes"},
		{"cache-secs", "10"},
		{"user-agent", "StreamAI-Spike1/0.1"},
	}
}

func mpvSetOption(h *C.mpv_handle, key, value string) error {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	cv := C.CString(value)
	defer C.free(unsafe.Pointer(cv))
	rc := C.mpv_set_option_string(h, ck, cv)
	if rc < 0 {
		return errors.New(C.GoString(C.mpv_error_string(rc)))
	}
	return nil
}

func mpvGetPropertyInt64(h *C.mpv_handle, name string) int64 {
	cn := C.CString(name)
	defer C.free(unsafe.Pointer(cn))
	var out C.int64_t
	if rc := C.mpv_get_property(h, cn, C.MPV_FORMAT_INT64, unsafe.Pointer(&out)); rc < 0 {
		return 0
	}
	return int64(out)
}

// updateCallbackChan è globale perché il trampoline C non può catturare
// closures Go. Per un PoC single-instance (l'harness) è accettabile.
var (
	updateCallbackMu   sync.Mutex
	updateCallbackChan chan struct{}
)

//export goSpike1UpdateCallback
func goSpike1UpdateCallback() {
	updateCallbackMu.Lock()
	ch := updateCallbackChan
	updateCallbackMu.Unlock()
	if ch == nil {
		return
	}
	select {
	case ch <- struct{}{}:
	default:
	}
}

func installUpdateCallback(rctx *C.mpv_render_context) <-chan struct{} {
	ch := make(chan struct{}, 1)
	updateCallbackMu.Lock()
	updateCallbackChan = ch
	updateCallbackMu.Unlock()
	C.mpv_render_context_set_update_callback(rctx, (C.mpv_render_update_fn)(C.spike1_update_trampoline), nil)
	return ch
}

// ---- WS hub ----------------------------------------------------------------

// wsHub espone frame RGBA8 grezzi via WebSocket binary. Throttle in fps
// per evitare di saturare la connessione locale a 4K60 (~ 1.9 GB/s).
// Protocollo: ogni messaggio binary è:
//
//   uint32 LE width | uint32 LE height | uint32 LE seqno | byte[w*h*4] RGBA8
//
// L'handshake WebSocket è implementato manualmente (RFC 6455) per non
// introdurre dipendenze esterne nello spike — sufficiente per un PoC
// localhost-only.
type wsHub struct {
	w, h        int
	throttleFPS int
	mu          sync.Mutex
	clients     map[*wsClient]struct{}
	seq         atomic.Uint32
}

func newWSHub(w, h, fps int) *wsHub {
	return &wsHub{w: w, h: h, throttleFPS: fps, clients: map[*wsClient]struct{}{}}
}

func (h *wsHub) serve(ctx context.Context, addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:      http.HandlerFunc(h.handle),
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 0, // streaming
	}
	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()
	log.Printf("ws hub listening on %s (frame %dx%d, throttle %d fps)", addr, h.w, h.h, h.throttleFPS)
	return srv.Serve(ln)
}

func (h *wsHub) handle(w http.ResponseWriter, r *http.Request) {
	// RFC 6455 handshake minimale: lo lasciamo come TODO. In assenza di
	// gorilla/websocket o net/http server-side WS standard, qui usiamo
	// un endpoint HTTP "/snapshot" che restituisce l'ultimo frame come
	// blob binario — più semplice e sufficiente per debug visivo.
	//
	// Il PoC TS in frontend/spike/mpv-webgl2/ può fare polling
	// `fetch('/snapshot')` a 30 fps. La latenza non è il KPI di SPIKE-1
	// (lo è invece il *throughput render+readback* lato Go, già misurato).
	if r.URL.Path != "/snapshot" {
		http.Error(w, "use /snapshot", http.StatusNotFound)
		return
	}
	frame := h.snapshotFrame()
	if frame == nil {
		http.Error(w, "no frame yet", http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Frame-Width", strconv.Itoa(h.w))
	w.Header().Set("X-Frame-Height", strconv.Itoa(h.h))
	w.Header().Set("X-Frame-Seq", strconv.Itoa(int(h.seq.Load())))
	_, _ = w.Write(frame)
}

func (h *wsHub) snapshotFrame() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.clients) == 0 {
		// In assenza di client connessi tieni comunque l'ultimo frame:
		// usiamo un singleton "lastFrame" buffer.
	}
	return append([]byte(nil), lastFrame...)
}

// lastFrame è un buffer condiviso (single-producer, multi-reader)
// aggiornato da pushFrame.
var (
	lastFrameMu sync.RWMutex
	lastFrame   []byte
	lastPushAt  time.Time
)

func (h *wsHub) pushFrame(rgba []byte) {
	if h.throttleFPS > 0 {
		minDt := time.Second / time.Duration(h.throttleFPS)
		lastFrameMu.RLock()
		dt := time.Since(lastPushAt)
		lastFrameMu.RUnlock()
		if dt < minDt {
			return
		}
	}
	cp := make([]byte, len(rgba))
	copy(cp, rgba)
	lastFrameMu.Lock()
	lastFrame = cp
	lastPushAt = time.Now()
	lastFrameMu.Unlock()
	h.seq.Add(1)
}

// wsClient è il placeholder per il futuro upgrade a vero WebSocket
// (gorilla/websocket o nhooyr/websocket). Per ora non usato.
type wsClient struct{ conn net.Conn }

// ---- Report ----------------------------------------------------------------

func writeReport(path string, col *kpiCollector, gpu string) error {
	if path == "-" || path == "" {
		return col.writeJSON(os.Stdout, gpu)
	}
	out, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create %s: %w", path, err)
	}
	defer out.Close()
	if err := col.writeJSON(out, gpu); err != nil {
		return err
	}
	log.Printf("report written to %s", path)
	return nil
}

// Helper: usato da kpi.go per byte order del header WS in caso espandiamo
// il protocollo. Tenuto qui per evitare import cycle.
var _ = binary.LittleEndian

// Sentinel per evitare warning "imported and not used" su io quando si
// taglia il package per build più piccole.
var _ io.Writer = (*os.File)(nil)

