//go:build dev_pprof

package main

import (
	"net/http"
	_ "net/http/pprof" // Registra gli handler di pprof su DefaultServeMux

	"github.com/rs/zerolog/log"
)

// initProfiling avvia un server HTTP in background che espone gli endpoint di pprof.
// È attivo solo quando l'app viene compilata con il tag -tags dev_pprof.
// (Es. go run -tags dev_pprof ./cmd/streamai)
func initProfiling() {
	log.Info().Msg("StreamAI: Starting pprof server on http://localhost:6060/debug/pprof/")
	go func() {
		// Avvia il server HTTP per pprof
		if err := http.ListenAndServe("localhost:6060", nil); err != nil {
			log.Warn().Err(err).Msg("StreamAI: pprof server stopped or failed to start")
		}
	}()
}
