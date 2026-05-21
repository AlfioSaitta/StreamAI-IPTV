// Package discovery — porting di main.js (discoverSsdpDevices / scanSubnet /
// probeDeviceServices) come Wails v3 Service.
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3):
//
//	electronAPI.discoverDevices()       -> DiscoveryService.DiscoverDevices()
//	electronAPI.getLocalIPs()           -> DiscoveryService.GetLocalIPs()
//	electronAPI.scanIp(ip)              -> DiscoveryService.ScanIP(ip)
//	electronAPI.probeDeviceServices(ip) -> DiscoveryService.ProbeDeviceServices(ip)
//	electronAPI.onDeviceFound(cb)       -> wails.Events.On("device-found", cb)
//
// Implementazione (Fase 2):
//   - SSDP M-SEARCH via github.com/koron/go-ssdp
//   - mDNS browse via github.com/grandcat/zeroconf
//   - Subnet scan TCP con goroutine pool
package discovery
import (
	"context"
	"sync"
	"time"
)
const (
	// EventDeviceFound nome canale Wails per streaming dei device trovati.
	EventDeviceFound = "device-found"
	// SSDPSearchTimeout durata massima dell'M-SEARCH UDP (uguale a main.js).
	SSDPSearchTimeout = 2500 * time.Millisecond
	// SubnetScanConcurrency numero di goroutine concorrenti per /24 scan.
	SubnetScanConcurrency = 24
	// TCPProbeTimeout per ogni probe TCP (matcha main.js TCP_PROBE_TIMEOUT_MS).
	TCPProbeTimeout = 600 * time.Millisecond
)
// Service e' il Wails v3 Service di discovery.
type Service struct {
	// scanMu evita scan concorrenti sovrapposti (UI-protezione).
	scanMu sync.Mutex
}
// New costruisce il servizio.
func New() *Service { return &Service{} }
// DiscoverDevices lancia in parallelo SSDP M-SEARCH + scan sottoreti /24 di
// tutte le interface locali up; deduplica per IP. Emette eventi
// "device-found" via wailsevents.Emit per ogni nuovo device.
//
// Ritorna l'elenco aggregato dopo SSDPSearchTimeout + completion del scan.
func (s *Service) DiscoverDevices() ([]Device, error) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), SSDPSearchTimeout+5*time.Second)
	defer cancel()
	seen := newDeviceSet()
	// SSDP M-SEARCH
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		devices, err := searchSSDP(ctx, SSDPSearchTimeout)
		if err != nil {
			return
		}
		for _, d := range devices {
			seen.addAndEmit(d)
		}
	}()
	// Subnet scan su tutte le interface up
	ifaces, err := localSubnetBases()
	if err == nil {
		for _, base := range ifaces {
			wg.Add(1)
			go func(b string) {
				defer wg.Done()
				for _, d := range scanSubnet(ctx, b, 254, SubnetScanConcurrency) {
					seen.addAndEmit(d)
				}
			}(base)
		}
	}
	wg.Wait()
	return seen.values(), nil
}
// ScanIP fa probe di un singolo host (porte 8009/8008/9080/8080/7000) e
// ritorna 0..1 device. Mantiene la stessa shape di main.js -> scanIp(target).
func (s *Service) ScanIP(target string) ([]Device, error) {
	d := buildDeviceFromIP(context.Background(), target, "")
	if d == nil {
		return []Device{}, nil
	}
	return []Device{*d}, nil
}
// ProbeDeviceServices ritorna l'elenco di protocolli (stringhe) trovati su un
// host. Wrapper compat per electronAPI.probeDeviceServices(ip).
func (s *Service) ProbeDeviceServices(ip string) ([]string, error) {
	services := probeDeviceServices(context.Background(), ip)
	protos := make([]string, 0, len(services))
	for _, s := range services {
		protos = append(protos, s.Protocol)
	}
	return protos, nil
}
// deviceSet e' uno set thread-safe per IP che emette anche l'evento Wails.
type deviceSet struct {
	mu      sync.Mutex
	byIP    map[string]Device
}
func newDeviceSet() *deviceSet { return &deviceSet{byIP: map[string]Device{}} }
func (s *deviceSet) addAndEmit(d Device) {
	s.mu.Lock()
	_, exists := s.byIP[d.IP]
	if !exists {
		s.byIP[d.IP] = d
	}
	s.mu.Unlock()
	if !exists {
		emitDeviceFound(d)
	}
}
func (s *deviceSet) values() []Device {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Device, 0, len(s.byIP))
	for _, d := range s.byIP {
		out = append(out, d)
	}
	return out
}
