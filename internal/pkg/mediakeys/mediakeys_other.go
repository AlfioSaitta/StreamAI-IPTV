//go:build !linux && !freebsd && !openbsd && !netbsd && !dragonfly

// mediakeys_other.go — stub no-op per piattaforme non-Linux.
//
// TODO Fase 7-bis.4 estensione (futura):
//   - Windows: implementare SMTC tramite
//     github.com/saltosystems/winrt-go (richiede CGO_ENABLED=0 OK).
//     API target: Windows.Media.SystemMediaTransportControls.
//   - macOS: implementare MPNowPlayingInfoCenter +
//     MPRemoteCommandCenter tramite cgo Cocoa
//     (`-framework MediaPlayer`). Richiede Info.plist bundle ID.
//
// Comportamento corrente su Windows/macOS: tutte le operazioni sono
// no-op success — l'app funziona ma i media keys hardware (cuffie,
// tastiera multimediale) non sono intercettati a livello OS. Lato
// utente: i keybindings del frontend continuano a funzionare per
// chi usa la tastiera del PC.

package mediakeys

// ctrlState vuoto per piattaforme senza backend nativo.
type ctrlState struct{}

func platformStart(_ *Controller) error           { return nil }
func platformStop(_ *Controller) error            { return nil }
func platformSyncStatus(_ *Controller) error      { return nil }
func platformSyncMetadata(_ *Controller) error    { return nil }
func platformSyncCapabilities(_ *Controller) error { return nil }
func platformSyncVolume(_ *Controller) error      { return nil }

