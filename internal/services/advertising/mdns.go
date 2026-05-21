package advertising
import (
	"github.com/grandcat/zeroconf"
)
// mDNSAdvertisedServices elenca i service-type mDNS da annunciare:
// vogliamo che StreamAI appaia come AirPlay-receiver (per device iOS/macOS),
// raop (audio AirPlay), Chromecast e DIAL.
var mDNSAdvertisedServices = []struct{ Type, Domain string }{
	{"_airplay._tcp", "local."},
	{"_raop._tcp", "local."},
	{"_googlecast._tcp", "local."},
	{"_dial._tcp", "local."},
}
func (s *Service) startMDNSLocked() error {
	port := s.httpPort
	if port <= 0 {
		port = 1 // zeroconf richiede port > 0
	}
	text := []string{
		"vendor=StreamAI-IPTV",
		"model=Wails3",
	}
	for _, svc := range mDNSAdvertisedServices {
		srv, err := zeroconf.Register(s.instance, svc.Type, svc.Domain, port, text, nil)
		if err != nil {
			return err
		}
		s.closers = append(s.closers, func() { srv.Shutdown() })
	}
	return nil
}
