// Package pip — finestra Picture-in-Picture del player desktop.
//
// # PERCHÉ UNA FINESTRA WAILS E NON LE API PIP DEL WEBVIEW
//
// Il video non vive in un `<video>`: è disegnato in un `<canvas>` WebGL2
// alimentato dai frame RGBA di libmpv (vedi internal/services/player). Le due
// API PiP disponibili nei runtime web hanno quindi entrambe un requisito che
// non possiamo soddisfare:
//
//   - `HTMLVideoElement.requestPictureInPicture()` opera solo su `<video>`;
//   - `documentPictureInPicture.requestWindow()` (Document PiP) è una feature
//     Chromium: non esiste su WebKitGTK (Linux) né su WKWebView (macOS).
//
// La terza strada — una seconda finestra gestita da noi — funziona su tutti e
// tre gli OS con lo stesso comportamento e la stessa UI, che è il requisito
// "Uniform UI" del progetto. È la strategia 3 già prevista dal piano
// (docs/plan-go-wails-migration.md §6.2) come fallback universale.
//
// # COME FUNZIONA
//
// La finestra PiP carica lo stesso bundle del frontend con `?pip=1`: il
// frontend monta una vista ridotta (canvas + controlli minimi) che scarica i
// frame dallo stesso middleware HTTP `/player/frame` già usato dalla finestra
// principale. Non serve alcun transport nuovo, e l'audio non è coinvolto: vive
// nel processo Go (mpv) e continua a suonare qualunque finestra disegni i
// pixel.
//
// Chi disegna: quando il PiP è aperto, è la finestra PiP a eseguire il loop di
// render e la finestra principale lo **ferma** (vedi
// `EventOpened`/`EventClosed` nel frontend). Due loop a piena cadenza
// raddoppierebbero il costo di conversione dei frame senza alcun vantaggio
// visibile.
//
// # THREAD-SAFETY
//
// Il mutex protegge SOLO la sezione "cerca-o-crea" di Open(). In particolare
// non viene mai tenuto mentre si chiama `Window.Close()`: la chiusura fa
// scattare il callback registrato con OnWindowEvent, e se quel callback
// provasse a prendere lo stesso lock si avrebbe un deadlock (i mutex Go non
// sono rientranti). Il titolo è quindi in un atomic, non sotto il mutex.
package pip

import (
	"errors"
	"fmt"
	"os"
	"sync"
	"sync/atomic"

	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/gtkframe"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)

const (
	// WindowName identifica la finestra PiP nel WindowManager di Wails.
	// È anche ciò che rende `Open()` idempotente: una sola finestra per nome.
	WindowName = "pip"

	// MainWindowName è il nome della finestra principale, assegnato in
	// cmd/streamai/main.go (`application.WebviewWindowOptions{Name: "main"}`).
	// Serve a ridurla a icona mentre il PiP è aperto e a ripristinarla alla
	// chiusura: senza, resterebbe una finestra grande e vuota dietro a quella
	// PiP, con l'utente che vede due finestre per lo stesso stream.
	MainWindowName = "main"

	// WindowURL carica lo stesso bundle con il flag che fa montare la vista
	// ridotta al posto dell'app completa (vedi frontend/index.tsx).
	WindowURL = "/?pip=1"

	// EventOpened / EventClosed notificano alla finestra principale il cambio
	// di stato, così può rallentare/riprendere il proprio loop di render.
	EventOpened = "pip:opened"
	EventClosed = "pip:closed"

	// EventUpdated segnala che il canale è cambiato mentre la finestra PiP era
	// già aperta. Senza, la vista PiP continuerebbe a descrivere il canale di
	// apertura: titolo sbagliato nella barra e — ora che c'è la timeline — una
	// barra di posizione disegnata sul tipo di contenuto sbagliato.
	EventUpdated = "pip:updated"

	// DefaultWidth/DefaultHeight: 480×270 = 16:9, la stessa proporzione del
	// video, così non ci sono bande nere.
	DefaultWidth  = 480
	DefaultHeight = 270
	// MinWidth/MinHeight: sotto questi valori la finestra è inutilizzabile.
	MinWidth  = 240
	MinHeight = 135
)

// OpenOptions parametrizza l'apertura (e l'aggiornamento) della finestra PiP.
type OpenOptions struct {
	// Title mostrato nella barra di trascinamento della finestra PiP.
	Title string `json:"title"`

	// IsLive: un canale live non ha una timeline da mostrare (durata ignota e
	// non cercabile).
	IsLive bool `json:"isLive"`

	// SeekDisabled: il server non supporta il seek (lo rileva il probe HTTP di
	// byte-range nella finestra principale). La timeline va disegnata come non
	// utilizzabile, invece di far credere che il trascinamento funzioni.
	SeekDisabled bool `json:"seekDisabled"`
}

// WindowState è lo stato osservabile della finestra PiP.
//
// Il titolo è qui e non solo nel titolo OS della finestra perché la finestra
// PiP è frameless: la sua barra è HTML dentro la vista, che deve quindi
// conoscere il nome del canale. Passarlo nella query string dell'URL sarebbe
// fragile (encoding, caratteri non ASCII nei nomi dei canali).
type WindowState struct {
	Open  bool   `json:"open"`
	Title string `json:"title"`

	// IsLive e SeekDisabled descrivono il canale in riproduzione: con questi la
	// vista PiP decide se mostrare la timeline e se può essere trascinata.
	IsLive       bool `json:"isLive"`
	SeekDisabled bool `json:"seekDisabled"`

	// Fullscreen è lo stato **reale** della finestra, non quello che la vista
	// crede: il compositor può uscire dal fullscreen per conto suo (scorciatoia
	// di sistema), e l'icona del pulsante deve seguirlo.
	Fullscreen bool `json:"fullscreen"`

	// EdgeResize chiede al frontend di disegnare le proprie maniglie di
	// ridimensionamento sui bordi.
	//
	// Serve perché il runtime JS di Wails gestisce il resize dai bordi **solo
	// su Windows**: `drag.js` esce subito con
	// `if (!resizable || !IsWindows()) return`. Su Linux (e macOS) quindi il
	// resize nativo non parte mai, anche se il lato Go è implementato
	// (`startResize` → `gtk_window_begin_resize_drag`).
	//
	// Il frontend non deve indovinare la piattaforma: la capacità arriva da qui.
	EdgeResize bool `json:"edgeResize"`
}

// Service gestisce la finestra PiP. Registrato come Wails Service in main.go.
type Service struct {
	// mu protegge solo la sezione "cerca-o-crea" di Open: mai tenuto durante
	// una Close() (vedi il commento sul package).
	mu sync.Mutex
	// title è l'ultimo titolo richiesto, letto dalla vista PiP e dai log.
	// atomic e non sotto `mu` perché lo scrive anche il callback di chiusura.
	title atomic.Pointer[string]
	// media è il tipo di canale corrente (live? seekabile?): la vista PiP lo usa
	// per disegnare o meno la timeline. Atomic come il titolo, e per lo stesso
	// motivo: lo aggiorna anche Update(), che gira mentre l'utente naviga.
	media atomic.Pointer[mediaInfo]
}

// mediaInfo è quanto la vista PiP deve sapere del canale in riproduzione per
// costruire i propri controlli.
type mediaInfo struct {
	isLive       bool
	seekDisabled bool
}

// New costruisce il servizio. Nessuna risorsa allocata finché non si apre la
// finestra: il costo a riposo è zero.
func New() *Service { return &Service{} }

func (s *Service) setTitle(t string) { s.title.Store(&t) }

func (s *Service) currentTitle() string {
	if p := s.title.Load(); p != nil {
		return *p
	}
	return ""
}

func (s *Service) setMedia(isLive, seekDisabled bool) {
	s.media.Store(&mediaInfo{isLive: isLive, seekDisabled: seekDisabled})
}

func (s *Service) currentMedia() mediaInfo {
	if p := s.media.Load(); p != nil {
		return *p
	}
	return mediaInfo{}
}

// osTitle è il titolo della finestra di sistema del PiP.
//
// Il titolo OS non è estetica: su Wayland l'unico modo per ottenere "sempre
// sopra le altre" è una **regola di finestra del compositor**, e una regola deve
// poter riconoscere la finestra (vedi docs/pip-design.md §4-quater).
//
// È **costante**: non contiene il nome del canale, che cambia a ogni zapping e
// quindi non è un criterio utilizzabile (e la barra HTML della vista lo mostra
// comunque, questo titolo compare solo nella barra delle applicazioni e
// nell'alt-tab).
//
// PERCHÉ COSTANTE E NON UN PREFISSO. Su Wayland la regola si scrive a mano in
// kwinrulesrc, dove il tipo di confronto è un numero (`titlematch`); un titolo
// cercato come "esatto" non trova mai "StreamAI PiP — Rai 1 HD", e la regola
// fallirebbe **in silenzio** — nel modo peggiore, perché l'utente la vede
// elencata e crede che sia attiva. Se invece il titolo della finestra coincide
// con la stringa cercata, il confronto riesce con qualunque modo (esatto,
// sottostringa o espressione regolare): la stringa non ha metacaratteri e
// contiene sé stessa. Così la regola non dipende da un valore che non possiamo
// controllare né verificare.
//
// Lo script che crea la regola cerca questa stessa stringa: se cambia qui, va
// cambiata in `scripts/kwin-pip-above.sh` (guard:
// TestOSTitle_MatchesWindowRuleScript).
const osTitle = "StreamAI PiP"

// Open apre la finestra PiP, o la riporta in primo piano se è già aperta.
// Ritorna true se la finestra è (ora) visibile.
//
// Idempotente per costruzione: la ricerca per nome sul WindowManager evita di
// creare finestre duplicate se l'utente preme `P` due volte.
func (s *Service) Open(opts OpenOptions) (bool, error) {
	app := application.Get()
	if app == nil {
		return false, errors.New("pip: applicazione Wails non ancora inizializzata")
	}

	title := opts.Title
	if title == "" {
		title = "StreamAI"
	}
	s.setTitle(title)
	s.setMedia(opts.IsLive, opts.SeekDisabled)

	s.mu.Lock()
	if existing, ok := app.Window.GetByName(WindowName); ok && existing != nil {
		// Già aperta: la portiamo davanti invece di aprirne una seconda.
		existing.SetTitle(osTitle)
		existing.Focus()
		s.mu.Unlock()
		// Il canale può essere cambiato da quando la finestra è stata aperta: la
		// vista deve aggiornare barra e timeline.
		wailsevents.Emit(EventUpdated, s.State())
		return true, nil
	}
	w := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   WindowName,
		Title:  osTitle,
		URL:    WindowURL,
		Width:  DefaultWidth,
		Height: DefaultHeight,
		// Ridimensionabile ma non sotto la soglia di usabilità; il 16:9 non è
		// imposto: l'utente può allargarla, il video si adatta.
		MinWidth:    MinWidth,
		MinHeight:   MinHeight,
		AlwaysOnTop: true,
		// La barra di trascinamento è nostra (vista PiP, `--wails-draggable`):
		// una titlebar di sistema su una finestra always-on-top ruberebbe
		// spazio e sarebbe l'unica parte dell'app non a tema.
		Frameless: true,
		// Sfondo nero: senza, tra la creazione della finestra e il primo frame
		// disegnato si vedrebbe il bianco di default del webview.
		BackgroundColour: application.NewRGB(0, 0, 0),
		InitialPosition:  application.WindowCentered,
	})
	s.mu.Unlock()

	if w == nil {
		return false, errors.New("pip: creazione della finestra fallita")
	}

	// `Frameless: true` da solo NON basta su Linux/Wayland: GTK3 smette di
	// disegnare le sue decorazioni ma il compositor ne aggiunge di proprie.
	// Serve una titlebar vuota lato client — vedi internal/pkg/gtkframe, che
	// spiega la trappola e la contromisura. No-op altrove.
	//
	// Due momenti: subito dopo la creazione (per il caso in cui la finestra
	// esista già) e quando il runtime è pronto. La funzione è idempotente.
	gtkframe.Apply()
	w.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		gtkframe.Apply()
	})

	// La chiusura può avvenire anche dall'esterno (window manager, Alt+F4):
	// senza questo hook la finestra principale resterebbe convinta che il PiP
	// sia ancora aperto e terrebbe il proprio loop di render rallentato, cioè
	// il video resterebbe a 0.5 fps.
	w.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		s.setTitle("")
		restoreMainWindow(app)
		log.Info().Msg("pip: finestra chiusa")
		wailsevents.Emit(EventClosed, nil)
	})

	// La finestra principale va a icona: il PiP esiste per guardare altro
	// mentre si fa altro, e due finestre per lo stesso stream (una grande e
	// vuota dietro) sono solo confusione. Viene ripristinata alla chiusura.
	minimiseMainWindow(app)
	// Il focus torna sul PiP: ridurre la finestra principale può spostarlo su
	// un'altra applicazione, e senza focus le scorciatoie del PiP (Spazio, M,
	// Esc) non arriverebbero più.
	w.Focus()

	// Wayland non ha un protocollo con cui un client chieda di restare sopra le
	// altre finestre: `AlwaysOnTop` funziona su X11, Windows e macOS, ma qui
	// resta una richiesta senza effetto. Meglio dirlo che lasciar credere a un
	// bug dell'app (vedi docs/pip-design.md §4-quater).
	if os.Getenv("WAYLAND_DISPLAY") != "" && os.Getenv("GDK_BACKEND") != "x11" {
		log.Warn().Msg("pip: sessione Wayland — \"sempre sopra\" non è supportato dal compositor; " +
			"se la finestra finisce dietro le altre serve la regola di KWin " +
			"(scripts/kwin-pip-above.sh, docs/pip-design.md §4-quater)")
	}

	// `os_title` è ciò che la regola di finestra del compositor deve
	// riconoscere: se un giorno "sempre sopra" non funzionasse, questo log dice
	// subito se il titolo visto da KWin è quello atteso, senza doverlo dedurre.
	log.Info().Str("title", title).Str("os_title", osTitle).Msg("pip: finestra aperta")
	// Payload = stato completo (come EventUpdated): la vista PiP ricava da un
	// solo evento titolo, tipo di canale e stato del fullscreen.
	wailsevents.Emit(EventOpened, s.State())
	return true, nil
}

// Update aggiorna titolo e tipo di canale di una finestra PiP già aperta, senza
// portarla in primo piano.
//
// Esiste perché il PiP resta aperto mentre l'utente cambia canale nella finestra
// principale: senza, la barra mostrerebbe ancora il canale di apertura e la
// timeline verrebbe disegnata per il tipo sbagliato (barra di posizione su un
// canale live, o nessuna barra su un film).
//
// Non chiama Focus() di proposito: rubare il focus mentre l'utente naviga nella
// finestra principale sarebbe il difetto opposto a quello che risolve.
func (s *Service) Update(opts OpenOptions) {
	title := opts.Title
	if title == "" {
		title = "StreamAI"
	}
	// Lo stato si registra sempre, anche senza finestra: è quello che la vista
	// PiP leggerà alla prossima apertura.
	s.setTitle(title)
	s.setMedia(opts.IsLive, opts.SeekDisabled)

	app := application.Get()
	if app == nil {
		return
	}
	w, ok := app.Window.GetByName(WindowName)
	if !ok || w == nil {
		return
	}
	w.SetTitle(osTitle)
	wailsevents.Emit(EventUpdated, s.State())
}

// ToggleFullscreen porta la finestra PiP a tutto schermo, o la riporta alla
// dimensione precedente, e ritorna lo stato letto subito dopo la richiesta.
//
// Quello stato può essere ancora il precedente: su GTK il fullscreen è una
// richiesta al compositor e non viene applicata in modo sincrono. Per questo la
// vista non si fida di un valore ottimistico ma rilegge `State()` quando mostra
// i controlli — cioè quando l'icona è davvero visibile.
func (s *Service) ToggleFullscreen() (bool, error) {
	app := application.Get()
	if app == nil {
		return false, errors.New("pip: applicazione Wails non ancora inizializzata")
	}
	w, ok := app.Window.GetByName(WindowName)
	if !ok || w == nil {
		return false, errors.New("pip: finestra PiP non aperta")
	}
	w.ToggleFullscreen()
	return w.IsFullscreen(), nil
}

// minimiseMainWindow riduce a icona la finestra principale.
//
// Best-effort: se la finestra non esiste (app in smontaggio, test) non è un
// errore. `Minimise` è idempotente.
func minimiseMainWindow(app *application.App) {
	w, ok := app.Window.GetByName(MainWindowName)
	if !ok || w == nil {
		log.Warn().Msg("pip: finestra principale non trovata, non posso ridurla a icona")
		return
	}
	w.Minimise()
}

// restoreMainWindow ripristina la finestra principale se è ridotta a icona.
//
// Il controllo `IsMinimised` evita di riportare in primo piano una finestra che
// l'utente ha ridotto per conto suo e che il PiP non ha toccato: deiconificarla
// sarebbe un furto di focus.
func restoreMainWindow(app *application.App) {
	w, ok := app.Window.GetByName(MainWindowName)
	if !ok || w == nil {
		return
	}
	if w.IsMinimised() {
		w.Restore()
	}
	w.Focus()
}

// Close chiude la finestra PiP. No-op se non è aperta (idempotente: viene
// chiamata anche su `Escape` e alla chiusura dell'app).
//
// Non tiene `mu` mentre chiude: `Close()` fa scattare l'hook di WindowClosing
// registrato in Open(), che è lo stesso goroutine del chiamante.
func (s *Service) Close() error {
	app := application.Get()
	if app == nil {
		return nil
	}
	w, ok := app.Window.GetByName(WindowName)
	if !ok || w == nil {
		return nil
	}
	// L'evento `EventClosed` arriva dall'hook registrato in Open(): non lo
	// emettiamo anche qui, altrimenti la finestra principale riceverebbe due
	// notifiche per la stessa chiusura.
	w.Close()
	return nil
}

// resizeEdges sono i bordi accettati da StartResize, con i nomi che Wails
// traduce in `GdkWindowEdge` (`gdkEdgeForBorder`).
var resizeEdges = map[string]bool{
	"n-resize": true, "s-resize": true, "e-resize": true, "w-resize": true,
	"ne-resize": true, "nw-resize": true, "se-resize": true, "sw-resize": true,
}

// StartResize avvia il ridimensionamento della finestra PiP dal bordo indicato.
//
// PERCHÉ PASSA DA HandleMessage. Il runtime JS di Wails sa inviare il messaggio
// `wails:resize:<edge>`, ma attiva quella logica **solo su Windows**
// (`drag.js`: `if (!resizable || !IsWindows()) return`). Il backend GTK3 invece
// è pronto: `HandleMessage` → `startResize` → `gtk_window_begin_resize_drag`,
// che riusa le coordinate del click già registrate dal gestore nativo
// `button-press-event` (`w.drag`). Quindi basta inviare quel messaggio, e
// `Window.HandleMessage` è l'API pubblica che lo fa — senza toccare interni di
// Wails né il trasporto IPC del webview (che il pacchetto runtime non espone).
func (s *Service) StartResize(edge string) error {
	if !resizeEdges[edge] {
		return fmt.Errorf("pip: bordo di resize sconosciuto %q", edge)
	}
	app := application.Get()
	if app == nil {
		return errors.New("pip: applicazione Wails non ancora inizializzata")
	}
	w, ok := app.Window.GetByName(WindowName)
	if !ok || w == nil {
		return errors.New("pip: finestra PiP non aperta")
	}
	// Log esplicito: se la finestra non si ridimensiona, questo dice se la
	// richiesta è almeno arrivata al backend. Senza, "non si scala" resta
	// indistinguibile fra "la maniglia non è raggiungibile" (lato vista) e
	// "il compositor rifiuta il resize" (lato GTK).
	log.Info().Str("edge", edge).Msg("pip: resize richiesto")
	w.HandleMessage("wails:resize:" + edge)
	return nil
}

// State riporta stato e titolo della finestra PiP.
//
// Il frontend lo usa al mount per allineare l'indicatore: un reload della
// webview principale non tocca il WindowManager, quindi la finestra PiP può
// essere ancora aperta mentre lo stato JS crede di no.
func (s *Service) State() WindowState {
	app := application.Get()
	if app == nil {
		return WindowState{}
	}
	w, ok := app.Window.GetByName(WindowName)
	open := ok && w != nil
	if !open {
		return WindowState{}
	}
	m := s.currentMedia()
	return WindowState{
		Open:         true,
		Title:        s.currentTitle(),
		EdgeResize:   edgeResizeSupported,
		IsLive:       m.isLive,
		SeekDisabled: m.seekDisabled,
		Fullscreen:   w.IsFullscreen(),
	}
}

// ServiceShutdown chiude la finestra PiP alla chiusura dell'app. Wails chiude
// comunque tutte le finestre, ma esplicito evita che una finestra always-on-top
// sopravviva per un istante alla finestra principale.
func (s *Service) ServiceShutdown() error {
	log.Info().Msg("pip: ServiceShutdown")
	return s.Close()
}
