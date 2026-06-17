package playlist

import (
	"encoding/json"
	"fmt"
	"github.com/AlfioSaitta/StreamAI-IPTV/internal/pkg/wailsevents"
	"github.com/rs/zerolog/log"
	"github.com/wailsapp/wails/v3/pkg/application"
	"io"
	"net/http"
	"net/url"
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
	ID       string   `json:"category_id"`
	Name     string   `json:"category_name"`
	ParentID int      `json:"parent_id"`
	Channels []Stream `json:"channels,omitempty"`
}

type Stream struct {
	Rating5Based       float32 `json:"rating_5based"`
	Num                int     `json:"num"`
	StreamID           int     `json:"stream_id"`
	Name               string  `json:"name"`
	StreamType         string  `json:"stream_type"`
	StreamIcon         string  `json:"stream_icon"`
	EpgChannelID       string  `json:"epg_channel_id"`
	Added              string  `json:"added"`
	CategoryID         string  `json:"category_id"`
	Rating             string  `json:"rating"`
	ContainerExtension string  `json:"container_extension,omitempty"`
}

type FullPlaylist struct {
	Live   []Category `json:"live"`
	Vod    []Category `json:"vod"`
	Series []Category `json:"series"`
}

// --- Service Definition ---

type XtreamCredentials struct {
	ServerUrl string `json:"serverUrl"`
	Username  string `json:"username"`
	Password  string `json:"password"`
}

type PlaylistService struct {
	client *http.Client
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
	go s.runXtreamPipeline(creds)
	return nil
}

func (s *PlaylistService) runXtreamPipeline(creds XtreamCredentials) {
	_, err := s.fetchPlayerAPI(creds)
	if err != nil {
		log.Error().Err(err).Msg("Failed to fetch player API")
		emitError("Failed to connect to server: " + err.Error())
		return
	}

	var wg sync.WaitGroup

	var liveCategories, vodCategories, seriesCategories []Category
	var liveStreams, vodStreams, seriesStreams []Stream

	// Fan-out: Fetch all categories and streams concurrently
	wg.Add(6)
	go func() { defer wg.Done(); liveCategories, _ = s.fetchCategories(creds, "get_live_categories") }()
	go func() { defer wg.Done(); vodCategories, _ = s.fetchCategories(creds, "get_vod_categories") }()
	go func() { defer wg.Done(); seriesCategories, _ = s.fetchCategories(creds, "get_series_categories") }()
	go func() { defer wg.Done(); liveStreams, _ = s.fetchStreams(creds, "get_live_streams") }()
	go func() { defer wg.Done(); vodStreams, _ = s.fetchStreams(creds, "get_vod_streams") }()
	go func() { defer wg.Done(); seriesStreams, _ = s.fetchStreams(creds, "get_series") }()

	wg.Wait() // Fan-in

	// Aggregate data into the structure the frontend expects
	playlist := FullPlaylist{
		Live:   s.mergeStreamsIntoCategories(liveCategories, liveStreams),
		Vod:    s.mergeStreamsIntoCategories(vodCategories, vodStreams),
		Series: s.mergeStreamsIntoCategories(seriesCategories, seriesStreams),
	}

	log.Info().
		Int("liveCategories", len(playlist.Live)).
		Int("vodCategories", len(playlist.Vod)).
		Int("seriesCategories", len(playlist.Series)).
		Msg("Playlist processing complete")

	emitSuccess(playlist)
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

	categoryMap := make(map[string]*Category, len(categories))
	for i := range categories {
		categories[i].Channels = []Stream{}
		categoryMap[categories[i].ID] = &categories[i]
	}

	for _, stream := range streams {
		if category, ok := categoryMap[stream.CategoryID]; ok {
			category.Channels = append(category.Channels, stream)
		}
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

func (s *PlaylistService) fetchAndDecode(url string, target interface{}) error {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("User-Agent", "StreamAI/1.0")

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned non-200 status: %s", resp.Status)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read response body: %w", err)
	}

	if len(bodyBytes) == 0 || (bodyBytes[0] != '[' && bodyBytes[0] != '{') {
		return nil
	}

	if err := json.Unmarshal(bodyBytes, target); err != nil {
		return fmt.Errorf("failed to decode JSON response: %w", err)
	}

	return nil
}

func (s *PlaylistService) fetchPlayerAPI(creds XtreamCredentials) (*PlayerAPIResponse, error) {
	apiURL, err := s.buildAPIURL(creds, "")
	if err != nil {
		return nil, err
	}

	var data PlayerAPIResponse
	err = s.fetchAndDecode(apiURL, &data)
	if err != nil {
		return nil, err
	}

	if data.UserInfo.Auth != 1 {
		return nil, fmt.Errorf("authentication failed: %s", data.UserInfo.Message)
	}

	return &data, nil
}

func (s *PlaylistService) fetchCategories(creds XtreamCredentials, action string) ([]Category, error) {
	apiURL, err := s.buildAPIURL(creds, action)
	if err != nil {
		return nil, err
	}

	var categories []Category
	err = s.fetchAndDecode(apiURL, &categories)
	if err != nil {
		return nil, err
	}
	return categories, nil
}

func (s *PlaylistService) fetchStreams(creds XtreamCredentials, action string) ([]Stream, error) {
	apiURL, err := s.buildAPIURL(creds, action)
	if err != nil {
		return nil, err
	}

	var streams []Stream
	err = s.fetchAndDecode(apiURL, &streams)
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
