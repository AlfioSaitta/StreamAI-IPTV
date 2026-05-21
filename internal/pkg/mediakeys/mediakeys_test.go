package mediakeys

import (
	"testing"
)

func TestController_StartStopLifecycle(t *testing.T) {
	c := New(Callbacks{})
	if c.Started() {
		t.Fatal("new controller should not be started")
	}
	err := c.Start("StreamAI")
	if err != nil {
		t.Logf("Start failed (acceptable in sandbox without DBus session): %v", err)
		return
	}
	defer func() { _ = c.Stop() }()
	if !c.Started() {
		t.Fatal("Started() false after successful Start")
	}
	// Doppio Start = ErrAlreadyStarted.
	if err := c.Start("StreamAI"); err == nil {
		t.Fatal("second Start should return ErrAlreadyStarted")
	}
	// Stop + idempotenza.
	if err := c.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if c.Started() {
		t.Fatal("Started() true after Stop")
	}
	if err := c.Stop(); err != nil {
		t.Fatalf("Stop on inactive: %v", err)
	}
}

func TestController_SettersBeforeStart(t *testing.T) {
	// Tutti i setter devono essere safe anche prima di Start().
	c := New(Callbacks{})
	if err := c.SetStatus(StatusPaused); err != nil {
		t.Fatalf("SetStatus before Start: %v", err)
	}
	if err := c.SetMetadata(Metadata{Title: "Test"}); err != nil {
		t.Fatalf("SetMetadata before Start: %v", err)
	}
	if err := c.SetVolume(0.5); err != nil {
		t.Fatalf("SetVolume before Start: %v", err)
	}
	if err := c.SetCapabilities(DefaultCapabilities()); err != nil {
		t.Fatalf("SetCapabilities before Start: %v", err)
	}
}

func TestController_SetVolumeClamps(t *testing.T) {
	c := New(Callbacks{})
	_ = c.SetVolume(-0.5)
	if got := c.snapshot().volume; got != 0 {
		t.Fatalf("negative volume not clamped: %v", got)
	}
	_ = c.SetVolume(2.0)
	if got := c.snapshot().volume; got != 1 {
		t.Fatalf(">1 volume not clamped: %v", got)
	}
	_ = c.SetVolume(0.5)
	if got := c.snapshot().volume; got != 0.5 {
		t.Fatalf("valid volume changed: %v", got)
	}
}

func TestController_SetCallbacksAtomicSwap(t *testing.T) {
	c := New(Callbacks{})
	calls := make(chan string, 2)
	c.SetCallbacks(Callbacks{
		OnPlay:  func() { calls <- "play" },
		OnPause: func() { calls <- "pause" },
	})
	c.dispatchCallback(c.callbacks.OnPlay)
	c.dispatchCallback(c.callbacks.OnPause)
	got := []string{<-calls, <-calls}
	if !(got[0] == "play" || got[1] == "play") {
		t.Fatalf("OnPlay not dispatched, got %v", got)
	}
	if !(got[0] == "pause" || got[1] == "pause") {
		t.Fatalf("OnPause not dispatched, got %v", got)
	}
}

func TestController_DispatchNilCallbackSafe(t *testing.T) {
	c := New(Callbacks{})
	// Non deve panicare.
	c.dispatchCallback(c.callbacks.OnPlay)
}

func TestDefaultCapabilities(t *testing.T) {
	caps := DefaultCapabilities()
	if !caps.CanPlay || !caps.CanPause || !caps.CanControl {
		t.Fatalf("defaults broken: %+v", caps)
	}
	if caps.CanGoNext || caps.CanGoPrevious || caps.CanSeek {
		t.Fatalf("defaults should NOT enable next/previous/seek: %+v", caps)
	}
}

