package remote
import (
"context"
"encoding/json"
"testing"
"time"
"github.com/coder/websocket"
"github.com/wailsapp/wails/v3/pkg/application"
)
// TestRemote_PingPongAndBroadcast smoke-test: avvia il WS server, connette
// un client coder/websocket, manda {action:"ping"}, riceve {type:"pong"};
// poi BroadcastStatus → il client riceve {type:"status",payload:...}.
func TestRemote_PingPongAndBroadcast(t *testing.T) {
r := New(19021)
if err := r.ServiceStartup(context.Background(), application.ServiceOptions{}); err != nil {
t.Fatalf("startup: %v", err)
}
t.Cleanup(func() { _ = r.ServiceShutdown() })
time.Sleep(150 * time.Millisecond)
ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
defer cancel()
c, _, err := websocket.Dial(ctx, "ws://127.0.0.1:19021/", nil)
if err != nil {
t.Fatalf("dial: %v", err)
}
t.Cleanup(func() { _ = c.Close(websocket.StatusNormalClosure, "") })
cmd, _ := json.Marshal(map[string]any{"action": "ping"})
if err := c.Write(ctx, websocket.MessageText, cmd); err != nil {
t.Fatalf("write: %v", err)
}
_, msg, err := c.Read(ctx)
if err != nil {
t.Fatalf("read pong: %v", err)
}
var resp map[string]any
_ = json.Unmarshal(msg, &resp)
if resp["type"] != "pong" {
t.Fatalf("expected pong, got %s", msg)
}
r.BroadcastStatus(map[string]any{"streamTitle": "Test", "isPlaying": true})
_, msg2, err := c.Read(ctx)
if err != nil {
t.Fatalf("read status: %v", err)
}
var env map[string]any
_ = json.Unmarshal(msg2, &env)
if env["type"] != "status" {
t.Fatalf("expected status, got %s", msg2)
}
if r.Clients() != 1 {
t.Errorf("expected 1 client, got %d", r.Clients())
}
if r.Port() != 19021 {
t.Errorf("expected port 19021, got %d", r.Port())
}
}
