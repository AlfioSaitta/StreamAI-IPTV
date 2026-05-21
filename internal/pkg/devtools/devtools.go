// Package devtools — Fase 7-bis.10 del plan-go-wails-migration.
//
// Decide se i DevTools (webview inspector) devono essere abilitati
// per la sessione corrente e fornisce le key-bindings che li aprono
// esplicitamente.
//
// Regole di abilitazione:
//
//   - Env `STREAMAI_DEBUG=1` → DevTools abilitati anche in build
//     `production`. Bypass esplicito per troubleshooting di campo:
//     un utente può lanciare l'app da terminale con
//     `STREAMAI_DEBUG=1 streamai` per inviare al maintainer
//     screenshots del Network panel o del Console log.
//
//   - Build senza tag `production` (default `go build`) → DevTools
//     già abilitati di default da Wails v3 (vedi
//     `WebviewWindowOptions.DevToolsEnabled` godoc), nessun env
//     necessario.
//
//   - Build con tag `production` (`go build -tags production`) e
//     `STREAMAI_DEBUG` non impostato → DevTools disabilitati,
//     key-bindings inerti (privacy).
//
// Note keyboard shortcuts:
//   - In tutti e 3 i webview (WebKitGTK 6.0, WebView2, WKWebView)
//     i shortcut `Ctrl+Shift+I` / `Cmd+Opt+I` e `F12` sono gestiti
//     nativamente dal webview quando DevTools sono abilitati.
//     Le KeyBindings di Wails sono un layer aggiuntivo di sicurezza:
//     funzionano anche se il webview non intercetta i tasti per
//     qualche motivo (focus su iframe sandbox, etc.).
package devtools

import (
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// EnvVar è il nome dell'env che forza l'abilitazione DevTools.
// Documentato in README "Troubleshooting".
const EnvVar = "STREAMAI_DEBUG"

// Enabled ritorna true se DevTools vanno abilitati per questa
// sessione (env opt-in). Quando false NON significa "DevTools
// chiusi" — in build dev Wails li attiva comunque; significa solo
// che NON forziamo l'abilitazione esplicita.
func Enabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(EnvVar)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// KeyBindings ritorna le accelerator → callback per la finestra:
// Ctrl+Shift+I e F12 aprono i DevTools della webview. Quando
// `Enabled() == false` ritorna nil così le bindings non vengono
// registrate (privacy in produzione).
//
// Sintassi accelerator Wails v3: vedi
// github.com/wailsapp/wails/v3/pkg/application/keys.go. Tokens:
// `cmdorctrl`, `shift`, `alt`, `option` (alias `alt` macOS),
// `i`, `f12`. Combinati con `+`.
func KeyBindings() map[string]func(window application.Window) {
	if !Enabled() {
		return nil
	}
	open := func(w application.Window) {
		if w == nil {
			return
		}
		w.OpenDevTools()
	}
	return map[string]func(application.Window){
		// Cross-platform: cmdorctrl si risolve a Cmd su macOS e
		// Ctrl su Linux/Windows automaticamente.
		"cmdorctrl+shift+i": open,
		"f12":               open,
	}
}

