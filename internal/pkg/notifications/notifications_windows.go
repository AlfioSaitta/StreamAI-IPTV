//go:build windows

package notifications

import (
	"os/exec"
)

func platformSend(title, message string) error {
	// Fallback PowerShell per Windows 10+
	ps, err := exec.LookPath("powershell")
	if err != nil {
		return err
	}
	
	// Utilizziamo argomenti per evitare problemi di escaping nelle stringhe
	script := `Param($title, $msg); [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); $obj = New-Object System.Windows.Forms.NotifyIcon; $obj.Icon = [System.Drawing.SystemIcons]::Information; $obj.Visible = $true; $obj.ShowBalloonTip(5000, $title, $msg, [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 1; $obj.Dispose()`
	
	cmd := exec.Command(ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script, "-title", title, "-msg", message)
	return cmd.Run()
}
