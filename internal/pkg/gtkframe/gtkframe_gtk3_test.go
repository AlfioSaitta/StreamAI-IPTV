//go:build linux && gtk3 && gtkframetest

package gtkframe

import (
	"runtime"
	"testing"
	"time"
)

// Il meccanismo del workaround: una finestra con decorazioni disattivate
// (come la crea Wails per il PiP) deve ricevere una titlebar lato client, che è
// ciò che impedisce al compositor Wayland di disegnarne una propria.
//
// Verifica scoperta della finestra + applicazione della titlebar, cioè la
// parte che il test manuale con la sonda C non copre: qui passa per
// `gtk_window_list_toplevels()` e per le condizioni di guardia reali.
func TestApply_AddsTitlebarToFramelessWindow(t *testing.T) {
	// GTK vuole il main loop sul thread principale.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	const title = "streamai-gtkframe-test-frameless"
	if !createWindow(title, false) {
		t.Skip("nessun display disponibile: gtk_init_check fallita")
	}
	if hasTitlebar(title) {
		t.Fatal("precondizione: la finestra appena creata non deve avere titlebar")
	}

	Apply()

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		pump()
		if hasTitlebar(title) {
			return // titlebar applicata
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("Apply() non ha impostato la titlebar sulla finestra frameless entro il timeout")
}

// Le finestre DECORATE non vanno toccate: sono quelle normali (la finestra
// principale ha la titlebar di sistema) e aggiungerne una vuota lato client
// significherebbe una doppia barra.
func TestApply_LeavesDecoratedWindowAlone(t *testing.T) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	const title = "streamai-gtkframe-test-decorated"
	if !createWindow(title, true) {
		t.Skip("nessun display disponibile: gtk_init_check fallita")
	}

	Apply()

	deadline := time.Now().Add(1500 * time.Millisecond)
	for time.Now().Before(deadline) {
		pump()
		if hasTitlebar(title) {
			t.Fatal("Apply() ha messo una titlebar su una finestra decorata")
		}
		time.Sleep(20 * time.Millisecond)
	}
}
