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
// #include <mpv/client.h>
import "C"

import (
	"encoding/json"
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"unsafe"
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
	mu     sync.Mutex // protegge `handle` durante init/close concorrenti
	handle *C.mpv_handle
}

// ensureInit crea il mpv_handle se non esiste. Da chiamare con `mu` preso.
func (b *cgoBackend) ensureInit() error {
	if b.handle != nil {
		return nil
	}
	h := C.mpv_create()
	if h == nil {
		return errors.New("player: mpv_create returned nil (libmpv too old or OOM)")
	}

	// Profilo libmpv (plan §4.8.2). Set tutti i flag PRE-initialize:
	// `mpv_initialize` failure post-set è ricoverable, lo è meno il
	// contrario.
	opts := [][2]string{
		{"terminal", "no"},
		{"idle", "yes"},
		{"keep-open", "always"}, // post-EOS resta in pausa, no chiusura auto
		{"hwdec", "auto-safe"},
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
		// Headless: niente window output, render-API la attiveremo in §6.1.
		// `vo=null` permette decodifica audio + tracking position senza
		// finestra mpv nativa. Quando SPIKE-1 conferma render-API, switch a
		// `vo=libmpv` + `mpv_render_context_create`.
		{"vo", "null"},
		// User-Agent: il proxy IPTV già rewriting; lo settiamo comunque
		// come fallback per stream caricati senza proxy.
		{"user-agent", "StreamAI IPTV"},
	}
	for _, kv := range opts {
		if err := setOption(h, kv[0], kv[1]); err != nil {
			C.mpv_terminate_destroy(h)
			return fmt.Errorf("player: mpv_set_option_string %s=%s: %w", kv[0], kv[1], err)
		}
	}

	if rc := C.mpv_initialize(h); rc < 0 {
		errMsg := C.GoString(C.mpv_error_string(rc))
		C.mpv_terminate_destroy(h)
		return fmt.Errorf("player: mpv_initialize: %s", errMsg)
	}

	b.handle = h
	runtime.SetFinalizer(b, func(bb *cgoBackend) { _ = bb.Close() })
	return nil
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
	// No-op fino a SPIKE-1: il render context non esiste ancora.
	// Quando attiveremo `mpv_render_context_create`, qui invocheremo
	// `mpv_render_context_set_parameter(MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME)`
	// + ridimensioneremo l'FBO interno. Per ora ignoriamo silenziosamente:
	// il frontend chiama Resize anche prima del Load, non vogliamo errori.
	_ = width
	_ = height
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
	st := State{Loaded: true}

	if paused, err := getPropertyBool(b.handle, "pause"); err == nil {
		st.Paused = paused
		st.Playing = !paused
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
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.handle == nil {
		return nil
	}
	C.mpv_terminate_destroy(b.handle)
	b.handle = nil
	return nil
}
