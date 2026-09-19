// Proprietà MPRIS aggiornate dal lato server.
//
// Serve un test perché questo percorso è invisibile all'app: se l'aggiornamento
// fallisce, l'errore torna al binding e finisce nel log, mentre per l'utente
// l'unico sintomo è un widget del desktop che resta fermo — che nessuno nota.
// È successo davvero: PlaybackStatus, Metadata e i Can* erano (correttamente)
// dichiarati non scrivibili, perché la specifica MPRIS2 li vuole read-only, ma
// venivano aggiornati con `Properties.Set`, che è il percorso *client* e per
// quelli restituisce ErrReadOnly.
//
// La verifica è fatta **dal bus**, non sullo stato interno: ciò che conta è cosa
// vede un lettore MPRIS (KDE, GNOME, playerctl).
//
//go:build linux

package mediakeys

import (
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Nome diverso da quello dell'app: il test gira sul bus di sessione dell'utente
// e non deve contendere il bus name al player eventualmente in esecuzione.
const testBusName = "org.mpris.MediaPlayer2.streamaipropstest"

func startTestController(t *testing.T) *Controller {
	t.Helper()
	if testing.Short() {
		t.Skip("short mode")
	}
	if _, err := exec.LookPath("gdbus"); err != nil {
		t.Skip("gdbus non in PATH")
	}
	c := New(Callbacks{})
	if err := c.Start("StreamAIPropsTest"); err != nil {
		t.Skipf("Start fallito (session bus assente?): %v", err)
	}
	t.Cleanup(func() { _ = c.Stop() })
	// Il bus name è registrato in modo asincrono: senza attesa il primo Get
	// può arrivare prima che l'oggetto esista.
	time.Sleep(150 * time.Millisecond)
	return c
}

// busGetProp legge una proprietà come la leggerebbe un client MPRIS.
func busGetProp(t *testing.T, iface, name string) string {
	t.Helper()
	out, err := exec.Command("gdbus", "call", "--session",
		"--dest", testBusName,
		"--object-path", "/org/mpris/MediaPlayer2",
		"--method", "org.freedesktop.DBus.Properties.Get",
		iface, name).CombinedOutput()
	if err != nil {
		t.Fatalf("gdbus Get %s.%s: %v\n%s", iface, name, err, out)
	}
	return string(out)
}

func TestSync_PlaybackStatusVisibleOnBus(t *testing.T) {
	c := startTestController(t)

	if err := c.SetStatus(StatusPlaying); err != nil {
		t.Fatalf("SetStatus(playing): %v", err)
	}
	if got := busGetProp(t, mprisPlayerIface, "PlaybackStatus"); !strings.Contains(got, "'Playing'") {
		t.Fatalf("PlaybackStatus sul bus = %s, atteso Playing", got)
	}

	// Secondo valore: se l'aggiornamento fosse applicato solo una volta (o solo
	// allo Start), il primo assert passerebbe comunque.
	if err := c.SetStatus(StatusPaused); err != nil {
		t.Fatalf("SetStatus(paused): %v", err)
	}
	if got := busGetProp(t, mprisPlayerIface, "PlaybackStatus"); !strings.Contains(got, "'Paused'") {
		t.Fatalf("PlaybackStatus sul bus = %s, atteso Paused", got)
	}
}

func TestSync_CapabilitiesVisibleOnBus(t *testing.T) {
	c := startTestController(t)

	all := Capabilities{
		CanPlay: true, CanPause: true, CanGoNext: true,
		CanGoPrevious: true, CanSeek: true, CanControl: true,
	}
	if err := c.SetCapabilities(all); err != nil {
		t.Fatalf("SetCapabilities(tutte true): %v", err)
	}
	// Tutte e sei, non solo la prima: era proprio il sintomo del difetto che
	// l'aggiornamento si fermasse alla prima proprietà non scrivibile.
	for _, name := range []string{
		"CanPlay", "CanPause", "CanGoNext", "CanGoPrevious", "CanSeek", "CanControl",
	} {
		if got := busGetProp(t, mprisPlayerIface, name); !strings.Contains(got, "true") {
			t.Errorf("%s sul bus = %s, atteso true", name, got)
		}
	}

	// E il ritorno a false, così il test non passerebbe con valori congelati al
	// primo snapshot.
	if err := c.SetCapabilities(Capabilities{}); err != nil {
		t.Fatalf("SetCapabilities(tutte false): %v", err)
	}
	if got := busGetProp(t, mprisPlayerIface, "CanGoNext"); !strings.Contains(got, "false") {
		t.Errorf("CanGoNext sul bus = %s, atteso false", got)
	}
}

// Il frontend passa l'identificativo del canale, che per Xtream è un numero
// ("12345"): non è un object path D-Bus. Non è un dettaglio formale — un valore
// non valido fa panicare `conn.Emit` mentre codifica PropertiesChanged
// ("dbus: wire format error: invalid object path"), dentro il percorso di
// riproduzione. Reale: osservato in produzione, un errore per ogni aggiornamento
// di metadati.
func TestSync_MetadataAcceptsNonObjectPathTrackID(t *testing.T) {
	c := startTestController(t)

	if err := c.SetMetadata(Metadata{Title: "Rai 1 HD", TrackID: "12345"}); err != nil {
		t.Fatalf("SetMetadata con trackId numerico: %v", err)
	}
	got := busGetProp(t, mprisPlayerIface, "Metadata")
	if !strings.Contains(got, "mpris:trackid") {
		t.Fatalf("Metadata sul bus senza trackid: %s", got)
	}
	// Il trackid deve essere un object path valido e **derivato dall'id**, così
	// resta lo stesso a ogni aggiornamento: un contatore progressivo farebbe
	// credere ai widget del desktop che ogni metadata sia un brano nuovo.
	if !strings.Contains(got, "/io/streamai/track/ch12345") {
		t.Errorf("trackid non derivato dall'id del canale: %s", got)
	}

	// Stesso id → stesso trackid, anche su una chiamata successiva.
	if err := c.SetMetadata(Metadata{Title: "Altro titolo", TrackID: "12345"}); err != nil {
		t.Fatalf("secondo SetMetadata: %v", err)
	}
	if again := busGetProp(t, mprisPlayerIface, "Metadata"); !strings.Contains(again, "/io/streamai/track/ch12345") {
		t.Errorf("trackid cambiato fra due aggiornamenti dello stesso canale: %s", again)
	}
}

func TestSync_MetadataVisibleOnBus(t *testing.T) {
	c := startTestController(t)

	if err := c.SetMetadata(Metadata{Title: "Rai 1 HD", Artist: "StreamAI"}); err != nil {
		t.Fatalf("SetMetadata: %v", err)
	}
	got := busGetProp(t, mprisPlayerIface, "Metadata")
	for _, want := range []string{"mpris:trackid", "xesam:title", "Rai 1 HD", "xesam:artist", "StreamAI"} {
		if !strings.Contains(got, want) {
			t.Errorf("Metadata sul bus non contiene %q: %s", want, got)
		}
	}
}
