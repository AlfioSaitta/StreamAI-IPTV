// Package mediakeys — Fase 7-bis.4 del plan-go-wails-migration.
//
// Esposizione cross-platform dei controlli media hardware al sistema
// operativo:
//
//   - Linux/*BSD: MPRIS2 (Media Player Remote Interfacing Specification
//     v2) su D-Bus session bus — supportato out-of-the-box da GNOME
//     Shell media widget, KDE Plasmoid Media Player, playerctl CLI,
//     elementary Pantheon, swaync, eww. Implementato in
//     `mediakeys_linux.go`.
//
//   - Windows: SMTC (System Media Transport Controls,
//     `Windows.Media.SystemMediaTransportControls`). **NON ANCORA
//     IMPLEMENTATO** — richiede `github.com/saltosystems/winrt-go` o
//     equivalente. Stub no-op in `mediakeys_other.go`. Tracking issue
//     futura.
//
//   - macOS: `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` via
//     cgo Cocoa (`-framework MediaPlayer`). **NON ANCORA
//     IMPLEMENTATO** — richiede CFNotificationCenter bridging non
//     banale. Stub no-op in `mediakeys_other.go`.
//
// Architettura:
//   - `Controller` è lo handle opaco creato con `New(callbacks)`.
//   - `Start(identity)` registra il bus name (Linux), allocando l'
//     IPC. Idempotente.
//   - `Stop()` rilascia il bus name e termina la sessione.
//   - I metodi `SetXxx(...)` aggiornano stato + emettono signal
//     `PropertiesChanged` (Linux) per notificare GNOME/KDE.
//   - Le `Callbacks` sono invocate quando l'utente preme un tasto
//     hardware (Play/Pause/Next/Previous su tastiera o cuffie).
//
// Pattern uso in PlayerService (futuro, Fase 6):
//
//	mk := mediakeys.New(mediakeys.Callbacks{
//	    OnPlay:     func() { player.Play() },
//	    OnPause:    func() { player.Pause() },
//	    OnNext:     func() { eventBus.Emit("media-key:next") },
//	    OnPrevious: func() { eventBus.Emit("media-key:previous") },
//	})
//	mk.Start("StreamAI")
//	defer mk.Stop()
//	mk.SetMetadata(mediakeys.Metadata{
//	    Title:    "Sky Sport HD",
//	    Artist:   "IPTV Provider",
//	    Duration: 0, // 0 = live stream
//	})
package mediakeys

import (
	"errors"
	"sync"
)

// Status è lo stato di playback MPRIS-compatible ("Playing", "Paused", "Stopped").
type Status string

const (
	StatusPlaying Status = "Playing"
	StatusPaused  Status = "Paused"
	StatusStopped Status = "Stopped"
)

// Metadata sono i dati track-level esposti al sistema.
//
// Mapping verso MPRIS2 (xesam: namespace) — vedi
// https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/:
//
//	Title    → xesam:title (string)
//	Artist   → xesam:artist (array of string)
//	Album    → xesam:album (string)
//	ArtURL   → mpris:artUrl (string, "file://" o "https://")
//	Duration → mpris:length (int64, microsecondi; 0 = live/unknown)
//	TrackID  → mpris:trackid (object path; auto-generato se vuoto)
type Metadata struct {
	Title    string
	Artist   string
	Album    string
	ArtURL   string
	Duration int64 // microseconds; 0 = live/unknown
	TrackID  string
}

// Capabilities è il set di azioni che il backend può gestire.
// Espone al desktop quali pulsanti devono essere abilitati nei
// player widget.
type Capabilities struct {
	CanPlay       bool
	CanPause      bool
	CanGoNext     bool
	CanGoPrevious bool
	CanSeek       bool
	CanControl    bool // master switch; se false GNOME nasconde il widget
}

// DefaultCapabilities è il set minimo sensato per un player IPTV
// (no Next/Previous live; controllo completo VOD).
func DefaultCapabilities() Capabilities {
	return Capabilities{
		CanPlay:       true,
		CanPause:      true,
		CanGoNext:     false,
		CanGoPrevious: false,
		CanSeek:       false, // override true per VOD
		CanControl:    true,
	}
}

// Callbacks invocate quando l'utente preme un tasto hardware (cuffie,
// tastiera multimediale, smart-speaker via DBus, ...). Tutti i campi
// sono opzionali: se nil il metodo MPRIS corrispondente diventa no-op
// (gli altri DE rispettano comunque CanXxx properties).
type Callbacks struct {
	OnPlay      func()
	OnPause     func()
	OnPlayPause func()
	OnStop      func()
	OnNext      func()
	OnPrevious  func()
	// OnSeek riceve l'offset richiesto in microsecondi (può essere
	// negativo per rewind). Solo se Capabilities.CanSeek == true.
	OnSeek func(offsetMicros int64)
	// OnSetPosition riceve la posizione assoluta target (microsecondi
	// dal track start).
	OnSetPosition func(positionMicros int64)
	// OnRaise viene chiamato quando l'utente clicca sul nome dell'app
	// nel widget GNOME (è la convenzione MPRIS per "torna a finestra").
	OnRaise func()
	// OnQuit è la richiesta di terminazione (CanQuit deve essere true).
	OnQuit func()
}

// ErrAlreadyStarted è ritornato da Start se il Controller è già
// attivo.
var ErrAlreadyStarted = errors.New("mediakeys: controller already started")

// Controller è lo handle opaco. Crearlo con New.
type Controller struct {
	mu        sync.Mutex
	started   bool
	identity  string
	callbacks Callbacks
	caps      Capabilities
	status    Status
	meta      Metadata
	volume    float64
	// state è platform-specific (DBus conn + props handle su Linux;
	// vuoto altrove). Definito in mediakeys_<os>.go.
	state ctrlState
}

// New costruisce un Controller. Le callback possono essere
// ridefinite via SetCallbacks. Volume iniziale 1.0.
func New(cb Callbacks) *Controller {
	return &Controller{
		callbacks: cb,
		caps:      DefaultCapabilities(),
		status:    StatusStopped,
		volume:    1.0,
	}
}

// SetCallbacks rimpiazza atomicamente il set di callback. Utile per
// re-wiring quando PlayerService viene ricostruito (Fase 6).
func (c *Controller) SetCallbacks(cb Callbacks) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.callbacks = cb
}

// Start registra il controller verso l'OS (D-Bus bus name su Linux,
// SMTC/MPNowPlaying altrove se implementato; no-op altrimenti).
// `identity` è il nome user-facing ("StreamAI"); diventa
// `org.mpris.MediaPlayer2.streamai` (sanificato lowercase, [a-z0-9_]).
//
// Idempotenza: chiamare due volte ritorna ErrAlreadyStarted (il
// chiamante può scegliere di ignorarlo o loggarlo).
func (c *Controller) Start(identity string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.started {
		return ErrAlreadyStarted
	}
	if identity == "" {
		identity = "StreamAI"
	}
	c.identity = identity
	if err := platformStart(c); err != nil {
		return err
	}
	c.started = true
	return nil
}

// Stop rilascia le risorse OS-side. Idempotente: chiamare su un
// Controller non started è no-op (nil).
func (c *Controller) Stop() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.started {
		return nil
	}
	err := platformStop(c)
	c.started = false
	return err
}

// SetCapabilities aggiorna i Can* properties (e su Linux emette
// PropertiesChanged). Chiamabile prima o dopo Start.
func (c *Controller) SetCapabilities(caps Capabilities) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.caps = caps
	if !c.started {
		return nil
	}
	return platformSyncCapabilities(c)
}

// Started ritorna true tra Start e Stop riusciti.
func (c *Controller) Started() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.started
}

// SetStatus aggiorna PlaybackStatus + emette PropertiesChanged.
func (c *Controller) SetStatus(s Status) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status = s
	if !c.started {
		return nil
	}
	return platformSyncStatus(c)
}

// SetMetadata aggiorna il blocco metadata. Chiamabile durante
// playback (es. nuova traccia EPG su canale live).
func (c *Controller) SetMetadata(m Metadata) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.meta = m
	if !c.started {
		return nil
	}
	return platformSyncMetadata(c)
}

// SetVolume aggiorna il volume MPRIS (0.0–1.0). Il sistema può
// reagire impostando il volume dell'app via PulseAudio/PipeWire.
func (c *Controller) SetVolume(v float64) error {
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.volume = v
	if !c.started {
		return nil
	}
	return platformSyncVolume(c)
}

// Snapshot del controller per platform code (read-only).
type snapshot struct {
	identity string
	status   Status
	meta     Metadata
	caps     Capabilities
	volume   float64
}

func (c *Controller) snapshot() snapshot {
	return snapshot{
		identity: c.identity,
		status:   c.status,
		meta:     c.meta,
		caps:     c.caps,
		volume:   c.volume,
	}
}

// dispatchCallback è invocato dai handler DBus/SMTC per propagare
// l'evento alla callback utente. Locks-safe: la lock è già release
// dal chiamante platform-specific (per evitare re-entry su SetXxx
// chiamate dalla callback stessa).
func (c *Controller) dispatchCallback(fn func()) {
	if fn == nil {
		return
	}
	// Eseguiamo in goroutine separata per non bloccare l'event loop
	// DBus: una callback lenta non deve far accumulare i metodi.
	go fn()
}


