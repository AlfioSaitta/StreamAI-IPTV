// Package advertising — porting di services/advertisingService.js
// (Electron main process) come Wails v3 Service.
//
// Annuncia l'app come ricevitore AirPlay (mDNS _airplay._tcp + _raop._tcp),
// DLNA/UPnP MediaRenderer:1 (SSDP) e DIAL.
//
// Vedi docs/plan-go-wails-migration.md sez. 3, Fase 2.
package advertising
import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
)
// Service e' il Wails v3 Service di advertising.
type Service struct {
	mu       sync.Mutex
	running  bool
	lastErr  error
	instance string // nome esposto in mDNS/SSDP (default: hostname)
	httpPort int    // porta "fallback" annunciata se DIAL HTTP non parte; 0 = unset
	// Fase 2-bis: DIAL HTTP receiver (gap E28+E29).
	dialServer     *http.Server
	actualHTTPPort int             // porta effettiva DIAL HTTP (0 = non avviato)
	dialState      dialStateHolder // stato playback (running|stopped) per /apps/<APP>
	appVersion     string          // versione app, usata per UDN (uuid:streamai-<ver>)
	// closers e' la lista di funzioni di shutdown registrate dai sotto-servizi
	// (mDNS via zeroconf.Server.Shutdown, SSDP via ssdp.Advertiser.Close,
	// DIAL HTTP via http.Server.Close).
	// Le diverse signature delle librerie sono normalizzate qui in func().
	closers []func()
}
// New costruisce il servizio. Instance default = "StreamAI-<hostname>",
// httpPort default = 0 (= unset; SSDP NON partira', mDNS si').
func New() *Service {
	host, _ := os.Hostname()
	if host == "" {
		host = "StreamAI"
	}
	return &Service{instance: "StreamAI-" + host}
}
// SetInstance cambia il nome esposto nel network. Richiede Restart per
// propagarsi.
func (s *Service) SetInstance(name string) error {
	if name == "" {
		return errors.New("advertising: instance name cannot be empty")
	}
	s.mu.Lock()
	s.instance = name
	s.mu.Unlock()
	return nil
}
// SetHTTPPort imposta la porta annunciata dai descrittori (DLNA/DIAL).
func (s *Service) SetHTTPPort(port int) error {
	if port < 0 || port > 65535 {
		return fmt.Errorf("advertising: invalid port %d", port)
	}
	s.mu.Lock()
	s.httpPort = port
	s.mu.Unlock()
	return nil
}
// Start avvia mDNS + SSDP announce. Idempotente: doppia chiamata = no-op.
// Errori SSDP sono non-fatali (mDNS resta attivo).
func (s *Service) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return nil
	}
	// Fase 2-bis: l'HTTP DIAL deve partire PRIMA di SSDP, perche' la
	// LOCATION URL annunciata in SSDP punta al suo /dial.xml.
	if err := s.startDIALHTTPLocked(); err != nil {
		s.lastErr = err
		// Non-fatale: senza DIAL HTTP perdiamo solo la ricezione cast da
		// YouTube/Netflix/Tubi, ma mDNS resta utile per AirPlay.
	}
	if err := s.startMDNSLocked(); err != nil {
		s.lastErr = err
		s.stopLocked()
		return fmt.Errorf("advertising: mDNS start failed: %w", err)
	}
	if err := s.startSSDPLocked(); err != nil {
		s.lastErr = err
	}
	s.running = true
	return nil
}
// Stop ferma tutti gli annunci. Idempotente.
func (s *Service) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.running {
		return nil
	}
	s.stopLocked()
	s.running = false
	return nil
}
func (s *Service) stopLocked() {
	log.Debug().Msg("advertising: stopping sub-services")
	for _, fn := range s.closers {
		fn()
	}
	s.closers = nil
	log.Debug().Msg("advertising: sub-services stopped")
}
// Status ritorna lo stato corrente: "running" | "stopped" | "error".
func (s *Service) Status() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.running {
		return "running", nil
	}
	if s.lastErr != nil {
		return "error", s.lastErr
	}
	return "stopped", nil
}

// ServiceStartup è il lifecycle hook Wails v3: viene invocato
// automaticamente da application.Run() dopo aver inizializzato i
// Services. Replica il flusso `app.whenReady() → advertisingService.start()`
// di main.js (Electron).
//
// Il prefisso "Service" è riservato dal bindings generator v3 (non viene
// esposto al frontend), così evita di apparire come metodo bindato.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if err := s.Start(); err != nil {
		// Errore non fatale: il fallimento dell'advertising non deve
		// abbattere l'app (mDNS può fallire in container/sandbox dove i
		// multicast socket sono filtrati). Lo loggiamo e proseguiamo.
		log.Warn().Err(err).Msg("advertising: ServiceStartup soft-fail")
	}
	return nil
}

// ServiceShutdown è il lifecycle hook Wails v3 per il teardown:
// chiude mDNS, SSDP e DIAL HTTP. Replica `app.on('will-quit', ...)`.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("advertising: ServiceShutdown started")
	err := s.Stop()
	log.Info().Err(err).Msg("advertising: ServiceShutdown finished")
	return err
}

