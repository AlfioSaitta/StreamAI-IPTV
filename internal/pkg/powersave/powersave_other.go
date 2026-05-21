//go:build !linux && !windows && !darwin && !freebsd && !openbsd && !netbsd && !dragonfly

// powersave_other.go — stub no-op per piattaforme non supportate
// (solaris, illumos, plan9, android, ios, …).
//
// L'app continua a funzionare ma display/system sleep non vengono
// inibiti. L'utente deve usare le impostazioni OS standard se vuole
// disabilitare lo sleep durante un film.

package powersave

type inhibitState struct{}

func platformInhibit(_ string) (inhibitState, error) { return inhibitState{}, nil }
func platformUninhibit(_ inhibitState) error          { return nil }

