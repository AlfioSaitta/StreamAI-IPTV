// Package remote — porting di main.js setupWebSocketServer (porta 1902)
// come Wails v3 Service.
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3 + Fase 4):
//
//main.js setupWebSocketServer  -> remote.Service (ServiceStartup avvia :1902)
//ws.send {type:"status",...}   -> remote.BroadcastStatus(status)
//ws.on('message', cmd)         -> wails.Events.On("remote-control-command", cb)
//ws.send {type:"ping"} keepal. -> goroutine per-conn (tick 30 s)
//
// Implementazione (Fase 4):
//   - HTTP server :1902 con `coder/websocket` (rename moderno di
//     nhooyr.io/websocket, già fra le dipendenze tramite Wails v3).
//   - Tutti i client connessi sono tracciati in `clients` (mappa
//     puntatore→struct{}); broadcast è O(N) ma N ≤ poche app companion.
//   - Hot-reconnect: il server resta in ascolto su 0.0.0.0; al cambio
//     interfaccia il socket è già bindato wildcard, quindi gli IP nuovi
//     funzionano senza restart (vs. main.js che era hard-coded sui
//     validInterfaces all'avvio).
package remote
import (
"context"
"encoding/json"
"net"
"net/http"
"strconv"
"sync"
"time"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
	"github.com/coder/websocket"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)
const (
// DefaultPort porta WS di controllo remoto (uguale a main.js WS_CONTROL_PORT).
DefaultPort = 1902
// EventRemoteCommand canale verso il frontend per comandi entranti.
EventRemoteCommand = "remote-control-command"
// pingInterval keepalive WS (uguale a main.js: 30 s).
pingInterval = 30 * time.Second
// readMessageMax limite per messaggio entrante (i comandi sono piccoli JSON).
readMessageMax = 64 * 1024
)
// Service è il Wails v3 Service di remote control.
type Service struct {
port int
mu      sync.Mutex
server  *http.Server
clients map[*websocket.Conn]struct{}
lastSt  []byte
stopped bool
}
// New costruisce il servizio. port==0 -> DefaultPort.
func New(port int) *Service {
if port == 0 {
port = DefaultPort
}
return &Service{port: port, clients: make(map[*websocket.Conn]struct{})}
}
// ServiceStartup avvia il server WS :port su 0.0.0.0. Implementa
// application.ServiceStartup di Wails v3.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
ln, err := net.Listen("tcp", ":"+strconv.Itoa(s.port))
if err != nil {
return err
}
mux := http.NewServeMux()
mux.HandleFunc("/", s.handleWS)
s.mu.Lock()
s.server = &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
srv := s.server
s.mu.Unlock()
go func() { _ = srv.Serve(ln) }()
return nil
}
// ServiceShutdown chiude listener + tutti i WS attivi.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("remote: ServiceShutdown started")
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		log.Info().Msg("remote: ServiceShutdown finished (already stopped)")
		return nil
	}
	s.stopped = true
	srv := s.server
	clients := s.clients
	s.clients = make(map[*websocket.Conn]struct{})
	s.mu.Unlock()
	for c := range clients {
		_ = c.Close(websocket.StatusGoingAway, "server shutting down")
	}
	if srv != nil {
		log.Debug().Msg("remote: http.Server.Shutdown started")
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(ctx)
		log.Debug().Msg("remote: http.Server.Shutdown finished")
	}
	log.Info().Msg("remote: ServiceShutdown finished")
	return nil
}
// Port ritorna la porta in ascolto.
func (s *Service) Port() int { return s.port }
// Clients ritorna il numero di client WS connessi.
func (s *Service) Clients() int {
s.mu.Lock()
defer s.mu.Unlock()
return len(s.clients)
}
// BroadcastStatus invia {"type":"status","payload":<status>} a tutti i client.
func (s *Service) BroadcastStatus(status any) {
buf, err := json.Marshal(envelope{Type: "status", Payload: status})
if err != nil {
return
}
s.mu.Lock()
s.lastSt = buf
conns := make([]*websocket.Conn, 0, len(s.clients))
for c := range s.clients {
conns = append(conns, c)
}
s.mu.Unlock()
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
for _, c := range conns {
_ = c.Write(ctx, websocket.MessageText, buf)
}
}
// --- internals -------------------------------------------------------------
type envelope struct {
Type    string `json:"type"`
Payload any    `json:"payload,omitempty"`
}
func (s *Service) handleWS(w http.ResponseWriter, r *http.Request) {
conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
if err != nil {
return
}
conn.SetReadLimit(readMessageMax)
s.mu.Lock()
if s.stopped {
s.mu.Unlock()
_ = conn.Close(websocket.StatusGoingAway, "shutting down")
return
}
s.clients[conn] = struct{}{}
lastSt := s.lastSt
s.mu.Unlock()
if len(lastSt) > 0 {
ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
_ = conn.Write(ctx, websocket.MessageText, lastSt)
cancel()
}
defer func() {
s.mu.Lock()
delete(s.clients, conn)
s.mu.Unlock()
_ = conn.Close(websocket.StatusNormalClosure, "")
}()
pingCtx, cancelPing := context.WithCancel(r.Context())
defer cancelPing()
go func() {
t := time.NewTicker(pingInterval)
defer t.Stop()
pingBuf, _ := json.Marshal(envelope{Type: "ping"})
for {
select {
case <-pingCtx.Done():
return
case <-t.C:
ctx, cancel := context.WithTimeout(pingCtx, 5*time.Second)
err := conn.Write(ctx, websocket.MessageText, pingBuf)
cancel()
if err != nil {
return
}
}
}
}()
for {
_, data, err := conn.Read(r.Context())
if err != nil {
return
}
s.handleCommand(conn, data)
}
}
func (s *Service) handleCommand(conn *websocket.Conn, data []byte) {
var cmd map[string]any
if err := json.Unmarshal(data, &cmd); err != nil {
return
}
if action, _ := cmd["action"].(string); action == "ping" {
resp, _ := json.Marshal(map[string]any{
"type": "pong", "timestamp": time.Now().UnixMilli(),
})
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
_ = conn.Write(ctx, websocket.MessageText, resp)
cancel()
return
}
wailsevents.Emit(EventRemoteCommand, cmd)
}
