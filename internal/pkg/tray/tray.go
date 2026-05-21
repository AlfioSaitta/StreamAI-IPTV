// Package tray — Fase 7-bis.5 del plan-go-wails-migration.
//
// System tray (Linux KDE/GNOME via libayatana-appindicator, Windows via
// Shell_NotifyIcon, macOS via NSStatusItem) costruito su
// application.SystemTrayManager di Wails v3.
//
// Comportamento (replica spec plan §7-bis.5):
//   - Tooltip "StreamAI IPTV"
//   - Icona 256×256 PNG embeddata (vedi internal/pkg/appicon)
//   - Click sull'icona: toggle show/hide della main window
//   - Menu:
//     · "Mostra finestra" / "Nascondi finestra" (label dinamica via
//       Update() su event window:focus/blur)
//     · "Apri cartella log" → apre dir contenente streamai.log via
//       xdg-open (Linux) / open (macOS) / explorer (Windows)
//     · separator
//     · "Esci" → app.Quit()
//
// Voci PiP/Pausa del piano sono rinviate (richiedono wiring backend↔
// frontend via Wails Events; il PlayerService di Fase 6 espone gli
// hook necessari ma non è ancora implementato). Quando saranno
// disponibili basterà aggiungere due MenuItem.OnClick() che emettono
// `wailsevents.Emit("tray:pip-toggle"|"tray:play-pause")`.
//
// Note OS:
//   - Linux: richiede `libayatana-appindicator3-1` runtime (già nei
//     depends per-distro, vedi build/depends/<distro>.json).
//   - macOS: l'icona dovrebbe essere "template" (monocromatica) per
//     adattarsi a light/dark mode; per ora usiamo l'icona colorata,
//     migrazione a SetTemplateIcon rinviata a Fase 9-bis.
package tray

import (
	"os/exec"
	"path/filepath"
	"runtime"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/appicon"
)

// MainWindowName è il nome (option Name) della WebviewWindow primaria,
// usato per ritrovarla via app.Window.GetByName("main").
const MainWindowName = "main"

// Setup crea il system tray e lo collega alla main window dell'app.
//
// Il parametro `logFilePath` può essere vuoto: in tal caso la voce
// "Apri cartella log" è disabilitata (utile in test/dev senza file sink).
//
// Ritorna il *SystemTray creato (per test/teardown manuale) o nil se
// la creazione fallisce. Non panica mai: errori vengono loggati e
// l'app continua senza tray (degradazione graceful).
func Setup(app *application.App, logFilePath string) *application.SystemTray {
	if app == nil {
		log.Warn().Msg("tray: app is nil, skipping setup")
		return nil
	}

	t := app.SystemTray.New()
	t.SetTooltip("StreamAI IPTV")
	t.SetIcon(appicon.AppIcon256)

	// Click sull'icona → toggle window. Su Windows è il left-click,
	// su macOS richiede OnClick (i NSStatusItem di default aprono il
	// menu); su Linux KDE Plasma fa lo stesso comportamento.
	t.OnClick(func() {
		toggleMainWindow(app)
	})

	// Menu
	menu := app.NewMenu()

	showItem := menu.Add("Mostra finestra")
	showItem.OnClick(func(_ *application.Context) {
		showMainWindow(app)
	})

	openLogItem := menu.Add("Apri cartella log")
	if logFilePath == "" {
		openLogItem.SetEnabled(false)
		openLogItem.SetTooltip("Logging file disabilitato (vedi STREAMAI_LOG_FILE)")
	} else {
		logDir := filepath.Dir(logFilePath)
		openLogItem.SetTooltip(logDir)
		openLogItem.OnClick(func(_ *application.Context) {
			if err := openPath(logDir); err != nil {
				log.Warn().Err(err).Str("path", logDir).Msg("tray: cannot open log folder")
			}
		})
	}

	menu.AddSeparator()

	quitItem := menu.Add("Esci")
	quitItem.SetAccelerator("CmdOrCtrl+Q")
	quitItem.OnClick(func(_ *application.Context) {
		log.Info().Msg("tray: quit requested via menu")
		app.Quit()
	})

	t.SetMenu(menu)
	log.Info().Bool("logMenu", logFilePath != "").Msg("tray: system tray ready")
	return t
}

func mainWindow(app *application.App) application.Window {
	w, ok := app.Window.GetByName(MainWindowName)
	if !ok || w == nil {
		return nil
	}
	return w
}

func showMainWindow(app *application.App) {
	w := mainWindow(app)
	if w == nil {
		log.Warn().Msg("tray: main window not found")
		return
	}
	w.Show()
	w.Focus()
}

func toggleMainWindow(app *application.App) {
	w := mainWindow(app)
	if w == nil {
		log.Warn().Msg("tray: main window not found")
		return
	}
	if w.IsVisible() && w.IsFocused() {
		w.Hide()
		return
	}
	w.Show()
	w.Focus()
}

// openPath apre `path` con il file manager / shell di default dell'OS.
// Best-effort: errori del sotto-processo bubble-up al chiamante.
func openPath(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", path) //nolint:gosec // path è sotto controllo nostro (log dir)
	case "windows":
		cmd = exec.Command("explorer", path) //nolint:gosec
	default:
		// Linux/BSD: xdg-open è lo standard freedesktop.
		cmd = exec.Command("xdg-open", path) //nolint:gosec
	}
	// Detach dal parent process: vogliamo che file manager resti aperto
	// anche se StreamAI viene chiuso subito dopo.
	return cmd.Start()
}

