// Package appicon — Fase 7-bis.5 del plan-go-wails-migration.
//
// Embed delle icone applicative (PNG) usate da:
//   - application.Options{Icon: AppIcon256} → dock/taskbar (Linux/macOS) e
//     finestra principale (Windows alt-tab + AppUserModelID).
//   - SystemTray.SetIcon(AppIcon256) → tray icon (KDE/GNOME/Windows/macOS).
//   - SystemTray.SetDarkModeIcon(AppIconDark) → variante dark per macOS
//     template icon / GNOME symbolic.
//
// Le icone PNG sono in build/icons/ (generate da scripts/generate-icons.mjs
// a partire da icon.png). Vengono incluse staticamente nel binario tramite
// //go:embed, così non dipendiamo da percorsi runtime e l'esperimento
// `streamai --tray-only` funziona anche in modalità portable.
package appicon

import _ "embed"

// AppIcon256 è l'icona 256x256 PNG, usata per system tray + window icon.
// Sufficiente per HiDPI fino a 4× (i tray icon sono ridimensionati a
// 24-32 px dal sistema, l'extra risoluzione garantisce nitidezza su
// monitor 4K + scale 200%).
//
//go:embed icon-256.png
var AppIcon256 []byte

// AppIcon512 è l'icona 512x512, usata per dock/Launchpad macOS e
// finestra "About". Per i 3 OS target è sufficiente avere 256 + 512:
// il sistema fa downscale automatico (vedi NSImage / GdkPixbuf /
// HICON LR_DEFAULTSIZE).
//
//go:embed icon-512.png
var AppIcon512 []byte

