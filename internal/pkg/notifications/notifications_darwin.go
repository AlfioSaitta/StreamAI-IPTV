//go:build darwin

package notifications

import (
	"os/exec"
)

func platformSend(title, message string) error {
	// Fallback osascript per macOS
	cmd := exec.Command("osascript", "-e", `display notification "`+message+`" with title "`+title+`"`)
	return cmd.Run()
}
