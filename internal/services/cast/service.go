// Package cast — porting di main.js cast-connect/load/control/disconnect
// come Wails v3 Service, basato su client CastV2 (go-chromecast o go-cast).
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3):
//
//electronAPI.castConnect(host)   -> CastService.Connect(host)
//electronAPI.castLoad(stream)    -> CastService.Load(req)
//electronAPI.castControl(cmd)    -> CastService.Control(cmd)
//electronAPI.castDisconnect()    -> CastService.Disconnect()
//electronAPI.onCastStatus(cb)    -> wails.Events.On("cast-status", cb)
package cast
import "errors"
// LoadRequest payload per caricare uno stream sul receiver.
type LoadRequest struct {
	URL         string            `json:"url"`
	ContentType string            `json:"contentType"`
	Title       string            `json:"title,omitempty"`
	Subtitle    string            `json:"subtitle,omitempty"`
	Poster      string            `json:"poster,omitempty"`
	StreamType  string            `json:"streamType"` // "LIVE" | "BUFFERED"
	Headers     map[string]string `json:"headers,omitempty"`
}
// ControlCommand comando di playback verso il receiver.
type ControlCommand struct {
	Action   string  `json:"action"` // "play" | "pause" | "seek" | "volume" | "mute"
	Position float64 `json:"position,omitempty"`
	Volume   float64 `json:"volume,omitempty"`
	Muted    bool    `json:"muted,omitempty"`
}
// Service e' il Wails v3 Service di cast.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("cast: not implemented yet (plan sez. 6 Fase 3)")
// Connect apre una sessione CastV2 con il receiver.
func (s *Service) Connect(host string, port int) error { return errNotImpl }
// Load richiede al receiver di caricare uno stream.
func (s *Service) Load(req LoadRequest) error { return errNotImpl }
// Control invia un comando di playback.
func (s *Service) Control(cmd ControlCommand) error { return errNotImpl }
// Disconnect chiude la sessione.
func (s *Service) Disconnect() error { return errNotImpl }
