package playlist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// --- helper ---

// newTestService costruisce il servizio senza passare da New(), per usare il
// client del server di test.
func newTestService(client *http.Client) *PlaylistService {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &PlaylistService{client: client}
}

func credsFor(server string) XtreamCredentials {
	return XtreamCredentials{ServerUrl: server, Username: "u", Password: "p"}
}

// --- diagnosi del troncamento ---

// L'incidente del 2026-09-19: il provider ha consegnato un JSON incompleto e il
// log diceva solo "unexpected end of JSON input", indistinguibile da decine di
// altre cause. Il corpo che inizia come JSON e non finisce come JSON va
// riconosciuto e descritto per quello che è.
func TestFetchCatalogBody_TruncatedBodyIsDiagnosed(t *testing.T) {
	const truncated = `[{"stream_id":1,"name":"Film"},{"stream_id":2,"na`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(truncated))
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	creds := credsFor(srv.URL)
	apiURL, err := s.buildAPIURL(creds, "get_vod_streams")
	if err != nil {
		t.Fatalf("buildAPIURL: %v", err)
	}

	body, err := s.fetchCatalogBody(context.Background(), apiURL)
	if err == nil {
		t.Fatal("un JSON troncato deve produrre un errore")
	}
	if body != nil {
		t.Fatal("un corpo troncato non va consegnato al chiamante")
	}
	if !strings.Contains(err.Error(), "truncated JSON response") {
		t.Fatalf("l'errore deve dire che il corpo è troncato, ottenuto: %v", err)
	}
	// Il conteggio dei byte ricevuti è ciò che permette di distinguere un
	// troncamento del provider dal nostro tetto di 128 MiB.
	if !strings.Contains(err.Error(), fmt.Sprintf("%d bytes received", len(truncated))) {
		t.Fatalf("l'errore deve riportare i byte ricevuti, ottenuto: %v", err)
	}
}

// Un endpoint non abilitato risponde con HTML o testo: NON è un troncamento e
// non deve produrre un errore (il blocco è legittimamente vuoto). Il corpo
// ritornato è nil, ed è ciò che distingue "niente da decodificare" da un JSON
// vuoto valido.
func TestFetchCatalogBody_NonJSONIsNotAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>not enabled</html>"))
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	body, err := s.fetchCatalogBody(context.Background(), apiURL)
	if err != nil {
		t.Fatalf("una risposta non-JSON non è un errore: %v", err)
	}
	if body != nil {
		t.Fatalf("una risposta non-JSON non ha un corpo da decodificare, ottenuti %d byte", len(body))
	}
}

// Gli errori si generano con `json.Unmarshal` vero: `*json.SyntaxError` ha il
// campo `msg` non esportato, quindi non è costruibile a mano, e un tipo finto
// non verrebbe riconosciuto da errors.As (il test passerebbe per il motivo
// sbagliato). Il caso completo è comunque coperto end-to-end da
// TestFetchCatalogBody_TruncatedBodyIsDiagnosed.
func TestIsTruncatedJSON(t *testing.T) {
	syntaxErr := func(body string) error {
		var v any
		return json.Unmarshal([]byte(body), &v)
	}

	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"errore diverso", errors.New("connection reset by peer"), false},
		{"sintassi generica", syntaxErr("}{"), false},
		{"fine inattesa", syntaxErr(`[{"a":1`), true},
		{"avvolto", fmt.Errorf("failed to decode: %w", syntaxErr(`[{"a":1`)), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTruncatedJSON(tc.err); got != tc.want {
				t.Fatalf("isTruncatedJSON(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// --- retry ---

// Il caso reale: prima risposta troncata, seconda integra. Il retry deve
// recuperare il blocco.
func TestFetchAndDecodeRetry_RecoversFromTruncatedResponse(t *testing.T) {
	oldDelay := catalogRetryDelay
	catalogRetryDelay = time.Millisecond
	defer func() { catalogRetryDelay = oldDelay }()

	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			_, _ = w.Write([]byte(`[{"stream_id":1,"na`)) // troncata
			return
		}
		_, _ = w.Write([]byte(`[{"stream_id":1,"name":"Film"}]`)) // integra
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	var streams []Stream
	if err := s.fetchAndDecodeRetry(context.Background(), apiURL, &streams); err != nil {
		t.Fatalf("il retry doveva recuperare il blocco, ottenuto: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("atteso 1 stream, ottenuti %d", len(streams))
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("attese 2 richieste (1 + retry), fatte %d", got)
	}
}

// Su un corpo non-JSON (endpoint non abilitato) non si ritenta: la risposta è
// definitiva e un secondo giro sarebbe solo traffico in più.
func TestFetchAndDecodeRetry_DoesNotRetryNonJSON(t *testing.T) {
	oldDelay := catalogRetryDelay
	catalogRetryDelay = time.Millisecond
	defer func() { catalogRetryDelay = oldDelay }()

	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		_, _ = w.Write([]byte("not enabled"))
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	var streams []Stream
	if err := s.fetchAndDecodeRetry(context.Background(), apiURL, &streams); err != nil {
		t.Fatalf("non atteso errore: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Fatalf("attesa 1 sola richiesta, fatte %d", got)
	}
}

// Il caso che rende l'applicazione inutilizzabile: il primo tentativo è lento e
// il pannello lo uccide a metà risposta. Aspettarlo in sequenza significa
// perdere 30-40 s per un esito già compromesso, quindi dopo la soglia ne parte
// uno in parallelo e vince il primo che arriva integro.
func TestFetchAndDecodeRetry_HedgesSlowAttempt(t *testing.T) {
	oldHedge, oldDelay := catalogHedgeDelay, catalogRetryDelay
	catalogHedgeDelay = 50 * time.Millisecond
	catalogRetryDelay = time.Millisecond
	defer func() { catalogHedgeDelay, catalogRetryDelay = oldHedge, oldDelay }()

	const good = `[{"stream_id":1,"name":"Film"}]`
	var calls int32
	slowCancelled := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			// Primo tentativo: risposta parziale e connessione che resta
			// appesa, come quando il pannello muore a metà scrittura.
			_, _ = w.Write([]byte(`[{"stream_id":1,`))
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
			<-r.Context().Done()
			close(slowCancelled)
			return
		}
		_, _ = w.Write([]byte(good))
	}))
	defer srv.Close()

	// Timeout esplicito: se l'hedge non partisse, il test fallisce invece di
	// restare appeso fino al timeout della suite.
	s := newTestService(&http.Client{Timeout: 3 * time.Second})
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	start := time.Now()
	var streams []Stream
	if err := s.fetchAndDecodeRetry(context.Background(), apiURL, &streams); err != nil {
		t.Fatalf("il tentativo in parallelo doveva riuscire: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("atteso 1 stream, ottenuti %d", len(streams))
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("la chiamata ha atteso il tentativo lento: %v", elapsed)
	}
	select {
	case <-slowCancelled:
	case <-time.After(2 * time.Second):
		t.Error("il tentativo perdente non è stato annullato: continua a occupare il pannello")
	}
}

// Il troncamento è casuale e indipendente da una richiesta all'altra: può
// capitare più volte di fila. Un solo retry non basta.
func TestFetchAndDecodeRetry_SurvivesRepeatedTruncations(t *testing.T) {
	oldHedge, oldDelay := catalogHedgeDelay, catalogRetryDelay
	catalogHedgeDelay = time.Minute // nessun hedge: qui si misura la sequenza
	catalogRetryDelay = time.Millisecond
	defer func() { catalogHedgeDelay, catalogRetryDelay = oldHedge, oldDelay }()

	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if atomic.AddInt32(&calls, 1) < 4 {
			_, _ = w.Write([]byte(`[{"stream_id":1,"na`)) // troncata
			return
		}
		_, _ = w.Write([]byte(`[{"stream_id":1,"name":"Film"}]`))
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	var streams []Stream
	if err := s.fetchAndDecodeRetry(context.Background(), apiURL, &streams); err != nil {
		t.Fatalf("il quarto tentativo doveva riuscire: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("atteso 1 stream, ottenuti %d", len(streams))
	}
	if got := atomic.LoadInt32(&calls); got != 4 {
		t.Fatalf("attese 4 richieste, fatte %d", got)
	}
}

// Con tutti i tentativi troncati l'errore deve arrivare al chiamante — che tiene
// il catalogo precedente (applyFallbackForFailedBlocks) — e il numero di
// richieste deve restare limitato: il provider è già in difficoltà.
func TestFetchAndDecodeRetry_GivesUpAfterMaxAttempts(t *testing.T) {
	oldHedge, oldDelay := catalogHedgeDelay, catalogRetryDelay
	catalogHedgeDelay = time.Minute
	catalogRetryDelay = time.Millisecond
	defer func() { catalogHedgeDelay, catalogRetryDelay = oldHedge, oldDelay }()

	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		_, _ = w.Write([]byte(`[{"stream_id":1,"na`))
	}))
	defer srv.Close()

	s := newTestService(srv.Client())
	apiURL, _ := s.buildAPIURL(credsFor(srv.URL), "get_vod_streams")

	var streams []Stream
	err := s.fetchAndDecodeRetry(context.Background(), apiURL, &streams)
	if err == nil {
		t.Fatal("con tutti i tentativi troncati deve arrivare un errore")
	}
	if !strings.Contains(err.Error(), "truncated JSON response") {
		t.Fatalf("l'errore deve descrivere il troncamento, ottenuto: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != catalogFetchAttempts {
		t.Fatalf("attese %d richieste, fatte %d", catalogFetchAttempts, got)
	}
}

func TestIsRetryableCatalogError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"troncato", errors.New("truncated JSON response (123 bytes received)"), true},
		{"connessione caduta", errors.New("request failed: EOF"), true},
		{"non-JSON", errors.New("non-JSON response body, treating block as empty"), false},
		{"4xx", errors.New("server returned non-200 status: 403 Forbidden"), false},
		{"5xx", errors.New("server returned non-200 status: 503 Service Unavailable"), true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isRetryableCatalogError(tc.err); got != tc.want {
				t.Fatalf("isRetryableCatalogError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// --- fallback sui blocchi falliti ---

// Categorie e stream dello stesso blocco sono due fetch ma un solo blocco: il
// payload non deve elencare "vod" due volte (il frontend lo usa come set).
func TestFailedBlockNames(t *testing.T) {
	got := failedBlockNames([]blockError{
		{block: "live_categories", err: nil},
		{block: "vod_categories", err: errors.New("truncated")},
		{block: "vod_streams", err: errors.New("truncated")},
		{block: "series_streams", err: errors.New("timeout")},
		{block: "live_streams", err: errors.New("timeout")},
	})
	want := []string{"vod", "series", "live"}
	if len(got) != len(want) {
		t.Fatalf("attesi %d blocchi falliti, ottenuti %v", len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("blocchi falliti = %v, attesi %v", got, want)
		}
	}
	if names := failedBlockNames(nil); len(names) != 0 {
		t.Fatalf("senza errori non ci sono blocchi falliti, ottenuto %v", names)
	}
}

func cat(name string, ids ...int) []Category {
	c := Category{Name: name}
	for _, id := range ids {
		c.Channels = append(c.Channels, Stream{Name: fmt.Sprintf("ch%d", id)})
	}
	return []Category{c}
}

// Il cuore dell'incidente: il blocco VOD fallisce, ma il catalogo già caricato
// non deve sparire dalla UI.
func TestApplyFallbackForFailedBlocks_KeepsCachedBlock(t *testing.T) {
	s := newTestService(nil)
	creds := credsFor("http://provider.example:8080")

	good := FullPlaylist{
		Live:   cat("Live", 1, 2),
		Vod:    cat("VOD", 1, 2, 3),
		Series: cat("Serie", 1),
	}
	s.storeLastGood(catalogKey{server: creds.ServerUrl, user: creds.Username}, good)

	// Seconda run: VOD vuoto perché la fetch è fallita.
	fresh := FullPlaylist{
		Live:   cat("Live", 1, 2),
		Vod:    nil,
		Series: cat("Serie", 1),
	}
	got := s.applyFallbackForFailedBlocks(creds, fresh, []blockError{
		{block: "vod_streams", err: errors.New("truncated JSON response")},
	})

	if countChannels(got.Vod) != 3 {
		t.Fatalf("il blocco VOD doveva restare quello di prima (3 canali), ottenuto %d", countChannels(got.Vod))
	}
	if countChannels(got.Live) != 2 || countChannels(got.Series) != 1 {
		t.Fatal("gli altri blocchi non dovevano cambiare")
	}
}

// Se il blocco fresco HA dati, si pubblica quello: un catalogo legittimamente
// più corto non va "aggiustato".
func TestApplyFallbackForFailedBlocks_PrefersFreshData(t *testing.T) {
	s := newTestService(nil)
	creds := credsFor("http://provider.example:8080")
	s.storeLastGood(catalogKey{server: creds.ServerUrl, user: creds.Username},
		FullPlaylist{Vod: cat("VOD", 1, 2, 3)})

	fresh := FullPlaylist{Vod: cat("VOD", 1)}
	got := s.applyFallbackForFailedBlocks(creds, fresh, []blockError{
		{block: "vod_streams", err: errors.New("boom")},
	})
	if countChannels(got.Vod) != 1 {
		t.Fatalf("con dati freschi presenti non si deve recuperare la cache, ottenuti %d canali", countChannels(got.Vod))
	}
}

// Un catalogo vuoto SENZA errori è una risposta valida (abbonamento senza VOD):
// non va sostituito con quello vecchio.
func TestApplyFallbackForFailedBlocks_EmptyWithoutErrorIsPublished(t *testing.T) {
	s := newTestService(nil)
	creds := credsFor("http://provider.example:8080")
	s.storeLastGood(catalogKey{server: creds.ServerUrl, user: creds.Username},
		FullPlaylist{Vod: cat("VOD", 1, 2, 3)})

	got := s.applyFallbackForFailedBlocks(creds, FullPlaylist{Vod: nil}, nil)
	if countChannels(got.Vod) != 0 {
		t.Fatalf("un blocco vuoto senza errori è valido, ottenuti %d canali", countChannels(got.Vod))
	}
}

// La cache non deve essere avvelenata da un catalogo già degradato, altrimenti
// il blocco vuoto diventerebbe "lo stato buono" e non se ne uscirebbe più.
func TestApplyFallbackForFailedBlocks_DoesNotCacheDegradedCatalog(t *testing.T) {
	s := newTestService(nil)
	creds := credsFor("http://provider.example:8080")

	// Prima run: VOD fallito, nessuna cache precedente.
	got := s.applyFallbackForFailedBlocks(creds, FullPlaylist{Vod: nil}, []blockError{
		{block: "vod_streams", err: errors.New("truncated")},
	})
	if countChannels(got.Vod) != 0 {
		t.Fatal("senza cache il blocco resta vuoto")
	}
	if s.lastGood != nil {
		t.Fatal("un catalogo con blocchi falliti non deve entrare in cache")
	}
}
