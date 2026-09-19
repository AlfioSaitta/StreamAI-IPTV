//go:build linux && gtk3 && gtkframetest

// Helper cgo per i test del package. Vivono in un file normale (non `_test.go`)
// perché Go non supporta cgo nei file di test, e sono protetti dal tag
// `gtkframetest`: **non entrano nel binario di produzione**.
//
// Esecuzione dei test:
//
//	go test -tags 'gtk3 gtkframetest' ./internal/pkg/gtkframe/
package gtkframe

/*
#cgo pkg-config: gtk+-3.0
#include <gtk/gtk.h>
#include <string.h>

// Crea una finestra esattamente come la crea Wails per il PiP: decorazioni
// disattivate a livello GTK. Non la mostriamo (nessun artefatto a schermo):
// gtk_window_list_toplevels() elenca le GtkWindow esistenti, non solo quelle
// mappate.
static int test_create_window(const char *title, int decorated) {
    if (!gtk_init_check(NULL, NULL)) {
        return 0;
    }
    GtkWidget *w = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_title(GTK_WINDOW(w), title);
    gtk_window_set_decorated(GTK_WINDOW(w), decorated ? TRUE : FALSE);
    return 1;
}

static int test_has_titlebar(const char *title) {
    GList *wins = gtk_window_list_toplevels();
    int found = 0;
    for (GList *l = wins; l != NULL; l = l->next) {
        if (l->data == NULL || !GTK_IS_WINDOW(l->data)) {
            continue;
        }
        GtkWindow *w = GTK_WINDOW(l->data);
        if (g_strcmp0(gtk_window_get_title(w), title) != 0) {
            continue;
        }
        found = gtk_window_get_titlebar(w) != NULL;
        break;
    }
    g_list_free(wins);
    return found;
}

// Fa avanzare il main loop di GTK: serve a far scattare il g_timeout_add
// accodato da Apply().
static void test_pump(void) {
    while (g_main_context_iteration(NULL, FALSE)) {
    }
}
*/
import "C"

import "unsafe"

// createWindow crea una finestra di prova. Ritorna false senza display.
func createWindow(title string, decorated bool) bool {
	ct := C.CString(title)
	defer C.free(unsafe.Pointer(ct))
	dec := C.int(0)
	if decorated {
		dec = 1
	}
	return C.test_create_window(ct, dec) != 0
}

// hasTitlebar riporta se la finestra con quel titolo ha una titlebar lato client.
func hasTitlebar(title string) bool {
	ct := C.CString(title)
	defer C.free(unsafe.Pointer(ct))
	return C.test_has_titlebar(ct) == 1
}

// pump fa avanzare il main loop di GTK.
func pump() { C.test_pump() }
