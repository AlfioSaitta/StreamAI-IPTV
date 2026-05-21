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
	Close() error
}

// Service è il Wails v3 Service del player.
// Tutti i metodi pubblici sono auto-bindati dal generator (`npm run
// wails:bindings`) sotto frontend/bindings/.../player/service.ts.
//
// Thread-safety: tutti i metodi sono safe per chiamata concorrente dal
// frontend; il lock protegge il puntatore al backend (lazy-init al
// primo Load) e il riferimento all'app per emit di eventi.
type Service struct {
	mu      sync.Mutex
	backend backend
}

// New costruisce il servizio. Il backend reale è creato a build-time
// (vedi mpv_cgo.go / mpv_stub.go) tramite il selettore `newBackend()`.
func New() *Service {
	return &Service{backend: newBackend()}
}

// ServiceShutdown rilascia le risorse del backend (mpv_terminate_destroy).
// Chiamato da Wails v3 in ordine inverso di registrazione: in main.go
// il player è uno dei primi a essere registrato, quindi tra gli ultimi
// a essere chiuso (post-cast/remote/netstatus), così l'audio output
// non viene tagliato prima che l'UI abbia salvato l'history watch.
func (s *Service) ServiceShutdown() error {
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
	defer s.mu.Unlock()
	return s.backend.Load(url, headers)
}

// Play / Pause / Stop comandi di playback base.
func (s *Service) Play() error  { s.mu.Lock(); defer s.mu.Unlock(); return s.backend.Play() }
func (s *Service) Pause() error { s.mu.Lock(); defer s.mu.Unlock(); return s.backend.Pause() }
func (s *Service) Stop() error  { s.mu.Lock(); defer s.mu.Unlock(); return s.backend.Stop() }

// Seek cerca a posizione assoluta in secondi.
func (s *Service) Seek(seconds float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.Seek(seconds)
}

// SetVolume imposta volume 0.0..1.0. Valori fuori range vengono clampati.
func (s *Service) SetVolume(v float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	return s.backend.SetVolume(v)
}

// SetMuted attiva/disattiva mute.
func (s *Service) SetMuted(m bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.SetMuted(m)
}

// SetSpeed velocità di riproduzione (1.0 = normale, 0.5 = lento, 2.0 = veloce).
func (s *Service) SetSpeed(speed float64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.backend.SetSpeed(speed)
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
