package discovery
import (
	"context"
	"time"
	"github.com/grandcat/zeroconf"
)
// mDNSServiceTypes elenca i service-type mDNS interessanti per IPTV/streaming.
// Lista derivata dal mix di servizi annunciati da Chromecast (_googlecast._tcp),
// AirPlay (_airplay._tcp, _raop._tcp) e DIAL (_dial._tcp).
var mDNSServiceTypes = []string{
	"_googlecast._tcp",
	"_airplay._tcp",
	"_raop._tcp",
	"_dial._tcp",
	"_dlna._tcp", // raro ma presente su alcuni renderer
}
// browseMDNS interroga il network locale per servizi mDNS interessanti.
// Per ogni risposta valida fa il probe TCP per costruire il Device.
//
// Nota: usato come *complemento* a SSDP/subnet scan, non come sostituto.
// Alcuni device Chromecast moderni rispondono solo via mDNS (no SSDP).
func browseMDNS(ctx context.Context, timeout time.Duration) []Device {
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		return nil
	}
	entries := make(chan *zeroconf.ServiceEntry, 32)
	browseCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	for _, svc := range mDNSServiceTypes {
		go func(s string) {
			_ = resolver.Browse(browseCtx, s, "local.", entries)
		}(svc)
	}
	seen := map[string]bool{}
	out := make([]Device, 0)
	for {
		select {
		case entry, ok := <-entries:
			if !ok {
				return out
			}
			if entry == nil || len(entry.AddrIPv4) == 0 {
				continue
			}
			ip := entry.AddrIPv4[0].String()
			if seen[ip] {
				continue
			}
			seen[ip] = true
			fallback := entry.Instance
			d := buildDeviceFromIP(ctx, ip, fallback)
			if d != nil {
				out = append(out, *d)
			}
		case <-browseCtx.Done():
			return out
		}
	}
}
