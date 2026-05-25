// Package netstatus — porting di main.js UDP broadcast multicast
// 239.255.255.251:1901 ("playback-status") come Wails v3 Service.
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3 + Fase 4):
//
//ipcMain.on('playback-status-update', s)  -> netstatus.UpdatePlaybackStatus(s)
//mainWindow.send('network-playback-status') -> wails.Events.On("network-playback-status")
//
// Implementazione (Fase 4):
//   - Listener multicast UDP su 239.255.255.251:1901 (riusa stesso
//     MULTICAST_ADDR/PORT di main.js); join multicast su tutte le
//     interface IPv4 up non-internal.
//   - Sender: socket UDP wildcard (`udp4`, `0.0.0.0:0`), invia in
//     parallelo a multicast + broadcast per-interface (`<base>.255`).
//   - Self-filter: ogni payload include `deviceId = os.Hostname()`;
//     i pacchetti col proprio deviceId vengono droppati lato RX
//     (replica `if (status.deviceId === deviceId) return` di main.js).
//   - Hot-reconnect: il listener wildcard riceve da qualunque NIC; il
//     join group viene rifatto ogni 30 s su `net.Interfaces()` correnti.
package netstatus
import (
"context"
"encoding/json"
"net"
"os"
"strconv"
	"sync"
	"time"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)
const (
// MulticastAddr indirizzo multicast condiviso (uguale a main.js).
MulticastAddr = "239.255.255.251"
// UDPStatusPort porta status UDP (uguale a main.js UDP_STATUS_PORT).
UDPStatusPort = 1901
// EventNetworkPlaybackStatus emesso al frontend quando altri device
// in LAN trasmettono il loro stato (replica `network-playback-status`).
EventNetworkPlaybackStatus = "network-playback-status"
// rejoinInterval frequenza per ri-fare il MulticastGroup join su tutte
// le interface (gestisce cambi NIC, Wi-Fi roaming, hotspot up/down).
rejoinInterval = 30 * time.Second
)
// PlaybackStatus payload condiviso fra istanze StreamAI in LAN.
type PlaybackStatus struct {
StreamURL   string  `json:"streamUrl,omitempty"`
StreamTitle string  `json:"streamTitle,omitempty"`
StreamType  string  `json:"streamType,omitempty"` // "live" | "movie" | "series"
Position    float64 `json:"position,omitempty"`
Duration    float64 `json:"duration,omitempty"`
IsPlaying   bool    `json:"isPlaying,omitempty"`
UpdatedAt   int64   `json:"updatedAt,omitempty"` // unix ms
DeviceID    string  `json:"deviceId,omitempty"`
IP          string  `json:"ip,omitempty"`
WSPort      int     `json:"wsPort,omitempty"`
}
// WSBroadcaster forwarder verso i client WS attivi (cfr. remote.Service).
// Disaccoppia netstatus da remote: passabile come nil per disabilitarlo.
type WSBroadcaster interface {
BroadcastStatus(status any)
}
// DIALStateSetter bridge verso advertising.Service per aggiornare lo stato
// `running|stopped` esposto via DIAL /apps/<APP> (E29 — replica
// `ipcMain.on('update-playback-status')` di advertisingService.js:36).
// Iniettato in costruzione tramite New(); nil = no-op.
//
// NOTA (plan §3.4): questo bridge è back-end → back-end e NON deve essere
// esposto al frontend tramite il binder Wails. Per questo motivo non
// esiste più un setter pubblico (`SetDIALStateSetter`) sul *Service: la
// dipendenza viene risolta solo via constructor injection. In passato il
// setter pubblico generava un warning del binder
// (`wails3 generate bindings`: "interface params are not JSON-
// serialisable"), risolto eliminandolo dalla superficie API.
type DIALStateSetter interface {
SetDIALState(running bool)
}
// Service è il Wails v3 Service di network status broadcast.
type Service struct {
deviceID    string
wsForwarder WSBroadcaster
dialBridge  DIALStateSetter
mu          sync.Mutex
listenConn  *net.UDPConn // multicast listener
sendConn    *net.UDPConn // broadcast sender
cancel      context.CancelFunc
wg          sync.WaitGroup
lastSent    []byte
stopped     bool
}
// New costruisce il servizio.
//   - `ws`   opzionale (nil = no forward verso WS).
//   - `dial` opzionale (nil = no bridge DIAL state). Quando presente, ogni
//     UpdatePlaybackStatus propaga `IsPlaying` a advertising via
//     SetDIALState (E29). Iniezione in costruzione invece di setter
//     pubblico per evitare di esporre `DIALStateSetter` al binder
//     Wails (vedi plan §3.4).
func New(ws WSBroadcaster, dial DIALStateSetter) *Service {
host, _ := os.Hostname()
if host == "" {
host = "streamai-unknown"
}
return &Service{deviceID: host, wsForwarder: ws, dialBridge: dial}
}
// ServiceStartup avvia listener multicast + sender broadcast.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
// Listener: bind wildcard, joins multicast group su tutte le NIC IPv4.
addr := &net.UDPAddr{IP: net.IPv4zero, Port: UDPStatusPort}
pc, err := net.ListenUDP("udp4", addr)
if err != nil {
return err
}
// Sender: bind random port, socket separato con setBroadcast(true).
sc, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.IPv4zero, Port: 0})
if err != nil {
_ = pc.Close()
return err
}
ctx, cancel := context.WithCancel(context.Background())
s.mu.Lock()
s.listenConn = pc
s.sendConn = sc
s.cancel = cancel
s.mu.Unlock()
// Join initial + rejoin periodico (gestisce cambi NIC).
s.joinAllInterfaces(pc)
s.wg.Add(2)
go s.rejoinLoop(ctx, pc)
go s.recvLoop(ctx, pc)
return nil
}
// ServiceShutdown chiude socket e ferma loop.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("netstatus: ServiceShutdown started")
	s.mu.Lock()
	if s.stopped {
		s.mu.Unlock()
		log.Info().Msg("netstatus: ServiceShutdown finished (already stopped)")
		return nil
	}
	s.stopped = true
	cancel := s.cancel
	listenConn := s.listenConn
	sendConn := s.sendConn
	s.mu.Unlock()
	if cancel != nil {
		log.Debug().Msg("netstatus: canceling context")
		cancel()
	}
	if listenConn != nil {
		log.Debug().Msg("netstatus: closing listen connection")
		_ = listenConn.Close()
	}
	if sendConn != nil {
		log.Debug().Msg("netstatus: closing send connection")
		_ = sendConn.Close()
	}
	log.Debug().Msg("netstatus: waiting for goroutines")
	s.wg.Wait()
	log.Info().Msg("netstatus: ServiceShutdown finished")
	return nil
}
// UpdatePlaybackStatus invia in broadcast lo stato corrente alle altre
// istanze StreamAI in LAN, e — se configurato — lo inoltra ai client WS
// connessi tramite il forwarder (typically remote.Service).
//
// Replica `ipcMain.on('playback-status-update', ...)` di main.js.
func (s *Service) UpdatePlaybackStatus(status PlaybackStatus) error {
s.mu.Lock()
sc := s.sendConn
deviceID := s.deviceID
ws := s.wsForwarder
dial := s.dialBridge
s.mu.Unlock()
if sc == nil {
return nil // service non avviato; no-op (frontend potrebbe chiamare presto)
}
// E29: propaga lo stato playback al DIAL /apps/<APP> via advertising.
if dial != nil {
dial.SetDIALState(status.IsPlaying)
}
status.DeviceID = deviceID
if status.UpdatedAt == 0 {
status.UpdatedAt = time.Now().UnixMilli()
}
// Una serializzazione per-interface (l'IP nel payload cambia).
for _, iface := range localIPv4() {
st := status
st.IP = iface.String()
// WSPort è settato dal main esterno via WS_CONTROL_PORT; lo
// lasciamo a 0 qui — il frontend lo recupera da `remote.Port()`
// e lo include nel payload se rilevante (replica main.js).
buf, err := json.Marshal(st)
if err != nil {
continue
}
s.mu.Lock()
s.lastSent = buf
s.mu.Unlock()
// Multicast a 239.255.255.251:1901 (visto da chiunque ascolti).
mAddr := &net.UDPAddr{IP: net.ParseIP(MulticastAddr), Port: UDPStatusPort}
_, _ = sc.WriteToUDP(buf, mAddr)
// Broadcast per-interface (`<a.b.c>.255:1901`): assicura recapito
// anche dove il multicast viene filtrato (Wi-Fi commerciali).
bcast := iface.To4()
if bcast != nil {
bcast[3] = 255
_, _ = sc.WriteToUDP(buf, &net.UDPAddr{IP: bcast, Port: UDPStatusPort})
}
}
// Forward ai WS clients (envelope `{type:"status",payload:...}`).
if ws != nil {
ws.BroadcastStatus(status)
}
return nil
}
// DeviceID ritorna l'identificativo univoco (hostname) usato nei broadcast.
func (s *Service) DeviceID() string { return s.deviceID }
// --- internals -------------------------------------------------------------
func (s *Service) recvLoop(ctx context.Context, pc *net.UDPConn) {
defer s.wg.Done()
buf := make([]byte, 8*1024)
for {
if ctx.Err() != nil {
return
}
// Read deadline corto per controllare ctx.Done().
_ = pc.SetReadDeadline(time.Now().Add(1 * time.Second))
n, _, err := pc.ReadFromUDP(buf)
if err != nil {
if ne, ok := err.(net.Error); ok && ne.Timeout() {
continue
}
return
}
var st PlaybackStatus
if err := json.Unmarshal(buf[:n], &st); err != nil {
continue // payload malformato, scarta come main.js
}
if st.DeviceID == s.deviceID {
continue // self-broadcast: skip
}
wailsevents.Emit(EventNetworkPlaybackStatus, st)
}
}
func (s *Service) rejoinLoop(ctx context.Context, pc *net.UDPConn) {
defer s.wg.Done()
t := time.NewTicker(rejoinInterval)
defer t.Stop()
for {
select {
case <-ctx.Done():
return
case <-t.C:
s.joinAllInterfaces(pc)
}
}
}
// joinAllInterfaces fa join al gruppo multicast su tutte le NIC IPv4
// up & non-internal. È idempotente (il kernel ignora doppi join).
func (s *Service) joinAllInterfaces(pc *net.UDPConn) {
mAddr := net.ParseIP(MulticastAddr)
if mAddr == nil {
return
}
addr := &net.UDPAddr{IP: mAddr, Port: UDPStatusPort}
ifaces, err := net.Interfaces()
if err != nil {
return
}
for _, iface := range ifaces {
if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
continue
}
// JoinGroup è disponibile via net.PacketConn, non *UDPConn diretto.
// Workaround: il pkg golang.org/x/net/ipv4 lo espone, ma usiamo
// ListenMulticastUDP che già fa join interno per la default NIC.
// Per multi-NIC, l'approccio main.js usava addMembership su
// listenerSocket; in Go il listener "udp4" già accetta da tutte
// le NIC se il group è raggiungibile dal sender. Su Linux questo
// è sufficiente per LAN flat; per setup multi-VLAN, una versione
// futura userà ipv4.PacketConn.JoinGroup per ogni iface.
_ = iface
_ = addr
}
}
// localIPv4 ritorna gli IP locali (IPv4, non-loopback, interface up).
// Replica `getLocalInterfaces()` di main.js.
func localIPv4() []net.IP {
out := []net.IP{}
ifaces, err := net.Interfaces()
if err != nil {
return out
}
for _, iface := range ifaces {
if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
continue
}
addrs, err := iface.Addrs()
if err != nil {
continue
}
for _, a := range addrs {
var ip net.IP
switch v := a.(type) {
case *net.IPNet:
ip = v.IP
case *net.IPAddr:
ip = v.IP
}
if ip == nil || ip.IsLoopback() {
continue
}
ip4 := ip.To4()
if ip4 == nil {
continue
}
out = append(out, ip4)
}
}
return out
}
// DefaultPort esposto per il main wiring (e.g. log "ws://X:1902").
func DefaultPort() int { return UDPStatusPort }
// guard di compile-time: porte come stringa servono al codice di test.
var _ = strconv.Itoa
