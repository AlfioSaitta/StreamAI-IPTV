//go:build !unix

// Stub no-op per piattaforme non-Unix (Windows). La fase 7-bis.2
// estensione introdurrà la versione Windows con CreateMutexW +
// named pipes; finché non c'è, il build cross-piattaforma resta verde
// e il Single-Instance è degradato a "no-op" (entrambe le istanze
// continuerebbero a partire — accettabile temporaneamente perché
// Wails su Windows non è ancora supportato in produzione).
package singleinstance

import "os"

func tryFlock(_ *os.File) error { return nil }
func unflock(_ *os.File) error  { return nil }

