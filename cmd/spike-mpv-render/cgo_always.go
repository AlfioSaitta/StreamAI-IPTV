// Package-level cgo "always-on" stub.
//
// Tre obiettivi:
//
//  1. Mantenere il package cgo-enabled anche senza il build tag `mpv`,
//     altrimenti `go vet` / `go build` rifiutano `trampoline.c` con:
//       "C source files not allowed when not using cgo or SWIG".
//
//  2. Esportare `goSpike1UpdateCallback` con linkage globale visibile
//     al linker C anche nello stub-build. `trampoline.c` ne tiene una
//     `extern` declaration; in mpv-build viene chiamata da libmpv via
//     il trampoline, in stub-build resta inerte (channel nil).
//
//  3. Offrire al codice mpv-tagged un channel `updateCallbackChan` su
//     cui il trampoline pubblica i tick di redraw.
package main
// #include <stddef.h>
import "C"
import "sync"
var (
updateCallbackMu   sync.Mutex
updateCallbackChan chan struct{}
)
// goSpike1UpdateCallback è chiamata dal trampoline C (vedi
// trampoline.c). Esposta come simbolo C esterno via cgo //export.
//
//export goSpike1UpdateCallback
func goSpike1UpdateCallback() {
updateCallbackMu.Lock()
ch := updateCallbackChan
updateCallbackMu.Unlock()
if ch == nil {
return
}
select {
case ch <- struct{}{}:
default:
}
}
// Keep cgo enabled in package scope.
var _ = C.size_t(0)
