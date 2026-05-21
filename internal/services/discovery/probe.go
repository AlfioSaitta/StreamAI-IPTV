package discovery
import (
	"context"
	"fmt"
	"net"
	"sort"
	"strings"
	"sync"
	"time"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)
// probeTCP fa una connect TCP non-bloccante con timeout. Equivalente a
// main.js -> probeTcp(ip, port).
func probeTCP(ctx context.Context, ip string, port int, timeout time.Duration) bool {
	if net.ParseIP(ip) == nil {
		return false
	}
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", fmt.Sprintf("%s:%d", ip, port))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
// probeDeviceServices probe in parallelo le porte note e ritorna i servizi
// disponibili, ordinati per priorita' (stesso ordine di main.js).
func probeDeviceServices(ctx context.Context, ip string) []DeviceService {
	if net.ParseIP(ip) == nil {
		return nil
	}
	results := make([]DeviceService, 0, len(probePorts))
	resMu := sync.Mutex{}
	var wg sync.WaitGroup
	for _, cfg := range probePorts {
		wg.Add(1)
		go func(port int, protocol string, priority int) {
			defer wg.Done()
			if probeTCP(ctx, ip, port, TCPProbeTimeout) {
				resMu.Lock()
				results = append(results, DeviceService{Port: port, Protocol: protocol, Priority: priority})
				resMu.Unlock()
			}
		}(cfg.Port, cfg.Protocol, cfg.Priority)
	}
	wg.Wait()
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].Priority < results[j].Priority
	})
	return results
}
// classifyDevice deriva il "type" del dispositivo dai protocolli rilevati.
// Compat 1-a-1 con main.js -> classifyDevice.
func classifyDevice(services []DeviceService) string {
	for _, s := range services {
		if s.Protocol == "castv2" {
			return "chromecast"
		}
	}
	for _, s := range services {
		if s.Protocol == "airplay" {
			return "smarttv"
		}
	}
	for _, s := range services {
		if s.Protocol == "dlna" {
			return "dlna"
		}
	}
	return "unknown"
}
// buildDeviceFromIP fa probe del device e costruisce la struct Device; ritorna
// nil se nessun servizio risponde. Equivalente a main.js -> buildDeviceFromIp.
func buildDeviceFromIP(ctx context.Context, ip, fallbackName string) *Device {
	services := probeDeviceServices(ctx, ip)
	if len(services) == 0 {
		return nil
	}
	type_ := classifyDevice(services)
	primary := services[0]
	name := fallbackName
	if name == "" {
		switch type_ {
		case "chromecast":
			name = fmt.Sprintf("Chromecast (%s)", ip)
		case "dlna":
			name = fmt.Sprintf("DLNA Renderer (%s)", ip)
		default:
			name = fmt.Sprintf("Dispositivo (%s)", ip)
		}
	}
	ids := make([]string, 0, len(services))
	for _, s := range services {
		ids = append(ids, fmt.Sprintf("%s-%d", s.Protocol, s.Port))
	}
	return &Device{
		ID:       fmt.Sprintf("%s:%s", ip, strings.Join(ids, "-")),
		Name:     name,
		Type:     type_,
		IP:       ip,
		Port:     primary.Port,
		Services: services,
	}
}
// emitDeviceFound emette l'evento Wails "device-found" verso il frontend.
func emitDeviceFound(d Device) {
	wailsevents.Emit(EventDeviceFound, d)
}
