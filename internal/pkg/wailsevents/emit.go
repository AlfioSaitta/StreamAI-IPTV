// Package wailsevents — helper sicuro per emettere eventi Wails v3 verso il
// frontend, gestendo la finestra in cui l'app non e' ancora attiva (early
// service startup) o e' gia' stata terminata.
//
// In v3 alpha.93 la API e' `application.Get().Event.EmitEvent(&CustomEvent{...})`.
// Vedi docs/plan-go-wails-migration.md sez. 2.0.
package wailsevents
import (
	"sync/atomic"
	"github.com/wailsapp/wails/v3/pkg/application"
)
// emitDropped conta gli eventi emessi prima che l'app Wails sia inizializzata
// (utile per debug / tests).
var emitDropped atomic.Uint64
// Emit invia un evento al frontend in modo non-bloccante. Se l'app non e'
// ancora pronta, l'evento viene contato come "dropped" e perso (e' atteso
// che il frontend re-richieda lo stato all'avvio).
//
// name: nome dell'evento (es. "device-found", "cast-status").
// data: payload arbitrario (sara' JSON-encoded da Wails).
func Emit(name string, data any) {
	app := application.Get()
	if app == nil || app.Event == nil {
		emitDropped.Add(1)
		return
	}
	app.Event.EmitEvent(&application.CustomEvent{Name: name, Data: data})
}
// DroppedCount ritorna il numero di Emit() falliti perche' l'app non era ancora
// pronta. Solo per diagnostica.
func DroppedCount() uint64 { return emitDropped.Load() }
