package logging

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

func TestParseLevelEnvDefaults(t *testing.T) {
	t.Setenv("STREAMAI_LOG_LEVEL", "")
	if got := parseLevelEnv(); got != zerolog.InfoLevel {
		t.Fatalf("default level: got %v, want InfoLevel", got)
	}
	t.Setenv("STREAMAI_LOG_LEVEL", "DEBUG")
	if got := parseLevelEnv(); got != zerolog.DebugLevel {
		t.Fatalf("DEBUG: got %v, want DebugLevel", got)
	}
	t.Setenv("STREAMAI_LOG_LEVEL", "garbage")
	if got := parseLevelEnv(); got != zerolog.InfoLevel {
		t.Fatalf("garbage falls back to info: got %v", got)
	}
	t.Setenv("STREAMAI_LOG_LEVEL", "disabled")
	if got := parseLevelEnv(); got != zerolog.Disabled {
		t.Fatalf("disabled: got %v", got)
	}
}

func TestResolveLogPathOverride(t *testing.T) {
	p, err := resolveLogPath("/tmp/foo.log", "streamai")
	if err != nil {
		t.Fatal(err)
	}
	if p != "/tmp/foo.log" {
		t.Fatalf("override not honored: %q", p)
	}
}

func TestResolveLogPathDefaultLinux(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	dir := t.TempDir()
	t.Setenv("XDG_STATE_HOME", dir)
	p, err := resolveLogPath("", "streamai")
	if err != nil {
		t.Fatal(err)
	}
	// Only assert on Linux/BSD where XDG_STATE_HOME applies.
	switch {
	case strings.Contains(p, dir):
		// good
	case strings.Contains(p, "Library/Logs"),
		strings.Contains(p, "AppData"):
		// macOS / Windows: XDG ignored by design
	default:
		t.Fatalf("unexpected default path: %q", p)
	}
}

func TestInitAndCrashReport(t *testing.T) {
	dir := t.TempDir()
	logPath := filepath.Join(dir, "streamai.log")
	t.Setenv("STREAMAI_LOG_FILE", logPath)
	t.Setenv("STREAMAI_LOG_LEVEL", "debug")
	t.Setenv("XDG_STATE_HOME", dir)

	got, err := Init(Options{AppID: "streamai"})
	if err != nil {
		t.Fatalf("Init: %v", err)
	}
	if got != logPath {
		t.Fatalf("Init returned %q, want %q", got, logPath)
	}
	defer func() { _ = Close() }()

	if LogFilePath() != logPath {
		t.Fatalf("LogFilePath %q != %q", LogFilePath(), logPath)
	}

	// Crash report deve finire nella sotto-cartella crashes/ accanto
	// al log principale (su Linux XDG_STATE_HOME).
	report, err := WriteCrashReport("streamai", "boom")
	if err != nil {
		t.Fatalf("WriteCrashReport: %v", err)
	}
	if !strings.Contains(report, "crashes") {
		t.Fatalf("crash path %q does not contain crashes/", report)
	}
	data, err := os.ReadFile(report)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "boom") {
		t.Fatalf("crash payload not written: %q", data)
	}
}

