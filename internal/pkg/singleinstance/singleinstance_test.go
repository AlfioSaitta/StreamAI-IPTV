// Tests for the singleinstance package (Fase 7-bis.2).
package singleinstance

import (
	"errors"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// withTempRuntime forza XDG_RUNTIME_DIR a una tempdir, così i test non
// inquinano /run/user/<uid> e possono girare in parallelo CI senza
// stomp sui lock condivisi.
func withTempRuntime(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_RUNTIME_DIR", dir)
	return dir
}

func TestAcquire_FirstInstance(t *testing.T) {
	withTempRuntime(t)
	lock, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire #1: %v", err)
	}
	defer func() { _ = lock.Release() }()

	if lock.SocketPath() == "" {
		t.Error("SocketPath should be set after Acquire")
	}
	if _, err := os.Stat(lock.SocketPath()); err != nil {
		t.Errorf("socket not created: %v", err)
	}
}

func TestAcquire_SecondInstance_ErrAlreadyRunning(t *testing.T) {
	withTempRuntime(t)
	lock1, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire #1: %v", err)
	}
	defer func() { _ = lock1.Release() }()

	lock2, err := Acquire("streamai-test", nil)
	if !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("expected ErrAlreadyRunning, got %v (lock2=%v)", err, lock2)
	}
}

func TestAcquire_FocusIPC(t *testing.T) {
	withTempRuntime(t)
	var focusCalls atomic.Int32
	done := make(chan struct{}, 1)
	lock1, err := Acquire("streamai-test", func() {
		focusCalls.Add(1)
		select {
		case done <- struct{}{}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("Acquire #1: %v", err)
	}
	defer func() { _ = lock1.Release() }()

	// La seconda istanza deve fallire con ErrAlreadyRunning E aver
	// notificato la prima via IPC.
	_, err = Acquire("streamai-test", nil)
	if !errors.Is(err, ErrAlreadyRunning) {
		t.Fatalf("Acquire #2 = %v, want ErrAlreadyRunning", err)
	}

	select {
	case <-done:
		// ok
	case <-time.After(2 * time.Second):
		t.Fatal("onFocus callback never invoked after second Acquire")
	}
	if focusCalls.Load() != 1 {
		t.Errorf("focusCalls = %d, want 1", focusCalls.Load())
	}
}

func TestRelease_AllowsReacquire(t *testing.T) {
	withTempRuntime(t)
	lock1, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire #1: %v", err)
	}
	if err := lock1.Release(); err != nil {
		t.Fatalf("Release: %v", err)
	}

	// Dopo Release la prossima Acquire deve riuscire.
	lock2, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire #2 after Release: %v", err)
	}
	defer func() { _ = lock2.Release() }()
}

func TestRelease_Idempotent(t *testing.T) {
	withTempRuntime(t)
	lock, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Fatalf("first Release: %v", err)
	}
	if err := lock.Release(); err != nil {
		t.Errorf("double Release should be no-op, got %v", err)
	}
}

func TestPaths_InvalidAppID(t *testing.T) {
	withTempRuntime(t)
	if _, _, err := paths(""); err == nil {
		t.Error("empty appID should fail")
	}
	if _, _, err := paths("../escape"); err == nil {
		t.Error("appID with slashes should fail")
	}
}

func TestPaths_UsesXDGRuntimeDir(t *testing.T) {
	dir := withTempRuntime(t)
	lockPath, sockPath, err := paths("streamai-test")
	if err != nil {
		t.Fatalf("paths: %v", err)
	}
	if filepath.Dir(lockPath) != dir {
		t.Errorf("lock dir = %s, want %s", filepath.Dir(lockPath), dir)
	}
	if filepath.Dir(sockPath) != dir {
		t.Errorf("sock dir = %s, want %s", filepath.Dir(sockPath), dir)
	}
}

func TestAcquire_StaleSocketReused(t *testing.T) {
	withTempRuntime(t)
	// Simula crash della prima istanza: crea solo il file socket
	// (senza lock né listener attivo).
	_, sockPath, _ := paths("streamai-test")
	f, err := os.Create(sockPath)
	if err != nil {
		t.Fatalf("create stale socket: %v", err)
	}
	_ = f.Close()

	// La nuova istanza deve riuscire: lock libero (no flock prima) e
	// socket stale unlinkato.
	lock, err := Acquire("streamai-test", nil)
	if err != nil {
		t.Fatalf("Acquire over stale socket: %v", err)
	}
	defer func() { _ = lock.Release() }()
}

