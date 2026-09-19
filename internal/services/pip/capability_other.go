//go:build !linux

package pip

// edgeResizeSupported è false su Windows, dove il runtime JS di Wails gestisce
// già il resize dai bordi (controlla la posizione del mouse e invia
// `wails:resize:<edge>` prima di valutare il trascinamento), e su macOS, dove
// non è stato verificato: aggiungere maniglie nostre lì sarebbe un secondo
// meccanismo in concorrenza col primo.
const edgeResizeSupported = false
