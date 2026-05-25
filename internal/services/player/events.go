// events.go — Subscriber pattern e push events per il PlayerService
// (Fase 6.5 del plan-go-wails-migration).
//
// Ogni mutazione di stato (Load/Play/Pause/Stop/Seek/SetVolume/SetMuted)
// emette un PlayerStateEvent verso:
//   1. Subscriber Go interni (PowerSave, MediaKeys, NetStatus, Tray)
//      registrati via Service.Subscribe(...). I subscriber girano nello
//      stesso goroutine del chiamante della Setter, in modo sincrono —
//      la lavorazione che blocca a lungo deve essere fatta off-goroutine
//      dal subscriber stesso.
//   2. Frontend tramite Wails event `player-state` (rimpiazza il polling
//      250 ms di `useNativeMpvEngine.ts`).
//
// Inoltre un goroutine "watcher" (avviato lazy al primo Subscribe) fa
// poll backend.State() ogni 1 s mentre `loaded=true`, per catturare
// l'avanzamento di `position` senza richiedere un property-observer
// libmpv. Quando il backend reale wirera' `mpv_observe_property` (Fase
// 6.1) potremo accorciare l'intervallo o disabilitare il polling.
//
// Thread-safety: lo state ring (lastState) e la slice di subscriber
// sono protetti da RWMutex separato (`evMu`) per non collidere con il
// `s.mu` che protegge il backend pointer.
package player

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
)

// EventName e' il nome dell'evento Wails emesso al frontend a ogni
// mutazione di stato. Payload: PlayerStateEvent.
const EventName = "player-state"

// PlayerStateEvent e' il payload emesso. Combina lo snapshot State
// del backend con metadati IPTV-specifici (sourceURL, trackTitle,
// trackArtist) che il frontend popola via Service.SetTrackMetadata.
//
// JSON tag *senza* omitempty per i campi numerici/booleani: i
// subscriber (PowerSave, MediaKeys) si aspettano sempre la shape
// completa per fare diff sui transitions (loaded -> !loaded).
type PlayerStateEvent struct {
	State

	// SourceURL e' l'ultimo URL passato a Load() (utile per debug e
	// per riconoscere "stesso stream" su reload).
	SourceURL string `json:"sourceUrl"`

	// TrackTitle / TrackArtist / TrackArtURL sono metadati IPTV
	// (canale Live, episodio Series, film VOD) che il frontend imposta
	// via Service.SetTrackMetadata. Servono a MPRIS2 (mediakeys) per
	// mostrare titolo nel widget del DE e a NetStatus per il payload
	// LAN broadcast.
	TrackTitle  string `json:"trackTitle"`
	TrackArtist string `json:"trackArtist"`
	TrackArtURL string `json:"trackArtUrl"`
}

// subscriberID monotonic counter per generare token unici.
var subscriberID atomic.Uint64

// subscriber e' l'entry nella fanout map.
type subscriber struct {
	id uint64
	fn func(PlayerStateEvent)
}

// Subscribe registra una callback per le mutazioni di stato del
// player. Ritorna `unsubscribe`: chiamarla per rimuovere la callback.
// Idempotente sulle chiamate multiple a unsubscribe (no-op dopo la
// prima).
//
// NB: il metodo NON e' auto-bindato al frontend (Wails v3 bindgen
// salta i metodi con `func` argument). Il frontend si iscrive ai
// PlayerStateEvent tramite `Events.On("player-state", ...)`.
//
// I subscriber sono invocati in ordine di registrazione, sincronamente
// dal goroutine che ha generato l'evento. Una callback bloccante
// blocca anche le successive — usare goroutine interna se serve
// lavoro pesante.
func (s *Service) Subscribe(fn func(PlayerStateEvent)) (unsubscribe func()) {
	if fn == nil {
		return func() {}
	}
	id := subscriberID.Add(1)
	s.evMu.Lock()
	s.subscribers = append(s.subscribers, subscriber{id: id, fn: fn})
	wasEmpty := len(s.subscribers) == 1
	s.evMu.Unlock()

	// Avvia il watcher al primo subscriber (lazy: l'overhead 1 s
	// non viene pagato se nessuno ascolta).
	if wasEmpty {
		s.startWatcher()
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			s.evMu.Lock()
			for i, sub := range s.subscribers {
				if sub.id == id {
					s.subscribers = append(s.subscribers[:i], s.subscribers[i+1:]...)
					break
				}
			}
			s.evMu.Unlock()
		})
	}
}

// SetTrackMetadata aggiorna i metadati track-level IPTV (chiamato
// dal frontend prima di Load(...) per popolare title/artist/artURL
// usati da MPRIS / NetStatus). Esposto al binding TS.
func (s *Service) SetTrackMetadata(title, artist, artURL string) error {
	s.evMu.Lock()
	s.trackTitle = title
	s.trackArtist = artist
	s.trackArtURL = artURL
	s.evMu.Unlock()
	// Emit immediato per propagare i metadati ai subscriber.
	s.emitState()
	return nil
}

// emitState snapshotta lo stato corrente + metadati e fa fanout
// ai subscriber Go + Wails event. Chiamato post-mutating-op.
//
// Errori sullo State() del backend non sono fatali: emettiamo un
// evento "best-effort" con i metadati ultimi noti e Loaded=false
// (cosi' i subscriber non si bloccano in stato stale).
func (s *Service) emitState() {
	s.mu.Lock()
	state, err := s.backend.State()
	s.mu.Unlock()
	if err != nil {
		state = State{}
	}

	s.evMu.RLock()
	evt := PlayerStateEvent{
		State:       state,
		SourceURL:   s.sourceURL,
		TrackTitle:  s.trackTitle,
		TrackArtist: s.trackArtist,
		TrackArtURL: s.trackArtURL,
	}
	subs := make([]subscriber, len(s.subscribers))
	copy(subs, s.subscribers)
	s.evMu.RUnlock()

	// Fanout sincrono ai subscriber Go.
	for _, sub := range subs {
		sub.fn(evt)
	}

	// Emit Wails event verso il frontend (no-op se l'app non e'
	// ancora pronta).
	wailsevents.Emit(EventName, evt)
}

// startWatcher avvia il goroutine di poll dello stato (1 s). Idempotente:
// se gia' running, no-op. Si auto-ferma quando i subscriber tornano 0.
func (s *Service) startWatcher() {
	s.evMu.Lock()
	if s.watcherRunning {
		s.evMu.Unlock()
		return
	}
	s.watcherRunning = true
	stopCh := s.watcherStop
	s.evMu.Unlock()

	go func() {
		ticker := time.NewTicker(watcherInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stopCh:
				return
			case <-ticker.C:
				s.evMu.RLock()
				n := len(s.subscribers)
				s.evMu.RUnlock()
				if n == 0 {
					s.evMu.Lock()
					s.watcherRunning = false
					s.evMu.Unlock()
					return
				}
				s.emitState()
			}
		}
	}()
}

// watcherInterval e' la frequenza del poll automatico position/duration.
// 1 s e' sufficiente per timeline UI smooth (la frontend interpola).
const watcherInterval = 1 * time.Second

