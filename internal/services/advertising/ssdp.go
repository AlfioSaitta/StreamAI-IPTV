package advertising
import (
	"fmt"
	ssdp "github.com/koron/go-ssdp"
)
// startSSDPLocked annuncia l'app come DLNA MediaRenderer:1 + DIAL service.
// La LOCATION URL punta al device descriptor XML servito dal DIAL HTTP
// receiver (Fase 2-bis). Fallback a s.httpPort se DIAL HTTP non e' partito.
func (s *Service) startSSDPLocked() error {
	port := s.actualHTTPPort
	if port <= 0 {
		port = s.httpPort
	}
	if port <= 0 {
		return fmt.Errorf("advertising: SSDP requires DIAL HTTP server or httpPort > 0")
	}
	host := s.advertisedHost()
	location := fmt.Sprintf("http://%s:%d/dial.xml", host, port)
	serverID := "StreamAI/2.0 UPnP/1.0"
	maxAge := 1800
	advs := []struct{ ST, USN string }{
		{"urn:schemas-upnp-org:device:MediaRenderer:1", fmt.Sprintf("uuid:streamai-%s::urn:schemas-upnp-org:device:MediaRenderer:1", s.instance)},
		{"urn:dial-multiscreen-org:device:dial:1", fmt.Sprintf("uuid:streamai-%s::urn:dial-multiscreen-org:device:dial:1", s.instance)},
	}
	for _, a := range advs {
		adv, err := ssdp.Advertise(a.ST, a.USN, location, serverID, maxAge)
		if err != nil {
			return err
		}
		s.closers = append(s.closers, func() { _ = adv.Close() })
	}
	return nil
}
