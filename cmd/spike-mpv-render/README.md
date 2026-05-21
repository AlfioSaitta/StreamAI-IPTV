# spike-mpv-render

PoC harness Go per **SPIKE-1** (vedi
[`docs/spike1-methodology.md`](../../docs/spike1-methodology.md) e
[`docs/plan-go-wails-migration.md`](../../docs/plan-go-wails-migration.md) §6.0).

Apre un contesto EGL surfaceless, crea un `mpv_render_context` con
`MPV_RENDER_API_TYPE_OPENGL`, riproduce uno stream verso un FBO RGBA8
configurabile e:

1. raccoglie istogramma frame-time + counter dropped frame e produce un
   report JSON pronto per `spike1-report.json`;
2. (opz.) espone i frame via WebSocket binary verso il PoC TS in
   `frontend/spike/mpv-webgl2/` per misurare il pipeline end-to-end
   fino a `<canvas>` WebGL2.

## Build

Richiede `libmpv-dev`, `libegl1-mesa-dev`, `libgl1-mesa-dev`,
`pkg-config`. Build tag `mpv` obbligatorio (in linea con
`internal/services/player/mpv_cgo.go`).

```bash
# Da repo root:
task spike:1:build
# oppure:
go build -tags 'mpv spike1' -o build/bin/spike-mpv-render ./cmd/spike-mpv-render
```

Senza il tag `mpv` (o su OS non supportati) viene compilato lo stub che
stampa istruzioni e termina con exit 2.

## Esecuzione

```bash
./build/bin/spike-mpv-render \
    -url https://example.com/bbb_4k_hevc.mkv \
    -duration 60s \
    -fbo-width 3840 -fbo-height 2160 \
    -ws-addr :7799 \
    -output dist/spike1-report.json
```

| Flag | Default | Descrizione |
|------|---------|-------------|
| `-url`        | (richiesto) | URL o path locale dello stream da riprodurre |
| `-duration`   | `60s`       | Durata della misura (Go `time.Duration`) |
| `-fbo-width`  | `1920`      | Larghezza FBO RGBA8 |
| `-fbo-height` | `1080`      | Altezza FBO RGBA8 |
| `-ws-addr`    | (off)       | Se valorizzato, espone WebSocket binary su quell'addr |
| `-ws-throttle`| `30`        | Max FPS verso WS (riduce traffico per misure GPU lato browser) |
| `-output`     | `stdout`    | File JSON con il report KPI (`-` = stdout) |
| `-warmup`     | `2s`        | Frame scartati prima di iniziare la misura |
| `-hwdec`      | `auto-safe` | Override libmpv `hwdec` (es. `vaapi`, `no`) |
| `-verbose`    | `false`     | Log libmpv su stderr |

## Vincoli noti

- **Linux only** in questa iterazione. Per Windows / macOS servono
  `wgl_*` / `cgl_*` context creation — tracciati come SPIKE-1-WIN e
  SPIKE-1-MAC.
- FBO RGBA8 = ~ 2 GB/s di readback a 4K60 (3840·2160·4·60 ≈ 1.99 GB/s).
  È volutamente il "worst case CPU readback"; SPIKE-5 esplorerà il
  fast-path DRM-PRIME zero-copy che lo riduce a ~ 0 sul lato CPU.
- L'EGL surfaceless richiede Mesa ≥ 18 (tutto il toolchain target lo ha
  già). In ambienti senza GPU (CI runner senza `--gpus`) il context EGL
  fallisce all'init: gestito con messaggio chiaro.

