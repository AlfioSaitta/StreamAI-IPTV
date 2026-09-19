// Lato Go del callback di update di libmpv.
//
// Questo file esiste separato da `mpv_cgo.go` per un vincolo di cgo: il
// preambolo di un file che usa `//export` può contenere solo DICHIARAZIONI,
// mentre il preambolo di `mpv_cgo.go` definisce le helper `streamai_*`.
//
// Il flusso è:
//
//	libmpv (thread proprio) → streamai_update_trampoline (callback_cgo.c)
//	                        → goPlayerUpdateCallback (//export, qui sotto)
//	                        → needsUpdate = true  (solo un flag: dentro il
//	                          callback non si possono chiamare funzioni libmpv)
//	RenderFrame (thread HTTP) → mpv_render_context_update() → decide se
//	                          renderizzare o riusare il frame precedente.
//
//go:build mpv && (linux || darwin)

package player

// // Il contesto è dichiarato `void*` di proposito: questo file non può
// // includere header di mpv (in un file con `//export` il preambolo può
// // contenere solo dichiarazioni, e gli header mpv contengono definizioni
// // `static inline`). Il cast a `mpv_render_context*` avviene in
// // callback_cgo.c, che include <mpv/render.h>.
// int streamai_set_update_callback(void *ctx);
import "C"

import "sync/atomic"

// activeBackend è il backend a cui notificare gli update di mpv.
//
// Il trampoline C non riceve alcun contesto utile (il `ctx` che libmpv
// rimanda indietro è quello che gli passiamo noi, e non possiamo metterci un
// puntatore Go), quindi la notifica arriva "senza destinatario". Con il Service
// singleton dell'app basta tenere l'ultimo backend inizializzato: nel caso
// patologico di due backend vivi, la notifica in più provoca al massimo un
// render addizionale, mai un frame mancante (il gating richiede comunque una
// conferma da `mpv_render_context_update`).
var activeBackend atomic.Pointer[cgoBackend]

//export goPlayerUpdateCallback
func goPlayerUpdateCallback() {
	if b := activeBackend.Load(); b != nil {
		b.needsUpdate.Store(true)
	}
}
