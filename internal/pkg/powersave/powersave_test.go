package powersave

import (
	"errors"
	"testing"
)

// TestInhibitor_LifecyclePlatformAware verifica idempotenza Inhibit/
// Uninhibit + flag Active. Su Linux con DBus disponibile l'Inhibit
// dovrebbe riuscire; in sandbox CI senza session bus può fallire e
// quel path è soft (l'app continua a funzionare, vedi Inhibit docs).
func TestInhibitor_Lifecycle(t *testing.T) {
	inh := New()

	if inh.Active() {
		t.Fatal("new inhibitor should not be active")
	}
	if r := inh.Reason(); r != "" {
		t.Fatalf("new inhibitor reason should be empty, got %q", r)
	}

	err := inh.Inhibit("unit test reason")
	if err != nil {
		// Accept-il se DBus/caffeinate non disponibili nel sandbox:
		// è il comportamento documentato.
		t.Logf("Inhibit failed (acceptable in sandbox without DBus session): %v", err)
		if inh.Active() {
			t.Fatal("Active should be false after failed Inhibit")
		}
		return
	}
	defer func() { _ = inh.Uninhibit() }()

	if !inh.Active() {
		t.Fatal("Active should be true after successful Inhibit")
	}
	if r := inh.Reason(); r != "unit test reason" {
		t.Fatalf("Reason = %q, want %q", r, "unit test reason")
	}

	// Inhibit due volte deve essere idempotente (ErrAlreadyActive).
	err = inh.Inhibit("second reason")
	if !errors.Is(err, ErrAlreadyActive) {
		t.Fatalf("second Inhibit: got %v, want ErrAlreadyActive", err)
	}
	// Reason originale preservato.
	if r := inh.Reason(); r != "unit test reason" {
		t.Fatalf("Reason after second Inhibit changed: %q", r)
	}

	if err := inh.Uninhibit(); err != nil {
		t.Fatalf("Uninhibit: %v", err)
	}
	if inh.Active() {
		t.Fatal("Active should be false after Uninhibit")
	}

	// Uninhibit idempotente.
	if err := inh.Uninhibit(); err != nil {
		t.Fatalf("Uninhibit on inactive: %v", err)
	}
}

func TestInhibitor_EmptyReasonDefaults(t *testing.T) {
	inh := New()
	err := inh.Inhibit("")
	if err != nil {
		t.Logf("Inhibit('') failed (acceptable in sandbox): %v", err)
		return
	}
	defer func() { _ = inh.Uninhibit() }()
	if r := inh.Reason(); r != "Video playback" {
		t.Fatalf("empty reason default: got %q, want %q", r, "Video playback")
	}
}

