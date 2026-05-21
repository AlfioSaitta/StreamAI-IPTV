package crashguard

import (
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

func TestBuildPayloadContainsContext(t *testing.T) {
	out := buildPayload("boom", "1.2.3", "deadbee")
	for _, want := range []string{
		"StreamAI crash report",
		"Version:     1.2.3",
		"Commit:      deadbee",
		"Panic value:",
		"boom",
		"Stack trace:",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("payload missing %q: %s", want, out)
		}
	}
}

func TestRecoverGoroutineSwallowsPanic(t *testing.T) {
	var sb strings.Builder
	var mu sync.Mutex
	log.Logger = zerolog.New(&syncWriter{w: &sb, mu: &mu})

	done := make(chan struct{})
	go func() {
		defer close(done)
		defer RecoverGoroutine("test-routine")
		panic("kaboom")
	}()
	<-done

	mu.Lock()
	got := sb.String()
	mu.Unlock()
	if !strings.Contains(got, "kaboom") {
		t.Fatalf("expected panic logged, got: %s", got)
	}
	if !strings.Contains(got, "test-routine") {
		t.Fatalf("expected goroutine name logged, got: %s", got)
	}
}

func TestNonEmpty(t *testing.T) {
	if got := nonEmpty("", "fb"); got != "fb" {
		t.Fatalf("empty: %q", got)
	}
	if got := nonEmpty(" \t ", "fb"); got != "fb" {
		t.Fatalf("whitespace: %q", got)
	}
	if got := nonEmpty("hi", "fb"); got != "hi" {
		t.Fatalf("set: %q", got)
	}
}

type syncWriter struct {
	w  *strings.Builder
	mu *sync.Mutex
}

func (s *syncWriter) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

