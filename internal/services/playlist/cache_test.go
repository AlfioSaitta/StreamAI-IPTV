package playlist

import (
	"os"
	"path/filepath"
	"testing"
)

// isolaCache redirige `os.UserCacheDir()` su una directory temporanea: i test
// non devono scrivere nella cache reale dell'utente (né leggerne una che
// esiste, altrimenti l'esito dipenderebbe dalla macchina).
//
// Le variabili coperte sono tre perché `os.UserCacheDir` le legge diversamente
// per sistema operativo (XDG su Linux, HOME su macOS, LocalAppData su Windows).
func isolaCache(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CACHE_HOME", dir)
	t.Setenv("HOME", dir)
	t.Setenv("LocalAppData", dir)
	return dir
}

func credenzialiDiProva() XtreamCredentials {
	return XtreamCredentials{ServerUrl: "http://provider.example:8080", Username: "utente", Password: "segreta"}
}

// catalogoDiProva: due blocchi popolati abbastanza da rendere significativi i
// conteggi che il caricamento verifica.
func catalogoDiProva() FullPlaylist {
	return FullPlaylist{
		Live: []Category{{
			ID:   flexString("10"),
			Name: "News",
			Channels: []Stream{
				{StreamID: flexInt(1), Name: "Rai 1 HD", CategoryID: flexString("10")},
			},
		}},
		Vod: []Category{{
			ID:   flexString("20"),
			Name: "Film",
			Channels: []Stream{
				{StreamID: flexInt(2), Name: "Film 1", ContainerExtension: "mkv"},
				{StreamID: flexInt(3), Name: "Film 2", ContainerExtension: "mp4"},
			},
		}},
	}
}

func TestCatalogCache_RoundTrip(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()

	if err := s.persistCatalog(catalogKey{server: creds.ServerUrl, user: creds.Username}, catalogoDiProva()); err != nil {
		t.Fatalf("persistCatalog: %v", err)
	}

	got, err := s.LoadCachedCatalog(creds)
	if err != nil {
		t.Fatalf("LoadCachedCatalog: %v", err)
	}
	if got == nil {
		t.Fatal("la cache salvata non è stata ritrovata")
	}
	if got.SavedAt == 0 {
		t.Error("SavedAt non valorizzato: il frontend non può decidere se aggiornare")
	}
	if n := countChannels(got.Playlist.Live); n != 1 {
		t.Errorf("canali live = %d, attesi 1", n)
	}
	if n := countChannels(got.Playlist.Vod); n != 2 {
		t.Errorf("canali vod = %d, attesi 2", n)
	}
	// I campi devono sopravvivere al giro su disco: un catalogo che si ricarica
	// senza nome o senza id è peggio di nessun catalogo.
	if got.Playlist.Vod[0].Channels[1].Name != "Film 2" {
		t.Errorf("nome del secondo VOD = %q", got.Playlist.Vod[0].Channels[1].Name)
	}
	if got.Playlist.Vod[0].Channels[0].ContainerExtension != "mkv" {
		t.Errorf("container_extension perso: %q", got.Playlist.Vod[0].Channels[0].ContainerExtension)
	}
	if got.Playlist.Live[0].Name != "News" {
		t.Errorf("nome categoria = %q", got.Playlist.Live[0].Name)
	}
}

// Il caso normale del primo avvio: non c'è nulla, e non è un errore.
func TestCatalogCache_MissingIsNotAnError(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)

	got, err := s.LoadCachedCatalog(credenzialiDiProva())
	if err != nil {
		t.Fatalf("cache assente non è un errore, ottenuto: %v", err)
	}
	if got != nil {
		t.Fatalf("atteso nil, ottenuto %+v", got)
	}
}

// Un catalogo degradato (un blocco fallito) NON deve sovrascrivere quello
// integro già su disco: altrimenti al prossimo avvio l'utente vedrebbe il
// catalogo mutilato e senza nemmeno il segnale del fallimento.
func TestCatalogCache_DegradedCatalogIsNotSaved(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()
	key := catalogKey{server: creds.ServerUrl, user: creds.Username}

	if err := s.persistCatalog(key, catalogoDiProva()); err != nil {
		t.Fatalf("persistCatalog iniziale: %v", err)
	}

	degraded := catalogoDiProva()
	degraded.Vod = nil
	degraded.FailedBlocks = []string{"vod"}
	if err := s.persistCatalog(key, degraded); err != nil {
		t.Fatalf("persistCatalog degradato: %v", err)
	}

	got, err := s.LoadCachedCatalog(creds)
	if err != nil {
		t.Fatalf("LoadCachedCatalog: %v", err)
	}
	if got == nil {
		t.Fatal("la cache integra è sparita")
	}
	if n := countChannels(got.Playlist.Vod); n != 2 {
		t.Errorf("il catalogo su disco è stato sovrascritto da uno degradato: vod = %d", n)
	}
}

// Un file di formato diverso va ignorato, non decodificato "alla meglio": campi
// assenti diventerebbero canali senza nome, cioè un catalogo rotto che sembra
// valido.
func TestCatalogCache_DifferentSchemaIsIgnored(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()

	path, err := catalogCachePath(catalogKey{server: creds.ServerUrl, user: creds.Username})
	if err != nil {
		t.Fatalf("catalogCachePath: %v", err)
	}
	body := `{"schemaVersion":999,"savedAt":1,"playlist":{"live":[{"category_id":"1","channels":[{"name":"x"}]}]}}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("scrittura file di prova: %v", err)
	}

	got, err := s.LoadCachedCatalog(creds)
	if err != nil {
		t.Fatalf("uno schema diverso non è un errore fatale: %v", err)
	}
	if got != nil {
		t.Fatal("una cache di formato diverso non va usata")
	}
}

// Un file corrotto (scrittura interrotta, disco pieno, modifica manuale) non
// deve impedire l'avvio: si va di rete.
func TestCatalogCache_CorruptFileIsIgnored(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()

	path, err := catalogCachePath(catalogKey{server: creds.ServerUrl, user: creds.Username})
	if err != nil {
		t.Fatalf("catalogCachePath: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"schemaVersion":1,"playlist":{"live":[`), 0o600); err != nil {
		t.Fatalf("scrittura file di prova: %v", err)
	}

	got, err := s.LoadCachedCatalog(creds)
	if err != nil {
		t.Fatalf("file corrotto non è un errore fatale: %v", err)
	}
	if got != nil {
		t.Fatal("un file corrotto non va usato")
	}
}

// Una cache senza canali darebbe all'avvio un'app vuota, che è esattamente ciò
// che la cache esiste per evitare: tanto vale non usarla.
func TestCatalogCache_EmptyCatalogIsIgnored(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()

	if err := s.persistCatalog(catalogKey{server: creds.ServerUrl, user: creds.Username}, FullPlaylist{}); err != nil {
		t.Fatalf("persistCatalog: %v", err)
	}

	got, err := s.LoadCachedCatalog(creds)
	if err != nil {
		t.Fatalf("LoadCachedCatalog: %v", err)
	}
	if got != nil {
		t.Fatal("un catalogo senza canali non va usato")
	}
}

// La scrittura è atomica: nessun file temporaneo lasciato indietro, e il file
// resta leggibile.
func TestCatalogCache_NoTemporaryLeftBehind(t *testing.T) {
	dir := isolaCache(t)
	s := newTestService(nil)
	creds := credenzialiDiProva()

	if err := s.persistCatalog(catalogKey{server: creds.ServerUrl, user: creds.Username}, catalogoDiProva()); err != nil {
		t.Fatalf("persistCatalog: %v", err)
	}

	if err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if filepath.Ext(path) == ".tmp" {
			t.Errorf("file temporaneo rimasto su disco: %s", path)
		}
		return nil
	}); err != nil {
		t.Fatalf("walk: %v", err)
	}
}

// Due profili sullo stesso server con utenze diverse sono due file distinti:
// mescolarli mostrerebbe a un utente il catalogo di un altro.
func TestCatalogCache_PathIsPerProfile(t *testing.T) {
	isolaCache(t)
	s := newTestService(nil)

	a := XtreamCredentials{ServerUrl: "http://provider.example:8080", Username: "utente-a"}
	b := XtreamCredentials{ServerUrl: "http://provider.example:8080", Username: "utente-b"}
	c := XtreamCredentials{ServerUrl: "http://altro.example:8080", Username: "utente-a"}

	if err := s.persistCatalog(catalogKey{server: a.ServerUrl, user: a.Username}, catalogoDiProva()); err != nil {
		t.Fatalf("persistCatalog: %v", err)
	}

	for _, creds := range []XtreamCredentials{b, c} {
		got, err := s.LoadCachedCatalog(creds)
		if err != nil {
			t.Fatalf("LoadCachedCatalog: %v", err)
		}
		if got != nil {
			t.Fatalf("il catalogo di %s/%s è stato ritrovato da %s/%s",
				a.ServerUrl, a.Username, creds.ServerUrl, creds.Username)
		}
	}

	same, err := s.LoadCachedCatalog(a)
	if err != nil || same == nil {
		t.Fatalf("il catalogo del profilo originale non è più caricabile: %v", err)
	}
}
