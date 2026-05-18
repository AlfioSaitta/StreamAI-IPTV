// Package netstatus — porting di main.js UDP broadcast multicast
// 239.255.255.251:1901 ("playback-status") come Wails v3 Service.
//
// Permette ad altre istanze in LAN di sincronizzarsi sullo stato di playback
// (es. "what's playing on the living room TV").
//
// Implementazione attesa (Fase 4):
//   - net.ListenMulticastUDP per ricezione
//   - net.DialUDP per emissione
package netstatus
import "errors"
// PlaybackStatus stato playback condiviso in LAN.
type PlaybackStatus struct {
	StreamURL   string  `json:"streamUrl"`
	StreamTitle string  `json:"streamTitle"`
	StreamType  string  `json:"streamType"` // "live" | "movie" | "series"
	Position    float64 `json:"position"`
	Duration    float64 `json:"duration"`
	IsPlaying   bool    `json:"isPlaying"`
	UpdatedAt   int64   `json:"updatedAt"` // unix ms
}
// Service e' il Wails v3 Service di network status broadcast.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("netstatus: not implemented yet (plan sez. 6 Fase 4)")
// UpdatePlaybackStatus broadcast un nuovo stato in multicast.
func (s *Service) UpdatePlaybackStatus(status PlaybackStatus) error { return errNotImpl }
