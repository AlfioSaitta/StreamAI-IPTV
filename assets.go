// Package assets — embed del frontend statico (output Vite) per Wails v3.
//
// Il path `//go:embed` e' relativo a questo file Go (project root). La
// cartella `frontend/` viene popolata da `wails3 build` (che richiama
// `vite build` e copia `dist/` in `frontend/`), oppure servita live da
// `wails3 dev` (in dev mode l'embed e' bypassato dall'AssetServer).
//
// Vedi docs/plan-go-wails-migration.md sez. 6 Fase 1.
//
// Note: package name `streamai` (not `assets`) per convenzione del modulo
// root (github.com/AlfioSaitta/StreamAI-IPTV). Importare come
// `streamai "github.com/AlfioSaitta/StreamAI-IPTV"`.
package streamai

import "embed"

// FS espone il contenuto di frontend/ al main del binario.
//
//go:embed all:frontend
var FS embed.FS

