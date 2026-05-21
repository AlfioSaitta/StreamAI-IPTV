//go:build windows

// powersave_windows.go — backend SetThreadExecutionState.
//
// Documentazione MSDN:
//
//	https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setthreadexecutionstate
//
// Flag usati:
//   - ES_CONTINUOUS         (0x80000000): la richiesta resta attiva finché
//                           non viene esplicitamente revocata con un'altra
//                           chiamata ES_CONTINUOUS.
//   - ES_DISPLAY_REQUIRED   (0x00000002): impedisce lo screen sleep.
//   - ES_SYSTEM_REQUIRED    (0x00000001): impedisce il system sleep.
//   - ES_AWAYMODE_REQUIRED  (0x00000040): valido solo se la macchina è
//                           configurata per "Away Mode" (TV/media center
//                           power plan). Su desktop standard il flag è
//                           ignorato silenziosamente, quindi sicuro
//                           includerlo.
//
// Note thread-affinity:
//   - SetThreadExecutionState è per-thread su Windows < 10.
//     Per essere robusti chiamiamo da una goroutine lockata al thread
//     OS, ma essendo la stessa chiamata da entrambi i lati (inhibit/
//     uninhibit) il resultato è coerente.

package powersave

import (
	"errors"
	"runtime"
	"syscall"

	"golang.org/x/sys/windows"
)

const (
	esContinuous      = 0x80000000
	esDisplayRequired = 0x00000002
	esSystemRequired  = 0x00000001
	esAwayModeNeeded  = 0x00000040
)

type inhibitState struct {
	prevFlags uint32
}

func platformInhibit(_ string) (inhibitState, error) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	proc := kernel32.NewProc("SetThreadExecutionState")
	flags := uint32(esContinuous | esDisplayRequired | esSystemRequired | esAwayModeNeeded)
	prev, _, err := proc.Call(uintptr(flags))
	if prev == 0 {
		// Su SetThreadExecutionState `0` indica errore. Per Win10+
		// l'errno è esposto via GetLastError().
		if !errors.Is(err, syscall.Errno(0)) {
			return inhibitState{}, err
		}
		return inhibitState{}, errors.New("SetThreadExecutionState returned 0 (unknown)")
	}
	return inhibitState{prevFlags: uint32(prev)}, nil
}

func platformUninhibit(_ inhibitState) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	proc := kernel32.NewProc("SetThreadExecutionState")
	// Reset a ES_CONTINUOUS soltanto: rimuove le richieste display +
	// system, ripristinando il comportamento di power management
	// standard del sistema operativo.
	prev, _, err := proc.Call(uintptr(esContinuous))
	if prev == 0 && !errors.Is(err, syscall.Errno(0)) {
		return err
	}
	return nil
}

