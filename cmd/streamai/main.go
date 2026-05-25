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
	"net/http"
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
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/migration"
	notificationssvc "github.com/AlfioSaitta/StreamAI-IPTV/internal/services/notifications"
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
		defer func() {
			log.Info().Msg("StreamAI: releasing single-instance lock")
			_ = lock.Release()
			log.Info().Msg("StreamAI: single-instance lock released")
		}()
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
	migrationSvc := migration.New()
	notificationsSvc := notificationssvc.New()

	// Fase 6.5 — Service Go aggregati come variabili per poterli
	// "wirare" tra di loro dopo la registrazione (vedi blocco
	// playerStateWiring sotto la chiamata a app.New).
	playerSvc := player.New()
	powerSaveSvc := powersavesvc.New()
	mediaKeysSvc := mediakeyssvc.New()
	proxySvc := proxy.New()

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
			application.NewService(powerSaveSvc),
			application.NewService(mediaKeysSvc),
			application.NewService(playerSvc),
			application.NewService(proxySvc),
			application.NewService(advertisingSvc),
		application.NewService(netstatusSvc),
		application.NewService(migrationSvc),
		application.NewService(notificationsSvc),
		application.NewService(remoteSvc),
			application.NewService(cast.New()),
			application.NewService(discovery.New()),
		},
			Assets: application.AssetOptions{
				Handler: application.AssetFileServerFS(rootassets.FS),
				// FIX 2026-05-24 — Xtream "Load failed" su WebKitGTK.
				// La webview blocca le fetch cross-origin dal documento
				// `wails://wails.localhost` verso il proxy HTTP locale su
				// `http://127.0.0.1:<port>` per mixed-content. Esponiamo il
				// proxy come middleware dell'asset server così il frontend
				// può fare fetch a `/iptv-proxy?u=...` (same-origin),
				// bypassando i vincoli CORS/mixed-content della webview.
				//
				// Fase 6.1 Stage A (2026-05-24) — stessa logica per i frame
				// del native player: `/player/frame?w=W&h=H` ritorna i bytes
				// RGBA del frame corrente di libmpv. I due middleware sono
				// composti (proxy outer → player inner → assets); il match
				// di path è esclusivo (`/iptv-proxy` vs `/player/frame`),
				// quindi nessuna interferenza.
				Middleware: application.Middleware(chainMiddlewares(
					proxySvc.AssetMiddleware(),
					playerSvc.AssetMiddleware(),
				)),
			},
		// Linux: webview backend è scelto via build-tag (`gtk3` per
		// webkit2gtk-4.1 fallback, default webkitgtk-6.0). Vedi
		// plan §5.1 e build/depends/<distro>.json.
	})
	appRef = app // espone *App alla onFocus callback del single-instance lock

	// Fase 6.5 — Wiring PlayerService → PowerSave/MediaKeys/NetStatus.
	// Tutte le mutazioni di stato del player (Load/Play/Pause/Stop/Seek/
	// SetVolume/SetMuted + watcher 1s) generano un PlayerStateEvent
	// fanout-ato a 3 service Go integrazione-OS:
	//
	//   - PowerSave: inhibit display-sleep mentre lo stream e' in
	//     riproduzione (loaded && !paused); release altrimenti.
	//     Idempotente — PowerSave.Start ignora ErrAlreadyActive.
	//
	//   - MediaKeys: aggiorna lo stato MPRIS2 (Linux) / SMTC (Windows
	//     futuro) / MPNowPlaying (macOS futuro) con title/artist/
	//     position/duration → widget del DE mostra il titolo del canale
	//     IPTV e i tasti hw play/pause/next funzionano.
	//
	//   - NetStatus: broadcast multicast UDP :1901 sulla LAN con il
	//     payload IPTV → altri device StreamAI vedono "Cosa stai
	//     guardando" e possono fare hand-off via QR code.
	//
	// Le callback girano sincrone nel goroutine che ha generato l'evento:
	// teniamo il lavoro leggero (no I/O bloccante). PowerSave/MediaKeys/
	// NetStatus gia' fanno dispatch async internamente (D-Bus async,
	// UDP non-bloccante).
	//
	// Cleanup: gli unsubscribe non vengono chiamati esplicitamente
	// (l'app vive per tutto il process lifetime). All'app.Run() ritorna,
	// playerSvc.ServiceShutdown chiude il watcher e i subscriber
	// vengono GC'd col Service stesso.
	_ = playerSvc.Subscribe(func(evt player.PlayerStateEvent) {
		// PowerSave: inhibit display sleep se in play attivo.
		if evt.Loaded && !evt.Paused {
			if err := powerSaveSvc.Start("Video playback"); err != nil {
				// ErrAlreadyActive e' atteso quando il watcher 1s
				// rie-emette lo stesso state — niente log spam.
				log.Trace().Err(err).Msg("powersave.Start (already-active expected)")
			}
		} else {
			if err := powerSaveSvc.Stop(); err != nil {
				log.Trace().Err(err).Msg("powersave.Stop")
			}
		}

		// MediaKeys: aggiorna lo stato MPRIS2 + metadata.
		var status string
		switch {
		case !evt.Loaded:
			status = "stopped"
		case evt.Paused:
			status = "paused"
		default:
			status = "playing"
		}
		if err := mediaKeysSvc.SetPlaybackStatus(status); err != nil {
			log.Trace().Err(err).Msg("mediakeys.SetPlaybackStatus")
		}
		title := evt.TrackTitle
		if title == "" {
			title = "StreamAI"
		}
		_ = mediaKeysSvc.SetMetadata(mediakeyssvc.MetadataInput{
			Title:           title,
			Artist:          evt.TrackArtist,
			ArtURL:          evt.TrackArtURL,
			DurationSeconds: evt.Duration,
			TrackID:         evt.SourceURL,
		})

		// NetStatus: broadcast LAN.
		streamType := ""
		if evt.Duration > 0 {
			streamType = "movie" // duration > 0 → VOD/series
		} else if evt.Loaded {
			streamType = "live"
		}
		_ = netstatusSvc.UpdatePlaybackStatus(netstatus.PlaybackStatus{
			StreamURL:   evt.SourceURL,
			StreamTitle: evt.TrackTitle,
			StreamType:  streamType,
			Position:    evt.Position,
			Duration:    evt.Duration,
			IsPlaying:   evt.Loaded && !evt.Paused,
		})

		// Tray (Fase 6.5.3): aggiorna dinamicamente la label del menu
		// item "Riproduci/Pausa". No-op se il tray non è ancora stato
		// inizializzato (ApplicationStarted callback non ancora invocata)
		// o se siamo su un OS senza tray support (degradazione graceful).
		if evt.Loaded && !evt.Paused {
			tray.SetPlayLabel("Pausa")
		} else {
			tray.SetPlayLabel("Riproduci")
		}
	})

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
	log.Info().Msg("StreamAI: app.Run finished")
	_ = logging.Close()
}

// chainMiddlewares compone più middleware HTTP nell'ordine fornito: il
// primo middleware è il più esterno (il primo a vedere la request, l'ultimo
// a vedere la response), l'ultimo è il più interno (chiama `next` = asset
// server). Equivalente del pattern `func(next) → func(next) → ...`.
//
// Razionale Fase 6.1 Stage A: l'asset server Wails accetta UN solo
// middleware (`application.AssetOptions{ Middleware: ... }`). Per esporre
// sia `/iptv-proxy` (proxy.AssetMiddleware) sia `/player/frame`
// (player.AssetMiddleware) dobbiamo comporli in catena qui.
func chainMiddlewares(mws ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		// Applica in ordine inverso così il primo `mws[0]` resta più esterno.
		for i := len(mws) - 1; i >= 0; i-- {
			next = mws[i](next)
		}
		return next
	}
}
