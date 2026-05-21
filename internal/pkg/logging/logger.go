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
//                 (fallback ~/.local/state/streamai/streamai.log)
//   - macOS:      ~/Library/Logs/StreamAI/streamai.log
//   - Windows:    %LOCALAPPDATA%\StreamAI\logs\streamai.log
//                 (fallback %APPDATA%\StreamAI\logs\)
//
// Riferimenti:
//   - docs/plan-go-wails-migration.md §7-bis.6
//   - github.com/rs/zerolog
//   - gopkg.in/natefinch/lumberjack.v2
package logging

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
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

// fileSink è il sink rotante condiviso, esposto per Close() su shutdown.
var fileSink *lumberjack.Logger

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

	consoleWriter := zerolog.ConsoleWriter{
		Out:        os.Stderr,
		TimeFormat: time.RFC3339,
		NoColor:    !isTerminal(os.Stderr),
	}

	writers := []io.Writer{consoleWriter}

	if !opts.DisableFile {
		path, perr := resolveLogPath(opts.FilePath, opts.AppID)
		if perr != nil {
			// Soft-fail: continua con solo console writer, ma logga il
			// fallimento (sul console writer già attivo).
			log.Logger = zerolog.New(consoleWriter).With().Timestamp().Logger()
			log.Warn().Err(perr).Msg("logging: file sink disabled (path resolve failed)")
			return "", nil
		}
		if mkErr := os.MkdirAll(filepath.Dir(path), 0o755); mkErr != nil {
			log.Logger = zerolog.New(consoleWriter).With().Timestamp().Logger()
			log.Warn().Err(mkErr).Str("path", path).Msg("logging: cannot create log dir")
			return "", nil
		}
		fileSink = &lumberjack.Logger{
			Filename:   path,
			MaxSize:    opts.MaxSizeMB, // MB
			MaxBackups: opts.MaxBackups,
			MaxAge:     opts.MaxAgeDays, // days, 0 = no age cap
			Compress:   opts.Compress,
		}
		writers = append(writers, fileSink)
		logFile = path
	}

	multi := io.MultiWriter(writers...)
	log.Logger = zerolog.New(multi).With().Timestamp().Logger()
	return logFile, nil
}

// Close sincronizza il file sink (no-op se DisableFile). Da chiamare in
// `defer` nel main per garantire flush su crash/exit.
func Close() error {
	if fileSink == nil {
		return nil
	}
	err := fileSink.Close()
	fileSink = nil
	return err
}

// LogFilePath ritorna il path attualmente in uso dal file sink, o stringa
// vuota se non c'è. Utile per crash-log e UI "Apri cartella log".
func LogFilePath() string {
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
	if err := os.MkdirAll(dir, 0o755); err != nil {
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

