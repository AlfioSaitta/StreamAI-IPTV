package playlist

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// --- Structs for Xtream API Response ---

type UserInfo struct {
	Username       string `json:"username"`
	Password       string `json:"password"`
	Message        string `json:"message"`
	Status         string `json:"status"`
	ExpDate        string `json:"exp_date"`
	IsTrial        string `json:"is_trial"`
	ActiveCons     string `json:"active_cons"`
	CreatedAt      string `json:"created_at"`
	MaxConnections string `json:"max_connections"`
	Auth           int    `json:"auth"`
}

type ServerInfo struct {
	Timestamp      int64  `json:"timestamp"`
	URL            string `json:"url"`
	Port           string `json:"port"`
	HTTPSPort      string `json:"https_port"`
	ServerProtocol string `json:"server_protocol"`
	Timezone       string `json:"timezone"`
}

type PlayerAPIResponse struct {
	UserInfo   UserInfo   `json:"user_info"`
	ServerInfo ServerInfo `json:"server_info"`
}

type Category struct {
	ID       flexString `json:"category_id"`
	Name     string     `json:"category_name"`
	ParentID flexInt    `json:"parent_id"`
	Channels []Stream   `json:"channels,omitempty"`
}

type Stream struct {
	// Tipi "flessibili" (vedi jsonflex.go): questi campi arrivano come numero o
	// come stringa a seconda del provider, e un solo tipo inatteso faceva
	// fallire la decodifica dell'intera risposta.
	Rating5Based       flexFloat  `json:"rating_5based"`
	Num                flexInt    `json:"num"`
	StreamID           flexInt    `json:"stream_id"`
	Name               string     `json:"name"`
	StreamType         string     `json:"stream_type"`
	StreamIcon         string     `json:"stream_icon"`
	EpgChannelID       flexString `json:"epg_channel_id"`
	Added              flexString `json:"added"`
	CategoryID         flexString `json:"category_id"`
	Rating             flexString `json:"rating"`
	ContainerExtension string     `json:"container_extension,omitempty"`

	// Campi aggiuntivi consumati dal frontend per popolare `Channel`
	// (vedi `frontend/services/xtreamPayload.ts`). Senza di essi il payload
	// Go perdeva poster VOD, metadati di film/serie e — soprattutto — il
	// `series_id` necessario a costruire l'id stabile delle serie: il
	// frontend non poteva ricavare `logo`, `description`, `genre`, `year` e
	// `seriesId` da un payload che non li conteneva.
	SeriesID    flexInt    `json:"series_id,omitempty"`
	Cover       string     `json:"cover,omitempty"`
	CoverBig    string     `json:"cover_big,omitempty"`
	MovieImage  string     `json:"movie_image,omitempty"`
	Plot        string     `json:"plot,omitempty"`
	Description string     `json:"description,omitempty"`
	Genre       string     `json:"genre,omitempty"`
	Cast        string     `json:"cast,omitempty"`
	Director    string     `json:"director,omitempty"`
	ReleaseDate string     `json:"releaseDate,omitempty"`
	Year        flexString `json:"year,omitempty"`
	TmdbID      flexString `json:"tmdb_id,omitempty"`
}

type FullPlaylist struct {
	Live   []Category `json:"live"`
	Vod    []Category `json:"vod"`
	Series []Category `json:"series"`

	// FailedBlocks elenca i blocchi ("live", "vod", "series") la cui fetch è
	// fallita in questa run. Serve al frontend per distinguere un blocco vuoto
	// perché *il download è fallito* da uno vuoto perché il provider non ha
	// contenuti: senza, la UI scriveva "il server non ha restituito elementi"
	// anche quando il problema era una risposta troncata (incidente
	// 2026-09-19).
	FailedBlocks []string `json:"failedBlocks,omitempty"`
}

// --- Service Definition ---

type XtreamCredentials struct {
	ServerUrl string `json:"serverUrl"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

// maxCatalogBodyBytes è il tetto per singola risposta del provider.
//
// I cataloghi Xtream reali arrivano a qualche decina di MB; oltre questa soglia
// il payload è patologico (o il server sta rispondendo con altro). Il tetto
// serve perché `io.ReadAll` su un body illimitato — con 6 richieste in
// parallelo — può portare a centinaia di MB di RAM in un colpo solo.
const maxCatalogBodyBytes = 128 << 20 // 128 MiB

// catalogKey identifica un profilo Xtream nella cache dell'ultimo catalogo
// buono. Server e utente insieme: due profili possono puntare allo stesso
// server con utenze diverse, e i loro cataloghi non vanno mescolati.
type catalogKey struct {
	server string
	user   string
}

// blockError associa a un blocco del catalogo (le cui fetch sono una coppia:
// categorie + stream) l'errore che lo ha fatto fallire.
type blockError struct {
	block string
	err   error
}

type PlaylistService struct {
	client *http.Client

	// mu protegge lo stato della run corrente.
	mu sync.Mutex
	// cancel annulla la run in corso, se presente.
	cancel context.CancelFunc
	// generation identifica l'ultima run avviata. Una run che al termine
	// scopre di non essere più quella corrente non deve emettere il risultato:
	// l'evento `playlist:success` non porta alcun identificatore di run, quindi
	// una run vecchia che completava dopo una nuova sovrascriveva la UI con
	// dati stantii.
	generation uint64

	// lastGood è l'ultimo catalogo completo caricato con successo, e serve a
	// non azzerare un blocco quando il provider lo consegna troncato (vedi
	// applyFallbackForFailedBlocks). Uno slot solo, non una mappa: si tiene il
	// catalogo del profilo attivo, non la storia di tutti i profili.
	//
	// Costo: ~20-25 MB per un catalogo da 44k voci, gli stessi dati che il
	// frontend tiene già. È il prezzo per non far sparire il catalogo VOD
	// dell'utente a ogni singhiozzo del provider.
	lastGoodKey catalogKey
	lastGood    *FullPlaylist
}

func New() *PlaylistService {
	return &PlaylistService{
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (s *PlaylistService) ServiceStartup(_ *application.App) error {
	log.Info().Msg("Playlist Service Started")
	return nil
}

func (s *PlaylistService) ProcessXtreamPlaylist(creds XtreamCredentials) error {
	log.Info().Str("server", creds.ServerUrl).Msg("Starting Xtream playlist processing")

	// Cancella la run precedente. Due login ravvicinati (doppio click, cambio
	// profilo) avviavano altrimenti 12 fetch in parallelo, con la run vecchia
	// che poteva completare DOPO la nuova e sovrascriverne il risultato.
	ctx, cancel := context.WithCancel(context.Background())

	s.mu.Lock()
	previous := s.cancel
	s.cancel = cancel
	s.generation++
	gen := s.generation
	s.mu.Unlock()

	if previous != nil {
		previous()
	}

	go s.runXtreamPipeline(ctx, gen, creds)
	return nil
}

// isCurrent indica se `gen` è ancora la run corrente (nessuna run più recente
// l'ha superata).
func (s *PlaylistService) isCurrent(gen uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.generation == gen
}

func (s *PlaylistService) runXtreamPipeline(ctx context.Context, gen uint64, creds XtreamCredentials) {
	_, err := s.fetchPlayerAPI(ctx, creds)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch player API")
		// Se siamo stati superati o cancellati, l'errore è atteso: non
		// dobbiamo mostrarlo all'utente come fallimento del login corrente.
		if s.isCurrent(gen) {
			emitError("Failed to connect to server: " + err.Error())
		}
		return
	}

	var wg sync.WaitGroup

	var liveCategories, vodCategories, seriesCategories []Category
	var liveStreams, vodStreams, seriesStreams []Stream

	// Fan-out: Fetch all categories and streams concurrently.
	//
	// Gli errori NON vanno scartati: un fallimento di decodifica lasciava la
	// slice a `nil`, quindi il blocco (VOD o serie) risultava semplicemente
	// vuoto a valle e l'utente vedeva un catalogo vuoto senza alcuna traccia del
	// motivo. Qui li raccogliamo e li logghiamo per blocco.
	var liveCatErr, vodCatErr, seriesCatErr error
	var liveStreamErr, vodStreamErr, seriesStreamErr error

	wg.Add(6)
	go func() {
		defer wg.Done()
		liveCategories, liveCatErr = s.fetchCategories(ctx, creds, "get_live_categories")
	}()
	go func() {
		defer wg.Done()
		vodCategories, vodCatErr = s.fetchCategories(ctx, creds, "get_vod_categories")
	}()
	go func() {
		defer wg.Done()
		seriesCategories, seriesCatErr = s.fetchCategories(ctx, creds, "get_series_categories")
	}()
	go func() { defer wg.Done(); liveStreams, liveStreamErr = s.fetchStreams(ctx, creds, "get_live_streams") }()
	go func() { defer wg.Done(); vodStreams, vodStreamErr = s.fetchStreams(ctx, creds, "get_vod_streams") }()
	go func() { defer wg.Done(); seriesStreams, seriesStreamErr = s.fetchStreams(ctx, creds, "get_series") }()

	wg.Wait() // Fan-in

	// Errori per blocco, loggati una volta ciascuno (fuori dalle goroutine).
	blockErrors := []blockError{
		{"live_categories", liveCatErr},
		{"vod_categories", vodCatErr},
		{"series_categories", seriesCatErr},
		{"live_streams", liveStreamErr},
		{"vod_streams", vodStreamErr},
		{"series_streams", seriesStreamErr},
	}
	for _, be := range blockErrors {
		if be.err != nil {
			log.Error().
				Err(be.err).
				Str("block", be.block).
				Msg("Xtream: block fetch/decode failed")
		}
	}

	// Run superata da una più recente o annullata: il risultato è obsoleto e
	// non va pubblicato.
	if ctx.Err() != nil || !s.isCurrent(gen) {
		log.Info().Msg("Xtream playlist processing superseded, discarding result")
		return
	}

	// Aggregate data into the structure the frontend expects
	playlist := FullPlaylist{
		Live:   s.mergeStreamsIntoCategories(liveCategories, liveStreams),
		Vod:    s.mergeStreamsIntoCategories(vodCategories, vodStreams),
		Series: s.mergeStreamsIntoCategories(seriesCategories, seriesStreams),
	}

	// Un blocco fallito non deve azzerare il catalogo che l'utente sta già
	// usando (vedi applyFallbackForFailedBlocks).
	playlist = s.applyFallbackForFailedBlocks(creds, playlist, blockErrors)
	playlist.FailedBlocks = failedBlockNames(blockErrors)

	// Conteggio anche i CANALI: il numero di categorie da solo non distingue
	// "catalogo caricato" da "categorie senza stream" (che è esattamente il caso
	// in cui il frontend mostra un blocco vuoto).
	log.Info().
		Int("liveCategories", len(playlist.Live)).
		Int("liveChannels", countChannels(playlist.Live)).
		Int("vodCategories", len(playlist.Vod)).
		Int("vodChannels", countChannels(playlist.Vod)).
		Int("seriesCategories", len(playlist.Series)).
		Int("seriesChannels", countChannels(playlist.Series)).
		Msg("Playlist processing complete")

	emitSuccess(playlist)

	// Copia su disco per il prossimo avvio: quando l'app riparte il catalogo
	// compare subito, invece di attendere 30-50 s di rete (vedi cache.go).
	s.persistCatalogAsync(catalogKey{server: creds.ServerUrl, user: creds.Username}, playlist)
}

// applyFallbackForFailedBlocks sostituisce i blocchi che sono falliti con gli
// ultimi dati validi già caricati, e aggiorna la cache.
//
// PERCHÉ ESISTE (incidente del 2026-09-19): su un provider con ~23k voci VOD, la
// risposta di `get_vod_streams` è arrivata troncata. Il blocco veniva marcato
// vuoto e il risultato pubblicato come successo, quindi il frontend riceveva
// `vod: []` e il catalogo VOD — perfettamente valido fino a un secondo prima —
// spariva dalla UI. Un errore transitorio del provider non deve distruggere
// dati che l'utente sta già usando: il blocco si tiene, e si segnala che è
// rimasto quello di prima.
//
// La sostituzione avviene SOLO se il blocco fresco è vuoto. Un catalogo
// legittimamente più corto (il provider ha rimosso dei contenuti) viene
// pubblicato così com'è: qui non si "aggiusta" un risultato valido.
func (s *PlaylistService) applyFallbackForFailedBlocks(
	creds XtreamCredentials,
	fresh FullPlaylist,
	blockErrors []blockError,
) FullPlaylist {
	key := catalogKey{server: creds.ServerUrl, user: creds.Username}

	s.mu.Lock()
	cached := s.lastGood
	cachedKey := s.lastGoodKey
	s.mu.Unlock()

	if cached == nil || cachedKey != key {
		// Nessuna base da cui recuperare: si pubblica il risultato fresco
		// (eventualmente con blocchi vuoti) e si registra solo se è sano, per
		// non avvelenare la cache con un catalogo già degradato.
		if !hasFailedBlock(blockErrors) {
			s.storeLastGood(key, fresh)
		}
		return fresh
	}

	// Blocchi da recuperare: quelli la cui fetch (categorie o stream) è fallita.
	failed := map[string]bool{}
	for _, be := range blockErrors {
		if be.err == nil {
			continue
		}
		switch {
		case strings.HasPrefix(be.block, "live_"):
			failed["live"] = true
		case strings.HasPrefix(be.block, "vod_"):
			failed["vod"] = true
		case strings.HasPrefix(be.block, "series_"):
			failed["series"] = true
		}
	}

	reuse := func(name string, freshBlock, cachedBlock []Category) []Category {
		if !failed[name] || countChannels(freshBlock) > 0 || countChannels(cachedBlock) == 0 {
			return freshBlock
		}
		log.Warn().
			Str("block", name).
			Int("channels", countChannels(cachedBlock)).
			Msg("Xtream: block failed, keeping the previously loaded catalog for it")
		return cachedBlock
	}

	merged := FullPlaylist{
		Live:   reuse("live", fresh.Live, cached.Live),
		Vod:    reuse("vod", fresh.Vod, cached.Vod),
		Series: reuse("series", fresh.Series, cached.Series),
	}

	// La cache avanza solo con dati freschi per tutti i blocchi: conservare un
	// blocco recuperato la renderebbe una copia di sé stessa e non ci sarebbe
	// più modo di uscirne quando il provider torna a funzionare.
	if !hasFailedBlock(blockErrors) {
		s.storeLastGood(key, fresh)
	}
	return merged
}

// failedBlockNames traduce gli errori per fetch nei blocchi logici del
// catalogo ("live", "vod", "series"), senza duplicati: categorie e stream dello
// stesso blocco sono due fetch ma un solo blocco.
func failedBlockNames(blockErrors []blockError) []string {
	var out []string
	seen := map[string]bool{}
	for _, be := range blockErrors {
		if be.err == nil {
			continue
		}
		var name string
		switch {
		case strings.HasPrefix(be.block, "live_"):
			name = "live"
		case strings.HasPrefix(be.block, "vod_"):
			name = "vod"
		case strings.HasPrefix(be.block, "series_"):
			name = "series"
		default:
			continue
		}
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

func hasFailedBlock(blockErrors []blockError) bool {
	for _, be := range blockErrors {
		if be.err != nil {
			return true
		}
	}
	return false
}

func (s *PlaylistService) storeLastGood(key catalogKey, pl FullPlaylist) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastGoodKey = key
	s.lastGood = &pl
}

// safeURL rimuove query string e userinfo (che per Xtream contengono username e
// password) prima di far finire un URL nei log.
func safeURL(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "[unparseable]"
	}
	u.RawQuery = ""
	u.User = nil
	return u.String()
}

// countChannels somma gli stream di tutte le categorie di un blocco.
func countChannels(categories []Category) int {
	total := 0
	for i := range categories {
		total += len(categories[i].Channels)
	}
	return total
}

// mergeStreamsIntoCategories assembles the nested structure required by the frontend.
func (s *PlaylistService) mergeStreamsIntoCategories(categories []Category, streams []Stream) []Category {
	if len(categories) == 0 {
		return []Category{}
	}
	if len(streams) == 0 {
		for i := range categories {
			categories[i].Channels = []Stream{}
		}
		return categories
	}

	// Chiave `flexString` (non `string`) per confrontare direttamente gli id:
	// categoria e stream possono arrivare con forme diverse (numero vs stringa)
	// ma entrambe normalizzate a testo da `flexString.UnmarshalJSON`.
	categoryMap := make(map[flexString]*Category, len(categories))
	for i := range categories {
		categories[i].Channels = []Stream{}
		categoryMap[categories[i].ID] = &categories[i]
	}

	orphans := 0
	for _, stream := range streams {
		if category, ok := categoryMap[stream.CategoryID]; ok {
			category.Channels = append(category.Channels, stream)
			continue
		}
		orphans++
	}

	// Stream senza categoria corrispondente: sono il sintomo tipico di un
	// `category_id` che non combacia (formato diverso fra l'endpoint delle
	// categorie e quello degli stream). Renderlo visibile evita di dover
	// indovinare perché un blocco appare vuoto.
	if orphans > 0 {
		log.Warn().
			Int("orphanStreams", orphans).
			Int("streams", len(streams)).
			Int("categories", len(categories)).
			Msg("Xtream: streams with no matching category")
	}

	result := make([]Category, 0, len(categories))
	for i := range categories {
		result = append(result, categories[i])
	}

	return result
}

func (s *PlaylistService) buildAPIURL(creds XtreamCredentials, action string) (string, error) {
	u, err := url.Parse(creds.ServerUrl)
	if err != nil {
		return "", fmt.Errorf("invalid server URL: %w", err)
	}
	u.Path = "/player_api.php"
	q := u.Query()
	q.Set("username", creds.Username)
	q.Set("password", creds.Password)
	if action != "" {
		q.Set("action", action)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

// fetchCatalogBody esegue **un** tentativo e ritorna il corpo della risposta
// solo se il JSON è completo.
//
// Ritorna (nil, nil) per una risposta che non è JSON (endpoint non abilitato,
// pagina di errore): quel caso non è un errore, è un blocco vuoto.
//
// La completezza si verifica qui, e non al momento della decodifica nel tipo di
// destinazione, perché la stessa risposta può essere valutata da più tentativi
// in parallelo (vedi fetchCatalogBodyResilient): `json.Valid` è indipendente dal
// tipo e costa una scansione dei byte, contro i ~12 s di rete che servono a
// ottenerli.
func (s *PlaylistService) fetchCatalogBody(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "StreamAI/1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("server returned non-200 status: %s", resp.Status)
	}

	// Tetto esplicito: `io.ReadAll` su un body illimitato, con 6 richieste in
	// parallelo, può allocare centinaia di MB in un colpo solo (un provider che
	// risponde con un payload enorme o con lo stream sbagliato).
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxCatalogBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}
	if len(bodyBytes) > maxCatalogBodyBytes {
		log.Warn().
			Int("limitBytes", maxCatalogBodyBytes).
			Str("url", safeURL(url)).
			Msg("Xtream catalog response truncated at size limit")
		return nil, fmt.Errorf("catalog response exceeds %d bytes limit", maxCatalogBodyBytes)
	}

	if len(bodyBytes) == 0 || (bodyBytes[0] != '[' && bodyBytes[0] != '{') {
		// Molti provider rispondono a un endpoint non abilitato con HTML, testo
		// semplice o una pagina di errore. Senza questo log il blocco risultava
		// semplicemente vuoto, indistinguibile da "abbonamento senza VOD".
		log.Warn().
			Str("url", safeURL(url)).
			Int("bytes", len(bodyBytes)).
			Msg("Xtream: non-JSON response body, treating block as empty")
		return nil, nil
	}

	if !json.Valid(bodyBytes) {
		// Serve l'errore di `encoding/json` per la diagnosi (troncato vs
		// sintassi), ma solo quando il corpo è davvero invalido: decodificarlo
		// in `json.RawMessage` non costruisce la struttura, quindi non alloca
		// nulla di paragonabile a un `any` da 24k elementi.
		var probe json.RawMessage
		probeErr := json.Unmarshal(bodyBytes, &probe)
		if probeErr == nil {
			probeErr = errors.New("body JSON non valido")
		}
		if isTruncatedJSON(probeErr) {
			// Un body che INIZIA come JSON ma non finisce come JSON è il caso
			// osservato in produzione: il pannello, sotto carico, uccide la
			// risposta a metà scrittura (misurato 2026-09-19: i tentativi che
			// finiscono in 11-13 s arrivano interi, quelli che scendono a
			// ~190 KB/s vengono tagliati a 28-43 s, ~20% dei tentativi).
			contentLen := resp.Header.Get("Content-Length")
			log.Warn().
				Str("url", safeURL(url)).
				Int("bytesReceived", len(bodyBytes)).
				Str("contentLength", contentLen).
				Bool("chunked", contentLen == "").
				Msg("Xtream: truncated JSON response from provider")
			return nil, fmt.Errorf("truncated JSON response (%d bytes received, content-length %q): %w",
				len(bodyBytes), contentLen, probeErr)
		}
		return nil, fmt.Errorf("failed to decode JSON response: %w", probeErr)
	}

	return bodyBytes, nil
}

// isTruncatedJSON riconosce il caso "corpo incompleto" da `encoding/json`.
// Un input vuoto non arriva qui (lo intercetta il controllo non-JSON sopra), e
// per un JSON troncato l'errore è `*json.SyntaxError` con messaggio
// "unexpected end of JSON input".
func isTruncatedJSON(err error) bool {
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var syntaxErr *json.SyntaxError
	if errors.As(err, &syntaxErr) {
		return strings.Contains(syntaxErr.Error(), "unexpected end of JSON input")
	}
	return false
}

// fetchAndDecodeRetry scarica un blocco e lo decodifica applicando la politica
// di tentativi descritta qui sotto.
//
// IL GUASTO, MISURATO (2026-09-19). `get_vod_streams` su questo pannello è un
// JSON di 9,9 MB con ~24k elementi, servito in chunked senza `content-length`.
// Il pannello lo uccide a metà scrittura: su 9 richieste consecutive, 2 sono
// arrivate troncate. I tentativi riusciti finiscono in 11-13 s; quelli che
// scendono a ~190 KB/s vengono tagliati a 28-43 s. Non è la cache fredda (un
// troncamento è capitato anche su una richiesta "calda") né un limite di
// dimensione (i tagli sono a 6,4 / 7,0 / 7,7 / 8,4 MB): il pannello abortisce
// sotto carico, in modo casuale e indipendente da una richiesta all'altra.
//
// LA POLITICA, DI CONSEGUENZA.
//
//  1. Hedge: se il primo tentativo è ancora in corso dopo `catalogHedgeDelay`,
//     ne parte un secondo **in parallelo**. È il tempo, non la dimensione, a
//     distinguere il successo dal troncamento: attendere in sequenza un
//     tentativo lento significa perdere 30-40 s per un esito già compromesso,
//     mentre una richiesta nuova ha buone probabilità di cadere nel percorso
//     veloce. Il tentativo perdente viene annullato, così non occupa il
//     pannello più del necessario.
//  2. Se anche i tentativi in parallelo falliscono, ne seguono altri in
//     sequenza — fino a `catalogFetchAttempts` — con la pausa breve di sempre.
//     Il tasso di troncamento misurato è ~35% per tentativo (4 su 11 richieste
//     osservate fra la sessione dell'app e le misure dirette sul pannello):
//     sei tentativi portano il fallimento sotto lo 0,3%.
//
// Non ritenta su risposte che sono legittimamente definitive: 4xx e corpi
// non-JSON (endpoint non abilitato) non cambierebbero al secondo colpo.
func (s *PlaylistService) fetchAndDecodeRetry(ctx context.Context, url string, target interface{}) error {
	body, err := s.fetchCatalogBodyResilient(ctx, url)
	if err != nil {
		return err
	}
	// Corpo non-JSON: blocco vuoto, non un errore (vedi fetchCatalogBody).
	if body == nil {
		return nil
	}
	if err := json.Unmarshal(body, target); err != nil {
		return fmt.Errorf("failed to decode JSON response: %w", err)
	}
	return nil
}

// catalogFetchAttempts è il numero massimo di richieste per un blocco, hedge
// compreso.
//
// Sei e non due: con il tasso di troncamento misurato (~35% per tentativo) due
// tentativi lasciano fallire un blocco su nove, che su un catalogo VOD significa
// l'applicazione inutilizzabile quasi una volta su dieci. Il costo di un
// tentativo in più si paga solo quando il pannello è già in difficoltà.
const catalogFetchAttempts = 6

// catalogHedgeDelay è la soglia oltre la quale parte il tentativo in parallelo.
// Sopra il tempo di una risposta buona (11-13 s misurati) e ben sotto il momento
// in cui il pannello uccide quella lenta (28-43 s).
//
// Variabile e non costante perché i test la accorciano.
var catalogHedgeDelay = 18 * time.Second

type catalogFetchResult struct {
	body []byte
	err  error
}

// fetchCatalogBodyResilient ritorna il primo corpo valido fra i tentativi,
// (nil, nil) per una risposta non-JSON, oppure l'ultimo errore.
func (s *PlaylistService) fetchCatalogBodyResilient(ctx context.Context, url string) ([]byte, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	results := make(chan catalogFetchResult, catalogFetchAttempts)
	started := 0
	launch := func() {
		started++
		go func() {
			body, err := s.fetchCatalogBody(ctx, url)
			select {
			case results <- catalogFetchResult{body: body, err: err}:
			case <-ctx.Done():
			}
		}()
	}

	launch()
	hedge := time.NewTimer(catalogHedgeDelay)
	defer hedge.Stop()

	pending := 1
	var lastErr error
	for pending > 0 {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case r := <-results:
			pending--
			if r.err == nil {
				if started > 1 {
					log.Info().Str("url", safeURL(url)).Int("attempts", started).
						Msg("Xtream: block recovered after retry")
				}
				return r.body, nil
			}
			lastErr = r.err
			if !isRetryableCatalogError(r.err) {
				return nil, r.err
			}
			if pending > 0 {
				// Un altro tentativo è ancora in corso: aspettiamo il suo esito
				// invece di aggiungere carico.
				continue
			}
			if started >= catalogFetchAttempts {
				return nil, lastErr
			}
			log.Warn().Str("url", safeURL(url)).Err(r.err).Int("attempt", started).
				Msg("Xtream: block fetch failed, retrying")
			select {
			case <-time.After(catalogRetryDelay):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
			launch()
			pending++
		case <-hedge.C:
			if started < catalogFetchAttempts {
				log.Warn().Str("url", safeURL(url)).
					Int("afterMs", int(catalogHedgeDelay.Milliseconds())).
					Msg("Xtream: slow block fetch, starting a parallel attempt")
				launch()
				pending++
			}
		}
	}
	return nil, lastErr
}

// catalogRetryDelay è l'attesa prima del secondo tentativo. Breve: il caso è
// "il pannello era occupato", non "il server era giù".
//
// Variabile e non costante perché i test la azzerano: 1,5 s per ogni caso di
// retry renderebbero la suite inutilmente lenta.
var catalogRetryDelay = 1500 * time.Millisecond

// isRetryableCatalogError distingue i fallimenti transitori da quelli
// definitivi (vedi fetchAndDecodeRetry).
func isRetryableCatalogError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	// Endpoint non abilitato / risposta che non è JSON: ritentare non aiuta.
	if strings.Contains(msg, "non-JSON response body") {
		return false
	}
	// Errore HTTP del client: 4xx è definitivo, 5xx è transitorio.
	if strings.Contains(msg, "non-200 status") {
		return strings.Contains(msg, "50")
	}
	// Tutto il resto (troncamenti, timeout, connessioni cadute) è transitorio.
	return true
}

func (s *PlaylistService) fetchPlayerAPI(ctx context.Context, creds XtreamCredentials) (*PlayerAPIResponse, error) {
	apiURL, err := s.buildAPIURL(creds, "")
	if err != nil {
		return nil, err
	}

	var data PlayerAPIResponse
	// Anche questa passa dai tentativi: è la chiamata che decide se l'utente
	// riesce a entrare. Un troncamento qui (payload piccolo, ma il pannello non
	// guarda la dimensione) faceva fallire l'intera pipeline con "Failed to
	// connect to server", cioè l'applicazione inutilizzabile per un guasto
	// transitorio.
	err = s.fetchAndDecodeRetry(ctx, apiURL, &data)
	if err != nil {
		return nil, err
	}

	if data.UserInfo.Auth != 1 {
		return nil, fmt.Errorf("authentication failed: %s", data.UserInfo.Message)
	}

	return &data, nil
}

func (s *PlaylistService) fetchCategories(ctx context.Context, creds XtreamCredentials, action string) ([]Category, error) {
	apiURL, err := s.buildAPIURL(creds, action)
	if err != nil {
		return nil, err
	}

	var categories []Category
	err = s.fetchAndDecodeRetry(ctx, apiURL, &categories)
	if err != nil {
		return nil, err
	}
	return categories, nil
}

func (s *PlaylistService) fetchStreams(ctx context.Context, creds XtreamCredentials, action string) ([]Stream, error) {
	apiURL, err := s.buildAPIURL(creds, action)
	if err != nil {
		return nil, err
	}

	var streams []Stream
	err = s.fetchAndDecodeRetry(ctx, apiURL, &streams)
	if err != nil {
		return nil, err
	}
	return streams, nil
}

func emitSuccess(data interface{}) {
	wailsevents.Emit("playlist:success", data)
}

func emitError(message string) {
	wailsevents.Emit("playlist:error", message)
}
