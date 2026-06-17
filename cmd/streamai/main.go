// Package main — Wails v3 entry point per StreamAI-IPTV.
package main

import (
	"errors"
	"net/http"
	"os"
	"runtime"
	"time"

	"github.com/getsentry/sentry-go"
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
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/migration"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/netstatus"
	notificationssvc "github.com/AlfioSaitta/StreamAI-IPTV/internal/services/notifications"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/playlist"
	powersavesvc "github.com/AlfioSaitta/StreamAI-IPTV/internal/services/powersave"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/proxy"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/remote"
)

var (
	version   = "dev"
	commitSHA = ""
)

func main() {
	runtime.LockOSThread()
	initProfiling()

	err := sentry.Init(sentry.ClientOptions{
		Dsn:              "https://1ed61c33c431587bec1c76a3db950908@o4508166622806016.ingest.de.sentry.io/4511451808006224",
		EnableTracing:    true,
		TracesSampleRate: 1.0,
		Release:          version,
	})
	if err != nil {
		log.Error().Err(err).Msg("sentry.Init failed")
	}
	defer sentry.Flush(2 * time.Second)

	crashguard.InitSignalHandler("streamai", version, commitSHA)
	logFile, _ := logging.Init(logging.Options{AppID: "streamai"})
	defer crashguard.Recover("streamai", version, commitSHA)
	defer sentry.Recover()

	startedAt := time.Now()

	var appRef *application.App
	lock, err := singleinstance.Acquire("streamai", func() {
		if appRef == nil {
			return
		}
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
		}()
	}

	remoteSvc := remote.New(0)
	advertisingSvc := advertising.New()
	advertisingSvc.SetAppVersion(version)
	netstatusSvc := netstatus.New(remoteSvc, advertisingSvc)
	migrationSvc := migration.New()
	notificationsSvc := notificationssvc.New()
	playerSvc := player.New()
	powerSaveSvc := powersavesvc.New()
	mediaKeysSvc := mediakeyssvc.New()
	proxySvc := proxy.New()
	playlistSvc := playlist.New()
	castSvc := cast.New()
	discoverySvc := discovery.New()

	app := application.New(application.Options{
		Name:        "StreamAI",
		Description: "AI-powered IPTV player — Wails v3 build",
		Icon:        appicon.AppIcon256,
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
			application.NewService(castSvc),
			application.NewService(discoverySvc),
			application.NewService(playlistSvc),
		},
		OnShutdown: func() {
			log.Info().Msg("StreamAI: application shutdown triggered (watchdog active)")
			time.AfterFunc(5*time.Second, func() {
				log.Error().Msg("StreamAI: shutdown timeout reached! forcing exit to avoid freeze")
				os.Exit(1)
			})
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(rootassets.FS),
			Middleware: application.Middleware(chainMiddlewares(
				proxySvc.AssetMiddleware(),
				playerSvc.AssetMiddleware(),
			)),
		},
	})
	appRef = app

	_ = playerSvc.Subscribe(func(evt player.PlayerStateEvent) {
		go func() {
			if evt.Loaded && !evt.Paused {
				if err := powerSaveSvc.Start("Video playback"); err != nil {
					log.Trace().Err(err).Msg("powersave.Start (already-active expected)")
				}
			} else {
				if err := powerSaveSvc.Stop(); err != nil {
					log.Trace().Err(err).Msg("powersave.Stop")
				}
			}

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

			streamType := ""
			if evt.Duration > 0 {
				streamType = "movie"
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

			if evt.Loaded && !evt.Paused {
				tray.SetPlayLabel("Pausa")
			} else {
				tray.SetPlayLabel("Riproduci")
			}
		}()
	})

	app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(_ *application.ApplicationEvent) {
		log.Info().
			Dur("elapsed", time.Since(startedAt)).
			Str("version", version).
			Str("commit", commitSHA).
			Str("logfile", logFile).
			Msg("StreamAI: application started (Wails v3 ready)")
		tray.Setup(app, logFile)
	})

	devToolsEnabled := devtools.Enabled()
	if devToolsEnabled {
		log.Info().Str("env", devtools.EnvVar).Msg("StreamAI: DevTools forced enabled via env opt-in")
	}

	_ = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            "main",
		Title:           "StreamAI",
		Width:           1280,
		Height:          800,
		MinWidth:        960,
		MinHeight:       540,
		URL:             "/",
		DevToolsEnabled: devToolsEnabled,
		KeyBindings:     devtools.KeyBindings(),
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

func chainMiddlewares(mws ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		for i := len(mws) - 1; i >= 0; i-- {
			next = mws[i](next)
		}
		return next
	}
}
