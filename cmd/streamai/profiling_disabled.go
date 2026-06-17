//go:build !dev_pprof

package main

// initProfiling è una no-op nella build di produzione.
// Il server pprof non viene compilato né avviato.
func initProfiling() {
	// No-op
}
