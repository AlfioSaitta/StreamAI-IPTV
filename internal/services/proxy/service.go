// Package proxy — HTTP proxy locale per riscrivere header IPTV
// (User-Agent custom, strip CSP/X-Frame-Options, CORS *) e — opzionale —
// per saltare la verifica TLS verso provider con certificati invalidi
// (replica `STREAMAI_INSECURE_ELECTRON=1` di main.js).
//
// Sostituisce gli interceptor Electron:
//
//	session.webRequest.onBeforeSendHeaders(...)   → header rewrite request
//	session.webRequest.onHeadersReceived(...)     → header rewrite response
//	session.setCertificateVerifyProc(...)         → TLS skip (insecure mode)
//
// che Wails v3 non espone nativamente (vedi docs/plan-go-wails-migration.md
// §"Fase 5"). Il flusso è:
//
//	frontend  →  Player.Load(streamUrl)
//	          →  proxy.BuildProxyURL(streamUrl, ua, headers)
//	          →  http://127.0.0.1:<port>/proxy?u=<base64url>&ua=<...>&h=<base64json>
//	          →  proxy.handleProxy fa upstream con http.Client custom
//	             (TLS skip opzionale, header rewrite),
//	          →  ritorna body 1:1 + header response sanificati.
package proxy

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// defaultUserAgent replica details.requestHeaders['User-Agent'] = 'StreamAI IPTV'
	// di main.js:291. Override per-request via query string `ua=`.
	defaultUserAgent = "StreamAI IPTV"
	// proxyPath è il path servito dal proxy locale (server TCP standalone).
	proxyPath = "/proxy"
	// AssetMiddlewarePath è il path same-origin servito tramite l'asset
	// server di Wails (vedi `AssetMiddleware`). Il frontend lo usa per
	// evitare il blocco mixed-content/CORS della webview quando fa fetch
	// verso `http://127.0.0.1:<port>` (origine diversa da `wails://`).
	AssetMiddlewarePath = "/iptv-proxy"
	// readHeaderTimeout protegge dal Slowloris (gosec G112).
	readHeaderTimeout = 10 * time.Second
	// dialTimeout per la connessione TCP iniziale upstream.
	dialTimeout = 10 * time.Second
	// tlsHandshakeTimeout per il TLS handshake upstream.
	tlsHandshakeTimeout = 10 * time.Second
	// responseHeaderTimeout per il primo byte di risposta upstream.
	responseHeaderTimeout = 15 * time.Second
)

// hopByHopHeaders (RFC 7230 §6.1) — non propagare end-to-end.
var hopByHopHeaders = []string{
	"Connection",
	"Keep-Alive",
	"Proxy-Authenticate",
	"Proxy-Authorization",
	"Te",
	"Trailer",
	"Transfer-Encoding",
	"Upgrade",
}

// blockedResponseHeaders bloccano la playback IPTV in contesto secure
// (replica main.js:300-304).
var blockedResponseHeaders = []string{
	"Content-Security-Policy",
	"Content-Security-Policy-Report-Only",
	"X-Frame-Options",
}

// Service è il Wails v3 Service del proxy IPTV.
type Service struct {
	mu         sync.RWMutex
	server     *http.Server
	listener   net.Listener
	port       int
	insecure   bool
	httpClient *http.Client
	started    bool
	closers    []func()
}

// New costruisce il Service. Legge env `STREAMAI_INSECURE_PROXY` /
// `STREAMAI_INSECURE_ELECTRON` per abilitare TLS skip globale.
func New() *Service {
	insecure := isEnvTruthy("STREAMAI_INSECURE_PROXY") || isEnvTruthy("STREAMAI_INSECURE_ELECTRON")
	return &Service{
		insecure:   insecure,
		httpClient: buildHTTPClient(insecure),
	}
}

// ServiceStartup lifecycle Wails v3 — bind 127.0.0.1:0 + Serve in goroutine.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return s.Start()
}

// ServiceShutdown lifecycle Wails v3 — teardown.
func (s *Service) ServiceShutdown() error {
	return s.Stop()
}

// Start avvia il proxy. Idempotente.
func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return nil
	}
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("proxy: listen 127.0.0.1:0: %w", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc(proxyPath, s.handleProxy)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: readHeaderTimeout,
	}
	go func() { _ = srv.Serve(ln) }()
	s.server = srv
	s.listener = ln
	s.port = ln.Addr().(*net.TCPAddr).Port
	s.started = true
	s.closers = append(s.closers, func() { _ = srv.Close() })
	log.Printf("proxy: listening on http://127.0.0.1:%d%s (insecure=%v)", s.port, proxyPath, s.insecure)
	return nil
}

// Stop ferma il proxy. Idempotente.
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return nil
	}
	for _, fn := range s.closers {
		fn()
	}
	s.closers = nil
	s.started = false
	s.port = 0
	return nil
}

// Port ritorna la porta locale del proxy.
func (s *Service) Port() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.started {
		return 0, errors.New("proxy: not started")
	}
	return s.port, nil
}

// Insecure indica se il proxy salta la verifica TLS.
func (s *Service) Insecure() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.insecure
}

// SetInsecure abilita/disabilita TLS skip a runtime.
func (s *Service) SetInsecure(insecure bool) {
	s.mu.Lock()
	s.insecure = insecure
	s.httpClient = buildHTTPClient(insecure)
	s.mu.Unlock()
}

// AssetMiddleware ritorna un middleware HTTP che intercetta le richieste a
// `AssetMiddlewarePath` (`/iptv-proxy`) e le inoltra all'handler proxy IPTV,
// lasciando passare tutto il resto al `next` handler (asset server Vite/embed).
//
// Razionale: la webview di Wails (WebKitGTK/WebView2/WKWebView) blocca le
// fetch cross-origin dal documento (`wails://wails.localhost`) verso un
// server HTTP standalone su `127.0.0.1:<port>` per mixed-content / CORS,
// anche se quest'ultimo risponde con `Access-Control-Allow-Origin: *`.
// Esponendo il proxy come middleware dell'asset server otteniamo un endpoint
// **same-origin** che la webview accetta senza vincoli.
func (s *Service) AssetMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == AssetMiddlewarePath {
				s.handleProxy(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// BuildProxyURL costruisce l'URL locale che il player deve usare al
// posto dello stream originale.
func (s *Service) BuildProxyURL(streamURL, userAgent string, headers map[string]string) (string, error) {
	if streamURL == "" {
		return "", errors.New("proxy: streamURL is empty")
	}
	pu, err := url.Parse(streamURL)
	if err != nil {
		return "", fmt.Errorf("proxy: invalid streamURL: %w", err)
	}
	if pu.Scheme != "http" && pu.Scheme != "https" {
		return "", fmt.Errorf("proxy: unsupported scheme %q", pu.Scheme)
	}
	s.mu.RLock()
	port := s.port
	started := s.started
	s.mu.RUnlock()
	if !started || port == 0 {
		return "", errors.New("proxy: not started")
	}
	q := url.Values{}
	q.Set("u", base64.RawURLEncoding.EncodeToString([]byte(streamURL)))
	if userAgent != "" {
		q.Set("ua", userAgent)
	}
	if len(headers) > 0 {
		hb, err := json.Marshal(headers)
		if err != nil {
			return "", fmt.Errorf("proxy: marshal headers: %w", err)
		}
		q.Set("h", base64.RawURLEncoding.EncodeToString(hb))
	}
	return fmt.Sprintf("http://127.0.0.1:%d%s?%s", port, proxyPath, q.Encode()), nil
}

// handleProxy è il core del proxy.
func (s *Service) handleProxy(w http.ResponseWriter, r *http.Request) {
	rawU := r.URL.Query().Get("u")
	if rawU == "" {
		http.Error(w, "missing u", http.StatusBadRequest)
		return
	}
	dec, err := base64.RawURLEncoding.DecodeString(rawU)
	if err != nil {
		http.Error(w, "bad u encoding", http.StatusBadRequest)
		return
	}
	upstreamURL := string(dec)
	pu, err := url.Parse(upstreamURL)
	if err != nil || (pu.Scheme != "http" && pu.Scheme != "https") {
		http.Error(w, "invalid upstream url", http.StatusBadRequest)
		return
	}

	ua := r.URL.Query().Get("ua")
	if ua == "" {
		ua = defaultUserAgent
	}
	extraHeaders := map[string]string{}
	if rawH := r.URL.Query().Get("h"); rawH != "" {
		if hb, herr := base64.RawURLEncoding.DecodeString(rawH); herr == nil {
			_ = json.Unmarshal(hb, &extraHeaders)
		}
	}

	ctx := r.Context()
	upstreamReq, err := http.NewRequestWithContext(ctx, r.Method, upstreamURL, r.Body)
	if err != nil {
		http.Error(w, "upstream request build failed", http.StatusBadGateway)
		return
	}
	rewriteRequestHeaders(upstreamReq, r, ua, extraHeaders)

	s.mu.RLock()
	client := s.httpClient
	s.mu.RUnlock()

	resp, err := client.Do(upstreamReq)
	if err != nil {
		log.Printf("proxy: upstream failed %s: %v", sanitizeURL(upstreamURL), err)
		http.Error(w, "upstream unreachable", http.StatusBadGateway)
		return
	}
	defer func() { _ = resp.Body.Close() }()

	rewriteResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil && !errors.Is(err, context.Canceled) {
		log.Printf("proxy: copy body %s: %v", sanitizeURL(upstreamURL), err)
	}
}

// rewriteRequestHeaders applica i rewrite di main.js:286-294.
func rewriteRequestHeaders(up *http.Request, orig *http.Request, ua string, extra map[string]string) {
	for k, vv := range orig.Header {
		if isHopByHop(k) || strings.EqualFold(k, "Host") {
			continue
		}
		for _, v := range vv {
			up.Header.Add(k, v)
		}
	}
	up.Header.Del("Upgrade-Insecure-Requests")
	up.Header.Del("Origin")
	up.Header.Del("Referer")
	up.Header.Set("User-Agent", ua)
	up.Header.Set("Accept", "*/*")
	up.Header.Set("Cache-Control", "no-cache")
	up.Header.Set("Pragma", "no-cache")
	for k, v := range extra {
		up.Header.Set(k, v)
	}
}

// rewriteResponseHeaders strippa hop-by-hop + blocked + aggiunge CORS.
func rewriteResponseHeaders(dst, src http.Header) {
	for k, vv := range src {
		if isHopByHop(k) || isBlockedResponse(k) {
			continue
		}
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
	dst.Set("Access-Control-Allow-Origin", "*")
	dst.Set("Access-Control-Allow-Headers", "*")
	dst.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
}

func isHopByHop(h string) bool {
	for _, hh := range hopByHopHeaders {
		if strings.EqualFold(h, hh) {
			return true
		}
	}
	return false
}

func isBlockedResponse(h string) bool {
	for _, b := range blockedResponseHeaders {
		if strings.EqualFold(h, b) {
			return true
		}
	}
	return false
}

func buildHTTPClient(insecure bool) *http.Client {
	tr := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   dialTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   tlsHandshakeTimeout,
		ResponseHeaderTimeout: responseHeaderTimeout,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          50,
		IdleConnTimeout:       60 * time.Second,
		// gosec G402: InsecureSkipVerify abilitato solo quando l'utente
		// ha esplicitamente attivato lo "Insecure mode" (env o toggle UI).
		TLSClientConfig: &tls.Config{InsecureSkipVerify: insecure}, //nolint:gosec
	}
	return &http.Client{
		Transport: tr,
		// 0 = no timeout sulla richiesta complessiva: gli stream live sono
		// long-running; il caller chiude la connessione quando il client
		// downstream se ne va (context cancellation propagato via ctx).
		Timeout: 0,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("proxy: too many redirects (>10)")
			}
			return nil
		},
	}
}

// sanitizeURL maschera credenziali Xtream per log non leakable.
func sanitizeURL(u string) string {
	parsed, err := url.Parse(u)
	if err != nil {
		return "[unparseable]"
	}
	q := parsed.Query()
	for _, k := range []string{"username", "password", "pwd", "token"} {
		if q.Has(k) {
			q.Set(k, "***")
		}
	}
	parsed.RawQuery = q.Encode()
	if parsed.User != nil {
		parsed.User = url.UserPassword("***", "***")
	}
	return parsed.String()
}

// IsIPTVRequest replica isIptvRequest di main.js:15-19.
func IsIPTVRequest(u string) bool {
	if u == "" {
		return false
	}
	low := strings.ToLower(u)
	return strings.Contains(low, ".m3u8") ||
		strings.Contains(low, ".ts") ||
		strings.Contains(low, "/live/") ||
		strings.Contains(low, "/movie/") ||
		strings.Contains(low, "/series/") ||
		strings.Contains(low, "player_api.php") ||
		strings.Contains(low, ":8080") ||
		strings.Contains(low, ":8000") ||
		strings.Contains(low, ":25461")
}

func isEnvTruthy(name string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

