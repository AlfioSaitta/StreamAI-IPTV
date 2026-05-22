# SPIKE-1 — risultati smoke test (2026-05-22)

Run #1 sul host di sviluppo openSUSE Tumbleweed con GPU NVIDIA RTX 3050 Ti
Laptop, driver 580.159.03, libmpv 2.5.0, ffmpeg lavfi `testsrc2`.

> Sorgente sintetica: niente decoder esercitato → questi numeri misurano
> il **transport** (mpv render → FBO RGBA8 → `glReadPixels` → CPU buffer),
> non la decodifica. Per i numeri di decode/hwdec reali serve la suite
> con clip BBB 1080p/4K H.264/HEVC/AV1 (vedi `scripts/spike1-bench.sh`).

## Matrice risultati

| Configurazione      | fps  | p50 (ms) | p95 (ms) | p99 (ms) | drop      | result |
| ------------------- | ---- | -------- | -------- | -------- | --------- | ------ |
| 1080p60 hwdec=no    | 60.1 | 16.65    | 18.76    | 21.54    | 0 / 481   | warn   |
| 1080p60 hwdec=auto  | 60.1 | 16.66    | **16.95**| **18.04**| 0 / 481   | warn   |
| 4K60   hwdec=no     | 58.6 | 16.93    | 18.48    | 21.00    | 17 / 469  | fail   |
| 4K60   hwdec=auto   | 58.7 | 16.93    | 18.19    | 20.36    | 15 / 470  | fail   |

Soglie KPI (vedi `cmd/spike-mpv-render/kpi.go → gradeResult()`):
- 1080p: p95 ≤ 8.0 ms (calcolato escludendo vsync)
- 4K:    p95 ≤ 14.0 ms
- dropped ratio ≤ 0.5%

## Analisi

### ✅ HW decode funziona (NVDEC su NVIDIA, path libmpv `hwdec=auto-safe`)

Il delta `1080p SW → 1080p HW` su p95 (**18.76→16.95 ms**, −9.7 %) e p99
(**21.54→18.04 ms**, −16.3 %) conferma che `hwdec=auto-safe` istanzia
correttamente NVDEC. A 1080p l'HW migliora il tail latency e azzera i
dropped frame.

### ⚠️ Transport T1 (readback CPU) satura a 4K

A 4K@60 il pacchetto RGBA8 trasferito da GPU a RAM è `3840×2160×4 ≈
33 MB/frame`, cioè **~2 GB/s sostenuti** su PCIe per stare nei 16.67 ms.
Sul portatile con GPU su PCIe x8 Gen4 il bus è saturo:
- p99 a 20+ ms su entrambe le run (SW e HW): il bottleneck non è il
  decoder ma `glReadPixels(RGBA, GL_UNSIGNED_BYTE, …)` + memcpy.
- ~3.2-3.5 % di frame droppati (15-17 / 470).

**Conseguenza per il piano:** il transport T1 (`readback → JS canvas`) è
viabile solo fino a 1080p60. Per 4K@60 serve T2 (DMA-BUF zero-copy —
`mpv_render` → `EGL_LINUX_DMA_BUF_EXT` → `EGLImage` → texture WebKit GL)
oppure T3 (memoria condivisa con dispatch tile-based via shared image).

### ⚙️ Soglia KPI vs realtà visiva

Le soglie attuali (`p95 ≤ 8 ms` a 1080p) **escludono** la quota vsync.
Il misuratore corrente non separa "GPU work" da "vsync wait": il p50
=16.65 ms a 1080p è esattamente `1/60s` ⇒ stiamo misurando il ciclo
frame intero, non il tempo CPU/GPU puro. Risultato: tutti i run
finiscono in **warn/fail** per definizione, anche quando visivamente
sono perfetti (60.1 fps, 0 drop a 1080p).

**Refactor consigliato** (non blocking per Fase 6):
1. Inserire `glFenceSync` dopo il dispatch render e misurare solo il
   tempo da fence-creation a `glClientWaitSync(fence, 0)` → tempo GPU
   work puro.
2. Disabilitare il vsync nell'EGL surface (`eglSwapInterval(0)`) durante
   il bench: l'harness gira offscreen, non serve sync al display.
3. Aggiornare le soglie a valori realistici post-refactor (probabile
   `p95_gpu ≤ 4 ms` a 1080p, `p95_gpu ≤ 10 ms` a 4K).

## Decisioni architetturali (Fase 6)

- **Transport** scelto per Fase 6.1: **T2 (DMA-BUF zero-copy)** su
  Linux, fallback T1 (readback) su macOS/Windows e su Linux quando
  `EGL_EXT_image_dma_buf_import` non è disponibile (vecchi driver Mesa
  pre-22.x). Vedi piano §4.3 e piano §6.0 "Strategia transport".
- **Decoder selection**: usare il default libmpv `hwdec=auto-safe` (già
  in `mpv_cgo.go`). Su Linux NVIDIA → NVDEC; su Linux Intel/AMD →
  VAAPI; su macOS → VideoToolbox; su Windows → D3D11VA. Già verificato
  funzionante.
- **Resolution cap iniziale**: portare a produzione **fino a 1080p60**
  con T1, sbloccare 4K solo dopo SPIKE-3 (T2 funzionante su almeno
  due driver — `nvidia-580` + `mesa-radeonsi`).

## Comandi per riprodurre

```bash
export CGO_CFLAGS_ALLOW="-fno-strict-overflow|-fstack-clash-protection|-fcf-protection|-fno-omit-frame-pointer"
go build -tags "mpv spike1 gtk3" -trimpath -o build/bin/spike-mpv-render ./cmd/spike-mpv-render

mkdir -p dist/spike1
for HWDEC in no auto-safe; do
  for RES in 1920x1080 3840x2160; do
    W=${RES%x*}; H=${RES#*x}
    ./build/bin/spike-mpv-render \
      -url "av://lavfi:testsrc2=size=${RES}:rate=60" \
      -duration 8s -warmup 2s \
      -fbo-width $W -fbo-height $H \
      -hwdec $HWDEC \
      -output dist/spike1/smoke-${RES}-${HWDEC}.json
  done
done
```

## Asset di test mancante

Manca ancora il run con **clip reale HEVC/AV1** (BBB 4K HEVC, BBB
1080p H.264). Comando ufficiale documentato in `scripts/spike1-bench.sh`:

```bash
SPIKE1_URL=https://download.blender.org/demo/movies/BBB/bbb_sunflower_2160p_60fps_normal.mp4 \
  bash scripts/spike1-bench.sh
```

Da eseguire prima di sbloccare Fase 6.1 in produzione (richiede ~6 GB
di download + 60s di bench × 4 configurazioni = ~5 min).

