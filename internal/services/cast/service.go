// Package cast — porting di main.js cast-connect/load/control/disconnect
// come Wails v3 Service, basato su CastV2 client `barnybug/go-cast`.
//
// Mapping (vedi docs/plan-go-wails-migration.md sez. 3 + Fase 3):
//
//	electronAPI.castConnect(opts)   -> CastService.Connect(host, port)
//	electronAPI.castLoad(opts)      -> CastService.Load(req)
//	electronAPI.castControl({...})  -> CastService.Control(cmd)
//	electronAPI.castDisconnect()    -> CastService.Disconnect()
//	electronAPI.onCastStatus(cb)    -> wails.Events.On("cast-status", cb)
//
// Scelta libreria (Fase 3, POC):
//   - `barnybug/go-cast` (v0.0.0-2024-05-23): scelto per dipendenze
//     minimali (solo gogo/protobuf; bumpa miekg/dns già usato da zeroconf).
//   - Alternativa scartata: `vishen/go-chromecast`, che pull-in gRPC,
//     OpenTelemetry, OAuth2 e Google APIs (overhead ingiustificato).
//
// Limitazioni note (TODO Fase 3-bis):
//   - Nessun `Seek` esposto dall'upstream. Da implementare via canale
//     CastV2 custom usando `TransportId` dall'ApplicationSession (vedi
//     `client.NewChannel`). Per ora `Control{action:"seek"}` ritorna errore
//     non-fatal: la UI fa fallback.
package cast

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
	"sync"
	"time"

	gocast "github.com/barnybug/go-cast"
	"github.com/barnybug/go-cast/controllers"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)

const (
	// EventCastStatus nome canale Wails per snapshot stato cast.
	EventCastStatus = "cast-status"
	// connectTimeout — match `CAST_CONNECT_TIMEOUT_MS = 8000` di main.js.
	connectTimeout = 8 * time.Second
	// loadTimeout — match `CAST_LOAD_TIMEOUT_MS = 12000` di main.js.
	loadTimeout = 12 * time.Second
	// controlTimeout per play/pause/stop/volume/mute.
	controlTimeout = 4 * time.Second
	// statusTick — frequenza poll status (1 s) coerente con cron Electron.
	statusTick = 1 * time.Second
)

// LoadRequest payload per caricare uno stream sul receiver.
type LoadRequest struct {
	URL         string `json:"url"`
	ContentType string `json:"contentType,omitempty"`
	Title       string `json:"title,omitempty"`
	Subtitle    string `json:"subtitle,omitempty"`
	Poster      string `json:"poster,omitempty"`
	StreamType  string `json:"streamType,omitempty"` // "LIVE" | "BUFFERED"
}

// ControlCommand comando di playback verso il receiver.
type ControlCommand struct {
	Action   string  `json:"action"` // "play"|"pause"|"stop"|"seek"|"volume"|"mute"|"status"
	Position float64 `json:"position,omitempty"`
	Volume   float64 `json:"volume,omitempty"`
	Muted    bool    `json:"muted,omitempty"`
}

// Status snapshot da emettere via "cast-status".
type Status struct {
	Connected   bool    `json:"connected"`
	DeviceIP    string  `json:"deviceIp,omitempty"`
	PlayerState string  `json:"playerState"` // IDLE|BUFFERING|PLAYING|PAUSED
	CurrentTime float64 `json:"currentTime"`
	Duration    float64 `json:"duration"`
	Volume      float64 `json:"volume"`
	Muted       bool    `json:"muted"`
	MediaTitle  string  `json:"mediaTitle,omitempty"`
	Error       string  `json:"error,omitempty"`
}

// Service è il Wails v3 Service di cast.
type Service struct {
	mu       sync.Mutex
	client   *gocast.Client
	media    *controllers.MediaController
	status   Status
	tickStop context.CancelFunc
	tickerWG sync.WaitGroup
}

// New costruisce il servizio (singleton consigliato).
func New() *Service {
	return &Service{status: Status{PlayerState: "IDLE", Volume: 1}}
}

// ServiceShutdown chiude la sessione cast e ferma il ticker; invocato
// da Wails v3 al teardown se il metodo è presente.
func (s *Service) ServiceShutdown() error { return s.Disconnect() }

// GetStatus ritorna lo snapshot corrente (non emette evento).
func (s *Service) GetStatus() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Connect apre una sessione CastV2 con il receiver e avvia il ticker
// di "cast-status". Porta 8008 normalizzata a 8009 (CastV2 canonica).
func (s *Service) Connect(host string, port int) error {
	if !isValidIPv4(host) {
		return errors.New("cast: IP dispositivo non valido")
	}
	if port == 8008 || port == 0 {
		port = 8009
	}

	// Chiudi sessione precedente fuori dal lock per evitare deadlock col ticker.
	s.shutdownAndWait()

	ip := net.ParseIP(host)
	client := gocast.NewClient(ip, port)

	ctx, cancel := context.WithTimeout(context.Background(), connectTimeout)
	defer cancel()
	if err := client.Connect(ctx); err != nil {
		client.Close()
		return fmt.Errorf("cast: connessione fallita: %w", err)
	}

	s.mu.Lock()
	s.client = client
	s.status = Status{
		Connected:   true,
		DeviceIP:    host,
		PlayerState: "IDLE",
		Volume:      1,
	}
	s.startTickerLocked()
	snap := s.status
	s.mu.Unlock()

	wailsevents.Emit(EventCastStatus, snap)
	return nil
}

// Load lancia il media sul receiver (DefaultMediaReceiver) e aggiorna lo
// stato a BUFFERING → PLAYING.
func (s *Service) Load(req LoadRequest) error {
	if req.URL == "" || !strings.HasPrefix(strings.ToLower(req.URL), "http") {
		return errors.New("cast: URL media non valido (richiesto http/https)")
	}
	s.mu.Lock()
	client := s.client
	s.mu.Unlock()
	if client == nil {
		return errors.New("cast: nessuna sessione attiva (Connect prima)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), loadTimeout)
	defer cancel()

	media, err := client.Media(ctx) // launch DefaultMediaReceiver se necessario
	if err != nil {
		return fmt.Errorf("cast: launch receiver fallito: %w", err)
	}

	streamType := req.StreamType
	if streamType == "" {
		streamType = "LIVE"
	}
	contentType := req.ContentType
	if contentType == "" {
		contentType = guessContentType(req.URL)
	}

	s.mu.Lock()
	s.status.PlayerState = "BUFFERING"
	s.status.MediaTitle = req.Title
	s.status.Error = ""
	s.media = media
	snap := s.status
	s.mu.Unlock()
	wailsevents.Emit(EventCastStatus, snap)

	item := controllers.MediaItem{
		ContentId:   req.URL,
		ContentType: contentType,
		StreamType:  streamType,
	}
	if _, err := media.LoadMedia(ctx, item, 0, true, nil); err != nil {
		s.mu.Lock()
		s.status.PlayerState = "IDLE"
		s.status.Error = err.Error()
		snap := s.status
		s.mu.Unlock()
		wailsevents.Emit(EventCastStatus, snap)
		return fmt.Errorf("cast: load fallito: %w", err)
	}

	s.mu.Lock()
	s.status.PlayerState = "PLAYING"
	snap = s.status
	s.mu.Unlock()
	wailsevents.Emit(EventCastStatus, snap)
	return nil
}

// Control invia un comando di playback al receiver.
func (s *Service) Control(cmd ControlCommand) error {
	s.mu.Lock()
	client := s.client
	media := s.media
	s.mu.Unlock()

	if cmd.Action == "status" {
		s.pollStatus()
		return nil
	}
	if client == nil {
		return errors.New("cast: nessuna sessione attiva")
	}

	ctx, cancel := context.WithTimeout(context.Background(), controlTimeout)
	defer cancel()

	switch cmd.Action {
	case "play":
		if media == nil {
			return errors.New("cast: media non caricato")
		}
		_, err := media.Play(ctx)
		return err
	case "pause":
		if media == nil {
			return errors.New("cast: media non caricato")
		}
		_, err := media.Pause(ctx)
		return err
	case "stop":
		if media == nil {
			return errors.New("cast: media non caricato")
		}
		_, err := media.Stop(ctx)
		return err
	case "volume":
		level := clamp01(cmd.Volume)
		_, err := client.Receiver().SetVolume(ctx, &controllers.Volume{Level: &level})
		return err
	case "mute":
		muted := cmd.Muted
		_, err := client.Receiver().SetVolume(ctx, &controllers.Volume{Muted: &muted})
		return err
	case "seek":
		// TODO Fase 3-bis: implementare via canale CastV2 custom.
		return errors.New("cast: seek non implementato (Fase 3-bis)")
	default:
		return fmt.Errorf("cast: comando non supportato: %s", cmd.Action)
	}
}

// Disconnect chiude la sessione e ferma il ticker.
func (s *Service) Disconnect() error {
	s.shutdownAndWait()
	s.mu.Lock()
	snap := s.status
	s.mu.Unlock()
	wailsevents.Emit(EventCastStatus, snap)
	return nil
}

// shutdownAndWait: cancella il ticker fuori dal lock per evitare deadlock
// con `pollStatus` (che a sua volta riacquisisce s.mu).
func (s *Service) shutdownAndWait() {
	s.mu.Lock()
	stop := s.tickStop
	s.tickStop = nil
	s.mu.Unlock()
	if stop != nil {
		stop()
		s.tickerWG.Wait()
	}
	s.mu.Lock()
	if s.client != nil {
		s.client.Close()
		s.client = nil
	}
	s.media = nil
	s.status = Status{PlayerState: "IDLE", Volume: 1}
	s.mu.Unlock()
}

// startTickerLocked: caller deve tenere s.mu.
func (s *Service) startTickerLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	s.tickStop = cancel
	s.tickerWG.Add(1)
	go func() {
		defer s.tickerWG.Done()
		t := time.NewTicker(statusTick)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				s.pollStatus()
			}
		}
	}()
}

// pollStatus interroga il MediaController per i campi dinamici
// (currentTime, playerState, volume) ed emette "cast-status" solo se cambiati.
func (s *Service) pollStatus() {
	s.mu.Lock()
	media := s.media
	client := s.client
	snap := s.status
	s.mu.Unlock()

	if client == nil || media == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resp, err := media.GetStatus(ctx)
	if err != nil || resp == nil || len(resp.Status) == 0 {
		return
	}
	ms := resp.Status[0]
	changed := false
	if ms.PlayerState != "" && ms.PlayerState != snap.PlayerState {
		snap.PlayerState = ms.PlayerState
		changed = true
	}
	if ms.CurrentTime != snap.CurrentTime {
		snap.CurrentTime = ms.CurrentTime
		changed = true
	}
	if ms.Media != nil && ms.Media.Duration != snap.Duration {
		snap.Duration = ms.Media.Duration
		changed = true
	}
	if ms.Volume != nil {
		if ms.Volume.Level != nil && *ms.Volume.Level != snap.Volume {
			snap.Volume = *ms.Volume.Level
			changed = true
		}
		if ms.Volume.Muted != nil && *ms.Volume.Muted != snap.Muted {
			snap.Muted = *ms.Volume.Muted
			changed = true
		}
	}
	if !changed {
		return
	}
	s.mu.Lock()
	s.status = snap
	s.mu.Unlock()
	wailsevents.Emit(EventCastStatus, snap)
}

// --- helpers ---------------------------------------------------------------

func isValidIPv4(ip string) bool {
	addr := net.ParseIP(ip)
	return addr != nil && addr.To4() != nil
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// guessContentType replica `getCastContentType` di main.js: heuristica
// path-based (m3u8 → HLS, mpd → DASH, ecc.).
func guessContentType(u string) string {
	low := strings.ToLower(u)
	switch {
	case strings.Contains(low, ".m3u8"):
		return "application/x-mpegURL"
	case strings.Contains(low, ".mpd"):
		return "application/dash+xml"
	case strings.Contains(low, ".mkv"):
		return "video/x-matroska"
	case strings.Contains(low, ".mp4"):
		return "video/mp4"
	case strings.Contains(low, ".ts"):
		return "video/mp2t"
	default:
		return "video/mp4"
	}
}

