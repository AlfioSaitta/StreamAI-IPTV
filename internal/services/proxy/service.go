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
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
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

// bufferPool riutilizza i buffer per io.Copy, riducendo le allocazioni e il GC.
var bufferPool = &sync.Pool{
	New: func() interface{} {
		// Un buffer da 32KB è un buon compromesso per lo streaming.
		buffer := make([]byte, 32*1024)
		return &buffer
	},
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
	// imageCache è la cache su disco delle immagini (vedi imagecache.go).
	// Condivisa fra profili, quindi la chiave è l'URL upstream. Nil se non è
	// stato possibile prepararla: il proxy funziona lo stesso.
	imageCache *imageCache
}

// imageCacheRef legge la cache sotto lock: viene assegnata all'avvio, ma le
// richieste possono arrivare mentre il servizio si sta ancora inizializzando.
func (s *Service) imageCacheRef() *imageCache {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.imageCache
}

// initImageCache prepara la cache immagini su disco.
//
// Best-effort per scelta: se la directory di sistema non è disponibile o non è
// scrivibile, il proxy deve continuare a funzionare come prima — una cache non
// deve mai essere la ragione per cui le copertine non si vedono.
func (s *Service) initImageCache() {
	base, err := os.UserCacheDir()
	if err != nil {
		log.Warn().Err(err).Msg("proxy: cache immagini disabilitata (cache dir di sistema non disponibile)")
		return
	}
	cache, err := newImageCache(filepath.Join(base, "streamai", "images"), imageCacheBytesLimit, imageCacheTTL)
	if err != nil {
		log.Warn().Err(err).Msg("proxy: cache immagini disabilitata")
		return
	}
	s.mu.Lock()
	s.imageCache = cache
	// Manutenzione periodica: senza, la cache si ripulisce solo all'avvio o
	// quando una voce viene richiesta, e una sessione lunga non sfoltisce mai.
	stopJanitor := make(chan struct{})
	go cache.runJanitor(imageCacheJanitorInterval, stopJanitor)
	s.closers = append(s.closers, func() { close(stopJanitor) })
	s.mu.Unlock()
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
	s.initImageCache()
	return s.Start()
}

// ServiceShutdown lifecycle Wails v3 — teardown.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("proxy: ServiceShutdown started")
	err := s.Stop()
	log.Info().Err(err).Msg("proxy: ServiceShutdown finished")
	return err
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
	log.Info().Int("port", s.port).Bool("insecure", s.insecure).Msg("proxy: listening")
	return nil
}

// Stop ferma il proxy. Idempotente.
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.started {
		return nil
	}
	log.Debug().Msg("proxy: stopping server")
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
	previous := s.httpClient
	s.insecure = insecure
	s.httpClient = buildHTTPClient(insecure)
	s.mu.Unlock()

	// Il client precedente non è più raggiungibile da nessuno: chiudiamo subito
	// le sue connessioni idle invece di lasciare decine di fd aperti fino alla
	// prossima GC (ogni toggle di insecure mode ne accumulava un pool intero).
	// `CloseIdleConnections` non tocca le richieste in volo, quindi gli stream
	// già avviati continuano normalmente sul client vecchio.
	if previous != nil {
		if tr, ok := previous.Transport.(interface{ CloseIdleConnections() }); ok {
			tr.CloseIdleConnections()
		}
	}
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

	// Cache immagini. Solo per le GET — una POST non è una copertina. La
	// decisione definitiva la prende comunque il Content-Type della risposta:
	// un indirizzo può sembrare un'immagine e non esserlo, e viceversa.
	//
	// `no-cache` salta la **lettura** ma non la scrittura (significa "non
	// servirmi la copia vecchia", non "non conservare": quello è `no-store`).
	// Così un refresh forzato riempie anche la cache, invece di lasciarla com'era.
	requestCacheControl := strings.ToLower(r.Header.Get("Cache-Control"))
	cache := s.imageCacheRef()
	cacheKey := ""
	if cache != nil && (r.Method == http.MethodGet || r.Method == http.MethodHead) &&
		!strings.Contains(requestCacheControl, "no-store") {
		cacheKey = imageCacheKey(upstreamURL)
		if !strings.Contains(requestCacheControl, "no-cache") {
			if path, contentType, ok := cache.get(cacheKey); ok {
				if r.Method == http.MethodHead {
					if serveImageHeadersFromCache(w, path, contentType) {
						return
					}
				} else if serveImageFromCache(w, path, contentType) {
					return
				}
			} else if r.Method == http.MethodHead {
				// Sonda di presenza: si risponde "no" senza andare upstream.
				// Senza questo, chiedere se un'immagine è in cache costerebbe
				// esattamente la banda che si sta cercando di risparmiare.
				w.Header().Set("X-StreamAI-Cache", "miss")
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
	}

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

	// Immagine: la serviamo e la memorizziamo nello stesso passaggio, così la
	// richiesta successiva — anche da un altro profilo, anche fra un mese — non
	// tocca affatto l'upstream.
	if cache != nil && cacheKey != "" && resp.StatusCode == http.StatusOK && isCacheableImageType(resp.Header.Get("Content-Type")) {
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, imageCacheEntryLimit+1))
		if readErr == nil && int64(len(body)) <= imageCacheEntryLimit {
			cache.put(cacheKey, resp.Header.Get("Content-Type"), body)
			rewriteResponseHeaders(w.Header(), resp.Header)
			w.Header().Set("X-StreamAI-Cache", "stored")
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(body)
			return
		}
		if len(body) > 0 {
			// Oltre il tetto, o lettura interrotta a metà: quello che abbiamo
			// letto va servito comunque, ma non entra in cache.
			rewriteResponseHeaders(w.Header(), resp.Header)
			w.Header().Set("X-StreamAI-Cache", "skipped")
			w.WriteHeader(resp.StatusCode)
			_, _ = w.Write(body)
			if readErr == nil {
				flushStream(w, resp.Body, upstreamURL)
			}
			return
		}
	}

	rewriteResponseHeaders(w.Header(), resp.Header)
	w.WriteHeader(resp.StatusCode)

	// Il client ha `Timeout: 0` (necessario per gli stream live long-running),
	// quindi il body non ha alcun limite complessivo: senza un watchdog di
	// inattività una connessione che smette di inviare dati senza chiudersi
	// (provider morto a metà stream, NAT drop) resta appesa per minuti o ore,
	// tenendo occupate una goroutine e un fd per richiesta e mandando in
	// buffering permanente il player.
	body := newIdleTimeoutReader(resp.Body, idleBodyTimeout)
	defer func() { _ = body.Close() }()

	flushStream(w, body, upstreamURL)
}

// idleBodyTimeout è il tempo massimo di inattività del body upstream prima che
// la connessione venga considerata morta.
const idleBodyTimeout = 30 * time.Second

// idleTimeoutReader chiude il reader sottostante se non arrivano byte per
// `timeout`, e riarma il timer a ogni lettura fruttuosa.
type idleTimeoutReader struct {
	reader  io.ReadCloser
	timer   *time.Timer
	timeout time.Duration
}

func newIdleTimeoutReader(reader io.ReadCloser, timeout time.Duration) *idleTimeoutReader {
	it := &idleTimeoutReader{reader: reader, timeout: timeout}
	it.timer = time.AfterFunc(timeout, func() {
		log.Warn().Dur("timeout", timeout).Msg("proxy: upstream body idle, closing connection")
		_ = reader.Close()
	})
	return it
}

func (it *idleTimeoutReader) Read(p []byte) (int, error) {
	n, err := it.reader.Read(p)
	if n > 0 {
		it.timer.Reset(it.timeout)
	}
	return n, err
}

func (it *idleTimeoutReader) Close() error {
	it.timer.Stop()
	return it.reader.Close()
}

// flushStream copia `src` in `dst` svuotando il buffer di net/http dopo ogni
// blocco.
//
// `io.CopyBuffer` da solo non basta: senza `Flush` i dati restano nel bufio del
// server (≈4KB) finché non si riempie, quindi su stream a basso bitrate
// (audio/radio IPTV ≈16 KB/s) ogni chunk può attendere centinaia di ms prima
// di partire, percepito come playback a scatti.
func flushStream(dst http.ResponseWriter, src io.Reader, upstreamURL string) {
	buffer := bufferPool.Get().(*[]byte)
	defer bufferPool.Put(buffer)

	flusher, canFlush := dst.(http.Flusher)
	for {
		n, err := src.Read(*buffer)
		if n > 0 {
			if _, werr := dst.Write((*buffer)[:n]); werr != nil {
				if !errors.Is(werr, context.Canceled) {
					log.Printf("proxy: copy body %s: %v", sanitizeURL(upstreamURL), werr)
				}
				return
			}
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !errors.Is(err, context.Canceled) {
				log.Printf("proxy: read body %s: %v", sanitizeURL(upstreamURL), err)
			}
			return
		}
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
		// Impostazioni di pooling ottimizzate per HLS/IPTV
		DialContext: (&net.Dialer{
			Timeout:   dialTimeout,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,              // Aumentato per gestire più connessioni idle totali
		MaxIdleConnsPerHost:   20,               // Cruciale per HLS, che fa molte richieste allo stesso host
		IdleConnTimeout:       90 * time.Second, // Timeout più lungo per mantenere le connessioni aperte
		TLSHandshakeTimeout:   tlsHandshakeTimeout,
		ResponseHeaderTimeout: responseHeaderTimeout,
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
