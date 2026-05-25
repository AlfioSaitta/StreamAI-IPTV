// Stub backend per `player.Service`. Compilato di default (zero build-tag);
// escluso quando `-tags mpv` è passato a `go build`. Tutti i metodi ritornano
// `errNotBuilt` per indicare al frontend che il binario corrente non include
// il backend cgo. In Wails dev su una macchina senza libmpv, il frontend
// mostra il banner "Backend video non disponibile — rebuild with -tags mpv".

//go:build !mpv

package player

func newBackend() backend { return &stubBackend{} }

type stubBackend struct{}

func (*stubBackend) Load(string, map[string]string) error { return errNotBuilt }
func (*stubBackend) Play() error                          { return errNotBuilt }
func (*stubBackend) Pause() error                         { return errNotBuilt }
func (*stubBackend) Stop() error                          { return errNotBuilt }
func (*stubBackend) Seek(float64) error                   { return errNotBuilt }
func (*stubBackend) SetVolume(float64) error              { return errNotBuilt }
func (*stubBackend) SetMuted(bool) error                  { return errNotBuilt }
func (*stubBackend) SetSpeed(float64) error               { return errNotBuilt }
func (*stubBackend) SetAid(int) error                     { return errNotBuilt }
func (*stubBackend) SetSid(int) error                     { return errNotBuilt }
func (*stubBackend) AddSub(string) error                  { return errNotBuilt }
func (*stubBackend) Resize(int, int) error                { return errNotBuilt }
func (*stubBackend) Tracks() ([]Track, error)             { return nil, errNotBuilt }
func (*stubBackend) SetMaxBitrate(int) error              { return errNotBuilt }
func (*stubBackend) BufferInfo() (BufferInfo, error)      { return BufferInfo{}, errNotBuilt }
func (*stubBackend) State() (State, error)                { return State{}, errNotBuilt }
func (*stubBackend) HwInfo() (HwAccelInfo, error)         { return HwAccelInfo{Built: false}, errNotBuilt }
func (*stubBackend) RenderFrame(int, int) ([]byte, error) { return nil, errNotBuilt }
func (*stubBackend) Close() error                         { return nil }
