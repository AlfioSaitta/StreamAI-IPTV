package discovery
// Device descrive un dispositivo scoperto in rete. Mantiene la stessa shape
// di main.js -> buildDeviceFromIp() per garantire compat 1-a-1 col frontend
// esistente (vedi types.ts: CastDevice).
type Device struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	Type     string         `json:"type"` // "chromecast" | "smarttv" | "dlna" | "unknown"
	IP       string         `json:"ip"`
	Port     int            `json:"port"`
	Location string         `json:"location,omitempty"` // SSDP LOCATION header
	Services []DeviceService `json:"services"`
}
// DeviceService descrive un singolo endpoint/protocollo trovato.
type DeviceService struct {
	Port     int    `json:"port"`
	Protocol string `json:"protocol"` // "castv2" | "dial" | "dlna" | "airplay"
	Priority int    `json:"priority"`
}
// NetInterface descrive una network interface locale, esposta al frontend.
type NetInterface struct {
	Name     string   `json:"name"`
	Address  string   `json:"address"`  // IPv4 principale
	Netmask  string   `json:"netmask"`
	IsUp     bool     `json:"isUp"`
	IsLoop   bool     `json:"isLoop"`
	Hardware string   `json:"hardware,omitempty"` // MAC
	IPv4     []string `json:"ipv4,omitempty"`
}
// portConfig descrive una porta da probare con il suo protocollo associato.
// Ordine = ordine in main.js -> probeDeviceServices (regressione visiva).
var probePorts = []struct {
	Port     int
	Protocol string
	Priority int
}{
	{Port: 8009, Protocol: "castv2", Priority: 1},
	{Port: 8008, Protocol: "dial", Priority: 3},
	{Port: 9080, Protocol: "dlna", Priority: 4},
	{Port: 8080, Protocol: "dlna", Priority: 5},
	{Port: 7000, Protocol: "airplay", Priority: 7},
}
