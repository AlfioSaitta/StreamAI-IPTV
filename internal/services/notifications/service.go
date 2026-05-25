package notifications

import (
	"context"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/notifications"
)

// Service gestisce le notifiche native del sistema operativo.
type Service struct {
}

// New crea una nuova istanza del servizio notifiche.
func New() *Service {
	return &Service{}
}

// ServiceStartup viene chiamato da Wails all'avvio dell'applicazione.
func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

// ServiceShutdown viene chiamato da Wails alla chiusura dell'applicazione.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("notifications: ServiceShutdown started")
	log.Info().Msg("notifications: ServiceShutdown finished")
	return nil
}

// Send invia una notifica nativa al sistema operativo.
func (s *Service) Send(title, message string) {
	_ = notifications.Send(title, message)
}
