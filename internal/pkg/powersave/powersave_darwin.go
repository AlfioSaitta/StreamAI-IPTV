//go:build darwin

// powersave_darwin.go — backend `caffeinate` subprocess.
//
// Rationale: l'API "ufficiale" è IOPMAssertionCreateWithName del
// framework IOKit, ma richiede cgo + framework Linker flag — overhead
// di build sproporzionato per un'inhibition. macOS espone /usr/bin/
// caffeinate (Apple stock dal 2012) che wrappa esattamente quella
// API. Con il flag `-w <PID>` caffeinate aggancia la propria vita al
// PID specificato: se l'app crasha o esce senza fare Uninhibit,
// caffeinate riceve SIGCHLD-like e termina, rilasciando l'IOPM
// assertion → nessun leak di power-management state.
//
// In alternativa: `caffeinate -d` solo display, `-i` solo idle,
// `-d -s` display + system; usiamo `-d -i` per replicare il
// comportamento di SetThreadExecutionState (display + system).

package powersave

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
)

type inhibitState struct {
	cmd *exec.Cmd
}

func platformInhibit(_ string) (inhibitState, error) {
	cmd := exec.Command(
		"/usr/bin/caffeinate",
		"-d", // prevent display sleep
		"-i", // prevent idle sleep
		"-w", strconv.Itoa(os.Getpid()), // die when our PID dies
	)
	if err := cmd.Start(); err != nil {
		return inhibitState{}, fmt.Errorf("caffeinate start: %w", err)
	}
	// Reap della subprocess in background per evitare zombie se
	// l'app sopravvive (caso normale: termina con noi via -w).
	go func() { _ = cmd.Wait() }()
	return inhibitState{cmd: cmd}, nil
}

func platformUninhibit(s inhibitState) error {
	if s.cmd == nil || s.cmd.Process == nil {
		return nil
	}
	// Kill esplicito. Anche se caffeinate userebbe -w per terminare
	// con noi, vogliamo poter rilasciare l'inhibition al volo (es.
	// pause durante playback) senza chiudere l'intera app.
	if err := s.cmd.Process.Kill(); err != nil {
		return fmt.Errorf("caffeinate kill: %w", err)
	}
	return nil
}

