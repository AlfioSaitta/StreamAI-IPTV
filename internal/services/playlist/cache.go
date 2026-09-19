// cache.go — copia su disco dell'ultimo catalogo completo.
//
// PERCHÉ. Costruire il catalogo dalla rete costa 30-50 s: sei richieste in
// parallelo, di cui una (`get_vod_streams`) da ~10 MB, su un pannello che sotto
// carico tronca le risposte lente e va ritentato (vedi fetchAndDecodeRetry). È
// il primo dato che l'utente vuole vedere, e farlo aspettare significa aprire
// l'app su una schermata vuota.
//
// Con una copia su disco l'avvio mostra il catalogo **subito** e la pipeline di
// rete parte dopo, in background, quando lo dicono le impostazioni del profilo
// (`contentAutoRefreshEnabled` + intervallo, gestiti dal frontend): l'utente
// vede contenuti mentre i dati freschi arrivano.
//
// COSA NON È. Non è una cache "a scadenza": il file non scade da solo, e non
// decide nulla. Chi lo usa decide se i dati sono abbastanza freschi, e il
// timestamp (`SavedAt`) esiste per questo.
package playlist

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// catalogCacheSchemaVersion identifica il formato del file. Va incrementata
// quando cambia la forma di FullPlaylist: un file vecchio verrebbe decodificato
// senza errore ma con campi a zero (nomi di canale vuoti, id mancanti), cioè un
// catalogo rotto che sembra valido. Meglio ignorarlo e rifare la fetch.
const catalogCacheSchemaVersion = 1

// catalogCacheMutex serializza le scritture: due run ravvicinate (cambio
// profilo, refresh manuale durante uno automatico) scrivono lo stesso file, e
// senza serializzazione l'ultima rename potrebbe essere quella sbagliata.
var catalogCacheMutex sync.Mutex

// catalogCacheFile è il contenuto del file su disco.
type catalogCacheFile struct {
	SchemaVersion int          `json:"schemaVersion"`
	Server        string       `json:"server"`
	Username      string       `json:"username"`
	SavedAt       int64        `json:"savedAt"`
	Playlist      FullPlaylist `json:"playlist"`
}

// CachedCatalog è quanto il frontend riceve da LoadCachedCatalog.
type CachedCatalog struct {
	Playlist FullPlaylist `json:"playlist"`
	// SavedAt è l'istante del salvataggio (unix millisecondi): il frontend lo usa
	// come "ultimo aggiornamento riuscito" per capire, secondo le impostazioni,
	// se e quando rifare la fetch.
	SavedAt int64 `json:"savedAt"`
}

// catalogCacheDir è la directory della cache (XDG su Linux, la cache utente
// altrove). Permessi 0700: contiene l'elenco dei contenuti dell'utente, non è
// roba da lasciare leggibile a tutti.
func catalogCacheDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("cache dir di sistema non disponibile: %w", err)
	}
	dir := filepath.Join(base, "streamai", "catalog")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("creazione %s: %w", dir, err)
	}
	return dir, nil
}

// catalogCachePath è il file di un profilo. La chiave è server+utente, come per
// la cache in memoria: due profili possono puntare allo stesso server con
// utenze diverse e i loro cataloghi non vanno mescolati.
//
// Il nome è un hash perché server e utente non sono nomi di file validi (URL con
// `:` e `/`), non per segretezza.
func catalogCachePath(key catalogKey) (string, error) {
	dir, err := catalogCacheDir()
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(key.server + "\x00" + key.user))
	return filepath.Join(dir, hex.EncodeToString(sum[:16])+".json"), nil
}

// persistCatalog salva il catalogo sul disco. Scrittura atomica (file
// temporaneo + rename): un lettore concorrente vede il file vecchio o quello
// nuovo, mai un file a metà.
func (s *PlaylistService) persistCatalog(key catalogKey, pl FullPlaylist) error {
	if len(pl.FailedBlocks) > 0 {
		// Su disco deve restare un catalogo integro: se un blocco è fallito, la
		// copia precedente è meglio di questa. Vale la stessa regola della cache
		// in memoria (applyFallbackForFailedBlocks).
		log.Warn().
			Strs("failedBlocks", pl.FailedBlocks).
			Msg("catalog: cache su disco non aggiornata (catalogo degradato)")
		return nil
	}

	path, err := catalogCachePath(key)
	if err != nil {
		return err
	}

	data, err := json.Marshal(catalogCacheFile{
		SchemaVersion: catalogCacheSchemaVersion,
		Server:        key.server,
		Username:      key.user,
		SavedAt:       time.Now().UnixMilli(),
		Playlist:      pl,
	})
	if err != nil {
		return fmt.Errorf("serializzazione catalogo: %w", err)
	}

	catalogCacheMutex.Lock()
	defer catalogCacheMutex.Unlock()

	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return fmt.Errorf("scrittura %s: %w", tmp, err)
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("rename %s: %w", path, err)
	}

	log.Info().
		Int("bytes", len(data)).
		Int("channels", countChannels(pl.Live)+countChannels(pl.Vod)+countChannels(pl.Series)).
		Msg("catalog: cache su disco salvata")
	return nil
}

// persistCatalogAsync salva senza bloccare chi ha appena pubblicato il catalogo:
// serializzare ~15 MB richiede centinaia di ms, e l'evento per la UI non deve
// aspettarli.
func (s *PlaylistService) persistCatalogAsync(key catalogKey, pl FullPlaylist) {
	go func() {
		if err := s.persistCatalog(key, pl); err != nil {
			log.Warn().Err(err).Msg("catalog: salvataggio della cache su disco fallito")
		}
	}()
}

// LoadCachedCatalog ritorna l'ultimo catalogo salvato per queste credenziali.
//
// Ritorna (nil, nil) quando non c'è nulla di utilizzabile — primo avvio, cache
// cancellata, formato vecchio, file illeggibile — perché per il chiamante sono
// tutti lo stesso caso: non c'è una copia locale, si va di rete. Un errore vero
// (directory non creabile) è invece distinto: è una condizione dell'ambiente che
// vale la pena vedere nel log.
func (s *PlaylistService) LoadCachedCatalog(creds XtreamCredentials) (*CachedCatalog, error) {
	path, err := catalogCachePath(catalogKey{server: creds.ServerUrl, user: creds.Username})
	if err != nil {
		return nil, err
	}

	raw, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("lettura %s: %w", path, err)
	}

	var f catalogCacheFile
	if err := json.Unmarshal(raw, &f); err != nil {
		log.Warn().Err(err).Msg("catalog: cache su disco illeggibile, ignorata")
		return nil, nil
	}
	if f.SchemaVersion != catalogCacheSchemaVersion {
		log.Info().
			Int("schemaTrovato", f.SchemaVersion).
			Int("schemaAtteso", catalogCacheSchemaVersion).
			Msg("catalog: cache su disco di formato diverso, ignorata")
		return nil, nil
	}

	// Un catalogo senza canali non è un catalogo: mostrarlo all'avvio darebbe
	// un'app vuota, cioè esattamente ciò che questa cache esiste per evitare.
	if countChannels(f.Playlist.Live)+countChannels(f.Playlist.Vod)+countChannels(f.Playlist.Series) == 0 {
		log.Warn().Msg("catalog: cache su disco senza canali, ignorata")
		return nil, nil
	}

	log.Info().
		Int64("savedAt", f.SavedAt).
		Time("savedAtLeggibile", time.UnixMilli(f.SavedAt)).
		Int("channels", countChannels(f.Playlist.Live)+countChannels(f.Playlist.Vod)+countChannels(f.Playlist.Series)).
		Msg("catalog: cache su disco caricata")
	return &CachedCatalog{Playlist: f.Playlist, SavedAt: f.SavedAt}, nil
}
