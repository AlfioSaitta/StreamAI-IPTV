// Test del subscriber pattern di events.go (Fase 6.5).
//go:build !mpv
package player
import (
"sync"
"sync/atomic"
"testing"
"time"
)
// fakeOKBackend ritorna nil su tutti i mutating method e mantiene
// stato minimo (volume/paused/loaded/position) per validare il
// payload PlayerStateEvent emesso. Lo stubBackend default ritorna
// errNotBuilt e quindi blocca la propagazione di emitState().
type fakeOKBackend struct {
stubBackend
mu       sync.Mutex
volume   float64
paused   bool
loaded   bool
position float64
}
func (f *fakeOKBackend) Load(string, map[string]string) error {
f.mu.Lock()
defer f.mu.Unlock()
f.loaded = true
return nil
}
func (f *fakeOKBackend) Play() error  { f.mu.Lock(); defer f.mu.Unlock(); f.paused = false; return nil }
func (f *fakeOKBackend) Pause() error { f.mu.Lock(); defer f.mu.Unlock(); f.paused = true; return nil }
func (f *fakeOKBackend) Stop() error {
f.mu.Lock()
defer f.mu.Unlock()
f.loaded = false
f.paused = false
return nil
}
func (f *fakeOKBackend) Seek(s float64) error {
f.mu.Lock()
defer f.mu.Unlock()
f.position = s
return nil
}
func (f *fakeOKBackend) SetVolume(v float64) error {
f.mu.Lock()
defer f.mu.Unlock()
f.volume = v
return nil
}
func (f *fakeOKBackend) SetMuted(bool) error    { return nil }
func (f *fakeOKBackend) SetSpeed(float64) error { return nil }
func (f *fakeOKBackend) State() (State, error) {
f.mu.Lock()
defer f.mu.Unlock()
return State{
Loaded:   f.loaded,
Paused:   f.paused,
Playing:  f.loaded && !f.paused,
Position: f.position,
Volume:   f.volume,
}, nil
}
func newServiceWithFake() *Service {
return &Service{backend: &fakeOKBackend{}, watcherStop: make(chan struct{})}
}
func TestSubscribe_BasicFanout(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var calls atomic.Int32
var lastEvent PlayerStateEvent
var mu sync.Mutex
defer s.Subscribe(func(evt PlayerStateEvent) {
calls.Add(1)
mu.Lock()
lastEvent = evt
mu.Unlock()
})()
if err := s.Play(); err != nil {
t.Fatalf("Play: %v", err)
}
if err := s.Pause(); err != nil {
t.Fatalf("Pause: %v", err)
}
if err := s.SetVolume(0.5); err != nil {
t.Fatalf("SetVolume: %v", err)
}
if got := calls.Load(); got < 3 {
t.Errorf("calls=%d want>=3", got)
}
mu.Lock()
defer mu.Unlock()
if lastEvent.Volume != 0.5 {
t.Errorf("volume=%v want 0.5", lastEvent.Volume)
}
if !lastEvent.Paused {
t.Errorf("paused=%v want true", lastEvent.Paused)
}
}
func TestSubscribe_LoadEmitsURL(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var lastURL string
var mu sync.Mutex
defer s.Subscribe(func(evt PlayerStateEvent) {
mu.Lock()
lastURL = evt.SourceURL
mu.Unlock()
})()
if err := s.Load("http://example.com/live.m3u8", nil); err != nil {
t.Fatalf("Load: %v", err)
}
mu.Lock()
defer mu.Unlock()
if lastURL != "http://example.com/live.m3u8" {
t.Errorf("sourceURL=%q", lastURL)
}
}
func TestSubscribe_Unsubscribe(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var calls atomic.Int32
unsub := s.Subscribe(func(PlayerStateEvent) { calls.Add(1) })
_ = s.Play()
unsub()
pre := calls.Load()
_ = s.Pause()
_ = s.SetVolume(0.3)
if post := calls.Load(); pre != post {
t.Errorf("after unsubscribe pre=%d post=%d", pre, post)
}
}
func TestSubscribe_MultipleSubscribers(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var a, b, c atomic.Int32
defer s.Subscribe(func(PlayerStateEvent) { a.Add(1) })()
defer s.Subscribe(func(PlayerStateEvent) { b.Add(1) })()
defer s.Subscribe(func(PlayerStateEvent) { c.Add(1) })()
_ = s.Play()
if a.Load() < 1 || b.Load() < 1 || c.Load() < 1 {
t.Errorf("fanout incomplete a=%d b=%d c=%d", a.Load(), b.Load(), c.Load())
}
}
func TestSubscribe_NilCallback(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
unsub := s.Subscribe(nil)
if unsub == nil {
t.Fatal("nil unsub")
}
unsub()
}
func TestSetTrackMetadata(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var title, artist, art string
var mu sync.Mutex
defer s.Subscribe(func(evt PlayerStateEvent) {
mu.Lock()
title, artist, art = evt.TrackTitle, evt.TrackArtist, evt.TrackArtURL
mu.Unlock()
})()
if err := s.SetTrackMetadata("Canale 1", "Live IPTV", "http://logo"); err != nil {
t.Fatalf("SetTrackMetadata: %v", err)
}
mu.Lock()
defer mu.Unlock()
if title != "Canale 1" || artist != "Live IPTV" || art != "http://logo" {
t.Errorf("title=%q artist=%q art=%q", title, artist, art)
}
}
func TestStop_ClearsMetadata(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
var title string
var mu sync.Mutex
defer s.Subscribe(func(evt PlayerStateEvent) {
mu.Lock()
title = evt.TrackTitle
mu.Unlock()
})()
_ = s.SetTrackMetadata("Canale", "Live", "")
_ = s.Stop()
mu.Lock()
defer mu.Unlock()
if title != "" {
t.Errorf("after Stop title=%q want empty", title)
}
}
func TestWatcher_StopsWhenNoSubscribers(t *testing.T) {
s := newServiceWithFake()
defer func() { _ = s.ServiceShutdown() }()
unsub := s.Subscribe(func(PlayerStateEvent) {})
s.evMu.RLock()
running := s.watcherRunning
s.evMu.RUnlock()
if !running {
t.Fatal("watcher should run")
}
unsub()
deadline := time.Now().Add(3 * time.Second)
for time.Now().Before(deadline) {
s.evMu.RLock()
r := s.watcherRunning
s.evMu.RUnlock()
if !r {
return
}
time.Sleep(100 * time.Millisecond)
}
t.Error("watcher did not stop")
}
func TestEmitState_BackendErrorBestEffort(t *testing.T) {
s := &Service{backend: &stubBackend{}, watcherStop: make(chan struct{})}
defer func() { _ = s.ServiceShutdown() }()
var calls atomic.Int32
defer s.Subscribe(func(PlayerStateEvent) { calls.Add(1) })()
if err := s.SetTrackMetadata("X", "Y", ""); err != nil {
t.Fatalf("SetTrackMetadata: %v", err)
}
if calls.Load() < 1 {
t.Error("subscriber not invoked on best-effort emit")
}
}
