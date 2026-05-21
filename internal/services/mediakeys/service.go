// Package mediakeys — Wails v3 Service per controllo media keys
// hardware (Fase 7-bis.4 del plan-go-wails-migration).
//
// Mapping IPC frontend ↔ backend:
//
//	// Frontend chiama backend (PlayerService aggiornato → MPRIS):
//	MediaKeysService.SetPlaybackStatus("playing")
//	MediaKeysService.SetMetadata({title, artist, album, artUrl, durationMicros})
//	MediaKeysService.SetVolume(0.7)
//	MediaKeysService.SetCapabilities({canPlay, canPause, canSeek, ...})
//
//	// Backend emette eventi al frontend (utente preme tasto hardware
//	// → MPRIS → callback → emit Wails event):
//	wails.Events.On("media-key", payload => {
//	  switch (payload.action) {
//	    case "play":      videoPlayer.play(); break;
//	    case "pause":     videoPlayer.pause(); break;
//	    case "playpause": videoPlayer.togglePlay(); break;
//	    case "stop":      videoPlayer.stop(); break;
//	    case "next":      navigateNextChannel(); break;
//	    case "previous":  navigatePreviousChannel(); break;
//	    case "seek":      videoPlayer.seekBy(payload.offsetSeconds); break;
//	    case "setposition": videoPlayer.seekTo(payload.positionSeconds); break;
//	    case "raise":     focusMainWindow(); break;
//	    case "quit":      app.quit(); break;
//	  }
//	});
//
// Lifecycle:
//   - ServiceStartup: registra il bus name MPRIS (Linux); no-op altrove.
//   - ServiceShutdown: rilascia bus name + chiude conn D-Bus.
//
// Su Linux il Controller resta vivo per tutta la sessione: il
// frontend chiama solo i setter — gli eventi entrano automaticamente
// via callback (Wails event bus → React listener).
package mediakeys

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/mediakeys"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)

// EventName è il nome dell'evento Wails inoltrato al frontend.
// Payload: MediaKeyEvent (JSON).
const EventName = "media-key"

// MediaKeyEvent è il payload emesso al frontend.
type MediaKeyEvent struct {
	// Action: "play"|"pause"|"playpause"|"stop"|"next"|"previous"|
	// "seek"|"setposition"|"raise"|"quit"
	Action string `json:"action"`
	// OffsetSeconds è valorizzato solo per Action="seek".
	OffsetSeconds float64 `json:"offsetSeconds,omitempty"`
	// PositionSeconds è valorizzato solo per Action="setposition".
	PositionSeconds float64 `json:"positionSeconds,omitempty"`
}

// MetadataInput è il payload accettato da SetMetadata dal frontend
// (JSON-safe; il backend converte microseconds <-> secondi).
type MetadataInput struct {
	Title           string  `json:"title,omitempty"`
	Artist          string  `json:"artist,omitempty"`
	Album           string  `json:"album,omitempty"`
	ArtURL          string  `json:"artUrl,omitempty"`
	DurationSeconds float64 `json:"durationSeconds,omitempty"`
	TrackID         string  `json:"trackId,omitempty"`
}

// CapabilitiesInput è il payload accettato da SetCapabilities.
type CapabilitiesInput struct {
	CanPlay       bool `json:"canPlay"`
	CanPause      bool `json:"canPause"`
	CanGoNext     bool `json:"canGoNext"`
	CanGoPrevious bool `json:"canGoPrevious"`
	CanSeek       bool `json:"canSeek"`
	CanControl    bool `json:"canControl"`
}

// Service è il Wails v3 Service.
type Service struct {
	ctrl *mediakeys.Controller
}

// New costruisce il servizio. Le callback inoltrano gli eventi
// MPRIS verso il bus eventi Wails — il frontend gestisce la logica
// player (questo Service non sa nulla del player concreto).
func New() *Service {
	s := &Service{}
	s.ctrl = mediakeys.New(mediakeys.Callbacks{
		OnPlay:      func() { s.emit(MediaKeyEvent{Action: "play"}) },
		OnPause:     func() { s.emit(MediaKeyEvent{Action: "pause"}) },
		OnPlayPause: func() { s.emit(MediaKeyEvent{Action: "playpause"}) },
		OnStop:      func() { s.emit(MediaKeyEvent{Action: "stop"}) },
		OnNext:      func() { s.emit(MediaKeyEvent{Action: "next"}) },
		OnPrevious:  func() { s.emit(MediaKeyEvent{Action: "previous"}) },
		OnSeek: func(offsetMicros int64) {
			s.emit(MediaKeyEvent{Action: "seek", OffsetSeconds: float64(offsetMicros) / 1e6})
		},
		OnSetPosition: func(posMicros int64) {
			s.emit(MediaKeyEvent{Action: "setposition", PositionSeconds: float64(posMicros) / 1e6})
		},
		OnRaise: func() { s.emit(MediaKeyEvent{Action: "raise"}) },
		OnQuit:  func() { s.emit(MediaKeyEvent{Action: "quit"}) },
	})
	return s
}

func (s *Service) emit(ev MediaKeyEvent) {
	// Emission soft-fail: se Wails non è ancora inizializzato
	// (early-boot callback) wailsevents.Emit ritorna senza side effect.
	wailsevents.Emit(EventName, ev)
}

// ServiceStartup avvia MPRIS2 (Linux) o no-op altrove. Soft-fail:
// se DBus non disponibile (sandbox/CI senza session bus) loggiamo
// e proseguiamo — l'app funziona senza media keys hardware.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	if err := s.ctrl.Start("StreamAI"); err != nil {
		log.Warn().Err(err).Msg("mediakeys: ServiceStartup soft-fail (continuing without media keys)")
		return nil
	}
	return nil
}

// ServiceShutdown rilascia il bus name + chiude conn.
func (s *Service) ServiceShutdown() error {
	return s.ctrl.Stop()
}

// --- API bindable al frontend ---

// SetPlaybackStatus aggiorna lo stato MPRIS ("playing"|"paused"|
// "stopped", case-insensitive). Valori sconosciuti diventano
// "stopped" (per evitare di esporre stati indefiniti al DE).
func (s *Service) SetPlaybackStatus(status string) error {
	var ms mediakeys.Status
	switch status {
	case "playing", "Playing", "PLAYING":
		ms = mediakeys.StatusPlaying
	case "paused", "Paused", "PAUSED":
		ms = mediakeys.StatusPaused
	default:
		ms = mediakeys.StatusStopped
	}
	return s.ctrl.SetStatus(ms)
}

// SetMetadata aggiorna track metadata visualizzati nel widget
// GNOME/KDE/playerctl.
func (s *Service) SetMetadata(in MetadataInput) error {
	return s.ctrl.SetMetadata(mediakeys.Metadata{
		Title:    in.Title,
		Artist:   in.Artist,
		Album:    in.Album,
		ArtURL:   in.ArtURL,
		Duration: int64(in.DurationSeconds * 1e6),
		TrackID:  in.TrackID,
	})
}

// SetVolume aggiorna volume (0.0–1.0). Il volume può anche essere
// CAMBIATO dall'OS (slider GNOME media widget) → vedi MediaKeyEvent
// rinviato al frontend con Action="volume" (TODO se necessario).
func (s *Service) SetVolume(v float64) error { return s.ctrl.SetVolume(v) }

// SetCapabilities aggiorna i Can* property MPRIS.
func (s *Service) SetCapabilities(in CapabilitiesInput) error {
	return s.ctrl.SetCapabilities(mediakeys.Capabilities{
		CanPlay:       in.CanPlay,
		CanPause:      in.CanPause,
		CanGoNext:     in.CanGoNext,
		CanGoPrevious: in.CanGoPrevious,
		CanSeek:       in.CanSeek,
		CanControl:    in.CanControl,
	})
}

// Started ritorna true se MPRIS è attivo (utile per debug/UI status).
func (s *Service) Started() bool { return s.ctrl.Started() }

