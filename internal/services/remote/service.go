// Package remote — porting di main.js setupWebSocketServer (porta 1902)
// come Wails v3 Service.
//
// Espone un WebSocket server :1902 per controllo remoto da app companion
// mobile. Comandi entranti vengono riemessi al frontend via app.EmitEvent
// "remote-control-command" (vedi docs/plan-go-wails-migration.md sez. 3, Fase 4).
//
// Implementazione attesa: nhooyr.io/websocket (moderno, context-aware).
package remote
import "errors"
// Service e' il Wails v3 Service di remote control.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("remote: not implemented yet (plan sez. 6 Fase 4)")
// Port ritorna la porta WS attualmente in ascolto (default 1902).
func (s *Service) Port() (int, error) { return 1902, nil }
// Clients ritorna il numero di client WS connessi.
func (s *Service) Clients() (int, error) { return 0, errNotImpl }
