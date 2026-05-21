// Package main — Wails v3 entry point per StreamAI-IPTV.
//
// Architettura: vedi docs/plan-go-wails-migration.md §2.
// I servizi (discovery, advertising, cast, remote, netstatus, proxy, player)
// vivono in internal/services/<name>/ come application.Service v3, con
// metodi pubblici auto-bindati dal bindgen v3 (frontend/bindings/*.ts).
//
// Vincoli (vedi plan §"Vincoli funzionali non negoziabili"):
//   - Player integrato nel DOM (canvas WebGL2 + libmpv render-API).
//   - PiP funzionante su Linux + Windows + macOS.
//   - HEVC/AV1 HW-accelerated universale.
//   - 4K@60 fluido, AV drift |Δ| ≤ 40 ms.
package main

import (
	"errors"
	"os"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	rootassets "github.com/AlfioSaitta/StreamAI-IPTV"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/appicon"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/crashguard"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/devtools"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/logging"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/singleinstance"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/tray"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/advertising"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/cast"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/discovery"
	mediakeyssvc "github.com/AlfioSaitta/StreamAI-IPTV/internal/services/mediakeys"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/netstatus"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player"
	powersavesvc "github.com/AlfioSaitta/StreamAI-IPTV/internal/services/powersave"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/proxy"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/remote"
)


// Set at build time via -ldflags "-X main.version=...".
var (
	version   = "dev"
	commitSHA = ""
)

func main() {
	// Fase 7-bis.6 — logging: dual sink (stderr + lumberjack) attivo
	// PRIMA di ogni log.Printf, così single-instance e service wiring
	// finiscono nel file rotante. Soft-fail in caso di filesystem RO.
	logFile, _ := logging.Init(logging.Options{AppID: "streamai"})

	// Fase 7-bis.7 — crash recovery: defer top-level scrive un report
	// crash-<ts>.log nella cartella crashes/ accanto al log principale
	// e fa flush+exit ordinato. Va prima di qualsiasi panic possibile.
	defer crashguard.Recover("streamai", version, commitSHA)

	startedAt := time.Now()

	// Fase 7-bis.2 — Single-instance lock. Se un'altra istanza StreamAI
	// è già attiva per questo utente, lei riceve un "FOCUS" via Unix
	// socket e noi terminiamo con exit code 0 (UX coerente con Electron:
	// doppio click sull'icona = porta in primo piano la finestra esistente).
	//
	// La callback onFocus viene definita dopo la creazione di `app` per
	// poter chiamare app.Window operations. Per evitare l'ordine
	// circolare usiamo una variabile-puntatore catturata in chiusura.
	var appRef *application.App
	lock, err := singleinstance.Acquire("streamai", func() {
		if appRef == nil {
			return
		}
		// Porta la main window in foreground. Su Linux è equivalente a
		// `xdotool windowactivate`; su Wails v3 alpha.93 il modo
		// supportato è chiamare Show()+Focus() sulla finestra "main".
		w, ok := appRef.Window.GetByName("main")
		if ok && w != nil {
			w.Show()
			w.Focus()
		}
	})
	if errors.Is(err, singleinstance.ErrAlreadyRunning) {
		log.Info().Msg("StreamAI: another instance already running — focusing it and exiting")
		os.Exit(0)
	}
	if err != nil {
		log.Warn().Err(err).Msg("StreamAI: single-instance lock soft-fail (continuing without lock)")
	} else {
		defer func() { _ = lock.Release() }()
	}

	// Wiring Fase 4: remote (WS :1902) e netstatus (UDP multicast :1901)
	// sono accoppiati. netstatus.UpdatePlaybackStatus(s) inoltra anche ai
	// client WS via remote.BroadcastStatus, replicando il comportamento di
	// ipcMain.on('playback-status-update', …) in main.js.
	//
	// Fase 2-bis: il bridge DIAL state (netstatus → advertising) viene
	// passato a `netstatus.New` in costruzione, non più via setter
	// pubblico, per non esporre `DIALStateSetter` al binder Wails
	// (plan §3.4). Per questo costruiamo `advertisingSvc` prima di
	// `netstatusSvc`.
	remoteSvc := remote.New(0) // 0 → DefaultPort 1902
	advertisingSvc := advertising.New()
	advertisingSvc.SetAppVersion(version)
	netstatusSvc := netstatus.New(remoteSvc, advertisingSvc)

	app := application.New(application.Options{
		Name:        "StreamAI",
		Description: "AI-powered IPTV player — Wails v3 build",
		// Fase 7-bis.5 — icona dock/taskbar/about. 256×256 PNG embeddata
		// (vedi internal/pkg/appicon). Sufficiente per HiDPI fino a 4×.
		Icon: appicon.AppIcon256,
		// Ordine di registrazione studiato per il teardown (Fase 7-bis.1):
		// Wails v3 invoca ServiceShutdown in ordine inverso, quindi il
		// risultato effettivo allo shutdown è
		//   cast → remote → netstatus → advertising → proxy → player →
		//   powersave.
		// Rationale (plan §7-bis.1):
		//   - cast prima di remote: l'ultimo "status" WS deve poter
		//     uscire prima che il WS server :1902 chiuda i listener;
		//   - netstatus prima di advertising: smettiamo di annunciare
		//     stato playback prima di togliere i descriptor mDNS/SSDP;
		//   - proxy + player chiudono per ultimi tra i servizi
		//     "playback": HTTP listener IPTV e mpv_terminate_destroy()
		//     non devono dipendere da altri svc;
		//   - powersave per ultimo (registrato in cima): l'eventuale
		//     IOPMAssertion/DBus inhibition viene rilasciata DOPO che
		//     il player ha già fatto Stop(), così la pipeline
		//     "playerStop → screenSleepReleased" è observable in QA.
		//   - mediakeys subito sotto powersave: il bus name MPRIS deve
		//     restare valido finché il player può ancora emettere
		//     stati (PlayerService.Stop si propaga via SetStatus
		//     "Stopped" prima del unregister del bus name).
		// discovery non ha ServiceShutdown (scan on-demand), posizionato
		// alla fine — non altera l'ordine sopra.
		Services: []application.Service{
			application.NewService(powersavesvc.New()),
			application.NewService(mediakeyssvc.New()),
			application.NewService(player.New()),
			application.NewService(proxy.New()),
			application.NewService(advertisingSvc),
			application.NewService(netstatusSvc),
			application.NewService(remoteSvc),
			application.NewService(cast.New()),
			application.NewService(discovery.New()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(rootassets.FS),
		},
		// Linux: webview backend è scelto via build-tag (`gtk3` per
		// webkit2gtk-4.1 fallback, default webkitgtk-6.0). Vedi
		// plan §5.1 e build/depends/<distro>.json.
	})
	appRef = app // espone *App alla onFocus callback del single-instance lock

	// Fase 7-bis.1 — logging cold-start time. Wails dispatcha
	// events.Common.ApplicationStarted quando l'app è inizializzata
	// (Linux: g_application_activate; macOS: applicationDidFinishLaunching;
	// Windows: dopo WindowsApplicationStarted). Misuriamo qui il TTFP
	// (time-to-first-paint) per confrontarlo con la baseline Electron
	// (plan §1.3, target −60% RAM, cold-start ≤ Electron).
	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		log.Info().
			Dur("elapsed", time.Since(startedAt)).
			Str("version", version).
			Str("commit", commitSHA).
			Str("logfile", logFile).
			Msg("StreamAI: application started (Wails v3 ready)")
		// Fase 7-bis.5 — System tray. Va inizializzato DOPO
		// ApplicationStarted: su Linux/GTK la dbus connection per
		// libayatana-appindicator non è disponibile prima di
		// g_application_activate; su macOS NSStatusBar richiede che
		// NSApplication sia in stato active.
		tray.Setup(app, logFile)
	})

	// Fase 7-bis.10 — DevTools opt-in. In dev build (default
	// `go build`) Wails abilita già i DevTools; `STREAMAI_DEBUG=1`
	// li forza anche in build `production` per troubleshooting di
	// campo. Le key-bindings Ctrl+Shift+I / F12 sono inerti senza
	// opt-in (privacy in produzione).
	devToolsEnabled := devtools.Enabled()
	if devToolsEnabled {
		log.Info().Str("env", devtools.EnvVar).Msg("StreamAI: DevTools forced enabled via env opt-in")
	}

	// Finestra principale: stessa shape della shell Electron attuale.
	// Background #141414, no menu nativi (autoHideMenuBar in Electron).
	// In Wails v3 alpha.93 il pattern canonico (vedi examples/plain/main.go)
	// è `app.Window.NewWithOptions(...)`: registra la finestra nel WindowManager
	// dell'app prima di `app.Run()` così lo screen manager viene popolato
	// con i monitor reali quando GTK è pronto.
	_ = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "StreamAI",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        540,
		BackgroundColour: application.NewRGB(20, 20, 20), // #141414
		URL:              "/",
		DevToolsEnabled:  devToolsEnabled,
		KeyBindings:      devtools.KeyBindings(),
	})

	log.Info().
		Str("version", version).
		Str("commit", commitSHA).
		Msg("StreamAI: starting Wails v3")

	if err := app.Run(); err != nil {
		log.Error().Err(err).Msg("StreamAI failed to start")
		_ = logging.Close()
		os.Exit(1)
	}
	_ = logging.Close()
}

