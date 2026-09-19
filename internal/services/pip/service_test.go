package pip

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Senza un'istanza Wails attiva (test, avvio anticipato, teardown) il servizio
// deve degradare in modo pulito: `Open` segnala l'errore, tutto il resto è un
// no-op. Un panic qui farebbe cadere il processo durante lo shutdown, dove
// `ServiceShutdown` viene chiamato proprio mentre l'app si smonta.
func TestService_NoApplication(t *testing.T) {
	s := New()

	if open, err := s.Open(OpenOptions{Title: "Canale"}); err == nil {
		t.Fatalf("Open senza applicazione: atteso errore, ottenuto open=%v", open)
	}

	if err := s.Close(); err != nil {
		t.Fatalf("Close senza applicazione deve essere no-op, ottenuto: %v", err)
	}
	if err := s.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown senza applicazione deve essere no-op, ottenuto: %v", err)
	}

	st := s.State()
	if st.Open || st.Title != "" {
		t.Fatalf("State senza applicazione deve essere vuoto, ottenuto %+v", st)
	}
}

// `StartResize` accetta solo i bordi che Wails sa tradurre in `GdkWindowEdge`,
// e senza un'app attiva fallisce invece di panicare (viene chiamato da un
// evento mouse, dove un panic chiuderebbe l'app).
func TestService_StartResize(t *testing.T) {
	s := New()

	if err := s.StartResize("bordo-inventato"); err == nil {
		t.Fatal("un bordo sconosciuto deve essere rifiutato")
	}

	for _, edge := range []string{"n-resize", "s-resize", "e-resize", "w-resize",
		"ne-resize", "nw-resize", "se-resize", "sw-resize"} {
		err := s.StartResize(edge)
		if err == nil {
			t.Fatalf("%s: senza applicazione Wails il resize non può partire", edge)
		}
		if strings.Contains(err.Error(), "sconosciuto") {
			t.Fatalf("%s: è un bordo valido, non deve essere rifiutato come sconosciuto", edge)
		}
	}
}

// Il titolo di sistema è la stringa esatta cercata dalla regola di finestra del
// compositor, che su Wayland è l'unico modo di ottenere "mantieni sopra le
// altre" (docs/pip-design.md §4-quater). Due proprietà da difendere:
//
//  1. deve restare letterale (niente metacaratteri, niente nome del canale): è
//     ciò che rende la regola indipendente dal valore di `titlematch`, un numero
//     che non controlliamo e che se sbagliato fa fallire la regola in silenzio;
//  2. deve essere la stessa stringa scritta in scripts/kwin-pip-above.sh — due
//     artefatti in linguaggi diversi, che nulla tiene agganciati a compile-time.
func TestOSTitle_MatchesWindowRuleScript(t *testing.T) {
	if osTitle == "" {
		t.Fatal("il titolo di sistema non può essere vuoto")
	}
	if strings.ContainsAny(osTitle, "%.*+?[](){}^$|\\") {
		t.Fatalf("titolo di sistema %q: niente metacaratteri o parti variabili, "+
			"altrimenti il confronto non è più equivalente nei tre modi di KWin "+
			"(esatto, sottostringa, espressione regolare)", osTitle)
	}

	script, err := os.ReadFile(filepath.Join("..", "..", "..", "scripts", "kwin-pip-above.sh"))
	if err != nil {
		t.Fatalf("lettura dello script della regola: %v", err)
	}
	want := `TITLE="` + osTitle + `"`
	if !strings.Contains(string(script), want) {
		t.Fatalf("scripts/kwin-pip-above.sh non contiene %s: la regola non "+
			"riconoscerebbe la finestra e resterebbe inerte", want)
	}
}

// Il titolo è memoria del servizio, non dello stato Wails: sopravvive alle
// letture e viene azzerato solo dal callback di chiusura. Qui verifichiamo la
// sola parte indipendente dall'app (set/get), che è quella usata dalla vista
// PiP per la barra della finestra.
func TestService_TitleRoundTrip(t *testing.T) {
	s := New()
	if got := s.currentTitle(); got != "" {
		t.Fatalf("titolo iniziale = %q, atteso vuoto", got)
	}
	s.setTitle("Rai 1 HD")
	if got := s.currentTitle(); got != "Rai 1 HD" {
		t.Fatalf("titolo = %q, atteso \"Rai 1 HD\"", got)
	}
	s.setTitle("")
	if got := s.currentTitle(); got != "" {
		t.Fatalf("titolo dopo azzeramento = %q, atteso vuoto", got)
	}
}

// `Update` viene chiamata a ogni cambio canale mentre il PiP è aperto: senza un
// PiP aperto non deve fare nulla (nessuna finestra da aggiornare) e non deve
// panicare. Lo stato però si registra comunque, perché è quello che la vista
// leggerà se il PiP viene aperto subito dopo.
func TestService_UpdateWithoutWindowRecordsState(t *testing.T) {
	s := New()
	s.Update(OpenOptions{Title: "Rai 1", IsLive: true, SeekDisabled: false})

	if got := s.currentTitle(); got != "Rai 1" {
		t.Fatalf("titolo = %q, atteso \"Rai 1\"", got)
	}
	if got := s.currentMedia(); !got.isLive || got.seekDisabled {
		t.Fatalf("stato del canale = %+v, atteso live e seekabile", got)
	}
}

// Un titolo vuoto non deve lasciare la barra senza testo: `Update` normalizza
// come `Open` (la barra della vista non ha un caso "senza nome").
func TestService_UpdateNormalizesEmptyTitle(t *testing.T) {
	s := New()
	s.Update(OpenOptions{Title: ""})

	if got := s.currentTitle(); got != "StreamAI" {
		t.Fatalf("titolo = %q, atteso \"StreamAI\"", got)
	}
}

// Il fullscreen è una capacità della finestra, non del servizio: senza finestra
// aperta deve fallire in modo pulito (viene chiamata da un click).
func TestService_ToggleFullscreenWithoutWindow(t *testing.T) {
	s := New()
	if _, err := s.ToggleFullscreen(); err == nil {
		t.Fatal("ToggleFullscreen senza finestra deve fallire")
	}
}

// Tipo di canale e seekabilità accompagnano il titolo: sono ciò con cui la vista
// PiP decide se disegnare la timeline, quindi devono sopravvivere alle letture.
func TestService_MediaRoundTrip(t *testing.T) {
	s := New()
	if got := s.currentMedia(); got.isLive || got.seekDisabled {
		t.Fatalf("stato iniziale = %+v, atteso zero", got)
	}
	s.setMedia(true, false)
	if got := s.currentMedia(); !got.isLive || got.seekDisabled {
		t.Fatalf("stato dopo setMedia = %+v", got)
	}
	s.setMedia(false, true)
	if got := s.currentMedia(); got.isLive || !got.seekDisabled {
		t.Fatalf("stato dopo setMedia = %+v", got)
	}
}
