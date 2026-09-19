// Sonda manuale contro un provider Xtream reale.
//
// Non fa parte della suite: richiede rete, un abbonamento e scarica decine di MB
// per tentativo. Serve a verificare **sul pannello vero** la politica di
// tentativi di `fetchAndDecodeRetry`, che i test simulano con un server di test
// (troncamento casuale a metà risposta).
//
// Si attiva solo con le credenziali nell'ambiente, che restano fuori dal repo:
//
//	STREAMAI_PROBE_SERVER=http://host:port STREAMAI_PROBE_USER=u STREAMAI_PROBE_PASS=p \
//	  go test ./internal/services/playlist/ -run TestProbe -v
//
// Senza quelle variabili il test viene saltato, quindi `go test ./...` resta
// offline e deterministico.
package playlist

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"
)

func TestProbe_RealProviderSurvivesTruncation(t *testing.T) {
	server, user, pass := os.Getenv("STREAMAI_PROBE_SERVER"), os.Getenv("STREAMAI_PROBE_USER"), os.Getenv("STREAMAI_PROBE_PASS")
	if server == "" || user == "" || pass == "" {
		t.Skip("credenziali del provider non impostate (STREAMAI_PROBE_SERVER/USER/PASS)")
	}

	s := newTestService(&http.Client{Timeout: 90 * time.Second})
	creds := XtreamCredentials{ServerUrl: server, Username: user, Password: pass}
	apiURL, err := s.buildAPIURL(creds, "get_vod_streams")
	if err != nil {
		t.Fatalf("buildAPIURL: %v", err)
	}

	// La politica di default, senza scorciatoie: è esattamente quella che gira
	// nell'app.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	var streams []Stream
	start := time.Now()
	if err := s.fetchAndDecodeRetry(ctx, apiURL, &streams); err != nil {
		t.Fatalf("il blocco VOD non è stato recuperato dopo %v: %v", time.Since(start).Round(time.Second), err)
	}
	elapsed := time.Since(start)

	// Un catalogo VOD troncato ma "valido" non esiste: se il JSON è incompleto
	// la decodifica fallisce. Qui il numero di elementi è la prova che i dati
	// sono arrivati interi.
	if len(streams) == 0 {
		t.Fatalf("blocco VOD vuoto dopo %v: il provider ha risposto ma senza dati", elapsed.Round(time.Second))
	}
	t.Logf("blocco VOD recuperato: %d stream in %v", len(streams), elapsed.Round(time.Second))
}

// La catena completa su un provider vero: pipeline di rete → file su disco →
// rilettura. È la verifica che l'avvio cache-first funzioni davvero, cioè che il
// file contenga il catalogo intero e non una sua parte.
func TestProbe_RealPipelinePersistsCatalogToDisk(t *testing.T) {
	server, user, pass := os.Getenv("STREAMAI_PROBE_SERVER"), os.Getenv("STREAMAI_PROBE_USER"), os.Getenv("STREAMAI_PROBE_PASS")
	if server == "" || user == "" || pass == "" {
		t.Skip("credenziali del provider non impostate (STREAMAI_PROBE_SERVER/USER/PASS)")
	}
	// La cache del test va in una directory temporanea: quella dell'utente non
	// va toccata né letta (altrimenti l'esito dipenderebbe dalla macchina).
	isolaCache(t)

	s := newTestService(&http.Client{Timeout: 90 * time.Second})
	creds := XtreamCredentials{ServerUrl: server, Username: user, Password: pass}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()

	start := time.Now()
	// generation 0 = quella iniziale del servizio: la run è "corrente" e pubblica
	// il risultato.
	s.runXtreamPipeline(ctx, 0, creds)
	t.Logf("pipeline completata in %v", time.Since(start).Round(time.Second))

	// Il salvataggio è async (non deve far aspettare la UI): attendo il file.
	var cached *CachedCatalog
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		got, err := s.LoadCachedCatalog(creds)
		if err != nil {
			t.Fatalf("LoadCachedCatalog: %v", err)
		}
		if got != nil {
			cached = got
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if cached == nil {
		t.Fatal("il catalogo non è stato salvato su disco entro 45 s")
	}

	live, vod, series := countChannels(cached.Playlist.Live), countChannels(cached.Playlist.Vod), countChannels(cached.Playlist.Series)
	if live+vod+series == 0 {
		t.Fatal("cache salvata ma senza canali")
	}
	if cached.SavedAt == 0 {
		t.Error("SavedAt non valorizzato: il frontend non può decidere quando aggiornare")
	}
	path, err := catalogCachePath(catalogKey{server: server, user: user})
	if err != nil {
		t.Fatalf("catalogCachePath: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	t.Logf("cache: live=%d vod=%d series=%d, file %.1f MB, risparmio atteso all'avvio ~%v",
		live, vod, series, float64(info.Size())/(1<<20), time.Since(start).Round(time.Second))
}
