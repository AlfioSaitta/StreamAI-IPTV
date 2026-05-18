// Package advertising — porting di services/advertisingService.js (Electron
// main process) come Wails v3 Service.
//
// Annuncia l'app come ricevitore AirPlay (mDNS _airplay._tcp + _raop._tcp),
// DLNA/UPnP (SSDP MediaRenderer:1), DIAL (urn:dial-multiscreen-org:device:dial:1).
//
// Implementazione attesa (Fase 2):
//   - grandcat/zeroconf per mDNS announce
//   - koron/go-ssdp in advertise mode
package advertising
import "errors"
// Service e' il Wails v3 Service di advertising.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("advertising: not implemented yet (plan sez. 6 Fase 2)")
// Start avvia gli annunci mDNS+SSDP. Idempotente.
func (s *Service) Start() error { return errNotImpl }
// Stop ferma gli annunci.
func (s *Service) Stop() error { return errNotImpl }
// Status ritorna lo stato corrente: "running" | "stopped" | "error".
func (s *Service) Status() (string, error) { return "stopped", nil }
