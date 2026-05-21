// Package powersave — Fase 7-bis.3 del plan-go-wails-migration.
//
// Inhibitor cross-platform per impedire screen-sleep / system-sleep
// durante la riproduzione video.
//
// Backend per OS:
//   - Linux/*BSD: D-Bus session bus, org.freedesktop.ScreenSaver.Inhibit
//     (supportato da GNOME, KDE, XFCE, Cinnamon, MATE, Budgie, Hyprland,
//     swayidle ≥ 1.7). Fallback su `systemd-inhibit` rinviato — la
//     stragrande maggioranza dei desktop Linux espone già l'interfaccia
//     ScreenSaver sul session bus.
//   - Windows: SetThreadExecutionState(ES_CONTINUOUS|ES_DISPLAY_REQUIRED|
//     ES_SYSTEM_REQUIRED|ES_AWAYMODE_REQUIRED) via kernel32.dll.
//   - macOS: subprocess `caffeinate -d -w <PID>` (no cgo richiesto).
//     `caffeinate` è in /usr/bin in ogni macOS supportato (≥ 10.8).
//     L'opzione `-w` lo aggancia al PID del nostro processo: se l'app
//     crasha, caffeinate muore con noi (zero leak).
//   - Altri (BSD non-Linux, illumos…): no-op silenzioso, returns nil.
//
// API:
//
//	inh := powersave.New()
//	if err := inh.Inhibit("StreamAI video playback"); err != nil { ... }
//	defer inh.Uninhibit()
//	if inh.Active() { ... }
//
// L'oggetto è thread-safe (sync.Mutex) e Inhibit/Uninhibit sono
// idempotenti: chiamare Inhibit due volte consecutive non crea un
// secondo cookie (sarebbe leak). Chiamare Uninhibit su un Inhibitor
// inattivo è un no-op.
package powersave

import (
	"errors"
	"sync"

	"github.com/rs/zerolog/log"
)

// ErrAlreadyActive viene ritornato da Inhibit se è già attivo. È un
// soft-error: il chiamante può ignorarlo o loggarlo (l'inhibition
// resta in piedi col reason precedente).
var ErrAlreadyActive = errors.New("powersave: inhibitor already active")

// Inhibitor è lo handle opaco. Crearlo con New().
type Inhibitor struct {
	mu     sync.Mutex
	active bool
	reason string
	// state è platform-specific (cookie DBus su Linux, *exec.Cmd su
	// macOS, contatore implicito su Windows). Definito nei file
	// powersave_<os>.go.
	state inhibitState
}

// New ritorna un Inhibitor pronto all'uso. È economico: nessun
// syscall fino al primo Inhibit().
func New() *Inhibitor { return &Inhibitor{} }

// Inhibit acquisisce l'inhibition. `reason` è una stringa
// user-facing che il desktop environment può mostrare nei suoi
// pannelli (es. GNOME Settings → Power → "App active: <reason>").
//
// Errori:
//   - ErrAlreadyActive: già attivo (non sovrascrive). Soft-error.
//   - Altri: backend-specific (DBus non disponibile, kernel32 syscall
//     fallito, caffeinate non in PATH…). Sono best-effort: l'app deve
//     continuare anche se l'inhibition fallisce (UX-only, non
//     correctness-critical).
func (i *Inhibitor) Inhibit(reason string) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.active {
		return ErrAlreadyActive
	}
	if reason == "" {
		reason = "Video playback"
	}
	state, err := platformInhibit(reason)
	if err != nil {
		log.Warn().Err(err).Str("reason", reason).Msg("powersave: inhibit failed")
		return err
	}
	i.state = state
	i.active = true
	i.reason = reason
	log.Info().Str("reason", reason).Msg("powersave: inhibitor active")
	return nil
}

// Uninhibit rilascia l'inhibition. Idempotente: chiamarla su un
// Inhibitor inattivo è no-op (nil).
func (i *Inhibitor) Uninhibit() error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if !i.active {
		return nil
	}
	if err := platformUninhibit(i.state); err != nil {
		// Loggiamo ma resettiamo lo stato comunque: meglio "credere"
		// di aver rilasciato che lasciare l'inhibitor in zombie
		// state. L'OS può fare timeout naturale dell'inhibition.
		log.Warn().Err(err).Msg("powersave: uninhibit failed (resetting state anyway)")
	} else {
		log.Info().Str("reason", i.reason).Msg("powersave: inhibitor released")
	}
	i.state = inhibitState{}
	i.active = false
	i.reason = ""
	return nil
}

// Active ritorna true se l'inhibition è attualmente attiva.
func (i *Inhibitor) Active() bool {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.active
}

// Reason ritorna la stringa motivo dell'inhibition corrente (vuota
// se inattiva). Esposto per il binding al frontend (utile per UI
// debug / settings).
func (i *Inhibitor) Reason() string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.reason
}

