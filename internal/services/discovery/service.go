// Package discovery — porting di main.js (discoverSsdpDevices / scanSubnet /
// probeDeviceServices) come Wails v3 Service.
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3):
//
//electronAPI.discoverDevices()       -> DiscoveryService.DiscoverDevices()
//electronAPI.getLocalIPs()           -> DiscoveryService.GetLocalIPs()
//electronAPI.scanIp(ip)              -> DiscoveryService.ScanIP(ip)
//electronAPI.probeDeviceServices(ip) -> DiscoveryService.ProbeDeviceServices(ip)
//electronAPI.onDeviceFound(cb)       -> wails.Events.On("device-found", cb)
//
// Implementazione attesa (Fase 2):
//   - SSDP via github.com/koron/go-ssdp
//   - mDNS via github.com/grandcat/zeroconf
//   - Subnet scan TCP con goroutine pool + semaforo
package discovery
import "errors"
// Device descrive un dispositivo scoperto in rete (Chromecast, DLNA, AirPlay, DIAL).
type Device struct {
	ID         string            `json:"id"`
	Name       string            `json:"name"`
	Type       string            `json:"type"` // "chromecast" | "dlna" | "airplay" | "dial"
	Host       string            `json:"host"`
	Port       int               `json:"port"`
	Properties map[string]string `json:"properties,omitempty"`
}
// NetInterface descrive una network interface locale.
type NetInterface struct {
	Name     string   `json:"name"`
	Address  string   `json:"address"`
	Netmask  string   `json:"netmask"`
	IsUp     bool     `json:"isUp"`
	IsLoop   bool     `json:"isLoop"`
	Hardware string   `json:"hardware,omitempty"`
	IPv4     []string `json:"ipv4,omitempty"`
}
// Service e' il Wails v3 Service di discovery.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("discovery: not implemented yet (plan sez. 6 Fase 2)")
// DiscoverDevices lancia SSDP + mDNS + subnet scan; emette eventi "device-found".
func (s *Service) DiscoverDevices() ([]Device, error) { return nil, errNotImpl }
// GetLocalIPs ritorna le interface di rete locali per scan.
func (s *Service) GetLocalIPs() ([]NetInterface, error) { return nil, errNotImpl }
// ScanIP fa probe di un singolo host (porte 8009/7000/1900/8060).
func (s *Service) ScanIP(target string) ([]Device, error) { return nil, errNotImpl }
// ProbeDeviceServices fa probe di CastV2/AirPlay-RAOP/DIAL REST.
func (s *Service) ProbeDeviceServices(ip string) ([]string, error) { return nil, errNotImpl }
