package migration

import (
	"context"
	"github.com/rs/zerolog/log"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/migrate"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Service gestisce la migrazione dei dati da v1 (Electron) a v2 (Wails).
type Service struct {
}

func New() *Service {
	return &Service{}
}

func (s *Service) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	return nil
}

func (s *Service) ServiceShutdown() error {
	log.Info().Msg("migration: ServiceShutdown started")
	log.Info().Msg("migration: ServiceShutdown finished")
	return nil
}

// HasLegacyData verifica se esistono dati della versione 1.x (Electron/Chromium IndexedDB).
func (s *Service) HasLegacyData() bool {
	return migrate.LegacyExists()
}

// GetLegacyPath ritorna il path del database legacy rilevato.
func (s *Service) GetLegacyPath() string {
	return migrate.ChromiumIndexedDBPath()
}

// GetLegacyData estrae e ritorna i dati legacy in formato JSON.
func (s *Service) GetLegacyData() (string, error) {
	data, err := migrate.ExtractLegacyData()
	if err != nil {
		return "", err
	}
	return data.ToJSON(), nil
}

// ImportSnapshot riceve un dump JSON dei dati e dovrebbe iniettarli nel database corrente.
// Al momento è uno stub per il wiring del frontend.
func (s *Service) ImportSnapshot(jsonData string) (bool, error) {
	// TODO: implementare logica di injection via Eval JS o ritorno dati strutturati.
	return true, nil
}
