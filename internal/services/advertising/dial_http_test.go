// Unit tests for Fase 2-bis DIAL HTTP receiver.
// Covers gap E28+E29 (vedi docs/plan-go-wails-migration.md §"Fase 2-bis").
package advertising

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	s := New()
	s.appVersion = "1.2.3"
	s.actualHTTPPort = 8090
	return s
}

func TestHandleDialXML_Rendering(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/dial.xml", nil)
	s.handleDialXML(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/xml" {
		t.Errorf("Content-Type = %q, want application/xml", ct)
	}
	if app := rr.Header().Get("Application-URL"); !strings.HasSuffix(app, ":8090/apps/") {
		t.Errorf("Application-URL = %q, want suffix :8090/apps/", app)
	}
	body := rr.Body.String()
	for _, must := range []string{
		`<deviceType>urn:schemas-upnp-org:device:dial:1</deviceType>`,
		`<friendlyName>StreamAI IPTV</friendlyName>`,
		`<modelName>StreamAI Desktop Player</modelName>`,
		`<UDN>uuid:streamai-1.2.3</UDN>`,
		`<application-URL>`,
	} {
		if !strings.Contains(body, must) {
			t.Errorf("dial.xml missing %q\n--- body ---\n%s", must, body)
		}
	}
	// XML safety: no unescaped angle brackets injected (statici, ma guard).
	if strings.Contains(body, "<script") {
		t.Errorf("dial.xml contains <script — XSL injection?")
	}
}

func TestHandleDialApp_StateStopped(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/apps/StreamAI%20IPTV", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "<state>stopped</state>") {
		t.Errorf("expected stopped state, got: %s", rr.Body.String())
	}
}

func TestHandleDialApp_StateRunning(t *testing.T) {
	s := newTestService(t)
	s.SetDIALState(true)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/apps/StreamAI%20IPTV", nil)
	s.handleDialApp(rr, req)
	if !strings.Contains(rr.Body.String(), "<state>running</state>") {
		t.Errorf("expected running state, got: %s", rr.Body.String())
	}
}

func TestHandleDialApp_URLEncodedPath(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	// Path già decodificato da net/http (URL.Path); il decode addizionale
	// in handler gestisce client che lasciano `%20` letterale.
	req := httptest.NewRequest(http.MethodGet, "/apps/StreamAI%20IPTV", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 for url-encoded path, got %d", rr.Code)
	}
}

func TestHandleDialApp_TrailingSlash(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/apps/StreamAI%20IPTV/", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("trailing slash must work, got %d", rr.Code)
	}
}

func TestHandleDialApp_UnknownApp_404(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/apps/YouTube", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404 for unknown app, got %d", rr.Code)
	}
}

func TestHandleDialApp_PostLaunch_201(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	body := bytes.NewBufferString("http://example.com/stream.m3u8")
	req := httptest.NewRequest(http.MethodPost, "/apps/StreamAI%20IPTV", body)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rr.Code)
	}
	if loc := rr.Header().Get("Location"); loc == "" {
		t.Error("expected Location header")
	}
}

func TestHandleDialApp_DeleteStop_200(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/apps/StreamAI%20IPTV", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("DELETE (DIAL stop) expected 200, got %d", rr.Code)
	}
}

func TestHandleDialApp_MethodNotAllowed(t *testing.T) {
	s := newTestService(t)
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/apps/StreamAI%20IPTV", nil)
	s.handleDialApp(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("PUT expected 405, got %d", rr.Code)
	}
}

func TestExtractDialURL(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		contentType string
		want        string
	}{
		{"raw URL", "http://example.com/s.m3u8", "text/plain", "http://example.com/s.m3u8"},
		{"https raw", "https://example.com/s.mpd", "", "https://example.com/s.mpd"},
		{"JSON url", `{"url":"http://ex.com/a.ts"}`, "application/json", "http://ex.com/a.ts"},
		{"JSON sniffed", `{"url":"http://ex.com/b"}`, "", "http://ex.com/b"},
		{"form v=", "v=http://ex.com/c.m3u8&foo=bar", "application/x-www-form-urlencoded", "http://ex.com/c.m3u8"},
		{"form url=", "url=http://ex.com/d.mpd", "application/x-www-form-urlencoded", "http://ex.com/d.mpd"},
		{"form src=", "src=http://ex.com/e.ts", "", "http://ex.com/e.ts"},
		{"empty", "", "", ""},
		{"garbage", "lololol", "", ""},
		{"JSON no url field", `{"foo":"bar"}`, "application/json", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := extractDialURL([]byte(tc.body), tc.contentType)
			if got != tc.want {
				t.Errorf("extractDialURL(%q, %q) = %q, want %q", tc.body, tc.contentType, got, tc.want)
			}
		})
	}
}

func TestSetDIALState_Idempotent(t *testing.T) {
	s := newTestService(t)
	s.SetDIALState(true)
	s.SetDIALState(true)
	if !s.dialState.running.Load() {
		t.Error("state should remain true after double-set")
	}
	s.SetDIALState(false)
	if s.dialState.running.Load() {
		t.Error("state should be false after reset")
	}
}

func TestAdvertisedHost_FallbackLoopback(t *testing.T) {
	s := newTestService(t)
	// Non possiamo forzare "no interfaces" senza mockare net.Interfaces;
	// ci basta verificare che la funzione non crashi e ritorni un IPv4.
	host := s.advertisedHost()
	if host == "" {
		t.Fatal("advertisedHost returned empty")
	}
	// IPv4 dotted-quad o 127.0.0.1.
	if strings.Count(host, ".") != 3 {
		t.Errorf("advertisedHost = %q, expected IPv4 dotted-quad", host)
	}
}

func TestDialHTTPServer_Lifecycle(t *testing.T) {
	// Avvio del listener reale su porta 8090..8094. Skip se nessuna porta
	// libera (CI parallela): il test e' best-effort.
	s := New()
	s.appVersion = "test"
	s.mu.Lock()
	err := s.startDIALHTTPLocked()
	if err != nil {
		s.mu.Unlock()
		t.Skipf("DIAL HTTP listen not available in this env: %v", err)
	}
	port := s.actualHTTPPort
	s.mu.Unlock()
	defer func() {
		for _, c := range s.closers {
			c()
		}
	}()

	// GET /dial.xml end-to-end.
	resp, err := http.Get("http://127.0.0.1:" + itoa(port) + "/dial.xml")
	if err != nil {
		t.Fatalf("GET /dial.xml: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 {
		t.Errorf("expected 200, got %d", resp.StatusCode)
	}
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(b), "StreamAI IPTV") {
		t.Errorf("body missing app name: %s", string(b))
	}
}

func TestServiceStartupShutdown_Lifecycle(t *testing.T) {
	// Verifica che ServiceStartup/ServiceShutdown siano idempotenti e
	// non blocchino anche quando mDNS/SSDP falliscono (es. CI senza
	// multicast socket).
	s := New()
	s.SetAppVersion("test")
	if err := s.ServiceStartup(nil, application.ServiceOptions{}); err != nil { //nolint:staticcheck
		t.Fatalf("ServiceStartup unexpected error: %v", err)
	}
	// Doppio Start = no-op
	if err := s.Start(); err != nil {
		t.Fatalf("double Start should be idempotent: %v", err)
	}
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown error: %v", err)
	}
	// Doppio Stop = no-op
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("double ServiceShutdown should be idempotent: %v", err)
	}
}

// itoa è una shim locale per evitare di importare strconv solo qui.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	n := len(buf)
	for i > 0 {
		n--
		buf[n] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		n--
		buf[n] = '-'
	}
	return string(buf[n:])
}
