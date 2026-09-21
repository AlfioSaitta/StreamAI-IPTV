// imagecache.go — cache su disco delle immagini servite dal proxy.
//
// PERCHÉ QUI E NON SOLO NEL WEBVIEW. Il frontend ha già una cache immagini in
// IndexedDB, ma vive dentro i dati del webview: si perde se quei dati vengono
// cancellati e non è condivisa fra profili. Questa invece sta nel processo Go e
// la chiave è **l'URL upstream**, quindi due profili che chiedono la stessa
// copertina — tipico: gli URL TMDB dei cataloghi VOD e i loghi dello stesso
// pannello — la scaricano una volta sola, anche a distanza di giorni.
//
// COSA NON ENTRA IN CACHE. Tutto ciò che non è un'immagine di un tipo che
// sappiamo servire. In particolare gli stream video (che verrebbero copiati su
// disco senza limite) e le risposte dell'API Xtream, che portano dati
// dell'account. Il filtro è sul Content-Type e vale solo per le GET.
//
// PERCHÉ IL TIPO È NELL'ESTENSIONE. Il nome del file è `<hash dell'URL><ext>`:
// l'estensione dice come servire i byte, la data del file dice quando scade
// (TTL) e quanto è stata usata di recente (eviction). Così non serve un file di
// metadati per voce, e un file orfano (metadati senza immagine o viceversa) non
// è possibile per costruzione.
package proxy

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

const (
	// imageCacheTTL: per quanto una voce resta valida. Le locandine e i loghi
	// dei pannelli cambiano raramente, e 30 giorni di copertura evitano di
	// riscaricare lo stesso catalogo a ogni sessione.
	imageCacheTTL = 30 * 24 * time.Hour

	// imageCacheEntryLimit: oltre questa dimensione la voce non viene
	// memorizzata (la risposta viene servita comunque).
	imageCacheEntryLimit = 8 << 20 // 8 MiB

	// imageCacheBytesLimit: tetto complessivo su disco. Con ~150 KB per
	// locandina sono qualche migliaio di immagini, cioè più di quanto serva per
	// scorrere un catalogo intero più volte.
	imageCacheBytesLimit = 512 << 20 // 512 MiB

	// imageCacheJanitorInterval: ogni quanto la cache si ripulisce da sola.
	// Senza, una voce scaduta o un eccesso di dimensione restano su disco finché
	// qualcuno non tocca quella voce, o finché l'app non viene riavviata: una
	// sessione lunga non sfoltirebbe mai.
	imageCacheJanitorInterval = 30 * time.Minute

	// imageCacheTouchInterval: quanto deve essere vecchia la data di un file
	// perché una lettura la aggiorni. Serve a tenere l'ordine LRU senza fare una
	// `chtimes` (una scrittura, su disco) a ogni singola richiesta: le immagini
	// calde vengono richieste molte volte al minuto.
	imageCacheTouchInterval = 5 * time.Minute
)

// imageExtByType elenca i tipi che sappiamo servire correttamente da file.
// Gli altri non vengono memorizzati: senza un'estensione affidabile li
// serviremmo con un Content-Type sbagliato, che è peggio di non averli in cache.
var imageExtByType = map[string]string{
	"image/jpeg":               ".jpg",
	"image/jpg":                ".jpg",
	"image/png":                ".png",
	"image/webp":               ".webp",
	"image/gif":                ".gif",
	"image/avif":               ".avif",
	"image/bmp":                ".bmp",
	"image/x-icon":             ".ico",
	"image/vnd.microsoft.icon": ".ico",
}

// imageTypeByExt è l'inverso, per servire i byte dalla cache.
var imageTypeByExt = func() map[string]string {
	out := make(map[string]string, len(imageExtByType))
	for ct, ext := range imageExtByType {
		if _, exists := out[ext]; !exists {
			out[ext] = ct
		}
	}
	// Preferenze esplicite dove più tipi condividono l'estensione.
	out[".jpg"] = "image/jpeg"
	out[".ico"] = "image/x-icon"
	return out
}()

type imageCacheEntry struct {
	name    string
	size    int64
	modTime time.Time
}

// imageCache è un archivio di immagini su disco, con TTL e sfoltimento LRU.
type imageCache struct {
	dir      string
	maxBytes int64
	ttl      time.Duration

	mu      sync.Mutex
	entries map[string]imageCacheEntry
	total   int64
}

// newImageCache prepara la directory e indicizza quello che contiene già.
func newImageCache(dir string, maxBytes int64, ttl time.Duration) (*imageCache, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("creazione %s: %w", dir, err)
	}
	c := &imageCache{
		dir:      dir,
		maxBytes: maxBytes,
		ttl:      ttl,
		entries:  make(map[string]imageCacheEntry),
	}
	c.index()
	return c, nil
}

// index ricostruisce l'indice dal contenuto della directory: la cache deve
// sopravvivere alla chiusura dell'app senza file di stato separati (che
// potrebbero disallinearsi dai file veri).
func (c *imageCache) index() {
	des, err := os.ReadDir(c.dir)
	if err != nil {
		log.Warn().Err(err).Str("dir", c.dir).Msg("proxy: cache immagini non leggibile, riparto da vuota")
		return
	}

	now := time.Now()
	removed := 0
	for _, de := range des {
		if de.IsDir() {
			continue
		}
		name := de.Name()
		full := filepath.Join(c.dir, name)

		// Scritture interrotte (l'app è stata chiusa a metà salvataggio).
		if strings.HasSuffix(name, ".tmp") {
			_ = os.Remove(full)
			removed++
			continue
		}

		key, ok := keyFromFileName(name)
		if !ok {
			continue // file estraneo alla cache: non lo tocchiamo
		}
		info, err := de.Info()
		if err != nil {
			continue
		}
		if now.Sub(info.ModTime()) > c.ttl {
			_ = os.Remove(full)
			removed++
			continue
		}
		c.entries[key] = imageCacheEntry{name: name, size: info.Size(), modTime: info.ModTime()}
		c.total += info.Size()
	}

	log.Info().
		Int("entries", len(c.entries)).
		Int64("bytes", c.total).
		Int("rimosse", removed).
		Str("dir", c.dir).
		Msg("proxy: cache immagini su disco pronta")
}

// get ritorna il file dell'immagine e il suo Content-Type. L'accesso aggiorna
// la data del file, così l'eviction vede quali immagini servono davvero.
func (c *imageCache) get(key string) (string, string, bool) {
	c.mu.Lock()
	entry, found := c.entries[key]
	c.mu.Unlock()
	if !found {
		return "", "", false
	}

	full := filepath.Join(c.dir, entry.name)
	info, err := os.Stat(full)
	if err != nil || time.Since(info.ModTime()) > c.ttl {
		c.remove(key)
		return "", "", false
	}

	contentType := imageTypeByExt[strings.ToLower(filepath.Ext(entry.name))]
	if contentType == "" {
		c.remove(key)
		return "", "", false
	}

	now := time.Now()
	if now.Sub(entry.modTime) > imageCacheTouchInterval {
		if err := os.Chtimes(full, now, now); err == nil {
			c.mu.Lock()
			c.entries[key] = imageCacheEntry{name: entry.name, size: entry.size, modTime: now}
			c.mu.Unlock()
		}
	}
	return full, contentType, true
}

// runJanitor ripulisce la cache a intervalli regolari e ritorna quando `stop`
// viene chiuso. È il processo che tiene la cache manutenuta durante una sessione
// lunga: senza, la pulizia avviene solo all'avvio o quando una voce viene
// richiesta, quindi quello che non viene più chiesto non viene mai liberato.
func (c *imageCache) runJanitor(interval time.Duration, stop <-chan struct{}) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			c.prune()
		}
	}
}

// prune rimuove le voci scadute e riporta la cache sotto il tetto.
func (c *imageCache) prune() {
	now := time.Now()

	c.mu.Lock()
	scadute := make([]string, 0)
	for key, entry := range c.entries {
		if now.Sub(entry.modTime) > c.ttl {
			scadute = append(scadute, key)
		}
	}
	c.mu.Unlock()

	for _, key := range scadute {
		c.remove(key)
	}
	if len(scadute) > 0 {
		log.Debug().Int("scadute", len(scadute)).Msg("proxy: cache immagini, voci scadute rimosse")
	}

	// Il tetto va riapplicato anche senza una scrittura: può essere stato
	// superato prima che la cache fosse ricostruita, o abbassato nel frattempo.
	c.evictIfNeeded()
}

// stats riporta l'occupazione corrente (usata dai log e dai test).
func (c *imageCache) stats() (entries int, bytes int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries), c.total
}

// put memorizza l'immagine con scrittura atomica (file temporaneo + rename):
// un lettore concorrente vede il file vecchio o quello nuovo, mai uno a metà.
func (c *imageCache) put(key, contentType string, data []byte) {
	base := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	ext, ok := imageExtByType[base]
	if !ok || len(data) == 0 || int64(len(data)) > imageCacheEntryLimit {
		return
	}

	name := key + ext
	tmp := filepath.Join(c.dir, name+".tmp")
	full := filepath.Join(c.dir, name)

	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		log.Debug().Err(err).Msg("proxy: scrittura immagine in cache fallita")
		return
	}
	if err := os.Rename(tmp, full); err != nil {
		_ = os.Remove(tmp)
		log.Debug().Err(err).Msg("proxy: rename immagine in cache fallito")
		return
	}

	c.mu.Lock()
	stale := ""
	if old, exists := c.entries[key]; exists {
		c.total -= old.size
		if old.name != name {
			stale = old.name
		}
	}
	c.entries[key] = imageCacheEntry{name: name, size: int64(len(data)), modTime: time.Now()}
	c.total += int64(len(data))
	c.mu.Unlock()

	// Stessa chiave ma estensione diversa: l'upstream ha risposto con un altro
	// Content-Type (es. `image/webp` dove prima dava `image/jpeg`). Il file
	// precedente è appena uscito dall'indice, quindi non verrebbe mai né servito
	// né sfoltito: resterebbe su disco fino alla scadenza del TTL continuando a
	// contare in `total` — cioè a far sfoltire immagini che servono — a ogni
	// ricostruzione dell'indice.
	if stale != "" {
		_ = os.Remove(filepath.Join(c.dir, stale))
	}

	c.evictIfNeeded()
}

// remove toglie una voce sia dall'indice sia dal disco.
func (c *imageCache) remove(key string) {
	c.mu.Lock()
	entry, found := c.entries[key]
	if found {
		delete(c.entries, key)
		c.total -= entry.size
	}
	c.mu.Unlock()
	if found {
		_ = os.Remove(filepath.Join(c.dir, entry.name))
	}
}

// evictIfNeeded riporta la cache sotto il tetto rimuovendo le immagini usate
// meno di recente.
func (c *imageCache) evictIfNeeded() {
	c.mu.Lock()
	if c.total <= c.maxBytes {
		c.mu.Unlock()
		return
	}
	type victim struct {
		key   string
		entry imageCacheEntry
	}
	victims := make([]victim, 0, len(c.entries))
	for k, e := range c.entries {
		victims = append(victims, victim{key: k, entry: e})
	}
	c.mu.Unlock()

	sort.Slice(victims, func(i, j int) bool { return victims[i].entry.modTime.Before(victims[j].entry.modTime) })

	removed := 0
	var freed int64
	c.mu.Lock()
	for _, v := range victims {
		if c.total <= c.maxBytes {
			break
		}
		// La voce esce dall'indice anche se il file non si riesce a rimuovere:
		// resterebbe comunque orfano su disco e verrebbe ripulito al prossimo
		// avvio dall'index().
		delete(c.entries, v.key)
		c.total -= v.entry.size
		if err := os.Remove(filepath.Join(c.dir, v.entry.name)); err == nil {
			removed++
			freed += v.entry.size
		}
	}
	c.mu.Unlock()

	log.Debug().Int("rimosse", removed).Int64("liberatiBytes", freed).Int64("totale", c.total).
		Msg("proxy: cache immagini sfoltita")
}

// imageCacheKey identifica un'immagine dal suo URL upstream. L'hash evita di
// mettere in chiaro sul disco URL che possono contenere le credenziali del
// pannello, e tiene i nomi di file indipendenti dalla lunghezza dell'URL.
func imageCacheKey(upstreamURL string) string {
	sum := sha256.Sum256([]byte(upstreamURL))
	return hex.EncodeToString(sum[:16])
}

// keyFromFileName riconosce i file della cache (`<hash><ext>`) e ne ritorna la
// chiave. Un nome che non corrisponde non è roba nostra.
func keyFromFileName(name string) (string, bool) {
	ext := strings.ToLower(filepath.Ext(name))
	if _, ok := imageTypeByExt[ext]; !ok {
		return "", false
	}
	key := strings.TrimSuffix(name, filepath.Ext(name))
	if len(key) != 32 {
		return "", false
	}
	if _, err := hex.DecodeString(key); err != nil {
		return "", false
	}
	return key, true
}

// isCacheableImageType dice se un Content-Type vale la pena di essere salvato.
func isCacheableImageType(contentType string) bool {
	base := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	_, ok := imageExtByType[base]
	return ok
}

// setCacheHeaders imposta gli header di una risposta servita dalla cache.
func setCacheHeaders(h http.Header, size int64, contentType string) {
	h.Set("Content-Type", contentType)
	h.Set("Content-Length", strconv.FormatInt(size, 10))
	// Gli stessi header che il percorso normale garantisce al webview.
	h.Set("Access-Control-Allow-Origin", "*")
	h.Set("Access-Control-Allow-Headers", "*")
	h.Set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
	// Il webview può tenersi la sua copia: è la stessa immagine.
	h.Set("Cache-Control", "public, max-age=86400")
	// Diagnostica: dice se una copertina lenta è un problema di rete o no.
	h.Set("X-StreamAI-Cache", "hit")
}

// serveImageFromCache scrive l'immagine memorizzata. Ritorna false se il file
// non è leggibile: in quel caso il chiamante prosegue con l'upstream, invece di
// servire una risposta rotta.
func serveImageFromCache(w http.ResponseWriter, path, contentType string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()

	info, err := f.Stat()
	if err != nil {
		return false
	}

	setCacheHeaders(w.Header(), info.Size(), contentType)

	if _, err := io.Copy(w, f); err != nil && !errors.Is(err, context.Canceled) {
		log.Debug().Err(err).Msg("proxy: invio immagine dalla cache interrotto")
	}
	return true
}

// serveImageHeadersFromCache risponde a una HEAD con i soli header, senza corpo
// e senza toccare l'upstream.
//
// È la richiesta con cui il frontend chiede "questa immagine ce l'hai già?" per
// decidere se mostrarla durante la riproduzione di un canale live, quando
// scaricare significherebbe contendere banda allo stream. Deve quindi costare
// zero: se non è in cache la risposta è `204` con `X-StreamAI-Cache: miss`, non
// un giro fino all'host dell'immagine.
func serveImageHeadersFromCache(w http.ResponseWriter, path, contentType string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	setCacheHeaders(w.Header(), info.Size(), contentType)
	w.WriteHeader(http.StatusOK)
	return true
}
