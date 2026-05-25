package migration

import (
	"context"
	"testing"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestService_Lifecycle(t *testing.T) {
	s := New()
	ctx := context.Background()
	opts := application.ServiceOptions{}

	if err := s.ServiceStartup(ctx, opts); err != nil {
		t.Fatalf("ServiceStartup failed: %v", err)
	}

	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown failed: %v", err)
	}
}

func TestService_ImportSnapshot(t *testing.T) {
	s := New()
	ok, err := s.ImportSnapshot(`{"profiles": "[]"}`)
	if err != nil {
		t.Fatalf("ImportSnapshot failed: %v", err)
	}
	if !ok {
		t.Error("Expected ok true")
	}
}

// Nota: HasLegacyData e GetLegacyData dipendono dai path di sistema (XDG_CONFIG_HOME ecc.)
// e sono difficili da testare in modo deterministico senza mockare l'intero OS/pacchetto migrate.
// Qui testiamo che i metodi esistano e non panichino.
func TestService_Accessors(t *testing.T) {
	s := New()
	// Solo verifica che non panichino
	_ = s.HasLegacyData()
	_ = s.GetLegacyPath()
	_, _ = s.GetLegacyData()
}
