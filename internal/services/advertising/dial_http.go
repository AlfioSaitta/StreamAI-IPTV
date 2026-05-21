// DIAL HTTP receiver — porting di advertisingService.js:159-268 (Electron
// main process) come parte del Service Wails v3 di advertising.
//
// Espone un HTTP server LAN (0.0.0.0:8090, retry +1 fino a 8094) con due
// handler:
//
//   GET  /dial.xml          → UPnP device descriptor DIAL 1.7
//   GET  /apps/StreamAI IPTV → <state>running|stopped</state>
//   POST /apps/StreamAI IPTV → launch request (body = URL stream o JSON
//                              {url:"..."}); emessa via wailsevents
//                              "dial-launch-request" → frontend chiama
//                              Player.Load(url).
//
// Senza /dial.xml i client DIAL nativi (YouTube, Netflix, Tubi, AppCast)
// NON vedono StreamAI come receiver anche se SSDP è attivo. Vedi
// docs/plan-go-wails-migration.md §"Fase 2-bis".
package advertising

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)

const (
	// dialDefaultPort è la porta DIAL di default (replica DEFAULT_PORT di
	// advertisingService.js; configurabile via env STREAMAI_ADVERTISING_PORT
	// nel codice Electron, mantenuto fisso qui — può essere reso dinamico
	// con SetDIALPort se servisse).
	dialDefaultPort = 8090
	// dialMaxPortAttempts replica MAX_PORT_ATTEMPTS = 5 (8090..8094).
	dialMaxPortAttempts = 5
	// dialAppName replica APP_NAME di advertisingService.js (case-sensitive,
	// con spazio — i client DIAL fanno match esatto su questo path).
	dialAppName = "StreamAI IPTV"
	// dialAppManufacturer / dialAppModel: stringhe esposte nel descriptor.
	dialAppManufacturer = "StreamAI"
	dialAppModel        = "StreamAI Desktop Player"
	// dialEventLaunch è il nome dell'evento Wails emesso quando un client
	// DIAL fa POST /apps/<APP> con una URL di stream da riprodurre.
	dialEventLaunch = "dial-launch-request"
	// dialHTTPReadHeaderTimeout protegge dal Slowloris (gosec G112).
	dialHTTPReadHeaderTimeout = 10 * time.Second
)

// dialState è un atomic boolean che riflette lo stato di playback corrente
// (true = "running", false = "stopped"). Aggiornato dal bridge
// netstatus→advertising via SetDIALState (E29).
type dialStateHolder struct {
	running atomic.Bool
}

// startDIALHTTPLocked avvia l'HTTP server DIAL. Replica
// advertisingService.js:159-195: prova 8090, se EADDRINUSE incrementa
// fino a 5 volte. Su successo registra `s.actualHTTPPort` (usato dal
// descriptor /dial.xml e dalla LOCATION URL SSDP).
//
// Non blocca: il server gira in goroutine; il close è registrato in
// s.closers come http.Server.Close() (immediate shutdown, OK per LAN
// service di advertising).
func (s *Service) startDIALHTTPLocked() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/dial.xml", s.handleDialXML)
	// L'URL del DIAL app endpoint contiene uno spazio (`StreamAI IPTV`).
	// I client possono inviarlo come `%20` o letterale; net/http normalizza
	// il path *non* fa decode su `%20`, quindi registriamo entrambi.
	mux.HandleFunc("/apps/", s.handleDialApp)

	var lastErr error
	for attempt := 0; attempt < dialMaxPortAttempts; attempt++ {
		port := dialDefaultPort + attempt
		addr := fmt.Sprintf("0.0.0.0:%d", port)
		ln, err := net.Listen("tcp4", addr)
		if err != nil {
			lastErr = err
			// EADDRINUSE → ritenta; ogni altro errore esce subito.
			if !isAddrInUse(err) {
				return fmt.Errorf("advertising: DIAL listen %s: %w", addr, err)
			}
			continue
		}
		srv := &http.Server{
			Handler:           mux,
			ReadHeaderTimeout: dialHTTPReadHeaderTimeout,
		}
		go func() {
			// Serve ritorna ErrServerClosed quando chiudiamo: log silente.
			_ = srv.Serve(ln)
		}()
		s.dialServer = srv
		s.actualHTTPPort = port
		s.closers = append(s.closers, func() { _ = srv.Close() })
		return nil
	}
	return fmt.Errorf("advertising: DIAL HTTP server failed after %d attempts: %w", dialMaxPortAttempts, lastErr)
}

// isAddrInUse rileva l'errore "address already in use" in modo
// platform-independent (Linux: syscall.EADDRINUSE → wrapped in
// *net.OpError → os.SyscallError). Match sulla stringa = portable.
func isAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "address already in use") ||
		strings.Contains(s, "Only one usage of each socket address")
}

// handleDialXML serve il descriptor UPnP DIAL 1.7. Replica
// advertisingService.js:197-230. Application-URL DEVE puntare allo
// stesso host:porta dell'HTTP server (è quello che i client poi
// chiamano in POST per fare launch). Spazio in APP_NAME url-encoded
// nel link, ma il letterale resta possibile (gestito da handleDialApp).
func (s *Service) handleDialXML(w http.ResponseWriter, _ *http.Request) {
	host := s.advertisedHost()
	port := s.actualHTTPPort
	udn := s.udn()
	appURL := fmt.Sprintf("http://%s:%d/apps/", host, port)
	// Nota: friendlyName/manufacturer/modelName sono stringhe statiche;
	// nessun input utente è interpolato — niente rischio XSS/XML injection.
	body := fmt.Sprintf(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:r="urn:restful-tv-org:schemas:upnp-dd">
  <specVersion>
    <major>1</major>
    <minor>0</minor>
  </specVersion>
  <device>
    <deviceType>urn:schemas-upnp-org:device:dial:1</deviceType>
    <friendlyName>%s</friendlyName>
    <manufacturer>%s</manufacturer>
    <modelName>%s</modelName>
    <UDN>%s</UDN>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:dial:1</serviceType>
        <serviceId>urn:upnp-org:serviceId:dial</serviceId>
        <controlURL>/ssdp/notfound</controlURL>
        <eventSubURL>/ssdp/notfound</eventSubURL>
        <SCPDURL>/ssdp/notfound</SCPDURL>
      </service>
    </serviceList>
    <application-URL>%s</application-URL>
  </device>
</root>`, dialAppName, dialAppManufacturer, dialAppModel, udn, appURL)

	w.Header().Set("Content-Type", "application/xml")
	w.Header().Set("Application-URL", appURL)
	_, _ = w.Write([]byte(body))
}

// handleDialApp gestisce /apps/<APP_NAME> (GET stato + POST launch).
// Match path tolerante a url-encoding: i client possono inviare
// `/apps/StreamAI IPTV`, `/apps/StreamAI%20IPTV`, `/apps/` (lista),
// con o senza trailing slash.
func (s *Service) handleDialApp(w http.ResponseWriter, r *http.Request) {
	// Decoded path: net/http espone r.URL.Path già decodificato.
	rest := strings.TrimPrefix(r.URL.Path, "/apps/")
	rest = strings.TrimSuffix(rest, "/")
	// Decode aggiuntivo per gestire `%20` residui (alcuni client non
	// decodificano e li passano letterali via RawPath).
	if dec, err := url.QueryUnescape(rest); err == nil {
		rest = dec
	}

	// `/apps/` (vuoto) → directory listing minimale: ritorna 200 con
	// link al solo nostro app. Replica behavior tollerante di node-ssdp.
	if rest == "" {
		w.Header().Set("Content-Type", "application/xml")
		_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial"><name>%s</name></service>`, dialAppName)
		return
	}

	// Solo il nostro APP_NAME è gestito; tutto il resto → 404.
	if !strings.EqualFold(rest, dialAppName) {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.serveDialAppStatus(w)
	case http.MethodPost:
		s.serveDialAppLaunch(w, r)
	case http.MethodDelete:
		// Stop request (DIAL allowStop=true): emette evento e risponde 200.
		wailsevents.Emit(dialEventLaunch+"-stop", map[string]any{"app": dialAppName})
		w.WriteHeader(http.StatusOK)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// serveDialAppStatus risponde GET con XML <state>. Replica
// advertisingService.js:251-263.
func (s *Service) serveDialAppStatus(w http.ResponseWriter) {
	state := "stopped"
	if s.dialState.running.Load() {
		state = "running"
	}
	w.Header().Set("Content-Type", "application/xml")
	_, _ = fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?>
<service xmlns="urn:dial-multiscreen-org:schemas:dial">
  <name>%s</name>
  <options allowStop="true"/>
  <state>%s</state>
</service>`, dialAppName, state)
}

// serveDialAppLaunch gestisce POST. Il body è il payload di launch
// inviato dal client DIAL: di solito è form-urlencoded
// (`v=URL&...` per YouTube) o JSON (`{"url":"..."}`); il fallback è il
// raw URL come stringa. Estraiamo la URL "best effort" e emettiamo un
// evento Wails al frontend, che decide come gestirlo.
func (s *Service) serveDialAppLaunch(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
	if err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	defer func() { _ = r.Body.Close() }()

	payload := map[string]any{
		"app":         dialAppName,
		"contentType": r.Header.Get("Content-Type"),
		"raw":         string(body),
	}
	// Best-effort URL extraction.
	if u := extractDialURL(body, r.Header.Get("Content-Type")); u != "" {
		payload["url"] = u
	}
	wailsevents.Emit(dialEventLaunch, payload)

	// DIAL spec: 201 Created + LOCATION del nuovo run.
	w.Header().Set("Location", fmt.Sprintf("/apps/%s/run", url.PathEscape(dialAppName)))
	w.WriteHeader(http.StatusCreated)
}

// extractDialURL estrae la URL dal body DIAL. Pattern supportati:
//   1. JSON `{"url":"http://..."}`
//   2. form-urlencoded `v=http://...` o `url=http://...`
//   3. raw `http://...` (intero body è la URL)
func extractDialURL(body []byte, contentType string) string {
	if len(body) == 0 {
		return ""
	}
	trimmed := strings.TrimSpace(string(body))
	// 1) JSON
	if strings.HasPrefix(contentType, "application/json") ||
		(strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) {
		var obj map[string]any
		if err := json.Unmarshal([]byte(trimmed), &obj); err == nil {
			if v, ok := obj["url"].(string); ok && v != "" {
				return v
			}
		}
	}
	// 2) form-urlencoded
	if strings.Contains(trimmed, "=") {
		if values, err := url.ParseQuery(trimmed); err == nil {
			for _, key := range []string{"url", "v", "src", "uri"} {
				if v := values.Get(key); v != "" {
					return v
				}
			}
		}
	}
	// 3) raw URL
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		return trimmed
	}
	return ""
}

// advertisedHost ritorna l'IP IPv4 LAN annunciato nei descriptor.
// Replica getLocalIpAddress() di advertisingService.js (prima
// interface non-loopback). Fallback a 127.0.0.1 se nessuna NIC.
func (s *Service) advertisedHost() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			if v4 := ip.To4(); v4 != nil {
				return v4.String()
			}
		}
	}
	return "127.0.0.1"
}

// udn ritorna l'UPnP Unique Device Name stabile per questa istanza.
// Replica `uuid:${app.getName()}-${app.getVersion()}` di Electron.
func (s *Service) udn() string {
	v := s.appVersion
	if v == "" {
		v = "dev"
	}
	return fmt.Sprintf("uuid:streamai-%s", v)
}

// SetDIALState aggiorna lo stato playback DIAL (E29). Chiamato dal
// bridge netstatus.UpdatePlaybackStatus → advertising. Idempotente.
func (s *Service) SetDIALState(running bool) {
	s.dialState.running.Store(running)
}

// SetAppVersion permette al main wiring di iniettare la versione (per UDN).
func (s *Service) SetAppVersion(v string) {
	s.mu.Lock()
	s.appVersion = v
	s.mu.Unlock()
}

// ActualHTTPPort ritorna la porta effettiva su cui gira l'HTTP DIAL
// (utile per test e per la LOCATION SSDP).
func (s *Service) ActualHTTPPort() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.actualHTTPPort
}

// guard di compile-time sulle dipendenze opzionali (errors evita
// "imported and not used" su rebuild parziali).
var _ = errors.New

