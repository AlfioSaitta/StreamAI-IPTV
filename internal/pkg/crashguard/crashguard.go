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
	"os/signal"
	"runtime"
	"runtime/debug"
	"runtime/pprof"
	"strings"
	"syscall"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/rs/zerolog/log"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/logging"
)

// InitSignalHandler imposta il listener dei segnali FATALI del sistema
// operativo (SIGSEGV, SIGABRT). Quando uno viene catturato genera un report di
// crash con lo stack di TUTTE le goroutine e termina il processo re-inoltrando
// il segnale, così da preservare il comportamento nativo (core dump, exit code
// 128+signum) invece di forzare exit 1.
//
// I segnali di TERMINAZIONE (SIGINT, SIGTERM) NON sono trattati come crash:
// sono richieste ordinate di uscita (Ctrl-C, `kill`, logout, stop di systemd) e
// devono passare dallo shutdown di Wails — rilascio del lock di singola
// istanza, `sentry.Flush`, `ServiceShutdown` dei servizi, chiusura della
// webview e dei processi figli (mpv). Trattarli come fatali faceva uscire l'app
// con codice 1 saltando tutti i defer di `main`.
//
// Se `onTerminate` è non nil, viene invocato alla ricezione di SIGINT/SIGTERM
// (tipicamente `app.Quit()`); altrimenti quei segnali restano al comportamento
// di default del runtime Go.
//
// Va chiamato una sola volta all'avvio dell'applicazione.
func InitSignalHandler(appID, version, commitSHA string, onTerminate func()) {
	if onTerminate != nil {
		termSigs := make(chan os.Signal, 1)
		signal.Notify(termSigs, syscall.SIGINT, syscall.SIGTERM)
		go func() {
			sig := <-termSigs
			log.Info().
				Str("signal", sig.String()).
				Msg("Termination signal received, requesting graceful shutdown")
			onTerminate()
		}()
	}

	fatalSigs := make(chan os.Signal, 1)
	signal.Notify(fatalSigs, syscall.SIGSEGV, syscall.SIGABRT)

	go func() {
		sig := <-fatalSigs
		// Un segnale fatale è stato catturato. Generiamo il report con lo stack
		// di TUTTE le goroutine.
		payload := buildPayload(fmt.Sprintf("Fatal OS signal: %s", sig), version, commitSHA, true)

		// Scrivi il report su file, come per un panic normale.
		path, err := logging.WriteCrashReport(appID, payload)
		if err != nil {
			fmt.Fprintf(os.Stderr, "crashguard: cannot write signal crash report: %v\n", err)
			fmt.Fprintln(os.Stderr, payload)
		} else {
			fmt.Fprintf(os.Stderr, "crashguard: signal crash report written to %s\n", path)
		}

		// Invia l'evento a Sentry. Creiamo un errore ad-hoc per avere uno stack trace.
		sentry.WithScope(func(scope *sentry.Scope) {
			scope.SetLevel(sentry.LevelFatal)
			scope.SetTag("signal", sig.String())
			sentry.CaptureException(fmt.Errorf("caught signal: %s\n\n%s", sig, payload))
		})

		// Flush di Sentry e del logger prima di uscire.
		log.Error().Str("signal", sig.String()).Msg("Fatal signal caught, flushing logs and Sentry before exit.")
		sentry.Flush(5 * time.Second)
		_ = logging.Close()

		// Re-inoltro del segnale: con il handler ripristinato il kernel riprende
		// il comportamento di default (core dump se configurato, exit code
		// corretto) invece del nostro exit 1 che lo mascherava.
		signal.Reset(sig)
		if s, ok := sig.(syscall.Signal); ok {
			if err := syscall.Kill(syscall.Getpid(), s); err == nil {
				// Diamo al segnale il tempo di essere consegnato prima di
				// arrenderci con un exit esplicito.
				time.Sleep(500 * time.Millisecond)
			}
		}
		os.Exit(1)
	}()
}

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

	// Invia il panic a Sentry
	sentry.CaptureException(fmt.Errorf("%v", r))
	sentry.Flush(2 * time.Second) // Attende l'invio prima di uscire

	payload := buildPayload(r, version, commitSHA, false)
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
		// Invia il panic a Sentry
		sentry.WithScope(func(scope *sentry.Scope) {
			scope.SetTag("goroutine", name)
			sentry.CaptureException(fmt.Errorf("%v", r))
		})

		log.Error().
			Str("goroutine", name).
			Interface("panic", r).
			Bytes("stack", debug.Stack()).
			Msg("crashguard: goroutine panic recovered")
	}
}

func buildPayload(panicValue any, version, commitSHA string, allGoroutines bool) string {
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
	fmt.Fprintf(&b, "\nStack trace:\n")

	if allGoroutines {
		// Per i segnali OS, debug.Stack() mostra solo lo stack del gestore di segnali.
		// Usiamo pprof per ottenere uno snapshot di TUTTE le goroutine, che è molto più utile.
		_ = pprof.Lookup("goroutine").WriteTo(&b, 1)
	} else {
		// Per i panic Go, debug.Stack() è sufficiente e mostra lo stack della goroutine in panic.
		b.Write(debug.Stack())
	}

	return b.String()
}

func nonEmpty(s, fallback string) string {
	if strings.TrimSpace(s) == "" {
		return fallback
	}
	return s
}
