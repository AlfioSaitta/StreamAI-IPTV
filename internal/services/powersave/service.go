// Package powersave — Wails v3 Service che espone il display-sleep
// inhibitor al frontend (Fase 7-bis.3 del plan-go-wails-migration).
//
// Mapping Electron → Wails:
//
//	window.electronAPI.powerSaveStart(reason)   →  PowerSaveService.Start(reason)
//	window.electronAPI.powerSaveStop()          →  PowerSaveService.Stop()
//	window.electronAPI.powerSaveActive()        →  PowerSaveService.Active()
//
// Pattern d'uso lato frontend (VideoPlayerNew.tsx → useVideoPlayerEngine):
//
//	video.addEventListener('playing', () => PowerSaveService.Start('Live TV'))
//	video.addEventListener('pause',   () => PowerSaveService.Stop())
//	video.addEventListener('ended',   () => PowerSaveService.Stop())
//	window.addEventListener('beforeunload', () => PowerSaveService.Stop())
//
// Una preferenza profilo `preventDisplaySleep` (default true) può
// gating-are le chiamate Start dal frontend — vedi
// ProfilePreferences.preventDisplaySleep in `types.ts` (TODO Fase 7).
package powersave

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/powersave"
)

// Service è il Wails v3 Service. È un wrapper thin sopra
// internal/pkg/powersave.Inhibitor: tutte le considerazioni di
// thread-safety, idempotenza e degradazione OS sono gestite lì.
type Service struct {
	inh *powersave.Inhibitor
}

// New costruisce il servizio.
func New() *Service { return &Service{inh: powersave.New()} }

// ServiceStartup lifecycle hook Wails v3 — no-op (l'inhibitor è
// lazy: nessun syscall fino al primo Start).
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

// ServiceShutdown rilascia un'eventuale inhibition pendente. Wails
// invoca ServiceShutdown in reverse-order della registration; vedi
// cmd/streamai/main.go per l'ordine globale (plan §7-bis.1).
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("powersave: ServiceShutdown started")
	err := s.inh.Uninhibit()
	log.Info().Err(err).Msg("powersave: ServiceShutdown finished")
	return err
}

// Start acquisisce l'inhibition con `reason` user-facing. Se è già
// attivo ritorna `ErrAlreadyActive` come stringa (per il binding
// TS l'errore diventa una rejected promise).
//
// Frontend deve chiamare Stop esattamente una volta per ogni Start
// che è andato a buon fine (idempotenza ulteriore: Stop su inactive
// è no-op).
func (s *Service) Start(reason string) error {
	return s.inh.Inhibit(reason)
}

// Stop rilascia l'inhibition. No-op se non attivo.
func (s *Service) Stop() error {
	return s.inh.Uninhibit()
}

// Active ritorna lo stato corrente. Il frontend può usarlo per
// sincronizzare UI (es. indicatore "Display sleep prevented" in
// settings) e diagnostica.
func (s *Service) Active() bool { return s.inh.Active() }

// Reason ritorna la stringa motivo dell'inhibition corrente (vuota
// se inattiva). Utile per debugging cross-window.
func (s *Service) Reason() string { return s.inh.Reason() }

