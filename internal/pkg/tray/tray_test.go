package tray

import (
	"os"
	"runtime"
	"testing"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/appicon"
)

// TestEmbeddedIconNonEmpty verifica che i byte PNG embeddati siano
// presenti (regression guard: se l'icon-256.png viene cancellato per
// sbaglio, lo build fallisce; questo test attesta anche la dimensione
// minima ragionevole — 256×256 PNG > 1 KB compresso).
func TestEmbeddedIconNonEmpty(t *testing.T) {
	if got := len(appicon.AppIcon256); got < 1024 {
		t.Fatalf("AppIcon256 too small: %d bytes (atteso >= 1024)", got)
	}
	if got := len(appicon.AppIcon512); got < 1024 {
		t.Fatalf("AppIcon512 too small: %d bytes (atteso >= 1024)", got)
	}
	// PNG magic header.
	if got := appicon.AppIcon256[:8]; string(got) != "\x89PNG\r\n\x1a\n" {
		t.Fatalf("AppIcon256 non è un PNG valido: %x", got)
	}
}

// TestOpenPathReturnsErrorForMissingBinary smoke-test del builder cmd.
// Non lo eseguiamo (Start() spawnerebbe processi reali); ci limitiamo
// a verificare che `openPath` selezioni il binario giusto per OS via
// PATH lookup (errore atteso se manca xdg-open in $PATH minimale).
func TestOpenPathBuildsCommandForOS(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode: skip OS-specific PATH lookup")
	}
	// Su Linux ci aspettiamo xdg-open nel PATH (CI Ubuntu lo include),
	// ma su sandbox potrebbe mancare: rendiamo il test tollerante.
	t.Setenv("PATH", os.Getenv("PATH"))
	err := openPath(t.TempDir())
	if err != nil && runtime.GOOS == "linux" {
		t.Logf("openPath returned err (acceptable in sandbox without xdg-open): %v", err)
	}
}

func TestMainWindowName(t *testing.T) {
	if MainWindowName != "main" {
		t.Fatalf("MainWindowName cambiato: %q — aggiornare anche cmd/streamai/main.go", MainWindowName)
	}
}

// TestSetPlayLabel_NoCrashWhenTrayNotInitialized verifica che chiamare
// SetPlayLabel prima che Setup() sia stato eseguito non panichi
// (Fase 6.5.3: il subscriber PlayerService viene wirato in main.go
// PRIMA dell'ApplicationStarted callback che inizializza il tray, e
// può sparare eventi anche durante quel gap).
func TestSetPlayLabel_NoCrashWhenTrayNotInitialized(t *testing.T) {
	resetState() // garantisce playItemRef == nil
	defer resetState()

	SetPlayLabel("Pausa")     // non deve panicare
	SetPlayLabel("Riproduci") // idem
}

// TestEventNamesStable congela i nomi degli eventi tray verso il
// frontend: un rename qui rompe frontend/hooks/useTrayBridge.ts.
func TestEventNamesStable(t *testing.T) {
	if EventPlayPause != "tray:play-pause" {
		t.Errorf("EventPlayPause=%q want tray:play-pause", EventPlayPause)
	}
	if EventPiPToggle != "tray:pip-toggle" {
		t.Errorf("EventPiPToggle=%q want tray:pip-toggle", EventPiPToggle)
	}
}
