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
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"

	rootassets "github.com/AlfioSaitta/StreamAI-IPTV"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/advertising"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/cast"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/discovery"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/netstatus"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/player"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/proxy"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/services/remote"
)


// Set at build time via -ldflags "-X main.version=...".
var (
	version   = "dev"
	commitSHA = ""
)

func main() {
	app := application.New(application.Options{
		Name:        "StreamAI",
		Description: "AI-powered IPTV player — Wails v3 build",
		Services: []application.Service{
			application.NewService(discovery.New()),
			application.NewService(advertising.New()),
			application.NewService(cast.New()),
			application.NewService(remote.New()),
			application.NewService(netstatus.New()),
			application.NewService(proxy.New()),
			application.NewService(player.New()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(rootassets.FS),
		},
		// Linux: webview backend è scelto via build-tag (`gtk3` per
		// webkit2gtk-4.1 fallback, default webkitgtk-6.0). Vedi
		// plan §5.1 e build/depends/<distro>.json.
	})

	// Finestra principale: stessa shape della shell Electron attuale.
	// Background #141414, no menu nativi (autoHideMenuBar in Electron).
	// In Wails v3 alpha.93 NewWindow e' package-level, non un metodo di *App.
	_ = application.NewWindow(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "StreamAI",
		Width:            1280,
		Height:           800,
		MinWidth:         960,
		MinHeight:        540,
		BackgroundColour: application.NewRGB(20, 20, 20), // #141414
		URL:              "/",
	})

	log.Printf("StreamAI %s (%s) — starting Wails v3", version, commitSHA)

	if err := app.Run(); err != nil {
		log.Fatalf("StreamAI failed to start: %v", err)
	}
}

