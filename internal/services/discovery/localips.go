package discovery
import (
	"net"
	"strings"
)
// GetLocalIPs ritorna le interface di rete locali (escludendo loopback e
// interface DOWN). Mantiene la shape attesa da services/deviceDiscovery.ts.
func (s *Service) GetLocalIPs() ([]NetInterface, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	out := make([]NetInterface, 0, len(ifaces))
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		isUp := iface.Flags&net.FlagUp != 0
		isLoop := iface.Flags&net.FlagLoopback != 0
		var primaryV4 string
		var netmask string
		ipv4 := []string{}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			v4 := ipnet.IP.To4()
			if v4 == nil {
				continue
			}
			addrStr := v4.String()
			ipv4 = append(ipv4, addrStr)
			if primaryV4 == "" {
				primaryV4 = addrStr
				netmask = net.IP(ipnet.Mask).String()
			}
		}
		if len(ipv4) == 0 {
			continue
		}
		out = append(out, NetInterface{
			Name:     iface.Name,
			Address:  primaryV4,
			Netmask:  netmask,
			IsUp:     isUp,
			IsLoop:   isLoop,
			Hardware: iface.HardwareAddr.String(),
			IPv4:     ipv4,
		})
	}
	return out, nil
}
// localSubnetBases ritorna le base /24 (es. "192.168.1") per ogni interface
// up, non loopback, con IPv4 valida — input per scanSubnet.
func localSubnetBases() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	bases := make([]string, 0)
	seen := map[string]struct{}{}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			v4 := ipnet.IP.To4()
			if v4 == nil {
				continue
			}
			parts := strings.Split(v4.String(), ".")
			if len(parts) != 4 {
				continue
			}
			base := strings.Join(parts[:3], ".")
			if _, ok := seen[base]; ok {
				continue
			}
			seen[base] = struct{}{}
			bases = append(bases, base)
		}
	}
	return bases, nil
}
