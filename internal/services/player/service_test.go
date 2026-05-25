// Test del dispatcher Service. Coprono lo stub backend (compilato di
// default, senza `-tags mpv`). Il backend cgo reale è coperto solo in
// integrazione (richiede libmpv installato + asset video di test, vedi
// tests/playback/4k-soak.sh — Fase 10 QA).
//
// Build constraint: questi test richiedono `stubBackend` (vedi
// volumeRecorder in fondo), che esiste solo quando il binario è
// compilato senza `-tags mpv`. Per testare il backend cgo eseguire
// integration suite in `tests/playback/`.

//go:build !mpv

package player

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestNew_ReturnsService(t *testing.T) {
	s := New()
	if s == nil {
		t.Fatal("New() returned nil")
	}
	if s.backend == nil {
		t.Fatal("New() did not initialize backend")
	}
}

func TestService_ServiceShutdown_Idempotent(t *testing.T) {
	s := New()
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("first shutdown: %v", err)
	}
	// Seconda chiamata: il backend è ancora presente (stubBackend.Close
	// è no-op) ma non deve panicare.
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("second shutdown: %v", err)
	}
}

// Verifica che TUTTI i metodi pubblici inoltrino correttamente l'errore
// del backend stub (errNotBuilt). Se aggiungiamo un metodo nuovo ma
// dimentichiamo di propagarlo dal Service al backend, qui salta fuori.
func TestService_StubBackend_PropagatesNotBuilt(t *testing.T) {
	s := New()

	cases := []struct {
		name string
		fn   func() error
	}{
		{"Load", func() error { return s.Load("http://example.com/stream.m3u8", nil) }},
		{"Play", s.Play},
		{"Pause", s.Pause},
		{"Stop", s.Stop},
		{"Seek", func() error { return s.Seek(42.0) }},
		{"SetVolume", func() error { return s.SetVolume(0.5) }},
		{"SetMuted", func() error { return s.SetMuted(true) }},
		{"SetSpeed", func() error { return s.SetSpeed(1.5) }},
		{"SetAid", func() error { return s.SetAid(1) }},
		{"SetSid", func() error { return s.SetSid(2) }},
		{"AddSub", func() error { return s.AddSub("/tmp/sub.srt") }},
		{"Resize", func() error { return s.Resize(1920, 1080) }},
		{"SetMaxBitrate", func() error { return s.SetMaxBitrate(5000) }},
		{"Tracks", func() error { _, err := s.Tracks(); return err }},
		{"BufferInfo", func() error { _, err := s.BufferInfo(); return err }},
		{"State", func() error { _, err := s.State(); return err }},
		{"RenderFrame", func() error { _, err := s.RenderFrame(1920, 1080); return err }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.fn()
			if !errors.Is(err, errNotBuilt) {
				t.Fatalf("expected errNotBuilt, got %v", err)
			}
			if !strings.Contains(err.Error(), "rebuild with -tags mpv") {
				t.Fatalf("error message should mention rebuild flag: %v", err)
			}
		})
	}
}

// SetVolume deve clampare l'input PRIMA di chiamare il backend.
// Verifichiamo intercettando la chiamata con un fake backend.
func TestService_SetVolume_Clamps(t *testing.T) {
	fake := &volumeRecorder{}
	s := &Service{backend: fake}

	cases := []struct {
		in, want float64
	}{
		{-0.5, 0},
		{0, 0},
		{0.7, 0.7},
		{1, 1},
		{1.5, 1},
		{42, 1},
	}
	for _, tc := range cases {
		if err := s.SetVolume(tc.in); err != nil {
			t.Fatalf("SetVolume(%v) error: %v", tc.in, err)
		}
		if fake.last != tc.want {
			t.Fatalf("SetVolume(%v): backend got %v, want %v", tc.in, fake.last, tc.want)
		}
	}
}

// Verifica thread-safety basica: 100 goroutine in parallelo non panicano
// e non lasciano il mutex bloccato.
func TestService_ConcurrentCalls(t *testing.T) {
	s := New()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = s.Play()
			_ = s.Pause()
			_, _ = s.State()
		}()
	}
	wg.Wait()
}

// --- fake backend per i test sopra ---

type volumeRecorder struct {
	stubBackend
	last float64
}

func (v *volumeRecorder) SetVolume(val float64) error {
	v.last = val
	return nil
}

// TestAssetMiddleware verifica il routing del middleware HTTP
// `/player/frame`: query param validation, propagazione di errNotBuilt
// come 503, passthrough verso `next` per path non match. Path RGBA happy
// non testabile qui (richiede backend mpv reale).
func TestAssetMiddleware_RoutesAndValidates(t *testing.T) {
	s := New()
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})
	h := s.AssetMiddleware()(next)

	tests := []struct {
		name       string
		path       string
		wantStatus int
		wantNext   bool
	}{
		{"passthrough unrelated path", "/foo/bar", http.StatusOK, true},
		{"missing w param", "/player/frame", http.StatusBadRequest, false},
		{"missing h param", "/player/frame?w=1280", http.StatusBadRequest, false},
		{"w too small", "/player/frame?w=8&h=720", http.StatusBadRequest, false},
		{"w too large", "/player/frame?w=9999&h=720", http.StatusBadRequest, false},
		{"h too small", "/player/frame?w=1280&h=8", http.StatusBadRequest, false},
		{"non-numeric w", "/player/frame?w=abc&h=720", http.StatusBadRequest, false},
		// Stub backend → errNotBuilt → 503.
		{"valid params, stub backend", "/player/frame?w=1280&h=720", http.StatusServiceUnavailable, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			called = false
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (body: %q)", rec.Code, tc.wantStatus, rec.Body.String())
			}
			if called != tc.wantNext {
				t.Fatalf("next handler called = %v, want %v", called, tc.wantNext)
			}
		})
	}
}

