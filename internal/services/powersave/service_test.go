package powersave

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// TestService_LifecycleNoCrash verifica che il wrapper Service esposto
// a Wails non panichi sui lifecycle hook anche senza app montata
// (entrambi sono no-op nel nostro design).
func TestService_LifecycleNoCrash(t *testing.T) {
	s := New()
	// ServiceStartup deve essere no-op (lazy init).
	if err := s.ServiceStartup(nil, application.ServiceOptions{}); err != nil {
		t.Fatalf("ServiceStartup: %v", err)
	}

	if s.Active() {
		t.Fatal("Service should not be active before Start")
	}

	// Start può fallire nei sandbox: tolleriamolo.
	err := s.Start("test")
	if err == nil {
		if !s.Active() {
			t.Fatal("Active false after successful Start")
		}
		if err := s.Stop(); err != nil {
			t.Fatalf("Stop: %v", err)
		}
		if s.Active() {
			t.Fatal("Active true after Stop")
		}
	} else {
		t.Logf("Start failed (acceptable in sandbox): %v", err)
	}

	// ServiceShutdown deve essere idempotente.
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown: %v", err)
	}
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown (second): %v", err)
	}
}


