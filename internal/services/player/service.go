// Package player — Wails v3 Service che incapsula libmpv (backend D, plan §4).
//
// Architettura (vedi docs/plan-go-wails-migration.md §4.1–4.3):
//
//	hooks/useNativeMpvEngine.ts (React)
//	    │ binding TS auto-generato
//	    ▼
//	internal/services/player/service.go (questo file — dispatcher + API pubblica)
//	    │ delega a backend selezionato a build-time
//	    ▼
//	┌─ mpv_cgo.go (build tag `mpv`, linux+darwin)  →  cgo su libmpv
//	│   + mpv_windows.go (build tag `mpv`)         →  LoadLibraryEx("mpv-2.dll")
//	│   + render_*.go                              →  render-API → shm transport
//	└─ mpv_stub.go (default, no build tag)         →  errori errNotBuilt
//
// Il backend di default ritorna `errNotBuilt` su tutti i metodi: lo scopo è
// permettere la compilazione del Wails service tree anche su CI/dev box che
// non hanno libmpv (es. CI Linux runner senza HW decode, openSUSE TW di
// sviluppo dove libmpv non è pre-installato). Per attivare il backend reale
// in build di rilascio Linux/macOS: `go build -tags mpv,...`. Il task
// `wails3 build` viene esteso in Fase 8 con `-tags mpv` automatico.
//
// Spike preflight obbligatori (plan §6.0) prima di sbloccare la Fase 6.1
// production-ready: SPIKE-1 (render-API → canvas 4K@60), SPIKE-2 (Document
// PiP), SPIKE-3 (shm zero-copy), SPIKE-4 (AV-sync HLS live 4K), SPIKE-5
// (DRM-PRIME Linux fast path, opzionale).
package player

import (
	"errors"
	"net/http"
	"strconv"
	"sync"
)

// errNotBuilt è ritornato dal backend stub quando il binario è stato
// compilato senza il build-tag `mpv`. Lasciato esportato per i test
// del dispatcher.
var errNotBuilt = errors.New("player: libmpv backend not compiled in (rebuild with -tags mpv)")

// Track audio/video/sottotitolo esposto al frontend.
type Track struct {
	ID       int    `json:"id"`
	Type     string `json:"type"` // "video" | "audio" | "sub"
	Title    string `json:"title,omitempty"`
	Lang     string `json:"lang,omitempty"`
	Codec    string `json:"codec,omitempty"`
	Selected bool   `json:"selected"`
}

// BufferInfo info sul ring buffer condiviso col webview (transport T2, §4.3).
// Width/Height in pixel del frame decodificato. Format: "nv12" (8-bit) /
// "p010" (10-bit) / "rgba" (fallback CPU readback). Stride in byte per il
// plane Y (NV12/P010); per RGBA è width*4.
type BufferInfo struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"`
	Stride int    `json:"stride"`
}

// State riassume lo stato del player per UI binding (sostituisce le tante
// IPC distinte di Video.js: paused, currentTime, duration, volume, muted).
type State struct {
	Loaded      bool    `json:"loaded"`
	Playing     bool    `json:"playing"`
	Paused      bool    `json:"paused"`
	Position    float64 `json:"position"` // secondi
	Duration    float64 `json:"duration"` // secondi (0 = live)
	Volume      float64 `json:"volume"`   // 0..1
	Muted       bool    `json:"muted"`
	Speed       float64 `json:"speed"`       // 1.0 = normale
	BitrateKbps int     `json:"bitrateKbps"` // current track bitrate (0 = unknown)
}

// HwAccelInfo riassume lo stato dell'accelerazione hardware del backend
// libmpv. Equivalente Wails dell'IPC `get-gpu-status` di Electron — il
// frontend (services/hwAccelService.ts) consuma entrambi via hostBridge.
//
// Campi:
//   - Built: true se il binario è stato compilato con `-tags mpv` (backend
//     reale); false se è in uso lo stub. UI mostra warning "Backend
//     video non disponibile" quando false.
//   - HwdecCurrent: valore della property mpv `hwdec-current`. Vuoto se
//     nessun file è caricato. Valori tipici: "vaapi", "nvdec", "drm",
//     "videotoolbox", "d3d11va", "no" (= software).
//   - Accelerated: true se `HwdecCurrent` ≠ "" e ≠ "no". Comodo per la UI.
//   - MpvVersion: stringa libmpv (es. "v0.39.0"). Utile in diagnostica
//     per matchare bug report (#vaapi su mpv 0.36 vs 0.39).
//   - VideoCodec / VideoCodecID: codec corrente come visto da mpv.
//   - LibmpvAPIVersion: numerico (es. 132). Soglia minima nostra: 107.
type HwAccelInfo struct {
	Built            bool   `json:"built"`
	Accelerated      bool   `json:"accelerated"`
	HwdecCurrent     string `json:"hwdecCurrent"`
	MpvVersion       string `json:"mpvVersion"`
	LibmpvAPIVersion int    `json:"libmpvApiVersion"`
	VideoCodec       string `json:"videoCodec"`
	VideoCodecID     string `json:"videoCodecId"`
	Error            string `json:"error,omitempty"`
}

// backend è l'interfaccia interna che ciascuna implementazione
// (cgo-mpv o stub) deve soddisfare. Permette di:
//   - testare il dispatcher senza libmpv;
//   - swap-pare il backend a build time tramite tag `mpv`;
//   - aggiungere in futuro un backend test/fake (es. fake mpv per
//     i test E2E del frontend Wails dev mode).
type backend interface {
	Load(url string, headers map[string]string) error
	Play() error
	Pause() error
	Stop() error
	Seek(seconds float64) error
	SetVolume(v float64) error
	SetMuted(m bool) error
	SetSpeed(speed float64) error
	SetAid(id int) error
	SetSid(id int) error
	AddSub(path string) error
	Resize(width, height int) error
	Tracks() ([]Track, error)
	SetMaxBitrate(kbps int) error
	BufferInfo() (BufferInfo, error)
	State() (State, error)
	HwInfo() (HwAccelInfo, error)
	// RenderFrame disegna il frame video corrente di libmpv in un buffer
	// RGBA in memoria (path SW, MPV_RENDER_API_TYPE_SW, "rgb0" pixfmt).
	// Lunghezza buffer = w*h*4, stride = w*4. Vedi mpv_cgo.go.RenderFrame
	// per i costi (decoder + colorspace conversion in CPU dentro libmpv).
	// Fase 6.1 Stage A: path RGBA readback "slow but everywhere"; lo
	// switch a OpenGL render-API + zero-copy DMA-BUF è in Stage B.
	RenderFrame(width, height int) ([]byte, error)
	Close() error
}

// Service è il Wails v3 Service del player.
// Tutti i metodi pubblici sono auto-bindati dal generator (`npm run
// wails:bindings`) sotto frontend/bindings/.../player/service.ts.
//
// Thread-safety: tutti i metodi sono safe per chiamata concorrente dal
// frontend; `mu` protegge il puntatore al backend (lazy-init al primo
// Load); `evMu` protegge i subscribers e i metadati track-level (vedi
// events.go).
type Service struct {
	mu      sync.Mutex
	backend backend

	// Subscriber pattern + metadati track-level (Fase 6.5, events.go).
	evMu           sync.RWMutex
	subscribers    []subscriber
	sourceURL      string
	trackTitle     string
	trackArtist    string
	trackArtURL    string
	watcherRunning bool
	watcherStop    chan struct{}
}

// New costruisce il servizio. Il backend reale è creato a build-time
// (vedi mpv_cgo.go / mpv_stub.go) tramite il selettore `newBackend()`.
func New() *Service {
	return &Service{
		backend:     newBackend(),
		watcherStop: make(chan struct{}),
	}
}

// ServiceShutdown rilascia le risorse del backend (mpv_terminate_destroy).
// Chiamato da Wails v3 in ordine inverso di registrazione: in main.go
// il player è uno dei primi a essere registrato, quindi tra gli ultimi
// a essere chiuso (post-cast/remote/netstatus), così l'audio output
// non viene tagliato prima che l'UI abbia salvato l'history watch.
func (s *Service) ServiceShutdown() error {
	// Ferma il watcher events (events.go) prima di chiudere il backend.
	s.evMu.Lock()
	if s.watcherRunning {
		// Drena il channel se gia' chiuso (idempotenza shutdown multipli).
		select {
		case <-s.watcherStop:
		default:
			close(s.watcherStop)
		}
		s.watcherRunning = false
	}
	s.evMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.backend == nil {
		return nil
	}
	return s.backend.Close()
}

// Load apre uno stream. Headers HTTP custom (es. User-Agent IPTV, Cookie,
// Referer custom per provider Xtream restricted). Per stream proxati via
// `proxy.Service.BuildProxyURL` gli headers vengono già injetti dal proxy
// → qui basta passare l'URL `127.0.0.1:<port>/proxy?u=...`.
func (s *Service) Load(url string, headers map[string]string) error {
	s.mu.Lock()
	err := s.backend.Load(url, headers)
	s.mu.Unlock()
	if err == nil {
		s.evMu.Lock()
		s.sourceURL = url
		s.evMu.Unlock()
		s.emitState()
	}
	return err
}

// Play / Pause / Stop comandi di playback base.
func (s *Service) Play() error {
	s.mu.Lock()
	err := s.backend.Play()
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

func (s *Service) Pause() error {
	s.mu.Lock()
	err := s.backend.Pause()
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

func (s *Service) Stop() error {
	s.mu.Lock()
	err := s.backend.Stop()
	s.mu.Unlock()
	if err == nil {
		// Reset metadata su Stop esplicito.
		s.evMu.Lock()
		s.sourceURL = ""
		s.trackTitle = ""
		s.trackArtist = ""
		s.trackArtURL = ""
		s.evMu.Unlock()
		s.emitState()
	}
	return err
}

// Seek cerca a posizione assoluta in secondi.
func (s *Service) Seek(seconds float64) error {
	s.mu.Lock()
	err := s.backend.Seek(seconds)
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

// SetVolume imposta volume 0.0..1.0. Valori fuori range vengono clampati.
func (s *Service) SetVolume(v float64) error {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	s.mu.Lock()
	err := s.backend.SetVolume(v)
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

// SetMuted attiva/disattiva mute.
func (s *Service) SetMuted(m bool) error {
	s.mu.Lock()
	err := s.backend.SetMuted(m)
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

// SetSpeed velocità di riproduzione (1.0 = normale, 0.5 = lento, 2.0 = veloce).
func (s *Service) SetSpeed(speed float64) error {
	s.mu.Lock()
	err := s.backend.SetSpeed(speed)
	s.mu.Unlock()
	if err == nil {
		s.emitState()
	}
	return err
}

// SetAid / SetSid selezionano traccia audio / sottotitolo per ID
// (vedi Tracks()).
func (s *Service) SetAid(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.SetAid(id)
}

// SetSid imposta la traccia sottotitolo.
func (s *Service) SetSid(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.SetSid(id)
}

// AddSub carica un file di sottotitoli esterno (SRT/ASS/VTT).
func (s *Service) AddSub(path string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.AddSub(path)
}

// Resize comunica al backend la dimensione corrente del <canvas> per
// adattare l'FBO interno (debounced 100 ms lato frontend).
func (s *Service) Resize(width, height int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.Resize(width, height)
}

// Tracks ritorna la lista delle tracce disponibili (audio + sub + video).
func (s *Service) Tracks() ([]Track, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.Tracks()
}

// SetMaxBitrate cap bitrate per ABR (Adaptive Bitrate). 0 = auto.
func (s *Service) SetMaxBitrate(kbps int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.SetMaxBitrate(kbps)
}

// BufferInfo info del ring buffer condiviso (transport T2/T3).
// Il frontend usa queste info per inizializzare lo shader WebGL2 con i
// formati YUV corretti.
func (s *Service) BufferInfo() (BufferInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.BufferInfo()
}

// State snapshot dello stato corrente (poll-friendly, esposto al frontend
// per evitare round-trip multipli su 6 property diverse).
func (s *Service) State() (State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.State()
}

// HwAccelInfo restituisce lo stato corrente dell'accelerazione hardware
// libmpv (vedi tipo HwAccelInfo). Esposto a `frontend/services/
// hwAccelService.ts` come controparte Wails dell'IPC Electron
// `get-gpu-status`. Sicuro anche con stub backend: ritorna
// `HwAccelInfo{Built: false}` invece di errore, così la UI può
// mostrare il warning senza far esplodere la promise.
func (s *Service) HwAccelInfo() (HwAccelInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := s.backend.HwInfo()
	if err != nil && errors.Is(err, errNotBuilt) {
		return HwAccelInfo{Built: false, Error: err.Error()}, nil
	}
	return info, err
}

// AssetMiddlewarePath è il path same-origin servito dall'asset server di
// Wails per esporre i frame RGBA decodificati da libmpv (Fase 6.1 Stage A).
// La webview blocca le fetch verso server HTTP standalone su 127.0.0.1
// per mixed-content/CORS (stesso problema del proxy IPTV, vedi
// `proxy.AssetMiddlewarePath`); montare l'endpoint come middleware
// dell'asset server permette al frontend di fare `fetch('/player/frame?w=W&h=H')`
// dal documento `wails://wails.localhost`.
//
// Query params:
//   - w (int, required): larghezza frame in pixel
//   - h (int, required): altezza frame in pixel
//
// Response body: w*h*4 bytes raw, pixel format "rgb0" (R,G,B,X — alpha
// indefinita). Content-Type: application/octet-stream. Headers
// `X-Frame-Width`/`X-Frame-Height` riflettono w/h ricevuti come sanity-check.
//
// Errors:
//   - 400 Bad Request: w o h mancanti/non numerici/fuori range [16..7680]
//   - 503 Service Unavailable: backend non compilato con `-tags mpv`
//     (errNotBuilt) — il frontend mostra il banner standard.
const AssetMiddlewarePath = "/player/frame"

// RenderFrame disegna il frame corrente di libmpv su un buffer RGBA in
// memoria Go di dimensione w*h*4. Vedi commento in `backend` interface
// e `mpv_cgo.go.RenderFrame`. Esposto come binding TS auto-generato (utile
// per smoke test devtools) e usato internamente da AssetMiddleware().
func (s *Service) RenderFrame(width, height int) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.RenderFrame(width, height)
}

// AssetMiddleware ritorna un middleware HTTP che intercetta le richieste a
// `AssetMiddlewarePath` (`/player/frame`) e risponde con il buffer RGBA
// del frame corrente. Lasciare passare tutto il resto al `next` handler.
// Wiring in `cmd/streamai/main.go` (chain con `proxy.AssetMiddleware`).
func (s *Service) AssetMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != AssetMiddlewarePath {
				next.ServeHTTP(w, r)
				return
			}
			q := r.URL.Query()
			width, err := strconv.Atoi(q.Get("w"))
			if err != nil || width < 16 || width > 7680 {
				http.Error(w, "invalid query param 'w' (expected 16..7680)", http.StatusBadRequest)
				return
			}
			height, err := strconv.Atoi(q.Get("h"))
			if err != nil || height < 16 || height > 4320 {
				http.Error(w, "invalid query param 'h' (expected 16..4320)", http.StatusBadRequest)
				return
			}
			buf, err := s.RenderFrame(width, height)
			if err != nil {
				if errors.Is(err, errNotBuilt) {
					http.Error(w, err.Error(), http.StatusServiceUnavailable)
					return
				}
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Length", strconv.Itoa(len(buf)))
			w.Header().Set("X-Frame-Width", strconv.Itoa(width))
			w.Header().Set("X-Frame-Height", strconv.Itoa(height))
			w.Header().Set("X-Pixel-Format", "rgb0")
			// Frame mai cacheable: ogni richiesta deve riflettere il
			// frame istantaneo del decoder.
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(buf)
		})
	}
}

