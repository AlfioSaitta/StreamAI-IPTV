// Backend libmpv via cgo. Compilato solo con `-tags mpv` su Linux/macOS
// (Windows usa `mpv_windows.go` con LoadLibraryEx, vedi plan §5.2).
//
// Scope di questo file (Fase 6.1 — pre-SPIKE):
//   - mpv_create + mpv_initialize con profilo IPTV-friendly (§4.8.2)
//   - Load/Play/Pause/Stop/Seek/SetVolume/SetMuted/SetSpeed via command/
//     set_property API (sincrono, no event loop ancora — gli event sono
//     gestiti in §6.1 con `mpv_wait_event` su goroutine separata e
//     `wailsevents.Emit("player-event", ...)` verso il frontend).
//   - State() snapshot (paused/position/duration/volume/speed) via
//     get_property tipizzato.
//   - Tracks() via `track-list` JSON property unmarshal.
//   - AddSub / SetAid / SetSid pass-through ai command mpv.
//   - Close() = mpv_terminate_destroy + reset puntatore.
//
// Out of scope di questo step (rinviato a §6.1 post-SPIKE):
//   - mpv_render_context_create() + FBO + shm transport (richiede SPIKE-1/3)
//   - BufferInfo() reale (per ora ritorna 0,0 vuoto — frontend deve fare
//     guard prima di inizializzare WebGL)
//   - PiP fallback (frontend, hooks/usePictureInPicture.ts §6.2)
//
// Note implementative:
//   - mpv API attesa: >= 1.107 (mpv 0.34, libmpv2.so). I server CI/distro
//     hanno tutti versioni più recenti; vedi build/depends/<distro>.json
//     che impone Depends "libmpv2" (Linux deb/rpm) o equivalente.
//   - Profilo libmpv: `hwdec=auto-safe`, `video-sync=audio`, `audio-buffer=
//     0.2`, `framedrop=vo`, `cache=yes`, `cache-secs=10` (vedi plan §4.8.2).
//     Override per IPTV live: `audio-buffer=0.5`, `cache-secs=4` (via
//     `Service.Profile = "live"` — non implementato qui, todo Fase 6.1).
//   - HTTP headers (Cookie, Referer, User-Agent) → option `http-header-fields`
//     come stringa "key: value\nkey: value" (formato libmpv). User-Agent
//     a parte via option `user-agent` per coerenza con il proxy IPTV.
//   - `terminal=no` + `idle=yes`: niente output stderr, mpv resta vivo
//     dopo Stop in attesa del prossimo Load (latenza zapping ridotta).

//go:build mpv && (linux || darwin)

package player

// #cgo pkg-config: mpv
// #include <stdlib.h>
// #include <string.h>
// #include <locale.h>
// #include <mpv/client.h>
// #include <mpv/render.h>
//
// // Helper C: costruisce l'array di mpv_render_param per il render SW
// // a partire dai puntatori già allocati lato Go. Tenere la logica qui
// // evita la gymnastica unsafe.Pointer↔*C.mpv_render_param sul lato Go.
// //
// // BLOCK_FOR_TARGET_TIME=0: per default `mpv_render_context_render` NON
// // torna finché non è il momento di mostrare il frame (pacing sul tempo di
// // presentazione, ~33 ms a 30 fps). Per un lettore embedded che disegna in un
// // canvas questo è dannoso e ingannevole:
// //   - parka un goroutine e una connessione HTTP per tutto il tempo di
// //     presentazione di OGNI frame, per un lavoro che dura ~4 ms;
// //   - falsa le metriche: il tempo per frame misurato diventa il pacing
// //     della sorgente, non il costo del render (misurato: ~31 ms contro
// //     ~7 ms reali a 720p, vedi scaler_cost_test.go);
// //   - il loop adattivo del frontend interpreta quell'attesa come carico e
// //     abbassa la cadenza, peggiorando la fluidità su hardware che invece
// //     avrebbe margine.
// // La sincronizzazione A/V resta garantita da mpv (`video-sync=audio`), non
// // dal blocco della call di render: senza blocco otteniamo il frame corrente
// // subito, e i frame non ancora maturi arrivano come "nessun frame nuovo"
// // (vedi il gating in RenderFrameEx).
// static int streamai_sw_render(mpv_render_context *ctx,
//                               int w, int h,
//                               const char *fmt,
//                               size_t stride,
//                               void *buffer) {
//     int size[2] = { w, h };
//     int block_for_target_time = 0;
//     mpv_render_param params[] = {
//         { MPV_RENDER_PARAM_SW_SIZE,    size },
//         { MPV_RENDER_PARAM_SW_FORMAT,  (void*)fmt },
//         { MPV_RENDER_PARAM_SW_STRIDE,  &stride },
//         { MPV_RENDER_PARAM_SW_POINTER, buffer },
//         { MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block_for_target_time },
//         { 0, NULL }
//     };
//     return mpv_render_context_render(ctx, params);
// }
//
// // Helper C: crea il render context in modalità SW.
// static int streamai_create_sw_ctx(mpv_handle *mpv, mpv_render_context **out) {
//     mpv_render_param params[] = {
//         { MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_API_TYPE_SW },
//         { 0, NULL }
//     };
//     return mpv_render_context_create(out, mpv, params);
// }
//
// // Registrazione del callback di update (definita in callback_cgo.c).
// // Contesto passato come `void*` per coerenza con la dichiarazione in
// // callback_cgo.go, che non può includere header mpv.
// int streamai_set_update_callback(void *ctx);
//
// // mpv_render_context_update() ritorna un bitfield: avvolgiamo la chiamata
// // per non dover gestire l'enum dal lato Go.
// static unsigned long long streamai_render_update(mpv_render_context *ctx) {
//     return (unsigned long long)mpv_render_context_update(ctx);
// }
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/rs/zerolog/log"
)

func newBackend() backend { return &cgoBackend{} }

// cgoBackend incapsula un mpv_handle. Lifecycle:
//   - newBackend()      → struct vuota (mpv non ancora creato, cost zero)
//   - Load() prima call → ensureInit() crea + initialize + applica profilo
//   - Load() successive → loadfile replace (no reinit, zapping veloce)
//   - Close()           → mpv_terminate_destroy + handle = nil
//
// Thread-safety: il chiamante (`*Service`) tiene già un mutex; qui non
// servono lock aggiuntivi. mpv_command / mpv_set_property sono safe da
// thread arbitrari secondo la docs.
type cgoBackend struct {
	mu        sync.Mutex // protegge `handle` e `renderCtx` durante init/close concorrenti
	handle    *C.mpv_handle
	renderCtx *C.mpv_render_context

	// renderMu serializza i render tra loro e rispetto a `Close()` (l'API
	// render di mpv non è thread-safe, e `mpv_render_context_free` non deve
	// correre con un `mpv_render_context_render` in corso). È distinto da `mu`
	// per non bloccare Load/Play/Pause/Seek per la durata di un frame.
	renderMu sync.Mutex

	// --- Rendering su richiesta (vedi RenderFrameEx) ---
	//
	// `needsUpdate` è alzato dal callback di update di libmpv (thread di mpv);
	// `sawUpdateSignal` dice se quel meccanismo ha MAI funzionato su questa
	// piattaforma/libmpv, ed è la condizione che abilita il salto dei frame
	// duplicati (vedi il commento in RenderFrameEx).
	needsUpdate     atomic.Bool
	sawUpdateSignal atomic.Bool

	// Ultimo frame renderizzato, riusato quando mpv non ne ha prodotto uno
	// nuovo. È di sola lettura una volta pubblicato: il chiamante lo consuma
	// (o lo scrive su HTTP) in modo sincrono.
	cachedFrame []byte
	cachedW     int
	cachedH     int

	frameSeq atomic.Uint64
	renders  atomic.Uint64
	skips    atomic.Uint64
}

// ensureInit crea il mpv_handle se non esiste. Da chiamare con `mu` preso.
func (b *cgoBackend) ensureInit() error {
	if b.handle != nil {
		return nil
	}

	// libmpv richiede LC_NUMERIC=C per il parsing corretto di float/opzioni.
	// Wails/Go usano solitamente UTF-8/C internamente, ma forziamo per sicurezza
	// dato che l'utente ha segnalato crash con locale it-IT.
	cloc := C.CString("C")
	defer C.free(unsafe.Pointer(cloc))
	C.setlocale(C.LC_NUMERIC, cloc)

	// Verifica versione API minima (1.107 = mpv 0.34).
	// In libmpv la versione è (major << 16) | minor.
	apiVersion := int(C.mpv_client_api_version())
	major := apiVersion >> 16
	minor := apiVersion & 0xFFFF
	minVersion := (1 << 16) | 107 // 1.107

	if apiVersion < minVersion {
		return fmt.Errorf("player: libmpv too old (api version %d.%d, expected >= 1.107)", major, minor)
	}

	// Creiamo l'handle. mpv_create() è un wrapper per mpv_create_client(NULL, "main").
	// Usiamo la call con recupero di errno per avere più diagnostica.
	h, err := C.mpv_create()
	if h == nil {
		return fmt.Errorf("player: mpv_create returned nil (api version: %d.%d, errno: %v; OOM or library mismatch)", major, minor, err)
	}

	// Profilo libmpv (plan §4.8.2). Set tutti i flag PRE-initialize:
	// `mpv_initialize` failure post-set è ricoverable, lo è meno il
	// contrario.
	opts := [][2]string{
		{"terminal", "no"},
		{"idle", "yes"},
		{"keep-open", "always"}, // post-EOS resta in pausa, no chiusura auto
		{"hwdec-codecs", "all"},
		// `video-sync=audio` (default di mpv) e non `display-resample`: il
		// resample sincronizzato al refresh del display è pensato per il
		// path OpenGL diretto, mentre qui ogni frame passa da una readback in
		// RAM + conversione in CPU. Quando il renderer non tiene il ritmo del
		// display, `display-resample` reagisce resamplando l'audio e
		// accumulando latenza; con `audio` mpv lascia scorrere il video e,
		// grazie a `framedrop=vo`, scarta i frame che non riesce a disegnare.
		// È la modalità più stabile su hardware lento.
		{"video-sync", "audio"},
		{"audio-buffer", "0.2"},
		{"audio-stream-silence", "yes"},
		{"framedrop", "vo"},
		{"demuxer-max-bytes", "150MiB"},
		{"demuxer-max-back-bytes", "75MiB"},
		{"cache", "yes"},
		{"cache-secs", "10"},
		{"cache-pause", "yes"},
		{"cache-pause-wait", "2"},
		{"interpolation", "no"},
		{"video-latency-hacks", "yes"},
		{"stream-buffer-size", "8MiB"},
		// Fase 6.1 (Step A): vo=libmpv consente di attivare il render-API
		// embedded. mpv NON apre una finestra propria; ogni frame è
		// renderizzato on-demand da `RenderFrame()` chiamando
		// `mpv_render_context_render` con MPV_RENDER_API_TYPE_SW
		// (path "slow but everywhere", vedi mpv/render.h: niente EGL/GL
		// nel processo Go → niente dipendenze su X11/Wayland display).
		// Step B (post-SPIKE-3) commuterà a MPV_RENDER_API_TYPE_OPENGL
		// con EGL surfaceless + texture DMA-BUF per la zero-copy 4K.
		{"vo", "libmpv"},
		// User-Agent: il proxy IPTV già rewriting; lo settiamo comunque
		// come fallback per stream caricati senza proxy.
		{"user-agent", "StreamAI IPTV"},
		{"stream-lavf-o", "reconnect=1,reconnect_streamed=1,reconnect_delay_max=5"},
	}
	for _, kv := range opts {
		if err := setOption(h, kv[0], kv[1]); err != nil {
			C.mpv_terminate_destroy(h)
			return fmt.Errorf("player: mpv_set_option_string %s=%s: %w", kv[0], kv[1], err)
		}
	}

	// Decodifica hardware con COPY-BACK.
	//
	// Il render-API software (`vo=libmpv` + MPV_RENDER_API_TYPE_SW) non può
	// consumare frame che vivono nella GPU: con `hwdec=auto-safe` mpv rileva che
	// il VO non supporta l'hardware decoding e ricade in SILENZIO sulla
	// decodifica in CPU. Su hardware datato significa decodificare 1080p
	// H.264/HEVC con la CPU, che è la causa principale di stutter e ventole.
	//
	// Le varianti `*-copy` decodificano sulla GPU e riscaricano il frame in RAM
	// nel formato atteso dal renderer software: si paga una copia per frame, ma
	// si sposta il carico da CPU a GPU — che è esattamente ciò che serve qui.
	//
	// La catena è in ordine di preferenza perché i valori disponibili variano
	// per versione di libmpv; `mpv_set_option_string` valida gli enum e
	// fallisce su un valore sconosciuto, quindi il primo accettato è anche il
	// migliore supportato da questa build. Se nessuno è disponibile restiamo sul
	// default di mpv (decodifica software) senza far fallire l'init.
	hwdecCandidates := []string{"auto-copy-safe", "auto-copy", "auto-safe", "auto"}
	hwdecSet := ""
	for _, candidate := range hwdecCandidates {
		if err := setOption(h, "hwdec", candidate); err == nil {
			hwdecSet = candidate
			break
		}
	}
	if hwdecSet == "" {
		log.Warn().Msg("player: no supported hwdec mode accepted, falling back to libmpv default")
	} else {
		log.Info().Str("hwdec", hwdecSet).Msg("player: hardware decoding (copy-back) requested")
	}

	if rc := C.mpv_initialize(h); rc < 0 {
		errMsg := C.GoString(C.mpv_error_string(rc))
		C.mpv_terminate_destroy(h)
		return fmt.Errorf("player: mpv_initialize: %s", errMsg)
	}

	// Fase 6.1 (Step A) — render context SW. Lo creiamo eagerly subito
	// dopo mpv_initialize per fallire fast se libmpv non supporta il
	// render-API SW (libmpv ≥ 0.34, builtin in tutte le distro target).
	// La memoria di destinazione viene allocata per-call in `RenderFrame`,
	// quindi qui basta tenere il context.
	var rctx *C.mpv_render_context
	if rc := C.streamai_create_sw_ctx(h, &rctx); rc < 0 {
		errMsg := C.GoString(C.mpv_error_string(rc))
		C.mpv_terminate_destroy(h)
		return fmt.Errorf("player: mpv_render_context_create(SW): %s", errMsg)
	}

	b.handle = h
	b.renderCtx = rctx

	// Notifica di "frame nuovo" da libmpv. È il meccanismo che permette di non
	// rirenderizzare frame duplicati (vedi RenderFrameEx): il render SW costa
	// ~4 ms per frame, quindi ripeterlo su frame identici è lavoro puro.
	activeBackend.Store(b)
	if rc := C.streamai_set_update_callback(unsafe.Pointer(rctx)); rc != 0 {
		log.Warn().Msg("player: mpv update callback not registered, will render on every call")
	}

	runtime.SetFinalizer(b, func(bb *cgoBackend) { _ = bb.Close() })
	return nil
}

// getPropertyInt64 legge una property intera (es. `frame-drop-count`).
func getPropertyInt64(h *C.mpv_handle, key string) int64 {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	var value C.int64_t
	if rc := C.mpv_get_property(h, ck, C.MPV_FORMAT_INT64, unsafe.Pointer(&value)); rc < 0 {
		return 0
	}
	return int64(value)
}

// RenderStats espone i contatori della pipeline di render.
func (b *cgoBackend) RenderStats() RenderCounters {
	b.mu.Lock()
	h := b.handle
	b.mu.Unlock()

	return RenderCounters{
		Renders:     b.renders.Load(),
		Skips:       b.skips.Load(),
		Seq:         b.frameSeq.Load(),
		Dropped:     droppedFrames(h),
		FrameGating: b.sawUpdateSignal.Load(),
	}
}

// droppedFrames legge il contatore di frame scartati da libmpv. È la metrica
// che dice se la pipeline riesce a stare dietro al contenuto: se cresce, il
// collo di bottiglia è nel render/upload, non nella rete.
func droppedFrames(h *C.mpv_handle) int64 {
	if h == nil {
		return 0
	}
	return getPropertyInt64(h, "frame-drop-count")
}

func setOption(h *C.mpv_handle, key, value string) error {
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

func setPropertyString(h *C.mpv_handle, key, value string) error {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	cv := C.CString(value)
	defer C.free(unsafe.Pointer(cv))
	rc := C.mpv_set_property_string(h, ck, cv)
	if rc < 0 {
		return errors.New(C.GoString(C.mpv_error_string(rc)))
	}
	return nil
}

func getPropertyString(h *C.mpv_handle, key string) (string, error) {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	out := C.mpv_get_property_string(h, ck)
	if out == nil {
		return "", fmt.Errorf("player: get_property_string %s: nil", key)
	}
	defer C.mpv_free(unsafe.Pointer(out))
	return C.GoString(out), nil
}

func getPropertyFloat(h *C.mpv_handle, key string) (float64, error) {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	var v C.double
	rc := C.mpv_get_property(h, ck, C.MPV_FORMAT_DOUBLE, unsafe.Pointer(&v))
	if rc < 0 {
		return 0, errors.New(C.GoString(C.mpv_error_string(rc)))
	}
	return float64(v), nil
}

func getPropertyBool(h *C.mpv_handle, key string) (bool, error) {
	ck := C.CString(key)
	defer C.free(unsafe.Pointer(ck))
	var v C.int
	rc := C.mpv_get_property(h, ck, C.MPV_FORMAT_FLAG, unsafe.Pointer(&v))
	if rc < 0 {
		return false, errors.New(C.GoString(C.mpv_error_string(rc)))
	}
	return v != 0, nil
}

// command esegue un comando mpv con args variadici (es. "loadfile", url, "replace").
// Equivalente di `mpv_command` con array NULL-terminato di C.string.
func command(h *C.mpv_handle, args ...string) error {
	if len(args) == 0 {
		return errors.New("player: command with no args")
	}
	cargs := make([]*C.char, len(args)+1)
	for i, a := range args {
		cargs[i] = C.CString(a)
	}
	cargs[len(args)] = nil
	defer func() {
		for i := range args {
			C.free(unsafe.Pointer(cargs[i]))
		}
	}()
	rc := C.mpv_command(h, &cargs[0])
	if rc < 0 {
		return fmt.Errorf("player: mpv_command %s: %s", args[0], C.GoString(C.mpv_error_string(rc)))
	}
	return nil
}

// --- backend interface implementation ---

func (b *cgoBackend) Load(url string, headers map[string]string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ensureInit(); err != nil {
		return err
	}

	if len(headers) > 0 {
		// `user-agent` ha la sua option dedicata (override esplicito).
		if ua := headers["User-Agent"]; ua != "" {
			_ = setPropertyString(b.handle, "user-agent", ua)
		}
		// Resto via http-header-fields (formato "k: v\nk: v\n").
		var sb strings.Builder
		for k, v := range headers {
			if strings.EqualFold(k, "User-Agent") {
				continue
			}
			sb.WriteString(k)
			sb.WriteString(": ")
			sb.WriteString(v)
			sb.WriteByte('\n')
		}
		if sb.Len() > 0 {
			_ = setPropertyString(b.handle, "http-header-fields", sb.String())
		}
	}

	// loadfile <url> replace → sostituisce playlist corrente.
	return command(b.handle, "loadfile", url, "replace")
}

func (b *cgoBackend) Play() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: Play before Load")
	}
	return setPropertyString(b.handle, "pause", "no")
}

func (b *cgoBackend) Pause() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: Pause before Load")
	}
	return setPropertyString(b.handle, "pause", "yes")
}

func (b *cgoBackend) Stop() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return nil
	}
	return command(b.handle, "stop")
}

func (b *cgoBackend) Seek(seconds float64) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: Seek before Load")
	}
	return command(b.handle, "seek", strconv.FormatFloat(seconds, 'f', 3, 64), "absolute")
}

func (b *cgoBackend) SetVolume(v float64) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ensureInit(); err != nil {
		return err
	}
	// mpv volume scale 0..100 (default), noi normalizziamo 0..1.
	return setPropertyString(b.handle, "volume", strconv.FormatFloat(v*100, 'f', 2, 64))
}

func (b *cgoBackend) SetMuted(m bool) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ensureInit(); err != nil {
		return err
	}
	val := "no"
	if m {
		val = "yes"
	}
	return setPropertyString(b.handle, "mute", val)
}

func (b *cgoBackend) SetSpeed(speed float64) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if err := b.ensureInit(); err != nil {
		return err
	}
	return setPropertyString(b.handle, "speed", strconv.FormatFloat(speed, 'f', 3, 64))
}

func (b *cgoBackend) SetAid(id int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: SetAid before Load")
	}
	return setPropertyString(b.handle, "aid", strconv.Itoa(id))
}

func (b *cgoBackend) SetSid(id int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: SetSid before Load")
	}
	return setPropertyString(b.handle, "sid", strconv.Itoa(id))
}

func (b *cgoBackend) AddSub(path string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: AddSub before Load")
	}
	return command(b.handle, "sub-add", path, "auto")
}

func (b *cgoBackend) Resize(width, height int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil || b.renderCtx == nil {
		return nil
	}

	// Per ora in modalità SW il ridimensionamento è gestito dinamicamente ad ogni
	// chiamata di RenderFrame(w, h). Tuttavia, prepariamo il backend per
	// lo Stage B (OpenGL) dove qui inizializzeremo l'FBO.
	// Logghiamo il resize come informazione di debug se necessario.
	return nil
}

// trackListRaw mappa la property `track-list` di libmpv (JSON array).
type trackListRaw []struct {
	ID       int     `json:"id"`
	Type     string  `json:"type"`
	Title    string  `json:"title"`
	Lang     string  `json:"lang"`
	Codec    string  `json:"codec"`
	Selected bool    `json:"selected"`
	Default  bool    `json:"default"`
	External bool    `json:"external"`
	FPS      float64 `json:"demux-fps,omitempty"`
}

func (b *cgoBackend) Tracks() ([]Track, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return nil, nil
	}
	js, err := getPropertyString(b.handle, "track-list")
	if err != nil {
		return nil, err
	}
	if js == "" {
		return nil, nil
	}
	var raw trackListRaw
	if err := json.Unmarshal([]byte(js), &raw); err != nil {
		return nil, fmt.Errorf("player: parse track-list: %w", err)
	}
	out := make([]Track, 0, len(raw))
	for _, r := range raw {
		out = append(out, Track{
			ID:       r.ID,
			Type:     r.Type,
			Title:    r.Title,
			Lang:     r.Lang,
			Codec:    r.Codec,
			Selected: r.Selected,
		})
	}
	return out, nil
}

func (b *cgoBackend) SetMaxBitrate(kbps int) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return errors.New("player: SetMaxBitrate before Load")
	}
	// HLS/DASH ABR cap. mpv property `hls-bitrate` accetta "max" o un numero
	// (bps). 0 = auto.
	if kbps <= 0 {
		return setPropertyString(b.handle, "hls-bitrate", "max")
	}
	return setPropertyString(b.handle, "hls-bitrate", strconv.Itoa(kbps*1000))
}

func (b *cgoBackend) BufferInfo() (BufferInfo, error) {
	// Placeholder fino a SPIKE-1. Il frontend chiama BufferInfo() per
	// inizializzare lo shader WebGL2 → se ritorniamo width=0 il frontend
	// deve fare guard e ritardare l'inizializzazione (vedi
	// hooks/useNativeMpvEngine.ts).
	return BufferInfo{}, nil
}

func (b *cgoBackend) State() (State, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return State{}, nil
	}
	// `Loaded` NON può derivare dalla sola esistenza dell'handle: l'handle
	// viene creato all'init del backend e `Stop()` invia solo il comando
	// `stop`, senza distruggerlo. Il risultato era che il player si
	// dichiarava `Loaded: true` già all'avvio dell'app e restava tale anche a
	// stream fermo; a valle `cmd/streamai/main.go` attivava quindi l'inibitore
	// di sospensione del display, annunciava "playing" su MPRIS e trasmetteva
	// lo status in broadcast LAN ogni secondo senza che nulla fosse in
	// riproduzione. Deriviamo lo stato reale da mpv.
	st := State{}
	if idle, err := getPropertyBool(b.handle, "idle-active"); err == nil {
		st.Loaded = !idle
	} else if pos, err := getPropertyFloat(b.handle, "playlist-pos"); err == nil {
		st.Loaded = pos >= 0
	}

	// `pause` viene letto solo se c'è davvero un media: a player idle mpv
	// mantiene l'ultimo valore di `pause`, che descriverebbe uno stato
	// inesistente (e farebbe scattare `Loaded && !Paused` nei consumer).
	if st.Loaded {
		if paused, err := getPropertyBool(b.handle, "pause"); err == nil {
			st.Paused = paused
			st.Playing = !paused
		}
	}
	if pos, err := getPropertyFloat(b.handle, "time-pos"); err == nil {
		st.Position = pos
	}
	if dur, err := getPropertyFloat(b.handle, "duration"); err == nil {
		st.Duration = dur
	}
	if vol, err := getPropertyFloat(b.handle, "volume"); err == nil {
		st.Volume = vol / 100.0
	}
	if mute, err := getPropertyBool(b.handle, "mute"); err == nil {
		st.Muted = mute
	}
	if spd, err := getPropertyFloat(b.handle, "speed"); err == nil {
		st.Speed = spd
	}
	if br, err := getPropertyFloat(b.handle, "video-bitrate"); err == nil && br > 0 {
		st.BitrateKbps = int(br / 1000)
	}
	return st, nil
}

// HwInfo legge da libmpv le property che descrivono la pipeline di
// decodifica attiva. Pensato per essere chiamato sia con file caricato
// (restituisce valori reali) sia idle (campi codec vuoti, ma `MpvVersion`
// e `LibmpvAPIVersion` sempre popolati). Vedi tipo HwAccelInfo in service.go.
func (b *cgoBackend) HwInfo() (HwAccelInfo, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	info := HwAccelInfo{Built: true}

	// LibmpvAPIVersion non richiede mpv_handle.
	info.LibmpvAPIVersion = int(C.mpv_client_api_version())

	// MpvVersion senza handle: usiamo un handle temporaneo se
	// necessario, ma l'API mpv_client_name richiede handle. Per
	// la versione mpv-runtime usiamo la property "mpv-version" via
	// handle se disponibile.
	if b.handle == nil {
		// Nessuno stream caricato: ritorniamo solo le info statiche.
		return info, nil
	}

	if v, err := getPropertyString(b.handle, "mpv-version"); err == nil {
		info.MpvVersion = strings.TrimSpace(v)
	}
	// "hwdec-current" property: stringa che indica il backend attivo
	// (es. "vaapi", "vaapi-copy", "nvdec", "drm", "videotoolbox",
	// "d3d11va", "no", ""). Vuoto = nessun decoder attivo (idle).
	if v, err := getPropertyString(b.handle, "hwdec-current"); err == nil {
		info.HwdecCurrent = strings.TrimSpace(v)
		info.Accelerated = info.HwdecCurrent != "" && info.HwdecCurrent != "no"
	}
	if v, err := getPropertyString(b.handle, "video-codec"); err == nil {
		info.VideoCodec = strings.TrimSpace(v)
	}
	if v, err := getPropertyString(b.handle, "video-format"); err == nil {
		info.VideoCodecID = strings.TrimSpace(v)
	}
	return info, nil
}

func (b *cgoBackend) Close() error {
	// Attende i render in corso prima di liberare il render context: liberarlo
	// mentre un altro thread è dentro `mpv_render_context_render` è un
	// use-after-free lato libmpv. Ordine di lock: renderMu → mu (stesso ordine
	// di RenderFrame, nessuna inversione possibile).
	b.renderMu.Lock()
	defer b.renderMu.Unlock()
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return nil
	}
	log.Debug().Msg("player: mpv_terminate_destroy started")
	// Ordine teardown: prima il render context (che osserva mpv),
	// poi terminate_destroy.
	if b.renderCtx != nil {
		log.Debug().Msg("player: mpv_render_context_free started")
		C.mpv_render_context_free(b.renderCtx)
		b.renderCtx = nil
		log.Debug().Msg("player: mpv_render_context_free finished")
	}
	C.mpv_terminate_destroy(b.handle)
	b.handle = nil

	// Non notificare più un backend distrutto (il callback di update vive
	// quanto il render context, ma la notifica arriverebbe a un backend chiuso).
	activeBackend.CompareAndSwap(b, nil)
	b.cachedFrame = nil

	log.Debug().Msg("player: mpv_terminate_destroy finished")
	return nil
}

// RenderFrame disegna il frame corrente di mpv in un buffer RGBA in
// memoria Go e lo ritorna come []byte (lunghezza = w*h*4). Path SW:
// nessuna dipendenza su EGL/GL. Stride implicito = `w*4`.
//
// Costo: ogni call esegue colorspace conversion + scaling YUV→RGBA
// **interamente in CPU** dentro libmpv. Misurato su sorgente 1080p30
// (Ryzen 7 6800H, libmpv 2.5.0 — vedi TestRenderCostPerFrame):
//
//	output  960×540 → 3.31 ms/frame  (~10% di un core a 30 fps)
//	output 1280×720 → 4.36 ms/frame  (~13%)
//	output 1920×1080 → 4.53 ms/frame (~14%)
//
// Il costo cresce poco con la risoluzione di OUTPUT: domina la conversione
// colori sul frame in INGRESSO, non lo scaling. È anche il motivo per cui il
// tuning dei filtri di scaling non produce guadagni misurabili (provato, esito
// nullo: docs/stage-b-assessment.md §4-bis). L'unico modo per togliere questo
// costo è portarlo sulla GPU (`MPV_RENDER_API_TYPE_OPENGL`, Fase 2).
//
// NB: i valori storicamente riportati qui (3/7/17 ms) erano gonfiati dal
// blocco sul tempo di presentazione, non dal lavoro di conversione.
// Per ora va bene per dimostrare il pipeline end-to-end; il path
// HW-accelerated (MPV_RENDER_API_TYPE_OPENGL + DMA-BUF) arriva in
// Step B della Fase 6.1 dopo SPIKE-3.
//
// Errori comuni:
//   - w o h <= 0 → invalid argument.
//   - render context non inizializzato (player non ancora caricato
//     un media) → ritorna un buffer pieno di zeri (no errore: mpv
//     scrive comunque "nessun frame disponibile").
//   - libmpv ritorna `MPV_ERROR_UNSUPPORTED` se il formato SW non è
//     compilato (cosa improbabile su libmpv >= 0.34).
//
// Format: usiamo `"rgb0"` = 4 bytes per pixel, ordine R,G,B,X (BGRA non
// pre-moltiplicato). Per `<canvas>` 2D + `putImageData` serve RGBA
// (R,G,B,A) — il consumer lato JS può fare swap se necessario; il
// nostro hook attuale tratta il buffer come "BGRA, alpha=0xff".
func (b *cgoBackend) RenderFrame(w, h int) ([]byte, error) {
	buf, _, _, err := b.RenderFrameEx(w, h)
	return buf, err
}

// RenderFrameEx è `RenderFrame` con due informazioni in più: la sequenza del
// frame (`seq`) e se questo è un frame NUOVO (`isNew`).
//
// `isNew == false` significa che mpv non ha prodotto un frame nuovo dall'ultima
// chiamata: il buffer ritornato è identico al precedente e il chiamante può
// saltare l'upload GPU (era il caso più frequente: il frontend chiede un frame
// a cadenza fissa, mentre il contenuto è 24/25/30p, quindi una quota
// significativa delle richieste riportava lo stesso identico frame — con 3-17
// ms di conversione in CPU spesi per ricrearlo).
//
// GARANZIA DI NON-REGRESSIONE: il salto avviene **solo** se il callback di
// update di libmpv ha già segnalato almeno un frame (`sawUpdateSignal`). Se il
// meccanismo non funziona su una data piattaforma/libmpv, `sawUpdateSignal`
// resta false e il comportamento è esattamente quello precedente: si
// renderizza a ogni chiamata. Il salto non può quindi mai produrre un frame
// mancante o uno stallo.
func (b *cgoBackend) RenderFrameEx(w, h int) ([]byte, uint64, bool, error) {
	if w <= 0 || h <= 0 {
		return nil, 0, false, fmt.Errorf("player: RenderFrame: invalid size %dx%d", w, h)
	}
	// `mpv_render_context_render` non è thread-safe e non deve correre con
	// `mpv_render_context_free`: `renderMu` serializza i render tra loro e
	// rispetto a `Close()`. Deliberatamente NON teniamo `b.mu` per la durata
	// del render — quel mutex è condiviso con Load/Play/Pause/Seek/Stop e un
	// render software dura ~4 ms, quindi tenerlo qui bloccherebbe i comandi
	// dell'utente per la maggior parte del tempo a 60 fps.
	b.renderMu.Lock()
	defer b.renderMu.Unlock()

	// Snapshot del contesto di render: lettura brevissima, sotto `b.mu`.
	// `renderMu` (già preso) garantisce che `Close()` non lo liberi mentre
	// stiamo renderizzando.
	b.mu.Lock()
	rctx := b.renderCtx
	b.mu.Unlock()

	if rctx == nil {
		// Player non ancora inizializzato: buffer nero opaco.
		buf := make([]byte, w*h*4)
		for i := 3; i < len(buf); i += 4 {
			buf[i] = 0xff // alpha = opaco
		}
		return buf, b.frameSeq.Load(), true, nil
	}

	// Chiediamo a mpv se c'è un frame da renderizzare. `update()` va chiamata
	// dopo OGNI callback di update (è un requisito di render.h) e il suo valore
	// di ritorno contiene MPV_RENDER_UPDATE_FRAME quando un frame è pronto.
	pending := b.needsUpdate.Swap(false)
	flags := uint64(C.streamai_render_update(rctx))
	hasFrame := flags&uint64(C.MPV_RENDER_UPDATE_FRAME) != 0

	if pending || hasFrame {
		b.sawUpdateSignal.Store(true)
	}

	// Salto del frame duplicato: la politica (e le sue condizioni di sicurezza)
	// sta in gating.go, così è testabile senza cgo.
	hasValidCache := b.cachedFrame != nil && b.cachedW == w && b.cachedH == h
	if shouldReuseFrame(b.sawUpdateSignal.Load(), pending, hasFrame, hasValidCache) == GatingReuse {
		b.skips.Add(1)
		return b.cachedFrame, b.frameSeq.Load(), false, nil
	}

	// Buffer di proprietà della richiesta: `AssetMiddleware` lo scrive nel
	// ResponseWriter in modo sincrono prima di ritornare, quindi non serve
	// copiarlo né riciclarlo. La versione precedente allocava comunque un
	// buffer nuovo a ogni frame *e* ci copiava dentro il frame del pool: a
	// 720p/60fps erano ~3.7 MB di memcpy in più per frame (~220 MB/s) e
	// pressione sul GC, senza alcun risparmio di allocazioni.
	size := w * h * 4
	buf := make([]byte, size)

	fmt0 := C.CString("rgba")
	defer C.free(unsafe.Pointer(fmt0))
	stride := C.size_t(w * 4)
	rc := C.streamai_sw_render(
		rctx,
		C.int(w), C.int(h),
		fmt0,
		stride,
		unsafe.Pointer(&buf[0]),
	)
	if rc < 0 {
		return nil, 0, false, fmt.Errorf("player: mpv_render_context_render(SW): %s",
			C.GoString(C.mpv_error_string(rc)))
	}

	// Il frame appena prodotto diventa la cache per le chiamate in cui mpv non
	// avrà nulla di nuovo da dare.
	b.cachedFrame = buf
	b.cachedW = w
	b.cachedH = h
	b.renders.Add(1)

	return buf, b.frameSeq.Add(1), true, nil
}
