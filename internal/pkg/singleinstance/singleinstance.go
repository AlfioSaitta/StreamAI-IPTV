// Package singleinstance impone un'unica istanza Wails di StreamAI per
// utente, replicando `app.requestSingleInstanceLock()` di Electron
// (E38 in docs/plan-go-wails-migration.md §"Fase 7-bis.2").
//
// Senza questo lock due istanze in parallelo competerebbero per:
//   - porta DIAL HTTP 8090 (advertising) → la seconda farebbe retry +1
//   - porta WS remote 1902 (remote.Service) → idem
//   - socket multicast UDP 1901 (netstatus) → entrambe riceverebbero i
//     propri broadcast e li droppano via deviceId filter, ma il doppio
//     traffico LAN è comunque spreco
//   - file lock IndexedDB / LevelDB del WebView (Fase 7-bis.8) → DATA-LOSS
//
// L'API è volutamente minimale:
//
//	lock, err := singleinstance.Acquire("streamai", func() {
//	    // chiamato in goroutine quando una seconda istanza tenta di partire:
//	    // mostra la finestra principale e portala in primo piano.
//	})
//	if errors.Is(err, singleinstance.ErrAlreadyRunning) {
//	    os.Exit(0) // la prima istanza ha ricevuto il focus, noi terminiamo
//	}
//	defer lock.Release()
//
// Implementazione corrente: Unix-only (Linux + macOS) tramite flock(2) +
// unix socket. Windows verrà coperto in 7-bis.2 estensione (CreateMutexW +
// named pipe) con build tag dedicato; il file `unsupported.go` fornisce
// uno stub no-op così il build cross-piattaforma resta verde.
package singleinstance

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ErrAlreadyRunning indica che un'altra istanza ha già il lock. Il
// chiamante dovrebbe terminare con exit code 0 (la prima istanza è
// stata notificata via IPC e ha portato in foreground la finestra).
var ErrAlreadyRunning = errors.New("singleinstance: another instance is already running")

// focusMessage è il payload IPC che la seconda istanza invia alla prima
// per chiedere "show & focus". Volutamente fisso e brevissimo: nessun
// parsing complesso, niente esposizione a payload arbitrari.
const focusMessage = "FOCUS\n"

// connectTimeout per la connessione al socket della prima istanza.
const connectTimeout = 2 * time.Second

// Lock rappresenta il lock acquisito. Va rilasciato con Release() al
// termine del processo (oppure, in pratica, il file lock viene rilasciato
// automaticamente quando il processo esce).
type Lock struct {
	mu         sync.Mutex
	lockFile   *os.File
	socketPath string
	listener   net.Listener
	stopped    chan struct{}
	released   bool
}

// runtimeDir ritorna la directory base per lock/socket per-utente.
// Preferenza:
//  1. $XDG_RUNTIME_DIR (tipicamente /run/user/<uid>) — wipe-on-reboot
//  2. /tmp/streamai-<uid>/ — fallback portable, sopravvive ai reboot
func runtimeDir(appID string) (string, error) {
	if rd := os.Getenv("XDG_RUNTIME_DIR"); rd != "" {
		if st, err := os.Stat(rd); err == nil && st.IsDir() {
			return rd, nil
		}
	}
	uid := os.Getuid()
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("%s-%d", appID, uid))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("singleinstance: mkdir %s: %w", dir, err)
	}
	return dir, nil
}

// paths ritorna lock e socket path per l'appID. Wrap esposto per i test.
func paths(appID string) (lockPath, sockPath string, err error) {
	if appID == "" || strings.ContainsAny(appID, "/\\") {
		return "", "", fmt.Errorf("singleinstance: invalid appID %q", appID)
	}
	dir, err := runtimeDir(appID)
	if err != nil {
		return "", "", err
	}
	return filepath.Join(dir, appID+".lock"),
		filepath.Join(dir, appID+".sock"),
		nil
}

// Acquire tenta di prendere il lock di unica istanza. Se un'altra
// istanza è già attiva:
//  1. apre il socket della prima e gli invia "FOCUS\n"
//  2. ritorna ErrAlreadyRunning (il chiamante deve fare os.Exit(0))
//
// Se il lock è libero (incluso "stale" — istanza precedente crashata
// senza Release), Acquire:
//  1. acquisisce flock(LOCK_EX|LOCK_NB) sul file lock
//  2. unlinka il socket stale e crea il nuovo listener Unix
//  3. lancia una goroutine che dispatcha onFocus su ogni "FOCUS\n"
//
// onFocus può essere nil (utile per test); se non-nil viene invocata
// in goroutine separata per evitare deadlock con il main loop Wails.
func Acquire(appID string, onFocus func()) (*Lock, error) {
	lockPath, sockPath, err := paths(appID)
	if err != nil {
		return nil, err
	}

	// Apri il file lock (crea se non esiste, 0600 = solo l'utente).
	f, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("singleinstance: open lock %s: %w", lockPath, err)
	}

	// Non-blocking exclusive flock. Se occupato, c'è già un'altra istanza.
	if err := tryFlock(f); err != nil {
		_ = f.Close()
		// Notifica la prima istanza, best-effort.
		_ = sendFocus(sockPath)
		return nil, ErrAlreadyRunning
	}

	// Scrivi PID nel lock file (debug; non usato per locking).
	_ = f.Truncate(0)
	_, _ = f.WriteAt([]byte(fmt.Sprintf("%d\n", os.Getpid())), 0)

	// Socket stale: se la prima istanza è crashata il file resta. Unlink
	// best-effort prima di ListenUnix.
	_ = os.Remove(sockPath)

	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		// Non-fatale: il lock è preso comunque, ma il "focus IPC" non
		// funzionerà — la seconda istanza riceverà ErrAlreadyRunning e
		// uscirà senza notificare. Acceptable degradation.
		l := &Lock{lockFile: f, socketPath: sockPath, stopped: make(chan struct{})}
		close(l.stopped)
		return l, nil
	}
	// Permessi: solo l'utente può scrivere.
	_ = os.Chmod(sockPath, 0o600)

	lock := &Lock{
		lockFile:   f,
		socketPath: sockPath,
		listener:   ln,
		stopped:    make(chan struct{}),
	}
	go lock.acceptLoop(onFocus)
	return lock, nil
}

// acceptLoop accetta connessioni IPC e dispatcha onFocus per ogni
// "FOCUS\n" ricevuto. Termina quando il listener viene chiuso.
func (l *Lock) acceptLoop(onFocus func()) {
	defer close(l.stopped)
	buf := make([]byte, 16)
	for {
		conn, err := l.listener.Accept()
		if err != nil {
			return // listener chiuso → exit loop
		}
		// Limite di lettura per evitare misuse (DoS con bytes infiniti).
		_ = conn.SetReadDeadline(time.Now().Add(connectTimeout))
		n, _ := conn.Read(buf)
		_ = conn.Close()
		if n > 0 && strings.HasPrefix(string(buf[:n]), "FOCUS") && onFocus != nil {
			go onFocus()
		}
	}
}

// Release chiude il listener, rilascia flock e rimuove il socket.
// Idempotente. Il file lock viene rilasciato automaticamente alla
// chiusura del descrittore o all'exit del processo.
func (l *Lock) Release() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.released {
		return nil
	}
	l.released = true
	if l.listener != nil {
		_ = l.listener.Close()
		<-l.stopped
	}
	_ = os.Remove(l.socketPath)
	if l.lockFile != nil {
		_ = unflock(l.lockFile)
		_ = l.lockFile.Close()
	}
	return nil
}

// SocketPath ritorna il path del socket IPC (utile per test).
func (l *Lock) SocketPath() string { return l.socketPath }

// sendFocus invia "FOCUS\n" al socket Unix indicato (la prima istanza).
// Best-effort: timeout di 2 s, errori non propagati al caller.
func sendFocus(sockPath string) error {
	d := net.Dialer{Timeout: connectTimeout}
	conn, err := d.Dial("unix", sockPath)
	if err != nil {
		return err
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetWriteDeadline(time.Now().Add(connectTimeout))
	_, err = conn.Write([]byte(focusMessage))
	return err
}

