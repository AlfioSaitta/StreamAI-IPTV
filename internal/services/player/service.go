// Package player — bridge cgo verso libmpv render-API (backend D, plan sez. 4).
//
// Architettura: libmpv decodifica con HW accel (VAAPI/NVDEC/D3D11VA/
// VideoToolbox), output in NV12/P010 surface, esportata al webview tramite
// shared-memory (transport T2) o WebCodecs fallback (T3). Il frontend
// renderizza in <canvas> WebGL2 con shader BT.709/BT.2020 -> sRGB.
//
// PiP: non gestito qui (frontend, hooks/usePictureInPicture.ts).
//
// Implementazione attesa (Fase 6.1):
//   - mpv_unix.go (build linux,darwin):  #cgo LDFLAGS: -lmpv
//   - mpv_windows.go (build windows): LoadLibraryEx("mpv-2.dll")
//   - transport_shm_unix.go (linux,darwin): shm_open + mmap
//   - transport_shm_windows.go: CreateFileMapping + MapViewOfFile
//   - profile.go: opzioni libmpv per AV-sync, HW decode, 4K (plan sez. 4.8.2)
//   - profile_live.go: override per IPTV latency-critical
//
// Spike preflight obbligatori (plan sez. 6.0): SPIKE-1, SPIKE-2, SPIKE-4.
package player
import "errors"
// Track audio/video/sottotitolo esposto al frontend.
type Track struct {
	ID       int    `json:"id"`
	Type     string `json:"type"` // "video" | "audio" | "sub"
	Title    string `json:"title,omitempty"`
	Lang     string `json:"lang,omitempty"`
	Codec    string `json:"codec,omitempty"`
	Selected bool   `json:"selected"`
}
// BufferInfo info sul ring buffer condiviso col webview.
type BufferInfo struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Format string `json:"format"` // "nv12" | "p010" | "rgba"
	Stride int    `json:"stride"`
}
// Service e' il Wails v3 Service del player (cgo libmpv).
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("player: not implemented yet (plan sez. 6 Fase 6.1, gated by SPIKE 1-2-4)")
// Load apre uno stream nel player. Headers HTTP custom (per IPTV con UA dinamico).
func (s *Service) Load(url string, headers map[string]string) error { return errNotImpl }
// Play / Pause / Stop comandi di playback base.
func (s *Service) Play() error  { return errNotImpl }
func (s *Service) Pause() error { return errNotImpl }
func (s *Service) Stop() error  { return errNotImpl }
// Seek cerca a posizione assoluta in secondi.
func (s *Service) Seek(seconds float64) error { return errNotImpl }
// SetVolume imposta volume 0.0-1.0.
func (s *Service) SetVolume(v float64) error { return errNotImpl }
// SetMuted attiva/disattiva mute.
func (s *Service) SetMuted(m bool) error { return errNotImpl }
// SetSpeed imposta velocita' di riproduzione (1.0 = normale).
func (s *Service) SetSpeed(speed float64) error { return errNotImpl }
// SetAid / SetSid selezionano traccia audio / sottotitolo per ID.
func (s *Service) SetAid(id int) error { return errNotImpl }
func (s *Service) SetSid(id int) error { return errNotImpl }
// AddSub carica un file di sottotitoli esterno (SRT/ASS/VTT).
func (s *Service) AddSub(path string) error { return errNotImpl }
// Resize comunica al backend la dimensione corrente del <canvas> per adattare
// l'FBO interno (debounced 100 ms lato frontend).
func (s *Service) Resize(width, height int) error { return errNotImpl }
// Tracks ritorna la lista delle tracce disponibili.
func (s *Service) Tracks() ([]Track, error) { return nil, errNotImpl }
// SetMaxBitrate cap bitrate per ABR (Adaptive Bitrate). 0 = auto.
func (s *Service) SetMaxBitrate(kbps int) error { return errNotImpl }
// BufferInfo info shared-memory ring buffer.
func (s *Service) BufferInfo() (BufferInfo, error) { return BufferInfo{}, errNotImpl }
