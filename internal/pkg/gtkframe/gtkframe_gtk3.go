//go:build linux && gtk3

// Package gtkframe — rimozione reale delle decorazioni su GTK3/Wayland.
//
// # IL PROBLEMA
//
// Wails v3 implementa `WebviewWindowOptions.Frameless` chiamando
// `gtk_window_set_decorated(FALSE)`. Su X11 funziona. Su **Wayland** no: GTK3
// non disegna più le sue decorazioni, ma il compositor negozia le decorazioni
// via `xdg-decoration` e, non trovando una superficie di decorazione lato
// client, ne disegna di proprie. Risultato: la finestra resta decorata e
// `Frameless` non ha alcun effetto visibile.
//
// Verificato su KDE Plasma 6 / KWin Wayland (openSUSE Tumbleweed, GTK 3.24.53)
// con una sonda minima: con `set_decorated(FALSE)` la finestra mostra la
// titlebar di KWin; con una **titlebar vuota lato client** (CSD attive, nessun
// widget visibile) la finestra appare completamente pulita.
//
// # LA CONTROMISURA
//
// È il trucco standard per GTK3 su Wayland: invece di disattivare le
// decorazioni, si fornisce al client una titlebar propria e **vuota**. Il
// compositor vede un client che gestisce le proprie decorazioni e non ne
// aggiunge.
//
// La applichiamo a ogni toplevel con `decorated == FALSE`, cioè esattamente
// alle finestre per cui Wails ha già chiesto l'assenza di decorazioni: oggi
// solo la finestra PiP. È idempotente (salta le finestre che hanno già una
// titlebar propria) e non tocca le finestre decorate normalmente.
//
// # LIMITI
//
//   - Vale per il backend **GTK3** (build con `-tags gtk3`), l'unico con
//     `gtk_window_list_toplevels`. Su GTK4 il file non viene compilato e
//     resta il no-op: lì la funzione esiste ma non è verificata.
//   - È un workaround a una limitazione del runtime, non una funzionalità:
//     quando Wails lo risolverà (o passeremo a un backend che decora
//     diversamente) questo package va cancellato.
package gtkframe

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>

// Contatore diagnostico: quante finestre sono state sistemate in totale.
static int streamai_frame_fixed = 0;
static int streamai_frame_attempts = 0;

static gboolean streamai_apply_idle(gpointer data) {
    int *attempts = (int *) data;
    (*attempts)++;
    streamai_frame_attempts = *attempts;

    GList *wins = gtk_window_list_toplevels();
    int fixed_now = 0;
    for (GList *l = wins; l != NULL; l = l->next) {
        if (l->data == NULL || !GTK_IS_WINDOW(l->data)) {
            continue;
        }
        GtkWindow *w = GTK_WINDOW(l->data);
        // Solo le finestre per cui Wails ha chiesto l'assenza di decorazioni.
        if (gtk_window_get_decorated(w)) {
            continue;
        }
        // Già sistemata (o titlebar propria legittima): non la tocchiamo.
        if (gtk_window_get_titlebar(w) != NULL) {
            continue;
        }
        GtkWidget *bar = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 0);
        gtk_widget_set_size_request(bar, -1, 1);
        gtk_widget_show(bar);
        gtk_window_set_titlebar(w, bar);
        fixed_now++;
    }
    g_list_free(wins);
    streamai_frame_fixed += fixed_now;

    // La finestra può non esistere ancora (creazione asincrona sul main
    // thread di GTK): riproviamo per qualche secondo prima di arrenderci.
    if (fixed_now == 0 && *attempts < 25) {
        return G_SOURCE_CONTINUE;
    }
    g_free(attempts);
    return G_SOURCE_REMOVE;
}

// streamai_fix_frameless_windows accoda il lavoro sul main loop di GTK.
// g_timeout_add è sicura da thread non-main (il main context di default è
// protetto da lock): non serve che il chiamante sia sul thread della UI.
static void streamai_fix_frameless_windows(void) {
    int *attempts = (int *) g_malloc0(sizeof(int));
    g_timeout_add(120, streamai_apply_idle, attempts);
}

static int streamai_frameless_fixed(void) {
    return streamai_frame_fixed;
}

static int streamai_frameless_attempts(void) {
    return streamai_frame_attempts;
}
*/
import "C"

import (
	"time"

	"github.com/rs/zerolog/log"
)

// Apply chiede al main loop di GTK di sostituire le decorazioni delle finestre
// frameless con una titlebar vuota lato client. Non blocca: il lavoro avviene
// sul thread della UI e la finestra può non esistere ancora (vengono fatti
// alcuni tentativi).
func Apply() {
	C.streamai_fix_frameless_windows()

	// Esito nel log: senza, un fallimento del workaround sarebbe invisibile e
	// la finestra resterebbe decorata senza che nessuno sappia perché.
	go func() {
		time.Sleep(1200 * time.Millisecond)
		fixed := int(C.streamai_frameless_fixed())
		attempts := int(C.streamai_frameless_attempts())
		if fixed == 0 {
			log.Warn().
				Int("attempts", attempts).
				Msg("gtkframe: nessuna finestra frameless trovata, le decorazioni resteranno visibili su Wayland")
			return
		}
		log.Info().
			Int("windows", fixed).
			Int("attempts", attempts).
			Msg("gtkframe: decorazioni rimosse (titlebar vuota lato client)")
	}()
}
