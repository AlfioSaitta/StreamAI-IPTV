package proxy

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTestCache(t *testing.T, maxBytes int64, ttl time.Duration) *imageCache {
	t.Helper()
	c, err := newImageCache(t.TempDir(), maxBytes, ttl)
	if err != nil {
		t.Fatalf("newImageCache: %v", err)
	}
	return c
}

func TestImageCache_StoreAndServe(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	key := imageCacheKey("https://image.tmdb.org/t/p/w300/cover.jpg")
	body := []byte("finti byte jpeg")

	c.put(key, "image/jpeg", body)

	path, contentType, ok := c.get(key)
	if !ok {
		t.Fatal("l'immagine appena salvata non è stata ritrovata")
	}
	if contentType != "image/jpeg" {
		t.Fatalf("content type = %q", contentType)
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("lettura dal disco: %v", err)
	}
	if string(got) != string(body) {
		t.Fatalf("byte diversi da quelli salvati: %q", got)
	}
}

// Il tipo di contenuto viaggia nell'estensione: quelli che non sappiamo servire
// correttamente non vengono memorizzati, perché servirli con il Content-Type
// sbagliato è peggio che non averli in cache.
func TestImageCache_SkipsUnknownType(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	key := imageCacheKey("https://provider.example/logo.svg")

	c.put(key, "image/svg+xml", []byte("<svg/>"))

	if _, _, ok := c.get(key); ok {
		t.Fatal("un tipo non gestito non deve finire in cache")
	}
	if entries, err := os.ReadDir(c.dir); err != nil || len(entries) != 0 {
		t.Fatalf("la directory dovrebbe essere vuota, trovati %d file (err=%v)", len(entries), err)
	}
}

func TestImageCache_SkipsOversizeEntry(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	key := imageCacheKey("https://provider.example/enorme.jpg")

	c.put(key, "image/jpeg", make([]byte, imageCacheEntryLimit+1))

	if _, _, ok := c.get(key); ok {
		t.Fatal("una voce oltre il tetto non deve essere memorizzata")
	}
}

// Lo stesso URL può tornare con un Content-Type diverso (content negotiation
// dell'upstream). Il file con l'estensione vecchia esce dall'indice: se restasse
// su disco non verrebbe mai né servito né sfoltito, e continuerebbe a contare in
// `total` — cioè a far sfoltire immagini che servono — a ogni ricostruzione
// dell'indice, per tutti i 30 giorni di TTL.
func TestImageCache_ReplacesEntryWithDifferentExtension(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	key := imageCacheKey("https://image.tmdb.org/t/p/w300/cover.jpg")

	c.put(key, "image/jpeg", []byte("byte jpeg"))
	c.put(key, "image/webp", []byte("byte webp"))

	path, contentType, ok := c.get(key)
	if !ok {
		t.Fatal("l'immagine deve essere ancora in cache dopo la sostituzione")
	}
	if contentType != "image/webp" {
		t.Fatalf("content type = %q, atteso image/webp", contentType)
	}
	if filepath.Ext(path) != ".webp" {
		t.Fatalf("file servito = %q, atteso un .webp", path)
	}
	if entries, _ := os.ReadDir(c.dir); len(entries) != 1 {
		t.Fatalf("il file con l'estensione vecchia deve sparire dal disco: trovati %d file", len(entries))
	}
	if _, bytes := c.stats(); bytes != int64(len("byte webp")) {
		t.Fatalf("byte contati = %d, attesi %d", bytes, len("byte webp"))
	}
}

func TestImageCache_ExpiresAfterTTL(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, 20*time.Millisecond)
	key := imageCacheKey("https://provider.example/vecchia.png")

	c.put(key, "image/png", []byte("png"))

	if _, _, ok := c.get(key); !ok {
		t.Fatal("alla prima lettura l'immagine deve esserci")
	}

	time.Sleep(40 * time.Millisecond)

	if _, _, ok := c.get(key); ok {
		t.Fatal("dopo il TTL l'immagine non deve più essere servita")
	}
	if entries, _ := os.ReadDir(c.dir); len(entries) != 0 {
		t.Fatalf("la voce scaduta dovrebbe essere rimossa dal disco, trovati %d file", len(entries))
	}
}

// Tetto di dimensione: si libera spazio partendo dall'immagine usata meno di
// recente. È il caso che protegge il disco da un catalogo da 20.000 copertine.
func TestImageCache_EvictsLeastRecentlyUsed(t *testing.T) {
	// Tre immagini da 100 byte con un tetto di 250: una deve uscire.
	c := newTestCache(t, 250, imageCacheTTL)
	keys := []string{
		imageCacheKey("https://provider.example/1.jpg"),
		imageCacheKey("https://provider.example/2.jpg"),
		imageCacheKey("https://provider.example/3.jpg"),
	}
	payload := make([]byte, 100)

	for _, k := range keys {
		c.put(k, "image/jpeg", payload)
	}

	// `put` avviene nello stesso millisecondo: le date si impostano a mano,
	// altrimenti l'ordine di sfoltimento sarebbe casuale.
	base := time.Now().Add(-time.Hour)
	for i, k := range keys {
		path := filepath.Join(c.dir, c.entries[k].name)
		stamp := base.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatalf("Chtimes: %v", err)
		}
		c.mu.Lock()
		entry := c.entries[k]
		entry.modTime = stamp
		c.entries[k] = entry
		c.mu.Unlock()
	}

	// La quarta immagine sfonda il tetto e fa uscire la più vecchia.
	c.put(imageCacheKey("https://provider.example/4.jpg"), "image/jpeg", payload)

	if _, _, ok := c.get(keys[0]); ok {
		t.Error("la voce usata meno di recente doveva essere rimossa")
	}
	if _, _, ok := c.get(keys[2]); !ok {
		t.Error("la voce più recente non doveva essere toccata")
	}
	if c.total > c.maxBytes {
		t.Errorf("cache oltre il tetto: %d byte su %d", c.total, c.maxBytes)
	}
}

// La cache deve sopravvivere alla chiusura dell'app e valere per qualunque
// profilo: è la proprietà per cui esiste (stesso URL, nessun file di stato).
func TestImageCache_SharedAcrossInstances(t *testing.T) {
	dir := t.TempDir()
	key := imageCacheKey("https://image.tmdb.org/t/p/w300/condivisa.jpg")

	first, err := newImageCache(dir, imageCacheBytesLimit, imageCacheTTL)
	if err != nil {
		t.Fatalf("newImageCache: %v", err)
	}
	first.put(key, "image/jpeg", []byte("copertina"))

	// Seconda istanza sulla stessa directory: simula il riavvio dell'app o un
	// altro profilo che chiede la stessa copertina.
	second, err := newImageCache(dir, imageCacheBytesLimit, imageCacheTTL)
	if err != nil {
		t.Fatalf("newImageCache (seconda): %v", err)
	}
	if _, _, ok := second.get(key); !ok {
		t.Fatal("la cache non è sopravvissuta alla ricostruzione dell'indice")
	}
}

func TestImageCache_IndexCleansTmpAndExpired(t *testing.T) {
	dir := t.TempDir()
	expired := imageCacheKey("https://provider.example/scaduta.jpg") + ".jpg"
	tmp := imageCacheKey("https://provider.example/interrotta.jpg") + ".jpg.tmp"
	estraneo := "README.txt"

	if err := os.WriteFile(filepath.Join(dir, expired), []byte("vecchia"), 0o600); err != nil {
		t.Fatalf("scrittura: %v", err)
	}
	old := time.Now().Add(-imageCacheTTL - time.Hour)
	if err := os.Chtimes(filepath.Join(dir, expired), old, old); err != nil {
		t.Fatalf("Chtimes: %v", err)
	}
	for _, name := range []string{tmp, estraneo} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatalf("scrittura %s: %v", name, err)
		}
	}

	c, err := newImageCache(dir, imageCacheBytesLimit, imageCacheTTL)
	if err != nil {
		t.Fatalf("newImageCache: %v", err)
	}

	if len(c.entries) != 0 {
		t.Errorf("una voce scaduta non deve entrare nell'indice, trovate %d", len(c.entries))
	}
	if _, err := os.Stat(filepath.Join(dir, expired)); !os.IsNotExist(err) {
		t.Error("la voce scaduta doveva essere rimossa dal disco")
	}
	if _, err := os.Stat(filepath.Join(dir, tmp)); !os.IsNotExist(err) {
		t.Error("il file temporaneo di una scrittura interrotta doveva essere rimosso")
	}
	// Un file che non è nostro non va toccato.
	if _, err := os.Stat(filepath.Join(dir, estraneo)); err != nil {
		t.Errorf("un file estraneo alla cache è stato rimosso: %v", err)
	}
}

// --- integrazione con l'handler del proxy ---

// newTestProxy costruisce un Service con la cache e un client di test.
func newTestProxy(t *testing.T, upstream *httptest.Server) *Service {
	t.Helper()
	cache := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	return &Service{httpClient: upstream.Client(), imageCache: cache}
}

func proxyRequest(t *testing.T, upstreamURL string) *http.Request {
	t.Helper()
	encoded := base64.RawURLEncoding.EncodeToString([]byte(upstreamURL))
	return httptest.NewRequest(http.MethodGet, proxyPath+"?u="+encoded, nil)
}

// Il cuore della funzionalità: la seconda richiesta della stessa immagine non
// tocca l'upstream.
func TestHandleProxy_ServesImageFromCacheOnSecondRequest(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("copertina"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/cover.jpg"

	// Prima richiesta: passa dall'upstream e memorizza.
	rec1 := httptest.NewRecorder()
	s.handleProxy(rec1, proxyRequest(t, url))
	if got := rec1.Header().Get("X-StreamAI-Cache"); got != "stored" {
		t.Fatalf("prima richiesta: X-StreamAI-Cache = %q, atteso \"stored\"", got)
	}
	if body := rec1.Body.String(); body != "copertina" {
		t.Fatalf("prima richiesta: corpo = %q", body)
	}

	// Seconda richiesta: dalla cache, senza upstream.
	rec2 := httptest.NewRecorder()
	s.handleProxy(rec2, proxyRequest(t, url))
	if got := rec2.Header().Get("X-StreamAI-Cache"); got != "hit" {
		t.Fatalf("seconda richiesta: X-StreamAI-Cache = %q, atteso \"hit\"", got)
	}
	if body := rec2.Body.String(); body != "copertina" {
		t.Fatalf("seconda richiesta: corpo = %q", body)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("l'upstream è stato chiamato %d volte, attesa 1 sola", got)
	}
	// Gli header che servono al webview devono esserci anche dalla cache.
	if rec2.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Error("manca Access-Control-Allow-Origin sulla risposta servita dalla cache")
	}
}

// Uno stream non deve finire su disco: sarebbe una copia illimitata del video.
func TestHandleProxy_DoesNotCacheStreams(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "video/mp2t")
		_, _ = w.Write([]byte("segmento video"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/segment.ts"

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		s.handleProxy(rec, proxyRequest(t, url))
		if got := rec.Header().Get("X-StreamAI-Cache"); got != "" {
			t.Fatalf("richiesta %d: uno stream non deve passare dalla cache (header %q)", i+1, got)
		}
		if rec.Body.String() != "segmento video" {
			t.Fatalf("richiesta %d: corpo = %q", i+1, rec.Body.String())
		}
	}

	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("l'upstream è stato chiamato %d volte, attese 2 (nessuna cache)", got)
	}
	if entries, _ := os.ReadDir(s.imageCacheRef().dir); len(entries) != 0 {
		t.Fatalf("uno stream ha scritto %d file in cache", len(entries))
	}
}

// Una risposta di errore non va memorizzata: il prossimo tentativo deve poter
// riprovare davvero.
func TestHandleProxy_DoesNotCacheErrors(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("non trovata"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/missing.jpg"

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		s.handleProxy(rec, proxyRequest(t, url))
		if strings.Contains(rec.Header().Get("X-StreamAI-Cache"), "hit") {
			t.Fatal("una 404 non deve essere servita dalla cache")
		}
	}

	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("l'upstream è stato chiamato %d volte, attese 2", got)
	}
}

// `Cache-Control: no-cache` dal client salta la lettura della cache: serve a
// forzare il refresh quando una copertina è cambiata.
func TestHandleProxy_HonoursNoCacheRequest(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("copertina"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/cover.jpg"

	rec1 := httptest.NewRecorder()
	s.handleProxy(rec1, proxyRequest(t, url))

	req := proxyRequest(t, url)
	req.Header.Set("Cache-Control", "no-cache")
	rec2 := httptest.NewRecorder()
	s.handleProxy(rec2, req)

	if got := rec2.Header().Get("X-StreamAI-Cache"); got != "stored" {
		t.Fatalf("con no-cache atteso \"stored\", ottenuto %q", got)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("l'upstream è stato chiamato %d volte, attese 2", got)
	}
}

// `no-store` invece salta sia la lettura sia la scrittura: è la richiesta di non
// conservare affatto la risposta.
func TestHandleProxy_HonoursNoStoreRequest(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("copertina"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/cover.jpg"

	req := proxyRequest(t, url)
	req.Header.Set("Cache-Control", "no-store")
	rec := httptest.NewRecorder()
	s.handleProxy(rec, req)

	if got := rec.Header().Get("X-StreamAI-Cache"); got != "" {
		t.Fatalf("con no-store la cache non deve essere toccata, header %q", got)
	}
	if entries, _ := os.ReadDir(s.imageCacheRef().dir); len(entries) != 0 {
		t.Fatalf("con no-store non si deve scrivere nulla, trovati %d file", len(entries))
	}
}

// Manutenzione periodica: senza, una voce scaduta resta su disco finché qualcuno
// non la richiede — cioè, se non viene più richiesta, per sempre.
func TestImageCache_JanitorPrunesExpired(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, 20*time.Millisecond)
	c.put(imageCacheKey("https://provider.example/scaduta.jpg"), "image/jpeg", []byte("jpeg"))

	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		c.runJanitor(10*time.Millisecond, stop)
		close(done)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if entries, _ := c.stats(); entries == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if entries, _ := c.stats(); entries != 0 {
		t.Errorf("il janitor non ha rimosso la voce scaduta: %d voci rimaste", entries)
	}
	if files, _ := os.ReadDir(c.dir); len(files) != 0 {
		t.Errorf("il file scaduto è ancora su disco: %d file", len(files))
	}

	close(stop)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Error("il janitor non si è fermato alla chiusura del canale")
	}
}

// Il tetto va riapplicato anche senza nuove scritture: può essere stato superato
// prima che la cache fosse ricostruita, o abbassato nel frattempo.
func TestImageCache_PruneEnforcesLimitWithoutWrites(t *testing.T) {
	// Tetto iniziale largo: durante le scritture non scatta nessuna eviction,
	// quindi la potatura ha davvero qualcosa da fare.
	c := newTestCache(t, 1<<20, imageCacheTTL)
	for i := 0; i < 6; i++ {
		c.put(imageCacheKey(fmt.Sprintf("https://provider.example/%d.jpg", i)), "image/jpeg", make([]byte, 200))
	}
	if _, bytes := c.stats(); bytes != 1200 {
		t.Fatalf("premessa non valida: attesi 1200 byte, trovati %d", bytes)
	}

	// Il tetto cambia (impostazione abbassata, cache ereditata da una versione
	// precedente): la manutenzione deve riportarla sotto anche senza scritture.
	c.maxBytes = 400
	c.prune()

	if _, bytes := c.stats(); bytes > 400 {
		t.Errorf("dopo la potatura la cache è ancora sopra il tetto: %d byte", bytes)
	}
}

// L'accesso aggiorna la data del file solo se è vecchia: una `chtimes` a ogni
// richiesta sarebbe una scrittura su disco per un'immagine che viene chiesta
// decine di volte al minuto.
func TestImageCache_TouchIsThrottled(t *testing.T) {
	c := newTestCache(t, imageCacheBytesLimit, imageCacheTTL)
	key := imageCacheKey("https://provider.example/calda.jpg")
	c.put(key, "image/jpeg", []byte("jpeg"))

	path := filepath.Join(c.dir, c.entries[key].name)
	prima, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}

	if _, _, ok := c.get(key); !ok {
		t.Fatal("l'immagine deve essere in cache")
	}
	dopo, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if !dopo.ModTime().Equal(prima.ModTime()) {
		t.Error("una voce appena scritta non deve essere ritoccata a ogni lettura")
	}

	// Una voce vecchia invece va ritoccata: è così che l'ordine LRU resta vero.
	vecchia := time.Now().Add(-imageCacheTouchInterval - time.Minute)
	if err := os.Chtimes(path, vecchia, vecchia); err != nil {
		t.Fatalf("Chtimes: %v", err)
	}
	c.mu.Lock()
	entry := c.entries[key]
	entry.modTime = vecchia
	c.entries[key] = entry
	c.mu.Unlock()

	if _, _, ok := c.get(key); !ok {
		t.Fatal("l'immagine deve essere in cache")
	}
	ritoccata, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if !ritoccata.ModTime().After(vecchia) {
		t.Error("una voce vecchia deve essere ritoccata alla lettura")
	}
}

// Sonda di presenza (`HEAD`): il frontend la usa per sapere se un'immagine è già
// in cache **prima** di mostrarla mentre guarda un canale live, quando scaricare
// significherebbe contendere banda allo stream. Deve quindi costare zero in
// entrambi i casi — presente e assente.
func TestHandleProxy_HeadProbeTellsWhetherImageIsCached(t *testing.T) {
	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("copertina"))
	}))
	defer upstream.Close()

	s := newTestProxy(t, upstream)
	url := upstream.URL + "/cover.jpg"

	sonda := func() *httptest.ResponseRecorder {
		t.Helper()
		req := proxyRequest(t, url)
		req.Method = http.MethodHead
		rec := httptest.NewRecorder()
		s.handleProxy(rec, req)
		return rec
	}

	// Assente: risposta negativa, e l'upstream non viene sfiorato.
	rec := sonda()
	if got := rec.Header().Get("X-StreamAI-Cache"); got != "miss" {
		t.Fatalf("sonda a cache vuota: X-StreamAI-Cache = %q, atteso \"miss\"", got)
	}
	if rec.Code != http.StatusNoContent {
		t.Fatalf("sonda a cache vuota: status = %d, atteso 204", rec.Code)
	}
	if rec.Body.Len() != 0 {
		t.Errorf("la sonda non deve avere corpo, %d byte", rec.Body.Len())
	}
	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Fatalf("la sonda non deve toccare l'upstream, chiamate: %d", got)
	}

	// Una GET popola la cache.
	recGet := httptest.NewRecorder()
	s.handleProxy(recGet, proxyRequest(t, url))

	// Presente: risposta affermativa, con la dimensione, senza corpo e sempre
	// senza upstream.
	rec = sonda()
	if got := rec.Header().Get("X-StreamAI-Cache"); got != "hit" {
		t.Fatalf("sonda con immagine in cache: X-StreamAI-Cache = %q, atteso \"hit\"", got)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("sonda con immagine in cache: status = %d, atteso 200", rec.Code)
	}
	if rec.Header().Get("Content-Length") == "" {
		t.Error("la sonda deve riportare la dimensione dell'immagine")
	}
	if rec.Body.Len() != 0 {
		t.Errorf("la sonda non deve avere corpo, %d byte", rec.Body.Len())
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("attesa 1 sola chiamata upstream (la GET), fatte %d", got)
	}
}

// --- wiring di produzione ---

// I test sopra usano una cache iniettata a mano. Qui si passa dal percorso vero:
// `New()` + `initImageCache()` + il server in ascolto, che è quello che fa
// `ServiceStartup`. Serve a coprire la parte che una cache iniettata non tocca —
// la directory di sistema, il client HTTP reale, gli header visti da un client
// HTTP vero — cioè esattamente il tragitto di una copertina che manca.
func TestService_InitImageCacheUsesSystemDirAndServesFromDisk(t *testing.T) {
	cacheHome := t.TempDir()
	// `os.UserCacheDir()` legge l'ambiente a ogni chiamata: su Linux XDG_*,
	// altrove HOME/LOCALAPPDATA. Si impostano tutti e tre per non dipendere
	// dalla piattaforma su cui gira la suite.
	t.Setenv("XDG_CACHE_HOME", cacheHome)
	t.Setenv("HOME", cacheHome)
	t.Setenv("LOCALAPPDATA", cacheHome)

	var calls int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Content-Length", "9")
		_, _ = w.Write([]byte("copertina"))
	}))
	defer upstream.Close()

	s := New()
	s.initImageCache()
	if s.imageCacheRef() == nil {
		t.Fatal("la cache immagini non è stata inizializzata")
	}
	if err := s.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer func() { _ = s.Stop() }()

	port, err := s.Port()
	if err != nil {
		t.Fatalf("Port: %v", err)
	}
	target := fmt.Sprintf("http://127.0.0.1:%d%s?u=%s", port, proxyPath,
		base64.RawURLEncoding.EncodeToString([]byte(upstream.URL+"/copertina.jpg")))

	get := func() *http.Response {
		t.Helper()
		resp, err := http.Get(target)
		if err != nil {
			t.Fatalf("GET %s: %v", target, err)
		}
		t.Cleanup(func() { _ = resp.Body.Close() })
		return resp
	}

	prima := get()
	corpo, _ := io.ReadAll(prima.Body)
	if prima.StatusCode != http.StatusOK || string(corpo) != "copertina" {
		t.Fatalf("prima richiesta: status %d, corpo %q", prima.StatusCode, corpo)
	}
	if got := prima.Header.Get("X-StreamAI-Cache"); got != "stored" {
		t.Fatalf("prima richiesta: X-StreamAI-Cache = %q, atteso \"stored\"", got)
	}

	// L'immagine è finita **su disco**, nella directory di sistema del processo.
	dir := filepath.Join(cacheHome, "streamai", "images")
	voci, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("lettura %s: %v", dir, err)
	}
	if len(voci) != 1 {
		t.Fatalf("atteso 1 file in cache, trovati %d", len(voci))
	}
	if !strings.HasSuffix(voci[0].Name(), ".jpg") {
		t.Errorf("il file in cache dovrebbe avere l'estensione del Content-Type: %q", voci[0].Name())
	}
	if info, _ := voci[0].Info(); info.Mode().Perm() != 0o600 {
		t.Errorf("i permessi del file in cache sono %v, attesi 0600", info.Mode().Perm())
	}

	// Seconda richiesta: dal disco, senza rifare il download.
	seconda := get()
	corpo2, _ := io.ReadAll(seconda.Body)
	if string(corpo2) != "copertina" {
		t.Fatalf("seconda richiesta: corpo %q", corpo2)
	}
	if got := seconda.Header.Get("X-StreamAI-Cache"); got != "hit" {
		t.Fatalf("seconda richiesta: X-StreamAI-Cache = %q, atteso \"hit\"", got)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("l'upstream è stato chiamato %d volte, attesa 1 sola", got)
	}
}
