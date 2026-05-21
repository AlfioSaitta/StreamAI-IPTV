# SPIKE-1 — libmpv render-API → texture GL → WebGL2 canvas

> Status: ◐ in progress (scaffolding 2026-05-21) — vedi
> [`plan-go-wails-migration.md`](plan-go-wails-migration.md) §6.0.

## Obiettivo

Verificare che il pipeline **libmpv → OpenGL FBO → readback → WebGL2** sia
in grado di sostenere riproduzione video reale ai target KPI sotto, su
tutte le piattaforme desktop del MVP.

Per la **prima iterazione** ci concentriamo su **Linux X11/Wayland**
(openSUSE TW dev host, Ubuntu 24.04 CI). Windows/macOS saranno aggiunti
in una seconda passata (ticket SPIKE-1-WIN / SPIKE-1-MAC) e non sono
prerequisito per chiudere questo spike sul piano logico — ma restano
gate per `v2.0.0` complessivo come da §6.0.

## Esito atteso (gate)

| Hardware | Target frame time (full pipeline) | Dropped frames (10 min) |
|----------|----------------------------------|-------------------------|
| Intel UHD 620 / M1 / Ryzen 5500 (1080p60) | ≤ 8 ms | ≤ 0.5% |
| Intel UHD 770 / M1 Pro / NVIDIA GTX 1660+ (4K60) | ≤ 14 ms | ≤ 0.5% |

Se uno qualsiasi dei due falla sull'hardware target ⇒ promuovere
**SPIKE-5** (DRM-PRIME zero-copy) a *mandatory* anziché opzionale, e
rivalutare il transport.

## Setup dev host

### openSUSE Tumbleweed (riferimento)

```bash
sudo zypper install -y \
    mpv-devel \
    Mesa-libEGL-devel Mesa-libGL-devel \
    libwayland-egl1 \
    pkgconf-pkg-config
```

### Ubuntu 24.04 (CI / runner)

```bash
sudo apt-get install -y \
    libmpv-dev \
    libegl1-mesa-dev libgl1-mesa-dev \
    pkg-config
```

### Verifica

```bash
pkg-config --modversion mpv      # ≥ 0.34 (libmpv2 API ≥ 1.107)
pkg-config --modversion egl gl   # presenti
```

## Esecuzione

```bash
# Build harness Go (richiede libmpv-dev + EGL/GL).
task spike:1:build

# Run su uno stream HEVC 10-bit (esempio Big Buck Bunny 4K HEVC):
./build/bin/spike-mpv-render \
    -url https://example.com/bbb_4k_hevc.mkv \
    -duration 60s \
    -fbo-width 3840 -fbo-height 2160 \
    -output dist/spike1-report.json

# Apre il PoC WebGL2 (legge frame via WS dalla porta 7799):
xdg-open frontend/spike/mpv-webgl2/index.html

# Oppure (più semplice) bench end-to-end orchestrato:
scripts/spike1-bench.sh
```

## Test clip raccomandate

| Slot | Codec | Risoluzione | Durata | Fonte |
|------|-------|-------------|--------|-------|
| C1   | H.264 8-bit | 1920×1080@60 | 10 min | TPN  / Sintel |
| C2   | HEVC 10-bit | 1920×1080@60 | 10 min | Jellyfish-90Mbps |
| C3   | HEVC 10-bit | 3840×2160@60 | 10 min | LG 4K HDR demo |
| C4   | AV1 10-bit  | 3840×2160@60 | 10 min | Netflix Open Content |
| C5   | HLS live    | 1920×1080@50 | 60 min | RAI HLS pubblico |

Le clip C1–C4 vanno scaricate localmente (no rete) per isolare la
misura dal jitter di rete. C5 è soak test misto rete+decode.

## Metriche raccolte (`spike1-report.json`)

Per ogni clip e per ogni hardware:

```jsonc
{
  "hw": { "cpu": "AMD Ryzen 5500", "gpu": "Intel UHD 620 (Mesa 24.x)", "ram_gb": 16, "os": "openSUSE TW 20260518" },
  "clip": "C3-LG-4K-HDR",
  "fbo": { "width": 3840, "height": 2160, "format": "RGBA8" },
  "duration_s": 600,
  "frames": 36000,
  "frame_time_ms": {
    "p50": 11.2,
    "p95": 13.8,
    "p99": 16.1,
    "max": 41.7,
    "histogram_buckets_ms": [0, 4, 8, 12, 16, 20, 30, 60, 120],
    "histogram_counts":     [0, 2, 4521, 28910, 1980, 320, 180, 70, 19]
  },
  "dropped_frames": { "count": 42, "ratio": 0.00117 },
  "decoder_hwdec": "vaapi",
  "result": "pass"
}
```

`result`:
- `"pass"` — p95 ≤ target frame time **AND** dropped ratio ≤ 0.5%
- `"warn"` — p95 ≤ target ma dropped > 0.5%, o viceversa
- `"fail"` — p95 > target ma dropped > 0.5% — gate non superato

## Decision matrix post-misura

| Esito Linux 1080p | Esito Linux 4K | Azione |
|-------------------|----------------|--------|
| pass | pass | ✅ Procedere con Fase 6.1 (implementazione backend D) |
| pass | warn/fail | ⚠️ Promuovere SPIKE-5 (DRM-PRIME) a mandatory |
| warn | fail | ⚠️ Indagare bottleneck (readback vs decode), valutare transport WebCodecs |
| fail | fail | ❌ Stop migrazione su Linux; rivedere architettura player |

## Anti-obiettivi (fuori scope di SPIKE-1)

- Audio routing (PipeWire/PA) — coperto da SPIKE-4.
- A/V sync drift — coperto da SPIKE-4.
- DRM-PRIME / VAAPI zero-copy — SPIKE-5.
- Shared-memory IPC ottimizzato — SPIKE-3 (qui usiamo WS+RGBA8 per semplicità).
- Document Picture-in-Picture — SPIKE-2.

## Note implementative scaffold corrente

L'harness in `cmd/spike-mpv-render/` ha attualmente:

- ✅ EGL surfaceless context (no display server richiesto per CI)
- ✅ libmpv `mpv_render_context_create` con `MPV_RENDER_API_TYPE_OPENGL`
- ✅ FBO RGBA8 configurabile via `-fbo-width / -fbo-height`
- ✅ `glReadPixels` RGBA + WebSocket binary feed verso il PoC TS
- ✅ Histogram frame-time + counter dropped frame via `frame-drop-count`
- ☐ Rendering NV12/P010 diretto (rinviato, richiede SPIKE-5 / GL_TEXTURE_EXTERNAL_OES)
- ☐ Misura GPU time via `EXT_disjoint_timer_query_webgl2` lato browser
- ☐ Soak automatizzato con `-duration` ≥ 10m + auto-report

## Smoke run osservato (2026-05-21)

Dev host: openSUSE TW, GPU **NVIDIA GeForce RTX 3050 Ti Laptop** (driver
580.159.03), OpenGL 3.3 Core via EGL surfaceless. Sorgente sintetica
`av://lavfi:testsrc2` (no decoder reale → misura solo render + readback).

| FBO | Frames in 10 s | p50 | p95 | p99 | max | result |
|-----|---------------:|----:|----:|----:|----:|:------:|
| 1920×1080 RGBA8 | 601 | 16.66 ms | 16.91 ms | 18.78 ms | 19.47 ms | **warn** |
| 3840×2160 RGBA8 | 583 | 16.98 ms | 18.75 ms | 22.16 ms | 24.65 ms | **fail** |

> p50 ≈ 16.6 ms su entrambe le risoluzioni = cadenza VSync del decoder
> a 60 fps (1/60 = 16.67 ms). I numeri **non** sono il tempo GPU reale:
> il bottleneck dominante è `glReadPixels` sincrono CPU-side
> (~ 8 MB/frame a 1080p, ~ 33 MB/frame a 4K).

**Conclusione preliminare:** il pipeline EGL + FBO + readback RGBA8 **non**
soddisfa il KPI 4K60 (p95 18.75 > 14 ms target). Questo era atteso e
**richiede** la promozione di **SPIKE-5 (DRM-PRIME zero-copy)** a
mandatory per il 4K Linux, oppure il passaggio a transport WebCodecs
(SPIKE-3 fallback). Le misure su sorgente reale (HEVC/H.264 decoded)
seguiranno l'installazione del pacchetto codec completo (su openSUSE TW
richiede repo Packman per ffmpeg/mpv full-codec).

## Smoke quick-start

```bash
task spike:1:build      # richiede mpv-devel + Mesa-libEGL-devel + Mesa-libGL-devel
task spike:1:smoke      # 10 s @ 1080p + 10 s @ 4K via lavfi (no codec real)
ls dist/spike1/         # smoke-1080p.json, smoke-4k.json
```

Per misure con codec reale (HEVC/H.264) installare:

- **openSUSE TW**: `sudo zypper install -y --from packman ffmpeg-7 libavcodec`
  (Packman ha ffmpeg full-codec; il repo OSS ha solo libopenh264).
- **Ubuntu 24.04+**: codec full inclusi di default.
- **Fedora**: `sudo dnf install ffmpeg-free --allowerasing`.

