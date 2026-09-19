package player

// Politica di "rendering su richiesta".
//
// Il loop del frontend chiede un frame a cadenza fissa, ma il contenuto IPTV è
// tipicamente 24/25/30p: senza questo controllo una quota significativa delle
// richieste riporta lo STESSO frame, e ogni volta il backend paga una
// conversione colori in CPU da ~3 a ~5 ms. Il caso peggiore è lo stallo
// di rete: mpv non produce nulla e noi continuiamo a riconvertire il frame
// precedente.
//
// La decisione è isolata qui, in una funzione pura senza cgo, per poterla
// testare: è l'invariante di sicurezza che impedisce a questa ottimizzazione di
// trasformarsi in un frame mancante o in un video bloccato.

// GatingDecision descrive perché un frame viene riusato dalla cache.
type GatingDecision int

const (
	// GatingRender: va renderizzato (nessun riuso possibile).
	GatingRender GatingDecision = iota
	// GatingReuse: il frame in cache è ancora valido, si può evitare il render.
	GatingReuse
)

// shouldReuseFrame decide se riusare il frame in cache invece di renderizzare.
//
// Parametri:
//   - sawSignal: libmpv ha già segnalato ALMENO una volta un update da quando
//     il media è stato caricato. Senza questa prova il meccanismo di notifica
//     non è affidabile su questa piattaforma e si renderizza a ogni chiamata:
//     è la garanzia che l'ottimizzazione non possa degradare il comportamento
//     su un sistema dove il callback non arriva.
//   - pending: il callback di update ha segnalato un frame nuovo.
//   - hasFrame: `mpv_render_context_update()` riporta MPV_RENDER_UPDATE_FRAME.
//   - hasValidCache: esiste un frame in cache con le dimensioni richieste.
func shouldReuseFrame(sawSignal, pending, hasFrame, hasValidCache bool) GatingDecision {
	if !sawSignal {
		// Meccanismo mai osservato → comportamento identico a prima del gating.
		return GatingRender
	}
	if pending || hasFrame {
		// C'è un frame nuovo: va renderizzato, mai servito quello vecchio.
		return GatingRender
	}
	if !hasValidCache {
		// Niente da riusare (primo frame, oppure dimensioni cambiate).
		return GatingRender
	}
	return GatingReuse
}
