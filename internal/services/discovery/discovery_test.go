package discovery
import (
	"testing"
)
func TestClassifyDevice(t *testing.T) {
	cases := []struct {
		name    string
		in      []DeviceService
		wantTyp string
	}{
		{"chromecast wins over dial", []DeviceService{{Protocol: "dial"}, {Protocol: "castv2"}}, "chromecast"},
		{"airplay -> smarttv", []DeviceService{{Protocol: "airplay"}}, "smarttv"},
		{"dlna fallback", []DeviceService{{Protocol: "dlna"}, {Protocol: "dial"}}, "dlna"},
		{"empty", nil, "unknown"},
		{"unknown only", []DeviceService{{Protocol: "ssh"}}, "unknown"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyDevice(tc.in)
			if got != tc.wantTyp {
				t.Fatalf("classifyDevice(%v) = %q, want %q", tc.in, got, tc.wantTyp)
			}
		})
	}
}
func TestHostFromLocation(t *testing.T) {
	cases := map[string]string{
		"http://192.168.1.34:8009/ssdp/device-desc.xml":           "192.168.1.34",
		"https://10.0.0.5/desc.xml":                                "10.0.0.5",
		"http://example.com:1900/desc.xml":                         "",
		"  http://172.16.5.42:1234/x ":                             "172.16.5.42",
		"":                                                         "",
		"::1":                                                      "",
	}
	for in, want := range cases {
		if got := hostFromLocation(in); got != want {
			t.Errorf("hostFromLocation(%q) = %q, want %q", in, got, want)
		}
	}
}
func TestGetLocalIPsReturnsAtLeastOne(t *testing.T) {
	s := New()
	ifaces, err := s.GetLocalIPs()
	if err != nil {
		t.Fatal(err)
	}
	if len(ifaces) == 0 {
		t.Skip("no IPv4 interfaces (sandboxed env?)")
	}
	for _, i := range ifaces {
		if i.Address == "" {
			t.Errorf("interface %s has empty address", i.Name)
		}
	}
}
