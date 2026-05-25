//go:build linux

package notifications

import (
	"github.com/godbus/dbus/v5"
)

func platformSend(title, message string) error {
	conn, err := dbus.SessionBus()
	if err != nil {
		return err
	}

	obj := conn.Object("org.freedesktop.Notifications", "/org/freedesktop/Notifications")
	
	// Notify(app_name, replaces_id, app_icon, summary, body, actions, hints, expire_timeout)
	call := obj.Call("org.freedesktop.Notifications.Notify", 0,
		"StreamAI",           // app_name
		uint32(0),            // replaces_id
		"",                   // app_icon
		title,                // summary
		message,              // body
		[]string{},           // actions
		map[string]dbus.Variant{}, // hints
		int32(-1),            // expire_timeout (-1 = default)
	)
	return call.Err
}
