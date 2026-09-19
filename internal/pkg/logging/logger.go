// Package logging — Fase 7-bis.6 del plan-go-wails-migration.
//
// Inizializza un logger zerolog con dual-output:
//   - stderr (color console writer) per development / journald.
//   - file rotante via lumberjack (10 MB/file, 5 file, gzip).
//
// Livello configurabile via env STREAMAI_LOG_LEVEL=debug|info|warn|error|disabled
// (default: info). Override testuale anche tramite STREAMAI_LOG_FILE per
// puntare il sink file a un path custom (utile per CI/test).
//
// Path file di default (per OS):
//   - Linux/*BSD: $XDG_STATE_HOME/streamai/streamai.log
//     (fallback ~/.local/state/streamai/streamai.log)
//   - macOS:      ~/Library/Logs/StreamAI/streamai.log
//   - Windows:    %LOCALAPPDATA%\StreamAI\logs\streamai.log
//     (fallback %APPDATA%\StreamAI\logs\)
//
// Riferimenti:
//   - docs/plan-go-wails-migration.md §7-bis.6
//   - github.com/rs/zerolog
//   - gopkg.in/natefinch/lumberjack.v2
package logging

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"gopkg.in/natefinch/lumberjack.v2"
)

// Options configura l'inizializzazione del logger globale.
type Options struct {
	// AppID è il nome corto dell'app (default "streamai"). Determina la
	// sotto-cartella nei path di stato/log.
	AppID string
	// FilePath, se non vuoto, sovrascrive il path del file rotante.
	// Altrimenti viene calcolato in base all'OS (vedi DefaultLogPath).
	FilePath string
	// Level imposta il livello minimo. Se zero, viene letto da
	// STREAMAI_LOG_LEVEL (default info).
	Level zerolog.Level
	// HasLevel è true se Level è stato impostato esplicitamente
	// (per distinguere zerolog.DebugLevel == 0 dal default).
	HasLevel bool
	// MaxSizeMB, MaxBackups, MaxAgeDays, Compress configurano lumberjack.
	// I default replicano il plan §7-bis.6: 10 MB/file, 5 file, gzip.
	MaxSizeMB  int
	MaxBackups int
	MaxAgeDays int
	Compress   bool
	// DisableFile, se true, scrive solo su stderr (utile per test/CLI).
	DisableFile bool
}

// fileFlushInterval è la frequenza del flush del sink bufferizzato.
const fileFlushInterval = 2 * time.Second

// sinkBufferSize è la dimensione del buffer del sink file.
const sinkBufferSize = 64 << 10

var (
	sinkMu        sync.Mutex
	fileSink      *lumberjack.Logger
	buffered      *switchableSink
	flushStopChan chan struct{}
)

// switchableSink è il writer verso il file rotante, bufferizzato e
// disattivabile.
//
// Due motivi:
//   - lumberjack scrive con UNA syscall per riga: un burst di log (errori
//     proxy, discovery) diventava centinaia di write. Il buffer le coalesce e
//     un flusher periodico garantisce che nulla resti in RAM a lungo.
//   - dopo `Close()` il sink diventa un no-op. Prima, la prima riga scritta
//     dopo la chiusura faceva riaprire il file a lumberjack, ricreandolo dopo
//     che l'app aveva "chiuso" il logging (es. un ticker che logga durante lo
//     shutdown).
type switchableSink struct {
	mu      sync.Mutex
	buf     *bufio.Writer
	rotator *lumberjack.Logger
	closed  bool
}

func (s *switchableSink) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return len(p), nil // shutdown: scarta senza riaprire il file
	}
	return s.buf.Write(p)
}

// flush scrive su disco i dati bufferizzati.
func (s *switchableSink) flush() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	_ = s.buf.Flush()
}

// close fa il flush finale, chiude il rotatore e disattiva il sink.
func (s *switchableSink) close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	s.mu.Unlock()

	flushErr := s.buf.Flush()
	if err := s.rotator.Close(); err != nil {
		return err
	}
	return flushErr
}

// stopFlusher ferma il goroutine di flush periodico, se attivo. Idempotente.
func stopFlusher() {
	sinkMu.Lock()
	stop := flushStopChan
	flushStopChan = nil
	sinkMu.Unlock()
	if stop != nil {
		close(stop)
	}
}

// Init configura il logger globale di zerolog secondo opts. È idempotente:
// chiamate successive sostituiscono il logger globale (utile in test).
//
// Ritorna il path effettivo del file di log (o stringa vuota se DisableFile),
// così che il chiamante possa scriverlo nella crash-log o esporlo da menu.
func Init(opts Options) (logFile string, err error) {
	if opts.AppID == "" {
		opts.AppID = "streamai"
	}
	if opts.MaxSizeMB == 0 {
		opts.MaxSizeMB = 10
	}
	if opts.MaxBackups == 0 {
		opts.MaxBackups = 5
	}
	if !opts.HasLevel {
		opts.Level = parseLevelEnv()
	}

	// Override file path da env, se presente.
	if envPath := strings.TrimSpace(os.Getenv("STREAMAI_LOG_FILE")); envPath != "" {
		opts.FilePath = envPath
	}

	// Compress default → true (plan §7-bis.6).
	// Non possiamo usare lo zero-value perché bool zero == false sarebbe
	// indistinguibile da "voluto false"; lo lasciamo on-by-default qui.
	if !opts.Compress {
		opts.Compress = true
	}

	zerolog.TimeFieldFormat = time.RFC3339Nano
	zerolog.SetGlobalLevel(opts.Level)

	// `Init` può essere richiamato più volte (test, re-init): fermiamo il
	// flusher precedente prima di sostituire i sink.
	stopFlusher()

	// Il `ConsoleWriter` fa `json.Unmarshal` + colorize di OGNI riga: se stderr
	// non è un terminale (produzione avviata da .desktop, journald, file) è
	// puro costo senza alcun beneficio. In quel caso zerolog emette JSON, che è
	// anche il formato più utile nei log di sistema.
	var consoleOut io.Writer = os.Stderr
	if isTerminal(os.Stderr) {
		consoleOut = zerolog.ConsoleWriter{
			Out:        os.Stderr,
			TimeFormat: time.RFC3339,
			NoColor:    false,
		}
	}

	writers := []io.Writer{consoleOut}

	if !opts.DisableFile {
		path, perr := resolveLogPath(opts.FilePath, opts.AppID)
		if perr != nil {
			// Soft-fail: continua con solo console writer, ma logga il
			// fallimento (sul console writer già attivo).
			log.Logger = zerolog.New(consoleOut).With().Timestamp().Logger()
			log.Warn().Err(perr).Msg("logging: file sink disabled (path resolve failed)")
			return "", nil
		}
		// 0o750 e non 0o755: i log di un'app IPTV contengono URL di stream,
		// nomi di canali e (su errori del provider) frammenti di richieste.
		// Non c'è motivo per cui un altro utente della macchina debba poterli
		// leggere. gosec G301.
		if mkErr := os.MkdirAll(filepath.Dir(path), 0o750); mkErr != nil {
			log.Logger = zerolog.New(consoleOut).With().Timestamp().Logger()
			log.Warn().Err(mkErr).Str("path", path).Msg("logging: cannot create log dir")
			return "", nil
		}
		rotator := &lumberjack.Logger{
			Filename:   path,
			MaxSize:    opts.MaxSizeMB, // MB
			MaxBackups: opts.MaxBackups,
			MaxAge:     opts.MaxAgeDays, // days, 0 = no age cap
			Compress:   opts.Compress,
		}
		sink := &switchableSink{
			buf:     bufio.NewWriterSize(rotator, sinkBufferSize),
			rotator: rotator,
		}

		sinkMu.Lock()
		fileSink = rotator
		buffered = sink
		stop := make(chan struct{})
		flushStopChan = stop
		sinkMu.Unlock()

		writers = append(writers, sink)
		logFile = path

		go func() {
			t := time.NewTicker(fileFlushInterval)
			defer t.Stop()
			for {
				select {
				case <-stop:
					return
				case <-t.C:
					sink.flush()
				}
			}
		}()
	}

	multi := io.MultiWriter(writers...)
	log.Logger = zerolog.New(multi).With().Timestamp().Logger()
	return logFile, nil
}

// Close fa il flush finale e disattiva il file sink (no-op se DisableFile).
// Da chiamare in `defer` nel main per garantire flush su crash/exit.
//
// Dopo la Close le scritture sul sink file vengono scartate: una goroutine che
// logga durante lo shutdown non ricrea il file appena chiuso.
func Close() error {
	stopFlusher()

	sinkMu.Lock()
	sink := buffered
	buffered = nil
	fileSink = nil
	sinkMu.Unlock()

	if sink == nil {
		return nil
	}
	return sink.close()
}

// LogFilePath ritorna il path attualmente in uso dal file sink, o stringa
// vuota se non c'è. Utile per crash-log e UI "Apri cartella log".
func LogFilePath() string {
	sinkMu.Lock()
	defer sinkMu.Unlock()
	if fileSink == nil {
		return ""
	}
	return fileSink.Filename
}

// parseLevelEnv legge STREAMAI_LOG_LEVEL; default zerolog.InfoLevel.
func parseLevelEnv() zerolog.Level {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv("STREAMAI_LOG_LEVEL")))
	switch raw {
	case "trace":
		return zerolog.TraceLevel
	case "debug":
		return zerolog.DebugLevel
	case "info", "":
		return zerolog.InfoLevel
	case "warn", "warning":
		return zerolog.WarnLevel
	case "error":
		return zerolog.ErrorLevel
	case "fatal":
		return zerolog.FatalLevel
	case "panic":
		return zerolog.PanicLevel
	case "disabled", "off", "silent":
		return zerolog.Disabled
	default:
		return zerolog.InfoLevel
	}
}

// resolveLogPath calcola il path del file di log per l'OS corrente.
// Se override è non vuoto lo usa così com'è (espandendo ~).
func resolveLogPath(override, appID string) (string, error) {
	if override != "" {
		return expandHome(override)
	}
	switch runtime.GOOS {
	case "windows":
		// %LOCALAPPDATA%\StreamAI\logs\streamai.log
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = os.Getenv("APPDATA")
		}
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "StreamAI", "logs", appID+".log"), nil
	case "darwin":
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, "Library", "Logs", "StreamAI", appID+".log"), nil
	default:
		// $XDG_STATE_HOME/streamai/streamai.log
		base := os.Getenv("XDG_STATE_HOME")
		if base == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			base = filepath.Join(home, ".local", "state")
		}
		return filepath.Join(base, appID, appID+".log"), nil
	}
}

func expandHome(p string) (string, error) {
	if strings.HasPrefix(p, "~"+string(os.PathSeparator)) || p == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		return filepath.Join(home, p[1:]), nil
	}
	return p, nil
}

// isTerminal best-effort detection per disabilitare i colori quando lo
// stderr è rediretto a file/journald. Senza dipendere da `mattn/go-isatty`
// usiamo `Stat()`: char devices hanno ModeCharDevice.
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return (info.Mode() & os.ModeCharDevice) != 0
}

// WriteCrashReport scrive un report di crash sul file system (separato
// dal log rotante per facilitarne il pickup al prossimo avvio).
//
// Fase 7-bis.7: il chiamante (main.go in defer recover()) costruisce
// `payload` con stack trace + ultime info contestuali.
//
// Ritorna il path scritto; il file ha nome
// `crash-<unix-nano>.log` nella cartella crashes/ accanto al log
// principale (vedi resolveLogPath).
func WriteCrashReport(appID, payload string) (string, error) {
	if appID == "" {
		appID = "streamai"
	}
	base, err := resolveLogPath("", appID)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(filepath.Dir(base), "crashes")
	// 0o750 come la cartella dei log: i report di crash possono contenere
	// stack trace con URL e credenziali del provider. gosec G301.
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	name := fmt.Sprintf("crash-%d.log", time.Now().UnixNano())
	full := filepath.Join(dir, name)
	if err := os.WriteFile(full, []byte(payload), 0o600); err != nil {
		return "", err
	}
	return full, nil
}

// CrashReportsDir ritorna la directory dove WriteCrashReport scriverà i
// file. Utile per scansionarli al prossimo avvio (dialog opt-in "Invia
// report?" — plan §7-bis.7).
func CrashReportsDir(appID string) (string, error) {
	if appID == "" {
		appID = "streamai"
	}
	base, err := resolveLogPath("", appID)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(base), "crashes"), nil
}
