// Package proxy — HTTP proxy locale per riscrivere header IPTV
// (User-Agent custom, strip CSP/X-Frame-Options, CORS *).
//
// Sostituisce gli interceptor webRequest.onHeadersReceived di Electron (Wails
// non li espone nativamente). Vedi docs/plan-go-wails-migration.md sez. 5.
//
// Pattern URL: http://127.0.0.1:<port>/proxy?u=<base64url>&ua=<...>
// libmpv riceve direttamente l'URL riscritto.
//
// Implementazione attesa (Fase 5):
//   - net/http stdlib su porta random (127.0.0.1:0)
//   - oppure middleware AssetServer v3 (application.AssetServerOptions.Middleware)
package proxy
import "errors"
// Service e' il Wails v3 Service del proxy IPTV.
type Service struct{}
// New costruisce il servizio.
func New() *Service { return &Service{} }
var errNotImpl = errors.New("proxy: not implemented yet (plan sez. 6 Fase 5)")
// BuildProxyURL costruisce l'URL locale che il player deve usare al posto
// dello stream originale.
func (s *Service) BuildProxyURL(streamURL, userAgent string, headers map[string]string) (string, error) {
	return "", errNotImpl
}
// Port ritorna la porta locale del proxy.
func (s *Service) Port() (int, error) { return 0, errNotImpl }
