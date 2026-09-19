//go:build linux || freebsd || openbsd || netbsd || dragonfly

// mediakeys_linux.go — backend MPRIS2 D-Bus session.
//
// Spec: https://specifications.freedesktop.org/mpris-spec/latest/
//
// Bus name: org.mpris.MediaPlayer2.streamai
// Object path: /org/mpris/MediaPlayer2
// Interfaces esposte:
//   - org.freedesktop.DBus.Introspectable (auto, generato da
//     godbus/introspect)
//   - org.freedesktop.DBus.Properties (auto, generato da godbus/prop)
//   - org.mpris.MediaPlayer2 (Raise/Quit + properties)
//   - org.mpris.MediaPlayer2.Player (Play/Pause/PlayPause/Stop/Next/
//     Previous/Seek/SetPosition + properties dinamiche)
//
// Note specifiche:
//   - Il bus name è sanificato a [a-z0-9_]; "StreamAI" → "streamai".
//   - Se un'altra istanza StreamAI è già registrata (caso anomalo,
//     dato il single-instance lock di Fase 7-bis.2), Wails fa
//     fallback al pattern MPRIS instance "streamai.instance<PID>"
//     come da spec §"Bus Name Policy".
//   - PropertiesChanged è gestito automaticamente da godbus/prop
//     (vedi EmitTrue nelle prop.Prop definitions).

package mediakeys

import (
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/godbus/dbus/v5"
	"github.com/godbus/dbus/v5/introspect"
	"github.com/godbus/dbus/v5/prop"
	"github.com/rs/zerolog/log"
)

const (
	mprisObjectPath  = "/org/mpris/MediaPlayer2"
	mprisIface       = "org.mpris.MediaPlayer2"
	mprisPlayerIface = "org.mpris.MediaPlayer2.Player"
)

// ctrlState contiene lo stato D-Bus runtime del Controller.
type ctrlState struct {
	conn  *dbus.Conn
	props *prop.Properties
	// trackIDCounter genera mpris:trackid univoci quando l'utente non
	// ne fornisce uno. ObjectPath richiesto dalla spec MPRIS.
	trackIDCounter uint64
}

// sanitizeIdentity → bus name segment valido per MPRIS.
func sanitizeIdentity(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '_':
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" {
		out = "streamai"
	}
	return out
}

// mprisRoot implementa l'interfaccia org.mpris.MediaPlayer2 (metodi).
type mprisRoot struct{ c *Controller }

func (r *mprisRoot) Raise() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Raise() received")
	r.c.dispatchCallback(r.c.callbacks.OnRaise)
	return nil
}

func (r *mprisRoot) Quit() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Quit() received")
	r.c.dispatchCallback(r.c.callbacks.OnQuit)
	return nil
}

// mprisPlayer implementa org.mpris.MediaPlayer2.Player (metodi).
//
// Nota: il metodo "Seek" della spec MPRIS confligge con la firma
// dello `io.Seeker` Go (`Seek(int64, int) (int64, error)`), facendo
// scattare il warning `stdmethods` di `go vet`. Per evitare il
// warning senza compromettere la DBus signature, esponiamo il metodo
// Go come `MprisSeek` e lo registriamo su DBus col nome `Seek` via
// `conn.ExportWithMap` (vedi platformStart).
type mprisPlayer struct{ c *Controller }

func (p *mprisPlayer) Next() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Next()")
	p.c.dispatchCallback(p.c.callbacks.OnNext)
	return nil
}
func (p *mprisPlayer) Previous() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Previous()")
	p.c.dispatchCallback(p.c.callbacks.OnPrevious)
	return nil
}
func (p *mprisPlayer) Pause() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Pause()")
	p.c.dispatchCallback(p.c.callbacks.OnPause)
	return nil
}
func (p *mprisPlayer) PlayPause() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS PlayPause()")
	if p.c.callbacks.OnPlayPause != nil {
		p.c.dispatchCallback(p.c.callbacks.OnPlayPause)
		return nil
	}
	// Fallback: deduce dallo status corrente.
	p.c.mu.Lock()
	s := p.c.status
	p.c.mu.Unlock()
	if s == StatusPlaying {
		p.c.dispatchCallback(p.c.callbacks.OnPause)
	} else {
		p.c.dispatchCallback(p.c.callbacks.OnPlay)
	}
	return nil
}
func (p *mprisPlayer) Stop() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Stop()")
	p.c.dispatchCallback(p.c.callbacks.OnStop)
	return nil
}
func (p *mprisPlayer) Play() *dbus.Error {
	log.Debug().Msg("mediakeys: MPRIS Play()")
	p.c.dispatchCallback(p.c.callbacks.OnPlay)
	return nil
}

// MprisSeek è il nome Go del metodo DBus "Seek" (rinominato per
// evitare il conflitto stdmethods di go vet con io.Seeker).
func (p *mprisPlayer) MprisSeek(offsetMicros int64) *dbus.Error {
	log.Debug().Int64("offset_us", offsetMicros).Msg("mediakeys: MPRIS Seek()")
	if p.c.callbacks.OnSeek == nil {
		return nil
	}
	go p.c.callbacks.OnSeek(offsetMicros)
	return nil
}
func (p *mprisPlayer) SetPosition(_ dbus.ObjectPath, positionMicros int64) *dbus.Error {
	log.Debug().Int64("pos_us", positionMicros).Msg("mediakeys: MPRIS SetPosition()")
	if p.c.callbacks.OnSetPosition == nil {
		return nil
	}
	go p.c.callbacks.OnSetPosition(positionMicros)
	return nil
}

// OpenUri è opzionale dalla spec ma viene chiamato da alcuni file
// manager (KDE Dolphin "Send to MPRIS player"). Per ora no-op
// (lo IPTV player non apre URI esterni via DBus).
func (p *mprisPlayer) OpenUri(_ string) *dbus.Error { return nil }

func platformStart(c *Controller) error {
	conn, err := dbus.ConnectSessionBus()
	if err != nil {
		return fmt.Errorf("mediakeys: connect session bus: %w", err)
	}

	busName := "org.mpris.MediaPlayer2." + sanitizeIdentity(c.identity)
	reply, err := conn.RequestName(busName, dbus.NameFlagDoNotQueue)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mediakeys: RequestName(%s): %w", busName, err)
	}
	if reply != dbus.RequestNameReplyPrimaryOwner {
		// Fallback per-instance bus name come da spec MPRIS.
		busName = busName + ".instance" + fmt.Sprintf("%d", procPID())
		reply, err = conn.RequestName(busName, dbus.NameFlagDoNotQueue)
		if err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
			_ = conn.Close()
			return fmt.Errorf("mediakeys: RequestName fallback failed: %v (reply=%d)", err, reply)
		}
	}

	root := &mprisRoot{c: c}
	player := &mprisPlayer{c: c}

	if err := conn.Export(root, mprisObjectPath, mprisIface); err != nil {
		_ = conn.Close()
		return fmt.Errorf("mediakeys: export %s: %w", mprisIface, err)
	}
	// `ExportWithMap` ci permette di rinominare MprisSeek → Seek sul bus
	// senza che il metodo Go si chiami "Seek" (conflitto stdmethods).
	if err := conn.ExportWithMap(player, map[string]string{"MprisSeek": "Seek"},
		mprisObjectPath, mprisPlayerIface); err != nil {
		_ = conn.Close()
		return fmt.Errorf("mediakeys: export %s: %w", mprisPlayerIface, err)
	}

	snap := c.snapshot()
	propsSpec := buildPropsSpec(c, snap)
	props, err := prop.Export(conn, mprisObjectPath, propsSpec)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mediakeys: export properties: %w", err)
	}

	// Introspection: aggiunge il nodo D-Bus standard così che
	// `gdbus introspect --session --dest=org.mpris.MediaPlayer2.streamai
	// --object-path=/org/mpris/MediaPlayer2` ritorni la lista metodi.
	intro := buildIntrospection(root, player, props)
	if err := conn.Export(introspect.NewIntrospectable(intro), mprisObjectPath,
		"org.freedesktop.DBus.Introspectable"); err != nil {
		_ = conn.Close()
		return fmt.Errorf("mediakeys: export introspect: %w", err)
	}

	c.state = ctrlState{conn: conn, props: props}
	log.Info().Str("busname", busName).Msg("mediakeys: MPRIS2 ready")
	return nil
}

func platformStop(c *Controller) error {
	if c.state.conn == nil {
		return nil
	}
	conn := c.state.conn
	c.state = ctrlState{}

	// La chiusura di godbus può bloccarsi se ci sono segnali pendenti
	// o problemi col bus di sessione. Usiamo un timeout per evitare freeze.
	done := make(chan error, 1)
	go func() {
		log.Info().Msg("mediakeys: closing dbus connection")
		done <- conn.Close()
	}()

	select {
	case err := <-done:
		return err
	case <-time.After(500 * time.Millisecond):
		log.Warn().Msg("mediakeys: dbus connection close timed out, skipping")
		return nil
	}
}

// buildPropsSpec costruisce la mappa props per prop.Export.
// I property writable (Volume, Rate, LoopStatus, Shuffle) hanno
// callback EmitTrue → PropertiesChanged generato automaticamente.
func buildPropsSpec(c *Controller, snap snapshot) map[string]map[string]*prop.Prop {
	// Volume writable: callback inoltra al Controller (e da lì alla
	// callback utente se vogliono reagire al volume settato dall'OS).
	volumeWrite := func(ch *prop.Change) *dbus.Error {
		v, ok := ch.Value.(float64)
		if !ok {
			return prop.ErrInvalidArg
		}
		// Aggiorniamo state interno via SetVolume (acquisisce mu).
		_ = c.SetVolume(v)
		return nil
	}

	return map[string]map[string]*prop.Prop{
		mprisIface: {
			"CanQuit":             roProp(true),
			"CanRaise":            roProp(true),
			"HasTrackList":        roProp(false),
			"Identity":            roProp(snap.identity),
			"DesktopEntry":        roProp("streamai"),
			"SupportedUriSchemes": roProp([]string{"http", "https", "file"}),
			"SupportedMimeTypes":  roProp([]string{}),
		},
		mprisPlayerIface: {
			"PlaybackStatus": roProp(string(snap.status)),
			"LoopStatus":     rwProp("None", func(_ *prop.Change) *dbus.Error { return nil }),
			"Rate":           rwProp(1.0, func(_ *prop.Change) *dbus.Error { return nil }),
			"Shuffle":        rwProp(false, func(_ *prop.Change) *dbus.Error { return nil }),
			"Metadata":       roProp(toDBusMetadata(snap.meta, &c.state.trackIDCounter)),
			"Volume":         rwProp(snap.volume, volumeWrite),
			"Position":       roProp(int64(0)), // microseconds; aggiornato esternamente
			"MinimumRate":    roProp(0.25),
			"MaximumRate":    roProp(4.0),
			"CanGoNext":      roProp(snap.caps.CanGoNext),
			"CanGoPrevious":  roProp(snap.caps.CanGoPrevious),
			"CanPlay":        roProp(snap.caps.CanPlay),
			"CanPause":       roProp(snap.caps.CanPause),
			"CanSeek":        roProp(snap.caps.CanSeek),
			"CanControl":     roProp(snap.caps.CanControl),
		},
	}
}

func roProp(v any) *prop.Prop {
	return &prop.Prop{Value: v, Writable: false, Emit: prop.EmitTrue}
}

func rwProp(v any, cb func(*prop.Change) *dbus.Error) *prop.Prop {
	return &prop.Prop{Value: v, Writable: true, Emit: prop.EmitTrue, Callback: cb}
}

func toDBusMetadata(m Metadata, counter *uint64) map[string]dbus.Variant {
	out := map[string]dbus.Variant{}
	out["mpris:trackid"] = dbus.MakeVariant(trackPath(m.TrackID, counter))
	if m.Title != "" {
		out["xesam:title"] = dbus.MakeVariant(m.Title)
	}
	if m.Artist != "" {
		out["xesam:artist"] = dbus.MakeVariant([]string{m.Artist})
	}
	if m.Album != "" {
		out["xesam:album"] = dbus.MakeVariant(m.Album)
	}
	if m.ArtURL != "" {
		out["mpris:artUrl"] = dbus.MakeVariant(m.ArtURL)
	}
	if m.Duration > 0 {
		out["mpris:length"] = dbus.MakeVariant(m.Duration)
	}
	return out
}

// trackPath costruisce mpris:trackid, che la specifica MPRIS vuole di tipo
// object path D-Bus.
//
// Serve una conversione perché il chiamante passa l'identificativo del canale
// (per Xtream un numero: "12345"), che object path non è. E non è una formalità:
// un valore non valido non viene ignorato, fa **panicare** `conn.Emit` mentre
// codifica PropertiesChanged (`dbus: wire format error: invalid object path`),
// cioè dentro il percorso di riproduzione. Osservato in produzione, un errore
// per ogni aggiornamento di metadati.
//
// La conversione è **deterministica**: lo stesso canale produce sempre lo stesso
// trackid, così i widget del desktop non scambiano ogni aggiornamento di
// metadati per un brano nuovo (gli aggiornamenti arrivano a raffica).
func trackPath(id string, counter *uint64) dbus.ObjectPath {
	if p := dbus.ObjectPath(id); p.IsValid() {
		return p
	}
	seg := sanitizePathElement(id)
	if seg == "" {
		seg = fmt.Sprintf("auto%d", atomic.AddUint64(counter, 1))
	}
	return dbus.ObjectPath("/io/streamai/track/" + seg)
}

// sanitizePathElement riduce una stringa arbitraria a un elemento di object path
// D-Bus (caratteri [A-Za-z0-9_]) e ritorna "" se non resta nulla di utilizzabile.
func sanitizePathElement(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return ""
	}
	// Un elemento non può iniziare con una cifra: "12345" da solo sarebbe un
	// object path strutturalmente valido per godbus ma non conforme alla spec.
	if out[0] >= '0' && out[0] <= '9' {
		out = "ch" + out
	}
	return out
}

func buildIntrospection(root *mprisRoot, player *mprisPlayer, props *prop.Properties) *introspect.Node {
	playerMethods := introspect.Methods(player)
	// Rinomina "MprisSeek" → "Seek" anche in introspection (vedi godoc
	// di mprisPlayer per il motivo del workaround stdmethods).
	for i := range playerMethods {
		if playerMethods[i].Name == "MprisSeek" {
			playerMethods[i].Name = "Seek"
		}
	}
	return &introspect.Node{
		Name: mprisObjectPath,
		Interfaces: []introspect.Interface{
			introspect.IntrospectData,
			prop.IntrospectData,
			{
				Name:       mprisIface,
				Methods:    introspect.Methods(root),
				Properties: props.Introspection(mprisIface),
			},
			{
				Name:       mprisPlayerIface,
				Methods:    playerMethods,
				Properties: props.Introspection(mprisPlayerIface),
			},
		},
	}
}

// setLocalProp aggiorna una proprietà **dal lato server** ed emette
// PropertiesChanged secondo il campo Emit della proprietà.
//
// PERCHÉ NON `Properties.Set`. Quello implementa
// org.freedesktop.DBus.Properties.Set, cioè la richiesta di un **client**, e per
// una proprietà non scrivibile restituisce ErrReadOnly (prop.go:
// `if !prop.Writable { return ErrReadOnly }`). PlaybackStatus, Metadata e tutti
// i Can* sono read-only per specifica MPRIS2: dichiararli scrivibili solo per
// poterli aggiornare sarebbe una bugia detta ai client, che vedrebbero
// nell'introspezione una scrittura non permessa. `SetMust` è invece l'API per il
// lato server: salta il controllo di scrivibilità, copia il valore nello store
// interno (un puntatore creato da prop.Export) ed emette il segnale.
//
// `SetMust` **panica** se il tipo del valore non è quello dichiarato in
// buildPropsSpec (dbus.Store non riesce a copiarlo). Questa funzione viene
// chiamata nel percorso di riproduzione — un panic qui chiuderebbe l'app per un
// titolo di traccia — quindi il panic viene convertito in errore.
func setLocalProp(props *prop.Properties, name string, v any) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("sync %s: %v", name, r)
		}
	}()
	props.SetMust(mprisPlayerIface, name, v)
	return nil
}

func platformSyncStatus(c *Controller) error {
	if c.state.props == nil {
		return nil
	}
	return setLocalProp(c.state.props, "PlaybackStatus", string(c.status))
}

func platformSyncMetadata(c *Controller) error {
	if c.state.props == nil {
		return nil
	}
	return setLocalProp(c.state.props, "Metadata",
		toDBusMetadata(c.meta, &c.state.trackIDCounter))
}

func platformSyncCapabilities(c *Controller) error {
	if c.state.props == nil {
		return nil
	}
	caps := c.caps
	updates := []struct {
		name string
		val  bool
	}{
		{"CanGoNext", caps.CanGoNext},
		{"CanGoPrevious", caps.CanGoPrevious},
		{"CanPlay", caps.CanPlay},
		{"CanPause", caps.CanPause},
		{"CanSeek", caps.CanSeek},
		{"CanControl", caps.CanControl},
	}
	for _, u := range updates {
		if err := setLocalProp(c.state.props, u.name, u.val); err != nil {
			return err
		}
	}
	return nil
}

// Volume è l'unica proprietà scrivibile anche dai client, e il suo Set passa
// dalla callback volumeWrite (che richiama SetVolume). Qui siamo già dentro
// SetVolume, quindi si aggiorna per la via locale: passare da `Set`
// rientrerebbe nel controller senza motivo.
func platformSyncVolume(c *Controller) error {
	if c.state.props == nil {
		return nil
	}
	return setLocalProp(c.state.props, "Volume", c.volume)
}
