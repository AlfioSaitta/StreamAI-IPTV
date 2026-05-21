package discovery
import (
	"context"
	"net/url"
	"strings"
	"time"
	ssdp "github.com/koron/go-ssdp"
)
// searchSSDP esegue M-SEARCH SSDP su 239.255.255.250:1900 con ST=ssdp:all,
// poi per ogni device unico fa il probe TCP delle porte note. Compat con
// main.js -> discoverSsdpDevices.
func searchSSDP(ctx context.Context, timeout time.Duration) ([]Device, error) {
	waitSec := int(timeout / time.Second)
	if waitSec < 1 {
		waitSec = 1
	}
	svcs, err := ssdp.Search("ssdp:all", waitSec, "")
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	devices := make([]Device, 0)
	for _, sv := range svcs {
		ip := hostFromLocation(sv.Location)
		if ip == "" || seen[ip] {
			continue
		}
		seen[ip] = true
		fallback := sv.Server
		if fallback == "" {
			fallback = "UPnP Device (" + ip + ")"
		}
		d := buildDeviceFromIP(ctx, ip, fallback)
		if d == nil {
			continue
		}
		d.Location = sv.Location
		devices = append(devices, *d)
	}
	return devices, nil
}
// hostFromLocation estrae l'host (IPv4) da un LOCATION SSDP (es.
// "http://192.168.1.34:8009/ssdp/device-desc.xml" -> "192.168.1.34").
// Rifiuta hostname non-IP per evitare falsi positivi su DNS pubblici.
func hostFromLocation(location string) string {
	u, err := url.Parse(strings.TrimSpace(location))
	if err != nil || u.Host == "" {
		return ""
	}
	host := u.Hostname()
	// Whitelist solo IPv4 (compat main.js -> isValidIPv4).
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return ""
	}
	for _, p := range parts {
		if len(p) == 0 || len(p) > 3 {
			return ""
		}
		for _, c := range p {
			if c < '0' || c > '9' {
				return ""
			}
		}
	}
	return host
}
