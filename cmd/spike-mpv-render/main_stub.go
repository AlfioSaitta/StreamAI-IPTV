// Stub fallback. Compilato quando il tag `mpv` NON è presente, o quando
// non siamo su Linux. Stampa un messaggio chiaro e termina con exit code
// 2 (= "preflight non soddisfatto", distinto da exit 1 = "KPI failed").
//
//go:build !mpv || !linux

package main

import (
	"fmt"
	"os"
	"runtime"
)

func main() {
	fmt.Fprintf(os.Stderr, `spike-mpv-render: build stub.

Questo binario richiede:
  - Build tag 'mpv' attivato (es. -tags 'mpv spike1')
  - Linux con libmpv-dev + EGL/GL headers

GOOS attuale: %s   GOARCH: %s
Build tags richiesti: mpv (e linux)

Vedi cmd/spike-mpv-render/README.md per istruzioni.
`, runtime.GOOS, runtime.GOARCH)
	os.Exit(2)
}

