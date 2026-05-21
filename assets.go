// Package assets — embed del frontend statico (output Vite) per Wails v3.
//
// Layout post-ristrutturazione (vedi docs/plan-go-wails-migration.md 2.1):
//   - sorgenti React/TS in `frontend/` (App.tsx, components/, services/, ...)
//   - output Vite in `frontend/dist/`  l'unico contenuto embeddato qui
//   - `wails3 dev` (e Vite dev-server) bypassano l'embed e servono i file
//     dal disco; solo `task build` / `wails3 build` usano `FS`.
//
// Nota: il package name e' `streamai` (NON `assets`) per convenzione del
// modulo root (github.com/AlfioSaitta/StreamAI-IPTV). Importare come
// `streamai "github.com/AlfioSaitta/StreamAI-IPTV"`.
package streamai

import "embed"

// FS espone il bundle compilato del frontend (output di `vite build`).
// Se la cartella `frontend/dist` non esiste il build Go fallisce: assicurarsi
// di lanciare `task frontend:build` prima di `go build` standalone.
//
//go:embed all:frontend/dist
var FS embed.FS

