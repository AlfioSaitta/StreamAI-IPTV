//go:build linux || freebsd || openbsd || netbsd || dragonfly

// powersave_linux.go — backend D-Bus session per Linux/*BSD.
//
// Usa l'interfaccia freedesktop standard:
//
//	dbus-send --session --print-reply --dest=org.freedesktop.ScreenSaver \
//	  /org/freedesktop/ScreenSaver org.freedesktop.ScreenSaver.Inhibit \
//	  string:"StreamAI" string:"Video playback"
//
// Supportato out-of-the-box da GNOME, KDE Plasma, XFCE, Cinnamon,
// MATE, Budgie. Wayland compositors moderni (Hyprland, sway con
// swayidle ≥ 1.7) implementano lo stesso interface.

package powersave

import (
	"fmt"

	"github.com/godbus/dbus/v5"
)

const (
	dbusName  = "org.freedesktop.ScreenSaver"
	dbusPath  = "/org/freedesktop/ScreenSaver"
	dbusIface = "org.freedesktop.ScreenSaver"
)

// inhibitState contiene il cookie ritornato da Inhibit (da passare
// a UnInhibit per il rilascio). conn è il riferimento alla session
// bus connection, mantenuto vivo per la durata dell'inhibition.
type inhibitState struct {
	conn   *dbus.Conn
	cookie uint32
}

func platformInhibit(reason string) (inhibitState, error) {
	conn, err := dbus.SessionBus()
	if err != nil {
		return inhibitState{}, fmt.Errorf("dbus session bus: %w", err)
	}
	obj := conn.Object(dbusName, dbus.ObjectPath(dbusPath))
	var cookie uint32
	call := obj.Call(dbusIface+".Inhibit", 0, "StreamAI", reason)
	if call.Err != nil {
		// Non chiudiamo la conn — è condivisa (SessionBus restituisce
		// un singleton). Lasciamola al garbage collector.
		return inhibitState{}, fmt.Errorf("ScreenSaver.Inhibit: %w", call.Err)
	}
	if err := call.Store(&cookie); err != nil {
		return inhibitState{}, fmt.Errorf("ScreenSaver.Inhibit decode: %w", err)
	}
	return inhibitState{conn: conn, cookie: cookie}, nil
}

func platformUninhibit(s inhibitState) error {
	if s.conn == nil || s.cookie == 0 {
		return nil
	}
	obj := s.conn.Object(dbusName, dbus.ObjectPath(dbusPath))
	call := obj.Call(dbusIface+".UnInhibit", 0, s.cookie)
	if call.Err != nil {
		return fmt.Errorf("ScreenSaver.UnInhibit: %w", call.Err)
	}
	return nil
}

