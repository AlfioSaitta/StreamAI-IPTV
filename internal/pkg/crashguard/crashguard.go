// Package crashguard — Fase 7-bis.7 del plan-go-wails-migration.
//
// Cattura panic top-level del main goroutine e scrive un report
// (stack trace + metadata + ultime log lines, se disponibili)
// nella cartella crash dello stato applicazione (via internal/pkg/logging).
//
// Uso canonico in cmd/streamai/main.go:
//
//	defer crashguard.Recover("streamai", version, commitSHA)
//
// In ogni goroutine separata (Service che fa go-routine long-running)
// ognuna deve avere il suo `defer crashguard.RecoverGoroutine(name)` —
// la versione top-level qui propaga l'exit code 1 dopo aver scritto il
// report; quella per goroutine si limita a loggare senza terminare il
// processo.
package crashguard

import (
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/logging"
)

// Recover è il defer top-level per main(). Cattura panic, scrive un
// crash report, fa flush del log file e termina con exit code 1.
//
// Non re-panica: il programma è ormai morto, l'esito atteso è "scrivi
// il report e muori in modo controllato".
func Recover(appID, version, commitSHA string) {
	r := recover()
	if r == nil {
		return
	}
	payload := buildPayload(r, version, commitSHA)
	path, err := logging.WriteCrashReport(appID, payload)
	if err != nil {
		// Best effort: stampa su stderr se non possiamo scrivere il file.
		fmt.Fprintf(os.Stderr, "crashguard: cannot write crash report: %v\n", err)
		fmt.Fprintln(os.Stderr, payload)
	} else {
		fmt.Fprintf(os.Stderr, "crashguard: crash report written to %s\n", path)
	}
	// Flush log file rotante.
	_ = logging.Close()
	os.Exit(1)
}

// RecoverGoroutine è il defer per goroutine non-main. Logga il panic
// (con stack trace) tramite zerolog e ritorna — il programma resta
// vivo, ma il logger registra l'evento.
func RecoverGoroutine(name string) {
	if r := recover(); r != nil {
		log.Error().
			Str("goroutine", name).
			Interface("panic", r).
			Bytes("stack", debug.Stack()).
			Msg("crashguard: goroutine panic recovered")
	}
}

func buildPayload(panicValue any, version, commitSHA string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "StreamAI crash report\n")
	fmt.Fprintf(&b, "=====================\n")
	fmt.Fprintf(&b, "Timestamp:   %s\n", time.Now().Format(time.RFC3339Nano))
	fmt.Fprintf(&b, "Version:     %s\n", nonEmpty(version, "dev"))
	fmt.Fprintf(&b, "Commit:      %s\n", nonEmpty(commitSHA, "unknown"))
	fmt.Fprintf(&b, "OS/Arch:     %s/%s\n", runtime.GOOS, runtime.GOARCH)
	fmt.Fprintf(&b, "Go version:  %s\n", runtime.Version())
	fmt.Fprintf(&b, "NumCPU:      %d\n", runtime.NumCPU())
	fmt.Fprintf(&b, "NumGoroutine:%d\n", runtime.NumGoroutine())
	fmt.Fprintf(&b, "Log file:    %s\n", nonEmpty(logging.LogFilePath(), "(not configured)"))
	fmt.Fprintf(&b, "\nPanic value:\n%v\n", panicValue)
	fmt.Fprintf(&b, "\nStack trace:\n%s\n", debug.Stack())
	return b.String()
}

func nonEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}

