// Unit tests for Fase 5 — proxy HTTP locale + header rewrite + TLS skip.
package proxy

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestIsIPTVRequest(t *testing.T) {
	cases := map[string]bool{
		"http://x.tv/live/123.m3u8":           true,
		"http://x.tv/movie/42.mp4":            true,
		"http://x.tv/series/9.mkv":            true,
		"http://x.tv/player_api.php?u=a&p=b":  true,
		"http://x.tv:8080/cmd":                true,
		"http://x.tv:8000/cmd":                true,
		"http://x.tv:25461/cmd":               true,
		"http://x.tv/chunk.ts":                true,
		"https://github.com":                  false,
		"":                                    false,
		"http://example.com/index.html":       false,
	}
	for u, want := range cases {
		if got := IsIPTVRequest(u); got != want {
			t.Errorf("IsIPTVRequest(%q) = %v, want %v", u, got, want)
		}
	}
}

func TestSanitizeURL_Credentials(t *testing.T) {
	u := "http://srv.example/player_api.php?username=alice&password=s3cr3t&action=get_live"
	got := sanitizeURL(u)
	if strings.Contains(got, "s3cr3t") || strings.Contains(got, "alice") {
		t.Errorf("sanitizeURL leaked creds: %s", got)
	}
	if !strings.Contains(got, "username=%2A%2A%2A") && !strings.Contains(got, "username=***") {
		t.Errorf("expected username masked, got: %s", got)
	}
	// userinfo form (http://user:pass@host)
	got2 := sanitizeURL("http://alice:s3cr3t@srv.example/stream.m3u8")
	if strings.Contains(got2, "s3cr3t") {
		t.Errorf("userinfo creds not masked: %s", got2)
	}
}

func TestRewriteRequestHeaders_BaselineIPTV(t *testing.T) {
	orig := httptest.NewRequest("GET", "http://client/stream.m3u8", nil)
	orig.Header.Set("Upgrade-Insecure-Requests", "1")
	orig.Header.Set("Origin", "http://wails")
	orig.Header.Set("Referer", "http://wails/app")
	orig.Header.Set("X-Custom", "keep")

	up := httptest.NewRequest("GET", "http://upstream/", nil)
	rewriteRequestHeaders(up, orig, "MyUA/1.0", map[string]string{
		"Referer": "http://allowed.example/",
		"Cookie":  "sid=xyz",
	})

	if up.Header.Get("User-Agent") != "MyUA/1.0" {
		t.Errorf("UA = %q", up.Header.Get("User-Agent"))
	}
	if up.Header.Get("Upgrade-Insecure-Requests") != "" {
		t.Errorf("Upgrade-Insecure-Requests should be stripped")
	}
	if up.Header.Get("Origin") != "" {
		t.Errorf("Origin should be stripped")
	}
	if up.Header.Get("Referer") != "http://allowed.example/" {
		t.Errorf("Referer override failed: %q", up.Header.Get("Referer"))
	}
	if up.Header.Get("Cookie") != "sid=xyz" {
		t.Errorf("Cookie not set: %q", up.Header.Get("Cookie"))
	}
	if up.Header.Get("X-Custom") != "keep" {
		t.Errorf("X-Custom not preserved")
	}
	if up.Header.Get("Cache-Control") != "no-cache" {
		t.Errorf("Cache-Control missing")
	}
}

func TestRewriteResponseHeaders_StripsCSPAndAddsCORS(t *testing.T) {
	src := http.Header{}
	src.Set("Content-Security-Policy", "frame-src 'none'")
	src.Set("X-Frame-Options", "DENY")
	src.Set("Content-Type", "application/vnd.apple.mpegurl")
	src.Set("Transfer-Encoding", "chunked")
	src.Set("X-Custom", "keep")

	dst := http.Header{}
	rewriteResponseHeaders(dst, src)

	if dst.Get("Content-Security-Policy") != "" {
		t.Errorf("CSP should be stripped")
	}
	if dst.Get("X-Frame-Options") != "" {
		t.Errorf("X-Frame-Options should be stripped")
	}
	if dst.Get("Transfer-Encoding") != "" {
		t.Errorf("hop-by-hop should be stripped")
	}
	if dst.Get("Content-Type") != "application/vnd.apple.mpegurl" {
		t.Errorf("Content-Type lost")
	}
	if dst.Get("X-Custom") != "keep" {
		t.Errorf("X-Custom dropped")
	}
	if dst.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("CORS not added")
	}
}

func TestBuildProxyURL_NotStarted(t *testing.T) {
	s := New()
	_, err := s.BuildProxyURL("http://x.tv/s.m3u8", "", nil)
	if err == nil {
		t.Fatal("expected error when proxy not started")
	}
}

func TestBuildProxyURL_InvalidScheme(t *testing.T) {
	s := New()
	// Forziamo "started" per superare il check di porta
	s.mu.Lock()
	s.started = true
	s.port = 9999
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.started = false
		s.port = 0
		s.mu.Unlock()
	}()
	_, err := s.BuildProxyURL("ftp://nope/", "", nil)
	if err == nil {
		t.Error("expected error on ftp:// scheme")
	}
}

func TestBuildProxyURL_RoundTrip(t *testing.T) {
	s := New()
	s.mu.Lock()
	s.started = true
	s.port = 7777
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.started = false
		s.port = 0
		s.mu.Unlock()
	}()

	stream := "http://srv.example/live/1.m3u8?u=alice&p=s3cr3t"
	headers := map[string]string{"Referer": "http://allowed/", "X-Foo": "bar"}
	got, err := s.BuildProxyURL(stream, "MyUA", headers)
	if err != nil {
		t.Fatalf("BuildProxyURL: %v", err)
	}
	pu, err := url.Parse(got)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if pu.Host != "127.0.0.1:7777" || pu.Path != "/proxy" {
		t.Errorf("bad proxy URL: %s", got)
	}
	rawU := pu.Query().Get("u")
	dec, err := base64.RawURLEncoding.DecodeString(rawU)
	if err != nil {
		t.Fatalf("decode u: %v", err)
	}
	if string(dec) != stream {
		t.Errorf("u decode mismatch: %s", dec)
	}
	if pu.Query().Get("ua") != "MyUA" {
		t.Errorf("ua mismatch")
	}
	rawH := pu.Query().Get("h")
	if rawH == "" {
		t.Fatal("expected h param")
	}
	hb, _ := base64.RawURLEncoding.DecodeString(rawH)
	var hmap map[string]string
	if err := json.Unmarshal(hb, &hmap); err != nil {
		t.Fatalf("h json: %v", err)
	}
	if hmap["Referer"] != "http://allowed/" || hmap["X-Foo"] != "bar" {
		t.Errorf("headers round-trip mismatch: %+v", hmap)
	}
}

// Integration: bring up the proxy + a fake upstream and verify
// end-to-end header rewrite + body pass-through.
func TestProxy_EndToEnd(t *testing.T) {
	// Fake upstream
	upstreamCalls := 0
	var receivedUA, receivedReferer, receivedOrigin string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		receivedUA = r.Header.Get("User-Agent")
		receivedReferer = r.Header.Get("Referer")
		receivedOrigin = r.Header.Get("Origin")
		// Server "ostile" che mette CSP + XFO che il proxy deve strippare.
		w.Header().Set("Content-Security-Policy", "frame-src 'none'")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n"))
	}))
	defer up.Close()

	s := New()
	if err := s.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = s.Stop() }()

	proxyURL, err := s.BuildProxyURL(up.URL+"/live.m3u8", "Custom/9.9",
		map[string]string{"Referer": "http://allowed.example/"})
	if err != nil {
		t.Fatalf("BuildProxyURL: %v", err)
	}

	req, _ := http.NewRequest("GET", proxyURL, nil)
	// Simulate browser headers — devono essere ripuliti dal proxy.
	req.Header.Set("Origin", "http://wails")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("proxy roundtrip: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		t.Errorf("status = %d", resp.StatusCode)
	}
	if !strings.Contains(string(body), "#EXTM3U") {
		t.Errorf("body not forwarded: %q", body)
	}
	if resp.Header.Get("Content-Security-Policy") != "" {
		t.Errorf("CSP not stripped by proxy")
	}
	if resp.Header.Get("X-Frame-Options") != "" {
		t.Errorf("XFO not stripped by proxy")
	}
	if resp.Header.Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("CORS not added by proxy")
	}
	if upstreamCalls != 1 {
		t.Errorf("upstream calls = %d, want 1", upstreamCalls)
	}
	if receivedUA != "Custom/9.9" {
		t.Errorf("upstream UA = %q, want Custom/9.9", receivedUA)
	}
	if receivedReferer != "http://allowed.example/" {
		t.Errorf("upstream Referer = %q", receivedReferer)
	}
	if receivedOrigin != "" {
		t.Errorf("upstream Origin should have been stripped, got %q", receivedOrigin)
	}
}

func TestProxy_LifecycleIdempotent(t *testing.T) {
	s := New()
	if err := s.Start(); err != nil {
		t.Fatalf("first Start: %v", err)
	}
	if err := s.Start(); err != nil {
		t.Fatalf("second Start should be no-op: %v", err)
	}
	p, err := s.Port()
	if err != nil || p <= 0 {
		t.Errorf("Port after Start: %d / %v", p, err)
	}
	if err := s.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if err := s.Stop(); err != nil {
		t.Errorf("double Stop should be no-op: %v", err)
	}
	if _, err := s.Port(); err == nil {
		t.Errorf("Port after Stop should error")
	}
}

func TestProxy_BadParams(t *testing.T) {
	s := New()
	if err := s.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = s.Stop() }()
	port, _ := s.Port()
	base := "http://127.0.0.1:" + itoa(port) + "/proxy"

	cases := []struct {
		name string
		url  string
		want int
	}{
		{"missing u", base, 400},
		{"bad base64", base + "?u=!!!notbase64!!!", 400},
		{"invalid upstream scheme", base + "?u=" + base64.RawURLEncoding.EncodeToString([]byte("ftp://x/")), 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := http.Get(tc.url)
			if err != nil {
				t.Fatalf("GET: %v", err)
			}
			defer func() { _ = resp.Body.Close() }()
			if resp.StatusCode != tc.want {
				t.Errorf("status = %d, want %d", resp.StatusCode, tc.want)
			}
		})
	}
}

func TestProxy_SetInsecure(t *testing.T) {
	s := New()
	s.SetInsecure(true)
	if !s.Insecure() {
		t.Error("expected Insecure() true")
	}
	s.SetInsecure(false)
	if s.Insecure() {
		t.Error("expected Insecure() false")
	}
}

// itoa è una shim locale (no strconv import dedicato).
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

