// e2e_test.go — verifica end-to-end MPRIS2 con gdbus / playerctl.
// Skip se il binario non è disponibile o DBus session non presente.

//go:build linux

package mediakeys

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestE2E_MprisAdvertisedToSessionBus(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	if _, err := exec.LookPath("gdbus"); err != nil {
		t.Skip("gdbus not in PATH")
	}
	c := New(Callbacks{})
	if err := c.Start("StreamAITest"); err != nil {
		t.Skipf("Start failed (no session bus?): %v", err)
	}
	defer func() { _ = c.Stop() }()

	// Attendi che la registrazione sia visibile.
	time.Sleep(150 * time.Millisecond)

	out, err := exec.Command("gdbus", "introspect", "--session",
		"--dest", "org.mpris.MediaPlayer2.streamaitest",
		"--object-path", "/org/mpris/MediaPlayer2").CombinedOutput()
	if err != nil {
		t.Fatalf("gdbus introspect failed: %v\n%s", err, out)
	}
	s := string(out)
	for _, want := range []string{
		"org.mpris.MediaPlayer2",
		"org.mpris.MediaPlayer2.Player",
		"Play",
		"Pause",
		"PlayPause",
		"Seek",
		"PlaybackStatus",
		"Identity",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("introspection missing %q\nfull output:\n%s", want, s)
		}
	}
}

func TestE2E_MethodCallDispatchesCallback(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	if _, err := exec.LookPath("gdbus"); err != nil {
		t.Skip("gdbus not in PATH")
	}
	got := make(chan string, 5)
	c := New(Callbacks{
		OnPlay:  func() { got <- "play" },
		OnPause: func() { got <- "pause" },
		OnNext:  func() { got <- "next" },
	})
	if err := c.Start("StreamAIDispatch"); err != nil {
		t.Skipf("Start failed: %v", err)
	}
	defer func() { _ = c.Stop() }()
	time.Sleep(150 * time.Millisecond)

	for _, m := range []string{"Play", "Pause", "Next"} {
		if out, err := exec.Command("gdbus", "call", "--session",
			"--dest", "org.mpris.MediaPlayer2.streamaidispatch",
			"--object-path", "/org/mpris/MediaPlayer2",
			"--method", "org.mpris.MediaPlayer2.Player."+m).CombinedOutput(); err != nil {
			t.Fatalf("gdbus call %s: %v\n%s", m, err, out)
		}
	}

	select {
	case ev := <-got:
		if ev != "play" {
			t.Fatalf("first callback = %q, want play", ev)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for OnPlay")
	}
}

