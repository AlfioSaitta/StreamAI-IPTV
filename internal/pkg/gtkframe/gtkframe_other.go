// No-op per le piattaforme dove il workaround non serve o non è verificato:
// Windows e macOS (i runtime lì decorano come richiesto) e Linux con backend
// non-GTK3 (build senza `-tags gtk3`), dove `gtk_window_list_toplevels` non
// esiste. Vedi il commento di package in gtkframe_gtk3.go.

//go:build !linux || !gtk3

package gtkframe

// Apply non fa nulla: sulle piattaforme non GTK3 non c'è nulla da correggere.
func Apply() {}
